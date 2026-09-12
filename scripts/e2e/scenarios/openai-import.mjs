// scripts/e2e/scenarios/openai-import.mjs
//
// 回归场景：**导入账号文件直接登录 OpenAI 账号**（09-12，复刻 sub2api account_codex_import
// 的格式面）。四种形态混导：Codex CLI auth.json / 扁平 token JSON / 裸 accessToken 行 /
// NDJSON（每行一个 JSON 或 token）；身份从 JWT `https://api.openai.com/auth` claims 解出
// （email / chatgpt_account_id / chatgpt_plan_type）。导入即自动切换生效（写 auth.json +
// 重启引擎 + 启用订阅）。
//
// 文件注入用 DataTransfer + input[type=file]（Chromium 支持，无需主进程弹窗）。
// JWT 为场景本地伪造（payload 合法即可，应用不验签——签名校验是 OpenAI 端的事）。

export const name = "openai-import";
export const description = "导入账号文件直接登录 OpenAI：auth.json/扁平 JSON/裸 token 混导 + 导入即生效";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const nowSec = Math.floor(Date.now() / 1000);
const idToken = b64u({ alg: "none", typ: "JWT" }) + "." + b64u({
  sub: "user-e2e-abc",
  email: "imported@test.local",
  exp: nowSec + 86400,
  "https://api.openai.com/auth": { chatgpt_account_id: "acct-e2e-1", chatgpt_plan_type: "plus", chatgpt_subscription_active_until: "2027-01-01T00:00:00Z" },
}) + ".sig";
const accessToken = b64u({ alg: "none" }) + "." + b64u({ exp: nowSec + 3600 }) + ".sig";

// 文件 1：标准 Codex CLI auth.json（设备码登录产物长这样）
const AUTH_JSON = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: idToken, access_token: accessToken, refresh_token: "refresh-e2e-1", account_id: "acct-e2e-1" }, last_refresh: new Date().toISOString() });
// 文件 2：NDJSON 混合形态（裸 token / auth.json 形 / 扁平 JSON 各一条）
const MIXED = [
  "sk-oai-bare-token-e2e-plain-string",
  JSON.stringify({ tokens: { access_token: accessToken, refresh_token: "refresh-e2e-2", id_token: idToken }, last_refresh: "2026-09-12T00:00:00Z" }),
  JSON.stringify({ accessToken: accessToken, refreshToken: "refresh-e2e-3", email: "flat@test.local" }),
].join("\n");

/** 注入文件到 OpenAI 订阅页的隐藏 file input 并触发 change */
async function injectFiles(h, files) {
  const ok = await h.eval(`(() => {
    const input = document.querySelector('.openai-account-grid input[type="file"]');
    if (!input) return "NO_INPUT";
    const dt = new DataTransfer();
    for (const [name, content] of ${JSON.stringify(files)}) {
      dt.items.add(new File([content], name, { type: "application/json" }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "OK";
  })()`);
  if (ok !== "OK") throw new Error(`注入文件失败：${ok}`);
}

async function openOpenaiSettings(h) {
  const hit = await h.eval(`(() => {
    const nav = document.querySelector(".settings-nav");
    if (!nav) return "NO_NAV";
    for (const btn of nav.querySelectorAll("button")) {
      if ((btn.textContent || "").includes("OpenAI 订阅")) { btn.click(); return "OK"; }
    }
    return "NO_ITEM";
  })()`);
  if (hit !== "OK") throw new Error(`打开 OpenAI 订阅设置失败：${hit}`);
  await h.waitFor(`!!document.querySelector(".openai-account-grid")`, { label: "OpenAI 订阅页", timeoutMs: 15000 });
}

export const steps = [
  {
    name: "① 打开设置→OpenAI 订阅，初始无账号",
    run: async (h) => {
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面挂载", timeoutMs: 30000 });
      await wait(900);
      await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
      await h.waitFor(`!!document.querySelector(".settings-nav")`, { label: "设置弹窗", timeoutMs: 15000 });
      await openOpenaiSettings(h);
      const empty = await h.eval(`(() => { const g = document.querySelector(".openai-account-grid"); return g ? !g.querySelector(".openai-account-card") : null; })()`);
      h.check("前置：账号列表为空", empty === true, `empty=${empty}`);
      h.check("「导入账号文件」卡片存在", await h.eval(`[...document.querySelectorAll(".relay-add-card")].some(b => (b.textContent || "").includes("导入账号文件"))`) === true);
      await h.screenshot("01-empty");
    },
  },

  {
    name: "② 导入 auth.json → 自动登录生效（账号卡「使用中」+ PLUS 档位）",
    run: async (h) => {
      await injectFiles(h, [["auth.json", AUTH_JSON]]);
      // 导入 → vault → 自动 accountSwitch（写 auth.json + 重启引擎）→ onActivate 启用订阅
      await h.waitFor(`(() => {
        const card = [...document.querySelectorAll(".openai-account-card")].find(c => (c.textContent || "").includes("imported@test.local"));
        return Boolean(card && card.textContent.includes("使用中"));
      })()`, { label: "账号卡出现且「使用中」", timeoutMs: 90_000 });
      const accounts = await h.eval(`window.codex.openaiAccounts().then(list => list.map(a => ({ email: a.email, active: a.active, planType: a.planType, sub: a.subscriptionUntil })))`);
      const imported = (accounts || []).find((a) => a.email === "imported@test.local");
      h.check("vault 有 imported@test.local 且为当前生效", Boolean(imported?.active), JSON.stringify(imported));
      h.check("档位徽章 = plus（JWT claims 解出）", imported?.planType === "plus", String(imported?.planType));
      h.check("订阅有效期已解析", String(imported?.sub ?? "").startsWith("2027-01-01"), String(imported?.sub));
      await h.screenshot("02-imported-active");
    },
  },

  {
    name: "③ 混合形态 NDJSON：裸 token / auth.json 形 / 扁平 JSON 各入一账",
    run: async (h) => {
      await injectFiles(h, [["mixed.txt", MIXED]]);
      // 等待「入库完成且重切换落定」：首个可登录条目（imported@test.local，带 id_token）
      // 被重新写回 auth.json 并 active —— 单等 length 会在 accountSwitch 完成前抢跑（实测竞态）
      await h.waitFor(`window.codex.openaiAccounts().then((list) => list.length >= 3 && list.some((a) => a.active && a.email === "imported@test.local"))`, { label: "入库 ≥3 且可登录条目重新生效", timeoutMs: 60_000 });
      const accounts = await h.eval(`window.codex.openaiAccounts().then(list => list.map(a => ({ id: a.email || a.id, active: a.active })))`);
      const emails = (accounts || []).map((a) => a.id);
      h.check("flat@test.local（扁平 JSON 的 email 字段）入账", emails.includes("flat@test.local"), JSON.stringify(emails));
      // 裸 token 无 email/account claims → 落库为 import-* 兜底 id（不丢凭据）
      h.check("裸 token 条目也已入库（兜底 id）", emails.some((e) => String(e).startsWith("import-")), JSON.stringify(emails));
      const total = emails.length;
      h.check("NDJSON 三条全部入库（auth.json 形按 identity 去重更新）", total === 3, `total=${total}`);
      // 第二轮导入的首个「可登录」条目（auth.json 形的 imported@test.local，带 id_token）保持当前生效；
      // 裸 token 条目只入 vault 不作为切换目标（无 id_token 构不成登录态）
      h.check("导入即生效：可登录条目保持当前生效", (accounts || []).some((a) => a.active && a.id === "imported@test.local"), JSON.stringify(accounts));
      await h.screenshot("03-mixed-imported");
    },
  },

  {
    name: "④ 停用当前生效账号 → 全套退出清理（与中转站对称）+ 死锁解除",
    run: async (h) => {
      const accounts = await h.eval(`window.codex.openaiAccounts()`);
      const active = (accounts || []).find((a) => a.active);
      h.check("前置：有当前生效账号", Boolean(active), JSON.stringify((accounts || []).map((a) => a.email)));
      // 账号卡开关停用 = 停用当前生效账号：auth.json 置空 + openai-official 条目停用 + custom-model.json 清空
      await h.eval(`window.codex.openaiToggleAccount({ id: ${JSON.stringify(active?.id ?? "")}, disabled: true })`);
      await h.waitFor(`window.codex.openaiAccounts().then((list) => list.every((a) => !a.active))`, { label: "账号退出登录态", timeoutMs: 20_000 });
      const st = await h.eval(`window.codex.listCustomModels()`);
      const official = (st?.providers || []).find((p) => p.provider === "openai-official");
      h.check("openai-official 供应商条目已自动停用", Boolean(official) && official.enabled === false, JSON.stringify(official && { provider: official.provider, enabled: official.enabled }));
      h.check("生效配置已清空（不悬挂在无凭据的供应商上）", st?.current === null, String(st?.current));
      // 死锁解除：生效位空了，其他供应商现在能正常启用（此前会被残留的 openai-official 互斥卡死）
      const other = (st?.providers || []).find((p) => p.provider !== "openai-official");
      if (other) {
        await h.eval(`window.codex.setProviderEnabled({ provider: ${JSON.stringify(other.provider)}, enabled: true })`);
        const st2 = await h.eval(`window.codex.listCustomModels()`);
        h.check("其他供应商可正常启用（无残留互斥死锁）", st2?.current === other.provider, `current=${String(st2?.current)}`);
      } else {
        h.check("其他供应商可正常启用（无残留互斥死锁）", false, "列表里没有其他供应商可验证");
      }
      await h.screenshot("04-deactivated-cleanup");
    },
  },

  {
    name: "⑤ 渲染层无 console.error",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
