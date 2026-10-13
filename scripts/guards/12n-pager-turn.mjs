/**
 * 市场翻页：参数根因修复 + 统一翻页过渡动画（10-13 立）
 *
 * 用户报「专家市场下一页没变化、没反馈」—— 根因在**服务端参数**：SkillHub 技能包 API 只认
 * `page=`，`pageNum` 被忽略（实测 page 1/2 返回同 6 条）；前端怎么点都是第一页且无任何视觉线索。
 * 用户追加令：「所有翻页统一做动画过渡，做好看一点」⇒ 四个翻页网格统一 `key={页码}` + `.page-turn`。
 *
 * 失效方式全是有害且静默的：
 *   · 参数回退成 pageNum ⇒ 又回到「点了没反应」且无报错（最阴的一类）；
 *   · 某个翻页点漏掉 page-turn ⇒ 翻页反馈四个市场不一致（用户点名要统一）；
 *   · 动画没有 reduced-motion 逃生口 ⇒ 违反全局减动效纪律。
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
  console.log(`  ${condition ? "✓" : "✗"} 【pager-turn】${message}`);
  if (!condition) fails++;
};

/* ── 一、根因：SkillHub 技能包 API 翻页参数（page=，⛔ 不许回退 pageNum）── */
{
  const src = read("electron/skillhub-packages.ts");
  ok(/skillsets\?page=\$\{page\}/.test(src) && /skillsets\?page=\$\{p\}/.test(src),
    "技能包列表两处请求都用 page=（主请求 + 搜索时拉全量的循环）");
  ok(!/pageNum/.test(codeOnly(src)), "⛔ 源码不再出现 pageNum（连注释都改成新事实 —— 文档滞后会误导下一轮）");
}

/* ── 二、四个翻页点统一 page-turn（key={页码}）────────────────────────── */
{
  const cases = [
    ["src/features/expert-market/ExpertMarketSection.tsx", "skill-card-grid page-turn\" key={page}", "专家包市场"],
    ["src/features/settings-plugins/PluginsMarketSection.tsx", "skill-card-grid page-turn\" key={pluginMarketPage}", "插件市场（Gitee）"],
    ["src/features/codex-official-market/CodexOfficialMarketSection.tsx", "skill-card-grid page-turn\" key={page}", "Codex 官方市场"],
    ["src/features/settings-skills/SkillsCenterSection.tsx", "skill-card-grid page-turn\" key={marketPage}", "技能市场"],
  ];
  for (const [file, needle, label] of cases) {
    ok(codeOnly(read(file)).includes(needle), `${label}：网格 key={页码} + page-turn`);
  }
}

/* ── 三、动画与逃生口 ────────────────────────────────────────────────── */
{
  const css = read("src/styles/11-settings-secrets.css");
  ok(/@keyframes page-turn-in \{/.test(css) && /\.page-turn \{ animation: page-turn-in/.test(css),
    "统一动画 keyframes + .page-turn（淡入 + 上移 10px + 微缩放）");
  ok(/@media \(prefers-reduced-motion: reduce\) \{ \.page-turn \{ animation: none; \} \}/.test(css),
    "⛔ 减动效偏好下关动画（全局纪律）");
}

/* ── 四、check 链登记 ────────────────────────────────────────────────── */
ok(JSON.parse(read("package.json")).scripts.check.includes("12n-pager-turn.mjs"), "package.json check 链已登记本守卫");

console.log(`\n【pager-turn】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
