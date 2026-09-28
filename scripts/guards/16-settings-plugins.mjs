/**
 * 预检守卫组：16-settings-plugins —— 「设置 → 插件」页的结构分区。
 *
 * 立此组的原因（2026-09-28 用户：「这三个是内置插件，跟下面插件市场区分开，三个布局做好看一点」）：
 *   改造前，三张**内置**卡散在同一页的两个区块里 —— 生图/视觉在页面顶部的「内置插件」块，
 *   视频生成接口在下方「内置接口」块（与**可安装的**插件市场列表同页），用户分不清
 *   「自带的能力」和「要装的东西」。改造后：三张内置卡同区同构，插件市场独立成区。
 *
 * ⛔ 另钉一个**我自己踩过的坑**：给这套卡片追加样式时，`.bi-plugin-*` 被**追加了两份**
 *    （后者覆盖前者），导致「grid 改单列」改了没生效 —— 文件里同一选择器只允许一份权威定义。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【195】设置·插件页的内置卡分区"));

  const builtin = readFileSync(join(ROOT, "src", "components", "BuiltinPlugins.tsx"), "utf8");
  const market = readFileSync(join(ROOT, "src", "features", "settings-plugins", "PluginsMarketSection.tsx"), "utf8");
  const videoCard = readFileSync(join(ROOT, "src", "components", "VideoGenBuiltInCard.tsx"), "utf8");
  const css = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");

  /* ① 三张内置卡必须**同一个区块**：生图 + 视觉 + 视频 */
  (builtin.includes('<VideoGenBuiltInCard />') && builtin.includes('panel("image")') && builtin.includes('panel("vision")') ? ok : fail)(
    "【195】三张内置卡同区（生图 / 视觉辅助 / 视频生成接口 都在「内置插件」区块）"
  );
  (builtin.includes('className="bi-plugin-grid"') ? ok : fail)(
    "【195】内置卡共用同一容器 .bi-plugin-grid（单列整行）"
  );

  /* ② 插件市场页**不得**再出现内置卡（负向断言：自带能力与可安装插件必须分区）
        ⛔ 匹配前先剥注释 —— 那里的注释正好写着「『内置接口』块搬走了」，不剥会被自己打红。 */
  (!market.includes("VideoGenBuiltInCard") ? ok : fail)(
    "【195】插件市场页不再渲染内置卡（自带 ≠ 市场，混在一页会让人分不清）"
  );
  // ⛔ 判据锚**区块标题的 JSX 形态**（plugin-market-title 后面跟「内置接口」）——
  //    不要用 `/内置接口/` 裸匹配：那条「搬走了」的说明注释就在同文件里，会被自己打红（实测）。
  (!/plugin-market-title[^>]*>\s*内置接口/.test(market) ? ok : fail)(
    "【195】插件市场页不再有「内置接口」区块标题"
  );

  /* ③ 三卡同构：视频卡的卡片也用 .bi-plugin 规格（不是另一套类名） */
  (/className="bi-plugin is-summary"/.test(videoCard) ? ok : fail)(
    "【195】视频生成接口卡复用 .bi-plugin 规格（三卡同构）"
  );
  (!/className="vg-card"/.test(videoCard) ? ok : fail)(
    "【195】不再使用早期那套 .vg-card 卡片类（已并入 .bi-plugin）"
  );

  /* ④ ⛔ 同一选择器只允许一份权威定义（追加式改样式的坑：后者覆盖前者，改了像没改） */
  for (const sel of [".bi-plugin-grid", ".bi-plugin", ".bi-plugin-head", ".bi-plugin-form", ".bi-plugin-foot"]) {
    const n = (css.match(new RegExp(`^\\${sel} \\{`, "gm")) ?? []).length;
    (n <= 1 ? ok : fail)(`【195】${sel} 只有一份定义（实测 ${n} 份 —— 重复追加会让前面的改动静默失效）`);
  }

  /* ⑤ 主题合规：卡片样式不许写死色值（DESIGN.md 规则 1） */
  const cardBlock = css.slice(css.indexOf(".bi-plugin-grid"), css.indexOf(".bi-plugin.is-summary .bi-plugin-foot"));
  (!/#[0-9a-fA-F]{3,8}\b/.test(cardBlock) ? ok : fail)(
    "【195】内置卡样式只用主题变量（无写死色值 —— 写死会在暗色主题下瞎掉）"
  );

  /* ⑥ 淘汰的样式类不该留残印 */
  (!/\.vg-card/.test(css) ? ok : fail)("【195】.vg-card 系列样式已清（弹层的 .vg-* 保留）");
}
