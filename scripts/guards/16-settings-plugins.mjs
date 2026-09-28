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

  /* ③ 三卡同构 = **同一颗紧凑行组件**（09-28 三次改版：卡面只留一行摘要 + 二级弹窗放字段）。
        用户原话：「为啥这三个卡片要占这么多，不会做出二级弹窗吗」。 */
  const rowComp = readFileSync(join(ROOT, "src", "components", "BuiltinPluginRow.tsx"), "utf8");
  (builtin.includes("<BuiltinPluginRow") && videoCard.includes("<BuiltinPluginRow") ? ok : fail)(
    "【195】三张内置卡都渲染 BuiltinPluginRow（行结构唯一实现 —— 各画一份必然漂移）"
  );
  ([builtin, videoCard].filter((s) => s.includes('className="bi-row"')).length === 0 ? ok : fail)(
    "【195】卡面不再自绘 .bi-row（行结构只能来自 BuiltinPluginRow）"
  );
  (!/<input|textarea|select/.test(rowComp) ? ok : fail)(
    "【195】紧凑行组件里没有任何输入字段（字段只能进二级弹窗 —— 摊在卡上就是用户嫌的『占这么多』）"
  );
  (builtin.includes('className="bi-modal-body"') && videoCard.includes('className="vg-list"') ? ok : fail)(
    "【195】三卡各有二级弹窗承载字段（生图/视觉 .bi-modal-body，视频 .vg-list）"
  );
  (!/className="vg-card"/.test(videoCard) ? ok : fail)(
    "【195】不再使用早期那套 .vg-card 卡片类（已并入统一行 + 弹窗）"
  );

  /* ⑦.5 ⛔ 内置插件的二级弹窗必须 createPortal 到 body（09-28 用户截图：弹窗被嵌在设置面板里，
        左/上/下被面板裁掉、header 整个看不见）。面板祖先链上只要有**任何一级**创建了包含块
        （transform / filter / contain / will-change —— 动画容器很常见），position:fixed 就退化成
        相对该祖先定位。portal 到 body 后与 DOM 祖先彻底无关，是最稳的修法。 */
  (builtin.includes("createPortal(") && builtin.includes(", document.body)") ? ok : fail)(
    "【195】生图 / 视觉弹窗 createPortal 到 body（嵌在面板里会被祖先的包含块裁掉）"
  );
  (videoCard.includes("createPortal(") && videoCard.includes(", document.body)") ? ok : fail)(
    "【195】视频接口弹窗 createPortal 到 body（同一坑，两个弹窗都不能例外）"
  );

  /* ④ ⛔ 同一选择器只允许一份权威定义（追加式改样式的坑：后者覆盖前者，改了像没改） */
  for (const sel of [".bi-plugin-grid", ".bi-row", ".bi-row-icon", ".bi-modal-body", ".bi-modal-foot"]) {
    const n = (css.match(new RegExp(`^\\${sel} \\{`, "gm")) ?? []).length;
    (n <= 1 ? ok : fail)(`【195】${sel} 只有一份定义（实测 ${n} 份 —— 重复追加会让前面的改动静默失效）`);
  }

  /* ⑤ 主题合规：卡片与弹窗样式不许写死色值（DESIGN.md 规则 1） */
  const cardBlock = css.slice(css.indexOf(".bi-plugin-grid"));
  (!/#[0-9a-fA-F]{3,8}\b/.test(cardBlock) ? ok : fail)(
    "【195】内置卡 / 弹窗样式只用主题变量（无写死色值 —— 写死会在暗色主题下瞎掉）"
  );

  /* ⑥ 淘汰的样式类不该留残印 */
  (!/\.vg-card/.test(css) ? ok : fail)("【195】.vg-card 系列样式已清（弹层的 .vg-* 保留）");

  /* ⑦ 窄容器不许溢出（09-28 用户截图：三行右侧的「状态 + 配置」被面板边界裁掉）
        ⛔ 病根是 **grid 列写成 `1fr`** —— grid 列的默认最小值是 `auto`(=min-content)，
           而行内描述是 `nowrap` ⇒ 列的 min-content = 整句话宽（远大于面板）⇒ 列被撑宽、
           整行溢出容器。必须 `minmax(0, 1fr)`。这是"grid 子项溢出"的标准修法，
           与 flex 里给子项 `min-width: 0` 是同一件事的两面 —— 两处都要有。
        ⛔ 上一次离线预览用 900px 宽容器 ⇒ 完全没暴露（面板实际 ~620px）。**验证必须用真实宽度**。 */
  (/\.bi-plugin-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css) ? ok : fail)(
    "【195】内置卡网格用 minmax(0,1fr) 而非 1fr（否则 nowrap 描述撑宽列 ⇒ 右侧状态/按钮被面板裁掉）"
  );
  (/\.bi-row\s*\{[^}]*min-width:\s*0/.test(css) ? ok : fail)(
    "【195】.bi-row 作为 grid 项允许收缩（min-width:0，与上一条配套）"
  );
  (/\.bi-row > \.bi-row-state,\s*\n\.bi-row > \.secondary-setting \{ flex: none; \}/.test(css) ? ok : fail)(
    "【195】行内状态胶囊与按钮 flex:none（中文 min-content 只有一个字宽，不写会被挤成一条）"
  );
}
