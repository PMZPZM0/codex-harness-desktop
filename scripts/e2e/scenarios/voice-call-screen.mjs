// scripts/e2e/scenarios/voice-call-screen.mjs
//
// 回归场景：**应用内实时通话界面**（手机来电式全屏遮罩，不是独立窗口）。
//
// 钉住的事：
//   1) 入口：悬浮球右键菜单有「打开通话界面」，点了在**应用内**出现全屏通话界面。
//   2) 界面要素齐全：大头像 + 状态字 + 底部大圆钮（开始通话/用悬浮球/挂断/打断）。
//   3) 收起 ≠ 挂断：右上角收起后界面消失、悬浮球还在（通话控制权回到悬浮球）。
//   4) 零回归：界面收起后输入框仍可正常打字（全屏遮罩绝不能挡住主链路）。
//
// 不点「开始通话」跑真实通话（模型 + 麦克风不适合自动回归）；
// 通话链路回归见 voice-call 场景 + preflight 纯逻辑断言。

export const name = "voice-call-screen";
export const description = "应用内通话界面：右键入口 + 界面要素 + 收起不挂断 + 输入零回归";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BALL = ".voice-ball";
const MENU = ".voice-ball-menu";
const SCREEN = ".voice-call-screen";

/** 右键悬浮球并等菜单出现，返回菜单是否成功打开 */
async function openBallMenu(h) {
  const ctx = await h.eval(`(() => {
    const ball = document.querySelector("${BALL}");
    if (!ball) return false;
    const r = ball.getBoundingClientRect();
    ball.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return true;
  })()`);
  if (!ctx) return false;
  return h.waitFor(`!!document.querySelector("${MENU}")`, { label: "右键菜单出现", timeoutMs: 5000 })
    .then(() => true)
    .catch(() => false);
}

/** 点右键菜单里的「打开通话界面」 */
async function clickMenuItem(h, keyword) {
  return h.eval(`(() => {
    const b = [...document.querySelectorAll("${MENU} button")].find(x => (x.innerText || "").includes(${JSON.stringify(keyword)}));
    if (!b) return false; b.click(); return true;
  })()`);
}

export const steps = [
  {
    name: "① 进入主界面",
    run: async (h) => {
      await h.waitFor(
        `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
        { label: "引导页或主界面", timeoutMs: 30000 }
      );
      const hasGuide = await h.eval(`document.body.innerText.includes("直接进入")`);
      if (hasGuide) await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
      await wait(1500);
      h.check("已进入主界面", true);
    },
  },

  {
    name: "② 前置：悬浮球在、通话界面未开",
    run: async (h) => {
      h.check("前置：语音悬浮球存在", await h.exists(BALL));
      h.check("前置：通话界面初始未打开", !(await h.exists(SCREEN)));
    },
  },

  {
    name: "③ 右键 → 打开通话界面 → 要素齐全",
    run: async (h) => {
      const menuShown = await openBallMenu(h);
      h.check("右键菜单出现", menuShown);
      if (!menuShown) return;
      const items = await h.eval(`[...document.querySelectorAll("${MENU} button")].map(b => (b.innerText || "").trim()).join("|")`);
      h.check("菜单有「打开通话界面」", String(items).includes("打开通话界面"), String(items));
      await h.screenshot("悬浮球右键菜单");
      await clickMenuItem(h, "打开通话界面");
      const opened = await h
        .waitFor(`!!document.querySelector("${SCREEN}")`, { label: "通话界面出现", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("通话界面在应用内打开", opened);
      if (!opened) return;
      const text = await h.text(SCREEN);
      h.check("界面有「语音通话」状态字", String(text).includes("语音通话"), String(text).slice(0, 80).replace(/\n/g, " "));
      h.check("界面有「开始通话」大钮", String(text).includes("开始通话"), String(text).slice(0, 80).replace(/\n/g, " "));
      h.check("界面有「用悬浮球」次级钮", String(text).includes("用悬浮球"));
      h.check("界面有大头像", await h.exists(".voice-call-avatar"));
      h.check("界面有收起钮（收起≠挂断）", await h.exists(".voice-call-min"));
      await h.screenshot("通话界面");
    },
  },

  {
    name: "④ 收起 → 界面消失、悬浮球保留",
    run: async (h) => {
      if (!(await h.exists(SCREEN))) {
        h.check("通话界面存在（前置）", false, "上一步未打开");
        return;
      }
      await h.eval(`(() => { const b = document.querySelector(".voice-call-min"); if (!b) return false; b.click(); return true; })()`);
      const closed = await h
        .waitFor(`!document.querySelector("${SCREEN}")`, { label: "通话界面收起", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("点收起后通话界面消失", closed);
      h.check("收起后悬浮球仍在（控制权回到悬浮球）", await h.exists(BALL));
    },
  },

  {
    name: "⑤ 复开不炸 + 输入链路零回归",
    run: async (h) => {
      const menuShown = await openBallMenu(h);
      if (!menuShown) { h.check("再次打开右键菜单", false); return; }
      await clickMenuItem(h, "打开通话界面");
      const reopened = await h
        .waitFor(`!!document.querySelector("${SCREEN}")`, { label: "通话界面复开", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("通话界面可再次打开", reopened);
      if (reopened) {
        await h.eval(`(() => { const b = document.querySelector(".voice-call-min"); if (b) b.click(); })()`);
        await wait(400);
      }
      // 全屏遮罩关闭后绝不能挡输入链路：真打字一遍
      const typed = "call-screen-regression";
      await h.typeInto(".composer-editor", typed);
      const value = String(await h.text(".composer-editor"));
      h.check("收起后输入框仍可正常输入", value.includes(typed), value.slice(0, 60));
      await h.eval(`(() => {
        const el = document.querySelector(".composer-editor");
        if (!el) return false;
        el.focus();
        document.execCommand("selectAll");
        document.execCommand("delete");
        return true;
      })()`);
      await wait(200);
    },
  },

  {
    name: "⑥ 无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
