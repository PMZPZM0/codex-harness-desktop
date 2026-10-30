/** 06-app-behavior 第 1/5 段：原 06-app-behavior.mjs L16–L864（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：06-app-behavior
 * 分节：【23】【24】【25】【28】（原 L2914–L4089）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, createRequire, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readSettingsSurface, readStyles, readdirSync, relative, rmSync, sliceHandle, spawnSync, statSync, typesSrc,
} from "../_ctx.mjs";
import { FUNCTION_MENU_DEFAULT_ORDER, moveFunctionMenuItem, normalizeFunctionMenu, resetFunctionMenuLayout, setFunctionMenuItemOverflow } from "../../../src/features/function-menu/menu-model.mjs";



export async function run() {
{
{
console.log(C.bold("\n【23】API 协议：引擎只支持 Responses，chat 不得从任何路径写进配置"));

{
  // 09-16 真实引擎探针实证（scripts/probe-wire-api.cjs，独立 CODEX_HOME + app-server）：
  // config.toml 写 `wire_api = "chat"` 时 initialize 能过，但 **turn/start 必报**
  //   `wire_api = "chat"` is no longer supported. How to fix: set `wire_api = "responses"`
  // → 之后每一个请求都失败（等同应用全瘫）。所以：① 写配置一律恒 responses；
  // ② UI 不得再提供这个永远无法生效的选项（否则用户选了保存时被静默改回，表现为「协议自己跳回 re 开头」）。
  const mainTs = readMainSource();
  const appTsx = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  const hookTs = readFileSync(join(ROOT, "src/hooks/useModelProviders.ts"), "utf8");
  // ⛔ 判据必须**精确到 wireApi**（09-19 修正）：不能全文禁 `<option value="chat">` ——
  //   新加的「上游协议」选择器**合法地**含有它（那是告诉本地协议桥"上游网关是什么协议"，
  //   与写给引擎的 wireApi 完全两回事）。全文禁会把正确功能顶红（实测踩到）。
  (!appTsx.includes('wireApi: "chat"') && !/wireApi:\s*event\.target\.value/.test(appTsx) ? ok : fail)(
    "App.tsx 没有任何路径把 wireApi 设成 chat（引擎只支持 responses；「上游协议」选择器不算）"
  );
  (!appTsx.includes('target.wireApi === "chat"') ? ok : fail)("App.tsx 会话接力内联 config 不把 chat 透传给引擎");
  (!mainTs.includes('savedWire === "chat" ? "chat"') ? ok : fail)("main.ts 历史会话别名段不把 chat 透传进 config.toml");
  // ⛔ 锚点切片而非全文禁字符串（09-18）：probeCustomModel 的协议回落合法地含
  // `input.wireApi === "chat" ? "chat"`（探针只选测试端点、不写 config.toml），
  // 全文禁会误伤。本守卫的本意是「保存入口不透传 chat」——锁定 save handler 区域来查。
  const saveEntryIdx = mainTs.indexOf('"custom-model:save"');
  const saveRegion = saveEntryIdx >= 0 ? mainTs.slice(saveEntryIdx, saveEntryIdx + 4000) : mainTs;
  (!saveRegion.includes('=== "chat" ? "chat"') ? ok : fail)("main.ts 保存入口恒 responses，不透传用户选的 chat（不依赖下游归一兜底）");
  (!hookTs.includes("wireApi: wireUsed") ? ok : fail)("useModelProviders 探测不再把实测协议回写草稿（避免「探测说 chat、保存变 responses」自相矛盾）");
  (mainTs.includes('wireApi: "responses" }') ? ok : fail)("main.ts normalizeProvider 仍在读入侧归一化 chat（保命逻辑，别删）");
  (mainTs.includes('const activeWireApi = "responses"') ? ok : fail)("main.ts applyCustomModel 生成的 provider 段恒为 responses");
  // ⛔ 判据不能锚 "wireApi: \"responses\" }"（单行结尾）：保存调用后来拆成多行
  //   （加了 maxConcurrency 归一），只要**显式传了 responses** 就算通过。
  (/wireApi: "responses",/.test(hookTs) ? ok : fail)("保存路径显式归一 wireApi（草稿里的历史 chat 写不进配置）");
}
  }
}

{
{
console.log(C.bold("\n【24】协议桥：引擎只发 Responses，chat-only 网关由本地桥转换接入"));

{
  // 背景：引擎只会 POST /responses；只提供 /v1/chat/completions 的网关（火山 coding、Kimi Coding 等）
  // 过去「连接测试通过、对话全废」。桥上按上游实际能力转发/转换（双向转换契约来自真实引擎实证：
  // scripts/probe-responses-contract.cjs 录契约、scripts/probe-bridge.cjs 跑端到端）。
  // 这里守两件事：① 接线不得被绕过（任何下发点漏了桥 = chat-only 网关静默不可用）；
  // ② 转换行为不得回退（直接跑编译产物的真实转换函数，毫秒级）。
  const bridgeSrc = existsSync(join(ROOT, "electron/responses-bridge.ts"))
    ? readResponsesBridgeSource() : "";
  const mainTs = readMainSource();
  const preloadTs = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  const typesSrc = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  const hookTs = readFileSync(join(ROOT, "src/hooks/useModelProviders.ts"), "utf8");

  (bridgeSrc.includes("export class ResponsesBridge") ? ok : fail)("electron/responses-bridge.ts 存在且导出 ResponsesBridge");
  (mainTs.includes("new ResponsesBridge(") ? ok : fail)("main.ts 实例化协议桥单例");
  (mainTs.includes("await responsesBridge.start()") ? ok : fail)("启动链拉起协议桥（失败必须降级直连，不掐死启动）");
  (mainTs.includes("bridgeRewriteProviderConfig(params)") ? ok : fail)("codex:request 统一兜底：渲染层自带的内联 provider 配置也走桥");
  (mainTs.includes("bridgeDial(activeNormalized.provider, activeNormalized.baseUrl)") ? ok : fail)("applyCustomModel 的 config.toml 地址走桥（provider/别名/harness 三段的单点来源）");
  (mainTs.includes('base_url = "${bridgeDial(alias, active.baseUrl)}"') ? ok : fail)("历史会话别名段的 base_url 也走桥");
  (!/base_url: baseUrl\b/.test(mainTs) ? ok : fail)("main.ts 不留任何直连 base_url 的内联配置（漏一处 = chat-only 网关静默不可用）");
  // ⛔ 口径变化（10-04）：删除 `subagents:invoke` 那条绕过调度闸门的旁路时，连带移除了它内联的
  // 一处 provider 配置（`base_url: bridgeDial(…)`）⇒ 「走桥的内联配置」由 7 处降到 6 处。
  // 这是**消费方消失**、不是漏桥 —— 下方「不留任何直连 base_url 的内联配置」那条才是真正的安全网；
  // 这个计数闸门保留，只为在有人**再少一处**时报警（少 = 要么删了消费方、要么漏了桥，必须来看一眼）。
  // ⛔ 注释写成 `//` 前缀：本文件在【265】棘轮名单里，口径是**净代码行**，块注释的续行会被算成代码行。
  const dialedCount = (mainTs.match(/base_url: bridgeDial\(/g) ?? []).length;
  (dialedCount >= 6 ? ok : fail)(`main.ts 内联 provider 配置已桥化（实测 ${dialedCount} 处，10-04 起基线 6）`);
  (preloadTs.includes('"bridge:status"') && typesSrc.includes("bridgeStatus") ? ok : fail)("桥状态 IPC 在 preload 与类型声明里对齐");
  (hookTs.includes("本机协议桥") ? ok : fail)("useModelProviders 明确告知 chat-only 网关已由协议桥接管（不再说「无法使用」）");
  /* 10-20 云端记忆身份错位（勾了 4 个只有 deepseek 能用）：MEMHUB 用内部账号转发，
     账号服务按内部账号的 userModels 鉴权。桥必须把记忆 key 补成 MEMHUB 会透传的
     `X-Tdai-User-Key`，账号服务才能按真实用户鉴权/扣费。 */
  (bridgeSrc.includes('headers["x-tdai-user-key"]') && bridgeSrc.includes("sk-mem-") ? ok : fail)(
    "云端记忆桥：sk-mem key 同步补 X-Tdai-User-Key（否则模型请求按内部账号鉴权）"
  );
  /* 10-20 多租户隔离加固：MEMHUB 会原样透传客户端给的 X-Tdai-User-Key ⇒ 单靠它 = 客户端自报身份。
     桥再带本机账号代理令牌；账号服务要求两证指向同一用户。 */
  (bridgeSrc.includes('headers["x-harness-proxy-token"]') && bridgeSrc.includes("readCloudProxyToken") && /headers\["x-tdai-user-key"\] =/.test(bridgeSrc) ? ok : fail)(
    "云端记忆桥：同时带代理令牌，并覆盖客户端同名头（不采信自报身份）"
  );
  {
    const serverPath = join(ROOT, "cloud/server-account/server.js");
    if (existsSync(serverPath)) {
      const accountServerSrc = readFileSync(serverPath, "utf8");
      (accountServerSrc.includes("usernameByMemoryKey") && accountServerSrc.includes("effectiveUsername") && accountServerSrc.includes("X-Tdai-User-Key") ? ok : fail)(
        "账号服务：内部网关请求按 X-Tdai-User-Key 映射真实用户（鉴权/余额/扣费都用 effectiveUsername）"
      );
      /* 跨用户隔离的硬判据：token 与 memKey 必须一致；memKey-only 不归属；billing 全用有效用户。 */
      (accountServerSrc.includes("claimedToken") && accountServerSrc.includes('"identity-mismatch"') && accountServerSrc.includes('"invalid-identity-token"') && accountServerSrc.includes('"identity-incomplete"') ? ok : fail)(
        "账号服务：代理令牌 + memKey 双证必须同时存在且一致（缺一/不一致/令牌无效直接拒绝）"
      );
      (/if \(found\) return "";/.test(accountServerSrc) && /effectiveUsername = internal && hasIdentity \? tokenHit\.username : hit\.username/.test(accountServerSrc) ? ok : fail)(
        "账号服务：memKey 重复命中判无效；无身份的老客户端回退内部账号（不按自报 memKey 归属）"
      );
      (accountServerSrc.includes("addPoints(effectiveUsername") && accountServerSrc.includes("addUsageOnly(effectiveUsername") ? ok : fail)(
        "账号服务：扣费/用量都记在 effectiveUsername（不再记内部账号或提交头的人）"
      );
    }
  }

  // ── 行为级：直接跑编译产物的真实转换函数 ──
  const compiled = join(ROOT, "dist-electron", "responses-bridge.js");
  const compiledOk = existsSync(compiled);
  (compiledOk ? ok : fail)("协议桥已编译进 dist-electron（随主进程一起打包，不依赖额外运行时文件）");
  (bridgeSrc.includes("BRIDGE_PROBE_IDLE_MS") && bridgeSrc.includes("BRIDGE_CONNECT_MS") && bridgeSrc.includes("无响应头") && bridgeSrc.includes("改用 chat 转换") && bridgeSrc.includes("watchForwardIdle") ? ok : fail)(
    "auto 探活：连响应头都没有 / 200 无数据 / 非 SSE 都会超时改走 chat；显式 responses 也有空闲看门狗（不再永远「生成中」）"
  );
  {
    const probeSrc = readFileSync(join(ROOT, "electron/features/custom-model-probe.ts"), "utf8");
    (probeSrc.includes("if (models && !model)") && probeSrc.includes("实际推理失败") && probeSrc.includes("35_000") ? ok : fail)(
      "模型检测：指定模型必须真发一次推理（/models 里有 ≠ 能用；grok-4.7 实测列表有、推理挂起）"
    );
    /* ⛔ 10-22 用户实测：网关整站 502（Caddy 反代目标不通），界面却说「实际推理失败…通常是该账号
       未开通这个模型」—— 把人引到换模型/查账号上，方向全错。两条判据：
       ① 5xx 单独归因到服务端；② 精确诊断不许被 catch 再包一层。 */
    (probeSrc.includes("if (response.status >= 500) throw diagnose(") ? ok : fail)(
      "⛔ 5xx 归因为服务端网关异常（⛔ 不许再说成「该账号未开通这个模型」）"
    );
    (probeSrc.includes("const diagnose = (message: string) => Object.assign(new Error(message), { probeDiagnosed: true });")
      && probeSrc.includes("if (error?.probeDiagnosed) throw error;") ? ok : fail)(
      "⛔ 精确诊断不被 catch 二次包装（否则认证失败 / 模型不存在 / 5xx 全被吞成「实际推理失败」）"
    );
  }
  if (compiledOk) {
    const requireBridge = createRequire(import.meta.url);
    const { toChatRequest, ChatStreamTranslator, chatJsonToResponses } = requireBridge(compiled);

    const chat = toChatRequest({
      model: "m", instructions: "SYS",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "DEV" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "HI" }] },
        { type: "function_call", name: "exec_command", arguments: '{"cmd":"x"}', call_id: "c1" },
        { type: "function_call_output", call_id: "c1", output: "done" },
        { type: "reasoning", summary: [] },
      ],
      tools: [
        { type: "function", name: "exec_command", description: "d", parameters: { type: "object" } },
        { type: "web_search" },
      ],
      tool_choice: "auto", reasoning: { effort: "xhigh", summary: "auto" },
      stream: true, store: false, include: ["reasoning.encrypted_content"], prompt_cache_key: "k",
    });
    (chat.messages[0]?.role === "system" && chat.messages[0]?.content === "SYS" ? ok : fail)("转换：instructions → 首条 system 消息");
    (chat.messages[1]?.role === "system" ? ok : fail)("转换：developer 角色降级为 system（多数学网关不认 developer）");
    (chat.messages[2]?.role === "user" ? ok : fail)("转换：用户消息原样保留");
    (chat.messages[3]?.tool_calls?.[0]?.function?.name === "exec_command" ? ok : fail)("转换：function_call → assistant.tool_calls");
    (chat.messages[4]?.role === "tool" && chat.messages[4]?.tool_call_id === "c1" ? ok : fail)("转换：function_call_output → role:tool（call_id 必须对得上）");
    (chat.tools?.length === 1 && chat.tools[0].function?.name === "exec_command" ? ok : fail)("转换：tools 变 chat 嵌套形状，非 function 工具（web_search）剔除");
    (chat.reasoning_effort === "high" ? ok : fail)("转换：xhigh 降档 high（Chat 网关不认 xhigh）");
    (chat.stream_options?.include_usage === true ? ok : fail)("转换：流式请求要求 usage（引擎 token 统计依赖它）");
    (!("store" in chat) && !("prompt_cache_key" in chat) && !("include" in chat) ? ok : fail)("转换：Responses 专有字段不得泄漏给 chat 上游");

    const textTranslator = new ChatStreamTranslator("m");
    let textOut = textTranslator.push({ choices: [{ delta: { content: "he" } }] });
    textOut += textTranslator.push({ choices: [{ delta: { content: "llo" } }] });
    textOut += textTranslator.push({ choices: [{ delta: {} }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } });
    textOut += textTranslator.finish();
    (textOut.includes("response.created") && textOut.includes("response.output_item.added") && textOut.includes("response.output_text.delta") ? ok : fail)("回流：文本增量转成引擎消费的事件序列（实证过的最小集）");
    (textOut.includes('"text":"hello"') ? ok : fail)("回流：收尾事件里文本已合并完整");
    (textOut.includes("response.completed") && textOut.includes('"input_tokens":4') ? ok : fail)("回流：completed 事件带 usage 映射（prompt→input）");

    const toolTranslator = new ChatStreamTranslator("m");
    let toolOut = toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c9", type: "function", function: { name: "exec_command", arguments: "" } }] } }] });
    toolOut += toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } }] });
    toolOut += toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] });
    toolOut += toolTranslator.finish();
    (toolOut.includes("response.function_call_arguments.delta") ? ok : fail)("回流：工具参数分片转成 function_call_arguments.delta");
    (toolOut.includes('"arguments":"{\\"a\\":1}"') ? ok : fail)("回流：收尾时工具参数拼接完整（引擎据此执行）");
    (toolOut.includes('"call_id":"c9"') ? ok : fail)("回流：工具 call_id 原样保留（下一轮 function_call_output 要对回它）");

    const json = chatJsonToResponses({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }, "m");
    (json.output?.[0]?.content?.[0]?.text === "hi" ? ok : fail)("回流：非流式 chat 响应也能转成 responses 输出项");
  }
}
  }
}

{
{
console.log(C.bold("\n【25】思考等级：展示 低/中/高/最高/极高，默认 低/中/高/极高，档案随模型持久化"));
{
  // 背景：用户实测两件事——① 菜单名要改成「低 中 高 最高 极高」，一般模型默认就是
  // 低/中/高/极高；② 档位「不是跟着模型保存生效的，每次都要二次保存」：过去只有无会话时
  // 才写档案，会话里选的档位新会话弹回旧值。守两头：档位规则（真跑 effort.ts 的导出函数，
  // Node 自带 type-stripping 毫秒级）+ 接线（applyEffort 无条件写档案、chooseModel 读档案、
  // 主进程 catalog 与 UI 同规则、桥对 chat 上游压档）。
  const effortSrc = join(ROOT, "src", "lib", "effort.ts");
  const effortUrl = pathToFileURL(effortSrc).href;
  let exported = null;
  try {
    const probe = spawnSync(process.execPath, [
      "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
      `import * as e from ${JSON.stringify(effortUrl)}; console.log(JSON.stringify({` +
      ` custom: e.CUSTOM_MODEL_EFFORTS, all: e.ALL_EFFORTS,` +
      ` und: e.declaredModelEfforts(undefined), empty: e.declaredModelEfforts([]),` +
      ` legacy: e.declaredModelEfforts(["low", "medium", "high"]),` +
      ` legacyUltra: e.declaredModelEfforts(["low", "medium", "high", "ultra"]),` +
      ` untouched: e.declaredModelEfforts(["high"]),` +
      ` norm: e.normalizeEffort("xhigh") }));`,
    ], { encoding: "utf8" });
    exported = JSON.parse(probe.stdout.trim().split("\n").at(-1));
  } catch { /* 下面统一判红 */ }
  (exported ? ok : fail)("effort.ts 可被 Node type-stripping 直接加载（守卫跑的是真代码，不是字符串）");
  if (exported) {
    (JSON.stringify(exported.custom) === JSON.stringify(["low", "medium", "high", "xhigh"]) ? ok : fail)("默认档位 = 低/中/高/极高（用户定稿，不再是旧三档）");
    (JSON.stringify(exported.all) === JSON.stringify(["minimal", "low", "medium", "high", "ultra", "xhigh", "max"]) ? ok : fail)("菜单顺序 = 极简,低,中,高,最高,极高,（max 追加在末尾）（ultra 在 xhigh 前；max 是 09-16 补的引擎内置档，追加不打乱已定稿顺序）");
    (JSON.stringify(exported.und) === JSON.stringify(["low", "medium", "high", "xhigh"]) && JSON.stringify(exported.empty) === JSON.stringify(exported.und) ? ok : fail)("未声明档位（含探测合并的空数组）→ 回退新默认四档");
    (JSON.stringify(exported.legacy) === JSON.stringify(["low", "medium", "high", "xhigh"]) ? ok : fail)("旧版默认三档声明自动补「极高」（老档案升版后菜单不少档、引擎 catalog 不缺档）");
    (JSON.stringify(exported.legacyUltra) === JSON.stringify(["low", "medium", "high", "ultra", "xhigh"]) ? ok : fail)("旧版自动生成的三档+最高声明也补「极高」（真机档案实测的存量形态）；菜单正好=低中高最高极高");
    (JSON.stringify(exported.untouched) === JSON.stringify(["high"]) ? ok : fail)("用户显式声明的档位列表不被迁移污染");
    (exported.norm === "xhigh" ? ok : fail)("normalizeEffort 认识新档位值");
  }

  // ---- 09-18「档位不被支持」的自动兜底：真跑 effort-support.ts 的纯函数（node type-stripping） ----
  {
    const supportSrc = join(ROOT, "src", "lib", "effort-support.ts");
    const supportUrl = pathToFileURL(supportSrc).href;
    let s = null;
    try {
      const probe = spawnSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        // localStorage 在 Node 里没有 —— 先塞一个内存版（模块只在函数体里访问它）
        `globalThis.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };` +
        `import * as m from ${JSON.stringify(supportUrl)}; console.log(JSON.stringify({` +
        ` pos1: m.isUnsupportedEffortError("unsupported value for reasoning_effort: max"),` +
        ` pos2: m.isUnsupportedEffortError("Invalid value 'max' for 'reasoning_effort'"),` +
        ` pos3: m.isUnsupportedEffortError("不支持该思考档位"),` +
        ` neg1: m.isUnsupportedEffortError("Invalid API key provided"),` +
        ` neg2: m.isUnsupportedEffortError("rate limit exceeded"),` +
        ` neg3: m.isUnsupportedEffortError(""),` +
        ` fbMax: m.pickEffortFallback("max", []),` +
        ` fbXhigh: m.pickEffortFallback("xhigh", []),` +
        ` fbHigh: m.pickEffortFallback("high", []),` +
        ` fbMin: m.pickEffortFallback("minimal", []),` +
        ` fbUnknown: m.pickEffortFallback("bogus", []),` +
        ` fbSkipBlocked: m.pickEffortFallback("max", ["xhigh", "ultra"]),` +
        ` fbAllBlocked: m.pickEffortFallback("high", ["medium", "low", "minimal"]),` +
        ` store0: m.blockedEffortsOf("m1"),` +
        ` afterMark: m.markEffortUnsupported("m1", "max"),` +
        ` store1: m.blockedEffortsOf("m1"),` +
        ` otherModel: m.blockedEffortsOf("m2"),` +
        ` afterClear: (m.clearEffortUnsupported("m1", "max"), m.blockedEffortsOf("m1")),` +
        ` }));`,
      ], { encoding: "utf8" });
      s = JSON.parse(probe.stdout.trim().split("\n").at(-1));
    } catch { /* 下面统一判红 */ }
    (s ? ok : fail)("effort-support.ts 可被 Node type-stripping 直接加载（守卫跑的是真代码）");
    if (s) {
      (s.pos1 && s.pos2 && s.pos3 ? ok : fail)("档位不支持类错误能识别（英文 unsupported / invalid value / 中文「不支持」）");
      (!s.neg1 && !s.neg2 && !s.neg3 ? ok : fail)("非档位错误不误判（invalid api key / 限流 / 空串 都不能触发降档重发）");
      (s.fbMax === "xhigh" && s.fbXhigh === "ultra" && s.fbHigh === "medium" ? ok : fail)("降档链：max→极高、极高→最高、高→中（逐级保守）");
      (s.fbMin === null ? ok : fail)("已是最低档 → 返回 null（不再重发，改为提示用户手动选）");
      (s.fbUnknown === "high" ? ok : fail)("未知档位 → 回落安全档 high");
      (s.fbSkipBlocked === "high" ? ok : fail)("降档会跳过该模型已标记不支持的档位（max→跳过极高/最高→高）");
      (s.fbAllBlocked === null ? ok : fail)("更低档全被标记时返回 null（不会无限降）");
      (JSON.stringify(s.store0) === "[]" && JSON.stringify(s.afterMark) === '["max"]' && JSON.stringify(s.store1) === '["max"]' ? ok : fail)("「不支持」的记录按模型 id 分组落盘（mark 幂等、读回一致）");
      (JSON.stringify(s.otherModel) === "[]" ? ok : fail)("记录按模型隔离（别的模型不受影响）");
      (JSON.stringify(s.afterClear) === "[]" ? ok : fail)("clearEffortUnsupported：该档位发送成功后能清掉记录（自愈，避免永久标灰）");
    }
  }

  // ---- 09-18 内置规格表更新 + 模型 ID 补全：真跑 model-specs.ts（node type-stripping） ----
  {
    const specsUrl = pathToFileURL(join(ROOT, "src", "lib", "model-specs.ts")).href;
    let sp = null;
    try {
      const probe = spawnSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        `import * as m from ${JSON.stringify(specsUrl)}; const V = (id) => { const s = m.matchModelSpec(id); return s ? (s.inputTypes || []).includes("image") : null; }; console.log(JSON.stringify({` +
        ` gpt6: m.matchModelSpec("gpt-6-astra").contextWindow, gpt6Vis: V("gpt-6-astra"), gpt6Out: m.matchModelSpec("gpt-6-astra").maxOutputTokens,` +
        ` gpt56: m.matchModelSpec("gpt-5.6-terra").contextWindow, gpt55: m.matchModelSpec("gpt-5.5").contextWindow, gpt51: m.matchModelSpec("gpt-5.1").contextWindow,` +
        ` fable: m.matchModelSpec("claude-fable-5").contextWindow, fableVis: V("claude-fable-5"), claudeOld: m.matchModelSpec("claude-sonnet-4-5").contextWindow,` +
        ` gemini: m.matchModelSpec("gemini-3.5-flash").contextWindow, geminiOut: m.matchModelSpec("gemini-3.5-flash").maxOutputTokens, geminiVis: V("gemini-3.5-flash"),` +
        ` dsV4: m.matchModelSpec("deepseek-v4-pro").contextWindow, dsV4Out: m.matchModelSpec("deepseek-v4-pro").maxOutputTokens, dsV4Vis: V("deepseek-v4-pro"),` +
        ` dsV41: m.matchModelSpec("deepseek-v4.1-flash").contextWindow, dsV41Out: m.matchModelSpec("deepseek-v4.1-flash").maxOutputTokens, dsV41Vis: V("deepseek-v4.1-flash"),` +
        ` dsFlashCtx: m.matchModelSpec("deepseek-flash").contextWindow, dsFlashVis: V("deepseek-flash"), dsFlashEff: m.matchModelSpec("deepseek-flash").efforts.join("/"),` +
        ` dsV4FlashRouted: m.matchModelSpec("deepseek-v4-flash-ga-260731").contextWindow,` +
        ` k3: m.matchModelSpec("kimi-k3").contextWindow, k3Vis: V("kimi-k3"), k3256: m.matchModelSpec("kimi-k3-256k").contextWindow,` +
        ` glm53: m.matchModelSpec("glm-5.3").contextWindow, glm53Vis: V("glm-5.3"), glm53fVis: V("glm-5.3-flash"),` +
        ` qwen38: m.matchModelSpec("qwen3.8-max").contextWindow, qwen38Video: (m.matchModelSpec("qwen3.8-max").inputTypes || []).includes("video"),` +
        ` nova: m.matchModelSpec("sensenova-v6.5-pro").contextWindow, novaVis: V("sensenova-v6.5-pro"),` +
        ` unknown: m.matchModelSpec("totally-unknown-xyz"),` +
        ` sugGpt56: m.suggestModelIds("gpt-5.6").slice(0, 2).map((e) => e.id),` +
        ` sugEmpty: m.suggestModelIds("").length,` +
        ` sugDeepseek: m.suggestModelIds("deepseek")[0].id,` +
        ` fmt: m.formatTokenCount(1050000) + "/" + m.formatTokenCount(262144),` +
        ` }));`,
      ], { encoding: "utf8" });
      sp = JSON.parse(probe.stdout.trim().split("\n").at(-1));
    } catch { /* 下面统一判红 */ }
    (sp ? ok : fail)("model-specs.ts 可被 Node type-stripping 直接加载（规格守卫跑的是真表）");
    if (sp) {
      (sp.gpt6 === 1050000 && sp.gpt6Vis === true && sp.gpt6Out === 128000 ? ok : fail)("GPT-6 Astra：1.05M 上下文 / 128K 输出 / 视觉（09-03 发布）");
      (sp.gpt56 === 1050000 && sp.gpt55 === 1000000 && sp.gpt51 === 400000 ? ok : fail)("GPT-5.6=1.05M、5.4/5.5=1M、5.0/5.1=400K（按世代分开，不再一刀切 400K）");
      (sp.fable === 1000000 && sp.fableVis === true ? ok : fail)("Claude Fable 5 / Opus 4.8：1M / 128K / 视觉（新旗舰）");
      (sp.claudeOld === 200000 ? ok : fail)("早期 Claude 仍是 200K —— 不能把整个家族都标成 1M（虚标会被供应商拒）");
      (sp.gemini === 1048576 && sp.geminiOut === 65536 && sp.geminiVis === true ? ok : fail)("Gemini 3.x：1,048,576 / 65,536 / 多模态（Google 官方模型指南）");
      (sp.dsV4 === 1000000 && sp.dsV4Out === 393216 && sp.dsV4Vis === false ? ok : fail)("DeepSeek V4-Pro（仍在售）：1M / 384K 且**纯文本**（官方明确 v4-pro 无视觉）");
      (sp.dsV41 === 1048576 && sp.dsV41Out === 393216 && sp.dsV41Vis === true ? ok : fail)("DeepSeek V4.1 Flash：1,048,576 / 384K 且**原生视觉**（09-10 发布，官方特性表 Vision 支持 —— 别沿用 V4 的纯文本旧标）");
      (sp.dsFlashCtx === 1048576 && sp.dsFlashVis === true && sp.dsFlashEff === "low/high/max" ? ok : fail)("官方主 id deepseek-flash 与别名同规格；思考强度 low/high/max（默认 high，官方模型&价格页）");
      (sp.dsV4FlashRouted === 1048576 ? ok : fail)("旧名 deepseek-v4-flash 官方声明路由到 V4.1 Flash —— 规格必须按 V4.1（1M/视觉）算，不能留在旧纯文本规则里");
      (sp.k3 === 1000000 && sp.k3Vis === true && sp.k3256 === 262144 ? ok : fail)("Kimi K3：1M + **原生视觉**（K3 首次支持）；K3-256k 省额度档 262K");
      (sp.glm53Vis === false && sp.glm53fVis === true ? ok : fail)("GLM-5.3 纯文本、只有 GLM-5.3-Flash 是原生多模态（别把整个家族标成视觉）");
      (sp.qwen38 === 1000000 && sp.qwen38Video === true ? ok : fail)("Qwen3.8-Max：约 1M / 文本+图像+视频");
      (sp.nova === 131072 && sp.novaVis === true ? ok : fail)("日日新 SenseNova 6.5：128K / 图文视频输入（用户自己的供应商也在表里）");
      (sp.unknown === null ? ok : fail)("未收录的模型返回 null（拿不准就不编 —— 用户手填 + 外部 JSON 可覆盖）");
      (Array.isArray(sp.sugGpt56) && sp.sugGpt56[0] === "gpt-5.6" && sp.sugGpt56.includes("gpt-5.6-sol") ? ok : fail)("补全：完全相等优先（打 gpt-5.6 先出别名本身，再出 Sol/Terra/Luna）");
      (sp.sugEmpty >= 5 ? ok : fail)("补全：空输入给当前主流型号（新手上来不用背名字）");
      (sp.sugDeepseek === "deepseek-flash" ? ok : fail)("补全：表内顺序 = 新旗舰在前（打 deepseek 先看到 V4.1 Flash 官方主 id deepseek-flash）");
      (sp.fmt === "1.05M/262K" ? ok : fail)("formatTokenCount：1.05M / 262K（徽标文案）");
    }
  }

  const appTs = readAppUi();
  // ---- 09-18 生图模型内置规格表 + 生图插件 Tab 补全：真跑 image-model-specs.ts ----
  //  为什么用行为断言而不是查字符串：这批数字（尺寸/参考图/质量档）是**给用户看的承诺**，
  //  字符串守卫只能证明"代码里写着"，证明不了"匹配逻辑真能命中"（假绿高发区）。
  {
    const imgUrl = pathToFileURL(join(ROOT, "src", "lib", "image-model-specs.ts")).href;
    let im = null;
    try {
      const probe = spawnSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        `import * as m from ${JSON.stringify(imgUrl)};` +
        `const S = (id) => m.matchImageSpec(id);` +
        `console.log(JSON.stringify({` +
        ` flare: S("gpt-image-2.5-flare"), g2: S("gpt-image-2"), g2Dated: S("gpt-image-2-2026-04-21") ? 1 : 0,` +
        ` sunburst: S("gpt-image-2.5-sunburst") ? 1 : 0,` +
        ` seed45: S("seedream-4.5"), seed5lite: S("seedream-5-lite"), seed5pro: S("seedream-5-pro"),` +
        ` nb2: S("nano-banana-2"), nbPro: S("nano-banana-pro"), flux: S("flux-2-pro"),` +
        ` imagen: S("imagen-4-ultra"), qwen: S("qwen-image-3.0-pro"), unknown: S("totally-unknown-xyz"),` +
        ` badges: m.imageSpecBadges(S("gpt-image-2.5-flare")).map((b) => b.text),` +
        ` hint: m.imageSpecHint(S("gpt-image-2.5-flare")),` +
        ` emptyHint: m.imageSpecHint(null),` +
        ` sugEmpty: m.suggestImageModelIds("").length,` +
        ` sugFlare: m.suggestImageModelIds("gpt-image-2.5").map((e) => e.id),` +
        ` sugSeed: m.suggestImageModelIds("seedream").map((e) => e.id),` +
        ` tier: m.sideTierLabel(3840) + "/" + m.sideTierLabel(2048),` +
        ` rows: m.buildImageModelRows("gpt-image-2.5", ["my-relay-flare", "gpt-image-2.5-relay-x"]),` +
        ` }));`,
      ], { encoding: "utf8" });
      im = JSON.parse(probe.stdout.trim().split("\n").at(-1));
    } catch { /* 下面统一判红 */ }
    (im ? ok : fail)("【41】image-model-specs.ts 可被 Node type-stripping 直接加载（生图规格守卫跑的是真表）");
    if (im) {
      const flare = im.flare ?? {};
      (JSON.stringify(flare.sizes) === JSON.stringify(["1024x1024", "1536x1024", "1024x1536"]) && flare.maxRefs === 16
        ? ok : fail)("【41】GPT Image 2.5：三个官方常用尺寸 + 参考图 ≤16 张（改图能力是它的卖点之一）");
      (flare.custom && flare.custom.step === 16 && flare.custom.maxSide === 3840 && flare.custom.maxPixels === 8294400
        ? ok : fail)("【41】GPT Image 2.5 自定义尺寸规则：16 倍数 / 单边 ≤3840 / 总像素 ≤8,294,400（与 harness-media 的 checkSize 同口径）");
      (Array.isArray(flare.qualities) && flare.qualities.includes("xhigh") && flare.qualities.includes("max")
        ? ok : fail)("【41】2.5 代质量档含 xhigh/max；2 代没有 —— 跨代差异必须分开写，别把 2.5 的档位安到 2 代上");
      (Array.isArray(im.g2?.qualities) && !im.g2.qualities.includes("xhigh") && !im.g2.qualities.includes("max")
        ? ok : fail)("【41】GPT Image 2 的质量档只到 high（安上 xhigh/max 会让用户传出不存在的档位）");
      (im.g2Dated === 1 && im.sunburst === 1 ? ok : fail)("【41】Flare / Sunburst / dated 快照都能命中同一条规则（网关常按快照名给模型）");
      (im.seed45?.maxRefs === 14 && im.seed45?.custom?.maxSide === 4096 && !(im.seed45?.tiers ?? []).includes("1K")
        ? ok : fail)("【41】Seedream 4.5：参考图 ≤14、自定义单边 ≤4096、**不支持 1K**（官方明确 1K 不提供）");
      (im.seed5lite?.maxRefs === 14 && im.seed5pro?.maxRefs === 10 ? ok : fail)("【41】Seedream 5 Lite ≤14 张参考图、5 Pro ≤10 张（代际差异）");
      (im.nb2?.maxSide === 4096 && im.nbPro?.maxSide === 4096 ? ok : fail)("【41】Nano Banana 2 / Pro：原生 4K");
      (im.flux?.custom?.step === 16 && im.flux?.custom?.maxPixels === 4194304 ? ok : fail)("【41】FLUX.2：边长 16 倍数、最高 4MP（约 2048×2048）");
      (im.imagen?.maxSide === 2048 && im.qwen?.maxSide === 2048 ? ok : fail)("【41】Imagen 4 / Qwen-Image：单边上限 2K");
      (im.unknown === null ? ok : fail)("【41】未收录的生图模型返回 null（拿不准就不编参数 —— 少显示一个徽标，胜过显示一个错的）");
      (Array.isArray(im.badges) && im.badges.length > 0 && im.badges.some((b) => /改图/.test(b)) && im.badges.some((b) => /质量/.test(b))
        ? ok : fail)("【41】列表徽标把「尺寸 / 改图 / 质量档」都摊开了（用户不点进去就能比）");
      (Array.isArray(im.hint) && im.hint.length > 0 && im.hint.some((l) => /尺寸/.test(l)) && JSON.stringify(im.emptyHint) === "[]"
        ? ok : fail)("【41】字段下方参数说明：命中内置表才有内容，未命中不显示（不给未知模型编参数）");
      (im.sugEmpty >= 6 ? ok : fail)("【41】补全：空输入给当前热门生图模型（新手不用背名字）");
      (Array.isArray(im.sugFlare) && im.sugFlare.length === 2 && im.sugFlare[0] === "gpt-image-2.5-flare"
        ? ok : fail)("【41】补全：打 gpt-image-2.5 先出 Flare（表内顺序 = 热门在前）");
      (Array.isArray(im.sugSeed) && im.sugSeed.length >= 3 && im.sugSeed[0] === "seedream-5-pro"
        ? ok : fail)("【41】补全：打 seedream 出 5 Pro / 5 Lite / 4.5（前缀命中保持表内顺序）");
      (im.tier === "4K/2K" ? ok : fail)("【41】像素→档位文案：3840→4K、2048→2K（徽标不糊大数字）");
      // 候选行构造 = 真代码行为断言（组件里的分支守卫挡不住 if(false)，所以抽成纯函数后直跑）
      const rows = Array.isArray(im.rows) ? im.rows : [];
      (rows.length > 0 && rows[0]?.id === "gpt-image-2.5-flare" && rows[0]?.spec
        ? ok : fail)("【41】生图候选行构造真跑通（内置表命中且带参数，不是空列表）");
      (rows.some((r) => r.probed && r.id === "gpt-image-2.5-relay-x" && r.spec)
        ? ok : fail)("【41】网关探测到的 id 也过规格表（接入点名里带官方型号时照样有参数徽标）");
      (rows.some((r) => r.probed && r.id === "my-relay-flare" && !r.spec)
        ? ok : fail)("【41】认不出的探测 id 不带参数徽标（不猜）");

      const imgSpecsSrc = readFileSync(join(ROOT, "src", "lib", "image-model-specs.ts"), "utf8");
      (/suggestImageModelIds/.test(imgSpecsSrc) && /IMAGE_MODEL_CATALOG/.test(imgSpecsSrc))
        ? ok("【41】规格表导出补全入口（候选来自内置表，不靠硬编码列表）")
        : fail("【41】image-model-specs 缺补全入口 —— 输入框拿不到候选");

      const pluginsSrc = readFileSync(join(ROOT, "src", "components", "BuiltinPlugins.tsx"), "utf8");
      (!/datalist/.test(pluginsSrc))
        ? ok("【41】内置插件页的原生 datalist 已移除（换成支持 Tab 补全 + 参数徽标的 ModelIdInput）")
        : fail("【41】内置插件页又有 datalist —— 生图模型字段没有 Tab 补全");
      // ⛔ 不能用 `<ModelIdInput[^>]*` 这类正则：属性里的箭头函数 `=>` 会在第一个 `>` 处截断
      //   （09-18 实测：守卫因此假红）。分开断言「元件在位」与「variant 取值」。
      (/<ModelIdInput\b/.test(pluginsSrc)
        // 09-28：内置插件页改「字段直接摊开」后，区分口径的变量名从 active 变成 kind
        // ⇒ 锚点同时接受两者（判据本意是「按生图/聊天取不同参数口径」，不是变量叫什么）
        && /variant=\{(?:active|kind) === "image" \? "image" : "chat"\}/.test(pluginsSrc))
        ? ok("【41】插件模型字段按类型取参数口径（生图=尺寸/改图/质量档，视觉=上下文/图片）")
        : fail("【41】插件模型字段没接 ModelIdInput 或没区分生图/聊天口径");
      (/imageSpecHint\(matchImageSpec\(value\.model\)\)/.test(pluginsSrc))
        ? ok("【41】选中内置生图模型后摊开参数说明（尺寸 / 改图 / 质量档）")
        : fail("【41】生图模型参数没显示出来 —— 用户选了模型仍不知道能出多大、能不能带参考图");

      const inputSrc = readFileSync(join(ROOT, "src", "components", "ModelIdInput.tsx"), "utf8");
      // ⛔ 锚定**活分支**而不是「文件里出现过 variant === "image"」：后者在别处（探测项三元）
      //   也出现，`if (false)` 变异照样绿（09-18 反证 F 当场抓到）。
      (/if \(variant === "image"\) \{/.test(inputSrc) && /buildImageModelRows\(value, extraIds\)/.test(inputSrc) && /imageSpecBadges/.test(inputSrc))
        ? ok("【41】ModelIdInput 的生图变体真走生图候选行（同一套 Tab/↑↓/Esc 交互契约）")
        : fail("【41】ModelIdInput 的生图分支被架空 —— 生图字段拿不到带参数的候选");
      // 浮层方向 + 高度：只判方向的实现会在弹窗里被裁（09-18 e2e 实测：上弹后顶部超出弹窗 7px、首行被切）
      (/upward/.test(inputSrc) && /bottom: calc\(100% \+ 6px\)/.test(readStyles()))
        ? ok("【41】候选浮层在底部空间不足时向上弹（插件弹窗 overflow:auto 会把向下弹的列表裁掉）")
        : fail("【41】候选浮层不会上弹 —— 在弹窗底部会被裁掉，用户看不到候选");
      (/getComputedStyle\(node\)/.test(inputSrc) && /popMax/.test(inputSrc) && /style=\{\{ maxHeight/.test(inputSrc))
        ? ok("【41】浮层高度按「最近裁剪祖先」的可用空间封顶（只判方向会让上弹的列表顶出弹窗）")
        : fail("【41】浮层高度没按可用空间封顶 —— 上弹时首行候选会被弹窗切掉");
    }
  }

  const applyEffortBody = appTs.slice(appTs.indexOf("function applyEffort"), appTs.indexOf("function changeEffort"));
  (applyEffortBody.includes("setProviderEffort") ? ok : fail)("applyEffort 会把档位写进档案（跟着模型保存的写入端）");
  (!applyEffortBody.includes("!threadRef.current?.id && customModel") ? ok : fail)("写档案不再被「无会话」条件挡住（旧守卫 = 二次保存 bug 的根源）");
  (appTs.includes("const archiveEffort = (customModel?.models ?? []).find((m) => m.id === next?.model)?.effort") ? ok : fail)("chooseModel 切模型时读档案 models[].effort（读取端）");
  // 09-18：模型档位声明（models[].efforts）随模型配置里的勾选区一起删除 —— 档位是**会话级**选择，
  // 不再 upsert 补声明。副作用要守：旧实现每次选到"未声明档位"都重写 model-catalog.json，
  // 而 current 是过期闭包（09-16 真机定位的档案回退第二个根源）——现在整段逻辑没了，反而更安全。
  (!appTs.includes("efforts: [...(current.efforts ?? []), value]") ? ok : fail)("changeEffort 不再 upsert 补档位声明（09-18：档位不是模型属性，选不了就直接自动降档）");
  (appTs.includes('xhigh: "极高"') && appTs.includes('ultra: "最高"') && appTs.includes('low: "低"') && appTs.includes('medium: "中"') && appTs.includes('high: "高"') ? ok : fail)("展示名：低/中/高/最高/极高（极高=xhigh 顶格档，最高=ultra 扩展档）");
  (appTs.includes("极高: \"xhigh\"") ? ok : fail)("/effort 命令别名含「极高」");

  const mainTs = readMainSource();
  (mainTs.includes('m.efforts?.length ? m.efforts : ["minimal", "low", "medium", "high", "ultra", "xhigh", "max"]') ? ok : fail)("catalog：空数组声明也回退全档位（探测合并会写 efforts: []，旧实现会声明出空档位表）");
  (mainTs.includes('["low", "medium", "high"].every((e) => efforts.includes') ? ok : fail)("catalog：旧版三档声明同步补「极高」（与 UI 同规则）");

  const bridgeTs = readResponsesBridgeSource();
  (bridgeTs.includes('effort === "xhigh" || effort === "ultra" ? "high" : effort') ? ok : fail)("桥：chat 上游把 xhigh/ultra 压到 high（网关不认扩展档）");
}

// ---------- 【26】打包瘦身：浏览器内核不随包 + 国内镜像按需下载 ----------
// 背景：安装包 900MB 的头号元凶是随包内置的两套 Chromium 内核（pw-browsers ~700MB +
// cloak-cache ~536MB 原始体积），而应用本来就有「开发工具」页的按需下载入口。
// 09-16 起内核不再打进包，改为下载时默认走国内镜像、失败回落官方源。这里守三件事：
// ① extraResources / mac copy 不得把内核目录又塞回包里（体积回潮守卫）；
// ② 镜像常量必须在（没有它，国内用户下载会退回龟速官方源）；
// ③ 主进程两条下载分支都必须走 runBrowserDownload（镜像优先 + 官方源回落），
//    谁直接 spawn 官方源 = 绕过加速，同样算回归。
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const extraFrom = (pkg.build?.extraResources ?? []).map((entry) => entry.from ?? entry);
  // ⛔ 体积口径（10-01 用户定稿）：**下载体积 >50MB 的一律不随包**，≤50MB 的一律随包。
  //   这份「不该随包」清单 = 大件（pwsh 282 / git 90 / ffmpeg 307 / miniconda 100 / mingw 267）
  //   + 两个浏览器内核（170 / 200）。小件随包由下面的 positive 断言盯（少一条 = 空壳包）。
  const unbundled = [
    "resources/tools/pw-browsers",
    "resources/tools/pwsh", "resources/tools/git", "resources/tools/ffmpeg",
    "resources/tools/miniconda", "resources/tools/mingw",
    // 知识库本地 embedding 后端（10-04 改判）：npm 树解压实测 463MB（裁剪后仍 ~85MB + 模型 23MB），
    // 早先「35MB 内置」只算了模型 ⇒ 改回按需下载（知识库页 / 开发工具页），负向断言防体积回潮。
    "resources/tools/kb-embedding",
  ];
  for (const source of unbundled) {
    (!extraFrom.includes(source) ? ok : fail)(`package.json extraResources 不随包内置 ${source.replace("resources/tools/", "")}（体积回潮守卫）`);
  }
  (extraFrom.includes("resources/tools/node") ? ok : fail)("node 仍随包内置（安装器引导运行时，缺了其余工具都装不了）");
  (Array.isArray(pkg.build?.files) && pkg.build.files.some((pattern) => String(pattern).includes("mermaid") && String(pattern).endsWith(".map")) ? ok : fail)("asar 打包排除 mermaid 的 sourcemap（-25MB 纯赚）");
  const copyMac = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (copyMac.includes('NOT_BUNDLED = new Set(["pw-browsers"])') && copyMac.includes("NOT_BUNDLED.has(path.basename(entry))") ? ok : fail)("mac copy-mac-tools 复制 tools 时跳过 Playwright 内核目录");
  const toolchainTs = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (!/PLAYWRIGHT|pw-browsers/.test(toolchainTs) ? ok : fail)("toolchain：Playwright 内核环境/路径已移除（浏览器自动化改 Ego Lite + nuphus 回落）");
  (toolchainTs.includes("export function egoBrowserPath()") && toolchainTs.includes("active_version_dir") && toolchainTs.includes('env.EGO_BROWSER_PATH = egoCli') && !/CLOAKBROWSER_(ENTRY|CACHE_DIR|DOWNLOAD_URL)/.test(toolchainTs) ? ok : fail)("toolchain：Ego Lite 双平台检测 + 引擎 PATH/EGO_BROWSER_PATH 注入；Cloak 环境已清除");
  const mainTs26 = readMainSource();
  (!/runBrowserDownload|playwright-browsers/.test(mainTs26) ? ok : fail)("main.ts：Playwright 内核下载链已整体移除");
  (!/runBrowserDownload|playwright-browsers/.test(mainTs26) ? ok : fail)("main.ts：Playwright 内核下载分支已移除（不再有第二套浏览器内核）");
  const browserIpcSrc = readFileSync(join(ROOT, "electron", "features", "browser-ipc.ts"), "utf8");
  (browserIpcSrc.includes('ipcHost.handle("browser:ego-status"') && browserIpcSrc.includes('ipcHost.handle("browser:ego-install"') && browserIpcSrc.includes('ipcHost.handle("browser:ego-cleanup"') && !browserIpcSrc.includes("browser:open-cloak") && !browserIpcSrc.includes("browser:cloak-status") ? ok : fail)("browser-ipc：Ego Lite 检测/安装/打开/升级/回收 Space，Cloak 通道已移除");
  // ⛔ 09-16 安装包瘦身：大件工具转按需下载；10-01 用户改口径「50m 以内的都内置」⇒
  //    pwsh/git/ffmpeg/conda/mingw 这些**大件**仍不得 builtIn（否则安装包暴涨），
  //    而 ≤50MB 的小件（python/rg/jq/ninja/7zip/yt-dlp/uv/cmake/adb）**必须** builtIn。
  (mainTs26.includes("devRuntimeSpecs")
    && !/pwsh: \{[^}]*builtIn: true/.test(mainTs26)
    && !/git: \{[^}]*builtIn: true/.test(mainTs26)
    && !/ffmpeg: \{[^}]*builtIn: true/.test(mainTs26)
    && !/conda: \{[^}]*builtIn: true/.test(mainTs26)
    && !/mingw: \{[^}]*builtIn: true/.test(mainTs26)
    && /python: \{[^}]*builtIn: true/.test(mainTs26)
    && /rg: \{[^}]*builtIn: true/.test(mainTs26)
    && /"platform-tools": \{[^}]*builtIn: true/.test(mainTs26) ? ok : fail)(
    "main.ts：大件（pwsh/git/ffmpeg/conda/mingw）按需下载，小件（python/rg/adb…）随包内置 —— 50MB 口径");
  // ⛔ 内置项必须真的随包：extraResources 少一条 = 用户端卡片显示「内置」却找不到文件（electron-builder 静默跳过）
  const erTo = (pkg.build?.extraResources ?? []).map((entry) => entry.to);
  (["tools/python", "tools/rg", "tools/uv", "tools/jq", "tools/ninja", "tools/sevenzip", "tools/yt-dlp", "tools/cmake", "tools/platform-tools"]
    .every((to) => erTo.includes(to)) ? ok : fail)(
    "package.json：内置小工具的 extraResources 一条不少（漏了 = 发出去是空壳包）");
  (mainTs26.includes("toolRootsRead()") && /watchFs\(toolsDir, \{ recursive: true \}/.test(mainTs26) && mainTs26.includes('message: "开发工具目录已更新", auto: true') ? ok : fail)("main.ts：随包 + userData 两个 tools 目录都监视 → 引擎自己装工具后界面自动刷新");
  const installRuntimes = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (installRuntimes.includes("https://cdn.npmmirror.com/binaries/node/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/python/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/git-for-windows/") ? ok : fail)("install-runtimes：node/python/git 走 npmmirror 国内镜像（有镜像源的不该是龟速官方源）");
  // 【242】开发工具的**卸载要真删**（10-01 用户报「卸载不真」：点了卸载还显示已装）。
  //   根因：npm 类工具（nuphus / playwright-cli / cloakbrowser）的 marker 形如
  //   `npm-global\node_modules\@nuphus\nuphus-mcp\package.json`，旧实现只删 `npm-global/nuphus-mcp`
  //   —— 那是个**shim 文件**，包体 `node_modules/@nuphus` 原地不动，于是卸载后 marker 依然命中。
  //   反证：把包体路径改回 marker 首段推导 → 断言必须红。
  {
    const rt = codeOnly(readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8"));
    const hasMap = /NPM_PACKAGE_ARTIFACTS[^=]*=\s*\{[\s\S]*?nuphus:\s*\{[^}]*node_modules\/@nuphus[\s\S]*?rea:\s*\{[^}]*node_modules\/rea-agents/.test(rt);
    hasMap
      ? ok("【242】npm 类工具的卸载落点是**包体目录**（node_modules/@nuphus、rea-agents），不是 marker 首段")
      : fail("【242】npm 类工具的卸载落点又退回 marker 首段推导 —— 删的是 shim 文件，包体还在 ⇒ 卸载后仍显示已装");
    // 10-07 重构：删除动作挪进 removeTargetsWithProgress（分批删 + 发进度，用户要求卸载也要有进度），
    //   **安全校验仍在同一个 for 循环里逐 target 做**，且校验全部通过后才开始删 ——
    //   判据因此改为「逐 target 校验循环 + 紧随其后的分批删除调用」两段都在。
    //   ⛔ 负向不变：少了 allowedRoots.includes 那句（等于允许删 tools 根 / codexHome）必须红。
    (/for \(const target of targets\)[\s\S]{0,600}?allowedRoots\.includes\(resolvedTarget\)[\s\S]{0,600}?await removeTargetsWithProgress\(id, targets\)/.test(rt))
      ? ok("【242】卸载逐个 target 做「必须落在 tools/codexHome 之内、不得等于根」的安全校验，校验通过后才分批删除")
      : fail("【242】卸载没走「逐个 target + 逐个安全校验」—— 少校验会把 tools 根或 codexHome 整个删掉");
    /* ══ 【285】装 / 判 / 卸 三处落点必须**同源**（10-07 用户实测两位数事故）═════════
       症状统一是「卸载不更新状态，一直显示已安装」，但根因是三个地方各写了一份落点：
         ① kb-embedding 装在 <userData>/kb-backend，判定读 kbEmbeddingInstalled()，
            卸载却按 marker 首段推导出 tools/kb-embedding —— **一个不存在的路径**，删了个空气；
         ② npm 类的判定认**全部候选落位**（mac 双布局），卸载只删 npmGlobalRoot() 那一个
            ⇒ 装在另一个落位的包（cloakbrowser）永远删不掉；
         ③ kb-embedding 的常驻 embedding worker 抱着模型文件，通用分批删除在 Windows 上
            EBUSY，而旧代码 try/catch 把失败吞成「删成功」。
       ⇒ 判据：卸载落点必须显式给 kbBackendDir()、npm 落点必须遍历 npmGlobalRootCandidates()、
          kb-embedding 必须走自己的卸载函数（含 dispose worker）、分批删除失败必须抛而不是吞。 */
    (/if \(id === "kb-embedding"\) return \[kbBackendDir\(\)\];/.test(rt)
      && /if \(id === "kb-embedding"\)[\s\S]{0,400}?await uninstallKbEmbedding\(\);/.test(rt)
      && /npmGlobalRootCandidates\(true\)\.flatMap/.test(rt)
      && /if \(failedCount > 0\)[\s\S]{0,300}?throw new Error\(/.test(rt))
      ? ok("【285】卸载落点与安装/判定同源（kb-embedding 走 kbBackendDir + 自带卸载；npm 类遍历全部候选落位；删除失败抛错不吞）")
      : fail("【285】卸载落点与安装/判定不同源 —— 又会出现「卸载了但一直显示已安装」（kb-embedding / cloakbrowser 实测）");
    /* 负向：判定侧既然认双落位，卸载侧就不许退回单落位（npmGlobalRoot() 单值）。
       ⛔ 正向那条已覆盖，这里钉的是「别把 npmGlobalRootCandidates 改回 npmGlobalRoot」。 */
    (!/npmGlobalRootCandidates\(true\)\.flatMap\([\s\S]{0,300}?npmShimPaths\(\.\.\./.test(rt)
      && /function npmShimPaths\(globalRoot: string/.test(rt))
      ? ok("【285】npm 卸载遍历全部候选落位，且 npmShimPaths 显式接根参数（不再内部取单值）")
      : fail("【285】npm 卸载又退回单落位了 —— 装在另一落位的包会「卸载了但仍显示已安装」");
    /* ⛔⛔ 第四层（探针实测才抓到，静态判据看不出来）：`NPM_PACKAGE_ARTIFACTS` 的 dirs
       是相对 **npm-global 前缀** 的（`node_modules/cloakbrowser`），而 npmGlobalRootCandidates()
       返回的落位**已含 node_modules 一段** ⇒ 直接 join 会拼出
       `node_modules/node_modules/cloakbrowser` ⇒ **包体从来就没被删过**（Windows 同样中招）。
       判据 = 必须先取 `path.dirname(root)` 当前缀再 join dirs。 */
    (/npmGlobalRootCandidates\(true\)\.flatMap\(\(root\) => \{\s*const prefix = path\.dirname\(root\);[\s\S]{0,200}?pkg\.dirs\.map\(\(dir\) => path\.join\(prefix, dir\)\)/.test(rt))
      ? ok("【285】npm 包体落点 join 到 npm-global 前缀（否则会拼出 node_modules/node_modules/…，包体永远删不掉）")
      : fail("【285】npm 包体落点又直接 join 到含 node_modules 的落位上 ⇒ 拼出 node_modules/node_modules/… ⇒ 包体从未被删过（cloakbrowser 实测）");
  }
  // 09-20 下载源选择：auto 通道序保持「镜像 → (代理) → 直连 → gh-proxy」，六种源在 switch 里分派
  // 09-20 下载源选择：auto = 国内优先（镜像 → (代理) → gh 加速 → 直连兜底），六种源在 switch 里分派
  (installRuntimes.includes('case "mirror": attempts = mirror ? [["国内镜像 npmmirror", curlArgs.slice(), mirror], ...direct] : [...ghAccels, ...direct]') && installRuntimes.includes('case "ghproxy": attempts = isGh ? [ghAccels[0], ...direct]') && installRuntimes.includes('case "ghfast": attempts = isGh ? [ghAccels[1], ...direct]') && /case "auto":\s*\n\s*default: attempts = \[\s*\n\s*\.\.\.\(mirror \? \[\["国内镜像 npmmirror", curlArgs\.slice\(\), mirror\]\] : \[\]\),\s*\n\s*\.\.\.viaProxy,\s*\n\s*\.\.\.ghAccels,\s*\n\s*\.\.\.direct,/.test(installRuntimes) ? ok : fail)("install-runtimes：下载通道按所选源分派（auto = 国内优先：镜像 → (代理) → gh 加速 → 直连兜底）");
  // 【241】内置 Python 必须是**完整版**（10-01 用户机器实录：装 Laya 报 `No module named pip`）。
  //   旧链两处断裂：① 官方 python-3.13.x-amd64.exe /quiet 在部分机器**静默空转**
  //   （exit 0 但 TargetDir 为空 ⇒ 复制 Tk 组件抛错 ⇒ 连坐整条安装链，pip 引导根本没跑）；
  //   ② get-pip.py 走 bootstrap.pypa.io（国内不稳）。现换 python-build-standalone 整包
  //   （自带 pip 模块 + Tkinter 全家）+ 本地 ensurepip；判定按结构锚（不看固定字符窗口）。
  {
    const irNoComment = codeOnly(installRuntimes);
    (irNoComment.includes("python-build-standalone") && irNoComment.includes("winPythonHealthy") && /ensurepip --default-pip/.test(irNoComment) ? ok : fail)(
      "【241】内置 Python 走 python-build-standalone 完整版 + ensurepip 离线补 pip（自带 Tkinter，不再靠 exe 安装器补）"
    );
    (!/PYTHON_FULL_URL|get-pip\.py|embed-amd64\.zip/.test(irNoComment) ? ok : fail)(
      "【241】旧的 embeddable zip / 官方 exe 安装器 / 联网 get-pip 三条链不许复活（exe 静默空转＝用户机器上 pip 装不上的根因）"
    );
    const dr241 = codeOnly(readFileSync(join(ROOT, "electron", "features", "dev-runtimes.ts"), "utf8"));
    // ⛔ 10-08：锚点由 `if (id === "python" && !IS_MAC)` 改成平台无关的 `if (id === "python")`
    //    （mac 半边补齐：原判据把 darwin 排除在外，只查 python/bin/python3 一个文件 ⇒
    //     与 Windows 侧同一个「坏安装显示已安装」的坑在 mac 上原样存在）。
    const pyBranchStart = dr241.indexOf('if (id === "python") {');
    const pyBranchEnd = dr241.indexOf("if (PIP_PACKAGE_DIRS[id])");
    const pyBranch = pyBranchStart >= 0 && pyBranchEnd > pyBranchStart ? dr241.slice(pyBranchStart, pyBranchEnd) : "";
    (pyBranch.includes("pythonSiteDir(dir)") && pyBranch.includes('"pip", "__init__.py"') && pyBranch.includes("_tkinter.pyd") && pyBranch.includes("python.exe") && pyBranch.includes("IS_MAC") ? ok : fail)(
      "【241】「Python 装没装」两平台都必须含 pip 模块（Windows 另需 _tkinter）—— 只看可执行文件 ⇒ 坏安装显示「已安装」、卡片连修复入口都没有"
    );
  }
  /* 【243】工具安装的两条硬不变量（10-02 外部用户报障：所有工具都卡在 `@STAGE 解压 [fail] "tar"`）。
     ⛔ 事故 ①（解压器）：解压器原来硬编码 `C:\Windows\System32\tar.exe`，系统盘不是 C: 或精简版
        Windows 取不到就回落到裸 `tar`，而多数机器 PATH 上没有 tar ⇒ 走归档的工具**全部**失败，
        报错还被截成两个字的 `"tar"`。
     ⛔ 事故 ②（坏缓存）：`archiveReady()` 判出缓存坏了，却直接 `download()`，而它用
        `curl --continue-at -` **续传** —— 续传只补尾巴，「体积对、内容坏」的文件永远修不好，
        用户点多少次都是「续传 0 字节 → 进度瞬间 100% → 用同一个坏包解压 → 失败」。
     ⛔ 事故 ③（随包 7-Zip 是空壳）：主通道下的是 `7zr.exe`（**精简版，只认 7z 格式**）并改名成
        7z.exe ⇒ 随包「7-Zip CLI」对有效 zip / tar.gz 一律返回 2（实测格式表里没有 zip/gzip/tar）。
     三条都只在真机 + 真网络下才暴露，必须靠守卫钉住结构（锚「接线形态」，不锚注释）。 */
  {
    const ir = codeOnly(installRuntimes);
    // ① 解压器解析要跟随真实系统盘 + 扫 PATH，且报错要能说清现状
    (ir.includes("SystemRoot") && ir.includes("function findOnPath") && ir.includes("function extractorHint") ? ok : fail)(
      "【243】解压器按 %SystemRoot%/System32 → C:/Windows/System32 → 扫 PATH 解析（不再硬编码 C:、不再裸 `tar`）"
    );
    // ② 三级降级：bsdtar → 7z → PowerShell Expand-Archive（零依赖兜底，仅 zip）
    (ir.includes("function extractArchive") && ir.includes("Expand-Archive") && ir.includes("-NoProfile -NonInteractive") ? ok : fail)(
      "【243】解压有三级降级：系统 tar → 7-Zip → Windows 自带 PowerShell Expand-Archive（零依赖兜底）"
    );
    // ③ 坏缓存必须**先删再下**，且下载完再校验一次（不许对坏文件续传）
    (/archiveReady\(zip\)[\s\S]{0,220}?fs\.rmSync\(zip/.test(ir) && ir.includes("下载完成的压缩包校验不通过") ? ok : fail)(
      "【243】缓存校验不过先删再完整重下 + 下载后再校验一次（对坏文件续传会让用户永远装不上）"
    );
    // ④ 随包 7-Zip 必须是完整版（7za.exe），不许退回只认 7z 的 7zr
    (ir.includes("x64") && ir.includes('"7za.exe"') && !ir.includes("7zr.exe") ? ok : fail)(
      "【243】7-Zip 取 extra 包的 x64/7za.exe 完整版（旧链下的是 7zr 精简版，读不了 zip/tar.gz）"
    );
    const prep = codeOnly(readFileSync(join(ROOT, "scripts", "prepare-windows-tools.cjs"), "utf8"));
    (prep.includes("sevenzip/7za.exe") ? ok : fail)(
      "【243】构建期必备件清单盯 sevenzip/7za.exe（盯 7z.exe 会把只认 7z 的空壳 7-Zip 发出去）"
    );
    // ⑤ 归档校验不许再用体积当完整性判据：ninja 的 zip 只有 **285KB**，旧判据「小于 1MB 即坏包」
    //    会让它「删缓存 → 重下 → 还是坏 → 失败」，10-02 CI 的 win/mac 两个 job 同时挂在这。
    const arBody = ir.slice(ir.indexOf("function archiveReady"), ir.indexOf("function liftUp"));
    (arBody.length > 0 && !/1024 \* 1024/.test(arBody) ? ok : fail)(
      "【243】归档校验不拿「>1MB」当完整性判据（小体积归档会被误杀成坏包）"
    );
    /* ⑥ 每个「手写解压」的工具分支都不许绕开共享纪律（10-08 用户报「MinGW 下载失败」）：
       MinGW 那一支曾直接调 BSDTAR（无三级降级）、且对坏缓存走 `--continue-at -` 续传
       （**续传只补尾巴，坏文件永远修不好**）⇒ 现场特征 = 临时目录里躺着完好的 zip、而
       tools/mingw 连目录都没建。判据锚**接线取值**（剥注释后仍出现的事实），不锚注释。 */
    const mingwBranch = ir.slice(ir.indexOf('if (want("mingw")) {'), ir.indexOf('if (fs.existsSync(path.join(nodeDir, "node.exe")))'));
    (mingwBranch.includes("await extractArchive(zip, dir, false,") && mingwBranch.includes("已删除，改为完整重新下载")
      && mingwBranch.includes("MinGW 解压完成但找不到") ? ok : fail)(
      "【243】MinGW 安装支比照 install() 办理：坏缓存先删 → 下载后再校验 → 走共享三级降级 extractArchive → 装完复核 marker（不再只调 BSDTAR、不再对坏缓存续传）"
    );
  }

  /* 【244】pip 多源兜底 + 工具自检（10-02 用户报障：清华镜像的 wheel 直链 403 ⇒ 文档转换 / 手机控制 /
   *   Laya 三处全挂，用户看到的是「HTTP error 403」这种跟他操作无关的报错）。
   *   ⛔ 根因不是「源挂了」而是**只有一个源**：pip 下载 wheel 失败**不会**自动换 index
   *     （`--extra-index-url` 也不救），必须整个命令换源重跑 ⇒ 必须有兜底表 + 逐源重试。
   *   ⛔ 任何一处退回「写死单源」都等于那个工具永远只试清华 —— 所以逐文件钉住。 */
  {
    const psSrc = readFileSync(join(ROOT, "electron", "features", "pip-sources.ts"), "utf8");
    const srcCount = (psSrc.match(/https:\/\/[^"'`\s]+/g) || []).length;
    (srcCount >= 3 ? ok : fail)(`【244】pip 源兜底表 ≥3 个源（实 ${srcCount} 个；单源必被镜像抖动打死）`);
    const inst = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
    (inst.includes("async function pipInstall(") ? ok : fail)("【244】install-runtimes 有 pipInstall 多源兜底函数");
    (inst.includes("PIP_INDEXES.length") ? ok : fail)("【244】安装器按兜底表长度逐源重试（不是只试一个就报错）");
    // ⛔ 负向：不许再出现「写死单源」的 pip install —— 漏一处就等于那个工具永远只试清华
    const soloPip = (inst.match(/pip install[^\n]*pypi\.tuna\.tsinghua\.edu\.cn/g) || []).length;
    (soloPip === 0 ? ok : fail)(`【244】install-runtimes 无写死单源的 pip install（实 ${soloPip} 处）`);
    const laya = readFileSync(join(ROOT, "electron", "features", "laya-service.ts"), "utf8");
    const phone = readFileSync(join(ROOT, "electron", "features", "phone-harness.ts"), "utf8");
    (laya.includes("LAYA_PIP_SOURCES") && phone.includes("PHONE_PIP_SOURCES") ? ok : fail)("【244】Laya / 手机控制都走多源兜底表");
    (laya.includes("runPip(") && phone.includes("runPip(") ? ok : fail)("【244】Laya 与手机控制的失败路径都会换源重跑（不是单源硬失败）");
    // 工具自检：用户明确要的「检查」——必须是**真跑**，不能只查文件在不在
    const rt = readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8");
    (/(?:ipcMain|ipcHost)\.handle\("runtime:health"/.test(rt) ? ok : fail)("【244】存在工具自检 IPC（runtime:health）");
    (rt.includes("function probeTool(") && rt.includes("child.on(\"close\"") ? ok : fail)("【244】自检是真跑版本命令（不是只查文件在不在）");
    (rt.includes('if (spec.kind === "guide") continue;') ? ok : fail)("【244】自检跳过系统级安装项（Docker / OpenSSL 我们没装，无从探测）");
  }
  /* 【286】「装完不更新」的整类根因（10-08 用户报「开发工具安装完不更新」，markitdown 实测确证）。
     ⛔⛔ 三个口径各自为政 ⇒ 卸载后进入**不可恢复**状态：
        · 判定（runtimeInstalled）看 site-packages 里的**包目录**；
        · 安装动作（pip install）看 **dist-info 元数据**；
        · 卸载（runtimeUninstallTargets）只删**包目录**、留下 dist-info。
     于是：卸载 → 只剩 <name>-<ver>.dist-info → 重装时 pip 回一句 `Requirement already satisfied`
     然后 **exit 0 什么都不做** → 脚本/安装器一路报成功 → 界面「开发工具安装成功」+ 卡片仍显示
     「下载」，**点多少次都一样**（实测：包目录 83 个文件全丢，`import markitdown` 报
     ModuleNotFoundError 而 `pip show markitdown` 说装着）。markitdown / laya / phone-harness
     三个 pip 包共用这条链。⇒ 判据锚**接线取值**（剥注释后仍出现的事实），不锚注释。 */
  {
    const dr286 = codeOnly(readFileSync(join(ROOT, "electron", "features", "dev-runtimes.ts"), "utf8"));
    const rt286 = codeOnly(readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8"));
    const ir286 = codeOnly(readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8"));
    (dr286.includes("function pipMetadataDirs(") ? ok : fail)(
      "【286】pip 包元数据目录有单一真相源（dev-runtimes.pipMetadataDirs：<name>-<ver>.dist-info / *.egg-info）"
    );
    const pipAnchor286 = rt286.indexOf("const pipDir = PIP_PACKAGE_DIRS[id]");
    const pipBranch286 = pipAnchor286 >= 0 ? rt286.slice(pipAnchor286, pipAnchor286 + 400) : "";
    (pipBranch286.includes("pipMetadataDirs(site, pipDir)") ? ok : fail)(
      "【286】卸载 pip 包必须连元数据一起删（只删包目录 ⇒ 残留 dist-info ⇒ pip 判 already satisfied 空转 ⇒ 永远装不回来）"
    );
    (ir286.includes("function stalePipMetadata(") && /stalePipMetadata\(site, \["markitdown"\]\)/.test(ir286) ? ok : fail)(
      "【286】安装脚本装前清孤儿元数据（与 dev-runtimes.pipMetadataDirs 同一套规则：主进程 TS 与纯 Node 脚本各一份，改一处必须同步另一处）"
    );
    (ir286.includes("仍没有 markitdown 包目录") ? ok : fail)(
      "【286】安装脚本装完必须复核包目录（pip 的 exit 0 只说明命令跑完了，不说明东西装上了）"
    );
    const verifyCalls286 = (rt286.match(/assertInstallVerified\(id, spec\)/g) || []).length;
    (rt286.includes("function assertInstallVerified(") && verifyCalls286 === 3 ? ok : fail)(
      `【286】runtime:install 的三条真实安装路径都回读 runtimeInstalled（实际 ${verifyCalls286} 处，应为 3：kb-embedding / laya+phone-harness / 通用；guide 与 builtIn 早退不算）——「安装成功」必须与卡片同源`
    );
  }
  // 09-16 下午：自动化包与 ponytail 改为「随包预解压直装」（用户「直接内置，不用解压啥的」）——
  // npm-global 必须进 extraResources（缺了等于回到「要点安装才解压」），zip 保留作修复备用；
  // ⛔ 09-27 起 ponytail **不再启动自动种**（用户：「ponytail 写的代码很烂、以后谁还写代码」；
  //    且与引擎初始化原则「一切拓展按需安装」相悖——自动种让每个新会话多注入 ~640 token）。
  //    改为开发工具页手动安装（runtime:install id=ponytail 保留）；已装用户不受影响。
  (extraFrom.includes("resources/tools/npm-global") ? ok : fail)("package.json extraResources 随包预解压 npm-global（自动化包开箱即用，不用点安装解压）");
  (extraFrom.includes("resources/tools/automation-tools.zip") ? ok : fail)("automation-tools.zip 仍随包（修复备用：重新解压即可恢复）");
  (extraFrom.includes("resources/tools/ponytail-plugin") ? ok : fail)("ponytail-plugin 仍随包（手动安装源，开发工具页用）");
  // ⛔ 负向断言（结构性，变异验证过）：boot.ts 里**无条件**的 ensurePonytailPlugin 不许出现。
  //    ⛔ 必须过 codeOnly 剥注释：boot.ts 头注释里会提到这个符号，裸 includes 会被注释顶成假红。
  //    ★ 10-30 事故后放宽**一个且仅一个**形态：引擎 0.16x 要求 marketplace 目录带清单文件，
  //      旧布局被丢 ⇒ 插件/技能/钩子一起消失、控制台开关假死。允许「写代码模式 ≠ off」时
  //      在启动阶段补齐市场段（先落盘，再启动引擎）——⛔ 必须紧跟在 getPonytailMode() 判断之后，
  //      否则就是「默认自动种」（09-27 用户令：默认不装，自动种每会话多注入 ~640 token）。
  const bootTs = codeOnly(readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8"));
  const bootHealGated = /getPonytailMode\(\)\) !== "off"[\s\S]{0,500}ensurePonytailPlugin/.test(bootTs);
  (!bootTs.includes("ensurePonytailPlugin") ? ok : bootHealGated ? ok : fail)(
    "ponytail 启动不自动种（09-27 按需安装；10-30 起只允许「写代码模式 ≠ off」时自愈，且必须紧跟模式判断）"
  );
  /* ★ 10-30 用户实测「这个界面没有返回功能」（机器人面板）：
     返回键与其它内页同款（左箭头 + 次要按钮，放标题行最左）；Esc 等效且必须捕获阶段拦，
     否则同一个 Esc 会把底下的面板/搜索一起关掉。 */
  const botConsole = codeOnly(readFileSync(join(ROOT, "src/features/app-view/AppView/05-remote-console.tsx"), "utf8"));
  (botConsole.includes('className="secondary-setting bot-back"') ? ok : fail)(
    "机器人面板有「返回」（左箭头 + 次要按钮，在标题行最左）"
  );
  (/if \(!botManagerOpen\) return;[\s\S]{0,240}event\.key !== "Escape"[\s\S]{0,240}stopPropagation\(\)[\s\S]{0,240}setBotManagerOpen\(false\)/.test(botConsole) ? ok : fail)(
    "机器人面板 Esc 可关（捕获阶段 stopPropagation，不误关底下面板）"
  );
  // ⛔ 09-16 实测教训：引擎对 config/value/write 要求**必填** mergeStrategy，缺了整条请求被拒
  //    （Invalid request: missing field `mergeStrategy`）。这些调用普遍带 .catch(() => undefined)
  //    静默吞掉 → 表现成「开关点了没生效」。这里按结构守：**只认真正的调用点**
  //    （`config/value/write", {` … `})`），注释里提到这个字符串的段落不算（否则误判）。
  {
    const callRe = /config\/value\/write",\s*\{([\s\S]*?)\n\s*\}\)/g;
    const bodies = [...mainTs26.matchAll(callRe)].map((m) => m[1]);
    const missing = bodies.filter((body) => !body.includes("mergeStrategy"));
    (!missing.length && bodies.length > 0 ? ok : fail)(`main.ts：全部 ${bodies.length} 处 config/value/write 调用都带 mergeStrategy（引擎必填，缺了静默失败）`);
  }
}

// ---------- 【27】自动化工具拆细 + CloakBrowser 剥离随包（09-16 下午） ----------
// 用户四句话定下的形态：
//   ① 「这三个内置」——Nuphus / Playwright CLI / ponytail 写代码模式插件随包；
//   ② 「CloakBrowser 不用内置，按需下载就行」——从包里剥离，走 npm 国内镜像按需装；
//   ③ 「默认用内置浏览器」——默认通道是内置浏览器视图 + playwright-cli，Cloak 只在需要时用；
//   ④ 「自动化工具拆开，拆详细一点」——开发工具页从一张大卡拆成逐条能力卡。
// 每条都同时守「实现」与「给模型的指令/给用户的文案」：只改一半就会出现
// 「包里已经没有它，指令却还说它内置」的错配（模型会去调一个不存在的模块）。
{
  const pkg27 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const extraResources27 = pkg27.build?.extraResources ?? [];
  const npmGlobalSet = extraResources27.find((entry) => entry?.from === "resources/tools/npm-global");
  const npmFilter = Array.isArray(npmGlobalSet?.filter) ? npmGlobalSet.filter.map(String) : [];
  (npmFilter.some((pattern) => /^!node_modules(\/\*\*\/\*)?$/.test(pattern)) ? ok : fail)("package.json：npm-global 根级映射显式排除 node_modules（该层交给下面那条独立映射）");
  (!npmFilter.some((pattern) => /cloakbrowser/i.test(pattern)) ? ok : fail)("package.json：CloakBrowser 排除项已删除（功能整体移除）");
  // ⛔ 09-16 实测踩坑（打包验证才暴露）：electron-builder 的 copyDir **无条件丢弃 extraResources `from`
  //    根级的 node_modules**（app-builder-lib/out/util/filter.js 写死 `if (relative === "node_modules") return false`，
  //    且 walk() 在目录节点被过滤时整棵剪掉）。所以只写一条 from=npm-global 的映射时，包里只有根级 shim，
  //    node_modules 是空的 → 装出来的应用 nuphus/playwright-cli 两张卡都显示「未安装」，得让用户点一次
  //    「修复安装」解 zip，与「随包内置、开箱即用」的承诺不符。
  //    必须**另加一条** from=.../npm-global/node_modules 的映射（那一层的相对路径不叫 node_modules，绕过剪枝）。
  const nodeModulesSet = extraResources27.find((entry) => entry?.from === "resources/tools/npm-global/node_modules");
  (nodeModulesSet && nodeModulesSet.to === "tools/npm-global/node_modules" ? ok : fail)("package.json：单独一条 from=resources/tools/npm-global/node_modules → tools/npm-global/node_modules 的映射（缺了它 builder 会把 node_modules 整个剪掉，「随包内置」落空）");
  // ⛔⛔ 10-07 实测事故（用户报「开发工具/知识库全部安装失败」）：上面那条剪枝规则**不只是 npm-global 的事**。
  //    `resources/tools/node` 同样带根级 node_modules（npm 本体 16M + 它自带的 npm/node_modules 12M），
  //    而它**从来没有**配过独立映射 ⇒ 装出来的 Windows 包里有 `tools/node/node.exe` 却**没有 npm**，
  //    `runtime-ipc.ts` / `kb-embed-backend.ts` 一律抛「内置 Node 缺少 npm（…/npm/bin/npm-cli.js）」。
  //    ⚠️ dev 态从仓库读 `resources/tools`（npm 在）⇒ **本地永远不复现**，只在打包版爆。
  //    ⚠️ mac 侧不受影响：`build/copy-mac-tools.cjs` 是整目录 `fs.cp`，不过 builder 的 filter。
  //    ⇒ 只要 extraResources 里新增任何带根级 node_modules 的 from，**必须同轮补一条独立映射**。
  const nodeNmSet = extraResources27.find((entry) => entry?.from === "resources/tools/node/node_modules");
  (nodeNmSet && nodeNmSet.to === "tools/node/node_modules" ? ok : fail)("package.json：单独一条 from=resources/tools/node/node_modules → tools/node/node_modules 的映射（缺了它包内 Node 没有 npm ⇒「开发工具」与知识库的全部安装动作都报「内置 Node 缺少 npm」）");
  const nodeModulesFilter = Array.isArray(nodeModulesSet?.filter) ? nodeModulesSet.filter.map(String) : [];
  (!nodeModulesFilter.some((pattern) => /cloakbrowser/i.test(pattern)) ? ok : fail)("package.json：node_modules 映射不再包含 CloakBrowser 排除项");

  const packAutomation = readFileSync(join(ROOT, "scripts", "pack-automation.cjs"), "utf8");
  (!/cloakbrowser/i.test(packAutomation) ? ok : fail)("pack-automation：CloakBrowser 排除清单已删除（功能整体移除）");

  const beforePack = readFileSync(join(ROOT, "scripts", "before-pack.cjs"), "utf8");
  (beforePack.includes("requiredShipped") && beforePack.includes('["@nuphus", "nuphus-mcp", "package.json"]') && !/@playwright/.test(beforePack) ? ok : fail)("before-pack：硬校验随包 npm-global 含 nuphus-mcp（不再要求 Playwright CLI）");
  // ⛔ 断言的是**比较表达式本身**（去空白后匹配），不是两个松散标识符：
  //    反证实测过一次假绿——只留 const packScript/newestSource 的声明、把 Math.max(...) 摘掉，
  //    旧写法照样命中，守卫恒绿。这类守卫必须锚在真正的逻辑上。
  const bpFlat = beforePack.replace(/\s+/g, "");
  (bpFlat.includes("constnewestSource=Math.max(fs.statSync(modules).mtimeMs,fs.statSync(packScript).mtimeMs)") ? ok : fail)("before-pack：zip 新鲜度同时比对打包脚本 mtime（改了排除清单不会静默复用旧 zip）");
  // 产物层守卫：verify-packaged-tools 必须对「包体真的进包了」下断言（它是最靠近产物的那道网）。
  const verifyPackagedTools = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (verifyPackagedTools.includes("@nuphus/nuphus-mcp/package.json") && !/@playwright/.test(verifyPackagedTools) && /from=resources\/tools\/npm-global\/node_modules/.test(verifyPackagedTools) ? ok : fail)("verify-packaged-tools：断言产物里有 nuphus-mcp（不再要求 Playwright CLI）");
  /* ⛔⛔ 10-07 二次事故（v0.0.33 首轮 CI 的 mac job 就红在这条脚本上）：
     本脚本是**两平台共用**的（build-win 验 resources/tools 与 win-unpacked；build-mac 验 resources/tools
     与 .app/Contents/Resources/tools），而两个平台随包 Node 的**解包布局不同** ——
       · Windows 解官方 **zip** ⇒ npm 在 `node/node_modules/npm/`
       · macOS 解官方 **tar.gz** ⇒ npm 在 `node/lib/node_modules/npm/`
     我给本脚本加 npm 断言时只写死了 Windows 那一条 ⇒ mac 上「Verify native automation before packaging」
     必红（同一文件第 29 行的 node 本体本来就是按平台分支的 `node.exe` / `bin/node`，我漏了那个既有模式）。
     ⇒ 钉住「按候选列表探测、两种布局都列出」，并负向钉住「不许退回写死单条」。 */
  const npmCandidates = /const npmCli = \[\s*path\.join\(root, "node", "node_modules", "npm", "bin", "npm-cli\.js"\),[\s\S]{0,240}?path\.join\(root, "node", "lib", "node_modules", "npm", "bin", "npm-cli\.js"\),[\s\S]{0,240}?\]\.find\(fs\.existsSync\)/.test(verifyPackagedTools);
  (npmCandidates ? ok : fail)("verify-packaged-tools：npm CLI 必须按「候选列表」探测两种解包布局（Windows zip 的 node/node_modules/npm + mac tar.gz 的 node/lib/node_modules/npm）；只写死一种会把另一平台的 CI job 打红");
  (!/const npmCli = path\.join\(root, "node", "node_modules", "npm", "bin", "npm-cli\.js"\);/.test(verifyPackagedTools) ? ok : fail)("verify-packaged-tools：npm CLI 不许退回单平台硬编码路径（10-07 mac job 事故的复发形态）");
  /* ⛔⛔ 10-07 mac **真缺口**（与上面同源，但严重程度不同 —— 这是**功能**缺口，不是 CI 失败）：
     `runtime-ipc.ts`（开发工具装包）与 `kb-embed-backend.ts`（知识库语义后端安装）**各自**写死了
     npm 的 Windows zip 布局路径；而 mac 的随包 Node 是官方 tar.gz 布局（npm 在 `node/lib/node_modules/npm`），
     且 `build/copy-mac-tools.cjs` 是整目录 fs.cp、**不做任何布局归一化**
     ⇒ mac 上这两个功能一律抛「内置 Node 缺少 npm」，等于被阉割（用户 09-18 定的发版第 0 步
       就是 mac 适配审计，这条正属于「跨平台代码里写死某平台的东西」）。
     已下沉成 `toolchain.bundledNpmCli()`（候选列表，与既有 `bundledGit()` 同型）。
     下面两条：① 唯一真相源必须真的按候选探测；② 业务文件里不许再出现那条硬编码路径。 */
  const toolchainSrc = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  const npmHelper = /export function bundledNpmCli\(\)\s*\{[\s\S]{0,1200}?"node", "node_modules", "npm", "bin", "npm-cli\.js"[\s\S]{0,400}?"node", "lib", "node_modules", "npm", "bin", "npm-cli\.js"/.test(toolchainSrc);
  (npmHelper ? ok : fail)("toolchain.bundledNpmCli：按候选列表探测两种解包布局（Windows zip 的 node/node_modules/npm + mac tar.gz 的 node/lib/node_modules/npm）—— 只认一种 = mac 上「开发工具 / 知识库」装不上");
  /* ⛔ 上面那条负向判据用「字面量在主进程源码里的出现次数」实现 —— 比逐个文件 walk 简单也更强：
     `mainSrc`（_ctx 的聚合面）已递归覆盖 electron/main.ts + electron/features/** + electron/main/**
     + 顶层 electron/*.ts，正是「谁可能写死路径」的全部范围。
     ⛔ 下限钉 1（不是 0）：toolchain.ts 里那条 Windows 候选**必须**在，它是唯一真相源；
        钉 1 同时挡住「把 toolchain 那行也删了」与「业务文件又抄一份」两个方向。 */
  const npmLiteralCount = mainSrc.split('"node", "node_modules", "npm", "bin", "npm-cli.js"').length - 1;
  (npmLiteralCount === 1 ? ok : fail)(`npm CLI 路径字面量在主进程源码里只许出现 1 次（toolchain.ts 唯一真相源）；实际 ${npmLiteralCount} 次 —— 0 = 真相源被删，>1 = 又有业务文件写死了单平台路径（mac 上「开发工具 / 知识库」装不上）`);
  // 行为探针（不只看字符串）：给一个「有 npm-global 但没有那两个包」的假 tools 根，
  // 断言 before-pack 真的中止打包并点名缺什么；逃生阀仍可放行。
  {
    const probeRoot = join(ROOT, ".e2e-artifacts", "missing-shipped-probe");
    try { rmSync(probeRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    mkdirSync(join(probeRoot, "npm-global", "node_modules"), { recursive: true });
    const invoke = `require(${JSON.stringify(join(ROOT, "scripts", "before-pack.cjs"))})().then(() => process.exit(0), (e) => { console.error(String((e && e.message) || e)); process.exit(1); });`;
    const strict = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: probeRoot, AUTOMATION_ZIP_OPTIONAL: "" },
    });
    const relaxed = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: probeRoot, AUTOMATION_ZIP_OPTIONAL: "1" },
    });
    try { rmSync(probeRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    (strict.status !== 0 && /随包 npm-global 缺少/.test(String(strict.stderr || "")) ? ok : fail)("before-pack：npm-global 缺 nuphus 时**中止打包**并点名缺哪个");
    (relaxed.status === 0 ? ok : fail)("before-pack：AUTOMATION_ZIP_OPTIONAL=1 仍可显式放行（发布链路不被卡死）");
  }

  const mainTs27 = readMainSource();
  const idLine = /type DevRuntimeId = ([^;]+);/.exec(mainTs27)?.[1] ?? "";
  (!/\bautomation\b/.test(idLine) ? ok : fail)("main.ts：开发工具 id 里不再有合并的 automation 大卡");
  (idLine.includes('"nuphus"') && !idLine.includes('"playwright-cli"') && !idLine.includes('"cloakbrowser"') ? ok : fail)("main.ts：只剩 Nuphus 内置条目；Playwright / CloakBrowser 已从运行时清单移除");
  (mainTs27.includes('nuphus: { name: "Nuphus 桌面自动化"') && !mainTs27.includes('"playwright-cli": { name:') ? ok : fail)("main.ts：Nuphus 内置卡片在位，Playwright 卡已删除");
  (mainTs27.includes('marker: "npm-global\\\\node_modules\\\\@nuphus\\\\nuphus-mcp\\\\package.json", bundled: true') && !mainTs27.includes('@playwright\\\\cli\\\\package.json') ? ok : fail)("main.ts：Nuphus 卡标为 bundled，Playwright 已移除（缺失才给「修复安装」）");
  (mainTs27.includes('marker: "ponytail-plugin", kind: "plugin", bundled: true, noUninstall: true') ? ok : fail)("main.ts：ponytail 也是 bundled（随包内置；缺失走「重种插件」，绝不能落进解压 zip 的分支）");
  const egoCardSrc = readFileSync(join(ROOT, "src", "features", "settings-devtools", "EgoLiteCard.tsx"), "utf8");
  (egoCardSrc.includes("Ego Lite 浏览器自动化") && egoCardSrc.includes("下载安装") && egoCardSrc.includes("egoStatus") && egoCardSrc.includes("CODEX_THREAD_ID") ? ok : fail)("EgoLiteCard：外部安装入口 + 状态/版本 + 每会话 Space 说明（不内置 611MB Chromium）");
  (mainTs27.includes("async function runNpmInstall(") && !/runNpmInstall\(id, "cloakbrowser"/.test(mainTs27) && !/cloakbrowser: \{ name:/.test(mainTs27) ? ok : fail)("main.ts：CloakBrowser 下载/安装分支已移除");
  // 09-20 下载源选择：direct 只走官方源，其余（auto/mirror/gh 加速/proxy）保持镜像优先+官方回落
  (mainTs27.includes('const registries = userRegistry ? [userRegistry] : source === "direct" ? [""] : [CHINA_NPM_REGISTRY, ""];') ? ok : fail)("main.ts：npm 安装按所选源组装（direct 只走官方，其余镜像优先 + 官方源回落，用户自设源时不覆盖）");
  // ⛔ 10-01 改：卸载落点从「单条 if (id === "cloakbrowser")」升级为 NPM_PACKAGE_ARTIFACTS 映射
  //    （npm 包的包体在 node_modules/<pkg>，而 npm-global/<pkg> 那层是 shim 文件 —— 只删 shim 等于没卸干净）。
  (mainTs27.includes("NPM_PACKAGE_ARTIFACTS") && mainTs27.includes('rea: { dirs: ["node_modules/rea-agents"]') ? ok : fail)("main.ts：npm 包卸载删的是**包体目录**（如 node_modules/rea-agents），不是 marker 首段");
  // ⛔ 10-07：npmShimPaths 改为**显式接根参数**（卸载要遍历全部候选落位，内部取单值会删不干净）
  //   ⇒ 锚点跟着改成新调用形态，语义不变（shim 仍随包体一起清）。
  (mainTs27.includes("...npmShimPaths(root, ...pkg.shims)") ? ok : fail)("main.ts：卸载时把该包的 shim 一起清掉（否则 PATH 留着指向空目录）");
  (mainTs27.includes('if (spec.bundled) throw new Error("该工具随应用内置') ? ok : fail)("main.ts：bundled 条目拒绝卸载（删了没有可靠重取途径）");
  (mainTs27.includes("if (spec.bundled && runtimeInstalled(id, spec)) return { ok: true, runtimes: runtimeList() };") ? ok : fail)("main.ts：bundled 条目已就位时「修复安装」是幂等空操作（判定与清单同源 runtimeInstalled）");
  const toolchainTs27 = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (toolchainTs27.includes('export const CHINA_NPM_REGISTRY = "https://registry.npmmirror.com";') ? ok : fail)("toolchain：npm 国内镜像常量在位（registry.npmmirror.com）");

  // 「默认用内置浏览器」：指令 / 技能 / 渲染层三处必须同向
  const devInstr = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  // ⛔ 09-20 修正方向：浏览器通道**首选已注册的 nuphus browser_* MCP 工具**，playwright-cli 降为兜底。
  //    旧断言写的是「playwright-cli 是默认通道」——那正是要修的问题：24 个 browser_* 工具已注册、
  //    占着约 10k 前缀，指令却一次不提、还把 CLI 说成默认（每步一次进程往返）。
  // ⛔⛔ 10-12 改（引擎 0.157 起内置 MCP 工具延迟暴露，直调必返 unsupported call）：主线已改成
  //    playwright-cli，browser_* 是「名字在表里、路由不认」。断言随之改成钉新事实。
  (/ego-browser \(ego lite/.test(devInstr) && devInstr.includes("codex-<CODEX_THREAD_ID>") && devInstr.includes("nuphus-call browser_") && devInstr.includes("Do NOT call nuphus browser_*") && !/cloakbrowser upgrade path/.test(devInstr) ? ok : fail)("developer_instructions：ego-browser 优先（每会话 Space），未装回落 nuphus-call 默认浏览器；Cloak 提法已移除");
  (!/DEFAULT browser channel/.test(devInstr) ? ok : fail)("developer_instructions：不得回退成「playwright-cli 是默认通道」");
  (/Do NOT call nuphus browser_\*/.test(devInstr) && /unsupported call/.test(devInstr) ? ok : fail)("developer_instructions：明确禁止直调 MCP browser_*（改用 nuphus-call CLI）并写明报错");
  (!/The in-app browser panel is CloakBrowser/.test(devInstr) ? ok : fail)("developer_instructions：不再声称应用内面板就是 CloakBrowser（默认是内置浏览器视图）");
  const skillsFile = readFileSync(join(ROOT, "electron", "builtin-skills", "02-skill-browser.ts"), "utf8");
  const skillsTs = skillsFile.slice(Math.max(0, skillsFile.indexOf("export const BROWSER_SKILL")));
  (/## 1\. 一会话一 Space/.test(skillsTs) && skillsTs.includes("CODEX_THREAD_ID") && skillsTs.includes("taskSpace") && skillsTs.includes("ego-browser") && skillsTs.includes("nuphus-call browser_") && !/CLOAKBROWSER_ENTRY/.test(skillsTs) ? ok : fail)("browser-skill：ego 优先 + 每会话 TaskSpace（CODEX_THREAD_ID）+ nuphus-call 默认浏览器回落；Cloak/Playwright 指导已移除");
  const appTs = readAppUi();
  (!/browserMode.*"cloak"/.test(appTs) ? ok : fail)("App.tsx：浏览器模式里的 cloak 分支已移除（只剩内置视图）");
  (appTs.includes('const autoIds = ["nuphus", "ponytail"]') ? ok : fail)("App.tsx：开发工具分组只剩 Nuphus / ponytail（Playwright、Cloak 已删除）");

  // mac 侧与 Windows 同源（不再排除/安装 CloakBrowser）
  const macCopy = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (!/isCloakPackage|cloak-cache/.test(macCopy) ? ok : fail)("mac copy-mac-tools：不再排除 CloakBrowser / cloak-cache（功能已整体移除）");
  const macPrepare = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  (!/cloakbrowser|cloak-cache|CLOAKBROWSER/i.test(macPrepare) ? ok : fail)("mac prepare-mac-tools：不再安装或缓存 cloakbrowser");
  const verifyPackaged = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (!/cloak/i.test(verifyPackaged) ? ok : fail)("verify-packaged-tools：CloakBrowser 冒烟已移除（浏览器自动化主通道改为外部 Ego Lite）");
}
  }
}
}
