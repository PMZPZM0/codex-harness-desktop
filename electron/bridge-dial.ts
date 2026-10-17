/**
 * 协议桥「下发地址」helper（叶子模块，2026-09-24 断环收尾）。
 *
 * ⛔ 存在的理由：`responsesBridge` 单例 + `bridgeDial` 原在 main.ts，而
 *    `main/03-turn-summary.ts` 要调 `bridgeDial` ⇒ 反向依赖 main.ts（2,000+ 行巨石 + 启动链）。
 *    两者依赖的都只是叶子（responses-bridge / upstream-protocols）⇒ 抽成本模块后
 *    main 侧与 main/** 侧都是正向依赖，环彻底消失（不留"冻结上限"尾巴）。
 *
 * 语义与原地逐字一致：桥未启动时 bridgeDial 原样返回 → 直连（降级安全）。
 */
import { ResponsesBridge } from "./responses-bridge";
import { upstreamProtocols } from "./upstream-protocols";
import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/* ⛔⛔ 桥的日志必须**落文件**（10-17 实测教训）：桥在主进程里，`console.log` 只进终端 ——
   应用以 GUI 方式启动时终端不存在 ⇒ 「旧会话 59 秒零输出」时**一行可查的证据都没有**，
   只能来回猜（浪费了整轮）。这里把同一条日志再写一份到 `userData/logs/bridge.log`。
   ⛔ 路径必须**惰性求值**（`app.getPath` 不能在模块体调，那时 userData 还没重定向）。
   ⛔ 日志失败一律静默：诊断能力不能反过来影响转发。 */
let bridgeLogPath = "";
function bridgeLog(line: string): void {
  console.log(line);
  try {
    if (!bridgeLogPath) {
      const dir = path.join(app.getPath("userData"), "logs");
      mkdirSync(dir, { recursive: true });
      bridgeLogPath = path.join(dir, "bridge.log");
    }
    appendFileSync(bridgeLogPath, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch { /* 日志失败不影响转发 */ }
}

/**
 * 本地协议桥（09-16）：引擎只会发 Responses（POST /v1/responses），而不少第三方网关
 * 只提供 /v1/chat/completions —— 这类网关过去「连接测试通过、实际对话全废」。
 * 桥让引擎照常按 Responses 调用它，由它按上游**实际能力**转发（详见 electron/responses-bridge.ts）。
 *
 * 端口固定 47121（与内置调度 MCP 47120 同族）以便跨运行稳定；被占用则退回随机端口。
 * 构造函数无副作用（仅存配置），故可在此顶层构造——与原 main.ts 行为一致。
 *
 * `emitReasoning: true` —— 必须显式打开，否则思考内容只在**回合结束后**一次性出现。
 * 原因在 `responses-bridge/02-chat-convert.ts` 的构造函数：
 *     this.emitReasoning = options.emitReasoning === true;   // 不传 ⇒ false
 * 门控的是 `if (this.emitReasoning && reasoning)`，即**推理增量的下发**；
 * 而收尾时 `01-sse-items.ts:finalizeItems` 会把累积文本一次性写进
 * `reasoning.summary` 发出 —— 这正是「结束时能看到、过程中看不到」的成因。
 *
 * 两条协议路径的默认值**不一致**，chat 路径是「不传即关」：
 *   · chat      02-chat-convert.ts:117      `options.emitReasoning === true`   → 默认关
 *   · anthropic 03-anthropic-convert.ts:188  `options.emitReasoning !== false`  → 默认开
 * 本单例是 chat 路径的唯一构造点，漏传即整个应用拿不到实时思考流。
 *
 * 上游侧无需改动：面板 `/v1/responses` 实测会流式发
 * `response.reasoning_summary_text.delta`（单次对话 347 个事件 / 4188 字符）。
 */
export const responsesBridge = new ResponsesBridge({
  preferredPort: 47121,
  log: bridgeLog,
  emitReasoning: true,
});

/**
 * 生成「下发给引擎」的 base_url：桥已启动时换成桥地址并登记上游目标；
 * 桥未启动（启动失败等）时原样返回 → 直连，行为与旧版本完全一致（降级安全）。
 */
export function bridgeDial(id: string, upstreamBaseUrl: string | undefined): string | undefined {
  if (!upstreamBaseUrl) return upstreamBaseUrl;
  /* ⛔⛔ **幂等防护**：上游绝不能是桥自己（或任何「桥地址」形状的 URL）——
     一旦有人拿着**已拨号**的地址再来 dial（例如从 config.toml 读回的 base_url 再走一遍桥），
     就会把「桥自己/旧端口」注册成上游 ⇒ 转发必 10061 拒绝 ⇒ 全部 502 ⇒ 引擎零输出无限重试
     （10-17 实测：云模型发送 62s 零输出，curl 桥端点回 502 upstream connect failed）。
     ⇒ 已经是桥地址的，原样返回、**不再注册**。 */
  if (/^http:\/\/127\.0\.0\.1:\d+\/p\//.test(upstreamBaseUrl) || /^http:\/\/localhost:\d+\/p\//.test(upstreamBaseUrl)) {
    return upstreamBaseUrl;
  }
  const dialed = responsesBridge.urlFor(id);
  if (!dialed) return upstreamBaseUrl;
  responsesBridge.register(id, { baseUrl: upstreamBaseUrl, mode: upstreamProtocols.get(id) ?? "auto", label: id });
  return dialed;
}
