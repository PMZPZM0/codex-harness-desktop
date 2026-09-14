// 验证：悬浮球隐藏 → 设置页勾「显示悬浮球」→ 悬浮球恢复（走真实 IPC 链路）
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "../scripts/e2e/lib/harness.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const h = new ElectronHarness({ root: ROOT, artifactsDir: join(ROOT, ".e2e-artifacts"), namePrefix: "ball-", profileName: "main" });
let fail = 0;
const check = (c, l, x = "") => { console.log((c ? "  ✓ " : "  ✗ ") + l + (x ? "  " + x : "")); if (!c) fail++; };
await h.launch();
try {
  await wait(3500);
  const vis = () => h.eval(`(() => ({ ball: !!document.querySelector('.voice-ball, [class*="voice-ball"]'), visible: (() => { const b = document.querySelector('.voice-ball, [class*="voice-ball"]'); return b ? getComputedStyle(b).display !== 'none' : false; })() }))()`);
  const set = (patch) => h.eval(`(async () => { await window.codex.voiceSettingsSet(${JSON.stringify(patch)}); return true; })()`);

  // 前置：悬浮球存在且显示
  await h.eval(`(() => { const t=[...document.querySelectorAll('.view-tab')].find(x=>(x.textContent||'').includes('项目')); if (t) t.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; })()`);
  await wait(800);
  const before = await vis();
  console.log("初始:", JSON.stringify(before));
  check(before.ball, "前置：悬浮球在 DOM 中", JSON.stringify(before));

  // ① 模拟右键「隐藏悬浮球」：settingsSet 落盘 visible=false
  await set({ ball: { visible: false, hints: true } });
  await wait(800);
  const hidden = await vis();
  console.log("隐藏后:", JSON.stringify(hidden));
  check(!hidden.visible, "★ 隐藏后悬浮球消失");

  // ② 模拟设置页勾「显示悬浮球」：settingsSet 落盘 visible=true → 广播 → 组件应恢复
  await set({ ball: { visible: true, hints: true } });
  await wait(800);
  const restored = await vis();
  console.log("勾选恢复后:", JSON.stringify(restored));
  check(restored.ball && restored.visible, "★ 勾选后悬浮球恢复（BUG 修复点）");

  // ③ 再走一轮隐藏/恢复（确认不是偶然）
  await set({ ball: { visible: false, hints: true } });
  await wait(600);
  const h2 = await vis();
  await set({ ball: { visible: true, hints: true } });
  await wait(600);
  const r2 = await vis();
  check(!h2.visible && r2.ball && r2.visible, "第二轮隐藏→恢复也正常");
} catch (e) { console.error("异常:", e.message); fail++; }
finally { await h.close(); }
console.log("\n" + (fail ? `验收失败 ${fail} 项` : "全部通过 ✓"));
process.exit(fail ? 1 : 0);
