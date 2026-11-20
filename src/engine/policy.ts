import type { Analysis } from "./scan.js";

/** Least-privilege policy synthesized from observed resmgr paths and MsgSend edges. */
export function synthesizePolicy(analysis: Analysis): string {
  const lines: string[] = [
    "# Synthesized by ChannelCheck from the QNX 8.0 IPC graph.",
    "# Review before secpolcompile. Grants only observed attach paths, channel connect, and spawn.",
    "",
  ];
  const types = new Set<string>();
  for (const typeName of analysis.processTypes.values()) types.add(typeName);
  for (const program of analysis.programs) {
    if (program.transitionType) types.add(program.transitionType);
  }
  for (const typeName of [...types].sort()) lines.push(`type ${typeName};`);
  if (types.size) lines.push("");
  for (const program of analysis.programs) {
    const typeName = analysis.processTypes.get(program.file);
    if (!typeName) continue;
    for (const path of program.paths) lines.push(`allow_attach ${typeName} ${path};`);
  }
  const seen = new Set<string>();
  for (const edge of analysis.edges) {
    const source = analysis.processTypes.get(edge.from);
    const target = analysis.processTypes.get(edge.to);
    if (!source || !target) continue;
    const rule = `allow ${source} ${target}:channel connect;`;
    if (seen.has(rule)) continue;
    seen.add(rule);
    lines.push(rule);
  }
  lines.push("");
  lines.push("allow default_rules self:ability {");
  lines.push("    spawn");
  lines.push("};");
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
}
