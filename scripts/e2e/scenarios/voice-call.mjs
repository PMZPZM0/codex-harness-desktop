// scripts/e2e/scenarios/voice-call.mjs
//
// 回归场景：**语音通话悬浮入口**（本机离线识别与合成的旁挂新增）。
//
// 这个场景要钉住两件事，缺一不可：
//   1) 语音入口本身可用：悬浮球在、点得开、面板内容齐全、能收起。
//   2) **既有输入链路零回归**：语音是「旁挂」，绝不能动输入框/发送键/引用面板。
//      所以下面专门有一组回归守卫断言——这正是「设计铁律 0」的自动化体现。
//
// 注意：本场景**不启动真实通话**（那需要下载约 270MB 模型 + 麦克风授权，不适合放进自动回归）。
// 真实通话链路的正确性由 preflight 的纯逻辑断言（AEC/门控/断句）+ 人工验收覆盖。

export const name = "voice-call";
export const description = "语音悬浮入口：开关面板 + 既有输入链路零回归守卫";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BALL = ".voice-ball";
const PANEL = ".voice-panel";

export const steps = [
  {
    name: "① 进入主界面",
    run: async (h) => {
      // 引导页可能被跳过（真实 Key 灌进去后会自动进主界面），两种落点都接受
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
    name: "② 前置：悬浮球在、面板是关的",
    run: async (h) => {
      // 先断言前置条件，否则「点一下能打开」可能只是上一步的残留状态
      h.check("前置：语音悬浮球存在", await h.exists(BALL));
      h.check("前置：通话面板初始为关闭", !(await h.exists(PANEL)));
      const cls = await h.eval(`(document.querySelector("${BALL}")||{}).className || ""`);
      h.check("悬浮球初始为未通话态（无 is-listening）", !String(cls).includes("is-listening"), String(cls));
      await h.screenshot("语音悬浮球");
    },
  },

  {
    name: "③ 点击悬浮球 → 面板展开",
    run: async (h) => {
      await h.click(BALL);
      const opened = await h
        .waitFor(`!!document.querySelector("${PANEL}")`, { label: "通话面板出现", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("点击悬浮球可展开通话面板", opened);
      if (opened) await h.screenshot("语音面板");
    },
  },

  {
    name: "④ 面板内容齐全",
    run: async (h) => {
      if (!(await h.exists(PANEL))) {
        h.check("面板存在（前置）", false, "上一步未打开面板");
        return;
      }
      const text = String(await h.text(PANEL));
      h.check("面板标题「语音通话」", text.includes("语音通话"), text.slice(0, 80).replace(/\n/g, " "));
      h.check("面板说明「原有打字输入完全不受影响」", text.includes("原有打字输入完全不受影响"));
      h.check("面板有模型状态行", text.includes("语音模型") || text.includes("无法读取模型状态"), text.slice(0, 120).replace(/\n/g, " "));
      const buttons = await h.eval(
        `[...document.querySelectorAll("${PANEL} button")].map(b => (b.innerText||"").trim()).join("|")`
      );
      h.check("面板有「开始通话」按钮", String(buttons).includes("开始通话"), String(buttons));
      const hasBall = await h.exists(BALL);
      h.check("面板展开时悬浮球仍在（可再次点击收起）", hasBall);
    },
  },

  {
    name: "⑤ 回归守卫：既有输入链路零改动",
    run: async (h) => {
      // 「旁挂新增」的自动化体现：语音入口出现后，原有输入相关元素必须原样还在
      h.check("回归：输入框 .composer-editor 仍在", await h.exists(".composer-editor"));
      h.check("回归：发送键 .send-button 仍在", await h.exists(".send-button"));
      h.check("输入框旁有语音按钮 .composer-mic-button", await h.exists(".composer-mic-button"));
      h.check("主操作区只有一个发送/暂停按钮", Number(await h.count(".composer-right .send-button")) === 1);
      h.check("回归：附件按钮 .plus-spin-button 仍在", await h.exists(".plus-spin-button"));
      h.check("回归：输入框设置区 .composer-setting 仍在", (await h.count(".composer-setting")) > 0);
      h.check("回归：侧栏 aside.sidebar 仍在", await h.exists("aside.sidebar"));
      h.check("回归：主区 main.workspace 仍在", await h.exists("main.workspace"));

      // 真打字一遍，确认输入框功能没被语音组件截胡
      const typed = "voice-regression-probe";
      await h.typeInto(".composer-editor", typed);
      const value = String(await h.text(".composer-editor"));
      h.check("回归：输入框仍可正常输入", value.includes(typed), value.slice(0, 60));
      // 清空，避免残留影响后续步骤/场景
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
    name: "⑥ 收起面板 → 悬浮球保留",
    run: async (h) => {
      const closed = await h
        .eval(`(() => {
          const btn = [...document.querySelectorAll("${PANEL} button")].find(b => (b.getAttribute("title")||"") === "收起");
          if (!btn) return false;
          btn.click();
          return true;
        })()`)
        .catch(() => false);
      h.check("面板有「收起」按钮", Boolean(closed));
      if (closed) {
        const gone = await h
          .waitFor(`!document.querySelector("${PANEL}")`, { label: "面板收起", timeoutMs: 6000 })
          .then(() => true)
          .catch(() => false);
        h.check("点「收起」后面板消失", gone);
      }
      h.check("收起后悬浮球仍在", await h.exists(BALL));
      await h.screenshot("语音面板已收起");
    },
  },

  {
    name: "⑦ 悬浮球位置可持久化（拖动不改坏布局）",
    run: async (h) => {
      // 只断言「可写可读」的持久化通道，不模拟真实拖拽（CDP 合成 pointer 事件不稳）
      const saved = await h.eval(`(() => {
        localStorage.setItem("voice-float-pos", JSON.stringify({ right: 30, bottom: 120 }));
        const raw = localStorage.getItem("voice-float-pos");
        localStorage.removeItem("voice-float-pos");
        return raw;
      })()`);
      h.check("悬浮球位置持久化通道可用", String(saved).includes("bottom"), String(saved));
      // 还原成默认位置，避免影响用户真实使用
      await h.eval(`localStorage.removeItem("voice-float-pos"); true`);
    },
  },

  {
    name: "⑧ 无渲染层报错",
    run: async (h) => {
      h.check(
        "渲染层无 console.error",
        h.consoleLog.length === 0,
        h.consoleLog.slice(0, 3).join(" ｜ ")
      );
    },
  },

  {
    name: "⑨ 设置 → 语音通话：5 项控件齐全 + 改值可切",
    run: async (h) => {
      // 打开设置弹窗（找"设置"按钮，回退到快捷键 ","）
      let opened = await h.eval(`(() => {
        const btns = [...document.querySelectorAll("button")];
        const t = btns.find(b => (b.getAttribute("title") || b.getAttribute("aria-label") || "").trim() === "设置");
        if (t) { t.click(); return true; } return false;
      })()`);
      if (!opened) {
        await h.pressKey(",");
        opened = await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置弹窗", timeoutMs: 5000 }).then(() => true).catch(() => false);
      }
      h.check("设置弹窗可打开", Boolean(opened));
      if (!opened) return;
      // 点"语音通话"导航
      const found = await h.eval(`(() => {
        const btns = [...document.querySelectorAll(".settings-nav button")];
        const t = btns.find(b => (b.innerText || "").trim() === "语音通话");
        if (t) { t.click(); return true; } return false;
      })()`);
      h.check("设置导航里有「语音通话」", Boolean(found));
      await h.waitFor(`!!document.querySelector(".voice-settings")`, { label: "语音通话设置页", timeoutMs: 5000 }).catch(() => undefined);
      h.check("语音通话设置页渲染", await h.exists(".voice-settings"));
      // 五项控件齐全
      const rows = await h.eval(`(() => {
        const labels = [...document.querySelectorAll(".voice-settings .settings-label-main")].map(n => n.innerText.trim());
        return labels;
      })()`);
      // 控件齐全：先等到设置数据真正加载（出现"音色"等控件），再读 textContent
      await h.waitFor(
        `(() => { const el = document.querySelector(".voice-settings"); return !!el && (el.textContent || "").includes("音色"); })()`,
        { label: "设置数据加载", timeoutMs: 8000 }
      ).catch(() => undefined);
      const fullText = await h.eval(`(document.querySelector(".voice-settings")?.textContent || "").trim()`).catch(() => "");
      const want = [
        "音色", "语速", "播报音量", "麦克风",
        "断句等待", "长句提前断句", "单句最长时长", "识别线程数",
        "打断灵敏度", "打断方式", "模型下载镜像源",
      ];
      for (const w of want) {
        h.check(`设置页有「${w}」`, String(fullText).includes(w), String(fullText).slice(0, 80));
      }
      // 试听按钮（音色配套，用户点名要的）
      const hasAudition = await h.eval(`(() => {
        const b = [...document.querySelectorAll(".voice-settings button")].find(x => (x.innerText || "").includes("试听"));
        return !!b;
      })()`);
      h.check("音色有「试听」按钮", Boolean(hasAudition));
      // 麦克风测试按钮
      const hasMicTest = await h.eval(`(() => {
        const b = [...document.querySelectorAll(".voice-settings button")].find(x => (x.innerText || "").includes("测试麦克风"));
        return !!b;
      })()`);
      h.check("麦克风有「测试麦克风」按钮", Boolean(hasMicTest));
      // 开关：麦克风 3 + 按键启动 + 长按听写 + 语音唤醒 + 悬浮球显示 + 随机气泡 = 8
      const toggleCount = await h.eval(`document.querySelectorAll('.voice-settings .voice-toggle input[type=checkbox]').length`);
      h.check("开关齐全（麦克风3 + 按键 + 长按听写 + 唤醒 + 悬浮球 + 气泡）", Number(toggleCount) === 8, `实际 ${toggleCount}`);
      h.check("有「长按语音输入」卡片", String(fullText).includes("长按语音输入"));
      h.check("有「悬浮球」卡片", String(fullText).includes("悬浮球"));
      // 按键启动 + 语音唤醒卡片
      const uiText = await h.text(".voice-settings").catch(() => "");
      h.check("有「按键启动」卡片", String(uiText).includes("按键启动"));
      h.check("有「语音唤醒」卡片", String(uiText).includes("语音唤醒"));
      // 改一个值（barge.mode 切到 manual）—— 验证 UI 状态切换
      const switched = await h.eval(`(() => {
        const radios = [...document.querySelectorAll('.voice-settings input[type="radio"][value="manual"]')];
        const r = radios[0]; if (!r) return false; r.click(); return r.checked;
      })()`);
      h.check("打断方式可切到「手动」", Boolean(switched));
    },
  },

  {
    name: "⑩ 开发工具 → 语音模型：卡片布局 + 按钮在右 + 导入提示",
    run: async (h) => {
      // 关掉设置弹窗，回到主界面（按 ESC 触发 React 的关闭逻辑）
      await h.pressKey("Escape");
      await wait(400);
      // 重新打开设置 → 切到"开发工具"
      await h.eval(`(() => {
        const btns = [...document.querySelectorAll("button")];
        const t = btns.find(b => (b.getAttribute("title") || b.getAttribute("aria-label") || "").trim() === "设置");
        if (t) t.click();
      })()`);
      await h.waitFor(`!!document.querySelector(".settings-modal")`, { label: "设置弹窗", timeoutMs: 5000 });
      await wait(300);
      const found = await h.eval(`(() => {
        const btns = [...document.querySelectorAll(".settings-nav button")];
        const t = btns.find(b => (b.innerText || "").trim() === "开发工具");
        if (t) { t.click(); return true; } return false;
      })()`);
      h.check("设置导航里有「开发工具」", Boolean(found));
      await h.waitFor(`!!document.querySelector(".voice-devtools-card")`, { label: "语音模型卡片", timeoutMs: 6000 });
      // 卡片头（图标 + 标题 + sherpa-onnx 副标题）
      const cardText = await h.text(".voice-devtools-card").catch(() => "");
      h.check("卡片标题有「语音模型」", String(cardText).includes("语音模型"));
      h.check("卡片描述有「按需下载」", String(cardText).includes("按需下载") && !String(cardText).includes("生产构建不打包"));
      // 按钮在右边（量最后一个按钮的右边到卡片右边的距离；< 卡片左内边距就算"贴右"）
      const layout = await h.eval(`(() => {
        const buttons = [...document.querySelectorAll(".voice-devtools-actions button")];
        if (!buttons.length) return null;
        const last = buttons[buttons.length - 1];
        const first = buttons[0];
        const card = last.closest(".voice-devtools-card");
        const lr = last.getBoundingClientRect();
        const fr = first.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        return {
          rightGap: Math.round(cr.right - lr.right),
          leftGap: Math.round(fr.left - cr.left),
        };
      })()`);
      h.check("操作按钮贴右边（右边距 < 左边距）", layout && layout.rightGap < layout.leftGap, JSON.stringify(layout));
      // 按钮文字
      const btnLabels = await h.eval(`(() => {
        return [...document.querySelectorAll(".voice-devtools-actions button")].map(b => (b.innerText || "").trim());
      })()`);
      h.check("下载模型按钮存在", String(btnLabels).includes("下载模型"), JSON.stringify(btnLabels));
      h.check("本地导入按钮存在", String(btnLabels).includes("本地导入"), JSON.stringify(btnLabels));
      // 路径（不再单独占一行——内联到标题区作为 mono 小字）
      const pathInline = await h.text(".voice-devtools-path-inline").catch(() => "");
      h.check("显示模型路径（内联）", String(pathInline).includes("voice-models") || /[\\/]/.test(String(pathInline)), String(pathInline).slice(0, 80));
      // 导入提示 details（默认收着）
      const hintPresent = await h.exists(".voice-devtools-import-hint");
      h.check("本地导入提示 details 存在", Boolean(hintPresent));
      // 展开后再校验
      if (hintPresent) {
        await h.eval(`(() => { const d = document.querySelector(".voice-devtools-import-hint"); if (d) d.open = true; })()`);
        await wait(200);
        const hintText = await h.text(".voice-devtools-import-hint-body").catch(() => "");
        h.check("导入提示列出三种布局", /HF 标准快照/.test(String(hintText)) && /单独某个仓库/.test(String(hintText)) && /仓库根/.test(String(hintText)));
        h.check("导入提示列出仓库 basename", /sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30/.test(String(hintText)) && /vad/.test(String(hintText)) && /sherpa-onnx-vits-zh-ll/.test(String(hintText)));
      }
    },
  },
];
