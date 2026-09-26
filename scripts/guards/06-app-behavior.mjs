/**
 * 预检守卫组：06-app-behavior
 * 分节：【23】【24】【25】【28】（原 L2914–L4089）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, createRequire, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, rmSync, spawnSync, typesSrc,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【23】原 L2914–L2945 ══ */
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

  /* ══ 【24】原 L2949–L3031 ══ */
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
  const dialedCount = (mainTs.match(/base_url: bridgeDial\(/g) ?? []).length;
  (dialedCount >= 7 ? ok : fail)(`main.ts 内联 provider 配置已桥化（实测 ${dialedCount} 处）`);
  (preloadTs.includes('"bridge:status"') && typesSrc.includes("bridgeStatus") ? ok : fail)("桥状态 IPC 在 preload 与类型声明里对齐");
  (hookTs.includes("本机协议桥") ? ok : fail)("useModelProviders 明确告知 chat-only 网关已由协议桥接管（不再说「无法使用」）");

  // ── 行为级：直接跑编译产物的真实转换函数 ──
  const compiled = join(ROOT, "dist-electron", "responses-bridge.js");
  const compiledOk = existsSync(compiled);
  (compiledOk ? ok : fail)("协议桥已编译进 dist-electron（随主进程一起打包，不依赖额外运行时文件）");
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

  /* ══ 【25】原 L3035–L3450 ══ */
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
        && /variant=\{active === "image" \? "image" : "chat"\}/.test(pluginsSrc))
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
  const unbundled = [
    "resources/tools/pw-browsers", "resources/tools/cloak-cache",
    "resources/tools/pwsh", "resources/tools/git", "resources/tools/python",
    "resources/tools/rg", "resources/tools/uv", "resources/tools/cmake",
    "resources/tools/ninja", "resources/tools/sevenzip", "resources/tools/jq",
  ];
  for (const source of unbundled) {
    (!extraFrom.includes(source) ? ok : fail)(`package.json extraResources 不随包内置 ${source.replace("resources/tools/", "")}（体积回潮守卫）`);
  }
  (extraFrom.includes("resources/tools/node") ? ok : fail)("node 仍随包内置（安装器引导运行时，缺了其余工具都装不了）");
  (Array.isArray(pkg.build?.files) && pkg.build.files.some((pattern) => String(pattern).includes("mermaid") && String(pattern).endsWith(".map")) ? ok : fail)("asar 打包排除 mermaid 的 sourcemap（-25MB 纯赚）");
  const copyMac = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (copyMac.includes('NOT_BUNDLED = new Set(["pw-browsers", "cloak-cache"])') && copyMac.includes("NOT_BUNDLED.has(path.basename(entry))") ? ok : fail)("mac copy-mac-tools 复制 tools 时跳过两个内核目录");
  const toolchainTs = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (toolchainTs.includes('PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright"') ? ok : fail)("toolchain：Playwright 内核国内镜像源已配置（npmmirror binaries）");
  (toolchainTs.includes('CLOAKBROWSER_DOWNLOAD_URL: "https://ghfast.top/https://github.com/CloakHQ/cloakbrowser/releases/download"') ? ok : fail)("toolchain：CloakBrowser 内核走 gh 代理（归档与 SHA256SUMS 同源，校验不受影响）");
  (toolchainTs.includes("if (!process.env[key]) env[key] = value;") ? ok : fail)("toolchain：用户自设的下载源变量优先于镜像（不覆盖用户配置）");
  const mainTs26 = readMainSource();
  // 09-20 下载源选择：内核下载 attempts 改为按 source 组装（direct 只走官方，其余镜像优先+官方回落）
  (mainTs26.includes('const attempts = source === "direct" || !mirrorKeys.length') && mainTs26.includes('{ env: mirrored, via: "国内镜像" }, { env: official, via: "官方源" }') ? ok : fail)("main.ts：内核下载按所选源组装（direct 只走官方，其余镜像优先 + 官方源回落）");
  (mainTs26.includes('await runBrowserDownload(id, node, cli, ["install", "chromium"], "浏览器内核", downloadSource)') ? ok : fail)("main.ts：Playwright 内核下载走 runBrowserDownload（不直接 spawn 官方源）");
  (mainTs26.includes('await runBrowserDownload(id, node, cli, ["install"], "Cloak 内核", downloadSource)') ? ok : fail)("main.ts：Cloak 内核下载走 runBrowserDownload（不直接 spawn 官方源）");
  (mainTs26.includes("devRuntimeSpecs") && !/pwsh: \{[^}]*builtIn: true/.test(mainTs26) && !/git: \{[^}]*builtIn: true/.test(mainTs26) && !/python: \{[^}]*builtIn: true/.test(mainTs26) ? ok : fail)("main.ts：pwsh/git/python 已转为按需下载（不再是 builtIn）");
  (mainTs26.includes("watchFs(toolsRoot(), { recursive: true }") && mainTs26.includes('message: "开发工具目录已更新", auto: true') ? ok : fail)("main.ts：tools 目录监视 → 引擎自己装工具后界面自动刷新");
  const installRuntimes = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (installRuntimes.includes("https://cdn.npmmirror.com/binaries/node/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/python/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/git-for-windows/") ? ok : fail)("install-runtimes：node/python/git 走 npmmirror 国内镜像（有镜像源的不该是龟速官方源）");
  // 09-20 下载源选择：auto 通道序保持「镜像 → (代理) → 直连 → gh-proxy」，六种源在 switch 里分派
  // 09-20 下载源选择：auto = 国内优先（镜像 → (代理) → gh 加速 → 直连兜底），六种源在 switch 里分派
  (installRuntimes.includes('case "mirror": attempts = mirror ? [["国内镜像 npmmirror", curlArgs.slice(), mirror], ...direct] : [...ghAccels, ...direct]') && installRuntimes.includes('case "ghproxy": attempts = isGh ? [ghAccels[0], ...direct]') && installRuntimes.includes('case "ghfast": attempts = isGh ? [ghAccels[1], ...direct]') && /case "auto":\s*\n\s*default: attempts = \[\s*\n\s*\.\.\.\(mirror \? \[\["国内镜像 npmmirror", curlArgs\.slice\(\), mirror\]\] : \[\]\),\s*\n\s*\.\.\.viaProxy,\s*\n\s*\.\.\.ghAccels,\s*\n\s*\.\.\.direct,/.test(installRuntimes) ? ok : fail)("install-runtimes：下载通道按所选源分派（auto = 国内优先：镜像 → (代理) → gh 加速 → 直连兜底）");
  // 09-16 下午：自动化包与 ponytail 改为「随包预解压直装」（用户「直接内置，不用解压啥的」）——
  // npm-global 必须进 extraResources（缺了等于回到「要点安装才解压」），zip 保留作修复备用；
  // ponytail 启动自动种只在 config **没有**注册段时动手（否则用户卸载后下次启动又装回来，卸载失效）。
  (extraFrom.includes("resources/tools/npm-global") ? ok : fail)("package.json extraResources 随包预解压 npm-global（自动化包开箱即用，不用点安装解压）");
  (extraFrom.includes("resources/tools/automation-tools.zip") ? ok : fail)("automation-tools.zip 仍随包（修复备用：重新解压即可恢复）");
  (extraFrom.includes("resources/tools/ponytail-plugin") ? ok : fail)("ponytail-plugin 随包（启动自动种入引擎插件 cache）");
  (mainTs26.includes('!configText.includes(\'ponytail@ponytail\')') ? ok : fail)("ponytail 自动种只在 config 无注册段时执行（不破坏「卸载后不再自动装回」语义）");
  (mainTs26.includes("void ensurePonytailPlugin(codexHome, bundledPonytail)") ? ok : fail)("ponytail 启动自动种调 ensurePonytailPlugin（幂等，失败降级）");
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
  (npmFilter.some((pattern) => /^!cloakbrowser(\.cmd|\.ps1)?$/.test(pattern)) ? ok : fail)("package.json：filter 同时排除 npm-global 根下的 cloakbrowser shim");
  // ⛔ 09-16 实测踩坑（打包验证才暴露）：electron-builder 的 copyDir **无条件丢弃 extraResources `from`
  //    根级的 node_modules**（app-builder-lib/out/util/filter.js 写死 `if (relative === "node_modules") return false`，
  //    且 walk() 在目录节点被过滤时整棵剪掉）。所以只写一条 from=npm-global 的映射时，包里只有根级 shim，
  //    node_modules 是空的 → 装出来的应用 nuphus/playwright-cli 两张卡都显示「未安装」，得让用户点一次
  //    「修复安装」解 zip，与「随包内置、开箱即用」的承诺不符。
  //    必须**另加一条** from=.../npm-global/node_modules 的映射（那一层的相对路径不叫 node_modules，绕过剪枝）。
  const nodeModulesSet = extraResources27.find((entry) => entry?.from === "resources/tools/npm-global/node_modules");
  (nodeModulesSet && nodeModulesSet.to === "tools/npm-global/node_modules" ? ok : fail)("package.json：单独一条 from=resources/tools/npm-global/node_modules → tools/npm-global/node_modules 的映射（缺了它 builder 会把 node_modules 整个剪掉，「随包内置」落空）");
  const nodeModulesFilter = Array.isArray(nodeModulesSet?.filter) ? nodeModulesSet.filter.map(String) : [];
  (nodeModulesFilter.some((pattern) => /^!cloakbrowser(\/\*\*\/\*)?$/.test(pattern)) && nodeModulesFilter.some((pattern) => pattern.startsWith("!.bin/cloakbrowser")) ? ok : fail)("package.json：node_modules 映射同样排除 cloakbrowser 包体与 .bin shim");

  const packAutomation = readFileSync(join(ROOT, "scripts", "pack-automation.cjs"), "utf8");
  (packAutomation.includes('parts[1].startswith("cloakbrowser")') && packAutomation.includes('parts[2] == "cloakbrowser"') ? ok : fail)("pack-automation：打 zip 时排除 cloakbrowser（否则「修复安装」把它又装回包里）");

  const beforePack = readFileSync(join(ROOT, "scripts", "before-pack.cjs"), "utf8");
  (beforePack.includes("requiredShipped") && beforePack.includes('["@nuphus", "nuphus-mcp", "package.json"]') && beforePack.includes('["@playwright", "cli", "package.json"]') ? ok : fail)("before-pack：硬校验随包 npm-global 含 nuphus-mcp + @playwright/cli（坏包守卫盯着随包内容本身）");
  // ⛔ 断言的是**比较表达式本身**（去空白后匹配），不是两个松散标识符：
  //    反证实测过一次假绿——只留 const packScript/newestSource 的声明、把 Math.max(...) 摘掉，
  //    旧写法照样命中，守卫恒绿。这类守卫必须锚在真正的逻辑上。
  const bpFlat = beforePack.replace(/\s+/g, "");
  (bpFlat.includes("constnewestSource=Math.max(fs.statSync(modules).mtimeMs,fs.statSync(packScript).mtimeMs)") ? ok : fail)("before-pack：zip 新鲜度同时比对打包脚本 mtime（改了排除清单不会静默复用旧 zip）");
  // 产物层守卫：verify-packaged-tools 必须对「包体真的进包了」下断言（它是最靠近产物的那道网）。
  const verifyPackagedTools = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (verifyPackagedTools.includes("@nuphus/nuphus-mcp/package.json") && verifyPackagedTools.includes("@playwright/cli/package.json") && /from=resources\/tools\/npm-global\/node_modules/.test(verifyPackagedTools) ? ok : fail)("verify-packaged-tools：断言产物里真的有 nuphus-mcp 与 @playwright/cli（node_modules 没被打进包就红）");
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
    (strict.status !== 0 && /随包 npm-global 缺少/.test(String(strict.stderr || "")) ? ok : fail)("before-pack：npm-global 缺 nuphus/playwright-cli 时**中止打包**并点名缺哪个");
    (relaxed.status === 0 ? ok : fail)("before-pack：AUTOMATION_ZIP_OPTIONAL=1 仍可显式放行（发布链路不被卡死）");
  }

  const mainTs27 = readMainSource();
  const idLine = /type DevRuntimeId = ([^;]+);/.exec(mainTs27)?.[1] ?? "";
  (!/\bautomation\b/.test(idLine) ? ok : fail)("main.ts：开发工具 id 里不再有合并的 automation 大卡");
  (idLine.includes('"nuphus"') && idLine.includes('"playwright-cli"') && idLine.includes('"cloakbrowser"') ? ok : fail)("main.ts：拆成 nuphus / playwright-cli / cloakbrowser 三条独立条目");
  (mainTs27.includes('nuphus: { name: "Nuphus 桌面自动化"') && mainTs27.includes('"playwright-cli": { name: "Playwright 浏览器自动化"') ? ok : fail)("main.ts：Nuphus / Playwright CLI 两条内置卡片在位");
  (mainTs27.includes('marker: "npm-global\\\\node_modules\\\\@nuphus\\\\nuphus-mcp\\\\package.json", bundled: true') && mainTs27.includes('marker: "npm-global\\\\node_modules\\\\@playwright\\\\cli\\\\package.json", bundled: true') ? ok : fail)("main.ts：两条内置卡片标为 bundled（界面显示「内置」，缺失才给「修复安装」）");
  (mainTs27.includes('marker: "ponytail-plugin", kind: "plugin", bundled: true, noUninstall: true') ? ok : fail)("main.ts：ponytail 也是 bundled（随包内置；缺失走「重种插件」，绝不能落进解压 zip 的分支）");
  (mainTs27.includes('cloakbrowser: { name: "CloakBrowser 指纹浏览器"') && !/cloakbrowser: \{[^}]*bundled: true/.test(mainTs27) ? ok : fail)("main.ts：CloakBrowser 是独立的按需下载卡片（不是 bundled）");
  (mainTs27.includes("async function runNpmInstall(") && mainTs27.includes('await runNpmInstall(id, "cloakbrowser", "CloakBrowser", downloadSource)') ? ok : fail)("main.ts：CloakBrowser 走 runNpmInstall（用内置 node 自带 npm，不依赖用户环境）");
  // 09-20 下载源选择：direct 只走官方源，其余（auto/mirror/gh 加速/proxy）保持镜像优先+官方回落
  (mainTs27.includes('const registries = userRegistry ? [userRegistry] : source === "direct" ? [""] : [CHINA_NPM_REGISTRY, ""];') ? ok : fail)("main.ts：npm 安装按所选源组装（direct 只走官方，其余镜像优先 + 官方源回落，用户自设源时不覆盖）");
  (mainTs27.includes('if (id === "cloakbrowser") return path.join(npmGlobalRoot(), "cloakbrowser");') ? ok : fail)("main.ts：卸载 CloakBrowser 只删包体目录（按 marker 首段删会连 nuphus/playwright-cli 一起删光）");
  (mainTs27.includes('npmShimPaths("cloakbrowser")') ? ok : fail)("main.ts：卸载后清掉 npm shim（否则 PATH 留着指向空目录的 cloakbrowser.cmd）");
  (mainTs27.includes('if (spec.bundled) throw new Error("该工具随应用内置') ? ok : fail)("main.ts：bundled 条目拒绝卸载（删了没有可靠重取途径）");
  (mainTs27.includes("if (spec.bundled && runtimeInstalled(id, spec)) return { ok: true, runtimes: runtimeList() };") ? ok : fail)("main.ts：bundled 条目已就位时「修复安装」是幂等空操作（判定与清单同源 runtimeInstalled）");
  const toolchainTs27 = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (toolchainTs27.includes('export const CHINA_NPM_REGISTRY = "https://registry.npmmirror.com";') ? ok : fail)("toolchain：npm 国内镜像常量在位（registry.npmmirror.com）");

  // 「默认用内置浏览器」：指令 / 技能 / 渲染层三处必须同向
  const devInstr = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  // ⛔ 09-20 修正方向：浏览器通道**首选已注册的 nuphus browser_* MCP 工具**，playwright-cli 降为兜底。
  //    旧断言写的是「playwright-cli 是默认通道」——那正是要修的问题：24 个 browser_* 工具已注册、
  //    占着约 10k 前缀，指令却一次不提、还把 CLI 说成默认（每步一次进程往返）。
  (devInstr.includes("PREFERRED — the nuphus MCP browser tools") && devInstr.includes("FALLBACK — `playwright-cli`") && devInstr.includes("CLOAKBROWSER_ENTRY") ? ok : fail)("developer_instructions：浏览器通道首选 nuphus browser_* MCP 工具、playwright-cli 为兜底；cloakbrowser 先探 CLOAKBROWSER_ENTRY");
  (!devInstr.includes("DEFAULT browser channel") ? ok : fail)("developer_instructions：不得回退成「playwright-cli 是默认通道」（会让已注册的 browser_* 工具白占上下文）");
  (devInstr.includes("If `browser_navigate` appears in your tool list") ? ok : fail)("developer_instructions：通道按「工具列表里有没有 browser_navigate」判存在（nuphus 随桌面总闸注册，写成绝对会调不存在的工具）");
  (!/The in-app browser panel is CloakBrowser/.test(devInstr) ? ok : fail)("developer_instructions：不再声称应用内面板就是 CloakBrowser（默认是内置浏览器视图）");
  const skillsTs = readBuiltinSkillsSource();
  (!/本机内置的浏览器就是 CloakBrowser/.test(skillsTs) && /## 0\. 通道选型/.test(skillsTs) && /首选：nuphus 的/.test(skillsTs) && /MCP 工具/.test(skillsTs) ? ok : fail)("browser-skill：通道选型首选 nuphus browser_*（CloakBrowser 仅在已安装且需过反爬时用）");
  const appTs = readAppUi();
  (appTs.includes('const [browserMode] = useState<"cloak" | "internal">("internal")') ? ok : fail)("App.tsx：浏览器模式默认内置视图（不再是 cloak）");
  (appTs.includes('const autoIds = ["nuphus", "playwright-cli", "cloakbrowser", "playwright-browsers", "cloak-browsers", "ponytail"]') ? ok : fail)("App.tsx：开发工具分组按拆分后的条目 id 归类");

  // mac 侧两条链路与 Windows 同源（否则 mac 包又把 CloakBrowser 带回来）
  const macCopy = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (macCopy.includes("isCloakPackage") && macCopy.includes("!isCloakPackage(entry)") ? ok : fail)("mac copy-mac-tools：复制 npm-global 时同样排除 cloakbrowser");
  const macPrepare = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  (!macPrepare.includes('"cloakbrowser@') ? ok : fail)("mac prepare-mac-tools：不再安装 cloakbrowser（与 Windows 同源）");
  const verifyPackaged = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (verifyPackaged.includes("未随包内置") ? ok : fail)("verify-packaged-tools：CloakBrowser 缺席不再判失败（按需下载是预期形态）");
}
  }

  /* ══ 【28】原 L3458–L4089 ══ */
  {
{
  console.log(C.bold("\n【28】config.toml 写入面 + 会话/rollout 面（09-16 审计修复的回归网）"));
  const req = createRequire(import.meta.url);
  const cfg = req(join(ROOT, "dist-electron", "config-toml.js"));
  const backup = req(join(ROOT, "dist-electron", "thread-backup.js"));
  const mainTs = readMainSource();
  const workerSrc = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
  const workerGen = readFileSync(join(ROOT, "electron", "rollout-worker-source.ts"), "utf8");
  const backupTs = readFileSync(join(ROOT, "electron", "thread-backup.ts"), "utf8");

  // ── Bug 5：TOML 字符串转义必须处理换行/控制字符（粘贴带尾换行就能写坏整份配置） ──
  const esc = cfg.escapeTomlString;
  (esc("a\nb") === "a\\nb" ? ok : fail)("【28】escapeTomlString：内嵌换行转成 \\n（TOML 单行字符串里裸换行非法）");
  (esc("a\rb\tc") === "a\\rb\\tc" ? ok : fail)("【28】escapeTomlString：回车/制表一并转义");
  (esc('a"b\\c') === 'a\\"b\\\\c' ? ok : fail)("【28】escapeTomlString：引号与反斜杠仍按原语义转义");
  (!/[\u0000-\u001f\u007f]/.test(esc("a\u0000b\u0007c\u007fd")) ? ok : fail)("【28】escapeTomlString：其余控制字符被剔除");

  // ── Bug 9：MCP 段名解析要支持引号（含空格/中文/@ : +），否则用户段被静默删除 ──
  const hdr = (line) => JSON.stringify(cfg.parseTableHeader(line));
  (hdr('[mcp_servers."my server"]') === '["mcp_servers","my server"]' ? ok : fail)("【28】parseTableHeader：带空格的引号段名");
  (hdr("[mcp_servers.'我的服务']") === '["mcp_servers","我的服务"]' ? ok : fail)("【28】parseTableHeader：中文引号段名");
  (hdr('[mcp_servers."@scope/pkg"]') === '["mcp_servers","@scope/pkg"]' ? ok : fail)("【28】parseTableHeader：@ 与 / 段名");
  (hdr("[projects.'d:\\2']") === '["projects","d:\\\\2"]' ? ok : fail)("【28】parseTableHeader：带盘符/反斜杠的字面量段名");
  (cfg.parseTableHeader("exclude = [") === null ? ok : fail)("【28】parseTableHeader：值行不是段头");
  const names9 = cfg.collectMcpServerNames(['[mcp_servers.files]', '[mcp_servers."my server"]', '[mcp_servers."我的服务"]', '[mcp_servers."@scope/pkg"]', '[mcp_servers."a:b"]'].join("\n"));
  (["files", "my server", "我的服务", "@scope/pkg", "a:b"].every((n) => names9.includes(n)) ? ok : fail)("【28】collectMcpServerNames：裸名与引号名全采到（旧实现漏掉带空格/中文/@/: 的那类）");

  // ── Bug 1：harness 不再写 [permissions.*]（引擎没有工具映射，且缺 default_permissions 会废掉整份配置） ──
  (cfg.HARNESS_CONFIG_SECTIONS.has("permissions") === false ? ok : fail)("【28】permissions 已从 HARNESS_CONFIG_SECTIONS 移出（用户自己的档位不再被删）");
  (!/function permissionsToml/.test(mainTs) ? ok : fail)("【28】permissionsToml 已删除（不再写出非法 permissions 段）");
  (mainTs.includes("injectMcpToolRules(") && mainTs.includes("mcpToolRulesOf(") ? ok : fail)("【28】工具级权限改走 injectMcpToolRules / mcpToolRulesOf（引擎真支持的键）");

  // ── Bug 10：数值键强校验（裸插值 = 本地配置文件到任意命令执行） ──
  (!/model_max_output_tokens = \$\{maxOut\}/.test(mainTs) && /Number\.isFinite\(maxOut\)/.test(mainTs) ? ok : fail)("【28】model_max_output_tokens 经 Number.isFinite 校验（不再裸插值）");

  // ── Bug 7：设置页「会话记录」占用量的必须是真实 rollout 目录 ──
  (!/path\.join\(codexHome, "rollouts"\)/.test(mainTs) ? ok : fail)("【28】storage-info 不再量不存在的 codexHome/rollouts");
  (/archived_sessions"\)\]/.test(mainTs) && /path\.join\(codexHome, "sessions"\)/.test(mainTs) ? ok : fail)("【28】storage-info 量 sessions + archived_sessions（真实落点）");

  // ── Bug 8：provider id 取引擎权威索引；会话「记录已丢失」要有标记 ──
  {
    const st = req(join(ROOT, "dist-electron", "session-tools.js"));
    const missingCase = st.markMissingRollouts(
      [{ id: "T1", path: "sessions/x/rollout-2026-09-16T00-00-00-01a09d64-23c8-7e80-9215-58ad1a647868.jsonl" }, { id: "T2", path: "p2" }, { id: "T3" }],
      new Set(["t2"]),
    );
    (missingCase[0].rolloutMissing === true ? ok : fail)("【28】markMissingRollouts：索引有 path、兜底扫描没找到 → 标记录丢失");
    (missingCase[1].rolloutMissing === undefined ? ok : fail)("【28】markMissingRollouts：磁盘上真存在的不标（避免误报）");
    (missingCase[2].rolloutMissing === undefined ? ok : fail)("【28】markMissingRollouts：没有 path 的条目不标（兜底独有项/极简索引）");
  }
  (mainTs.includes("markMissingRollouts(merged, present)") ? ok : fail)("【28】thread/list 调用 markMissingRollouts（点开前就能发现记录已丢）");
  (mainTs.includes('await server.request("thread/list", { limit: 200, archived') ? ok : fail)("【28】collectSessionProviderIds 以引擎线程索引为权威源（不看 rollout 文件内容，含归档会话）");
  ((await import("node:fs")).existsSync(join(ROOT, "src", "App.tsx")) && readAppUi().includes("entry.rolloutMissing") ? ok : fail)("【28】渲染层用 rolloutMissing 拦下点击并显示「记录丢失」徽标");

  // ── Bug 13：导入的会话文件名必须 canonical（否则侧栏可见、点开报错） ──
  (!/rel = `sessions\/imported\/rollout-imported-\$\{id\}/.test(backupTs) && backupTs.includes("canonicalRolloutName(id,") ? ok : fail)("【28】thread-backup 写出的是 canonical 文件名（旧实现写 rollout-imported-<uuid> → 导入后打不开）");
  const CANON = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
  const uuid13 = "01a09d64-23c8-7e80-9215-58ad1a647868";
  (CANON.test(backup.canonicalRolloutName(uuid13, Date.UTC(2026, 8, 16))) ? ok : fail)("【28】canonicalRolloutName 产出引擎认的文件名形态");
  const fixed13 = backup.canonicalizeRel(`sessions/imported/rollout-imported-${uuid13}.jsonl`);
  (typeof fixed13 === "string" && CANON.test(fixed13.split("/").pop()) ? ok : fail)("【28】canonicalizeRel 把老备份里的非 canonical 名就地修好（旧文件导入也能打开）");
  (backup.canonicalizeRel("sessions/x/notarollout.jsonl") === null ? ok : fail)("【28】canonicalizeRel 对没有线程 id 的文件名返回 null（宁可跳过也不写死文件）");

  // ── Bug 14：侧栏标题必须剥 harness 注入块（与 thread-backup 同口径） ──
  (workerSrc.includes("stripHarnessBlocks") && workerSrc.includes("looksInjected") ? ok : fail)("【28】rollout-worker 也剥注入块 / 用同一份前缀表");
  (workerGen.includes("stripHarnessBlocks") ? ok : fail)("【28】内联产物 rollout-worker-source.ts 已同步（生成物不能落后于 worker 源码）");
  {
    // 真跑一次 worker：首条用户消息是 [SYSTEM TASK] 包装 + AGENTS.md 注入，标题必须是包装里的用户原文
    const probe = spawnSync(process.execPath, ["-e", `
const fs=require("fs"),os=require("os"),path=require("path");
const {Worker}=require("worker_threads");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"pw28-"));
const dir=path.join(root,"sessions","2026","09","16");
fs.mkdirSync(dir,{recursive:true});
const rows=[
 {type:"session_meta",payload:{cwd:"D:/x"}},
 {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"# AGENTS.md instructions\\n\\n<INSTRUCTIONS>\\nxxx"}],internal_chat_message_metadata_passthrough:{content_item_kinds:["agents_md.instructions"]}}},
 {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"[Harness 相关记忆，仅供参考]\\n记点东西\\n[记忆结束]\\n\\n[SYSTEM TASK abc] === 用户需求 ===\\n真实问题：帮我看看这个\\n=== END ==="}],internal_chat_message_metadata_passthrough:{content_item_kinds:["user.text"]}}},
];
fs.writeFileSync(path.join(dir,"rollout-2026-09-16T00-00-00-01a09d64-23c8-7e80-9215-58ad1a647868.jsonl"), rows.map(r=>JSON.stringify(r)).join("\\n")+"\\n");
const w=new Worker(${JSON.stringify(join(ROOT, "electron", "rollout-worker.cjs"))});
const done=(o)=>{process.stdout.write(JSON.stringify(o));try{w.terminate();}catch{}};
w.on("message",(m)=>done(m)); w.on("error",(e)=>done({err:String(e&&e.message)}));
w.postMessage({id:1,op:"list",root});
`], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    let parsed14 = null;
    try { parsed14 = JSON.parse(probe.stdout || "null"); } catch { parsed14 = null; }
    const title14 = String(parsed14?.data?.[0]?.name ?? "");
    (title14 === "真实问题：帮我看看这个" ? ok : fail)(`【28】侧栏标题取到包装里的用户原文（实得：${JSON.stringify(title14.slice(0, 40))}）`);
  }

  // ── Bug 3 / 6 / 1 / 2：拼一份「按生成逻辑来的」样例配置，用 tomllib 真解析 ──
  const existing = [
    'model = "old-model"',
    'approval_policy = "never"',
    "default_permissions = \":workspace\"",
    "[model_providers.mine]",
    'name = "Mine"',
    '[features]',
    "browser_use = false",
    "memories = true",
    "[otel]",
    'exporter = "none"',
    'trace_exporter = "none"',
    "[permissions.my-profile]",
    'description = "我自己写的档位"',
    '[mcp_servers."我的服务"]',
    'command = "x"',
  ].join("\n");
  const preserved = cfg.preserveUserConfig(existing);
  (preserved.topLevel.includes("approval_policy") ? ok : fail)("【28】用户顶层键归入 topLevel（必须输出在第一个段头之前）");
  (!preserved.sections.includes("approval_policy") ? ok : fail)("【28】用户顶层键不再混进「用户段」文本（旧实现被拼到文件尾部 → 被 MCP 段吞掉）");
  (preserved.sections.includes("[permissions.my-profile]") ? ok : fail)("【28】用户自己的 [permissions.*] 档位整段保留");
  (preserved.sectionExtras["features"]?.includes("memories = true") ? ok : fail)("【28】段级共享表里用户的子键进 sectionExtras（features.memories）");
  (preserved.sectionExtras["otel"]?.some((line) => line.startsWith("trace_exporter")) ? ok : fail)("【28】段级共享表里用户的子键进 sectionExtras（otel.trace_exporter）");
  (!Object.values(preserved.sectionExtras).flat().some((line) => /^browser_use/.test(line)) ? ok : fail)("【28】harness 自己的子键不被当成用户键留下（features.browser_use）");

  const configText = [
    'model = "glm-5.3-flash"',
    'model_provider = "harness"',
    'developer_instructions = """',
    "line1",
    '"""',
    ...(preserved.topLevel ? [preserved.topLevel] : []),
    "[model_providers.harness]",
    'name = "内置统一通道"',
    `base_url = "${esc("https://x.example/v1\n")}"`,
    'env_key = "CODEX_HARNESS_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "model_max_output_tokens = 393216",
    "[windows]",
    'sandbox = "unelevated"',
    "[tools]",
    "web_search = true",
    "[otel]",
    'exporter = "none"',
    "[sandbox_workspace_write]",
    "network_access = true",
    "[shell_environment_policy]",
    'inherit = "all"',
    "[shell_environment_policy.set]",
    'PATH = "C:\\\\x"',
    "[features]",
    "browser_use = true",
    "[mcp_servers.nuphus]",
    'command = "C:\\\\nuphus.exe"',
    "args = []",
    "startup_timeout_sec = 20",
    ...(preserved.sections ? [preserved.sections, ""] : []),
  ].join("\n");
  const finalText = cfg.injectMcpToolRules(
    cfg.injectSectionExtras(configText, preserved.sectionExtras),
    { nuphus: { deny: ["desktop_shell"], ask: ["desktop_mouse"], allow: ["desktop_screenshot"] } },
  );
  const PY28 = join(ROOT, "resources", "tools", "python", "python.exe");
  if (!existsSync(PY28)) {
    fail("【28】内置 python 缺席，无法做 config.toml 的 tomllib 真解析门禁");
  } else {
    const b64 = Buffer.from(finalText, "utf8").toString("base64");
    const run = spawnSync(PY28, ["-c", "import sys,base64,tomllib,json;print(json.dumps(tomllib.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))))", b64], { encoding: "utf8", windowsHide: true });
    let doc = null;
    try { doc = JSON.parse(run.stdout || "null"); } catch { doc = null; }
    (doc ? ok : fail)(`【28】样例 config.toml 被 tomllib 真解析通过${doc ? "" : `（${String(run.stderr || "").trim().split("\n").pop()?.slice(0, 120)}）`}`);
    // ⚠️ 这里刻意**不用 `if (doc)` 包住**（09-16 反证时发现的设计缺陷）：解析失败时被包住的断言会
    // 「整块跳过」——报告里一条红都没有，看起来像全绿。改成逐条断言（`doc?.`），解析失败就让
    // 每一条都红，红得显眼。
    (doc?.approval_policy === "never" ? ok : fail)("【28】tomllib：用户顶层键**在顶层**（不再落进 mcp_servers 段 —— 修 Bug 3）");
    (doc?.default_permissions === ":workspace" ? ok : fail)("【28】tomllib：用户 default_permissions 保住（harness 不再写 permissions）");
    (doc?.permissions?.["my-profile"]?.description === "我自己写的档位" ? ok : fail)("【28】tomllib：用户自定义权限档位保住");
    (doc?.features?.browser_use === true && doc?.features?.memories === true ? ok : fail)("【28】tomllib：features 段 harness 子键 + 用户子键共存（修 Bug 6）");
    (doc?.otel?.exporter === "none" && doc?.otel?.trace_exporter === "none" ? ok : fail)("【28】tomllib：otel 段同理（用户 trace_exporter 不被删）");
    (JSON.stringify(doc?.mcp_servers?.nuphus?.disabled_tools) === '["desktop_shell"]' ? ok : fail)("【28】tomllib：deny 落到 disabled_tools（工具从引擎工具表移除 = 真阻断）");
    (doc?.mcp_servers?.nuphus?.tools?.desktop_mouse?.approval_mode === "prompt" ? ok : fail)("【28】tomllib：ask 落到 [mcp_servers.X.tools.<名>] approval_mode = prompt");
    (doc?.mcp_servers?.nuphus?.tools?.desktop_screenshot?.approval_mode === "auto" ? ok : fail)("【28】tomllib：allow 落到 approval_mode = auto");
    (typeof doc?.model_providers?.harness?.base_url === "string" && doc.model_providers.harness.base_url.includes("\n") ? ok : fail)("【28】tomllib：带换行的 base_url 转义后既合法又能往返（修 Bug 5）");
    (!Object.keys(doc?.permissions ?? {}).some((key) => key.startsWith("mcp__")) ? ok : fail)("【28】tomllib：harness 不再产出任何 mcp__ 工具权限键");
  }

  // ── Bug 12：max 档不再被静默丢弃/替换（用真实 effort.ts 编译后执行） ──
  try {
    const ts = req("typescript");
    const js = ts.transpileModule(readFileSync(join(ROOT, "src", "lib", "effort.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", js)(mod, mod.exports);
    const declared = mod.exports.declaredModelEfforts;
    (declared(["max"]).includes("max") ? ok : fail)("【28】effort：只声明 max 时不再回落成整套默认档（修 Bug 12）");
    (declared(["low", "medium", "high", "max"]).includes("max") ? ok : fail)("【28】effort：声明 max 的模型在 UI 里有 max 可选");
    (mod.exports.ALL_EFFORTS.includes("max") ? ok : fail)("【28】effort：ALL_EFFORTS 含 max（引擎内置 gpt-6-astra 就声明了它）");
    (declared(["low", "medium", "high"]).includes("xhigh") ? ok : fail)("【28】effort：旧的自动三档仍补极高（产品行为不得回退）");
  } catch (error) {
    fail(`【28】effort.ts 行为断言跑不起来：${String(error?.message ?? error).slice(0, 120)}`);
  }

  // ── Bug 11：被证伪的声明不得复活（引擎**不校验** effort） ──
  const effortTs = readFileSync(join(ROOT, "src", "lib", "effort.ts"), "utf8");
  (!/否则 turn\/start 被拒/.test(mainTs) && !/否则 turn\/start 被拒/.test(effortTs) ? ok : fail)("【28】不再声称「引擎按 catalog 校验 effort，否则 turn/start 被拒」（已证伪）");
  (mainTs.includes("引擎根本不校验") || mainTs.includes("不校验档位") ? ok : fail)("【28】main.ts 注释记录了实证结论（引擎读了 catalog 但不校验档位）");
}

// ═══════════════════════════════════════════════════════════════════
// 【29】SSH-only 发布流水线（09-16）
// 背景：本机远端是 SSH（deploy key），SSH 只能推代码/标签 —— 既不能建 Release 也不能传资产，
// 本机也没有 gh CLI / API token。所以「用 SSH 发版」的唯一形态是：推 tag → Actions 用仓库自带的
// GITHUB_TOKEN 构建三端包并发布。这里把这条链的契约钉死：任何一处漂移都会让用户端**静默**收不到
// 更新（更新器按资产名匹配，名字错了不报错、只显示「已是最新」）。
// ═══════════════════════════════════════════════════════════════════
{
  const wfDir = join(ROOT, ".github", "workflows");
  const release = readFileSync(join(wfDir, "release.yml"), "utf8");
  const buildMac = readFileSync(join(wfDir, "build-mac.yml"), "utf8");
  const buildWin = readFileSync(join(wfDir, "build-win.yml"), "utf8");
  const prepWin = readFileSync(join(ROOT, "scripts", "prepare-windows-tools.cjs"), "utf8");
  const updates = readFileSync(join(ROOT, "electron", "updates.ts"), "utf8");
  const pkg29 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  (/\n\s+push:\s*\n\s+tags:\s*\n\s+- "v\*"/.test(release) ? ok : fail)("【29】release.yml 由 tag 推送触发（SSH 推 tag 即完成发版）");
  (/permissions:\s*\n\s+contents: write/.test(release) ? ok : fail)("【29】release.yml 声明 contents: write（建 Release / 传资产必需，默认只读）");
  (release.includes("uses: ./.github/workflows/build-mac.yml") && release.includes("uses: ./.github/workflows/build-win.yml") ? ok : fail)("【29】release.yml 复用两个构建工作流（构建步骤只此一份，避免同口径漂移）");
  (/^\s*workflow_call:/m.test(buildMac) && /^\s*workflow_call:/m.test(buildWin) ? ok : fail)("【29】build-mac.yml / build-win.yml 都声明 workflow_call（可被 release 复用）");
  ((/needs:\s*\[mac,\s*win\]/.test(release) || /needs:\s*\[win,\s*mac\]/.test(release)) ? ok : fail)("【29】publish 依赖 mac + win 两个 job（三端不齐不发版）");

  // 构建侧 artifact 名 ⇄ 发布侧取件目录：改名不同步 = 发布 job 找不到文件（最易漂移处）
  (buildWin.includes("name: win-x64") && release.includes("pick artifacts/win-x64") ? ok : fail)("【29】Windows artifact 名（win-x64）在构建与发布两侧一致");
  (buildMac.includes("name: mac-${{ matrix.mac_target }}") && buildMac.includes("mac_target: arm64") && buildMac.includes("mac_target: x64") ? ok : fail)("【29】mac artifact 名由 matrix 产生（mac-arm64 / mac-x64）");
  (release.includes("pick artifacts/mac-arm64") && release.includes("pick artifacts/mac-x64") ? ok : fail)("【29】发布侧按 mac-arm64 / mac-x64 取件（与构建侧 matrix 对应）");

  // 资产命名 = 更新器的匹配契约（electron/updates.ts）：名字错 → 用户静默收不到更新
  (updates.includes('a.name.includes("mac") && a.name.endsWith(".zip") && a.name.includes(arch)') && updates.includes('a.name.endsWith(".exe")') ? ok : fail)("【29】更新器匹配规则仍是「Windows 认 .exe / mac 认 mac+.zip+架构名」");
  (release.includes("-win-x64.exe") && release.includes("-arm64-mac.zip") && release.includes("-x64-mac.zip") ? ok : fail)("【29】三个资产名同时满足更新器（mac x64 强制带架构名 —— electron-builder 原生产物不带 x64）");
  (release.includes("--clobber") ? ok : fail)("【29】资产上传用 --clobber（重跑失败 job 不会因子资产重名而失败）");

  // 更新说明：应用内「发现新版本」弹窗的内容来源，缺了必须直接失败
  (release.includes("docs/releases/v${VERSION}.md") && release.includes("缺少更新说明") ? ok : fail)("【29】release.yml 强制要求 docs/releases/v<版本>.md（缺则发布失败，不当静默无说明发布）");
  const currentNotes = join(ROOT, "docs", "releases", `v${pkg29.version}.md`);
  (existsSync(currentNotes) ? ok : fail)(`【29】当前版本 ${pkg29.version} 的更新说明已在位（docs/releases/v${pkg29.version}.md）`);

  // tag ⇄ 版本号：错配会让 Release 的 tag 与包内容对不上（用户装了 0.0.19 却被提示 0.0.18）。
  // ⛔ 同样锚定实际条件表达式（第一版只查 GITHUB_REF_NAME 与 `!= "v${VERSION}"` 两个片段，
  //    把条件首项改成 `"never"` 就恒假、守卫照样绿）。
  (/if \[ "\$\{GITHUB_REF_TYPE\}" = "tag" \] && \[ "\$\{GITHUB_REF_NAME\}" != "v\$\{VERSION\}" \]; then/.test(release) ? ok : fail)("【29】推送的 tag 必须与 package.json 版本一致（错配直接失败）");

  // Windows 随包工具链：CI 干净检出里 resources/tools/* 是空的（被 gitignore），必须能由脚本现造
  (buildWin.includes("node scripts/prepare-windows-tools.cjs") ? ok : fail)("【29】Windows job 会现造随包工具链（CI 检出里 resources/tools/* 为空）");
  (buildWin.includes("node scripts/verify-packaged-tools.cjs resources/tools") && buildWin.includes("node scripts/verify-packaged-tools.cjs release/win-unpacked/resources/tools") ? ok : fail)("【29】Windows job 打包前后都跑真 MCP 握手验收（缺随包能力=坏包）");

  /* ⛔ 09-24（评估报告 §3.1）：发版前必须有预检门禁。
     此前两个 build workflow 里 grep `npm run check` / `verify` / `lint` / `accept` **全 0 命中**
     ⇒ tag 一推就自动发布，而整套预检（IPC 三件套一致性 / bag-types / 死导入 / require 路径 /
     结构守卫）与 eslint 一次都没跑过。check = build + 全部守卫，故它同时取代原来的 build 步。

     ⛔ 09-24 晚修订（v0.0.27 首发实测）：CI 干净检出上 check **跑不过** —— 预检的部分守卫依赖
     开发机工作区的打包产物（automation-tools.zip / 内置 python / rollout-worker 运行环境），
     首个发布 run 三端全挂在 check。故当前 CI 是 **build 档**，环境适配（0.0.28 加「CI 环境档」）
     完成后必须恢复 check 档。
     ⇒ 判据相应改成「两档之一」：check 档（理想），或 build 档 **且带 TODO(0.0.28) 说明**。
       仍非恒真：换成别的命令、或删掉那句说明，照样红。 */
  const gateOk = (wf) => wf.includes("run: npm run check")
    || (wf.includes("run: npm run build") && /TODO\(0\.0\.28\)/.test(wf));
  (gateOk(buildWin) ? ok : fail)("【29】Windows 构建前跑预检闸门（check 档；或 build 档且带 TODO(0.0.28) 环境适配说明）");
  (gateOk(buildMac) ? ok : fail)("【29】macOS 构建前跑预检闸门（与 Windows 同口径）");
  (buildWin.includes("run: npm run lint") && buildMac.includes("run: npm run lint") ? ok : fail)("【29】两个构建都跑 npm run lint（分层红线在 CI 上也有牙）");
  (buildWin.includes("npm run check") || /TODO\(0\.0\.28\)/.test(buildWin) ? ok : fail)("【29】不得退回「无门禁的纯构建」（当前 build 档必须带 TODO(0.0.28) 说明）");
  { /* 顺序判据：构建/预检步骤必须早于打包 —— 放到打包之后等于没门禁。
       ⛔ build 档下没有 "npm run check" 字样，取 "npm run build" 的位置（同位置同语义）。 */
    const atGate = (wf) => {
      const i = wf.indexOf("npm run check");
      return i >= 0 ? i : wf.indexOf("npm run build");
    };
    const atPack = buildWin.indexOf("electron-builder");
    (atGate(buildWin) >= 0 && atPack >= 0 && atGate(buildWin) < atPack ? ok : fail)("【29】Windows 的构建/预检排在打包之前（放之后 = 门禁失效）");
    const atPackMac = buildMac.indexOf("electron-builder");
    (atGate(buildMac) >= 0 && atPackMac >= 0 && atGate(buildMac) < atPackMac ? ok : fail)("【29】macOS 的构建/预检排在打包之前");
  }

  /* ══ 【141】随包工具链版本必须单一来源（09-24，评估报告 §3.4）══
     实测漂移：playwright-core 在 Windows 是 1.62.1、mac 是 1.58.2，**差 4 个小版本**，
     而两处都没有任何注释说明原因 —— 根因不是"改错了"，是"两处独立字面量"这个机制。 */
  {
    const versionsPath = join(ROOT, "scripts", "lib", "tools-versions.cjs");
    (existsSync(versionsPath) ? ok : fail)("【141】scripts/lib/tools-versions.cjs 存在（版本单一来源）");
    const versionsSrc = readFileSync(versionsPath, "utf8");
    (/"0\.2\.3"/.test(versionsSrc) && /win32: "1\.62\.1"/.test(versionsSrc) && /darwin: "1\.58\.2"/.test(versionsSrc) ? ok : fail)(
      "【141】各平台现值保留在表里（⛔ 不得为「对齐」擅自改 mac 的 playwright-core —— 本机验不了，属产品决策）"
    );
    const prepWinSrc = readFileSync(join(ROOT, "scripts", "prepare-windows-tools.cjs"), "utf8");
    const prepMacSrc = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
    (/require\("\.\/lib\/tools-versions\.cjs"\)/.test(prepWinSrc) && /require\("\.\/lib\/tools-versions\.cjs"\)/.test(prepMacSrc) ? ok : fail)(
      "【141】两个 prepare 脚本都从单一来源取版本（任一侧留字面量 = 漂移机制回来了）"
    );
    (!/const NUPHUS_VERSION = "/.test(prepWinSrc) ? ok : fail)("【141】Windows 侧不得再留自写版本字面量");
    (!/@nuphus\/nuphus-mcp@\d/.test(prepMacSrc) ? ok : fail)("【141】mac 侧不得再留自写 npm 版本字面量");
    (!/playwright-core@\d/.test(prepMacSrc) ? ok : fail)("【141】mac 侧不得再留自写 playwright-core 字面量");
    /* 四处同源的第四处（CI workflow 的 ref:）也要与表一致 */
    const wantNuphus = (/nuphus: "([^"]+)"/.exec(versionsSrc) ?? [])[1] ?? "";
    (wantNuphus && buildMac.includes(`ref: v${wantNuphus}`) ? ok : fail)(
      `【141】build-mac.yml 的 nuphus ref 与版本表一致（表 ${wantNuphus}）`
    );
  }

  /* ══ 【142】陈旧 dist 必须可见（09-24，评估报告 §3.3）══
     实测 dist 4,504 文件 / 187 MB，index.html 只引用 8 个（2.52 MB）⇒ 98.65% 是死重，
     约 51–57 MB 会被打进**本地**安装包（CI 从干净检出构建，不受影响）。
     修法 = 打包期裁剪；但本地默认**不删**（正在运行的旧实例会因旧 chunk 被删而懒加载 404，
     与 09-23 那次崩溃同源）⇒ 必须保留"CI 默认开 / 本地显式 PACK_PRUNE_STALE_DIST=1"的分档。 */
  {
    const packSrc = readFileSync(join(ROOT, "scripts", "before-pack.cjs"), "utf8");
    (/function pruneStaleDistAssets\(/.test(packSrc) ? ok : fail)("【142】before-pack 有打包期陈旧产物裁剪（否则死重照进安装包）");
    (/process\.env\.CI \|\| process\.env\.PACK_PRUNE_STALE_DIST === "1"/.test(packSrc) ? ok : fail)(
      "【142】本地默认不删（只有 CI 或显式开启才删）—— 否则正在运行的旧实例会懒加载 404"
    );
    (/约 \$\{mb\} MB 会被打进安装包/.test(packSrc) ? ok : fail)("【142】不开删时也要把可省空间打出来（让这笔账一直可见）");
    /* 裁剪必须排在所有早退分支之前（darwin / AUTOMATION_ZIP_OPTIONAL），否则 mac 与"可选包"两条路都不裁。 */
    const atPrune = packSrc.indexOf("pruneStaleDistAssets(path.resolve(__dirname");
    const atDarwin = packSrc.indexOf('if (process.platform === "darwin") return;');
    (atPrune >= 0 && atDarwin > atPrune ? ok : fail)("【142】裁剪排在早退分支之前（放在之后 mac 与可选包两条路都不裁）");
    /* 反向绊线：不得为了省体积去动 emptyOutDir（那正是 09-23 崩溃的修法）。 */
    const viteSrc = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    (/emptyOutDir: false/.test(viteSrc) ? ok : fail)("【142】vite 仍设 emptyOutDir:false（改回 true = 重演运行中实例懒加载 404）");
  }
  const prepMarkers = [
    "npm-global/node_modules/@nuphus/nuphus-mcp/package.json",
    "npm-global/node_modules/@playwright/cli/package.json",
    // 引擎按 `nuphus-call …` 命令行调用桌面工具（35 个 schema 不进上下文）⇒ 这个桥必须在 PATH 上。
    // 它不是任何 npm 包的 bin（npm 不会生成），mac 侧由 prepare-mac-tools 写 bin/nuphus-call，
    // Windows 侧必须由本脚本写 npm-global/nuphus-call.cmd —— 漏了就是「README 有、用户用不了」。
    "npm-global/nuphus-call.cmd",
    "vscode-cli/code.exe",
    "cloudflared.exe",
    "ponytail-plugin/.codex-plugin",
    "pwsh-headless/pwsh.exe",
  ];
  const missingPrep = prepMarkers.filter((m) => !prepWin.includes(m));
  (missingPrep.length === 0 ? ok : fail)(`【29】prepare-windows-tools 硬校验覆盖随包能力${missingPrep.length ? "（缺：" + missingPrep.join(", ") + "）" : ""}`);
  // ⛔ 只查 marker 字符串不够：把 `writeNuphusCallShim(prefix)` / `buildHeadlessBridge()` 注释掉，
  //    marker 列表还在、硬校验反而会**正确地报缺**……但在「只注释调用、没跑脚本」的情形下预检
  //    照样绿（假绿）。这里锚定两个**副作用调用本身**必须出现在 main 流程里。
  (/^\s+writeNuphusCallShim\(prefix\);\s*$/m.test(prepWin) ? ok : fail)("【29】prepare-windows-tools 真的会写 nuphus-call 命令行桥（不是只在注释/校验表里提它）");
  (/^\s+buildHeadlessBridge\(\);\s*$/m.test(prepWin) && /csc\.exe/.test(prepWin) && /target:winexe/.test(prepWin) ? ok : fail)("【29】prepare-windows-tools 真的会编译 pwsh 无窗口桥（csc /target:winexe）");

  // extraResources 里每条 resources/tools 源，要么 prep 脚本能造、要么有明确出处
  // extraResources 里每条 resources/tools 源，要么 prep 脚本能造、要么有明确出处：
  //   - automation-tools.zip：before-pack.cjs 由 npm-global 现造
  //   - 三个 .mjs 助手：在 .gitignore 规则之前就已纳入版本控制，干净检出里就有
  const BY_DESIGN = new Set([
    "resources/tools/automation-tools.zip",
    "resources/tools/nuphus-call.mjs",
    "resources/tools/harness-media.mjs",
    "resources/tools/cloak-open.mjs",
  ]);
  const uncovered = [];
  for (const entry of pkg29.build?.extraResources ?? []) {
    const from = typeof entry === "string" ? entry : entry?.from;
    if (!from || !from.startsWith("resources/tools/")) continue;
    if (BY_DESIGN.has(from)) continue;
    const seg = from.slice("resources/tools/".length);
    if (!prepWin.includes(seg)) uncovered.push(from);
  }
  (uncovered.length === 0 ? ok : fail)(`【29】Windows 随包源全部可由 CI 现造${uncovered.length ? "（未覆盖：" + uncovered.join(", ") + "）" : ""}`);

  // pwsh 无窗口桥的源码必须在版本控制里（否则 CI 编译不出 pwsh-headless/pwsh.exe）
  const gitignore29 = readFileSync(join(ROOT, ".gitignore"), "utf8");
  (gitignore29.includes("!resources/tools/pwsh-headless/PwshHeadless.cs") && existsSync(join(ROOT, "resources", "tools", "pwsh-headless", "PwshHeadless.cs")) ? ok : fail)("【29】pwsh-headless 源码已纳入版本控制（CI 现场编译）");

  // ⛔ 打 zip 的执行体必须能独立于「随包 python」工作：09-16 安装包瘦身把 python 移出随包、
  //    资源目录又被 gitignore ⇒ CI 干净检出里没有 python，而 before-pack → pack-automation 在
  //    Windows job 里是打包前置步骤。只用 python 的实现会让整条发布流水线在 CI 上直接失败。
  const packScript = readFileSync(join(ROOT, "scripts", "pack-automation.cjs"), "utf8");
  // ⛔ 断言要锚定**实际分支条件**，不能只查标识符存在 —— 第一版只查 "System32"/packWithTar/--exclude
  //    三个名字，把 `if (tarBin)` 改成 `if (false && tarBin)` 照样绿（假绿，反证时才发现）。
  (/\nif \(tarBin\) \{\n {2}try \{ packWithTar\(tarBin\); packed = true; \}/.test(packScript) ? ok : fail)("【29】pack-automation 优先用 bsdtar（Windows 自带 tar.exe，CI 无随包 python 也能打 zip）");
  (packScript.includes("npm-global/node_modules/cloakbrowser") && packScript.includes("npm-global/node_modules/.bin/cloakbrowser") ? ok : fail)("【29】bsdtar 分支的排除清单与 python 分支同源（含 .bin shim，否则「修复安装」把 CloakBrowser 装回来）");
  (packScript.includes("npm-global/cloakbrowser.cmd") ? ok : fail)("【29】排除清单覆盖顶层 cloakbrowser shim 三件套");
}

// ---------- 汇总 ----------

// ---------- 【29】发送动画交接 + 浮层动画位移 + 插队退化（09-17 三起实测事故的回归网） ----------
{
  const app = readAppUi();
  const css = readStyles();
  // ⛔ 必须剥注释再断言：本轮首版守卫就被自己的**注释**喂成假绿 —— `no active turn`、
  //    `compact-toast-in` 这些词在解释性注释里也会出现，只查字符串存在等于没查（AGENTS.md 已点名）。
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const appCode = stripComments(app);
  const cssCode = stripComments(css);

  // ① 入场动画必须由真实消息「认领」
  //   事故：动画只登记在乐观气泡上，真实消息几十毫秒内接管、气泡卸载 → 动画被腰斩
  //   （实测 t+13ms opacity 0.24 → t+34ms 节点已消失），消息"啪"地跳到位、没有过渡。
  /function claimSendAnimation\(/.test(appCode) && /function armSendAnimationClaim\(/.test(appCode)
    ? ok("发送入场动画交接机制在（armSendAnimationClaim / claimSendAnimation 成对）")
    : fail("缺少 arm/claimSendAnimation —— 真实消息接管时动画被腰斩（消息没有过渡到落点）");
  /claimSendAnimation\(itemText\(item\)\)/.test(appCode)
    ? ok("真实消息挂载时认领动画（UserMessageView lazy 初始化里）")
    : fail("UserMessageView 没有认领动画 —— 乐观气泡卸载后动画不会接手");
  (/armSendAnimationClaim\(messageText\)/.test(appCode) && /armSendAnimationClaim\(text\)/.test(appCode))
    ? ok("发送处（普通发送 + 编辑重发）都登记了待认领动画")
    : fail("发送处缺少 armSendAnimationClaim —— 认领永远不命中，动画又会被腰斩");

  // ② 带 translate(-50%) 的入场动画只能给「left:50% 居中定位」的元素用
  //   事故：限流条借用 compact-toast-in → 整体左移自身宽度一半（实测 tx=-237px = 474.8/2），
  //   表现为「靠左、越出输入框左缘、右边被切」。
  const toastAt = cssCode.indexOf("@keyframes compact-toast-in");
  const toastBlock = toastAt < 0 ? "" : cssCode.slice(toastAt, toastAt + 400);
  /translate\(\s*-50%/.test(toastBlock)
    ? (/\.rate-limit-retry-bar\s*\{[^}]*compact-toast-in/.test(cssCode)
        ? fail("限流条又借用了 compact-toast-in（含 translate(-50%)）—— 会左移半个宽度、越出输入框被切")
        : ok("限流条没有借用带 -50% 位移的动画（不会整体左移）"))
    : ok("compact-toast-in 不含横向位移（借用安全）");
  /@keyframes\s+rate-limit-bar-in/.test(cssCode)
    ? ok("限流条专用入场动画 rate-limit-bar-in 在")
    : fail("rate-limit-bar-in 缺失 —— 限流条入场动画会被换回带位移的那套");

  // ③ 插队（turn/steer）必须先判定「真的有回合在跑」，并在引擎回 no active turn 时退化
  //   事故（用户实测「插队消息每次都报错」）：原实现只认 activeTurnId，上一轮 429/中断/跑完后
  //   它仍是旧值 → 引擎回 `no active turn to steer`，消息卡在队列里永远发不出去。
  const startIdx = appCode.indexOf("async function startQueued");
  const queuedFn = startIdx < 0 ? "" : appCode.slice(startIdx, startIdx + 3200);
  // 锚定「运行中回合」判定必须由 isTurnRunning 驱动、且 steer 用的是这个结果（不是裸 activeTurnId）
  (/const runningTurnId = [^\n]*isTurnRunning\(turn\)/.test(queuedFn) && /expectedTurnId: steerTurnId/.test(queuedFn))
    ? ok("插队前按 isTurnRunning 判定运行中回合（不再只看陈旧的 activeTurnId）")
    : fail("插队只看 activeTurnId —— 上一轮结束后插队必报 no active turn（用户实测「每次都报错」）");
  (/if \(!\/no active turn\/i\.test\(message\)\)/.test(queuedFn) && /thread\/queue\/start/.test(queuedFn))
    ? ok("引擎回 no active turn 时退化为开始新回合（消息不会卡在队列里）")
    : fail("no active turn 没有退化路径 —— 排队消息会卡在队列里发不出去");

  // ④ 相位续播：这是「不再两步」的核心时序判定（纯函数在 src/lib/send-anim.mjs）
  {
    const { createSendAnimClaim, armSendAnimationClaim, claimSendAnimation, SEND_ANIM_DURATION_MS, SEND_CLAIM_TTL_MS } = await import("../../src/lib/send-anim.mjs");
    const T0 = 1_000_000;
    const TEXT = "你好世界这是一条测试消息";
    const run = (elapsed, realText = TEXT) => {
      const store = createSendAnimClaim();
      armSendAnimationClaim(store, TEXT, T0);
      return claimSendAnimation(store, realText, T0 + elapsed);
    };
    const fast = run(30);
    (fast.kind === "continue" && fast.delayMs === 30)
      ? ok("快回声（30ms）：认领并给出续播相位 30ms（真实节点不再从 0% 重起）")
      : fail(`快回声应续播 30ms，实际 ${JSON.stringify(fast)}`);
    const slow = run(SEND_ANIM_DURATION_MS + 50);
    slow.kind === "skip"
      ? ok("慢回声（≥动画时长）：跳过补播（消息早已在屏上，不再「飞」一下）")
      : fail(`慢回声应 skip，实际 ${JSON.stringify(slow)}`);
    const prefixed = run(40, `[记忆] ${TEXT} 补充说明`);
    prefixed.kind === "continue"
      ? ok("真实正文带记忆/引用前缀仍能认领（前缀匹配）")
      : fail(`带前缀应 continue，实际 ${JSON.stringify(prefixed)}`);
    const wrong = run(40, "完全不相干的内容");
    wrong.kind === "none"
      ? ok("文本对不上不认领（历史/其它消息不会误播）")
      : fail(`文本不匹配应 none，实际 ${JSON.stringify(wrong)}`);
    const expired = run(SEND_CLAIM_TTL_MS + 1);
    expired.kind === "none"
      ? ok("超过 TTL 不认领（切会话重挂载不误播）")
      : fail(`超时应 none，实际 ${JSON.stringify(expired)}`);
    const onceStore = createSendAnimClaim();
    armSendAnimationClaim(onceStore, TEXT, T0);
    const first = claimSendAnimation(onceStore, TEXT, T0 + 10);
    const second = claimSendAnimation(onceStore, TEXT, T0 + 20);
    (first.kind === "continue" && second.kind === "none")
      ? ok("认领是一次性的（第二次不再播）")
      : fail(`认领应一次性，实际 ${first.kind} / ${second.kind}`);
    claimSendAnimation(createSendAnimClaim(), TEXT, T0).kind === "none"
      ? ok("没有登记时不认领（不凭空播动画）")
      : fail("没登记也认领了 —— 会凭空播动画");
    // 接线：delayMs 必须真的落到 DOM 的 inline animation-delay
    /style=\{sendAnimDelay \? \{ animationDelay: `-\$\{sendAnimDelay\}ms` \} : undefined\}/.test(app)
      ? ok("续播相位落到 DOM（inline animation-delay 接线在）")
      : fail("App.tsx 没有把续播相位写成 inline animation-delay —— 认领到的相位被丢掉，仍会从 0% 重起");
  }

  // ⑤ 乐观气泡安全阀的判据（09-17 用户实测：「消息发出去，先是旧内容+生成条，过一会才看到我的消息」）
  //   事故：原判据「当前没有任何 running 回合」在**正常发送**时同样成立 —— 气泡上屏后本轮 turn 还没建
  //   （要等 turn/start 往返 + 记忆召回），条件立刻命中 → 探针实测气泡**只活 6~8ms**，而真实消息
  //   1.7~3.3s 才到 ⇒ 用户自己的消息有 2~3 秒**完全不在界面上**（只剩「正在生成回复」状态条，
  //   也就是用户截图里问的"中间那个"）。修好后同一探针：气泡存活 1344ms、直到真实消息接管才消失。
  {
    /const sawRunningTurnRef = useRef\(false\)/.test(appCode)
      ? ok("【29】乐观气泡安全阀有「本轮曾出现过运行中回合」判据（sawRunningTurnRef）")
      : fail("【29】安全阀没有 sawRunningTurnRef —— 气泡会在本轮 turn 建立前被误回收（消息消失 2~3 秒）");
    /if \(running\) sawRunningTurnRef\.current = true;/.test(appCode)
      ? ok("【29】检测到运行中回合时置位判据（回合结束后才允许回收）")
      : fail("【29】判据没有被置位 —— 回收条件永远不成立 / 或气泡会赖着");
    /if \(!running && sawRunningTurnRef\.current\)/.test(appCode)
      ? ok("【29】回收条件要求「曾出现过运行中回合」（不再是裸 !running）")
      : fail("【29】回收条件仍是裸 !running —— 正常发送时气泡被秒回收（实测 6~8ms）");
    /setTimeout\(\(\) => \{[\s\S]{0,220}isTurnRunning\(turn\)[\s\S]{0,140}\}, 15_000\)/.test(appCode)
      ? ok("【29】有 15s 超时兜底（引擎始终不回时气泡不会一直赖在聊天区）")
      : fail("【29】缺超时兜底 —— 引擎不回应时气泡会永久赖在聊天区（09-13 修过的老问题）");
    // ⛔ 只数次数是弱守卫（09-18）：加/删任意一处都能绕过；按**函数切片**也不行 ——
    //   `async function send` 在文件里出现在 editResend **之后**，切片会取到空串（当场假红）。
    //   真判据 = 逐处复位点算出「它属于哪个函数」，再要求 editResend 与 send 都在名单里。
    const resetOwner = (offset) => {
      const i = Math.max(appCode.lastIndexOf("async function ", offset), appCode.lastIndexOf("function ", offset));
      if (i < 0) return "?";
      const m = appCode.slice(i, i + 80).match(/function\s+([A-Za-z0-9_]+)/);
      return m ? m[1] : "?";
    };
    const resetOwners = [...appCode.matchAll(/sawRunningTurnRef\.current = false;/g)].map((m) => resetOwner(m.index));
    (resetOwners.length >= 5 && resetOwners.includes("editResend") && resetOwners.filter((n) => n === "send").length >= 2)
      ? ok("【29】判据在两处回收 + 三条发送路径（普通 / 排队 / 编辑重发）全部复位")
      : fail(`【29】有发送路径没复位 sawRunningTurnRef（归属：${resetOwners.join("/")}）—— 上一轮的置位会污染本轮`);
  }

  // ⑥b 编辑重发（fork + 重发）不能把用户的消息弄丢（09-18 用户：「我编辑消息，保存重新，发送，消息不见了」）
  //   真机复现链（隔离 profile + 60ms 采样 + window.__adbg 埋点）：提交后 fork 立刻把旧回合从可见列表拿掉，
  //   而编辑后那条**自己的消息**本该由乐观气泡顶着 —— 但 editResend 漏了 sawRunningTurnRef 复位，
  //   安全阀判据带着上一轮的 true、又见 fork 后新回合还没建（running=false）⇒ 气泡**当帧被回收**
  //   （埋点 confirm-timeout、pending 恒 0），于是有 1~2s 界面上连用户自己的消息都没有；
  //   更糟的是 turn/start 失败时 catch 只清气泡不回退 ⇒ 消息**永久消失**。
  {
    const editResendBody = appCode.slice(appCode.indexOf("async function editResend"), appCode.indexOf("async function copyImage"));
    (editResendBody.length > 200 ? ok : fail)("【42】editResend 函数体可定位（守卫读的是真函数，不是全文）");
    // ⛔⛔ 09-19 用户要求「我点编辑消息，保存就知道新建会话，要在原会话继续跑」：
    //   编辑重发**不再 fork**（原来 fork 会另建会话，用户视角就是"莫名多了个会话"）。
    //   守卫随之反转：必须**不 fork**（改回 fork 会红），且失败路径不得再依赖"回退会话"
    //   （没换过 thread，回退是死逻辑 —— 代码审查发现过）。
    (!/thread\/fork/.test(editResendBody) ? ok : fail)(
      "【42】编辑重发在原会话进行（不得 fork 另建会话）"
    );
    (/const forked = \{ thread: threadRef\.current \?\? thread \};/.test(editResendBody) ? ok : fail)(
      "【42】编辑重发明确指向当前会话（同一个会话继续跑）"
    );
    (!/const before = threadRef\.current;/.test(editResendBody) ? ok : fail)(
      "【42】不再有「fork 前会话」死代码（没换 thread 就无需回退）"
    );
    (/原消息仍在，可重试/.test(editResendBody) ? ok : fail)(
      "【42】失败提示说清「原消息仍在，可重试」（不是干巴巴一句失败）"
    );
  }

  // ⑥ 生成状态条的渲染顺序（09-17 用户实测：「这个怎么到这个位置了」）
  //   事故：run-activity-bar 排在 #chat-anchor（乐观气泡）**之前** → 发送后那段「消息已上屏、
  //   引擎还没回声」的窗口里，状态条显示在刚发出的消息**上方**。
  //   运行时反证：改回原顺序 → 气泡 top=80 / 状态条 top=51，与用户截图的比例一致。
  //   ⛔ 必须按**源码顺序**断言（indexOf 比较），只查「两个类名都存在」等于没查。
  {
    const anchorIdx = appCode.indexOf('id="chat-anchor"');
    const barIdx = appCode.indexOf('className="run-activity-bar"');
    (anchorIdx >= 0 && barIdx >= 0 && anchorIdx < barIdx)
      ? ok("【29】生成状态条排在乐观气泡**之后**（不会显示在你的消息上方）")
      : fail("【29】run-activity-bar 排在 #chat-anchor 之前 —— 发送后状态条会出现在你消息的上方（用户实测）");
    ((appCode.match(/className="run-activity-bar"/g) || []).length === 1)
      ? ok("【29】状态条只渲染一处（多份会让它上下各出现一次）")
      : fail("【29】run-activity-bar 渲染点不唯一");
  }

  // ⑦ mac「不使用项目地址」+ 快捷键平台分叉（09-17 用户报：「mac 的不使用项目地址功能用不了，没有适配」）
  //   三个独立死因（任一都足以让 mac 用不了）：
  //   ① 发送路径条件是裸 `!workspace` —— mac 全新机器从没设过项目地址，于是用户明确选了
  //      「不使用项目地址」也照样被清掉 + 强制弹目录选择框（运行时反证：消息被目录框拦住、永不上屏）。
  //   ② 全局 keydown 写死 `!event.ctrlKey || … || event.metaKey` —— mac 的命令键是 ⌘，
  //      这句把 mac 的**所有**快捷键 return 掉（⌘O 打开工作区就在其中）。
  //   ③ scratch 目录优先写 app 安装目录 —— mac 上那是 .app/Contents/MacOS，写进去破坏代码签名。
  {
    const mainSrc = readMainSource();
    /if \(!workspace && !welcomeScratchDir\) \{/.test(appCode)
      ? ok("【30】欢迎页发送路径：有 scratch 时不弹目录选择框（mac 上该选项才真的能用）")
      : fail("【30】发送路径条件缺 !welcomeScratchDir —— mac 全新机器上「不使用项目地址」会被清掉并弹框");
    /if \(welcomeScratchDir\) setWelcomeScratchDir\(null\);\s*\n\s*await chooseWorkspace\(\)/.test(appCode)
      ? fail("【30】旧写法回归 —— 发送时会把用户刚选的临时目录清掉")
      : ok("【30】已无「无条件清 scratch 再弹框」的旧写法");

    /const mod = mac \? event\.metaKey : event\.ctrlKey;/.test(appCode)
      ? ok("【30】快捷键命令键按平台分叉（mac = ⌘）")
      : fail("【30】快捷键写死 ctrlKey —— mac 上所有快捷键失效（⌘O 打开工作区也废）");
    // ⛔ 不能只匹配旧字面串（`!event.ctrlKey || … || event.metaKey`）—— 换成等价的
    //    `!mod || event.altKey || event.metaKey` 就漏检（反证实测为假绿）。改为**结构性**判据：
    //    分叉是**成对**的两行（mod / otherMod），所以 handler 体里 `event.metaKey` 恰好出现 2 次；
    //    再把它当干扰键拦一次（旧写法）就会变成 3 次，守卫立刻红。
    {
      const onKeyIdx = appCode.indexOf("function onKey(event: globalThis.KeyboardEvent) {");
      const onKeyBody = onKeyIdx < 0 ? "" : appCode.slice(onKeyIdx, onKeyIdx + 1200);
      const metaCount = (onKeyBody.match(/event\.metaKey/g) || []).length;
      (/const mod = mac \? event\.metaKey : event\.ctrlKey;/.test(onKeyBody)
        && /const otherMod = mac \? event\.ctrlKey : event\.metaKey;/.test(onKeyBody)
        && metaCount === 2)
        ? ok("【30】handler 里 metaKey 只用于成对平台分叉（没被当干扰键拦掉）")
        : fail(`【30】metaKey 用法异常（分叉缺失或出现 ${metaCount} 次）—— mac 的 ⌘ 会被 return 掉`);
    }

    /* 09-22 收紧：scratch root 必须**全平台**统一 userData —— 旧 darwin 分支写法允许 win 落 exe 同级目录，
       实测 dist/scratch 里的会话记忆被构建清掉（假记忆）；打包后在 Program Files 还会只读。
       ⛔ 只检查 scratch:create handler 的函数体窗口 —— 聚合源里别处（如注释）出现 exe 字样不算。 */
    const scratchIdx = mainSrc.indexOf('ipcMain.handle("scratch:create"');
    const scratchBody = scratchIdx < 0 ? "" : mainSrc.slice(scratchIdx, scratchIdx + 500);
    (/getPath\("userData"\)/.test(scratchBody) && scratchBody.includes('"scratch"') && !/dirname\(app\.getPath\("exe"\)\)/.test(scratchBody))
      ? ok("【30】scratch:create 全平台落 userData（不写 exe 同级 dist / .app bundle）")
      : fail("【30】scratch:create 未统一落 userData —— exe 同级目录会被构建清空（记忆丢失）或只读（Program Files）");

    // 展示层：快捷键标签平台化必须走 src/lib/hotkey.mjs 的纯函数（本机是 Windows 跑不到 mac 分支，
    // 只有纯函数断言能证明「mac 上显示成 ⌘」而不是靠猜）
    // ⛔ 09-22：接线形态变了 —— App 不再直接 import macHotkeyLabel，而是 `import { hk } from "./lib/hk"`
    //   再用 `hk("Ctrl+K")`，由 src/lib/hk.ts 内部做 `isMacPlatform() ? macHotkeyLabel(label) : …`。
    //   断言改为核**整条链**（App 用了 hk 且 hk 委派给 macHotkeyLabel + isMacPlatform），
    //   比原来只认 App 的一行 import 更贴住"平台化真的生效"这个意图。
    const hkPath = join(ROOT, "src", "lib", "hk.ts");
    const hkSrc = existsSync(hkPath) ? readFileSync(hkPath, "utf8") : "";
    const appUsesHk = /from "[^"]*lib\/hk"/.test(appCode) && /\bhk\(/.test(appCode);
    const hkDelegates = /isMacPlatform\(\)/.test(hkSrc) && /macHotkeyLabel\(/.test(hkSrc);
    appUsesHk && hkDelegates
      ? ok("【30】快捷键标签平台化已接线（App → lib/hk → isMacPlatform ? macHotkeyLabel）")
      : fail(`【30】快捷键标签平台化断链（App 用 hk=${appUsesHk} / hk.ts 委派=${hkDelegates}）—— mac 上仍显示 Ctrl`);
  }

  // ⑧ 快捷键标签转换的**行为**断言（纯函数，与平台探测解耦）
  {
    const { macHotkeyLabel, hotkeyLabel } = await import("../../src/lib/hotkey.mjs");
    const rows = [
      ["Ctrl+Shift+F", "⌘⇧F"],
      ["Ctrl+O", "⌘O"],
      ["Shift+Enter", "⇧Enter"],
      ["Ctrl+Z / Ctrl+Y", "⌘Z / ⌘Y"],
      ["Esc", "Esc"],
    ];
    const bad = rows.filter(([input, expected]) => macHotkeyLabel(input) !== expected);
    (bad.length === 0 ? ok : fail)(`【30】mac 标签转换规则正确（${rows.length} 条${bad.length ? "，错：" + bad.map(([i]) => i).join(",") : ""}）`);
    (hotkeyLabel("Ctrl+O", "win32") === "Ctrl+O" && hotkeyLabel("Ctrl+O", "darwin") === "⌘O" ? ok : fail)("【30】Windows 侧标签原样不变（只 mac 转换）");
    // 接线：快捷键一览与命令面板都过 hk()
    (/keys: item\.keys\.map\(hk\)/.test(appCode) && /\{row\.shortcut && <kbd>\{hk\(row\.shortcut\)\}<\/kbd>\}/.test(appCode))
      ? ok("【30】快捷键一览 + 命令面板都走 hk()（不再是写死的 Ctrl 文案）")
      : fail("【30】有展示点没走 hk() —— mac 上仍会看到 Ctrl 文案");
  }

  // ⑨ 产物可启动性（09-17 用户报「启动就白屏」后补的网）
  //   用户白屏时我做的第一件事是「回退源码重建」——说明**产物层面**也要能自证：
  //   构建被打断 / 被别的进程占用时，会留下「index.html 引用不存在的 chunk」或
  //   「0 字节的 main.js」，这两种都会让应用**白屏**，而源码侧完全看不出来。
  //   ⛔ 排查经验：白屏时 CDP 求值/截图会**整体超时**，别据此断言「代码坏了」——
  //   正确姿势是 `electron --enable-logging <appDir>` 抓渲染层 console，或换隔离 profile 复测。
  {
    const distHtml = join(ROOT, "dist", "index.html");
    const html = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|data:)/.test(r));
    const missing = refs.filter((r) => !existsSync(join(ROOT, "dist", r.replace(/^\.?\//, ""))));
    (missing.length === 0 ? ok : fail)(`【31】dist/index.html 引用的 ${refs.length} 个资源都在${missing.length ? "（缺：" + missing.join(", ") + "）" : ""}`);
    const artifacts = ["dist-electron/main.js", "dist-electron/preload.js", ...refs.map((r) => join("dist", r.replace(/^\.?\//, "")))];
    const bad = artifacts.filter((p) => { try { return readFileSync(join(ROOT, p)).length < 64; } catch { return true; } });
    (bad.length === 0 ? ok : fail)(`【31】关键产物非空且可读（${artifacts.length} 个）${bad.length ? "（异常：" + bad.join(", ") + "）" : ""}`);
  }

  // ⑩ 调度锁「孤儿持有者」+ 一键释放（09-17 用户实测「都关掉了，怎么还提示被锁住了」）
  //    事故：锁持有者是**从 thread-runtime 记录派生的**（第一个 dispatch.enabled 的线程），而会话被
  //    归档/删除时**没有任何地方清这条记录** —— store 里那句「记录被清掉时锁会自动释放」当年只是设想，
  //    实现里连 remove 都没有 ⇒ 孤儿记录永久占着全局唯一的调度权，而那条会话在侧栏上已找不到，
  //    用户**没有任何入口**能关它（实测：记录里 enabled=true，其 threadId 在引擎 state 库里已不存在）。
  {
    const mainCode = readMainSource();
    const storeCode = stripComments(readFileSync(join(ROOT, "electron", "thread-runtime-store.ts"), "utf8"));

    // 防线一：主进程必须真的有清理**调用点**（有方法不等于有人调，这正是当初的坑）
    (/threadRuntimeStore\.remove\(/.test(mainCode) && /threadRuntimeStore\.releaseDispatch\(/.test(mainCode))
      ? ok("【29】主进程有调度记录清理调用点（remove / releaseDispatch）")
      : fail("【29】没有任何地方清调度记录 —— 归档/删除会话会留下孤儿记录永久占锁");

    // 防线二：清理挂在引擎 thread/archived | thread/deleted 事件上（覆盖所有删除/归档路径，不靠 UI 自觉）
    const evIdx = mainCode.indexOf('event.method === "thread/archived"');
    const evSlice = evIdx < 0 ? "" : mainCode.slice(evIdx, evIdx + 900);
    (evIdx >= 0 && /thread\/deleted/.test(evSlice) && /threadRuntimeStore\.(remove|releaseDispatch)\(/.test(evSlice))
      ? ok("【29】归档/删除事件触发记录清理（覆盖所有路径）")
      : fail("【29】thread/archived|deleted 事件没接记录清理 —— 会话消失后锁仍被占");

    // 防线三：store 真的实现了这两个方法（旧版连 remove 都没有）
    (/async releaseDispatch\(threadId: string\): Promise<boolean>/.test(storeCode) && /async remove\(threadId: string\): Promise<boolean>/.test(storeCode))
      ? ok("【29】store 实现 releaseDispatch / remove")
      : fail("【29】store 缺 releaseDispatch/remove —— 清理调用点会全部落空");

    // 防线四：渲染层自愈 —— 持有者不在会话列表里就自动释放（覆盖历史坏数据，用户不必手改 json）
    const healIdx = appCode.indexOf("window.codex.releaseDispatch(");
    const healSlice = healIdx < 0 ? "" : appCode.slice(Math.max(0, healIdx - 700), healIdx + 220);
    (/threads\.some\(\(entry\) => entry\.id === dispatchOwnerId\)/.test(healSlice) && /if \(!dispatchOwnerId \|\| threads\.length === 0\) return;/.test(healSlice))
      ? ok("【29】渲染层自愈：持有者不在会话列表时自动释放（历史坏数据也能解）")
      : fail("【29】缺少「持有者已消失」自愈 —— 孤儿锁只能靠用户手改 json");

    // 防线五：一键释放（用户 09-17 要求「在调度里面加一个主动释放功能，一键释放后删除旧的调度会话」）
    const releaseIdx = appCode.indexOf("async function releaseDispatchHolder()");
    const releaseFn = releaseIdx < 0 ? "" : appCode.slice(releaseIdx, releaseIdx + 2200);
    (/openAppConfirm\(/.test(releaseFn) && /window\.codex\.releaseDispatch\(holderId\)/.test(releaseFn) && /deleteThreadCore\(holderId\)/.test(releaseFn))
      ? ok("【29】一键释放：确认 → 释放锁 → 删除旧会话（三步齐）")
      : fail("【29】一键释放不完整（缺确认 / 缺释放 / 缺删除）");
    // 顺序必须是「先释放、后删除」：删失败时用户至少已经拿回调度权
    (releaseFn.indexOf("window.codex.releaseDispatch(holderId)") > -1
      && releaseFn.indexOf("window.codex.releaseDispatch(holderId)") < releaseFn.indexOf("deleteThreadCore(holderId)"))
      ? ok("【29】一键释放顺序 = 先释放、后删除（删除失败也不丢调度权）")
      : fail("【29】一键释放顺序反了或缺失 —— 删除失败会把调度权一起卡住");

    // 防线六：删除只有一条内核（普通删除与一键释放共用）——别处再写简版删除必漏衍生状态
    const coreIdx = appCode.indexOf("async function deleteThreadCore(id: string)");
    const coreFn = coreIdx < 0 ? "" : appCode.slice(coreIdx, coreIdx + 900);
    const coreCallers = (appCode.match(/await deleteThreadCore\(/g) || []).length;
    (coreIdx >= 0 && coreCallers >= 2)
      ? ok("【29】删除会话走唯一内核 deleteThreadCore（普通删除 / 一键释放共用）")
      : fail(`【29】deleteThreadCore 缺失或调用点不足（${coreCallers} 处）—— 会出现漏清衍生状态的简版删除`);
    (/threadCacheRef\.current\.delete\(id\)/.test(coreFn) && /threadProviderRef\.current\.delete\(id\)/.test(coreFn))
      ? ok("【29】删除内核清理衍生状态（会话缓存 + 供应商登记）")
      : fail("【29】删除内核漏清衍生状态（会话缓存 / 供应商登记）");

    // 接线：按钮在面板里，父组件把回调传了下去
    (/className="dispatch-release"/.test(appCode) && /onReleaseHolder=\{/.test(appCode) && /onReleaseHolder\?: \(\) => void;/.test(appCode))
      ? ok("【29】面板里有「释放并删除该会话」按钮且已接线（onReleaseHolder）")
      : fail("【29】一键释放按钮缺失或没接线（onReleaseHolder）");
  }
}

  /* ══ 【124】归档提示浮层：窗口顶部居中 + 3 秒自动消失 ══
     09-23 用户三轮更正定稿：「放对话框正中间」→「对话框上方正中间，不是应用正中间」→
     「不是贴着输入框上面……对话框平时上面弹窗的那个位置」⇒ 最终确认 **窗口顶部居中**。
     这一节把**位置契约**钉死（fixed + 顶部 + 水平居中 + portal 到 body）；
     以及入场动画的 transform 必须自带那 50% 位移（动画的 transform 会覆盖静态位移，漏了就跳位）。 */
  {
    console.log(C.bold("\n【124】归档提示浮层：窗口顶部居中 / 3 秒消失"));
    const css124 = readStyles().replace(/\r/g, "");
    /** ⛔ 必须按**行首**匹配选择器：`.composer-wrap {` 也是 `.workspace > .composer-wrap {` 的子串，
     *  用裸 indexOf 会取到那条 `min-width: 0` 的规则（实测踩过：守卫假红）。 */
    const ruleBody124 = (sel) => {
      const i = css124.indexOf(`\n${sel} {`);
      if (i < 0) return null;
      const end = css124.indexOf("}", i);
      return end < 0 ? null : css124.slice(i + sel.length + 3, end);
    };
    const toast = ruleBody124(".archive-toast");
    (toast ? ok : fail)("【124】.archive-toast 规则存在");
    if (toast) {
      (/position:\s*fixed/.test(toast) ? ok : fail)(
        "【124】浮层是 fixed（相对视口定位）"
      );
      (/top:\s*54px/.test(toast) ? ok : fail)(
        "【124】浮层贴在窗口顶部（top: 54px = 顶栏 43px 之下）"
      );
      (/left:\s*50%/.test(toast) && /transform:\s*translateX\(-50%\)/.test(toast) ? ok : fail)(
        "【124】浮层水平居中（left:50% + translateX(-50%)）"
      );
      (!/(^|[;\s])right:\s*/.test(toast) ? ok : fail)(
        "【124】旧的「右上角」形态不许回来（无 right）"
      );
      (!/bottom:\s*calc\(100%/.test(toast) ? ok : fail)(
        "【124】不许退回「贴着输入框上沿」那版（无 bottom: calc(100% …)）"
      );
    }
    // 入场动画必须自带居中位移（动画 transform 覆盖静态 transform，漏了会跳位）
    const kf = css124.slice(css124.indexOf("@keyframes archive-toast-in"), css124.indexOf("@keyframes archive-toast-in") + 240);
    (/translateX\(-50%\)/.test(kf) ? ok : fail)(
      "【124】入场动画 keyframes 带 translateX(-50%)（漏了浮层会从居中位置跳到左边）"
    );
    // 3 秒
    const toastComp = readFileSync(join(ROOT, "src", "components", "ArchiveToast.tsx"), "utf8");
    (/durationMs = 3000/.test(toastComp) ? ok : fail)("【124】默认停留 3 秒（durationMs = 3000）");
    // 渲染点：03-composer.tsx 里 + **portal 到 body**（带 transform 的祖先会劫持 fixed 的包含块）
    const composerSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8");
    const timelineSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    (/\{archiveToast && createPortal\(/.test(composerSrc) ? ok : fail)(
      "【124】浮层 portal 到 document.body（空态 .composer-wrap.docked-center 带 transform，会劫持 fixed）"
    );
    (!/<ArchiveToast/.test(timelineSrc) ? ok : fail)(
      "【124】timeline 里没有第二份浮层（两份会同时出现）"
    );
  }

  /* ══ 【138】不许"吞掉失败还报成功"（09-24，评估报告 §4.2 / §4.4）══
     同类事故在本仓反复出现（开关点了没生效 / 归档报喜而会话还在），故钉成结构判据。 */
  {
    const teamsSrc = readFileSync(join(ROOT, "electron", "features", "teams-agents-ipc.ts"), "utf8");
    const archiveHandler = teamsSrc.slice(teamsSrc.indexOf('ipcMain.handle("agents:archive"'));
    /* ⛔ 形态判据：thread/archive 的失败必须先落到 failed，不能 `.catch(() => undefined)` 之后
       无条件自增 —— 那会让界面弹「已归档 N 个」而引擎侧根本没归档。 */
    (!/thread\/archive"[\s\S]{0,120}?\.catch\(\(\) => undefined\)[\s\S]{0,200}?archived \+= 1/.test(archiveHandler) ? ok : fail)(
      "【138】agents:archive 不得「吞掉引擎失败再无条件自增」（会报喜而会话仍在）"
    );
    (/archivedOk[\s\S]{0,120}?failed\.push\(id\)/.test(archiveHandler) ? ok : fail)(
      "【138】归档失败计入 failed（与 MCP 孪生实现 dispatch-rpc.ts 同口径）"
    );
    const schedSrc = readFileSync(join(ROOT, "electron", "scheduler.ts"), "utf8");
    /* tick() 内是 try/finally、没有 catch ⇒ 裸 void this.tick() 会把抛出变成 unhandled rejection。
       注意：这**不会**让调度停摆（finally 已复位 tickInProgress、定时器不受影响）——
       审计原判"调度器会静默死掉"过重，此处只钉"必须兜住"这一条。 */
    (!/setInterval\(\(\) => void this\.tick\(\)/.test(schedSrc) ? ok : fail)(
      "【138】调度器 tick 不得裸 void（tick 无 catch，抛出即 unhandled rejection）"
    );
    (/private runTickSafely\(\)[\s\S]{0,200}?\.catch\(/.test(schedSrc) ? ok : fail)(
      "【138】tick 走 runTickSafely 包装（catch 住并记日志，下一轮照常）"
    );
  }

  /* ══ 【154】专家团办公室预览（09-25 新域 team-office）══════════════════
     ⛔ 09-25 用户定稿：独立「公司模式」侧栏菜单**删掉**（「这样没啥用，不方便」），
        改成**专家团专属预览**（在「专家 / 专家团」页每个团队卡片上进入）。
     形态 = Marvis 式拟人化办公室（单张 SVG 插画 + 三态动画）：
        v1 折线组织图被否「歪歪扭扭」；v2 div 纯色块被否「不好看」⇒ 断言钉死 SVG 插画形态。
     数据零新 IPC（复用 teams / team-threads:map / runningThreadIds）—— 若有人给它加新通道，
     说明在重复造已有能力，打红。 */
  {
    console.log(C.bold("\n【154】专家团办公室预览（team-office 域）"));
    /* 不得再有独立侧栏入口 */
    const shellSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8");
    (!shellSrc.includes("CompanyMode") && !shellSrc.includes("companyPreview") ? ok : fail)("【154】侧栏不得有独立「公司模式」入口（已收成专家团专属预览）");
    /* 入口 = 专家团会话右侧「成员流转轨」末位节点（用户 09-25 定稿：⛔ 不是设置页卡片） */
    const railSrc = readFileSync(join(ROOT, "src", "features", "experts-teams", "ExpertsTeams", "02-rails.tsx"), "utf8");
    (railSrc.includes("onOpenOffice") && railSrc.includes("team-rail-office") ? ok : fail)("【154】成员流转轨末位有「办公室」入口节点");
    const teamsSrc = readFileSync(join(ROOT, "src", "features", "settings-teams", "TeamsSettingsSection.tsx"), "utf8");
    (!teamsSrc.includes("openTeamOfficePreview") ? ok : fail)("【154】⛔ 不得在专家团设置页卡片加入口（用户已否）");
    const timelineSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    (timelineSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)("【154】会话把 rail 入口接到预览状态（用当前会话的团队）");
    /* 组件与数据面 */
    const viewPath = join(ROOT, "src", "features", "team-office", "TeamOfficePreview.tsx");
    const viewSrc = existsSync(viewPath) ? readFileSync(viewPath, "utf8") : "";
    (viewSrc.includes("teamThreadsMap()") ? ok : fail)("【154】成员会话映射走既有 team-threads:map（⛔ 不得新增重复通道）");
    (viewSrc.includes("runningThreadIds") ? ok : fail)("【154】角色运行态来自 runningThreadIds（回退路径）");
    (viewSrc.includes("runningByMember") ? ok : fail)("【154】角色状态映射真实成员运行记录 runningByMember（优先）");
    (viewSrc.includes("openThread") ? ok : fail)("【154】预览的「进入对话」真实跳到该成员会话");
    (!/ipcMain\.handle/.test(viewSrc) ? ok : fail)("【154】视图组件内不得直接注册 IPC");
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (appViewSrc.includes("<TeamOfficePreview") && appViewSrc.includes("teamId={app.companyPreviewTeamId}") ? ok : fail)("【154】预览浮层已挂载进 AppView（显式 props，域组件禁收 app）");
    const bagSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "bag-types.ts"), "utf8");
    (bagSrc.includes("companyPreviewTeamId: string | null;") ? ok : fail)("【154】companyPreviewTeamId 已登记 bag-types");
    const cssEntry = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    (cssEntry.includes("./styles/20-team-office") ? ok : fail)("【154】办公室样式已接入 styles.css（20-team-office）");
    const officeCss = existsSync(join(ROOT, "src", "styles", "20-team-office.css")) ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    /* 形态守卫（v3）：单张 SVG 插画（统一描边）+ 三态 + 动画，⛔ 不许退回折线图/div 色块 */
    const officePath = join(ROOT, "src", "features", "team-office", "OfficeScene.tsx");
    const officeSrc = existsSync(officePath) ? readFileSync(officePath, "utf8") : "";
    (officeSrc.includes("ofc-worker") && officeSrc.includes('"never"') && officeSrc.includes("state-${state}") ? ok : fail)("【154】虚拟办公室场景存在（拟人化角色 + 三态：工作/空闲/空工位）");
    (officeSrc.includes("<svg") && /stroke=\{OFC\.ink\}/.test(officeSrc) ? ok : fail)("【154】办公室为单张 SVG 插画（统一描边，⛔ 不许退回 div 纯色块）");
    (/.ofc-desk/.test(officeCss) && /.ofc-bubble/.test(officeCss) ? ok : fail)("【154】办公室样式（工位/角色）齐全");
    (/ofc-type-a|ofc-zzz|ofc-sip/.test(officeCss) ? ok : fail)("【154】角色动画（敲键盘/打盹/端咖啡）存在");
  }

  /* ══ 【168】办公室动画体系（09-26 v4「活起来」）═══════════════════════════
     用户要求：办公室要「好看 + 有动画 + 员工之间交接 + 预设动画和随机动画」。
     形态钉死三件事：① 动画与数据解耦（导演是纯逻辑，不认识 DOM/React）
                    ② 快照单源（弹窗持有导演，场景只画 → 右栏看板与画面必然一致）
                    ③ 走路必须是真的过渡（写 SVG transform 属性 = 人闪现到终点）。 */
  {
    console.log(C.bold("\n【168】办公室动画体系（导演 / 姿势 / 交接 / 走路）"));
    const directorPath = join(ROOT, "src", "features", "team-office", "office-director.ts");
    const directorSrc = existsSync(directorPath) ? readFileSync(directorPath, "utf8") : "";
    const sceneSrc2 = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeScene.tsx"), "utf8");
    const previewSrc2 = readFileSync(join(ROOT, "src", "features", "team-office", "TeamOfficePreview.tsx"), "utf8");
    const css2 = readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8");

    // ① 导演必须是纯逻辑：不认识 React / DOM（否则没法离线写断言，且渲染与决策会缠在一起）
    (directorSrc.length > 0 && !/from "react"|document\.|window\./.test(directorSrc) ? ok : fail)(
      "【168】动画导演是纯逻辑（不 import react、不碰 document/window）"
    );
    // ② 随机源可注入（截图/断言用固定种子 ⇒ 结果可复现，判据不依赖 Math.random）
    (/constructor\(private rand: \(\) => number = Math\.random\)/.test(directorSrc) ? ok : fail)(
      "【168】随机源可注入（固定种子可复现，断言不许靠运气）"
    );
    // ③ 真实的两个交接必须是**状态迁移**触发：被派任务 / 交成果
    (/!wasRunning && nowRunning/.test(directorSrc) && /pushHandoff\(-1, i, "task"\)/.test(directorSrc) && /pushHandoff\(i, -1, "report"\)/.test(directorSrc) ? ok : fail)(
      "【168】派任务 / 交成果由真实运行态迁移触发（不是纯装饰动画）"
    );
    // ④ 姿势池齐备：预设动画（工作/喝咖啡/伸懒腰/看手机/打盹/翻资料）
    (["coffee", "stretch", "phone", "doze", "note"].every((k) => directorSrc.includes('kind: "' + k + '"')) ? ok : fail)(
      "【168】空闲姿势池齐备（喝咖啡 / 伸懒腰 / 看手机 / 打盹 / 翻资料）"
    );
    // ⑤ 快照单源：弹窗持导演，场景只收 snapshot prop（⛔ 场景内部不得再 new 一个）
    (previewSrc2.includes("new OfficeDirector()") && /snapshot=\{snapshot\}/.test(previewSrc2) && !sceneSrc2.includes("new OfficeDirector()") ? ok : fail)(
      "【168】快照单源：导演在弹窗、场景只画 prop（否则画面与右栏看板会不一致）"
    );
    // ⑥ 走路是真的过渡：CSS transform + transition，⛔ 不是写 SVG transform 属性（那是闪现）
    (/\.ofc-walker-slot \{[^}]*transition: transform/.test(css2) && /--wk-x/.test(sceneSrc2) ? ok : fail)(
      "【168】走动小人用 CSS transform 过渡（写 SVG transform 属性会让人「闪现」到终点）"
    );
    // ⑦ 交接特效齐备：飞行卡片 + 落点脉冲 + 接收者惊叹号
    (["ofc-handoff-card", "ofc-handoff-pulse", "ofc-handoff-alert"].every((k) => css2.includes(k)) ? ok : fail)(
      "【168】交接特效齐备（飞行卡片 / 落点脉冲 / 接收者惊叹号）"
    );
    // ⑧ 场景必须真的渲染交接与走动人（⛔ 防止退回「死插画」）
    (sceneSrc2.includes("snapshot.handoffs.map") && sceneSrc2.includes("<Walker") ? ok : fail)(
      "【168】场景渲染交接飞行与走动小人（不许退回静止插画）"
    );
    // ⑨ 家具动效齐备（云漂 / 钟摆 / 水泡 / 吐纸 / 叶片 / 灯摆 / 白板手写）
    (["ofc-drift", "ofc-swing", "ofc-rise", "ofc-print", "ofc-leaf", "ofc-lamp-sway", "ofc-draw"].every((k) => css2.includes(k)) ? ok : fail)(
      "【168】家具动效齐备（云漂 / 钟摆 / 水泡 / 吐纸 / 叶片 / 灯摆 / 白板手写）"
    );
    // ⑩ 姿势动画齐备（每个姿势都要有自己的手臂/躯干姿态，否则「预设动画」是空话）
    (["pose-work", "pose-coffee", "pose-stretch", "pose-phone", "pose-note", "pose-doze"].every((k) => css2.includes("." + k + " ")) ? ok : fail)(
      "【168】六种坐姿各有自己的动画（工作 / 咖啡 / 伸懒腰 / 手机 / 翻资料 / 打盹）"
    );
  }

  /* ══ 【155】团队调度的团队标识恢复（09-25 真机事故）═════════════════════
     事故：重启后打开历史专家团会话，主理人调度 4/4 全失败，错误「专家团「」不存在」。
     根因：runTeamMember 只从 teamThreadConfigRef / teamThreadMapRef 取 teamId，而这两个 ref
     **只在本次运行「发起会话」时填充** —— 打开历史会话时没人恢复它们 ⇒ teamId = ""。
     修复：① 主进程持久映射 teamOfThread 兜底（+ 回填 ref）
           ② 打开会话时把映射同步进 ref（UI 与调度共用同一真相源）
           ③ 拿不到就不发空 teamId，改为明确报错。
     ⛔ 这条链断掉的表现极具迷惑性（工具可调用、通道通、只有 team 名是空串），必须钉住。 */
  {
    console.log(C.bold("\n【155】团队调度的团队标识恢复"));
    const teamSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part07", "02-seg", "02-team-sessions-skills.tsx"), "utf8");
    (teamSrc.includes("window.codex.teamOfThread?.(leadThreadId)") ? ok : fail)("【155】runTeamMember 有主进程持久映射兜底（teamOfThread）");
    (/bag\.teamThreadMapRef\.current\.set\(leadThreadId, teamId\)/.test(teamSrc) ? ok : fail)("【155】兜底拿到的 teamId 回填 ref（避免重复查询）");
    (/if \(!teamId\) \{[\s\S]{0,320}?无法确定该会话所属的专家团/.test(teamSrc) ? ok : fail)("【155】拿不到团队标识 ⇒ 明确报错（⛔ 不得把空 teamId 发下去）");
    const rolesSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "01-mcp-teams-plan", "02-team-roles-import.tsx"), "utf8");
    (/teamOfThread[\s\S]{0,400}?teamThreadMapRef\.current\.set\(id, String\(teamId\)\)/.test(rolesSrc) ? ok : fail)("【155】打开会话时把团队映射回填 ref（重启后调度/UI 都能恢复）");
    /* 启动时从主进程灌满映射（否则重启后未打开过的会话：调度拿不到 teamId、
       工具卡的成员头像注册表也为空 —— 同一事故的第二个受害面） */
    (/teamThreadsMap\?\.\(\)[\s\S]{0,500}?teamThreadMapRef\.current\.set\(threadId/.test(rolesSrc) ? ok : fail)("【155】启动时从主进程全量灌 ref（工具卡成员解析 + 调度共用）");
    (teamSrc.includes("bag.thread?.id === leadThreadId ? bag.thread?.cwd") ? ok : fail)("【155】cwd 兜底用「本会话 cwd」且限定同会话（后台调度不串配置）");
  }

  /* ══ 【157】上下文用量口径（09-25 用户报「用户经常爆上下文，一切换供应商就爆了上下文」）══
     ⛔ 两个真根因：① 分子用了会话**累计计费量** total（长会话必然超过窗口 ⇒ 环顶到 100%）；
     ② tokenUsage 是全应用**单槽**、切会话不清 ⇒ 环里粘着上一个会话的数字。 */
  {
    console.log(C.bold("\n【157】上下文用量口径：按会话归属 + 只用本轮 last"));
    const statusSrc157 = readFileSync(join(ROOT, "src", "features", "status", "Status.tsx"), "utf8");
    (!/usageBucket\(tokenUsage, "last"\) \?\? usageBucket\(tokenUsage, "total"\)/.test(statusSrc157) ? ok : fail)(
      "【157】⛔ 上下文环不得拿会话累计 total 当分子（长会话必然超窗口 ⇒ 环顶到 100%）"
    );
    (statusSrc157.includes('const currentUsage = usageBucket(tokenUsage, "last");') ? ok : fail)(
      "【157】环的分子只用本轮 last（= 当前上下文规模）"
    );
    (statusSrc157.includes("const currentUsage = lastUsage;") && statusSrc157.includes("const breakdownUsage = lastUsage ?? totalUsage;") ? ok : fail)(
      "【157】容量弹层：百分比只认 last，明细网格仍可 total 兜底"
    );
    const part05Src157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8");
    const part01Src157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part01", "04-optimistic-turn-approval-e2e.tsx"), "utf8");
    (/persistTokenUsageSnapshot[\s\S]{0,300}?map\.set\(threadId/.test(part01Src157) ? ok : fail)(
      "【157】用量按会话归属存储（后台会话/被委派子会话不污染当前的环）"
    );
    (/usageThreadId === String\(bag\.threadRef\.current\?\.id/.test(part05Src157) ? ok : fail)(
      "【157】只有当前会话的用量才进环"
    );
    (/useEffect\(\(\) => \{[\s\S]{0,240}?tokenUsageByThreadRef\.current\.get\(activeId\)/.test(part05Src157) ? ok : fail)(
      "【157】切会话时换成该会话自己的快照（否则环里粘着上一个会话的数字）"
    );
    /* 落盘 + 接力继承（09-25 用户补充：「一切换供应商，显示从初始值开始统计，原来的不消耗识别出来，
       聊一会就爆了」）—— 切供应商会**重启应用**，内存快照全丢 ⇒ 必须落盘才谈得上"真实进度"。 */
    (/localStorage\.setItem\(TOKEN_SNAPSHOT_KEY/.test(part01Src157) && /JSON\.parse\(localStorage\.getItem\(TOKEN_SNAPSHOT_KEY\)/.test(part01Src157) ? ok : fail)(
      "【157】用量快照落盘 + 启动读回（⛔ 不落盘 ⇒ 切供应商重启后进度归零）"
    );
    (/TOKEN_SNAPSHOT_MAX/.test(part01Src157) && /slice\(-TOKEN_SNAPSHOT_MAX\)/.test(part01Src157) ? ok : fail)(
      "【157】快照按上限截断（防撑爆 localStorage）"
    );
    /* ⛔ 必须**真 LRU**（09-25 代码审查）：Map 的 set 不会把已存在的键挪到末尾 ⇒ 只写 slice(-N)
       实际是 FIFO，长期活跃的老会话会被新会话挤掉、重启后进度照样归零。 */
    (/map\.delete\(threadId\);[\s\S]{0,80}?map\.set\(threadId, usage\);/.test(part01Src157) ? ok : fail)(
      "【157】快照截断是**真 LRU**（先 delete 再 set 挪到末尾；否则长期活跃会话会被挤掉、进度照样归零）"
    );
    (/const TOKEN_SNAPSHOT_KEY/.test(part01Src157.split("export function")[0]) ? ok : fail)(
      "【157】存储键在**模块级**（放 hook 体里会被【93】当 Bag 名字）"
    );
    (/persistTokenUsageSnapshot\(usageThreadId, normalizedUsage\)/.test(part05Src157) ? ok : fail)(
      "【157】每次用量事件都落盘"
    );
    const settingsSrc157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part06", "02-seg", "02-model-thread-settings.tsx"), "utf8");
    (/inheritTokenUsageSnapshot\(threadId, next\.id\)/.test(settingsSrc157) ? ok : fail)(
      "【157】接力（fork）时把用量快照继承给新会话（⛔ 否则新会话环从 0 开始）"
    );
  }
// ── 21. 归档链路失败必须可见（09-26 用户报「点归档没反应」）──
{
  const part08Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  // ① archiveThread 整体 try/catch：引擎 thread/archive 报错不许再落进 unhandled rejection（void 调用 = 无声消失）
  (/async function archiveThread\(id: string\) \{\n    \/\/ ⛔ 09-26[\s\S]*?try \{[\s\S]*?await window\.codex\.request\("thread\/archive", \{ threadId: id \}\);/.test(part08Src) ? ok : fail)(
    "【162】归档链路整体 try/catch（void 调用的报错不许静默消失——「点归档没反应」本身）"
  );
  // ② 失败必须弹可见 toast（带引擎原话），行保持原位（本地清理在引擎成功之后才执行）。
  (/bag\.showToast\("归档失败", msg\.slice\(0, 160\)\)/.test(part08Src) ? ok : fail)(
    "【162】归档失败弹可见 toast（引擎原话截 160 字；用户不再面对无声失败）"
  );
  // ③ unarchive 同病同修：历史归档区点恢复也不许静默。
  (/async function unarchiveThread\(id: string\) \{[\s\S]*?try \{[\s\S]*?await window\.codex\.request\("thread\/unarchive", \{ threadId: id \}\);[\s\S]*?bag\.showToast\("取消归档失败"/.test(part08Src) ? ok : fail)(
    "【162】取消归档同修（历史归档区恢复失败也要可见）"
  );
  // ④ 反向绊线：本地清理（setThreads 过滤行）必须仍在引擎请求**之后**——失败时不许误删本地行。
  (/await window\.codex\.request\("thread\/archive", \{ threadId: id \}\);\n      bag\.setThreads\(\(current\) => current\.filter/.test(part08Src) ? ok : fail)(
    "【162】本地行的移除必须在引擎归档成功之后（失败时行保持原位）"
  );
  // ⑤ 幽灵会话分流（09-26「点归档没反应」真根因）：no rollout found / not found 类错误 = 引擎已
  //    不认这条线程（rollout 双份残留、兜底扫描捞回的幽灵行）；按「失败」提示只会让用户反复点，
  //    按幽灵处理（本地移除 + 「已从列表清理」提示）才达成用户意图 = 让它从侧栏消失。
  (/no rollout found/i.test(part08Src) && /\.test\(msg\)/.test(part08Src) ? ok : fail)(
    "【162】幽灵会话（引擎已不认）按本地清理分流，不按失败提示"
  );
  // ⑥ 反向绊线：幽灵分流必须真的移除本地行（只提示不清理 = 幽灵行还在，没解决任何事）。
  (/bag\.setThreads\(\(current\) => current\.filter\(\(entry\) => entry\.id !== id\)\);[\s\S]{0,160}bag\.showToast\("已从列表清理"/.test(part08Src) ? ok : fail)(
    "【162】幽灵分流必须带本地行移除（setThreads filter + 「已从列表清理」提示成对）"
  );
}


  }
}
