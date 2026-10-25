/**
 * 宿主注入消息的**保留标记**（10-26 用户现场：「成员同步发出来的消息，还要排队吗，这什么操作」）。
 *
 * 背景：宿主往某个会话投消息时，走的是引擎的**用户消息队列**（`thread/queue/add`）——
 *   群事件（`[群事件] …`）、子智能体回报、渠道机器人消息都走这一条（⛔ 不用 `turn/start`：
 *   那会打断正在跑的回合）。
 * 引擎视角里它们就是「排队的用户消息」⇒ 应用的**排队消息面板**会把它们显示成
 *   「排队中 1/3」的用户消息卡 —— 用户看到的是"我的消息在排队"，实际是宿主内部广播。
 *   （时间线里已经按 `[群事件]` 约定单独渲染了，⛔ 但排队面板没套这条规则。）
 *
 * ⇒ 宿主侧给这类消息的 `clientUserMessageId` 打**保留前缀**，渲染层按前缀过滤：
 *   · 引擎照常收到并消费（投递链路、FIFO、启动时机都不变）
 *   · 用户的「排队消息」面板不再出现宿主内部消息
 *     （它不是用户说的话，用户也不能编辑/删除/定时它 ⇒ 摆在那儿只会误导）
 *
 * ⛔ 前缀是**跨层契约**：主进程写、渲染层读 ⇒ 单一真相源放本文件，两边都 import。
 *    ⛔ 改前缀必须两边同改（否则过滤失效，宿主消息又会冒回排队面板）。
 */

/** 保留前缀（clientUserMessageId 以它开头 = 宿主注入，不是用户说的话）。 */
export const HOST_QUEUE_PREFIX = "host:";

/** 宿主注入消息的 clientUserMessageId。tag 用来区分来源（boss / delegate …），便于排查。 */
export function hostQueueMessageId(tag) {
  const who = String(tag || "host").replace(/[^a-zA-Z0-9_-]/g, "") || "host";
  const rand = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${HOST_QUEUE_PREFIX}${who}:${rand}`;
}

/** 这条排队项是不是宿主注入的（渲染层过滤用）。 */
export function isHostQueueItem(item) {
  const id = String(item?.clientUserMessageId ?? item?.id ?? "");
  return id.startsWith(HOST_QUEUE_PREFIX);
}
