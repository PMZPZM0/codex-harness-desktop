/**
 * 预检守卫组：12-ui-dialogs —— 应用内弹窗（不得用原生 window.confirm / prompt / alert）。
 *
 * 为什么单独成组：⛔ **Electron 原生模态框关闭后吞焦点** —— 用户实测「应用和输入框失焦，
 * 要再点一下才能继续打字」。这类问题**在静态检查里看得见**（grep window.confirm），
 * 但在构建/类型检查里全绿，只能靠结构断言钉住。2026-09-28 用户报「画布清空」弹窗失焦后
 * 立此组，并顺手清掉同类（远程控制台删机器人）。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync } from "./_ctx.mjs";

async function walk(dir, out = []) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

export async function run() {
  console.log(C.bold("\n【191】应用内弹窗（禁用原生 window.confirm/prompt/alert）"));

  const files = [...(await walk(join(ROOT, "src", "features"))), ...(await walk(join(ROOT, "src", "components")))];
  /* ① 负向断言：features/ 与 components/ 下**不得**再出现真正的原生弹窗调用。
        ⛔ 匹配前先剔注释行/文档字符串（否则注释里写「不用 window.confirm」会自己打红）。 */
  const offenders = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "").replace(/\*\s?.*$/, "");
      if (/window\.(confirm|prompt|alert)\s*\(/.test(code)) offenders.push(`${f.replace(ROOT, "").replace(/\\/g, "/")}:${i + 1}`);
    });
  }
  (offenders.length === 0 ? ok : fail)(
    `【191】渲染层无原生弹窗调用（原生模态框关闭后吞焦点 ⇒ 应用与输入框失焦）${offenders.length ? "：仍存在 " + offenders.join(" / ") : ""}`
  );

  /* ② 画布域必须有自己的应用内确认弹层（宿主 openAppConfirm 挂在设置树里，画布浮层够不到）
        —— 判据锚「状态 + 渲染 + 取消/确定按钮」三处接线，只锚常量会假绿。 */
  const canvas = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
  (/const \[confirmAsk, setConfirmAsk\]/.test(canvas) ? ok : fail)(
    "【191】画布有应用内确认弹层状态（confirmAsk）"
  );
  (/confirmAsk \? \(/.test(canvas) && /drama-canvas-modal-mask/.test(canvas) ? ok : fail)(
    "【191】确认弹层真的被渲染（drama-canvas-modal-mask 同款样式）"
  );
  (/onClick=\{\(\) => \{ const run = confirmAsk\.onConfirm; setConfirmAsk\(null\); run\(\); \}\}/.test(canvas) ? ok : fail)(
    "【191】确定按钮先关弹层再执行动作（不关会让弹层挂在清空后的画布上）"
  );
  // Escape 必须能关弹层（否则只能点「取消」）
  (/if \(confirmAsk\) \{ setConfirmAsk\(null\); return; \}/.test(canvas) ? ok : fail)(
    "【191】Escape 先关确认弹层（否则按了没反应）"
  );
  // 取消按钮默认聚焦：破坏性操作不该默认停在「确定」上
  (/is-ghost" autoFocus onClick=\{\(\) => setConfirmAsk\(null\)\}/.test(canvas) ? ok : fail)(
    "【191】确认弹层默认焦点在「取消」（防误删）"
  );
}
