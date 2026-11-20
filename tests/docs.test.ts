import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("submission documents", () => {
  it("ships an Apache-2.0 license GitHub can detect", () => {
    const license = read("LICENSE");
    expect(license.startsWith("Apache License")).toBe(true);
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("Copyright 2026 ChannelCheck Contributors");
  });

  it("teaches six QNX 8.0 steps and stays honest about QEMU", () => {
    const codelab = read("docs/CODELAB.md");
    for (const step of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6"]) {
      expect(codelab).toContain(step);
    }
    expect(codelab).toContain("qcc -Vgcc_ntox86_64");
    expect(codelab).toContain("qcc -Vgcc_ntoaarch64le");
    expect(codelab).toContain("were not installed");
    expect(read("docs/codelab/index.html")).toContain("Step 06");
    const script = read("DEMO_SCRIPT.md");
    expect(script).toContain("0:00");
    expect(script).toContain("2:25–2:40");
    expect(script).not.toContain("3:00");
  });
});