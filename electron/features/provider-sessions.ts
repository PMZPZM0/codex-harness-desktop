/**
 * provider-sessions（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：collectSessionProviderIds
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { codexHome, server } from "../runtime-refs";
import { mutableState } from "../main";
export async function collectSessionProviderIds(): Promise<Set<string>> {
  const now = Date.now();
  if (mutableState.sessionProviderIdsCache && now - mutableState.sessionProviderIdsCache.at < 60_000) return mutableState.sessionProviderIdsCache.ids;
  const ids = new Set<string>();
  // ① 权威源：引擎线程索引。引擎未就绪（启动期/重启中）就静默跳过，退回 ②。
  try {
    for (const archived of [false, true]) {
      let cursor = "";
      for (let page = 0; page < 5; page += 1) {
        const response: any = await server.request("thread/list", { limit: 200, archived, ...(cursor ? { cursor } : {}) });
        for (const entry of response?.data ?? []) {
          const id = typeof entry?.modelProvider === "string" ? entry.modelProvider.trim() : "";
          if (id) ids.add(id);
        }
        const next = typeof response?.nextCursor === "string" ? response.nextCursor : "";
        if (!next || next === cursor) break;
        cursor = next;
      }
    }
  } catch { /* 引擎没起来：跳过，下面用 rollout 兜底 */ }
  // ② 补充源：rollout 首行（session_meta）的 model_provider
  const stack = [path.join(codexHome, "sessions")];
  let visited = 0;
  while (stack.length && visited < 4000) {
    const dir = stack.pop() as string;
    let entries: any[] = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const dirEntry of entries) {
      const full = path.join(dir, dirEntry.name);
      if (dirEntry.isDirectory()) { stack.push(full); continue; }
      if (!dirEntry.name.endsWith(".jsonl")) continue;
      visited += 1;
      // 只读首行（session_meta）即可拿到创建时的 model_provider，避免整文件读入
      try {
        const handle = await fs.open(full, "r");
        try {
          const buffer = Buffer.alloc(8192);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
          const parsed = JSON.parse(firstLine);
          const id = parsed?.payload?.model_provider ?? parsed?.payload?.modelProvider;
          if (typeof id === "string" && id.trim()) ids.add(id.trim());
        } finally { await handle.close(); }
      } catch { /* 空文件/损坏行：跳过 */ }
    }
  }
  mutableState.sessionProviderIdsCache = { at: now, ids };
  return ids;
}
