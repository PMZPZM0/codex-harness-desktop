// scripts/e2e/scenarios/send-anchor-top.mjs
//
// 回归场景：**发送锚顶**（对齐 WorkBuddy 观感，09-12 用户反馈「正文出字上下跳动」）。
//
// 旧行为：发送即贴底（stickToBottom=true），回复在视口底部下方展开——每出一个字整屏
// 内容上移，「思考中」占位头塌陷时再猛坠一下 = 上下跳动。
// 新行为：发送后把这条新消息**顶到对话区顶部**，回复向下方的空白处长，第一屏上方
// 内容纹丝不动；回复长超一屏（内容开始在视口下方堆积 >64px）后自动转回贴底跟随。
//
// 本场景发一条真实消息（harness 已灌真实模型配置），断言：
//   ① 乐观气泡出现时锚在对话区顶部附近（不是底部）；
//   ② 真实回合接管后锚点平滑换位，用户消息仍钉在顶部（确认瞬间不跳）；
//   ③ 流式开始后视口依然稳定（回复未超屏时用户消息不移动）。

export const name = "send-anchor-top";
export const description = "发送锚顶：新消息钉在对话区顶部，回复向下展开（消灭出字跳动）";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCROLLER = ".timeline";
const ANCHOR = "#chat-anchor";

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
    name: "② 前置：输入框与发送键就绪",
    run: async (h) => {
      h.check("前置：输入框 .composer-editor 存在", await h.exists(".composer-editor"));
      h.check("前置：滚动容器 .timeline 存在", await h.exists(SCROLLER));
    },
  },

  {
    name: "③ 发送长消息 → 乐观气泡锚在顶部（内容溢出才有锚定意义）",
    run: async (h) => {
      // 用长消息保证发送后内容**超出视口**：away(scrollHeight-scrollTop-clientHeight)>0
      // 才能区分「锚顶」与「贴底」——贴底模式下 away 恒为 0（内容不满屏两种行为长得一样）
      const longText = "请记住以下测试材料，之后我会提问。"
        + "窗口化渲染是长会话性能的关键。".repeat(150)
        + "\n问题：只回答一个数字，1+1=?";
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", longText);
      await wait(400);
      await h.click(".send-button");
      const appeared = await h
        .waitFor(`!!document.querySelector("${ANCHOR}")`, { label: "乐观气泡出现", timeoutMs: 8000 })
        .then(() => true)
        .catch(() => false);
      h.check("发送后乐观气泡出现", appeared);
      if (!appeared) return;
      await wait(500); // 等锚顶滚动生效
      const pos = await h.eval(`(() => {
        const scroller = document.querySelector("${SCROLLER}");
        const anchor = document.querySelector("${ANCHOR}");
        const s = scroller.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        // 诊断：锚点上方有什么（前两个可见兄弟/子元素的类名与高度）
        const above = [];
        let node = anchor?.previousElementSibling;
        for (let i = 0; node && i < 3; i++) {
          const r = node.getBoundingClientRect();
          if (r.height > 0) above.push(String(node.className || node.tagName).slice(0, 40) + ":" + Math.round(r.height));
          node = node.previousElementSibling;
        }
        return { gap: Math.round(a.top - s.top), scrollTop: Math.round(scroller.scrollTop), away: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight), hasWelcome: !!document.querySelector(".welcome-state"), above };
      })()`);
      // 锚定生效的三个特征：内容溢出（away>0）+ 气泡顶在容器顶（gap 小）+ 不在底部（scrollTop<scrollHeight-clientHeight）
      h.check("发送后内容溢出视口（away>80，贴底模式不可能）", pos.away > 80, JSON.stringify(pos));
      // 新会话第一条消息：欢迎块要等会话真正建立才卸载，期间布局由它支配（中间态，
      // 会话建立后的钉顶由步骤④兜底）——欢迎块尚存时豁免 gap 断言
      if (pos.hasWelcome) {
        h.check("欢迎块尚存（新会话中间态，跳过 gap 断言）", true, "welcome-state 在场");
      } else {
        h.check("乐观气泡锚在对话区顶部（gap<64px）", pos.gap >= -10 && pos.gap < 64, JSON.stringify(pos));
      }
      await h.screenshot("发送后锚顶");
    },
  },

  {
    name: "④ 真实回合接管 → 用户消息钉在顶部、无双显",
    run: async (h) => {
      const turnAppeared = await h
        .waitFor(`!!document.querySelector(".turn-group.running") || document.querySelectorAll(".turn-group").length > 0`, { label: "真实回合出现", timeoutMs: 20000 })
        .then(() => true)
        .catch(() => false);
      h.check("真实回合出现", turnAppeared);
      if (!turnAppeared) return;
      await wait(800); // 等换锚滚动
      const pos = await h.eval(`(() => {
        const scroller = document.querySelector("${SCROLLER}");
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const s = scroller.getBoundingClientRect();
        const g = last.getBoundingClientRect();
        // 用户可见属性：消息正文在时间线只出现一次（乐观/真实双显 = 跳动 + 重影）
        const hits = (scroller.innerText || "").split("1+1").length - 1;
        return { gap: Math.round(g.top - s.top), textHits: hits };
      })()`);
      // 用户消息钉在顶部：顶部对齐（gap∈[-20,96)）。gap 大负值 = 消息被卷出视口上方（贴底接管了）= 失败
      h.check("用户消息钉在顶部（-20px ≤ gap < 96px）", pos.gap >= -20 && pos.gap < 96, JSON.stringify(pos));
      h.check("消息无双显（乐观气泡已被接管/去重）", pos.textHits === 1, JSON.stringify(pos));
      await h.screenshot("真实回合接管后");
    },
  },

  {
    name: "⑤ 流式出字期间视口稳定（未超屏时用户消息不动）",
    run: async (h) => {
      // 取当前用户消息顶部位置，等 2.5 秒流式后再取——回复没长超一屏时它必须原地不动
      const before = await h.eval(`(() => {
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        return last ? Math.round(last.getBoundingClientRect().top) : null;
      })()`);
      await wait(2500);
      const after = await h.eval(`(() => {
        const groups = [...document.querySelectorAll(".turn-group")];
        const last = groups[groups.length - 1];
        const scroller = document.querySelector("${SCROLLER}");
        return { top: last ? Math.round(last.getBoundingClientRect().top) : null, away: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) };
      })()`);
      h.check("用户消息位置有效（前置）", before !== null && after.top !== null, JSON.stringify({ before, after }));
      // 回复未长超一屏（away 小）时，视口稳定 = 顶部位置不大幅移动
      if (after.away < 200) {
        h.check("流式期间视口稳定（用户消息移动 <40px）", Math.abs((after.top ?? 0) - (before ?? 0)) < 40, JSON.stringify({ before, after }));
      } else {
        // 回复已超屏转贴底：内容上移是预期行为，跳过稳定性断言
        h.check("回复已超屏（转贴底跟随），跳过锚定稳定性断言", true, `away=${after.away}`);
      }
    },
  },

  {
    name: "⑥ 无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
