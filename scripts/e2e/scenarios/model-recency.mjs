// scripts/e2e/scenarios/model-recency.mjs
//
// 回归场景：**打开会话时用哪个模型**（09-11「我切换的模型没生效」的修法）。
//
// 旧行为：openThread 无条件用 localStorage 的 `thread-model-<id>` 回填 → 用户改了全局模型后
// 打开旧会话仍然跑老模型（连带「思考又是英文」——因为实跑的还是那个说英文的旧模型）。
// 新行为：全局默认 vs 会话记录，**谁被用户更晚显式选中就用谁**。
//
// 这里是真端到端：真起引擎、真建会话，然后重载渲染层让 openThread 跑一遍，
// 直接断言它写回 localStorage 的会话模型——不是测一个复制出来的纯函数。

export const name = "model-recency";
export const description = "打开会话的模型回填：全局后改 → 用全局；会话后改 → 用会话记录";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const GLOBAL = "custom:e2e-global:GLOBAL-MODEL";
const THREAD_OLD = "custom:e2e-thread:THREAD-MODEL";
const THREAD_OLDER = "custom:e2e-thread:THREAD-MODEL-2";

export const steps = [
  {
    name: "① 跳过引导进入主界面",
    run: async (h) => {
      await h.waitFor(`document.body && document.body.innerText.includes("直接进入")`, {
        label: "引导页出现",
        timeoutMs: 30000,
      });
      // 前置：确认真在引导页（不是直接落在主界面，否则后面的点击是假通过）
      h.check("前置：处于引导页", !(await h.exists(".app-shell")));
      await h.clickByText("暂时不登录，直接进入");
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 25000 });
      await wait(1800);
      h.check("主界面已挂载", true);
      await h.screenshot("主界面");
    },
  },

  {
    name: "② 造一个真实会话（走引擎）",
    run: async (h) => {
      const cwd = JSON.stringify(process.cwd());
      const id = await h.eval(
        `window.codex.request("thread/start", { model: "e2e-probe-model", cwd: ${cwd} })
           .then(r => (r && r.thread && r.thread.id) || "")`
      );
      // 前置条件：会话真的建出来了（没有 id 后面全是假通过）
      h.check("前置：引擎返回了会话 id", typeof id === "string" && id.length > 0, String(id).slice(0, 40));
      if (typeof id !== "string" || !id) throw new Error("thread/start 未返回 id");
      h.threadId = id;

      // 引擎的 rollout 是**首回合**才落盘的：光 thread/start 的会话 resume 会报
      // "no rollout found"，又不在 thread/list 里（两条前置都过不了，测试就是假通过）。
      // 这里发一条探查回合把会话「坐实」——模型调用必然失败（e2e profile 没有供应商凭据），
      // 但 rollout 已落盘，够用了。
      await h.eval(
        `window.codex.request("turn/start", {
           threadId: ${JSON.stringify(id)},
           input: [{ type: "text", text: "e2e 探查回合", text_elements: [] }],
           model: "e2e-probe-model",
           approvalPolicy: "never",
           sandboxPolicy: { type: "dangerFullAccess" },
         }).then(() => "ok").catch(e => "ERR:" + e.message)`
      );
      await wait(2500);

      const listed = await h.eval(
        `window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false })
           .then(r => (r.data || []).some(t => t.id === ${JSON.stringify(id)})).catch(() => false)`
      );
      h.check("前置：会话出现在 thread/list（启动恢复才会打开它）", listed === true, `listed=${listed}`);

      const resumed = await h.eval(
        `window.codex.request("thread/resume", { threadId: ${JSON.stringify(id)}, excludeTurns: true })
           .then(r => (r && r.thread && r.thread.id) || "").catch(e => "ERR:" + e.message)`
      );
      h.check("前置：该会话可 resume", resumed === id, String(resumed).slice(0, 80));
      await h.screenshot("已建会话");
    },
  },

  {
    name: "③ 全局后改 → 打开会话必须用全局模型",
    run: async (h) => {
      const id = h.threadId;
      await h.eval(`(() => {
        const now = Date.now();
        localStorage.setItem("default-model", ${JSON.stringify(GLOBAL)});
        localStorage.setItem("default-model-at", String(now));
        // 会话记录：老的、且**没有**显式选择时间戳（= 只是自动回填的，不算用户选过）
        localStorage.setItem("thread-model-" + ${JSON.stringify(id)}, ${JSON.stringify(THREAD_OLD)});
        localStorage.removeItem("thread-model-at-" + ${JSON.stringify(id)});
        localStorage.setItem("last-thread", ${JSON.stringify(id)});
        return true;
      })()`);
      // 前置：种子确实写进去了（写错值会让断言无意义）
      const seeded = await h.eval(`(() => ({
        g: localStorage.getItem("default-model"),
        ga: Number(localStorage.getItem("default-model-at")) > 0,
        t: localStorage.getItem("thread-model-" + ${JSON.stringify(id)}),
        ta: localStorage.getItem("thread-model-at-" + ${JSON.stringify(id)}),
        last: localStorage.getItem("last-thread"),
      }))()`);
      h.check(
        "前置：局部存储已按预期种好",
        seeded.g === GLOBAL && seeded.ga === true && seeded.t === THREAD_OLD && seeded.ta === null && seeded.last === id,
        JSON.stringify(seeded)
      );

      await h.reload();
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "重载后主界面", timeoutMs: 25000 });
      const got = await h
        .waitFor(
          `localStorage.getItem("thread-model-" + ${JSON.stringify(id)}) === ${JSON.stringify(GLOBAL)}`,
          { label: "会话模型被全局覆盖", timeoutMs: 20000 }
        )
        .then(() => true)
        .catch(() => false);
      const actual = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(id)})`);
      h.check("全局后改 → 会话模型跟到全局（切换生效）", got, `实际 ${actual}`);
      await h.screenshot("全局覆盖生效");
    },
  },

  {
    name: "④ 会话后改 → 打开会话必须保留会话自己的模型",
    run: async (h) => {
      const id = h.threadId;
      const future = Date.now() + 60_000;
      await h.eval(`(() => {
        // 全局戳保持「更早」，会话记录标成「更晚被显式选中」
        localStorage.setItem("thread-model-" + ${JSON.stringify(id)}, ${JSON.stringify(THREAD_OLDER)});
        localStorage.setItem("thread-model-at-" + ${JSON.stringify(id)}, String(${future}));
        localStorage.setItem("last-thread", ${JSON.stringify(id)});
        return true;
      })()`);
      const seeded = await h.eval(`(() => ({
        t: localStorage.getItem("thread-model-" + ${JSON.stringify(id)}),
        ta: Number(localStorage.getItem("thread-model-at-" + ${JSON.stringify(id)})) > 0,
      }))()`);
      // 前置：会话记录确实是「更晚」的那一方
      h.check("前置：会话记录已置为更晚的选择", seeded.t === THREAD_OLDER && seeded.ta === true, JSON.stringify(seeded));

      await h.reload();
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "重载后主界面", timeoutMs: 25000 });
      await wait(2500); // 给 openThread 的 resume 留时间落盘
      const actual = await h.eval(`localStorage.getItem("thread-model-" + ${JSON.stringify(id)})`);
      h.check("会话后改 → 会话模型不被全局打回", actual === THREAD_OLDER, `实际 ${actual}`);
      await h.screenshot("会话记录优先");
    },
  },

  {
    name: "⑤ 无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
