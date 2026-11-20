import type { ScanResult } from "./types.js";

export function toMarkdown(result: ScanResult, title = "ChannelCheck audit"): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Posture **${result.score.posture}** · score **${result.score.score}/100**.`);
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Critical | ${result.score.critical} |`);
  lines.push(`| Error | ${result.score.error} |`);
  lines.push(`| Warning | ${result.score.warning} |`);
  lines.push(`| Info | ${result.score.info} |`);
  lines.push("");
  lines.push(`Confined launches: ${result.score.confined}. Unconfined launches: ${result.score.unconfined}.`);
  lines.push("");
  if (!result.findings.length) {
    lines.push("No findings. The IFS script, security policy, and IPC graph agree.");
    lines.push("");
  } else {
    lines.push("## Findings");
    lines.push("");
    for (const finding of result.findings) {
      lines.push(`### ${finding.severity.toUpperCase()} \`${finding.ruleId}\``);
      lines.push("");
      lines.push(`\`${finding.file}:${finding.line}\` — ${finding.message}`);
      lines.push("");
      lines.push(finding.rationale);
      lines.push("");
      lines.push(`**Fix.** ${finding.remediation}`);
      lines.push("");
    }
  }
  if (result.boot.length) {
    lines.push("## IFS boot timeline");
    lines.push("");
    for (const event of result.boot) {
      lines.push(`- \`${event.phase}\` ${event.file}:${event.line} ${event.text}`);
    }
    lines.push("");
  }
  lines.push("Host note: this report was produced by the ChannelCheck static engine. It does not claim that QNX SDP 8.0 or QEMU executed the image.");
  lines.push("");
  return lines.join("\n");
}

export function toText(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`ChannelCheck  QNX SDP 8.0  ${result.score.posture} ${result.score.score}/100`);
  lines.push("");
  if (!result.findings.length) lines.push("  no findings");
  for (const finding of result.findings) {
    lines.push(`  ${finding.severity.toUpperCase().padEnd(8)}  ${finding.ruleId}`);
    lines.push(`            ${finding.file}:${finding.line}`);
    lines.push(`            ${finding.message}`);
    lines.push("");
  }
  lines.push(
    `  ${result.score.critical} critical  ${result.score.error} error  ${result.score.warning} warning  ${result.score.info} info`,
  );
  return lines.join("\n");
}
