/**
 * 通知回执与浮层单条化 · 守卫（2026-10-06 立）
 *
 * 守用户那条需求的两半：
 *   ① 「很多开发都没有通知提醒，全部检查一下，就比如你刚刚控制台里面加的那个，我开关就没反馈通知」
 *      ⇒ 拨动开关**必须**有回执（正在 / 成功 / 失败三态里，成功与失败至少各一条）。
 *   ② 「通知只展示最新的，不要一下上下展示好几个通知叠加」
 *      ⇒ 浮层同一时刻只留最新一条；通知中心（历史台账）不受影响。
 *
 * ⛔⛔ 为什么必须把 09-20 的旧判据改掉而不是"再加一条"：
 *   09-20 的口径是**反的**（「单槽被后到的顶掉 ⇒ 多会话并发看不见先到的那条」⇒ 改多条队列 +
 *   每条独立倒计时 + NOTICE_MAX=4）。10-06 用户明确改成"只看最新" ⇒ 旧断言「setNotice 是推一条入队」
 *   会**抵制正确修改**（它在 07-turn-fold.mjs 里，本轮已按新口径就地改写，行数不变以守住【265】棘轮）。
 *   ⛔ 教训：用户改口径时，要把它派生出来的每一处都找出来 —— 断言、常量、CSS 文案、组件注释。
 *
 * ⚠️ 覆盖边界（如实声明）：这里的"回执"判据看的是**接线**（成功/失败分支里有没有真的调通知），
 *   不测文案好不好、也不真跑 UI（点开关的 E2E 在 scripts/accept.mjs 那侧）。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【notice-feedback】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => existsSync(path.join(ROOT, rel));
/** 剥注释（`//` 整行 + 块注释 + JSX 注释）。
 *  ⛔ 负向断言一律先剥注释 —— 本轮真跑踩到：这些注释里**引用了被禁的模式**，
 *  只剥行注释会让三条负向断言自己把自己顶红。 */
const codeOnly = (source) => String(source)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");

/* ── ① 浮层：同一时刻只留最新一条 ─────────────────────────────────────── */
const HUB = "src/features/app-state/parts/part02/02-goal-browser-notice/02-approval-notice-center.tsx";
const hub = has(HUB) ? read(HUB) : "";
const hubCode = codeOnly(hub);
ok(/bag\.setNotices\(\[\{ id, text, threadId, scope \}\]\)/.test(hubCode),
  "⛔ setNotice 用**整体替换**入队（只留最新一条）—— 用户 10-06：不要上下叠加好几条");
ok(!/\[\.\.\.current,\s*\{\s*id,\s*text,\s*threadId,\s*scope\s*\}/.test(hubCode),
  "⛔ 负向：不许退回「追加进队列」的写法（那就是叠加本身）");
ok(/for \(const entry of bag\.notices\)[\s\S]{0,240}?clearTimeout\(timer\)[\s\S]{0,160}?noticeTimersRef\.current\.delete\(entry\.id\)/.test(hubCode),
  "被顶替的旧通知要**连同它的定时器**一起收掉（否则回调打在不存在的 id 上，定时器还一直挂着）");
ok(/noticeCenter/.test(hubCode) && /notice-center-v1/.test(hubCode),
  "⛔ 通知中心（历史台账）不受影响 —— 用户要的是浮层不叠，台账仍留全量");
ok(!/NOTICE_MAX/.test(hubCode),
  "队列上限常量不再是消费方（浮层恒 1 条）；⛔ 别顺手把它当「多条并列」的复活开关");

/* ── ② 开关回执：控制台「回复风格」（本轮用户点名的那个）───────────────── */
const SWITCH = "src/features/settings-general/BuiltinSkillSwitch.tsx";
const sw = codeOnly(has(SWITCH) ? read(SWITCH) : "");
ok((sw.match(/onNotice\?\.\(/g) || []).length >= 3,
  "内置技能开关有「正在…/成功/失败」三条回执（这条要重启引擎，按秒计，只留失败回执 = 点了没反应）");
ok(/else onNotice\?\.\(next \?/.test(sw),
  "⛔ 成功分支必须有回执（旧实现只在 `if (r.error)` 里通知 ⇒ 成功静默，正是用户报的那个）");

/* ── ③ 技能页「共享技能池」：同一技能的另一入口，此前成功+失败全静默 ────── */
const POOL = "src/features/settings-skills/SkillPoolSection.tsx";
const pool = codeOnly(has(POOL) ? read(POOL) : "");
ok((pool.match(/onNotice\?\.\(/g) || []).length >= 2,
  "池面板拨动给出回执（成功一条 + 失败一条）");
ok(!/\.catch\(\(\) => undefined\)/.test(pool),
  "⛔ 负向：池页不许再 `.catch(() => undefined)` —— 成功静默 + 失败也静默 = 用户完全不知道成没成");
ok(/onNotice=\{setNotice\}/.test(codeOnly(read("src/features/settings-skills/SkillsCenterSection.tsx"))),
  "池面板的回执由父级穿透（它按设计自取数据、不经 bag）—— 父级真的把 setNotice 传下去了");

/* ── ④ 开关静默吞错：本轮修掉的其余三处 ─────────────────────────────── */
const SCHED_ROWS = "src/features/settings-schedule/ScheduleSettingsSection.tsx";
const sched = codeOnly(has(SCHED_ROWS) ? read(SCHED_ROWS) : "");
ok(/toggleSchedule\(task\)\.then\(\(result: any\) => setNotice\(/.test(sched),
  "定时任务开关按**结果对象**回执（⛔ 吞错会让外层 then 报出假的「已启用」）");
ok(/setAwake\(on\)\.then\(\(\) => setNotice\([\s\S]{0,300}?\.catch\(\(error: any\) => setNotice\(/.test(sched),
  "「保持电脑唤醒」勾选也有回执（失败更要说 —— 主进程没开成功时电脑照样会睡）");

const MODEL = "src/features/settings-model/ModelSettingsSection.tsx";
const model = codeOnly(has(MODEL) ? read(MODEL) : "");
ok(/saveAppSettings\(\{ autoCompactRatio: v \}\)\.then\(\(\) => setNotice\(/.test(model),
  "自动压缩比例：**落盘成功才报成功**（原来即发即忘 —— 盘上没写成功也照报「已设为 N%」）");
ok(/return \{ ok: false, error: message \}/.test(codeOnly(read("src/hooks/useScheduler.ts"))),
  "useScheduler.toggleSchedule 失败时把原因交回调用方（不是只写页面状态行）");

const RPA = "src/features/settings-rpa/RpaSettingsSection.tsx";
const rpa = codeOnly(has(RPA) ? read(RPA) : "");
ok(/updateTask\(\{ id: task\.id, patch: \{ status: next \} \}\)\.then\([\s\S]{0,700}?setNotice\([\s\S]{0,500}?\.catch\(\(error: any\) => setNotice\(/.test(rpa),
  "RPA 待办开关：完成/恢复都给回执，失败不再 `.catch(() => undefined)` 吞掉");

const BOT = "src/features/app-state/parts/part02/04-runtime-commands-account/02-commands-hooks-account.tsx";
const bot = codeOnly(has(BOT) ? read(BOT) : "");
ok(/botStreamSet\?\.\(next\)[\s\S]{0,200}?\.catch\(\(error: any\) => bag\.setNotice\(/.test(bot)
  && /botsSet\?\.\(next\)[\s\S]{0,200}?\.catch\(\(error: any\) => bag\.setNotice\(/.test(bot),
  "机器人流式/机器人设置：落盘失败必须说出来（原来两个 `.catch(() => undefined)` 把失败吞干净）");

console.log(`\n【notice-feedback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
