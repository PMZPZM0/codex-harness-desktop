/**
 * 12bd —— 群聊「停止运行」的位置（11-07 用户令）
 *
 * 用户原话：「停止运行放到成员列表的 @ 前面去」。
 * 背景：这个键原来是**系统追加到「指令」菜单末尾**的（`sys-stop`），但菜单的点击解析
 * （`menuPickResult(group.menu, key)`）只查群自己的菜单 ⇒ 点它只会弹
 * 「这个菜单项已经不在了（可能被改过）」（用户截图正是这一句）。
 * 现在：菜单里不再有系统项；停止键落在成员栏顶部、成员名单（每行就是 @）**之前**。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12bd】群聊停止键的位置（成员列表 @ 之前）");

const view = read("src/features/harness-team/04-team-group-view.tsx");
const menuLib = read("src/lib/team-menu.mjs");

ok(!/STOP_MENU_ITEM/.test(view) && !/sys-stop/.test(menuLib),
  "「指令」菜单不再追加系统项（sys-stop 常量与引用都已删除 —— 点了只会弹「菜单项已经不在了」）");

const headAt = view.indexOf("team-group__members-head");
const rowAt = view.indexOf("team-group__members-stoprow");
const listAt = view.indexOf("<ul>", headAt);
ok(headAt > 0 && rowAt > headAt && listAt > rowAt,
  "停止键在成员栏**顶部**：成员标题之后、成员名单（每行是 @）之前");

ok(/team-group__members-stoprow[\s\S]{0,400}?onClick=\{\(\) => void stopAll\(\)\}/.test(view),
  "顶部那颗键接的就是原来的 stopAll（不是另造一条停止逻辑）");

const footAt = view.indexOf("team-group__members-foot");
ok(footAt > 0 && !/members-stop/.test(view.slice(footAt, footAt + 400)),
  "名单底部的 foot 不再放停止键（同一条功能只留一处，避免两个「停止运行」）");

console.log(fails ? `\n【team-stop】失败 ${fails} 项` : `\n【team-stop】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
