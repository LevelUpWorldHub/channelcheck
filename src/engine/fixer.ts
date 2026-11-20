import { fixBuildContent, parseBuildfile } from "./buildfile.js";
import { unifiedDiff } from "./diff.js";
import { deadlockFindings, fixProgramContent, parseProgram, sendEdges } from "./ipc.js";
import { fixSecpolContent, parseSecpol } from "./secpol.js";
import { inferType } from "./text.js";
import type { DiffFile, FixResult, SourceFile } from "./types.js";

function sourcePath(path: string): boolean {
  return /\.(c|cc|cpp|cxx)$/.test(path);
}

export function applySafeFixes(files: SourceFile[]): FixResult {
  const programs = files.filter((file) => sourcePath(file.path)).map((file) => parseProgram(file.path, file.content));
  const sent = sendEdges(programs);
  const deadlockLines = new Map<string, Set<number>>();
  for (const finding of deadlockFindings(sent.edges)) {
    const set = deadlockLines.get(finding.file) ?? new Set<number>();
    set.add(finding.line);
    deadlockLines.set(finding.file, set);
  }

  const declared = files
    .filter((file) => file.path.endsWith(".secpol"))
    .flatMap((file) => parseSecpol(file.path, file.content).types.map((type) => type.name));

  const next = files.map((file) => {
    if (sourcePath(file.path)) {
      return { path: file.path, content: fixProgramContent(file.content, deadlockLines.get(file.path) ?? new Set()) };
    }
    if (file.path.endsWith(".build")) {
      return { path: file.path, content: fixBuildContent(file.content, file.path, declared) };
    }
    return file;
  });

  const fixedPrograms = next.filter((file) => sourcePath(file.path)).map((file) => parseProgram(file.path, file.content));
  const fixedEdges = sendEdges(fixedPrograms).edges;
  const launches = next
    .filter((file) => file.path.endsWith(".build"))
    .flatMap((file) => parseBuildfile(file.path, file.content).commands);
  const typeByProcess = new Map<string, string>();
  for (const program of fixedPrograms) {
    const launch = launches.find((cmd) => cmd.binary === program.processName);
    const typeName = program.transitionType || launch?.typeName || (launch ? inferType(program.processName, declared) : undefined);
    if (typeName) typeByProcess.set(program.file, typeName);
  }
  const needed = new Set<string>();
  for (const cmd of launches) if (cmd.typeName) needed.add(cmd.typeName);
  for (const program of fixedPrograms) if (program.transitionType) needed.add(program.transitionType);
  const pairs: { source: string; target: string }[] = [];
  for (const edge of fixedEdges) {
    const source = typeByProcess.get(edge.from);
    const target = typeByProcess.get(edge.to);
    if (!source || !target) continue;
    needed.add(source);
    needed.add(target);
    pairs.push({ source, target });
  }

  const finished = next.map((file) => {
    if (!file.path.endsWith(".secpol")) return file;
    return { path: file.path, content: fixSecpolContent(file.content, [...needed], pairs) };
  });

  const diffs: DiffFile[] = [];
  files.forEach((file, index) => {
    if (file.content === finished[index].content) return;
    diffs.push({
      file: file.path,
      before: file.content,
      after: finished[index].content,
      diff: unifiedDiff(file.path, file.content, finished[index].content),
    });
  });
  return { files: finished, diffs, applied: diffs.length };
}
