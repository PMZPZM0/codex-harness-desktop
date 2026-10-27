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
  && /\.composer-rail\s*\{[^}]*top:\s*\d+px[^}]*bottom:\s*\d+px/s.test(railCss),
  "竖条**竖着骑在输入框左边框线上**（right:100% + 手柄 translateX(50%)，10-27 用户二改）；top/bottom 拉伸 ⇒ 跟输入框一样高");

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

/* ③ 弹层自适应 */
ok(/function placePanel\(anchor: DOMRect/.test(rail) && /Math\.min\(left, viewport\.w - w - pad\)/.test(rail)
  && /Math\.min\(top, viewport\.h - h - pad\)/.test(rail),
  "弹层按实测矩形定位并夹进视口（不写死坐标，小窗口/主窗口都不会被切）");
ok(/rightRoom >= w \|\| rightRoom >= leftRoom \? anchor\.right \+ gap : anchor\.left - gap - w/.test(rail),
  "右开优先、右边放不下就翻到左边");
ok(/createPortal\(/.test(rail), "弹层 portal 到 body（不被输入区的 overflow 裁掉）");
ok(/\.composer-rail-icons\s*\{[^}]*max-height:\s*100%/s.test(railCss), "图标列不超出输入框高度（超出内部滚动）");

/* ④ 密码本：明文不进渲染层 */
const vaultMain = src("electron/features/vault-ipc.ts");
ok(/safeStorage\.encryptString/.test(vaultMain) && /safeStorage\.decryptString/.test(vaultMain), "密码本用系统 safeStorage 加解密");
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
ok(/`\$\{sticker\.emoji\}（\$\{sticker\.gloss\}）`/.test(stickers), "表情插入「emoji +（中文释义）」，模型直接读得懂");

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

console.log(`\n【rail】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
