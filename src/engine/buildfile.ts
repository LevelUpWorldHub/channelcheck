import { makeFinding } from "./rules.js";
import {
  DEBUG_BINS,
  EXITS,
  PROLOGUE,
  basename,
  inferType,
  columnOf,
  fixPathValue,
  fixPermValue,
  permsRisk,
  splitLines,
  stripHashComment,
  tokenize,
  unsafePath,
} from "./text.js";
import type { BootEvent, Finding } from "./types.js";

export interface Attrs {
  flags: Record<string, boolean>;
  values: Record<string, string>;
  raw: string;
}

export interface ScriptCommand {
  line: number;
  text: string;
  argv: string[];
  binary: string;
  background: boolean;
  typeName?: string;
  uid?: string;
  priority?: number;
  fifo: boolean;
  modifiers: string[];
}

export interface FileEntry {
  line: number;
  text: string;
  target: string;
  effectiveTarget: string;
  source?: string;
  attrs: Attrs;
  kind: "file" | "link" | "dir" | "fifo" | "inline";
  inlineKind?: "script" | "bootstrap" | "data";
}

export interface ScriptBlock {
  openLine: number;
  bodyStart: number;
  bodyEnd: number;
  closeLine: number;
  body: { line: number; text: string }[];
}

export interface BuildModel {
  file: string;
  lines: string[];
  entries: FileEntry[];
  commands: ScriptCommand[];
  bootstrap: ScriptCommand[];
  scriptBlocks: ScriptBlock[];
  pathValues: { line: number; value: string }[];
  hasPolicyBlob: boolean;
  bootable: boolean;
  dupignore: boolean;
  prefix: string;
}

const emptyAttrs = (): Attrs => ({ flags: {}, values: {}, raw: "" });

function mergeAttrs(base: Attrs, extra: Attrs): Attrs {
  return {
    flags: { ...base.flags, ...extra.flags },
    values: { ...base.values, ...extra.values },
    raw: [base.raw, extra.raw].filter(Boolean).join(" "),
  };
}

export function parseAttrInner(inner: string): Attrs {
  const attrs = emptyAttrs();
  attrs.raw = inner.trim();
  const tokens = tokenize(inner);
  for (const token of tokens) {
    if (token.startsWith("+") || token.startsWith("-")) {
      const on = token.startsWith("+");
      const name = token.slice(1).trim();
      if (name) attrs.flags[name] = on;
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      attrs.values[token.slice(0, eq)] = token.slice(eq + 1);
    }
  }
  return attrs;
}

function takeAttrs(line: string): { attrs: Attrs; rest: string } | null {
  if (!line.trimStart().startsWith("[")) return null;
  const start = line.indexOf("[");
  const end = line.indexOf("]", start);
  if (end < 0) return null;
  const attrs = parseAttrInner(line.slice(start + 1, end));
  return { attrs, rest: line.slice(end + 1).trim() };
}

export function parseScriptCommand(raw: string, line: number, stickyMods: string[] = []): ScriptCommand | null {
  let text = raw.trim();
  if (!text || text.startsWith("#")) return null;
  let background = false;
  if (text.endsWith("&")) {
    background = true;
    text = text.slice(0, -1).trim();
  }
  const modifiers = [...stickyMods];
  let rest = text;
  while (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) break;
    modifiers.push(rest.slice(1, end).trim());
    rest = rest.slice(end + 1).trim();
  }
  if (!rest) return null;
  const tokens = tokenize(rest).filter((token) => token !== "&");
  if (tokens.some((token) => token === "&")) background = true;
  const argv: string[] = [];
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) && argv.length === 0) continue;
    argv.push(token);
  }
  if (argv.length === 0) return null;
  let index = 0;
  let typeName: string | undefined;
  let uid: string | undefined;
  let binary = basename(argv[0]);
  if (argv[0] === "on") {
    index = 1;
    const withArg = new Set(["-T", "-u", "-C", "-p", "-n", "-R", "-t"]);
    while (index < argv.length && argv[index].startsWith("-")) {
      const opt = argv[index];
      index++;
      if (withArg.has(opt) && index < argv.length && !argv[index].startsWith("-")) {
        const value = argv[index++];
        if (opt === "-T") typeName = value;
        if (opt === "-u") uid = value;
      }
    }
    if (argv[index]) binary = basename(argv[index]);
  }
  let priority: number | undefined;
  let fifo = false;
  for (const mod of modifiers) {
    for (const part of mod.split(/\s+/)) {
      const match = /^pri=(\d+)([fro])?$/i.exec(part);
      if (!match) continue;
      priority = Number(match[1]);
      fifo = match[2]?.toLowerCase() === "f";
    }
  }
  return {
    line,
    text: raw.trim(),
    argv,
    binary,
    background,
    typeName,
    uid,
    priority,
    fifo,
    modifiers,
  };
}

function effectiveTarget(target: string, prefix: string, bootable: boolean): string {
  if (target.startsWith("/")) return target.replace(/\/+/g, "/");
  const p = (prefix || (bootable ? "proc/boot" : "")).replace(/^\/+|\/+$/g, "");
  if (!p) return target;
  return `/${p}/${target}`.replace(/\/+/g, "/");
}

function collectPaths(line: string, lineNo: number, into: { line: number; value: string }[]): void {
  const re = /(?:^|[\s])PATH=([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    into.push({ line: lineNo, value: match[1] });
  }
}

export function parseBuildfile(file: string, content: string): BuildModel {
  const lines = splitLines(content);
  const entries: FileEntry[] = [];
  const commands: ScriptCommand[] = [];
  const bootstrap: ScriptCommand[] = [];
  const scriptBlocks: ScriptBlock[] = [];
  const pathValues: { line: number; value: string }[] = [];
  let sticky = emptyAttrs();
  let bootable = false;
  let dupignore = false;
  let prefix = "";

  const pushEntry = (entry: FileEntry): void => {
    entries.push(entry);
    if (entry.attrs.flags.dupignore) dupignore = true;
    if (entry.attrs.values.prefix !== undefined) prefix = entry.attrs.values.prefix;
    if (entry.attrs.values.virtual) bootable = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const physical = lines[i];
    collectPaths(physical, i + 1, pathValues);
    const stripped = stripHashComment(physical).trim();
    if (!stripped) continue;
    const taken = takeAttrs(stripped);
    const lineAttrs = taken?.attrs ?? emptyAttrs();
    const rest = (taken ? taken.rest : stripped).trim();
    const attrs = mergeAttrs(sticky, lineAttrs);
    if (taken && !rest) {
      sticky = mergeAttrs(sticky, lineAttrs);
      if (lineAttrs.flags.dupignore) dupignore = true;
      if (lineAttrs.values.prefix !== undefined) prefix = lineAttrs.values.prefix;
      if (lineAttrs.values.virtual) bootable = true;
      continue;
    }
    if (rest.endsWith("{") || /\{\s*$/.test(rest)) {
      const spec = rest.replace(/\{\s*$/, "").trim();
      const eq = spec.indexOf("=");
      const name = (eq >= 0 ? spec.slice(0, eq) : spec).trim();
      const body: { line: number; text: string }[] = [];
      const bodyStart = i + 2;
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^\}\s*(#.*)?$/.test(lines[j].trim())) break;
        body.push({ line: j + 1, text: lines[j] });
        collectPaths(lines[j], j + 1, pathValues);
      }
      const closeLine = j < lines.length ? j + 1 : lines.length;
      const isBootstrap = Boolean(attrs.values.virtual) || name === ".bootstrap" || name === "boot";
      const isScript = Boolean(attrs.flags.script) || name === ".script" || name.includes("script");
      const inlineKind = isBootstrap ? "bootstrap" : isScript ? "script" : "data";
      if (attrs.values.virtual) bootable = true;
      const usePrefix = attrs.values.prefix ?? prefix;
      pushEntry({
        line: i + 1,
        text: physical.trim(),
        target: name || spec,
        effectiveTarget: effectiveTarget(name || spec, usePrefix, bootable || Boolean(attrs.values.virtual)),
        attrs,
        kind: "inline",
        inlineKind,
      });
      const bucket = inlineKind === "bootstrap" ? bootstrap : inlineKind === "script" ? commands : null;
      if (inlineKind === "script") {
        scriptBlocks.push({
          openLine: i + 1,
          bodyStart,
          bodyEnd: closeLine - 1,
          closeLine,
          body,
        });
      }
      if (bucket) {
        let stickyMods: string[] = [];
        for (const src of body) {
          const code = inlineKind === "script" ? src.text.replace(/^\s*#.*$/, "").trim() : src.text.trim();
          if (!code || code.startsWith("#")) continue;
          if (/^\[[^\]]*\]\s*$/.test(code)) {
            const inner = code.slice(1, code.lastIndexOf("]")).trim();
            stickyMods = [...stickyMods, inner];
            continue;
          }
          const cmd = parseScriptCommand(src.text, src.line, stickyMods);
          if (cmd) bucket.push(cmd);
        }
      }
      i = j;
      continue;
    }
    let target = rest;
    let source: string | undefined;
    const eq = rest.indexOf("=");
    if (eq >= 0) {
      target = rest.slice(0, eq).trim();
      source = rest.slice(eq + 1).trim();
    }
    const kind = attrs.values.type === "link"
      ? "link"
      : attrs.values.type === "dir"
        ? "dir"
        : attrs.values.type === "fifo"
          ? "fifo"
          : "file";
    if (attrs.values.virtual) bootable = true;
    const usePrefix = attrs.values.prefix ?? prefix;
    pushEntry({
      line: i + 1,
      text: physical.trim(),
      target,
      source,
      effectiveTarget: effectiveTarget(target, usePrefix, bootable),
      attrs,
      kind,
    });
  }

  const hasPolicyBlob = entries.some((entry) => entry.effectiveTarget.endsWith("/secpol.bin") || entry.target.endsWith("secpol.bin"));
  return {
    file,
    lines,
    entries,
    commands,
    bootstrap,
    scriptBlocks,
    pathValues,
    hasPolicyBlob,
    bootable,
    dupignore,
    prefix: prefix || (bootable ? "proc/boot" : ""),
  };
}

function rootOwned(cmd: ScriptCommand): boolean {
  if (!cmd.uid) return true;
  const uid = cmd.uid.split(":")[0];
  return uid === "0" || uid === "root";
}

export function auditBuild(model: BuildModel): Finding[] {
  const findings: Finding[] = [];
  const file = model.file;

  if (!model.bootstrap.length && !model.entries.some((entry) => entry.inlineKind === "bootstrap")) {
    findings.push(makeFinding("QNX-IFS-BOOTSTRAP", file, 1, "Bootable image has no [virtual=...] bootstrap block."));
  } else if (model.bootstrap.length) {
    const first = model.bootstrap[0];
    if (!first.binary.startsWith("startup-") && !first.binary.startsWith("startup_")) {
      findings.push(makeFinding(
        "QNX-IFS-BOOTSTRAP",
        file,
        first.line,
        `First bootstrap executable is ${first.binary}; QNX 8 requires startup-* before procnto.`,
      ));
    }
    if (!model.bootstrap.some((cmd) => cmd.binary.startsWith("procnto"))) {
      findings.push(makeFinding(
        "QNX-IFS-BOOTSTRAP",
        file,
        model.bootstrap[0].line,
        "Bootstrap does not contain procnto-smp-instr (or another procnto).",
      ));
    }
  }

  for (const path of model.pathValues) {
    if (unsafePath(path.value)) {
      findings.push(makeFinding(
        "QNX-IFS-UNSAFE-PATH",
        file,
        path.line,
        `PATH=${path.value} includes an empty, relative, or /tmp component.`,
        { column: columnOf(model.lines[path.line - 1] ?? "", "PATH=") },
      ));
    }
  }

  const secpol = model.commands.find((cmd) => cmd.binary === "secpolpush");
  if (!secpol) {
    const line = model.scriptBlocks[0]?.openLine ?? 1;
    findings.push(makeFinding("QNX-IFS-SECPOL-MISSING", file, line, "The startup script never calls secpolpush."));
  } else {
    for (const cmd of model.commands) {
      if (cmd.line >= secpol.line) break;
      if (PROLOGUE.has(cmd.binary)) continue;
      findings.push(makeFinding(
        "QNX-IFS-SECPOL-ORDER",
        file,
        cmd.line,
        `${cmd.binary} is launched before secpolpush, so it cannot receive a security type.`,
      ));
    }
    if (!model.hasPolicyBlob) {
      findings.push(makeFinding(
        "QNX-IFS-POLICY-BLOB",
        file,
        secpol.line,
        "secpolpush runs, but the image has no /proc/boot/secpol.bin entry.",
      ));
    }
  }

  let devcLine = -1;
  for (const cmd of model.commands) {
    if (cmd.binary.startsWith("devc-") || cmd.binary.startsWith("devc_")) {
      devcLine = cmd.line;
      break;
    }
  }
  for (const cmd of model.commands) {
    if (DEBUG_BINS.has(cmd.binary)) {
      findings.push(makeFinding(
        "QNX-IFS-DEBUG-SHELL",
        file,
        cmd.line,
        `${cmd.binary} is a development backdoor and is still launched from the production script.`,
      ));
    }
    if (!DEBUG_BINS.has(cmd.binary) && !PROLOGUE.has(cmd.binary) && cmd.binary !== "secpolpush" && cmd.binary !== "secpolgenerate" && !cmd.typeName) {
      const root = rootOwned(cmd);
      findings.push(makeFinding(
        root ? "QNX-IFS-UNCONFINED-ROOT" : "QNX-IFS-UNCONFINED",
        file,
        cmd.line,
        `${cmd.binary} is started ${root ? "as root " : ""}without on -T.`,
      ));
    }
    if (!cmd.background && !EXITS.has(cmd.binary)) {
      findings.push(makeFinding(
        "QNX-IFS-FOREGROUND",
        file,
        cmd.line,
        `${cmd.binary} is started in the foreground, so the rest of the IFS script never runs.`,
      ));
    }
    if (cmd.binary === "reopen") {
      const dev = cmd.argv.find((arg) => arg.startsWith("/dev/"));
      if (dev && (devcLine < 0 || devcLine > cmd.line)) {
        findings.push(makeFinding(
          "QNX-IFS-BOOT-ORDER",
          file,
          cmd.line,
          `reopen ${dev} appears before the devc-* driver that creates it.`,
        ));
      }
    }
  }

  const seen = new Map<string, number>();
  for (const entry of model.entries) {
    if (entry.kind === "inline" && entry.inlineKind !== "data") continue;
    const key = entry.effectiveTarget;
    if (!key) continue;
    const prev = seen.get(key);
    if (prev !== undefined) {
      findings.push(makeFinding(
        "QNX-IFS-DUPLICATE-TARGET",
        file,
        entry.line,
        `${key} is already defined on line ${prev}. ${model.dupignore ? "+dupignore will silently drop one of them." : "mkifs rejects the duplicate."}`,
        { severity: model.dupignore ? "warning" : "error" },
      ));
    } else {
      seen.set(key, entry.line);
    }
    const names = [basename(entry.target), entry.source ? basename(entry.source) : ""];
    if (names.some((name) => DEBUG_BINS.has(name))) {
      findings.push(makeFinding(
        "QNX-IFS-DEBUG-SHELL",
        file,
        entry.line,
        `${entry.target} ships ${names.find((name) => DEBUG_BINS.has(name))} inside the image.`,
      ));
    }
    const perms = entry.attrs.values.perms;
    if (perms) {
      const risk = permsRisk(perms);
      if (risk.setuid) {
        findings.push(makeFinding("QNX-IFS-SETUID", file, entry.line, `${entry.target} is setuid/setgid (perms=${perms}).`));
      }
      if (risk.worldWritable) {
        findings.push(makeFinding("QNX-IFS-WORLD-WRITABLE", file, entry.line, `${entry.target} is world-writable (perms=${perms}).`));
      }
    }
  }

  return findings;
}

export function bootTimeline(model: BuildModel): BootEvent[] {
  const events: BootEvent[] = [];
  for (const cmd of model.bootstrap) {
    events.push({
      file: model.file,
      line: cmd.line,
      text: cmd.text,
      phase: "bootstrap",
    });
  }
  const secpolLine = model.commands.find((cmd) => cmd.binary === "secpolpush")?.line ?? Number.POSITIVE_INFINITY;
  for (const cmd of model.commands) {
    let phase: BootEvent["phase"] = "service";
    if (DEBUG_BINS.has(cmd.binary)) phase = "debug";
    else if (cmd.binary === "secpolpush") phase = "policy";
    else if (PROLOGUE.has(cmd.binary)) phase = "prologue";
    else if (cmd.line < secpolLine) phase = "risk";
    events.push({ file: model.file, line: cmd.line, text: cmd.text, phase });
  }
  return events;
}

export function fixBuildContent(content: string, file: string, declared: string[]): string {
  const model = parseBuildfile(file, content);
  const lines = [...model.lines];
  const deleteLines = new Set<number>();
  const seen = new Set<string>();
  for (const entry of model.entries) {
    if (entry.kind === "inline" && entry.inlineKind !== "data") continue;
    const names = [basename(entry.target), entry.source ? basename(entry.source) : ""];
    if (names.some((name) => DEBUG_BINS.has(name))) {
      deleteLines.add(entry.line);
      continue;
    }
    if (seen.has(entry.effectiveTarget)) deleteLines.add(entry.line);
    else seen.add(entry.effectiveTarget);
  }

  const replacements = new Map<number, { end: number; insert: string[] }>();
  for (const block of model.scriptBlocks) {
    const insert = rewriteScript(block.body, declared);
    if (block.bodyStart <= block.bodyEnd) {
      replacements.set(block.bodyStart, { end: block.bodyEnd, insert });
    }
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const replacement = replacements.get(lineNo);
    if (replacement) {
      out.push(...replacement.insert);
      i = replacement.end - 1;
      continue;
    }
    if (deleteLines.has(lineNo)) continue;
    out.push(fixPathAndPerms(lines[i]));
  }

  let rewritten = out.join("\n");
  if (content.endsWith("\n") && !rewritten.endsWith("\n")) rewritten += "\n";
  const again = parseBuildfile(file, rewritten);
  const pushes = again.commands.some((cmd) => cmd.binary === "secpolpush");
  if (pushes && !again.hasPolicyBlob) {
    const blob = "[uid=0 gid=0 perms=0644] /proc/boot/secpol.bin = secpol.bin";
    const base = rewritten.endsWith("\n") ? rewritten : `${rewritten}\n`;
    return `${base}${blob}\n`;
  }
  return rewritten;
}

function fixPathAndPerms(line: string): string {
  return line
    .replace(/PATH=([^\s]+)/g, (_, value: string) => `PATH=${fixPathValue(value)}`)
    .replace(/perms=([0-7]{3,4})/g, (_, value: string) => `perms=${fixPermValue(value)}`);
}

function rewriteScript(body: { line: number; text: string }[], declared: string[]): string[] {
  interface Item {
    kind: "comment" | "blank" | "cmd";
    text: string;
    cmd?: ScriptCommand;
  }
  const items: Item[] = [];
  let stickyMods: string[] = [];
  for (const src of body) {
    const trimmed = src.text.trim();
    if (!trimmed) {
      items.push({ kind: "blank", text: "" });
      continue;
    }
    if (trimmed.startsWith("#")) {
      items.push({ kind: "comment", text: trimmed });
      continue;
    }
    if (/^\[[^\]]*\]\s*$/.test(trimmed)) {
      stickyMods = [...stickyMods, trimmed.slice(1, trimmed.lastIndexOf("]")).trim()];
      items.push({ kind: "comment", text: trimmed });
      continue;
    }
    const cmd = parseScriptCommand(src.text, src.line, stickyMods);
    if (!cmd) {
      items.push({ kind: "comment", text: trimmed });
      continue;
    }
    if (DEBUG_BINS.has(cmd.binary)) continue;
    items.push({ kind: "cmd", text: trimmed.replace(/\s+/g, " ").replace(" &", " &"), cmd });
  }

  const secpols = items.filter((item) => item.cmd?.binary === "secpolpush");
  const rest = items.filter((item) => item.cmd?.binary !== "secpolpush");
  const head: Item[] = [];
  let index = 0;
  while (index < rest.length) {
    const item = rest[index];
    if (item.kind !== "cmd" || (item.cmd && PROLOGUE.has(item.cmd.binary))) {
      head.push(item);
      index++;
      continue;
    }
    break;
  }
  const tail = rest.slice(index).map((item) => {
    if (item.kind !== "cmd" || !item.cmd) return item;
    return { ...item, text: confine(item.text, item.cmd, declared) };
  });
  const secpol = secpols[0] ?? { kind: "cmd" as const, text: "secpolpush" };
  const merged = [...head, secpol, ...tail];
  const lines: string[] = [];
  for (const item of merged) {
    if (item.kind === "blank") {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(`    ${item.text.trim()}`);
  }
  return lines;
}

function confine(original: string, cmd: ScriptCommand, declared: string[]): string {
  const leaving = EXITS.has(cmd.binary);
  const needsType = !leaving && !cmd.typeName;
  const needsBg = !leaving && !cmd.background;
  if (!needsType && !needsBg) return original.trim();
  let text = original.trim().replace(/\s*&\s*$/, "").trim();
  if (needsType) {
    const typeName = inferType(cmd.binary, declared);
    if (cmd.argv[0] === "on") {
      text = text.replace(/\bon\b/, `on -T ${typeName}`);
    } else {
      const mods: string[] = [];
      let rest = text;
      while (rest.startsWith("[")) {
        const end = rest.indexOf("]");
        if (end < 0) break;
        mods.push(rest.slice(0, end + 1));
        rest = rest.slice(end + 1).trim();
      }
      text = `${mods.join(" ")} on -T ${typeName} ${rest}`.trim();
    }
  }
  if (!leaving && !text.endsWith("&")) text = `${text} &`;
  return text.replace(/\s+/g, " ").trim();
}

export function launchedTypes(model: BuildModel): string[] {
  const types = new Set<string>();
  for (const cmd of model.commands) {
    if (cmd.typeName) types.add(cmd.typeName);
  }
  return [...types];
}
