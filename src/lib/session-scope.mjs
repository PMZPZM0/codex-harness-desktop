/**
 * 会话作用域（session scope）—— 把「会话级的模型 / 档位 / 权限」写进**会话自己的
 * developer instructions**，让会话里的模型能读到自己的真实配置。
 *
 * 为什么需要它（09-14 实证）：
 *   模型/档位/权限早就已经是会话级状态了（权威判据 = rollout 的 `turn_context.model` /
 *   `turn_context.effort`，见 AGENTS.md「模型作用域」）。但模型自己**没有任何会话级出口**
 *   能回答「我当前是什么模型」——它能读到的只有全局 `config.toml` / `custom-model.json`
 *   的顶层 `model`（那是「新建会话时的默认值」，恒等于旧的全局默认）。于是出现：
 *   会话实际跑 glm-5.3-flash（rollout 实证），模型做配置体检时读全局档案却报
 *   deepseek-v4-flash —— 用户看到的「模型还是串全局的」。
 *   修法 = 把会话作用域写进会话级 instructions（引擎的
 *   `thread settings.collaboration_mode.settings.developer_instructions`，rollout 的
 *   `thread_settings_applied` 可回读），模型据此自报，且天然按会话隔离、互不污染。
 *
 * 本模块是纯函数：拼块 / 幂等剥离 / 变更签名。规则型断言在 scripts/check-preflight.mjs。
 */

/** 作用域块首行标记——幂等剥离与「是否已注入」判断都以它为锚。 */
export const SESSION_SCOPE_HEADING = "会话作用域（会话级·权威）";

/** 归一化输入：缺项一律回落空串，避免拼出 `undefined`。 */
function norm(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** 作用域块的取值集合（顺序固定，便于断言与 diff）。 */
export function sessionScopeValues(input = {}) {
  return {
    threadId: norm(input.threadId),
    model: norm(input.model),
    provider: norm(input.provider),
    effort: norm(input.effort),
    sandbox: norm(input.sandbox),
    approval: norm(input.approval),
    workspace: norm(input.workspace),
  };
}

/** 变更签名：模型/供应商/档位/权限任一变化即视为需要重新下发。 */
export function sessionScopeSignature(input = {}) {
  const v = sessionScopeValues(input);
  return [v.model, v.provider, v.effort, v.sandbox, v.approval].join("|");
}

/**
 * 生成对模型可见的「会话作用域」说明块。
 * 措辞刻意区分「会话级（权威）」与「全局默认（只是新会话初值）」——上一版之所以被模型
 * 自报成全局模型，就是因为全局档案被当成了当前配置。
 */
export function sessionScopeBlock(input = {}) {
  const v = sessionScopeValues(input);
  const lines = [
    SESSION_SCOPE_HEADING,
    `- 会话 ID：${v.threadId || "（未登记）"}`,
    `- 当前模型：${v.model || "（未知）"}${v.provider ? `（供应商 ${v.provider}）` : ""}`,
    `- 思考档位：${v.effort || "（默认）"}`,
    `- 执行权限：${v.sandbox || "（默认）"} / 审批 ${v.approval || "（默认）"}`,
    `- 工作区：${v.workspace || "（未指定）"}`,
    "",
    "以上是本会话**生效的会话级配置**，每个会话各自独立、互不影响。",
    "全局 config.toml / custom-model.json 的顶层 model 与 effort 只是「新建会话时的默认值」，**不代表当前会话**。",
    "被问到「当前是什么模型 / 什么档位 / 什么权限」，或做配置体检时，一律以本节为准；",
    "需要与引擎侧交叉验证时，读本会话 rollout 里的 `turn_context.model` / `turn_context.effort`。",
  ];
  return lines.join("\n");
}

/** 剥离历史注入块（幂等保护：万一基线文本里混进了作用域块，不会越拼越长）。
 *  组合时的分隔符（`---`）要一并剥掉，否则每次重发都会多留一条横线。 */
export function stripScopeBlock(text) {
  const raw = norm(text);
  if (!raw) return "";
  const at = raw.indexOf(SESSION_SCOPE_HEADING);
  if (at < 0) return raw;
  return raw.slice(0, at).replace(/(?:\s*---)?\s*$/, "");
}

/**
 * 组合最终下发的 developer instructions：**基线在前，作用域块在后**。
 * 基线取引擎的 `config/read`（即 config.toml 的 developer_instructions：语言/工具/自动化
 * 说明那一大段），必须原样带上——否则作用域块会把基线顶掉，模型就不知道 nuphus-call /
 * playwright-cli / generate_image 这些内置工具怎么用了。
 */
export function composeScopeInstructions(base, block) {
  const cleanBase = stripScopeBlock(base);
  const cleanBlock = norm(block);
  if (!cleanBlock) return cleanBase;
  return cleanBase ? `${cleanBase}\n\n---\n\n${cleanBlock}` : cleanBlock;
}
