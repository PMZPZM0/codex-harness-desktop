/**
 * 语音模型提供方注册表（11-10 用户令：「加一个 moss live 模型，留一个语音模型接口」）。
 *
 * 这是语音模型的**扩展接口**：现有本地离线引擎（vits/kokoro/emotivoice）与远程实时模型
 * （MOSS-Live）都登记成 `VoiceModelProvider`。新增模型 = 往 `VOICE_MODEL_PROVIDERS` 加一条，
 * 界面/状态按 kind 分流，⛔ 不再往 UI 里硬编码卡片。
 *
 * ⛔ 纯数据、无副作用、不 import electron —— 守卫可直接真跑断言。
 * ⛔ 两类模型生命周期不同：
 *   · local-onnx：下载模型包 → 校验 → 本机 sherpa-onnx 推理（现有链路）；
 *   · remote-live：不下载模型，填远端地址/模型/密钥，走提供方 API（全双工实时）。
 *     目前只**留接口与配置**，实时推理运行时待接入 ⇒ runnable=false，UI 如实提示。
 */

export type VoiceModelKind = "local-onnx" | "remote-live";

export type RemoteConfigField = {
  key: "baseUrl" | "model" | "apiKey";
  label: string;
  placeholder: string;
  /** 密钥类字段：状态只回 hasKey/末四位，不回明文 */
  secret?: boolean;
};

export type VoiceModelProvider = {
  id: string;
  label: string;
  kind: VoiceModelKind;
  tagline: string;
  role: string;
  /** 官方文档/平台地址（远程模型给配置入口） */
  docs?: string;
  /** remote-live 的配置字段；local-onnx 无 */
  remoteFields?: RemoteConfigField[];
  /** 模型装了/配了 ≠ 能合成。remote-live 实时推理未接入前为 false */
  runnable: boolean;
  pros: string[];
  cons: string[];
};

/** MOSS-Live：模思智能全双工实时语音 API（远程，非本地 ONNX）。 */
export const MOSS_LIVE_PROVIDER: VoiceModelProvider = {
  id: "moss-live",
  label: "MOSS-Live",
  kind: "remote-live",
  tagline: "全双工实时语音 · 边听边说",
  role: "远程实时对话模型：自然打断、边听边说。不占本机磁盘，需提供方 API 密钥。",
  docs: "https://platform.mosi.cn/docs/models/moss-live",
  remoteFields: [
    { key: "baseUrl", label: "接口地址", placeholder: "https://…（MOSS-Live API 基址）" },
    { key: "model", label: "模型", placeholder: "moss-live" },
    { key: "apiKey", label: "API 密钥", placeholder: " sk-…", secret: true },
  ],
  runnable: false,
  pros: ["全双工：边听边说、自然打断，接近真人对话", "不下载模型、不占本机磁盘与 CPU", "表现力与自然度高于本地离线 TTS"],
  cons: ["需联网与提供方 API 密钥，离线不可用", "实时推理运行时待接入，当前仅留接口与配置", "对话内容会发送到提供方服务器"],
};

/** 现有本地引擎登记成同一接口（数据与 model-manifest / UI 文案保持一致）。 */
export const VOICE_MODEL_PROVIDERS: VoiceModelProvider[] = [
  {
    id: "vits", label: "轻量播报", kind: "local-onnx", runnable: true,
    tagline: "vits-zh-ll · 装完基础模型就能用", role: "默认引擎，随基础语音模型一起装。",
    pros: ["体积最小、CPU 最快", "零额外依赖，装完即用"], cons: ["偏机械、只有 5 个音色"],
  },
  {
    id: "kokoro", label: "自然多音色", kind: "local-onnx", runnable: true,
    tagline: "Kokoro v1.1 int8 · 中英 103 音色", role: "想让播报更像真人时用它。",
    pros: ["103 音色、韵律自然", "与现有同一套 sherpa-onnx 运行时"], cons: ["CPU 慢约 1.8 倍", "无情绪控制"],
  },
  {
    id: "emotivoice", label: "情感语气", kind: "local-onnx", runnable: false,
    tagline: "EmotiVoice · 真情绪控制", role: "要高兴/悲伤/愤怒语气时用它。",
    pros: ["真情绪、2014 音色"], cons: ["体积大", "缺通用 ONNX 推理运行时，暂不能合成"],
  },
  MOSS_LIVE_PROVIDER,
];

/** 读某个远程模型的已存配置（不校验，只取）。 */
export function remoteConfigOf(
  remote: Record<string, { baseUrl?: string; model?: string; apiKey?: string }> | undefined,
  id: string,
): { baseUrl: string; model: string; apiKey: string } {
  const c = remote?.[id] ?? {};
  return { baseUrl: String(c.baseUrl ?? ""), model: String(c.model ?? ""), apiKey: String(c.apiKey ?? "") };
}

/** 远程模型是否已配置（地址+模型+密钥齐才算，缺一个都连不上）。 */
export function remoteConfigured(
  remote: Record<string, { baseUrl?: string; model?: string; apiKey?: string }> | undefined,
  id: string,
): boolean {
  const c = remoteConfigOf(remote, id);
  return Boolean(c.baseUrl && c.model && c.apiKey);
}
