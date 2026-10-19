/**
 * 云端令牌自愈 / 轮换检测 / 账号归一 的判据（10-19，复检清单 1/2/4/5/6）。
 *
 * 事故：用户订阅云端知识库 + 记忆后，模型探活 401；点「重签密钥并同步」也没用。
 * 现场三件事：① 重签落在**另一个大小写不同的账号**上；② 本机行里的 key 是旧串（令牌环只留 3 枚）；
 * ③ 开了云端记忆时真正上游是 memapi + 记忆 userKey，只换代理令牌不影响它。
 *
 * 本守卫只钉**客户端结构**（服务端行为在 `cloud/server-account/server.js`，由部署后的 /models 回执实测）：
 *   ① 401/403 探活必须自愈一次并重试；
 *   ② 非强制同步不能盲信 `hasProxyToken`（要么比前缀，要么远程校验）；
 *   ③ 自愈 = 强制重签 + 写回行 + 刷新记忆上游；
 *   ④ 令牌校验遇网络异常按“有效”处理（不能因断网重签）；
 *   ⑤ 状态面暴露账号 + 令牌前缀，界面能显示；
 *   ⑥ 云端模型连通测试：探行里的合成上游 / 401 自动重签重探 / 成功保存重启 / 失败重签重试。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【cloud-heal】${message}`);
  if (!condition) fails++;
};

const probeIpc = codeOnly(read("electron/features/custom-model-ipc.ts"));
const modelsIpc = codeOnly(read("electron/features/cloud-models-ipc.ts"));
const heal = codeOnly(read("electron/cloud-heal.ts"));
const token = codeOnly(read("electron/cloud-token.ts"));
const provider = codeOnly(read("electron/cloud-provider.ts"));
const ui = codeOnly(read("src/features/settings-cloud/CloudAccountSection.tsx"));
const dialog = codeOnly(read("src/features/settings-cloud/ResultDialog.tsx"));
const manifest = read("electron/ipc-channels.manifest.json");
/* 生成物也按原文断言（正向）：codeOnly 会把含 `/**` 的注释字符串当块注释起点，可能吃掉整段。 */
const preload = read("electron/preload.ts");
/* ⛔ ipc-registry 的 note 字符串里含 `/**` 片段（不是注释）⇒ 过 codeOnly 会把它当块注释起点，
   一口气吃掉后半份注册表（云端条目恰好在被吃掉的那段里）。这里只做正向断言，用原文。 */
const registry = read("electron/ipc-registry.ts");

/* ① 探活 401/403 自愈 */
ok(/healCloudAccess\(\)/.test(probeIpc) && /认证失败（HTTP \(401\|403\)）/.test(probeIpc) && /probeCustomModel\(await withSavedKey\(input\)\)/.test(probeIpc),
  "探活遇 401/403：云端供应商自动 `healCloudAccess()` 后**重试一次**（且只对 cloud 生效）");
ok(/first\.provider \?\? ""\) !== CLOUD_PROVIDER_ID/.test(probeIpc), "自愈只对云端供应商触发（别的供应商 401 就是 key 错，不该被静默换掉）");

/* ② 非强制同步必须校验 */
ok(/verifyProxyToken\(cachedToken\)/.test(modelsIpc) && /proxyTokenPrefix/.test(modelsIpc),
  "非强制同步：先比服务端令牌前缀，再远程校验本机缓存（不再盲信 hasProxyToken）");
ok(!/const needToken = force \|\| !catalog\.data\.provider\?\.hasProxyToken;/.test(modelsIpc),
  "⛔ 负向：不许退回「只要服务端说有令牌就复用本机缓存」");

/* ③ 自愈三件事 */
ok(/issueProxyToken\(true\)/.test(heal) && /updateCloudProviderKey\(encrypted\)/.test(heal) && /refreshMemoryUpstreamFromIntegrations\(\)/.test(heal),
  "自愈 = 强制重签 + 写回供应商行 + 刷新记忆上游（重签时记忆 userKey 一起换）");
ok(/if \(inFlight\) return inFlight;/.test(heal), "并发去重：探活与定时同步同时触发只签一次（不把别的设备挤出令牌环）");

/* ④ 校验的失败语义 */
ok(/return res\.status !== 401 && res\.status !== 403;/.test(token) && /catch \{\s*return true;\s*\}/.test(token),
  "令牌校验：401/403 = 无效；网络异常按有效处理（临时断网不重签）");

/* ⑤ 状态面 + 界面 */
ok(/account: state\.active\?\.username \?\? ""/.test(modelsIpc) && /tokenPrefix: readProxyToken\(\)\.slice\(0, 12\)/.test(modelsIpc),
  "cloud-models:status 暴露 account + tokenPrefix");
ok(/models\?\.tokenPrefix/.test(ui) && /模型令牌/.test(ui), "云账号卡显示「模型令牌 前缀… + 账号」");

/* ⑥ 记忆上游刷新点存在 */
ok(/export async function refreshMemoryUpstreamFromIntegrations/.test(provider) && /setMemoryUpstream\(null\)/.test(provider),
  "记忆上游刷新：未开通/停用时清掉记忆意图（回落纯模型）");

/* ⑦ 云端模型连通测试（10-19）：按钮 → 通道 → 探活 → 401 自愈 → 保存重启 / 重签重试 */
ok(/"name": "cloudModelsTest"/.test(manifest) && /"channel": "cloud-models:test"/.test(manifest),
  "manifest 登记 cloud-models:test（单一真相源）");
ok(/cloudModelsTest: \(input\?: \{ forceHeal\?: boolean \}\)/.test(preload) && /"cloud-models:test"/.test(preload),
  "生成物暴露 cloudModelsTest（forceHeal 可选，minArgs 0）");
ok(/ipcHost\.handle\("cloud-models:test"/.test(modelsIpc) && /forceHeal/.test(modelsIpc) && /export type CloudTestReply/.test(modelsIpc),
  "cloud-models:test 通道 + 结构化回执（forceHeal = 界面「重签密钥并重试」）");
ok(/probeCustomModel\(\{ provider: CLOUD_PROVIDER_ID, baseUrl: current\.baseUrl, apiKey: key, model, wireApi: "responses" \}\)/.test(modelsIpc),
  "探的是云供应商**行里的合成上游**（记忆开启时 = memapi + 记忆 userKey，不是纯模型通道 ⇒ 不会假绿）");
ok(/认证失败（HTTP \(401\|403\)）/.test(modelsIpc) && /healCloudAccess\(\)/.test(modelsIpc) && /code: "still-failing"/.test(modelsIpc),
  "401/403 自动重签一次并重探；仍失败如实回报（不连环重签、不把别的设备挤出令牌环）");
ok(/if \(await readMemoryUpstream\(\)\) return false;/.test(provider),
  "记忆上游开启时，代理令牌不得覆盖行里的记忆 userKey（防「memapi 地址 + 代理令牌」的必 401 组合）");
ok(/doTestModels/.test(ui) && /cloudModelsTest/.test(ui)
  && /label: "保存并重启应用", primary: true, onClick: doSaveRestart/.test(ui)
  && /label: "重签密钥并重试", primary: true, onClick: \(\) => \{ void doTestModels\(true\); \}/.test(ui)
  && /relaunchApp\(\)/.test(ui),
  "界面闭环：连通测试 → 成功「保存并重启应用」/ 失败「重签密钥并重试」（断言锚动作接线，不认提示文案）");
ok(/actions\?: ResultAction\[\]/.test(dialog) && /onClick=\{\(\) => \{ onClose\(\); void action\.onClick\(\); \}\}/.test(dialog),
  "ResultDialog 支持动作按钮（先关窗再执行，不叠两层弹窗）");
ok(/cloud-models:test/.test(registry) && /count: 7/.test(registry), "ipc-registry 登记第 7 条通道（数与通道面一致）");

console.log(`\n【cloud-heal】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
