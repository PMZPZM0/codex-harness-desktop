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
/** 本场景负责覆盖的源文件（供 run.mjs 增量判断）。 */
export const covers = ["src/components/scroll-utils.ts", "src/styles.css"];

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
  // ── 防抖断言（09-12 用户实测「每次新一行出字，消息整体往上抖一下」）──
  // 在**出字进行中**连续采样，比较每一次相邻采样的消息位置：抖动 = 相邻跳变。
  // 用「相邻跳变」而不是「总位移」——总位移会因为「攒够一行才跟随」而正常增大，
  // 那是有意为之的平滑跟随，不是抖动。
  const jitter = await h.eval(`(async () => {
    const s = document.querySelector("${SCROLLER}");
    if (!s) return null;
    const gaps = [];
    for (let i = 0; i < 14; i++) {
      const g = [...document.querySelectorAll(".turn-group")].pop();
      if (g) gaps.push(Math.round(g.getBoundingClientRect().top - s.getBoundingClientRect().top));
      await new Promise((r) => setTimeout(r, 90));
    }
    let maxJump = 0;
    for (let i = 1; i < gaps.length; i++) maxJump = Math.max(maxJump, Math.abs(gaps[i] - gaps[i - 1]));
    return { gaps, maxJump };
  })()`);
  console.log(`  [防抖 ${label}] 相邻最大跳变=${jitter?.maxJump}px 采样=${JSON.stringify(jitter?.gaps)}`);
  // 阈值：一行约 24px；单次相邻跳变若超过一行半（36px）就是肉眼可见的「抖一下」。
  h.check(`[${label}] 出字期间无抖动（相邻跳变 <36px）`, jitter != null && jitter.maxJump < 36, JSON.stringify(jitter));
  // 「不自动贴底」的判据必须是「视口没被拉到内容最底部」（scrollTop < maxScroll），
  // 不能用 away 的绝对值：短回复（回答只有一行）在视口里本来就凑不满一屏，
  // away 天然很小——那不代表落到了底部（09-12 实测：gap 稳定在 1~6px，away 仅 67）。
  const atBottom = await h.eval(`(() => {
    const s = document.querySelector("${SCROLLER}");
    return { scrollTop: Math.round(s.scrollTop), maxScroll: Math.round(s.scrollHeight - s.clientHeight) };
  })()`);
  h.check(`[${label}] 不自动贴底（视口未停在内容最底部）`, atBottom.scrollTop < atBottom.maxScroll - 4, JSON.stringify(atBottom));
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
    name: "② 第一条（**短**消息）：钉顶 + 流式稳定",
    run: async (h) => {
      // 短消息：能装进一屏 → 应当钉顶（长消息另有 ⑥ter 专门验「跟到回复位置」）
      const shortText = "【标记一】只回答一个数字，1+1=?";
      await sendAndAssertPinned(h, shortText, "第一条");
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
    name: "⑥bis **长回复时最新内容必须可见**（回归：钉顶把正文推出屏幕 = 大片空白）",
    run: async (h) => {
      // 先确保消息已钉在顶部（前置条件），再等回复长到超过一屏
      const pinned = await h.eval(`(() => {
        const s = document.querySelector("${SCROLLER}");
        const g = [...document.querySelectorAll(".turn-group")].pop();
        if (!s || !g) return null;
        return { gap: Math.round(g.getBoundingClientRect().top - s.getBoundingClientRect().top) };
      })()`);
      h.check("[前置] 第三条已钉在顶部附近", pinned && pinned.gap >= -64 && pinned.gap < 96, JSON.stringify(pinned));
      // 等回复长过一屏（最多 40s）
      const grew = await h.waitFor(`(() => {
        const s = document.querySelector("${SCROLLER}");
        return s && s.scrollHeight > s.clientHeight * 1.6;
      })()`, { label: "回复长过一屏", timeoutMs: 40000 }).then(() => true).catch(() => false);
      h.check("[前置] 回复确实长过一屏（否则本断言无意义）", grew);
      await wait(2500);
      // 核心断言：内容溢出后，视口底部必须贴近内容底部（跟随），否则就是「正文流到屏幕外」
      const vis = await h.eval(`(() => {
        const s = document.querySelector("${SCROLLER}");
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const lr = last ? last.getBoundingClientRect() : null;
        return {
          away: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
          maxScroll: Math.round(s.scrollHeight - s.clientHeight),
          scrollTop: Math.round(s.scrollTop),
          lastBottom: lr ? Math.round(lr.bottom) : null,
          viewBottom: Math.round(s.getBoundingClientRect().bottom),
        };
      })()`);
      console.log(`  [长回复可见性] ${JSON.stringify(vis)}`);
      // 内容溢出后应已交回跟随：视口距内容底部不超过 120px 级别，而不是钉死在锚点位置
      // （钉死会让 away 涨到几百甚至上千像素 —— 正是用户看到的「大片空白 + 看不到最新」）。
      h.check("[长回复] 视口已跟随到内容底部（away ≤ 120px）", vis.away <= 120, JSON.stringify(vis));
      h.check("[长回复] 最后一个回合的底部落在视口内（正文没被推出屏幕）",
        vis.lastBottom != null && vis.lastBottom <= vis.viewBottom + 4, JSON.stringify(vis));
      await h.screenshot("长回复可见性");
    },
  },

  {
    name: "⑥ter **长消息（自身超一屏）→ 直接跟到 agent 回复位置**",
    run: async (h) => {
      // 构造一条明显超过一屏的用户消息（约 3 屏）
      const huge = "【标记超长】" + "这是一段用于把用户消息撑到超过一屏的填充文本，目的是验证长消息不钉顶而是跟到回复。".repeat(90);
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", huge);
      await wait(300);
      await h.click(".send-button");
      const appeared = await h.waitFor(`!!document.querySelector("#chat-anchor") || [...document.querySelectorAll(".turn-group")].some(g => (g.innerText||"").includes("标记超长"))`, { label: "超长消息出现", timeoutMs: 20000 }).then(() => true).catch(() => false);
      h.check("[超长] 消息已发出并渲染", appeared);
      await wait(3500);   // 等回复开始出现
      const r = await h.eval(`(() => {
        const s = document.querySelector("${SCROLLER}");
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const lastUser = [...groups].reverse().find((g) => (g.innerText || "").includes("标记超长"));
        const ur = lastUser ? lastUser.getBoundingClientRect() : null;
        const sr = s.getBoundingClientRect();
        return {
          away: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight),
          maxScroll: Math.round(s.scrollHeight - s.clientHeight),
          userTopVisible: ur ? Math.round(ur.top - sr.top) : null,
          userBottomVisible: ur ? Math.round(ur.bottom - sr.top) : null,
          viewH: Math.round(sr.height),
          lastBottom: last ? Math.round(last.getBoundingClientRect().bottom - sr.top) : null,
        };
      })()`);
      console.log(`  [超长消息] ${JSON.stringify(r)}`);
      // 核心：长消息不钉顶，视口停在内容尾部区域（跟到 agent 回复位置）。
      // 容差按「流式增长量」给：断言瞬间可能刚好又长了一段，away 会有几十~百来像素的浮动；
      // 关键判据是**绝不能停在长消息开头**（那会让 away ≈ 整条消息高度，实测 1990+）。
      h.check("[超长] 视口已跟到内容底部（away ≤ 240px，即 agent 回复位置可见）", r.away <= 240, JSON.stringify(r));
      h.check("[超长] 最后一个回合底部在视口内", r.lastBottom != null && r.lastBottom <= r.viewH + 4, JSON.stringify(r));
      await h.screenshot("超长消息跟到回复");
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
