import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applySafeFixes, parseBuildfile, parseProgram, parseSecpol, scanWorkspace, synthesizePolicy, toSarif, analyze } from "../src/engine/index.js";
import type { SourceFile } from "../src/engine/types.js";

function loadDir(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(build|secpol|c|cc|cpp|h|hh|hpp)$/.test(name)) continue;
      out.push({ path: path.relative(dir, full).split(path.sep).join("/"), content: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return out;
}

const root = path.resolve(import.meta.dirname, "..");
const adas = loadDir(path.join(root, "examples/adas-sensor-bus"));
const pump = loadDir(path.join(root, "examples/infusion-pump"));
const plc = loadDir(path.join(root, "examples/factory-plc"));
const clean = loadDir(path.join(root, "examples/hardened-baseline"));

function ids(files: SourceFile[]): string[] {
  return scanWorkspace(files).findings.map((finding) => finding.ruleId);
}

describe("mkifs buildfile", () => {
  it("parses the official virtual bootstrap and script shape", () => {
    const model = parseBuildfile("simple.build", `[virtual=x86_64,bios +compress] boot = {
    startup-x86
    PATH=/proc/boot procnto-smp-instr
}
[+script] .script = {
    display_msg "hi"
    devc-con -n9 &
    reopen /dev/con1
    [+session] esh &
}
`);
    expect(model.bootstrap.map((cmd) => cmd.binary)).toEqual(["startup-x86", "procnto-smp-instr"]);
    expect(model.commands.map((cmd) => cmd.binary)).toEqual(["display_msg", "devc-con", "reopen", "esh"]);
    expect(model.commands[3].modifiers.join(" ")).toContain("+session");
    expect(model.bootable).toBe(true);
  });

  it("flags unsafe PATH, setuid, world-writable, duplicates, and late secpolpush", () => {
    const rules = ids(adas);
    expect(rules).toContain("QNX-IFS-UNSAFE-PATH");
    expect(rules).toContain("QNX-IFS-SETUID");
    expect(rules).toContain("QNX-IFS-WORLD-WRITABLE");
    expect(rules).toContain("QNX-IFS-DUPLICATE-TARGET");
    expect(rules).toContain("QNX-IFS-SECPOL-ORDER");
    expect(rules).toContain("QNX-IFS-DEBUG-SHELL");
    expect(rules).toContain("QNX-IFS-UNCONFINED-ROOT");
    expect(rules).toContain("QNX-IFS-FOREGROUND");
    expect(rules).toContain("QNX-IFS-POLICY-BLOB");
  });
});

describe("secpol", () => {
  it("parses the QNX 8 screen policy and ability ranges", () => {
    const model = parseSecpol("screen.secpol", `
type screen_t;
type screen_client_t;
allow_attach screen_t /dev/screen;
allow screen_client_t screen_t : channel connect;
allow server self:ability {
    mem_phys:0x1200000-0x24000000
    setuid:4,6,23
    able_create
};
`);
    expect(model.types.map((type) => type.name)).toEqual(["screen_t", "screen_client_t"]);
    expect(model.attaches[0].path).toBe("/dev/screen");
    expect(model.allows.some((rule) => rule.sources.includes("screen_client_t") && rule.targets.includes("screen_t"))).toBe(true);
    const findings = scanWorkspace([{ path: "screen.secpol", content: model.content }]).findings.map((finding) => finding.ruleId);
    expect(findings).toContain("QNX-SEC-PHYS-MEM");
    expect(findings).not.toContain("QNX-SEC-ABLE-PRIV");
  });

  it("flags wildcard allow and root abilities in the ADAS policy", () => {
    const rules = ids(adas);
    expect(rules).toContain("QNX-SEC-WILDCARD");
    expect(rules).toContain("QNX-SEC-ROOT-ABILITY");
    expect(rules).toContain("QNX-SEC-PHYS-MEM");
    expect(rules).toContain("QNX-SEC-ABLE-PRIV");
    expect(rules).toContain("QNX-SEC-DANGLING-TYPE");
    expect(rules).toContain("QNX-SEC-LINK-TMP");
  });
});

describe("ipc", () => {
  it("detects the ADAS MsgSend cycle and priority inversion", () => {
    const result = scanWorkspace(adas);
    expect(result.findings.some((finding) => finding.ruleId === "QNX-IPC-DEADLOCK")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.inCycle)).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "QNX-IPC-PRIORITY-INVERSION")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "QNX-IPC-UNCHECKED-SEND")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "QNX-IPC-UNCHECKED-CONNECT")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "QNX-IPC-UNGUARDED-RESMGR")).toBe(true);
    const program = parseProgram("fusion.c", adas.find((file) => file.path === "fusion.c")!.content);
    expect(program.calls.some((call) => call.api === "ConnectAttach")).toBe(true);
    expect(program.calls.some((call) => call.api === "resmgr_attach")).toBe(true);
  });

  it("does not treat a checked one-way MsgSend as a deadlock", () => {
    const rules = ids(clean);
    expect(rules).not.toContain("QNX-IPC-DEADLOCK");
  });

  it("sees ChannelCreate_r, MsgSendv, MsgReceive, and SIGEV_PULSE_INIT", () => {
    const pumpProg = parseProgram("pump_rm.c", pump.find((file) => file.path === "pump_rm.c")!.content);
    expect(pumpProg.calls.map((call) => call.api)).toEqual(expect.arrayContaining([
      "ChannelCreate_r",
      "dispatch_create_channel",
      "SIGEV_PULSE_INIT",
      "MsgReceivePulse",
      "resmgr_attach",
      "secpol_transition_type",
    ]));
    const plc = parseProgram("supervisor.c", readFileSync(path.join(root, "examples/factory-plc/supervisor.c"), "utf8"));
    expect(plc.calls.map((call) => call.api)).toEqual(expect.arrayContaining(["name_open", "MsgSendv", "ConnectAttach"]));
    const cell = parseProgram("plc_cell.c", readFileSync(path.join(root, "examples/factory-plc/plc_cell.c"), "utf8"));
    expect(cell.calls.map((call) => call.api)).toEqual(expect.arrayContaining(["MsgReceive", "MsgReply"]));
  });
});

describe("fixes and reports", () => {
  it("hardens every sample to zero critical and error findings and is idempotent", () => {
    for (const sample of [adas, pump, plc, clean]) {
      const once = applySafeFixes(sample);
      const rescanned = scanWorkspace(once.files);
      const severe = rescanned.findings.filter((finding) => finding.severity === "critical" || finding.severity === "error");
      expect(severe, severe.map((finding) => `${finding.ruleId} ${finding.file}:${finding.line} ${finding.message}`).join("\n")).toEqual([]);
      const twice = applySafeFixes(once.files);
      expect(twice.files.map((file) => file.content)).toEqual(once.files.map((file) => file.content));
    }
  });

  it("leaves the hardened baseline with no findings", () => {
    const result = scanWorkspace(clean);
    expect(result.findings, result.findings.map((finding) => `${finding.ruleId} ${finding.message}`).join("\n")).toEqual([]);
    expect(result.score.score).toBe(100);
    expect(result.score.posture).toBe("locked");
  });

  it("parses a C++ resource manager with the same Neutrino calls", () => {
    const program = parseProgram("rm.cpp", `
      int io_devctl(resmgr_context_t *ctp, io_devctl_t *msg, RESMGR_OCB_T *ocb) {
        MsgSend(fd, &frame, sizeof frame, &frame, sizeof frame);
        return 0;
      }
      int main() {
        int chid = ChannelCreate(_NTO_CHF_FIXED_PRIORITY);
        if (chid == -1) return 1;
        resmgr_attach(dpp, &resmgr_attr, "/dev/cpp", _FTYPE_ANY, 0, &connect_funcs, &io_funcs, &attr);
        secpol_transition_type(NULL, "cpp_t", 0);
      }
    `);
    expect(program.calls.map((call) => call.api)).toEqual(expect.arrayContaining([
      "MsgSend",
      "ChannelCreate",
      "resmgr_attach",
      "secpol_transition_type",
    ]));
    expect(program.paths).toContain("/dev/cpp");
    expect(program.transitionType).toBe("cpp_t");
  });

  it("emits SARIF 2.1.0 and a least-privilege policy without root", () => {
    const result = scanWorkspace(adas);
    const sarif = toSarif(result.findings) as { version: string; runs: { results: { ruleId: string; locations: { physicalLocation: { region: { startLine: number } } }[] }[] }[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBe(result.findings.length);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
    const policy = synthesizePolicy(analyze(adas));
    expect(policy).toContain("allow_attach");
    expect(policy).not.toContain("PROCMGR_AID_ROOT");
    expect(policy).not.toContain("mem_phys");
    expect(policy).not.toContain("able_priv");
  });
});
