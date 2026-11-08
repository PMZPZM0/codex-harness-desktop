/**
 * 手机端 `/api/rpc` 的**类型白名单**（11-06）。
 *
 * 为什么单独成模块：它既是安全边界（手机只能调这些），又必须能被守卫直接 require 跑真断言 ——
 * `remote.ts` 依赖 electron（net），普通 node 进程 require 不了，所以白名单放在这个零依赖叶子里。
 *
 * ⛔ 加新类型 = 两处一起改：本表 + `remote.ts` 里对应的 `data.type === "..."` 分支。
 *    守卫 12ba 双向核对（表里有、分支没有 / 分支有、表里没有，都打红）。
 */
export const REMOTE_RPC_TYPES: ReadonlySet<string> = new Set([
  "list-threads", "get-messages", "new-thread", "boss-groups", "send-message",
  "catalog", "interrupt", "compact", "archive", "goal", "tasks",
  "turn-files", "file-diff", "goal-get", "answer", "files-list", "file-read",
  // 11-06 排队消息：运行中也能发 —— 入队 / 立即（插队）/ 撤回
  "queue-list", "queue-add", "queue-start", "queue-delete",
  // 11-08 审查：手机端思考档位跟模型规格联动（返回当前模型支持的档位）
  "efforts",
]);

/** 判断某个 RPC 类型是否在白名单里（⛔ 未登记一律拒）。 */
export function isAllowedRemoteRpc(type: unknown): boolean {
  return REMOTE_RPC_TYPES.has(String(type ?? ""));
}
