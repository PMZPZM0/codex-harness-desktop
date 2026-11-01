/**
 * ESC 分层栈守卫（10-31 立，用户：「esc 只关闭最上面的」）
 *
 * 起因：设置里打开二级弹窗后按 Esc，二级和设置一起关。根因是每个弹窗各自
 * `window/document.addEventListener("keydown")` —— 同一个 Esc 会被所有打开的层收到
 * （capture 也不行：stopPropagation 拦不住**同一 target** 上的其它监听）。
 *
 * 守四件事：
 *   ① 栈模块与 hook 在位（`src/lib/escape-layer.mjs` + `src/hooks/useEscapeLayer.ts`）。
 *   ② **真跑**：后注册的层先消费，Esc 只触发最上层；移除后回落到下一层。
 *   ③ 返回 false 的层不消费（例如"提交中不许关"），继续交给下一层。
 *   ④ 设置弹窗与常见二级弹窗**必须走栈**，且不许再残留自己的 `key === "Escape"` 监听。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks += 1;
  console.log(`  ${cond ? "✓" : "✗"} 【esc】${msg}`);
  if (!cond) fails += 1;
};

const stackPath = path.join(ROOT, "src", "lib", "escape-layer.mjs");
const hookPath = path.join(ROOT, "src", "hooks", "useEscapeLayer.ts");
ok(existsSync(stackPath) && existsSync(hookPath), "① 栈模块与 hook 在位（escape-layer.mjs / useEscapeLayer.ts）");

if (existsSync(stackPath)) {
  const mod = await import(pathToFileURL(stackPath).href);
  const fire = () => ({ key: "Escape", preventDefault() { /* noop */ }, stopImmediatePropagation() { /* noop */ } });
  const calls = [];
  const offA = mod.pushEscapeLayer(() => { calls.push("A"); });
  const offB = mod.pushEscapeLayer(() => { calls.push("B"); });
  mod.dispatchEscapeForTest(fire());
  offB();
  mod.dispatchEscapeForTest(fire());
  offA();
  ok(calls.join(",") === "B,A", "② 真跑：Esc 只由最上层消费（B → A，随后栈空不再触发）");

  const order = [];
  const outer = mod.pushEscapeLayer(() => { order.push("outer"); });
  const skip = mod.pushEscapeLayer(() => false);
  mod.dispatchEscapeForTest(fire());
  skip();
  outer();
  ok(order.join(",") === "outer", "③ 返回 false 的层不消费（交给下一层）");

  ok(mod.escapeLayerSnapshot().length === 0, "④ 全部移除后栈为空（不残留监听）");
}

const files = [
  "src/components/SettingsDialog.tsx",
  "src/components/HelpDialog.tsx",
  "src/components/CloseConfirmDialog.tsx",
  "src/components/VoiceDevToolsSection.tsx",
  "src/components/AnchorPopover.tsx",
  "src/components/EffortPicker.tsx",
  "src/components/EntityTagEditor.tsx",
  "src/components/FileRefCard.tsx",
  "src/features/function-menu/AddPagesDialog.tsx",
  "src/features/app-view/AppView/NewProjectDialog.tsx",
  "src/features/app-view/AppView/LoginManagerModal.tsx",
  "src/features/app-view/AppView/SidebarGuideModal.tsx",
  "src/features/data-access/VaultWriteConfirm.tsx",
  "src/features/settings-cloud/ResultDialog.tsx",
  "src/features/settings-cloud/SessionSyncDialog.tsx",
  "src/features/settings-model/ModelSettingsSection.tsx",
  "src/features/settings-devtools/DevtoolsSettingsSection.tsx",
  "src/features/settings-app-lock/AppLockSettingsSection.tsx",
  "src/features/settings-skills/SkillPoolSection.tsx",
  "src/features/app-state/parts/part02/01-mcp-teams-plan/01-mcp-subagents-state.tsx",
  "src/features/app-state/parts/part09/02-seg.tsx",
  "src/features/auth/LoginScreen.tsx",
  "src/features/boss-group-view/BossGroupHelpButton.tsx",
  "src/features/composer-rail/ComposerRail.tsx",
  "src/features/dispatch/DispatchMenu.tsx",
  "src/features/event-broadcast/BroadcastHost.tsx",
  "src/features/newbie-guide/NewbieGuide.tsx",
  "src/features/preview/Preview.tsx",
  "src/features/app-state/parts/part04/03-seg/01-chat-search-file-tree.tsx",
];
/* 这两个还保留**元素级** Esc（行内输入框），只要求它们把浮层那部分接进栈 */
const elementLevelEsc = [
  "src/features/app-view/AppView/01-sidebar-shell.tsx",
  "src/features/composer/Composer.tsx",
];
const raw = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const missingLayer = [...files, ...elementLevelEsc].filter((rel) => !/useEscapeLayer\(/.test(raw(rel)));
ok(missingLayer.length === 0, `⑤ 各级弹窗/浮层全部走全局 ESC 栈（${files.length + elementLevelEsc.length} 个；缺：${missingLayer.join(" / ") || "无"}）`);

const rawEscape = files.filter((rel) => /key === "Escape"/.test(raw(rel)));
ok(rawEscape.length === 0, `⑥ 负向：这些弹窗不再自己监听 Esc（否则一次按键多层一起关；违规：${rawEscape.join(" / ") || "无"}）`);

/* ⑦ 全局「逐步关最上层」的兜底链也必须入栈：它以前自己挂 window keydown，
   注册顺序早于各弹窗自己的层 ⇒ 一次 Esc 先把设置关掉，二级弹窗跟着被卸载
   （用户实测「开了二级界面，esc 二级界面跟着设置界面一起关了」的真根因）。 */
const globalEscSrc = raw("src/features/app-state/parts/part04/03-seg/01-chat-search-file-tree.tsx");
/* ⛔ 同文件的快捷键热键也挂 window keydown（onKey 同名），负向只盯 ESC 判定那一句。 */
ok(/useEscapeLayer\(!bag\.showLogin/.test(globalEscSrc) && !/event\.key !== "Escape"/.test(globalEscSrc),
  "⑦ 全局 ESC 兜底链入栈（不再自挂 window keydown 抢在弹窗层之前）");

console.log(`\n  【esc】${checks - fails}/${checks} 通过`);
if (fails) process.exit(1);
