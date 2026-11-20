import { RULES } from "./rules.js";
import { TOOL_NAME, VERSION } from "./version.js";
import type { Finding, Severity } from "./types.js";

function level(severity: Severity): "error" | "warning" | "note" {
  if (severity === "critical" || severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "note";
}

export function toSarif(findings: Finding[], root = "file://channelcheck"): unknown {
  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: VERSION,
            informationUri: "https://www.qnx.com/developers/docs/8.0/com.qnx.doc.security.system/topic/manual/secpol_language.html",
            rules: RULES.map((rule) => ({
              id: rule.id,
              name: rule.title,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.rationale },
              help: { text: `${rule.rationale}\n\nFix: ${rule.remediation}` },
              defaultConfiguration: { level: level(rule.severity) },
              properties: { tags: ["QNX", "SDP-8.0"], severity: rule.severity },
            })),
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: level(finding.severity),
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file, uriBaseId: root },
                region: { startLine: Math.max(1, finding.line), startColumn: Math.max(1, finding.column) },
              },
            },
          ],
          properties: { severity: finding.severity, rationale: finding.rationale },
        })),
      },
    ],
  };
}
