// scripts/e2e/scenarios/identity-greeting-once.mjs
//
// 回归场景：**身份引导只打一次招呼**（09-12 用户反馈：「怎么每次新会话都强制引导呢，
// 改成一次打招呼才需要引导，其他情况下直接开始干活」）。
//
// 旧行为：判定用 `onboarded`（用户**真的回答了**才为 true）→ 不回答的用户**每个新会话**
// 都被强制引导一遍。新行为：只要问过一次就落 `greeted=true`，之后新会话一律直接干活。
//
// 断言（权威判据 = 隔离 profile 的 rollout 里有没有引导指令）：
//   ① 全新 profile 的第一个会话：rollout 里**有**「初次见面」引导指令；
//   ② 第二个会话：rollout 里**没有**引导指令（证明 greeted 标记生效）；
//   ③ personalization.json 里 greeted=true。

export const name = "identity-greeting-once";
export const description = "身份引导只打一次招呼：首会话引导，之后新会话直接干活";
/** 本场景覆盖的源文件（供 run.mjs 增量判断）。 */
export const covers = ["electron/personalization.ts", "src/App.tsx"];

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  await wait(1500);
}

/** 隔离 profile 里所有 rollout 文本（含 developer_instructions 的注入痕迹） */
function rolloutTexts(h) {
  const files = h._rolloutFiles ? h._rolloutFiles() : [];
  return files.map((f) => {
    try { return { file: f.split(/[\\/]/).pop(), text: readFileSync(f, "utf8") }; }
    catch { return { file: f, text: "" }; }
  });
}

async function sendAndWaitTurn(h, text) {
  await h.clearInput(".composer-editor");
  await h.typeInto(".composer-editor", text);
  await wait(250);
  await h.click(".send-button");
  // 等首回合落盘（引擎 rollout 是首回合才写的）——出现回合即可
  await h.waitFor(`document.querySelectorAll(".turn-group").length >= 1`, { label: "回合出现", timeoutMs: 40000 }).catch(() => undefined);
  await wait(2500);
}

export const steps = [
  {
    name: "① 全新 profile 进入主界面",
    run: async (h) => {
      await enterMain(h);
      h.check("已进入主界面", await h.exists(".app-shell"));
      const p = join(h.userDataDir, "personalization.json");
      h.check("前置：新 profile 还没有 personalization.json（全新用户）", !existsSync(p), p);
    },
  },

  {
    name: "② 第一个会话：rollout 里应**有**「初次见面」引导指令",
    run: async (h) => {
      await sendAndWaitTurn(h, "只回复一个字：好");
      const rolls = rolloutTexts(h);
      h.check("前置：已有 rollout 落盘", rolls.length > 0, `files=${rolls.length}`);
      const withGreeting = rolls.filter((r) => r.text.includes("初次见面"));
      console.log(`  [首会话] rollout ${rolls.length} 个，含引导指令的 ${withGreeting.length} 个`);
      h.check("[首会话] 注入了身份引导指令", withGreeting.length > 0, `rollouts=${rolls.map((r) => r.file).join(",")}`);
    },
  },

  {
    name: "③ 第二个会话：rollout 里应**没有**引导指令（只打一次招呼）",
    run: async (h) => {
      const before = rolloutTexts(h).length;
      await h.clickByText("新建任务").catch(() => undefined);
      await wait(1200);
      await sendAndWaitTurn(h, "只回复一个数字：9");
      const rolls = rolloutTexts(h);
      const fresh = rolls.filter((r) => r.text.includes("只回复一个数字"));
      console.log(`  [次会话] 新 rollout：${fresh.map((r) => r.file).join(",") || "(无)"}`);
      h.check("前置：第二个会话产生了新的 rollout", rolls.length > before, `before=${before} after=${rolls.length}`);
      const withGreeting = fresh.filter((r) => r.text.includes("初次见面"));
      console.log(`  [次会话] 带引导指令的：${withGreeting.length} 个（应为 0）`);
      h.check("[次会话] 没有再次注入引导指令", withGreeting.length === 0, `greeted=${withGreeting.map((r) => r.file).join(",")}`);
    },
  },

  {
    name: "④ personalization.json 落盘 greeted=true",
    run: async (h) => {
      const p = join(h.userDataDir, "personalization.json");
      let config = null;
      try { config = JSON.parse(readFileSync(p, "utf8")); } catch { /* 未落盘 */ }
      console.log(`  [档案] ${JSON.stringify(config)}`);
      h.check("前置：personalization.json 已生成", config != null, p);
      h.check("greeted 已置 true（此后新会话不再引导）", config?.greeted === true, `greeted=${config?.greeted}`);
    },
  },

  {
    name: "⑤ 收尾：无渲染层报错",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
