/**
 * 「汇总消息底部 · 已更改 N 个文件」汇报卡判据（10-06 立；用户对照 Qoder 效果图点名：
 * 「汇总消息底部显示文件…这个生成文件直接打开预览就行，和右键打开文件地址和复制文件路径…修改文件下面效果，还有生成的图片」）。
 *
 * ⛔ 这块 UI 的失效方式全是**静默的**：行点了没反应（没接 onOpenFile / 被按钮点击吞掉）、
 * 右键菜单漏项、折叠阈值被删掉一口气铺满、图片行退化成文字块 —— tsc 与预检全绿。
 * 本守卫钉**代码形态 + 复用关系**；行为（真点、真右键、真复制）由验收项 `file-summary` 在真产物上跑。
 * 独立守卫（不进 check-preflight 的 checks 计数）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【file-summary】${message}`);
  if (!condition) fails++;
};

const status = read("src/features/status/Status.tsx");
const statusCode = codeOnly(status);
const shared = read("src/features/shared/InlineCards.tsx");
const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
const css = read("src/styles/04-cards-tools.css");

/* ── 一、汇报卡本体：点行预览 / 右键菜单 / 折叠 ───────────────────────────── */

ok(status.includes("export function CompletedChanges({ turn, onOpenFile }"), "汇报卡收 onOpenFile（没有它 = 行点了没反应，onOpenFile 永远 undefined）");
ok(/onClick=\{\(\) => openPath\(file\.path, name\)\}/.test(statusCode), "行点击 → openPath（用户点名：直接打开预览）");
ok(/onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); setMenu\(/.test(statusCode), "行右键 → 弹文件卡菜单");
ok(statusCode.includes("openImageLightbox(path, name)") && statusCode.includes("onOpenFile?.(path)"),
  "openPath 分流：图片走灯箱、其余走文件预览（与消息内联卡片同口径，别各写一套）");
ok((statusCode.match(/event\.stopPropagation\(\)/g) ?? []).length >= 2,
  "行内按钮（审查 / 打开）各自 stopPropagation —— 否则点按钮连着行点击一起触发（预览 + 弹窗双开）");
ok(statusCode.includes("const COLLAPSE_LIMIT = 6;") && statusCode.includes("files.slice(0, COLLAPSE_LIMIT)"),
  "超过 6 行折叠（一口气铺满会把消息区顶飞；阈值常量要在）");
ok(/expanded \? "收起" : `再显示 \$\{files\.length - COLLAPSE_LIMIT\} 个文件`/.test(statusCode),
  "折叠钮文案：再显示 N 个文件 / 收起（用户点名的「再显示 12 个文件」式交互）");
ok(statusCode.includes('className="completed-file-thumb"') && statusCode.includes("imageUrl(file.path)"),
  "图片文件显示缩略图（用户点名「还有生成的图片」——不许退化成 PNG 文字块）");
ok(statusCode.includes('className="completed-file-new">新增'), "宿主追踪的新增文件打「新增」徽标（与「已删除」成对）");

/* ── 二、右键菜单：复用一份 + 两项点名 ───────────────────────────── */

ok(statusCode.includes('import { FileCardMenu } from "../shared/InlineCards"'),
  "菜单是**复用** shared 基座的那一份（第二份菜单实现 = 两处真相源，改一处漏一处）");
ok(shared.includes("export function FileCardMenu"), "shared 的 FileCardMenu 已导出（复用面）");
ok(shared.includes('label: "复制文件路径"') && shared.includes("copyTextToClipboard(menu.path)"),
  "菜单含「复制文件路径」且真的写剪贴板（挂空按钮 = 点了没反应）");
ok(shared.includes('label: "在文件夹中显示"') && shared.includes("shellReveal(menu.path)"),
  "菜单含「在文件夹中显示」= 用户说的「打开文件地址」（走 shell:reveal）");
ok(/\(editable \? 5 : 4\) \* itemH/.test(shared),
  "菜单高度按 5/4 项算（加了菜单项不改高度 ⇒ 视口翻转判断错位，菜单会跑出屏幕）");

/* ── 三、接线与样式 ───────────────────────────────────────────── */

ok(turnView.includes("<CompletedChanges turn={turn} onOpenFile={handlers.onOpenFile} />"),
  "turn-view 把 handlers.onOpenFile 递进汇报卡（不递 = onOpenFile 永远 undefined，行点击静默失效）");
ok(/\.completed-file\.clickable:hover/.test(css) && /\.completed-file-thumb img/.test(css) && /\.completed-more:hover/.test(css),
  "样式齐：行 hover / 缩略图裁切 / 折叠钮 hover（少一个 = 看着像坏了）");

console.log(`\n【file-summary】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
