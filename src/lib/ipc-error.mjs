/**
 * IPC 错误码解析（渲染层入口）—— 09-24 实测的必要补丁。
 *
 * ⛔ 关键事实：主进程/preload 侧构造的错误对象带 `.code` / `.channel`，但**经 contextBridge
 *    回传渲染层时自定义属性会被丢弃**（结构化克隆只保留标准 Error 的 message/stack）。
 *    真机验证：`catch (e) => e.code` 在渲染层是 `undefined`，而 `e.message` 是
 *    `[ERR_NO_HANDLER] codex:request: Error invoking remote method …`。
 *
 * ⇒ 所以错误码**约定写在消息前缀** `[ERR_XXX] <channel>: <原始消息>`，渲染层用本模块解析，
 *    不要直接读 `e.code`（那样只会拿到 undefined，然后误判成"没有错误码"）。
 *    preload 侧的 `IpcError` 类型仍然有效（同进程内可用），类型里也标注了这一点。
 */

/** 已知错误码（与 preload 的 normalizeIpcError 一一对应） */
export const IPC_ERROR_CODES = [
  "ERR_MISSING_ARGS",
  "ERR_NO_HANDLER",
  "ERR_UNCLONABLE",
  "ERR_BAD_ARGS",
  "ERR_TIMEOUT",
  "ERR_INVOKE_FAILED",
];

/**
 * 从任意 thrown 值里解析出 IPC 错误码；不是 IPC 错误返回 null（调用方据此区分业务错误）。
 * @param {unknown} error
 * @returns {string | null}
 */
export function ipcErrorCodeOf(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const hit = message.match(/\[(ERR_[A-Z_]+)\]/);
  return hit ? hit[1] : null;
}

/**
 * 从 IPC 错误里解析出通道名（前缀之后的 `<channel>:` 段）；解析不到返回空串。
 * @param {unknown} error
 * @returns {string}
 */
export function ipcErrorChannelOf(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const hit = message.match(/^\[ERR_[A-Z_]+\]\s*([^:]+):/);
  return hit ? hit[1].trim() : "";
}

/** 友好的中文说明（做提示文案时用；未知码返回空串，调用方退回原文） */
export function ipcErrorHintOf(error) {
  switch (ipcErrorCodeOf(error)) {
    case "ERR_MISSING_ARGS": return "调用参数不足（应用内部错误，请反馈）";
    case "ERR_NO_HANDLER": return "该功能在当前版本不可用（通道未注册）";
    case "ERR_UNCLONABLE": return "返回值无法跨进程传递（数据类型不支持）";
    case "ERR_BAD_ARGS": return "参数不合法";
    case "ERR_TIMEOUT": return "主进程响应超时";
    case "ERR_INVOKE_FAILED": return "主进程调用失败";
    default: return "";
  }
}
