/**
 * 自定义模型相关类型（共享：main 与 features/* 都从这里取）
 *
 * 09-21 架构改造：从 electron/main.ts 搬出（内容逐字未改）。
 */
import type { BridgeMode } from "../responses-bridge";

/**
 * 并发上限的**主进程侧默认值**（1~10）。
 *
 * 09-25 用户要求「并发默认 10」（原 3，09-19 定的）。范围仍是 1~10 ⇒ 默认即上限。
 * ⛔ 渲染层同源副本 = `src/lib/concurrency.mjs` 的 `DEFAULT_MAX_CONCURRENCY`（electron/ 与 src/
 *    独立打包、互不 import，只能各存一份）；守卫【159】逐字比对两侧。
 */
export const DEFAULT_MAX_CONCURRENCY = 10;

export type CustomModelFile = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  wireApi?: "responses" | "chat";
  encryptedKey?: string;
  /** 当前生效模型的思考档位（档案 100% 同步口径，对齐顶层 model）：
   *  写 config.toml 顶层 model_reasoning_effort 作引擎兜底默认，
   *  也是 UI「切供应商/切模型」时恢复用户所选档位的依据。 */
  effort?: string;
  /** 该供应商下已保存的模型列表，model 是其中当前生效的那个 */
  models?: ProviderModel[];
  /** 启用状态；禁用时若为当前供应商则清空当前配置 */
  enabled?: boolean;
  /** 该供应商最多允许几个会话同时跑（09-19 加、供应商配置界面可自定义；09-25 默认值 3 → 10 = 上限）。
   *  限流是同一个 Key 的共享配额 → 并发越高越容易 429；未设置时按 DEFAULT_MAX_CONCURRENCY 处理。 */
  maxConcurrency?: number;
  /** 上游**协议**（09-19 加，供应商配置界面可自定义）：桥按它决定怎么转发。
   *  · auto（默认）：先按 responses 试，上游明确表示"没这个端点"时才切 chat；
   *  · chat：直接按 Chat Completions 转换（**网关不认 responses 且自动判定不灵时手动选它**）；
   *  · responses：强制透传（确认上游就是 Responses 时用，省一次探测）。
   *  ⛔ 有些网关对未知路径返回 400（而不是 404），旧版判定会误当成"端点正常"直接透传 ⇒
   *    对话失败且看不出原因。这就是加这个手动开关的原因（Claude 类通道尤其常见）。 */
  upstreamProtocol?: BridgeMode;
};

export type ProviderModel = {
  id: string;
  /** 是否加入该供应商的可用模型列表；旧配置缺失时按 true 迁移。 */
  enabled?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputTypes?: ("text" | "image" | "video")[];
  outputTypes?: ("text" | "image" | "video")[];
  /** 该模型支持的思考档位（按声明顺序）；缺省走默认三档 low/medium/high。
   *   GPT 系等模型支持 minimal/xhigh/ultra 更多档位，在这里显式声明后引擎才认。 */
  efforts?: string[];
  /** 用户为该模型选定的思考档位（档案持久化）：切供应商/切模型时自动应用，
   *  重装/清存储后不丢。仅存档不写入引擎——引擎侧兜底默认走 config.toml
   *  顶层 model_reasoning_effort，会话内显式值由每轮 turn/start 下发。 */
  effort?: string;
};
