/**
 * 12bg —— 群聊「停止」的落点与状态条（11-07 用户三轮修正后的定稿）
 *
 * 用户原话演变：
 *   ①「这个菜单项已经不在（可能被改过）」→ 菜单里的「停止运行」是系统追加项，
 *     点击解析只查群自己的菜单 ⇒ 永远解析不到、点了什么也不做；
 *   ②「停止运行放到成员列表的 @ 前面去」→ ③「我的意思是加这里后面，有运行状态的，就在这里显示」
 *     ⇒ **单成员的「停」排在 @ 后面、只在该成员运行中出现**；
 *   ④「这一块删了，不要了」→ 常驻状态条（「当前没有运行中的任务」）整块移除。
 *
 * 判据：菜单无系统项 / 成员行「停」在 @ 之后且仅运行中 / 全局「停全部」在「成员 N」标题行 /
 *       状态条 TSX 与 CSS 都删净 / 一次性回执 4 秒自动消失。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12bg】群聊停止键的落点");

const view = read("src/features/harness-team/04-team-group-view.tsx");
const menuLib = read("src/lib/team-menu.mjs");
const css = read("src/styles/61-team-mode.css");

ok(view.includes("STOP_MENU_ITEM") === false && menuLib.includes("sys-stop") === false,
  "「指令」菜单不再追加系统项（点了只会弹「菜单项已经不在了」，用户截图点名）");

const atIdx = view.indexOf("team-group__member-at${");
const stopIdx = view.indexOf("team-group__member-stop");
ok(atIdx > 0 && stopIdx > atIdx,
  "单成员「停」排在 @ **后面**（用户「加这里后面，有运行状态的，就在这里显示」）");
ok(/isBot && running && \([\s\S]{0,320}?team-group__member-stop/.test(view),
  "「停」只在该成员运行中渲染（谁在跑停谁，空闲成员不出现）");

const headIdx = view.indexOf("team-group__members-head");
const headBlock = headIdx < 0 ? "" : view.slice(headIdx, headIdx + 900);
ok(headBlock.includes("team-group__members-stop") && headBlock.includes("stopAll()"),
  "全局「停全部」在「成员 N」标题行（空闲也可点，做一次清理并回话）");

ok(view.includes("team-group__running") === false && css.includes("team-group__running") === false,
  "常驻状态条整块删除（TSX 不再渲染、CSS 规则也清掉 —— 用户「这一块删了，不要了」）");

ok(/menuMsgTimerRef/.test(view) && /setTimeout\(\(\) => setMenuMsg\(""\), 4000\)/.test(view),
  "一次性回执 4 秒自动消失（不再把「已清理…」挂成常驻状态条）");

console.log(fails ? `\n【team-stop】失败 ${fails} 项` : `\n【team-stop】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
