import type { GraphEdge, GraphNode } from "@engine";

interface Point { x: number; y: number }

function place(nodes: GraphNode[]): Map<string, Point> {
  const pos = new Map<string, Point>();
  const processes = nodes.filter((node) => node.kind === "process");
  const types = nodes.filter((node) => node.kind === "type");
  const width = 920;
  const height = 520;
  processes.forEach((node, index) => {
    if (processes.length <= 1) pos.set(node.id, { x: width / 2, y: 300 });
    else if (processes.length === 2) pos.set(node.id, { x: index === 0 ? 230 : 690, y: 300 });
    else {
      const angle = (Math.PI * 2 * index) / processes.length - Math.PI / 2;
      pos.set(node.id, { x: width / 2 + Math.cos(angle) * 270, y: 310 + Math.sin(angle) * 150 });
    }
  });
  types.forEach((node, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    pos.set(node.id, { x: 150 + col * 200, y: 58 + row * 36 });
  });
  return pos;
}

function curve(a: Point, b: Point, self: boolean, bend: number): string {
  if (self) {
    return `M ${a.x} ${a.y - 28} C ${a.x + 70} ${a.y - 110}, ${a.x - 70} ${a.y - 110}, ${a.x} ${a.y - 28}`;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const midX = (a.x + b.x) / 2 + (-dy / len) * bend;
  const midY = (a.y + b.y) / 2 + (dx / len) * bend;
  return `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`;
}

export function Graph({
  nodes,
  edges,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect: (file: string, line: number) => void;
}) {
  const pos = place(nodes);
  return (
    <svg data-testid="ipc-graph" viewBox="0 0 920 520" className="h-full w-full" role="img" aria-label="QNX IPC and security policy graph">
      <rect x="0" y="0" width="920" height="520" fill="transparent" />
      {edges.map((edge) => {
        const from = pos.get(edge.from);
        const to = pos.get(edge.to);
        if (!from || !to) return null;
        const klass = edge.inCycle
          ? "cycle-edge"
          : edge.kind === "pulse"
            ? "pulse-edge"
            : edge.kind === "confines"
              ? "confines-edge"
              : "send-edge";
        return (
          <path
            key={edge.id}
            d={curve(from, to, edge.from === edge.to, edge.kind === "confines" ? 0 : edge.from < edge.to ? 42 : -42)}
            className={klass}
            data-cycle={edge.inCycle ? "true" : "false"}
            onClick={() => onSelect(edge.file, edge.line)}
          >
            <title>{`${edge.label} ${edge.file}:${edge.line}`}</title>
          </path>
        );
      })}
      {nodes.map((node) => {
        const at = pos.get(node.id);
        if (!at) return null;
        const typeNode = node.kind === "type";
        const width = typeNode ? 132 : 214;
        const height = typeNode ? 28 : 74;
        return (
          <g key={node.id} transform={`translate(${at.x - width / 2} ${at.y - height / 2})`} onClick={() => node.file && onSelect(node.file, 1)} style={{ cursor: "pointer" }}>
            <rect
              width={width}
              height={height}
              rx={typeNode ? 14 : 8}
              fill={node.inCycle ? "color-mix(in srgb, var(--critical) 18%, var(--panel))" : "var(--panel)"}
              stroke={node.inCycle ? "var(--critical)" : node.criticality === "high" ? "var(--warning)" : "var(--line)"}
              strokeWidth={node.inCycle ? 2 : 1}
            />
            <text x="12" y={typeNode ? 18 : 22} fill="var(--ink)" fontFamily="IBM Plex Sans, sans-serif" fontSize={typeNode ? 12 : 14} fontWeight="600">
              {node.label}
            </text>
            {!typeNode && (
              <>
                <text x="12" y="42" fill="var(--muted)" fontFamily="IBM Plex Mono, monospace" fontSize="11">
                  {node.secpolType ?? "untyped"} · {node.confined ? "confined" : "unconfined"}
                </text>
                <text x="12" y="60" fill="var(--muted)" fontFamily="IBM Plex Mono, monospace" fontSize="11">
                  {node.priority ?? ""}
                </text>
                <title>{[node.label, node.secpolType, node.priority, ...node.paths].filter(Boolean).join(" · ")}</title>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
