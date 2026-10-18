/**
 * 云账号 / 云端模型同步 / 云端知识库·记忆（cloud-* 四域）判据（10-16 立）
 *
 * 用户令：桌面版做成**中转站式云账号登录**，登录后自动同步云端模型并保持更新；
 * 记忆与知识库经 MCP 接本地环境；**各板块保持独立**、接口配置齐全。
 *
 * 失效方式全是有害且往往静默的：
 *   · `accountsBase` / `cloudHome` 又长出第二份实现 ⇒ 同机两个域读两个目录/两个基址，
 *     界面表现是"这边登录了、那边说没登录"（迁入前就存在这个隐患，本守卫防它复发）；
 *   · 云供应商只写复数列表、漏写**单数生效档案** ⇒ 10-16「勾 5 个、下拉 15 个」事故复发；
 *   · 令牌走明文落盘、或被写进引擎 config.toml ⇒ 凭据泄漏；
 *   · 记忆中枢没有 MCP 端点却伪造一个连接器 ⇒ 模型每轮去试一个死端点，报错还指向 MCP；
 *   · manifest / registry / composition 任一漏登记 ⇒ 通道调不到或域不挂载。
 * 网络行为（真登录、真同步）由验收与用户实测覆盖；本守卫钉**结构、登记与单源边界**。
 * 独立守卫（不进 _ctx MODULES 计数），已挂进 package.json 的 check 链。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【cloud】${message}`);
  if (!condition) fails++;
};

const DOMAINS = [
  { id: "cloud-auth", file: "features/cloud-auth-ipc.ts", channels: ["cloud-auth:login", "cloud-auth:logout", "cloud-auth:switch", "cloud-auth:status", "cloud-auth:points"] },
  { id: "cloud-models", file: "features/cloud-models-ipc.ts", channels: ["cloud-models:catalog", "cloud-models:sync", "cloud-models:token", "cloud-models:set-enabled", "cloud-models:activate", "cloud-models:status"] },
  { id: "cloud-kb", file: "features/cloud-kb-ipc.ts", channels: ["cloud-kb:sync", "cloud-kb:status"] },
  { id: "cloud-memory", file: "features/cloud-memory-ipc.ts", channels: ["cloud-memory:sync", "cloud-memory:status"] },
];
const ALL_CHANNELS = DOMAINS.flatMap((d) => d.channels);

const api = read("electron/cloud-api.ts");
const provider = read("electron/cloud-provider.ts");
const mcp = read("electron/cloud-mcp.ts");
const memory = read("electron/features/cloud-memory-ipc.ts");
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registry = read("electron/ipc-registry.ts");
const composition = JSON.parse(read("electron/composition.json"));

/* ── ① 四个域文件都在，且 composition 各登记一行（enabled） ────────────── */
const rows = composition.domains || [];
const missingFiles = DOMAINS.filter((d) => !existsSync(join(ROOT, "electron", d.file))).map((d) => d.file);
ok(missingFiles.length === 0, `四个云域文件都在（缺：${missingFiles.join("/") || "无"}）`);

const unregistered = DOMAINS.filter((d) => !rows.some((r) => r && r.id === d.id && r.enabled));
ok(unregistered.length === 0, `四个云域都在组合表里启用（未启用：${unregistered.map((d) => d.id).join("/") || "无"}）`);

/* ⛔ 一个板块恒等于一个域前缀：每个域文件只被组合表引用一行（【253】⑥ 的棘轮之外再钉一次本域面） */
const dupFiles = DOMAINS.filter((d) => rows.filter((r) => r && r.file === d.file).length !== 1).map((d) => d.file);
ok(dupFiles.length === 0, `云域文件在组合表里各出现且仅出现一次（异常：${dupFiles.join("/") || "无"}）`);

/* ── ② manifest：13 条通道全在，且 count 自洽 ─────────────────────────── */
const manifestChannels = (manifest.channels || []).map((c) => c.channel);
const missingCh = ALL_CHANNELS.filter((c) => !manifestChannels.includes(c));
ok(missingCh.length === 0, `manifest 含全部 ${ALL_CHANNELS.length} 条云域通道（缺：${missingCh.join("/") || "无"}）`);
ok(
  manifestChannels.length === manifest.count,
  `manifest count 自洽（count=${manifest.count}，实际 ${manifestChannels.length}）`,
);

/* ── ③ registry：四个前缀登记，且 count == 通道数（【90】/【107】口径） ── */
const badCounts = DOMAINS.filter((d) => {
  const m = new RegExp(`prefix:\\s*"${d.id}",\\s*count:\\s*(\\d+)`).exec(registry);
  return !m || Number(m[1]) !== d.channels.length;
});
ok(badCounts.length === 0, `registry 四个云域的 count 与通道数一致（不符：${badCounts.map((d) => d.id).join("/") || "无"}）`);

/* ── ④⛔⛔ 基座单源：accountsBase / cloudHome 全仓只能有一份实现 ───────── */
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
const electronFiles = walk(join(ROOT, "electron"));
const defineSites = (name) =>
  electronFiles.filter((p) => new RegExp(`export function ${name}\\s*\\(`).test(codeOnly(readFileSync(p, "utf8"))));
const baseSites = defineSites("accountsBase");
const homeSites = defineSites("cloudHome");
ok(
  baseSites.length === 1 && baseSites[0].endsWith("cloud-api.ts"),
  `accountsBase 全仓只有一份实现且在基座（实测 ${baseSites.length} 处：${baseSites.map((p) => p.split(/[\\/]/).pop()).join("/")}）`,
);
ok(
  homeSites.length === 1 && homeSites[0].endsWith("cloud-api.ts"),
  `cloudHome 全仓只有一份实现且在基座（实测 ${homeSites.length} 处：${homeSites.map((p) => p.split(/[\\/]/).pop()).join("/")}）`,
);
/* 域里不许自己解析基址环境变量（否则又是一份判定） */
const envReaders = electronFiles.filter((p) => {
  const name = p.split(/[\\/]/).pop();
  if (name === "cloud-api.ts") return false;
  return /HARNESS_ACCOUNTS_BASE/.test(codeOnly(readFileSync(p, "utf8")));
});
ok(envReaders.length === 0, `除基座外没有文件自行解析 HARNESS_ACCOUNTS_BASE（违规：${envReaders.map((p) => p.split(/[\\/]/).pop()).join("/") || "无"}）`);

/* ── ⑤⛔ 写云供应商必须同轮写**单数生效档案**（10-16 事故复发防线） ──────── */
const providerCode = codeOnly(provider);
ok(
  /customModelFile/.test(providerCode) && /function alignActiveFile/.test(providerCode),
  "云供应商写入包含 alignActiveFile（同时对齐单数生效档案 —— 10-16「勾 5 个下拉 15 个」的根因防线）",
);
ok(/promoteIfVacant/.test(providerCode), "空生效位由 promoteIfVacant 补上（否则下拉框整只灰的、点不动）");
ok(
  /if \(changed\) await writeCustomModels\(list\);/.test(providerCode),
  "写复数列表只在 changed 时落盘（幂等：没变就不写，避免与渲染层保存打架）",
);

/* ── ⑥⛔ 令牌不落明文、不进 config.toml ───────────────────────────────── */
const apiCode = codeOnly(api);
ok(/safeStorage/.test(apiCode) && /encryptString/.test(apiCode), "云令牌经 safeStorage 加密（不写明文凭据）");
ok(
  /isEncryptionAvailable/.test(apiCode) && /return "";/.test(apiCode),
  "安全存储不可用时**拒绝存储**（返回空串，而不是退化成明文）",
);
const mcpCode = codeOnly(mcp);
ok(
  /encryptedSecrets/.test(mcpCode) && /envHttpHeaders/.test(mcpCode),
  "MCP 连接器把令牌放 encryptedSecrets + 声明 envHttpHeaders（引擎侧经环境变量注入）",
);
ok(
  !/config\.toml|configToml/.test(mcpCode),
  "MCP 连接器写入**不碰** config.toml（令牌绝不落引擎配置）",
);

/* ── ⑦⛔ 记忆无 MCP 端点时不伪造连接器 ────────────────────────────────── */
const memoryCode = codeOnly(memory);
ok(
  /rest-only/.test(memoryCode) && /mcpUrl/.test(memoryCode),
  "记忆域：无 mcpUrl 时如实回报 rest-only（服务端将来补上即自动切换）",
);
ok(
  /syncCloudMcpConnector\(null, CLOUD_MEMORY_CONNECTOR_ID\)/.test(memoryCode),
  "记忆域：走不到 MCP 分支时**停用**连接器（⛔ 不伪造一个连不上的端点）",
);

/* ── ⑧ 登录不是配对：走账号密码 ──────────────────────────────────────── */
ok(/\/login/.test(apiCode) && !/pair-ticket/.test(apiCode), "登录走账号密码（/login），⛔ 不走配对票据（配对是给无登录会话的壳用的）");

/* ── ⑨ 保持更新：轮询只在已登录时打网络 ──────────────────────────────── */
const modelsCode = codeOnly(read("electron/features/cloud-models-ipc.ts"));
ok(/setInterval/.test(modelsCode) && /loggedIn/.test(modelsCode), "模型同步有定时轮询，且只在已登录时打网络（未登录直接跳过）");
ok(/HARNESS_CLOUD_SYNC_MINUTES/.test(modelsCode), "轮询间隔可配（HARNESS_CLOUD_SYNC_MINUTES）");

/* ── ⑩ 渲染层：设置页三件套（注册表 / 导航 / 帮助总览）+ 页面自包含 ──────
   ⛔ 这三处必须同轮改齐：漏注册表 ⇒【101】红；漏帮助总览 ⇒【32】红；
     漏导航 ⇒ 用户根本进不去那一页（守卫查不到，但功能等于没做）。 */
const registrySrc = read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx");
const navSrc = read("src/features/app-view/helpers/catalogs.ts");
const helpSrc = read("src/components/HelpDialog.tsx");
const typesSrc = read("src/features/app-view/types.ts");
const pageSrc = read("src/features/settings-cloud/CloudAccountSection.tsx");
ok(/cloud:\s*\{\s*render:/.test(registrySrc), "设置注册表有 cloud 页的 render 条目（缺了【101】会红）");
ok(/\["cloud",\s*"云账号"/.test(navSrc), '设置导航含 ["cloud", "云账号"]（否则用户进不去这一页）');
ok(/page:\s*"云账号"/.test(helpSrc), "帮助总览含「云账号」（缺了【32】会红）");
ok(/"cloud"/.test(typesSrc) && /SettingsPage/.test(typesSrc), 'SettingsPage 类型含 "cloud"');
ok(
  /export function CloudAccountSection\(\)/.test(pageSrc),
  "设置页组件**自包含**（无 props —— 不吃 app 状态、不动 bag，板块之间保持独立）",
);
ok(
  /cloudAuthStatus/.test(pageSrc) && /unsupported/.test(pageSrc),
  "设置页对老构建（无 cloud-* 通道）有降级提示（⛔ 不是白屏）",
);
ok(
  /__refreshProviders/.test(pageSrc),
  "同步后刷新渲染层供应商状态（不刷新 ⇒ 同步成功了但下拉框还是空的）",
);

/* ── ⑪ 首启登录页也有「云账号」入口（用户 10-16 实测「我还没看见登录界面」）──
   ⛔ 只做设置页不够：**首启看到的是 LoginScreen**，那里没有入口 = 新用户根本发现不了这套能力。 */
const loginSrc = read("src/features/auth/LoginScreen.tsx");
ok(
  /mode === "cloud"/.test(loginSrc) && /"openai" \| "cloud"/.test(loginSrc),
  '首启登录页有 cloud 模式（mode 联合类型含 "cloud"）',
);
ok(
  /login-option-title">云账号</.test(loginSrc),
  "首启登录页有「云账号」选项卡（缺了 ⇒ 新用户看不到这套能力）",
);
ok(
  /cloudAuthLogin/.test(loginSrc) && /cloudModelsSync/.test(loginSrc),
  "首启登录页的云账号走真通道（cloudAuthLogin + cloudModelsSync）",
);
ok(
  /provider: "cloud", name: "云端模型"/.test(loginSrc),
  "登录后把供应商落成 id=cloud / 名=云端模型（与主进程 cloud-provider 的口径一致）",
);

/* ── ⑫⛔⛔ 10-16 用户实测两条：供应商「测试」永远 401 / 加完供应商引擎配置没跟上 ──
   ① 设置页的模型「测试」用的是**编辑器草稿**的 apiKey，而草稿里那把永远是空串
      （界面写"已安全保存，留空则不修改"）⇒ 探测请求不带 Authorization ⇒ 一律 401。
      自动生成的供应商（云端模型）用户更没法手填 ⇒ 永远测不通。修法 = 空串时回落已保存的 Key。
   ② 供应商行加进了 custom-models.json，但 config.toml 没重生成 ⇒ 缺 `[model_providers.cloud]` 段。
      ⛔ 后果不只是"用不了"：旧线程 rollout 里记着创建时的 model_provider，缺段 ⇒ resume 报
      "Model provider not found"（会话内容全空）。所以档案一变就必须重生成。 */
const probeIpcSrc = codeOnly(read("electron/features/custom-model-ipc.ts"));
ok(
  /withSavedKey/.test(probeIpcSrc) && /encryptedKey/.test(probeIpcSrc),
  "custom-model:probe 在 apiKey 为空时**回落到已保存的 Key**（否则设置页的「测试」对自动生成的供应商永远 401）",
);
ok(
  /refreshEngineProviders/.test(providerCode),
  "云供应商档案变更后重生成引擎配置（缺 [model_providers.cloud] 段 ⇒ 旧会话 resume 报 Model provider not found）",
);
ok(
  /export async function activateCloudProvider/.test(providerCode) && /restart: true/.test(providerCode),
  "有「设为当前生效」的显式入口（activateCloudProvider，restart:true）—— ⛔ 自动同步不抢生效位，只有它抢",
);

/* ── ⑬ 用户中心入口 + 输入框积分徽标（10-16 用户令）────────────────── */
const linksSrc = read("src/lib/cloud-links.mjs");
ok(
  /export function cloudUserCenterUrl/.test(linksSrc) && !/ppz123\.asia/.test(linksSrc),
  "用户中心 URL 由账号基址**派生**（⛔ 不写死域名 —— 自建部署换基址时接口与链接必须一起动）",
);
ok(
  /openUserCenter|云端用户中心/.test(pageSrc),
  "云账号设置页有「云端用户中心」入口（未登录分支也要有 —— 那是注册入口）",
);
const composerSrc = codeOnly(read("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"));
const iRelay = composerSrc.indexOf("<RelayBalanceBadge");
const iCloud = composerSrc.indexOf("<CloudPointsBadge");
const iCtx = composerSrc.indexOf("<ContextUsageBadge");
ok(
  iCloud >= 0 && iRelay >= 0 && iCtx >= 0 && iCloud > iRelay && iCloud < iCtx,
  "积分徽标在**上下文环左边**、与中转站徽标同排（用户令：跟中转站/GPT 账号图标同位置）",
);
ok(
  /未登录|points \? null|r\.ok \? r : null/.test(codeOnly(read("src/features/settings-cloud/CloudPointsBadge.tsx"))),
  "积分徽标未登录时不占位（返回 null，不显示「0 积分」）",
);
ok(
  /from "\.\.\/\.\.\/\.\.\/\.\.\/settings-cloud"/.test(read("src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx")),
  "跨板块只经对方 barrel（⛔ 不深链 settings-cloud 内部文件）",
);
ok(
  existsSync(join(ROOT, "src/lib/cloud-links.d.mts")),
  "src/lib/cloud-links.mjs 有配套 .d.mts 声明（缺了 tsc 报 TS7016）",
);

/* ── ⑭ 推理上游的「单一决策点」+ 记忆增强上游（10-16）──────────────────
   ⛔ 这两条是成对的：`cloud-models` 每 10 分钟同步一次上游地址，若记忆域也自己写一份，
      必然互相覆盖（症状：开了记忆、过十分钟自己变回不带记忆）。所以落盘只许经 cloud-provider。 */
const memDomainSrc = codeOnly(read("electron/features/cloud-memory-ipc.ts"));
ok(
  /readMemoryUpstream/.test(providerCode) && /resolveUpstream/.test(providerCode) && /effective\.baseUrl/.test(providerCode),
  "云供应商行的 baseUrl/key 由 cloud-provider 的 resolveUpstream() 合成（⛔ 别让两个写入者各写一份）",
);
ok(
  /setMemoryUpstream/.test(memDomainSrc) && /resyncCloudUpstream/.test(memDomainSrc),
  "记忆域只「记意图」+ 触发重算（setMemoryUpstream → resyncCloudUpstream），不自己写 baseUrl",
);
ok(
  !/stdio/.test(memDomainSrc),
  "记忆域不再声称需要 stdio 适配器（10-16 实测：memapi 无记忆读写路由，记忆是在对话层注入的）",
);
ok(
  /setMemoryUpstream\(null\)/.test(memDomainSrc),
  "记忆未开通/被停用时要**清掉**上游意图并切回纯模型地址（⛔ 否则停用后对话仍走记忆端点）",
);

/* ── ⑮ 本地「积分估算」显示面（10-18 用户令：本地也做到与服务端同口径）────────
   ⛔ 这组钉的是**接线**，不是数值（数值判据在 .workbuddy/tmp/test-credit-estimate.mjs，
      含"服务端源码里那条公式还在不在"的跨仓同口径钉子）。
   ⛔⛔ 最危险的失效是**静默的**：估算模块写好了但没接到回合完成事件上 ⇒ 页脚永远不显示，
      守卫若只查"文件存在"就完全看不出来。所以这里必须查到**调用点**与**读取点**。 */
const estimateSrc = read("src/lib/credit-estimate.mjs");
ok(existsSync(join(ROOT, "src/lib/credit-estimate.d.mts")), "src/lib/credit-estimate.mjs 有配套 .d.mts 声明（缺了 tsc 报 TS7016）");
ok(
  /Math\.round\(\(tokens \/ 1000\) \* rate \* factor \* 100\) \/ 100/.test(estimateSrc),
  "估算公式与服务端逐字符同形：(tokens / 1000) * rate * factor 保留两位（⛔ 差一点就会出现「页脚说 0.4、账本扣 0.8」）",
);
ok(
  /tokens <= 0\) return null/.test(estimateSrc),
  "没有 token 时如实返回 null（⛔ 不许返回 0 —— 那会显示「0 积分」，看着像免费）",
);
const storeSrc = read("src/lib/cloud-credit-store.ts");
ok(
  /* ⛔ 锚**代码形态**而不是裸路径/裸方法名 —— 上面 store 的注释里就写着 `/api/cloud-models`
     与 `cloudModelsCatalog`，用裸串判定会被注释顶成假绿（实测：删掉整条 HTTP 回落仍全绿）。 */
  /if \(api && api\.cloudModelsCatalog\) return api\.cloudModelsCatalog\(\)/.test(storeSrc)
  && /fetch\("\/api\/cloud-models"/.test(storeSrc),
  "积分 store 的倍率来源是云端目录（桌面/PPcode 走 IPC `cloud-models:catalog`，云助手走同源 HTTP `/api/cloud-models` —— ⛔ 两条路回执同形，只解析一次，不做二套字段映射）",
);
ok(
  /\{ models: new Map\(\), offPeak: null \}/.test(storeSrc) && /snap\.models\.has\(name\)/.test(storeSrc),
  "拿不到目录就返回空目录、且不记任何回合（⛔ 不猜倍率、不写死 0 —— 页脚据此不占位）",
);
const turnDoneSrc = read("src/features/app-state/parts/part05/event-router/05-turn-completed-notify.tsx");
ok(
  /recordTurnCredit\(turnId, creditModel, inputTokens, outputTokens\)/.test(turnDoneSrc),
  "回合完成事件里**真的调了** recordTurnCredit（只建模块不接线 ⇒ 页脚永远不显示，且不报任何错）",
);
ok(
  /modelName\(loadThreadModel\(threadId\)\)[^\n]*\|\|[^\n]*bag\.activeModelRef\.current/.test(turnDoneSrc),
  "积分归属照本仓既有口径（会话自己记的模型优先，没记过才回落到当前选择）——⛔ 直接读 activeModelRef 会把「切了全局模型、本会话跑自己的模型」算错倍率",
);
const footerSrc = read("src/features/shared/MessageFooter.tsx");
ok(
  /useTurnCredit\(turn\?\.id\)/.test(footerSrc) && /\(turnCredit\.free \|\| turnCredit\.factor === 0\) \? "免费"/.test(footerSrc),
  "消息页脚按 turn.id 读本轮估算，且「倍率 0」与「闲时系数 0」都显示「免费」而不是「≈ 0 积分」",
);
ok(
  /* ⛔ 锚「点 ×<系数>」这个**显示形态**：tooltip 一旦在这里写回窗口默认系数，就会在
     "每模型单独配置"时给出错的折扣数字（窗口 0.5、该模型 0.8 ⇒ 用户看到 ×0.5、实际扣 0.8）。
     负向只挡"点 ×窗口系数"这一形态 —— 后面那句「全局默认 ×0.5」是**正确**的补充信息，
     ⛔ 不能一起挡掉（第一版写成裸 `×${rec.window.rate}` 就误伤了自己）。 */
  /点 ×\$\{rec\.factor\}/.test(footerSrc) && !/点 ×\$\{rec\.window\.rate\}/.test(footerSrc),
  "积分 tooltip 的折扣系数用**实际生效的** rec.factor（⛔ 不许在「点 ×」处写窗口默认系数）",
);
ok(
  /creditNode \? \[creditNode\] : \[\]/.test(footerSrc),
  "页脚积分节点由估算结果**决定要不要占位**（拿不到估算就不显示，不摆一个空位）",
);
const badgeSrc = read("src/features/settings-cloud/CloudPointsBadge.tsx");
ok(
  /currentOffPeakWindow\(offPeak\)/.test(badgeSrc),
  "积分徽标现算「当前命中哪个闲时窗口」（⛔ 不能只信目录里的 active 快照 —— 那是拉目录那一刻算的，可以差 5 分钟）",
);
/* ⛔ 这里必须**数次数**：`warmCloudCreditCatalog()` 在徽标里出现两次（进入时一次 + 轮询各一次）。
   只断言"出现过"的话，删掉"进入时"那一次仍能通过 —— 而那正是最要紧的一次（否则首屏要等 5 分钟）。 */
ok(
  (badgeSrc.match(/warmCloudCreditCatalog\(\)/g) || []).length >= 2,
  `积分徽标预热目录：进入时一次 + 每次轮询一次（实测 ${(badgeSrc.match(/warmCloudCreditCatalog\(\)/g) || []).length} 次；⛔ 只剩轮询那次 ⇒ 徽标一直停在「未启用」直到用户发出第一回合）`,
);
ok(
  /enabled !== true\) return \{ text: "闲时倍率：未启用/.test(badgeSrc) && /if \(!offPeak\) return null/.test(badgeSrc),
  "目录没拿到时整行不出现（⛔ 不许显示「未启用」—— 那是在说谎）",
);
const catalogEntry = (manifest.channels || []).find((c) => c.channel === "cloud-models:catalog") || {};
ok(
  /offPeak\?:/.test(String(catalogEntry.returns || "")) && /tzOffsetMinutes\?:/.test(String(catalogEntry.returns || "")),
  "manifest 里 cloud-models:catalog 的返回类型声明了 offPeak/tzOffsetMinutes（⛔ 生成区手改会被覆盖，必须改 manifest 再跑 npm run gen:ipc）",
);

console.log(`\n【cloud-account】${checks - fails}/${checks} 通过`);
if (fails > 0) process.exit(1);
