export type Severity = "critical" | "error" | "warning" | "info";

export interface SourceFile {
  path: string;
  content: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  rationale: string;
  remediation: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  fixable: boolean;
}

export interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  fixable: boolean;
  rationale: string;
  remediation: string;
}

export interface GraphNode {
  id: string;
  kind: "process" | "type";
  label: string;
  file?: string;
  secpolType?: string;
  paths: string[];
  criticality: "high" | "normal";
  confined: boolean;
  inCycle: boolean;
  priority?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "msgsend" | "pulse" | "allow" | "confines";
  sync: boolean;
  inCycle: boolean;
  label: string;
  file: string;
  line: number;
}

export interface ScanGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
}

export interface BootEvent {
  file: string;
  line: number;
  text: string;
  phase: "bootstrap" | "prologue" | "policy" | "service" | "debug" | "risk";
}

export interface Scorecard {
  score: number;
  critical: number;
  error: number;
  warning: number;
  info: number;
  posture: "locked" | "hardening" | "exposed";
  confined: number;
  unconfined: number;
}

export interface ScanResult {
  findings: Finding[];
  graph: ScanGraph;
  boot: BootEvent[];
  score: Scorecard;
  files: SourceFile[];
  rules: RuleMeta[];
}

export interface DiffFile {
  file: string;
  before: string;
  after: string;
  diff: string;
}

export interface FixResult {
  files: SourceFile[];
  diffs: DiffFile[];
  applied: number;
}
