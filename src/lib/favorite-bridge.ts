/**
 * 收藏请求桥 —— 把「这条消息要收藏」的意图从**共享展示组件**送到 app 状态层（09-24）。
 *
 * 为什么不逐层传 prop：`MessageFooter` 被 `ItemView` / `TurnView` / `SessionQueue` 多处复用，
 * 给它加一个 `onFavorite` 要穿过 3~4 层只会转发的包装组件（每层签名都得改），
 * 而这件事与那些中间层毫无关系。与 `src/voice/wave-level.ts` 的
 * `setVoiceOpenSettingsHandler` 同款做法：**注册一个全局处理器**，组件只表达意图。
 *
 * ⛔ 处理器为空时 `requestFavorite` 返回 false（调用方据此提示「收藏功能尚未就绪」），
 *    不静默丢弃 —— 静默失败在用户看来就是「点了没反应」。
 */

export type FavoriteRequest = {
  kind: "text" | "image" | "file" | "link";
  /** 收藏内容：文本正文 / 文件绝对路径 / URL */
  content: string;
  /** 展示标题（不填由主进程从正文推一行） */
  title?: string;
  /** 来源（从哪条消息/哪个会话收藏的，便于回溯） */
  source?: {
    threadId?: string;
    threadName?: string;
    turnId?: string;
    messageId?: string;
    role?: string;
  };
};

type FavoriteHandler = (request: FavoriteRequest) => void;

let handler: FavoriteHandler | null = null;

export function setFavoriteHandler(fn: FavoriteHandler | null): void {
  handler = fn;
}

/** 是否已有处理器（设置页/菜单用来判断「能不能收藏」）。 */
export function hasFavoriteHandler(): boolean {
  return handler !== null;
}

/** 发起一次收藏。返回 false = 状态层还没就绪（调用方应给出可见提示）。 */
export function requestFavorite(request: FavoriteRequest): boolean {
  if (!handler) return false;
  handler(request);
  return true;
}
