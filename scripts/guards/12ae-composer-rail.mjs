/**
 * 守卫：输入框左侧竖条（收藏夹 / 密码本 / 开发日记 / 心情表情）+ 两处 IPC 扩展目录。
 *
 * 用户令：「在输入框左边…加一个小粗条…点击展开竖着的小窗口，自适应展示位置…
 * 跟输入框一样高，宽度就一个图标宽度…这个小贴条可以跨会话展示，所有会话点击展示都一样，
 * 默认隐藏的，点击小粗条自适应位置展示」+
 * 「这个小粗条弹窗记得留好IPC接口，还有那个功能入口菜单也留好IPC接口，方便后续拓展和用户拓展」。
 *
 * 判据盯**接线与契约**（真实观感由真机几何实测盯，见提交说明）：
 *   · 竖条挂在输入框里（跨会话一致）+ 默认折叠 + 状态持久化；
 *   · 面板清单来自 `extensions:catalog`（⛔ 不许只在组件里写死四个）；
 *   · 弹层按实测矩形定位并夹进视口（右开优先、放不下翻左）；
 *   · 密码本：渲染层拿不到明文（复制走主进程写剪贴板）；加密不可用就拒存；
 *   · 开发日记：一天一个 md；心情表情：插入「表情 + 括号释义」；
 *   · manifest / registry / composition 三处都登记了新域。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const src = (rel) => codeOnly(read(rel));
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【rail】${message}`);
  if (!condition) fails++;
};

const rail = src("src/features/composer-rail/ComposerRail.tsx");
const railCss = read("src/styles/54-composer-rail.css");
const composerForm = src("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx");

/* ① 挂载与形态 */
ok(/<ComposerRail app=\{app\} \/>/.test(composerForm), "竖条挂在输入框表单里（每个会话同一个组件 ⇒ 跨会话一致）");
ok(/composer-rail-toggle/.test(rail) && /aria-expanded=\{open\}/.test(rail), "折叠是一根可点的粗条，且带 aria-expanded 两态反馈");
ok(/localStorage\.getItem\("composer-rail-open"\)/.test(rail) && /localStorage\.setItem\("composer-rail-open"/.test(rail),
  "展开/折叠状态持久化（用户：「所有会话点击展示都一样」）");
ok(/className="composer-rail-grip"/.test(rail) && /\.composer-rail\s*\{[^}]*right:\s*100%/s.test(railCss)
  && /\.composer-rail-toggle\s*\{[^}]*transform:\s*translateX\(50%\)/s.test(railCss)
  && /\.composer-rail\s*\{[^}]*top:\s*-?\d+px[^}]*bottom:\s*-?\d+px/s.test(railCss),
  "宽屏：竖条骑在输入框左边框线上（right:100% + translateX(50%)），上下各探出 ⇒ 比输入框高一些（10-28 用户：「可以比输入框高一些，现在太小了」）");
/* 10-28：小屏（≤1100）收进输入框内部横排 —— 竖列放不下 5×28 高，实测会被裁。 */
ok(/@media \(max-width: 1100px\)/.test(railCss) && /flex-flow:\s*row nowrap/.test(railCss)
  && /padding-top:\s*40px/.test(railCss),
  "小屏（≤1100px）自适应：快捷条收进输入框内部横排一行，正文 padding-top 让位；其余宽度仍在输入框外侧");

/* ② 扩展目录（用户：「留好IPC接口，方便后续拓展和用户拓展」） */
ok(/window\.codex\.extensionsCatalog/.test(rail), "竖条面板清单来自 IPC `extensions:catalog`（不是写死四个）");
ok(/FALLBACK_PANELS/.test(rail) && /(?:kind === "external"|kind: "external")/.test(rail), "IPC 不可用时回落到内置四个（竖条不会消失）");
ok(/action\?\.type === "text"|action\.type === "url"|action\.type === "settings"/.test(rail),
  "扩展项按封闭动作集渲染（url / settings / text）—— ⛔ 不执行命令");
const extMain = src("electron/features/extensions-ipc.ts");
ok(/normalizeAction/.test(extMain) && /`ext_\$\{id\}`/.test(extMain), "扩展目录做了动作归一化与 id 命名空间隔离");
ok(!/exec|spawn|shell\.openPath/i.test(extMain), "⛔ 扩展目录不提供执行命令动作（JSON 能跑命令 = 后门）");
const menuSrc = src("src/features/function-menu/FunctionMenu.tsx");
ok(/extensionsCatalog/.test(menuSrc) && /extMenu\.map/.test(menuSrc), "功能入口菜单也接入了同一份扩展目录");

/* ③ 弹层形态（10-28 用户令：「这四个按键都做成弹窗…应用居中…适当大一点，不要内联弹窗」；
      尺寸经三调：460×236（贴边，太小）→ 940×740（太大）→ 780×600（仍偏大）→ **640×520**） */
const popover = src("src/components/AnchorPopover.tsx");
ok(/createPortal\(/.test(rail) && /modal-backdrop/.test(rail) && /composer-rail-backdrop/.test(rail)
  && /\.composer-rail-panel\s*\{[^}]*width:\s*min\(640px/s.test(railCss)
  && /\.composer-rail-panel\s*\{[^}]*max-height:\s*min\(520px/s.test(railCss),
  "四个入口都是**居中弹窗**（portal + modal-backdrop + 宽 640 / 高自适应上限 520），不再是贴边内联浮层");
ok(/onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) setPanelId\(null\); \}\}/.test(rail)
  && /addEventListener\("keydown", onKey, true\)/.test(rail)
  && /event\.key === "Escape"/.test(rail) && /event\.stopPropagation\(\)/.test(rail),
  "点遮罩 / 按 Esc 关闭（capture + stopPropagation，不连带关掉背后的层）");
/* 10-28 审查补：声明了 aria-modal 就必须把焦点圈住 + 关闭后归还（否则键盘用户掉到 body）。 */
ok(/event\.key !== "Tab"/.test(rail) && /event\.preventDefault\(\); first\.focus\(\)/.test(rail)
  && /event\.preventDefault\(\); last\.focus\(\)/.test(rail),
  "Tab 在弹窗内首尾循环（aria-modal 声明与实际一致，不会跑回背后输入框）");
ok(/returnFocusRef/.test(rail) && /returnFocusRef\.current\?\.focus\?\.\(\)/.test(rail),
  "关闭后焦点还给触发它的那颗图标（不落到 body）");
ok(/function placePopover\(anchor: AnchorRect/.test(popover) && /createPortal\(/.test(popover),
  "统一浮层原语仍在（其它域：功能菜单 / 下拉仍走 AnchorPopover）");
/* 10-28：图标 22→28 后放不下就**换列**（每列上限 3 个），不再靠滚动裁切；
   ⛔ 不设上限时会排成 4+1（第二列只剩一个图标），所以必须钉住 104px 这个「3 个」的边界。 */
ok(/\.composer-rail-icons\s*\{[^}]*flex-wrap:\s*wrap/s.test(railCss)
  && /\.composer-rail-icons\s*\{[^}]*max-height:\s*104px/s.test(railCss),
  "图标列高度不够时换列（每列上限 3 个 → 5 个排 3+2），不是滚动裁切");
ok(/\.composer-rail-icon\s*\{[^}]*width:\s*28px/s.test(railCss)
  && /\.composer-rail-icon\s*\{[^}]*flex:\s*none/s.test(railCss),
  "图标 28px 且 flex:none（不被压扁）");
/* ⛔⛔ 10-28 真事故：换列后卡片宽度仍按单列算（实测 42px）⇒ 第 4/5 个图标**溢出卡片 22px**，
   正好盖住边框线上的手柄 —— 用户："遮住，小粗条了都"。卡片必须 max-content 包住所有列。 */
ok(/\.composer-rail-icons\s*\{[^}]*width:\s*max-content/s.test(railCss)
  && /\.composer-rail-icons\s*\{[^}]*flex:\s*none/s.test(railCss),
  "图标卡片宽度 max-content（换列时包住两列，图标不许溢出压到手柄/边框线）");
/* 10-28 用户：「要不左边，要不右边，不要在，小粗条上」⇒ 卡片与手柄之间留可见间隙 */
ok(/\.composer-rail-icons\s*\{[^}]*margin:\s*0\s+10px\s+0\s+0/s.test(railCss),
  "图标卡片与手柄之间留 10px 间隙（手柄整根骑在边框线上，不被卡片压住）");
/* 10-28 用户：「加一个拖动顺序功能」 */
ok(/draggable/.test(rail) && /onDrop=/.test(rail) && /composerRailOrder/.test(rail),
  "图标可拖拽排序，顺序落 app-settings.composerRailOrder");

/* ④ 密码本：明文不进渲染层 */
const vaultMain = src("electron/features/vault-ipc.ts");
// 10-27 起域不许直取 safeStorage（用户数据目录 / 密钥库都走 host 接缝），判据跟到接缝调用
ok(/inject: \["ipc", "host"\]/.test(vaultMain) && /const secure = host\.secure/.test(vaultMain)
  && /secure\.encryptString\(/.test(vaultMain) && /secure\.decryptString\(/.test(vaultMain),
  "密码本用系统 safeStorage 加解密（经 host.secure 接缝）");
ok(/const \{ secret, \.\.\.rest \} = item/.test(vaultMain) && /hasSecret: Boolean\(secret\)/.test(vaultMain),
  "列表只回 hasSecret、**不回明文**（渲染层拿不到密码）");
ok(/clipboard\.writeText\(plain\)/.test(vaultMain) && /本机加密不可用，无法安全保存密码/.test(vaultMain),
  "复制密码由主进程写剪贴板；加密不可用时**拒绝保存**（不写明文）");
const vaultUi = src("src/features/composer-rail/PasswordBookPanel.tsx");
ok(/vaultCopy\(item\.id\)/.test(vaultUi) && !/password:\s*item/.test(vaultUi), "密码本界面只调 vaultCopy，不自行解码");

/* ⑤ 开发日记 / 心情表情 */
const journalMain = src("electron/features/journal-ipc.ts");
ok(/dev-journal/.test(journalMain) && /`\$\{date\}\.md`/.test(journalMain), "开发日记：一天一个 md（userData/dev-journal）");
ok(/journal:append/.test(journalMain) && /## \$\{hhmm\}/.test(journalMain), "同日多条按 `## HH:mm 标题` 追加");
const stickers = src("src/features/composer-rail/MoodStickersPanel.tsx");
ok(/onInsert\(sticker\.emoji\)/.test(stickers) && !/（\$\{sticker\.gloss\}）/.test(stickers),
  "表情只插 emoji（10-27 用户改口：「不要带文字，一个表情就行了」）；含义靠引擎图例（personalization 里的 mood bar 一行）");
ok(/onDone\?\.\(\)/.test(stickers) && /MoodStickersPanel onDone=\{\(\) => setPanelId\(null\)\}/.test(rail),
  "选中表情后弹层自动收起（用户：「选择了表情，表情界面自动隐藏」）");
ok(/10_000/.test(rail) && /if \(!open \|\| panelId\) return/.test(rail),
  "竖条展开后 10s 自动收起；有面板打开时不收（用户：「这个一直展示不会自动隐藏」）");
/* ⛔ 10-28：「重新贴边」按钮随贴边浮层一起删除（居中弹窗没有左右贴边可换）——
   负向断言防它被顺手加回来（否则同一排会同时出现"贴边"和"居中"两套语义）。 */
ok(!/setPrefer|prefer=\{prefer\}/.test(rail),
  "已删除「重新贴边 / 换边」按钮（居中弹窗不需要，别再长回来）");

/* ⑥ 三处登记 */
const manifest = read("electron/ipc-channels.manifest.json");
const registry = read("electron/ipc-registry.ts");
const composition = read("electron/composition.json");
for (const ch of ["vault:list", "vault:save", "vault:remove", "vault:copy", "journal:list", "journal:read", "journal:save", "journal:append", "journal:remove", "journal:search", "extensions:catalog"]) {
  ok(manifest.includes(`"${ch}"`) && registry.includes(`"${ch}"`), `通道三处登记：${ch}（manifest + registry）`);
}
for (const domain of ["vault", "journal", "extensions"]) {
  ok(composition.includes(`"id": "${domain}"`), `composition 登记域：${domain}`);
}
ok(existsSync(join(ROOT, "electron/features/vault-ipc.ts")) && existsSync(join(ROOT, "electron/features/journal-ipc.ts")) && existsSync(join(ROOT, "electron/features/extensions-ipc.ts")),
  "三个域文件在位");

/* 10-27 审查补丁：界面承诺的防护必须有实现，不然就是假承诺 */
ok(/30_000/.test(vaultMain) && /clipboard\.readText/.test(vaultMain) && /clipboard\.clear\(\)/.test(vaultMain),
  "复制密码后 30s 自动清空剪贴板（只在内容仍是这串密码时清）—— 界面写了「30 秒」就必须真做");
ok(/确认删除 \$\{activeSelection\.length\} 条？/.test(read("src/features/settings-favorites/FavoritesSettingsSection.tsx")),
  "收藏夹批量删除两步确认（收藏删了没法从会话复原）");
ok(/md-table-scroll" tabIndex=\{0\}/.test(read("src/features/markdown/Markdown.tsx")),
  "表格滚动层可键盘聚焦（宽表键盘用户也能左右滚，WCAG 2.1.1）");

/* 10-27 审查二：类型单一来源 + 扩展项设置页白名单 */
ok(existsSync(join(ROOT, "src/lib/rail-ipc-types.d.ts")) && /declare global/.test(read("src/lib/rail-ipc-types.d.ts"))
  && ["electron/features/vault-ipc.ts", "electron/features/journal-ipc.ts", "electron/features/extensions-ipc.ts"]
    .every((rel) => /rail-ipc-types/.test(read(rel))),
  "跨进程类型只有一份（src/lib/rail-ipc-types.d.ts），三个域都 import type 它、不再本地重写");
ok(/SETTINGS_PAGES/.test(extMain) && /SETTINGS_PAGES\.has\(target\)/.test(extMain),
  "扩展项的 settings 动作按白名单校验目标页（页名写错不会跳到空白页）");

console.log(`\n【rail】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
