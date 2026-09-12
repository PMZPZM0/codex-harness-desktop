// scripts/e2e/scenarios/smoke.mjs
//
// 冒烟场景：把「改完一次代码后必须人工点一遍」的主干路径自动化。
// 覆盖：启动 → 跳过引导 → 主界面骨架 → 输入框 → #// 面板 → 侧栏导航 → 右栏 → 设置弹窗与焦点归还。
// 每步都落到截图，跑完看一眼 .e2e-artifacts/shots/ 就知道有没有肉眼可见的破相。

export const name = "smoke";
export const description = "冒烟：跳过引导 → 主界面骨架 → 输入框/#//面板 → 侧栏 → 右栏 → 设置弹窗";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const steps = [
  {
    name: "① 引导页渲染",
    run: async (h) => {
      // 引导页**可能被跳过**：隔离 profile 里灌了真实模型配置且带 Key 时，
      // customModel.hasKey=true，App 的兼容 effect 会自动进入主界面（写 login-skipped）。
      // 所以这里等的是「引导页或主界面二选一」，不能硬等跳过按钮（否则带真配置必假红）。
      await h.waitFor(
        `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
        { label: "引导页或主界面", timeoutMs: 30000 }
      );
      h.check("引导页或主界面已就绪", true);
      await h.screenshot("启动落点");
    },
  },

  {
    name: "② 跳过引导进入主界面",
    run: async (h) => {
      const hasGuide = await h.eval(`document.body.innerText.includes("直接进入")`);
      if (hasGuide) await h.clickByText("暂时不登录，直接进入");
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
      await wait(1800); // 等首屏数据（会话列表/工作区）落定
      h.check("主界面挂载（引导页已跳过或本就被跳过）", true);
      await h.screenshot("主界面");
    },
  },

  {
    name: "③ 主界面骨架完整",
    run: async (h) => {
      h.check("标题栏 .topbar", await h.exists(".topbar"));
      h.check("侧栏 aside.sidebar", await h.exists("aside.sidebar"));
      h.check("主区 main.workspace", await h.exists("main.workspace"));
      h.check("时间线 .timeline", await h.exists(".timeline"));
      h.check("输入框 .composer-editor", await h.exists(".composer-editor"));
      h.check("发送键 .send-button", await h.exists(".send-button"));
      h.check("附件按钮 .plus-spin-button", await h.exists(".plus-spin-button"));
      // 欢迎页「项目地址」选择 chip（09-11 新增；仅空态显示，发送首条消息后随欢迎态消失）
      h.check("欢迎页项目地址 chip .welcome-cwd-chip", await h.exists(".welcome-cwd-chip"));

      const tabsText = await h.eval(`[...document.querySelectorAll(".sidebar-tab")].map(e => e.innerText).join("|")`);
      for (const t of ["新建任务", "自动化", "技能中心", "插件市场", "专家团", "会话备份"]) {
        h.check(`侧栏项「${t}」`, String(tabsText).includes(t), String(tabsText).replace(/\n/g, " "));
      }

      const settingsText = await h.eval(
        `[...document.querySelectorAll(".composer-setting")].map(e => e.innerText).join("|")`
      );
      h.check("输入框底部「权限」档", String(settingsText).includes("访问"), String(settingsText));
      // 「模型 / 思考」两档在有真实模型配置时显示的是**模型名与档位**（如 "deepseek-v4-flash"），
      // 只有空配置才退回占位文案——所以按 title 属性判定，别按文案（否则带上真配置就假红）。
      const modelControls = await h.eval(
        `[...document.querySelectorAll(".model-controls .composer-setting")].map(e => e.getAttribute("title")).join("|")`
      );
      h.check("输入框底部「模型」档", String(modelControls).includes("模型"), String(modelControls));
      h.check("输入框底部「思考」档", String(modelControls).includes("思考"), String(modelControls));
    },
  },

  {
    name: "④ 输入框可输入、发送键就绪",
    run: async (h) => {
      await h.typeInto(".composer-editor", "e2e 冒烟测试文本");
      await h.waitFor(`(document.querySelector(".composer-editor")?.innerText || "").includes("e2e 冒烟")`, {
        label: "文本进入输入框",
        timeoutMs: 6000,
      });
      h.check("文本写入输入框", true);
      h.check("发送键可见", await h.exists(".send-button"));
      await h.screenshot("输入框已输入");
      await h.clearInput(".composer-editor");
      await wait(400);
      const cleared = await h.eval(`(document.querySelector(".composer-editor")?.innerText || "").trim().length`);
      h.check("清空后输入框为空", cleared === 0, `残留长度 ${cleared}`);
    },
  },

  {
    name: "⑤ `#` 触发技能面板",
    run: async (h) => {
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "#");
      const ok = await h
        .waitFor(`!!document.querySelector(".command-palette")`, { label: "# 技能面板", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("输入 # 弹出技能面板", ok);
      if (ok) await h.screenshot("技能面板");
      await h.clearInput(".composer-editor");
      await wait(400);
    },
  },

  {
    name: "⑥ `/` 触发命令面板",
    run: async (h) => {
      await h.clearInput(".composer-editor");
      await h.typeInto(".composer-editor", "/");
      const ok = await h
        .waitFor(`!!document.querySelector(".command-palette")`, { label: "/ 命令面板", timeoutMs: 6000 })
        .then(() => true)
        .catch(() => false);
      h.check("输入 / 弹出命令面板", ok);
      if (ok) await h.screenshot("命令面板");
      await h.clearInput(".composer-editor");
      await h.pressKey("Escape");
      await wait(400);
    },
  },

  {
    name: "⑦ 侧栏「技能中心」可打开/关闭",
    run: async (h) => {
      await h.clickByText("技能中心");
      const opened = await h
        .waitFor(`!!document.querySelector(".modal-backdrop")`, { label: "技能中心面板打开", timeoutMs: 8000 })
        .then(() => true)
        .catch(() => false);
      h.check("点击「技能中心」打开面板", opened);
      if (opened) {
        const hasSkills = String(await h.bodyText(3000)).includes("技能中心");
        h.check("面板内容为技能中心", hasSkills);
        await h.screenshot("技能中心");
        await h.pressKey("Escape");
        const closed = await h
          .waitFor(`!document.querySelector(".modal-backdrop")`, { label: "技能中心面板关闭", timeoutMs: 8000 })
          .then(() => true)
          .catch(() => false);
        h.check("技能中心可关闭（ESC）", closed);
      }
      h.check("回到聊天主界面", await h.exists(".composer-editor"));
    },
  },

  {
    name: "⑧ 右栏面板可展开",
    run: async (h) => {
      // 前置：确认没有残留弹窗（否则后面的断言会“假通过”）
      h.check("前置：无残留弹窗", !(await h.exists(".modal-backdrop")));
      await h.clickByTitle("展开右侧面板");
      const ok = await h
        .waitFor(`/变更|项目树|终端/.test(document.body.innerText)`, { label: "右栏出现", timeoutMs: 8000 })
        .then(() => true)
        .catch(() => false);
      h.check("右栏可展开（出现变更/终端/项目树标签）", ok);
      if (ok) await h.screenshot("右栏面板");
      // 收起，避免影响后续
      await h.clickByTitle("收起右侧面板").catch(() => h.clickByTitle("展开右侧面板").catch(() => {}));
      await wait(400);
    },
  },

  {
    name: "⑨ 设置弹窗可开关且焦点归还",
    run: async (h) => {
      // 前置：确保弹窗此刻是关的，否则“能打开”是假通过
      const preClosed = !(await h.exists(".modal-backdrop"));
      h.check("前置：设置弹窗初始为关闭", preClosed);
      await h.clickByTitle("设置");
      const opened = await h
        .waitFor(`!!document.querySelector(".modal-backdrop")`, { label: "设置弹窗出现", timeoutMs: 8000 })
        .then(() => true)
        .catch(() => false);
      h.check("设置可打开", opened);
      if (opened) {
        await h.screenshot("设置页");
        await h.pressKey("Escape");
        await h.waitFor(`!document.querySelector(".modal-backdrop")`, { label: "设置弹窗关闭", timeoutMs: 8000 });
        h.check("设置可通过 ESC 关闭", true);
        const active = await h.eval(
          `(() => { const a = document.activeElement; return a ? (a.tagName + "." + (typeof a.className === "string" ? a.className : "")) : "none"; })()`
        );
        h.check("关闭后焦点未丢给 body（focus-return 生效）", !/^BODY/.test(String(active)), `activeElement=${active}`);
      }
    },
  },

  {
    name: "⑩ 开发工具页含音色克隆模型入口",
    run: async (h) => {
      // 前置：弹窗初始关闭（避免上一步残留造成假通过）
      const preClosed = !(await h.exists(".modal-backdrop"));
      h.check("前置：设置弹窗初始为关闭", preClosed);
      await h.clickByTitle("设置");
      await h.waitFor(`!!document.querySelector(".modal-backdrop")`, { label: "设置弹窗", timeoutMs: 8000 });
      // 在弹窗内点「开发工具」分页（限域查找，避免点到侧栏的同名文本）
      const clicked = await h.eval(`(() => {
        const root = document.querySelector(".modal-backdrop");
        if (!root) return false;
        const btn = [...root.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "开发工具");
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      h.check("设置内可切到「开发工具」页", Boolean(clicked));
      await wait(400);
      // 开发工具页内容由异步状态驱动（等待而非猜时间：固定等待在冷启动下会假红）
      const appeared = await h
        .waitFor(`document.body.innerText.includes("音色克隆模型")`, { label: "音色克隆模型卡片", timeoutMs: 10000 })
        .then(() => true)
        .catch(() => false);
      h.check("开发工具页显示「音色克隆模型」卡片", appeared);
      const hasAction = await h.eval(`[...document.querySelectorAll("button")].some((b) => /下载音色克隆模型|打开模型目录|取消下载/.test(b.innerText || ""))`);
      h.check("音色克隆模型卡片含安装/打开按钮", hasAction);
      await h.screenshot("开发工具-音色克隆模型");
      await h.pressKey("Escape");
      await h.waitFor(`!document.querySelector(".modal-backdrop")`, { label: "设置弹窗关闭", timeoutMs: 8000 });
    },
  },

  {
    name: "⑪ 无渲染层报错",
    run: async (h) => {
      h.check(
        "渲染层无 console.error",
        h.consoleLog.length === 0,
        h.consoleLog.slice(0, 3).join(" ｜ ")
      );
    },
  },
];
