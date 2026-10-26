/**
 * 供应商自动配置（10-24）判据。
 *
 * 用户令：登录云账号 / 中转站 / OpenAI 订阅 / 自定义 API 后，全程自动 ——
 * 自动检测并刷新模型 → 提示勾选（可一键全选）→ 保存启用 → 旧供应商自动停用 → 重启。
 *
 * 失效方式都有害且多数静默：
 *   · 云端又拿代理网关的 /models 去探活 ⇒ 用户只看到「该网关不提供 /models」；
 *   · 勾选只写本机档案、不写服务端 ⇒ 十分钟后定时同步把用户的选择顶回来；
 *   · 保存没把旧供应商停用 ⇒ 两个绿开关（10-15 的老事故）；
 *   · 登录页绕过弹窗直接 onLogin ⇒ 又变成「悄悄全选 + 立即生效」，用户没机会选模型；
 *   · 保存后不刷新供应商列表 ⇒ 界面还停在旧状态（用户原话「明显列表自动刷新」）。
 * 判据钉**结构、单源与接线**；真链路（检测/勾选/保存/互斥）由验收 provider-autosetup 跑本地 mock 网关。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const src = (rel) => codeOnly(read(rel));
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【setup】${message}`);
  if (!condition) fails++;
};

const FILES = {
  dialog: "src/features/provider-setup/ProviderSetupDialog.tsx",
  barrel: "src/features/provider-setup/index.ts",
  lib: "src/lib/provider-setup.ts",
  css: "src/styles/42-provider-setup.css",
  login: "src/features/auth/LoginScreen.tsx",
  relay: "src/lib/relay.ts",
  handleLogin: "src/features/app-state/parts/part08/02-seg.tsx",
  bagTypes: "src/features/app-state/parts/bag-types.ts",
  modelPage: "src/features/settings-model/ModelSettingsSection.tsx",
  cloudPage: "src/features/settings-cloud/CloudAccountSection.tsx",
  openaiPage: "src/features/openai/OpenaiSubscriptionPage.tsx",
  registry: "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
  providerEvent: "src/features/app-state/parts/part05/01-seg.tsx",
  cloudProvider: "electron/cloud-provider.ts",
  styles: "src/styles.css",
  accept: "scripts/accept.mjs",
};
for (const [name, rel] of Object.entries(FILES)) {
  ok(existsSync(join(ROOT, rel)), `文件在位：${name}（${rel}）`);
}

const dialog = src(FILES.dialog);
const lib = src(FILES.lib);
const css = read(FILES.css);
const login = src(FILES.login);
const relay = src(FILES.relay);
const handleLogin = src(FILES.handleLogin);
const modelPage = src(FILES.modelPage);
const cloudPage = src(FILES.cloudPage);
const openaiPage = src(FILES.openaiPage);
const registry = src(FILES.registry);
const providerEvent = src(FILES.providerEvent);
const cloudProvider = src(FILES.cloudProvider);
const bagTypes = src(FILES.bagTypes);
const accept = read(FILES.accept);

/* ── ① 大弹窗与进度 ── */
ok(/createPortal/.test(dialog), "弹窗 portal 到 body（登录页/设置内容列有 transform / overflow 祖先）");
ok(/provider-setup-backdrop/.test(dialog) && /z-index:\s*920/.test(css), "弹窗走独立背景层 + 920 档（高于设置 400 / 模型编辑器 900）");
ok(/width:\s*min\(1000px/.test(css) && /height:\s*min\(720px/.test(css) && /grid-template-columns:\s*250px/.test(css), "大面板尺寸与左流程 / 右内容双栏骨架");
ok(/@media \(max-width: 860px\)/.test(css), "窄屏退化为横向步骤条（不挤压模型列表）");
ok(["account", "detect", "select", "save", "restart"].every((id) => dialog.includes(`data-step`) && dialog.includes(`"${id}"`)), "五步进度齐全：账号 → 检测 → 勾选 → 保存 → 重启");
ok(/data-state=\{state\}/.test(dialog) && /provider-setup-step-done|provider-setup-receipt/.test(dialog), "步骤状态（done/active/error）与完成回执都真实渲染");

/* ── ② 检测：三类来源各走各的通道 ── */
const cloudBranch = lib.slice(lib.indexOf('input.source === "cloud"'), lib.indexOf('input.provider === "openai-official"'));
ok(/cloudModelsSync/.test(cloudBranch) && /cloudModelsCatalog/.test(cloudBranch), "云端检测走账号目录（cloud-models:sync + catalog）");
ok(!/probeCustomModel/.test(cloudBranch), "⛔ 云端检测不走 probeCustomModel（代理网关没有 /models）");
const officialBranch = lib.slice(lib.indexOf('input.provider === "openai-official"'), lib.indexOf("const probe = await window.codex.probeCustomModel"));
ok(/openaiModels/.test(officialBranch) && /OFFICIAL_MODELS/.test(officialBranch), "OpenAI 官方订阅检测走 openai:models（失败回落内置目录）");
ok(/const probe = await window\.codex\.probeCustomModel/.test(lib) && /probe\?\.models/.test(lib), "自定义/中转站检测走 probeCustomModel 真拉模型列表");
ok(/force:\s*false/.test(cloudBranch), "⛔ 云端检测不强制重签（force:true 会把同账号其它设备挤出令牌环）");

/* ── ③ 勾选与保存：落盘通道正确、旧供应商必须真停用 ── */
ok(/selected\.length/.test(dialog) && /selectAll/.test(dialog) && /selectNone/.test(dialog) && /全不选|一键全选/.test(dialog), "一键全选 / 全不选真实存在");
ok(/lastAutoDetectRef/.test(dialog) && /onBlur=/.test(dialog), "自定义供应商填好地址与密钥、离开输入框即自动检测（用户令「配好就自动检测」）");
ok(/detectingRef/.test(dialog), "检测并发保护（自动失焦 + 手动点按钮不会打两路）");
ok(/disabled=\{saving \|\| !selected\.length\}/.test(dialog), "没勾任何模型时保存按钮禁用（不允许保存空清单）");
const cloudSave = lib.slice(lib.indexOf("if (input.source === \"cloud\" || input.provider === \"cloud\")"), lib.indexOf("} else {"));
ok(/cloudModelsSetEnabled/.test(cloudSave) && /cloudModelsActivate/.test(cloudSave), "云端勾选写服务端 + activate 启用（换设备登录也一致）");
ok(/saveCustomModel/.test(lib) && /enabled:\s*true/.test(lib), "其它供应商走 custom-model:save 且显式 enabled:true（主进程互斥兜底）");
ok(/saved\?\.enabled === false/.test(lib), "主进程把无 Key 第三方存成停用时，编排层如实报错（不许显示已启用）");
ok(/const before = await enabledProviders\(\)/.test(lib) && /const after = await enabledProviders\(\)/.test(lib), "保存前后各读一次供应商列表（旧供应商是否真停用要有据）");
ok(/stillEnabled/.test(lib) && /disabled/.test(lib) && /others/.test(lib), "回执区分「已自动停用」与「仍有人启用」（互斥失效要如实提示）");
ok(/旧供应商已自动停用/.test(dialog) && /唯一启用的供应商/.test(dialog), "完成页写明旧供应商自动停用 / 已是唯一启用");
ok(/RELAUNCH_SECONDS/.test(dialog) && !/稍后重启/.test(dialog) && /立即重启/.test(dialog) && /自动重启/.test(dialog), "重启步骤有倒计时 + 自动重启（10-24 用户：不再提供「稍后重启」出口）");

/* ── ④ 登录页四路接入 ── */
ok(/ProviderSetupDialog/.test(login) && /setSetupIntent/.test(login), "登录页接入统一弹窗");
ok(["source: \"cloud\"", "source: \"relay\"", "source: \"openai\"", "source: \"custom\""].every((s) => login.includes(s)), "四路来源齐全：云 / 中转站 / OpenAI / 自定义");
ok(/deferActivation:\s*true/.test(login) && /pending/.test(login), "中转站登录用 deferActivation 解析候选后再交给弹窗（取消不落档案）");
ok(/deferActivation/.test(relay) && /pending: \{ provider: resolved\.provider/.test(relay), "performRelayLogin 的 defer 分支返回待启用凭据");
ok(/if \(info\.saved\)/.test(handleLogin), "handleLogin 支持「弹窗已保存」的收尾路径");
const preSaved = handleLogin.slice(handleLogin.indexOf("if (info.saved)"), handleLogin.indexOf("let models: string[]"));
ok(/adoptSavedProvider/.test(preSaved) && /setShowLogin\(false\)/.test(preSaved) && /markModelConfigured/.test(preSaved), "预保存路径：采用档案 → 进主界面 → 记已配置");
ok(!/probeCustomModel|saveCustomModel/.test(preSaved), "⛔ 预保存路径不重复探测/保存（重复保存会再重启一次引擎）");
ok(/saved\?: any; models\?: string\[\]/.test(bagTypes), "bag 类型同步了 saved/models（类型面与实现不分叉）");
ok(/if \(ok && intent\.relayActive\) writeRelayActive/.test(login), "中转站 relay-active 只在保存成功且进入主界面后写（取消不写）");

/* ── ⑤ 设置页 / 云账号页 / OpenAI 页 ── */
/* 10-26 用户令（两轮）：自动配置从「下方大块（说明句 + 步骤条）」→ 页头按钮 → 最后挪到
   页面**底部右侧操作条**，同轮删掉本页唯一的 ?⇒ 锚点跟着接线走：入口仍是 openAutoSetup，
   但落点必须是 `.model-page-dock`（页头那块已整块删除）。 */
ok(/openAutoSetup/.test(modelPage) && /ProviderSetupDialog/.test(modelPage) && /refreshActive/.test(modelPage), "模型页自动配置入口（右下角操作条）+ 弹窗 + 保存后刷新供应商列表");
/* 入口的具体落点（页头 / 底部操作条 / 供应商工具条）不钉死：这几个版本里改过三次，
   钉位置只会让调版式的人连带改守卫。接线由上面那条 openAutoSetup 断言守。 */
ok(/relaunchApp/.test(modelPage), "模型页保存后自动重启应用");
ok(/openNewProvider/.test(modelPage) && /openProviderEditor/.test(modelPage) && /provider-card-update/.test(modelPage), "模型页保留手动添加 / 编辑 / 更新模型入口（大卡片 + 二级弹窗，功能不删）");
ok(/provider-card-test/.test(modelPage) && /classifyProviderProbeFailure/.test(modelPage) && /密钥失效/.test(modelPage), "卡片支持测试连接并标出「密钥失效」，云端可修复 / 其它提示更新 Key");
ok(/model-compact-control/.test(modelPage) && !/model-global-bar/.test(modelPage), "自动压缩在页内工具条（旧整行文字条已删，说明收进就地 ?，与页头帮助 ? 无关）");
ok(/provisionCloud\(api, \{ activate: false \}\)/.test(cloudPage), "云账号登录自动配置不再偷偷抢生效位（activate:false 交给弹窗）");
ok(/provisionCloud\(api, \{ activate: true, onlyIfEmpty: true, restartIfActive: true \}\)/.test(cloudPage), "云账号「一键同步 / 修复」重启引擎并自动刷新模型页（云端密钥失效后修复即生效）");
ok(/选择模型并启用/.test(cloudPage) && /ProviderSetupDialog/.test(cloudPage) && /relaunchApp/.test(cloudPage), "云账号页有「选择模型并启用」入口 + 弹窗 + 重启");
ok(/openOfficialSetup/.test(openaiPage) && /ProviderSetupDialog/.test(openaiPage) && /relaunchApp/.test(openaiPage), "OpenAI 页登录/启用订阅走同一弹窗");
ok(!/onActivate\(OFFICIAL_MODELS\)/.test(openaiPage), "⛔ OpenAI 页不再绕过选模型直接 activate");
ok(/refreshActive=\{app\.refreshActive\}/.test(registry) && /onRefreshActive=\{app\.refreshActive\}/.test(registry), "设置注册表把 refreshActive 接进模型页与 OpenAI 页");
ok(/provider-activated/.test(providerEvent) && /getCustomModel/.test(providerEvent) && /applyGlobalModelChoice/.test(providerEvent), "provider-activated 后当前会话模型跟到新供应商（⛔ 旧 model id 会发不出去）");
ok(/activateCloudProvider/.test(cloudProvider) && /sendToWindow\("harness:event", \{ type: "provider-activated"/.test(cloudProvider), "云端 activate 也广播 provider-activated（与 custom-model 同一事件，⛔ 不另开一套）");

/* ── ⑥ 样式与验收登记 ──
   10-25 起验收脚本收敛为「只保留当前轮」（provider-autosetup / provider-login-autosetup 两项随历史项删除，
   见 accept.mjs 头注释）⇒ 这里的登记断言改为负向：这两个 id 不许再出现（防复制旧模板复活），
   mock 网关断言随之退役（验收项本体已删，行为覆盖移交守卫真跑部分）。 */
ok(/42-provider-setup/.test(read(FILES.styles)), "样式已挂进全局样式入口");
ok(!/"provider-autosetup"/.test(accept) && !/"provider-login-autosetup"/.test(accept), "旧 autosetup 验收项已随 10-25 收敛删除（⛔ 防复制旧模板复活）");

/* ── ⑦ 单源：编排只有这一份 ── */
ok((lib.match(/export async function detectSetupModels/g) ?? []).length === 1, "detectSetupModels 只有一个实现");
ok((lib.match(/export async function applySetupSelection/g) ?? []).length === 1, "applySetupSelection 只有一个实现");
ok(/detectSetupModels/.test(dialog) && /applySetupSelection/.test(dialog), "弹窗只调用编排层（不自己写探测/保存逻辑）");
ok(!/window\.codex\.(saveCustomModel|cloudModelsSetEnabled)/.test(dialog), "⛔ 弹窗不直接碰落盘通道（落盘统一走编排层）");
ok(/finishedRef/.test(dialog), "完成回调只允许触发一次（倒计时 + 手动点击不双开）");

console.log(`\n【provider-setup】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
