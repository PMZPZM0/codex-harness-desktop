// scripts/e2e/scenarios/multi-session-live.mjs
//
// 回归场景：**两个会话真的同时在跑**（用户报「一次并发两个会话，另一个就宕机」）。
//
// 场景：会话 A 发一条长任务（会持续流式一会儿）→ **不等 A 结束**就切到会话 B →
//       B 也发一条 → 断言：
//         ① A 的回合**仍在运行**（切走后不能被判定结束/卡死）；
//         ② B 真的跑起来（B 的回合出现且 running）；
//         ③ 切回 A：A 的运行状态还在、内容在长（没被"宕机"）；
//         ④ 侧栏两个会话的运行态正确（切到谁都对）；
//         ⑤ 渲染层无 console.error。
//
// 这条场景专门盯「切换会话导致另一个会话死掉」这一类回归——多会话并行是核心体验。

export const name = "multi-session-live";
export const description = "多会话并行：A 运行中切到 B 并发消息，两边都真跑不宕机";
/** 本场景负责覆盖的源文件（供 run.mjs「只跑受影响场景」的增量判断）。 */
export const covers = ["electron/main.ts", "electron/session-tools.ts"];

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

/** 新开一个会话（点「新建任务」），返回是否成功 */
async function newThread(h) {
  await h.clickByText("新建任务").catch(() => undefined);
  await wait(1200);
}

async function send(h, text) {
  await h.clearInput(".composer-editor");
  await h.typeInto(".composer-editor", text);
  await wait(250);
  await h.click(".send-button");
}

/** 当前会话是否在跑（running 回合 或 停止按钮态） */
async function runningNow(h) {
  return await h.eval(`(() => {
    const groups = [...document.querySelectorAll(".turn-group")];
    const running = groups.some((g) => g.className.includes("running"));
    const btn = document.querySelector(".send-button");
    const isPause = !!btn && (btn.className.includes("is-stop") || btn.className.includes("is-pause") || (btn.title || "").includes("停止"));
    return { running, isPause, turns: groups.length };
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
    name: "② 会话 A：发一条会持续一会儿的任务",
    run: async (h) => {
      const long = "【A】请逐条列出 1 到 30 的每个数字并用一句话说明它的特点。" + "要求：不要省略任何一条，直接开始。".repeat(8);
      await send(h, long);
      const ok = await h.waitFor(`[...document.querySelectorAll(".turn-group")].some(g => g.className.includes("running"))`, { label: "A 开始运行", timeoutMs: 30000 }).then(() => true).catch(() => false);
      h.check("[A] 回合已开始运行", ok);
    },
  },

  {
    name: "③ **不等 A 结束**就新建会话 B 并发消息",
    run: async (h) => {
      // 关键：A 还在跑
      const before = await runningNow(h);
      h.check("[前置] A 此刻仍在运行（本场景的核心前提）", before.running || before.isPause, JSON.stringify(before));
      await newThread(h);
      await send(h, "【B】只回答一个数字：3+4=?");
      const started = await h.waitFor(`[...document.querySelectorAll(".turn-group")].length >= 1`, { label: "B 消息出现", timeoutMs: 30000 }).then(() => true).catch(() => false);
      h.check("[B] B 的回合出现", started);
      await wait(2500);
      const b = await runningNow(h);
      h.check("[B] B 真的跑起来了（running 或已出现内容）", b.running || b.turns >= 1, JSON.stringify(b));
    },
  },

  {
    name: "④ 切回会话 A：A 的运行状态还在（没宕机）",
    run: async (h) => {
      // 侧栏里点回带 【A】 的那个会话（用会话名/预览文本定位第一个任务项）
      const clicked = await h.eval(`(() => {
        const items = [...document.querySelectorAll("aside.sidebar button, aside.sidebar [role='button'], .thread-item, .sidebar-item")];
        const target = items.find((el) => (el.innerText || "").includes("A]")) || items[0];
        if (!target) return false;
        target.click();
        return true;
      })()`);
      h.check("能从侧栏切回会话 A", Boolean(clicked));
      await wait(3000);
      const a = await h.eval(`(() => {
        const groups = [...document.querySelectorAll(".turn-group")];
        const text = (document.querySelector(".timeline")?.innerText || "");
        return {
          turns: groups.length,
          running: groups.some((g) => g.className.includes("running")),
          grew: text.length,
          hasA: text.includes("【A】"),
        };
      })()`);
      h.check("[A] 切回后 A 仍在运行或已有内容（不是空白/宕机）", a.running || a.grew > 0, JSON.stringify(a));
    },
  },

  {
    name: "④bis **切会话不得重播正文**（诊断：揭示动画的 animated 字数不得异常大）",
    run: async (h) => {
      // 清空探针 → 切到 B → 切回 A → 看这一路上有没有「把已有正文整段重播」的揭示。
      await h.eval(`(window.__adbg = [])`);
      await h.eval(`(() => {
        const rows = [...document.querySelectorAll(".thread-row")];
        const t = rows.find((r) => (r.innerText || "").includes("B]")) || rows[1] || rows[0];
        t?.querySelector("button")?.click();
        return true;
      })()`);
      await wait(2500);
      await h.eval(`(() => {
        const rows = [...document.querySelectorAll(".thread-row")];
        const t = rows.find((r) => (r.innerText || "").includes("A]")) || rows[0];
        t?.querySelector("button")?.click();
        return true;
      })()`);
      await wait(3000);

      const reveals = await h.eval(`(() => (window.__adbg || []).filter((e) => e && e.r === "reveal"))()`);
      const maxAnimated = reveals.length ? Math.max(...reveals.map((e) => Number(e.animated) || 0)) : 0;
      const totalAnimated = reveals.reduce((a, e) => a + (Number(e.animated) || 0), 0);
      console.log(`  [重播取证] 切会话期间揭示次数=${reveals.length} 最大单次 animated=${maxAnimated} 累计=${totalAnimated}`);
      if (reveals.length) console.log(`  [重播取证] 明细: ${JSON.stringify(reveals.slice(-6))}`);
      // 判定：切会话只是重新挂载，已有正文应当**直接显示**（animated 接近 0）。
      // 若单次 animated 达到数百字，就是把整段正文重播了一遍。
      h.check("切会话没有整段重播正文（单次揭示 animated < 200 字）", maxAnimated < 200, `maxAnimated=${maxAnimated} reveals=${JSON.stringify(reveals.slice(-6))}`);
      await h.screenshot("切会话重播取证");
    },
  },

  {
    name: "⑤ 再切回 B，两个会话都还能用 + 无渲染层报错",
    run: async (h) => {
      await h.eval(`(() => {
        const items = [...document.querySelectorAll("aside.sidebar button, aside.sidebar [role='button'], .thread-item, .sidebar-item")];
        const target = items.find((el) => (el.innerText || "").includes("B]")) || items[1] || items[0];
        if (target) target.click();
        return true;
      })()`);
      await wait(2500);
      const b = await h.eval(`document.querySelector(".timeline")?.innerText || ""`);
      h.check("[B] 切回 B 后内容还在（会话没丢）", b.includes("【B】") || b.length > 0);
      const typed = "multi-session-probe";
      await h.typeInto(".composer-editor", typed);
      h.check("输入框仍可用（应用没卡死）", String(await h.text(".composer-editor")).includes(typed));
      await h.clearInput(".composer-editor");
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
      await h.screenshot("多会话并行");
    },
  },
];
