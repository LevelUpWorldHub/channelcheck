import { makeFinding } from "./rules.js";
import { basename, columnOf, splitLines } from "./text.js";
import type { Finding } from "./types.js";

export type ApiName =
  | "ChannelCreate"
  | "ChannelCreate_r"
  | "ConnectAttach"
  | "MsgSend"
  | "MsgSendv"
  | "MsgSendPulse"
  | "MsgReceive"
  | "MsgReceivePulse"
  | "MsgReply"
  | "resmgr_attach"
  | "dispatch_create"
  | "dispatch_create_channel"
  | "secpol_transition_type"
  | "SIGEV_PULSE_INIT"
  | "open"
  | "name_open";

export interface CallSite {
  api: ApiName;
  line: number;
  column: number;
  text: string;
  func: string;
  path?: string;
  coidVar?: string;
  flags?: string;
  checked: boolean;
  serverBlocking: boolean;
}

export interface Handler {
  name: string;
  line: number;
  endLine: number;
  body: string;
  param: string;
  guarded: boolean;
}

export interface ProgramModel {
  file: string;
  processName: string;
  highCriticality: boolean;
  calls: CallSite[];
  handlers: Handler[];
  paths: string[];
  transitionType?: string;
  isServer: boolean;
}

export interface SendEdge {
  from: string;
  to: string;
  file: string;
  line: number;
  sync: boolean;
  serverBlocking: boolean;
  path: string;
}

const GUARD = /->info\.cred|secpol_check_permission|secpol_check\b|secpol_get_permission|iofunc_check_access|ability_check|\bEPERM\b|\bEACCES\b/;

export function maskComments(content: string): string[] {
  const lines = splitLines(content);
  let block = false;
  return lines.map((line) => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (block) {
        const end = line.indexOf("*/", i);
        if (end < 0) {
          out += " ".repeat(line.length - i);
          return out;
        }
        out += " ".repeat(end + 2 - i);
        i = end + 2;
        block = false;
        continue;
      }
      if (line.startsWith("//", i)) {
        out += " ".repeat(line.length - i);
        break;
      }
      if (line.startsWith("/*", i)) {
        block = true;
        out += "  ";
        i += 2;
        continue;
      }
      const ch = line[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        out += ch;
        i++;
        while (i < line.length) {
          out += line[i];
          if (line[i] === "\\" && i + 1 < line.length) {
            out += line[i + 1];
            i += 2;
            continue;
          }
          if (line[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  });
}

function braceDelta(line: string): number {
  let delta = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

const API_RES: { api: ApiName; re: RegExp }[] = [
  { api: "dispatch_create_channel", re: /\bdispatch_create_channel\s*\(/ },
  { api: "dispatch_create", re: /\bdispatch_create\s*\(/ },
  { api: "ChannelCreate_r", re: /\bChannelCreate_r\s*\(/ },
  { api: "ChannelCreate", re: /\bChannelCreate\s*\(/ },
  { api: "ConnectAttach", re: /\bConnectAttach\s*\(/ },
  { api: "MsgSendPulse", re: /\bMsgSendPulse\s*\(/ },
  { api: "MsgSendv", re: /\bMsgSendv\s*\(/ },
  { api: "MsgSend", re: /\bMsgSend\s*\(/ },
  { api: "MsgReceivePulse", re: /\bMsgReceivePulse\s*\(/ },
  { api: "MsgReceive", re: /\bMsgReceive\s*\(/ },
  { api: "MsgReply", re: /\bMsgReply\s*\(/ },
  { api: "resmgr_attach", re: /\bresmgr_attach\s*\(/ },
  { api: "secpol_transition_type", re: /\bsecpol_transition_type\s*\(/ },
  { api: "SIGEV_PULSE_INIT", re: /\bSIGEV_PULSE_INIT\s*\(/ },
  { api: "name_open", re: /\bname_open\s*\(/ },
  { api: "open", re: /\bopen\s*\(/ },
];

function detectApi(line: string): ApiName | undefined {
  for (const entry of API_RES) {
    if (entry.re.test(line)) return entry.api;
  }
  return undefined;
}

function isChecked(lines: string[], index: number, api: string, varName?: string): boolean {
  const line = lines[index] ?? "";
  if (/\bif\s*\(/.test(line) && line.includes(api)) return true;
  if (!varName) return false;
  const window = lines.slice(index, index + 6).join("\n");
  const ident = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${ident}\\b\\s*(==|!=|<=|>=|<|>)\\s*(-1|0|NULL|EOK)`).test(window)) return true;
  if (new RegExp(`if\\s*\\(\\s*!?\\s*${ident}\\b`).test(window)) return true;
  return false;
}

function assignedVar(line: string, api: string): string | undefined {
  const re = new RegExp(`(?:\\b(?:int|long|coid_t|dispatch_t)\\b\\s*\\*?\\s*)?([A-Za-z_]\\w*)\\s*=\\s*[^;]*\\b${api}\\b`);
  return re.exec(line)?.[1];
}

export function parseProgram(file: string, content: string): ProgramModel {
  const original = splitLines(content);
  const masked = maskComments(content);
  const calls: CallSite[] = [];
  const handlers: Handler[] = [];
  let depth = 0;
  let func = "file";
  let funcStart = 1;
  let sig = "";
  let body: string[] = [];
  const filePaths = new Map<string, string>();
  let funcPaths = new Map<string, string>();
  let pendingTarget: string | undefined;
  let sawReceiveInMain = false;
  const highCriticality = /criticality:\s*(high|safety)/i.test(content) || /\bSCHED_FIFO\b/.test(content);

  const finishFunc = (endLine: number) => {
    if (func !== "file") {
      const text = body.join("\n");
      const param = /resmgr_context_t\s*\*\s*([A-Za-z_]\w*)/.exec(sig)?.[1]
        ?? /resmgr_context_t\s*\*\s*([A-Za-z_]\w*)/.exec(text)?.[1]
        ?? "ctp";
      handlers.push({
        name: func,
        line: funcStart,
        endLine,
        body: text,
        param,
        guarded: GUARD.test(text),
      });
    }
    body = [];
    sig = "";
  };

  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    const lineNo = i + 1;
    const trimmed = line.trim();
    const before = depth;

    if (before === 0) {
      if (trimmed && !trimmed.endsWith(";") && !/^(if|for|while|switch|else|do|return)\b/.test(trimmed)) {
        sig += `${sig ? " " : ""}${trimmed}`;
      } else if (trimmed.endsWith(";") && !trimmed.includes("{")) {
        sig = "";
      }
    }

    const delta = braceDelta(line);
    if (before === 0 && (line.includes("{") || (sig.includes("(") && delta > 0))) {
      const match = sig.match(/([A-Za-z_]\w*)\s*\([^;]*\)/);
      const name = match?.[1];
      if (name && !["if", "for", "while", "switch", "else", "do", "return", "sizeof"].includes(name)) {
        func = name;
        funcStart = lineNo;
        funcPaths = new Map(filePaths);
        if (func === "main") sawReceiveInMain = false;
      }
    }

    const targetComment = /@channelcheck-target:\s*(\S+)/.exec(original[i] ?? "")
      ?? /@channelcheck-target:\s*(\S+)/.exec(original[i - 1] ?? "")
      ?? /@channelcheck-target:\s*(\S+)/.exec(original[i - 2] ?? "");
    if (targetComment) pendingTarget = targetComment[1];

    const api = trimmed.startsWith("#") ? undefined : detectApi(line);
    if (api && !/^\s*(\/\/|\*)/.test(original[i] ?? "")) {
      const coidVar = assignedVar(line, api);
      let path: string | undefined;
      const openPath = /(?:open|name_open)\s*\(\s*"([^"]+)"/.exec(line)?.[1];
      const attachPath = /resmgr_attach\s*\([^,]+,[^,]+,\s*"([^"]+)"/.exec(line)?.[1];
      const transition = /secpol_transition_type\s*\([^,]+,\s*"([^"]+)"/.exec(line)?.[1];
      if (openPath) path = openPath;
      if (attachPath) path = attachPath;
      if ((api === "open" || api === "name_open") && coidVar && path) {
        funcPaths.set(coidVar, path);
        filePaths.set(coidVar, path);
      }
      if (api === "ConnectAttach" && coidVar && pendingTarget) {
        funcPaths.set(coidVar, pendingTarget);
        filePaths.set(coidVar, pendingTarget);
        path = pendingTarget;
      }
      if (api === "MsgSend" || api === "MsgSendv" || api === "MsgSendPulse") {
        const arg = /\bMsgSend(?:v|Pulse)?\s*\(\s*([^,)\s]+)/.exec(line)?.[1];
        if (arg && funcPaths.has(arg)) path = funcPaths.get(arg);
        else if (arg && filePaths.has(arg)) path = filePaths.get(arg);
        else if (pendingTarget && api !== "MsgSendPulse") path = path ?? pendingTarget;
      }
      const flags = api === "ChannelCreate" || api === "ChannelCreate_r"
        ? /\bChannelCreate(?:_r)?\s*\(\s*([^)]*)\)/.exec(line)?.[1]?.trim()
        : undefined;
      const serverBlocking = func !== "main" && func !== "file"
        ? true
        : func === "main" && sawReceiveInMain;
      calls.push({
        api,
        line: lineNo,
        column: columnOf(line, api),
        text: (original[i] ?? line).trim(),
        func,
        path: path ?? transition,
        coidVar,
        flags,
        checked: isChecked(masked, i, api, coidVar),
        serverBlocking,
      });
      if (api === "MsgReceive" || api === "MsgReceivePulse" || api === "dispatch_create" || api === "dispatch_create_channel") {
        if (func === "main") sawReceiveInMain = true;
      }
      if (api !== "ConnectAttach") pendingTarget = targetComment ? pendingTarget : undefined;
    } else if (!targetComment) {
      pendingTarget = undefined;
    }

    if (func !== "file") body.push(original[i] ?? line);
    depth += delta;
    if (depth < 0) depth = 0;
    if (before > 0 && depth === 0) {
      finishFunc(lineNo);
      func = "file";
      sig = "";
    }
  }

  const paths = calls.filter((call) => call.api === "resmgr_attach" && call.path).map((call) => call.path!) ;
  const transitionType = calls.find((call) => call.api === "secpol_transition_type")?.path;
  const isServer = calls.some((call) =>
    call.api === "resmgr_attach" || call.api === "MsgReceive" || call.api === "MsgReceivePulse"
    || call.api === "dispatch_create" || call.api === "dispatch_create_channel");

  for (const call of calls) {
    if (!isServer) call.serverBlocking = false;
    else if (call.func !== "main" && call.func !== "file") call.serverBlocking = true;
  }

  return {
    file,
    processName: basename(file).replace(/\.(c|cc|cpp|cxx|h|hh|hpp)$/, ""),
    highCriticality,
    calls,
    handlers,
    paths,
    transitionType,
    isServer,
  };
}

const ASSIGNED_HANDLER = /io_funcs\s*\.\s*(open|devctl)\s*=\s*([A-Za-z_]\w*)/g;

export function auditProgram(program: ProgramModel, highFromBuild = false): Finding[] {
  const findings: Finding[] = [];
  const high = program.highCriticality || highFromBuild;
  const file = program.file;
  const assigned = new Set<string>(["io_open", "io_devctl"]);
  for (const call of program.calls) {
    /* handlers discovered below from source text stored on calls */
    void call;
  }
  const sourceBlob = program.handlers.map((handler) => handler.body).join("\n") + program.calls.map((call) => call.text).join("\n");
  for (const match of sourceBlob.matchAll(ASSIGNED_HANDLER)) assigned.add(match[2]);

  if (program.isServer) {
    for (const call of program.calls) {
      if ((call.api === "ChannelCreate" || call.api === "ChannelCreate_r") && !call.flags?.includes("_NTO_CHF_FIXED_PRIORITY")) {
        findings.push(makeFinding(
          "QNX-IPC-PRIORITY-INVERSION",
          file,
          call.line,
          high
            ? `${call.api}(${call.flags || "0"}) has no _NTO_CHF_FIXED_PRIORITY on a high-criticality server.`
            : `${call.api}(${call.flags || "0"}) lets the server thread adopt the sender priority.`,
          { severity: high ? "error" : "warning", column: call.column },
        ));
      }
      if (call.api === "dispatch_create") {
        findings.push(makeFinding(
          "QNX-IPC-IMPLICIT-CHANNEL",
          file,
          call.line,
          "dispatch_create() allocates a channel without _NTO_CHF_FIXED_PRIORITY.",
          { severity: high ? "error" : "warning", column: call.column },
        ));
      }
      if ((call.api === "ChannelCreate" || call.api === "ChannelCreate_r") && !call.checked) {
        findings.push(makeFinding("QNX-IPC-UNCHECKED-CHANNEL", file, call.line, `${call.api} result is not checked.`, { column: call.column }));
      }
    }
  }

  for (const call of program.calls) {
    if ((call.api === "MsgSend" || call.api === "MsgSendv") && !call.checked) {
      findings.push(makeFinding("QNX-IPC-UNCHECKED-SEND", file, call.line, `${call.api} result is ignored.`, { column: call.column }));
    }
    if (call.api === "ConnectAttach" && !call.checked) {
      findings.push(makeFinding("QNX-IPC-UNCHECKED-CONNECT", file, call.line, "ConnectAttach result is ignored.", { column: call.column }));
    }
  }

  for (const handler of program.handlers) {
    if (!assigned.has(handler.name) && handler.name !== "io_open" && handler.name !== "io_devctl") continue;
    if (!assigned.has(handler.name)) continue;
    if (handler.guarded) continue;
    findings.push(makeFinding(
      "QNX-IPC-UNGUARDED-RESMGR",
      file,
      handler.line,
      `${handler.name}() performs resmgr work without a credential or secpol check.`,
    ));
  }
  return findings;
}

export function sendEdges(programs: ProgramModel[]): { edges: SendEdge[]; unresolved: Finding[] } {
  const byPath = new Map<string, string>();
  for (const program of programs) {
    for (const path of program.paths) byPath.set(path, program.file);
  }
  const edges: SendEdge[] = [];
  const unresolved: Finding[] = [];
  for (const program of programs) {
    for (const call of program.calls) {
      if (call.api !== "MsgSend" && call.api !== "MsgSendv" && call.api !== "MsgSendPulse") continue;
      if (!call.path) {
        if (call.api !== "MsgSendPulse") {
          unresolved.push(makeFinding(
            "QNX-IPC-UNRESOLVED-TARGET",
            program.file,
            call.line,
            `${call.api} uses a coid whose path is not visible in this workspace.`,
            { column: call.column },
          ));
        }
        continue;
      }
      const target = byPath.get(call.path);
      if (!target) {
        unresolved.push(makeFinding(
          "QNX-IPC-UNRESOLVED-TARGET",
          program.file,
          call.line,
          `${call.api} targets ${call.path}, which no resmgr_attach in this workspace provides.`,
          { column: call.column },
        ));
        continue;
      }
      edges.push({
        from: program.file,
        to: target,
        file: program.file,
        line: call.line,
        sync: call.api !== "MsgSendPulse",
        serverBlocking: call.serverBlocking && call.api !== "MsgSendPulse",
        path: call.path,
      });
    }
  }
  return { edges, unresolved };
}

export function findCycles(edges: SendEdge[]): SendEdge[][] {
  const blocking = edges.filter((edge) => edge.sync && edge.serverBlocking);
  const adj = new Map<string, SendEdge[]>();
  for (const edge of blocking) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge);
    adj.set(edge.from, list);
  }
  const cycles: SendEdge[][] = [];
  const stack: string[] = [];
  const stackEdges: SendEdge[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (node: string): void => {
    if (visiting.has(node)) {
      const at = stack.indexOf(node);
      if (at >= 0) cycles.push(stackEdges.slice(at));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const edge of adj.get(node) ?? []) {
      stackEdges.push(edge);
      dfs(edge.to);
      stackEdges.pop();
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adj.keys()) dfs(node);

  return cycles.filter((cycle) => cycle.length > 0);
}

export function deadlockFindings(edges: SendEdge[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const cycle of findCycles(edges)) {
    if (!cycle.length) continue;
    const key = cycle.map((edge) => `${edge.from}->${edge.to}`).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const breakEdge = [...cycle].sort((a, b) => `${a.file}:${String(a.line).padStart(6, "0")}`.localeCompare(`${b.file}:${String(b.line).padStart(6, "0")}`)).at(-1)!;
    const names = cycle.map((edge) => basename(edge.from).replace(/\.(c|cc|cpp|cxx)$/, ""));
    const unique = names.filter((name, index) => names.indexOf(name) === index);
    const label = unique.length === 1
      ? `${unique[0]} sends to its own channel while still inside the receive thread`
      : `${unique.join(" → ")} → ${unique[0]}`;
    findings.push(makeFinding(
      "QNX-IPC-DEADLOCK",
      breakEdge.file,
      breakEdge.line,
      `Synchronous MsgSend deadlock: ${label}.`,
    ));
  }
  return findings;
}

export function fixProgramContent(content: string, deadlockLines: Set<number>): string {
  const lines = splitLines(content);
  const masked = maskComments(content);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const code = masked[i] ?? line;
    if (!code.trim().startsWith("//") && !code.trim().startsWith("*")) {
      if (deadlockLines.has(i + 1) && /\bMsgSendv?\s*\(/.test(code) && !/\bMsgSendPulse\s*\(/.test(code)) {
        line = breakDeadlock(line);
      } else {
        line = addFixedPriority(line);
        line = wrapBareSend(line);
      }
    }
    out.push(line);
  }
  let text = out.join("\n");
  text = fixDispatch(text);
  text = insertReturnChecks(text);
  text = insertHandlerGuards(text);
  if (text.includes("EPERM") && !text.includes("<errno.h>")) {
    text = `#include <errno.h>\n${text}`;
  }
  return text;
}

function addFixedPriority(line: string): string {
  return line.replace(/\b(ChannelCreate(?:_r)?)\s*\(\s*([^)]*)\)/g, (full, api: string, flags: string) => {
    if (flags.includes("_NTO_CHF_FIXED_PRIORITY")) return full;
    const trimmed = flags.trim();
    if (trimmed === "" || trimmed === "0") return `${api}(_NTO_CHF_FIXED_PRIORITY)`;
    return `${api}(${trimmed} | _NTO_CHF_FIXED_PRIORITY)`;
  });
}

function wrapBareSend(line: string): string {
  if (/\bif\s*\(/.test(line)) return line;
  const match = /^(\s*)(MsgSendv?)\s*\((.*)\)\s*;\s*$/.exec(line);
  if (!match) return line;
  return `${match[1]}if (${match[2]}(${match[3]}) == -1) { return -1; }`;
}

function breakDeadlock(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const arg = /\bMsgSendv?\s*\(\s*([^,)\s]+)/.exec(line)?.[1] ?? "coid";
  return `${indent}if (MsgSendPulse(${arg}, SIGEV_PULSE_PRIO_INHERIT, 1, 0) == -1) { return -1; } /* ChannelCheck: pulse breaks the synchronous MsgSend cycle */`;
}

function fixDispatch(content: string): string {
  if (!/\bdispatch_create\s*\(/.test(content)) return content;
  const assigned = /(?:\bint\s+)?([A-Za-z_]\w*)\s*=\s*ChannelCreate(?:_r)?\s*\(/.exec(content);
  if (assigned) {
    return content.replace(/\bdispatch_create\s*\(\s*\)/g, `dispatch_create_channel(${assigned[1]}, 0)`);
  }
  return content.replace(
    /^(\s*)(.*)\bdispatch_create\s*\(\s*\)\s*;/m,
    (_full, indent: string, prefix: string) =>
      `${indent}int chid_fixed = ChannelCreate(_NTO_CHF_FIXED_PRIORITY);\n${indent}if (chid_fixed == -1) { return -1; }\n${indent}${prefix}dispatch_create_channel(chid_fixed, 0);`,
  );
}

function insertReturnChecks(content: string): string {
  const lines = splitLines(content);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const match = /(?:\b(?:int|long)\s+)?([A-Za-z_]\w*)\s*=\s*(ChannelCreate(?:_r)?|ConnectAttach)\s*\(/.exec(line);
    if (!match || /\bif\s*\(/.test(line)) continue;
    const variable = match[1];
    const api = match[2];
    const window = lines.slice(i, i + 5).join("\n");
    if (new RegExp(`\\b${variable}\\b\\s*(==|!=|<)\\s*(-1|0)`).test(window) || new RegExp(`if\\s*\\(\\s*!?\\s*${variable}\\b`).test(window)) {
      continue;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    const test = api.endsWith("_r") ? `${variable} < 0` : `${variable} == -1`;
    out.push(`${indent}if (${test}) { return -1; }`);
  }
  return out.join("\n");
}

function insertHandlerGuards(content: string): string {
  const names = new Set<string>(["io_open", "io_devctl"]);
  for (const match of content.matchAll(/io_funcs\s*\.\s*(?:open|devctl)\s*=\s*([A-Za-z_]\w*)/g)) {
    names.add(match[1]);
  }
  const lines = splitLines(content);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const def = /^(\s*)(?:static\s+)?(?:inline\s+)?[\w\s\*]+\s+([A-Za-z_]\w*)\s*\(([^;]*)\)\s*\{?\s*$/.exec(lines[i]);
    const braceOnly = i > 0 && /^\s*\{\s*$/.test(lines[i]);
    let name: string | undefined;
    let signature = "";
    let indent = "    ";
    if (def && names.has(def[2]) && lines[i].includes("{")) {
      name = def[2];
      signature = def[3];
      indent = `${def[1]}    `;
    } else if (braceOnly) {
      const prev = /([A-Za-z_]\w*)\s*\(([^;]*)\)\s*$/.exec(lines[i - 1].trim());
      if (prev && names.has(prev[1])) {
        name = prev[1];
        signature = prev[2];
        indent = `${/^\s*/.exec(lines[i])?.[0] ?? ""}    `;
      }
    }
    if (!name) continue;
    const body = lines.slice(i, Math.min(lines.length, i + 40)).join("\n");
    if (GUARD.test(body)) continue;
    const param = /resmgr_context_t\s*\*\s*([A-Za-z_]\w*)/.exec(signature)?.[1] ?? "ctp";
    out.push(`${indent}if (${param}->info.cred.euid != 0) {`);
    out.push(`${indent}    return EPERM;`);
    out.push(`${indent}}`);
  }
  return out.join("\n");
}
