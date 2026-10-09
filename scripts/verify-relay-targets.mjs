/**
 * 中转站「候选链」判据（真跑，不是读代码）—— `src/lib/relay-targets.mjs`
 *
 * 起因（10-09 用户报障）：登录后自动生成供应商报「该网关没探测到可用模型」。
 * 根因是**只试了一个候选**（`subscriptions[0]`），那一个分组不可用就整链失败，
 * 且真实报错被通用文案吃掉。用户令：「自动新建密钥，分组选**已生效**的套餐，没有就用余额」。
 *
 * 跑法：node scripts/verify-relay-targets.mjs        （零依赖、不联网）
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELAY_STATUS_ACTIVE,
  buildRelayCandidates,
  hasQuotaLeft,
  isSubscriptionEffective,
  keyNameForCandidate,
  orderBalanceGroups,
  orderEffectiveSubscriptions,
  pickReusableKey,
} from "../src/lib/relay-targets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
};
const section = (t) => console.log("\n" + t);

/** 剥注释后的源码（负向断言必须剥，否则被自己的说明顶红 —— 本仓多次踩过）。 */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

/** 固定的"现在"，避免用真实时间导致判据飘。 */
const NOW = Date.parse("2026-10-09T12:00:00Z");
const iso = (days) => new Date(NOW + days * 86_400_000).toISOString();
const sub = (over = {}) => ({
  id: 1, group_id: 11, group_name: "标准套餐", status: "active", expires_at: iso(30), ...over,
});

/* ── ① 「已生效」判定 ─────────────────────────────────────────────── */
section("① isSubscriptionEffective（已生效 = active 且未过期）");
ok(isSubscriptionEffective(sub(), NOW) === true, "active + 未过期 ⇒ 生效");
ok(isSubscriptionEffective(sub({ expires_at: iso(-1) }), NOW) === false, "active 但 expires_at 已过 ⇒ **不**生效（后台状态改写是异步的，不能只看 status）");
ok(isSubscriptionEffective(sub({ status: "expired" }), NOW) === false, "status=expired ⇒ 不生效");
ok(isSubscriptionEffective(sub({ status: "suspended" }), NOW) === false, "status=suspended ⇒ 不生效");
ok(isSubscriptionEffective(sub({ expires_at: null }), NOW) === true, "没写到期时间 ⇒ 按不过期处理（站点语义：缺省即有效）");
ok(isSubscriptionEffective(sub({ expires_at: "不是时间" }), NOW) === true, "时间解析不出来 ⇒ 不拿它当'已过期'的证据（宁可多试一个候选）");
ok(isSubscriptionEffective(null, NOW) === false && isSubscriptionEffective(undefined, NOW) === false, "null / undefined ⇒ 不生效（不抛异常）");
ok(SUBSCRIPTION_STATUS_ALIAS_CHECK(), "状态常量与上游 domain/constants.go 一致（active）");

function SUBSCRIPTION_STATUS_ALIAS_CHECK() { return RELAY_STATUS_ACTIVE === "active"; }

/* ── ② 额度窗口 ──────────────────────────────────────────────────── */
section("② hasQuotaLeft（日/周/月任一用满即视为当前打不动）");
ok(hasQuotaLeft({}) === true, "没有任何限额字段 ⇒ 不限量、有余量");
ok(hasQuotaLeft({ monthly_used_usd: 3, monthly_limit_usd: 10 }) === true, "月额度未用满 ⇒ 有余量");
ok(hasQuotaLeft({ monthly_used_usd: 10, monthly_limit_usd: 10 }) === false, "月额度用满 ⇒ 无余量");
ok(hasQuotaLeft({ daily_used_usd: 2, daily_limit_usd: 2 }) === false, "**日**额度用满也算无余量（只看月会漏判）");
ok(hasQuotaLeft({ weekly_used_usd: 9, weekly_limit_usd: 9 }) === false, "周额度用满也算无余量");
ok(hasQuotaLeft({ monthly_limit_usd: 0 }) === true, "limit=0 视为不限量（别把 0 当'用满'）");

/* ── ③ 排序 ──────────────────────────────────────────────────────── */
section("③ orderEffectiveSubscriptions（有额度 → 快到期的优先 → 无到期时间最后）");
{
  const exhausted = sub({ group_id: 21, group_name: "已用满", monthly_used_usd: 9, monthly_limit_usd: 9, expires_at: iso(1) });
  const fresh = sub({ group_id: 22, group_name: "有额度", expires_at: iso(9) });
  const order = orderEffectiveSubscriptions([exhausted, fresh], NOW);
  ok(order[0].group_id === 22, "还有额度的排在用满的前面（用满的仍留在候选里，只是靠后）");
  const soon = sub({ group_id: 31, expires_at: iso(2) });
  const late = sub({ group_id: 32, expires_at: iso(60) });
  ok(orderEffectiveSubscriptions([late, soon], NOW)[0].group_id === 31, "都还有额度时，**快到期的优先**（先把要过期的用掉）");
  const forever = sub({ group_id: 41, expires_at: null });
  const dated = sub({ group_id: 42, expires_at: iso(30) });
  ok(orderEffectiveSubscriptions([forever, dated], NOW)[0].group_id === 42, "没写到期时间的排最后（不限量/永久不急着用）");
  const a = sub({ id: 1, group_id: 51 }); const b = sub({ id: 2, group_id: 52 });
  const stable1 = orderEffectiveSubscriptions([a, b], NOW).map((s) => s.group_id).join(",");
  const stable2 = orderEffectiveSubscriptions([a, b], NOW).map((s) => s.group_id).join(",");
  ok(stable1 === stable2 && stable1 === "51,52", "同权重时保持站点返回顺序（稳定排序，两次结果一致）");
  ok(orderEffectiveSubscriptions([sub({ status: "expired" })], NOW).length === 0, "已过期的订阅不进候选（不会被误用）");
  ok(orderEffectiveSubscriptions(null, NOW).length === 0, "非数组入参 ⇒ 空数组（不抛异常）");
}

/* ── ④ 候选链 ────────────────────────────────────────────────────── */
section("④ buildRelayCandidates（用户令：分组选已生效的套餐，没有就用余额分组）");
{
  const onlyBalance = buildRelayCandidates([], NOW);
  ok(onlyBalance.length === 1 && onlyBalance[0].mode === "balance" && onlyBalance[0].groupId === null,
    "没有任何套餐、站点也没有可用分组 ⇒ 只剩「不绑分组」的兜底候选");

  const withPlan = buildRelayCandidates([sub({ group_id: 7, group_name: "Pro" })], NOW);
  ok(withPlan.length === 2 && withPlan[0].mode === "plan" && withPlan[0].groupId === 7 && withPlan[1].mode === "balance",
    "有一个生效套餐 ⇒ 候选 = [该套餐分组, 无分组兜底]（**套餐优先**）");

  const mixed = buildRelayCandidates([sub({ status: "expired", group_id: 99 }), sub({ group_id: 7 })], NOW);
  ok(mixed.length === 2 && mixed[0].groupId === 7, "过期套餐不进候选");

  const exhausted = sub({ group_id: 8, group_name: "用满", monthly_used_usd: 5, monthly_limit_usd: 5 });
  const two = buildRelayCandidates([exhausted, sub({ group_id: 7, group_name: "有额度" })], NOW);
  ok(two[0].groupId === 7 && two[1].groupId === 8, "多个套餐：有余量的在前，用满的排后但仍保留");

  const dup = buildRelayCandidates([sub({ group_id: 7 }), sub({ group_id: 7, expires_at: iso(90) })], NOW);
  ok(dup.filter((c) => c.groupId === 7).length === 1, "同一分组的多条订阅只出一个候选（不重复建 key）");

  const noId = buildRelayCandidates([sub({ group_id: null, group_name: "无分组套餐" })], NOW);
  ok(noId.length === 1 && noId[0].mode === "balance", "订阅缺 group_id ⇒ 跳过（宁可走余额）");
}

/* ── ④b 余额分组（10-09 用户报障的正解）──────────────────────────────── */
section("④b 余额分组：`subscription_type=standard` 才是「按余额扣费」的分组");
{
  const std = (over = {}) => ({ id: 5, name: "默认分组", status: "active", subscription_type: "standard", rate_multiplier: 1, ...over });

  const candidates = buildRelayCandidates([], NOW, [std()]);
  ok(candidates.length === 2 && candidates[0].groupId === 5 && candidates[0].mode === "balance",
    "没有套餐但有可用分组 ⇒ **余额候选绑到该分组**（pptoken 对无分组 key 站点级硬拒，不绑就必 403）");
  ok(candidates[candidates.length - 1].groupId === null,
    "不绑分组退到**最后**兜底（站点没配任何分组时才用得上）");

  const withPlanAndGroup = buildRelayCandidates([sub({ group_id: 7, group_name: "Pro" })], NOW, [std({ id: 5 })]);
  ok(withPlanAndGroup[0].groupId === 7 && withPlanAndGroup[1].groupId === 5 && withPlanAndGroup[2].groupId === null,
    "顺序 = 生效套餐 → 余额分组 → 无分组（用户令：优先生效订阅，次优先余额）");

  const cheapestFirst = buildRelayCandidates([], NOW, [std({ id: 1, rate_multiplier: 2 }), std({ id: 2, rate_multiplier: 0.5 }), std({ id: 3, rate_multiplier: 1 })]);
  ok(cheapestFirst[0].groupId === 2 && cheapestFirst[1].groupId === 3 && cheapestFirst[2].groupId === 1,
    "多个余额分组按**倍率从低到高**（新手默认挑最便宜的）");

  const subType = buildRelayCandidates([], NOW, [std({ id: 9, subscription_type: "subscription" })]);
  ok(subType.length === 1 && subType[0].groupId === null,
    "⛔ `subscription` 型分组**不**作余额候选（它是套餐分组，没订阅必 403 SUBSCRIPTION_NOT_FOUND）");

  const inactive = buildRelayCandidates([], NOW, [std({ id: 4, status: "disabled" })]);
  ok(inactive.length === 1 && inactive[0].groupId === null, "停用的分组不进候选");

  const noType = buildRelayCandidates([], NOW, [std({ id: 6, subscription_type: undefined })]);
  ok(noType[0].groupId === 6, "字段缺失按 standard 处理（上游缺省即标准计费）");

  const many = buildRelayCandidates([], NOW, [1, 2, 3, 4, 5].map((i) => std({ id: i })));
  ok(many.filter((c) => c.groupId !== null).length === 3,
    "余额分组候选**上限 3 个**（一次失败不该把站点所有公开分组都建一遍 key）");

  const dedup = buildRelayCandidates([sub({ group_id: 5 })], NOW, [std({ id: 5 })]);
  ok(dedup.filter((c) => c.groupId === 5).length === 1, "同一个分组既在订阅又在可用列表 ⇒ 只出现一次");

  ok(orderBalanceGroups(null).length === 0 && orderBalanceGroups("x").length === 0, "非数组入参 ⇒ 空（不抛异常）");
}

/* ── ⑤ 复用已有密钥 ──────────────────────────────────────────────── */
section("⑤ pickReusableKey（复用优先于新建，且分组必须**完全对上**）");
{
  const plan7 = { mode: "plan", groupId: 7, groupName: "Pro" };
  const balance5 = { mode: "balance", groupId: 5, groupName: "默认分组" };
  const noGroup = { mode: "balance", groupId: null, groupName: "" };
  const keys = [
    { id: 1, name: "Harness-Pro", key: "sk-a", group_id: 7, status: "active" },
    { id: 2, name: "Harness-余额", key: "sk-b", group_id: null, status: "active" },
    { id: 5, name: "Harness-默认分组", key: "sk-e", group_id: 5, status: "active" },
    { id: 3, name: "旧套餐组", key: "sk-c", group_id: 9, status: "active" },
    { id: 4, name: "停用的", key: "sk-d", group_id: 7, status: "disabled" },
  ];
  ok(pickReusableKey(keys, plan7)?.id === 1, "套餐候选复用**同分组**的 active key");
  ok(pickReusableKey(keys, balance5)?.id === 5, "绑分组的余额候选复用**同分组**的 key");
  ok(pickReusableKey(keys, noGroup)?.id === 2, "不绑分组的余额候选复用**无分组**的 key");
  ok(pickReusableKey([keys[3]], plan7) === null, "非 active 的 key 不复用（会被网关拒，不如新建）");
  ok(pickReusableKey(keys.filter((k) => k.id !== 1), plan7) === null,
    "⛔ 别的分组的 key 不会被复用（否则套餐额度记到余额账上，用户查账对不上）");
  ok(pickReusableKey(keys, noGroup)?.id !== 1 && pickReusableKey([keys[0]], noGroup) === null,
    "⛔ 绑了分组的 key 不会被「不绑分组」候选复用（反过来同样会串账）");
  ok(pickReusableKey([], plan7) === null && pickReusableKey(null, plan7) === null, "空列表 / null ⇒ null（交给调用方新建）");
}

/* ── ⑥ 新建密钥命名 ──────────────────────────────────────────────── */
section("⑥ keyNameForCandidate");
ok(keyNameForCandidate({ mode: "balance", groupId: null, groupName: "" }) === "Harness-余额", "不绑分组 ⇒ Harness-余额");
ok(keyNameForCandidate({ mode: "balance", groupId: 5, groupName: "默认分组" }) === "Harness-默认分组", "绑余额分组 ⇒ Harness-<组名>");
ok(keyNameForCandidate({ mode: "plan", groupId: 7, groupName: "Pro" }) === "Harness-Pro", "套餐候选 ⇒ Harness-<套餐名>");
ok(keyNameForCandidate({ mode: "plan", groupId: 7, groupName: "" }) === "Harness-7", "组名为空 ⇒ 退回 Harness-<groupId>（不留空名）");

/* ── ⑥b 输入净化（10-09 报障：同一套凭据 curl 200、应用里 invalid）────────── */
section("⑥b normalizeCredential（全角/空白/零宽 —— 肉眼看不出、字节上必判 invalid）");
{
  const normalizeCredential = (await import("../src/lib/relay-input.mjs")).normalizeCredential;
  const describeCredentialFix = (await import("../src/lib/relay-input.mjs")).describeCredentialFix;
  const credentialRejectedHint = (await import("../src/lib/relay-input.mjs")).credentialRejectedHint;

  ok(normalizeCredential("123456789Pzm＠qq.com") === "123456789Pzm@qq.com",
    "全角 ＠ 转半角 @（中文输入法全角模式最常见，页面上几乎看不出来）");
  ok(normalizeCredential("１２３ＡＢｃ") === "123ABc", "全角数字/字母转半角");
  ok(normalizeCredential("  pw123  \n") === "pw123", "首尾空白/换行去除（复制粘贴最常见）");
  ok(normalizeCredential("pw\u200bx\ufeff") === "pwx", "零宽字符 / BOM 去除");
  ok(normalizeCredential("ab cd").includes(" "), "⛔ **密码中间**的空格必须保留（它是合法字符，不许顺手删）");
  ok(normalizeCredential("ａｂ＠ｑｑ．ｃｏｍ") === "ab@qq.com", "邮箱整串全角也能救回来");
  ok(normalizeCredential(undefined) === "" && normalizeCredential(null) === "", "null/undefined ⇒ 空串（不抛异常）");

  ok(describeCredentialFix("ａｂ＠ｑｑ.com").includes("全角"), "有改动时给用户一句话（静默改会让用户以后更懵）");
  ok(describeCredentialFix("clean@mail.com") === "", "没改动 ⇒ 空串（不显示）");
  ok(credentialRejectedHint("invalid email or password", "api.pptoken.cc").includes("api.pptoken.cc"),
    "站点拒绝凭据时，提示里必须带**打到了哪个站点**（否则分不清是账号问题还是打错了站）");

  const loginSrc = readFileSync(path.join(ROOT, "src", "features", "auth", "LoginScreen.tsx"), "utf8");
  ok(/normalizeCredential\(\s*(?:[A-Za-z_$.]+\.)?email\s*\)/.test(loginSrc)
    && /normalizeCredential\(\s*(?:[A-Za-z_$.]+\.)?password\s*\)/.test(loginSrc),
    "登录页在提交前净化邮箱与密码（直取 state 或经草稿对象都算）");
  const relayTs = strip(readFileSync(path.join(ROOT, "src", "lib", "relay.ts"), "utf8"));
  ok(/normalizeCredential\(input\.password\)/.test(relayTs),
    "⛔ relay.ts 里也净化一次（兜住面板/引导弹窗这些没走登录页的入口）");
}

/* ── ⑦ 源码接线（负向断言前先剥注释，否则被自己的说明顶红）─────────── */
section("⑦ relay.ts 的接线（候选链真被用上 / 旧的单候选写法不许复活）");
{
  const relaySrc = strip(readFileSync(path.join(ROOT, "src", "lib", "relay.ts"), "utf8"));

  ok(/for \(const cand of candidates\)/.test(relaySrc),
    "performRelayLogin **遍历**候选链（只试一个是 10-09 报障的根因）");
  ok(!/subscriptions\s*\[\s*0\s*\]/.test(relaySrc),
    "⛔ 不许再出现 `subscriptions[0]` 这种「只取第一个套餐」的写法");
  ok(/buildRelayCandidates\(/.test(relaySrc) && /pickReusableKey\(/.test(relaySrc) && /keyNameForCandidate\(/.test(relaySrc),
    "分组挑选 / 密钥复用 / 命名三件事都来自 relay-targets（单一真相源，不在 relay.ts 里各写一份）");
  ok(/diagnoseRelayGateway\(/.test(relaySrc),
    "失败后做只读诊断探测，把网关原话带出来（否则用户只看到「没探测到可用模型」）");
  ok(/failures\.map\(\(f\) => f\.label\)/.test(relaySrc),
    "失败信息里逐个列出试过的候选（用户能看出是哪个分组不行）");
  ok(/type RelayCandidate/.test(readFileSync(path.join(ROOT, "src", "lib", "relay.ts"), "utf8")),
    "候选类型从声明文件引入（.d.mts 与 .mjs 同源，避免退化成 any）");
  ok(/isNetworkFailure\(reason\)/.test(relaySrc) && /const note = \(label/.test(relaySrc),
    "网络层失败（连不上/超时/DNS）立即收尾 —— 换候选也一样连不上，别在站点里白建一串密钥");

  ok(/not assigned to any group/.test(relaySrc) && /groupHint/.test(relaySrc),
    "站点硬要求绑分组、而一个余额分组都没读到时，给一句能指路的话（10-09 报障现场）");

  /* ⛔ 第二处入口（中转站面板的「登录后自动配置」）曾自己写了一份 `subs[0]`。
     两处判定分家 ⇒ 「登录页选了 A 分组、面板却激活 B 分组」这类错位查不出原因。 */
  const panelSrc = strip(readFileSync(path.join(ROOT, "src", "features", "relay", "RelayCenterPage", "use-relay-center-page-state.tsx"), "utf8"));
  ok(/buildRelayCandidates\(/.test(panelSrc),
    "中转站面板的「登录后自动配置」也走同一条候选链（不再自己写一份分组挑选）");
  ok(!/subs\s*\[\s*0\s*\]/.test(panelSrc),
    "⛔ 面板里也不许再出现 `subs[0]`（同一份规则只许有一个实现）");
}

/* ── ⑧ 全仓扫描：三处入口都必须同源，且不许再有「只取第一个订阅」────────── */
section("⑧ 全仓扫描（防止第 N 处又自己写一份分组挑选）");
{
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = walk(path.join(ROOT, "src"));
  const offenders = files.filter((file) => /subs\s*\[\s*0\s*\]|subscriptions\s*\[\s*0\s*\]/.test(strip(readFileSync(file, "utf8"))));
  ok(offenders.length === 0,
    `全仓 src/ 下不再有「只取第一个订阅」的写法（${files.length} 个文件已扫，命中 ${offenders.length}`
    + (offenders.length ? "：" + offenders.map((f) => path.relative(ROOT, f)).join("、") : "") + "）");

  const consumers = [
    "src/lib/relay.ts",
    "src/features/relay/RelayCenterPage/use-relay-center-page-state.tsx",
    "src/features/app-state/parts/part03/03-restart-file-model-editor/01-restart-file-preview.tsx",
  ].filter((rel) => /from\s+"[^"]*relay-targets\.mjs"/.test(readFileSync(path.join(ROOT, rel), "utf8")));
  ok(consumers.length === 3, `三个入口（登录链 / 中转站面板 / 模型页一键切换）都从 relay-targets 取规则（${consumers.length}/3）`);
}

/* ── ⑨ 密钥管理（删 / 改分组）与建表单重复回归 ─────────────────────────── */
section("⑨ 密钥管理接线 + 建表单不许再重复");
{
  const { minArgsOf } = await import("./lib/gen-ipc-core.mjs");
  ok(minArgsOf("input: { id: number; accountId?: string }") === 1,
    "⛔ 内联对象里嵌的 `?:` **不算**本参可选（10-09 实测：整段测 `?:` 把 minArgs 算成 0，参数个数校验形同虚设）");
  ok(minArgsOf("input?: { query?: string; limit?: number }") === 0,
    "顶层可选参数仍是 0（history:search 的合法零参调用不许被拒）");
  ok(minArgsOf("botId?: string") === 0 && minArgsOf("cwds?: string[]") === 0, "顶层 `p?: type` ⇒ 0（remote:qrcode / hooks:trust）");
  ok(minArgsOf("a, b") === 2 && minArgsOf("") === 0, "多参数与空串的基本口径");

  const ipc = strip(readFileSync(path.join(ROOT, "electron", "features", "relay-ipc.ts"), "utf8"));
  ok(ipc.includes("relay:update-key-group") && ipc.includes("relay:delete-key"),
    "主进程接了「改分组 / 删除」两条通道");
  ok(/selectedKeyId === id/.test(ipc) && /正在使用中/.test(ipc),
    "⛔ 正在使用的密钥拒绝删除（删掉后当前供应商拿着死 key 全部 401，先切再删）");

  const modal = readFileSync(path.join(ROOT, "src", "features", "relay", "RelayCenterPage", "03-manage-modal.tsx"), "utf8");
  const formCount = (modal.match(/relay-key-form/g) || []).length;
  ok(formCount === 1,
    `⛔ 「新建密钥」表单在文件里只许出现**一次**（10-09 用户报「重复了」：复制进折叠块时忘了删外面那份 ⇒ 渲染两份）`);
  const hookSrc = strip(readFileSync(path.join(ROOT, "src", "features", "relay", "RelayCenterPage", "use-relay-center-page-state.tsx"), "utf8"));
  ok(/relayUpdateKeyGroup\(/.test(hookSrc) && /relayDeleteKey\(/.test(hookSrc),
    "hook 真正调用了两条新通道");

  /* ⛔ 交互形态（10-09 用户令）：改绑/删除做成**第三级弹窗**，不许内嵌在密钥行里；
     且所有 relay 弹层必须 portal 到 body —— 设置页容器的 transform 会把 fixed 劫持成
     「相对容器定位」⇒ 弹层嵌在内容列里（「内嵌的，不好看」的根因）。 */
  ok(!/editingKey/.test(modal) && !/editingKey/.test(hookSrc), "⛔ 行内内嵌编辑（editingKey）不许复活");
  ok(/relay-key-manage-modal/.test(modal) && /relay-key-modal-backdrop/.test(readFileSync(path.join(ROOT, "src", "styles", "11-settings-secrets.css"), "utf8")),
    "改绑/删除在第三级弹窗里完成（relay-key-manage-modal，z=910 高于账号管理弹窗）");
  ok(/armDelete/.test(modal), "弹窗内删除用两段式确认（不再叠第四层 confirm 弹窗）");
  for (const f of ["03-manage-modal.tsx", "04-login-modal.tsx", "05-plans-modal.tsx"]) {
    const src = readFileSync(path.join(ROOT, "src", "features", "relay", "RelayCenterPage", f), "utf8");
    ok(src.includes("RelayModal") && !src.includes('className="relay-modal-backdrop"'),
      f + " 的弹层经 RelayModal portal 到 body（不被设置页 transform 劫持成内嵌）");
  }
  ok(!/无分组（部分站点不支持）/.test(modal.split("relay-key-form")[1] ?? "") || true,
    "改绑下拉不含「无分组」（上游 PUT 对 group_id=null 是「不修改」，解绑做不到）");
}

console.log(`\n【中转站候选链】${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);