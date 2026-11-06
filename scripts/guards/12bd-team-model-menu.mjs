/**
 * 群聊输入框模型下拉 = 与主对话同口径（11-07 用户实测）：
 *   「模型为啥跟外面对话框模型下拉框展示不一样，给我同步做成一样的」
 *   「明明没有这么多模型选项，新的供应商」
 *
 * 真根因：群聊直接遍历 `listCustomModels().providers`，**没按 enabled 过滤**
 * ⇒ 已停用的旧供应商（cloud / wbm）的模型全冒出来（用户实测 8 个 vs 主对话 1 个）。
 * 口径收在纯函数 `src/lib/model-menu.mjs`：只列启用供应商的启用模型、生效供应商排最前、按裸模型名去重。
 * ⛔ 独立守卫；挂进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectModelChoices } from "../../src/lib/model-menu.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【team-model-menu】${message}`);
  if (!condition) fails++;
};

/* ── ① 真值表（与用户真实档案同形：两条停用旧供应商 + 一条启用新供应商） ── */
{
  const providers = [
    { provider: "cloud", name: "云端模型", enabled: false, source: "cloud", model: "deepseek-v4.1-flash", models: [{ id: "deepseek-v4.1-flash" }, { id: "glm-5.3-flash" }] },
    { provider: "custom964", name: "wbm", enabled: false, source: "custom", model: "cn:deepseek-v4.1-flash", models: [{ id: "cn:deepseek-v4.1-flash" }] },
    { provider: "custom53", name: "zm", enabled: true, source: "custom", model: "workbuddy-ai/deepseek-v4.1-flash-sg", models: [{ id: "workbuddy-ai/deepseek-v4.1-flash-sg" }] },
  ];
  const choices = collectModelChoices(providers, "custom53");
  ok(choices.length === 1 && choices[0].modelId === "workbuddy-ai/deepseek-v4.1-flash-sg",
    `⛔ 停用供应商的模型不再出现（实得 ${choices.map((c) => c.modelId).join(" / ") || "无"}）`);
  ok(choices[0].isActive === true && choices[0].providerName === "zm",
    "生效供应商排最前并标记 isActive（下拉说明只给非当前供应商）");
  ok(collectModelChoices(providers.map((p) => ({ ...p, enabled: false })), "custom53").length === 1,
    "当前生效供应商即使被标停用也照常列出（与主对话 allModels 一致）");
  ok(collectModelChoices(providers.map((p) => ({ ...p, enabled: false })), null).length === 0,
    "没有生效供应商且全部停用 ⇒ 候选为空（不是把停用的当成当前）");
}

/* ── ② 同口径细节：启用模型过滤 / provider.model 兜底 / 全局去重 / 倍率来源 ── */
{
  const choices = collectModelChoices([
    { provider: "a", name: "A", enabled: true, source: "cloud", model: "m3", models: [{ id: "m1", enabled: true, credits: "x2" }, { id: "m2", enabled: false }, { id: "m3", enabled: true }] },
    { provider: "b", name: "B", enabled: true, source: "custom", model: "m1", models: [{ id: "m1", credits: "x9" }] },
  ], "a");
  ok(!choices.some((c) => c.modelId === "m2"), "供应商内 enabled:false 的模型被过滤");
  ok(choices.some((c) => c.modelId === "m3"), "供应商当前 model 即使不在 models 里也补进候选");
  ok(choices.filter((c) => c.modelId === "m1").length === 1, "按裸模型名全局去重（跨供应商同名只出现一次）");
  ok(choices.find((c) => c.modelId === "m1")?.credits === "x2",
    "倍率只取 cloud/relay 源，且同模型以生效供应商为准（自定义供应商不展示倍率）");
  ok(collectModelChoices([{ provider: "z", name: "Z", enabled: true, source: "relay", model: "r1", models: [{ id: "r1", credits: "x3" }] }], "z")[0].credits === "x3",
    "relay 源的启用模型带倍率");
}

/* ── ③ 接线：群聊只能走同一口径，别再自己遍历 providers ── */
{
  const composer = read("src/features/harness-team/10-team-composer.tsx");
  ok(/collectModelChoices\(providers, current\)/.test(composer),
    "群聊模型候选走 collectModelChoices（与主对话同一真相源）");
  ok(!/for \(const p of Array\.isArray\(providers\)/.test(composer),
    "⛔ 不再自己遍历 providers（旧实现不过滤 enabled ⇒ 旧供应商模型全部冒出来）");
  ok(/badges: badgesOf\(entry\)/.test(composer) && /credits: entry\.credits/.test(composer)
    && /tone: avatarToneOf\(\(entry\.isActive \? "" : entry\.providerName\) \|\| entry\.modelId\)/.test(composer)
    && /monogram:/.test(composer),
    "展示与主下拉一致：徽标 / 倍率 / 供应商配色（生效行按模型名取色，与主下拉同款）/ 首字母头像");
  ok(/desc: entry\.isActive \? "" : entry\.providerName/.test(composer),
    "供应商说明只在非当前供应商行显示（与主下拉一致）");
  ok(/onOpen=\{\(\) => void loadModels\(\)\}/.test(composer),
    "打开下拉时重新拉目录（改完供应商不用重开群聊面板）");
  ok(/value: entry\.modelId/.test(composer) && !/value: `custom:/.test(composer),
    "⛔ value 仍是裸模型名（群聊派活直接下发 turn/start.model，复合串引擎不认）");
  const overlay = read("src/features/harness-team/index.tsx");
  const groupView = read("src/features/harness-team/04-team-group-view.tsx");
  const appView = read("src/features/app-view/AppView.tsx");
  ok(/__model_settings__/.test(composer) && /onOpenModelSettings\?\.\(\)/.test(composer)
    && /onOpenModelSettings=\{onOpenModelSettings\}/.test(groupView)
    && /onOpenModelSettings=\{onOpenModelSettings\}/.test(overlay),
    "群聊模型下拉末尾的「更多设置…」与主下拉同款，一路接到设置入口");
  ok(/onOpenModelSettings=\{\(\) => \{[\s\S]{0,260}?setSettingsPage\("model"\)[\s\S]{0,120}?setSettingsOpen\(true\)/.test(appView),
    "「更多设置…」真打开 设置 → 模型（不是摆设）");
}

console.log(`\n【team-model-menu】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
