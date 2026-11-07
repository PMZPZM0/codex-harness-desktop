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
    && /\.team-msg__body \.team-process__quote--top \{[\s\S]{0,220}?margin: 2px -8px/.test(css)
    && /\.team-msg__body \.team-process__quote--top \.team-process__quote-bar \{[\s\S]{0,160}?position: absolute/.test(css),
    "引用文字与正文左对齐（负 margin 抵消浅底 padding，竖线绝对定位不占位）");
  /* 11-07 用户令「头像对齐输入框边框」：改前实测头像 left 259 / 输入框卡片 left 221（差 38px）。
     根因是子项按 720 居中、composer 按 790 列居中 ⇒ 两条轴不同，必须共用同一条公式。 */
  ok(/padding-left: max\(14px, calc\(\(100% - var\(--team-column\)\) \/ 2\)\)/.test(css)
    && /\.team-group__composer \{ padding-inline: max\(14px, calc\(\(100% - var\(--team-column\)\) \/ 2\)\); \}/.test(css)
    && /\.team-group__stream > \* \{[\s\S]{0,160}?width: min\(100%, var\(--team-column\)\)/.test(css)
    && /align-items: flex-start;/.test(css),
    "⛔ 消息头像与输入框左边框同轴（stream / composer 同一条 padding 公式与列宽）");
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
  ok(/onOpenMention\?: \(\) => void;/.test(composer) && /mentionCount\?: number;/.test(composer)
    && /toolsSlot\?: React\.ReactNode;/.test(composer),
    "三个新 prop 都在 Props 里（⛔ 少一个就是「写了不生效」）");
  ok(/aria-label="选择伙伴（@）"/.test(composer) && /team-composer__at-badge/.test(composer),
    "@ 按钮带已选人数徽标");
  ok(/\{toolsSlot\}/.test(composer), "群菜单按钮渲染在工具行（FLOAT 形态由父层不传）");
  const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/onOpenMention=\{openMentionPanel\}/.test(view) && /mentionCount=\{atTargets\.length\}/.test(view)
    && /toolsSlot=\{!floatMenu \?/.test(view),
    "群视图把三个 prop 真的传下去了（⛔ 组件加了 prop 不传 = 按钮不存在）");
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
  ok(/buildTalkInput\(talkOptions/.test(ipc) && /他的回复会以他的署名进群/.test(talkSrc)
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
  ok(/const r = await onSend\?\.\(atTargets, fullBody, params\)[\s\S]{0,220}?setText\(""\)/.test(view),
    "派活成功即清空输入框（主对话口径；失败保留原文）");
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
  ok(/team-composer__resize/.test(composer) && /team-composer__grip/.test(composer)
    && /localStorage\.getItem\("team-composer-height"\)/.test(composer),
    "群输入框有与主对话同款的顶部把手（拖动改高度 / 双击复位 / 持久化）");
  ok(/<ComposerRail app=\{app\}/.test(composer),
    "群输入框左侧复用主对话的 ComposerRail（侧边粗条，⛔ 不另造一条装饰条）");
  ok(/team-composer__pane-flyout/.test(composer) && /bottom: calc\(100% \+ 8px\)/.test(read("src/styles/61-team-mode.css")),
    "技能 / 引用文件是浮在输入卡上方的弹出层（⛔ 不再顶替 textarea 做成内嵌）");
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
  const quoteView = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
  ok(/team-process__quote-author/.test(quoteView) && /faceOfId\(quote\.authorId\)/.test(quoteView),
    "引用行里「回复某人」带头像 + 名字（真实提及，⛔ 不只是纯文字）");
}

console.log(`\n【team-chat-ux】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
