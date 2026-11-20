import { makeFinding } from "./rules.js";
import { DANGEROUS_ABILITIES, abilityBase, dangerousRule, splitLines } from "./text.js";
import type { Finding } from "./types.js";

export interface AllowRule {
  line: number;
  raw: string;
  sources: string[];
  targets: string[];
  classes: string[];
  permissions: string[];
  wildcard: boolean;
}

export interface AbilityGrant {
  line: number;
  typeName: string;
  abilities: { name: string; line: number }[];
}

export interface AttachRule {
  line: number;
  typeName: string;
  path: string;
  channelType?: string;
  wildcard: boolean;
  broad: boolean;
}

export interface LinkRule {
  line: number;
  typeName: string;
  path: string;
}

export interface TypeDecl {
  line: number;
  name: string;
  attributes: string[];
}

export interface Transition {
  line: number;
  kind: "derive_type" | "default_spawn_type" | "type_transition";
  types: string[];
}

export interface Statement {
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface SecpolModel {
  file: string;
  content: string;
  statements: Statement[];
  types: TypeDecl[];
  allows: AllowRule[];
  attaches: AttachRule[];
  links: LinkRule[];
  abilities: AbilityGrant[];
  transitions: Transition[];
  attributes: string[];
}

const RESERVED = new Set(["self", "default", "default_rules", "*", "nonroot", "unlock"]);

export function splitStatements(content: string): Statement[] {
  const results: Statement[] = [];
  let buf = "";
  let start = 0;
  let startLine = 1;
  let line = 1;
  let depth = 0;
  let comment = false;
  let quote: string | null = null;
  let started = false;
  let tokenStart = 0;

  const flush = (end: number) => {
    const text = buf.trim();
    if (text) results.push({ line: startLine, text, start: tokenStart, end });
    buf = "";
    started = false;
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\n") {
      line++;
      comment = false;
      if (started) buf += "\n";
      continue;
    }
    if (comment) continue;
    if (!quote && ch === "#") {
      comment = true;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (!started) {
        started = true;
        startLine = line;
        tokenStart = i;
      }
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "{") {
      if (!started) {
        started = true;
        startLine = line;
        tokenStart = i;
      }
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === ";" && depth === 0) {
      flush(i + 1);
      start = i + 1;
      continue;
    }
    if (!started) {
      if (/\s/.test(ch)) continue;
      started = true;
      startLine = line;
      tokenStart = i;
    }
    buf += ch;
    void start;
  }
  return results;
}

interface Tok {
  kind: "id" | "set";
  value: string;
  items: string[];
}

function tokenizeBody(body: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ":") {
      toks.push({ kind: "id", value: ":", items: [":"] });
      i++;
      continue;
    }
    if (ch === "{") {
      const end = body.indexOf("}", i);
      const inner = body.slice(i + 1, end < 0 ? body.length : end);
      const items = inner.split(/\s+/).filter(Boolean);
      toks.push({ kind: "set", value: items.join(" "), items });
      i = end < 0 ? body.length : end + 1;
      continue;
    }
    let j = i;
    while (j < body.length && !/[\s:{}]/.test(body[j])) j++;
    const value = body.slice(i, j);
    toks.push({ kind: "id", value, items: [value] });
    i = j;
  }
  return toks;
}

export function parseAllow(text: string, line: number): AllowRule | null {
  const body = text.replace(/^allow\s+/, "").trim();
  const toks = tokenizeBody(body);
  const colon = toks.findIndex((tok) => tok.value === ":");
  if (colon < 0) return null;
  const left = toks.slice(0, colon);
  const right = toks.slice(colon + 1);
  const groups = left.map((tok) => tok.items);
  let sources: string[] = [];
  let targets: string[] = [];
  if (groups.length === 0) return null;
  if (groups.length === 1 && groups[0].length === 1) {
    sources = groups[0];
    targets = ["self"];
  } else if (groups.length === 1) {
    const flat = groups[0];
    targets = [flat[flat.length - 1]];
    sources = flat.slice(0, -1);
  } else {
    targets = groups[groups.length - 1];
    sources = groups.slice(0, -1).flat();
  }
  const classes = right[0]?.items ?? [];
  const permissions = right.slice(1).flatMap((tok) => tok.items);
  if (right[0]?.kind === "id" && right.length >= 1) {
    // class is the first id; remaining tokens are permissions. Already handled.
  }
  const wildcard = [...sources, ...targets, ...classes, ...permissions].some((token) => token === "*");
  return { line, raw: text, sources, targets, classes, permissions, wildcard };
}

function abilityNames(text: string): string[] {
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open < 0) return [];
  return text
    .slice(open + 1, close < 0 ? text.length : close)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token !== "nonroot" && token !== "unlock");
}

export function parseSecpol(file: string, content: string): SecpolModel {
  const statements = splitStatements(content);
  const types: TypeDecl[] = [];
  const allows: AllowRule[] = [];
  const attaches: AttachRule[] = [];
  const links: LinkRule[] = [];
  const abilities: AbilityGrant[] = [];
  const transitions: Transition[] = [];
  const attributes: string[] = [];
  const lines = splitLines(content);

  const lineOf = (needle: string, from: number): number => {
    for (let i = Math.max(0, from - 1); i < lines.length; i++) {
      if (lines[i].includes(needle)) return i + 1;
    }
    return from;
  };

  for (const stmt of statements) {
    const text = stmt.text.replace(/\s+/g, " ").trim();
    if (text.startsWith("type ") && !text.startsWith("type_transition")) {
      const body = text.slice(5).trim();
      const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts[0]) types.push({ line: stmt.line, name: parts[0], attributes: parts.slice(1) });
      for (const attr of parts.slice(1)) attributes.push(attr);
      continue;
    }
    if (text.startsWith("attribute ")) {
      const name = text.slice("attribute ".length).trim().split(/\s+/)[0];
      if (name) attributes.push(name);
      continue;
    }
    if (text.startsWith("allow_attach ")) {
      const bits = text.slice("allow_attach ".length).trim().split(/\s+/);
      const typeName = bits[0] ?? "";
      const path = bits[1] ?? "";
      const channelType = bits[2];
      const wildcard = path === "*" || path === "/..." || path.endsWith("/...");
      const broad = !wildcard && (path.includes("*") || path.includes("..."));
      attaches.push({ line: stmt.line, typeName, path, channelType, wildcard, broad });
      continue;
    }
    if (text.startsWith("allow_link ")) {
      const bits = text.slice("allow_link ".length).trim().split(/\s+/);
      links.push({ line: stmt.line, typeName: bits[0] ?? "", path: bits[1] ?? "" });
      continue;
    }
    if (text.startsWith("allow_channel ")) {
      const bits = text.slice("allow_channel ".length).trim().split(/\s+/);
      allows.push({
        line: stmt.line,
        raw: text,
        sources: [bits[0] ?? ""],
        targets: [bits[1] ?? ""],
        classes: ["channel"],
        permissions: ["connect"],
        wildcard: bits.includes("*"),
      });
      continue;
    }
    if (text.startsWith("allow ")) {
      const rule = parseAllow(text, stmt.line);
      if (rule) {
        allows.push(rule);
        if (rule.classes.includes("ability") || rule.classes.includes("*")) {
          const names = rule.permissions.filter((perm) => perm !== "{" && perm !== "}");
          if (names.length) {
            abilities.push({
              line: stmt.line,
              typeName: rule.sources[0] ?? "",
              abilities: names.map((name) => ({ name, line: lineOf(name, stmt.line) })),
            });
          }
        }
      }
      continue;
    }
    if (text.startsWith("procmgr_ability ") || /^ability\s+\S+\s*\{/.test(text)) {
      const match = /^(?:procmgr_ability|ability)\s+(\S+)/.exec(text);
      const typeName = match?.[1] ?? "";
      const names = abilityNames(stmt.text);
      abilities.push({
        line: stmt.line,
        typeName,
        abilities: names.map((name) => ({ name, line: lineOf(name, stmt.line) })),
      });
      continue;
    }
    if (text.startsWith("derive_type ") || text.startsWith("default_spawn_type ") || text.startsWith("type_transition ")) {
      const kind = text.startsWith("derive_type ")
        ? "derive_type"
        : text.startsWith("default_spawn_type ")
          ? "default_spawn_type"
          : "type_transition";
      const idents = text
        .replace(/^(derive_type|default_spawn_type|type_transition)\s+/, "")
        .split(/[\s{}]+/)
        .filter((token) => token && token !== "process");
      const typeNames = kind === "derive_type" && !text.includes("{")
        ? [idents[0], idents[idents.length - 1]].filter((token): token is string => Boolean(token))
        : idents.filter((token) => !RESERVED.has(token));
      transitions.push({ line: stmt.line, kind, types: typeNames });
    }
  }

  return { file, content, statements, types, allows, attaches, links, abilities, transitions, attributes };
}

export function auditSecpol(model: SecpolModel): Finding[] {
  const findings: Finding[] = [];
  const declared = new Set([...model.types.map((type) => type.name), ...model.attributes]);

  const need = (name: string, line: number) => {
    if (!name || RESERVED.has(name)) return;
    if (!declared.has(name)) {
      findings.push(makeFinding("QNX-SEC-UNDECLARED-TYPE", model.file, line, `Type ${name} is used but never declared.`));
    }
  };

  for (const rule of model.allows) {
    if (rule.wildcard) {
      findings.push(makeFinding(
        "QNX-SEC-WILDCARD",
        model.file,
        rule.line,
        `Wildcard allow grants ${rule.sources.join(", ") || "a type"} more than channel connect.`,
      ));
    }
    for (const name of [...rule.sources, ...rule.targets]) need(name, rule.line);
  }
  for (const attach of model.attaches) {
    need(attach.typeName, attach.line);
    if (attach.channelType) need(attach.channelType, attach.line);
    if (attach.wildcard) {
      findings.push(makeFinding(
        "QNX-SEC-WILDCARD",
        model.file,
        attach.line,
        `allow_attach ${attach.typeName} ${attach.path} lets the type register any path.`,
      ));
    } else if (attach.broad) {
      findings.push(makeFinding(
        "QNX-SEC-BROAD-ATTACH",
        model.file,
        attach.line,
        `allow_attach ${attach.typeName} ${attach.path} matches more than one node.`,
      ));
    }
  }
  for (const link of model.links) {
    need(link.typeName, link.line);
    if (link.path === "/tmp" || link.path.startsWith("/tmp/") || link.path === "/" || link.path === "/...") {
      findings.push(makeFinding(
        "QNX-SEC-LINK-TMP",
        model.file,
        link.line,
        `allow_link ${link.typeName} ${link.path} can retarget a name onto a writable path.`,
      ));
    }
  }
  for (const grant of model.abilities) {
    need(grant.typeName, grant.line);
    for (const ability of grant.abilities) {
      const id = dangerousRule(ability.name);
      if (!id) continue;
      findings.push(makeFinding(id, model.file, ability.line, `${grant.typeName} is granted ${abilityBase(ability.name)}.`));
    }
  }
  for (const transition of model.transitions) {
    for (const name of transition.types) need(name, transition.line);
  }
  return findings;
}

export function allowsChannel(model: SecpolModel, source: string, target: string): boolean {
  return model.allows.some((rule) => {
    const sourceOk = rule.sources.includes(source) || rule.sources.includes("*");
    const targetOk = rule.targets.includes(target) || rule.targets.includes("*") || (rule.targets.includes("self") && source === target);
    const classOk = rule.classes.includes("channel") || rule.classes.includes("*");
    const permOk = rule.permissions.includes("connect") || rule.permissions.includes("*") || rule.permissions.length === 0;
    return sourceOk && targetOk && classOk && permOk;
  });
}

export function referencedTypes(model: SecpolModel): Set<string> {
  const names = new Set<string>();
  for (const rule of model.allows) {
    for (const name of [...rule.sources, ...rule.targets]) if (!RESERVED.has(name)) names.add(name);
  }
  for (const attach of model.attaches) {
    if (attach.typeName) names.add(attach.typeName);
    if (attach.channelType) names.add(attach.channelType);
  }
  for (const link of model.links) if (link.typeName) names.add(link.typeName);
  for (const grant of model.abilities) if (grant.typeName) names.add(grant.typeName);
  for (const transition of model.transitions) for (const name of transition.types) names.add(name);
  return names;
}

export function fixSecpolContent(content: string, neededTypes: string[], edges: { source: string; target: string }[]): string {
  const model = parseSecpol("policy.secpol", content);
  const referenced = referencedTypes(model);
  for (const typeName of neededTypes) referenced.add(typeName);
  let out = content;
  const spans = [...model.statements].sort((a, b) => b.start - a.start);
  for (const span of spans) {
    const text = span.text.replace(/\s+/g, " ").trim();
    let replacement: string | null | undefined;
    if (text.startsWith("type ") && !text.startsWith("type_transition")) {
      const name = text.slice(5).split(",")[0]?.trim();
      const usedElsewhere = [...referenced].includes(name ?? "") && (neededTypes.includes(name ?? "") || appearsOutside(content, name ?? "", span));
      if (name && !usedElsewhere) replacement = "";
    } else if (text.startsWith("allow ") && !text.startsWith("allow_attach") && !text.startsWith("allow_link") && !text.startsWith("allow_channel")) {
      const rule = parseAllow(text, span.line);
      if (rule?.wildcard) {
        if (rule.sources.every((source) => source === "*")) replacement = "";
        else replacement = `allow ${rule.sources.find((source) => source !== "*")} self:channel connect;`;
      } else if (isAbilityAllow(text) && onlyDangerous(text)) {
        replacement = "";
      }
    } else if (text.startsWith("procmgr_ability ") || /^ability\s+\S+\s*\{/.test(text)) {
      if (onlyDangerous(span.text)) replacement = "";
    } else if (text.startsWith("allow_link ")) {
      const path = text.split(/\s+/)[2] ?? "";
      if (path === "/tmp" || path.startsWith("/tmp/") || path === "/..." || path === "/") replacement = "";
    } else if (text.startsWith("allow_attach ")) {
      const path = text.split(/\s+/)[2] ?? "";
      if (path === "/..." || path === "*" || path.endsWith("/...")) replacement = "";
    }
    if (replacement === undefined) continue;
    out = out.slice(0, span.start) + replacement + out.slice(span.end);
  }

  out = splitLines(out)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const base = abilityBase(trimmed);
      return !DANGEROUS_ABILITIES.has(base);
    })
    .join("\n");

  out = out.replace(/allow\s+\S+\s+self:ability\s*\{\s*\}/g, "");
  out = out.replace(/procmgr_ability\s+\S+\s*\{\s*\}/g, "");

  const after = parseSecpol("policy.secpol", out);
  const have = new Set(after.types.map((type) => type.name));
  const missing = [...new Set(neededTypes)].filter((typeName) => typeName && !have.has(typeName) && !RESERVED.has(typeName));
  if (missing.length) {
    const block = missing.map((typeName) => `type ${typeName};`).join("\n");
    out = `${block}\n${out.trimStart()}`;
  }

  const refreshed = parseSecpol("policy.secpol", out);
  const extra: string[] = [];
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    if (RESERVED.has(edge.source) || RESERVED.has(edge.target)) continue;
    if (!allowsChannel(refreshed, edge.source, edge.target) && !extra.includes(`allow ${edge.source} ${edge.target}:channel connect;`)) {
      extra.push(`allow ${edge.source} ${edge.target}:channel connect;`);
    }
  }
  if (extra.length) {
    out = `${out.trimEnd()}\n${extra.join("\n")}\n`;
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

function appearsOutside(content: string, name: string, span: Statement): boolean {
  const before = content.slice(0, span.start);
  const after = content.slice(span.end);
  const re = new RegExp(`\\b${name}\\b`);
  return re.test(before) || re.test(after);
}

function isAbilityAllow(text: string): boolean {
  return /:ability\b/.test(text) || /:\s*ability\b/.test(text);
}

function onlyDangerous(text: string): boolean {
  const names = abilityNames(text);
  return names.length > 0 && names.every((name) => DANGEROUS_ABILITIES.has(abilityBase(name)));
}
