/** 引擎通知中文化：弹卡（toast）里的引擎英文提示按已知模式翻译成中文；
 * 未命中的文案原样返回。只做「用户能看懂怎么办」，不逐句直译。 */
const RULES: Array<{ match: RegExp; zh: (m: RegExpMatchArray) => string }> = [
  {
    // 项目本地 config.toml 里写了只支持用户级的键（反馈 #13）
    match: /Ignored unsupported project-local config keys in\s+(.+?):\s*(.+?)\.?\s*(If you want these settings to apply.*)?$/i,
    zh: (m) => {
      const keys = m[2]
        .split(/,\s*/)
        .map((key) => key.trim())
        .map((key) => ({ model_provider: "默认模型供应商（model_provider）", model_providers: "模型供应商定义（model_providers）" }[key] ?? key))
        .join("、");
      return `项目目录里的本地配置 ${m[1].trim()} 含有引擎不再支持的键：${keys}。这些配置只认用户级 config.toml——请在应用「设置 → 模型」里配置供应商（会写入用户级配置），并删除项目里 .codex/config.toml 中的这几段，提示即消失。`;
    },
  },
  {
    match: /Unknown model\s+(.+?)\s+is used\.?\s*(This will use fallback model metadata\.?)?/i,
    zh: (m) => `模型「${m[1]}」不在引擎内置元数据表里，已使用默认元数据（属正常现象，上下文窗口等参数按你的配置生效）。`,
  },
  {
    match: /Model metadata for\s+(.+?)\s+not found\.?\s*Defaulting to fallback metadata/i,
    zh: (m) => `模型「${m[1]}」的元数据未找到，已用默认元数据兜底（不影响使用）。`,
  },
  {
    match: /Heads up: (long|multiple) (threads|compactions)[^]*multiple compactions (are|were) requested[^]*/i,
    zh: () => "上一次上下文压缩还在进行中，本次压缩请求已被忽略；等当前压缩完成即可。",
  },
  {
    match: /Full-history hydration is deprecated for paginated threads/i,
    zh: () => "引擎提示：长会话已改为分页加载（应用已自动适配，无需处理）。",
  },
  {
    match: /rate limit/i,
    zh: () => "触发供应商限流，正在自动重试；稍等片刻即可恢复。",
  },
  {
    match: /stream (?:was )?disconnected|reconnecting/i,
    zh: () => "与模型的连接中断，正在自动重连（若反复出现，检查网络或更换供应商线路）。",
  },
];

export function translateEngineNotice(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  for (const rule of RULES) {
    const m = raw.match(rule.match);
    if (m) return rule.zh(m);
  }
  return raw;
}
