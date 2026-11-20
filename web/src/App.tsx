import { useEffect, useMemo, useState, type DragEvent } from "react";
import { applySafeFixes, scanWorkspace, toMarkdown, toSarif, type Finding, type Scorecard, type Severity, type SourceFile } from "@engine";
import { Graph } from "./Graph";
import { codelabSteps } from "./codelab";
import { cloneFiles, samples } from "./samples";

type Tab = "graph" | "source" | "timeline" | "rules" | "codelab";

const TABS: { id: Tab; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "source", label: "Source" },
  { id: "timeline", label: "Timeline" },
  { id: "rules", label: "Rules" },
  { id: "codelab", label: "Codelab" },
];

function download(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function lineWindow(content: string, line: number): { n: number; text: string; hit: boolean }[] {
  const lines = content.split("\n");
  const start = Math.max(1, line - 3);
  const end = Math.min(lines.length, line + 3);
  return lines.slice(start - 1, end).map((text, index) => ({ n: start + index, text, hit: start + index === line }));
}

function Score({ label, score }: { label: string; score: Scorecard }) {
  return (
    <div className="min-w-[9rem]">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="mono text-2xl font-medium tabular-nums">{score.score}</span>
        <span className="text-xs uppercase tracking-wide" style={{ color: score.posture === "locked" ? "var(--good)" : score.posture === "hardening" ? "var(--warning)" : "var(--critical)" }}>
          {score.posture}
        </span>
      </div>
    </div>
  );
}

export function App() {
  const opening = samples[0];
  const [sampleId, setSampleId] = useState(opening?.id ?? "dropped");
  const [files, setFiles] = useState<SourceFile[]>(() => cloneFiles(opening?.files ?? []));
  const [baseline, setBaseline] = useState<Scorecard>(() => scanWorkspace(opening?.files ?? []).score);
  const [tab, setTab] = useState<Tab>("graph");
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [activePath, setActivePath] = useState(opening?.files[0]?.path ?? "");
  const [editing, setEditing] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const result = useMemo(() => scanWorkspace(files), [files]);
  const visible = result.findings.filter((finding) => filter === "all" || finding.severity === filter);
  const selected = result.findings.find((finding) => finding.id === picked)
    ?? visible.find((finding) => finding.ruleId === "QNX-IPC-DEADLOCK")
    ?? visible.find((finding) => finding.severity === "critical")
    ?? visible[0]
    ?? result.findings[0];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function openSample(id: string): void {
    const sample = samples.find((item) => item.id === id);
    if (!sample) return;
    const next = cloneFiles(sample.files);
    setSampleId(id);
    setFiles(next);
    setBaseline(scanWorkspace(next).score);
    setPicked(null);
    setDiffText("");
    setNotice("");
    setEditing(false);
    setActivePath(next[0]?.path ?? "");
    setTab("graph");
  }

  function focusFinding(finding: Finding): void {
    setPicked(finding.id);
    setActivePath(finding.file);
  }

  function applyFixes(): void {
    const fixed = applySafeFixes(files);
    if (!fixed.diffs.length) {
      setNotice("No safe fixes. This workspace already matches the repairs ChannelCheck can make.");
      setDiffText("");
      return;
    }
    setFiles(fixed.files);
    setDiffText(fixed.diffs.map((diff) => diff.diff).join("\n"));
    setNotice(`Applied ${fixed.applied} file${fixed.applied === 1 ? "" : "s"}. Rescored from the patched sources.`);
    setPicked(null);
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    const dropped = [...event.dataTransfer.files].filter((file) => /\.(build|secpol|c|cc|cpp|cxx|h|hh|hpp)$/i.test(file.name));
    if (!dropped.length) {
      setNotice("Drop .build, .secpol, or C/C++ files.");
      return;
    }
    void Promise.all(dropped.map(async (file) => ({ path: file.name, content: await file.text() }))).then((next) => {
      setSampleId("dropped");
      setFiles(next);
      setBaseline(scanWorkspace(next).score);
      setPicked(null);
      setDiffText("");
      setNotice(`Loaded ${next.length} dropped file${next.length === 1 ? "" : "s"}.`);
      setActivePath(next[0]?.path ?? "");
    });
  }

  const active = files.find((file) => file.path === activePath) ?? files[0];
  const sample = samples.find((item) => item.id === sampleId);

  return (
    <div
      className="shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header className="top flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-sm text-sm font-semibold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>CC</span>
          <div>
            <div className="text-sm font-semibold tracking-[0.18em]">CHANNELCHECK</div>
            <div className="text-xs text-muted">QNX SDP 8.0 · IFS · secpol · MsgSend</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted" htmlFor="sample">Workspace</label>
          <select
            id="sample"
            className="rounded-sm border bg-transparent px-2 py-1 text-sm"
            style={{ borderColor: "var(--line)" }}
            value={samples.some((item) => item.id === sampleId) ? sampleId : ""}
            onChange={(event) => openSample(event.target.value)}
          >
            {sampleId === "dropped" && <option value="">Dropped files</option>}
            {samples.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <button type="button" className="rounded-sm border px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} onClick={() => sample && openSample(sample.id)}>
            Reset
          </button>
          <button type="button" aria-label="Toggle color theme" className="rounded-sm border px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button type="button" className="rounded-sm border px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} onClick={() => download("channelcheck.sarif", `${JSON.stringify(toSarif(result.findings), null, 2)}\n`, "application/sarif+json")}>SARIF</button>
          <button type="button" className="rounded-sm border px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} onClick={() => download("channelcheck.json", `${JSON.stringify(result, null, 2)}\n`, "application/json")}>JSON</button>
          <button type="button" className="rounded-sm border px-2 py-1 text-xs" style={{ borderColor: "var(--line)" }} onClick={() => download("channelcheck.md", toMarkdown(result, sample?.name ?? "Dropped workspace"), "text/markdown")}>Markdown</button>
        </div>
      </header>

      <section className="scorebar flex flex-wrap items-end justify-between gap-4 border-b px-4 py-3">
        <div className="flex flex-wrap gap-6">
          <Score label="Opened" score={baseline} />
          <Score label="Now" score={result.score} />
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <Count testid="critical-count" label="Critical" value={result.score.critical} tone="var(--critical)" />
          <Count testid="error-count" label="Error" value={result.score.error} tone="var(--error)" />
          <Count testid="warning-count" label="Warning" value={result.score.warning} tone="var(--warning)" />
          <Count testid="confined-count" label="Confined" value={result.score.confined} tone="var(--good)" />
          <Count testid="unconfined-count" label="Unconfined" value={result.score.unconfined} tone="var(--muted)" />
        </div>
        <button
          type="button"
          className="rounded-sm px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          onClick={applyFixes}
        >
          Apply safe fixes
        </button>
      </section>

      <aside className="nav scroll border-r p-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Sample</div>
        <p className="mt-2 text-sm leading-5">{sample?.blurb ?? "Files you dropped. They are scanned with the same engine as the CLI."}</p>
        <div className="mt-4 text-[10px] uppercase tracking-[0.16em] text-muted">Files</div>
        <ul className="mt-2 space-y-1">
          {files.map((file) => {
            const count = result.findings.filter((finding) => finding.file === file.path).length;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-sm"
                  style={{ background: file.path === active?.path ? "var(--panel-2)" : "transparent" }}
                  onClick={() => { setActivePath(file.path); setTab("source"); }}
                >
                  <span className="mono truncate">{file.path}</span>
                  <span className="mono text-xs text-muted">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs leading-5 text-muted">Drop a .build, .secpol, or .c file anywhere on this page to scan it in the browser.</p>
        {notice && <p className="mt-3 text-xs leading-5" role="status">{notice}</p>}
      </aside>

      <main className="stage flex min-h-[28rem] flex-col">
        <div className="flex gap-1 border-b px-3 py-2" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className="rounded-sm px-3 py-1 text-sm"
              style={{ background: tab === item.id ? "var(--accent)" : "transparent", color: tab === item.id ? "var(--accent-ink)" : "var(--ink)" }}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === "graph" && (
            <div className="h-[34rem] p-2">
              {result.graph.nodes.length === 0 ? (
                <Empty title="No processes to graph" body="ChannelCheck draws a node when a C file calls Neutrino IPC or a buildfile launches that program." />
              ) : (
                <Graph nodes={result.graph.nodes} edges={result.graph.edges} onSelect={(file, line) => {
                  const finding = result.findings.find((item) => item.file === file && item.line === line) ?? result.findings.find((item) => item.file === file);
                  if (finding) focusFinding(finding);
                  else setActivePath(file);
                }} />
              )}
            </div>
          )}
          {tab === "source" && active && (
            <SourceView
              file={active}
              highlight={selected?.file === active.path ? selected.line : undefined}
              editing={editing}
              onToggle={() => setEditing(!editing)}
              onChange={(content) => setFiles(files.map((file) => file.path === active.path ? { ...file, content } : file))}
            />
          )}
          {tab === "timeline" && <Timeline events={result.boot} />}
          {tab === "rules" && (
            <div className="scroll h-[34rem] p-4">
              <ul className="space-y-3">
                {result.rules.map((rule) => (
                  <li key={rule.id} className="panel rounded-sm p-3">
                    <div className="flex items-center gap-2">
                      <span className={`pip sev-${rule.severity}`} />
                      <span className="mono text-xs">{rule.id}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium">{rule.title}</div>
                    <p className="mt-1 text-sm leading-5 text-muted">{rule.rationale}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === "codelab" && (
            <div className="scroll h-[34rem] p-4" data-testid="codelab">
              <h2 className="text-lg font-semibold">Six steps from a resource manager to a clean QNX 8.0 image</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">The same lesson is in docs/CODELAB.md. Commands in step 6 run only after you source QNX SDP 8.0. This page does not invent qcc output.</p>
              <ol className="mt-4 space-y-4">
                {codelabSteps.map((step) => (
                  <li key={step.n} className="panel rounded-sm p-4">
                    <div className="mono text-xs text-muted">Step {step.n}</div>
                    <h3 className="mt-1 text-base font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6">{step.body}</p>
                    {step.code && <pre className="mono mt-3 overflow-auto rounded-sm p-3 text-xs leading-5" style={{ background: "var(--bg)" }}>{step.code}</pre>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        {diffText && (
          <details className="border-t" open>
            <summary className="cursor-pointer px-4 py-2 text-xs uppercase tracking-[0.14em] text-muted">Fix diff</summary>
            <pre data-testid="fix-diff" className="mono scroll max-h-48 px-4 pb-3 text-xs leading-5">{diffText}</pre>
          </details>
        )}
      </main>

      <aside className="inspector scroll border-l p-3">
        <div className="flex flex-wrap gap-1">
          {(["all", "critical", "error", "warning", "info"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className="rounded-sm border px-2 py-1 text-xs capitalize"
              style={{ borderColor: "var(--line)", background: filter === level ? "var(--panel-2)" : "transparent" }}
              onClick={() => setFilter(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-1" aria-label="Findings">
          {visible.length === 0 && <li className="text-sm text-muted">No findings at this severity.</li>}
          {visible.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-2 text-left"
                style={{ background: selected?.id === finding.id ? "var(--panel-2)" : "transparent" }}
                onClick={() => focusFinding(finding)}
              >
                <span className="flex items-center gap-2">
                  <span className={`pip sev-${finding.severity}`} />
                  <span className="text-sm">{finding.title}</span>
                </span>
                <span className="mono mt-1 block text-[11px] text-muted">{finding.file}:{finding.line}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected && <FindingCard finding={selected} files={files} />}
      </aside>
    </div>
  );
}

function Count({ label, value, tone, testid }: { label: string; value: number; tone: string; testid: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div data-testid={testid} className="mono text-lg tabular-nums" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function FindingCard({ finding, files }: { finding: Finding; files: SourceFile[] }) {
  const file = files.find((item) => item.path === finding.file);
  const window = file ? lineWindow(file.content, finding.line) : [];
  return (
    <article className="panel mt-4 rounded-sm p-3" data-testid="finding-card">
      <div className="mono text-[11px]">{finding.ruleId}</div>
      <h2 className="mt-1 text-base font-semibold">{finding.title}</h2>
      <p className="mt-2 text-sm leading-6">{finding.message}</p>
      <h3 className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted">Why this matters on QNX 8.0</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{finding.rationale}</p>
      <h3 className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted">Repair</h3>
      <p className="mt-1 text-sm leading-6">{finding.remediation}</p>
      <p className="mt-2 text-xs text-muted">{finding.fixable ? "Included in Apply safe fixes." : "ChannelCheck reports this and leaves the edit to you."}</p>
      {window.length > 0 && (
        <pre className="mono mt-3 overflow-auto text-xs leading-5" data-testid="finding-snippet">
          {window.map((line) => (
            <div key={line.n} className={line.hit ? "hit" : ""} data-testid={line.hit ? "finding-line" : undefined}>
              <span className="inline-block w-8 pr-2 text-right text-muted">{line.n}</span>
              {line.text || " "}
            </div>
          ))}
        </pre>
      )}
    </article>
  );
}

function SourceView({
  file,
  highlight,
  editing,
  onToggle,
  onChange,
}: {
  file: SourceFile;
  highlight?: number;
  editing: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
}) {
  const lines = file.content.split("\n");
  return (
    <div className="flex h-[34rem] flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="mono text-xs">{file.path}</span>
        <button type="button" className="text-xs" onClick={onToggle}>{editing ? "View lines" : "Edit"}</button>
      </div>
      {editing ? (
        <textarea
          aria-label={`Edit ${file.path}`}
          className="mono min-h-0 flex-1 resize-none bg-transparent p-3 text-xs leading-5 outline-none"
          value={file.content}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <div className="mono scroll min-h-0 flex-1 p-3 text-xs leading-5">
          {lines.map((line, index) => (
            <div key={index} className={highlight === index + 1 ? "hit" : ""}>
              <span className="inline-block w-10 pr-3 text-right text-muted">{index + 1}</span>
              {line || " "}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ events }: { events: { file: string; line: number; text: string; phase: string }[] }) {
  if (!events.length) return <Empty title="No boot script" body="Add a .build file. ChannelCheck reads the bootstrap and the [+script] in order." />;
  const tone: Record<string, string> = {
    bootstrap: "var(--info)",
    prologue: "var(--muted)",
    policy: "var(--good)",
    service: "var(--accent)",
    debug: "var(--critical)",
    risk: "var(--warning)",
  };
  return (
    <ol className="scroll h-[34rem] space-y-2 p-4" data-testid="timeline">
      {events.map((event, index) => (
        <li key={`${event.file}:${event.line}:${index}`} className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
          <span className="mono text-[11px] uppercase" style={{ color: tone[event.phase] ?? "var(--muted)" }}>{event.phase}</span>
          <span>
            <span className="mono text-xs text-muted">{event.file}:{event.line}</span>
            <span className="mt-1 block">{event.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}
