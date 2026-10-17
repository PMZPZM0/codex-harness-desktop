/** 流程图导出内核（纯函数）：独立 SVG / 单文件 HTML / 规格 JSON + 格式清单。 */
export type FlowExportFormat = { id: string; label: string; hint: string };

export const FLOW_EXPORT_FORMATS: FlowExportFormat[];
export function buildFlowSvg(
  spec: any,
  layout: { nodes: Array<{ id: string; x: number; y: number; w: number; h: number }>; width: number; height: number },
): string;
export function buildFlowHtml(spec: any, svg: string): string;
export function buildFlowJson(spec: any): string;
