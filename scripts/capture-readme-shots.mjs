/* 一次性：给 README 截新版主界面图（光/暗双主题）→ docs/screenshots/
 * 用法：node scripts/capture-readme-shots.mjs   （真拉起应用，跑完自动退出）
 */
import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "./e2e/lib/harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const h = new ElectronHarness({ name: "readme-shots", persistent: true });
await h.launch();
await new Promise((r) => setTimeout(r, 6000));
await h.waitFor(`!!document.querySelector(".composer-editor") || !!document.querySelector(".thread-row")`, { label: "界面就绪", timeoutMs: 45000 }).catch(() => undefined);
await new Promise((r) => setTimeout(r, 2500));

/* 光色（当前主题）→ docs/screenshots/main-light.png */
const lightPath = await h.screenshot("readme-main-light");
copyFileSync(lightPath, join(OUT, "main-light.png"));
console.log("captured main-light.png");

/* 暗色：点侧栏自带的「深色」切换按钮（渲染层自己的主题状态，不绕 store） */
try {
  await h.clickByTitle("深色");
  console.log("clicked dark toggle");
} catch (e) { console.log("dark toggle miss:", e.message); }
await new Promise((r) => setTimeout(r, 2500));
const darkPath = await h.screenshot("readme-main-dark");
copyFileSync(darkPath, join(OUT, "main-dark.png"));
console.log("captured main-dark.png");

/* 恢复浅色（不留状态给下一次运行） */
try { await h.clickByTitle("浅色"); } catch { /* 忽略 */ }

try { h.child && h.child.kill(); } catch { /* 忽略 */ }
process.exit(0);
