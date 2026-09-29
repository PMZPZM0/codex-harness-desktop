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
/** 生图工作流起手（09-29 精简为 3 步）：写提示词 → 出图 → 备注（可选）。 */
export function imageStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
export function dramaAutoLayout(
  nodes: DramaNode[],
  edges: DramaEdge[],
  options?: { gapX?: number; gapY?: number },
): Map<string, { x: number; y: number }>;
/** 白模视频工作流（Blender 白模预演 → Seedance 2.5 渲染成片）：节点带 payload.flow = "whitebox" */
export function whiteboxStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
/** 3D 建模工作流（参考图 → Aholo Lux3D 生成资产 → Blender 组装）：节点带 payload.flow = "model3d" */
export function model3dStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
/** 识别历史 starter 模板（只看结构，不看内容）：命中返回 { kind, ids }，否则 null。 */
export function legacyStarterSignature(snapshot: DramaSnapshot): { kind: string; ids: string[] } | null;
/** 空壳旧模板 ⇒ 返回升级后的最新快照；有内容或非旧模板 ⇒ 返回 null（调用方保持原样）。 */
export function upgradeLegacyStarterSnapshot(snapshot: DramaSnapshot): DramaSnapshot | null;
/** 六类电商图元数据（主图 / SKU / 详情 / 场景 / 白底 / 买家秀）。 */
export const IMAGE_KINDS: Array<{ key: string; label: string; size: string; ratio: string; purpose: string; skeleton: string; note: string }>;
/** 详情图默认图块清单（纵向从上到下，一行一块）。 */
export const DETAIL_PANELS_DEFAULT: string;
export function imageKindMeta(key: string): { key: string; label: string; size: string; ratio: string; purpose: string; skeleton: string; note: string };
export function imageKindOptions(): Array<{ value: string; label: string }>;
export function detailPanelsOf(payload: Record<string, any> | null | undefined): string[];
/** 电商出图工作流（白底母版 → 派生主图/SKU/场景/买家秀/详情图）：节点带 payload.flow = "ecom" */
export function ecomImageStarterWorkflow(baseX?: number, baseY?: number): DramaSnapshot;
