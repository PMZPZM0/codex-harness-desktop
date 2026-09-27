/** 无限画布的纯数据层（实现见 ./drama-canvas-model.mjs） */

export type DramaNodeKind = string;

export interface DramaNodeDef {
  label: string;
  icon: string;
  width: number;
  height: number;
  subtitle: string;
  group: string;
}

export interface DramaNode {
  id: string;
  kind: string;
  payload: Record<string, any>;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface DramaEdge {
  source: { id: string } | string;
  target: { id: string } | string;
  relation?: string;
}

export interface DramaSnapshot {
  version: number;
  nodes: DramaNode[];
  edges: DramaEdge[];
  updatedAt: number;
}

export interface DramaNormalizedSnapshot extends DramaSnapshot {
  repaired: string[];
  legacyEdges: boolean;
}

export const DRAMA_GROUPS: string[];
export const DRAMA_NODE_DEFS: Record<string, DramaNodeDef>;
export const DRAMA_UNKNOWN_KIND: string;
export const DRAMA_EDGE_RELATIONS: Array<[string, string]>;
export const DRAMA_SNAPSHOT_VERSION: number;

export function dramaNodeDef(kind: string): DramaNodeDef;
export function dramaIsKnownKind(kind: string): boolean;
export function dramaRelationLabel(key: string): string;
export function dramaDefaultRelation(sourceKind: string, targetKind: string): string;
export function dramaRelationOptions(selected: string, sourceKind: string, targetKind: string): Array<[string, string]>;
export function dramaDefaultPayload(kind: string): Record<string, any>;
export function dramaNodeLabel(kind: string, payload: Record<string, any>): string;
export function dramaNextShotId(payloads: Array<Record<string, any>>, sceneId?: string): string;
export function dramaNextNodeId(prefix?: string): string;
export function dramaNormalizeSnapshot(raw: unknown): DramaNormalizedSnapshot;
export function dramaEndpointId(endpoint: unknown): string;
export function dramaMergeSnapshot(incoming: unknown, current: unknown): DramaNormalizedSnapshot;
export function dramaSnapshotKey(snapshot: unknown): string;
export function dramaStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
/** 生图工作流起手（09-27）：需求 → 主提示词 → 出图 A/B → 选图。 */
export function imageStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
export function dramaAutoLayout(
  nodes: DramaNode[],
  edges: DramaEdge[],
  options?: { gapX?: number; gapY?: number },
): Map<string, { x: number; y: number }>;
