/**
 * 预检守卫组：06-app-behavior
 * 分节：【23】【24】【25】【28】（原 L2914–L4089）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, createRequire, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readdirSync, relative, rmSync, sliceHandle, spawnSync, statSync, typesSrc,
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
  // ⛔ 口径变化（10-04）：删除 `subagents:invoke` 那条绕过调度闸门的旁路时，连带移除了它内联的
  // 一处 provider 配置（`base_url: bridgeDial(…)`）⇒ 「走桥的内联配置」由 7 处降到 6 处。
  // 这是**消费方消失**、不是漏桥 —— 下方「不留任何直连 base_url 的内联配置」那条才是真正的安全网；
  // 这个计数闸门保留，只为在有人**再少一处**时报警（少 = 要么删了消费方、要么漏了桥，必须来看一眼）。
  // ⛔ 注释写成 `//` 前缀：本文件在【265】棘轮名单里，口径是**净代码行**，块注释的续行会被算成代码行。
  const dialedCount = (mainTs.match(/base_url: bridgeDial\(/g) ?? []).length;
  (dialedCount >= 6 ? ok : fail)(`main.ts 内联 provider 配置已桥化（实测 ${dialedCount} 处，10-04 起基线 6）`);
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
    "resources/tools/pw-browsers", "resources/tools/cloak-cache",
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
  (mainTs26.includes("watchFs(toolsRoot(), { recursive: true }") && mainTs26.includes('message: "开发工具目录已更新", auto: true') ? ok : fail)("main.ts：tools 目录监视 → 引擎自己装工具后界面自动刷新");
  const installRuntimes = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (installRuntimes.includes("https://cdn.npmmirror.com/binaries/node/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/python/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/git-for-windows/") ? ok : fail)("install-runtimes：node/python/git 走 npmmirror 国内镜像（有镜像源的不该是龟速官方源）");
  // 【242】开发工具的**卸载要真删**（10-01 用户报「卸载不真」：点了卸载还显示已装）。
  //   根因：npm 类工具（nuphus / playwright-cli / cloakbrowser）的 marker 形如
  //   `npm-global\node_modules\@nuphus\nuphus-mcp\package.json`，旧实现只删 `npm-global/nuphus-mcp`
  //   —— 那是个**shim 文件**，包体 `node_modules/@nuphus` 原地不动，于是卸载后 marker 依然命中。
  //   反证：把包体路径改回 marker 首段推导 → 断言必须红。
  {
    const rt = codeOnly(readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8"));
    const hasMap = /NPM_PACKAGE_ARTIFACTS[^=]*=\s*\{[\s\S]*?nuphus:\s*\{[^}]*node_modules\/@nuphus[\s\S]*?"playwright-cli":\s*\{[^}]*node_modules\/@playwright\/cli[\s\S]*?cloakbrowser:\s*\{[^}]*node_modules\/cloakbrowser/.test(rt);
    hasMap
      ? ok("【242】npm 类工具的卸载落点是**包体目录**（node_modules/@nuphus、@playwright/cli、cloakbrowser），不是 marker 首段")
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
      && /npmGlobalRootCandidates\(\)\.flatMap/.test(rt)
      && /if \(failedCount > 0\)[\s\S]{0,300}?throw new Error\(/.test(rt))
      ? ok("【285】卸载落点与安装/判定同源（kb-embedding 走 kbBackendDir + 自带卸载；npm 类遍历全部候选落位；删除失败抛错不吞）")
      : fail("【285】卸载落点与安装/判定不同源 —— 又会出现「卸载了但一直显示已安装」（kb-embedding / cloakbrowser 实测）");
    /* 负向：判定侧既然认双落位，卸载侧就不许退回单落位（npmGlobalRoot() 单值）。
       ⛔ 正向那条已覆盖，这里钉的是「别把 npmGlobalRootCandidates 改回 npmGlobalRoot」。 */
    (!/npmGlobalRootCandidates\(\)\.flatMap\([\s\S]{0,300}?npmShimPaths\(\.\.\./.test(rt)
      && /function npmShimPaths\(globalRoot: string/.test(rt))
      ? ok("【285】npm 卸载遍历全部候选落位，且 npmShimPaths 显式接根参数（不再内部取单值）")
      : fail("【285】npm 卸载又退回单落位了 —— 装在另一落位的包会「卸载了但仍显示已安装」");
    /* ⛔⛔ 第四层（探针实测才抓到，静态判据看不出来）：`NPM_PACKAGE_ARTIFACTS` 的 dirs
       是相对 **npm-global 前缀** 的（`node_modules/cloakbrowser`），而 npmGlobalRootCandidates()
       返回的落位**已含 node_modules 一段** ⇒ 直接 join 会拼出
       `node_modules/node_modules/cloakbrowser` ⇒ **包体从来就没被删过**（Windows 同样中招）。
       判据 = 必须先取 `path.dirname(root)` 当前缀再 join dirs。 */
    (/npmGlobalRootCandidates\(\)\.flatMap\(\(root\) => \{\s*const prefix = path\.dirname\(root\);[\s\S]{0,200}?pkg\.dirs\.map\(\(dir\) => path\.join\(prefix, dir\)\)/.test(rt))
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
  // ⛔ 负向断言（结构性，变异验证过）：boot.ts 里**任何形态**的 ensurePonytailPlugin 都不许出现
  //    （import 与调用都算）——手动安装路径在 04-dev-runtime-install.ts，不在此文件。
  //    ⛔ 必须过 codeOnly 剥注释：boot.ts 头注释里会提到这个符号，裸 includes 会被注释顶成假红。
  const bootTs = codeOnly(readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8"));
  (bootTs.includes("ensurePonytailPlugin") ? fail : ok)("ponytail 启动**不再自动种**（09-27 改按需安装：boot.ts 里不得出现任何形式的 ensurePonytailPlugin；自动种会让每会话多注入 ~640 token）");
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
  // ⛔ 10-01 改：卸载落点从「单条 if (id === "cloakbrowser")」升级为 NPM_PACKAGE_ARTIFACTS 映射
  //    （npm 包的包体在 node_modules/<pkg>，而 npm-global/<pkg> 那层是 shim 文件 —— 只删 shim 等于没卸干净）。
  (mainTs27.includes("NPM_PACKAGE_ARTIFACTS") && mainTs27.includes('cloakbrowser: { dirs: ["node_modules/cloakbrowser"]') ? ok : fail)("main.ts：卸载 CloakBrowser 删的是**包体目录** node_modules/cloakbrowser（按 marker 首段删会连 nuphus/playwright-cli 一起删光）");
  // ⛔ 10-07：npmShimPaths 改为**显式接根参数**（卸载要遍历全部候选落位，内部取单值会删不干净）
  //   ⇒ 锚点跟着改成新调用形态，语义不变（shim 仍随包体一起清）。
  (mainTs27.includes("shims: [\"cloakbrowser\"]") && mainTs27.includes("...npmShimPaths(root, ...pkg.shims)") ? ok : fail)("main.ts：卸载时把该包的 shim 一起清掉（否则 PATH 留着指向空目录的 cloakbrowser.cmd）");
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
  // 09-28 更新：`model_max_output_tokens` 已确认在 0.157.1 无落点（顶层也忽略）⇒ 写入器不再写它，
  // 原来的「经 Number.isFinite 校验」锚点随之消失。判据改成两条仍成立的：① 写入器彻底不写该键；
  // ② 仍在写的数值键（自动压缩阈值）必须经数值化处理，不许裸插值。
  // ⛔ 判据必须**限定在写入器文件**：config-toml 的白名单与 boot 的自愈判据**必须**保留该键名
  //    （存量坏配置要靠它剥掉），全仓扫键名会把这两处正确代码打红（09-28 实测）。
  const applyCode28 = codeOnly(readFileSync(join(ROOT, "electron", "features", "custom-model-apply.ts"), "utf8"));
  (!/model_max_output_tokens\s*=/.test(applyCode28) ? ok : fail)(
    "【28】写入器不再写 model_max_output_tokens（0.157.1 已无落点；白名单/自愈判据保留不算违规）"
  );
  (/model_auto_compact_token_limit = \$\{Math\.round\(/.test(applyCode28) ? ok : fail)(
    "【28】自动压缩阈值经 Math.round 数值化（数值键不许裸插值）"
  );

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

  // ⛔⛔ 10-02 实测事故：**删 tag 重建会让同名 release 退回草稿态**，而 gh release upload / edit(notes)
  //    都不会把它转正 ⇒ 草稿对匿名 API 不可见、/releases/latest 回落上一版、应用内更新器永远收不到
  //    这一版（当时 CI 全绿、资产也 clobber 覆盖了，看着像发布成功，实则用户拿不到）。
  //    锚定「拿 isDraft 去判 + 命中就 --draft=false」这一对动作，而不是只看有没有 --draft 字样。
  (/gh release view "v\$\{VERSION\}" --json isDraft[\s\S]{0,120}?gh release edit "v\$\{VERSION\}" --draft=false/.test(release) ? ok : fail)(
    "【29】release.yml 有草稿态转正兜底（删 tag 重建会让同名 release 退回草稿 ⇒ 用户永远收不到更新）"
  );
  (release.includes('gh release edit "v${VERSION}" --notes-file "${NOTES}"') ? ok : fail)(
    "【29】release 已存在时也重写说明正文（只 upload 资产会让发布页停在首建时的旧正文）"
  );

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
    "resources/tools/harness-video.mjs",
    "resources/tools/cloak-open.mjs",
    // Windows 控件清单通道（10-04）：两个都是**版本控制里的静态脚本**，干净检出就有，
    // 不需要 CI 现造（harness-uia.mjs 是 MCP 门面，desktop-uia.ps1 调系统自带 UIAutomation）。
    "resources/tools/harness-uia.mjs",
    "resources/tools/desktop-uia.ps1",
  ]);
  const uncovered = [];
  for (const entry of pkg29.build?.extraResources ?? []) {
    const from = typeof entry === "string" ? entry : entry?.from;
    if (!from || !from.startsWith("resources/tools/")) continue;
    if (BY_DESIGN.has(from)) continue;
    const seg = from.slice("resources/tools/".length);
    /* ⛔ 10-07：`<X>/node_modules` 是绕过 builder 剪枝的**姐妹条目**（见【27】），它的可造性
       完全由父条目 X 决定 —— 父条目 prep 脚本能造，姐妹条目就跟着有（node 的 npm 就是解压
       官方 node zip 时一起出来的）。⇒ 按「父条目可造」判定，别为每条姐妹条目单独开后门。 */
    const parent = seg.endsWith("/node_modules") ? seg.slice(0, -"/node_modules".length) : "";
    if (prepWin.includes(seg) || (parent && prepWin.includes(parent))) continue;
    uncovered.push(from);
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
    // ⛔ 10-03：域改插件形态后注册写 ipcHost.handle —— 只认 ipcMain.handle 会得到 -1 ⇒ 切片为空 ⇒ 假红。
    const scratchIdx = mainSrc.search(/(?:ipcMain\.handle|ipcHost\.handle)\("scratch:create"/);
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
    // ⛔ 10-05 修：原来用**固定 900 字符窗口**（`slice(evIdx, evIdx + 900)`）—— 同一个分支里加几行注释
    //   或一条新语句，`threadRuntimeStore.remove(` 就被挤出窗口 ⇒ **假红**（本轮实际踩到：往这个分支
    //   加了「委托登记表清理」就红了一次）。这正是项目记过的"固定字符窗口"坑，且它诱人把 900 越调越大。
    //   ⇒ 改成**按分支边界切片**：从事件分支起，到下一个**同级**（6 空格缩进）的 `if (event.method === "` 之前。
    //     ⛔ 必须是 6 空格：分支体里还有**嵌套**的 `if (event.method === "thread/deleted")`（10 空格），
    //       按不带缩进的朴素 `indexOf` 会把边界卡在嵌套那句上 ⇒ 切片只有 297 字符 ⇒ 下一条**恒定假红**
    //       （本轮实测踩到，靠"切片长度"这条前置断言才发现）。
    const ARCH_START = 'event.method === "thread/archived"';
    const evIdx = mainCode.indexOf(ARCH_START);
    const nextBranch = evIdx < 0 ? -1 : mainCode.indexOf('\n      if (event.method === "', evIdx + ARCH_START.length);
    const evSlice = evIdx < 0 ? "" : mainCode.slice(evIdx, nextBranch > evIdx ? nextBranch : evIdx + 4000);
    // ⛔ 本文件的 ok/fail 是**单参**（消息）版 —— 写 `ok(cond, msg)` 会把 cond 当消息打印、
    //   恒判通过（假绿）。凡要有条件地判定，一律用 `(cond ? ok : fail)("…")` 形态。
    (/purgeDeletedThread\(goneId\)/.test(evSlice) ? ok : fail)("【29】切片确实跨到分支体内（边界写错会让下一条恒假）");
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
    const teamsSrc = readFileSync(join(ROOT, "electron", "features", "agents-ipc.ts"), "utf8");
    const archiveFrom = teamsSrc.search(/(?:ipcMain\.handle|ipcHost\.handle)\("agents:archive"/);
    const archiveHandler = archiveFrom >= 0 ? teamsSrc.slice(archiveFrom) : "";
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
  /* ⛔⛔ 2026-10-05 修：这一组（以及紧随其后的【168】）原先整块被
     `if (!existsSync(.../office-render.ts)) { 作废 } else { … }` 关掉 ——
     而 `office-render.ts` **早在 v18 换成素材版时就删了**
     ⇒ 两组 30+ 条断言**一直在空跑**（含与旧形态无关、至今仍然有效的
       入口节点 / 数据面 / 样式接入）⇒ 用户 10-05 报「显示器没对准、没显示」时
       没有任何守卫能拦下 —— 这道门就是假绿的根源。
     ✅ 改为按**目录存在**判定；⛔ 已随实现换代而失效的形态断言（PixiJS / 导演 /
        OfficeScene / office-art）在本轮**显式删除**，不留"注释说作废、代码还在"的中间态。 */
  if (existsSync(join(ROOT, "src", "features", "team-office"))) {
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
    /* ⛔ 10-05 修订：原来两条断言的是"组件自己调 `teamThreadsMap()` / `runningThreadIds`"——
       而当前实现已改为**纯 props 驱动**（成员运行态由宿主从引擎事件流归约后传入，
       见该文件头「数据边界」注释）。⇒ 旧断言过时，且方向与新架构**相反**。
       ⛔ 新判据：**组件不许自己拉数据 / 订阅引擎**（这才是域组件的规矩）。 */
    (!/window\.codex|teamThreadsMap\(|runningThreadIds/.test(codeOnly(viewSrc)) ? ok : fail)(
      "【154】⛔⛔ 预览是**纯 props 驱动**：不自己拉 IPC（成员状态由宿主归约后传入）"
    );
    (viewSrc.includes("runningByMember") ? ok : fail)("【154】角色状态映射真实成员运行记录 runningByMember（唯一数据源）");
    (viewSrc.includes("openThread") ? ok : fail)("【154】预览的「进入对话」真实跳到该成员会话");
    /* ⭐ 10-07 用户要求：关闭钮**左侧**一组缩放按钮（放大 / 缩小 / 重置）+ 滚轮缩放。
       ⛔ 判据锚「控制组存在 + 它排在关闭钮**之前**」这个**结构**，不锚图标名
         （图标换了不算回归；缺按钮 / 顺序反了才算）。
       ⛔ 只断言"有个 tools 容器"是不够的 —— 事件必须被**收回来**：顶栏整条是
         `pointer-events: none`，托盘不写 `auto` 的话三个按钮全是死的。 */
    const toolsIdx154 = viewSrc.indexOf("office-overlay-tools");
    const closeIdx154 = viewSrc.indexOf("office-overlay-close");
    (toolsIdx154 >= 0 && closeIdx154 > toolsIdx154 ? ok : fail)(
      "【154】缩放控制组在关闭钮**左侧**（DOM 顺序：tools 先于 close）"
    );
    /* ⛔ 用带转义的锚点找 `zoomCtl.current?.zoomIn()` 这类调用，别用宽松的 includes */
    (["zoomIn", "zoomOut", "reset"].every((k) => new RegExp(`zoomCtl\\.current\\?\\.${k}\\(\\)`).test(viewSrc)) ? ok : fail)(
      "【154】放大 / 缩小 / 重置三个操作都接到画布的控制句柄"
    );
    (viewSrc.includes("onZoomChange") && viewSrc.includes("controlsRef") ? ok : fail)(
      "【154】画布回报缩放倍率 + 接收控制句柄（缺回报 ⇒ 到上下限按钮不停用 = 点了没反应）"
    );
    const officeCss154 = existsSync(join(ROOT, "src", "styles", "20-team-office.css"))
      ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    (/\.office-overlay-tools\s*\{[\s\S]{0,400}?pointer-events:\s*auto/.test(officeCss154) ? ok : fail)(
      "【154】⛔⛔ 缩放托盘自己收回点击（顶栏是 pointer-events:none，不收回 ⇒ 三个按钮全点不动）"
    );
    // ⛔ 10-03：负向断言也要双形态 —— 渲染层一旦出现 `ipcHost.handle` 同样是"视图组件内注册 IPC"，
    //    只禁 ipcMain 的话，改个名字就能绕过（负向断言最怕这种"换个写法就绿"）。
    (!/ipcMain\.handle/.test(viewSrc) && !/ipcHost\.handle/.test(viewSrc) ? ok : fail)("【154】视图组件内不得直接注册 IPC");
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (appViewSrc.includes("<TeamOfficePreview") && appViewSrc.includes("teamId={app.companyPreviewTeamId}") ? ok : fail)("【154】预览浮层已挂载进 AppView（显式 props，域组件禁收 app）");
    const bagSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "bag-types.ts"), "utf8");
    (bagSrc.includes("companyPreviewTeamId: string | null;") ? ok : fail)("【154】companyPreviewTeamId 已登记 bag-types");
    const cssEntry = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    (cssEntry.includes("./styles/20-team-office") ? ok : fail)("【154】办公室样式已接入 styles.css（20-team-office）");
    /* ⛔⛔ 10-05 加：**显示器内容区必须落在屏幕玻璃上，不是椅背上。**
       背景（用户两次报「显示器还是固定的 / 没对准 / 没显示」）：
         · 10-04 那版 screen 坐标是"扫 bg.webp"得到的，但判据同时命中了**椅背**
           （椅背 rgb(47,65,95) 与屏幕玻璃同属"暗且偏蓝"）⇒ 六个屏面全落在椅背上；
         · 而椅背随后会被**重贴**盖回人物身上（OfficeCanvas 的 backrest 重贴）
           ⇒ 画上去的动态内容被整块盖掉 ⇒ 用户看到的仍是背景图里烙死的静态屏幕。
       ⇒ 判据用**几何不可能性**：屏面底必须高于椅背顶（相对坐标 screen.y+h <= backrest.dy）。
         ⛔ 无阈值可调、无需读图；坐标一旦写回椅背范围立刻变红。 */
    const fmtSrc = existsSync(join(ROOT, "src", "features", "team-office", "office-format.ts"))
      ? readFileSync(join(ROOT, "src", "features", "team-office", "office-format.ts"), "utf8") : "";
    const seatRows = [...fmtSrc.matchAll(/y:\s*(-?\d+),\s*facing:\s*"up",\s*backrest:\s*\{\s*dx:\s*(-?\d+),\s*dy:\s*(-?\d+),\s*w:\s*\d+,\s*h:\s*\d+\s*\},\s*screen:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g)];
    (seatRows.length === 6 ? ok : fail)(`【154】SEATS 六个座位都带 screen 矩形（解析到 ${seatRows.length} 个 —— ⛔ 0 个说明正则失配、断言在空跑）`);
    const onChair = seatRows.filter((m) => Number(m[5]) + Number(m[7]) > Number(m[3]));
    (onChair.length === 0 ? ok : fail)(`【154】⛔⛔ 每个屏面都**完全在椅背上方**（压到椅背上会被椅背重贴整块盖掉）—— 违例 ${onChair.length} 个`);
    /* ⛔ 判据落在**注释里**（量法说明）⇒ ⛔ 不能先剥注释再找（那样必然恒红 —— 第一版就写错了）。 */
    (/(is_glass|sum\s*<\s*190)/.test(fmtSrc) ? ok : fail)(
      "【154】量法注释点名**亮度判据**（⛔ 旧的 `b>r+20` 类判据会把椅背一起收进来）");
    const officeCss = existsSync(join(ROOT, "src", "styles", "20-team-office.css")) ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    /* 形态守卫（09-27 v8「PixiJS 渲染」）：v1 折线图 / v2 div 色块 / v3 单张 SVG 插画
       三版都被用户否过（「歪歪扭扭」「不好看」「手绘人物和素材家具违和」）⇒ 断言钉死：
       画布 = PixiJS Application + 逐帧 animateScene，⛔ 不许退回任何一种被否形态。 */
    /* ── 当前实现（原生 canvas 2D，v19 起）─────────────────────────────
       ⛔ 这里原先断言的是 PixiJS 形态（`new Application` / `animateScene` /
          `OfficeScene` / `pointertap`），那些文件已随 v19 换实现而删除
          ⇒ 断言早已失效，本轮**显式移除**（⛔ 不留死断言）。
       下面是**当下真实存在**的实现面。 */
    const canvasPath154 = join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx");
    const canvasSrc154 = existsSync(canvasPath154) ? readFileSync(canvasPath154, "utf8") : "";
    const screenPath154 = join(ROOT, "src", "features", "team-office", "office-screen.ts");
    const screenSrc154 = existsSync(screenPath154) ? readFileSync(screenPath154, "utf8") : "";
    const cssSrc154 = existsSync(join(ROOT, "src", "styles", "20-team-office.css"))
      ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    (canvasSrc154.includes('getContext("2d")') && canvasSrc154.includes("drawScreen(") ? ok : fail)(
      "【154】场景是原生 canvas 2D 且逐帧画显示器内容（v19 形态）"
    );
    (cssSrc154.includes(".office-pixel-canvas") ? ok : fail)(
      "【154】画布宿主容器样式齐全（.office-pixel-canvas —— 类名是接口）"
    );
    (!/\.ofc-(desk|bubble|type-a|zzz|sip)/.test(cssSrc154) ? ok : fail)(
      "【154】⛔ 场景级 .ofc-* 旧样式已清干净（留着 = 死样式，CSS 覆盖告警会一直报）"
    );
    /* ⛔⛔ 显示器内容必须画在**背景之后**：画在背景前等于没画（会被背景盖掉）。 */
    const drawIdx154 = canvasSrc154.indexOf("drawScreen(");
    const bgIdx154 = canvasSrc154.indexOf("ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H)");
    (bgIdx154 >= 0 && drawIdx154 > bgIdx154 ? ok : fail)(
      "【154】⛔⛔ 显示器内容画在背景之后（画在背景前 = 被背景盖住 = 用户报的「没显示」）"
    );
    (!canvasSrc154.includes("ipcRenderer") && !/window as any\)\.codex/.test(canvasSrc154) ? ok : fail)(
      "【154】画布层零 IPC（事件驱动：成员状态由宿主 props 传入）"
    );
    /* ⛔⛔ 待机 ≠ 熄屏（10-05 用户报「显示器都还是固定的」的第二层原因）：
       `idle` 必须有**自己的**屏保分支，⛔ 不许再让它落到 `off`。 */
    (/if \(mode === "idle"\)/.test(screenSrc154) ? ok : fail)(
      "【154】⛔⛔ idle 有自己的屏保分支（⛔ 退回 off ⇒ 委托跑完全员待机、六屏全黑静止）"
    );
    (/return "code";[\s\S]{0,300}?return "idle";/.test(screenSrc154) ? ok : fail)(
      "【154】⛔⛔ 有人坐工位但没在跑 ⇒ 映射到 idle（屏保），⛔ 不是 off"
    );
    (/if \(!input\.occupied\) return "off";/.test(screenSrc154) ? ok : fail)(
      "【154】off 语义收窄为**空座**（⛔ 别再让「待机」共用它）"
    );
    (/let officeSimSingletonRef/.test(canvasSrc154) ? ok : fail)(
      "【154】sim 是模块级常驻单例（⛔ 组件级 ⇒ 每次打开预览都重播进场）"
    );
  }

  /* ══ 【168】办公室动画体系 —— 2026-10-05 **整组移除** ═══════════════════
     ⛔ 这组断言的对象是 PixiJS 版实现（`office-director.ts` 导演 / `OfficeScene.tsx`
        场景 / `office-render.ts` 程序化绘制 / `office-art.ts` 素材注册表），
        而这些文件**随 v19 换成「Kenney CC0 像素素材 + 原生 canvas 2D」时全部删除**。
     ⛔⛔ 更糟的是它外面套了 `if (!existsSync(office-render.ts)) { …作废… } else { … }`
        ⇒ 整组（约 30 条）**一直在空跑**，却让人以为"办公室有 30 条守卫在保护"。
        10-05 用户报「显示器没对准、没显示」时没有任何守卫能拦下，根源就在这里。
     现状（v19）的对应断言已迁到【154】：canvas 2D 形态 / 显示器内容绘制顺序 /
        idle 屏保 / sim 常驻单例 / 屏面坐标几何（屏面必须在椅背上方）。
     ⛔ 将来若想恢复"交接动画 / 姿势池 / 设施动画"这类断言，请按**当前实现**重写，
        不要在这组旧断言上改 —— 它的锚点全是已删文件。 */

  /* ══ 【169】办公室渲染纵深（09-27 v9 程序化绘制 → v10 三层纵深）═══════════
     ⛔ v9 定稿（用户 09-27 拍板）：**不搬**参考实现的 3D 素材（作者自己标注「注意素材
        版权问题」），房间 / 后墙 / 两侧 / 工位桌椅全部用 PixiJS Graphics 程序化绘制
        （src/features/team-office/office-render.ts）。
     ⛔ v10 修的是**遮挡顺序**（用户第二次贴参考图「看看这种布局效果」后实测）：
        参考镜头在工位正前方略高，自远而近 = 显示器 → 桌 → 人 → 椅子。
        三个对象必须**各按自己的地面基线 y 排 zIndex**（桌更靠后 / 椅子更靠观众），
        合成一件 Graphics 一定会错：要么人被桌挡住只露头顶，要么椅子被整个人盖住。 */
  /* ⛔ 办公室预览（team-office 域）09-30 用户要求整体下线、待重做 ⇒ 目录不在就不跑这组断言 */
  if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
  {
    console.log(C.bold("\n【169】办公室渲染纵深（程序化绘制 / 桌-人-椅三层遮挡）"));
    const renderPath = join(ROOT, "src", "features", "team-office", "office-render.ts");
    const renderSrc = existsSync(renderPath) ? readFileSync(renderPath, "utf8") : "";
    const isoPath = join(ROOT, "src", "features", "team-office", "office-iso.ts");
    const isoSrc = existsSync(isoPath) ? readFileSync(isoPath, "utf8") : "";
    const furnSrc = existsSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"))
      ? readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8") : "";

    (["drawRoom", "drawBackWall", "drawSideProps", "drawDeskStation", "drawChair"].every((f) => renderSrc.includes("export function " + f)) ? ok : fail)(
      "【169】office-render 五件套齐全（房间 / 后墙 / 两侧 / 工位 / 椅子）"
    );
    (!/assets\/office\/|\.png/.test(renderSrc) ? ok : fail)(
      "【169】绘制模块零贴图依赖（程序化路线：不引任何 PNG）"
    );
    // ⛔ 等距块**不许画底面**：相机在上前方俯视，底面永远被自己的顶面遮住；而它的屏幕位置
    //    只比顶面低 (z1−z0)·k，画在最后会**盖住顶面上半** ⇒ 白桌面变成一大片灰
    //    （v10 打磨实测：把桌面渐变 alpha 从 0.019 调到 0.005 都不见效，根因是这块底面）。
    ((() => {
      const fn = (renderSrc.match(/function isoPrism\([\s\S]*?\n\}/) || [""])[0];
      const polys = (fn.match(/g\.poly\(/g) || []).length;
      const bottomQuad = /up\(a, lo\)[\s\S]{0,40}up\(b, lo\)/.test(fn);
      return polys === 4 && !bottomQuad;
    })() ? ok : fail)(
      "【169】等距块只画 4 个可见面（左右侧 + 前 + 顶），⛔ 不画底面（它会盖住顶面 ⇒ 白桌面变灰）"
    );
    ((["drawDeskStation(desk", "drawChair(chair"]).every((k) => furnSrc.includes(k)) ? ok : fail)(
      "【169】桌与椅分两个 Graphics（合成一件 ⇒ 要么人被桌挡、要么椅被人挡）"
    );
    // ⛔ 三层顺序靠**数值**判定：桌/椅各取自己的地面基线，人物取座位点 ⇒ 桌 < 人 < 椅。
    //    桌面基线取「占地中心」= v − DESK_DV/2，椅子基线取 v + CHAIR_DV（都写在 syncStatics 里）。
    ((() => {
      const desk = /deskBox\.zIndex = floorPoint\(slot\.u, slot\.v - DESK_DV \/ 2\)\.y/.test(furnSrc);
      const chair = /chairBox\.zIndex = floorPoint\(slot\.u, slot\.v \+ CHAIR_DV\)\.y/.test(furnSrc);
      const person = /view\.container\.zIndex = slot\.y;/.test(furnSrc);
      return desk && chair && person && /world\.sortableChildren = true/.test(furnSrc);
    })() ? ok : fail)(
      "【169】桌 / 人 / 椅各按自己的地面基线排 zIndex（桌最靠后、椅最靠观众）"
    );
    // ⛔ 行距 > 桌纵深 + 椅距：不够时后一排的**桌子会压住前一排的椅子、显示器会盖住前一排的人**
    //    （450px 地板深 + 0.31 行距实测过；改 FLOOR/ROW_V/DESK_DV 任一都要过这条）。
    const isoNum = (src, re) => { const m = src.match(re); return m ? Number(m[1]) : NaN; };
    ((() => {
      const deskDv = isoNum(renderSrc, /export const DESK_DV = ([\d.]+)/);
      const chairDv = isoNum(renderSrc, /export const CHAIR_DV = ([\d.]+)/);
      const rowsBlock = (isoSrc.match(/const ROW_V[\s\S]*?\n\};/) || [""])[0];
      const rows = (rowsBlock.match(/\[[\d.,\s]+\]/g) || []).map((s) =>
        s.replace(/[[\]]/g, "").split(",").map(Number).filter((n) => Number.isFinite(n)));
      const gaps = rows.map((xs) => xs.slice(1).reduce((g, x, i) => Math.min(g, x - xs[i]), Infinity));
      const minGap = Math.min(...gaps);
      return Number.isFinite(deskDv) && Number.isFinite(chairDv) && gaps.length > 0
        && minGap > deskDv + chairDv;
    })() ? ok : fail)(
      "【169】行距 > 桌纵深 + 椅距（不够时后排桌子会压住前排椅子 / 显示器会盖住前排的人）"
    );
    // 地板纵深与场景高度：工位是"深"的，地板太浅就塞不下多排（这里只钉两者同步缩放）
    ((() => {
      const floorY = (isoSrc.match(/export const FLOOR = \{[\s\S]*?\n\};/) || [""])[0].match(/-?\d+/g) || [];
      const depth = Number(floorY[1]) === Number(floorY[3]) ? Number(floorY[5]) - Number(floorY[1]) : NaN;
      const sceneH = isoNum(isoSrc, /export const SCENE_H = (\d+)/);
      return Number.isFinite(depth) && depth >= 500 && sceneH >= depth + 120;
    })() ? ok : fail)(
      "【169】地板纵深 ≥ 500 且画布高度留够（容纳 3 排工位 + 墙）"
    );
  }

  /* ══ 【176】办公室角色外形（09-27 用户：「每个角色都是不同的动物」）══════════
     ⛔ 用户 09-27 拍板：角色 = **纯黑动物剪影**（无描边、无五官）+ 脖子一圈饱和彩项圈。
        剪影没有五官 ⇒ 物种**只能靠耳朵外形区分**、个体**只能靠项圈色区分**，
        所以这两件事都必须**按序号稳定派生**（同一成员每次进办公室都是同一种动物 + 同一个色）。
     形态钉死四件事：
       ① 物种池 ≥10 且互不相同（两个物种画成一个样 = 白做）；
       ② 动物与项圈色只依赖序号（出现 Math.random/Date.now = 每次刷新换一张脸）；
       ③ 每个物种的耳朵分支与头型尺寸都齐备（少一个 case 就退化成认不出的黑团）；
       ④ 屏幕内容与姿势一致（人在打盹、屏幕上还跑着代码 = 一眼假）。 */
  /* ⛔ 办公室预览（team-office 域）09-30 用户要求整体下线、待重做 ⇒ 目录不在就不跑这组断言 */
  if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
  {
    console.log(C.bold("\n【176】办公室角色外形（物种 / 项圈 / 屏幕内容）"));
    const palPath = join(ROOT, "src", "features", "team-office", "office-palette.ts");
    const palSrc = existsSync(palPath) ? readFileSync(palPath, "utf8") : "";
    const canvas176 = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
    const render176 = readFileSync(join(ROOT, "src", "features", "team-office", "office-render.ts"), "utf8");

    const animals = ((palSrc.match(/export const ANIMALS: AnimalKind\[\] = \[([\s\S]*?)\];/) || [])[1] || "");
    const list = (animals.match(/"([a-z]+)"/g) || []).map((s) => s.replace(/"/g, ""));
    (list.length >= 10 && new Set(list).size === list.length ? ok : fail)(
      "【176】物种池 ≥10 且无重复（每个成员一种动物；重复 = 两个人长得一样）"
    );
    const all = list.concat("lion");
    // 物种外形二选一：**单侧耳**（drawEarSide 的 case，可参与抽动）或**整圈对称特征**
    // （drawHeadBackdrop 的 animal === "x"，如绵羊的羊毛圈 / 刺猬的刺 —— 拆不成左右两支）。
    // ⛔ 只查单侧分支会把 sheep/hedgehog 误报成"缺耳朵"（它们的外形在 backdrop 里）。
    const missing = all.filter((a) => {
      const hasSize = new RegExp("\\b" + a + ": \\[\\d").test(canvas176);
      const hasSideEar = new RegExp('case "' + a + '":').test(canvas176);
      const hasBackdrop = new RegExp('animal === "' + a + '"').test(canvas176);
      return !hasSize || (!hasSideEar && !hasBackdrop);
    });
    (all.length >= 11 && missing.length === 0 ? ok : fail)(
      "【176】每个物种都有耳朵分支 + 头型尺寸（缺一个就退化成认不出的黑团）"
        + (missing.length ? "，缺：" + missing.join("/") : "")
    );
    (/export function animalOf\(index: number, isCeo = false\)/.test(palSrc)
      && /export function collarColor\(index: number, isCeo = false\)/.test(palSrc)
      && !/export function (animalOf|collarColor)[\s\S]{0,240}?(Math\.random|Date\.now)/.test(palSrc) ? ok : fail)(
      "【176】物种与项圈色都按序号稳定派生（⛔ 不许随机 —— 同一个人每次进来都该是同一种动物）"
    );
    (canvas176.includes("animalOf(") && canvas176.includes("collarColor(") && canvas176.includes("SILHOUETTE") ? ok : fail)(
      "【176】画布真的用上了物种 / 项圈色 / 剪影色（有常量没接线 = 恒真假绿）"
    );
    (/export function screenKindOf\(index: number, running: boolean, dozing: boolean, role = ""\)/.test(render176)
      && /if \(dozing\) return "sleep"/.test(render176)
      && /资金\|流向\|行情/.test(render176) && /return "risk"/.test(render176)
      && /screenKindOf\(slot\.idx, slot\.running, slot\.pose\?\.kind === "doze", slot\.profession\)/.test(canvas176)
      && /:\$\{s\.profession\}/.test(canvas176) ? ok : fail)(
      "【176】屏幕内容按成员稳定派生（09-30 加职业映射：资金看行情 / 风控看仪表盘）+ 打盹切熄屏 + key 含职业"
    );
    // ⛔ 跑腿目标与设施坐标必须**同源**：drawAmenities 画设施用的每个 floorPoint(u, v)
    //    都要出现在 OfficeCanvas 的 ERRAND_SPOT_UV 里 —— 两边漂移 ⇒「去接水」的人走到空气里。
    ((() => {
      const uvBlock = (canvas176.match(/const ERRAND_SPOT_UV[\s\S]*?\n\};/) || [""])[0];
      const want = [...uvBlock.matchAll(/u: ([\d.]+), v: ([\d.]+)/g)].map((m) => m[1] + "," + m[2]);
      const amenities = (render176.match(/export function drawAmenities[\s\S]*?\n\}/) || [""])[0];
      const got = [...amenities.matchAll(/floorPoint\(([\d.]+), ([\d.]+)\)/g)].map((m) => m[1] + "," + m[2]);
            /* 09-30 加了 3 个跑腿点（treadmill / vending / tea）+ 素材模式的新设施：
         ERRAND_SPOT_UV 的每个点都必须能在 drawAmenities 里找到（素材数组的 [id,u,v,k] 或程序化 floorPoint）。 */
      const amenSprites = (render176.match(/\["[a-z0-9]+", ([\d.]+), ([\d.]+), [\d]+\]/g) || [])
        .map((s) => { const m = s.match(/([\d.]+), ([\d.]+),/); return m ? m[1] + "," + m[2] : ""; });
      return want.length === 7 && want.every((p) => got.includes(p) || amenSprites.includes(p));
    })() ? ok : fail)(
      "【176】跑腿目标与办公设施坐标同源（两边漂移 ⇒「去接水」的人走到空气里）"
    );
    // ⛔ screens ticker **只挂不驱动**的假象（09-27 实测）：syncStatics 把每台显示器的
    //    动画 ticker 收进 scene.screens，animateScene 却只驱动 scene.props ⇒ 屏幕永远静止，
    //    而"代码在逐行敲"的静态首帧看起来像在动（截图验收发现不了，必须锚驱动点）。
    (/if \(screenAnim\) scene\.screens\.push\(screenAnim\);/.test(canvas176)
      && /scene\.screens\.forEach\(\(p\) => p\.update\(scene\.clock\)\);/.test(canvas176) ? ok : fail)(
      "【176】屏幕动画 ticker 被逐帧驱动（只 push 不 update = 永远静止的首帧）"
    );
    // 耳朵必须是**可动部件**：左右各一支、pivot 在耳根，坐姿/走姿的动画循环里都要碰它
    // （物种识别全靠耳朵，耳朵焊死 = 退回"一坨黑"）。
    // ⛔ 09-30 素材路线：部件类型变成可空（生图精灵没有独立耳朵），所以断言改成**判空后的驱动**
    //    —— 既保住"接入两个动画循环"，又钉死"素材模式下不许崩"。
    ((canvas176.match(/ears: Graphics\[\] \| null;/g) || []).length >= 2
      && /if \(p\.ears\) p\.ears\.forEach\(\(ear, i\) =>/.test(canvas176)
      && /if \(w\.ears\) w\.ears\.forEach\(\(ear, i\) =>/.test(canvas176) ? ok : fail)(
      "【176】耳朵接入坐姿 + 走姿两个动画循环（且素材模式下判空驱动，不崩）"
    );
    // ⛔ 键盘**不许居中**：人坐在工位正中，居中键盘会被躯干整个挡住（09-27 放大实测只剩两条白边），
    //    必须偏向人的左手侧 —— 锚定「u 减偏移」的写法，改回居中即红。
    //    （09-30：桌深从 0.235 收到 0.17，键盘跟着往左前挪到 0.056/0.052 —— 只放宽数值区间，
    //      「必须减 offset」这条不变；居中写法 `floorPoint(u, v ...)` 仍然判红。）
    (/floorPoint\(u - 0\.0[3-9]\d*, v - 0\.0[3-9]\d*\)/.test(render176) ? ok : fail)(
      "【176】键盘偏向人的左手侧（居中 = 被躯干挡住，放大才看得见的假 blanks）"
    );
    // ⛔ 走动小人的头部 wrap 偏移**必须补偿 HEAD_CY**：buildAnimalHead 把头画在 wrap 内部
    //    (0, HEAD_CY) 处，walker 的 headwrap 若还写死 (0,-76)（buildHead 时代的旧补偿），
    //    头就被双重抬高 36+ 单位 —— 脖子上出现"白色空洞"，背后的墙 / 饮水机从洞里透出来
    //    （09-27 用户截图点名"人物出来都是穿模的"）。
    (/headwrap\.position\.set\(0, -76 - HEAD_CY\)/.test(canvas176) ? ok : fail)(
      "【176】走动小人头部 wrap 偏移补偿 HEAD_CY（写死旧偏移 = 头双重抬高、脖子断成两截）"
    );
    // 圆头下缘往中间收，头两侧与项圈上缘之间必然露楔形白缝 —— 必须有**脖子填充**兜底
    // （09-27 用户截图点名"脖子中间空了那么多"；小 ry 物种中心也空 3~7 单位）。
    (/const NECK_FILL = \{/.test(canvas176) && /neck\.roundRect\(NECK_FILL\.x/.test(canvas176) ? ok : fail)(
      "【176】坐姿有脖子填充（头底扎进项圈 + 黑块兜住楔形白缝，缺一个就露缝）"
    );
  }

  /* ══ 【177】手机控制 phone-harness（09-27 新增）══════════════════════════
     ⛔ 两条硬边界，都是"错了不会报错、但会悄悄骗人"的那类：
       ① **iPhone 通道只在 macOS 上可能存在** —— iPhone 走的是 Mac 的「iPhone 镜像」窗口，
          Windows/Linux 上根本不存在这条通道。UI 若不加区分地宣传"能控制 iPhone"，
          用户会照着做然后发现做不到（能力边界必须是真的）。
       ② **装机即关掉上游遥测** —— 上游默认开启且会上报 task 文本与每步调用参数
          （上游 issue #100 正在修）。这是本机数据边界，不跟随上游默认值。
       两者都锚**代码形态**（平台判定 / 装机流程里的那一行），不锚注释文字。 */
  {
    console.log(C.bold("\n【177】手机控制 phone-harness（平台边界 / 遥测默认关）"));
    const phPath = join(ROOT, "electron", "features", "phone-harness.ts");
    const phSrc = existsSync(phPath) ? readFileSync(phPath, "utf8") : "";
    const phUi = existsSync(join(ROOT, "src", "features", "settings-devtools", "PhoneHarnessCard.tsx"))
      ? readFileSync(join(ROOT, "src", "features", "settings-devtools", "PhoneHarnessCard.tsx"), "utf8") : "";

    (existsSync(phPath) && /iphoneEligible: process\.platform === "darwin"/.test(phSrc) ? ok : fail)(
      "【177】iPhone 通道严格绑定 darwin（Windows/Linux 上不存在的通道不许宣传）"
    );
    (phUi.includes("iphoneEligible") && /status\?\.platform === "darwin"/.test(phUi) ? ok : fail)(
      "【177】卡片按平台显示不同能力清单（非 Mac 要明说 iPhone 通道不支持）"
    );
    ((() => {
      // ⛔ 顺序也是判据：必须先关遥测、再注册技能（技能一生效就会被调用）。
      const off = phSrc.indexOf('harness(["config", "set", "telemetry", "false"]');
      const skill = phSrc.indexOf('harness(["skill"]');
      return off > 0 && skill > off;
    })() ? ok : fail)(
      "【177】装机后先关上游遥测再注册技能（上游默认开且会上报任务文本与调用参数）"
    );
    // ⛔ 10-02：单源口径已废 —— 清华源的索引页 200 但 wheel 直链 403，单源必挂
    //    （用户实测：文档转换 / 手机控制 / Laya 三处同时报同一个 403）。现在走共享源表逐源重试；
    //    环境变量仍可覆盖**首选源**（自测/代理场景）。
    (phSrc.includes("PHONE_PIP_SOURCES") && phSrc.includes("PIP_INDEXES") && phSrc.includes("pip-sources") ? ok : fail)(
      "【177】pip 安装走**多源兜底**（共享源表 pip-sources.ts；单源必被镜像抖动打死 —— 10-02 三处报障的根因）"
    );
    // ⛔ 必须带 `-U`：不带升级参数时 pip 对已装的包只回 "Requirement already satisfied" 就结束，
    //    用户点「检查更新」什么也没发生（上游 alpha 周更，拿不到修复 = 假动作）。
    (/pip", "install", "-U"/.test(phSrc) ? ok : fail)(
      "【177】装机/更新走 pip install -U（不带 -U 时已装包不会被升级，点更新 = 静默空转）"
    );
    // adb（Android 通道必需）：① 两平台安装表都要有它（预检【34】同源要求对称）；
    // ② 装进 tools/platform-tools；③ CLI 侧要能拿到路径（写 android.adb，⛔ 不动系统 PATH）。
    const rtSrc = existsSync(join(ROOT, "scripts", "install-runtimes.cjs"))
      ? readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8") : "";
    ((rtSrc.match(/want\("platform-tools"\)/g) ?? []).length >= 2
      && /path\.join\(TOOLS, "platform-tools"\)/.test(rtSrc)
      && /PLATFORM_TOOLS_URL/.test(rtSrc) ? ok : fail)(
      "【177】adb 在 Windows 与 macOS 两条安装路径上对称存在且落 tools/platform-tools（预检【34】比对两平台安装表）"
    );
    (/harness\(\["config", "set", "android\.adb"/.test(phSrc) ? ok : fail)(
      "【177】adb 路径写进 phone-harness 的 android.adb（⛔ 不改系统 PATH，与项目一贯做法一致）"
    );
    (phUi.includes('installDevRuntime') && phUi.includes('"platform-tools"') ? ok : fail)(
      "【177】卡片里有 adb 下载安装入口（复用开发工具页的运行时安装链路：进度与下载源都一致）"
    );
  }

  /* ══ 【170】DESIGN.md 视觉规范与代码对账（09-26）══════════════════════════
     概念来自 Google Stitch 的 DESIGN.md（结构参考 VoltAgent/awesome-design-md，MIT）：
     AGENTS.md 定义「怎么建」，DESIGN.md 定义「长什么样」。
     ⛔ 这类文档最大的风险是**和代码漂移**：CSS 变量改了而文档没跟 ⇒ 它变成骗人的东西，
        比没有还糟（后来改 UI 的 agent 会照着错的色板写）。所以这里做的是**真值对账**，
        不是「文件存在吗」—— 后者恒真，等于没写。 */
  {
    console.log(C.bold("\n【170】DESIGN.md 视觉规范（存在 / 章节 / 变量真值对账）"));
    const md170 = existsSync(join(ROOT, "DESIGN.md")) ? readFileSync(join(ROOT, "DESIGN.md"), "utf8") : "";
    const css170 = readFileSync(join(ROOT, "src", "styles", "01-base-and-chrome.css"), "utf8");

    (md170.length > 1200 ? ok : fail)(
      "【170】根目录存在 DESIGN.md（与 AGENTS.md 并列：一个管怎么建、一个管长什么样）"
    );

    (["## Overview", "## Colors", "## Typography", "## Components", "## Theming"].every((h) => md170.includes(h)) ? ok : fail)(
      "【170】DESIGN.md 章节齐备（总览 / 颜色 / 字体 / 组件 / 主题）"
    );

    // ⛔ 核心：变量表的亮/暗两栏必须与 CSS 里的**真值一致**
    const lightBlock = css170.slice(css170.indexOf(":root {"), css170.indexOf(':root[data-theme="dark"]'));
    const darkBlock = css170.slice(css170.indexOf(':root[data-theme="dark"] {'));
    const cssVal = (blk, name) => {
      const m = blk.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,8})"));
      return m ? m[1].toLowerCase() : null;
    };
    const drift = [];
    for (const name of ["bg", "panel", "panel-2", "line", "text", "muted", "accent"]) {
      const row = md170.split("\n").find((l) => l.startsWith("| `--" + name + "`"));
      if (!row) { drift.push(name + "(文档缺行)"); continue; }
      const cells = row.split("|").map((c) => c.trim().replace(/`/g, ""));
      const mdLight = (cells[2] || "").toLowerCase();
      const mdDark = (cells[3] || "").toLowerCase();
      const cLight = (cssVal(lightBlock, name) || "").toLowerCase();
      const cDark = (cssVal(darkBlock, name) || "").toLowerCase();
      if (!mdLight || mdLight !== cLight) drift.push(name + " 亮 " + mdLight + "≠" + cLight);
      if (!mdDark || mdDark !== cDark) drift.push(name + " 暗 " + mdDark + "≠" + cDark);
    }
    (drift.length === 0 ? ok : fail)(
      "【170】DESIGN.md 变量表与 CSS 真值一致（改了变量必须同步文档，否则文档会骗人）"
        + (drift.length ? "，漂移：" + drift.slice(0, 4).join("；") : "")
    );

    // 引导链：引擎只会自动读 AGENTS.md ⇒ DESIGN.md 必须在那里登记，
    // 否则改 UI 的 agent 根本不知道有这份规范（写得再好也没人读）。
    const agents170 = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    (agents170.includes("DESIGN.md") && agents170.includes("改 UI 前先读") ? ok : fail)(
      "【170】AGENTS.md 已登记 DESIGN.md（引擎只保证读 AGENTS.md，引导链断了规范就没人看）"
    );
  }

  /* ══ 【171】项目级 AGENTS.md 自动创建 + DESIGN.md 引导链（09-26 用户报障）══════════
     用户实测两个断点：「应用没有自动创建项目级 AGENTS.md」；根目录的 DESIGN.md「没生效，
     让 agent 自己扫他都不知道」。根因：引擎只自动读 <cwd>/AGENTS.md（项目文档机制），
     而应用此前①从不在用户项目里创建它 ②没有任何机制提及 DESIGN.md。
     形态：electron/project-conventions.ts 的 ensureProjectAgentsMd(cwd) —— 缺失则创建模板 /
     存在但从没提 DESIGN.md 且项目根确有 DESIGN.md 时追加引导（带标记、幂等）；
     接线 = **全部** thread/start 调用点在**转发之前**调用（引擎处理 thread/start 时就读
     AGENTS.md，响应侧才建会让本会话错过）。⛔ 全静默降级：启动链旁路，失败不许影响会话启动。 */
  {
    console.log(C.bold("\n【171】项目级 AGENTS.md 自动创建 + DESIGN.md 引导链"));
    const pcSrc = readFileSync(join(ROOT, "electron", "project-conventions.ts"), "utf8");

    // ① 模板与追加段都必须引导读 DESIGN.md —— 这是 DESIGN.md 在用户项目里生效的唯一通道
    //    ⛔ 锚「模板正文本体」（两处模板里各出现一次的短语），不能数全文 DESIGN.md —— 头注释里就有 3 处，数全文恒真
    const guideHits = (pcSrc.match(/先完整读它/g) || []).length;
    const sectionHits = (pcSrc.match(/## 视觉规范/g) || []).length;
    (guideHits >= 2 && sectionHits >= 2 ? ok : fail)(
      "【171】模板与追加段都引导读 DESIGN.md（DESIGN.md 生效的唯一通道，不能断）"
        + `（模板正文命中：先完整读它×${guideHits}/视觉规范标题×${sectionHits}）`
    );
    // ② 追加幂等：带标记判重，thread/start 反复触发也不重复追加
    (pcSrc.includes("HARNESS_APPEND_MARK") && /includes\(HARNESS_APPEND_MARK\)/.test(pcSrc) ? ok : fail)(
      "【171】追加幂等（带标记判重，thread/start 反复触发不重复追加）"
    );
    // ③ 静默降级：启动链旁路，任何失败（只读盘/权限）都不许影响会话启动
    (pcSrc.includes("export function ensureProjectAgentsMd") && /catch \{/.test(pcSrc) ? ok : fail)(
      "【171】全函数 try/catch 静默降级（启动链旁路，失败不许影响会话启动）"
    );
    // ④ 接线完整性（结构性）：每一个 server.request("thread/start") 的文件都必须已接线 ——
    //    将来新增调用点漏接，这里打红（这就是用户看到的「没自动创建」）。
    const engineTs = [];
    (function walk171(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const fp = join(dir, e.name);
        if (e.isDirectory()) walk171(fp);
        else if (/\.ts$/.test(e.name)) engineTs.push(fp);
      }
    })(join(ROOT, "electron"));
    const unwired = engineTs.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes('server.request("thread/start"') && !src.includes("ensureProjectAgentsMd");
    });
    (unwired.length === 0 ? ok : fail)(
      "【171】全部 thread/start 调用点都已接线 ensureProjectAgentsMd"
        + (unwired.length ? "，未接线：" + unwired.slice(0, 3).map((f) => f.replace(ROOT, "")).join("；") : "")
    );
    // ⑤ 主路径必须在**转发前**调用（响应侧建会让本会话错过）
    const bridge171 = readFileSync(join(ROOT, "electron", "features", "codex-ipc.ts"), "utf8");
    ((() => {
      const call = bridge171.indexOf("ensureProjectAgentsMd(startCwd)");
      const req = bridge171.indexOf("server.request(method, params)");
      return call >= 0 && req >= 0 && call < req;
    })() ? ok : fail)(
      "【171】主路径（codex:request）在转发前调用（引擎处理 thread/start 时就读 AGENTS.md）"
    );
  }

  /* ══ 【172】AGENTS.md 注入上限（09-26 实测：默认 32KB 静默截断，一半规章进不了模型）═══
     实测取证（`codex debug prompt-input` 渲染模型实际输入）：引擎读 <cwd>/AGENTS.md 注入
     <INSTRUCTIONS>，但受 `project_doc_max_bytes` 限制 —— **默认 32768 字节**，超出静默截断
     （不报错、不加提示）。本仓 AGENTS.md 已 64KB ⇒ 只注入 32770 字节，尾部一半（工具链 /
     能力清单 / 初始化原则 / 记忆后端…）全部读不到，症状 =「规章写了但 agent 不照做」。
     ⛔ 引擎会向上遍历拼接多级 AGENTS.md，上限卡的是**拼接总量**（子目录项目叠加后更容易超）。
     判据：启动参数必须显式抬高上限，且**值要 > 当前 AGENTS.md 字节数**（否则等于没修）。 */
  {
    console.log(C.bold("\n【172】AGENTS.md 注入上限（默认 32KB 会静默截断）"));
    const csSrc = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
    // ① 启动参数显式设置上限（接线锚：spawn 的 argv 数组里带 -c project_doc_max_bytes=…）
    const m = csSrc.match(/-c",\s*"project_doc_max_bytes=(\d+)"/);
    (m ? ok : fail)(
      "【172】启动参数显式抬高 project_doc_max_bytes（引擎默认 32768 会静默截断 AGENTS.md）"
        + (m ? `（当前 ${m[1]}）` : "，未找到 -c project_doc_max_bytes=… ⇒ 用的是默认 32768")
    );
    // ② 值必须留有余量：> 当前 AGENTS.md 实际字节数（引擎会向上拼接多级，故要求 ≥2×）
    if (m) {
      const limit = Number(m[1]);
      let agentsBytes = 0;
      try { agentsBytes = statSync(join(ROOT, "AGENTS.md")).size; } catch { agentsBytes = 0; }
      (limit > agentsBytes ? ok : fail)(
        `【172】上限(${limit}) 必须大于 AGENTS.md 实际大小(${agentsBytes} 字节，否则等于没修)`
      );
      (limit >= agentsBytes * 2 ? ok : fail)(
        `【172】上限留 2× 余量（引擎向上遍历会拼接多级 AGENTS.md，卡的是总量；余量=${(agentsBytes ? (limit / agentsBytes).toFixed(2) : "?")}×）`
      );
    }
  }

  /* ══ 【174】dev 重启不白屏 + 任务栏图标不丢（09-27 用户实测两连）════════════
     事故一（白屏）：保存供应商 → relaunchApp() 整应用重启。dev 启动脚本是
       `concurrently -k "vite" "wait-on tcp:5173 && electron ."`，`-k` 让旧 electron 一退
       就把 vite 一起杀掉，而新实例继承 VITE_DEV_SERVER_URL=http://localhost:5173 ⇒
       did-fail-load ERR_CONNECTION_REFUSED ⇒ DOM 全空 = 白屏（探针实测）。
     事故二（图标）：WindowFactory 只认 app.getAppPath()/build/icon.ico 一条路径，relaunch
       等场景 appPath 不落在仓库根 ⇒ existsSync=false ⇒ icon:undefined ⇒ dev 无 AUMID 兜底
       ⇒ 任务栏回退 Electron 原子图标。
     两条都为「文件存在但路径/环境变了」，故断言锚**接线与多源兜底**而非文件存在。 */
  {
    const diagSrc = readFileSync(join(ROOT, "electron", "features", "app-diagnostics.ts"), "utf8");
    const winSrc = readFileSync(join(ROOT, "electron", "features", "window-factory.ts"), "utf8");
    // ① relaunch 前必须摘掉 dev URL（新实例才不会去连已死的 vite）
    (/delete process\.env\.VITE_DEV_SERVER_URL/.test(diagSrc) ? ok : fail)(
      "【174】app:relaunch 在 dev 下摘掉 VITE_DEV_SERVER_URL（否则新实例连已死的 vite ⇒ 白屏）"
    );
    // ② relaunch 必须优雅退（app.quit 而非 app.exit）——保证 before-quit 清理与图标不被打断
    // ⛔ 10-03：双形态锚点（域改插件形态后写 ipcHost.handle）
    const relaunchBlock = sliceHandle(diagSrc, "app:relaunch", 1200);
    // ⛔ 10-03：域接缝化后写的是 `host.app.relaunch()` / `host.app.quit()`。
    //    判据必须**认接缝形态** —— 只写 /app\.relaunch\(\)/ 的话，此刻仍能过是因为它恰好是
    //    `host.app.relaunch()` 的子串（**碰巧匹配**，不是设计）。将来若改成别的接缝名
    //    （如 `caps.app`）就会静默假红/假绿。判据要显式列出两种形态。
    const relaunchGraceful = /(?:\bhost\.app|app)\.relaunch\(\)/.test(relaunchBlock)
      && /(?:\bhost\.app|app)\.quit\(\)/.test(relaunchBlock)
      && !/(?:\bhost\.app|app)\.exit\(0\)/.test(relaunchBlock);
    (relaunchGraceful ? ok : fail)(
      "【174】app:relaunch 用 app.quit() 优雅退出（app.exit 会跳过 before-quit 清理并打断任务栏图标）"
    );
    // ③ 窗口加载失败要能回落本地 dist（宁可看构建版也不能白屏）
    (/loadURL\(devUrl\)\.catch\(/.test(winSrc) && /loadFile\(distIndex\)/.test(winSrc) ? ok : fail)(
      "【174】dev URL 加载失败回落本地 dist（白屏第二道保险）"
    );
    // ④ 图标路径必须多源兜底（只认 app.getAppPath() 一条会在 relaunch 后丢图标）
    (/iconCandidates/.test(winSrc) && /process\.execPath/.test(winSrc) && /iconCandidates\.find\(/.test(winSrc) ? ok : fail)(
      "【174】窗口图标多源兜底（appPath / execPath 上溯 / cwd，取首个存在的）"
    );
  }

  /* ══ 【173】共享技能池（09-27 用户需求：按项目选择生效的全局技能）══════════
     模型：全局停用集（codex-home/skill-global-disabled.json）∪ 项目禁用集
     （<项目>/.codex-harness/skill-pool.json）→ syncSkillPool(cwd) 投影到磁盘改名。
     ⛔ 引擎「扫到就注入」无 per-project 开关 ⇒ 池的唯一生效途径 = thread/start 前
     重排磁盘状态；接线挂在 ensureProjectAgentsMd（【171】的同一收口，12 处继承）。
     ⛔ 投影必须幂等且保底迁移（磁盘 .disabled 而配置无记录 ⇒ 记入全局停用集，
     否则用户已停用的技能会被误恢复）。 */
  {
    console.log(C.bold("\n【173】共享技能池（按项目生效）"));
    const poolSrc = readFileSync(join(ROOT, "electron", "skill-pool.ts"), "utf8");

    // ① 三件套齐全（sync 投影 / describe UI 数据 / set 动作）
    ((["syncSkillPool", "describeSkillPool", "setSkillPoolState"].every((fn) => poolSrc.includes("export function " + fn))) ? ok : fail)(
      "【173】skill-pool.ts 三件套齐全（sync 投影 / describe / set）"
    );
    // ①b 项目独立性（09-27 用户拍板「A 项目启用禁用跟 B 项目没有毛关系」）：describe 的
    //    active 必须按 cwd 自己的配置算（!globalDisabled && !projectDisabled），
    //    ⛔ 禁止读磁盘改名态（磁盘是「最近一次 sync 项目」的投影，读它会把 A 的状态泄漏进 B 的
    //    视图，且在 B 点开还会反向写坏 B 的配置——双向污染，实测复现过）。
    (/active:\s*!globalDisabled\s*&&\s*!projectDisabled/.test(poolSrc) && !/active:\s*enabled\b/.test(poolSrc) ? ok : fail)(
      "【173】describe 的 active 按项目配置算（禁读磁盘投影态，保证项目间独立）"
    );
    // ② 接线：ensureProjectAgentsMd 里必须调用 syncSkillPool（thread/start 前生效的唯一通道）
    const pcPool = readFileSync(join(ROOT, "electron", "project-conventions.ts"), "utf8");
    (pcPool.includes("syncSkillPool(dir)") ? ok : fail)(
      "【173】syncSkillPool 挂在 ensureProjectAgentsMd（thread/start 前投影，12 处调用点继承）"
    );
    // ③ 迁移保底：磁盘停用态而配置无记录 ⇒ 记入全局停用集（防误恢复）
    (poolSrc.includes("记入全局停用集") && poolSrc.includes("writeGlobalDisabled(codexHome, global)") ? ok : fail)(
      "【173】迁移保底：遗留 .disabled 先记入全局停用集（防已停用技能被误恢复）"
    );
    // ④ IPC 三件套：handler 注册 + manifest 通道 + registry 域表
    const handlerPool = readFileSync(join(ROOT, "electron", "features", "skills-ipc.ts"), "utf8");
    const manifestPool = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
    const registryPool = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/(?:ipcMain|ipcHost)\.handle\("skills:pool-describe"/.test(handlerPool) && /(?:ipcMain|ipcHost)\.handle\("skills:pool-set"/.test(handlerPool) ? ok : fail)(
      "【173】skills:pool-describe / skills:pool-set handler 已注册"
    );
    (manifestPool.includes("skills:pool-describe") && manifestPool.includes("skills:pool-set") ? ok : fail)(
      "【173】manifest 已登记 skills:pool-* 两通道"
    );
    (registryPool.includes('"skills:pool-describe", "skills:pool-set"') ? ok : fail)(
      "【173】ipc-registry 的 skills 域已登记 pool 通道"
    );
    // ⑤ UI：技能中心挂池管理区块
    const uiPool = readFileSync(join(ROOT, "src", "features", "settings-skills", "SkillPoolSection.tsx"), "utf8");
    const centerPool = readFileSync(join(ROOT, "src", "features", "settings-skills", "SkillsCenterSection.tsx"), "utf8");
    (uiPool.includes("describeSkillPool") && uiPool.includes("setSkillPoolState") ? ok : fail)(
      "【173】SkillPoolSection 自取池数据与动作（不经 bag，避开【92】顺序契约）"
    );
    (/<SkillPoolSection\s+projects=\{props\.projects\}[^>]*\/>/.test(centerPool) ? ok : fail)(
      "【173】技能中心「我的技能」视图已挂共享技能池区块（穿 projects 供项目切换器；⛔ 判据锚 props 接线，别锚整串字面量——10-06 加 onNotice 回执时旧字面量断言假红）"
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

// ── 22. 引擎 0.157 协议迁移：thread/rollback → thread/revert（09-27 用 generate-ts 做协议 diff 发现）──
{
  const undo178 = readAppUi();
  // ⛔ 用**调用形态**锚（`request("thread/rollback"`）——注释里会写旧方法名解释原因，
  //   用「全文禁词」会被自己的注释误伤（09-27 在【46】上真踩过）。
  (!/request\("thread\/rollback"/.test(undo178) ? ok : fail)(
    "【178】不许再调 thread/rollback（引擎 0.157 已移除该 RPC ⇒ 直接 method not found）"
  );
  // 撤销分支先整块锚定再查内容（⛔ 别用固定字符窗口串两句：插几行就假红）
  const undoBlock178 = /name === "undo"\)([\s\S]*?)\} else if/.exec(undo178)?.[1] ?? "";
  (/request\("thread\/revert", \{ threadId[^}]*beforeTurnId/.test(undoBlock178) ? ok : fail)(
    "【178】撤销走 thread/revert 且传 beforeTurnId（替代 numTurns：beforeTurnId 之前的前缀才是保留部分）"
  );
  (/request\("thread\/turns\/list"/.test(undoBlock178) ? ok : fail)(
    "【178】revert 后必须 thread/turns/list 重载回合（返回的 thread.turns 恒为空，直接塞回会清空界面）"
  );
}

// ── 23. 使用统计页的「账号用量」区块（09-27 接引擎 account/usage/read；该 RPC 0.153 就有，只是没接）──
{
  const upSrc = readFileSync(join(ROOT, "src", "components", "UsagePanel.tsx"), "utf8");
  (/request\("account\/usage\/read"/.test(upSrc) ? ok : fail)(
    "【179】使用统计页接入引擎账号用量（account/usage/read）"
  );
  // ⛔ 必须静默降级：未登录 / 用第三方 provider（引擎侧没有账号态）/ 网络失败 ⇒ **整块不渲染**。
  //   本机实测 auth.json 是 4 字节的 `null` ⇒ 用户当前走的就是这条降级路（SSR 已实证不留空区块）。
  (/\.catch\(\(\) => undefined\)/.test(upSrc) && /if \(!summary\) return null/.test(upSrc) ? ok : fail)(
    "【179】拿不到账号数据时静默降级（catch 兜住 + !summary 直接 return null，不留空占位）"
  );
  // ⛔ 两套来源不许混算：本机累计（本地 stats）与服务端账号 summary 必须分开展示。
  //   锚 `stats` 的**数据引用形态**（stats. / stats, / stats)）—— 裸词会被自己的 CSS 类名
  //   `usage-stats-row` 误伤（09-27 实测踩到；同型教训：断言别锚裸词，要锚代码形态）。
  const accountFn = /function AccountUsageBlock\(\)[^]*?\n}/.exec(upSrc)?.[0] ?? "";
  (accountFn.length > 0 && !/stats\s*[.,)]/.test(accountFn) ? ok : fail)(
    "【179】账号区块不引用本机 stats（本机累计与服务端记账是两套来源，不许混算）"
  );
}

// ── 24. 侧栏导航重排（09-27 用户一次性五条：删会话备份 / 自动化改名 / 三入口合并 / 删模型配置 / 搜索任务挪位）──
{
  // ⛔⛔ 读进来先过 codeOnly()：本块自己的注释里必然会提到这些类名/文案（讲解历史时写的），
  //   裸词断言会被自己的注释命中 —— 09-27 变异实测当场栽了两次（`search-box` 命中的是注释里的
  //   「.search-box」）。这是同一个坑的第五次，从此本块的断言一律在**剥掉注释的代码**上做。
  const side180 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8"));
  // ① 删「会话备份」入口（用户：「会话备份选项删了，前面不需要这个了」）。
  //   ⛔ 只删**侧栏入口**：设置页里的 backup 页保留（用户说的是"主界面左侧侧边栏的"）。
  (!/setSettingsPage\("backup"\)/.test(side180) ? ok : fail)(
    "【180】侧栏不再有「会话备份」入口（⛔ 设置页里的备份页仍保留，别连带删掉）"
  );
  // ② 「自动化」→「定时任务」：它跳的本来就是 schedule 页，改名后入口与目标页同名
  (/<Clock3 size=\{15\} \/><span>定时任务<\/span>/.test(side180) ? ok : fail)(
    "【180】侧栏该项文案是「定时任务」（跳 schedule 页，与页面同名）"
  );
  (!/<span>自动化<\/span>/.test(side180) ? ok : fail)(
    "【180】侧栏不再有「自动化」文案（与设置页里真正的 automation 页区分开）"
  );
  // ③ 技能中心 / 插件市场 / 专家-专家团 合并成一个入口 + 弹窗三选一
  (/<span>技能-插件-专家\/专家团<\/span>/.test(side180) ? ok : fail)(
    "【180】侧栏有合并入口「技能-插件-专家/专家团」"
  );
  (!/<span>技能中心<\/span>|<span>插件市场<\/span>|<span>专家\/专家团<\/span>/.test(side180) ? ok : fail)(
    "【180】原来的三个独立入口不再并列在侧栏（已收进弹窗）"
  );
  // ⛔ 必须同时钉「打开动作」与「打开条件」：只查弹窗内容会**恒真** —— 09-27 变异实测，
  //   把渲染条件 `{extHubOpen && (` 改成 `{false && (` 时断言照样绿（内容还在源码里）。
  (/onClick=\{\(\) => setExtHubOpen\(true\)\}/.test(side180) ? ok : fail)(
    "【180】合并入口的按钮真的会打开弹窗（有 setExtHubOpen(true)）"
  );
  (/\{extHubOpen && \(/.test(side180) ? ok : fail)(
    "【180】弹窗挂在 extHubOpen 条件上（⛔ 不是被改成恒假/被删）"
  );
  // 弹窗内容取「aria-label → 下一个稳定标记 {moreHubOpen」之间（⛔ 别用固定字符窗口，
  // 插几行就假红；也别锚结尾缩进 —— 09-27 自己在这里写错过一次）
  // 10-04：「···更多」的弹窗插在 {projectFilter 之前，窗口尾锚必须跟着换成 {moreHubOpen，
  // 否则这个 hub 的窗口会把另一个弹窗也算进来（"every" 断言仍会绿，但盯不住它自己那三项）。
  const hub180 = (() => {
    const at = side180.indexOf('aria-label="技能 / 插件 / 智能体"');
    if (at < 0) return "";
    const end = side180.indexOf("{moreHubOpen &&", at);
    return side180.slice(at, end > at ? end : at + 2400);
  })();
  (["skills", "plugins", "agentteam"].every((p) => new RegExp(`setSettingsPage\\("${p}"\\)`).test(hub180)) ? ok : fail)(
    "【180】弹窗三项（技能市场 / 插件市场 / 智能体）各自能跳到对应设置页"
  );
  (["技能市场", "插件市场", "智能体"].every((t) => hub180.includes(t)) ? ok : fail)(
    "【180】弹窗三项文案齐全"
  );
  (/\.ext-hub-list\s*\{/.test(readStyles()) ? ok : fail)(
    "【180】合并入口弹窗的列表样式存在（缺了弹窗里会是一堆裸按钮）"
  );
  // ④ 模型配置入口的删除在【70】里（同轮把那两条正向断言翻成负向）
  // ⑤ 搜索任务挪到「新建任务」下面（原来在按钮区之外，是独立一行）
  // ⛔ 导航区边界 = `aria-label="导航"` 到它的 `</div>`（按钮区内无嵌套 div，首个 </div> 即边界）。
  //   09-27 变异实测：只查「全文某处有 search-box」太弱（挪出去照样能过）。
  const navStart180 = side180.indexOf('aria-label="导航"');
  const navEnd180 = navStart180 >= 0 ? side180.indexOf("</div>", navStart180) : -1;
  const nav180 = navStart180 >= 0 && navEnd180 > navStart180 ? side180.slice(navStart180, navEnd180) : "";
  (nav180.includes("新建任务") && nav180.includes("search-box") && nav180.indexOf("search-box") > nav180.indexOf("新建任务") ? ok : fail)(
    "【180】「搜索任务」在导航区内、且排在「新建任务」之后"
  );
  (!/<\/div>\s*<button className="search-box"/.test(side180) ? ok : fail)(
    "【180】搜索任务不再留在导航区之外的旧位置（紧跟 </div> 之后那一行）"
  );
}

// ── 25. 办公室走动人寻路（09-27 用户「按建议顺序」第 3 项）──
// 背景：走动人原来是 from→to **直线插值**，从自己工位走到饮水机会直接穿过别人的桌子。
// 参照 munder-difflin 的做法（作者博客：BFS 四方向寻路，明确说这规模不需要 A*）改成网格寻路。
  /* ⛔ 办公室预览（team-office 域）09-30 用户要求整体下线、待重做 ⇒ 目录不在就不跑这组断言 */
  if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
{
  const canvas181 = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  const navPath181 = join(ROOT, "src", "features", "team-office", "office-nav.mjs");
  // ① 接线：走动人必须走 BFS 路径
  (/buildWalkerPath\(scene, ground/.test(canvas181) ? ok : fail)(
    "【181】走动人用 BFS 路径（buildWalkerPath）"
  );
  // ⛔ 用 codeOnly 剥注释再判：注释里讲解历史时必然提到"直线插值"这些词
  (!/lerp\(w\.from\.x, w\.to\.x/.test(codeOnly(canvas181)) ? ok : fail)(
    "【181】不再有 from→to 直线插值（那会让人穿过别人的桌子）"
  );
  // ② 路径只在目标变化时重算（这个同步函数每帧跑，无条件重算 = 每帧一次 BFS）
  (/walker\.pathKey !== key/.test(canvas181) ? ok : fail)(
    "【181】路径只在目标变化时重算（每帧重算 = 每帧一次 BFS）"
  );
  // ③ 可行走网格按工位布局缓存
  (/scene\.navKey !== navKey/.test(canvas181) ? ok : fail)(
    "【181】可行走网格按布局缓存（不每帧重建 768 格）"
  );
  // ④ 走动速度按弧长换算（按 t 恒速会让"绕远路"的人反而走得飞快）
  (/pxPerFrame \/ w\.totalLen/.test(canvas181) ? ok : fail)(
    "【181】走动速度按路径长度换算（不是按 t 恒速）"
  );
  // ⑤ 真跑纯模块（office-nav.mjs 就是为此才用 .mjs：.ts 守卫只能读文本、跑不了）
  if (!existsSync(navPath181)) fail("【181】office-nav.mjs 缺失 —— 守卫无法真跑寻路");
  else {
    const nav181 = await import(pathToFileURL(navPath181).href);
    // ⛔ 这里的工位 u/v 抄自 office-iso 的 COL_U / ROW_V（3 列 × 3 行）；布局改了两边一起改。
    const desks181 = [
      { u: 0.23, v: 0.3 }, { u: 0.5, v: 0.3 }, { u: 0.77, v: 0.3 },
      { u: 0.23, v: 0.61 }, { u: 0.5, v: 0.61 }, { u: 0.77, v: 0.61 },
      { u: 0.23, v: 0.92 }, { u: 0.5, v: 0.92 }, { u: 0.77, v: 0.92 },
    ];
    const grid181 = nav181.buildWalkGrid(desks181);
    const blocked181 = (pt) => nav181.isBlocked(grid181, nav181.cellOf(pt.u, pt.v, grid181).cx, nav181.cellOf(pt.u, pt.v, grid181).cy);
    (desks181.every(blocked181) ? ok : fail)("【181】真跑：工位座位点被判为障碍（网格确实按桌子标了）");
    const p181 = nav181.findPath({ u: 0.5, v: 0.61 }, { u: 0.9, v: 0.68 }, grid181);
    (Array.isArray(p181) && p181.length >= 3 ? ok : fail)(`【181】真跑：工位→饮水机有路径（${p181?.length ?? 0} 个点）`);
    if (p181) {
      const hits181 = p181.filter(blocked181).length;
      (hits181 <= 2 ? ok : fail)(`【181】真跑：路径不穿家具（落在障碍格的只有 ${hits181} 个，允许起终点计数）`);
      const walked181 = nav181.pathLength(p181.map((pt) => ({ x: pt.u, y: pt.v })));
      const direct181 = Math.hypot(0.9 - 0.5, 0.68 - 0.61);
      (walked181 > direct181 * 1.001 ? ok : fail)(
        `【181】真跑：路径比直线长（${walked181.toFixed(3)} vs ${direct181.toFixed(3)}）⇒ 确实在绕，不是直线`
      );
    }
    // 每个工位都要能走出去（⛔ 别出现"被自己桌子困住"的工位）
    let trapped181 = 0;
    for (const desk of desks181) if (!nav181.findPath(desk, { u: 0.5, v: 0.06 }, grid181)) trapped181++;
    (trapped181 === 0 ? ok : fail)(`【181】真跑：9 个工位都能走到后墙通道（被困住 ${trapped181} 个）`);
  }

  /* ══ 【182】archkit 架构图引擎（逆向复刻 archify 方法论，净室重实现；纯函数真跑） ══ */
  {
    const model = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-model.mjs")).href);
    const renderer = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-render.mjs")).href);
    (model.archkitNormalizeDiagram({ type: "mindmap", nodes: [], edges: [] }).ok === false ? ok : fail)(
      "【182】未知 type 被拒（白名单：architecture / workflow / sequence）"
    );
    const dup182 = model.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a" }, { id: "a" }], edges: [] });
    (dup182.ok === false && dup182.problems.some((p) => /重复/.test(p.message)) ? ok : fail)("【182】节点 id 重复 ⇒ 整份拒收");
    (model.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a" }], edges: [{ from: "a", to: "ghost" }] }).ok === false ? ok : fail)(
      "【182】连线端点不存在 ⇒ 不 ok（⛔ 不做静默修复——证据图错一根线就整份拒收）"
    );
    (model.archkitNormalizeDiagram({ type: "sequence", nodes: [{ id: "A" }, { id: "B" }], messages: [{ from: "A", to: "B" }] }).ok === false ? ok : fail)(
      "【182】sequence 消息缺 text 被拒"
    );
    const sample182 = model.archkitNormalizeDiagram({
      type: "architecture", title: "样例",
      nodes: [
        { id: "m", kind: "entry", label: "main.ts", evidence: ["electron/main.ts"] },
        { id: "e", kind: "external", label: "引擎" },
        { id: "u", kind: "module", label: "渲染层" },
      ],
      edges: [{ from: "m", to: "e", label: "spawn" }, { from: "m", to: "u", label: "桥" }],
    });
    if (sample182.ok) {
      const html182 = renderer.archkitRender(sample182.diagram);
      (html182 === renderer.archkitRender(sample182.diagram) ? ok : fail)(
        "【182】渲染确定性：同输入两次输出逐字节一致（deliver 回执 sha256 的前提）"
      );
      (!/(src|href)\s*=\s*"https?:|@import|url\(\s*['"]?https?:/i.test(html182) && html182.includes("<svg") ? ok : fail)(
        "【182】产出自包含：无任何外链资源（src/href 都要查——link 标签走 href，⛔ 只查 src 会漏）"
      );
      (html182.includes("main.ts") && html182.includes('data-archkit="1"') && html182.includes('data-id="m"') ? ok : fail)(
        "【182】节点卡片是真 SVG 文本（可搜索可复制），不是位图；且带 data 属性供交互"
      );
      (renderer.archkitRender(model.archkitNormalizeDiagram({
        type: "sequence", title: "s",
        nodes: [{ id: "A" }, { id: "B" }], messages: [{ from: "A", to: "B", text: "hi" }],
      }).diagram).includes("lifeline") ? ok : fail)("【182】sequence 渲染出 lifeline（三型图各自有专属布局）");
    } else {
      fail("【182】样例输入竟不合法：" + JSON.stringify(sample182.problems));
    }
  }

  /* ══ 【183】定时任务 → 微信主动投递（09-27：打通「会话设定时 + 到点推微信」通道） ══ */
  {
    const sched183 = readFileSync(join(ROOT, "electron", "scheduler.ts"), "utf8");
    const im183 = readFileSync(join(ROOT, "electron", "features", "weixin-ipc.ts"), "utf8");
    const gw183 = readFileSync(join(ROOT, "electron", "weixin-gateway.ts"), "utf8");
    // ⛔ 都锚接线形态，别锚常量/注释（注释里的同名字串不算——【180】【70】各踩过一次）
    (/deliver\?: DeliverTarget/.test(sched183) && /deliver: input\.deliver === undefined \? current\?\.deliver : sanitizeDeliver\(input\.deliver\)/.test(sched183) ? ok : fail)(
      "【183】定时任务有 deliver 字段且 save 走 sanitizeDeliver（缺省保留原值，局部更新不打掉已有投递）"
    );
    (/task\.deliver\?\.channel === "weixin"/.test(sched183) && /await this\.deliverWeixin\(task, outcome\.replyText\)/.test(sched183) ? ok : fail)(
      "【183】run 完成后真的调 deliverWeixin 并把抓到的回复文本传进去（⛔ 只建通道不接线 = 永远不发）"
    );
    (/if \(!weixinGateway\) throw/.test(sched183) && /weixinGateway\.sendToBoundUser\(text\)/.test(sched183) && /weixinGateway\.sendText\(to, text\)/.test(sched183) ? ok : fail)(
      "【183】投递走微信网关（to 显式→sendText；缺省→sendToBoundUser；未登录要抛错留痕，不许静默吞）"
    );
    (/textByTurn/.test(sched183) && /item\/agentMessage\/delta/.test(sched183) && /item\/completed/.test(sched183) ? ok : fail)(
      "【183】回复文本从 agentMessage 增量聚合 + completed 兜底（完成事件经常只回 id+status，只等 completed 会拿到空文本）"
    );
    // ⛔ 10-03：域改插件形态后注册写 ipcHost.handle —— 只认 ipcMain.handle 会让这条**安全/能力**断言假红。
    (/(?:ipcMain\.handle|ipcHost\.handle)\("weixin:send"/.test(im183) && /sendToBoundUser\(text\)/.test(im183) && /hasSession\(\)/.test(im183) ? ok : fail)(
      "【183】weixin:send 通道存在（agent 主动推送的直连工具；未登录 must 抛错，to 缺省走绑定用户）"
    );
    (/get boundUserId\(\)/.test(gw183) && /sendToBoundUser/.test(gw183) ? ok : fail)(
      "【183】网关暴露 boundUserId/sendToBoundUser（调度投递的缺省目标）"
    );
    let manifest183 = {};
    try { manifest183 = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8")); } catch { /* 读不到由下一条报 */ }
    const wxSend183 = (manifest183.channels || []).find((c) => c.channel === "weixin:send");
    (wxSend183 && wxSend183.cast === "Promise<{ ok: boolean }>" ? ok : fail)(
      "【183】manifest 登记了 weixin:send（cast 完整 Promise 形态——写对象类型会让 preload TS2352，phone 域踩过）"
    );
    const cap183 = readFileSync(join(ROOT, "electron", "builtin-skills", "14-skill-harness-api.ts"), "utf8");
    (cap183.includes("weixin:send") && cap183.includes("deliver") ? ok : fail)(
      "【183】harness-api 能力清单包含 weixin:send 与 deliver（agent 读的就是这份——清单里没有 = 会话里永远配不出来）"
    );
  }

  /* ══ 【184】内置视频生成接口 + 生图工作流（09-27；适配层纯函数真跑） ══ */
  {
    const videoGen184 = readFileSync(join(ROOT, "electron", "features", "video-gen.ts"), "utf8");
    const manifest184 = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
    const videoChannels184 = (manifest184.channels || []).filter((c) => c.channel.startsWith("video:")).map((c) => c.channel);
    // ⛔ 期望清单要**穷举**：少写一个（如 09-29 新增的 video:concat）会让断言在域里加了通道后
    //    仍然绿 —— 那就从「登记完整性」退化成了「这几个还在」。
    const wantVideo184 = ["video:providers", "video:config-read", "video:config-save", "video:submit", "video:poll", "video:download", "video:concat"];
    (wantVideo184.every((ch) => videoChannels184.includes(ch)) && videoChannels184.length === wantVideo184.length ? ok : fail)(
      `【184】manifest 登记了 video 域全部 7 通道（providers/config-read/config-save/submit/poll/download/concat；实得 ${videoChannels184.length}）`
    );
    (/videoAssertImageOk\(/.test(videoGen184) ? ok : fail)(
      "【184】video:submit 提交前过 videoAssertImageOk（url-only 厂商吃本地首帧要当场报错，不许静默失败）"
    );
    (/isInsideTrustedRoots\(String\(input\.workspace\)\)/.test(videoGen184) ? ok : fail)(
      "【184】video:download 落盘前过可信根校验（与 fs:write 同一口径）"
    );
    const registry184 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/{ prefix: "video", count: 7,/.test(registry184) && /features\/video-gen\.ts/.test(registry184) ? ok : fail)(
      "【184】ipc-registry 有 video 域条目（count 7，file 指向 video-gen.ts）"
    );
    // 适配层真值表（纯 .mjs 直接 import 跑，不是读文本）
    const vp = await import(pathToFileURL(join(ROOT, "src", "lib", "video-providers.mjs")).href);
    const NOW184 = 1727420000000;
    (vp.VIDEO_PROVIDERS.length === 8 && vp.VIDEO_PROVIDERS.filter((p) => p.region === "cn").length === 5 ? ok : fail)(
      "【184】真跑：8 家厂商（国内 5 国外 3）——国内外都要支持是用户点名的要求"
    );
    (vp.klingToken({ accessKey: "ak", secretKey: "sk" }, NOW184) === vp.klingToken({ accessKey: "ak", secretKey: "sk" }, NOW184) ? ok : fail)(
      "【184】真跑：klingToken 确定性（nowMs 入参，同输入同输出——JWT 里不许藏 Date.now）"
    );
    (() => {
      try { vp.videoAssertImageOk("wanx", "i2v", "D:/local/frame.png"); return fail("【184】真跑：url-only 厂商吃本地首帧竟然放行了"); }
      catch (e) { return /公网/.test(e.message) ? ok("【184】真跑：url-only 厂商吃本地首帧被拒且指明替代厂商") : fail("【184】真跑：报错文案没说清要公网 URL"); }
    })();
    (vp.videoParsePoll("wanx", { output: { task_status: "SUCCEEDED", video_url: "https://v/1.mp4" } }).url === "https://v/1.mp4" ? ok : fail)(
      "【184】真跑：wanx 成功态取到 video_url（parsePoll 归一成 {status,url}）"
    );
    // 渲染层：shot 卡的生成按钮必须真接线（⛔ 禁止"生成视频（未接入）"这种假按钮回潮）
    // 09-28：按钮改为按 GEN_CHANNELS 映射表逐通道渲染 ⇒ 锚点跟着改成「视频通道分支真的调
    // generate(id, what)」（不再是写死的 `generate(id, "video")` 字面量，否则重构即假红）。
    // ⛔ 09-28 二次搬家：按钮本体移到 DramaChannelButton.tsx（卡面 + 检查器共用）⇒ 读那个文件，
    //    并额外要求 shot 在映射表里确实挂着 video 通道（只查「调了 generate」会漏掉"通道被摘掉"）。
    const btn184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8");
    const card184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8");
    (btn184.includes("void actions.story.generate(id, what)") && /shot: \["image", "video", "audio"\]/.test(btn184) && !card184.includes("生成视频（未接入）") ? ok : fail)(
      "【184】shot 卡「生成视频」真调 story.generate（未接入的置灰假按钮不许回潮）"
    );
    const story184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8");
    (story184.includes("videoSubmit") && story184.includes("videoPoll") && story184.includes("videoDownload") ? ok : fail)(
      "【184】视频生成闭环三步都在（submit → poll → download 落工作区），不是只调了 submit"
    );
    // 生图工作流（09-27 二次修正）：⛔ 不做独立侧栏入口（用户点名：原来一个入口就别造重复入口）
    // —— 同一画布 + 两种起手按钮；专家召唤在选择器里（会话选择 + 视频团/生图专家）。
    const model184 = readFileSync(join(ROOT, "src", "lib", "drama-canvas-model.mjs"), "utf8");
    const side184 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8");
    const canvas184 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    (model184.includes("export function imageStarterWorkflow") ? ok : fail)(
      "【184】生图起手骨架 imageStarterWorkflow 存在"
    );
    (/setDramaCanvasVariant/.test(side184) ? fail("【184】侧栏又出现了 variant 双入口（用户点名别造重复入口）") : ok)(
      "【184】侧栏只有一个画布入口（无 variant 双入口回潮）"
    );
    (canvas184.includes('createStarter("drama")') && canvas184.includes('createStarter("image")') && canvas184.includes("新建生图工作流") ? ok : fail)(
      "【184】画布头部有「短剧/生图」两个起手按钮（生图工作流在同入口内闭环）"
    );
    (canvas184.includes("onSummonTeam") && canvas184.includes('"video-production-team"') && canvas184.includes('"image-gen-expert"') ? ok : fail)(
      "【184】交给 Agent 选择器里有专家召唤（视频制作专家团 / 生图专家——没这俩选项就没闭环）"
    );
    (readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8").includes('startTeamSession({ teamId, task: text') ? ok : fail)(
      "【184】召唤走 teams:start-session（task 直接进团队会话，不是塞输入框）"
    );
    (readFileSync(join(ROOT, "electron", "expert-teams", "07-team-default.ts"), "utf8").includes("imageGenExpert(mk)") ? ok : fail)(
      "【184】生图专家已注册进默认专家团清单（清单里没有 = 选择器召唤会报未知 teamId）"
    );
    (canvas184.includes("? 0.62 : MIN_ZOOM") ? ok : fail)(
      "【184】适配最小缩放 0.62（⛔ 0.38 会把 12.5px 卡片字缩成 ~5px——「卡片文字糊」的主因）"
    );
  }

  /* ══ 【185】备份页「选择会话导出」（09-27：勾选任意多条一次导出） ══ */
  {
    const backup185 = readFileSync(join(ROOT, "src", "features", "settings-backup", "BackupSettingsSection.tsx"), "utf8");
    (backup185.includes("void exportThreadsMarkdown(picked)") && backup185.includes("void exportThreadsBackup(picked)") ? ok : fail)(
      "【185】选择器勾的 id 数组要真的传进导出函数（⛔ 两张卡各自为政 = 勾了白勾）"
    );
    (/backup-picker-search/.test(backup185) && /onChange=\{\(e\) => setPickerQuery\(e\.target\.value\)\}/.test(backup185) ? ok : fail)(
      "【185】选择器带搜索框（会话多了之后没有搜索的勾选列表没法用）"
    );
    (/allVisiblePicked/.test(backup185) && /取消全选/.test(backup185) ? ok : fail)(
      "【185】全选只作用于当前可见集（搜索过滤后全选/取消全选不能误伤被过滤掉的勾选）"
    );
  }

  /* ══ 【186】archkit 收尾：5 型图齐 + delta 对比 + visual-check 门禁（09-27） ══ */
  {
    const model186 = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-model.mjs")).href);
    const render186 = await import(pathToFileURL(join(ROOT, "src", "lib", "archkit-render.mjs")).href);
    // ① 5 型白名单真跑
    (model186.archkitNormalizeDiagram({ type: "dataflow", nodes: [{ id: "p" }], edges: [] }).ok
      && model186.archkitNormalizeDiagram({ type: "lifecycle", nodes: [{ id: "idle" }], edges: [{ from: "idle", to: "idle", label: "tick" }] }).ok ? ok : fail)(
      "【186】真跑：dataflow / lifecycle 归一通过（5 型图齐；lifecycle 自环转移合法）"
    );
    // ② delta 真值表
    const oldD = model186.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a", kind: "module", label: "A" }, { id: "b", kind: "module", label: "B" }], edges: [{ from: "a", to: "b" }] }).diagram;
    const newD = model186.archkitNormalizeDiagram({ type: "architecture", nodes: [{ id: "a", kind: "module", label: "A2" }, { id: "c", kind: "entry", label: "C" }], edges: [{ from: "a", to: "c" }] }).diagram;
    const d186 = model186.archkitDelta(oldD, newD);
    (JSON.stringify(d186.added) === '["c"]' && JSON.stringify(d186.removed) === '["b"]' && JSON.stringify(d186.changed) === '["a"]' ? ok : fail)(
      "【186】真跑：delta 增/删/改判定（按 id 对齐；changed = 同 id 内容变化）"
    );
    (() => { try { model186.archkitDelta(oldD, model186.archkitNormalizeDiagram({ type: "sequence", nodes: [], edges: [] }).diagram); fail("【186】跨 type delta 竟然没抛错"); } catch (e) { return /同型/.test(e.message) ? ok("【186】真跑：跨 type delta 抛错（架构图 vs 时序图没有可比性）") : fail("【186】跨 type 报错文案不对：" + e.message); } })();
    // ③ 渲染：lifecycle 圆环 / delta 面板 / 无 delta 不带面板
    (render186.archkitRender(model186.archkitNormalizeDiagram({ type: "lifecycle", nodes: [{ id: "idle" }, { id: "running" }], edges: [{ from: "idle", to: "running", label: "start" }] }).diagram).includes("k-state") ? ok : fail)(
      "【186】lifecycle 渲染出状态卡（圆环布局 + 状态配色）"
    );
    (render186.archkitRender(newD, { delta: d186 }).includes("delta-panel") && !render186.archkitRender(newD).includes("delta-panel") ? ok : fail)(
      "【186】delta 面板只在传 delta 时渲染（普通渲染输出必须保持逐字节稳定）"
    );
    // ④ visual-check 门禁：electron 启动前必须清 ELECTRON_RUN_AS_NODE / NODE_OPTIONS（宿主常带，不清=纯 Node 化）
    const cli186 = readFileSync(join(ROOT, "scripts", "archkit.mjs"), "utf8");
    (/visual-check/.test(cli186) && /delete env\.ELECTRON_RUN_AS_NODE/.test(cli186) && /delete env\.NODE_OPTIONS/.test(cli186) ? ok : fail)(
      "【186】visual-check spawn 前清 ELECTRON_RUN_AS_NODE / NODE_OPTIONS（不清 = electron.exe 退化纯 Node，require('electron') 直接 MODULE_NOT_FOUND）"
    );
    (readFileSync(join(ROOT, ".codex", "skills", "arch-diagram", "SKILL.md"), "utf8").includes("5 型齐") ? ok : fail)(
      "【186】技能文档已更新为 5 型齐（诚实边界清零：dataflow/lifecycle/delta/visual-check 都已落地）"
    );
  }

  /* ══ 【187】排队消息定时发送：主进程定时器 + due 落点 + UI 入口（09-28） ══ */
  {
    console.log(C.bold("\n【187】排队消息定时发送（queue-timer 域）"));
    const timerIpc = codeOnly(readFileSync(join(ROOT, "electron", "features", "queue-timer-ipc.ts"), "utf8"));
    // ① 主进程：定时器本体必须在主进程（渲染层 setTimeout 会被 Chromium 隐藏节流），set 前幂等清理
    // ⛔ 10-03 改插件形态（P0 容器）：注册走 `inject: ["ipc"]` 注入的 ipcHost，不再直接 `ipcMain.handle`。
    //    **断言跟着搬**：锚点换成新形态，但"两个通道都必须注册、且卸载要能摘掉"这条不变量不变。
    (/ipcHost\.handle\("queue-timer:set"/.test(timerIpc) && /ipcHost\.handle\("queue-timer:cancel"/.test(timerIpc)
      && /inject: \["ipc"\]/.test(timerIpc) && /ctx\.effect\(/.test(timerIpc) ? ok : fail)(
      "【187】主进程注册 queue-timer:set / queue-timer:cancel 两个 handler（经容器注入 ipcHost），且卸载可摘"
    );
    (/broadcastToAll\("queue-timer:due", \{ threadId, queuedSubmissionId: id \}\)/.test(timerIpc) && /timers\.delete\(id\);/.test(timerIpc) ? ok : fail)(
      "【187】到点只广播 queue-timer:due、不直接调引擎（启动/钉顶/429 兜底/toast 全在渲染层），广播前消费掉条目（一次性）"
    );
    (/clearTimer\(id\);\s*\n\s*const delay = Math\.max\(0, runAt - Date\.now\(\)\)/.test(timerIpc) ? ok : fail)(
      "【187】set 前先 clearTimer（同一条重复设定时 = 覆盖而不是叠两个 setTimeout）"
    );
    // ② preload：due 订阅 + 类型面
    const preload187 = codeOnly(readFileSync(join(ROOT, "electron", "preload.ts"), "utf8"));
    (/__on\("queue-timer:due"/.test(preload187) ? ok : fail)("【187】preload 手写 onQueueTimerDue 订阅（事件不走 manifest）");
    (/onQueueTimerDue\(listener: \(event: \{ threadId: string; queuedSubmissionId: string \}\) => void\): \(\) => void;/.test(typesSrc) ? ok : fail)(
      "【187】vite-env.d.ts 声明 onQueueTimerDue（渲染层类型面）"
    );
    // ③ 渲染层落点：due 处理按 threadId 定位（⛔ 不认 bag.queue/bag.thread —— 到点的会话可能不是当前会话）
    const appUi = readAppUi();
    const part04c2 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "03-seg", "02-browser-queue-settings.tsx"), "utf8");
    (/const list = await window\.codex\.request\("thread\/queue\/list", \{ threadId, limit: 100 \}\)/.test(part04c2) && /if \(!entry\) return;/.test(part04c2) ? ok : fail)(
      "【187】到点先以引擎队列为准确认条目还在（被删/已被启动 ⇒ 定时自然失效）"
    );
    (/const busy = bag\.runningThreadIdsRef\.current\.has\(threadId\);/.test(part04c2) && /queuedSubmissionIds: \[id, \.\.\.rest\]/.test(part04c2) ? ok : fail)(
      "【187】会话忙 ⇒ 这条 reorder 到队头交给既有的回合结束 auto-start（定时只改时机，不改变排队不打断的约定）"
    );
    (/thread\/queue\/start", \{ threadId, queuedSubmissionId: id \}/.test(part04c2) && /isQueueAlreadyStartedError\(message\)/.test(part04c2) ? ok : fail)(
      "【187】会话空闲 ⇒ thread/queue/start 直接启动 + 引擎竞态（already started）按成功静默"
    );
    (/bag\.armRetryForQueueRelease\(threadId, entry\.input\)/.test(part04c2) && /bag\.armPinForReleasedQueue\(threadId, "queue-timer"\)/.test(part04c2) ? ok : fail)(
      "【187】定时释放与「立即」同待遇：钉顶意图 + 429 兜底都要挂上"
    );
    (/void window\.codex\.queueTimerCancel\(\{ queuedSubmissionId: id \}\)/.test(codeOnly(part04c2).split("async function deleteQueued")[1]?.split("async function reorderQueued")[0] ?? "") ? ok : fail)(
      "【187】删除排队消息时同步取消它的定时（衍生状态一起撤，不能只靠到点 due 兜底）"
    );
    // ④ UI 入口
    const queueUi = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8");
    (/TIMER_PRESET_MINUTES = \[5, 15, 30, 60\]/.test(queueUi) && /取消定时/.test(queueUi) && /type="datetime-local"/.test(queueUi) ? ok : fail)(
      "【187】条目有定时按钮：预设相对时间 + 自定义时间（datetime-local）+ 取消定时"
    );
    (queueUi.includes("window.prompt") ? fail("【187】定时输入不许用 window.prompt（Electron 不支持，实测抛错）") : ok)(
      "【187】定时输入用自建弹层（window.prompt 在 Electron 不可用）"
    );
    const composer187 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8");
    (composer187.includes("timers={queueTimers[thread.id] ?? {}}") && composer187.includes("void setQueuedTimer(thread.id, entry.id, runAt)") ? ok : fail)(
      "【187】composer 把当前会话的定时表传进 QueuedMessageList（徽标渲染的数据面）"
    );
    (/\.queued-timer-menu \{/.test(readStyles()) ? ok : fail)("【187】定时弹层样式已接入（15-queued-messages.css）");
    // ⛔⛔ 09-28 启动崩溃复盘：queueTimers 家族在 bag-types 有声明、tsc/check-bag-types 双绿，
    //    但 part04c2 里 **bag.x = x 镜像赋值行整批漏写** ⇒ 运行时 bag.queueTimers undefined，
    //    对账 effect 挂载即读 undefined[threadId]（uuid 正是 thread.id）⇒ 整个渲染层崩。
    //    判据 = 每个 bag 家族名字的**赋值行**必须存在（类型声明在≠接线在）。
    const part04c2b = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "03-seg", "02-browser-queue-settings.tsx"), "utf8");
    const bagBindings = ["bag.queueTimers =", "bag.setQueueTimers =", "bag.queueTimersLoadedRef =", "bag.persistQueueTimers =", "bag.setQueuedTimer =", "bag.releaseQueuedTimerDue ="];
    (bagBindings.every((binding) => part04c2b.includes(binding)) ? ok : fail)(
      "【187】queueTimers 家族 6 个名字的 bag 镜像赋值行全部在位（缺一个 = 运行时 undefined = 启动崩）"
    );
  }

}


  }
  /* ══ 【231】办公室预览 v18（Kenney CC0 资产版，09-30 用户「用免费的现成的」）════════
     ⛔ 这版推翻了两条旧路线：AI 生图切片（用户「都是截图在动」）与程序化绘制家具
     （用户「摆放丑死了」），改用 **Kenney CC0 资产**（Furniture Kit + Toon Characters，
     官方声明可商用免署名）。本组断言钉的是"再次被否掉的坑"与资产授权。 */
  /* ⛔ 这组断言校验的是 v18（Kenney 版）的实现文件 office-assets.ts —— 09-30 晚该域已重做为
     v19 像素版（office-format.ts），v18 文件不在 ⇒ 跳过（⛔ 别只查目录：目录在、实现换代照样会炸） */
  if (!existsSync(join(ROOT, "src", "features", "team-office", "office-assets.ts"))) {
    /* ⛔⛔ 同上一类：本组断言的是 v18（Kenney CC0 资产版）实现，v19 已换成像素素材版
       ⇒ 文件不在、整组空跑。⛔ 不再静默跳过。 */
    console.log("  ! 【231】断言对象 office-assets.ts 是 v18 实现、v19 已换 ⇒ 本组跳过（⛔ 空跑=假绿，待重写）");
  } else
  {
    const taDir = join(ROOT, "src", "features", "team-office");
    /* ① 资产授权声明：CC0 + 可商用（⛔ 资产来源换成人人无许可的包时必须在这里显红） */
    const assetsSrc = readFileSync(join(taDir, "office-assets.ts"), "utf8");
    (assetsSrc.includes("CC0") && /(commercial|可商用)/.test(assetsSrc) ? ok : fail)(
      "【231】资产索引声明 CC0 + 可商用（换源必须同步声明）"
    );
    /* ② 索引与磁盘**逐个数对账**（索引漂移 = 运行时静默缺件） */
    const fDir = join(taDir, "assets", "kenney", "furniture");
    const pDir = join(taDir, "assets", "kenney", "persons");
    const fCount = readdirSync(fDir).filter((x) => x.endsWith(".png")).length;
    const pCount = readdirSync(pDir).filter((x) => x.endsWith(".png")).length;
    const fRows = (assetsSrc.match(/^  "\S+": f_\S+,$/gm) || []).length;
    const pRows = (assetsSrc.match(/^  "\S+": p_\S+,$/gm) || []).length;
    (fRows === fCount ? ok : fail)(`【231】家具索引数与磁盘一致（${fRows}/${fCount}）`);
    (pRows === pCount ? ok : fail)(`【231】角色索引数与磁盘一致（${pRows}/${pCount}）`);
    /* ③ 资产索引**由生成器产出**（手改会被覆盖；缺生成器 = 下一个人不知道怎么加件） */
    (existsSync(join(ROOT, ".workbuddy", "tmp", "gen-art-kenney.mjs")) ? ok : warn)(
      "【231】资产索引生成器在位（.workbuddy/tmp/gen-art-kenney.mjs）"
    );
    /* ④ 布局单一真相源：格坐标只在 office-scene.ts（渲染层出现 isoPoint(数字) 就是漂移） */
    const sceneSrc = readFileSync(join(taDir, "office-scene.ts"), "utf8");
    const canvasSrc = readFileSync(join(taDir, "OfficeCanvas.tsx"), "utf8");
    (sceneSrc.includes("export const DESKS") && sceneSrc.includes("export const PROPS") ? ok : fail)(
      "【231】工位与静物清单收在 office-scene.ts（单一真相源）"
    );
    (!/\{\s*u:\s*[\d.]+,\s*v:\s*[\d.]+/.test(canvasSrc) ? ok : fail)(
      "【231】渲染层不内联工位/静物布局字面量（一律从 office-scene 取）"
    );
    /* ⑤ 等距资产**不做纵深缩放**（⛔ 缩了桌腿与地板格子就错位 —— v9~v17 的 depthScale 必须不在） */
    (!canvasSrc.includes("depthScale") ? ok : fail)("【231】等距渲染不含 depthScale（缩放会破坏格对齐）");
    /* ⑥ 角色必须在桌子**近端**（v + 正值）：放远端会被桌+显示器整块盖住（实测全看不见） */
    (/isoPoint\(d\.u[^)]*d\.v \+ [\d.]+/.test(canvasSrc) ? ok : fail)(
      "【231】角色/椅子放桌子近端（v + 正值；远端会被桌子挡住）"
    );
    /* ⑦ Pixi v8 必须先 Assets.load 再建场景（⛔ Texture.from(未加载 url) 返回空纹理 = 一片白点） */
    (canvasSrc.includes("await preloadOfficeArt()") ? ok : fail)(
      "【231】资产先预加载再建场景（v8 的 Texture.from 对未加载 URL 返回空纹理）"
    );
    /* ⑧ 入口链路 + bag 镜像赋值（⛔ 09-28 启动崩的形态：类型声明在、赋值行缺） */
    const tlSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    const part02Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "03-thread-switch-update", "02-update-ui-settings.tsx"), "utf8");
    (tlSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)(
      "【231】成员流转轨的「办公室」按钮接到预览状态"
    );
    (appViewSrc.includes("<TeamOfficePreview") && appViewSrc.includes("teamId={app.companyPreviewTeamId}") ? ok : fail)(
      "【231】预览浮层挂在 AppView（显式 props）"
    );
    (part02Src.includes("bag.companyPreviewTeamId =") && part02Src.includes("bag.setCompanyPreviewTeamId =") ? ok : fail)(
      "【231】bag 镜像赋值两行齐（缺一行 = 运行时 undefined）"
    );
    /* ⑨ CSS 三前缀同源 + 入口引用 */
    (existsSync(join(ROOT, "src", "styles", "20-team-office.css")) && readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes("./styles/20-team-office") ? ok : fail)(
      "【231】办公室样式接入 styles.css（20-team-office.css）"
    );
  }

  /* ══ 【232】桌面宠物（09-30）：官方九态格式 / 内置包几何 / CSP 放行 / 接线 ══ */
  {
    const fmtSrc = readFileSync(join(ROOT, "src", "features", "pet", "pet-format.ts"), "utf8");
    const ipcSrc = readFileSync(join(ROOT, "electron", "features", "pet-ipc.ts"), "utf8");
    const winSrc = readFileSync(join(ROOT, "electron", "features", "pet-window.ts"), "utf8");
    const stateSrc = readFileSync(join(ROOT, "electron", "features", "pet-state.ts"), "utf8");
    const genSrc = readFileSync(join(ROOT, "scripts", "gen-pet-spritesheets.mjs"), "utf8");
    const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    const mainEntrySrc = readFileSync(join(ROOT, "src", "main.tsx"), "utf8");
    const htmlSrc = readFileSync(join(ROOT, "index.html"), "utf8");
    const harnessSrc = readFileSync(join(ROOT, "scripts", "e2e", "lib", "harness.mjs"), "utf8");

    /** 官方九态行名（顺序即行序）—— 引擎二进制与 petdex 文档逐字一致的规范。 */
    const OFFICIAL_STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
    const arrayLiteral = (src, name) => {
      const m = src.match(new RegExp(name + "[\\s\\S]{0,40}?=\\s*\\[([\\s\\S]*?)\\]"));
      return m ? (m[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "")) : [];
    };

    /* ① 九态行名与顺序：渲染层 / 主进程 / 生成器 **三处同源**，且都等于官方规范。
       ⛔ 行序就是行号，错一位 = 所有动作错乱（官方按行号取图）。 */
    const renderRows = arrayLiteral(fmtSrc, "PET_STATES");
    const mainRows = arrayLiteral(ipcSrc, "PET_STATE_ROWS");
    const genRows = arrayLiteral(genSrc, "STATE_ROWS");
    (JSON.stringify(renderRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】渲染层九态行名与顺序 = 官方规范（实得 ${renderRows.join("/")}）`
    );
    (JSON.stringify(mainRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】主进程九态行名与顺序 = 官方规范（与渲染层同源；实得 ${mainRows.join("/")}）`
    );
    (JSON.stringify(genRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】生成器九态行名与顺序 = 官方规范（实得 ${genRows.join("/")}）`
    );
    /* ② 生成器必须「缺一行就抛」，否则新格式少一行会静默出一张残图 */
    (genSrc.includes("官方九态缺一不可") && genSrc.includes("ROW_ANIMATION") ? ok : fail)(
      "【232】生成器缺行即抛（不静默出残图）"
    );
    /* ③ 内置宠物：几何自描述 + 图集尺寸 = 8 列 × 9 行 × (192×208)。
       ⛔ 图集现在可能是 WebP（AI 美术管线产出，比 PNG 小 60%）：PNG 读 IHDR、WebP 读 VP8X。 */
    const petSlugs = ["harness-blob", "harness-cat", "harness-bot"];
    const spriteSize = (file) => {
      try {
        const head = readFileSync(file).subarray(0, 33);
        if (head.length < 30) return null;
        if (head[0] === 0x89 && head.subarray(1, 4).toString() === "PNG") {
          return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
        }
        if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP" && head.subarray(12, 16).toString() === "VP8X") {
          return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
        }
        return null;
      } catch { return null; }
    };
    let builtinOk = 0;
    const builtinProblems = [];
    for (const slug of petSlugs) {
      const dir = join(ROOT, "public", "pets", slug);
      try {
        const meta = JSON.parse(readFileSync(join(dir, "pet.json"), "utf8"));
        const sheet = join(dir, String(meta.spritesheetPath || ""));
        const size = spriteSize(sheet);
        const statesOk = JSON.stringify(meta.states) === JSON.stringify(OFFICIAL_STATES);
        const geomOk = meta.columns === 8 && meta.rows === 9
          && meta.frameSize?.width === 192 && meta.frameSize?.height === 208;
        const sheetOk = size && size.width === 8 * 192 && size.height === 9 * 208;
        if (statesOk && geomOk && sheetOk) builtinOk += 1;
        else builtinProblems.push(`${slug}: states=${statesOk} geom=${geomOk} sheet=${size ? `${size.width}x${size.height}` : "缺失/非PNG非WebP"}`);
      } catch (error) {
        builtinProblems.push(`${slug}: ${error.message}`);
      }
    }
    (builtinOk === petSlugs.length ? ok : fail)(
      `【232】内置宠物包几何全部合规（8 列 × 9 行 / 192×208 / 九态；问题：${builtinProblems.join(" | ") || "无"}）`
    );
    /* ④ ⛔ 内置宠物必须落在 public/pets（→ dist/pets），**不能**放 src/：
       before-pack 的可达闭包只认 js/css 与 CSS 里的 url()，JS import 的位图会被判成陈旧死块删掉
       （v0.0.27 事故同型）。dist/pets 不在裁剪面（裁剪只走 dist/assets）。 */
    (genSrc.includes('path.join(ROOT, "public", "pets")') ? ok : fail)(
      "【232】生成物落 public/pets（→ dist/pets，不在 dist/assets 裁剪面内）"
    );
    /* ⑤ ⛔ CSP 必须放行 pet://（09-30 实测踩到：`*` 只覆盖网络协议，自定义协议要显式列，
       不放行 ⇒ 图集被拦、浮窗全透明 0% 不透明像素；与当年 connect-src data: 事故同型） */
    (/img-src[^;]*\bpet:/.test(htmlSrc) ? ok : fail)(
      "【232】CSP 的 img-src 显式放行 pet:（否则图集被拦成空白）"
    );
    /* ⑥ 浮窗必须在**首帧前**摘掉启动页：启动页是不透明白底，晚一步就在桌面上闪一块白 */
    (/data-pet-window[\s\S]{0,24}\.boot-splash[\s\S]{0,60}?display:\s*none/.test(htmlSrc) ? ok : fail)(
      "【232】浮窗首帧前隐藏启动页（防透明窗上的白底闪烁）"
    );
    (htmlSrc.includes('get("pet") === "1"') && htmlSrc.includes("data-pet-window") ? ok : fail)(
      "【232】index.html 内联脚本在首帧前判定 ?pet=1"
    );
    /* ⑦ 入口分流必须在 main.tsx（App() 里条件调用 useHarnessApp 会破坏 hook 调用序） */
    (mainEntrySrc.includes("isPetWindow ? <PetFloat /> : <App />") ? ok : fail)(
      "【232】渲染入口按 ?pet=1 分流（不在 App() 里条件调用 hook）"
    );
    /* ⑧ 浮窗**不登记 window-bus**：登记进去会白收 codex:event 广播，还会被卷进弹窗语义 */
    (!winSrc.includes("registerBusWindow") ? ok : fail)(
      "【232】宠物浮窗不登记 window-bus（它是独立浮层，不是独立会话弹窗）"
    );
    /* ⑨ 对外「open」必须是**可见性**而非「窗口存在」：hide() 不销毁窗口，
       用 isPetWindowOpen 会让设置页在隐藏后仍显示"已显示"（09-30 实测） */
    (winSrc.includes("export function isPetVisible") && ipcSrc.includes("open: isPetVisible()") ? ok : fail)(
      "【232】IPC 的 open 用可见性语义（hide() 后不能仍报已显示）"
    );
    /* ⑩ 图集协议白名单必须**复用 petRoots**（不许另写一份目录 = 真相源分裂） */
    (ipcSrc.includes("export function petAssetRoots") && ipcSrc.includes("petRoots().map") && bootSrc.includes("petAssetRoots()") ? ok : fail)(
      "【232】pet:// 协议白名单来自 petRoots（单一真相源，不另写目录）"
    );
    /* ⑪ 启动恢复 + 事件归约接线（都断了功能就是"开了没反应/宠物不动"） */
    (bootSrc.includes("if (petSettings.enabled) applyPetSettings(petSettings)") ? ok : fail)(
      "【232】启动时按设置恢复宠物窗口"
    );
    (bootSrc.includes("feedPetEvent(event)") ? ok : fail)(
      "【232】引擎事件流喂给宠物归约（不改事件流向、只旁听）"
    );
    /* ⑫ 归约侧：九态全在类型里 + 一次性状态必须回落（庆祝/失败不能永久停住） */
    const stateNames = (stateSrc.match(/export type PetStateName =([\s\S]*?);/) || [, ""])[1];
    (OFFICIAL_STATES.every((s) => stateNames.includes(`"${s}"`)) ? ok : fail)(
      "【232】归约侧九态类型齐全"
    );
    (stateSrc.includes("holdUntil") && stateSrc.includes("pulse(") ? ok : fail)(
      "【232】一次性状态（庆祝/失败）到点回落，不永久停住"
    );
    /* ⑬ ⛔ e2e 必须排除宠物浮窗 target：它也是 page target，
       取 list[0] 会随机连到宠物窗 ⇒ 之后所有 eval/click 全打空（实测设置导航读到 0 项） */
    (harnessSrc.includes('!((t.url || "").includes("pet=1"))') || harnessSrc.includes('!(t.url || "").includes("pet=1")') ? ok : fail)(
      "【232】e2e 连接排除宠物浮窗（否则会随机连错窗口）"
    );
    /* ⑭ 设置页三处注册齐全（类型 / 导航 / 渲染注册表）—— 少一处就是"导航里有、点开空白" */
    const settingsTypesSrc = readFileSync(join(ROOT, "src", "features", "app-view", "types.ts"), "utf8");
    const catalogsSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts"), "utf8");
    const registrySrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    (settingsTypesSrc.includes('| "pet"') ? ok : fail)("【232】SettingsPage 类型含 pet");
    (catalogsSrc.includes('["pet", "桌面宠物"') ? ok : fail)("【232】设置导航含「桌面宠物」入口");
    (registrySrc.includes("PetSettingsSection") && /pet:\s*\{\s*render/.test(registrySrc) ? ok : fail)(
      "【232】设置注册表登记 pet 页"
    );
    /* ⑮ 样式接入（浮窗 + 设置页同一文件，前缀 pet-） */
    (readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes("./styles/22-pet") ? ok : fail)(
      "【232】宠物样式接入 styles.css（22-pet.css）"
    );
  }


  /* ══ 【233】像素办公室（team-office v19）═════════════════════════════
     实现整体删除过一次（用户「太丑了」），重做后按「目录存在才跑」守卫；
     ⛔ 断言钉的都是这轮实测踩过的坑，别删。 */
  if (!existsSync(join(ROOT, "src", "features", "team-office", "office-format.ts"))) {
    /* v19 实现不在（再次下线）⇒ 跳过 */
  } else {
    const fmtSrc = readFileSync(join(ROOT, "src", "features", "team-office", "office-format.ts"), "utf8");
    const simSrc = readFileSync(join(ROOT, "src", "features", "team-office", "office-sim.ts"), "utf8");
    const canvasSrc = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");

    /* ① 精灵格式常量与 MetroCity 图集一致（16×32，7 列；列 6 = 坐姿） */
    (fmtSrc.includes("FRAME_W = 16") && fmtSrc.includes("FRAME_H = 32") ? ok : fail)(
      "【233】精灵帧 16×32（MetroCity CC0 图集网格）"
    );
    (fmtSrc.includes("COL_SIT = 6") ? ok : fail)("【233】坐姿列号 = 6（图集第 7 列）");

    /* ② ⛔ 座位格必须在碰撞图的可走行：桌矩形 y1 只到 8/13（椅行 9/14 留空）。
       座位被挡 ⇒ findPath 返回 null ⇒ 成员永远走不到工位（实测全员困在门口） */
    (/\{ x0: 6, y0: 6, x1: 10, y1: 8 \}/.test(simSrc) && /\{ x0: 19, y0: 11, x1: 23, y1: 13 \}/.test(simSrc) ? ok : fail)(
      "【233】桌碰撞矩形不含椅子行（椅行 9/14 可走）"
    );

    /* ③ ⛔ 门凹龛必须连通房间（col 5 也要开）—— 只开 2-4 会被左墙封死 */
    (simSrc.includes("for (const x of [2, 3, 4, 5]) g[at(x, y)] = 0;") ? ok : fail)(
      "【233】门凹龛连通房间（cols 2-5 × rows 15-18）"
    );

    /* ③b ⛔ 行为模型 = 人人有工位、坐班是常态（09-30 用户纠错：别把没任务的人映射成永久闲逛） */
    (simSrc.includes("坐班是常态") && simSrc.includes("onBreak") ? ok : fail)(
      "【233】坐班常态模型（非 running 也坐工位，闲逛只是短暂休息）"
    );

    /* ③c ⛔ 回工位必须**当场 BFS 重规划**并精确落到座位像素；⛔ 不许回放"来时路线的反向"
     * （10-06 晚逐帧实测：陈旧 homePath 的头是**出发地** ⇒ 人朝饮水机走直线、撞进「桌子行 +
     *  座位格」的夹角 ⇒ 每帧动 0.68px 却从不靠近路点、`path` 一格不减，僵持 1692 秒）。 */
    (simSrc.includes("private headHome") && simSrc.includes("back.push({ x: seat.x, y: seat.y })") && !/\.homePath\s*=/.test(simSrc) ? ok : fail)(
      "【233】回工位当场重规划 + 精确落座（⛔ homePath 已整体删除，不许回放陈旧路线）"
    );
    (simSrc.includes('activity: null | "tea" | "water" | "book"') && simSrc.includes("agent.activity = null") && simSrc.includes("agent.path = []") ? ok : fail)(
      "【233】休息活动（tea/water/book）在 mode 沿清空 + 清在途路径"
    );

    /* ══ 【237】Laya 智能判断（10-01 用户立项）═══════════════════════════
       GitHub NandhaKishorM/laya（Apache-2.0，33ms 非自回归决策引擎）。数据端
       electron/features/laya-service.ts（laya-serve HTTP，Python laya[serve]）。
       首个消费方 = 思考等级「自动」档。⛔ 判断失败必须降级手选档（增强不是依赖）。 */
    const layaSrc = existsSync(join(ROOT, "electron", "features", "laya-service.ts"))
      ? readFileSync(join(ROOT, "electron", "features", "laya-service.ts"), "utf8") : "";
    (layaSrc.includes("127.0.0.1") && layaSrc.includes("LAYA_API_KEY") && layaSrc.includes("hf-mirror.com") && layaSrc.includes("IDLE_EXIT_MS") ? ok : fail)(
      "【237】服务安全与经济性（只绑 127.0.0.1 + API key 鉴权 + 权重走 hf-mirror + 闲置自动退出）"
    );
    (layaSrc.includes('["low", "medium", "high", "xhigh"].includes(choice)') && layaSrc.includes("confidence >= 0.45") ? ok : fail)(
      "【237】effort 判定收口（档位白名单 + 校准置信 <0.45 弃权——低置信硬判不如不判）"
    );
    const sendSrc237 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "02-seg", "send.tsx"), "utf8");
    (sendSrc237.includes("bag.effortAuto") && sendSrc237.includes("resolveAutoEffort") && sendSrc237.includes("effectiveEffort") ? ok : fail)(
      "【237】发送链接入（effortAuto → resolveAutoEffort → effectiveEffort，手选档不被覆盖）"
    );
    const pickerSrc237 = readFileSync(join(ROOT, "src", "components", "EffortPicker.tsx"), "utf8");
    (pickerSrc237.includes("onAutoToggle") && pickerSrc237.includes("自动（Laya 智能判断）") ? ok : fail)(
      "【237】EffortPicker 自动档开关在位（⛔ auto 不进滑块 levels——不污染 effort 值域）"
    );
    const capabilitySrc237 = readFileSync(join(ROOT, "scripts", "gen-capability-skill.mjs"), "utf8");
    (capabilitySrc237.includes('"laya":') ? ok : fail)(
      "【237】能力清单含 laya 域描述（漏了模型就不知道这个能力存在——【153】教训）"
    );
    // 10-01 二补：手动档立即生效 + 升档锚点（模型对「中以上」系统性压缩的实测对策）
    (sendSrc237.includes("manualEffortOverride") && layaSrc.includes("ruleEscalate") ? ok : fail)(
      "【237】手动档一次性覆盖 + 升档锚点（自动模式下手选立即生效；规则命中 0ms 跳过模型）"
    );

    /* ── 【239】插件市场源 = Gitee 官方镜像（10-01 用户定稿：SkillHub 源几乎全为 DSH 生态装不上）──
       三条硬不变量：源指向 Gitee 镜像仓库、旧 SkillHub 插件 API 清零、镜像源插件全兼容
       （清单条目必须有 pluginPath——DSH 探测分支已随换源删除，不许回来）。 */
    {
      const marketSrc = readFileSync(join(ROOT, "electron", "codex-market.ts"), "utf8");
      const plugIpcSrc = readFileSync(join(ROOT, "electron", "features", "plugins-ipc.ts"), "utf8");
      (marketSrc.includes("claude-plugins-official-gitee") && marketSrc.includes("gitee.com/api/v5") ? ok : fail)(
        "【239】插件市场源 = Gitee 官方镜像（claude-plugins-official-gitee，48 个 .claude-plugin 兼容插件）"
      );
      (!/api\.skillhub\.cn\/api\/v1\/plugins/.test(marketSrc) && !/listSkillHubPlugins/.test(plugIpcSrc) ? ok : fail)(
        "【239】SkillHub 插件源清零（API 调用与旧函数名不许回来）"
      );
      (/Gitee 镜像源的插件全部自带 \.claude-plugin\/plugin\.json/.test(plugIpcSrc) ? ok : fail)(
        "【239】DSH 探测分支已删（镜像源 100% 兼容，无需逐仓库探测）"
      );
      /* 10-01 用户：「能不能翻译成中文，英文看不懂」——名称/简介走静态翻译表，
         ⛔ 必须同时锚「表存在」与「映射时真的套用」，只锚表存在会变成恒真。 */
      (/(?:^|\n)\s+"?[\w.-]+"?: \{ name:/.test(marketSrc) && /PLUGIN_ZH\[slug\]/.test(marketSrc) && /zh\?\.name \|\| slug/.test(marketSrc) ? ok : fail)(
        "【239】插件名称/简介中文翻译表在位且映射时套用（PLUGIN_ZH → displayName/description）"
      );
    }

    /* ── 【245】插件市场「已安装」状态必须来自**本地 manifest**（10-03 用户报障：
       装完卡片仍是「+」，「已安装」里也看不到）───────────────────────────────
       根因：判定只依赖引擎 `plugin/list` 的「id@market 前段 === slug」，而引擎可能未认领
       （安装流程自己的提示语就写着「当前列表未返回该插件」）⇒ 永远显示未安装。
       真相源 = 安装时写入市场目录的 `.codex-market.json`（主进程扫目录回传 installed）。 */
    const appUiCode245 = codeOnly(readAppUi());
    const marketSrc245 = codeOnly(readFileSync(join(ROOT, "electron", "codex-market.ts"), "utf8"));
    const marketIpcSrc245 = codeOnly(readFileSync(join(ROOT, "electron", "features", "plugins-ipc.ts"), "utf8"));
    // ⛔ 自读源文件：marketSrc 是【239】块内的局部 const，在块外引用会 ReferenceError
    //   ⇒ 「预检自身异常」会把后面所有断言一起废掉（10-03 实测踩过）。
    (marketSrc245.includes("export function codexMarketDir(") && /const marketDir = codexMarketDir\(codexHome\)/.test(marketSrc245) ? ok : fail)(
      "【245】本地市场目录单一真相源 codexMarketDir()（安装落点与「已装」扫描不许各拼一份路径）"
    );
    (marketSrc245.includes("listInstalledMarketPlugins") && /installed: installedMap\.has\(entry\.slug\)/.test(marketSrc245) ? ok : fail)(
      "【245】市场列表逐项合并本地已装标记（真相源 = .codex-market.json，不靠引擎 plugin/list 的命名巧合）"
    );
    (marketIpcSrc245.includes("installedDir: codexMarketDir(codexHome)") ? ok : fail)(
      "【245】plugins:market-list 必须传 installedDir（不传就退化成只看引擎列表 ⇒ 装完仍显示「+」）"
    );
    (appUiCode245.includes("plugin.installed === true") ? ok : fail)(
      "【245】市场卡片的「已安装」判定读主进程回传的 plugin.installed（引擎 id 比对只作回落）"
    );
    (/installMarketPlugin\(plugin\)[\s\S]{0,400}refreshPluginsPage\(\)/.test(appUiCode245) ? ok : fail)(
      "【245】装完插件必须重拉市场列表（只刷页面资源 ⇒ 卡片停留在旧状态）"
    );

    /* ── 【246】本地已装插件必须能进「已安装」列表并能真卸载（10-03 用户追问后补做）─────
       引擎 plugin/list 有时不认领本地市场插件（安装流程自己会提示「当前列表未返回该插件」），
       于是「装完了但已安装列表里没有、也卸不掉」。两条不变量：
         ① 补齐口径 = 引擎列表 ∪（本地已装 − 引擎已认领），且通道必须**零网络**；
         ② 卸载走本地删除时，目标必须过 safeFolder 归一 + 市场目录内校验（删除是唯一不可逆动作）。 */
    (/(?:ipcMain|ipcHost)\.handle\("plugins:market-installed"/.test(marketIpcSrc245) && marketIpcSrc245.includes("listInstalledMarketPlugins(codexMarketDir(codexHome))") && !/market-installed[\s\S]{0,200}listMarketPlugins\(/.test(marketIpcSrc245) ? ok : fail)(
      "【246】已装清单通道只扫本地目录（走 listInstalledMarketPlugins；误接 listMarketPlugins 会去拉远端 48 个插件）"
    );
    (appUiCode245.includes("localOnly: true") && appUiCode245.includes("engineSlugs.has(row.slug)") ? ok : fail)(
      "【246】「已安装」列表补齐本地已装且不与引擎重复（localOnly 标记 + 引擎 slug 差集）"
    );
    (/if \(plugin\.localOnly && plugin\.marketSlug\)[\s\S]{0,300}uninstallMarketPlugin\(/.test(appUiCode245) ? ok : fail)(
      "【246】localOnly 插件卸载走本地 IPC（引擎 plugin/uninstall 认不出它，绕过去会报 unknown plugin）"
    );
    (marketSrc245.includes("export async function removeCodexMarketPluginFiles(")
      && /target === root \|\| !target\.startsWith\(root \+ path\.sep\)/.test(marketSrc245)
      && marketSrc245.includes("safeFolder(slug)") ? ok : fail)(
      "【246】卸载删除有三重防御（safeFolder 归一 + 必须落在市场目录内 + 不等于根本身）"
    );

    /* ── 【254】Codex 官方插件市场（GitHub openai/plugins，国内镜像）—— 10-03 用户立项 ──────
       「帮我内置国内镜像源到插件列表里面，分好类，加官方插件安装入口，和安装状态反馈和已安装反馈」
       这是**第二个数据源**、独立板块（codex-official-market 前缀），不改 Gitee 源（【239】）一根毛。
       ⛔ 块内一律自读源文件（引用别的块内局部 const = ReferenceError，会把后面所有断言一起废掉）。 */
    {
      const officialSrc = codeOnly(readFileSync(join(ROOT, "electron", "codex-official-market.ts"), "utf8"));
      const officialIpc = codeOnly(readFileSync(join(ROOT, "electron", "features", "codex-official-market-ipc.ts"), "utf8"));
      const officialCatalog = readFileSync(join(ROOT, "electron", "codex-official-catalog.gen.ts"), "utf8");
      (officialSrc.includes('const GH_OWNER = "openai"') && officialSrc.includes('const GH_REPO = "plugins"')
        && officialSrc.includes('".agents/plugins/marketplace.json"') && officialSrc.includes('".agents/plugins/api_marketplace.json"') ? ok : fail)(
        "【254】官方源锚定 GitHub openai/plugins 的 .agents/plugins/{marketplace,api_marketplace}.json（清单形态与上游一致）"
      );
      // 镜像顺序 = 实测可用性（gh-proxy 通、直连兜底）；顺序反了国内首屏就要等三轮超时
      (/const MIRROR_PREFIXES = \["https:\/\/gh-proxy\.com\/", "https:\/\/ghfast\.top\/", ""\]/.test(officialSrc) ? ok : fail)(
        "【254】镜像优先级 gh-proxy → ghfast → 直连（⛔ api.github.com 也走代理：未登录直连限 60 次/小时）"
      );
      (officialSrc.includes("const MAX_FILES = 1_200") && officialSrc.includes("MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024") ? ok : fail)(
        "【254】文件数上限按实测放宽到 1200（上游 zoom 单插件 795 个文件；沿用 Gitee 源的 300 会拒装 4 个合法插件）"
      );
      (officialSrc.includes("export function codexOfficialMarketDir(") && /installedDir: codexOfficialMarketDir\(codexHome\)/.test(officialIpc) ? ok : fail)(
        "【254】官方市场目录单一真相源 + list 必须传 installedDir（同【245】口径，不传就只看引擎列表）"
      );
      // 已装真相源 = 安装时写的 marker；两处（写 / 读）都要在，缺一处就是「装完仍是 +」
      (/\.codex-official\.json/.test(officialSrc) && officialSrc.includes("listInstalledOfficialPlugins")
        && /installed: installedMap\.has\(item\.slug\)/.test(officialSrc) ? ok : fail)(
        "【254】官方插件「已安装」判定读本地 marker .codex-official.json（引擎 plugin/list 不认领时它返空）"
      );
      (/(?:ipcHost|ipcMain)\.handle\("codex-official-market:installed"/.test(officialIpc)
        && officialIpc.includes("listInstalledOfficialPlugins(codexOfficialMarketDir(codexHome))")
        && !/codex-official-market:installed[\s\S]{0,200}listOfficialMarketPlugins\(/.test(officialIpc) ? ok : fail)(
        "【254】官方已装清单通道零网络（走本地扫描；误接 list 会去拉上游 65 条拖慢刷新）"
      );
      // pluginPath 来自渲染层字符串且参与临时目录取值拼接 ⇒ 必须白名单校验（不能靠"大概传不到"）
      (/if \(!\/\^\[\\w\.-\]\+\(\\\/\[\\w\.-\]\+\)\+\$\/\.test\(plugin\.pluginPath\)/.test(officialSrc)
        && officialSrc.includes('plugin.pluginPath.split("/").includes("..")') ? ok : fail)(
        "【254】安装入参 pluginPath 走形态白名单（只允许 plugins/<slug>，含 .. 或以 / 开头一律拒绝）"
      );
      (officialSrc.includes("export async function removeOfficialMarketPluginFiles(")
        && officialSrc.includes("path.resolve(pluginsRootOf(marketDir))")
        && /target === root \|\| !target\.startsWith\(root \+ path\.sep\)/.test(officialSrc)
        && officialSrc.includes("safeFolder(slug)") ? ok : fail)(
        "【254】官方插件卸载同样有三重删除防御（归一 + 必须落在 <市场>/plugins 内 + 点开头目录不碰）"
      );
      (officialIpc.includes("ensureOfficialMarketplaceSection(codexHome)")
        && /marketplacePath: installed\.manifestPath/.test(officialIpc)
        && officialIpc.includes('server.request("plugin/install"') && officialIpc.includes("server.restart()") ? ok : fail)(
        "【254】装完必须注册本地市场段 + plugin/install 传清单**文件**（传目录报 os error 5）+ 重启引擎（照【245】三条实证）"
      );
      (/自动生成，请勿手改/.test(officialCatalog) && /node scripts\/gen-codex-official-catalog\.mjs/.test(officialCatalog) ? ok : fail)(
        "【254】官方文案快照是生成物（头部标记 + 生成器命令都在，别手改 electron/codex-official-catalog.gen.ts）"
      );
      // 上游拉不通时回落内置快照，但**必须带 live=false 让 UI 说明白**（静默冒充实时数据 = 骗人）
      (/manifestCache = \{ at: Date.now\(\), entries, live: false \}/.test(officialSrc) && /live,\n?\s*catalogGeneratedAt/.test(officialSrc) ? ok : fail)(
        "【254】网络失败回落内置快照时回传 live=false + 快照日期（UI 要如实标注，不许冒充实时清单）"
      );
    }

    /* ── 【255】两个市场源在插件页各自成块 + 安装/已装反馈（10-03）──────────────────
       用户拍板：新独立板块（不塞进 plugins 域）· 按源给各自的分类 tab · 同时放出引擎自带的
       openai-api-curated 官方卡片。三条都各有断言，防止下一轮"顺手合并成一个列表"。 */
    {
      const officialUiSrc = readFileSync(join(ROOT, "src", "features", "codex-official-market", "CodexOfficialMarketSection.tsx"), "utf8");
      const officialUiCode = codeOnly(officialUiSrc);
      const officialIpc255 = codeOnly(readFileSync(join(ROOT, "electron", "features", "codex-official-market-ipc.ts"), "utf8"));
      const pluginsPageCode = codeOnly(readFileSync(join(ROOT, "src", "features", "settings-plugins", "PluginsMarketSection.tsx"), "utf8"));
      const appUiCode255 = codeOnly(readAppUi());
      (officialUiCode.includes("export function CodexOfficialMarketSection(") && officialUiCode.includes("useState(")
        && !/\bbag\./.test(officialUiCode) ? ok : fail)(
        "【255】官方市场板块自包含（本地 state，不进 bag —— 装进度/分页/搜索只有本页消费）"
      );
      (pluginsPageCode.includes("<CodexOfficialMarketSection") && /marketSource === "official"/.test(pluginsPageCode)
        && /label: "Claude 插件镜像"/.test(pluginsPageCode) && /label: "Codex 官方插件"/.test(pluginsPageCode) ? ok : fail)(
        "【255】插件页有源切换，两个源各渲染各的块（分类表 8 类 / 10 类不混排 —— 用户拍板按源给 tab）"
      );
      (/window\.codex\.listOfficialMarketCategories\(\)/.test(officialUiCode) ? ok : fail)(
        "【255】官方分类 tab 读上游清单（主进程现算 10 类含数量），不许在 catalogs.ts 里再硬编码一份"
      );
      (officialIpc255.includes('type: "official-plugin-install"') && /event\?\.type !== "official-plugin-install"/.test(officialUiCode) ? ok : fail)(
        "【255】安装进度事件独立 type（⛔ 不许与 Gitee 源共用 plugin-install：两源 slug 有重名 linear/github，会认错插件）"
      );
      (officialUiCode.includes("<PluginInstallModal") && officialUiCode.includes("STAGE_POSITIONS") ? ok : fail)(
        "【255】安装中有六步弹层（复用 PluginInstallModal，同一套 DOM/CSS，装了看不到进度=没有反馈）"
      );
      /* ⛔ 10-08 收口（行为已按 10-06 用户定案变更）：本页不再显示已安装项，
         页内两段式确认条（confirmSlug / uninstallPlugin）随之删除 —— 卸载统一在「已安装」屏
         走 openAppConfirm 确认框（全局模态层级另有【227】钉）。本条改为**负向**：
         旧的页内两段式确认条不许复活，且本页必须真的隐藏已装项。 */
      (!officialUiCode.includes("confirmSlug") && officialUiCode.includes("if (installed) return null") ? ok : fail)(
        "【255】官方市场页不显示已安装项（10-06 定案）；页内两段式确认条（confirmSlug）不许复活 —— 卸载统一在「已安装」屏走确认框"
      );
      /* ⛔ 10-08 收口：官方市场来源的插件卸载**必须走专用通道**。半成品把卸载统一收进 changePlugin 后，
         官方插件只调了引擎 plugin/uninstall —— 落盘目录与 `.agents/plugins/marketplace.json` 条目没清；
         而官方市场页按「扫本地目录」判已装、又隐藏已装项 ⇒ 两处都没入口、磁盘却还在（幽灵残留）。
         判据锚**调用接线**（剥注释后仍出现该 API 调用），不是"常量存在"。 */
      ((() => {
        const seg05 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8"));
        return seg05.includes("window.codex.uninstallOfficialMarketPlugin(") && /marketplaceName/.test(seg05) && /codex-official/i.test(seg05);
      })() ? ok : fail)(
        "【255】官方市场插件卸载走专用通道（changePlugin /codex-official/i 分支调 uninstallOfficialMarketPlugin —— 只调 plugin/uninstall 会漏删落盘目录 + marketplace 清单条目）"
      );
      (officialUiCode.includes("!live &&") && officialUiCode.includes("codex-official-market-error") ? ok : fail)(
        "【255】快照模式与加载失败都在 UI 上明说（⛔ 静默空列表会被当成「官方源没有插件」）"
      );
      // 每张卡片必须写清「还要配什么」：官方 65 条全部要鉴权（ON_INSTALL 58 / ON_USE 7），15 条还要 ChatGPT 连接器
      (officialUiCode.includes("{plugin.authNote}") && /authNote: /.test(codeOnly(readFileSync(join(ROOT, "electron", "codex-official-market.ts"), "utf8"))) ? ok : fail)(
        "【255】卡片带鉴权提示 authNote（装了不等于能用；「已安装」不能骗人）"
      );
      (!/\.filter\(\(marketplace: any\) => marketplace\.name !== "openai-api-curated"\)/.test(appUiCode255)
        && /\.flatMap\(\(marketplace: any\) => \(marketplace\.plugins \?\? \[\]\)/.test(appUiCode255) ? ok : fail)(
        "【255】openai-api-curated 整源过滤已按用户改判删除（引擎自带的官方市场卡片要放出来）"
      );
      (/if \(!plugin\.installable \|\| installing\) return;/.test(officialUiCode) ? ok : fail)(
        "【255】外部仓库源（3 条）不许触发安装（只给查看来源，不给人点了才发现报错）"
      );
      /* ⛔⛔ 10-08 事故（用户实测「装技能/插件报安装失败，其实已经装好了」）：四条安装链
       * （技能市场 / 插件市场 / 官方市场 / 专家市场）最后一步都是 `await server.restart()`，
       * 引擎的**瞬时**启动失败会原样抛出 ⇒ 把已经落盘的安装报成失败（SkillHub「编程专家.Skill」
       * 与 Gitee「Agent SDK 开发套件」两次实测；codex-home/skills 与 plugins/codex-market 里文件都在）。
       * 引擎侧已有自动重试兜底，但重试用尽时**不许**再把「装好了」说成「装失败」——
       * 四条必须降级成 pending 如实告知。判据锚**接线取值**（剥注释后仍出现
       * try{...restart()}catch 的降级写法），不是"文件里出现过 restart"。
       * ⛔ 本段续行一律带 ` * ` 前缀：本文件在【265】棘轮名单里，判据是**净代码行**。 */
      ((() => {
        const chain = ["skills-ipc.ts", "plugins-ipc.ts", "codex-official-market-ipc.ts", "expert-market-ipc.ts"]
          .map((name) => [name, join(ROOT, "electron", "features", name)]);
        const missing = chain
          .filter(([, file]) => !/try \{ await server\.restart\(\); \} catch/.test(codeOnly(readFileSync(file, "utf8"))))
          .map(([name]) => name);
        if (missing.length) console.log(`      未降级的安装链：${missing.join(" / ")}`);
        return missing.length === 0;
      })() ? ok : fail)(
        "【255】四条安装链都不让「引擎重启失败」变成「安装失败」（文件已落盘 ⇒ 必须降级为 pending 如实告知）"
      );
      // 板块三前缀同源：目录名 = IPC 前缀 = CSS 类前缀，且 CSS 独立成文件（不许塞进别人的分节尾部）
      (/\.codex-official-market/.test(readFileSync(join(ROOT, "src", "styles", "25-codex-official-market.css"), "utf8"))
        && readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes('./styles/25-codex-official-market') ? ok : fail)(
        "【255】官方市场样式独立分节 25-codex-official-market.css 且已进 barrel（类前缀 = 域 id）"
      );
    }

    /* ③c 坐姿打字微动画 = 图集两个坐姿变体交替（cols 5/6） */
    (fmtSrc.includes("SIT_FRAMES = [5, 6]") && canvasSrc.includes("SIT_FRAMES[") ? ok : fail)(
      "【233】坐姿用双帧变体交替（打字微动画）"
    );

    /* ③d ⛔ 坐姿锚点从椅背顶推导 + 椅背重贴：人不抬高看不清谁坐在哪、不重贴就是人物挡住椅子。
       ⛔ 锚**per-seat backrest**（10-01 实测：两排椅子相对座位高度差 25px，统一公式/常量
       必然弄错一排——上排人物整个被盖掉「头都没了」）。 */
    /* ⛔ 锚「坐姿分支取 per-seat 偏移 − 31」，不锚换行（10-06 拆行后旧字面量匹配假红）。 */
    (/const dy = a\.action === "sit"\s*\?\s*Math\.round\(a\.y \+ r\.dy - 31\)/.test(canvasSrc) ? ok : fail)(
      "【233】坐姿锚点从椅背顶推导（人物顶 = 椅背顶 - 31，两排自适应）"
    );
    (canvasSrc.includes("SEATS[a.seatIndex]?.backrest") && canvasSrc.includes("ctx.drawImage(bg, a.x + r.dx") ? ok : fail)(
      "【233】坐姿画完重贴椅背矩形（人坐进椅子，不是挡住椅子；矩形按座位实测值）"
    );

    /* ⑤ 渲染必须关平滑（像素风最近邻放大）+ 资产走 Vite import（可达闭包，别回 public/） */
    (canvasSrc.includes("imageSmoothingEnabled = false") ? ok : fail)(
      "【233】canvas 关像素平滑（否则像素被拉糊）"
    );
    (canvasSrc.includes('from "./assets/bg.webp?inline"') && canvasSrc.includes("assets/chars/char_0.png") ? ok : fail)(
      "【233】办公室资产走 Vite import（打包可达闭包内；bg 必须 ?inline —— 80KB 超内联阈值，拆文件 = 构建版白底）"
    );

    /* ⑥ 事件驱动边界：域不订阅引擎、不开 IPC —— 状态只从 props 进（架构规则 §2.2） */
    (!/ipcRenderer|window\.codex\./.test(simSrc) ? ok : fail)(
      "【233】sim 不碰 IPC（状态一律由宿主 props 传入）"
    );
    (canvasSrc.includes("membersRef") ? ok : fail)(
      "【233】成员状态经 ref 进渲染循环（props 变化即画面变化 = 事件驱动落点）"
    );

    /* ⑦ 入口三件套：按钮回调接通 / bag 状态在 / AppView 挂载 */
    const timelineSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    (timelineSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)(
      "【233】办公室按钮接通（不再留 TODO 空实现）"
    );
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (appViewSrc.includes("from \"../team-office\"") && appViewSrc.includes("<TeamOfficePreview") ? ok : fail)(
      "【233】AppView 挂载办公室浮层"
    );
  }


  /* ══ 【234】个性化皮肤已删（10-01 用户：「把这个个性化皮肤删了，保留组件库」）═════════
     09-30 深夜首版（单品散绑）→ 10-01 套装化 → 当天用户要求整体删除。组件库（【235】）
     保留并继承全部数据面（gz / catalog.gen / SkinHost / ingest）。本块 = 负向断言防复活：
     ⛔ 这些文件不许回来；换肤接线点（ToggleSwitch/Spinner 的 skin 分支）不许回来。 */
  {
    const skinGone = ["src/features/ui-skin", "src/features/settings-ui-skin", "src/lib/ui-skin/store.ts", "src/lib/ui-skin/packs.gen.ts", "src/hooks/use-skin-binding.ts"];
    const leftovers = skinGone.filter((rel) => existsSync(join(ROOT, rel)));
    (leftovers.length === 0 ? ok : fail)(`【234】皮肤文件已删净（残留：${leftovers.join(", ") || "无"}）`);

    const widgetsSrc234 = readFileSync(join(ROOT, "src", "components", "SettingsWidgets.tsx"), "utf8");
    const cardShellSrc = readFileSync(join(ROOT, "src", "components", "CardShell.tsx"), "utf8");
    (!widgetsSrc234.includes("useSkinBinding") && !cardShellSrc.includes("useSkinBinding") && !widgetsSrc234.includes("SkinHost") && !cardShellSrc.includes("SkinHost") ? ok : fail)(
      "【234】开关 / 加载器恢复默认渲染（无换肤分支残留）"
    );

    /* ⑧ 开关全仓统一渲染路径（从皮肤块继承，与皮肤无关、独立成立）：
       胶囊开关只许走共享 ToggleSwitch——出现散装实现（label+checkbox 胶囊）= 同类控件两套长相。 */
    const switchScatter = [];
    const scanDirs238 = [join(ROOT, "src", "features"), join(ROOT, "src", "components")];
    const walk238 = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) { walk238(p); continue; }
        if (!ent.name.endsWith(".tsx") && !ent.name.endsWith(".ts")) continue;
        const t = readFileSync(p, "utf8");
        if (t.includes('className="bot-switch') || t.includes('className="auto-switch') || t.includes('className="switch"')) {
          switchScatter.push(relative(ROOT, p));
        }
      }
    };
    for (const d of scanDirs238) walk238(d);
    (switchScatter.length === 0 ? ok : fail)(
      `【234】胶囊开关统一走 ToggleSwitch（散装实现清零；命中：${switchScatter.join(", ") || "无"}）`
    );
  }

  /* ══ 【235】Uiverse 组件库（10-01：独立设置页 + 引擎查询工具）═══════════════
     与【234】同数据源（src/lib/ui-skin/data/*.gz，单一真相源）：皮肤管换肤，这里管浏览取码。
     引擎侧 = 内置 MCP（harness-dispatch）的 ui_component_search / ui_component_get 两工具。 */
  {
    const libSrc = existsSync(join(ROOT, "electron", "features", "uiverse-library.ts"))
      ? readFileSync(join(ROOT, "electron", "features", "uiverse-library.ts"), "utf8") : "";
    (libSrc.includes('path.join(appPath, "dist", "assets")') && libSrc.includes('path.join(appPath, "src", "lib", "ui-skin", "data"') ? ok : fail)(
      "【235】数据端双路定位（构建产物 dist/assets 前缀匹配 + dev 源文件回落；单一真相源不复制第二份）"
    );

    /* ① MCP 工具定义 + 执行端接线（⛔ 各自锚定，不串固定窗口） */
    const dispatchCoreSrc = readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8");
    (dispatchCoreSrc.includes('"ui_component_search"') && dispatchCoreSrc.includes('"ui_component_get"') ? ok : fail)(
      "【235】MCP 工具定义在位（dispatchMcpTools 含 search + get 两件）"
    );
    const dispatchRpcSrc = readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8");
    (dispatchRpcSrc.includes('from "./uiverse-library"') && dispatchRpcSrc.includes('name === "ui_component_search"') && dispatchRpcSrc.includes('name === "ui_component_get"') ? ok : fail)(
      "【235】执行端接线（dispatch-rpc 两分支真调 uiverseSearch/uiverseGet）"
    );

    /* ② 指令常驻（⛔ 锚 text += 接线；模型不知道工具存在 = 白配） */
    const devInstrSrc = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
    (devInstrSrc.includes("UI_COMPONENT_INSTRUCTIONS") && /text \+= UI_COMPONENT_INSTRUCTIONS;/.test(devInstrSrc) ? ok : fail)(
      "【235】developer_instructions 常驻第 12 条（写前端先查库；接线在 buildDevInstructions）"
    );

    /* ③ 独立设置页三件套（注册表 / 类型 / 导航）+ 帮助总览 + 域页面在位 */
    const registrySrc235 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    const typesSrc235 = readFileSync(join(ROOT, "src", "features", "app-view", "types.ts"), "utf8");
    const catalogsSrc235 = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts"), "utf8");
    const helpSrc235 = readFileSync(join(ROOT, "src", "components", "HelpDialog.tsx"), "utf8");
    (registrySrc235.includes('"component-library"') && typesSrc235.includes('"component-library"') ? ok : fail)(
      "【235】设置注册表 + 类型含 component-library"
    );
    (catalogsSrc235.includes('"component-library", "组件库"') && helpSrc235.includes("组件库") ? ok : fail)(
      "【235】设置导航含「组件库」+ 帮助总览有该页（守卫【32】同款义务）"
    );
    const compLibSrc = readFileSync(join(ROOT, "src", "features", "component-library", "ComponentLibrary.tsx"), "utf8");
    (compLibSrc.includes("writeClipboard") && compLibSrc.includes("comp-lib-error") && compLibSrc.includes("loadCategory") ? ok : fail)(
      "【235】组件库页：复制走 writeClipboard、加载失败可见（⛔ 不许静默空白）、数据走基座 loadCategory"
    );
  }

}
