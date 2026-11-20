#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySafeFixes, scanWorkspace, synthesizePolicy, toMarkdown, toSarif, toText, analyze } from "../engine/index.js";
import type { SourceFile } from "../engine/types.js";
import { VERSION } from "../engine/version.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function walk(dir: string, base = dir): SourceFile[] {
  const out: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dist-web" || name === ".git") continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, base));
      continue;
    }
    if (!/\.(build|secpol|c|cc|cpp|cxx|h|hh|hpp)$/.test(name)) continue;
    if (stat.size > 1_000_000) continue;
    out.push({ path: path.relative(base, full).split(path.sep).join("/"), content: readFileSync(full, "utf8") });
  }
  return out;
}

function load(target: string): { dir: string; files: SourceFile[] } {
  const full = path.resolve(target);
  if (!existsSync(full)) {
    console.error(`channelcheck: path not found: ${target}`);
    process.exit(2);
  }
  if (statSync(full).isFile()) {
    return { dir: path.dirname(full), files: [{ path: path.basename(full), content: readFileSync(full, "utf8") }] };
  }
  return { dir: full, files: walk(full) };
}

function usage(): void {
  console.log(`ChannelCheck ${VERSION} — QNX SDP 8.0 IFS, secpol, and IPC analyzer

Usage:
  channelcheck scan [dir] [--json]
  channelcheck graph [dir]
  channelcheck fix [dir] [--dry-run] [--write]
  channelcheck sarif [dir] [-o file.sarif]
  channelcheck ci [dir]
  channelcheck policy [dir]
  channelcheck ui [--port 4179]
  channelcheck --version
`);
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function positional(argv: string[]): string {
  const value = argv.find((arg) => !arg.startsWith("-"));
  return value ?? ".";
}

function serve(port: number): void {
  const web = path.join(repoRoot, "dist-web");
  if (!existsSync(path.join(web, "index.html"))) {
    console.error("channelcheck: web workbench is not built. Run npm run build, or npm run dev for the live server.");
    process.exit(2);
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".map": "application/json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(web, rel));
    if (!file.startsWith(web) || !existsSync(file) || statSync(file).isDirectory()) {
      const fallback = path.join(web, "index.html");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`ChannelCheck workbench  http://127.0.0.1:${port}`);
  });
}

function main(argv: string[]): void {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(VERSION);
    return;
  }
  const command = argv[0];
  const rest = argv.slice(1);
  if (command === "ui") {
    const port = Number(argValue(rest, "--port") ?? 4179);
    serve(port);
    return;
  }
  const target = positional(rest);
  const { dir, files } = load(target);
  if (!files.length) {
    console.error(`channelcheck: no .build, .secpol, or C/C++ files in ${target}`);
    process.exit(2);
  }
  const result = scanWorkspace(files);
  if (command === "scan") {
    if (rest.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else console.log(toText(result));
    return;
  }
  if (command === "graph") {
    console.log(JSON.stringify(result.graph, null, 2));
    return;
  }
  if (command === "policy") {
    console.log(synthesizePolicy(analyze(files)));
    return;
  }
  if (command === "sarif") {
    const sarif = `${JSON.stringify(toSarif(result.findings), null, 2)}\n`;
    const out = argValue(rest, "-o") ?? argValue(rest, "--output");
    if (out) {
      mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      writeFileSync(out, sarif);
      console.log(`wrote ${out}`);
    } else {
      console.log(sarif);
    }
    return;
  }
  if (command === "fix") {
    const fixed = applySafeFixes(files);
    if (!fixed.diffs.length) {
      console.log("No safe fixes. The workspace already matches the rules ChannelCheck can repair.");
      return;
    }
    for (const diff of fixed.diffs) {
      console.log(diff.diff);
      console.log("");
    }
    const write = rest.includes("--write");
    const dry = rest.includes("--dry-run") || !write;
    if (dry && !write) {
      console.log(`Dry run. ${fixed.applied} file(s) would change. Re-run with --write to apply.`);
      return;
    }
    for (const file of fixed.files) {
      const before = files.find((item) => item.path === file.path);
      if (!before || before.content === file.content) continue;
      writeFileSync(path.join(dir, file.path), file.content);
    }
    const again = scanWorkspace(fixed.files);
    console.log(`Wrote ${fixed.applied} file(s).`);
    console.log(toText(again));
    return;
  }
  if (command === "ci") {
    console.log(toText(result));
    if (result.score.critical > 0 || result.score.error > 0) process.exit(1);
    return;
  }
  if (command === "report") {
    console.log(toMarkdown(result, path.basename(dir)));
    return;
  }
  usage();
  process.exit(2);
}

main(process.argv.slice(2));
