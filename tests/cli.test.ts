import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [tsx, path.join(root, "src/cli/index.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("channelcheck CLI", () => {
  it("prints a version and a usage line", () => {
    expect(run(["--version"]).stdout.trim()).toBe("1.0.0");
    expect(run(["--help"]).stdout).toContain("channelcheck scan");
  });

  it("fails CI on the ADAS image and passes the hardened baseline", () => {
    const broken = run(["ci", "examples/adas-sensor-bus"]);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toContain("QNX-IPC-DEADLOCK");
    const clean = run(["ci", "examples/hardened-baseline"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("no findings");
  });

  it("emits a graph, a dry-run diff, and SARIF", () => {
    const graph = JSON.parse(run(["graph", "examples/adas-sensor-bus"]).stdout) as { edges: { inCycle: boolean }[] };
    expect(graph.edges.some((edge) => edge.inCycle)).toBe(true);
    const fix = run(["fix", "examples/adas-sensor-bus", "--dry-run"]);
    expect(fix.status).toBe(0);
    expect(fix.stdout).toContain("Dry run");
    expect(fix.stdout).toContain("MsgSendPulse");
    const sarif = JSON.parse(run(["sarif", "examples/factory-plc"]).stdout) as { version: string };
    expect(sarif.version).toBe("2.1.0");
    const policy = run(["policy", "examples/hardened-baseline"]);
    expect(policy.stdout).toContain("allow_attach telemetry_t /dev/telemetry");
  });
});
