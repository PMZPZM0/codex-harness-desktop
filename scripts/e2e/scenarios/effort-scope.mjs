// scripts/e2e/scenarios/effort-scope.mjs
//
// 回归场景：**思考等级档案持久化 + 切换立刻生效**（09-11 用户反馈「跟之前供应商切换
// BUG 一样，没写进配置里面」）。
//
// 修复内容（三层）：
//   1) custom-model.json：models[].effort + 顶层 effort（档案持久化，切供应商/重装不丢）
//   2) config.toml 顶层 model_reasoning_effort（引擎兜底默认，重启后 resume 的老会话用）
//   3) 每轮 turn/start 的 effort 逐回合下发（原已有）+ 打开会话时无显式记录则应用档案档位
//
// ⚠ 本场景必须带真实模型配置跑（同 model-scope）：档位菜单按模型声明的 efforts 过滤，
//   空配置下连菜单选项都没有。引擎侧取证 = rollout turn_context 的 effort 实收值。

export const name = "effort-scope";
export const description = "思考等级：UI 切换写档案（custom-model.json + config.toml），引擎逐回合真实生效";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 场景内共享状态（同一次跑内存共享；harness 无 kv 存储，模块变量即可）
let threadId = "";

/** 在隔离 profile 里读 custom-model.json / config.toml（真实配置灌入后的那份） */
function readProfile(h, rel) {
  const p = join(h.userDataDir, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** 造「引擎侧真存在、可 resume」的会话（同 model-scope：探查回合坐实 rollout 落盘） */
async function seedThread(h, tag) {
  const cwd = JSON.stringify(process.cwd());
  const id = await h.eval(
    `window.codex.request("thread/start", { model: "e2e-probe-model", cwd: ${cwd} })
       .then(r => (r && r.thread && r.thread.id) || "")`
  );
  h.check(`前置：${tag} 拿到会话 id`, typeof id === "string" && id.length > 0, String(id).slice(0, 40));
  if (typeof id !== "string" || !id) throw new Error(`thread/start（${tag}）未返回 id`);
  await h.eval(
    `window.codex.request("turn/start", {
       threadId: ${JSON.stringify(id)},
       input: [{ type: "text", text: ${JSON.stringify("e2e 探查回合 " + tag)}, text_elements: [] }],
       model: "e2e-probe-model",
       approvalPolicy: "never",
       sandboxPolicy: { type: "dangerFullAccess" },
     }).then(() => "ok").catch(e => "ERR:" + e.message)`
  );
  await wait(2200);
  return id;
}

/** 打开思考菜单并选指定档位。
 *  按钮定位不能用 nth-child（.model-controls 里混着余额/上下文徽标等条件渲染元素），
 *  用 title 文案定位：思考菜单 title=「请求思考强度（…）」，全局唯一。
 *  选项没有 title 属性，档位名在 <strong> 文本里，按 strong 文本点选。 */
async function pickEffort(h, label) {
  await h.eval(`(() => {
    const btns = Array.from(document.querySelectorAll(".model-controls .composer-setting"));
    const btn = btns.find((b) => (b.getAttribute("title") || "").includes("思考强度"));
    if (!btn) throw new Error("思考菜单按钮不存在");
    btn.click();
    return "ok";
  })()`);
  const pop = ".model-controls .composer-menu.open .composer-menu-pop";
  await h.waitFor(`!!document.querySelector("${pop}")`, { label: "思考菜单打开", timeoutMs: 6000 });
  const picked = await h.eval(`(() => {
    const btns = Array.from(document.querySelectorAll("${pop} button[role='option']"));
    const b = btns.find((b) => ((b.querySelector("strong") || b).innerText || "").trim() === ${JSON.stringify(label)});
    if (!b) return "";
    b.click();
    return ${JSON.stringify(label)};
  })()`);
  if (!picked) throw new Error(`思考菜单里没有「${label}」项`);
  await wait(800);
}

/** 真发一条消息，等引擎 rollout 落盘新回合（拿到 effort 证据即打断，省额度） */
async function sendAndReadEffort(h, threadId, { timeoutMs = 120000 } = {}) {
  const before = h.engineModelOf(threadId);
  await h.typeInto(".composer-editor", "e2e 思考档位验证：只回复一个「好」字，不要做任何其他事");
  await h.waitFor(`(document.querySelector(".composer-editor")?.innerText || "").includes("e2e 思考档位验证")`, {
    label: "文本已进输入框",
    timeoutMs: 8000,
  });
  await h.click(".send-button");
  const t0 = Date.now();
  let info = h.engineModelOf(threadId);
  while (Date.now() - t0 < timeoutMs) {
    info = h.engineModelOf(threadId);
    if (info.errors.length > before.errors.length) break;
    if (info.turns > before.turns && info.backendResponses.length > before.backendResponses.length) break;
    await wait(1000);
  }
  await h
    .eval(`window.codex.request("turn/interrupt", { threadId: ${JSON.stringify(threadId)} }).then(() => "ok").catch(e => "ERR:" + e.message)`)
    .catch(() => undefined);
  await wait(800);
  return h.engineModelOf(threadId);
}

export const steps = [
  {
    name: "① 前置：真实模型配置已灌入 + 主界面就绪",
    run: async (h) => {
      h.check("前置：已灌入真实模型配置", Boolean(h.realConfig?.ok), h.realConfig ? `${h.realConfig.copied.join(" · ")} ← ${h.realConfig.src}` : "无");
      const cfg = readProfile(h, "custom-model.json");
      h.check("前置：隔离 profile 里 custom-model.json 存在且有 models 列表", Boolean(cfg && JSON.parse(cfg).models?.length), cfg ? `${JSON.parse(cfg).models?.length ?? 0} 个模型` : "文件不存在");
      const parsed = JSON.parse(cfg ?? "{}");
      h.check(
        "前置：当前生效模型声明了思考档位（菜单才有得选）",
        Boolean(parsed.models?.some((m) => m.id === parsed.model && Array.isArray(m.efforts) && m.efforts.length)),
        `model=${parsed.model} efforts=${JSON.stringify(parsed.models?.find((m) => m.id === parsed.model)?.efforts ?? null)}`
      );
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面", timeoutMs: 25000 });
    },
  },
  {
    name: "② 建会话并坐实 rollout",
    run: async (h) => {
      const id = await seedThread(h, "effort-scope");
      threadId = id;
    },
  },
  {
    name: "③ UI 切「轻量思考」→ 档案三处落盘",
    run: async (h) => {
      await pickEffort(h, "轻量思考");
      const cfg = JSON.parse(readProfile(h, "custom-model.json") ?? "{}");
      const current = cfg.models?.find((m) => m.id === cfg.model);
      h.check("③a custom-model.json models[].effort = low", current?.effort === "low", `models[${cfg.model}].effort=${current?.effort ?? "(无)"}`);
      h.check("③b custom-model.json 顶层 effort = low", cfg.effort === "low", `顶层 effort=${cfg.effort ?? "(无)"}`);
      const toml = readProfile(h, "codex-home/config.toml") ?? "";
      h.check("③c config.toml 顶层 model_reasoning_effort = \"low\"", /^model_reasoning_effort = "low"$/m.test(toml), (toml.match(/^model_reasoning_effort.*$/m) ?? ["(未写入)"])[0]);
    },
  },
  {
    name: "④ 引擎侧取证：新回合实收 effort=low",
    run: async (h) => {
      const id = threadId;
      const info = await sendAndReadEffort(h, id);
      h.check("④a 真实后端回包（token_usage_record.response_id）", info.backendResponses.length > 0, `${info.backendResponses.length} 条回包`);
      h.check("④b 最新回合引擎实收 effort=low", info.turnEffort === "low", `turnEffort=${JSON.stringify(info.turnEffort)} 全序列=${JSON.stringify(info.turnEfforts)}`);
      h.check("④c 无后端错误", info.errors.length === 0, JSON.stringify(info.errors.slice(0, 2)));
    },
  },
  {
    name: "⑤ 再切「均衡思考」→ 下一回合立刻生效 + 档案同步",
    run: async (h) => {
      await pickEffort(h, "均衡思考");
      const id = threadId;
      const info = await sendAndReadEffort(h, id);
      h.check("⑤a 真实后端回包", info.backendResponses.length > 0, `${info.backendResponses.length} 条回包`);
      h.check("⑤b 最新回合引擎实收 effort=medium（切换立刻生效，不等重启）", info.turnEffort === "medium", `turnEffort=${JSON.stringify(info.turnEffort)} 全序列=${JSON.stringify(info.turnEfforts)}`);
      const cfg = JSON.parse(readProfile(h, "custom-model.json") ?? "{}");
      h.check("⑤c 档案同步到 medium", cfg.models?.find((m) => m.id === cfg.model)?.effort === "medium" && cfg.effort === "medium", `顶层=${cfg.effort ?? "(无)"}`);
      h.check("⑤d 无后端错误", info.errors.length === 0, JSON.stringify(info.errors.slice(0, 2)));
    },
  },
  {
    name: "⑥ 渲染层无 console.error",
    run: async (h) => {
      h.check("⑥ 无 console.error", h.consoleLog.filter((e) => e.level === "error").length === 0, `${h.consoleLog.length} 条日志`);
    },
  },
];
