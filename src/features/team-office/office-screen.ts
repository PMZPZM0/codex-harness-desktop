/**
 * 办公室状态词 · 单一映射（2026-10-22 精简）
 *
 * 白色办公室场景（`OfficeCanvas`）与 `TeamOfficePreview` 共用：把**真实运行阶段 + 真实事件**
 * 翻译成工位名牌/显示器上的一行中文（⛔ 画面由 SVG 工位与黑猫成员构成，
 * 状态词与完成态时效由本文件提供）。
 */
import type { OfficeActivityKind } from "./office-activity";

/** 一次委托的**真实阶段**（由宿主从 run 记录推导，见 `TeamOfficePreview.phaseOfRun`）。 */
export type RunPhase =
  | "none"
  | "thinking"
  | "waiting"
  | "writing"
  | "reporting"
  | "done"
  | "failed";

/** 产出超过这么多字符 ⇒ 视为"已成稿"（走 reporting）。 */
export const REPORT_CHARS = 600;
/** 运行中、超过这么久仍无产出 ⇒ 视为"长时间无输出"（走 waiting）。 */
export const WAIT_AFTER_MS = 8000;
/** 完成/失败反馈保留这么久，之后回落成 none（新的会话开始时再显示）。 */
export const DONE_HOLD_MS = 60000;

/**
 * 完成/失败反馈的**时效裁剪**：`DONE_HOLD_MS` 之后回落成 `none`。
 * ⛔ 由绘制侧按绝对时刻判，宿主继续如实上报"最近一次是 done"即可。
 */
export function effectivePhase(phase: RunPhase, sinceMs: number, now: number): RunPhase {
  if (phase !== "done" && phase !== "failed") return phase;
  if (!sinceMs) return phase;
  return now - sinceMs > DONE_HOLD_MS ? "none" : phase;
}

/** 事件词（热点/HUD 上的中文；字号小，英文缩写在那儿很难读）。 */
export function eventWordZhOf(kind: OfficeActivityKind): string {
  switch (kind) {
    case "browser": return "开浏览器";
    case "websearch": return "查资料";
    case "file-write": return "写文件";
    case "file-search": return "搜文件";
    case "file-read": return "看文件";
    case "file-edit": return "改文件";
    case "terminal": return "跑命令";
    case "service": return "调服务";
    case "collab": return "分派";
    case "thinking": return "思考";
    default: return "";
  }
}