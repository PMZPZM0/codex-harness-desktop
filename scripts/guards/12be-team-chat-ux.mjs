/**
 * 群聊三块 + 两处布局压缩（11-07 用户令）
 *
 * 用户原话：
 *   「伙伴资料卡（点头像看身份/模型/群内统计）、@ 候选面板（机器人单独一类）、群内搜索三块 这个继续完成一下」
 *   「然后这个输入框上面这个列表，改成@面板，然后停止放到群成员列表卡片后面，
 *     上面太宽了，下面输入框也是太宽了，聊天内容看不到多少了」
 *   「专家团会话，总是主代理说话，代替其他成员回复，其他成员的会话不会直接到群里」
 *
 * ⛔ 这个守卫盯的是**因果链**，不是"有没有这个词"：
 *   ① 口径在纯函数里（`team-mention.mjs` / `team-search.mjs`）—— 面板只是画；
 *   ② 视图真的接线（面板/资料卡/搜索/已选 chip 都渲染出来，⛔ 不是写了组件没挂）；
 *   ③ 布局压缩是**可验证的**：常驻 chip 整块消失、输入框 min-height 回到 64；
 *   ④ 团成员产出直投群流：事件分支 + 合成作者 id + 提示词不许转述。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMention, matchMentionCandidates, mentionSectionsOf, mentionTriggerOf } from "../../src/lib/team-mention.mjs";
import { searchGroupRows } from "../../src/lib/team-search.mjs";
import { createGroup, setMemberAvatar } from "../../src/lib/team-models.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/* ⛔ 负向结构断言必须剥注释（项目纪律）：注释里引用旧实现不能把断言顶红。 */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【team-chat-ux】${message}`);
  if (!condition) fails++;
};

const group = {
  id: "g1",
  name: "交付群",
  leadId: "u1",
  members: [
    { id: "u1", kind: "human", name: "我" },
    { id: "p1", kind: "bot", name: "星象", targetKind: "expert", targetKey: "xingxiang", targetProfession: "视觉设计" },
    { id: "p2", kind: "bot", name: "软件开发专家团", targetKind: "team", targetKey: "t1" },
    { id: "p3", kind: "bot", name: "空壳", targetKind: "", targetKey: "" },
    { id: "p4", kind: "bot", name: "静音的人", targetKind: "expert", targetKey: "muted", muted: true },
  ],
};
const catalog = [
  { kind: "expert", key: "chengshu", name: "承枢", profession: "交付总监", teamId: "t1" },
  { kind: "member", key: "m1", name: "洞明", profession: "逆向工程专家", teamId: "t1" },
  { kind: "member", key: "m2", name: "观澜", profession: "前端工程师", teamId: "t1" },
];

/* ── ① @ 面板口径：机器人单独一类 + 团成员落到团那一行 ── */
{
  const sections = mentionSectionsOf(group, catalog);
  ok(sections.map((s) => s.key).join(",") === "bot,team,kid",
    `面板分三段且机器人单独一类（实得 ${sections.map((s) => s.key).join(",") || "空"}）`);
  const bot = sections.find((s) => s.key === "bot");
  ok(bot.items.length === 3 && bot.items.every((i) => i.id !== "u1"),
    `⛔ 机器人单独一类：**只列伙伴**，不列人（群里只有你自己，@ 自己毫无意义；实得 ${bot.items.map((i) => i.name).join("/")}）`);
  ok(bot.items.every((i) => !String(i.selectId).startsWith("team:")),
    "⛔ selectId 永远是**群成员 id**（合成 id 不是群成员，派活会被判未绑定）");
  const team = sections.find((s) => s.key === "team");
  ok(team && team.items.length === 1 && team.items[0].selectId === "p2",
    "专家团占一行，点它 = 叫整团（selectId 是团那一行的成员 id）");
  const kid = sections.find((s) => s.key === "kid");
  ok(kid && kid.items.length === 2 && kid.items.every((i) => i.selectId === `team:t1:${i.id.replace(/^kid:/, "")}`),
    "⛔ 团成员 @ 的是**成员本人**（合成 id team:<teamId>:<memberId>；用户：「每个成员都可以艾特」）");
  ok(kid && !kid.items.some((i) => i.selectId === "p2"),
    "⛔ 团成员的 selectId 不再指向团那一行（那会退化成主理人代答，用户实测就是这个问题）");
  ok(kid.items[0].avatar.targetKind === "member" && kid.items[0].avatar.targetKey === "m1",
    "团成员的头像按自己的身份画（不是团徽章）");
  ok(team.items[0].avatar.targetKind === "expert" && team.items[0].avatar.targetKey === "chengshu",
    "团那一行画**主理人**的脸（用户：「肯定要是主理人➕成员」）");
  ok(bot.items.find((i) => i.id === "p3")?.unbound === true,
    "未绑定的伙伴在面板里标出来（⛔ 不隐藏：隐藏会让人以为「没这个人」）");
  ok(bot.items.find((i) => i.id === "p4")?.muted === true, "静音的伙伴在面板里标出来");
}

/* ── ② @ 触发与替换（打字触发 / 半角全角边界） ── */
{
  const cases = [
    ["@", 1, ""],
    ["请 @洞", 4, "洞"],
    ["第一行\n@观", 6, "观"],
    ["邮箱 a@b", 6, null],
  ];
  for (const [text, caret, expect] of cases) {
    const trigger = mentionTriggerOf(text, caret);
    ok((trigger ? trigger.query : null) === expect,
      `triggerOf(${JSON.stringify(text)}, ${caret}) ⇒ ${JSON.stringify(expect)}（实得 ${JSON.stringify(trigger ? trigger.query : null)}）`);
  }
  const applied = applyMention("请 @洞 帮我看下", { start: 2 }, "洞明");
  ok(applied.text === "请 @洞明 帮我看下", `替换保留原词尾后的正文（实得 ${JSON.stringify(applied.text)}）`);
  ok(applied.caret === 2 + 2 + 2, `caret 落在替换后的词尾（实得 ${applied.caret}）`);
  ok(matchMentionCandidates([{ name: "洞见·逆向", role: "逆向" }, { name: "洞明", role: "逆向" }], "洞", 1)[0].name === "洞明",
    "同分时名字短的优先（输入 `@洞` 先出「洞明」而不是「洞见·逆向」）");
  ok(matchMentionCandidates([{ name: "甲" }, { name: "乙" }], "", 1).length === 1, "空查询也有候选（`@` 一打就出列表）");
}

/* ── ③ 群内搜索口径：多词 AND / 结果可跳转 / 不搜卡片 ── */
{
  const rows = [
    { key: "k1", itemId: "i1", authorId: "p1", at: 1, kind: "text", text: "周报 已经 写好" },
    { key: "k2", itemId: "i2", authorId: "p2", at: 2, kind: "text", text: "毛利 口径 待确认" },
    { key: "k3", itemId: "i3", authorId: "p2", at: 3, kind: "card", text: "周报" },
    { key: "k4", itemId: "i4", authorId: "p1", at: 4, kind: "text", text: "毛利 口径 已对齐" },
  ];
  const hit = searchGroupRows(rows, "毛利 口径");
  ok(hit.map((h) => h.key).join(",") === "k4,k2", `多词 AND + 按时间倒序（实得 ${hit.map((h) => h.key).join(",")}）`);
  ok(hit.every((h) => h.itemId && h.key), "每条结果都带 key/itemId（跳转要靠它定位 DOM）");
  ok(!hit.some((h) => h.key === "k3"), "⛔ 卡片行不参与搜索（没有正文可读）");
  ok(searchGroupRows(rows, "   ").length === 0, "空查询不返回结果（⛔ 不要一打开就刷一屏）");
  const long = "x".repeat(200) + "命中" + "y".repeat(200);
  const one = searchGroupRows([{ key: "k9", itemId: "i9", authorId: "p1", at: 5, kind: "text", text: long }], "命中")[0];
  ok(one && one.snippet.length < 100, `snippet 有长度上限（实得 ${one ? one.snippet.length : "无"}）`);
}

/* ── ④ 视图接线：三块都真的渲染出来了 ── */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/<TeamMentionPanel/.test(view) && /mention\.open &&/.test(view),
    "@ 候选面板随 `mention.open` 渲染（不是常驻）");
  ok(/<TeamProfileCard/.test(view) && /openProfile\(/.test(view) && /setProfile\(\{ memberId/.test(view),
    "资料卡：点头像拿锚点坐标并渲染浮层");
  ok(/<TeamSearchPanel/.test(view) && /searchGroupRows|onJump=\{jumpToRow\}/.test(view),
    "群内搜索面板挂到群头");
  ok(/data-item-id=\{row\.itemId\}/.test(view) && /getAttribute\("data-item-id"\)/.test(view),
    "搜索跳转锚点与消息 DOM 对齐（`data-item-id` 一处写、一处读）");
  ok(/const need = rows\.length - index/.test(view) && /setVisibleCount\(Math\.min\(rows\.length, need \+ 6\)\)/.test(view),
    "跳转前先补分页窗口（目标不在 DOM 里时滚动会静默失败）");
  ok(/is-search-hit/.test(view) && /setFlashKey\(""\)/.test(view) || /setFlashKey\(\(cur\) => \(cur === hit\.key \? "" : cur\)\)/.test(view),
    "命中高亮是**临时**的（1.6s 后摘掉，⛔ 不留永久标记）");
  ok(/team-group__selected/.test(view) && /atTargets\.length > 0/.test(view),
    "已选 @ 只在真的选了人时出现一行");
}

/* ── ⑤ 布局压缩：常驻 chip 整块消失 + 输入框回到 64 ── */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(!/team-group__atbar/.test(view),
    "⛔ 输入框上方那排常驻 chip 整块删除（用户：「上面太宽了」——根因就是它）");
  const css = read("src/styles/61-team-mode.css");
  ok(/\.team-composer \.team-composer__input \{ min-height: 64px; \}/.test(css),
    "输入框 min-height 压到 64（用户：「下面输入框也是太宽了」；旧值 110 在文件前半段，靠源码顺序覆盖）");
  const lastMinHeight = [...css.matchAll(/\.team-composer \.team-composer__input \{ min-height: (\d+)px; \}/g)].pop();
  ok(!lastMinHeight || Number(lastMinHeight[1]) <= 64,
    `min-height 的**最后一条**规则必须 ≤64（实得 ${lastMinHeight ? lastMinHeight[1] : "无覆盖"}）`);
  ok(/\.team-mention \{/.test(css) && /\.team-search \{/.test(css) && /\.team-profile \{/.test(css),
    "三块的样式都在（面板/搜索/资料卡）");
  ok(/\.team-msg\.is-search-hit \{/.test(css), "搜索命中高亮的样式存在");
  /* ⛔⛔ 11-07 用户令（截图）：「消息开头的一处艾特是真艾特，其余位置的艾特都是假艾特且被重复展示；
     请把所有艾特统一改为真艾特……多个艾特按出现顺序逐一渲染」。判据三条：
       ① 正文走 linkifyMentions（唯一口径是纯函数，有单测），⛔ 不再单独渲染 mentions 前缀（那必然重复）；
       ② `a` 组件把提及链接画成带头像的胶囊（头像 ⇒ 与用户中心同源：MemberAvatar/UserAvatar）；
       ③ 提及胶囊有样式（⛔ 无样式 = 裸文字，用户看到的就还是"假艾特"）。 */
  /* ⛔ 渲染拆到独立板块 `17-team-mention-text.tsx`（守住 >1000 行棘轮）⇒ 判据读那个文件。 */
  const atText = codeOnly(read("src/features/harness-team/17-team-mention-text.tsx"));
  ok(/linkifyMentions\(/.test(atText)
    && /<Markdown components=\{components\}>/.test(atText)
    && !/team-card__prefix/.test(view)
    && /<TeamMentionText/.test(view),
    "⛔ 艾特只从正文出：linkify + 自定义 a 组件；不再渲染 mentions 前缀（重复的根因）");
  ok(/mentionIdOfHref\(href\)/.test(atText)
    && /<MemberAvatar member=\{faceOfId\(id\)\} size=\{16\}/.test(atText)
    && /candidates=\{mentionCandidates\}/.test(view),
    "提及带头像：头像按 id 取真身（用户 ⇒ UserAvatar，成员 ⇒ 智能体头像）");
  ok(/\.team-at \{[\s\S]{0,240}?display: inline-flex/.test(css)
    && /\.team-at__avatar/.test(css),
    "提及胶囊是**行内**元素（⛔ 不许独占一行，否则句子被切断）");
  const mentionRender = read("src/lib/team-mention-render.mjs");
  ok(/export function splitMentionSegments/.test(mentionRender)
    && /export function linkifyMentions/.test(mentionRender)
    && existsSync(join(ROOT, "tests/team-mention-render.test.mjs")),
    "艾特解析是纯函数且有真值表单测（顺序 / 分隔符 / 长名优先 / 代码块）");
  /* 11-07 用户对照截图：「名字在消息气泡外面，引用消息在气泡里面并且跟下面消息对齐」。 */
  ok(/className="team-msg__main"/.test(view)
    && /className="team-msg__meta"/.test(view)
    && /<div className="team-msg__body">[\s\S]{0,900}?team-process__quote--top/.test(view),
    "⛔ 名字那一行移出气泡（main 列容器），引用仍留在气泡里");
  ok(/\.team-msg__main \{[\s\S]{0,220}?flex-direction: column/.test(css)
    && /\.team-msg__body \.team-process__quote--top \{[^}]*display: inline-flex/.test(css)
    && /\.team-msg__body \.team-process__quote--top \{[^}]*margin: 2px 0 8px -8px/.test(css)
    && /\.team-msg__body \.team-process__quote--top \{[^}]*background: none/.test(css)
    && !/\.team-msg__body \.team-process__quote--top \{[^}]*background: color-mix/.test(css)
    && /\.team-msg__body \.team-process__quote--top \.team-process__quote-bar \{[^}]*position: absolute/.test(css),
    "引用行无底色、宽度收成内容宽（⛔ 不拉到对面，11-08 用户截图）；文字仍与正文左对齐（竖线绝对定位不占位）");
  /* 11-07 用户令「头像对齐输入框边框」：改前实测头像 left 259 / 输入框卡片 left 221（差 38px）。
     根因是子项按 720 居中、composer 按 790 列居中 ⇒ 两条轴不同，必须共用同一条公式。 */
  ok(/\.team-group__composer \{ padding-inline: max\(14px, calc\(\(100% - var\(--team-column\)\) \/ 2\)\); \}/.test(css)
    && /\.team-group__stream > \* \{[\s\S]{0,200}?max-width: var\(--team-column\)/.test(css)
    && /\.team-group__stream > \* \{[\s\S]{0,200}?margin-inline: auto/.test(css)
    && /align-items: flex-start;/.test(css),
    "⛔ 消息头像与输入框左边框同轴（stream / composer 共用 --team-column 与同一居中口径）");
}

/* ── ⑩ 全屏自适应 + 两侧折叠键 + 输入区不铺底（11-08 用户截图）──────────────
   ① 「中间这个都不自适应居中」：根因是 11-07 那版 `.team-group__stream > * { margin-right: 0 }`
     把空态 `.team-group__empty { margin: auto }` 的右半边打成 0 ⇒ 整块被推到右边。
   ② 「输入框也不会自适边长」：列宽钉死 790，全屏时只占中间一小条。
   ③ 「两边侧边栏都没有展开折叠按键」／「🔍 右边加一个下面展开折叠的按键」。
   ④ 「输入框这一排怎么都弄了底色，不要铺满底色」。 */
{
  const css = read("src/styles/61-team-mode.css");
  ok(/\.team-group__stream > \* \{[\s\S]{0,200}?width: min\(calc\(100% - 28px\), var\(--team-column\)\)/.test(css)
    && /--team-column: min\(var\(--chat-column-max\), calc\(100% - var\(--chat-side-reserve\) \* 2\)\)/.test(css)
    && !/--team-column: min\(100%, 1800px\)/.test(css),
    "群列宽与主对话**同一个数**（--chat-column-max 1000 + 让位；⛔ 既不钉死 790，也不放到 1800）");
  ok(!/\.team-group__stream > \* \{[^}]*margin-right: 0/.test(css),
    "⛔ 子项的 margin-right 不得写 0（会把空态的 margin:auto 打残 ⇒ 空态整块右漂）");
  ok(/\.team-group__empty \{ margin: auto;/.test(css) === false || /\.team-group__empty \{[^}]*margin: auto/.test(css),
    "空态仍靠 margin:auto 双向居中（左右由子项 margin-inline:auto 兜住）");
  const panel = codeOnly(read("src/features/harness-team/index.tsx"));
  ok(/is-rail-collapsed/.test(panel) && /team-mode__rail-mini/.test(panel) && /PanelLeftClose/.test(panel)
    && /harness-team:rail-collapsed/.test(panel) && /--team-rail: 48px/.test(css),
    "左栏可收成 48px 迷你条（折叠键 + 落 localStorage，⛔ 关掉面板再开不该忘）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/PanelRightClose/.test(view) && /is-members-hidden/.test(view) && /harness-team:members-open/.test(view)
    && /\.team-group__body\.is-members-hidden \.team-group__members \{ display: none; \}/.test(css),
    "成员栏可收起（收起 = 整栏不渲染，主列自然变宽）");
  ok(view.indexOf('aria-label="群内搜索"') > 0
    && view.indexOf('aria-label="群内搜索"') < view.indexOf("<PanelRightClose size={14} />")
    && view.indexOf("<PanelRightClose size={14} />") < view.indexOf("群设置"),
    "⛔ 折叠键位在 🔍 右边（用户点名了位置）");
  ok(/\.team-group__composer \{[\s\S]{0,600}?background: transparent;/.test(css),
    "⛔ 输入区那一排不再整条铺底（用户：「不要铺满底色」）");
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/send-button morph-action/.test(composer) && /<span className="morph-action-icon">/.test(composer)
    && !/team-composer__send/.test(composer) && !/team-composer__count/.test(composer)
    && !/is-send"\s*>\s*<span/.test(composer),
    "发送键与主对话同源（.send-button.morph-action），⛔ 不再自造蓝色药丸 / 字数计数");
  ok(/\.team-composer \{[\s\S]{0,600}?min-height: 108px;/.test(css)
    && /\.team-composer \{[\s\S]{0,600}?padding: 16px 14px 10px;/.test(css)
    && /\.team-composer \{[\s\S]{0,600}?box-shadow: var\(--shadow\);/.test(css)
    && !/\n\.team-composer \{ padding: 8px 10px 6px; \}/.test(css),
    "输入卡几何对齐主对话 .composer（108 最小高 / 16-14-10 内边距 / 同一阴影，⛔ 后面不许再压回 8-10-6）");
  /* 11-08 用户：「对齐左边文字一排，现在还是有点靠下了」——实测群头文字 55~67、左栏「团队」60~71，
     差 4px。根因两块头部内边距不同（群头 6+28+6=40，左栏头 11+28+8=47）⇒ 左栏头必须也收成 6/6。 */
  /* 11-08 用户（圈住独立窗标题栏）：「上面这个还是没对齐，偏下，放到这个框上下居中的位置」。
     ⛔ 真根因是**盒子被 1px 边框吃掉**：`.team-modal__head` 的 border-bottom 把 content box
        从 40 压到 39 ⇒ flex 居中的字/钮全落在 19.5；再加上字体默认行盒，肉眼就是"偏下"。
     ⇒ 分隔线改内阴影（不占盒子）+ 标题行高归 1 + 窗口钮族高改 40（原来 44 高、中心 24）。 */
  const cssBare = codeOnly(css);   // ⛔ 负向判断要剥注释：说明文字里就写着 `border-bottom: 1px`
  ok(/\.team-modal__head \{[\s\S]{0,400}?box-shadow: inset 0 -1px 0 var\(--line\);/.test(cssBare)
    && !/\.team-modal__head \{[^}]*border-bottom/.test(cssBare),
    "标题栏用**内阴影**画分隔线（border-bottom 会把 40 的盒子压成 39 ⇒ 整排字/钮偏下 0.5~1px）");
  ok(/\.team-modal__title strong,[\s\S]{0,80}?\.team-modal__sub \{ line-height: 1; \}/.test(css),
    "标题/副标题 line-height: 1（flex 居中的是行盒，默认行盒里 CJK 字面偏低）");
  ok(/\.is-team-popout \.window-controls \{ top: 0; height: 40px; \}/.test(css),
    "独立窗三钮族高 = 标题行高 40（全局 44 族是给 52 标题栏的；沿用它 ⇒ 钮中心 24、比中线低 4px，底边还会越线）");
  ok(/\.team-mode__rail-head \{[\s\S]{0,160}?padding: 6px 10px 6px 12px;/.test(css)
    && !/\.team-mode__rail-head \{[^}]*padding: 11px /.test(css),
    "左栏「团队」与群头同高（两块头部内边距都是 6/6 ⇒ 首行文字落在一条线上，⛔ 别再给左栏头加 11px 上边距）");
}

/* ── ⑨ 群内成员头像（11-07 用户令「加一个群内的成员头像自定义修改功能」）──
   判据四条：能点开（视图接线）、自定义优先（⛔ 顺序反了就等于没做）、上传当场压缩、
   落盘通道齐（主进程 handler + manifest + registry）。 */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const avatar = codeOnly(read("src/features/harness-team/13-team-avatar.tsx"));
  const picker = codeOnly(read("src/features/harness-team/19-team-avatar-picker.tsx"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const manifest = read("electron/ipc-channels.manifest.json");
  /* ⛔ 这里读原文：registry 的注释里含 `/*` 片段，过 codeOnly 会把 channels 整行一起吞掉（实测）。 */
  const registry = read("electron/ipc-registry.ts");
  ok(/team-group__member-avatar has-agent is-editable/.test(view)
    && /setAvatarTarget\(/.test(view)
    && /<TeamAvatarPicker/.test(view),
    "成员栏头像可点开选择器（⛔ 组件写了不接线 = 功能不存在）");
  ok(/if \(face\)[\s\S]{0,900}?const custom = memberAvatarSrc\(member\?\.avatar\)[\s\S]{0,240}?if \(custom\)/.test(avatar),
    "智能体成员：自定义头像（图集面孔 / 上传图）优先于默认脸（顺序反了改了也看不出来）；人类成员固定走 UserAvatar");
  ok(/createImageBitmap/.test(picker) && /drawImage\(bitmap/.test(picker) && /toDataURL\("image\/webp"/.test(picker),
    "上传图当场压成 128 方形（⛔ 原图塞 dataURL 一张就几 MB）");
  ok(/harness-team:set-avatar/.test(ipc) && /harness-team:set-avatar/.test(manifest) && /harness-team:set-avatar/.test(registry),
    "落盘通道齐（handler + manifest + 域表；少一处 = 预检【2】红 / 点了不生效）");
}

/* ── ⑩ 成员产出落群**不依赖面板**（11-07 用户令：「关掉群弹窗，任务就莫名其妙结束了、没结果回传」）──
   旧实现只有渲染层在 `team-run finished` 里写群日志 ⇒ 面板一卸载就没人接；
   现在主进程（team-invoke）在成员回合结束时直接落群，且 id 与渲染层同一个 ⇒ 双写在盘上只有一条。 */
{
  const invoke = codeOnly(read("electron/team-invoke.ts"));
  const bridge = codeOnly(read("electron/team-group-bridge.ts"));
  const ipcHost = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  ok(/appendMemberOutputToGroup\(boundGroup/.test(invoke) && /groupOfTeam\(team\.teamId\)/.test(invoke),
    "成员产出由**主进程**落群（面板关掉也照写）");
  ok(/export function bindTeamGroup/.test(bridge) && /export function groupOfTeam/.test(bridge)
    && /export function setTeamGroupAppender/.test(bridge),
    "team → 群 的绑定与写入口在独立桥里（⛔ 不让 harness-team-ipc ↔ team-invoke 成环）");
  ok(/bindTeamGroup\(partner\.targetKey, group\.id\)/.test(ipcHost)
    && /setTeamGroupAppender\(\(gid, entry\) => appendMessageTo\(gid, entry\)\)/.test(ipcHost),
    "派团时登记绑定 + 挂载时注入写入口（⛔ 不登记 = 成员产出无处可去）");
  /* ⛔ 11-07 Code review 发现：团成员会话由 team_member_invoke 起，拿不到群派活的 groupContextBlock。 */
  ok(/collaborationProtocolLines\("member"\)/.test(invoke),
    "团成员会话也拿到 member 协议（⛔ 不经 groupContextBlock 的那条链路）");
  ok(/id: `team-run:\$\{run\.runId\}`/.test(invoke)
    && /id: `team-run:\$\{String\(run\.runId \?\? memberThread\)\}`/.test(store),
    "⛔ 两个进程用**同一个幂等 id**（`team-run:<runId>`）—— 否则面板开着时同一条产出会写两遍");
}

/* ── ⑪ 入口改名 + 协作协议（11-07 用户令：「把群组改名为『工作伙伴』，会话标签保持不变」；
      「明确各成员如何沟通 / 配合 / 协调 / 汇报 / 产出，让含专家团的群明显优于自定义群」）── */
{
  const sidebar = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));
  const models = read("src/lib/team-models.mjs");
  const sop = read("electron/expert-teams/06-team-tools.ts");
  ok(/<span>工作伙伴<\/span>/.test(sidebar) && !/<span>群聊<\/span>/.test(sidebar),
    "侧栏入口叫「工作伙伴」（⛔ 会话上的「群调度」标签不动）");
  ok(/export function collaborationProtocolLines/.test(models)
    && /collaborationProtocolLines\(role\)/.test(models)
    && /const teamLike = kids\.length > 0/.test(models),
    "群上下文按「有没有团」分档注入协作协议（团版两大档 / 单人精简版）");
  ok(/你是主理人/.test(models) && /你在团里只管自己这一环/.test(models) && /一次只推进一件事/.test(models),
    "三档口径都在：主理人（分工/并发/验收/汇报/冲突）、成员（对齐/越界/交付格式）、单人（一件事/缺就问）");
  ok(/交接标准/.test(sop) && /汇报口径/.test(sop),
    "主理人 SOP 补了交接标准与汇报口径（派活消息必须写清输入/交付物/交给谁）");
}


/* ── ⑫ 独立群聊通道（11-07 用户令：「群聊是独立板块、独立通道，群聊不需要调度」）──
   判据：群聊会话/工具/投递都在 group-talk/ 自己的文件里，⛔ 不碰 runDelegatedTask / delegateRegistry /
   「没有调度权限」那套会话级指令；工具由主进程应答；外面会话的标签是「伙伴」。 */
{
  const chan = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  const tools = codeOnly(read("electron/features/group-talk/02-tools.ts"));
  const talk = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  const dispatch = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const badge = codeOnly(read("src/features/dispatch/DispatchMenu.tsx"));
  ok(/export async function ensureTalkThread/.test(chan) && /export async function runTalkTurn/.test(chan)
    && /dynamicTools: buildGroupTalkTools\(\)/.test(chan),
    "群聊每人一条长期引擎会话（thread/start 挂自己的工具，resume 复用）");
  ok(!/runDelegatedTask|delegateRegistry|canDispatchFrom|delegateScopeBlock/.test(chan + tools + talk),
    "⛔ 独立通道一行都不碰外面的调度链（不是改提示词糊弄）");
  ok(/group_say/.test(tools) && /group_read/.test(tools) && /group_members/.test(tools)
    && /export async function handleGroupTalkToolCall/.test(tools)
    && /export function attachGroupTalkEvents/.test(tools),
    "工具三件套 + 主进程应答（群聊会话的事件会被 filterForRenderer 裁掉）");
  ok(/lookupGroupThread\(/.test(tools),
    "工具身份只认引擎下发的 threadId（⛔ 不许模型自报群 id / 成员 id）");
  ok(/export function buildTalkInput/.test(talk) && /@名字：你要说的话/.test(talk)
    && !/结论、依据、建议|交付物|请给结论/.test(talk),
    "群聊输入是「有人对你说了一句」，⛔ 不是任务派发模板");
  ok(/runTalkTurn\(group\.id/.test(dispatch) && !/runDelegatedTask\(/.test(dispatch)
    && /attachGroupTalkEvents\(server\)/.test(dispatch),
    "群派活接线到独立通道，⛔ 不再调 runDelegatedTask");
  ok(/\? \"伙伴\"/.test(badge), "外面会话标签改成「伙伴」");
  /* ⛔⛔ 11-07 用户令：「把子会话调度权限关了，只关调度权限，不要动工作伙伴里面的群聊机制」——
     伙伴会话也是子会话 ⇒ 一律没有对外调度权限（agent_invoke 被拒）；群聊机制（group_say 投递 /
     runTalkTurn）不经过 canDispatchFrom，照常可用。 */
  const dispatchCore = codeOnly(read("electron/features/dispatch-core.ts"));
  const dispatchRpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
  ok(/lookupGroupThread\(threadId\)\)\s*return \{ restricted: true, label: "工作伙伴会话", dispatchOnly: true \}/.test(dispatchCore),
    "工作伙伴的伙伴会话没有对外调度权限（子会话一律不给 agent_invoke；群聊投递不受影响）");
  /* ⛔ 用户原话「**只关调度权限**」：知识库写入 / 定时任务 / CLI 安装这些非调度能力照旧
     （三处闸必须显式放过 dispatchOnly —— 漏一处就是把整包专家限制套到伙伴头上）。 */
  ok((dispatchRpc.match(/restrict\.restricted && !restrict\.dispatchOnly/g) || []).length >= 3,
    "「只关调度」= 知识库 / 定时任务 / CLI 安装三处闸显式放过 dispatchOnly");
}

/* ── ⑬ 艾特可见 + 群聊提示词不裸露 + 会话可分辨（11-07 真机两张截图）────────── */
{
  const models = read("src/lib/team-models.mjs");
  const ipcMain = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const talkSrc = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  const chanSrc = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  /* ⛔⛔ 11-08 用户令：「前面怎么还自动多一个 @」+「我消息气泡里面以透出来这种效果」
     ⇒ 正文**不再注入 `@名字`**（群日志 = 用户原话），"@ 了谁"改由气泡里的提及 chip 表达。
     判据两条：① 派活落盘不再调 withMentionPrefix；② 用户消息渲染出 `team-msg__mentioned` chip。 */
  ok(!/withMentionPrefix\(text/.test(ipcMain) && /^\s*text,$/m.test(ipcMain),
    "⛔ 派活落盘正文不再注入 @ 名字（用户原话原样入库；补一次就多一个 @，还看不出是系统加的）");
  ok(/team-msg__mentioned/.test(read("src/features/harness-team/04-team-group-view.tsx"))
    && /team-msg__mentioned-chip/.test(read("src/styles/61-team-mode.css")),
    "用户消息气泡里以「头像 + 名字」chip 透出这条 @ 了谁（截图 2 的效果）");
  ok(/\[SYSTEM TASK · 工作伙伴消息\]/.test(talkSrc) && /=== 用户需求 ===/.test(talkSrc) && /=== END ===/.test(talkSrc),
    "群聊输入包 SYSTEM TASK 壳：user-refs 只留需求体，⛔ 提示词不裸露在气泡");
  ok(/发件人：member · /.test(talkSrc) && /你手上有三个群聊工具/.test(talkSrc),
    "模型仍读得到发件人与工具说明（壳只影响显示，不影响指令）");
  ok(/thread\/name\/set/.test(chanSrc) && /伙伴·/.test(chanSrc),
    "群聊会话命名「伙伴·成员@群」——⛔ 不再是一堆随机笔名让人看不懂");
}
/* ── ⑭ 艾特不吃掉已输入的正文（11-07 真机：「输入了很多内容，再艾特，内容没了」）──── */
{
  const mentionLib = read("src/lib/team-mention.mjs");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const mentionTest = read("tests/team-mention-panel.test.mjs");
  ok(/hasCaret/.test(mentionLib) && /end = clamp\(rawCaret\)/.test(mentionLib),
    "⛔ applyMention 只替换触发时 caret 之前的查询词，不再吃光 @ 后的连续中文");
  ok(/caret: trigger\.caret/.test(view) && /caret: mention\.caret/.test(view),
    "触发位置与光标位置一起存进面板状态，选候选时原样传给纯函数");
  ok(/长中文里艾特不再吃掉整段正文/.test(mentionTest) && /没有 caret 的老调用仍按扫描兜底/.test(mentionTest),
    "回归真值表：长中文保全文 + 老调用兜底");
}
/* ── ⑮ 工作伙伴独立窗口（11-08 用户令：可缩放、挂后台、主应用真关闭时一起关）────── */
{
  const winFactory = codeOnly(read("electron/features/window-factory.ts"));
  const mainSrc = codeOnly(read("electron/main.ts"));
  const appSrc = codeOnly(read("src/App.tsx"));
  const popoutRoot = codeOnly(read("src/features/harness-team/21-team-popout-root.tsx"));
  const sidebar = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));
  const popoutCss = read("src/styles/61-team-mode.css");
  ok(/export function createTeamPopoutWindow/.test(winFactory) && /minWidth: 560/.test(winFactory)
    && /resizable: true/.test(winFactory) && /teamPopout: "1"/.test(winFactory),
    "独立窗口可缩放、有最小尺寸、URL 带 teamPopout=1");
  ok(/mainWin\.once\("closed"/.test(winFactory) && /win\.close\(\)/.test(winFactory),
    "主应用真关闭时一起关闭（hide / 最小化到托盘不算）");
  ok(/window:popout-team/.test(mainSrc) && /window:popout-team-close/.test(mainSrc),
    "打开/聚焦与关闭两条 IPC 都登记在主进程 window 域");
  ok(/isTeamPopoutWindow\(\)/.test(appSrc) && /TeamPopoutRoot/.test(appSrc)
    && /onCloseWindow/.test(popoutRoot) && /is-team-popout/.test(popoutRoot),
    "独立窗口首帧分流到群聊根组件，关闭键走关窗通道");
  ok(/popoutTeam\(\)/.test(sidebar) && /\.is-team-popout \.team-backdrop/.test(popoutCss),
    "侧栏入口改为打开独立窗口；窗口内铺满、不留模态遮罩");
  /* ⛔⛔ 11-08 用户截图「你这都三层系统按键」：原生标题栏 + 自绘窗口钮 + 卡片头 X 三层叠一起。
     ⇒ 与会话独立弹窗同一套窗框（frame:false），系统钮只由 `.window-controls` 画一次。 */
  const at = winFactory.indexOf("export function createTeamPopoutWindow");
  const teamWin = at < 0 ? "" : winFactory.slice(at, at + 3200);
  ok(/process\.platform === "win32" \? \{ frame: false \}/.test(teamWin)
    && /titleBarStyle: "hiddenInset"/.test(teamWin),
    "⛔ 独立窗口走无边框窗框（与 ?popout= 会话弹窗同款）；留原生标题栏就是三层按键");
  ok(/\.is-team-popout \.team-modal__head \{[^}]*-webkit-app-region: drag/.test(popoutCss)
    && /\.is-team-popout \.team-modal__head \{[^}]*padding-right: 112px/.test(popoutCss),
    "卡片头兼任标题栏：整条可拖 + 给自绘窗口钮让 112px（⛔ 少了标题会压到钮底下）");
  ok(/\.is-team-popout \.team-modal__close \{ display: none; \}/.test(popoutCss)
    && /\.is-team-popout \.esc-hint \{ display: none; \}/.test(popoutCss),
    "⛔ 独立窗口不再重复一个关闭 X / 一个按了没反应的 ESC 提示（关闭交给窗口钮）");
}
/* ── ⑥ 停止键位置：成员栏底部，⛔ 不再占消息流那一行 ── */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const css = read("src/styles/61-team-mode.css");
  /* 停止键的**位置、存在性与运行态视觉**全交给 `12bg-team-stop-placement`（那条线是它的 owner，
     用户在四个位置之间改过）。这里⛔ 不再断言它 —— 两处断言会互相打架（11-07 实践）。 */
  const running = view.slice(view.indexOf("team-group__running"), view.indexOf("team-group__running") + 1400);
  ok(!/team-group__stop/.test(running),
    "⛔ 运行态条里不再画停止按钮（那一行只说明状态）");
}

/* ── ⑦ 输入框工具行：@ 入口 + 群菜单不占另一行 ── */
{
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/onOpenMention\?: \(anchor: HTMLElement\) => void;/.test(composer) && /mentionCount\?: number;/.test(composer)
    && /toolsSlot\?: React\.ReactNode;/.test(composer) && /mentionAnchorRef\?: RefObject<HTMLButtonElement \| null>;/.test(composer),
    "新 prop 都在 Props 里（@ 入口带锚点、人数徽标、工具行、@ 面板锚点 ref；⛔ 少一个就是「写了不生效」）");
  ok(/aria-label="选择伙伴（@）"/.test(composer) && /team-composer__at-badge/.test(composer),
    "@ 按钮带已选人数徽标");
  ok(/\{toolsSlot\}/.test(composer), "群菜单按钮渲染在工具行（FLOAT 形态由父层不传）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/onOpenMention=\{\(\) => \(mention\.open \? closeMention\(\) : openMentionPanel\(\)\)\}/.test(view) && /mentionCount=\{atTargets\.length\}/.test(view)
    && /toolsSlot=\{!floatMenu \?/.test(view),
    "群视图把 prop 真的传下去了（@ 入口带开关、人数徽标、工具行；⛔ 组件加了 prop 不传 = 按钮不存在）");
}

/* ── ⑧ 专家团成员产出直投群流（用户：「总是主代理说话，代替其他成员回复」） ── */
{
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  ok(/event\.type === "team-run"/.test(store) && /teamAuthorIdOf\(teamId, memberKey\)/.test(store),
    "团成员的运行事件以**合成作者 id**写进群流（署名是成员自己）");
  ok(/phase === "started"[\s\S]{0,400}appendLive|setLive/.test(store),
    "started 建流式卡（同一个 runId 只更新一张）");
  ok(/appendMessageRef\.current\(hit\.gid/.test(store), "finished 落一条真消息（⛔ 只活在流式卡里就不算进群）");
  const models = read("src/lib/team-models.mjs");
  ok(/export function teamAuthorIdOf/.test(models) && /export function parseTeamAuthorId/.test(models),
    "合成作者 id 的编解码只有一处（⛔ 别在视图里手拼字符串）");
  ok(/成员做完会自己把结果发进群/.test(models) && /别替他们复述/.test(models),
    "提示词里明说：成员产出自己进群，主理人别复述（11-07 改成口语，语义不变）");
  /* ⛔ 11-07：派活整体搬到主进程 ⇒ 这条判据跟着去 `harness-team-ipc.ts` 的 `dispatchGroupText`。
     `forTeam` 决定主理人拿到的身份块是「团」还是「单人」——两处（渲染层/主进程）只剩一处了。 */
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  /* ⛔ 11-07 独立群聊通道后，`forTeam`（派活身份块）整个退场：不再有"主理人代转成员产出"。
     口径改成：群聊输入里直接写明「别人的回复会以他的署名进群」，由独立通道投递。 */
  const talkSrc = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  ok(/buildTalkInput\(\s*talkOptions/.test(ipc) && /他的回复会以他的署名进群/.test(talkSrc)
    && !/forTeam: partner\.targetKind === "team"/.test(ipc) && !/forTeam: partner\.targetKind === "team"/.test(store),
    "群聊通道里每个人自己发进群（⛔ 不再有主理人代转 / 派活身份块）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/parseTeamAuthorId\(id\)/.test(view) && /const nameOf = \(id: string\)/.test(view),
    "视图按合成 id 反查名字（目录没回来就退回 memberId，⛔ 不编名字）");
  /* ⛔⛔ 光让面板"能 @ 到成员"不够 —— 派活必须真的按成员下发，否则又落回整团让主理人代答。
     11-07：合成 id → target 的翻译搬到主进程 `resolveGroupTargets`（渲染层不再自己拼）。 */
  ok(/function resolveGroupTargets/.test(ipc) && /targetKind: "member"/.test(ipc)
    && /targetKey: `\$\{teamId\}:\$\{memberId\}`/.test(ipc),
    "派活把团成员的合成 id 翻成 kind:member + key <teamId>:<memberId>（⛔ 不翻 = 又派给整团）");
  ok(/const targets = \[\.\.\.picked\.filter\(\(m\) => !m\.muted\), \.\.\.virtuals\]/.test(ipc),
    "团成员与普通伙伴一起进 targets（静音规则同样适用）");
  ok(/<li key=\{kid\.key\} className=\{`team-group__member is-kid/.test(view) && /<MemberActions[\s\S]{0,240}?id=\{kidId\}/.test(view),
    "成员栏的团成员行有自己的 @（与伙伴行共用 MemberActions：运行态点 + ⏹️ + @）");
  /* 11-07 审查：成员级 @ 打通后，「追问」仍退回团那一行 ⇒ 同一成员两条路径派给不同对象。 */
  ok(/const teamAuthor = parseTeamAuthorId\(row\.authorId\);[\s\S]{0,160}?setAtTargets\(\[teamAuthor \? row\.authorId/.test(view),
    "「追问」团成员消息时 @ 回他本人（合成 id），⛔ 不退化回整团");
}

/* ── ⑥ 输入框对齐主对话（11-07 用户：「发出去之后输入框还有这个文字」+「同步成跟对话框一样的输入框」）── */
{
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  const ipcDispatch = codeOnly(read("electron/features/harness-team-ipc.ts"));
  /* ⛔⛔ 11-07 用户令：「关闭一下群弹窗，任务就莫名其妙结束了」——
     派活整条链搬进主进程：渲染层发完 IPC 立即返回（消息上屏 → 输入框清空同帧），
     主进程 handler 用 `void dispatchGroupText(...)` 在后台跑完（⛔ 不 await，否则又绑回请求生命周期）。 */
  ok(/const res = \(await window\.codex\.harnessTeamDispatch\(/.test(store)
    && !/invokeAgent\(/.test(store),
    "⛔ 消息上屏即返回：渲染层只发一条 dispatch（不再自己 await 全部回复 ⇒ 清空被推迟几十秒）");
  ok(/void runDispatchRounds\(g, opened\.targets, text, "human"/.test(ipcDispatch)
    && !/await runDispatchRounds\(/.test(ipcDispatch),
    "⛔ 主进程不 await 派活：关面板/切页后任务照跑（产出照进群、互 @ 照接力）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  /* 11-08：派活前多了「运行中的伙伴先进队列」这一跳（idleTargets），清空仍只在**成功之后**。 */
  ok(/const r = await onSend\?\.\(idleTargets, fullBody, params\)[\s\S]{0,260}?setText\(""\)/.test(view)
    && !/onSend\?\.\(idleTargets, fullBody, params\)[\s\S]{0,80}?setText\(""\)[\s\S]{0,200}?if \(r && !r\.ok\)/.test(view),
    "派活成功即清空输入框（主对话口径；失败保留原文 —— ⛔ 清空必须排在校验失败之后）");
  ok(/e\.nativeEvent\.isComposing/.test(view),
    "中文输入法选字期间的 Enter 不误发（否则 IME 会把清空回滚，看着像没清）");
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/onPaste=\{\(e\) => void onPaste\(e\)\}/.test(composer) && /function pastedFilePaths/.test(composer)
    && /readClipboardImage\(\)/.test(composer),
    "粘贴图片 / 文件真落进本轮附件（主对话输入框同款内在功能，⛔ 不是装饰）");
  ok(/const cur = optsRef\.current/.test(composer) && /onOpts\(\{ \.\.\.cur, files:/.test(composer),
    "⛔ 异步落盘后用最新 optsRef（拿闭包旧 opts 会覆盖 await 期间用户加的附件/偏好）");
  ok(/looksLikePath/.test(composer),
    "纯文本只有像绝对路径才认成图片附件（⛔ 别把一句以 .png 结尾的话吞掉）");
  const css = read("src/styles/61-team-mode.css");
  ok(/font-size: 14px;[\s\S]{0,120}?line-height: 1\.6;[\s\S]{0,200}?field-sizing: content/.test(css)
    && /max-height: min\(42vh, 360px\)/.test(css),
    "正文排版与 .composer-editor 同口径（14px/1.6/内容自适应/42vh 上限）");
}

/* ── ⑦ 解散群确认改弹窗（11-07 用户：「删除帮我做成弹窗」）── */
{
  const panel = codeOnly(read("src/features/harness-team/index.tsx"));
  ok(/setDeleteTarget\(\{ id: g\.id, name: g\.name \}\)/.test(panel)
    && /team-sheet__card--confirm/.test(panel)
    && /const confirmDelete = async \(\) =>/.test(panel) && /removeGroup\(target\.id\)/.test(panel),
    "解散群点菜单直接开确认弹窗（取消 / 解散并删除），确认后才真调 removeGroup");
  ok(!/confirmDeleteId/.test(panel) && !/再点一次/.test(panel) && !/is-armed/.test(panel),
    "⛔ 菜单里不再有「再点一次」的内联二次确认（用户要的是弹窗）");
  const css = read("src/styles/61-team-mode.css");
  ok(/\.team-sheet__card--confirm \{[^}]*width: min\(420px/.test(css)
    && /\.team-sheet__foot > button\.is-danger \{[^}]*background: var\(--danger\)/.test(css),
    "确认弹窗是窄卡 + 危险色主按钮（删除类操作一眼可辨）");
}

/* ── ⑧ 成员头像：只给智能体面孔 + 团成员也能改（11-07 用户令）── */
{
  const picker = codeOnly(read("src/features/harness-team/19-team-avatar-picker.tsx"));
  ok(/variant === "user" \?/.test(picker) && /USER_AVATAR_PRESETS\.map/.test(picker)
    && /variant === "agent" && \(/.test(picker) && /TEAM_AVATAR_PRESETS/.test(picker),
    "选择器分两种变体：user 只给用户中心 8 张 / agent 才是智能体面孔（⛔ 两套不串）");
  ok(/variant === "agent" && \([\s\S]{0,200}?上传图片/.test(picker),
    "上传图片只属于智能体变体（用户头像走用户中心，不在群里另存一份）");
  ok(/"子智能体", "CLI 智能体", "Codex"/.test(picker),
    "选择器分三组：子智能体 / CLI 智能体 / Codex");
  const presets = read("src/lib/avatar-presets.ts");
  ok(/export const TEAM_AVATAR_PRESETS/.test(presets) && /codex-/.test(presets)
    && /agentAvatarFaceAt\("subagent"/.test(presets),
    "预设表含 CLI/子智能体图集面孔与 Codex 配色");
  const avatarView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/group\.avatars\?\.\[kidId\]/.test(avatarView) && /memberId: kidId/.test(avatarView),
    "团成员行头像可点改（群级覆盖表 avatars[kidId]）");
  ok(/team-group__members-hint/.test(avatarView) && /点击头像可以修改/.test(avatarView),
    "成员栏标题行有「点击头像可以修改」提示（用户要的那排字）");
  ok(/isBot \? \([\s\S]{0,700}?variant: "agent"/.test(avatarView)
    && /variant: "user"/.test(avatarView) && /is-user is-editable/.test(avatarView),
    "bot 换智能体面孔、人类成员只换用户中心头像（两套头像不串）");
  const avatarComp = codeOnly(read("src/features/harness-team/13-team-avatar.tsx"));
  ok(avatarComp.indexOf("if (isHuman)") > 0 && avatarComp.indexOf("if (isHuman)") < avatarComp.indexOf("const rawAvatar"),
    "人类成员绕过群内头像覆盖，始终走 UserAvatar（用户头像不串智能体那套）");
  const base = createGroup({ id: "g-avatar", name: "头像群", members: [] });
  const withKid = setMemberAvatar(base, "team:t1:kid", "preset:subagent-1");
  const cleared = setMemberAvatar(withKid, "team:t1:kid", "");
  ok(withKid.avatars?.["team:t1:kid"] === "preset:subagent-1" && cleared.avatars?.["team:t1:kid"] === undefined,
    "非群成员（团成员）的头像写/清都走覆盖表（空值 = 恢复默认）");
}

/* ── ⑨ 群聊与主对话同款：输入框把手 / 侧边粗条 / 消息排版（11-07 用户令）── */
{
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/className="composer-resize-handle/.test(composer) && /className="composer-resize-grip/.test(composer)
    && !/team-composer__resize/.test(composer) && !/team-composer__grip/.test(composer)
    && /localStorage\.getItem\("team-composer-height"\)/.test(composer),
    "群输入框的顶部把手**复用主对话的类名与皮肤**（⛔ 不再自己写一套 96×12/56×4 胶囊 —— 那样描边不连边框线）");
  ok(/<ComposerRail app=\{app\}/.test(composer),
    "群输入框左侧复用主对话的 ComposerRail（侧边粗条，⛔ 不另造一条装饰条）");
  ok(/useAnchoredPopover\(/.test(composer) && /team-composer__files-pop/.test(composer) && /ThreadFilePicker/.test(composer)
    && !/team-composer__pane-flyout/.test(codeOnly(composer))
    && /\.team-composer__files-pop \{[^}]*width: min\(360px/.test(read("src/styles/61-team-mode.css")),
    "引用文件面板贴着 + 图标弹（自适应翻上/翻下 + 视口钳制，⛔ 不再以输入卡为锚）");
  /* ⛔⛔ 11-08 用户实测（截图）：「选中一个技能弹窗就关了、没有选中反馈」+「技能弹窗搞这么远干什么」——
     ① 面板必须登记进「点外部才关」的豁免名单（漏登记 ⇒ 点行的 mousedown 被当成外部点击、
        click 之前就被卸载 ⇒ 选中回调根本没跑）；
     ② 位置贴着 + 图标弹（useAnchoredPopover），⛔ 不再是居中弹窗。 */
  ok(/team-skill-dialog__item/.test(composer) && /createPortal\(/.test(composer) && /toggleSkill\(item\)/.test(composer)
    && /skillsPopRef\.current\?\.contains\(target\)/.test(composer)
    && /useAnchoredPopover\(plusView === "skills"/.test(composer)
    && /team-composer__skill-pop/.test(composer)
    && /\.team-composer__skill-pop \{[^}]*width: min\(420px/.test(read("src/styles/61-team-mode.css"))
    && !/team-skill-backdrop/.test(codeOnly(composer))
    && !/team-skill-dialog \{[^}]*width: min\(560px/.test(read("src/styles/61-team-mode.css")),
    "引用技能贴着 + 图标弹、可多选（点行只切换不关窗；面板在点外部豁免名单里，11-08 用户实测）");
  /* ⛔⛔ 11-08 用户令：「弹窗放到 + 号和 @ 图标上面自适应展示」——
     加号菜单贴着 + 图标弹（portal + useAnchoredPopover），⛔ 不再是居中弹窗 / 输入卡上的浮层。 */
  ok(/composer-quick-pop/.test(composer) && /useAnchoredPopover\(plusOpen/.test(composer)
    && /style=\{plusPos \? \{ position: "fixed"/.test(composer)
    && !/team-plus-dialog/.test(codeOnly(composer)),
    "加号菜单贴着 + 图标向上弹（自适应，11-08 用户令）");
  const mentionPanelSrc = codeOnly(read("src/features/harness-team/15-team-mention-panel.tsx"));
  ok(/useAnchoredPopover\(true, anchorRef, rootRef\)/.test(mentionPanelSrc) && /createPortal\(/.test(mentionPanelSrc)
    && /team-mention--pop/.test(mentionPanelSrc)
    && /\.team-mention--pop \{[^}]*position: fixed/.test(read("src/styles/61-team-mode.css")),
    "@ 面板贴着 @ 图标弹（自适应翻上/翻下 + 视口钳制，11-08 用户令）");
  /* ⛔⛔ 11-08 用户令（截图）：「我鼠标点外面要能关掉这个弹窗，还有 Esc，另外一个技能的和 + 号弹窗也是一样的」。 */
  ok(/document\.addEventListener\("pointerdown", onDown, true\)/.test(mentionPanelSrc)
    && /anchorRef\.current\?\.contains\(target\)/.test(mentionPanelSrc)
    && /document\.addEventListener\("keydown", onKey, true\)/.test(mentionPanelSrc),
    "@ 面板：点外部（含输入区）/ Esc 都能关（⛔ 不再只挂搜索框 keydown）");
  ok(/window\.addEventListener\("mousedown", onDown\)/.test(composer)
    && /plusBtnRef\.current\?\.contains\(target\)/.test(composer)
    && /filesPopRef\.current\?\.contains\(target\)/.test(composer),
    "加号菜单 / 文件浮层：点外部即关（触发按钮本身除外，交给它自己 toggle）");
  ok(/if \(!plusOpen && plusView === "main"\) return;[\s\S]{0,420}?document\.addEventListener\("keydown", onKey, true\)/.test(composer),
    "加号菜单 / 技能 / 文件弹层：Esc 只关这一层");
  ok(/onOpenMention=\{\(\) => \(mention\.open \? closeMention\(\) : openMentionPanel\(\)\)\}/.test(codeOnly(read("src/features/harness-team/04-team-group-view.tsx"))),
    "@ 按钮再点一次即收（锚点豁免 + 自身 toggle，不闪）");
  const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
  ok(/<TeamChatOverlay[\s\S]{0,160}?app=\{app\}/.test(appView),
    "宿主把 app 传给群聊浮层（ComposerRail 需要）");
  const teamCss = read("src/styles/61-team-mode.css");
  ok(/\.team-msg\.is-bot \.team-msg__body \{[^}]*background: transparent/.test(teamCss),
    "智能体消息不再套卡片（与主对话正文同形态）");
  ok(/\.team-msg\.is-human \{ flex-direction: row-reverse/.test(teamCss),
    "用户自己的发言靠右（主对话同款）");
  const teamSettings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  ok(/team-settings__layout-cards/.test(teamSettings) && /左右分栏/.test(teamSettings)
    && /全部靠左/.test(teamSettings) && /onMessageLayout/.test(teamSettings),
    "群设置里「消息排版」是两张卡片 + 示例演示，点卡片即时生效");
  const layoutView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/is-layout-left/.test(layoutView) && /\.team-group__stream\.is-layout-left \.team-msg\.is-human/.test(teamCss),
    "视图按选项切换「全部靠左」排版");
  ok(/group\.messageLayout \?\? "split"/.test(layoutView) && !/team-message-layout::/.test(layoutView)
    && /onSetMessageLayout/.test(layoutView),
    "消息排版落群 JSON（⛔ 不再只存 localStorage；换设备也保留）");
  const storeLayout = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  ok(/harnessTeamSetMessageLayout/.test(storeLayout), "store 接线 harnessTeamSetMessageLayout（主进程落盘）");
  ok(/team-group__badge/.test(layoutView) && /team-group__empty-icon/.test(layoutView)
    && /team-group__members-head/.test(teamCss),
    "群头有群徽标、空态有图标、成员栏标题有分隔（11-07 美化）");
  const quoteView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/team-process__quote-author/.test(quoteView) && /faceOfId\(quote\.authorId\)/.test(quoteView),
    "引用行里「回复某人」带头像 + 名字（真实提及，⛔ 不只是纯文字）");
}

/* ── ⑪ 群里就地弹「询问 / 审批」+ 发送键 morph 成停止键（11-08 用户两条令）──────
   ① 「询问，审批，计划，等等全部跟对话框一样就行，不要重复造轮子」+「要完全一样」
      ⇒ 群里必须能回答伙伴的询问/审批（以前只能干等）；卡片本体**复用**主对话那两件。
   ② 「群运行中的，发送按键过渡成⏹️，这里点停止是群里所有运行状态都停止掉」
      ⇒ 一个按钮 morph（⛔ 不是两个按钮切换）、点一下全群停。 */
{
  const cards = codeOnly(read("src/features/harness-team/22-team-pending-cards.tsx"));
  ok(/from "\.\.\/app-view\/helpers"/.test(cards) && /RequestCard/.test(cards)
    && /03-agent-ask-card/.test(cards) && /AgentAskCard/.test(cards),
    "群里的询问/审批卡**复用主对话的 RequestCard / AgentAskCard**（⛔ 不另写一套卡）");
  ok(/app\.pending \?\? \[\]/.test(cards) && /ids\.has\(String\(request\.params\?\.threadId/.test(cards)
    && /app\.agentAsk && ids\.has\(app\.agentAsk\.threadId\)/.test(cards),
    "归属按会话 id 过滤（伙伴的询问只落在群里；⛔ 拿全局 pending 会把别的会话的卡一起弹上来）");
  ok(/window\.codex\.respond|onDone=/.test(cards) && /\.\.\.\/app-state/.test(cards) === false || /import type \{ HarnessAppApi \}/.test(cards),
    "回包仍走卡片自己那条通道（window.codex.respond），app 只用来读写 pending/agentAsk");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/<TeamPendingCards app=\{app\} threadIds=\{agentThreadIds\} \/>/.test(view)
    && /const agentThreadIds = useMemo\(/.test(view)
    && /for \(const run of live \?\? \[\]\) if \(run\.threadId\) ids\.add/.test(view)
    && /for \(const row of rows\) if \(row\.threadId\) ids\.add/.test(view),
    "群视图把「本群出现过的会话 id」交给卡片区（正在跑的 ∪ 群消息来源；⛔ 只用 live 会让卡在回合结束时闪掉）");
  const css = read("src/styles/61-team-mode.css");
  ok(/\.team-group__overlay-stack \{[\s\S]{0,220}?position: absolute;/.test(css)
    && /\.team-group__overlay-stack \{[\s\S]{0,260}?bottom: calc\(100% - 6px\);/.test(css)
    && /\.team-group__overlay-stack \{[\s\S]{0,360}?padding-inline: max\(14px, calc\(\(100% - var\(--team-column\)\) \/ 2\)\);/.test(css)
    && /\.team-group__composer \{[\s\S]{0,400}?position: relative;/.test(css),
    "卡片区绝对定位在输入卡**正上方**、与输入卡同一条轴（主对话 composer-overlay-stack 同定位；⛔ 不挤走消息流）");

  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/const showStop = Boolean\(running\) && !hasDraft;/.test(composer)
    && /className=\{`send-button morph-action \$\{showStop \? "is-pause" : "is-send"\}`\}/.test(composer)
    && /onClick=\{showStop \? onStop : onSend\}/.test(composer),
    "运行中发送键**同一个节点** morph 成停止键（主对话同口径：空草稿=停止 / 有草稿=发送；⛔ 别用两个按钮切换）");
  ok(/<Square size=\{15\} fill="currentColor" \/>/.test(composer) && /<Spinner \/>/.test(composer),
    "停止图腾 ⏹（实心方块）+ 停止中转圈（用户点名的那个样子）");
  ok(/running=\{groupRunning\}/.test(view) && /onStop=\{\(\) => void stopEverything\(\)\}/.test(view)
    && /onStopAll\(agentThreadIds\)/.test(view),
    "视图把「有人在跑」与「停全部」接到输入框（候选 = 群内会话 id）");
  ok(/const stopAll = useCallback\(/.test(codeOnly(read("src/features/harness-team/02-team-store.ts")))
    && /harnessTeamStop\(\{ threadIds: candidates, stopAll: true \}\)/.test(codeOnly(read("src/features/harness-team/02-team-store.ts")))
    && /onStopAll=\{\(threadIds\) => stopAll\(active\.id, threadIds\)\}/.test(codeOnly(read("src/features/harness-team/index.tsx"))),
    "store 发 `stopAll: true` 并接线到面板（成功即清 busy/live，⛔ 不等引擎回包 —— 否则按钮一直停在停止上）");
  const stopSvc = codeOnly(read("electron/features/harness-team-stop.ts"));
  ok(/if \(input\?\.stopAll === true\)/.test(stopSvc)
    && /const hits = \[\.\.\.engineActiveTurnIds\]\.filter\(\(\[, owner\]\) => list\.includes\(owner\)\)/.test(stopSvc)
    && /for \(const \[turnId, owner\] of hits\)/.test(stopSvc),
    "主进程全群停：遍历活动回合表，只中断**候选列表里**那些会话（⛔ 不碰主对话/别的群）");
  ok(/stopTeamRuns\(input as TeamStopInput\)/.test(read("electron/features/harness-team-ipc.ts"))
    && /export async function stopTeamRuns/.test(stopSvc),
    "通道实现抽到 `harness-team-stop.ts`（ipc 注册宿主已到巨型文件棘轮上限，⛔ 别再往里塞逻辑）");
}

/* ── ⑫ 排队消息 / 插队消息 / 办公室预览（11-08 用户令）─────────────────────────
   「排队消息，插队消息，看看跟主对话框还差哪些，没同步过来，都完成一下」
   「还有办公室预览接进来」 */
{
  const queue = codeOnly(read("src/features/harness-team/23-team-queue.tsx"));
  ok(/from "\.\.\/session-queue"/.test(queue) && /<QueuedMessageList/.test(queue),
    "排队消息卡片**复用主对话那一张**（QueuedMessageList：折叠/拖排序/定时/编辑/立即/删除全同一套，⛔ 不另造）");
  ok(/thread\/queue\/add/.test(queue) && /thread\/queue\/list/.test(queue) && /thread\/queue\/delete/.test(queue)
    && /thread\/queue\/reorder/.test(queue),
    "载体是**引擎队列**（thread/queue/*）：每个伙伴各跑各的子会话，队列天然按 threadId 分开");
  ok(/harnessTeamQueueStart\(\{ threadId: target, queuedSubmissionId: id \}\)/.test(queue),
    "「立即」走主进程 `harness-team:queue-start`（⛔ 渲染层拼不出 expectedTurnId，猜错就是 no active turn to steer）");
  ok(/const byThread = useMemo/.test(queue) && /team-queue__who/.test(queue),
    "按成员分组展示（同一条队列卡里混着两个伙伴 = 分不清谁的消息）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  /* 11-08 用户实测：「前面怎么还自动多一个 @软件开发专家团」——
     根因是 `atTargets` 发完没清：上一轮 @ 的伙伴一直挂着，下一轮只 @ 了承枢，
     实际把整团也一起派了，正文还被 `withMentionPrefix` 补了一句 `@软件开发专家团`。
     ⛔ 判据：派活成功 / 全部进队列这两条路径都要清，换群也要清。 */
  ok((view.match(/setAtTargets\(\[\]\)/g) || []).length >= 4,
    "本轮 @ 必须在发完（派活 + 队列两条路径）与换群时清空 —— ⛔ 否则下一轮会偷偷带上上一轮的目标，正文还会被补 `@名字`");
  ok(/setText\(""\);[\s\S]{0,160}?setAtTargets\(\[\]\);/.test(view),
    "清 @ 与清正文在同一处（用户看到的就是「发出去、输入区归零」）");
  ok(/<TeamQueueStack/.test(view) && /queueTeamMessage\(entry\.run\.threadId, fullBody\)/.test(view)
    && /const idleTargets = atTargets\.filter/.test(view),
    "运行中的伙伴走**队列**、空闲的仍走派活（⛔ 对运行中的会话 turn/start 会被主进程拒，等于消息发不出去）");
  const mainQueue = codeOnly(read("electron/features/harness-team-queue.ts"));
  ok(/turn\/steer/.test(mainQueue) && /thread\/queue\/delete/.test(mainQueue) && /thread\/queue\/start/.test(mainQueue),
    "插队 = steer 进正在跑的回合，**并入后删掉队列那条**（不删的话回合结束会再执行一遍）；插不了退回按新回合启动");
  ok(/engineActiveTurnIds/.test(mainQueue), "expectedTurnId 取自主进程活动回合表（唯一真相，⛔ 不让渲染层猜）");

  const office = codeOnly(read("src/features/harness-team/24-team-office-preview.tsx"));
  ok(/OfficeRailNode/.test(office) && /TeamOfficePreview/.test(office),
    "办公室预览**入口节点与整屏预览都复用**主对话那两件（⛔ 不另画一个办公室）");
  ok(/teamId=\{group\.id\}/.test(office) && !/teamId=\{null\}/.test(office),
    "预览必须拿到**真 id**：TeamOfficePreview 开头是 `if (!teamId) return null`（⛔ 传 null 就是什么都画不出来 —— 本轮真踩过）");
  ok(/status: running\.has\(member\.id\) \? "busy" : "idle"/.test(office),
    "工位状态只认运行态（live/busy），⛔ 不按静态角色编状态");
  ok(/<TeamOfficeEntry group=\{group\} live=\{live\} busy=\{busy\} onOpenThread=\{onOpenThread\} \/>/.test(view)
    && /\.team-group__office \{[\s\S]{0,160}?margin-top: auto;/.test(read("src/styles/61-team-mode.css")),
    "入口钉在成员栏**末位**（与中枢群成员轨同一位置语义；⛔ 不跟着成员列表往下挤）");
}

/* ── ⑬ 两种回复模式（11-08 用户令：「做出来两种回复模式」+「在群设置里加上这个选项」）────
   过程模式：运行中展示运行过程（默认折叠、可展开，与主对话同一套折叠块），跑完过程消失只留汇报；
   占位模式：不展示过程/流式正文，只挂「图标 + 名字 + 处理中」，产出后再上屏。 */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const proc = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
  const settings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  /* 11-08 二改：过程/占位反馈统一搬到用户气泡下面（26-team-run-feedback），
     ⛔ 不再挂在 live 流式卡里（独立窗口 live 常年为空 ⇒ 两种模式"完全一样"）。 */
  ok(/<TeamRunFeedback/.test(view) && /row\.key === lastHumanKey/.test(view)
    && /<TeamProcess/.test(codeOnly(read("src/features/harness-team/26-team-run-feedback.tsx"))),
    "过程块只在**运行中的最后一条用户消息下面**渲（跑完 busy 清空即消失，⛔ 成品消息不挂过程）");
  ok(!/isBot && row\.kind !== "card" && \(\s*<TeamProcess/.test(view),
    "⛔ 成品消息里不许再出现过程块（用户：「运行结束后，运行过程隐藏掉，只留最后汇报」）");
  ok(/live?: boolean/.test(proc) || /live = false/.test(proc),
    "过程块支持运行中实时（回合还没落盘 ⇒ 取最新回合 + 2.5s 重拉，⛔ 缓存会把新步骤挡在外面）");
  ok(/team-run-feedback__chip/.test(codeOnly(read("src/features/harness-team/26-team-run-feedback.tsx")))
    && /team-run-feedback__chip/.test(read("src/styles/61-team-mode.css")),
    "占位模式画飞书式「头像 + 名字 + 处理中」小图标（挂在用户气泡下面）");
  ok(/replyMode: "process" \| "placeholder";/.test(settings) && /回复模式/.test(settings)
    && /onReplyMode\(opt\.value\)/.test(settings),
    "群设置里有「回复模式」两张卡（过程 / 占位），点卡片立即生效");
  ok(/normalizeReplyMode/.test(read("src/lib/team-models.mjs"))
    && /harness-team:set-reply-mode/.test(read("electron/features/harness-team-ipc.ts"))
    && /harnessTeamSetReplyMode/.test(read("electron/preload.ts")),
    "回复模式落群 JSON（通道 + 归一化齐；⛔ 不存 localStorage）");
  /* ⛔⛔ 11-08 审查：群输入框的「模型 / 完全访问 / 审批档」原来在 IPC 只接了 effort、其余直接丢弃，
     而建会话又恒写 workspace-write / never ⇒ 三个控件全是死的（选了也不生效）。
     同轮审查还发现：派活中「清空聊天记录」，跑完的回复会照写回空群（11-06 修过，派活搬进主进程后回归）。 */
  {
    const ipcSrc = codeOnly(read("electron/features/harness-team-ipc.ts"));
    const channelSrc = codeOnly(read("electron/features/group-talk/01-channel.ts"));
    ok(/params\.model \? \{ model: params\.model \}/.test(ipcSrc)
      && /params\.sandbox \? \{ sandbox: params\.sandbox \}/.test(ipcSrc)
      && /params\.approvalPolicy \? \{ approvalPolicy: params\.approvalPolicy \}/.test(ipcSrc)
      && /sandbox: options\.sandbox \|\| "workspace-write"/.test(channelSrc)
      && /options\.model \? \{ model: options\.model \}/.test(channelSrc)
      && /options\.approvalPolicy \? \{ approvalPolicy: options\.approvalPolicy \}/.test(channelSrc),
      "群输入框的模型 / 沙箱 / 审批档真下发到成员会话（⛔ 不再是只接 effort 的死控件，11-08 审查）");
    ok(/groupClearedAt\.set\(gid, Date\.now\(\)\)/.test(ipcSrc)
      && /const clearedMark = groupClearedAt\.get\(group\.id\)/.test(ipcSrc)
      && /clearedDuringRun \? \{ ok: true \}/.test(ipcSrc),
      "清空聊天记录后，在飞回合的回复不再写回空群（主进程代际判定，11-08 审查）");
  }
}

/* ── ⑭ 群成员共享群会话内容（11-08 用户问：「群成员，都能看到群会话内容吗」）────────
   改之前：每位成员只拿到「当前这一句 + 名册 + 群简介」，历史**不注入**，
   只有模型主动调 group_read 才能读 12 条 ⇒ 别人之间没 @ 它的对话它一概看不见，接不上话。
   改之后：最近 20 条默认注入**每一轮**（每一跳重读），所有成员拿到同一份共享上下文。
   ⛔ 两条硬约束：历史必须在 SYSTEM TASK 壳的 `=== END ===` **之后**（否则会糊进气泡），
      且必须用 `【群聊上下文 · …】…【群聊上下文结束】` 信封（四处剥离器按它剥）。 */
{
  const talk = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const outlet = codeOnly(read("electron/features/group-talk/index.ts"));
  ok(/export const TALK_HISTORY_LIMIT = 20;/.test(talk) && /export function groupHistoryBlock/.test(talk)
    && /TALK_HISTORY_CHAR_MAX = 400/.test(talk) && /TALK_HISTORY_TOTAL_MAX = 8000/.test(talk),
    "共享上下文是**有界**的：最近 20 条 / 每条 400 字 / 总量 8000 字（⛔ 不裁剪会把整本群日志每轮重复喂进去）");
  ok(/【群聊上下文 · 群里最近的消息】/.test(talk) && /【群聊上下文结束】/.test(talk),
    "用项目统一的 `【群聊上下文 · …】` 信封：harness-block-strip / cloud-sync / memory-lessons / thread-backup 四处按它剥离");
  ok(/groupHistoryBlock\(history, text\)/.test(talk)
    && talk.indexOf('"=== END ==="') < talk.indexOf("groupHistoryBlock(history, text)"),
    "历史放在 `=== END ===` **之后**（壳后）：user-refs 只保留需求体 ⇒ 气泡仍只有那一句人话");
  /* ⛔⛔ 11-08 Code review 抓到的真缺陷：原先按时间正序累加、超预算 break ⇒ 丢掉的是
     **最新**那几条（与"接上话"目标相反）。判据：必须从最新往旧累加 + 末尾反转回正序。 */
  ok(/for \(let i = recent\.length - 1; i >= 0; i -= 1\)/.test(talk) && /picked\.reverse\(\);/.test(talk)
    && /if \(used \+ line\.length > TALK_HISTORY_TOTAL_MAX\) break;/.test(talk),
    "共享上下文超预算时**丢最旧、留最新**（⛔ 正序累加会丢掉最新那几句，成员更接不上话）");
  ok(/text === current/.test(talk),
    "本轮这句已在需求体里，历史里不再重复贴一遍（⛔ 否则模型以为要回两次）");
  ok(/buildTalkInput\(options: GroupTalkOptions, me: TalkMember, from: TalkMember, text: string, history: TalkHistoryRow\[\] = \[\]\)/.test(talk),
    "注入是 buildTalkInput 的第 5 个参数（两条投递链共用同一份口径）");
  ok(/const history = await options\.readMessages\(TALK_HISTORY_LIMIT\)/.test(talk)
    && /buildTalkInput\(options, target, from, text, history\)/.test(talk),
    "runGroupTalk 每一跳都重读群日志（接力到第 2 个人时前一位的话已落群）");
  ok(/readGroupHistory\(TALK_HISTORY_LIMIT\)/.test(ipc)
    && /readMessages: \(limit: number\) => Promise\.resolve\(readGroupHistory\(limit\)\)/.test(ipc),
    "派活主链每轮也注入；默认注入与 group_read 工具**同一份** readGroupHistory（⛔ 两处口径分叉会读到不同历史）");
  ok(/TALK_HISTORY_LIMIT/.test(outlet) && /groupHistoryBlock/.test(outlet),
    "板块出口显式暴露共享上下文（守卫可钉唯一真相源）");
  /* ⛔ 负向：不许把历史塞进需求体、不许删掉 group_read */
  const needBody = (talk.match(/=== 用户需求 ===[\s\S]*?"=== END ==="/) ?? [])[0] ?? "";
  ok(!/groupHistoryBlock/.test(needBody), "⛔ 历史不许进需求体（会直接糊到气泡上）");
  ok(/group_read/.test(codeOnly(read("electron/features/group-talk/02-tools.ts"))),
    "group_read 保留：默认给最近 20 条，更早的由模型自己调工具取");
}

/* ── ⑯ 引用归属 / 主代理人名 / 话题消息（11-08 用户四条令）────────────────── */
{
  const fold = codeOnly(read("src/lib/team-fold.mjs"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const settings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  const topic = codeOnly(read("src/features/harness-team/25-team-topic.tsx"));
  const idx = codeOnly(read("src/features/harness-team/index.tsx"));
  ok(/const viaId = String\(r\?\.via\?\.memberId/.test(fold) && /lastByAuthor\.get\(viaId\)/.test(fold),
    "⛔ 引用行「回复谁就引谁」：带 via 引叫它来的那位伙伴（⛔ 不再一律引最近一条人类消息）");
  ok(/teamLeadOf\(m\)\?\.name \|\| m\?\.name/.test(view)
    && /name: String\(lead\?\.name \|\| m\.name/.test(codeOnly(read("src/lib/team-mention.mjs"))),
    "专家团主代理人显示**人名**（用户：「显示软件开发专家团看着别扭」）；selectId 仍指整团");
  ok(/replyMode=\{active\.replyMode/.test(idx) && /effectiveReplyMode = replyMode \?\?/.test(view),
    "⛔ 回复模式必须同时传读值（只传写入回调 ⇒ 点占位模式写进盘但界面不动，用户「选不了，点不过来」）");
  /* ⛔ 用**顺序**判定而不是"相隔多少字符"：板块长度会随文案变化，写死窗口会假红。 */
  const sectionOrder = [...settings.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]).join(">");
  ok(/^layout>message-form>partners>quick-menu>memory>/.test(sectionOrder),
    "群设置常用置顶：消息排版 → 群消息形式 → 伙伴 → 快捷指令 → 群记忆…（低频项下沉）");
  ok(/export function normalizeMessageForm/.test(read("src/lib/team-models.mjs"))
    && /harness-team:set-message-form/.test(read("electron/features/harness-team-ipc.ts"))
    && /harnessTeamSetMessageForm/.test(read("electron/preload.ts")),
    "群消息形式是**独立枚举 + 独立通道**（⛔ 不再挤在 replyMode 三态里）");
  ok(/data-section="message-form"/.test(settings) && /label: "话题消息"/.test(settings)
    && /label: "对话消息"/.test(settings), "独立的「群消息形式」板块：对话消息 / 话题消息 两张卡");
  ok(/export function buildTopicThreads/.test(fold) && /buildTopicThreads\(rows\)/.test(view),
    "话题分组走纯函数（用户气泡里更新，⛔ 视图不自己写循环）");
  ok(/effectiveMessageForm === "topic" && isBot\) return null/.test(view)
    && /TeamTopicBadge/.test(view) && /team-msg__topic/.test(read("src/styles/61-team-mode.css")),
    "话题模式：主流只留用户消息，伙伴回复收进气泡里的话题条");
  ok(/export function TeamTopicPreview/.test(topic) && /useEscapeLayer\(true, onClose\)/.test(topic)
    && /pointerdown/.test(topic),
    "点击话题条弹窗预览完整话题串；ESC 走全局栈 + 点遮罩关闭（⛔ 不自己挂 window keydown）");
  ok(/test\("buildTopicThreads/.test(read("tests/team-fold.test.mjs")),
    "话题分组有单测真值表");
}

/* ── 11-08 审查修正：跨群自愈隔离 / 艾特判重窗口 / 信封消毒 / 占位模式流式正文 / 停止复位 ── */
{
  const channelSrc = read("electron/features/group-talk/01-channel.ts");
  const ipcSrc = read("electron/features/harness-team-ipc.ts");
  const talkSrc = read("electron/features/group-talk/03-talk.ts");
  const viewSrc = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const storeSrc = read("src/features/harness-team/02-team-store.ts");
  (channelSrc.match(/String\(k\.split\("::"\)\[0\] \?\? ""\) (!==|===) String\(groupId\)/g) ?? []).length >= 2
    ? ok(true, "群聊会话台账自愈/认领只在本群内进行（⛔ 跨群同名成员会互删台账、串话）")
    : ok(false, "群聊会话台账自愈/认领只在本群内进行（⛔ 跨群同名成员会互删台账、串话）");
  ok(/Number\(\(row as \{ at\?: unknown \}\)\?\.at \?\? 0\) >= startedAt/.test(ipcSrc),
    "群内艾特判重只看**本轮开始之后**（⛔ 旧窗口含本轮前 60s = 上一轮说过话的成员被静默跳过）");
  ok(/export function sanitizeForEnvelope/.test(talkSrc) && /群聊上下文\\u200b/.test(talkSrc)
    && /sanitizeForEnvelope\(text\)/.test(talkSrc),
    "群消息原文进信封前消毒（⛔ 正文带【群聊上下文结束】/ 行首 --- 会把信封提前截断、指令漏进云同步/记忆）");
  ok(/(?:effectiveReplyMode|replyMode) === "process" && String\(run\.text \?\? ""\)\.trim\(\)/.test(viewSrc),
    "占位模式不显示流式正文（流式卡跟着回复模式分叉）");
  ok(/res\?\.ok \|\| res\?\.reason === "idle"/.test(storeSrc),
    "停止返回 idle 也复位 busy/live（⛔ 原来只在 ok 时清，停止键会卡死）");
}

console.log(`\n【team-chat-ux】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
