/** archkit 模型（实现见 ./archkit-model.mjs）：三型图的校验与归一。 */
export const ARCHKIT_TYPES: string[];
export const ARCHKIT_KINDS: Record<string, Set<string>>;
export const ARCHKIT_KIND_LABELS: Record<string, string>;
export interface ArchkitNode { id: string; kind: string; label: string; note: string; evidence: string[] }
export interface ArchkitEdge { from: string; to: string; label: string; style: "solid" | "dashed" }
export interface ArchkitMessage { from: string; to: string; text: string; style: "solid" | "dashed" }
export interface ArchkitDiagram { type: string; title: string; nodes: ArchkitNode[]; edges: ArchkitEdge[]; messages: ArchkitMessage[] }
export interface ArchkitProblem { level: "error" | "warn"; message: string }
export function archkitNormalizeDiagram(input: any): { ok: boolean; problems: ArchkitProblem[]; diagram: ArchkitDiagram | null };
export function archkitEvidenceIndex(diagram: ArchkitDiagram): Map<string, string[]>;
export function archkitNodesWithoutEvidence(diagram: ArchkitDiagram): string[];
