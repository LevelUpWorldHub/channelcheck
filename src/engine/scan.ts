import { auditBuild, bootTimeline, parseBuildfile, type BuildModel, type ScriptCommand } from "./buildfile.js";
import { auditProgram, deadlockFindings, findCycles, parseProgram, sendEdges, type ProgramModel, type SendEdge } from "./ipc.js";
import { resetFindingIds, RULES, makeFinding } from "./rules.js";
import { allowsChannel, auditSecpol, parseSecpol, referencedTypes, type SecpolModel } from "./secpol.js";
import { PROLOGUE, inferType } from "./text.js";
import type { BootEvent, Finding, GraphEdge, GraphNode, ScanGraph, ScanResult, Scorecard, Severity, SourceFile } from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export interface Analysis {
  findings: Finding[];
  graph: ScanGraph;
  boot: BootEvent[];
  score: Scorecard;
  builds: BuildModel[];
  policies: SecpolModel[];
  programs: ProgramModel[];
  edges: SendEdge[];
  processTypes: Map<string, string>;
}

function analyzed(path: string): boolean {
  return /\.(build|secpol|c|cc|cpp|cxx|h|hh|hpp)$/.test(path);
}

export function isSource(path: string): boolean {
  return /\.(c|cc|cpp|cxx|h|hh|hpp)$/.test(path);
}

export function scoreOf(findings: Finding[], confined: number, unconfined: number): Scorecard {
  const count = (severity: Severity) => findings.filter((finding) => finding.severity === severity).length;
  const critical = count("critical");
  const error = count("error");
  const warning = count("warning");
  const info = count("info");
  const score = Math.max(0, Math.min(100, 100 - critical * 12 - error * 5 - warning * 2 - info));
  return {
    score,
    critical,
    error,
    warning,
    info,
    posture: score >= 90 ? "locked" : score >= 55 ? "hardening" : "exposed",
    confined,
    unconfined,
  };
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.ruleId}|${finding.file}|${finding.line}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function launchFor(commands: ScriptCommand[], processName: string): ScriptCommand | undefined {
  return commands.find((cmd) => cmd.binary === processName);
}

export function analyze(files: SourceFile[]): Analysis {
  resetFindingIds();
  const findings: Finding[] = [];
  const builds: BuildModel[] = [];
  const policies: SecpolModel[] = [];
  const programs: ProgramModel[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!analyzed(file.path)) continue;
    try {
      if (file.path.endsWith(".build")) builds.push(parseBuildfile(file.path, file.content));
      else if (file.path.endsWith(".secpol")) policies.push(parseSecpol(file.path, file.content));
      else programs.push(parseProgram(file.path, file.content));
    } catch (error) {
      findings.push(makeFinding(
        "QNX-PARSE",
        file.path,
        1,
        error instanceof Error ? error.message : "parse failed",
      ));
    }
  }

  const commands = builds.flatMap((build) => build.commands);
  for (const build of builds) findings.push(...auditBuild(build));
  for (const policy of policies) findings.push(...auditSecpol(policy));

  for (const program of programs) {
    const launch = launchFor(commands, program.processName);
    const high = Boolean(launch && ((launch.priority ?? 0) >= 20 || launch.fifo));
    findings.push(...auditProgram(program, high));
  }

  const sent = sendEdges(programs);
  findings.push(...sent.unresolved);
  findings.push(...deadlockFindings(sent.edges));

  const declared = new Set(policies.flatMap((policy) => policy.types.map((type) => type.name)));
  const declaredList = [...declared];
  const processTypes = new Map<string, string>();
  for (const program of programs) {
    const launch = launchFor(commands, program.processName);
    const typeName = program.transitionType || launch?.typeName || (launch ? inferType(program.processName, declaredList) : undefined);
    if (typeName) processTypes.set(program.file, typeName);
  }

  for (const build of builds) {
    for (const cmd of build.commands) {
      if (!cmd.typeName) continue;
      if (!declared.has(cmd.typeName)) {
        findings.push(makeFinding(
          "QNX-SEC-ORPHAN-TYPE",
          build.file,
          cmd.line,
          `on -T ${cmd.typeName} has no matching type declaration in the security policy.`,
        ));
      }
    }
  }

  const launchTypes = new Set(commands.map((cmd) => cmd.typeName).filter((type): type is string => Boolean(type)));
  const transitionTypes = new Set(programs.map((program) => program.transitionType).filter((type): type is string => Boolean(type)));
  const ruleTypes = new Set(policies.flatMap((policy) => [...referencedTypes(policy)]));
  for (const policy of policies) {
    for (const type of policy.types) {
      const used = ruleTypes.has(type.name) || launchTypes.has(type.name) || transitionTypes.has(type.name);
      if (!used) {
        findings.push(makeFinding(
          "QNX-SEC-DANGLING-TYPE",
          policy.file,
          type.line,
          `Type ${type.name} is declared but never used by a rule, on -T launch, or secpol_transition_type().`,
        ));
      }
    }
    for (const attach of policy.attaches) {
      if (!launchTypes.has(attach.typeName)) {
        findings.push(makeFinding(
          "QNX-SEC-UNAPPLIED-TYPE",
          policy.file,
          attach.line,
          `allow_attach permits ${attach.typeName} to own ${attach.path}, but the IFS never starts it with on -T.`,
        ));
      }
    }
  }

  for (const edge of sent.edges) {
    const source = processTypes.get(edge.from);
    const target = processTypes.get(edge.to);
    if (!source || !target) continue;
    const covered = policies.some((policy) => allowsChannel(policy, source, target));
    if (!covered) {
      findings.push(makeFinding(
        "QNX-SEC-MISSING-ALLOW",
        edge.file,
        edge.line,
        `No allow ${source} ${target}:channel connect rule for the ${edge.sync ? "MsgSend" : "MsgSendPulse"} to ${edge.path}.`,
      ));
    }
  }

  const cycles = findCycles(sent.edges);
  const cyclePairs = new Set(cycles.flatMap((cycle) => cycle.map((edge) => `${edge.from}->${edge.to}:${edge.line}`)));
  const cycleNodes = new Set(cycles.flatMap((cycle) => cycle.flatMap((edge) => [edge.from, edge.to])));

  const nodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  for (const program of programs) {
    if (!program.calls.length && !launchFor(commands, program.processName)) continue;
    const launch = launchFor(commands, program.processName);
    const creates = program.calls.filter((call) => call.api === "ChannelCreate" || call.api === "ChannelCreate_r");
    const implicit = program.calls.some((call) => call.api === "dispatch_create");
    const hasChannel = creates.length > 0 || implicit || program.calls.some((call) => call.api === "dispatch_create_channel");
    const fixed = hasChannel && !implicit && creates.some((call) => call.flags?.includes("_NTO_CHF_FIXED_PRIORITY"));
    const priority = !hasChannel
      ? "client"
      : launch?.priority !== undefined
        ? `${launch.fifo ? "FIFO" : "RR"} ${launch.priority}${fixed ? " · fixed" : " · inherited"}`
        : fixed ? "fixed priority" : "inherited priority";
    nodes.push({
      id: program.file,
      kind: "process",
      label: program.processName,
      file: program.file,
      secpolType: processTypes.get(program.file),
      paths: program.paths,
      criticality: program.highCriticality || (launch?.priority ?? 0) >= 20 || Boolean(launch?.fifo) ? "high" : "normal",
      confined: Boolean(launch?.typeName),
      inCycle: cycleNodes.has(program.file),
      priority,
    });
  }

  const typeIds = new Set<string>();
  for (const program of programs) {
    const typeName = processTypes.get(program.file);
    if (!typeName) continue;
    const id = `type:${typeName}`;
    if (!typeIds.has(id)) {
      typeIds.add(id);
      nodes.push({
        id,
        kind: "type",
        label: typeName,
        secpolType: typeName,
        paths: [],
        criticality: "normal",
        confined: true,
        inCycle: false,
      });
    }
    graphEdges.push({
      id: `confines:${program.file}:${typeName}`,
      from: program.file,
      to: id,
      kind: "confines",
      sync: false,
      inCycle: false,
      label: "on -T / transition",
      file: program.file,
      line: 1,
    });
  }

  sent.edges.forEach((edge, index) => {
    graphEdges.push({
      id: `ipc:${index}:${edge.from}:${edge.to}:${edge.line}`,
      from: edge.from,
      to: edge.to,
      kind: edge.sync ? "msgsend" : "pulse",
      sync: edge.sync,
      inCycle: cyclePairs.has(`${edge.from}->${edge.to}:${edge.line}`),
      label: edge.sync ? "MsgSend" : "MsgSendPulse",
      file: edge.file,
      line: edge.line,
    });
  });

  const boot = builds.flatMap((build) => bootTimeline(build));
  const interesting = commands.filter((cmd) => !PROLOGUE.has(cmd.binary) && cmd.binary !== "secpolpush" && cmd.binary !== "secpolgenerate");
  const confined = interesting.filter((cmd) => cmd.typeName).length;
  const cleaned = dedupe(findings).sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));

  return {
    findings: cleaned,
    graph: { nodes, edges: graphEdges, cycles: cycles.map((cycle) => cycle.map((edge) => edge.from)) },
    boot,
    score: scoreOf(cleaned, confined, interesting.length - confined),
    builds,
    policies,
    programs,
    edges: sent.edges,
    processTypes,
  };
}

export function scanWorkspace(files: SourceFile[]): ScanResult {
  const analysis = analyze(files);
  return {
    findings: analysis.findings,
    graph: analysis.graph,
    boot: analysis.boot,
    score: analysis.score,
    files,
    rules: RULES,
  };
}
