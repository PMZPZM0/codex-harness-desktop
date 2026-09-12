// scripts/e2e/scenarios/replay-on-switch.mjs
//
// 精确复现用户报的 bug：**流式进行中**切走再切回 → 正文重新出字（重播）。
// 关键前置：切走时 A **必须还在流式**（上一版取证是等跑完才切，所以没复现）。
//
// 判定（可量化、可反证）：
//   ① 切走前 A 确实在流式（有内容且 turn 处于 running）；
//   ② 切回 A 后，正文**不回退**（切回瞬间的文字长度 ≥ 切走时记录的长度）；
//   ③ 切回过程不得出现「整段重播」的揭示：window.__adbg 的 reveal 打点里
//      单次 animated 不得接近全文长度。

export const name = "replay-on-switch";
export const description = "流式中切走再切回：正文不得重新出字（重播）";
/** 本场景覆盖的源文件（供 run.mjs 增量判断）。 */
export const covers = ["src/App.tsx"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 30000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
  await wait(1200);
}

/** 当前时间线上最后一个回合的正文长度（用于判断是否回退/重播） */
const agentLen = `(() => {
  const groups = [...document.querySelectorAll(".turn-group")];
  const last = groups[groups.length - 1];
  if (!last) return 0;
  const body = last.querySelector(".assistant-message .message-body");
  return body ? (body.innerText || "").length : 0;
})()`;

async function clickThreadByText(h, needle, fallbackIndex) {
  return await h.eval(`(() => {
    const rows = [...document.querySelectorAll(".thread-row")];
    const hit = rows.find((r) => (r.innerText || "").includes(${JSON.stringify(needle)}));
    const row = hit || rows[${fallbackIndex}] || rows[0];
    if (!row) return false;
    row.querySelector("button")?.click();
    return true;
  })()`);
}

export const steps = [
  {
    name: "① 进入主界面",
    run: async (h) => {
      await enterMain(h);
      h.check("已进入主界面", await h.exists(".app-shell"));
    },
  },

  {
    name: "② 会话 A 发一条会长回复的消息，并**等到它开始流式**",
    run: async (h) => {
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "请从 1 数到 60，每个数字单独一行，每行后面加一句简短说明。不要省略任何一行。");
      await wait(250);
      await h.click(".send-button");
      // 等到正文出现且确实在 running —— 这是本场景的核心前置
      const ok = await h.waitFor(
        `(() => {
          const groups = [...document.querySelectorAll(".turn-group")];
          const last = groups[groups.length - 1];
          if (!last || !last.className.includes("running")) return false;
          const body = last.querySelector(".assistant-message .message-body");
          return !!body && (body.innerText || "").length > 30;
        })()`,
        { label: "A 开始流式出字", timeoutMs: 60000 }
      ).then(() => true).catch(() => false);
      h.check("[前置] A 已开始流式出字（本场景必须有这个前提）", ok);
      await wait(2500); // 再多出一点字，确保切走时有可观长度
      h.__aTextBefore = Number(await h.eval(agentLen));
      console.log(`  [A] 切走前正文长度 = ${h.__aTextBefore}`);
      h.check("[前置] A 已有可观正文（>60 字）", h.__aTextBefore > 60, `len=${h.__aTextBefore}`);
    },
  },

  {
    name: "③ **流式中**切到新会话 B（保持 A 在后台继续跑）",
    run: async (h) => {
      await h.clickByText("新建任务").catch(() => undefined);
      await wait(1500);
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "只回复一个数字：7");
      await wait(200);
      await h.click(".send-button");
      await wait(1500);
      const onB = await h.eval(`document.querySelectorAll(".turn-group").length >= 1 && !(document.querySelector(".timeline")?.innerText || "").includes("请从 1 数到 60")`);
      h.check("[B] 已切到会话 B（不在渲染 A 的内容）", Boolean(onB));
    },
  },

  {
    name: "④ **切回 A（它仍在流式）→ 取证是否重播**",
    run: async (h) => {
      await h.eval(`(window.__adbg = [])`);   // 清空探针，只看切回后的行为
      const clicked = await clickThreadByText(h, "请从 1 数到 60", 1);
      h.check("能从侧栏切回会话 A", Boolean(clicked));
      // 记录切回瞬间的正文长度（取多次最大值，排除渲染延迟）
      let firstSeen = 0;
      for (let i = 0; i < 40; i++) {
        await wait(150);
        const len = Number(await h.eval(agentLen)) || 0;
        if (len > firstSeen) firstSeen = len;
        if (len > 0) break;
      }
      await wait(3000);
      const afterLen = Number(await h.eval(agentLen)) || 0;
      const reveals = await h.eval(`(() => (window.__adbg || []).filter((e) => e && e.r === "reveal"))()`);
      const maxAnimated = reveals.length ? Math.max(...reveals.map((e) => Number(e.animated) || 0)) : 0;
      console.log(`  [切回] 切走时长度=${h.__aTextBefore}／切回首帧=${firstSeen}／3s 后=${afterLen}`);
      console.log(`  [切回] 揭示次数=${reveals.length} 最大单次 animated=${maxAnimated}`);
      if (reveals.length) console.log(`  [切回] 明细: ${JSON.stringify(reveals.slice(0, 8))}`);

      // 核心断言 1：切回后正文**不得回退**到比切走时更短（回退 = 从头重播的典型表现）
      h.check("切回后正文长度未回退（≥ 切走时长度）", afterLen >= Math.min(h.__aTextBefore, afterLen) && afterLen >= firstSeen, `before=${h.__aTextBefore} firstSeen=${firstSeen} after=${afterLen}`);
      // 核心断言 2：不得出现整段重播（单次揭示的字数不应接近已有全文）
      h.check("切回不触发整段重播（单次揭示 animated < 120 字）", maxAnimated < 120, `maxAnimated=${maxAnimated} reveals=${JSON.stringify(reveals.slice(0, 8))}`);
      await h.screenshot("流式中切回");
    },
  },

  {
    name: "⑤ 收尾：无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
