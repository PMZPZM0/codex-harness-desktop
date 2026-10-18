/**
 * Laya 判断工具判据（10-18 立）
 *
 * 用户令：「给 codex 加一个调用 laya 判断的工具，看看那些场景下可以利用起来 laya 模型做判断，
 * 如果安装了 laya 模型，就再暴露这个工具给 codex」。
 *
 * 失效方式全是有害且往往静默的：
 *   · 没装也把 `laya_judge` 注册进工具面 ⇒ 模型每次请求都看到它、调了必然失败（假能力）；
 *   · 装了却看不到（条件写反 / 状态永远 false）⇒ 用户以为工具没做；
 *   · 执行端偷偷 `pip install` ⇒ 一次判断变成 800MB 下载；
 *   · 低置信把猜测当结论返回 ⇒ 比不判更糟（Laya 的校准值必须被尊重）；
 *   · 判据 criteria 与 knowledge_add 内部使用的那份漂移 ⇒ 工具判「知识」、写入端判「闲聊」。
 * 行为（真调 Laya / 预热 / 未安装）由验收 `laya-judge` 覆盖；本守卫钉纯函数真值表与接线。
 * 独立守卫（不进 _ctx MODULES 计数），已挂进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【laya-judge】${message}`);
  if (!condition) fails++;
};

/* ── 一、纯函数真值表（可直接真跑，不起 Electron / 不碰 Laya 服务）────────────── */
const { resolveLayaJudgeRequest, formatLayaVerdict } = await import("../../electron/laya-judge.ts");
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
{
  const k = resolveLayaJudgeRequest({ state: "  项目约定：提交前必须跑 npm run check  " });
  ok(k.preset === "knowledge_gate" && k.state.startsWith("项目约定") && Boolean(k.criteria.knowledge) && Boolean(k.criteria.chatter)
    && k.minConfidence === 0.5 && k.timeoutMs === 15000,
    "缺省 preset=knowledge_gate：state 去空白、判据是知识/闲聊、阈值 0.5、等待 15s");

  const d = resolveLayaJudgeRequest({ preset: "duplicate", state: "新内容", reference: "旧条目" });
  ok(d.state === "新内容" && d.instructions.includes("旧条目") && d.criteria.duplicate && d.criteria.new,
    "duplicate：新内容放 state、已有内容放 instructions（与 knowledge_add 内部验证过的问法同形），判据是重复/新增");
  ok(throws(() => resolveLayaJudgeRequest({ preset: "duplicate", state: "只有新内容" })),
    "duplicate 缺 reference ⇒ 明确拒绝（不拿空对照瞎判）");

  const c = resolveLayaJudgeRequest({ preset: "custom", state: "帮我改一下这个按钮", instructions: "判断用户意图", criteria: { task: "要改东西", question: "在问问题" } });
  ok(c.criteria.task && c.criteria.question, "custom：模型自定义 2 个选项可用");
  ok(throws(() => resolveLayaJudgeRequest({ preset: "custom", state: "x", instructions: "判断", criteria: { only: "只有一个" } })),
    "custom 少于 2 个选项 ⇒ 拒绝");
  ok(throws(() => resolveLayaJudgeRequest({ preset: "custom", state: "x", instructions: "判断", criteria: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`o${i}`, "说明"])) })),
    "custom 多于 6 个选项 ⇒ 拒绝");
  ok(throws(() => resolveLayaJudgeRequest({ preset: "custom", state: "x", instructions: "判断", criteria: { a: "", b: "说明" } })),
    "custom 选项缺含义 ⇒ 拒绝");

  ok(throws(() => resolveLayaJudgeRequest({})), "state 为空 ⇒ 拒绝");
  ok(throws(() => resolveLayaJudgeRequest({ state: "x".repeat(4001) })), "state 超 4000 字 ⇒ 拒绝");
  ok(throws(() => resolveLayaJudgeRequest({ preset: "nope", state: "x" })), "未知 preset ⇒ 拒绝");

  const clamp = resolveLayaJudgeRequest({ state: "x", minConfidence: 0.1, timeoutMs: 100 });
  ok(clamp.minConfidence === 0.5 && clamp.timeoutMs === 3000, "阈值/等待下限被钳住（0.5 / 3000ms）");
  const clampHigh = resolveLayaJudgeRequest({ state: "x", minConfidence: 0.99, timeoutMs: 999999 });
  ok(clampHigh.minConfidence === 0.95 && clampHigh.timeoutMs === 30000, "阈值/等待上限被钳住（0.95 / 30000ms）");

  const good = formatLayaVerdict("knowledge", 0.82, k.criteria, 0.5);
  ok(good.abstained === false && good.text.includes("Laya 判断") && good.text.includes("82%") && good.text.includes("项目知识"),
    "高置信结果：带选项、百分比与含义");
  const weak = formatLayaVerdict("chatter", 0.38, k.criteria, 0.5);
  ok(weak.abstained === true && weak.text.includes("弃权") && !weak.text.includes("建议"),
    "低置信结果：明确「弃权」，不诱导模型拿猜测当结论");
}

/* ── 二、工具面：装了才注册（用户需求的硬条件）─────────────────────────────── */
const part08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
const router = codeOnly(read("src/features/app-state/parts/part05/event-router/02-request.tsx"));
{
  ok(part08.includes("window.codex.layaStatus?.()"), "工具面构建时读 Laya 安装状态（可选调用，旧 preload 不炸）");
  ok(/laya\?\.installed\s*\?\s*\[[\s\S]{0,2600}?name: "laya_judge"/.test(part08),
    "laya_judge **只在 laya?.installed 为真时**进工具面（没装连 schema 都不出现）");
  ok(/name: "laya_judge"[\s\S]{0,1800}?knowledge_gate[\s\S]{0,400}?duplicate[\s\S]{0,400}?custom/.test(part08),
    "工具描述列明三种 preset（knowledge_gate / duplicate / custom）");
  ok(part08.includes("不适合") && part08.includes("弃权") && part08.includes("不可逆操作"),
    "工具描述写清适用边界：不适合安全/法律/财务等，低置信弃权");
  ok(/event\.params\?\.tool === "laya_judge"[\s\S]{0,900}?window\.codex\.layaJudge\(/.test(router),
    "渲染层事件路由把 laya_judge 转给 window.codex.layaJudge（专用通道，不走网关）");
}

/* ── 三、IPC 三件套 + 执行端 ───────────────────────────────────────────────── */
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registry = read("electron/ipc-registry.ts");
const preload = read("electron/preload.ts");
const service = codeOnly(read("electron/features/laya-service.ts"));
const dispatchCore = codeOnly(read("electron/features/dispatch-core.ts"));
const dispatchRpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
const devInstructions = codeOnly(read("electron/developer-instructions.ts"));
{
  const entry = (manifest.channels ?? manifest).find?.((c) => c.channel === "laya:judge");
  ok(Boolean(entry) && String(entry.name) === "layaJudge",
    "manifest 有 laya:judge（单一真相源），方法名 layaJudge");
  ok(registry.includes('"laya:judge"') && preload.includes("layaJudge"),
    "registry 与 preload 生成物都带上 laya:judge / layaJudge");
  ok(service.includes('ipcHost.handle("laya:judge"') && service.includes("layaJudgeForTool"),
    "laya 域有 laya:judge handler，执行端 = layaJudgeForTool");
  ok(service.includes("resolveLayaJudgeRequest") && service.includes("formatLayaVerdict"),
    "执行端复用纯函数（请求校验 / 结果格式化，不各写一份）");
  ok(service.includes("PIP_CACHE_MS") && /invalidatePipCache\(\)/.test(service) && service.includes("pipCache"),
    "pip 安装状态有缓存（新开会话/切会话不反复跑 pip show），安装/卸载会失效缓存");
  const toolFn = service.slice(service.indexOf("export async function layaJudgeForTool"), service.indexOf("export function layaShutdown"));
  ok(toolFn.length > 200 && !/layaInstall\s*\(/.test(toolFn),
    "layaJudgeForTool 里**没有** layaInstall：一次判断绝不偷偷装 800MB");
  ok(toolFn.includes("未安装") && toolFn.includes("正在预热") && toolFn.includes("formatLayaVerdict"),
    "执行端区分「未安装 / 正在预热」，低置信弃权交给纯函数（不把猜测当结论）");
  ok(dispatchRpc.includes("KNOWLEDGE_GATE_CRITERIA") && dispatchRpc.includes("DUPLICATE_CRITERIA"),
    "knowledge_add 与工具共用同一份判据（⛔ 不许两处各写一份）");
  ok(!dispatchCore.includes("laya_judge"),
    "⛔ laya_judge 不进 harness_tools 网关（同一能力两个名字会让模型绕过专用工具）");
  ok(devInstructions.includes("LAYA_INSTRUCTIONS") && devInstructions.includes("text += LAYA_INSTRUCTIONS")
    && devInstructions.includes("NEVER use it for security"),
    "常驻指令配套：只在工具表里有 laya_judge 时生效，并写明禁用场景");
}

console.log(`\n【laya-judge】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
