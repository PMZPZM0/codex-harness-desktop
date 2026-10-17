/** 交互式流程图：规格解析 + 分层布局（纯函数模块）。 */
export const FLOW_LIMIT: number;

export type FlowNodeSpec = { id: string; label: string; note: string; tone: string; shape: "rect" | "diamond" | "pill" };
export type FlowEdgeSpec = { from: string; to: string; label: string; tone: string; dashed: boolean };
export type FlowSpec =
  | { error: string }
  | { title: string; direction: "TD" | "LR"; nodes: FlowNodeSpec[]; edges: FlowEdgeSpec[] };

export function parseFlowchartSpec(raw: unknown): FlowSpec;
export function measureNode(node: { label: string; note?: string }): { w: number; h: number };
export function layoutFlowchart(spec: { nodes: FlowNodeSpec[]; edges: FlowEdgeSpec[]; direction: "TD" | "LR" }): {
  nodes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  width: number;
  height: number;
};
