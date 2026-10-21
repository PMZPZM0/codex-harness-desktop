/**
 * 工具的**「这一步在干什么」**参数（`step`）—— 参照 WorkBuddy 的工具标题形态（10-21）。
 *
 * ── 为什么要这个通道 ────────────────────────────────────────────────────────
 * 命令卡/工具卡的标题此前只能**从字面反推**（`command-display.mjs` 的意图/目标/动作短语），
 * 猜得出「跑守卫 11z」，猜不出「跑守卫看有没有回归」——那需要**意图**，只有模型知道。
 * 所以给工具面加一个可选参数 `step`：模型填一句中文，卡片直接把它当标题。
 *
 * ⛔ 引擎内置的 shell 工具（`exec_command` / `shell`）**没有这条路**（0.162.1 二进制实证）：
 *    它的 `justification` 参数硬绑 `sandbox_permissions: require_escalated`（原文：
 *    “`justification` requires an explicit `sandbox_permissions`”），填了就变成**审批请求**。
 *    ⇒ 引擎内置命令只能继续走 `commandAction()` 那条规则推断；本模块只管**宿主注册的工具**。
 *
 * ── 三条纪律 ────────────────────────────────────────────────────────────────
 * ① **注入点只有一个**（主进程 `thread/start` + `thread/resume` 改工具面那两处）——
 *    ⛔ 不要在各工具 schema 里逐个手写 `step`，那份一定会漂移。
 * ② **转发前必须剥离**：第三方 MCP / 我们自己的执行端都只认自己的参数，
 *    多带一个 `step` 会被严校验的服务器判成非法入参。
 * ③ **读不到就不显示**：空串/超长一律返空，调用方退回原标签 —— ⛔ 绝不因此编一个假标题。
 */

/** 参数名（注入 schema / 剥离 / 读卡片三处共用，⛔ 不要再写字面量）。 */
export const STEP_PARAM = "step";

/** 写进 inputSchema 的参数说明：既是给模型的指令，也是这条契约的文档。 */
export const STEP_PARAM_DESCRIPTION =
  "用一句中文说清「这一步在干什么」（≤20 字，直接作为界面上的操作卡片标题，例如「跑守卫看有没有回归」"
  + "「把三条档案同步到另外两个仓」）。⛔ 只写这一步的意图，不要复述参数内容，也不要写「执行操作」这类空话。";

/** 卡片标题的长度上限（超过就当没填 —— 标题是一行，长句会挤掉状态图标）。 */
const STEP_MAX = 40;

/**
 * 给一批工具 schema 注入可选的 `step` 参数（幂等：已有 `step` 的工具原样返回）。
 *
 * ⛔ 只加 `properties`，**不进 `required`**：模型偶尔不填是正常的，卡片退回原标签即可。
 * ⛔ 不修改入参对象本身（`thread/start` 的 params 可能被别处复用），返回新数组。
 *
 * @param {unknown} tools 工具面（OpenAI function schema 数组）
 * @returns {unknown} 新数组；输入不是数组时原样返回
 */
export function withStepParam(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const schema = tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : null;
    if (!schema) return tool;
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    if (properties[STEP_PARAM]) return tool;
    return {
      ...tool,
      inputSchema: {
        ...schema,
        properties: { ...properties, [STEP_PARAM]: { type: "string", description: STEP_PARAM_DESCRIPTION } },
      },
    };
  });
}

/**
 * 转发给真正的工具前剥掉 `step`（②号纪律）。非对象/没有该键时原样返回，不制造新对象。
 * @param {unknown} args 模型给的入参
 * @returns {unknown}
 */
export function stripStepParam(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  if (!(STEP_PARAM in args)) return args;
  const { [STEP_PARAM]: _drop, ...rest } = args;
  return rest;
}

/**
 * 从入参里读出这一步的说明（卡片标题）。读不到 / 空串 / 超长 ⇒ 空串（调用方退回原标签）。
 * @param {unknown} args 工具入参
 * @param {number} [max] 上限，默认 40
 * @returns {string}
 */
export function stepOf(args, max = STEP_MAX) {
  if (!args || typeof args !== "object") return "";
  const value = args[STEP_PARAM];
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length > max) return "";
  return text;
}
