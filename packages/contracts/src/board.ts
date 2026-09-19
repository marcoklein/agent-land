export interface BoardTicket {
  id: string;
  title: string;
  status: string;
  type: string;
  priority: number;
  assignee: string;
  created: string;
  updatedAt: string | null;
  lastStatus: string | null;
  phase: string | null;
  parked: boolean;
  tags: string[];
  deps: string[];
}

export interface BoardSnapshot {
  generatedAt: string;
  tickets: BoardTicket[];
}

export const FUNNEL = [
  "loop",
  "needs-refinement",
  "needs-questions",
  "needs-research",
  "needs-design",
  "needs-structure",
  "needs-plan",
  "needs-implementation",
  "human",
  "closed",
] as const;

export function boardColumn(t: BoardTicket): string {
  if (t.status === "closed") return "closed";
  if (t.parked) return "human";
  if (t.phase) return t.phase;
  return "loop";
}
