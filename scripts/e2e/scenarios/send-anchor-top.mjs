// scripts/e2e/scenarios/send-anchor-top.mjs
//
// 回归场景：**发送锚顶·连发版**（对齐 WorkBuddy 观感，09-12 用户反馈「正文出字
// 上下跳动/来回闪」，并明确要求「每次发新消息都要在那个位置」）。
//
// 钉住的事（连发三条消息逐条验证）：
//   1) **每一条**新消息发出去都被钉到对话区顶部（不是只有第一条）；
//   2) 流式出字期间消息原地不动（视口稳定 = 不跳动）、不自动贴底；
//   3) 消息无双显（乐观气泡被真实回合接管/渲染去重）；
//   4) 输入链路零回归、无渲染层报错。
//
// 真实引擎 + 真实模型配置（harness 已灌），每轮等上一轮回复完成再发下一条。

export const name = "send-anchor-top";
export const description = "发送锚顶·连发：每条新消息都钉在对话区顶部，流式稳定不跳动";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCROLLER = ".timeline";
const ANCHOR = "#chat-anchor";
let seq = 0;

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 30000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
  await wait(1500);
}

/** 发一条消息并断言「钉顶 + 无双显 + 流式稳定 + 不自动贴底」 */
async function sendAndAssertPinned(h, text, label) {
  seq += 1;
  await h.clearInput(".composer-editor");
  await h.typeInto(".composer-editor", text);
  await wait(300);
  const baseTurns = await h.eval(`document.querySelectorAll(".turn-group").length`);
  await h.click(".send-button");
  await wait(1200);
  const sentProbe = await h.eval(`!!document.querySelector("${ANCHOR}") || document.querySelectorAll(".turn-group").length > ${baseTurns}`);
  if (!sentProbe) {
    await h.eval(`document.querySelector(".composer-editor")?.focus()`);
    await h.pressKey("Enter");
  }
  const appeared = await h
    .waitFor(`!!document.querySelector("${ANCHOR}") || document.querySelectorAll(".turn-group").length > ${baseTurns}`, { label: `${label} 消息出现`, timeoutMs: 10000 })
    .then(() => true)
    .catch(() => false);
  h.check(`[${label}] 消息出现`, appeared);
  if (!appeared) return;
  // 轮询等钉顶稳定（欢迎块卸载/真实回合接管是布局剧变，允许最多 10s 收敛）
  let pos = null;
  let settled = false;
  for (let i = 0; i < 33; i++) {
    pos = await h.eval(`(() => {
      const scroller = document.querySelector("${SCROLLER}");
      const groups = [...document.querySelectorAll(".turn-group")];
      const last = groups[groups.length - 1];
      if (!last) return { gap: null };
      const s = scroller.getBoundingClientRect();
      const g = last.getBoundingClientRect();
      return { gap: Math.round(g.top - s.top) };
    })()`);
    if (pos.gap !== null && pos.gap >= -64 && pos.gap < 96) { settled = true; break; }
    await wait(300);
  }
  h.check(`[${label}] 消息钉在对话区顶部（-64px ≤ gap < 96px）`, settled, JSON.stringify(pos));
  await h.screenshot(`${label}-钉顶`);
  // 流式期间（2.5s 窗口）消息原地不动 + 不自动贴底
  const before = pos ? pos.gap : null;
  await wait(2500);
  const after = await h.eval(`(() => {
    const scroller = document.querySelector("${SCROLLER}");
    const groups = [...document.querySelectorAll(".turn-group")];
    const last = groups[groups.length - 1];
    const s = scroller.getBoundingClientRect();
    const g = last.getBoundingClientRect();
    return { gap: Math.round(g.top - s.top), away: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) };
  })()`);
  h.check(`[${label}] 流式期间钉顶稳定（移动 <40px）`, before !== null && Math.abs(after.gap - before) < 40, JSON.stringify({ before, after }));
  h.check(`[${label}] 不自动贴底（视口保持钉顶）`, after.away > 80, `away=${after.away}`);
  // 无双显：乐观/真实渲染同一文本只能出现一次
  const key = text.startsWith("【") ? text.slice(0, 4) : text.slice(0, 12);
  const hits = await h.eval(`(() => {
    const scroller = document.querySelector("${SCROLLER}");
    return (scroller.innerText || "").split(${JSON.stringify(key)}).length - 1;
  })()`);
  h.check(`[${label}] 消息无双显`, hits === 1, `命中 ${hits} 次`);
  const dbg = await h.eval(`(() => { if (!window.__adbg) return "NO-ARRAY"; window.__adbg.push({ r: "scenario-probe" }); return { n: window.__adbg.length, tail: window.__adbg.slice(-30) }; })()`);
  console.log(`  [锚定调试 ${label}]`, JSON.stringify(dbg));
}

/** 等当前回合结束（.running 消失），60s 上限 */
async function waitForTurnDone(h, label) {
  const done = await h
    .waitFor(`![...document.querySelectorAll(".turn-group")].some(g => g.className.includes("running"))`, { label: `${label} 回复完成`, timeoutMs: 60000 })
    .then(() => true)
    .catch(() => false);
  h.check(`[${label}] 回复已完成`, done);
  await wait(600);
  // 诊断：发送键此时是什么状态（发送 vs 暂停/队列）
  const btn = await h.eval(`(() => { const b = document.querySelector(".send-button"); return b ? { title: b.title, aria: b.getAttribute("aria-label"), cls: b.className.slice(0,80), html: b.innerHTML.slice(0,80) } : null; })()`);
  console.log(`  [诊断] ${label} 完成后发送键：`, JSON.stringify(btn));
}

export const steps = [
  {
    name: "① 进入主界面",
    run: async (h) => {
      await enterMain(h);
      h.check("已进入主界面", await h.exists(".app-shell"));
      h.check("前置：输入框与滚动容器就绪", (await h.exists(".composer-editor")) && (await h.exists(SCROLLER)));
    },
  },

  {
    name: "② 第一条（长消息）：钉顶 + 流式稳定",
    run: async (h) => {
      const longText = "【标记一】请记住以下测试材料，之后我会提问。"
        + "窗口化渲染是长会话性能的关键。".repeat(150)
        + "\n问题：只回答一个数字，1+1=?";
      await sendAndAssertPinned(h, longText, "第一条");
    },
  },

  {
    name: "③ 等第一轮完成",
    run: async (h) => { await waitForTurnDone(h, "第一条"); },
  },

  {
    name: "④ 第二条（短消息）：同样钉顶",
    run: async (h) => {
      await sendAndAssertPinned(h, "【标记二】继续，2+2等于几？只回答数字", "第二条");
    },
  },

  {
    name: "⑤ 等第二轮完成",
    run: async (h) => { await waitForTurnDone(h, "第二条"); },
  },

  {
    name: "⑥ 第三条（中长消息）：同样钉顶",
    run: async (h) => {
      const mid = "【标记三】" + "再用三句话介绍一下秋天的特点，不要标题，直接开始。".repeat(6);
      await sendAndAssertPinned(h, mid, "第三条");
    },
  },

  {
    name: "⑦ 收尾：输入框仍可输入 + 无渲染层报错",
    run: async (h) => {
      const typed = "anchor-regression";
      await h.typeInto(".composer-editor", typed);
      const value = String(await h.text(".composer-editor"));
      h.check("输入框仍可正常输入", value.includes(typed), value.slice(0, 40));
      await h.clearInput(".composer-editor");
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
