/**
 * custom-model-apply（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：applyCustomModel
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { readAppSettings } from "../app-settings";
import { app, safeStorage } from "electron";
import { shouldRegisterNuphus, withNuphusMasksForRules } from "../automation-policy";
import { safeProviderId } from "../provider-id";
import { injectMcpToolRules, injectSectionExtras, tomlBareKey } from "../config-toml";
import { developerInstructionsLine } from "../developer-instructions";
import { augmentedPath, bundledPython, nuphusBinary } from "../toolchain";
import { NUPHUS_VISION_ENV_TABLE, nuphusVisionEnv } from "../nuphus-env";
import type { CustomModelFile } from "../features/custom-model-types";
import { collectSessionProviderIds } from "../features/provider-sessions";
import { connectorEnv, connectorToml, mcpToolRulesOf } from "../main/04-connector-config";
import { devInstructionsInput } from "../main/12-skill-discipline";
import { dispatchHttpPort, dispatchToken } from "../features/dispatch-core";
import { ensureDispatchHttp } from "../features/dispatch-rpc";
import { escapeToml, readConnectors } from "../main/07-connectors-io";
import { mcpOverrideEnabled, readMcpOverrides } from "../main/06-mcp-overrides";
import { normalizeProvider, readCustomModels, readUserConfigSplit, writeModelCatalogToml } from "../main/01-model-catalog";
import { safeConnectorId } from "../main/07-connectors-io";
import { writeMcpOverrides } from "../main/06-mcp-overrides";
import { codexHome, server, upsertCustomModel } from "../runtime-refs";
import { bridgeDial } from "../main";
import { resolveLiveProxy } from "./openai-auth";
export async function applyCustomModel(entry: CustomModelFile, opts?: { restart?: boolean }) {
  const connectors = await readConnectors();
  const mcpOverrides = await readMcpOverrides();
  const appSettings = await readAppSettings(app.getPath("userData"));
  // developer_instructions 的组装输入与下面的「写出」同源（见 devInstructionsInput 上方说明）；
  // 两个自动化开关也从这里取，避免同一组开关在两处各算一遍而漂移。
  const devInput = await devInstructionsInput();
  const desktopAuto = devInput.desktop;
  const browserAuto = devInput.browser;
  // 内置 nuphus 与所有连接器都由 harness 重新生成，用户手工写的 MCP 段交给覆盖表
  // harness-dispatch（09-16 调度 MCP）同样是 harness 自己生成的段：不进保留清单，
  // 否则「保留旧段 +新生成段」会在 config.toml 里写出重复的 [mcp_servers.harness-dispatch]，
  // MCP 服务器起不来（实测：模型看不到任何 mcp__ 工具）。
  const ownedMcpServers = new Set(["nuphus", "harness-dispatch", ...connectors.map((connector) => safeConnectorId(connector.id))]);
  const { preserved, mcpExtra } = await readUserConfigSplit(ownedMcpServers, mcpOverrides);
  // 工具级权限规则（deny/ask/allow）→ 引擎真正支持的键（disabled_tools / approval_mode）。
  // 见 mcpToolRulesOf 上方 09-16 实证说明：旧实现写 [permissions.*] 既无效又会把整份配置打废。
  // ⛔ 再叠加**总闸掩码**（09-20）：关掉「桌面自动化 / 浏览器自动化」的那一组，整体进 disabled_tools
  //    —— 工具从引擎工具表消失 ⇒ 真阻断（此前浏览器总闸只是提示词级控制）。
  const mcpToolRules = withNuphusMasksForRules(mcpToolRulesOf(mcpOverrides), { desktop: desktopAuto, browser: browserAuto });
  await writeMcpOverrides(mcpOverrides);
  const connectorEnvValue = connectorEnv(connectors);
  // 官方订阅走 chatgpt.com 后端（区域受限）：引擎也要走用户配置的代理，否则 Cloudflare 403/直连超时
  if (entry.provider === "openai-official") {
    const proxy = await resolveLiveProxy();
    if (proxy) Object.assign(connectorEnvValue, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" });
  }
  server.setExternalEnv(connectorEnvValue);
  // 自定义模型目录：让引擎认识非内置模型，用 catalog 里的 context_window（否则 fallback ~121K，
  // 用户设置的 1M 上下文不生效）。无模型时返回空串不写该行。官方订阅走引擎内置模型目录，不需要。
  const isOfficialProvider = entry.provider === "openai-official";
  const catalogToml = isOfficialProvider ? "" : await writeModelCatalogToml(entry);
  // 当前生效模型（catalog 里那条）：下面的 effort 兜底默认要用它。
  // ⛔ 上下文上限**不在这里算、也不写顶层** —— 顶层单值会覆盖每模型上下文，
  //    改为只靠 catalog 的每模型 context_window（见上方 09-16 修正说明）。
  const currentCatalogModel = (normalizeProvider(entry).models ?? []).find((m) => m.id === entry.model);
  const savedProviders = await readCustomModels();
  // 全部已保存供应商都写进引擎配置（含禁用的）：旧线程的 rollout 里记录着创建时的
  // model_provider，抹掉 provider 段会让这些历史会话 resume 直接失败
  // （"Model provider `X` not found"→ 表现为归档/恢复后内容全空）。禁用只影响下拉可选。
  // 官方订阅是伪供应商（走引擎内置 openai + ChatGPT 登录），不写 provider 段。
  const providerEntries = isOfficialProvider ? savedProviders : [entry, ...savedProviders.filter((candidate) => candidate.provider !== entry.provider)];
  // ── 旧会话必须永远走「当前生效供应商」（09-10 跨引擎生命周期探针实证） ──
  // 实测结论：会话存档里的 model_provider 只记「名字」，引擎解析请求地址时只认 config.toml 里
  // 该名字对应段的 base_url（改存档无效、改 config.toml 生效，且必须重启引擎后重新加载会话）。
  // 而引擎进程只有一把全局 Key（= 当前生效供应商的 Key），所以「每个 id 各自指向自家网关」
  // 是错的自洽性：旧会话拿着当前 Key 去打老网关 → 必然 401 无限重连。
  // 正确形态：所有 id（含已删除供应商的历史 id）一律指向**当前生效供应商的地址与协议**，
  // 名字保留用于展示/兼容引用。这样任何历史会话都必然走当前供应商，切换后原会话直接可用。
  const activeNormalized = normalizeProvider(entry);
  // 下发地址统一走本地协议桥（见 responsesBridge 定义处）：非官方模式下**所有** provider 段、
  // 历史别名段、统一 harness 段都共用这一个地址，所以这里是全链路的单点接入——只此一处，
  // 别再在下游分散判断。桥未启动时 bridgeDial 原样返回 → 直连（旧行为）。
  const activeBaseUrl = bridgeDial(activeNormalized.provider, activeNormalized.baseUrl) ?? activeNormalized.baseUrl;
  // ⛔ 恒为 responses：新版引擎对 `wire_api = "chat"` 是**硬拒载**（整份 config.toml 加载失败
  // → 应用所有 codex:request 全部报错，09-14 用户实测截图）。历史上这里会透传用户档案里的
  // chat（旧版本可写入），一旦档案里有 chat 就写坏配置把应用打死。
  const activeWireApi = "responses" as const;
  const activeContext = activeNormalized.models?.find((model) => model.id === activeNormalized.model)?.contextWindow ?? activeNormalized.contextWindow ?? 128000;
  // 历史会话引用过、但已从供应商列表删除的 id（如重装供应商后 id 变化）→ 补成别名段，
  // 否则引擎解析不到会报 "Model provider not found"，会话同样打不开。
  const knownIds = new Set(providerEntries.map((provider) => normalizeProvider(provider).provider));
  // ⛔ 历史会话里的 provider id 同样要过 safeProviderId：否则 `openai` 会绕过 knownIds 的去重，
  //    写成 `[model_providers.openai-custom]` 与真实段**重复**（TOML duplicate key）→ 配置拒载。
  const aliasIds = isOfficialProvider ? [] : [...(await collectSessionProviderIds())]
    .map((id) => safeProviderId(id))
    .filter((id) => !knownIds.has(id) && id && id !== safeProviderId(entry.provider));
  const providerToml = providerEntries.flatMap((provider, index) => {
    const normalized = normalizeProvider(provider);
    const context = normalized.models?.find((model) => model.id === normalized.model)?.contextWindow ?? normalized.contextWindow ?? 128000;
    // ⛔ 数值键必须**强校验**（09-16 修 Bug 10，RCE 级）：`maxOutputTokens` 类型上写 number，
    //    运行时却可能来自用户可编辑的 `userData/model-specs.json`（setExternalSpecs 只校验
    //    `contextWindow > 0`，这个字段原样透传）/ `custom-models.json` / IPC `custom-model:save`。
    //    此前是**裸插值** —— 既没有 Number() 也没有转义。实测：值里塞
    //    `393216\n[mcp_servers.pwn]\ncommand="…"` 能拼出一个**合法**的新段（它是 provider 段的
    //    最后一行，后面紧跟的段头本身就是合法表声明），真引擎 `thread/start` 时**真的 spawn 了**
    //    注入的命令。⇒ 本地配置文件到代码执行的越权边界，四环（渲染层 JSON → IPC →
    //    custom-models.json → config.toml）全都没校验，这里兜住最后一道。
    const maxOut = Number(normalized.models?.find((model) => model.id === normalized.model)?.maxOutputTokens);
    // 非官方模式下所有段共用当前生效供应商的地址/协议（见上方实证说明）；官方模式保持各自原值
    const baseUrl = isOfficialProvider ? normalized.baseUrl : activeBaseUrl;
    // ⛔ 恒 responses（官方段也不透传 chat）——引擎已不支持 chat，写了会整份配置拒载
    const wireApi = "responses";
    return [
      ...(index ? [""] : []),
      `[model_providers.${tomlBareKey(safeProviderId(normalized.provider))}]`,
      `name = "${escapeToml(normalized.name)}"`,
      `base_url = "${escapeToml(baseUrl)}"`,
      'env_key = "CODEX_HARNESS_API_KEY"',
      `wire_api = "${wireApi}"`,
      "requires_openai_auth = false",
      // ⛔⛔ 09-19：这里**不再写 request_max_retries / stream_max_retries /
      //   stream_idle_timeout_ms**（曾写 10/10/600000，实测是 429 放大器：
      //   引擎默认 4/5/5min，调到 10 会让它在限流窗口内密集重打上游 ⇒ 越重试越限流。
      //   详见 electron/provider-retry.ts 的实测证据）。用引擎默认 = 与 WorkBuddy 行为对齐。
      `model_auto_compact_token_limit = ${Math.round(context * (appSettings.autoCompactRatio ?? 0.8))}`,
      'model_auto_compact_token_limit_scope = "model"',
      // 单次输出上限：用户在该供应商模型上填的「最大输出 Token」真实生效（探针实证：
      // model_max_output_tokens 是引擎认可的 provider 段顶层键，config/read 能读回；
      // catalog JSON 里的 max_output_tokens 字段会被引擎忽略——写这里才生效）。
      // 防止超长输出把上下文窗口撑爆卡死。未填时不写（引擎按模型自身上限）。
      ...(Number.isFinite(maxOut) && maxOut > 0 ? [`model_max_output_tokens = ${Math.floor(maxOut)}`] : []),
    ];
  });
  // 已删除供应商 id 的别名段：名字沿用原名（不可考），其余与当前生效供应商完全一致
  const aliasToml = aliasIds.flatMap((aliasId) => [
    "",
    `[model_providers.${tomlBareKey(aliasId)}]`,
    `name = "${escapeToml(aliasId)}（历史会话别名 → 当前生效供应商）"`,
    `base_url = "${escapeToml(activeBaseUrl)}"`,
    'env_key = "CODEX_HARNESS_API_KEY"',
    `wire_api = "${activeWireApi}"`,
    "requires_openai_auth = false",
    // 重试键同样不写（见 providerToml 处的实测说明）
    `model_auto_compact_token_limit = ${Math.round(activeContext * (appSettings.autoCompactRatio ?? 0.8))}`,
    'model_auto_compact_token_limit_scope = "model"',
  ]);
  // 自动化三件套不再注册为 MCP 常驻服务器：35 个工具 schema 会把每轮 prompt 撑大十几 KB，
  // 拖慢所有对话。改为按需命令行调用（nuphus-call / playwright-cli / cloakbrowser，
  // 用法见 developer_instructions），工具能力不变，上下文零占用。
  // ⛔ 统一内置 provider id 段（09-14 用户定稿）：新建会话一律绑 harness，它**永远指向当前生效
  // 供应商** —— 切供应商只重写这一段 + 重启引擎注入新 Key，所有会话零迁移直接可用。
  // 用户配置的真实 id 段（providerToml）与历史 id 别名段（aliasToml）都保留：前者给显示/兼容，
  // 后者给「旧会话 rollout 里记的老 id」兜底。官方订阅模式不写（走引擎内置 openai 通道）。
  const harnessToml = isOfficialProvider ? [] : [
    "",
    "[model_providers.harness]",
    'name = "内置统一通道（当前生效供应商）"',
    `base_url = "${escapeToml(activeBaseUrl)}"`,
    'env_key = "CODEX_HARNESS_API_KEY"',
    `wire_api = "${activeWireApi}"`,
    "requires_openai_auth = false",
    // 重试键同样不写（引擎默认 4/5/5min；写 10 会放大 429 —— 见 providerToml 处实测说明）
    `model_auto_compact_token_limit = ${Math.round(activeContext * (appSettings.autoCompactRatio ?? 0.8))}`,
    'model_auto_compact_token_limit_scope = "model"',
  ];
  // ⛔ 防重护栏（09-15 真实事故）：档案里若混入 id=harness 的供应商条目，providerToml 会
  //    再写一个 [model_providers.harness] 段，与下方 harnessToml 重复 → TOML duplicate key，
  //    引擎加载配置直接失败 = 应用全瘫。harness 段的**唯一权威**是 harnessToml，其余来源
  //    （用户档案/别名段）一律整段剔除。
  const stripHarnessTable = (lines: string[]) => {
    const out: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (/^\[model_providers\.harness\]/.test(line)) { skipping = true; continue; }
      if (skipping) { if (/^\[/.test(line)) { skipping = false; out.push(line); } continue; }
      out.push(line);
    }
    return out;
  };
  const configText = [
    `model = "${escapeToml(entry.model)}"`,
    // （顶层 model_context_window 已按 09-16 修正移除：全局单值会压掉 catalog 里每模型的
    //   上下文；`model_context_window` 仍留在 config-toml.ts 的 HARNESS_CONFIG_KEYS 里，
    //   以便 preserveUserConfig 把老版本写下的旧值一并丢弃，不留残留。）
    // 思考档位兜底默认（当前生效模型档案里记的档）：会话内显式值由每轮 turn/start
    // 的 effort 覆盖，这里只管「重启后 resume 的老会话没显式值时」的默认落点，
    // 与 custom-model.json 的 effort 字段同源。模型没记档位时不写，引擎用内置默认。
    ...((() => {
      const effort = currentCatalogModel?.effort ?? entry.effort;
      return effort ? [`model_reasoning_effort = "${escapeToml(effort)}"`] : [];
    })()),
    // 官方订阅：不写 model_provider（引擎默认 openai），声明优先用 ChatGPT 登录凭据
    // 非官方模式：顶层默认也指向统一内置 id —— 任何「没显式传 modelProvider」的建会话路径
    // （渠道机器人 / 远控 / 其它入口）都自动落到当前生效供应商，不再产生新的绑定差异。
    ...(isOfficialProvider ? ['preferred_auth_method = "chatgpt"'] : ['model_provider = "harness"']),
    ...(catalogToml ? [catalogToml] : []),
    // 完全自主工程模式 + 已装自动化工具使用说明（个性化走 $CODEX_HOME/AGENTS.md 原生机制）。
    // 桌面/浏览器自动化开关关掉时，对应段说明不注入，模型不会被引导去调用它们。
    // 生图/视觉插件配置后才注入对应段——引擎据此知道能力存在并通过命令行真实调用。
    developerInstructionsLine(devInput),
    // ⛔ 用户自己的顶层键必须在**第一个段头之前**（09-16 修 Bug 3）：旧实现把它们连同用户段
    //    一起拼在文件**末尾**，而末尾紧接 `[mcp_servers.*]` —— TOML 语义上这些键就成了那个段的
    //    键，引擎根本读不到（实测 `approval_policy = "never"` 变成 `mcp_servers.nuphus.approval_policy`，
    //    顶层设置静默失效）。放在这里（developer_instructions 块字符串之后、第一个段头之前）才安全：
    //    再往前会被多行字符串吞掉，往后会被段落吞掉。
    ...(preserved.topLevel ? [preserved.topLevel] : []),
    ...connectorToml(connectors),
    ...stripHarnessTable(providerToml),
    ...harnessToml,
    ...stripHarnessTable(aliasToml),
    "",
    // Windows 原生沙箱：elevated 模式需要一次性管理员安装（建沙箱用户/防火墙规则），
    // harness 静默 spawn 装不了，会导致所有 exec_command "blocked by policy"。
    // unelevated 用受限令牌，无需安装，是官方兜底。
    "[windows]",
    'sandbox = "unelevated"',
    "",
    // 联网工具开关：web_search 是 Responses API 服务端搜索工具，每轮 prompt 都带上；
    // 关掉能省掉模型「顺手联网」的往返（设置页「联网搜索」开关可切）。
    // workspace-write 沙箱网络访问保持开启（模型仍可用 curl/pip 自行联网，不依赖该开关）。
    "[tools]",
    `web_search = ${appSettings.webSearch === false ? "false" : "true"}`,
    "",
    // 关闭 otel/feedback 遥测写出：OtelExporterKind 的 "none" 会停掉 spans 的本地落库
    // （logs_*.sqlite 里那些 Reloading auth / remote control 噪音）。本机是 API key 模式，
    // 不需要 OpenTelemetry 导出，纯本地日志保留在引擎自有 feedback log 里够用了。
    "[otel]",
    'exporter = "none"',
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "",
    // Codex 会按 shell_environment_policy 重新构造每次工具调用的环境；显式覆盖 PATH，
    // 防止 WindowsApps 的 0 字节 python.exe 占位符抢在应用内置 Python 前面。
    "[shell_environment_policy]",
    'inherit = "all"',
    "ignore_default_excludes = true",
    "",
    "[shell_environment_policy.set]",
    `PATH = "${escapeToml(augmentedPath())}"`,
    ...(bundledPython() ? [
      `PYTHON = "${escapeToml(bundledPython())}"`,
      `PYTHON_EXECUTABLE = "${escapeToml(bundledPython())}"`,
      `PYTHONHOME = "${escapeToml(path.dirname(bundledPython()))}"`,
    ] : []),
    "",
    // 默认浏览器 = **内置浏览器视图**（右栏 Chromium webview）+ playwright-cli；CloakBrowser 是
    // 按需下载的可选增强（见 developer_instructions 的浏览器能力段）。
    // 浏览器自动化开关关掉后不开启 features.browser_use，模型不再被引导操作浏览器。
    ...(browserAuto ? [
      "[features]",
      "browser_use = true",
      "",
    ] : []),
    // ⛔ 工具级权限规则**不在这里写**（09-16 修 Bug 1/2）：旧实现把 deny/ask/allow 写成
    // `[permissions.allow/ask/deny]` + `"mcp__server__tool" = true`，既不被引擎解析（该 struct
    // 没有工具映射字段），又因为缺 `default_permissions` 让整份配置非法。
    // 现在由文件末尾的 injectMcpToolRules 把规则落到 `disabled_tools` / `[mcp_servers.X.tools.<名>]`
    // 这两个**引擎真正支持**的键上（见 mcpToolRulesOf 上方实证记录）。
    // 内置调度 MCP（09-16）：agent_invoke 走引擎级 MCP 注入 —— dynamicTools 只在 thread/start
    // 生效（引擎硬约束），MCP 是唯一能覆盖**所有会话（含老会话）**的注册通道。执行闸在主进程。
    ...(await (async () => {
      try {
        await ensureDispatchHttp();
        if (!dispatchHttpPort) return [];
        // 直连 HTTP 传输（引擎原生支持 url）：无子进程冷启动 —— stdio 走 electron.exe 实测要
        // 28s 才握手完，超过 startup_timeout 会被引擎判死，工具根本不注册（09-16 踩过）。
        return [
          "[mcp_servers.harness-dispatch]",
          `url = "http://127.0.0.1:${dispatchHttpPort}/mcp?token=${dispatchToken}"`,
          "startup_timeout_sec = 60",
          "",
        ];
      } catch (error: any) {
        console.warn("[dispatch] MCP 段写入失败：", error?.message ?? error);
        return [];
      }
    })()),
    // 内置桌面自动化 MCP：受覆盖表 + 两个自动化总闸控制。
    // ⛔ 09-20 修正注册条件（原先只看 desktopAuto）：nuphus 是**同一个 MCP 服务器**同时提供
    //    `desktop_*` 与 `browser_*`，只看桌面开关会带来两个问题 ——
    //    ① 关掉桌面自动化 ⇒ `browser_*` 被一起带走，「只给浏览器、不给真实键鼠」做不到（安全边界缺陷）；
    //    ② 关掉浏览器自动化 ⇒ `browser_*` 仍全量注册，只是提示词叫模型别用（**不是硬控制**）。
    //    现在改为「任一总闸开启就注册」，关闭的那一组由 `disabled_tools` 掩码整体摘掉
    //    （见 automation-policy.ts 的 nuphusDisabledTools）。
    // 全量注册 nuphus 的**全部 38 个工具**（09-20 实测枚举：桌面 15 + 浏览器 23），
    // schema 约占 ~10k 前缀，但作为 prompt 常量前缀可被上游缓存。
    ...(shouldRegisterNuphus({ desktop: desktopAuto, browser: browserAuto }) && nuphusBinary() && mcpOverrideEnabled(mcpOverrides, "nuphus") ? [
      "[mcp_servers.nuphus]",
      `command = "${escapeToml(nuphusBinary())}"`,
      "args = []",
      "startup_timeout_sec = 20",
      // 视觉插件（BYOK）必须**真的下发到 nuphus 进程**：`desktop_vision` 读的是
      // NUPHUS_MCP_VISION_* 环境变量，而不是我们这份 builtin-plugins.json
      // （09-20 定位：这段 env 从来没写过 ⇒ 插件怎么配 `desktop_vision` 都报 "API_KEY required"）。
      // ⛔ 子表 `[mcp_servers.X.env]` 这个形态是**真实 app-server 探针实证过**的
      //    （假 stdio MCP 把自己进程 env 落盘 → 4 个哨兵值全部命中）；别换内联写法。
      ...(() => {
        const visionEnv = nuphusVisionEnv(devInput.nuphusVision);
        if (!visionEnv.length) return [];
        return ["", NUPHUS_VISION_ENV_TABLE, ...visionEnv.map(([key, value]) => `${key} = "${escapeToml(value)}"`)];
      })(),
      "",
    ] : []),
    // 用户手工写进 config.toml 的 MCP 段：启用中的原样拼回，停用的保留原文但不输出
    ...mcpExtra.flatMap((section) => [section, ""]),
    // 用户自行管理的段落（projects / marketplaces / plugins / hooks / permissions 等）原样拼回，
    // 避免保存模型时把已安装插件的注册信息抹掉。
    ...(preserved.sections ? [preserved.sections, ""] : []),
  ].join("\n");
  // 两处**后置注入**（都在 config-toml.ts，纯函数、可被预检直接测）：
  //  ① injectSectionExtras：把用户在段级共享表里手写的额外子键插回对应段末尾（修 Bug 6）
  //  ② injectMcpToolRules：把 per-tool 权限落到 disabled_tools / approval_mode（修 Bug 1/2）
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    injectMcpToolRules(injectSectionExtras(configText, preserved.sectionExtras), mcpToolRules),
    "utf8",
  );
  // 官方订阅绝不能带 API Key：chatgpt 后端只认 ChatGPT 登录凭据，
  // 带上陈旧 sk- key 会 401 "api_key_not_supported" → 流无限重连（实证）。
  // 顺手把存档里的陈旧密钥清掉。
  if (entry.provider === "openai-official") {
    if (entry.encryptedKey) {
      try {
        const { encryptedKey: _stripped, ...clean } = entry;
        await upsertCustomModel(clean as CustomModelFile);
      } catch { /* 清档失败不影响主流程 */ }
    }
    server.setApiKey("");
  } else {
    const apiKey = entry.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(entry.encryptedKey, "base64")) : "";
    server.setApiKey(apiKey);
  }
  // restart:false = 同供应商内换模型的「只写配置」通道：引擎只在启动时读 config.toml，
  // 运行中重写零影响；重启会打断所有在跑回合（「app-server restarted」），只在
  // 真正切换供应商/Key 的流程里才需要。
  if (opts?.restart !== false) await server.restart();
}
