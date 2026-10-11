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

  /* ③ 回合级覆盖层的释放（10-11 用户报障：**手动停止后审批弹窗与询问弹窗留在界面上**）。
        询问卡与审批卡都是**阻塞式**的（引擎在等回包），回合结束后必须一起收掉。
        ⛔ 这里**真跑**那个纯函数（Node type-stripping 直载 src 的 .ts），不是 grep 字符串 ——
           只锚声明会假绿（记忆里的纪律：断言要锚「接线 / 取值」）。 */
  console.log(C.bold("\n【287】回合结束必须释放「等用户操作」的覆盖层（询问卡 / 审批卡）"));
  const count = (src, re) => (src.match(re) ?? []).length;
  const helperPath = join(ROOT, "src", "features", "app-view", "helpers", "turn-overlays.ts");
  const barrelSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers.tsx"), "utf8");
  const helperSrc = readFileSync(helperPath, "utf8");
  const threadSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "event-router", "03-thread-id.tsx"), "utf8");
  const stopSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "03-seg.tsx"), "utf8");

  (barrelSrc.includes("./helpers/turn-overlays") && !/function releaseTurnOverlays/.test(threadSrc) && !/function releaseTurnOverlays/.test(stopSrc) ? ok : fail)(
    "【287】释放逻辑只有一处实现（app-view/helpers/turn-overlays）—— 不许在调用方各写一份"
  );
  // ⛔ 数的是**调用点**（带实参 `bag, String(params.threadId`），别把函数定义那句也数进来
  (count(threadSrc, /releaseOverlaysOf\(bag, String\(params\.threadId/g) === 2 ? ok : fail)(
    "【287】两组回合结束事件都接了释放（turn/completed + turn/aborted·failed·interrupted）——后者是引擎侧中止 / 手机端 / 语音打断的唯一兜底"
  );
  (count(stopSrc, /releaseTurnOverlays\(\{/g) === 1 ? ok : fail)(
    "【287】用户点「停止」的路径（interrupt()）也接了释放 —— 不必等引擎的结束事件"
  );
  (/action: "cancel"/.test(helperSrc) && /answers: \{\}/.test(helperSrc) && /decision: "decline"/.test(helperSrc) ? ok : fail)(
    "【287】取消回包形状全部取自协议 schema（elicitation=action:cancel / requestUserInput=answers 空表 / 审批=decision:decline）—— 别自造"
  );

  // 真跑：单独一个会话的卡、另一个会话的卡、没有归属的卡，一次全走一遍
  try {
    const { pathToFileURL } = await import("node:url");
    const mod = await import(pathToFileURL(helperPath).href);
    const runOnce = (opts) => {
      const answered = [];
      const resolved = [];
      const cleared = [];
      let askCleared = 0;
      const out = mod.releaseTurnOverlays({
        respond: (id, payload) => { answered.push([id, payload]); return Promise.resolve(); },
        clearPending: (ids) => cleared.push(...ids),
        clearAsk: () => { askCleared++; },
        ...opts,
        agentAsk: opts.agentAsk ? { threadId: opts.agentAsk.threadId, resolve: (a) => resolved.push(a) } : null,
      });
      return { out, answered, resolved, cleared, askCleared };
    };
    const owned = [
      { id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "T1" } },
      { id: 2, method: "mcpServer/elicitation/request", params: { threadId: "T1" } },
    ];
    const other = { id: 3, method: "item/commandExecution/requestApproval", params: { threadId: "T2" } };
    const orphan = { id: 4, method: "execCommandApproval", params: {} };

    const a = runOnce({ threadId: "T1", pending: [...owned, other, orphan], agentAsk: { threadId: "T1" } });
    (a.out.answered === 2 && a.out.askReleased === true && a.cleared.map(String).sort().join(",") === "1,2" ? ok : fail)(
      "【287】真跑：只收本会话（T1）的卡 —— 别的会话与没有归属的卡一律不动"
    );
    (a.resolved.length === 1 && a.resolved[0] === "" && a.askCleared === 1 ? ok : fail)(
      "【287】真跑：询问卡按「取消」语义释放（resolve 空串 ⇒ 处理器回一条取消给引擎），否则那个 await 永远不落地"
    );
    (a.answered[0][1].decision === "decline" && a.answered[1][1].action === "cancel" ? ok : fail)(
      "【287】真跑：回包形状按类型分发（审批 decline / elicitation cancel）"
    );

    const b = runOnce({ threadId: "T1", pending: [orphan], agentAsk: null });
    (b.out.answered === 0 && b.cleared.length === 0 ? ok : fail)(
      "【287】真跑：没有 threadId 的卡默认不碰（legacy 审批参数就没有 threadId，不能瞎认领）"
    );
    const c = runOnce({ threadId: "T1", pending: [orphan], agentAsk: null, includeUnattributed: true });
    (c.out.answered === 1 && c.cleared.map(String).join(",") === "4" ? ok : fail)(
      "【287】真跑：只有在用户当前会话里才连带收掉无归属的卡（includeUnattributed）"
    );
    const d = runOnce({ threadId: "T1", pending: [], agentAsk: null });
    (d.out.answered === 0 && d.out.askReleased === false ? ok : fail)(
      "【287】真跑：幂等 —— 停止按钮先收一次、随后引擎的 turn/aborted 再收一次也不会出错"
    );
  } catch (error) {
    fail(`【287】真跑释放函数失败：${error?.message ?? error}`);
  }
}
