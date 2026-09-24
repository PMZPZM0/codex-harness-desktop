/**
 * dispatch-rpc（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：ensureDispatchHttp / dispatchRpcCall
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import http from "node:http";
import { canDispatchFrom } from "../dispatch";
import { broadcastHarnessEvent } from "../features/window-bus";
import type { DispatchKind } from "../dispatch";
import { DISPATCH_FIXED_PORT, dispatchMcpTools, dispatchProbes, dispatchToken, ensureDispatchToken, restrictedThreadRole, stableKey } from "../features/dispatch-core";
import { runDelegatedTask } from "../features/delegation";
import { delegateRegistry, server, threadRuntimeStore } from "../runtime-refs";
import { mutableState } from "../main";
export async function dispatchRpcCall(name: unknown, args: Record<string, unknown>): Promise<{ ok: boolean; output?: string; error?: string }> {
  // ── 旁证：引擎把调用转发给 MCP 服务器的同一时刻会发 item/started 事件（含真实 threadId）。
  // 用「参数指纹」对上号，拿到的才是**引擎认定的调用者**——模型谎报身份也绕不过。
  const argsKey = stableKey(args);
  const deadline = Date.now() + 10000;
  let callerThreadId = "";
  while (Date.now() < deadline) {
    const hit = [...dispatchProbes].reverse().find((probe) => probe.argsKey === argsKey && Date.now() - probe.at < 120_000);
    if (hit) { callerThreadId = hit.threadId; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!callerThreadId) return { ok: false, error: "安全校验失败：引擎事件里找不到这次调用" };

  if (name === "agent_invoke") {
    const originDispatch = (await threadRuntimeStore.get(callerThreadId))?.dispatch;
    const restrict = await restrictedThreadRole(callerThreadId);
    const originRecord = await delegateRegistry.infoOf(callerThreadId);
    const gate = canDispatchFrom({
      isDelegated: Boolean(originRecord),
      depth: originRecord?.depth ?? 0,
      holdsLock: originDispatch?.enabled === true,
      restricted: restrict.restricted,
      restrictedLabel: restrict.label,
    });
    if (!gate.ok) return { ok: false, error: gate.reason };
    const result = await runDelegatedTask({
      kind: String(args.kind ?? "") as DispatchKind,
      name: String(args.name ?? ""),
      query: String(args.query ?? ""),
      originThreadId: callerThreadId,
      cwd: args.cwd ? String(args.cwd) : undefined,
      model: args.model ? String(args.model) : undefined,
      effort: args.effort ? String(args.effort) : undefined,
      sandbox: args.sandbox ? String(args.sandbox) : undefined,
      approvalPolicy: args.approvalPolicy ? String(args.approvalPolicy) : undefined,
    });
    return result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error ?? "调度失败" };
  }
  if (name === "agent_archive_sessions") {
    const ids = Array.isArray(args.threadIds) ? args.threadIds.map(String) : [];
    // ⛔ 必须真调引擎的 thread/archive（09-16 用户实测：只标登记表的话侧栏会话不消失）。
    // 与 agents:archive IPC 同一条链路：引擎归档 + 登记表标记 + 广播刷新。
    let archived = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const record = await delegateRegistry.infoOf(id);
        if (!record || record.archived) continue;
        await server.request("thread/archive", { threadId: id });
        await delegateRegistry.markArchived([id]);
        archived += 1;
      } catch { failed.push(id); }
    }
    const remaining = await delegateRegistry.listByOrigin(String(args.originThreadId ?? "")).catch(() => []);
    broadcastHarnessEvent({ type: "delegates-changed" } as any);
    const hint = failed.length ? `（${failed.length} 个失败）` : remaining.length ? `（还有 ${remaining.length} 个未归档）` : "";
    return { ok: true, output: `已归档 ${archived} 个调度会话${hint}。` };
  }
  return { ok: false, error: `未知工具：${String(name)}` };
}
export async function ensureDispatchHttp(): Promise<void> {
  if (mutableState.dispatchHttpReady) return mutableState.dispatchHttpReady;
  await ensureDispatchToken(); // 令牌先就绪：/mcp 端点与 config.toml 都要用它
  mutableState.dispatchHttpReady = new Promise<void>((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      // ── MCP 协议端点（/mcp，09-16）：引擎用 url 直连（无子进程冷启动，避免 stdio 的
      //    electron 启动 28s > startup_timeout 被判死导致工具不注册）。Streamable HTTP：
      //    POST = JSON-RPC 请求/响应；**GET = SSE 长连接**（引擎 rmcp 客户端必开，缺了会报
      //    "fail to get common stream: Unexpected content type: None"）；DELETE = 会话终止。 ──
      if (req.url?.startsWith("/mcp") && (req.method === "GET" || req.method === "DELETE")) {
        const token = new URL(req.url, "http://x").searchParams.get("token");
        if (token !== dispatchToken) { res.statusCode = 403; res.end(); return; }
        if (req.method === "DELETE") { res.statusCode = 200; res.end(); return; }
        // SSE 流：保持连接（引擎用它收服务端主动消息），定期心跳防中间层断连
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "mcp-session-id": "harness-dispatch" });
        res.write(": connected\n\n");
        const keep = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* 连接已断 */ } }, 25000);
        req.on("close", () => clearInterval(keep));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/mcp")) {
        const token = new URL(req.url, "http://x").searchParams.get("token");
        if (token !== dispatchToken) { res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "token 校验失败" } })); return; }
        let body = "";
        req.on("data", (chunk) => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
        req.on("end", async () => {
          let msg: any = null;
          try { msg = JSON.parse(body); } catch { res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); return; }
          res.setHeader("mcp-session-id", "harness-dispatch");
          const reply = (result: any) => res.end(JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, result }));
          const fail = (message: string) => res.end(JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32000, message } }));
          if (msg?.id === undefined || msg?.id === null) { res.statusCode = 202; res.end(""); return; } // notification
          try {
            if (msg.method === "initialize") {
              reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "harness-dispatch", version: "1.0.0" } });
              return;
            }
            if (msg.method === "tools/list") { reply({ tools: dispatchMcpTools() }); return; }
            if (msg.method === "ping") { reply({}); return; }
            if (msg.method === "tools/call") {
              const out = await dispatchRpcCall(msg.params?.name, msg.params?.arguments ?? {});
              reply({ content: [{ type: "text", text: out.ok ? String(out.output ?? "") : "调用被拒绝：" + String(out.error ?? "未知原因") }], isError: !out.ok });
              return;
            }
            fail("method not found: " + String(msg.method));
          } catch (error: any) {
            fail(String(error?.message ?? error).slice(0, 300));
          }
        });
        return;
      }
      if (req.method !== "POST" || !req.url?.startsWith("/rpc")) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "not found" })); return; }
      let body = "";
      req.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body) as { token?: string; name?: string; args?: Record<string, unknown> };
          if (!payload.token || payload.token !== dispatchToken) { res.end(JSON.stringify({ ok: false, error: "token 校验失败" })); return; }
          res.end(JSON.stringify(await dispatchRpcCall(payload.name, payload.args ?? {})));
        } catch (error: any) {
          res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 300) }));
        }
      });
    });
    server.listen(DISPATCH_FIXED_PORT, "127.0.0.1", () => {
      mutableState.dispatchHttpPort = DISPATCH_FIXED_PORT;
      resolve();
    });
    // 端口被占（可能另一个实例/残留进程）：退回相邻端口并记录，config 会用实际端口重写
    server.on("error", () => {
      const fallback = http.createServer(server.listeners("request")[0] as any);
      fallback.listen(0, "127.0.0.1", () => {
        const addr = fallback.address();
        if (addr && typeof addr === "object") mutableState.dispatchHttpPort = addr.port;
        resolve();
      });
    });
    // 立即 resolve 兜底：listen 异常时不能卡死 config 写入（宁可这轮没有 MCP 段）
    setTimeout(resolve, 2000);
  });
  return mutableState.dispatchHttpReady;
}
