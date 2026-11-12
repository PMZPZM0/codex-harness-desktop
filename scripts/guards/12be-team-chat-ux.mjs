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
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyMention, matchMentionCandidates, mentionSectionsOf, mentionTargetsInText, mentionTriggerOf } from "../../src/lib/team-mention.mjs";
import { searchGroupRows } from "../../src/lib/team-search.mjs";
import { createGroup, setMemberAvatar, talkPartnerIdentity } from "../../src/lib/team-models.mjs";
import { pickAgentAvatar } from "../../src/lib/agent-avatars.mjs";
import { normalizeSessionKind, ownsHostToolSurface } from "../../src/lib/session-kind.mjs";

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
  /* ⛔⛔ 11-08 用户（截图）：「手动输入 @ 选中后，输入框里也有 @、输入框上面也有 @」——
     要求全部收进输入框、框上不再展示 ⇒ 删掉「本轮 @」chip 行，@ 的唯一真相源改成正文。 */
  ok(/mentionTargetsInText\(text\.replace\([\s\S]{0,80}?\), mentionCandidatesFlat\)/.test(view)
    && /removeMentionsFromText\(prev, \[item\.name\]\)/.test(view)
    && !/team-group__selected/.test(view) && !/setAtTargets\(/.test(view),
    "⛔ 「本轮 @」chip 行已删：选人只往正文插 `@名字 `，发消息时从正文反查目标（单一真相源）"
  );
  ok(!/team-group__selected/.test(read("src/styles/61-team-mode.css")),
    "已选 @ chip 的样式也删净（只删 JSX 会留下看起来还在的类）"
  );
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
  /* ⛔ 11-09：胶囊抽成 `TeamMentionChip`（Markdown 作用域与正文共用同一枚），
     尺寸变成 props（默认 16）⇒ 判据看组件本体，不再找写死的 `size={16}` 字面量。 */
  ok(/mentionIdOfHref\(href\)/.test(atText)
    && /export function TeamMentionChip/.test(atText)
    && /<MemberAvatar member=\{faceOfId\(id\)\} size=\{size\}/.test(atText)
    && /size = 16/.test(atText)
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
    /* ⛔ 11-09：引用抽成 `TeamQuoteBlock`（类名搬进组件内）⇒ 判据看**组件调用在气泡里**。 */
    && /<div className="team-msg__body">[\s\S]{0,1600}?<TeamQuoteBlock/.test(view),
    "⛔ 名字那一行移出气泡（main 列容器），引用仍留在气泡里");
  /* ⛔⛔ 11-09 用户截图「竖条位置一会这里一会正常」：几何规则**不再挂在 .team-msg__body 作用域**
     （换宿主就退回基础样式，正是位置跳变的根因）⇒ 判据同步改成全局一套 + flex/fit-content。 */
  ok(/\.team-msg__main \{[\s\S]{0,220}?flex-direction: column/.test(css)
    && /\.team-process__quote--top \{[\s\S]{0,400}?display: flex/.test(css)
    && /\.team-process__quote--top \{[\s\S]{0,400}?width: fit-content/.test(css)
    && /\.team-process__quote--top \{[^}]*margin: 2px 0 8px -8px/.test(css)
    && /\.team-process__quote--top \{[^}]*background: none/.test(css)
    && !/\.team-msg__body \.team-process__quote--top/.test(css)
    && /\.team-process__quote--top > \.team-process__quote-bar \{[^}]*position: absolute/.test(css),
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
    && /setTeamGroupAppender\(\(gid, entry, since\) =>[\s\S]{0,220}?appendMessageTo\(gid, entry\)/.test(ipcHost),
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
    && /dynamicTools: surface \?\? buildGroupTalkTools\(\)/.test(chan)
    /* ⛔ 11-11：团群主理人要挂真调度工具 ⇒ 新建走 surface，老会话**必须**在 resume 前改写首行
       （附录 Z：resume 传 dynamicTools 引擎整份忽略）。两条缺一，老群聊会话的工具面永远升不上去。 */
    && /await syncToolSurfaceAsync\(codexHome, threadId, options\.tools\)/.test(chan),
    "群聊每人一条长期引擎会话（thread/start 挂自己的工具，resume 复用；老会话按附录 Z 升级工具面）");
  ok(!/runDelegatedTask|delegateRegistry|canDispatchFrom|delegateScopeBlock/.test(chan + tools + talk),
    "⛔ 独立通道一行都不碰外面的调度链（不是改提示词糊弄）");
  ok(/group_say/.test(tools) && /group_read/.test(tools) && /group_members/.test(tools)
    && /export async function handleGroupTalkToolCall/.test(tools)
    && /export function attachGroupTalkEvents/.test(tools),
    "工具三件套 + 主进程应答（群聊会话的事件会被 filterForRenderer 裁掉）");
  ok(/lookupGroupThread\(/.test(tools),
    "工具身份只认引擎下发的 threadId（⛔ 不许模型自报群 id / 成员 id）");
  /* ⛔ 11-11：团群主理人真拿到 team_member_invoke 之后，它那一份输入**必须**允许出现派活口径
     （输入 / 交付物 / 交给谁）—— 但那份口径只能由 `me.dispatchTools` 守门：
     ⛔ 没挂工具的人（普通成员 / 普通群）看到的仍然是「别调任何调度工具」。 */
  ok(/export function buildTalkInput/.test(talk) && /@名字：你要说的话/.test(talk)
    && !/结论、依据、建议|请给结论/.test(talk)
    && /Array\.isArray\(me\.dispatchTools\)/.test(talk)
    && /别调任何调度工具/.test(talk),
    "群聊输入是「有人对你说了一句」，⛔ 不是任务派发模板（派活口径只给真拿到团队工具的主理人）");
  /* ⛔⛔ 11-11 用户令（原话：「群聊会话仍然拿不到 team_member_invoke，主理人还是靠行首 @名字：派活」）：
     团群里主理人必须拿到**真的**调度工具。四件缺一就退化成「行首 @ 演戏」：
     ① 建会话接受额外工具面（01-channel）；② 给主理人时真的传了团队工具（harness-team-ipc）；
     ③ 主理人会话落团队归属（执行端只认 teamRunStore）；④ 主进程认得群聊会话的 team_member_invoke
     （渲染层没有它的团队归属，会以「没有团」失败）。 */
  {
    const fallback = codeOnly(read("electron/team-tool-fallback.ts"));
    const boot = codeOnly(read("electron/features/boot.ts"));
    ok(/extraTools\?: unknown\[\]/.test(chan)
      && /buildTeamTools\(groupTeam\)/.test(dispatch) && /leadDispatchTools/.test(dispatch)
      && /partnerTools\.length \? \{ extraTools: partnerTools \}/.test(dispatch)
      && /teamRunStore\.setThreadLead\(tid\)/.test(dispatch)
      && /isGroupTalkThread/.test(fallback) && /isGroupTalkThread: \(tid\) => talkThreadIds\.has/.test(boot),
      "团群主理人拿到真调度工具（工具面 + 归属登记 + 执行端认群聊会话）");
    /* ⛔⛔ 11-11：主理人还要拿到**宿主能力网关**（知识库 / 定时任务 / 文件 / 记忆）——
       执行端权限早就按 dispatchOnly 定好（scheduler_save / knowledge_add 对群聊会话放行），
       缺的只是工具面这根线。⛔ 成员不给（每个成员都放开写知识库 = 权限面失控），
       而且文案必须按 `me.harnessGateway` 分叉：没挂的人要说"定时任务不在这儿建"。 */
    /* ⛔ 11-12：工具面里现在还插了 team_plan / team_status ⇒ 判据改为"同一处 withStepParam 里
       同时含调度两件 + 能力网关"（⛔ 不再逐字匹配整行数组，否则每加一个工具就红一次）。 */
    ok(/buildDelegateHarnessTool/.test(dispatch)
      && /withStepParam\(\[buildTeamTools\(groupTeam\)/.test(dispatch)
      && /buildTeamPhaseTool\(groupTeam\)/.test(dispatch)
      && /buildDelegateHarnessTool\(\)/.test(dispatch)
      && /harness_tools/.test(dispatch)
      && /harnessGateway: true/.test(dispatch)
      && /me\.harnessGateway/.test(talk) && /定时任务不在你这儿建/.test(talk),
      "团群主理人拿到宿主能力网关；没拿到的会话被明确告知定时任务该交给谁");
    /* ⛔⛔ 11-11 用户令（「@整团 复用主理人那条，只保留一个承枢」）：
       整团槽 `tgt:team:<团>` 只是派活入口，真正说话的是主理人 ⇒ 会话身份必须归一到合成 id。
       ⛔ 判据是**四处都传了**（探测 / 建 / 回合 / 串行键）—— 少一处就分叉成两条会话
       （漏串行键还会并发 resume 同一条，引擎报 busy）。 */
    ok(/const talkAs = isLeadSeat && leadAuthorId \? leadAuthorId : "";/.test(dispatch)
      && /talkAs \|\| partner\.id, async/.test(dispatch)
      && (dispatch.match(/\.\.\.\(talkAs \? \{ talkAs \} : \{\}\)/g) || []).length >= 3,
      "会话身份归一：@整团 与 @主理人打同一条会话（探测/建/回合/串行键四处都传）");
    /* ⛔⛔ 老数据里两条会话都真实存在过 ⇒ 启动时必须**合并台账**，否则用户仍看到两个发言人。
       ⛔ 被弃置的那条只**归档**（archivable），⛔ 不删除 —— rollout 是用户的记录。 */
    ok(/adoptTalkThreadAlias\(group\.id, leadKey, slotId\)/.test(dispatch)
      && /thread\/archive/.test(dispatch) && !/thread\/delete[\s\S]{0,200}adopted\.dropped/.test(dispatch)
      && /const key = talkKey\(groupId, String\(options\.talkAs \?\? ""\)\.trim\(\) \|\| String\(member\.id\)\)/.test(chan)
      && /export async function adoptTalkThreadAlias/.test(chan),
      "主理人双会话合并：整团槽台账并入合成 id（弃置那条只归档，⛔ 不删用户记录）");
    /* ⛔⛔ 11-11 真机（一句「在呢」回了两条，第二条 via 指向它自己）：@整团 与 @主理人是
       **同一张椅子、两个 id** —— 判「是不是同一个人」必须按椅子，⛔ 不能按 id 字符串。
       这两处负向断言防的是"把必回喂/催办改回字符串比较"（那会让主理人把自己当成成员回喂自己）。 */
    ok(/const sameSeat = \(a: string, b: string\) =>/.test(dispatch)
      && /sameSeat\(admin\.id, partner\.id\)/.test(dispatch)
      && !/String\(admin\.id\) !== String\(partner\.id\)/.test(dispatch)
      && !/String\(admin\.id\) === String\(partner\.id\)/.test(dispatch),
      "团群里「同一个人」按椅子判（@整团 与 @主理人 同座），⛔ 不按 id 字符串（否则自己回喂自己）");
    /* ⛔⛔ 11-11 用户令（「一直卡着空转」）：群聊里 team_member_invoke / team_phase_invoke
       原来是**同步等成员跑完**（3~5 分钟）⇒ 主理人那张卡一直挂着，用户只能判定卡死。
       改异步排片后四件缺一就退回老问题 / 产出没人接：
       ① fallback 群聊分支立即 respond + 后台并发跑；② 桥接 relay + 注入（走群聊串行队列）；
       ③ 工具 schema 描述按群聊覆写（否则模型以为结论已返回，直接收口 / 重派）；
       ④ 提示词改异步口径。⛔ 负向：独立团会话的同步返回链必须还在。 */
    const bridge = codeOnly(read("electron/team-group-bridge.ts"));
    ok(/if \(groupTalk\) \{/.test(fallback)
      && /\[已派单\]/.test(fallback)
      && /text: ack \}\], success: true/.test(fallback)
      && /void \(async \(\) => \{/.test(fallback)
      && /relayGroupLead\(gid, teamId,/.test(fallback)
      && /Promise\.allSettled\(tasks\.map/.test(fallback),
      "群聊团队工具异步排片：立刻回已派单 + 后台并发跑成员 + 完成后回喂主理人");
    /* ⛔⛔ 11-12 真机（群消息实证）：同一成员在 21:20 / 21:21 连续三次收到同一份任务，
       它自己都回「这是第三次收到同一份任务派发」—— 主理人被催办/回喂后重派。
       ⇒ 群聊派活必须有**短时幂等**：同 team + 同 member + 同正文 10 分钟内只起一次 turn，
         重复那次只回执；失败的不缓存（允许重试）。 */
    ok(/const recentDispatch = new Map/.test(fallback)
      && /DISPATCH_DEDUPE_MS/.test(fallback)
      && /const fresh = tasks\.filter/.test(fallback)
      && /\[已派过\]/.test(fallback)
      && /entry\.status === "rejected"[\s\S]{0,120}recentDispatch\.delete/.test(fallback),
      "群聊派活短时幂等：同一件活 10 分钟内不重复起 turn（⛔ 失败的那次仍允许重派）");
    /* ⛔⛔ 11-12 用户截图「看不懂」：群里 4 条派单长得一模一样、正文全空。
       根因是**宿主写的派活交接**（`team-dispatch:<runId>`）被当成成员回合交给 TurnView ——
       TurnView 按 threadId + at 去引擎回合取正文，交接那句话不在回合里 ⇒ 正文被整段吞掉，
       只剩引用块 + 耗时；成员交回后这 4 条又把同一段产出各显示一遍。
       ⇒ 合成消息必须走普通正文（itemId 前缀判），且不再叠引用。 */
    const hostView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
    ok(/const hostAuthored = String\(row\.itemId \?\? ""\)\.startsWith\("team-dispatch:"\)/.test(hostView)
      && /const useTurnView = isBot[\s\S]{0,240}&& !hostAuthored/.test(hostView)
      && /\{isBot && quote && !hostAuthored && \(/.test(hostView),
      "派活交接（team-dispatch:）走普通正文：⛔ 不交 TurnView（正文会被吞成空壳）、⛔ 不叠引用");
    /* ⛔⛔ 11-12 用户：「成员也不知道自己要干什么，团队是散的，互相不了解对方的能力和擅长领域」
       「交完就没事了」「飞书里智能体之间配合天衣无缝，团队是一个整体」。
       ⇒ 成员开跑前必须拿到团队整体：名册（含擅长）+ 团队负责人最近的计划；且要能读到群日志。 */
    const invokeSrc = codeOnly(read("electron/team-invoke.ts"));
    const bridgeSrc = codeOnly(read("electron/team-group-bridge.ts"));
    const teamIpcSrc = codeOnly(read("electron/features/harness-team-ipc.ts"));
    ok(/function teamBriefOf/.test(invokeSrc)
      && /## 成员与各自擅长/.test(invokeSrc)
      && /团队负责人最近说的/.test(invokeSrc)
      && /teamBriefOf\(team as never, member\.id, groupOfTeam/.test(invokeSrc)
      && /export function recentGroupMessages/.test(bridgeSrc)
      && /setTeamGroupReader\(/.test(teamIpcSrc),
      "成员开跑时拿到团队整体（名册含擅长 + 负责人最近的计划），⛔ 不是只给一句任务");
    /* ⛔⛔ 11-12 用户：「如果还要我指定让他派哪个人干嘛，那就是废物，自己成员都不了解？」
       「成员名册+能力清单」⇒ 名册必须带"擅长"，且主理人与成员读**同一份**口径。 */
    const toolsSrc = codeOnly(read("electron/expert-teams/06-team-tools.ts"));
    ok(/export function memberRosterLines/.test(toolsSrc)
      && /擅长：/.test(toolsSrc)
      && /memberRosterLines\(team, \{ withLead: true \}\)/.test(toolsSrc)
      && /memberRosterLines\(team as never, \{ withLead: true, selfId: memberId \}\)/.test(invokeSrc)
      && /派谁由你自己判断/.test(codeOnly(read("electron/features/group-talk/03-talk.ts"))),
      "名册=能力清单（含擅长）且一处口径；派谁由主理人自己判断，⛔ 不许问用户");
    /* ⛔⛔ 11-12 用户：「你给他们设计好流程，配套好工具」。
       流程必须落到工具：计划 → team_plan（落成群消息）；进度 → team_status（读群事实）。 */
    ok(/export function buildTeamPlanTool/.test(toolsSrc)
      && /export function buildTeamStatusTool/.test(toolsSrc)
      && /TEAM_TOOL_PLAN/.test(fallback) && /TEAM_TOOL_STATUS/.test(fallback)
      && /"team-plan:"/.test(fallback)
      && /buildTeamPlanTool\(\)/.test(codeOnly(read("electron/features/harness-team-ipc.ts")))
      && /buildTeamStatusTool\(\)/.test(codeOnly(read("electron/features/harness-team-ipc.ts"))),
      "流程配套工具：team_plan 发计划进群、team_status 查进度，且都挂在主理人工具面");
    /* ⛔⛔ 11-12 用户：「管理员设置就不能再展示普通标了」「管理员设置后多了哪些工具联动」。
       管理员是**群级身份**：团群由主理人担任（不是"团群不启用管理员"）。
       ⇒ 判定一处（adminSeatOf）、显示跟着走（成员标签 + 消息头角色）、名册 isAdmin 也跟着走。 */
    ok(/const adminSeatOf = \(id: string\)/.test(hostView)
      && /adminSeatOf\(m\.id\) && \(/.test(hostView)
      && /team-group__member-tag is-admin/.test(hostView)
      && /if \(adminSeatOf\(id\)\) return "管理员"/.test(hostView)
      && /const adminId = isTeamGroup[\s\S]{0,80}teamSlotMember/.test(teamIpcSrc)
      && /你是这个群的\*\*管理员\*\*/.test(talk),
      "管理员=群级身份（团群由主理人担任）：标签 / 消息头角色 / 名册 / 提示词同一处判定");
    /* ⛔⛔ 11-12 用户：「加一个设置管理员提醒，管理员的作用」「创建完成普通专家群之后，弹窗提醒+成员名单」。 */
    ok(/team-admin-hint/.test(hostView) && /adminHintVisible/.test(hostView)
      && /harness-team-admin-hint:/.test(hostView)
      && /群已建好/.test(read("src/features/harness-team/12-team-create.tsx"))
      && /还差一个管理员/.test(read("src/features/harness-team/12-team-create.tsx")),
      "没设管理员给提醒（可关且记住）+ 建群完成屏给成员名单与管理员作用");
    /* ⛔⛔ 11-12 用户：「这里还不能直接设置管理员？」—— 建群完成屏就得能设，别让人再跑一趟群设置。 */
    ok(/onSetAdmin/.test(read("src/features/harness-team/12-team-create.tsx"))
      && /const pickAdmin = async/.test(read("src/features/harness-team/12-team-create.tsx"))
      && /onSetAdmin=\{\(gid, memberId\) => setAdminOf/.test(read("src/features/harness-team/index.tsx")),
      "建群完成屏可直接设管理员（接线到 setAdminOf），⛔ 不用再跑一趟群设置");
    /* ⛔⛔ 11-12 用户：「群里汇总出字效果能不能加一下，现在是闪出来的，界面也跟着闪一下」。
       入场必须**不触发布局**（只 opacity/transform/clip-path）；且要跟项目既有的
       msg-appear 同档（0.16~0.18s）+ 尊重 prefers-reduced-motion。 */
    const teamCss = read("src/styles/61-team-mode.css");
    ok(/@keyframes team-msg-appear/.test(teamCss)
      && /\.team-msg__body \{ animation: team-msg-reveal/.test(teamCss)
      && !/\.team-msg \{[^}]*height:/.test(teamCss)
      && /prefers-reduced-motion[\s\S]{0,120}\.team-msg \{ animation: none; \}/.test(teamCss),
      "群消息入场是「出字」而非硬闪：opacity+位移+正文自上而下揭开，⛔ 不触发布局，且可降级");
    /* ⛔⛔ 11-12 用户：「这个系统是啥意思，然后来源啥的，改成私聊会话」「系统消息要来干嘛」。
       ⇒ 群消息流里不许再出现启动对账的系统提示；历史落过盘的也不投影；
         来源按钮不再露内部 threadId，改成「私聊 成员名」。 */
    ok(!/sys-interrupted:/.test(teamIpcSrc)
      && !/reconcileInterruptedDispatches/.test(read("electron/features/boot.ts"))
      && /itemId\.startsWith\("sys-interrupted:"\)/.test(read("src/lib/team-models.mjs"))
      && !/来源 \{shortId\(row\.threadId\)\}/.test(hostView)
      && /私聊 \{nameOf\(row\.authorId\)\}/.test(hostView),
      "群里没有系统提示：对账消息已取消、历史不投影；来源是「私聊 成员名」而非内部 id");
    /* ⛔⛔ 11-12 用户「断之前好像也没有接力」：排片跑完 / 成员交回的回交被按 teamId 的
       "还有人在跑"门槛吞掉 —— 同一个团可被多个群同时调用 ⇒ 别的群在跑，本群就永远停在最后产出。
       ⛔ 回交只按本次排片（relayInFlight）判，不许按 teamId 跨群判。 */
    ok(/if \(lead && chainBudget > 0 && leadCatchUps < MAX_LEAD_CATCH_UPS/.test(teamIpcSrc)
      && /\&\& !relayInFlight && chainBudget > 0 && leadCatchUps/.test(teamIpcSrc)
      && !/const stillRunning = teamRunStore\.activeRunList\(\)/.test(teamIpcSrc)
      && !/const membersStillRunning = teamRunStore\.activeRunList\(\)/.test(teamIpcSrc),
      "接力不串群：排片跑完/成员交回必回交主理人，⛔ 不再按 teamId 判断有没有人在跑");
    /* ⛔⛔ 11-12 用户：「成员汇报给主代理的时候没有艾特主代理，主代理能知道他跑完了？」 */
    ok(/handoffTo: teamAuthorIdOf/.test(read("electron/team-invoke.ts"))
      && /handoffTo: leadAuthorId/.test(teamIpcSrc)
      && /handoffTo: String\(entry/.test(read("src/lib/team-models.mjs"))
      && /handoffTo: String\(msg\?\.handoffTo/.test(read("src/lib/team-models.mjs"))
      && /team-msg__handoff/.test(hostView)
      && /run\.leadThreadId/.test(fallback)
      && !/activeRunList\(\)\.some\(\(run\) => String\(run\.teamId/.test(fallback),
      "成员交回显式 @ 主理人（结构化 handoffTo + 名字行标签），回喂按 leadThreadId 不串群");
    /* ⛔⛔ 11-12 用户截图（同一个问题回复两次）：提问被当成"给了活"⇒ 催办多跑一轮。
       问句判定收进 isInfoRequest（真值表在 11f）；这里钉接线，⛔ 旧内联窄词表不许复活。 */
    ok(/if \(isInfoRequest\(text\)\) return false;/.test(teamIpcSrc)
      && /leadTurnTaskLike/.test(teamIpcSrc)
      && !/const askLike = /.test(teamIpcSrc),
      "催办只认「布置任务」：提问/询问一律不算（⛔ 否则答完又被催一轮 = 同一问题回两次）");
    /* ⛔⛔ 11-12 审查修的两处（都只影响"看得对不对"，但会让用户判"又坏了"）：
       ① queued 用裸 memberId、running 用合成 id ⇒ 同一个人两行；
       ② settled 发在"还有人在跑"之前 ⇒ 明明还在跑却显示已收口。 */
    ok(/emitAsync\("queued", \{[\s\S]{0,160}teamAuthorIdOf\(teamId, String\(task\?\.memberId/.test(fallback)
      && /const stillRunning = teamRunStore\.activeRunList[\s\S]{0,140}if \(stillRunning\) return;\s*emitAsync\("settled"/.test(fallback),
      "异步反馈口径一致：queued 与 running 同一合成 id；整团没人跑了才 announce settled");
    ok(/export function relayGroupLead/.test(bridge)
      && /setTeamGroupRelay\(\(gid, teamId, note\) =>/.test(dispatch)
      && /relayLeadAfterMembers\(/.test(dispatch)
      && /runDispatchRounds\(group, \[target\], note, "automation"/.test(dispatch),
      "回喂走群聊串行队列（不落假用户消息、⛔ 不并发 resume 同一条会话）");
    /* ⛔ 11-12 用户：「就正常对话聊天派活，主代理一直刷屏」⇒ 口径从「回一句已派给谁」
       改成「拿到已派单就不要再说话」（派单消息已经进群，复述=同一件事说两遍）。 */
    ok(/groupAsyncToolCopy/.test(dispatch) && /异步派单/.test(dispatch)
      && /异步排片/.test(talk) && /拿到「已派单」就\*\*不要再说话\*\*/.test(talk)
      && /await Promise\.allSettled\(tasks\.map/.test(fallback),
      "工具 schema 与提示词同改异步口径（拿到已派单就不再复述）；⛔ 独立团会话仍保留同步返回链");
    /* ⛔⛔ 11-11 用户令「加一个异步执行反馈效果板块」+「这个可以给外面会话也加上」：
       板块必须是**独立的**（自己订阅事件、零 IPC、不占群聊域状态），且群聊与外面会话
       共用同一块（⛔ 不是各写一套）。四处缺一就等于没落地。 */
    ok(/export function AsyncRunPanel/.test(read("src/features/async-run-feedback/AsyncRunPanel.tsx"))
      && /group-async-run/.test(read("src/features/async-run-feedback/useAsyncRunState.ts"))
      && /export function reduceAsyncRunEvent/.test(read("src/features/async-run-feedback/useAsyncRunState.ts"))
      && /<AsyncRunPanel groupId=\{group\.id\}/.test(read("src/features/harness-team/04-team-group-view.tsx"))
      && /<AsyncRunPanel threadId=\{thread\?\.id\}/.test(read("src/features/app-view/AppView/02-main-stage/03-composer.tsx"))
      && /66-async-run-feedback/.test(read("src/styles.css")),
      "异步执行反馈是独立板块（自己订阅事件 / 零 IPC），群聊与外面会话共用同一块");
  }
  ok(/runTalkTurn\(group\.id/.test(dispatch) && !/runDelegatedTask\(/.test(dispatch)
    && /attachGroupTalkEvents\(server\)/.test(dispatch),
    "群派活接线到独立通道，⛔ 不再调 runDelegatedTask");
  ok(/\? \"伙伴\"/.test(badge), "外面会话标签改成「伙伴」");
  /* ⛔⛔ 11-07 用户令：「把子会话调度权限关了，只关调度权限，不要动工作伙伴里面的群聊机制」——
     伙伴会话也是子会话 ⇒ 一律没有对外调度权限（agent_invoke 被拒）；群聊机制（group_say 投递 /
     runTalkTurn）不经过 canDispatchFrom，照常可用。 */
  const dispatchCore = codeOnly(read("electron/features/dispatch-core.ts"));
  const dispatchRpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
  ok(/lookupGroupThread\(threadId\)\) return \{ groupThread: true \}/.test(dispatchCore)
    && /groupMember \|\| f\.groupThread\) return "workPartner"/.test(read("src/lib/session-kind.mjs"))
    && /dispatch: false, bossGroup: false, scheduler: true, knowledge: true, cliInstall: true/.test(read("src/lib/session-kind.mjs")),
    "工作伙伴的伙伴会话没有对外调度权限（子会话一律不给 agent_invoke；群聊投递不受影响）");
  /* ⛔ 用户原话「**只关调度权限**」：知识库写入 / 定时任务 / CLI 安装这些非调度能力照旧
     （11-12 起三处闸统一读能力矩阵 `caps.knowledge/scheduler/cliInstall` —— ⛔ 不许退回
     `restricted && !dispatchOnly` 的第二套判据，那种写法加一类会话就要改四处）。 */
  ok(/!restrict\.caps\.knowledge/.test(dispatchRpc) && /!restrict\.caps\.scheduler/.test(dispatchRpc)
    && /!restrict\.caps\.cliInstall/.test(dispatchRpc),
    "「只关调度」= 知识库 / 定时任务 / CLI 安装三处闸读能力矩阵（工作伙伴放行，专家/团队/被调度全拒）");
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
  /* ⛔⛔ 11-08 用户（截图 3）：「我点出来的那个 @ 总是固定在消息下面，很不好看」——
     气泡底部那排「补出来」的 chip 删除；@ 只在正文里（行内提及）。 */
  ok(!/team-msg__mentioned/.test(read("src/features/harness-team/04-team-group-view.tsx"))
    && !/team-msg__mentioned/.test(read("src/styles/61-team-mode.css")),
    "⛔ 气泡底部不再有「补出来」的 @ chip 行（@ 只在正文里）");
  /* ⛔⛔ 11-08 用户（截图）：「加上头像」「输入框里面自动变成图二这种」——
     输入框改成与主对话同模型的 **contenteditable + 真 chip 节点**（头像 + @名字），
     ⛔ 不再用 textarea + 覆盖层（头像会加宽，覆盖层与光标必然错位）。 */
  {
    const composerSrc2 = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
    const teamCss2 = read("src/styles/61-team-mode.css");
    const editorSrc = codeOnly(read("src/lib/team-composer-editor.ts"));
    ok(/contentEditable/.test(composerSrc2) && /renderEditor\(el, text, mentionNames, mentionAvatars/.test(composerSrc2)
      && /team-composer__at-chip/.test(editorSrc) && /data-mention/.test(editorSrc)
      && /contenteditable", "false"/.test(editorSrc)
      && !/team-composer__mirror/.test(composerSrc2),
      "输入框 = contenteditable + 原子 chip 节点（头像 + @名字），序列化回 `@名字`（⛔ 不再用覆盖层）");
    ok(/team-composer__at-avatar/.test(editorSrc) && /team-composer__at-avatar/.test(teamCss2)
      && /\.team-composer__at-avatar\s*\{[^}]*border-radius:\s*50%/.test(teamCss2),
      "chip 里画真头像（与成员栏同一套判定，16px 圆形）");
    ok(/editorCaret\(el\)/.test(composerSrc2) && /setEditorCaret\(el, caret\)/.test(composerSrc2) && /insertMentionAtCaret/.test(composerSrc2),
      "光标按纯文本偏移读写（contenteditable 没有 selectionStart；插人也走同一套偏移）");
  }
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

/* ── ⑦ 输入框工具行：@ 入口 + 行内提及（⛔ 「指令」按钮已下线） ── */
{
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/onOpenMention\?: \(anchor: HTMLElement\) => void;/.test(composer) && /mentionCount\?: number;/.test(composer)
    && /mentionAnchorRef\?: RefObject<HTMLButtonElement \| null>;/.test(composer)
    && /mentionNames\?: string\[\];/.test(composer) && /mentionAvatars\?: Record<string, MentionAvatar>;/.test(composer)
    && /editorApiRef\?: RefObject<TeamEditorApi \| null>;/.test(composer),
    "新 prop 都在 Props 里（@ 入口带锚点、人数徽标、提及名字/头像、编辑器命令面；⛔ 少一个就是「写了不生效」）");
  ok(/aria-label="选择伙伴（@）"/.test(composer) && /team-composer__at-badge/.test(composer),
    "@ 按钮带已选人数徽标");
  /* ⛔⛔ 11-08 用户：「然后那个指令按键可以不要了，配套群设置里面也可以删了」——
     「指令」按钮 = 群菜单（TeamMenuButton）整体下线 ⇒ 输入框不再收 toolsSlot 槽。 */
  ok(!/toolsSlot/.test(composer) && !/TeamMenuButton/.test(composer),
    "⛔ 输入框工具行不再收群菜单槽（指令按钮已下线）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/onOpenMention=\{\(\) => \(mention\.open \? closeMention\(\) : openMentionPanel\(\)\)\}/.test(view) && /mentionCount=\{atTargets\.length\}/.test(view)
    && /mentionNames=\{mentionNames\}/.test(view) && /mentionAvatars=\{mentionAvatars\}/.test(view)
    && /editorApiRef=\{editorApiRef\}/.test(view),
    "群视图把 prop 真的传下去了（@ 入口带开关、人数徽标、提及名字/头像、编辑器命令面；⛔ 组件加了 prop 不传 = 按钮不存在）");
  ok(!/TeamMenuButton/.test(view) && !/onSaveMenu/.test(view) && !/floatMenu/.test(view),
    "⛔ 群头不再有「指令」菜单按钮（指令体系整体下线，含 FLOAT 形态与保存菜单回调）");
  const settings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  ok(!/data-section="menu"/.test(settings) && !/快捷指令/.test(settings) && !/onSaveMenu/.test(settings),
    "⛔ 群设置里「快捷指令」整段也删了（⛔ 只删按钮留设置页 = 用户点名的那半没做）");
}

/* ── ⑦b 群头去赘述 + 办公室入口挪到操作区（11-08 用户截图「把我框住的文字赘述删了…办公室预览图标放到展开折叠左边」）── */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const css = read("src/styles/61-team-mode.css");
  ok(!/team-group__sub/.test(view) && !/\.team-group__sub\s*\{/.test(css)
    && !/位成员 · \$\{.*\} 个伙伴/.test(view),
    "⛔ 群头副标题「N 位成员 · M 个伙伴 · 项目 …」整条删除（人数/项目名在别处已有，用户点名赘述）");
  ok(!/members-foot/.test(view) && !/\.team-group__members-foot\s*\{/.test(css)
    && !/点 @ 把这个人加进这次派活/.test(view),
    "⛔ 成员栏底部那句「点 @ 把这个人加进这次派活」也删了（同一张截图框住的赘述）");
  const headActions = view.slice(view.indexOf("team-group__head-actions"), view.indexOf("team-group__head-actions") + 2600);
  ok(/<TeamOfficeEntry/.test(headActions)
    && headActions.indexOf("<TeamOfficeEntry") < headActions.indexOf("aria-label={membersOpen ? \"收起成员栏\" : \"展开成员栏\"}"),
    "办公室预览入口落在群头操作区，且在「收起/展开成员栏」键的**左边**（用户点名位置）");
  ok(!/\.team-group__office \{[\s\S]{0,120}?margin-top: auto;/.test(css),
    "⛔ 办公室入口不再靠 margin-top:auto 钉在成员栏底部（那只对右侧栏成立，挪到群头会撑歪）");
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
  /* 11-07 审查：成员级 @ 打通后，「追问」仍退回团那一行 ⇒ 同一成员两条路径派给不同对象。
     ⛔ 11-08：目标身份改成从正文反查 ⇒ 追问 = 把 `@他本人` 写进输入框。 */
  ok(/const teamAuthor = parseTeamAuthorId\(row\.authorId\);[\s\S]{0,200}?insertMentionText\(name\)/.test(view),
    "「追问」团成员消息时 @ 回他本人（合成 id 写进正文），⛔ 不退化回整团");
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
    /* ⛔ 11-11：判据收窄到 **handler 那次调用** —— relayLeadAfterMembers 里的 await 是后台回喂，
       ⛔ 不绑回 IPC 请求生命周期（它由成员完成事件触发，与 handler 无关）。 */
    && !/await runDispatchRounds\(g, opened\.targets/.test(ipcDispatch),
    "⛔ 主进程不 await 派活：关面板/切页后任务照跑（产出照进群、互 @ 照接力）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  /* 11-08：派活前多了「运行中的伙伴先进队列」这一跳（idleTargets），清空仍只在**成功之后**。 */
  /* ⛔ 11-09：清空收敛成 `clearComposer(isOverride)`（话题弹窗复用 send 时不许动主输入框草稿）。 */
  ok(/const r = await onSend\?\.\(idleTargets, fullBody, params\)[\s\S]{0,320}?clearComposer\(Boolean\(override\)\)/.test(view)
    && !/onSend\?\.\(idleTargets, fullBody, params\)[\s\S]{0,80}?clearComposer\([\s\S]{0,200}?if \(r && !r\.ok\)/.test(view),
    "派活成功即清空输入框（主对话口径；失败保留原文 —— ⛔ 清空必须排在校验失败之后）");
  ok(/e\.nativeEvent\.isComposing/.test(view),
    "中文输入法选字期间的 Enter 不误发（否则 IME 会把清空回滚，看着像没清）");
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  ok(/onPaste=\{\(e\) => void onPaste\(/.test(composer) && /function pastedFilePaths/.test(composer)
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
  ok(!/team-group__members-hint/.test(avatarView)
    && /className="team-group__member-main"[\s\S]{0,400}?onClick=\{\(event\) => openProfile\(event, m\.id\)\}/.test(avatarView),
    "成员栏不再堆提示文字；整行名字可点开资料卡（改名/换头像在卡内）");
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
    && /harnessTeamStop\(\{ threadIds: candidates, stopAll: true, groupId \}\)/.test(codeOnly(read("src/features/harness-team/02-team-store.ts")))
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
     根因是上一轮 @ 的目标挂到了下一轮。⛔ 11-08 起目标身份**从正文反查**
     ⇒ 发完清正文 = 清本轮 @（不再有独立的 atTargets 需要清），换群由组件重挂载重置。 */
  ok(!/setAtTargets\(/.test(view) && (view.match(/clearComposer\(Boolean\(override\)\)/g) || []).length >= 2
    && /const atTargets = useMemo\([\s\S]{0,60}?mentionTargetsInText\(text\.replace\([\s\S]{0,80}?\), mentionCandidatesFlat\)/.test(view),
    "本轮 @ 随正文一起清（派活 + 队列两条路径都清正文）—— ⛔ 不再有会偷偷带到下一轮的第二份目标状态");
  ok(/const r = await onSend\?\.\(idleTargets, fullBody, params\);[\s\S]{0,320}?clearComposer\(Boolean\(override\)\);/.test(view),
    "清 @ 与清正文在同一处（用户看到的就是「发出去、输入区归零」）");
  ok(/<TeamQueueStack/.test(view) && /queueTeamMessage\(entry\.run\.threadId, fullBody\)/.test(view)
    && /const idleTargets = targets\.filter/.test(view),
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
    && /\.team-group__office \{/.test(read("src/styles/61-team-mode.css")),
    "入口节点仍复用同一份（位置见 ⑦b：群头操作区、展开折叠键左边）");
}

/* ── ⑬ 两种回复模式（11-08 用户令：「做出来两种回复模式」+「在群设置里加上这个选项」）────
   过程模式：过程在**成员自己的流式卡**里（正在写 + 主对话同款折叠块），跑完只留汇报；
   占位模式：不展示过程/流式正文，用户气泡下只挂「小头像 + 名字 + 呼吸点」一粒小图标，产出后再上屏。 */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const proc = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
  const settings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  /* ⛔⛔ 11-08 三改（用户截图圈住用户气泡里的「剪承 运行中」）：「这个过程模式下，就不用在
     用户消息下面展示这个了，只有占位模式才显示这个」—— 过程模式返回 null，反馈只在占位模式画；
     ⛔ 反馈组件里不许再出现 TeamProcess（那是过程模式重复展示的来源）。 */
  const feedback = codeOnly(read("src/features/harness-team/26-team-run-feedback.tsx"));
  ok(/<TeamRunFeedback/.test(view) && /row\.key === lastHumanKey/.test(view)
    && /if \(mode !== "placeholder"\) return null;/.test(feedback) && !/<TeamProcess/.test(feedback),
    "⛔ 过程模式不在用户气泡下挂运行反馈（过程在成员流式卡里）；只有占位模式画小图标");
  ok(!/live=\{live \?\? \[\]\}/.test(view) && /<TeamRunFeedback[\s\S]{0,160}?faceOfId=\{faceOfId\}\s*\/>/.test(view),
    "反馈组件只收 mode/partners/faceOfId（⛔ 不再把 live 传进去 —— 占位图标不依赖流式正文）");
  ok(!/isBot && row\.kind !== "card" && \(\s*<TeamProcess/.test(view),
    "⛔ 成品消息里不许再出现过程块（用户：「运行结束后，运行过程隐藏掉，只留最后汇报」）");
  /* ⛔⛔ 11-09 用户（两张截图对照）：「运行结束效果是对的，运行中就不对」「给我做到跟主对话框一模一样，
     不管运行中还是运行结束，都复用过来」⇒ 运行中**不再走 TeamProcess 那套自绘过程块**，
     整轮交给 `TeamTurnView`（= 主对话 TurnView），只多传 `running` / `live`。
     ⛔ 判据随之改口径（意图不变：运行中要有过程、占位模式不画）：流式卡必须是 TeamTurnView + running，
        且**不许**再出现 `<TeamProcess`（第二套实现正是本次报障的根因）。 */
  ok(/<TeamTurnView[\s\S]{0,320}?threadId=\{run\.threadId\}[\s\S]{0,260}?running[\s\S]{0,60}?live/.test(view)
    && /effectiveReplyMode === "process" \? \(/.test(view)
    && !/<TeamProcess/.test(view)
    && !/row\.runFirst/.test(view),
    "运行中整轮交给 TeamTurnView（= 主对话 TurnView，用户「做到跟主对话框一模一样」）；⛔ 不许再有第二套过程块");
  /* ⛔ 11-08 用户实测（群聊页脚「缓存 0 · 命中 0%」一直不变）：群聊用量是归一化对象
     （字段 `cachedTokens`），取值函数只认引擎原始字段名 ⇒ 归一化值被漏掉、恒 0。 */
  ok(/cachedTokens", "cached_tokens"/.test(read("src/lib/usage-cached-tokens.ts")),
    "⛔ 归一化用量（cachedTokens）也能算命中率 —— 只认引擎原始字段名会永远显示「缓存 0 · 命中 0%」");
  ok(/live?: boolean/.test(proc) || /live = false/.test(proc),
    "过程块支持运行中实时（回合还没落盘 ⇒ 取最新回合；运行中**事件驱动**重拉，⛔ 不再 2.5s 轮询）");
  /* ⛔ 11-08 用户令「跟主对话完全一致」：过程块事件驱动（不再 2.5s 轮询）+ 流式卡里补实时编辑行。 */
  {
    const ipcProc = codeOnly(read("electron/features/harness-team-ipc.ts"));
    const storeProc = codeOnly(read("src/features/harness-team/02-team-store.ts"));
    const procComp = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
    const viewProc = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
    const fileStore = codeOnly(read("src/lib/turn-file-changes.mjs"));
    ok(/type: "group-talk-tick"/.test(ipcProc)
      && /event.type === "group-talk-tick"/.test(storeProc)
      && /bumpTeamProcessTick/.test(storeProc)
      && /subscribeTeamProcessTicks/.test(procComp)
      && !/setInterval\(\(\) => setTick\(\(n\) => n \+ 1\), 2500\)/.test(procComp)
      && /getThreadLiveFileChanges/.test(fileStore) && /liveByThread/.test(fileStore)
      && /<TeamLiveFiles threadId=\{run\.threadId\} \/>/.test(viewProc),
      "群聊过程与主对话一致：事件驱动重拉（group-talk-tick，⛔ 不再 2.5s 轮询）+ 流式卡实时编辑行（按线程）");
  }
  /* ⛔ 11-08 用户令「三样都补上，跟主对话完全一致」：用量页脚 / 推理浮窗 / 网页来源条。 */
  {
    const viewEq = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
    const cardsEq = codeOnly(read("src/features/harness-team/11-team-cards.tsx"));
    const procEq = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
    const ipcEq = codeOnly(read("electron/features/harness-team-ipc.ts"));
    const modelsEq = codeOnly(read("src/lib/team-models.mjs"));
    const rcEq = codeOnly(read("src/features/shared/ReasoningCard.tsx"));
    const overlayEq = codeOnly(read("src/features/harness-team/index.tsx"));
    ok(/team-msg__usage/.test(viewEq) && /usageInputTokens/.test(viewEq) && /row\.usage/.test(viewEq)
      && /\.\.\.\((?:liveUsage|usageForMessage) \? \{ usage: (?:liveUsage|usageForMessage) \}/.test(ipcEq)
      && /usage: msg\?\.usage \?\? null/.test(modelsEq),
      "群消息页脚展示 token 用量（与主对话同口径；主进程落消息时带 usage，老日志为空）");
    /* ⛔ 11-09：运行中整轮改由 `29-team-turn-view`（= 主对话 TurnView）承担，
       `09-team-process` 退役 ⇒ 判据改看新实现（⛔ 仍不许在群板块里另写一套推理渲染）。 */
    const turnEq = codeOnly(read("src/features/harness-team/29-team-turn-view.tsx"));
    ok(/reasoningFloatHost="\.team-reasoning-float-host"/.test(turnEq)
      && /reasoningFloatHost=\{reasoningFloatHost\}/.test(codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx")))
      && /reasoningFloatHost=\{reasoningFloatHost\}/.test(codeOnly(read("src/features/session-queue/SessionQueue.tsx")))
      && /floatHostSelector/.test(rcEq)
      /* ⛔ 推理两种展示（自适应浮窗 / 长条 strip）都在 ReasoningCard 里分叉 —— 群聊直接复用，
         ⛔ 不许在群板块里另写一套（出现 ReasoningStrip / reasoning-card 就是分叉）。 */
      && /ReasoningStrip/.test(rcEq) && /displayMode === "strip"/.test(rcEq)
      && !/ReasoningStrip/.test(turnEq) && !/reasoning-card/.test(turnEq)
      /* ⛔ 11-08 审查确认：宿主必须挂在 TeamGroupView 根（设置→团队 的 TeamModePanel 没有 overlay，
         只挂 overlay 那种场景浮窗会回落 body、被设置弹窗压住）。overlay 里不许再放第二份。 */
      && /team-reasoning-float-host/.test(viewEq) && !/team-reasoning-float-host/.test(overlayEq),
      "推理两种展示（浮窗 / 长条）都复用主对话 ReasoningCard（运行中 turnActive + 群内 portal 宿主挂在群视图根，⛔ 不自造渲染）");
    ok(/<TurnWebSources sources=\{collectTurnWebSources\(turn as never\)\} inline \/>/.test(cardsEq),
      "网页来源条与主对话同组件（TeamCards 里渲染）");
  }
  /* ⛔ 11-08 用户实测「一发消息就渲染报错」+「过程半天才出来」。 */
  {
    const filesStore = codeOnly(read("src/lib/turn-file-changes.mjs"));
    const procLive = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
    const ipcLive = codeOnly(read("electron/features/harness-team-ipc.ts"));
    ok(/const EMPTY_FILES = Object\.freeze\(\[\]\)/.test(filesStore)
      && /getThreadLiveFileChanges[\s\S]{0,160}?\?\? EMPTY_FILES/.test(filesStore)
      && /turnsOf\(threadId, live \? 1 : 8\)/.test(procLive)
      && /limit, sortDirection/.test(procLive)
      && /onPhase\?\.\("started", partner, \{\}\)/.test(ipcLive),
      "群聊首屏：快照稳定（空列表同一常量，⛔ 防 useSyncExternalStore 死循环）+ 运行中只拉最新 1 回合 + 建会话前先报运行中（11-08 用户实测）");
  }
  /* ⛔ 11-08 三改（用户：「这个显示不好看，上下太宽了，我要是那种很窄的，很小的头像+名字提醒」）：
     小图标收成 20px 高的窄粒（小头像 14 + 名字 + 呼吸点），⛔ 不再带「处理中…」长文案。 */
  {
    const feedbackSrc = codeOnly(read("src/features/harness-team/26-team-run-feedback.tsx"));
    const css = read("src/styles/61-team-mode.css");
    ok(/team-run-feedback__chip/.test(feedbackSrc) && /team-run-feedback__chip/.test(css)
      && /size=\{14\}/.test(feedbackSrc) && !/处理中…/.test(feedbackSrc)
      && /\.team-run-feedback__chip\s*\{[^}]*height:\s*20px/.test(css)
      && /\.team-run-feedback__chip\s*\{[^}]*padding:\s*0;/.test(css)
      && /\.team-run-feedback__chip\s*\{[^}]*border:\s*0;/.test(css)
      && /\.team-run-feedback__chip\s*\{[^}]*background:\s*none;/.test(css)
      && /\.team-run-feedback__dot\s*\{[^}]*width:\s*5px/.test(css),
      "占位模式 = 很窄的一粒（20px 高 / 小头像 14 / 名字 / 5px 呼吸点），⛔ 无边框无底色（不拉底色条，宽度跟内容走）");
    ok(!/is-process/.test(feedbackSrc) && !/team-run-feedback__row|team-run-feedback__who|team-run-feedback__waiting/.test(css),
      "⛔ 过程模式那套反馈样式已删净（带边框/内边距的宽行就是用户说「上下太宽」的那个）");
  }
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
      && /if \(clearedDuringRun\) \{/.test(ipcSrc)
      && /patchTalkMessageRow\(group\.id, duplicateRow\.id/.test(ipcSrc)
      && /cleared > since/.test(ipcSrc),
      "清空聊天记录后，在飞回合（群聊 + 主理人工具派活）的回复都不再写回空群（主进程代际判定，11-08 审查）");
  }
  /* ⛔⛔ 11-08 用户实测（「成员消息不处理完压根不上屏」「谁在运行一点反馈都没有」「为啥重复」）：
     ① 写库必须广播（否则接力成员的消息没人 await ⇒ 永远不出现）；
     ② 回合进行中必须广播 agentMessage 增量（与主聊天同一条 delta 方法）⇒ 流式卡/过程块实时；
     ③ 成员一回合里 group_say + 最终回复会落两条 ⇒ 宿主按「近乎同一句」去重；
     ④ 提示词明确「二选一」，别让模型两样都做。 */
  {
    const ipcLive = codeOnly(read("electron/features/harness-team-ipc.ts"));
    const storeLive = codeOnly(read("src/features/harness-team/02-team-store.ts"));
    const talkLive = codeOnly(read("electron/features/group-talk/03-talk.ts"));
    ok(/type: "harness-team-messages", groupId: gid, rows: result\.rows/.test(ipcLive)
      && /type: "group-talk-live", phase: "started"/.test(ipcLive)
      && /item\/agentMessage\/delta/.test(ipcLive)
      && /event\.type === "group-talk-live"/.test(storeLive)
      && /event\.type === "harness-team-messages"/.test(storeLive)
      && /textsAreNearDuplicate\(row\.text, output\)/.test(ipcLive)
      && /不要两样都做/.test(talkLive),
      "群聊回复实时上屏：写库广播 + 回合内增量广播（渲染层两个 handler）+ 工具/最终回复去重 + 提示词二选一（11-08 用户实测）");
    /* ⛔⛔ 11-08 审查（Required）：去重只看"重合率"不看长度 ⇒ 短句「收到，我马上开始」的二元组
       会被长文全覆盖（≈1.0），更详细的**最终回复**会被当重复吞掉 = 丢真正文。
       判据：长度差超过 1.3×+12 一律不判重；单测覆盖这个反例。 */
    const modelsLive = codeOnly(read("src/lib/team-models.mjs"));
    const dupTest = read("tests/team-near-duplicate.test.mjs");
    ok(/const shortLen = Math\.min\(x\.length, y\.length\)/.test(modelsLive)
      && /longLen > shortLen \* 1\.3 \+ 12/.test(modelsLive)
      && /长文最终回复 ⇒ 不判重/.test(dupTest),
      "⛔ 去重不能吞掉更详细的最终回复：长度差过大不判重（短句 + 长方案 ≈1.0 重合率，旧实现会丢正文）");
    /* ⛔⛔ 11-08 审查（Required）+ 优化：finished 后延迟摘卡（300/500ms）里，同一人可能被接力/排队
       又开了一轮 —— 旧实现无条件 delete，会把**新一轮**的卡删掉，后续 delta 无卡可写 ⇒ 消息整张消失。
       判据：主进程给每一轮显式 `runId`（成员 + 起跑时刻），两条 finished 路径都先比 runId、
       老事件（无 runId）才退回 startedAt；delta 也不许把上一轮的增量糊进新一轮。 */
    const raceGuard = storeLive.match(/cur\.startedAt > finishedAt/g) ?? [];
    ok(/const runId = `\$\{partner\?\.id \?\? ""\}:\$\{startedAt\}`/.test(ipcLive)
      && /phase: "finished", groupId: group\.id[^}]*runId/.test(ipcLive)
      && /const runId = String\(event\.runId \?\? record\.startedAt/.test(storeLive)
      && /cur\.runId !== runId/.test(storeLive)
      && /runId && cur\.runId && runId !== cur\.runId/.test(storeLive)
      && raceGuard.length >= 2 && /const finishedAt = Date\.now\(\);/g.test(storeLive),
      "⛔ 流式卡按显式 runId 认代次（主进程发 / 渲染层比；老事件回退 startedAt）—— 否则接力新卡被上一轮 finished 删掉、迟到 delta 糊进新一轮");
    const chanLive = codeOnly(read("electron/features/group-talk/01-channel.ts"));
    ok(/let threadId = options\.threadId\s*\|\| \(await ensureTalkThread/.test(chanLive)
      && /\.\.\.\(liveThreadId \? \{ threadId: liveThreadId \}/.test(ipcLive),
      "已 ensure 的会话 id 直接交给 runTalkTurn（每回合不再多一次 thread/resume）");
    /* ⛔ 11-08 Optional 收口：用量页脚不能「事件来晚就没有」 —— 常驻监听 + 落盘前缓存 + 收尾/迟到补写。 */
    ok(/usageFromTokenEvent/.test(ipcLive)
      && /installTalkUsageWatcher\(\);/.test(ipcLive)
      && /const usageForMessage = liveUsage \?\? talkUsageFor\(threadId, startedAt\)/.test(ipcLive)
      && /finishedTalkRuns\.set\(finishedThreadId/.test(ipcLive)
      && /async function patchLatestTalkMessageUsage\(groupId: string, threadId: string, usage: GroupUsage\)/.test(ipcLive)
      && /pickUsagePatchIndex\(list, threadId, now, TALK_USAGE_TTL\)/.test(ipcLive)
      && /patchLatestTalkMessageUsage\(run\.groupId, hit\.threadId, hit\.usage\)/.test(ipcLive)
      && /usageWritten === false && liveUsage/.test(ipcLive),
      "用量页脚兜底：常驻 tokenUsage 监听 + 落盘前缓存 + 收尾/迟到补写（⛔ 事件晚到也补得上，且运行中不挂到中间消息上）");
  }
}

/* ── ⑬b 伙伴转交写真实发送者 + 侧栏「伙伴」标签（11-08 用户截图：
   「群里会话的伙伴标签没出来，群成员 伙伴转交 明确出来谁给他发的消息」）────── */
{
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const tools = codeOnly(read("electron/features/group-talk/02-tools.ts"));
  const channel = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  const store = codeOnly(read("src/lib/team-talk-threads.mjs"));
  const rows = codeOnly(read("src/features/app-state/parts/part02/02-goal-browser-notice/01-goal-review-file-browser/02-thread-attention-rows.tsx"));
  ok(/hooks\.relay\(groupId, who\.memberId, who\.name, to, text\)/.test(tools)
    && /relay: \(gid: string, fromId: string, fromName: string/.test(ipc)
    && /String\(fromName \?\? ""\)\.trim\(\) \|\| "群成员"/.test(ipc),
    "伙伴转交必须写真实发送者：台账名字随 relay 传进来，⛔ 名册查不到也不能退化成「群成员」（截图里的那个标签）");
  ok(/export function listTalkThreads/.test(channel) && /listTalkThreads\(\)/.test(ipc)
    && /harness-team:talk-threads/.test(ipc),
    "群聊伙伴会话台账经只读通道暴露（会话是普通 thread，⛔ 只能由台账认，不能按标题猜）");
  ok(/harnessTeamTalkThreads/.test(store) && /subscribeTeamTalkThreads/.test(store)
    && /useSyncExternalStore\(subscribeTeamTalkThreads, getTeamTalkThreads\)/.test(rows)
    && /talkThreads\.byId\[entry\.id\]/.test(rows)
    && /if \(talkInfo\) rowBadges\.push\(<span className="thread-source-badge tone-dispatch"/.test(rows)
    && /群聊伙伴会话/.test(rows),
    "侧栏给群聊伙伴会话打「伙伴」标签（单例 store 订阅；⛔ 不在 renderThreadRow 里订阅，行数一变就 hook 错位）");
}

/* ── ⑬c resume 失败不再开重复会话（11-08 用户令「查一下 resume 失败后重复会话的问题」）────
   引擎原话 `cannot resume running thread`：会话活着、只是正在跑。旧代码把所有 resume 失败
   都当"会话没了"⇒ 新建一条 + 覆盖台账 ⇒ 同一位成员两条会话。判据：只有 missing 才重建；
   忙/暂时性一律抛可识别错误；台账写操作串行（链内重读，⛔ 不拿旧快照整份覆盖）；同一成员投递串行。 */
{
  const channel = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const resumeClass = codeOnly(read("src/lib/team-talk-resume.mjs"));
  const resumeTest = read("tests/team-talk-resume.test.mjs");
  ok(/classifyTalkResumeFailure/.test(channel) && /if \(resumed\.kind !== "missing"\) throw talkUnavailable/.test(channel)
    && /cannot resume \(\?:a \)\?running thread/.test(resumeClass)
    && /thread not found/.test(resumeClass)
    && /会话正在运行 ⇒ busy/.test(resumeTest),
    "⛔ resume 失败只有引擎明确说「会话不存在」才重建；忙 / 引擎重启 / 超时一律不新建（重复会话的根因）");
  ok(/let ledgerChain: Promise<unknown>/.test(channel) && /function mutateLedger</.test(channel)
    && (channel.match(/await mutateLedger\(/g) ?? []).length >= 2,
    "台账写操作串行 + 链内重新读盘合并（⛔ 旧快照整份写回会把并发开跑的其他成员整条抹掉）");
  /* ⛔ 11-11：串行键改成「会话身份」（@整团 与 @主理人打同一条会话，必须排同一条队列）。
     判据是**语义**（探测→空闲才挂，新建在串行队列内 ensure 后再挂），不是那个字面 id。 */
  ok(/export async function peekTalkThread/.test(channel) && /peekTalkThread\(group\.id, partner as TalkMember/.test(ipc)
    && /if \(liveThread && !liveThread\.busy\) attachLive\(liveThread\.threadId\)/.test(ipc)
    && /queueTalkDelivery\(group\.id, (?:talkAs \|\| )?partner\.id, async \(\) => \{[\s\S]{0,900}?ensureTalkThread\(group\.id/.test(ipc),
    "流式监听前只做**只读探测**（探到空闲才挂）；新建会话（首条消息）在**串行队列内** ensure 后再挂（否则整轮没有流式事件）");
  ok(/export function queueTalkDelivery/.test(channel) && /queueTalkDelivery\(group\.id, partner\.id/.test(ipc)
    && /withDispatchTimeout\(runTalkTurn/.test(ipc),
    "同一成员的消息串行投递（引擎不允许 resume/并行回合正在跑的会话；超时从真正开跑时算）");
}

/* ── ⑬d 专家随时可调 + 群 @ 专家库（11-08 用户截图：
   「内置的专家都不显示，就显示几个以前用过的；这个专家不管什么时候都要能直接调用」）── */
{
  const mentionLib = read("src/lib/dispatch-mention.mjs");
  const dispatchSrc = read("electron/dispatch.ts");
  const teamMention = read("src/lib/team-mention.mjs");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const settings = read("src/features/harness-team/03-team-settings.tsx");
  const pickTest = read("tests/team-mention-panel.test.mjs");
  ok(/if \(kind === "team"\) return allow\.team === true;/.test(mentionLib)
    && !/kind === "team" \|\| kind === "member"/.test(mentionLib)
    && /case "member": return allow\.expert;/.test(dispatchSrc)
    && /key === "member"[\s\S]{0,40}\? allow\.expert/.test(dispatchSrc),
    "⛔ 团成员（单个专家）不再跟「专家团」开关：渲染层置灰与执行端硬闸同口径（只有整团看开关）");
  ok(/key: "library", title: "专家库"/.test(teamMention) && /library: true/.test(teamMention)
    && /if \(item\.library\)/.test(view) && /targetKind: "expert"[\s\S]{0,80}?targetKey: item\.selectId/.test(view)
    && /onAddPartner\(/.test(view),
    "群 @ 面板列出专家库（没入群的专家），点选先加入本群再点名（⛔ 不再只能 @ 已加过的几个人）");
  ok(/filter\(\(item\) => !\(item as \{ library\?: boolean \}\)\.library\)/.test(view),
    "⛔ 专家库条目不进候选目标表（否则手打库里的名字会让发送键亮起、主进程却找不到这个群成员）");
  const createSrc = read("src/features/harness-team/12-team-create.tsx");
  ok(/expert: new Set\(\["expert", "member"\]\)/.test(settings)
    && /expert: new Set\(\["expert", "member"\]\)/.test(createSrc),
    "「添加伙伴 → 专家模式」与「创建群初始伙伴」都列出团成员（⛔ 两个入口各写一份筛选，必须同口径）");
  ok(/专家库：/.test(pickTest),
    "专家库分组有单测（在群的团 / 已加过的专家不重复列）");
}

/* ── ⑬e 群聊一回合一条成品消息（11-09 用户令：「每步一个新消息刷屏」「跟主对话一模一样」）── */
{
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  ok(!/method === "item\/completed"[\s\S]{0,900}?appendMessageTo\(group\.id/.test(ipc)
    && /const duplicateRow = spokenRows/.test(ipc)
    && /summary: true,/.test(ipc) && /runFirst: true,/.test(ipc),
    "⛔ 一个回合只落一条成品消息（撤回逐条落盘）：正文/过程/文件卡由渲染层按**回合**整体渲染");
  ok(/const duplicateRow = spokenRows[\s\S]{0,900}?patchTalkMessageRow\(group\.id, duplicateRow\.id, \{[\s\S]{0,160}?summary: true/.test(ipc),
    "最终回复已通过 group_say 落过 ⇒ 不再发第二条，把它标成 summary 并回填用量");
  ok(/const runCollapsedRows = useMemo/.test(view)
    && /const useTurnView = isBot && effectiveReplyMode !== "placeholder"/.test(view)
    && /<TeamTurnView/.test(view) && /onOpenReview=\{openReviewPanel\}/.test(view),
    "伙伴回复整轮复用主对话 TurnView（深度思考/步骤/正文/文件卡/页脚）；老群记录按回合收口只渲染末条");
  /* ⛔ 11-09 用户令：「群设置加一个对话流开关，默认折叠，点击展开后运行中就展开流程」：
     默认 simple（运行中过程折叠、点标题展开）；detail 才铺开。⛔ 收尾后的整轮折叠不变。 */
  const settingsUi = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  ok(/data-section="dialog-flow"/.test(settingsUi) && /data-group="dialog-flow"/.test(settingsUi)
    && /onDialogFlow\(opt\.value\)/.test(settingsUi)
    && /set-dialog-flow/.test(ipc) && /saveDialogFlow/.test(codeOnly(read("src/features/harness-team/02-team-store.ts")))
    && /effectiveDialogFlow === "detail" \? "detailed" : "simple"/.test(view)
    && /defaultOpen=\{defaultOpen\}/.test(codeOnly(read("src/features/harness-team/09-team-process.tsx"))),
    "对话流开关（默认折叠）：detail 时运行中过程才默认展开；simple 走折叠、点标题展开");
  /* ⛔ 11-09 用户令：「群聊有任务在跑时，关工作伙伴窗口要弹确认；没在跑不提示」。 */
  const wc = codeOnly(read("src/components/WindowControls.tsx"));
  const closeGuard = codeOnly(read("src/features/harness-team/30-team-close-guard.tsx"));
  ok(/runWindowCloseGuard\(\)/.test(wc) && /registerWindowCloseGuard/.test(closeGuard)
    && /isTeamPopoutWindow\(\)/.test(closeGuard) && /activeGroupIds\(busyByGroup, liveByGroup\)/.test(closeGuard)
    && /<TeamCloseGuard busyByGroup=\{busyByGroup\} liveByGroup=\{liveByGroup\} \/>/.test(codeOnly(read("src/features/harness-team/index.tsx"))),
    "群有任务在跑 ⇒ 关工作伙伴窗口先弹确认；没在跑直接关（守卫只拦窗口钮这一次点击）");
  /* ⛔ 11-09 用户截图：QwenPaw 的回复是一坨 `{status, elapsed_seconds, response, usage}` JSON
     ⇒ 本地 CLI 直跑的 stdout 必须先把文本字段剥出来再当群回复（JSON 也不上屏流式）。 */
  const cliDirect = codeOnly(read("electron/features/group-talk/04-cli.ts"));
  ok(/function unwrapCliStdout/.test(cliDirect) && /"response"/.test(cliDirect)
    && /function pickText/.test(cliDirect) && /stripAnsi/.test(cliDirect) && /function tryJson/.test(cliDirect)
    && /unwrapCliStdout\(out\.trim\(\) \|\| errOut\.trim\(\)\)/.test(cliDirect)
    && /startsWith\("\{"\)/.test(cliDirect),
    "本地 CLI 输出先剥机器可读信封（QwenPaw 的 {status,…,response} / OpenClaw --json / Comate 事件流 NDJSON + ANSI），再当回复");
  /* ⛔ 11-09 审查（Required）：① CLI 直跑是本机子进程 ⇒ 「停止」必须能真杀（引擎 turn/interrupt 管不到）；
     ② stdout 要有上限（事件流刷屏会吃内存）；③ 群中途被删不许写孤儿消息。 */
  ok(/function killTalkCliRuns/.test(cliDirect) && /activeChildren/.test(cliDirect)
    && /MAX_OUT/.test(cliDirect) && /scopeId/.test(cliDirect)
    && /killTalkCliRuns\(String\(input\?\.groupId/.test(codeOnly(read("electron/features/harness-team-stop.ts")))
    && /groupGone/.test(ipc),
    "CLI 直跑可被「停止」真杀 + stdout 有上限 + 群被删不写孤儿消息");
  ok(/phase === "item-start" \|\| phase === "item-done"/.test(store),
    "一条正文开始/完成 ⇒ 流式卡清空，下一条重新逐字上屏（⛔ 不叠在已落盘消息上）");
  ok(/!isBot && \([\s\S]{0,400}?<MessageFooter/.test(view) && /team-msg__footer/.test(view)
    && /onQuote=\{\(\) => quoteRow\(row\)\}/.test(view) && /onEdit=\{\(\) => editRow\(row\)\}/.test(view),
    "用户消息下面复用主对话 MessageFooter（引用 / 编辑 / 收藏 / 复制，⛔ 不在群里另写一套按钮）");
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
  /* ⛔ 11-09：签名改成多行（新增第 6 个 `topic`），判据改为「history 仍是第 5 个 + topic 可选」。 */
  ok(/history: TalkHistoryRow\[\] = \[\],/.test(talk) && /topic\?: \{ rootText\?: string \} \| null,/.test(talk),
    "注入是 buildTalkInput 的第 5 个参数、话题上下文是第 6 个（两条投递链共用同一份口径）");
  /* ⛔ 11-08 审查：runGroupTalk 整段死代码（派活搬进主进程后无调用方）已删 ——
     投递主链只剩 harness-team-ipc 一条，⛔ 不许再长出第二套口径。 */
  ok(!/runGroupTalk/.test(talk) && !/runGroupTalk/.test(outlet)
    && /runTalkTurn/.test(ipc) && /readGroupHistory\(TALK_HISTORY_LIMIT\)/.test(ipc),
    "runGroupTalk 死代码已删（接力主链只在 harness-team-ipc；⛔ 不再并存两套投递口径）");
  /* ⛔ 11-08：group_read 现在在 hook 里做单条/总量截断，但仍必须直读**同一份** readGroupHistory。 */
  ok(/readGroupHistory\(TALK_HISTORY_LIMIT\)/.test(ipc)
    && /readMessages: \(limit: number\) => Promise\.resolve\(\(\(\) => \{[\s\S]{0,80}?const rows = readGroupHistory\(limit\);/.test(ipc),
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
  ok(/^layout>message-form>dialog-flow>(admin>)?partners>memory>/.test(sectionOrder),
    "群设置常用置顶：消息排版 → 群消息形式 → 对话流 →（群管理员）→ 伙伴 → 群记忆…（低频项下沉；快捷指令段已删）");
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
  /* ⛔ 11-09：运行中卡改成三元（process ? 整轮 TurnView : 只挂「正在思考…」）——
     占位分支**不许**再渲染 run.text。 */
  ok(/effectiveReplyMode === "process" \? \(/.test(viewSrc)
    && /<p className="team-msg__thinking">正在思考…<\/p>/.test(viewSrc)
    && !/\} : \([\s\S]{0,160}?run\.text/.test(viewSrc),
    "占位模式不显示流式正文（流式卡跟着回复模式分叉）");
  ok(/res\?\.ok \|\| res\?\.reason === "idle"/.test(storeSrc),
    "停止返回 idle 也复位 busy/live（⛔ 原来只在 ok 时清，停止键会卡死）");
  /* ⛔ 11-08 用户：「复用一套主对话框的滚轮和自动滚轮最新消息」「群记录懒加载」。 */
  ok(/const followRef = useRef\(true\)/.test(viewSrc) && /awayFromBottom && \(/.test(viewSrc)
    && /className="jump-bottom"/.test(viewSrc) && !/stickRef\.current/.test(viewSrc),
    "群聊复用主对话滚轮语义：滚上去不拽回、点 .jump-bottom 恢复跟随（同一套皮肤与判据）");
  ok(/new ResizeObserver\(schedule\)/.test(viewSrc) && /if \(followRef\.current\) stick\(\)/.test(viewSrc),
    "流式内容长高时自动滚到最新（主对话同口径，⛔ 不再只等 rows 变长）");
  ok(/setVisibleCount\(\(v\) => Math\.min\(rows\.length, v \+ PAGE\)\)/.test(viewSrc)
    && /scrollToOffsetInstant\(node, node\.scrollHeight - prevH \+ prevTop\)/.test(viewSrc),
    "群记录懒加载：首屏 PAGE 条 + 滚到顶补一页，且加载后保持滚动位置（⛔ 不留跳变）");
}

/* ── ⑰ Code review 回归（11-08）─────────────────────────────────────────── */
{
  const fold = codeOnly(read("src/lib/team-fold.mjs"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/export function topicThreadOf/.test(fold) && /displayRow\?\.continued/.test(fold)
    && /topicThreadOf\(topicThreads, row\)/.test(view) && /openTopicRow/.test(view) && /topicThreadOf\(topicThreads, openTopicRow\)/.test(view),
    "⛔ 话题条按渲染行取数：`mergeConsecutive` 合并连发消息后，continued 子行的回复不许丢（Code review 实测复现）");
  ok(!/effectiveMessageForm === "topic" \? \[\] : runningPartnersOf/.test(view)
    && !/effectiveMessageForm !== "topic" && \(/.test(view),
    "群消息形式与回复模式正交：话题模式下照样有运行反馈（⛔ 不要把用户晾着）");
  ok(/test\("topicThreadOf：合并行/.test(read("tests/team-fold.test.mjs")),
    "合并行话题不丢有单测真值表");
}

/* ── ⑱ 11-08 Code review 确认修复（输入法 / 光标 / 粘贴 / 序列化 / 引用派活 / bot 合并）── */
{
  const composer = codeOnly(read("src/features/harness-team/10-team-composer.tsx"));
  const editor = codeOnly(read("src/lib/team-composer-editor.ts"));
  const models = codeOnly(read("src/lib/team-models.mjs"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/composingRef\.current = true/.test(composer) && /onCompositionStart=/.test(composer)
    && /onCompositionEnd=/.test(composer) && /if \(composingRef\.current\) return;/.test(composer),
    "输入法组合期不重建 DOM（⛔ 组合期重绘 = 候选词丢失、中文被打断）");
  ok(/const caret = editorCaret\(el\)/.test(composer)
    && /setEditorCaret\(el, Math\.min\(caret, editorValue\(el\)\.length\)\)/.test(composer)
    && !/setEditorCaret\(el, editorValue\(el\)\.length\)/.test(composer),
    "重绘后恢复原光标（⛔ 原来一律扔到末尾 = 用户「打字光标乱跳」）");
  ok(/const sigChanged = mentionSigRef\.current !== sig/.test(composer) && /if \(!sigChanged\) return;/.test(composer),
    "打字路径不重建 DOM：只有名字/头像表变了才为重绘 chip 动一次");
  ok(/e\.preventDefault\(\);[\s\S]{0,260}?getData\("text\/plain"\)[\s\S]{0,160}?execCommand\("insertText"/.test(composer),
    "普通文字粘贴只取 text/plain（⛔ 浏览器默认塞 HTML：图片丢失、别处的 chip 变真 @ 误派活）");
  ok(/lastIsBr/.test(editor) && /if \(!lastIsBr\) out \+= "\\n"/.test(editor),
    "序列化不重复计换行（`<div><br></div>` 空行翻倍的根因）");
  ok(/prev\.authorKind !== "bot" && r\.authorKind !== "bot"/.test(models),
    "⛔ bot 行不参与连发合并（合并会吞掉引用行 / 文件卡 / 来源 / 用量）");
  ok(/mentionTargetsInText\(text\.replace\([\s\S]{0,80}?\), mentionCandidatesFlat\)/.test(view),
    "⛔ 引用行（`> …`）不参与 @ 派活：引用一条写着 @某人 的消息不会静默派活");
}

/* ── ⑲ 群内互相 @ 协议（11-08 用户实测：成员回「生图专家 哈喽~」不带 @，对方一直不吭声）──
   用户原话：「好家伙，他们都不知道沟通要互相 @ 才行」。
   判据：成员提示词里有独立的协议段（行首 `@名字：` 或 group_say(to=) 二选一），
   并把失败模式写死（只写名字 = 对方收不到）；group_say 描述同样要说清不填 to 的后果。 */
{
  const talk = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  const tools = codeOnly(read("electron/features/group-talk/02-tools.ts"));
  ok(/【群聊沟通协议 · 必须遵守】/.test(talk)
    && /另起一行、行首/.test(talk) && /必须带 `@` 和冒号/.test(talk)
    && /收不到、也不会回你/.test(talk),
    "成员提示词：独立「群聊沟通协议」段（行首 @名字：/ group_say(to=) 二选一，只写名字不算）");
  ok(/不填 to 只有用户看得到，其他成员不会因此回你/.test(tools),
    "group_say 工具描述写清「不填 to = 其他成员不会回你」");
}

/* ── ⑳ 删群联动（11-08 用户实测：群删了、伙伴会话还挂在侧栏，「联动性太差了」）──────
   旧实现只按「群消息里出现过的 threadId」删会话 —— 聊天记录清空过就一条都删不到；
   归属的权威来源是群聊台账 `group-talk-threads.json`。 */
{
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  ok(/listTalkThreads\(\)\.filter\(\(row\) => row\.groupId === gid\)/.test(ipc)
    && /const \{ removed, failed \} = await deleteEngineThreads\(threads\)/.test(ipc)
    && /const removedIds = threads\.filter\(\(tid\) => !failedSet\.has\(tid\)\)/.test(ipc)
    && /forgetTalkThreads\(removedIds\)/.test(ipc)
    && /cleanupThreadArtifacts\(removedIds\)/.test(ipc),
    "删群：会话清单 = 群消息里的 threadId ∪ 台账里本群的会话；只清**删成功**的台账（删失败的留着下次自愈重试）");
  ok(/async function healOrphanTalkThreads/.test(ipc)
    && /if \(!existsSync\(file\)\) return;/.test(ipc)
    && /catch \{ return; \}/.test(ipc)
    && /void healOrphanTalkThreads\(\)\.catch/.test(ipc),
    "一次性自愈：群档案缺失/损坏时**不动手**（防误删），有效档案下清掉孤儿台账并删会话");
  /* ⛔ 两处都要广播（删群 + 自愈）—— 只留一处时另一条路径的标签要等 8s 轮询才掉。 */
  ok((ipc.match(/team-talk-threads-changed/g) || []).length >= 2
    && /team-talk-threads-changed/.test(read("src/lib/team-talk-threads.mjs")),
    "删群/自愈后广播 team-talk-threads-changed，侧栏「伙伴」标签即时刷新");
  /* ⛔ 11-08 反向联动（用户问「伙伴会话在外面删了，群里还在吗」）：删会话 ⇒ 台账条目也要清，
     否则下次 @ 会先 resume 一条已删除的会话（白跑一次）；群消息保留并标「来源 · 已删除」。 */
  ok(/if \(event\.method === "thread\/deleted" && forgetTalkThreads\(\[goneId\]\)\)/.test(codeOnly(read("electron/features/boot.ts")))
    && /type: "team-thread-gone"/.test(codeOnly(read("electron/features/boot.ts"))),
    "反向联动：会话在侧栏被删 ⇒ 群聊台账清条目 + 群消息标「已删除」（⛔ 不白跑 resume、不丢群记录）");
}

/* ── ㉑ 11-08 审查确认修复（派活假成功 / 用量页脚重复 / 删群竞态 / 信封消毒）────── */
{
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const talk = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  /* ⛔ 11-10：「每人一轮只能一次（ranIds）」已改成「每人最多 N 回合（canRun）」
     —— 判据随之从"说过话"改为"到回合上限"，语义仍是「不能再叫了要如实回失败」。 */
  ok(/if \(!canRun\(to\.id\)\)/.test(ipc) && /到上限了/.test(ipc),
    "group_say(to=) 送到本轮已到回合上限的成员时回失败（⛔ 不再假报「已经说给他了」而群里毫无反应）");

  /* ⛔⛔ 11-10 用户现场（截图「就这种垃圾？」「群成员连自己是谁都不知道」）：
     贴一整段任务书进群 ⇒ 正文里的 `@落纸`、`@砚云` 被**全文扫描**成派活目标 ⇒
     几个人同时被唤起、各自都说"这不是我的活"，群里一个人都不动。
     ⇒ 派活目标只认**行首 @**（与主进程 parseAgentMentions 同一口径），这里真跑五种输入。 */
  {
    const cands = [
      { selectId: "a", name: "文枢" },
      { selectId: "b", name: "落纸" },
      { selectId: "c", name: "砚云" },
    ];
    const runs = [
      ["@文枢 干活", ["a"], "行首 @ = 派给他"],
      ["@文枢 【任务书】第 2 轮：@落纸 先给选题，@砚云 写正文", ["a"], "任务书里的行中 @ 不算派活（⛔ 全扫会叫起一堆人）"],
      ["@文枢 派活\n@落纸 选题", ["a", "b"], "多行行首 @ = 派多人"],
      ["我 @落纸 帮我看下这句", ["b"], "没有行首 @、但只提到一个人 ⇒ 仍认他（点选插在句中）"],
      ["行中提 文枢 但没 @ 符号", [], "没 @ 符号不算"],
    ];
    const bad = runs.filter(([t, want]) => JSON.stringify(mentionTargetsInText(t, cands)) !== JSON.stringify(want));
    ok(bad.length === 0,
      `派活目标只认行首 @（任务书里的 @ 不误派；唯一命中仍认）${bad.length ? `（不符：${bad.map(([t]) => JSON.stringify(t.slice(0, 18))).join("、")}）` : " —— 五种输入全符合"}`);
  }

  /* ⛔ 团主理人必须知道「自己是谁」：群里只有一个团槽（名字是团名），
     UI 却展开成人名 ⇒ 不注入真名，它会说"这是文枢的活，我不抢"。 */
  ok(/teamLeadName/.test(talk) && /就是在叫你，不是在叫别人/.test(talk),
    "⛔ 团主理人身份注入真名 + 「用户 @你就是叫你」（⛔ 否则它把自己当旁观者）");
  /* ⛔ 团群没有 adminId ⇒ 只认 isAdmin 的话，主持人指令与闭环回喂都永远不生效。 */
  ok(/me\.isAdmin === true \|\| me\.teamRole === "lead"/.test(talk),
    "⛔ 团主理人也算主持人（团群没有管理员，只认 isAdmin 会导致主持指令不生效）");
  ok(/roster\.find\(\(m\) => m\.teamRole === "lead"\)/.test(ipc),
    "⛔ 闭环回喂兜底到团主理人（团群 adminId 恒空 ⇒ 原来链断在成员最后一句）");
  ok(/effectiveIds = \[teamSlot\.id\]/.test(ipc),
    "⛔ 团群里 @ 团内成员收敛到团（由主理人派单，⛔ 不是全员并行各说一句「我不抢」）");
  /* ⛔ 判据锚「两处具体清除点」—— 不能数 `finishedTalkRuns.delete(` 总数：
     淘汰最旧条目那行也是 delete，会把「本轮不清」掩盖成绿。 */
  ok(/finishedTalkRuns\.delete\(tid\);/.test(ipc)
    && /finishedTalkRuns\.delete\(threadId\);/.test(ipc),
    "新一轮开跑/排队拿到 threadId 时摘掉上一轮用量收尾标记（⛔ 否则同一成员 10 分钟内再跑，页脚会挂两遍）");
  ok((ipc.match(/groups\.some\(\(g\) => String\(g\.id\) === String\(group\.id\)\)/g) || []).length >= 2,
    "迟到/排队中的派活在群被删后放弃，并把刚建出来的会话删掉（⛔ 不留孤儿「伙伴」会话）");
  ok(/sanitizeForEnvelope\(String\(row\.speaker/.test(talk)
    /* ⛔ 11-10：名册改成逐字段拼装（名字/职业/团内位置/管理员各消毒一次），判据跟着换写法。 */
    && /sanitizeForEnvelope\(m\.name\)/.test(talk)
    && /sanitizeForEnvelope\(String\(t\)\)/.test(talk)
    && /sanitizeForEnvelope\(options\.groupName\)/.test(talk)
    && /sanitizeForEnvelope\(String\(options\.memory\)\)/.test(talk),
    "成员名 / 群名 / 共享背景与正文同口径过信封消毒（⛔ 只有正文消毒时，名字能截断信封）");
  /* ⛔⛔ 11-10 用户「成员都不知道哪个是管理员，成员都互相不认识」：身份必须随名册下发，
     prompt 名册 / group_members / 群设置标签 / group_say 别名共用同一份，⛔ 不许只改 UI。 */
  ok(/m\.isAdmin/.test(talk) && /isAdmin/.test(ipc)
    && /isAdmin/.test(codeOnly(read("electron/features/group-talk/01-channel.ts")))
    && /管理员/.test(read("src/features/harness-team/03-team-settings.tsx"))
    && /别名|aliasAdmin/.test(ipc),
    "管理员身份随名册下发（prompt / group_members / UI 标签 / group_say 别名同一份）");
  /* ⛔ 11-08 用户问「群里超长上下文怎么办」：三层防护各一条判据。 */
  const chan2 = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  ok(/const turnError = completed\?\.error \?\? null;/.test(chan2)
    && /code = stop\.kind === "contextWindowExceeded" \? "TALK_CONTEXT_EXCEEDED"/.test(chan2),
    "群聊回合「completed 但带 error」按失败抛中文原因（⛔ 旧实现只显示一条空白回复）");
  ok(/if \(!isContextExceeded\(error\)\) throw error;/.test(chan2)
    && /forgetTalkThreads\(\[threadId\]\)/.test(chan2)
    && /thread\/delete", \{ threadId \}/.test(chan2)
    && /await ensureTalkThread\(groupId, member/.test(chan2),
    "上下文超限自愈：清台账 + 删旧会话 + 新建后重试一次（群历史/身份每轮重新注入，不会失忆）");
  ok(/slice\(0, 1200\)/.test(ipc) && /12_000/.test(ipc),
    "group_read 单条 1200 字 / 总量 12000 字封顶（⛔ 否则 limit=50 一条工具结果就能撑爆会话）");
  ok(/clean\.length > 8000/.test(talk),
    "单条群消息进会话前 8000 字封顶（成员互相投递的是长输出，不封顶单条就能撑爆）");
}

/* ── ㉒ 11-08 用户实测：连按回车发出多条 / 停止报「还没有它的会话」 ───────────── */
{
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const stopSrc = codeOnly(read("electron/features/harness-team-stop.ts"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  ok(/if \(sendingRef\.current\) return/.test(view) && /sendingRef\.current = true;/.test(view)
    && (view.match(/sendingRef\.current = false;/g) || []).length >= 3
    && /if \(e\.repeat\) return;/.test(view),
    "发送：同步 ref 闸门（三条返回路径都释放）+ 忽略键盘自动重复（⛔ 连按回车不再发多条一样的）");
  ok(/if \(gid\) \{\s+const rows = listTalkThreads\(\)\.filter\(\(row\) => row\.groupId === gid\);/.test(stopSrc)
    && /memberName, groupId }/.test(store) && /stopAll: true, groupId/.test(store),
    "停止候选并上**群聊台账**（⛔ 第一条消息落盘前也能停；不再报「还没有它的会话」）");
  ok(/requestTalkCancel\(String\(input\.groupId\), String\(input\.memberName\)\)/.test(stopSrc)
    && /if \(consumeTalkCancel\(group\.id, partner\.name\)\)/.test(ipc)
    && /reason: "starting"/.test(stopSrc),
    "会话还在建时点停止 = 登记取消请求，runOne 开跑前整轮放弃（中性状态，不弹红字）");
  ok(!/还没有它的会话（先派一次活）/.test(stopSrc),
    "⛔ 「还没有它的会话（先派一次活）」不再作为错误返回（用户点的是停止，不是派活）");
}

/* ── ㉓ 11-08 用户实测「群设置几个切换切起来很卡」────────────────────────── */
{
  const settings = codeOnly(read("src/features/harness-team/03-team-settings.tsx"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const css = read("src/styles/61-team-mode.css");
  ok(/export function TeamViewModeSettings/.test(settings)
    && /export const TeamSettings = memo\(TeamSettingsImpl/.test(settings)
    && /<TeamViewModeSettings/.test(view) && /<div className="team-settings">/.test(view),
    "三个视图开关拆成独立小组件（同滚动容器外层），其余区块走 memo：切开关不再整页重渲染");
  ok(/\.team-settings__block\s*\{[^}]*content-visibility:\s*auto/.test(css),
    "设置区块的屏外内容跳过 layout/paint（打开面板不再一次性排完 8 个区块）");
  ok(/const displayRows = useMemo\(/.test(view),
    "消息投影按依赖记忆（切设置等无关重渲染不再重算）");
}

/* ── ㉔ 11-09 用户截图：伙伴会话在外面仍显示 Codex / 被识别成中枢会话 ─────────────
   两条要求：① 群聊里的名字/头像实时同步给外面的伙伴会话（历史回合也跟随，不用刷新）；
             ② 伙伴会话永远不是中枢会话（误登记要能自愈）。 */
{
  const models = codeOnly(read("src/lib/team-models.mjs"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const registry = codeOnly(read("electron/boss-groups/session-registry.ts"));
  const talkStore = codeOnly(read("src/lib/team-talk-threads.mjs"));
  const bossStore = codeOnly(read("src/features/boss-group-view/boss-threads-store.mjs"));
  const sidebar = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));
  const timeline = codeOnly(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"));
  const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
  const barrel = codeOnly(read("src/features/harness-team/index.tsx"));
  const manifest = read("electron/ipc-channels.manifest.json");

  ok(/export function talkPartnerIdentity\(row, group, catalog = \[\]\)/.test(models)
    && /name: String\(member\?\.name \?\? row\?\.name \?\? ""\)/.test(models)
    && /avatar: String\(member\?\.avatar \?\? group\?\.avatars\?\.\[memberId\] \?\? ""\)/.test(models)
    && /const isLead = Boolean\(parsed && !inCatalog\("member"\) && leadEntry\)/.test(models)
    && /targetKey: String\(leadEntry\?\.key \?\? ""\)/.test(models),
    "伙伴身份按**群成员当前名字/头像**解析（⛔ 不用台账快照）；主理人用目录 lead.key，⛔ 不是裸 memberId");
  ok(/\.\.\.talkPartnerIdentity\(row, group, catalog\)/.test(ipc)
    && /buildDispatchCatalog\(\)/.test(ipc)
    && /groupName: String\(group\?\.name \?\? ""\)/.test(ipc)
    && /unregisterBossSessionQuiet\(row\.threadId\)/.test(ipc),
    "talk-threads 下发伙伴身份 + 顺手摘掉误登记的中枢身份（私聊头像 seed 要带调度目录）");
  ok(/broadcastHarnessEvent\(\{ type: "team-talk-threads-changed"/.test(
      ipc.slice(ipc.indexOf('ipcHost.handle("harness-team:set-avatar"'), ipc.indexOf('ipcHost.handle("harness-team:set-avatar"') + 900)),
    "群内换头像后广播身份刷新（⛔ 等 8s 轮询 = 用户眼里的「不同步」）");
  const quiet = registry.match(/export async function unregisterBossSessionQuiet[\s\S]*?\n\}/)?.[0] ?? "";
  ok(Boolean(quiet) && !/fs\.rm|bossMemoryWorkspace/.test(quiet),
    "静默摘身份不删记忆目录（误登记期间存的正是这位伙伴的记忆）");
  ok(/harnessTeamTalkThreads\?\./.test(bossStore)
    && /const notTalk = \(id\) => Boolean\(id\) && !talkIds\.has\(id\)/.test(bossStore)
    && /cachedIds = cachedAll\.filter\(notTalk\)/.test(bossStore)
    && /sessionMemoryDirs\[id\] = dir/.test(bossStore),
    "中枢 store 在**渲染期**过滤伙伴会话（名单 / boss 线程 / 成员会话 / 记忆目录 / localStorage 缓存）");
  ok(/if \(!boss\.pending \|\| isPartner\)/.test(sidebar)
    && /getTeamTalkThreads\(\)\.byId\[currentThreadId\]/.test(sidebar),
    "中枢登记守卫：过渡态已清 / 目标是伙伴会话 ⇒ 不登记（⛔ 点中枢后改点会话会把对方登记成中枢）");
  ok(/const partnerRow = thread\?\.id \? \(talkThreads\.byId\[thread\.id\] \?\? null\) : null/.test(timeline)
    && /assistantName=\{partnerRow\?\.name \|\| undefined\} assistantAvatar=\{partnerAvatar \?\? undefined\}/.test(timeline)
    && /partnerRow\?\.name \|\| codexIdentity\.name/.test(timeline),
    "主时间线按伙伴台账传回合头身份（含乐观头）；历史回合渲染期解析 = 不刷新也跟随");
  ok(/assistantAvatar \?\? <CodexAvatar size=\{22\} \/>/.test(turnView)
    && /assistantName \|\| codexName/.test(turnView)
    && /prev\.assistantName === next\.assistantName/.test(turnView)
    && /prev\.assistantAvatar === next\.assistantAvatar/.test(turnView),
    "TurnView 用伙伴名字/头像（两处回合头 + memo 比较器跟着比）");
  ok(/export \{ MemberAvatar \} from "\.\/13-team-avatar";/.test(barrel)
    && /import \{ MemberAvatar \} from "\.\.\/\.\.\/\.\.\/harness-team";/.test(timeline),
    "头像组件走群板块 barrel 复用（⛔ 外面另写一套 preset/图集映射）");
  ok(manifest.includes('"name": "harnessTeamTalkThreads"')
    && manifest.includes("avatar: string; kind: string; targetKind: string; targetKey: string; groupName: string"),
    "manifest 返回类型与实现同步（⛔ 手改生成物）");
}

/* ── ㉕ 11-09 用户实测：运行过程会闪 / 收尾文件卡不出现 / 群里没复用滚轮自动跟随 ── */
{
  const proc = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  const cards = codeOnly(read("src/features/harness-team/11-team-cards.tsx"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const ticks = codeOnly(read("src/lib/team-process-ticks.mjs"));
  ok(/const first = loadedForRef\.current !== threadId;/.test(proc)
    && /if \(first\) \{/.test(proc)
    && /!list\.length \? turnsRef\.current : list/.test(proc),
    "过程/汇总重拉不卸载：只有首次/换会话进 loading，拉到空表保留上一份（⛔ 每 tick 闪、收尾文件卡消失的根因）");
  ok(/bumpTeamTurnsSettled\(tid\)/.test(store)
    && /const fresh = Date\.now\(\) - Number\(at\) < 120_000;/.test(cards)
    && /turnsCache\.delete\(threadId \+ ":8"\)/.test(proc)
    && /settledChanged \|\| refresh/.test(proc),
    "收尾文件卡即时出现：finished 结算 bump 回合缓存 + 刚结束的消息绕缓存（⛔ 关窗重进才出来）");
  ok(/selfScrollUntilRef/.test(view)
    && /lastUserInputAtRef/.test(view)
    && /followRafRef/.test(view)
    && /event\.deltaY < 0/.test(view)
    && /dist > el\.clientHeight \* 0\.25/.test(view)
    && /new MutationObserver\(schedule\)/.test(view)
    && !/syncFollow/.test(view),
    "群聊复用主对话滚动语义：程序滚动抑制窗 + 上滚先解除并取消待贴底 + 25% 迟滞 + 观察内容增长（⛔ 旧版观察的是滚动容器）");
  ok(/const activeRunKeys = useMemo/.test(view)
    && /const running = activeRunKeys\.has\(row\.key\);/.test(view),
    "「处理中」只标当前轮最后一条（⛔ 历史正文不再跟着亮处理中）");
  ok(/bumpTeamTurnsSettled/.test(ticks) && /getTeamTurnsSettled/.test(ticks) && /subscribeTeamTurnsSettled/.test(ticks),
    "回合结算计数 store 独立于过程 tick（历史卡不会被运行中的高频 tick 吵醒）");
}

/* ── ㉖ 11-09 审查确认：停止请求残留会静默吞掉下一条消息（60 秒窗口）────────────── */
{
  const stopSrc = codeOnly(read("electron/features/harness-team-stop.ts"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  ok(/export function clearTalkCancel/.test(stopSrc)
    && /for \(const target of targets\) clearTalkCancel\(group\.id, target\.name\);/.test(ipc),
    "新消息落盘即作废该成员的停止请求（⛔ 残留请求会把新消息在队列里静默吞掉：有气泡、没人回）");
  ok((ipc.match(/consumeTalkCancel\(group\.id, partner\.name\)/g) || []).length >= 2,
    "建会话后再补一次消费（ensure 那 1~3 秒里点的停止也真放弃，而不是「已停止」却照发）");
}

/* ── ㉖ 11-09 用户令：成员改名联动 / 文件灯箱 / 主侧边栏弹窗 ───────────────── */
{
  const models = codeOnly(read("src/lib/team-models.mjs"));
  const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const chan = codeOnly(read("electron/features/group-talk/01-channel.ts"));
  const store = codeOnly(read("src/features/harness-team/02-team-store.ts"));
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const card = codeOnly(read("src/features/harness-team/14-team-profile-card.tsx"));
  const sideDlg = codeOnly(read("src/features/harness-team/28-team-side-panel.tsx"));
  const barrel = codeOnly(read("src/features/app-view/components.ts"));
  const status = codeOnly(read("src/features/status/Status.tsx"));
  const cssCards = read("src/styles/04-cards-tools.css");
  const cssTeam = read("src/styles/61-team-mode.css");
  const proc = codeOnly(read("src/features/harness-team/09-team-process.tsx"));
  ok(/export function renameMember\(group, memberId, name\)/.test(models)
    && /reason: "duplicate"/.test(models),
    "成员改名纯函数：空名/重名拒绝（⛔ 重名会让 @名字 解析歧义）");
  ok(/harness-team:rename-member/.test(ipc)
    && /renameTalkMember\(String\(groupId\), String\(memberId\)/.test(ipc)
    && /type: "harness-team-groups"/.test(ipc),
    "改名落群档案 + 联动伙伴会话标题 + 广播群档案刷新（其它窗口同步）");
  ok(/export async function renameTalkMember\(/.test(chan)
    && /thread\/name\/set/.test(chan),
    "伙伴会话标题跟随新名字（引擎通知侧栏即时改）");
  ok(/const renameMember = useCallback/.test(store)
    && /event.type === "harness-team-groups"/.test(store),
    "store 接线改名 + 其它窗口收到群档案刷新（消息署名/@ 候选重算）");
  ok(/改名字/.test(card) && /onRename/.test(card) && /onRenameMember/.test(view),
    "资料卡就地改名（团成员/人类不提供：显示名另有来源）");
  ok(/onOpenFile=\{openFilePreview\}/.test(view)
    && /subscribeRightFile/.test(view)
    && /openRightFile\(path\)/.test(view)
    && !/TeamFilePreviewDialog/.test(view),
    "文件卡/产物卡/过程文件卡/正文引用统一进右侧栏「文件」页（⛔ 不再用居中大弹窗）");
  ok(/AppViewReviewPanel/.test(sideDlg) && /rightOpen: true/.test(sideDlg)
    && /workspace: resolvedWorkspace/.test(sideDlg)
    && /export function TeamSidePanel\(/.test(sideDlg)
    && /<TeamSidePanel /.test(view)
    && /onClick=\{\(\) => setSideOpen\(\(v\) => !v\)\}/.test(view)
    && view.indexOf("PanelRight size={14}") > view.indexOf("PanelRightOpen size={14}")
    && view.indexOf("PanelRight size={14}") < view.indexOf("Settings2 size={14}"),
    "右侧栏复用主面板；开关紧跟成员栏开合键、在设置键左边（⛔ 居中大浮动弹窗）");
  ok(/export \{ AppViewReviewPanel \}/.test(barrel),
    "跨板块复用走 app-view 组件出口（⛔ 深链内部文件）");
  /* 11-09 用户纠正：「拖动是整个右侧边栏浮动展示，所以上下左右拖动」——
     ⛔ 不是贴边抽屉、也不是左缘拉宽：hold 标题栏整块平移，位置记住、双击归位。 */
  ok(/const startDrag = \(event: ReactPointerEvent<HTMLElement>\)/.test(sideDlg)
    && /onPointerDown=\{startDrag\}/.test(sideDlg)
    && /onDoubleClick=\{resetPos\}/.test(sideDlg)
    && /style=\{box \? \{ left: box\.x, top: box\.y, width: box\.w, height: box\.h \}/.test(sideDlg)
    && /POS_KEY/.test(sideDlg) && /localStorage\.setItem\(POS_KEY/.test(sideDlg)
    && /ResizeObserver/.test(sideDlg)
    && !/team-side-panel__resize/.test(sideDlg) && !/startResize/.test(sideDlg),
    "右侧栏 = 可上下左右拖动的浮动面板（标题栏拖动、位置记住、双击归位；⛔ 退回左缘调宽）");
  ok(/\.team-side-panel \{[\s\S]{0,220}?position: absolute;[\s\S]{0,220}?border-radius: 12px/.test(cssTeam)
    && /\.team-side-panel__head \{[\s\S]{0,220}?cursor: move/.test(cssTeam)
    && !/\.team-side-panel__resize/.test(cssTeam),
    "浮动窗样式：绝对定位 + 圆角浮层 + 标题栏 move 光标（⛔ 贴边抽屉的 right/bottom 写法）");
  /* ⛔⛔ 11-09 真机探针根因：引擎没加载群子会话时 thread/turns/list 返回空表
     （同一线程 resume 前 0 条、resume 后 4 条）⇒ 汇总卡永远挑不到回合、文件卡整块不见。 */
  ok(/function ensureThreadLoaded\(threadId: string\)/.test(proc)
    && /request\("thread\/resume", \{ threadId, excludeTurns: false \}\)/.test(proc)
    && /const task = ensureThreadLoaded\(threadId\)[\s\S]{0,160}?thread\/turns\/list/.test(proc),
    "群子会话先按需 resume 再拉回合（引擎未加载时 turns/list 恒为空）");
  ok(/const FRESH_TURN_OPTS = \{ maxGapMs: 3 \* 60_000, allowNewestFallback: false \}/.test(proc)
    && /refresh \? FRESH_TURN_OPTS : undefined/.test(proc)
    && /setRetryTick\(\(n\) => n \+ 1\)/.test(proc)
    && /retryTick >= 8/.test(proc),
    "刚结束的消息：收紧匹配 + 挑不到回合时限次重拉（⛔ 只拉一次就永远空着）");
  /* ⛔ 11-09 用户令「已编辑卡片里面的审查、上面的文件卡片点击都要接线右侧栏浮窗，现在联动性0」：
     审查 → 浮动侧栏「审阅」页（数据走同一份 turnReview store）；产物卡/文件行 → 「文件」页预览。 */
  const teamCards = codeOnly(read("src/features/harness-team/11-team-cards.tsx"));
  ok(/onReview=\{onReview\}/.test(teamCards)
    && /onReview=\{openReviewPanel\}/.test(view)
    && /const openReviewPanel = \(\) => \{[\s\S]{0,160}?setSideTab\("turn-review"\);[\s\S]{0,80}?setSideOpen\(true\)/.test(view)
    && /subscribeRightFile\(\(\{ path \}: \{ path: string \}\) => \{[\s\S]{0,160}?setSideTab\("tree"\)/.test(view),
    "汇总卡「审查」/ 文件行 → 浮动侧栏「审阅」；产物卡与正文文件引用 → 「文件」页（同一个浮动面板）");
  /* ⛔⛔ 11-09 用户实测「复制功能没用」：群里直接调 navigator.clipboard 在 file:// 独立窗口会被静默拒绝
     （还被 catch 吞掉）⇒ 必须走 lib/clipboard 的三级兜底（主进程 IPC 优先）。 */
  ok(/copyTextToClipboard/.test(view) && /copyTextToClipboard/.test(proc)
    && !/navigator\.clipboard/.test(view) && !/navigator\.clipboard/.test(proc),
    "群聊复制走三级兜底（主进程 IPC 优先）；⛔ 直接 navigator.clipboard（file:// 弹窗静默失败）");
  /* ⛔ 11-09 用户截图「页脚和追问/来源之间一大片空白」：群特有项接在主对话页脚同一行。 */
  const footerSrc = codeOnly(read("src/features/shared/MessageFooter.tsx"));
  const turnViewSrc = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
  ok(/extraFooter\?: ReactNode/.test(footerSrc) && /\{extraFooter\}/.test(footerSrc)
    && /extraFooter=\{extraFooter\}/.test(turnViewSrc)
    && /extraFooter=\{footerExtras\}/.test(view)
    && /isBot && !useTurnView && \(/.test(view),
    "群特有页脚项（追问 / 来源）接在主对话页脚**同一行**（⛔ 另起一行 = 页脚下方一大片空白）");
  ok(/setDiffHover\(null\); openReview\(file\.path\)/.test(status)
    && /\.turn-diff-modal-mask \{[\s\S]{0,160}?z-index: 1002/.test(cssCards),
    "「审查」不再被悬停预览压住：打开前收起 hover；弹窗层级 1002 > 悬停 1000");

  /* ── ㉗ 11-10 代码层硬约束（用户令「不能光靠模型自觉」）──────────────────
     ⛔ 边界：10-26 用户明确删掉停滞/待审看门狗 ⇒ 这一组同时钉「不许复活」。 */
  const ipcG = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const guardSrc = codeOnly(read("electron/features/group-talk/05-guardrails.ts"));
  const invokeG = codeOnly(read("electron/team-invoke.ts"));
  const barrelG = read("electron/features/group-talk/index.ts");
  ok(/export const GUARDRAIL_RULES/.test(guardSrc)
    && /export function evaluateMemberOutput/.test(guardSrc)
    && /textsAreNearDuplicate/.test(guardSrc)
    && /05-guardrails/.test(barrelG)
    && !/setInterval|setTimeout|watchdog|markStalled|markReviewStalled/.test(guardSrc),
    "硬约束是独立板块的纯函数 + 规则表可拓展（⛔ 不许夹定时器/看门狗）");
  ok(/evaluateMemberOutput\(/.test(ipcG)
    && /guard\.allowRelay/.test(ipcG)
    && /guard\.countsAsOutput/.test(ipcG)
    && /outputForStore/.test(ipcG),
    "每条产出收尾真过代码判据：重复结论不再接力 / 空产出不假装成功 / 汇报行剥出正文");
  ok(/【群里汇报】\$\{body\}/.test(ipcG) && /ANNOUNCE_RE/.test(read("src/lib/team-fold.mjs")),
    "prompt 承诺的「汇报行额外发到群主流」真落地（⛔ 不是只有注释）");
  ok(/mentionNotices/.test(ipcG) && /sys-guardrail:/.test(ipcG),
    "一行多 @ / 找不到的人 / 点自己 ⇒ 明确回执，不再静默失效");
  ok(/evaluateMemberOutput/.test(invokeG)
    && /status: guard\.countsAsOutput \? "done" : "failed"/.test(invokeG)
    && /派活未完成/.test(ipcG) && /本群推进人/.test(ipcG),
    "两条产出链共用同一判据；失败把「谁没交 + 谁推进」作为事实摆出来（不自动催办）");
  ok(!/markStalled|markReviewStalled|setInterval\([^)]*stall/i.test(ipcG),
    "⛔ 不复活停滞/待审看门狗（10-26 事故：回投刷爆消息队列，用户明确要求删除）");
}

/* ── 团队推进三件套（11-10 用户令「123 一起完成一套定制化升级」）────────────── */
{
  const ipcSrc = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const talkSrc = codeOnly(read("electron/features/group-talk/03-talk.ts"));

  ok(/managerName/.test(ipcSrc) && /managerName/.test(talkSrc),
    "⛔ 直属上级链：成员知道向谁汇报（团成员→主理人；普通群按 managerId）");
  ok(/先向它说明再做/.test(talkSrc),
    "卡住 / 要不到输入时先向上级说明 —— 不是沉默，也不是乱拉人");

  ok(/artifacts\/YYYYMMDD-<任务短名>\//.test(talkSrc) && /内容语义/.test(talkSrc),
    "⛔ 产物落盘约定：artifacts/YYYYMMDD-短名/ + 文件名写内容语义（用户：「文件里能看的东西最全」）");
  ok(/别把产物散在目录根下/.test(talkSrc),
    "⛔ 禁止把产物散在目录根下（一周后认不出哪个文件是哪次任务的）");
}

/* ── 异常落到责任人（11-10 用户令「继续补上缺口」）────────────────────────────
   豆包是「群里发总榜 + 点名到人」；我们没有私聊载体，方案是：标记 → 待办 → 对方开口自动关闭。
   ⛔ 这里**真跑**解析（不是 grep 源码），否则格式一改就静默失效。 */
{
  const duty = await import(pathToFileURL(join(ROOT, "src/lib/team-duty.mjs")).href);
  const cases = [
    ["异常：新链 21 点零成交\n【待处理 · 责任人：明策】", "明策", "全角冒号 + 分隔点"],
    ["【待处理:责任人:投盈】费率超线", "投盈", "半角冒号也认"],
    ["这条没有标记", null, "没有标记 ⇒ null（⛔ 不当成异常）"],
    ["【待处理 · 责任人：】空名字", null, "空责任人 ⇒ null（⛔ 不许登记成无主待办）"],
  ];
  const bad = cases.filter(([text, want]) => {
    const got = duty.parseDuty(text);
    return want === null ? got !== null : got?.owner !== want;
  });
  ok(bad.length === 0,
    `待处理标记解析：全角/半角冒号都认、无标记与空责任人返回 null${bad.length ? `（不符：${bad.map(([,, n]) => n).join("、")}）` : " —— 四种输入全符合"}`);

  ok(duty.dutyKeyOf("明策", "新链零成交").startsWith("明策::"), "待办去重键按「责任人 + 标题」生成（⛔ 防群头数字虚高）");

  const ipcDuty = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const talkDuty = codeOnly(read("electron/features/group-talk/03-talk.ts"));
  ok(/closeOpenTasksOf\(gid, authorId\)/.test(ipcDuty) && /registerResponsibleFrom\(gid/.test(ipcDuty),
    "⛔ 责任人开口 ⇒ 自动关闭它名下待办；它这条里点了别人 ⇒ 先关后登记（顺序反了会自己关自己）");
  /* ⛔ 11-11：待办按**发言人身份**取（@整团 与 @主理人是同一个人 ⇒ 同一个键），
     判据是"本人名下待办注入到它自己的会话"，不是那个字面 id。 */
  ok(/openDutiesOf\(group\.id, (?:speakerId|partner\.id)\)/.test(ipcDuty) && /你名下的待处理/.test(talkDuty),
    "⛔ 私聊 = 来源对话：本人名下待办注入到它自己的会话（用户令「我们的私聊就是那个来源对话」）");
  ok(/异常必须落到人/.test(talkDuty) && /交付要自证/.test(talkDuty),
    "提示词要求：报异常写责任人、说完成要带凭据（⛔ 只说「已完成」不算交付）");
}

/* ── 群头进度点得开（11-11 补缺口：原来只有数字，用户还得自己翻消息找「还欠谁一件事」）── */
{
  const ipcProg = codeOnly(read("electron/features/harness-team-ipc.ts"));
  const viewProg = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  const cssProg = read("src/styles/61-team-mode.css");

  ok(/status === "open"\s*\)\s*\.sort[\s\S]{0,200}slice\(0, 12\)/.test(ipcProg)
    && /toName: x\.toName, fromName: x\.fromName, at: x\.at/.test(ipcProg),
    "⛔ group-progress 返回未结束清单（只 open、最多 12 条，按时间正序 —— ⛔ 全量会随群龄无限涨）");
  ok(/taskProgress\.items\.map/.test(viewProg) && /team-tasks__pop/.test(viewProg),
    "⛔ 群头数字点得开：展开看到「标题 + 谁派给谁 + 什么时候」");
  ok(/taskProgress\.open > 0 \?/.test(viewProg) && /is-done/.test(viewProg),
    "⛔ 没有未结束任务时不给可展开的壳（点了什么都不发生比不能点更糟）");
  ok(/\.team-tasks__pop\s*\{/.test(cssProg) && /summary::-webkit-details-marker/.test(cssProg),
    "浮层有样式且去掉 details 默认三角（三角会把 1px 内边距的胶囊撑开）");
  /* ⛔⛔ 11-12 用户令「删必须同步清理干净」：实测删 3 个群后仍有 6 个 team-runs 账本
     （266 KB）+ 3 条 thread-runtime 登记 ⇒ 删除路径必须在同一次请求里同步清掉。 */
  ok(/async forgetThread\(threadId: string\)/.test(read("electron/team-runs.ts"))
    && /cleanupThreadArtifacts\(removedIds\)/.test(read("electron/features/harness-team-ipc.ts"))
    && /threadRuntimeStore\.flush\(\)/.test(read("electron/features/harness-team-ipc.ts")),
    "删群同步清运行账本与线程运行时登记（⛔ 不等下次启动自愈）");
  /* ⛔⛔ 11-12 用户追加「后续也不准有残留」：删除同步清全部会话级落盘 + 启动按墓碑对账兜底。 */
  ok(/removeSessionWorkspace\(userDataDir, id\)/.test(read("electron/features/harness-team-ipc.ts"))
    && /forgetRoleSession\(userDataDir, id\)/.test(read("electron/features/harness-team-ipc.ts"))
    && /clearSessionPrivateMemory\(memRoot, id\)/.test(read("electron/features/harness-team-ipc.ts"))
    && /export async function reconcileDeletedThreadArtifacts/.test(read("electron/features/thread-deletion.ts"))
    && /await reconcileDeletedThreadArtifacts\(\)/.test(read("electron/features/boot.ts")),
    "无残留双保险：删群同步清工作区/角色/私有记忆；启动按墓碑对账补漏");
  /* ⛔⛔ 11-12 用户：「专家团还要管理员，你这机制搞错了吧」「这个卡片丑死了」。
     团群由团主理人担任管理员 ⇒ 完成屏不许再提示"还差一个管理员"/给下拉；
     布局按 DESIGN.md：收窄卡片、内容有内边距、去掉卡中卡的灰底块。 */
  const createSrc = read("src/features/harness-team/12-team-create.tsx");
  ok(/const isTeamGroup = picked\.some/.test(createSrc)
    && /管理员已就位：团主理人/.test(createSrc)
    && !/团群不用设/.test(createSrc)
    && /team-created__body/.test(createSrc)
    && /\.team-sheet__card\.team-created \{ width: min\(480px/.test(read("src/styles/61-team-mode.css"))
    && /\.team-created__hint \{[\s\S]{0,220}border-left/.test(read("src/styles/61-team-mode.css")),
    "团群不再提示设管理员；完成屏收窄、有内边距、去掉卡中卡");
}

/* ── ⑦ 同一个人的头像必须只有一张脸（11-12 用户截图：「头像为什么对不上」）──
   ⛔⛔ fixture 必须照**真实目录形状**写：member 的 `key` 是 `<teamId>:<memberId>`、
      主理人 key 同样带 `<teamId>:` 前缀。上面那个 `m1` / `chengshu` 的裸 key fixture
      把"两处 seed 不同"这个 bug 完全掩盖了 —— 它测了三年都是绿的，用户一眼就看见两张脸。 */
{
  const realCatalog = [
    { kind: "expert", key: "t1:lead1", memberId: "lead1", name: "文枢", profession: "主编", teamId: "t1" },
    { kind: "member", key: "t1:m1", memberId: "m1", name: "衡纸", profession: "撰稿", teamId: "t1" },
  ];
  const realGroup = {
    id: "g2", name: "内容生产组", leadId: "u1",
    members: [
      { id: "u1", kind: "human", name: "我" },
      { id: "p2", kind: "bot", name: "内容创作专家团", targetKind: "team", targetKey: "t1" },
    ],
  };
  const sec = mentionSectionsOf(realGroup, realCatalog);
  const kidItem = sec.find((s) => s.key === "kid").items[0];
  const teamItem = sec.find((s) => s.key === "team").items[0];

  /* 团成员：@ 面板 seed = 裸 memberId（消息气泡按合成 id `team:t1:m1` 拆出来的就是它） */
  ok(kidItem.avatar.targetKey === "m1",
    `团成员头像 seed = 裸 memberId（实得 ${JSON.stringify(kidItem.avatar.targetKey)}；⛔ 用目录 key t1:m1 就与气泡不同脸）`);
  /* 主理人：seed = 目录 key（成员栏 leadFaceOf / @ 面板 / 资料卡三处同一口径） */
  ok(teamItem.avatar.targetKey === "t1:lead1",
    `主理人头像 seed = 目录 key（实得 ${JSON.stringify(teamItem.avatar.targetKey)}）`);

  /* 反证：这两种 seed 真的会散列到不同造型 ⇒「必须统一」不是洁癖 */
  const a = pickAgentAvatar("expert", "t1:lead1");
  const b = pickAgentAvatar("expert", "lead1");
  ok(`${a.file}#${a.cell}` !== `${b.file}#${b.cell}`,
    `两种 seed 精确画出两张脸（${a.file}#${a.cell} vs ${b.file}#${b.cell}）—— 这就是用户看到「对不上」的成因`);

  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  /* 主理人在群里发言用合成 id ⇒ 必须回成员栏那一份，⛔ 不许自己拼 targetKey */
  ok(/if \(slot && !isTeamKidAuthor\(teamAuthor\.teamId, teamAuthor\.memberId\)\) return leadFaceOf\(slot\)/.test(view),
    "合成 id 的主理人分支复用 leadFaceOf（与成员栏同一份 seed + 同一份换脸覆盖）");
  ok(!/targetKey: kid\.key/.test(view),
    "⛔ 成员栏团成员不许拿目录 key 当头像 seed（那会与气泡画成两张脸）");
  ok(/return !isTeamKidAuthor\(ta\.teamId, ta\.memberId\)/.test(view),
    "「是不是团成员」判据只有 isTeamKidAuthor 一处（管理员与头像共用，⛔ 两处各判一次就会漂）");
  /* 换脸覆盖两处都认：成员行 avatar + 群级覆盖表（按合成 id 存） */
  ok(/group\.avatars\?\.\[teamAuthorIdOf\(String\(m\.targetKey \?\? ""\), teamMemberIdOf\(lead\)\)\]/.test(view),
    "主理人换脸两处都认（成员行 + 按合成 id 存的群级覆盖表），⛔ 只认一处 ⇒ 换了只有半边界面变");
  ok(/group\.avatars\?\.\[kidId\]/.test(view) && /targetKey: teamMemberIdOf\(kid\)/.test(view),
    "团成员换脸覆盖按合成 id 存、seed 用裸 memberId（覆盖与选脸口径分开）");

  const mentionSrc = codeOnly(read("src/lib/team-mention.mjs"));
  /* ⛔ 审查（11-12）：负向断言不许在锚点缺失时静默通过 —— 原来 `split(...)[1] ?? ""`
     会让「kids.push 被改名/搬走」这条半边恒真（守卫自洽地错）。先证明切片非空再断言。 */
  const kidsPushBlock = String(mentionSrc.split("kids.push")[1] ?? "").slice(0, 900);
  ok(kidsPushBlock.length > 0 && /targetKey: memberKey \}/.test(kidsPushBlock)
    && !/targetKey: key \},\s*$/m.test(kidsPushBlock),
    "@ 面板团成员同样用裸 memberId（纯函数层与视图同一口径；⛔ 锚点缺失必须报红，不许恒真）");

  /* ⛔⛔ 11-12 用户追报「私聊界面的头像也没有同步」：伙伴会话回合头的身份来自
     主进程 `talkPartnerIdentity`，它原先对主理人合成 id 取裸 memberId ⇒ 又是一张新脸。
     这里真跑纯函数，证明私聊 seed 与群聊 lead.key 精确落在同一格。 */
  const leadFace = talkPartnerIdentity({ memberId: "team:t1:lead1", name: "台账旧名" }, realGroup, realCatalog);
  ok(leadFace.targetKind === "expert" && leadFace.targetKey === "t1:lead1",
    `私聊主理人 seed = 目录 lead.key（实得 ${leadFace.targetKind}/${leadFace.targetKey}；⛔ 裸 lead1 就是第三张脸）`);
  const groupPick = pickAgentAvatar("expert", "t1:lead1");
  const chatPick = pickAgentAvatar("expert", leadFace.targetKey);
  ok(`${groupPick.file}#${groupPick.cell}` === `${chatPick.file}#${chatPick.cell}`,
    "私聊与群聊精确画出同一张脸（同一个文枢不允许第三次分叉）");
  const kidFace = talkPartnerIdentity({ memberId: "team:t1:m1", name: "衡纸" }, realGroup, realCatalog);
  ok(kidFace.targetKind === "member" && kidFace.targetKey === "m1",
    "团成员仍按裸 memberId 画（⛔ 目录缺 member 条目时会被误判成主理人）");
  const customGroup = { ...realGroup, members: realGroup.members.map((m) => m.targetKind === "team" ? { ...m, avatar: "preset:avatar-07" } : m) };
  ok(talkPartnerIdentity({ memberId: "team:t1:lead1", name: "x" }, customGroup, realCatalog).avatar === "preset:avatar-07",
    "私聊也认成员栏换过的脸（整团槽成员行与群级覆盖表两处都读）");
  /* ⛔ 审查修正：团槽 avatar 默认就是空串，写成 `?? 覆盖表` 会让「从 @ 面板换脸」只有群聊变。 */
  const overrideGroup = { ...realGroup, avatars: { "team:t1:lead1": "preset:avatar-03" } };
  ok(talkPartnerIdentity({ memberId: "team:t1:lead1", name: "x" }, overrideGroup, realCatalog).avatar === "preset:avatar-03",
    "团槽 avatar 为空串时仍回落到群级覆盖表（与 leadFaceOf 同为 || 口径）");
  ok(/avatar: String\(slot\?\.avatar \?\? ""\)\.trim\(\) \|\| String\(group\?\.avatars\?\.\[memberId\]/.test(read("src/lib/team-models.mjs")),
    "纯函数源码钉住 || 回落（⛔ 退回 ?? 就是「换了头像只有半边界面变」）");
}

  /* ⛔⛔ 11-12 用户截图（「把群里的图片和文件展示，还有其他所有同步主对话框，这啥玩意啊」）：
     群消息正文/引用把 `[附件文件]…[附件结束]` 信封原样当文字画出来，而主对话会解析成图片/文件 chip。
     ⇒ 群聊复用主对话那套：parseUserRefs 剥信封 + MessageAttachChip 渲染附件（⛔ 不另造 chip）。 */
  {
    const attachments = read("src/features/harness-team/30-team-attachments.tsx");
    const groupView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
    ok(/parseUserRefs\(/.test(attachments) && /MessageAttachChip/.test(attachments)
      && /openImageLightbox/.test(attachments) && /teamMessageBodyText/.test(attachments),
      "群消息附件复用主对话：parseUserRefs 剥信封 + MessageAttachChip 渲染图片/文件（⛔ 不另造 chip）");
    ok(/import \{ TeamMessageBody, teamMessageBodyText \} from "\.\/30-team-attachments"/.test(groupView)
      && /<TeamMessageBody[\s\S]{0,120}raw=\{row\.text\}/.test(groupView)
      && /text=\{teamMessageBodyText\(quote\.text, false\)\}/.test(groupView)
      && !/text=\{quote\.text\}/.test(groupView),
      "群气泡与「回复 @X」引用都走 teamMessageBodyText（⛔ 引用不再原样显示附件信封）");
    ok(/export function MessageAttachChip/.test(read("src/features/shared/UserMessageView.tsx"))
      && /\.team-msg__attachments \{/.test(read("src/styles/61-team-mode.css")),
      "MessageAttachChip 从主对话导出复用；群附件行有样式（.team-msg__attachments）");
    /* ⛔ 引用摘要（buildReplyQuotes）先把 `\s+` 折成单空格 ⇒ `[附件文件]\n- path` 变 `[附件文件] - path`，
       行级解析器再也匹配不到 ⇒ 必须在折行前用 team-fold 自己的信封正则剥掉。两边同认「附件文件」防漂移。 */
    ok(/附件文件/.test(codeOnly(read("src/lib/team-fold.mjs"))) && /附件文件/.test(codeOnly(read("src/lib/user-refs.ts"))),
      "引用摘要（team-fold）与正文解析（user-refs）同认附件段（⛔ 折行前先剥，否则引用里露出信封）");
  }

  /* ⛔⛔ 11-12 真机「群聊压根运行不起来」：引擎只在 spawn 时读 rollout 首行
     `session_meta.dynamic_tools`。宿主通用 `thread/resume` 升级会把**群聊伙伴会话**当成普通会话，
     首行整份改写成宿主 95 个工具 ⇒ team_member_invoke / team_phase_invoke / group_say 全丢，
     主理人没有派活工具，只能靠嘴编「已派出 / 进度到第二环」（实测 17:15=0 个、17:16=95 个，
     而 15:43 刚建的那条是 8 个群聊工具）。
   两条防线：① 通用 upgrade 对**派生会话**早退（工具面只由各自域管）；
            ② group-talk 每次 ensure/peek 都把权威工具面写回首行 ⇒ 被污染的老会话能自愈。
  ⛔⛔ 11-12 二次真机：① 的判据**一开始只查 group-talk 台账**（`lookupGroupThread`），漏了
    boss-groups 的群成员（两套群台账并存）⇒ 日志里 `01a1cf0b` 照样被升成 95 个，每次启动
    把刚自愈的会话又污染回去。判据必须按**会话类型**（唯一真相源 = `src/lib/session-kind.mjs`）。 */
  {
    const codexIpc = codeOnly(read("electron/features/codex-ipc.ts"));
    const channel = codeOnly(read("electron/features/group-talk/01-channel.ts"));
    const core = codeOnly(read("electron/features/dispatch-core.ts"));
    ok(/sessionOwnsHostToolSurface\(resumeThreadId\)/.test(codexIpc)
      && /if \(hostOwnsSurface && resumeThreadId && Array\.isArray\(resumeTools\) && resumeTools\.length\)/.test(codexIpc)
      && /跳过宿主工具面升级/.test(codexIpc)
      /* ⛔ 负向：resume 里不许再用「只查一张台账」的旧判据（那正是漏判 boss-groups 的形态）。 */
      && !/lookupGroupThread\(resumeThreadId\)/.test(codexIpc),
      "⛔ 派生会话（专家团 / 专家 / 工作伙伴 / 被调度）不许被通用 resume 改写成宿主工具面");
    ok(/async function sessionOwnsHostToolSurface\(threadId: string\)[\s\S]{0,600}ownsHostToolSurface\(role\.kind\)/.test(core)
      && /ensureDispatchToken, restrictedThreadRole, sessionOwnsHostToolSurface,/.test(core),
      "会话类型判据与能力矩阵同源（⛔ 不在 resume 侧另写一张台账判断）");
    /* 真跑（⛔ 不靠正则断言注释声称）：只有 normal / hub 归宿主，四类派生会话一律不归；
       未知 / 原型链键归一化到 normal（⛔ 不许取到 Object.prototype 变成"能派活"）。 */
    const owns = (kind) => ownsHostToolSurface(kind);
    ok(owns("normal") && owns("hub") && !owns("expertTeam") && !owns("expert")
      && !owns("workPartner") && !owns("delegate")
      && normalizeSessionKind("__proto__") === "normal" && owns("__proto__"),
      "⛔ 宿主工具面只归 normal / hub；四类派生会话不归，原型链键归一化为普通会话");
    const surfaceHits = (channel.match(/const surface = \[\.\.\.buildGroupTalkTools\(\), \.\.\.\(options\.extraTools \?\? \[\]\)\]/g) || []).length;
    ok(surfaceHits === 2 && !/const surface = options\.extraTools\?\.length/.test(channel),
      "群聊 ensure / peek 两处恒写回权威工具面（⛔ 已被污染的旧会话能自愈，主理人 extraTools 不丢）");
  }

  /* ⛔⛔ 11-12 用户令「把值得抄的三条机制拿出来」：落成纯函数并真跑，⛔ 不靠注释声称。
     借鉴 Cumora COORDINATION.md / AgentChat speaker selection / MetaGPT Environment。 */
  {
    const orch = await import(pathToFileURL(join(ROOT, "src/lib/group-orchestration.mjs")).href);
    const fake = orch.verifyProgressClaim({ text: "已经派给落纸了，进度到第二环" });
    const real = orch.verifyProgressClaim({ text: "已经派给落纸了，进度到第二环", memberOutputs: ["落纸的正文"] });
    const tool = orch.verifyProgressClaim({ text: "已完成 2/4", toolCalls: [{ name: "team_member_invoke" }] });
    ok(fake.claim && !fake.ok && fake.notice.length > 0 && real.ok && tool.ok,
      "① 执行与汇报分离：无证据自报进度被拦并给可见回执，有成员产出/派活调用才放行");
    const spokeSince = ["a"];
    const picked = orch.selectNextSpeakers({ candidates: ["a", "b", "b", "c"], spokeSince, known: ["a", "b", "c"], budget: 2, maxTurnsPerMember: 2, ranCount: { b: 2 } });
    ok(!orch.canSpeak({ memberId: "a", spokeSince, known: ["a", "b", "c"] }) && JSON.stringify(picked) === '["c"]',
      "② 显式发言权：已发言 / 超回合上限 / 重复候选由宿主过滤，预算截断");
    ok(orch.shouldStopGroupTurn({ itemsTotal: 3, itemsDone: 3 }).stop
      && orch.shouldStopGroupTurn({ chainBudget: 0 }).stop
      && !orch.shouldStopGroupTurn({ itemsTotal: 3, itemsDone: 2, chainBudget: 5, ranCount: { a: 1, b: 1 } }).stop,
      "③ 宿主判定终止：按任务项数 / 预算收口，不是「每人都发过一次」就算完成");
  }
  {
    const guardrails = codeOnly(read("electron/features/group-talk/05-guardrails.ts"));
    const ipc = codeOnly(read("electron/features/harness-team-ipc.ts"));
    ok(/verifyProgressClaim\(/.test(guardrails) && /progressClaim/.test(guardrails)
      && /memberOutputs:/.test(ipc) && /canSpeak\(/.test(ipc) && /shouldStopGroupTurn\(/.test(ipc),
      "三条机制都接进群聊链路（guardrails 收口 ①、接力循环接 ②③）");
  }

  /* ⛔⛔ 11-12：harness-dispatch 内置 MCP 是冗余第二套（引擎 0.157 起延迟暴露，模型看不到），
     每次启动握手 failed。根因修复 = 不再注册 + 清历史段 + 改掉「已固定走 MCP」的假注释。 */
  {
    const apply = codeOnly(read("electron/features/custom-model-apply.ts"));
    const boot = codeOnly(read("electron/features/boot.ts"));
    const reg = codeOnly(read("electron/capability-registry.ts"));
    ok(!/\[mcp_servers\.harness-dispatch\]/.test(apply)
      && /dispatchMcpCount !== 0/.test(boot)
      && !/已固定走 MCP/.test(reg),
      "⛔ harness-dispatch MCP 已退役：不再注册、残留段会清理、能力表不再声称走 MCP");
  }

console.log(`\n【team-chat-ux】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
