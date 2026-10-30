/**
 * 手机 / 外部入口新建会话时给引擎的 provider 绑定（10-31 从 provider-id.ts 拆出）。
 *
 * ⛔⛔ 两个必须同时满足的约束（各踩过一次）：
 *   ① **绑统一 harness 通道**：原始供应商 id（如 custom964 / cloud）≠ 引擎当前生效 provider（harness），
 *      直接传原始 id 会让首轮 `turn/start` 被拒：
 *      `This chat uses custom964, but your current provider is harness`。
 *   ② **base_url 必须过本地协议桥**：`bridgeDial(id, raw)` 把地址换成 `http://127.0.0.1:47121/p/<id>`
 *      并登记真实上游。⛔ 直接用档案里的原始地址会绕过桥 —— chat/completions 类上游拿不到适配、
 *      云通道拿不到注入的凭据，表现是「发送成功但模型零输出」，与桌面端建会话的行为不一致。
 *      桌面端每一条建会话路径（threads / teams / delegation / boss / 摘要）都是 `bridgeDial(...)`。
 *
 * 官方订阅是伪供应商：什么都不传（引擎走内置 openai + ChatGPT 登录凭据；任何内联 provider 定义
 * 都会触发密钥校验报错）。
 */
import { HARNESS_PROVIDER_ID } from "./provider-id";
import { bridgeDial } from "./bridge-dial";

export function harnessProviderConfig(model: { name?: string; baseUrl?: string; provider?: string } | null | undefined) {
  if (!model || model.provider === "openai-official") return {} as Record<string, unknown>;
  const providerId = String(model.provider ?? "");
  const baseUrl = bridgeDial(providerId, model.baseUrl) ?? model.baseUrl ?? "";
  return {
    modelProvider: HARNESS_PROVIDER_ID,
    config: {
      model_provider: HARNESS_PROVIDER_ID,
      model_providers: {
        [HARNESS_PROVIDER_ID]: {
          name: model.name || HARNESS_PROVIDER_ID,
          base_url: baseUrl,
          env_key: "CODEX_HARNESS_API_KEY",
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
    },
  } as Record<string, unknown>;
}
