export function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function detectNewline(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function basename(p: string): string {
  const clean = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i >= 0 ? clean.slice(i + 1) : clean;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Strip a mkifs `#` comment that is preceded by whitespace or starts the line. */
export function stripHashComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i).replace(/\s+$/, "");
    }
  }
  return line;
}

export function columnOf(line: string, needle: string): number {
  const i = line.indexOf(needle);
  return i >= 0 ? i + 1 : 1;
}

export const PROLOGUE = new Set([
  "display_msg",
  "procmgr_symlink",
  "waitfor",
  "reopen",
]);

export const EXITS = new Set([
  ...PROLOGUE,
  "secpolpush",
  "secpolgenerate",
  "mkdir",
  "ln",
  "cp",
  "mv",
  "echo",
  "cat",
  "ls",
  "chmod",
  "chown",
  "setconf",
  "mount",
  "umount",
]);

export const DEBUG_BINS = new Set(["ksh", "qconn"]);

export const KNOWN_TYPES: Record<string, string> = {
  "io-sock": "io_sock_t",
  slogger2: "slogger_t",
  "devc-ser8250": "devc_t",
  "devc-con": "devc_t",
  "devc-pty": "devc_t",
  pipe: "pipe_t",
  mqueue: "mqueue_t",
  random: "random_t",
  dumper: "dumper_t",
  "pci-server": "pci_t",
  "devb-eide": "devb_t",
  "devb-ram": "devb_t",
};

export function normId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function inferType(binary: string, declared: string[]): string {
  const base = basename(binary);
  let best = "";
  let bestScore = 0;
  const b = normId(base);
  for (const typeName of declared) {
    const stem = normId(typeName.replace(/_t$/i, ""));
    if (stem.length < 3) continue;
    let score = 0;
    if (b === stem) score = 100;
    else if (b.startsWith(`${stem}_`) || b.startsWith(stem)) score = 80 + stem.length;
    else if (stem.startsWith(b) && b.length >= 3) score = 60 + b.length;
    if (score > bestScore) {
      bestScore = score;
      best = typeName;
    }
  }
  if (bestScore >= 70) return best;
  if (KNOWN_TYPES[base]) return KNOWN_TYPES[base];
  if (base.startsWith("devc-") || base.startsWith("devc_")) return "devc_t";
  const norm = normId(base);
  return `${norm}_t`;
}

export function permsRisk(spec: string): { setuid: boolean; worldWritable: boolean } {
  if (spec === "*" || spec === "") return { setuid: false, worldWritable: false };
  if (/^[0-7]{3,4}$/.test(spec)) {
    const n = Number.parseInt(spec, 8);
    return {
      setuid: spec.length >= 4 && (n & 0o4000) !== 0,
      worldWritable: (n & 0o0002) !== 0,
    };
  }
  const setuid = /(^|,)\s*(u|a)?\+s\b/.test(spec) || spec.includes("+s");
  const worldWritable = /(^|,)\s*(o|a)?\+w\b/.test(spec) || spec.includes("+w");
  return { setuid, worldWritable };
}

export function fixPermValue(spec: string): string {
  if (!/^[0-7]{3,4}$/.test(spec)) return spec;
  let n = Number.parseInt(spec, 8);
  if (spec.length >= 4) n &= ~0o6000;
  n &= ~0o0002;
  return n.toString(8).padStart(spec.length, "0");
}

export function fixPathValue(value: string): string {
  const parts = value.split(":").filter((part) => part !== "" && part !== "." && part !== "/tmp" && !part.startsWith("/tmp/"));
  return parts.join(":");
}

export function unsafePath(value: string): boolean {
  return value.split(":").some((part) => part === "" || part === "." || part === "/tmp" || part.startsWith("/tmp/"));
}

export const DANGEROUS_ABILITIES = new Set([
  "PROCMGR_AID_ROOT",
  "root",
  "PROCMGR_AID_MEM_PHYS",
  "mem_phys",
  "PROCMGR_AID_ABLE_PRIV",
  "able_priv",
]);

export function abilityBase(token: string): string {
  return token.trim().split(":")[0]?.trim() ?? token.trim();
}

export function dangerousRule(name: string): string | undefined {
  const base = abilityBase(name);
  if (base === "PROCMGR_AID_ROOT" || base === "root") return "QNX-SEC-ROOT-ABILITY";
  if (base === "PROCMGR_AID_MEM_PHYS" || base === "mem_phys") return "QNX-SEC-PHYS-MEM";
  if (base === "PROCMGR_AID_ABLE_PRIV" || base === "able_priv") return "QNX-SEC-ABLE-PRIV";
  return undefined;
}
