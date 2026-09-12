// scripts/e2e/scenarios/relay-subscription.mjs
//
// 回归场景：**内置付费订阅全链路**（09-12 定稿流程）。
//
// 用户流程：中转站页置顶订阅长条卡 → 未登录先注册（应用内，aff_code 自动携带）→
// 注册成功自动登录 → 自动打开套餐市场（二级弹窗，GET /payment/plans）→ 点「立即订阅」
// 打开站内支付页（主进程弹窗 + token 注入免登录）→ 付款到账（本场景用 mark-paid 模拟）
// → 应用轮询 summary 检测到新订阅 → 自动复用/新建该分组密钥 → 走 relayActivate 链
// （探测→saveCustomModel→供应商生效，其他供应商让位）→ 置顶卡更新为「当前生效」。
//
// 站点用场景内起 mock sub2api 网关（node:http，零依赖）：实现 register/login/profile/
// subscriptions/summary/keys/groups/payment/plans/purchase 页/v1/models 探测；
// 另有 /api/v1/__test/mark-paid 供场景模拟「付款到账」。

export const name = "relay-subscription";
export const description = "付费订阅全链路：应用内注册→自动登录→套餐市场→支付检测→自动建密钥并生效";

import http from "node:http";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── mock sub2api 网关 ──
const state = {
  balance: 12.5,
  users: new Map(),   // email → password
  tokens: new Map(),  // token → email
  subscriptions: [],
  keys: [],
  hits: [],
};
const PLAN = {
  id: 1,
  group_id: 5,
  group_platform: "openai",
  group_name: "✅【e2e 订阅专用】$50 体验分组",
  name: "$50 额度体验卡",
  description: "e2e mock：每月相当于 $50 的额度",
  price: 9.9,
  original_price: 350,
  validity_days: 30,
  features: "e2e mock features 第一行\n第二行：仅测试用\n第三行",
  for_sale: true,
  sort_order: 1,
  rate_multiplier: 1,
};
const GROUP = { id: 5, group_id: 5, name: PLAN.group_name, group_name: PLAN.group_name };

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
const ok = (res, data) => json(res, 200, { code: 0, message: "success", data });
const fail = (res, status, message) => json(res, status, { code: status, message });

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
  state.hits.push(`${req.method} ${p}`);

  if (req.method === "POST" && p === "/api/v1/auth/register") {
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || password.length < 6) return fail(res, 400, "Invalid request: email/password");
    if (state.users.has(email)) return fail(res, 400, "邮箱已注册");
    if (body.turnstile_token === undefined && process.env.MOCK_REQUIRE_CAPTCHA === "1") return fail(res, 400, "captcha required");
    state.users.set(email, password);
    return ok(res, { ok: true, aff_code: body.aff_code ?? null });
  }
  if (req.method === "POST" && p === "/api/v1/auth/login") {
    const email = String(body.email ?? "").trim();
    if (state.users.get(email) !== String(body.password ?? "")) return fail(res, 401, "账号或密码不正确");
    const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
    state.tokens.set(token, email);
    return ok(res, { access_token: token, refresh_token: `r-${token}`, expires_in: 3600, user: { balance: state.balance } });
  }
  if (req.method === "POST" && p === "/api/v1/__test/mark-paid") {
    state.subscriptions.push({
      id: state.subscriptions.length + 1,
      group_id: PLAN.group_id,
      group_name: PLAN.group_name,
      status: "active",
      monthly_limit_usd: 50,
      monthly_used_usd: 0,
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    });
    return ok(res, { ok: true });
  }
  if (req.method === "GET" && p === "/purchase") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><head><title>sub2api purchase</title></head><body><h1>mock purchase page</h1></body></html>");
    return;
  }
  if (req.method === "GET" && p === "/v1/models") {
    return json(res, 200, { object: "list", data: [{ id: "e2e-chat-model" }, { id: "e2e-codex-model" }, { id: "codex-auto-review" }] });
  }
  // 以下端点需要 Bearer token（模拟 relayAuthedFetch 401 自动重登路径：token 失效即 401）
  const auth = String(req.headers.authorization ?? "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const email = state.tokens.get(token);
  if (req.method === "POST" && p === "/api/v1/auth/register/email-code") return fail(res, 404, "not found");
  if (!email) return json(res, 401, { code: "UNAUTHORIZED", message: "Authorization header is required" });
  if (req.method === "GET" && p === "/api/v1/user/profile") return ok(res, { balance: state.balance, email });
  if (req.method === "GET" && p === "/api/v1/subscriptions/summary") {
    return ok(res, { active_count: state.subscriptions.length, total_used_usd: 0, subscriptions: state.subscriptions });
  }
  if (req.method === "GET" && p === "/api/v1/keys") return ok(res, state.keys);
  if (req.method === "POST" && p === "/api/v1/keys") {
    const key = { id: state.keys.length + 1, key: `sk-e2e-${Math.random().toString(36).slice(2, 12)}`, name: String(body.name ?? "key"), group_id: body.group_id ?? null, quota: null, quota_used: 0, status: "active" };
    state.keys.push(key);
    return ok(res, key);
  }
  if (req.method === "GET" && p === "/api/v1/groups/available") return ok(res, [GROUP]);
  if (req.method === "GET" && p === "/api/v1/payment/plans") return ok(res, [PLAN]);
  return fail(res, 404, "not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`\x1b[90m(mock sub2api 网关：${BASE})\x1b[0m`);

/** React 受控输入：native setter + input 事件（insertText 对已有值追加不可靠） */
async function fillField(h, labelText, value) {
  const done = await h.eval(`(() => {
    const modal = document.querySelector(".relay-login-modal");
    if (!modal) return "NO_MODAL";
    for (const field of modal.querySelectorAll(".se-field")) {
      const label = (field.querySelector("span")?.textContent || "").trim();
      if (label.startsWith(${JSON.stringify(labelText)})) {
        const el = field.querySelector("input");
        if (!el) return "NO_INPUT";
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return "OK";
      }
    }
    return "NO_FIELD";
  })()`);
  if (done !== "OK") throw new Error(`填字段「${labelText}」失败：${done}`);
}

/** 点击设置弹窗侧栏里的「中转站」导航项 */
async function openRelaySettings(h) {
  const hit = await h.eval(`(() => {
    const nav = document.querySelector(".settings-nav");
    if (!nav) return "NO_NAV";
    for (const btn of nav.querySelectorAll("button")) {
      if ((btn.textContent || "").includes("中转站")) { btn.click(); return "OK"; }
    }
    return "NO_ITEM";
  })()`);
  if (hit !== "OK") throw new Error(`打开中转站设置失败：${hit}`);
  // 冷启动（刚构建完首跑）引擎起来慢，置顶卡可能 15s+ 才渲染 —— 放宽到 30s 吸收偶发
  await h.waitFor(`!!document.querySelector(".relay-sub-banner")`, { label: "订阅置顶卡出现", timeoutMs: 30000 });
}

export const steps = [
  {
    name: "① 打开设置→中转站，置顶卡处于「未登录」态",
    run: async (h) => {
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面挂载", timeoutMs: 30000 });
      await wait(1000);
      await h.eval(`document.querySelector(".sidebar-settings")?.click()`);
      await h.waitFor(`!!document.querySelector(".settings-nav")`, { label: "设置弹窗", timeoutMs: 15000 });
      await openRelaySettings(h);
      const bannerState = await h.eval(`document.querySelector(".relay-sub-banner")?.getAttribute("data-state")`);
      h.check("未登录：置顶卡为 guest 态", bannerState === "guest", `state=${bannerState}`);
      const hasCta = await h.eval(`(() => { const b = document.querySelector(".relay-sub-banner .primary-setting"); return !!b && (b.textContent || "").includes("登录"); })()`);
      h.check("未登录：主 CTA 是「登录 / 注册」", hasCta === true);
      await h.screenshot("01-guest-banner");
    },
  },

  {
    name: "② 应用内注册 → 自动登录 → 自动打开套餐市场",
    run: async (h) => {
      await h.eval(`(() => { const b = [...document.querySelectorAll(".relay-sub-banner button")].find(x => (x.textContent || "").includes("登录")); b?.click(); return !!b; })()`);
      await h.waitFor(`!!document.querySelector(".relay-login-modal")`, { label: "登录/注册弹窗", timeoutMs: 10000 });
      await h.eval(`(() => { const tabs = [...document.querySelectorAll(".relay-auth-tabs button")]; tabs.find(t => (t.textContent || "").includes("注册"))?.click(); return tabs.length; })()`);
      await wait(300);
      await fillField(h, "站点地址", BASE);
      await fillField(h, "邮箱", "e2e-sub@test.local");
      await fillField(h, "密码", "e2e-pass-123");
      await fillField(h, "确认密码", "e2e-pass-123");
      await h.screenshot("02-register-form");
      await h.eval(`(() => { const b = [...document.querySelectorAll(".relay-login-modal button")].find(x => (x.textContent || "").includes("注册并进入套餐选购")); b?.click(); return !!b; })()`);
      // 注册成功 → 自动登录 → autoConfigure（无订阅走余额）→ 自动打开套餐市场
      await h.waitFor(`!!document.querySelector(".relay-plans-modal")`, { label: "注册后自动打开套餐市场", timeoutMs: 60_000 });
      h.check("注册成功且自动登录（mock 账号已落库）", state.users.has("e2e-sub@test.local"), `users=${[...state.users.keys()].join(",")}`);
      h.check("注册请求携带邀请码 aff_code", state.hits.some((x) => x === "POST /api/v1/auth/register"));
      h.check("注册后已有登录 token", state.tokens.size >= 1, `tokens=${state.tokens.size}`);
      await h.screenshot("03-plans-auto-open");
    },
  },

  {
    name: "③ 套餐市场渲染：价格/划线价/有效期/立即订阅",
    run: async (h) => {
      const card = await h.eval(`(() => {
        const card = document.querySelector(".relay-plan-market-card");
        if (!card) return null;
        return { text: card.innerText.replace(/\\n/g, " | "), hasBuy: !!card.querySelector(".relay-plan-buy") };
      })()`);
      h.check("市场卡片已渲染", Boolean(card), JSON.stringify(card?.text ?? "").slice(0, 120));
      h.check("价格 ¥9.9 与划线价 ¥350 可见", (card?.text ?? "").includes("¥9.9") && (card?.text ?? "").includes("¥350"), card?.text ?? "");
      h.check("有效期 30 天可见", (card?.text ?? "").includes("30 天"), "");
      h.check("「立即订阅」按钮存在", card?.hasBuy === true);
      // 关掉市场，回到 banner（无订阅 → empty 态）
      await h.eval(`document.querySelector(".relay-plans-modal .relay-modal-close")?.click()`);
      await h.waitFor(`!document.querySelector(".relay-plans-modal")`, { label: "市场弹窗关闭", timeoutMs: 8000 });
      const bannerState = await h.eval(`document.querySelector(".relay-sub-banner")?.getAttribute("data-state")`);
      h.check("无订阅：置顶卡为 empty 态", bannerState === "empty", `state=${bannerState}`);
    },
  },

  {
    name: "④ 立即订阅 → 打开站内支付页（token 注入弹窗）→ 进入等待支付态",
    run: async (h) => {
      await h.eval(`(() => { const b = [...document.querySelectorAll(".relay-sub-banner button")].find(x => (x.textContent || "").includes("选购套餐")); b?.click(); return !!b; })()`);
      await h.waitFor(`!!document.querySelector(".relay-plans-modal")`, { label: "重新打开套餐市场", timeoutMs: 15000 });
      // 弹窗先渲染 loading 态，卡片由 relayPaymentPlans 异步返回后才有 —— 必须等卡片，否则点击空放
      await h.waitFor(`!!document.querySelector(".relay-plan-market-card .relay-plan-buy")`, { label: "套餐卡片渲染", timeoutMs: 15000 });
      await h.eval(`document.querySelector(".relay-plan-market-card .relay-plan-buy")?.click()`);
      // openPurchase：主进程弹窗 loadURL /purchase → mock 记录命中（异步加载，轮询等它）
      await h.waitFor(`document.querySelector(".relay-sub-banner").classList.contains("watching")`, { label: "置顶卡进入等待支付态", timeoutMs: 20000 });
      for (let i = 0; i < 40 && !state.hits.includes("GET /purchase"); i++) await wait(250);
      h.check("站内支付页被打开（mock 命中 /purchase）", state.hits.includes("GET /purchase"), `hits=${state.hits.filter((x) => x.includes("purchase")).join(",")}`);
      h.check("等待态提供「我已完成支付」核验按钮", await h.eval(`(() => { const b = [...document.querySelectorAll(".relay-sub-banner button")].find(x => (x.textContent || "").includes("我已完成支付")); return !!b; })()`) === true);
      await h.screenshot("04-watching");
    },
  },

  {
    name: "⑤ 模拟付款到账 → 自动新建套餐密钥 → 供应商生效 → 置顶卡更新",
    run: async (h) => {
      const before = state.keys.length;
      await fetch(`${BASE}/api/v1/__test/mark-paid`, { method: "POST" });
      // 激活链 = 探测 + saveCustomModel + 引擎重启（秒级）。**不能拿 banner 状态当完成信号**
      //（verifyPayment 先 setOverview 再跑激活，banner 会提前变 active）——以 relay-active
      // 落库（mode=plan + 套餐分组）为链路完成的权威信号。
      await h.waitFor(`(() => { try { const a = JSON.parse(localStorage.getItem("relay-active-v1") || "null"); return Boolean(a && a.mode === "plan" && Number(a.groupId) === ${PLAN.group_id}); } catch { return false; } })()`, {
        label: "激活链落库（relay-active = plan + 套餐分组）",
        timeoutMs: 90_000,
      });
      h.check("自动新建了绑定套餐分组的密钥", state.keys.length > before && state.keys.some((k) => k.group_id === PLAN.group_id), `keys=${state.keys.map((k) => k.name + ":g" + k.group_id).join(",")}`);
      const active = await h.eval(`(() => { try { return JSON.parse(localStorage.getItem("relay-active-v1") || "null"); } catch { return null; } })()`);
      h.check("relay-active 落库：plan 模式 + 套餐分组", Boolean(active) && active.mode === "plan" && Number(active.groupId) === PLAN.group_id, JSON.stringify(active && { mode: active.mode, groupId: active.groupId, provider: active.provider }));
      h.check("生效供应商 = 网关生成的 relay 供应商", Boolean(active?.provider?.startsWith("relay-")), String(active?.provider ?? ""));
      // 激活完成后 verifyPayment 会再刷一次 overview → selected 回填 → 置顶卡亮「当前生效」
      await h.waitFor(`(() => { const el = document.querySelector(".relay-sub-banner"); return !!el && el.innerText.includes("当前生效"); })()`, { label: "置顶卡亮「当前生效」", timeoutMs: 20_000 });
      const badge = await h.eval(`(() => { const el = document.querySelector(".relay-sub-banner"); return el ? el.innerText.replace(/\\n/g, " | ") : ""; })()`);
      h.check("置顶卡展示套餐与额度", badge.includes("月额度已用"), badge.slice(0, 120));
      // 正向联动加强：中转站激活后，模型供应商列表里**只有本站供应商是启用态**（其他全部自动停用）
      // 注意必须走 Electron IPC（window.codex.listCustomModels）——window.codex.request 是引擎 RPC，
      // 引擎不认识 custom-model:list，reject 后 eval 返回错误串会把它当 truthy 假绿（实测踩过）。
      await h.waitFor(`window.codex.listCustomModels().then((r) => {
        const relay = (r.providers || []).find((p) => p.provider === ${JSON.stringify("relay-127")});
        return Boolean(relay && relay.enabled !== false) && (r.providers || []).every((p) => p.provider === ${JSON.stringify("relay-127")} || p.enabled === false);
      })`, { label: "供应商互斥：仅 relay 供应商启用", timeoutMs: 30_000 });
      h.check("互斥生效：其他供应商已自动停用，只启用 relay 对应供应商", true);
      await h.screenshot("05-activated");
    },
  },

  {
    name: "⑥ 反向联动：手动启用其他供应商 → relay 供应商被停用 + 中转站退出当前生效",
    run: async (h) => {
      // 模拟用户在模型设置里启用另一个供应商（custom906 是灌入的真实供应商）
      const listResp = await h.eval(`window.codex.listCustomModels()`);
      const list = JSON.stringify((listResp?.providers || []).map((p) => p.provider));
      const others = JSON.parse(list).filter((p) => p !== "relay-127");
      if (!others.length) { h.check("前置：存在其他供应商可反向切换", false, list); return; }
      await h.eval(`window.codex.setProviderEnabled({ provider: ${JSON.stringify(others[0])}, enabled: true }).then(() => "ok").catch(e => "ERR:" + e.message)`);
      // set-enabled 全局互斥 → relay-127 被停用；provider-activated 广播 → 渲染层清 relay-active
      await h.waitFor(`window.codex.listCustomModels().then((r) => {
        const relay = (r.providers || []).find((p) => p.provider === ${JSON.stringify("relay-127")});
        const other = (r.providers || []).find((p) => p.provider === ${JSON.stringify(others[0])});
        return other?.enabled !== false && relay?.enabled === false;
      })`, { label: "互斥反转：relay 供应商被停用", timeoutMs: 30_000 });
      h.check("反向互斥：启用其他供应商后 relay 供应商自动停用", true);
      await h.waitFor(`(() => { try { return localStorage.getItem("relay-active-v1") === null; } catch { return false; } })()`, { label: "relay-active 已清（中转站退出当前生效）", timeoutMs: 20_000 });
      h.check("反向联动：中转站「当前生效」标记已清除（置顶卡/徽标同步退场）", true);
      await h.screenshot("06-reverse-linkage");
    },
  },

  {
    name: "⑦ 渲染层无 console.error",
    run: async (h) => {
      h.check("渲染层无 console.error", h.consoleLog.length === 0, h.consoleLog.slice(0, 3).join(" ｜ "));
    },
  },
];
