/**
 * 12bg —— 群聊「停止」与运行态的落点（11-07 用户四轮修正后的定稿）
 *
 * 用户原话演变：
 *   ①「这个菜单项已经不在（可能被改过）」→ 菜单里的「停止运行」是系统追加项，解析不到；
 *   ②「停止运行放到成员列表的 @ 前面去」；
 *   ③「我的意思是加这里后面，有运行状态的，就在这里显示」→ 单成员的「停」排在 @ 后面；
 *   ④「这个删除按键，怎么还在这里…**都放成员 @ 前面，动态展示，联动调度会话，真停止的**」
 *     ⇒ 全局「停止运行」大按钮**整块删除**；运行态 = 每个成员行里 @ **前面**的脉冲点，
 *        点 @ 后面的「停」是真的停那一个（走 harnessTeamStop，不是装饰）。
 *
 * 判据：菜单无系统项 / 无全局停止键（含 stopAll） / 每行三件套（状态点→@→停）/
 *       状态点有动画且尊重 prefers-reduced-motion / 停键认合成 id（团成员也能停）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【team-stop】群聊停止键与运行态的落点");

const view = read("src/features/harness-team/04-team-group-view.tsx");
const css = read("src/styles/61-team-mode.css");
const store = read("src/features/harness-team/02-team-store.ts");
const menuLib = read("src/lib/team-menu.mjs");

ok(!/STOP_MENU_ITEM/.test(view) && !/sys-stop/.test(menuLib),
  "「指令」菜单不再追加系统项（点了只会弹「菜单项已经不在了」）");

/* ④ 的硬要求：全局那块整块删掉，⛔ 留一个都算没改。
   ⛔ 必须剥注释：文件里写明「全局停止键已删（连同 stopAll / stopping）」的说明本身就含这些词。 */
const codeOnly = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const viewCode = codeOnly(view);
ok(!/team-group__members-stop\b/.test(viewCode) && !/const stopAll = /.test(viewCode) && !/stopping/.test(viewCode),
  "⛔ 没有全局「停止运行」：按钮、stopAll、stopping 状态全部删除（用户截图圈掉的那一块）");
ok(!/team-group__members-stop\b/.test(css) && !/team-group__members-stoprow/.test(css),
  "⛔ 全局停止键的样式也删净（只删 JSX 会留下看起来还在的类）");

/* 每行三件套：状态点（@ 前）→ @ → 停（@ 后） */
const cellAt = view.indexOf("function MemberActions");
const cell = cellAt > 0 ? view.slice(cellAt, view.indexOf("\nexport function TeamGroupView")) : "";
ok(cell.length > 0, "成员行右端抽成一个组件（伙伴行与团成员行共用，⛔ 两处各写一份必然漂）");
const liveAt = cell.indexOf("team-group__member-live");
const atAt = cell.indexOf("team-group__member-at");
const stopAt = cell.indexOf("team-group__member-stop");
ok(liveAt > 0 && atAt > liveAt && stopAt > atAt,
  "顺序固定：运行态点 → @ → 停（用户：「都放成员 @ 前面，动态展示」）");
ok(/running &&[\s\S]{0,160}?team-group__member-live/.test(cell) && /running &&[\s\S]{0,160}?team-group__member-stop/.test(cell),
  "状态点与停只在运行中出现的条件都在（空闲成员不画，否则成了装饰）");
ok((view.match(/<MemberActions/g) ?? []).length >= 2,
  "伙伴行 + 团成员行都用同一份（团成员也能看到运行态、也能单独停）");

/* 动态展示：有动画，且尊重系统的减少动画偏好 */
ok(/\.team-group__member-live\s*\{[\s\S]{0,240}?animation:\s*team-member-live/.test(css)
  && /@keyframes team-member-live/.test(css),
  "运行态点是动态的（脉冲 keyframes）");
ok(/prefers-reduced-motion:\s*reduce[\s\S]{0,240}?\.team-group__member-live/.test(css),
  "系统要求减少动画时降级成静态点（⛔ 不是删掉 —— 删掉就没有运行态了）");

/* 真停止：团成员的合成 id 必须翻成调度目标键，否则点了什么也停不掉 */
ok(/parseTeamAuthorId\(memberId\)/.test(store) && /targetKey = member\?\.targetKey \?\?/.test(store),
  "停止认团成员的合成 id（翻成 <teamId>:<memberId> 去委派登记表里找运行中的那条）");
ok(/harnessTeamStop\(\{ threadIds: candidates, targetKey, memberName \}\)/.test(store),
  "停键真的调 harnessTeamStop（引擎中断），不是只改本地 busy");
ok(/setBusyByGroup[\s\S]{0,220}?filter\(\(x\) => x !== memberId\)/.test(store),
  "停止成功后立刻摘运行态（不等引擎回 interrupted —— 有些情况不回）");

console.log(fails ? `\n【team-stop】失败 ${fails} 项` : `\n【team-stop】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
