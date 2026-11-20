import type { SourceFile } from "@engine";

const raw = import.meta.glob("../../examples/**/*.{c,h,cc,cpp,hh,hpp,build,secpol}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export interface Sample {
  id: string;
  name: string;
  blurb: string;
  files: SourceFile[];
}

const blurbs: Record<string, { name: string; blurb: string }> = {
  "adas-sensor-bus": {
    name: "ADAS sensor bus",
    blurb: "Broken on purpose. Two resource managers MsgSend into each other, root abilities, ksh, and a late secpolpush.",
  },
  "infusion-pump": {
    name: "Infusion pump",
    blurb: "aarch64le therapy controller. High-priority pump daemon is root and unconfined, with a physical-memory ability.",
  },
  "factory-plc": {
    name: "Factory PLC",
    blurb: "Cell controller with a wildcard channel allow, qconn in the image, and a duplicated target.",
  },
  "hardened-baseline": {
    name: "Hardened baseline",
    blurb: "The pattern the fixer aims for. Fixed-priority channel, on -T, secpolpush first, no debug shell.",
  },
};

const order = ["adas-sensor-bus", "infusion-pump", "factory-plc", "hardened-baseline"];
const groups = new Map<string, SourceFile[]>();

for (const [file, content] of Object.entries(raw)) {
  const parts = file.split("/");
  const at = parts.lastIndexOf("examples");
  const id = parts[at + 1];
  if (!id) continue;
  const rel = parts.slice(at + 2).join("/");
  const list = groups.get(id) ?? [];
  list.push({ path: rel, content });
  groups.set(id, list);
}

for (const list of groups.values()) {
  list.sort((a, b) => a.path.localeCompare(b.path));
}

export const samples: Sample[] = order
  .filter((id) => groups.has(id))
  .map((id) => ({
    id,
    name: blurbs[id]?.name ?? id,
    blurb: blurbs[id]?.blurb ?? "",
    files: groups.get(id) ?? [],
  }));

export function cloneFiles(files: SourceFile[]): SourceFile[] {
  return files.map((file) => ({ path: file.path, content: file.content }));
}
