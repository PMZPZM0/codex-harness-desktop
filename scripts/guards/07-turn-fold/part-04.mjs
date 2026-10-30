/** 07-turn-fold 第 4/6 段：原 07-turn-fold.mjs L2697–L3653（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：07-turn-fold
 * 分节：【43】（原 L4094–L7963）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  AUTO_CONTINUE_MAX_ATTEMPTS, C, MOOD_HEADING, ROOT, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, codeOnly, composeMoodInstructions, createHash, createRequire, decayMood, emptyMood, existsSync, fail, homedir, isTruncatedEmptyTurn, join, mainSrc, moodBlock, moodSignature, moodTone, normalizeMood, ok, pathToFileURL, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readVoiceSettingsSrc, readdirSync, relative, spawnSync, statSync, turnOutputStats, walk, warn,
} from "../_ctx.mjs";
import { isQueueAlreadyStartedError } from "../../../src/lib/queue-errors.mjs";
import { splitMarkdown, trimInvisibleSpace } from "../../../src/lib/markdown-blocks.mjs";

import { prepMac } from "./00-preamble.mjs";

export async function run() {
{
{
  // ── 【70】模型配置引导（⛔ 10-01 用户定稿：整体删除，首启只弹「开发工具」引导）──────
  //   登录页的快捷配置链路（handleLogin / markModelConfigured / 持久标记）是登录页自己的
  //   能力，必须保留；删除的只是引导弹窗组件、其状态与「一键配好」死链。
  const appSrc70 = readAppUi();
  const cssSrc70 = readStyles();
  (!existsSync(join(ROOT, "src", "components", "ModelSetupGuide.tsx")) ? ok : fail)(
    "【70】ModelSetupGuide 组件文件已删除（不留死文件）"
  );
  // ⛔ 10-02：必须**大小写不敏感** + 先过 codeOnly。原写法 `/showModelGuide/`（小写、不过滤注释）
  //    会因 setter 的大写 S 而恒真 —— 正是它放过了 send.tsx 里那句「声明已删、调用还在」的悬空调用
  //    （真 bug，未配模型时点发送直接抛错；调用落点检查见 scripts/check-bag-types.mjs）。
  (!/showModelGuide/i.test(codeOnly(appSrc70)) ? ok : fail)("【70】showModelGuide 全仓清零（含 setter；大小写不敏感 + 剥注释）");
  (!/async function quickSetup\(/.test(appSrc70) ? ok : fail)("【70】quickSetup 死链已删（只喂引导弹窗的链路）");
  (/MODEL_CONFIGURED_KEY/.test(appSrc70) && /markModelConfigured/.test(appSrc70) ? ok : fail)(
    "【70】登录页配置链路与「已配置过」持久标记保留"
  );
  (/\["model", "模型"/.test(readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts"), "utf8")) ? ok : fail)(
    "【70】设置页导航里仍有「模型」页（引导删掉后的常驻入口）"
  );
  (!/deferredByModel/.test(appSrc70) ? ok : fail)("【70】「没配模型推迟体检」的旧语义已随引导删除（不许回来）");
  // 引导专属样式不残留（⛔ 锚选择器形态而不是裸词，注释提到类名会自红）
  (!/\.model-guide-tabs\s*\{/.test(cssSrc70) ? ok : fail)("【70】引导专属样式已随组件删除（不留死样式）");
}
}

{
{
  // ── 【71】会话血缘：删源不得拖死子会话；已断链的必须自愈 ────────────────────
  //   09-19 用户事故：「我归档会话，提示 invalid paginated history lineage … missing source
  //   rollout，会话都没法选择了」。根因：旧版删会话时把**子会话依赖的源 rollout** 一起删了，
  //   而 fork/接力出来的子会话首行记着 `forked_from_id` → 引擎沿血缘回读源文件 → 找不到 →
  //   整个会话打不开。用户的原话是要「从根上修掉」且「会话必须独立」。
  const workerSrc71 = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
  const poolSrc71 = readFileSync(join(ROOT, "electron", "rollout-pool.ts"), "utf8");
  const mainSrc71 = readMainSource();
  // ① 删之前先算依赖：被别的会话依赖的源文件**必须保留**
  (/function collectLineage\(root\)/.test(workerSrc71) ? ok : fail)(
    "【71】purge 前先收集血缘依赖（collectLineage）"
  );
  (/const dependents = \(deps\.get\(match\[1\]\.toLowerCase\(\)\) \|\| \[\]\)\.filter\(\(item\) => !ids\.has\(item\.childId\)\);/.test(workerSrc71) ? ok : fail)(
    "【71】删除对象被别的活着的会话依赖时不算可删（整批一起删的子会话除外）"
  );
  (/if \(dependents\.length\) \{[\s\S]{0,200}?kept\.push\(/.test(workerSrc71) ? ok : fail)(
    "【71】有依赖者的 rollout 走 kept（保留）而不是 unlink"
  );
  (/if \(!ids\.size\) return \{ removed, failed, kept \};/.test(workerSrc71) ? ok : fail)(
    "【71】purge 返回值带 kept（调用方才能感知「被有意保留」）"
  );
  // ② 主进程必须把"保留"告诉用户/日志，不能静默
  (/if \(result\?\.kept\?\.length\) \{/.test(mainSrc71) ? ok : fail)(
    "【71】删除后被保留的 rollout 有显式日志（不静默）"
  );
  // ③ 已写坏的（源已丢）要自愈：摘掉血缘字段 + 备份原首行（可回滚）
  // ⛔ 必须含 history_base —— 它才是引擎真正读的血缘载体（09-19 实测：只摘 forked_from_id
  //   那组时文件层面看着"已自愈"，引擎照样报 missing source rollout，白跑两轮真机验证）。
  (/"history_base"\]/.test(workerSrc71) && /const LINEAGE_KEYS = \[[^\]]*"forked_from_id"[^\]]*\]/.test(workerSrc71) ? ok : fail)(
    "【71】血缘字段表含 history_base（引擎报错指的就是它的 thread_id）"
  );
  (/meta\.history_base\?\.thread_id/.test(workerSrc71) ? ok : fail)(
    "【71】依赖判定也认 history_base.thread_id（否则删源守卫仍漏判）"
  );
  // ⛔ review 抓出的两处：① 改写必须**原子替换**（写坏 = 会话历史损坏，比"打不开"更糟）；
  //   ② 自愈是 await 在启动链上的 ⇒ 必须有超时，worker 卡住不能把启动拖死。
  (/const tmpFile = `\$\{file\}\.heal\.tmp`;[\s\S]{0,160}?renameSync\(tmpFile, file\);/.test(workerSrc71) ? ok : fail)(
    "【71】自愈改写走「写临时文件 → rename」原子替换（避免半截 JSONL 毁掉会话历史）"
  );
  (/\{ healed: \[\], failed: \[\], timedOut: true \}/.test(mainSrc71) ? ok : fail)(
    "【71】血缘自愈带 5s 超时降级（await 在启动链上，不能拖死启动）"
  );
  (/for \(const key of LINEAGE_KEYS\) delete meta2\[key\];/.test(workerSrc71) ? ok : fail)(
    "【71】自愈时按表摘血缘字段（不是只删一个，避免漏摘导致仍打不开）"
  );
  (/writeFileSync\(`\$\{file\}\.lineage\.bak`, backupFirst, "utf8"\);/.test(workerSrc71) ? ok : fail)(
    "【71】自愈前备份原首行（.lineage.bak，可人工回滚）"
  );
  (/msg\.op === "healLineage"/.test(workerSrc71) ? ok : fail)(
    "【71】worker 暴露 healLineage 命令"
  );
  (/export function healRolloutLineageAsync\(codexHome/.test(poolSrc71) ? ok : fail)(
    "【71】主进程侧封装 healRolloutLineageAsync"
  );
  // ⛔ 必须 **await** 且在 `server.start()` **之前** —— 引擎一起来就把血缘读进内存，
  //   之后再改文件**同一次运行内不生效**（09-19 实测：文件已自愈但 resume 仍报 missing
  //   source rollout，必须重启才好）。位置写错 = 这个功能对"当前这次启动"完全无效。
  const healIdx = mainSrc71.indexOf("await healRolloutLineage();");
  const startIdx = mainSrc71.indexOf("await server.start();");
  (healIdx >= 0 && startIdx >= 0 && healIdx < startIdx ? ok : fail)(
    "【71】血缘自愈在 server.start() 之前 await（引擎起来后再改同一次运行内不生效）"
  );
  // ④ 自愈必须幂等：只处理「有血缘 + 源不在」的，别动正常会话
  (/if \(!meta\.parentId \|\| known\.has\(meta\.parentId\) \|\| !meta\.hasLineage\) continue;/.test(workerSrc71) ? ok : fail)(
    "【71】自愈只碰「源已丢失」的会话（源还在的正常会话不动，幂等）"
  );
}
}

{
{
  // ── 【72】上游协议手动开关（09-19 用户要求：Claude 类通道不认 responses，且自动判定不灵）──
  //   Cloid 等第三方网关常只提供 /v1/chat/completions；引擎只发 Responses ⇒ 由本地协议桥转换。
  //   但旧版桥的模式**恒为 auto**，而 auto 只在 404/405/501 时才切 chat —— 网关若对未知路径
  //   返回 400/401，就判成「端点正常」直接透传 ⇒ 对话失败且看不出原因。所以必须能手动指定。
  const bridgeSrc72 = readResponsesBridgeSource();
  const mainSrc72 = readMainSource();
  const appSrc72 = readAppUi();
  const hookSrc72 = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");

  // ① 模式来自配置，不许恒 auto
  (/const upstreamProtocols = new Map<string, BridgeMode>\(\);/.test(mainSrc72) ? ok : fail)(
    "【72】主进程有「供应商 id → 上游协议」的内存映射"
  );
  (/mode: upstreamProtocols\.get\(id\) \?\? "auto"/.test(mainSrc72) ? ok : fail)(
    "【72】桥注册时 mode 取自配置（不再恒 auto —— 手动指定才能生效）"
  );
  (!/mode: "auto", label: id/.test(mainSrc72) ? ok : fail)(
    "【72】没有残留的硬编码 auto 注册"
  );
  // ② 改设置必须能生效：register 变了要丢旧判定
  (/if \(previous && \(previous\.mode !== target\.mode \|\| previous\.baseUrl !== target\.baseUrl\)\) \{[\s\S]{0,80}?this\.resolved\.delete\(id\);/.test(bridgeSrc72) ? ok : fail)(
    "【72】协议/地址变化时丢掉已解析缓存（否则「改了设置不生效」）"
  );
  // ③ 400 的歧义判定：必须读措辞（只认状态码会误判）
  (/UNSUPPORTED_ENDPOINT_HINT/.test(bridgeSrc72) && /if \(status === 400\) \{/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 走「读响应措辞」判定（不能只看状态码：也可能是参数错误，切了反而更糟）"
  );
  // ④ 判定为「端点正常」时必须**回放**缓冲的响应体（不能吞掉真实报错）
  (/res\.end\(Buffer\.concat\(chunks\)\);/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 判定为端点正常时回放响应体（不吞真实报错）"
  );
  // ⑤ 数据链路：类型 + 保存归一 + 读侧兜底
  (/upstreamProtocol\?: BridgeMode;/.test(mainSrc72) ? ok : fail)("【72】档案类型含 upstreamProtocol");
  (/function normalizeUpstreamProtocol\(value: unknown\): BridgeMode \{/.test(mainSrc72) ? ok : fail)(
    "【72】主进程有协议归一函数（脏值落回 auto）"
  );
  (/const upstreamProtocol = normalizeUpstreamProtocol\(input\.upstreamProtocol \?\? existing\?\.upstreamProtocol\);/.test(mainSrc72) ? ok : fail)(
    "【72】保存时归一并在未传值时沿用旧值"
  );
  (/custom-model:save", async \(_event, input: \{[^}]*upstreamProtocol\?: BridgeMode/.test(mainSrc72) ? ok : fail)("【72】custom-model:save 入参带该字段");
  (/upstreamProtocol: dedupedDraft\.upstreamProtocol \?\? "auto"/.test(hookSrc72) ? ok : fail)(
    "【72】渲染层保存时带上该字段（缺省 auto）"
  );
  // ⑥ 界面入口
  (/<span>上游协议/.test(appSrc72) ? ok : fail)("【72】供应商配置界面有「上游协议」选项");
  (/\{ value: "chat", label: "Chat 兼容/.test(appSrc72) ? ok : fail)("【72】可手动选「Chat 兼容」");
  (/type UpstreamProtocol/.test(appSrc72) ? ok : fail)("【72】界面用类型约束（不是裸字符串）");
  // ⑦ 语义不许与 wireApi 混为一谈（wireApi 是写给引擎的，恒 responses）
  (/wireApi: "responses",/.test(hookSrc72) ? ok : fail)(
    "【72】wireApi 仍恒为 responses（写给引擎；引擎只发 Responses，写 chat 会拒载整份配置）"
  );
  // ⑧ 代码审查（09-19）修的三处 —— 都是"看起来能跑、实际会静默失效"的类型
  //   ① 协议映射必须在引擎起来**之前**预填：bridgeDial 是同步的、读内存表，而引擎起来后
  //      渲染层第一个请求就可能触发 bridgeDial —— 那时表还空 ⇒ 注册成 auto ⇒ 用户配的
  //      「强制 chat」重启后失效（竞态，难复现）。
  const bootSeq72 = mainSrc72.slice(mainSrc72.indexOf("await healRolloutLineage()"), mainSrc72.indexOf("await server.start()"));
  (/await readCustomModels\(\)/.test(bootSeq72) ? ok : fail)(
    "【72】启动链在 server.start() 之前预填「上游协议」映射（否则首个请求可能注册成 auto）"
  );
  //   ② 400 分支定性后必须排空上游响应：只 resolve 不消费会让 socket 长期悬挂，
  //      而 400 正是「网关不配套」的高频路径 ⇒ 泄漏随尝试次数累积。
  (/const verdictOf = \(\) => \(UNSUPPORTED_ENDPOINT_HINT\.test/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 歧义判定抽成单点（不许两处正则各写一遍，会漂移）"
  );
  (/\bup\.resume\(\);\s*\n\s*(?:resolve|finish)\(verdict\)/.test(bridgeSrc72) ? ok : fail)(
    "【72】400 判决后排空上游响应（不排空 = keep-alive 连接悬挂泄漏）"
  );
  //   ③ register 发现目标变化必须丢掉已解析协议（否则「改了设置不生效」且查不出原因）
  (/previous\.mode !== target\.mode \|\| previous\.baseUrl !== target\.baseUrl/.test(bridgeSrc72) ? ok : fail)(
    "【72】桥目标变化时丢弃已缓存的协议判定（mode 或 base_url 变了就重新判定）"
  );
}
}

{
{
  const bridge73 = readResponsesBridgeSource();
  const main73 = readMainSource();
  const app73 = readAppUi();
  const hook73 = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");
  const css73 = readStyles();

  // ① Anthropic 协议档存在且与其它档区分
  (/export type BridgeMode = "auto" \| "responses" \| "chat" \| "anthropic";/.test(bridge73) ? ok : fail)(
    "【73】BridgeMode 含 anthropic 档"
  );
  (/export function toAnthropicRequest\(body: any\): any \{/.test(bridge73) ? ok : fail)(
    "【73】有 Responses → Anthropic Messages 的请求转换（纯函数）"
  );
  (/export class AnthropicStreamTranslator/.test(bridge73) ? ok : fail)(
    "【73】有 Anthropic SSE → Responses SSE 的流式翻译器"
  );
  // ② 协议硬规则：这三条照文档猜必错，必须钉死
  (/type: "tool_use",\s*\n\s*id: item\.call_id/.test(bridge73) ? ok : fail)(
    "【73】function_call → tool_use 且 id 沿用引擎 call_id（自己生成就对不上，工具往返必断）"
  );
  (/type: "tool_result",\s*\n\s*tool_use_id: item\.call_id/.test(bridge73) ? ok : fail)(
    "【73】function_call_output → tool_result 且 tool_use_id 配对"
  );
  (/if \(last && last\.role === role\) last\.content\.push\(\.\.\.blocks\);/.test(bridge73) ? ok : fail)(
    "【73】连续同角色消息合并（Anthropic 要求 strict 交替，不合并会被 400）"
  );
  (/max_tokens: Math\.max\(1, Math\.round\(wanted\)\)/.test(bridge73) ? ok : fail)(
    "【73】max_tokens 必填且被压到上限（引擎的上下文级大值原样透传会被拒）"
  );
  (/input_schema: tool\.parameters/.test(bridge73) ? ok : fail)(
    "【73】tools 用 input_schema（不是 chat 的 function.parameters）"
  );
  (/anthropic-version": ANTHROPIC_VERSION|x-api-key/.test(bridge73) ? ok : fail)(
    "【73】认证头转换：Bearer → x-api-key + 强制 anthropic-version"
  );
  // ③ 请求转换里不许把 system/developer 内容静默丢掉（本轮修过的真 bug）
  (/for \(const block of blocks\) if \(block\.type === "text" && block\.text\) systemChunks\.push\(block\.text\);/.test(bridge73) ? ok : fail)(
    "【73】input 里的 system/developer 内容收集进顶层 system（只 continue 跳过 = 静默丢上下文）"
  );
  // ④ 配置链路贯通（少一层就会「选了但没效果」）
  (/value === "chat" \|\| value === "responses" \|\| value === "anthropic" \? value : "auto";/.test(main73) ? ok : fail)(
    "【73】主进程 normalizeUpstreamProtocol 认 anthropic"
  );
  (/export type UpstreamProtocol = "auto" \| "chat" \| "responses" \| "anthropic";/.test(hook73) ? ok : fail)(
    "【73】渲染层类型含 anthropic"
  );
  (/\{ value: "anthropic", label: "Anthropic（Claude 原生 \/v1\/messages）" \}/.test(app73) ? ok : fail)(
    "【73】供应商配置的下拉里真有这一档（只加类型不加选项 = 用户选不到）"
  );
  // ⑤ 本地模型预设
  (/const LOCAL_MODEL_PRESETS = \[/.test(app73) && /127\.0\.0\.1:11434\/v1/.test(app73) ? ok : fail)(
    "【73】本地模型预设存在（Ollama 11434 为起点）"
  );
  (["11434", "1234", "8000", "8080"].every((port) => app73.includes(`127.0.0.1:${port}/v1`)) ? ok : fail)(
    "【73】覆盖四家常用本地服务端口（Ollama / LM Studio / vLLM / llama.cpp）"
  );
  (!/maxConcurrency: "/.test(app73) ? ok : fail)(
    "【73】⛔ 本地预设不得再带并发档位（并发限制已删，09-25；不许悄悄复活）"
  );
  // 点预设不能改掉已有供应商的身份（改了就是覆盖别人的配置）
  // 点预设不能改掉已有供应商的身份 —— 09-19 改为**更强的保证**：
  // 编辑已保存供应商时整排预设根本不显示（见下条），所以旧的「isNew 判定」断言已失效并删除。
  // ⑥ 说明收进 ? 号
  (/function FieldHelp\(\{ text \}: \{ text: string \}\)/.test(app73) ? ok : fail)(
    "【73】有 ? 说明组件（用户要求：赘述收进 ? 号）"
  );
  (/tabIndex=\{0\}[\s\S]{0,140}?role="note"[\s\S]{0,80}?aria-label=\{text\}/.test(app73) ? ok : fail)(
    "【73】? 图标可键盘访问（只靠 hover 的话键盘用户读不到说明）"
  );
  (!/<p className="provider-form-hint">协议自动适配/.test(app73) ? ok : fail)(
    "【73】协议自动适配的常驻长说明已移除（改由 ? 承载）"
  );
  (/\.field-help-pop \{/.test(css73) ? ok : fail)(
    "【73】? 气泡浮层样式存在（portal 方案，09-20 起取代伪元素）"
  );
  (/\.local-preset-chip \{/.test(css73) ? ok : fail)("【73】本地预设 chip 样式存在");
  // ⑦ 本地服务「无 Key 也能启用」（09-19 代码审查抓到的真 bug）
  //   原逻辑把「无 Key 的第三方供应商」一律存成禁用（防首次安装默认启用），
  //   而本地模型服务本来就不需要 Key ⇒ 配好本地模型却发不出消息且看不出原因。
  (/function isLocalEndpoint\(baseUrl: unknown\): boolean \{/.test(main73) ? ok : fail)(
    "【73】有「本机/内网地址」判定（本地服务无 Key 应可启用）"
  );
  (/localhost" \|\| host === "::1" \|\| host === "0\.0\.0\.0"/.test(main73) ? ok : fail)(
    "【73】判定覆盖 loopback 各写法（127.x / localhost / ::1 / 0.0.0.0）"
  );
  (/\^172\\\.\(1\[6-9\]\|2\\d\|3\[01\]\)\\\./.test(main73) ? ok : fail)(
    "【73】判定覆盖 RFC1918 私网（含 172.16-31 这段，容易漏）"
  );
  // ⛔ 两处必须同源：只改保存侧 → 存成启用却显示停用；只改显示侧 → 界面假启用
  ((main73.match(/!isLocalEndpoint\(/g) ?? []).length >= 2 ? ok : fail)(
    "【73】显示侧（publicCustomModel）与保存侧（custom-model:save）都过同一判定（必须同源）"
  );
  (/provider !== "openai-official" && !isLocalEndpoint\(/.test(main73) ? ok : fail)(
    "【73】公网无 Key 的供应商仍被禁用（不能过度放宽，原意图要保住）"
  );
  // ⑧ 本地预设只在「新建」时显示 + 可取消（09-19 用户反馈）
  //   ① 「应该做新建的时候展示，不能在已配置模型里面还能选，容易误点」
  //   ② 「选中一个没法取消选择」
  // 09-21：块搬到组件后缩进变化，且 tsc 为回调参数补了 `: any` ⇒ 正则容忍两者（判据语义不变）
  (/const editingExisting = Boolean\(editingProvider\)\s*\n\s*\|\| providersList\.some\(\(item(?::\s*any)?\) => item\.provider === customDraft\.provider\);/.test(app73) ? ok : fail)(
    "【73】本地预设只在新建时显示（编辑已保存供应商时不出现，防误点）"
  );
  (!/const isNew = !current\.provider \|\| \/\^custom\\d\*\$\/\.test\(current\.provider\);/.test(app73) ? ok : fail)(
    "【73】预设显隐判定**不得**依赖 provider id 前缀（点了预设 id 会变成 ollama，整排会自己消失）"
  );
  (/if \(current\.baseUrl === preset\.url\) \{/.test(app73) ? ok : fail)(
    "【73】再点同一个预设可取消选择（用户反馈「没法取消」）"
  );
  (/name: current\.name\.trim\(\) === preset\.name \? "" : current\.name,/.test(app73) ? ok : fail)(
    "【73】取消时只回退预设写的值（用户手改过的名称/地址不动）"
  );
  // 取消分支要恢复一个全新的 custom id —— 用语义锚点（真实代码是 new RegExp 模板字符串，
  // 直接锚字面量要嵌套转义，太脆）
  (/if \(current\.baseUrl === preset\.url\) \{[\s\S]{0,400}?custom\$\{Date\.now\(\) % 1000\}/.test(app73) ? ok : fail)(
    "【73】取消时把预设生成的 id 也还原（避免留一个 ollama-2 这种无主 id）"
  );
  // ⑨ 「?」气泡必须走 portal 浮层（09-20 用户：「问好弹窗被左边供应商选项遮住了」）
  //   伪元素方案在 .provider-form（overflow-y:auto）里必被裁：气泡向左伸进 .provider-list 区域
  //   的部分直接消失（实测左边缘 537 < 列表右边界 603），看起来正是「被左边供应商遮住」。
  (/: \{ text: string \}\) \{[\s\S]{0,2600}?createPortal\(/.test(app73) ? ok : fail)(
    "【73】FieldHelp 的气泡走 createPortal 挂 body（伪元素逃不出滚动容器裁剪与层叠上下文）"
  );
  (!/\.field-help::after/.test(css73) ? ok : fail)(
    "【73】不得回退成 .field-help::after 伪元素气泡（09-20 已实锤会被 .provider-form 裁掉）"
  );
  (/\.field-help-pop \{[\s\S]{0,200}?position: fixed;/.test(css73) ? ok : fail)(
    "【73】气泡浮层本体是 position:fixed（fixed 不受祖先 overflow 裁剪）"
  );
  // ⑩ 通知是多条队列（09-20 用户：「会话窗口产生的弹窗相互污染，区分不出来哪个是哪个」）
  //   旧实现 const [notice, setNotice] = useState("") 是单槽：多会话并发来通知时后到的**直接顶掉**先到的。
  // ⛔ 10-03 收窄判据范围：本条针对的是**多会话通知中枢**（app-state 的 setNotice，
  //   它被当 onNotice 传进各域组件、并进它们的 effect 依赖），不是"任何组件都不许有单槽"。
  //   理由：`CodexOfficialMarketSection` 之类**独立设置面板**的单槽是正确语义 ——
  //   它的通知只由"用户点这一页的按钮"产生，不存在并发来源；强行改成队列反而是无意义的复杂度。
  //   ⛔ 判据改为扫真相源（app-state 的通知中枢）而不是聚合面全扫：
  //   否则任何新写一个单槽提示的独立组件都会被当成"回退"，守卫就会被稀释成噪声。
  const noticeHub73 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "02-goal-browser-notice", "02-approval-notice-center.tsx"), "utf8");
  (/const \[notices, setNotices\] = useState</.test(noticeHub73) ? ok : fail)(
    "【73】多会话通知中枢是队列（notices[]）不是单槽 —— 单槽会让并发通知互相顶掉"
  );
  (!/const \[notice, setNotice\] = useState\(""\)/.test(noticeHub73) ? ok : fail)(
    "【73】通知中枢不得回退成单槽 notice useState（多会话并发时会互相覆盖）"
  );
  /* ⛔ 判据别锁死参数/字段清单：10-27 加了第三个可选参 tone（新建任务=蓝 / 中枢=琥珀）
     ⇒ 原来写死 `(text, threadId?)` + `{ id, text, threadId, scope }` 会因为**多一个可选项**假红。
     真契约是「useCallback 稳定引用 + 浮层只留最新一条」⇒ 锚到这两个就够了。 */
  (/const setNotice = useCallback\(\(text: string, threadId\?: string[\s\S]{0,2000}?setNotices\(\[\{ id, text, threadId, scope/.test(app73) ? ok : fail)(
    "【73】setNotice 保持兼容签名与稳定引用（useCallback；空串仍=清空全部），但浮层**只留最新一条**——10-06 用户改口径：「不要一下上下展示好几个通知叠加」，原「推一条入队」的叠加写法已废"
  );
  (/notice-stack/.test(app73) && /\.notice-stack \{/.test(css73) ? ok : fail)(
    "【73】通知渲染仍走 .notice-stack 锚定容器（贴 .settings-modal / main.workspace 各自的锚；容器里恒 1 条，见 11u）"
  );
  (/String\(threadId\)\.replace\(\/-\/g, ""\)\.slice\(-4\)/.test(app73) ? ok : fail)(
    "【73】会话名兜底用 id 后 4 位短码（常量「会话」会让所有未命名会话撞成同一个名字）"
  );
  // ⑪ 弹窗位置跟随来源（09-20 用户：设置页产生的在设置弹窗内居中，对话的在对话区居中）
  (/threadId \? "chat" : \(settingsOpenRef\.current \? "settings" : "chat"\)/.test(app73) ? ok : fail)(
    "【73】通知归属（settings/chat）必须在入队时判定（渲染时再判会串组；带 threadId 恒为对话区）"
  );
  (/selector: "\.settings-modal"/.test(app73) && /selector: "main\.workspace"/.test(app73) ? ok : fail)(
    "【73】两组通知各贴各的锚：设置组贴 .settings-modal、对话组贴 main.workspace"
  );
  // ⑫ 通知中心（09-20 用户：收纳「不在看的会话」的通知 + 徽标 + 分组/已读/批量）
  (/const belongsToOtherThread = Boolean\(threadId && threadId !== threadRef\.current\?\.id\);/.test(app73) ? ok : fail)(
    "【73】中心只收「别的会话」的通知（设置操作提示/复制这类即时反馈无会话归属，收进去是噪音——用户点名纠正）"
  );
  (/scope === "chat" && settingsOpenRef\.current\) return;/.test(app73) ? ok : fail)(
    "【73】设置弹窗开着时对话来源的通知不弹浮层（不准跨对话框展示），静默进中心靠徽标提醒"
  );
  // 09-24：通知中心顶栏入口整块换成历史会话搜索（通知状态机仍在 part02，仅无顶栏入口）；
  // 同一个 portal 坑由新面板继承断言。
  (/chatSearchOpen && createPortal/.test(app73) ? ok : fail)(
    "【73】当前会话搜索面板必须 portal 到 body（.topbar z-index:30 的层叠上下文会把面板盖死——实测 DOM 全绿画面没有）；⛔ 开关必须是 bag.chatSearchOpen 单一真相源（Ctrl+Shift+F 也走它，另立局部 state 会让快捷键只打高亮不出面板）"
  );
  (/notice-center-v1/.test(app73) ? ok : fail)(
    "【73】中心持久化到 localStorage（notice-center-v1，上限 200 条）"
  );
  // ⑬ PATH 漂移检查必须跨平台（09-20 mac 审计抓到的真缺口）
  //   cfgPathLine 是 config.toml 里的 PATH 值：Windows 用 `;` 分隔、mac 用 `:`（path.delimiter）。
  //   写死 `;` 会在 mac 上把整条 PATH 当成一个元素 ⇒ 与 expectedFirst 永不相等 ⇒
  //   **每次启动都误判「安装目录漂移」并整份重写 config.toml**。
  (/cfgPathLine[\s\S]{0,160}?split\(path\.delimiter\)/.test(main73) ? ok : fail)(
    "【73】config.toml 的 PATH 漂移检查用 path.delimiter 切分（写死 ';' 会在 mac 上每次启动误判漂移并重写配置）"
  );
  (!/cfgPathLine\.replace\(\/\\\\\\\\\/g, "\\\\"\)\.split\(";"\)/.test(main73) ? ok : fail)(
    "【73】不得回退成写死分号切分 PATH"
  );
  // ⑭ 工具下载的进度与速度（09-20 用户：「把下载速度显示，和后台下载加一下」）
  //   ⛔ 关键事实：curl 的进度输出在**非 TTY**（我们走管道）下拿不到数据 ——
  //   `--progress-bar` 只吐 `#=#=#` 占位行、默认进度表只在结束时给一行总结。
  //   所以进度与速度**必须靠采样输出文件大小**自己算，不能回退去解析 curl 的输出。
  const instSrc = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  const instNoComment = instSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  (/\$\{speedText\}/.test(instSrc) && /@@SPEED/.test(instSrc) ? ok : fail)(
    "【73】下载脚本上报 @@SPEED（速率 + 已下载/总大小）"
  );
  (!/--progress-bar/.test(instNoComment) ? ok : fail)(
    "【73】不得依赖 curl 进度输出（非 TTY 下它只给占位行/结束总结——曾是进度条一直空的根因）"
  );
  (/setInterval\(\(\) => \{[\s\S]{0,1400}?\}, 500\)/.test(instSrc) ? ok : fail)(
    "【73】按 500ms 采样输出文件大小算百分比与瞬时速度"
  );
  (/const speed = line\.match\(\/\^@@SPEED/.test(main73) ? ok : fail)(
    "【73】主进程解析 @@SPEED 并随 runtime:progress 下发"
  );
  (/runtimeSpeed/.test(app73) ? ok : fail)(
    "【73】渲染层显示下载速度（安装弹窗 / 开发工具页 / 体检弹窗）"
  );
  (/后台运行/.test(app73) ? ok : fail)(
    "【73】安装弹窗支持「后台运行」：未完成也能关，下载继续、完成后再通知"
  );
  // ⑮ ⛔ 撤回记录（09-20 下午用户实测：「钉顶+发送特效你怎么又给我弄没了」）：
  //   12:47 曾加过「短会话内容靠底」= `.timeline { display:flex }` + 首元素 `margin-top: auto`。
  //   真机探针实测它**打坏钉顶**：`.timeline-bottom-spacer` 作为 flex item 的 `flex-shrink` 默认 1
  //   ⇒ 设 300px 只渲染 276px；而钉顶落点公式读的正是 `pad.offsetHeight`（**实际渲染高度**，
  //   见 `scrollHeightNoPad = scrollHeight − pad.offsetHeight`）⇒ 落点永远差一截；
  //   且首元素 auto margin 会把偏移算进 `anchorTopScroll`，与公式打架 ⇒ pad 在 0↔数百 px 振荡。
  //   故守卫改成**反向**：钉顶几何依赖 `.timeline` 的布局模型，不许改成 flex/grid。
  {
    const timelineBlock = (/\.timeline:not\(\.empty-state\)\s*\{([^}]*)\}/.exec(css73) || [])[1] ?? "";
    (!/display:\s*(flex|grid)/.test(timelineBlock) ? ok : fail)(
      "【73】非欢迎页的 timeline 不得是 flex/grid 容器（会压缩底部留白 spacer → 钉顶落点公式失效）"
    );
    // 留白 spacer 的高度必须是**显式 height**：钉顶公式要求它是可预测定值，
    // flex-grow 会让它随剩余空间伸缩（公式里的 pad.offsetHeight 就失去意义）。
    const spacerBlock = (/\.timeline-bottom-spacer\s*\{([^}]*)\}/.exec(css73) || [])[1] ?? "";
    (spacerBlock && !/flex(-grow)?\s*:\s*(1|auto)/.test(spacerBlock) ? ok : fail)(
      "【73】底部留白 spacer 必须用显式 height（不得 flex-grow：钉顶公式按定值算落点）"
    );
    // 撤回原因必须留在样式表里，防止后来者再把「靠底」加回来（这条是真机实测的代价换来的）
    (/已证明会打坏钉顶/.test(css73) ? ok : fail)(
      "【73】样式表保留「timeline 不得改 flex 靠底」的撤回说明（防回退）"
    );
  }
  (/notice-stack-in/.test(css73) ? ok : fail)(
    "【73】堆叠子项必须用自己的入场动画（旧 notice-in 最终帧 translate(-50%) 配 both 会把子项永久左移——靠左 bug 根因）"
  );
}
}

{
{
  const bs74 = readBuiltinSkillsSource();
  const di74 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  const main74 = readMainSource();
  /* 按常量边界切出各自正文（不要用正则非贪婪到 `  ——正文里有转义反引号，容易切错）。
     ⛔ 09-22：技能常量已按技能切到 electron/builtin-skills/**，**拼接顺序不再等于原文件顺序**
     ⇒ 「从 A 到后面的 B」会切出空串（B 在拼接里排在 A 前面）。改成「从该常量到
     **下一个常量或下一段文件头注释**」——与文件怎么切无关，判据语义不变（仍是"切出该技能正文"）。 */
  const cutSkill = (name) => {
    const m = new RegExp("^(?:export\\s+)?const " + name + " =", "m").exec(bs74);
    if (!m) return "";
    const rest = bs74.slice(m.index + m[0].length);
    const nxt = /\n(?:export\s+)?const |\n\/\*\*/.exec(rest);
    return rest.slice(0, nxt ? nxt.index : rest.length);
  };
  // ⛔ 10-22：browser-skill 正文里有 JS 示例（行首 `const task = await ...`），
  //    原来「切到下一个行首 const」的切法会把它拦腰截断 ⇒ 直接从专属文件切到末尾。
  const bSkillFile = readFileSync(join(ROOT, "electron", "builtin-skills", "02-skill-browser.ts"), "utf8");
  const bSkill = bSkillFile.slice(Math.max(0, bSkillFile.indexOf("export const BROWSER_SKILL")));
  const dSkill = cutSkill("DESKTOP_SKILL");
  (bSkill && dSkill ? ok : fail)("【74】能从 builtin-skills.ts 切出两个技能正文（切不出来说明常量被改名/移动）");

  // ① 浏览器技能必须真的讲 ego 通道（10-22 起 ego 优先、playwright-cli 回落）
  (/ego-browser/.test(bSkill) && /taskSpace/.test(bSkill) && /snapshot/.test(bSkill) && /nuphus-call/.test(bSkill) ? ok : fail)(
    "【74】browser-skill 讲清 ego TaskSpace + snapshot + browse-skills 默认浏览器回落"
  );
  (/同一页的多步动作/.test(bSkill) && /page\.evaluate/.test(bSkill) ? ok : fail)("【74】browser-skill 点明批处理与结构化取数的价值");
  (/观察 → 动作 → 验证/.test(bSkill) ? ok : fail)("【74】browser-skill 有「观察 → 动作 → 验证」三段协议");
  // ⛔ 10-12：MCP 工具对模型不可达 ⇒ 技能不再讲「判存在」，讲「ego 优先 + 回落」。
  (/unsupported call/.test(bSkill) && /回落/.test(bSkill) ? ok : fail)("【74】browser-skill 讲明 ego 优先、browse-skills 回落，并禁止直调 MCP browser_*（0.157 起必 unsupported call）");

  // ② 桌面技能：perceive/vision 分工 + 平台降级（Intel Mac 无本地 OCR）
  (/desktop_perceive/.test(dSkill) && /never click with them/.test(dSkill) ? ok : fail)(
    "【74】desktop-skill 写明 perceive 拿坐标、vision 的坐标不可点（工具描述原文警告）"
  );
  (/ONNX Runtime 已放弃 osx-x64/.test(dSkill) ? ok : fail)(
    "【74】desktop-skill 声明 Intel Mac 无本地 OCR（上游放弃 osx-x64，属预期而非故障）"
  );
  (/不可逆动作先问用户/.test(dSkill) ? ok : fail)("【74】desktop-skill 有不可逆动作先问用户的硬约束");

  // ③ 技能停用状态必须被尊重（09-20 修：总闸停用后每次启动被静默写回，总闸形同虚设）
  /* ⛔ 10-06 扩到技能池的 .pool-disabled（同型第二处，真跑实测）：只认 .disabled 且**优先看
   * SKILL.md 在不在** ⇒ 被池停用的技能重启时被写回 SKILL.md（界面说已停用、引擎却在加载）。
   * 判据锚「写入目标停用态优先」+「两种停用名都认」两处**取值形态**，不锚旧的单行三元写法。 */
  (/disabledVariantOf\(dir\) \?\? activeFile/.test(bs74) && /for \(const fn of \[SKILL_FILE_DISABLED, SKILL_FILE_POOL_DISABLED\]\)/.test(bs74) ? ok : fail)(
    "【74】ensureBuiltinSkills 尊重停用态（两种停用名都认 + 写入目标停用态优先，否则用户停用的技能每次启动被写回）"
  );
  (/existing\.replace\(\/\\r\\n\/g, "\\n"\) !== content\.replace\(\/\\r\\n\/g, "\\n"\)/.test(bs74) ? ok : fail)(
    "【74】技能内容比对归一化行尾（否则每次启动都白写一遍盘）"
  );

  // ④ 指令过期判据必须与「写出内容」同源（09-20 修的第二个 bug：旧判据 grep 一句老短语 ⇒ 恒 false）
  //   ⛔ 09-20 二次调整：为了让 nuphus 视觉 env 复用同一份输入，判据改成「先取 devInputNow、再生成整行」。
  //   断言随之改为**抓同源关系**（取值与生成整行用同一个变量）——比锚死一个具体写法耐改，
  //   且比旧版更强：旧版只证明"调了 devInstructionsInput"，新版证明"两次用的是同一份"。
  (/const devInputNow = await devInstructionsInput\(\);[\s\S]{0,140}?developerInstructionsLine\(devInputNow\)/.test(main74) ? ok : fail)(
    "【74】instructionsOutdated 用与写出同源的输入重新生成整行比对"
  );
  (/const instructionsOutdated = !configText\.includes\("Never infer/.test(main74) ? fail : ok)(
    "【74】不得回退成「grep 一句老短语」判断指令是否过期（老配置里本来就有 ⇒ 恒 false ⇒ 升级永不刷新）"
  );
  (/const devInput = await devInstructionsInput\(\)/.test(main74) && /developerInstructionsLine\(devInput\)/.test(main74) ? ok : fail)(
    "【74】applyCustomModel 与漂移判据共用 devInstructionsInput（两边输入不同会恒 true ⇒ 每次启动整份重写）"
  );

  // ⑤ 桌面指令不得只说命令行（否则模型不会直接调已注册的 desktop_* 工具）
  (/are NOT delivered to you/.test(di74) && /nuphus-call <tool> key=value/.test(di74) ? ok : fail)(
    "【74】developer_instructions 明说 MCP 工具**不会**下发给模型、主线是 nuphus-call CLI（10-12 引擎实证）"
  );
  (!/on-demand CLI bridge to desktop automation tools/.test(di74) ? ok : fail)(
    "【74】不得回退成「桌面只有 nuphus-call 命令行」的旧文案"
  );

  // ⑥ 跨平台文案不得写死单一平台的按键（09-20 审查抓到：指令里写死 Ctrl+V，mac 用户照着按必失败；
  //    这条文案是**每次请求都下发**的基础指令，错一次会持续误导）
  (!/Ctrl\+V/.test(bs74 + di74) || /Cmd\+V/.test(bs74 + di74) ? ok : fail)(
    "【74】按键写法不得只写死 Windows（出现 Ctrl+V 就必须同时给出 macOS 的 Cmd+V）"
  );
}
}

{
{
  const req75 = createRequire(import.meta.url);
  let pol = null;
  try { pol = req75(join(ROOT, "dist-electron", "automation-policy.js")); } catch { pol = null; }
  (pol ? ok : fail)("【75】dist-electron/automation-policy.js 可加载（总闸掩码的唯一来源）");

  if (pol) {
    const D = pol.NUPHUS_DESKTOP_TOOLS || [];
    const B = pol.NUPHUS_BROWSER_TOOLS || [];
    (D.length === 22 && B.length === 23 && new Set([...D, ...B]).size === 45 ? ok : fail)(
      `【75】nuphus 工具分组与实测枚举一致（桌面 22 + 浏览器 23 = 45；实际 ${D.length}+${B.length}）`
    );
    (pol.shouldRegisterNuphus({ desktop: false, browser: true })
      && pol.shouldRegisterNuphus({ desktop: true, browser: false })
      && !pol.shouldRegisterNuphus({ desktop: false, browser: false }) ? ok : fail)(
      "【75】nuphus 注册条件是「任一总闸开启」（关桌面不再连带丢掉 browser_* —— 安全边界）"
    );
    const onlyBrowser = pol.nuphusDisabledTools({ desktop: false, browser: true });
    const onlyDesktop = pol.nuphusDisabledTools({ desktop: true, browser: false });
    (onlyBrowser.length === 22 && !onlyBrowser.some((t) => t.startsWith("browser_")) ? ok : fail)(
      "【75】只开浏览器 ⇒ 掩掉整组桌面工具（真实键鼠拿不到）且不误伤 browser_*"
    );
    (onlyDesktop.length === 23 && !onlyDesktop.some((t) => t.startsWith("desktop_")) ? ok : fail)(
      "【75】只开桌面 ⇒ 掩掉整组浏览器工具（浏览器总闸＝硬控制，不再只是提示词）"
    );
    const merged = pol.withNuphusMasksForRules(
      { nuphus: { deny: [], ask: ["desktop_mouse"], allow: ["desktop_screenshot"] } },
      { desktop: false, browser: true },
    );
    (merged.nuphus.deny.includes("desktop_mouse")
      && !merged.nuphus.ask.includes("desktop_mouse")
      && !merged.nuphus.allow.includes("desktop_screenshot") ? ok : fail)(
      "【75】掩码进 deny 并从 ask/allow 摘除（否则同一工具既 disabled 又带 approval_mode，配置自相矛盾）"
    );
    (pol.effectiveNuphusPermission("desktop_mouse", "allow", { desktop: false, browser: true }) === "deny" ? ok : fail)(
      "【75】总闸掩码压过用户显式 allow（关着的组不能被单个工具放行）"
    );
  }

  const main75 = readMainSource();
  (/mcp-servers:permissions[\s\S]{0,700}?withNuphusMasks\(/.test(main75) ? ok : fail)(
    "【75】mcp-servers:permissions 也过掩码（否则界面显示「未设权限」而配置里已被禁用）"
  );
  (/shouldRegisterNuphus\(\{ desktop: desktopAuto, browser: browserAuto \}\)/.test(main75) ? ok : fail)(
    "【75】config.toml 的 nuphus 段用 shouldRegisterNuphus 判注册"
  );
  (/withNuphusMasksForRules\(mcpToolRulesOf\(mcpOverrides\)/.test(main75) ? ok : fail)(
    "【75】掩码并进 mcpToolRules（落成 disabled_tools）"
  );

  const pinOf = (file, re) => { try { return (re.exec(readFileSync(join(ROOT, file), "utf8")) || [])[1] || ""; } catch { return ""; } };
  /* ⛔ 09-24（评估报告 §3.4）：版本常量已收敛到 scripts/lib/tools-versions.cjs（单一来源），
     所以「win 版本常量 / mac npm 安装 / mac manifest」三处不再是字面量，而是从表里取。
     断言跟着搬：前两处改为「该文件确实从单一来源取 nuphus」，第三处改为直接在表里读。 */
  const versions75 = pinOf("scripts/lib/tools-versions.cjs", /nuphus: "([0-9.]+)"/);
  const pins = {
    "版本表": versions75,
    "win 取表": /const NUPHUS_VERSION = TOOLS_VERSIONS\.nuphus;/.test(readFileSync(join(ROOT, "scripts/prepare-windows-tools.cjs"), "utf8")) ? versions75 : "",
    "mac npm 取表": /@nuphus\/nuphus-mcp@\$\{TOOLS_VERSIONS\.nuphus\}/.test(readFileSync(join(ROOT, "scripts/prepare-mac-tools.cjs"), "utf8")) ? versions75 : "",
    "mac manifest 取表": /nuphus: TOOLS_VERSIONS\.nuphus/.test(readFileSync(join(ROOT, "scripts/prepare-mac-tools.cjs"), "utf8")) ? versions75 : "",
    "mac cargo ref": pinOf(".github/workflows/build-mac.yml", /repository: mrpulor-gh\/nuphus-mcp[\s\S]{0,220}?ref:\s*v([0-9.]+)/),
  };
  const uniq = new Set(Object.values(pins));
  (uniq.size === 1 && [...uniq][0] ? ok : fail)(
    `【75】nuphus 版本四处同源（${Object.entries(pins).map(([k, v]) => k + "=" + (v || "缺")).join(" / ")}）`
  );

  const bs75 = readBuiltinSkillsSource();
  const di75 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  (/判存在（必做的第一步）/.test(bs75) ? ok : fail)(
    "【75】desktop-skill 有「判存在」小节（总闸关着时别去调不存在的 desktop_*，也别用命令行绕）"
  );
  (/are NOT delivered to you/.test(di75) && /nuphus-call <tool> key=value/.test(di75) ? ok : fail)(
    "【75】桌面能力改走 nuphus-call CLI（MCP 工具不下发给模型，0.157 起；旧的「看工具表判存在」恒假）"
  );
  // ⛔ 10-12：开关关掉时该段桌面文案根本不注入，禁令改由 AUTOMATION DISABLED NOTE 承载（宿主判据）。
  (/不得用 `nuphus-call` 从命令行绕过/.test(di75) ? ok : fail)(
    "【75】总闸关闭时仍明确禁止命令行绕过（禁令在 AUTOMATION DISABLED NOTE，由宿主按开关下发）"
  );
}
}

{
{
  const req272 = createRequire(import.meta.url);
  const uiaServer = readFileSync(join(ROOT, "resources", "tools", "harness-uia.mjs"), "utf8");
  const uiaBridgeBytes = readFileSync(join(ROOT, "resources", "tools", "desktop-uia.ps1"));
  const uiaBridge = uiaBridgeBytes.toString("utf8");
  const pkg272 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const shipped = (pkg272.build?.extraResources ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.from));
  (shipped.includes("resources/tools/harness-uia.mjs") && shipped.includes("resources/tools/desktop-uia.ps1") ? ok : fail)(
    "【273】控件清单通道的两个脚本都随包（只带 .mjs 不带 .ps1 ⇒ 服务器起得来、每个工具都报找不到脚本）"
  );
  const nonAscii = [...uiaBridgeBytes].filter((byte) => byte > 0x7f).length;
  (nonAscii === 0 && /\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding/.test(uiaBridge) ? ok : fail)(
    `【273】desktop-uia.ps1 纯 ASCII 且强制 UTF-8 输出（GBK 尾字节会吃掉引号/大括号；当前非 ASCII 字节 ${nonAscii} 个）`
  );
  (/(?:^|\n)\s*function Round-Geom/.test(uiaBridge) && /IsInfinity/.test(uiaBridge)
    && (uiaBridge.match(/Round-Geom\(\$r\./g) ?? []).length >= 8 ? ok : fail)(
    "【273】几何坐标过 Infinity 归一（最小化窗口矩形是 Infinity，原样写出就不是合法 JSON）"
  );
  let policy272 = null;
  try { policy272 = req272(join(ROOT, "dist-electron", "automation-policy.js")); } catch { policy272 = null; }
  const mjsTools = [...uiaServer.matchAll(/name: "(desktop_ui_[a-z_]+)"/g)].map((m) => m[1]);
  (policy272 && mjsTools.length === 4 && JSON.stringify([...policy272.HARNESS_UIA_TOOLS].sort()) === JSON.stringify([...mjsTools].sort()) ? ok : fail)(
    `【273】工具名两侧同源（policy.HARNESS_UIA_TOOLS == harness-uia.mjs 的 TOOLS：${mjsTools.join("/") || "解析失败"}）`
  );
  // ⛔ 判据要真跑产物，不看文本：真值表错一格就是「该注册时没注册 / 不该注册时把键鼠交出去了」
  const truth272 = policy272 ? [
    policy272.shouldRegisterUia({ desktop: true, binaryReady: true, platform: "win32" }) === true,
    policy272.shouldRegisterUia({ desktop: false, binaryReady: true, platform: "win32" }) === false,
    policy272.shouldRegisterUia({ desktop: true, binaryReady: false, platform: "win32" }) === false,
    policy272.shouldRegisterUia({ desktop: true, binaryReady: true, platform: "darwin" }) === false,
  ] : [];
  (truth272.length === 4 && truth272.every(Boolean) ? ok : fail)(
    `【273】shouldRegisterUia 真值表（win32 应注册 / 关总闸应不注册 / 缺脚本应不注册 / mac 应不注册）实测 ${truth272.filter(Boolean).length}/4`
  );
  const apply272 = codeOnly(readFileSync(join(ROOT, "electron", "features", "custom-model-apply.ts"), "utf8"));
  (/shouldRegisterUia\(\{ desktop: desktopAuto, binaryReady: Boolean\(uiaServer\) \}\)/.test(apply272)
    && apply272.includes("HARNESS_UIA_MCP_SERVER,") ? ok : fail)(
    "【273】注册处真接线（调 shouldRegisterUia + 服务器名进 ownedMcpServers；漏后者会「保留旧段+新段」写出重复键）"
  );
  (/if \(args\?\.confirm !== true\) return/.test(uiaServer) ? ok : fail)(
    "【273】写操作必须显式 confirm=true（与 nuphus 的 desktop_mouse 同一条口径）"
  );
  (/spawn\(powershell, \[/.test(uiaServer) && !/shell:\s*!0|shell:\s*true/.test(uiaServer) ? ok : fail)(
    "【273】拉起 PowerShell 用参数数组且不开 shell（title/text 是外部输入，拼进命令行就是注入面）"
  );
  // 通道接上但模型不知道 = 白配（09-25「能力可达性」同型教训）：技能与常驻指令两处都要有选路指引
  const skill272 = codeOnly(readBuiltinSkillsSource());
  const di272 = codeOnly(readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8"));
  (skill272.includes("desktop_ui_snapshot") && skill272.includes("desktop_ui_invoke")
    && /Chromium 无障碍默认不展开/.test(skill272) && di272.includes("desktop_ui_*")
    && di272.includes("CHANNEL PRIORITY on Windows") ? ok : fail)(
    "【273】选路指引两处都在（技能讲清「原生用清单 / 网页用 browser_* / 坐标只兜底」，常驻指令给优先级）"
  );
}
}

{
{
  const req274 = createRequire(import.meta.url);
  const versions274 = readFileSync(join(ROOT, "scripts", "lib", "tools-versions.cjs"), "utf8");
  const prepMac = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  const verifyPkg = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  const apply274 = codeOnly(readFileSync(join(ROOT, "electron", "features", "custom-model-apply.ts"), "utf8"));
  const toolchain274 = codeOnly(readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8"));
  (/computerUse: "\d+\.\d+\.\d+"/.test(versions274) && /TOOLS_VERSIONS\.computerUse/.test(prepMac)
    && !/open-computer-use@\d/.test(prepMac) ? ok : fail)(
    "【274】open-computer-use 版本单一来源（表里一处、prepare-mac 从表取；出现第二处字面量即红）"
  );
  (/computerUse: TOOLS_VERSIONS\.computerUse/.test(prepMac) ? ok : fail)(
    "【274】mac 随包清单记了 computer use 版本（缺了就无从核对产物里到底是哪一版）"
  );
  (verifyPkg.includes("open-computer-use") && verifyPkg.includes("没有执行位") && verifyPkg.includes("别的平台的二进制") ? ok : fail)(
    "【274】产物层三条校验在位（主程序存在 + 执行位 + 不许残留 windows/linux 二进制）"
  );
  (/shouldRegisterComputerUse\(\{ desktop: desktopAuto, binaryReady: Boolean\(launcher\) \}\)/.test(apply274)
    && (/COMPUTER_USE_MCP_SERVER,/.test(apply274) && /\.\.\.connectors\.map\(/.test(apply274)) /* 10-13 ownedMcpServers 插入 rea，字面量切片放宽为两端都在 */ ? ok : fail)(
    "【274】注册处真接线（调 shouldRegisterComputerUse + 服务器名进 ownedMcpServers）"
  );
  (/args = \["\$\{escapeToml\(launcher\)\}", "mcp"\]/.test(apply274) ? ok : fail)(
    "【274】args 固定为 [启动脚本绝对路径, \"mcp\"]（上游 MCP 配置就是 command + args:[mcp]，写成裸命令名会静默起不来）"
  );
  (/fs\.existsSync\(launcher\) && fs\.existsSync\(app\)/.test(toolchain274) ? ok : fail)(
    "【274】就绪判据同时看启动脚本与 .app（只装上半截 = MCP 起得来但每次调用都失败）"
  );
  let policy274 = null;
  try { policy274 = req274(join(ROOT, "dist-electron", "automation-policy.js")); } catch { policy274 = null; }
  // ⛔ 真跑：mac 上 nuphus 桌面组必须整组被掩（否则两条键鼠通道并存），浏览器组不受影响
  const macMask = policy274 ? policy274.nuphusDisabledTools({ desktop: true, browser: true }, "darwin") : null;
  const winMask = policy274 ? policy274.nuphusDisabledTools({ desktop: true, browser: true }, "win32") : null;
  (Array.isArray(macMask) && policy274 && macMask.length === policy274.NUPHUS_DESKTOP_TOOLS.length
    && macMask.every((tool) => tool.startsWith("desktop_")) && !macMask.some((tool) => tool.startsWith("browser_"))
    && Array.isArray(winMask) && winMask.length === 0 ? ok : fail)(
    `【274】mac 掩掉 nuphus 桌面组、Windows 一组都不掩（实测 mac=${macMask ? macMask.length : "取不到"} 条 / win=${winMask ? winMask.length : "取不到"} 条）`
  );
  let caps274 = null;
  try { caps274 = req274(join(ROOT, "dist-electron", "capability-registry.js")); } catch { caps274 = null; }
  const probeBase = {
    arch: "arm64", desktopSwitch: true, browserSwitch: true, nuphusAvailable: true, uiaAvailable: true,
    computerUseAvailable: true, imagePlugin: true, egoBrowser: true, markitdown: true,
  };
  const desktopItem = (resolution, platform) => {
    const item = (resolution ?? []).find((entry) => entry.id === "desktop");
    return { platform, activeId: item?.activeId ?? null, uiaAvailable: item?.alternatives?.find((entry) => entry.id === "uia-desktop")?.available === true };
  };
  const mac274 = caps274 ? desktopItem(caps274.resolveCapabilities({ ...probeBase, platform: "darwin" }), "darwin") : null;
  const win274 = caps274 ? desktopItem(caps274.resolveCapabilities({ ...probeBase, platform: "win32" }), "win32") : null;
  (mac274?.activeId === "computer-use-desktop" && win274?.activeId === "nuphus-desktop" && win274?.uiaAvailable === true && mac274?.uiaAvailable === false ? ok : fail)(
    `【274】能力链路按平台给唯一后端（mac=${mac274?.activeId} / win=${win274?.activeId}；UIA 仅 win 判可用）—— 界面显示的后端必须等于实际会用的那个`
  );
}
}

{
{
  // ⛔ 10-30 视觉辅助插件整体移除：nuphus-env.ts 已删（原【76】的 13 条映射/写出/漂移断言随之退役）。
  //   这里改钉**负向防复活**：NUPHUS_MCP_VISION_* 链不许回来 —— 插件没了，env 没有配置来源，
  //   复活只会长出一段永远空转的死链。
  const main76 = readMainSource();
  (!/NUPHUS_MCP_VISION|nuphusVisionEnv|NUPHUS_VISION_ENV_TABLE/.test(main76) ? ok : fail)(
    "【76】NUPHUS_MCP_VISION_* env 链不许复活（10-30 视觉辅助插件整体移除）"
  );
  (!existsSync(join(ROOT, "electron", "nuphus-env.ts")) ? ok : fail)(
    "【76】electron/nuphus-env.ts 保持已删除状态（原视觉 env 映射的唯一来源）"
  );
  const di76 = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  (!/describe_image|NUPHUS_MCP_VISION/i.test(di76) ? ok : fail)(
    "【76】describe_image 命令行用法不许回到 developer_instructions（视觉插件 10-30 已移除）"
  );
}
}

{
{
  const appSrc77 = readAppUi();
  const css77 = readStyles();

  (/<p className="composer-disclaimer">内容由AI生成，请核实重要信息<\/p>/.test(appSrc77) ? ok : fail)(
    "【77】提示文案原样在（用户指定内容，改写/删除都要能被发现）"
  );
  // 静态：不许挂条件（条件渲染 + 动态高度会让 `.composer-wrap` 的 ResizeObserver 反复重申贴底）
  (!/\{[^}]*&&\s*<p className="composer-disclaimer"/.test(appSrc77) ? ok : fail)(
    "【77】提示是静态渲染（不挂在条件里 —— 高度反复变化会触发反复贴底抖动）"
  );
  // 位置 = composer 那一列的最下方：在输入框（ComposerComposerForm）之后、</main> 之前
  // （10-25 那排 suggest-row 快捷卡已按用户要求删除，锚点改到输入框组件本身）
  const iForm = appSrc77.indexOf("<ComposerComposerForm app={app} />");
  const iDis = appSrc77.indexOf('className="composer-disclaimer"');
  const iMain = appSrc77.indexOf("</main>");
  (iForm >= 0 && iDis > iForm && iMain > iDis ? ok : fail)(
    "【77】位置在输入框那一列的最下方（ComposerComposerForm 之后、</main> 之前）"
  );
  const rule77 = (/\.composer-disclaimer\s*\{([^}]*)\}/.exec(css77) || [])[1] ?? "";
  (rule77 && /text-align:\s*center/.test(rule77) ? ok : fail)(
    "【77】样式规则存在且居中（缺规则会退回左对齐默认值）"
  );
  (!/position:\s*(absolute|fixed)/.test(rule77) ? ok : fail)(
    "【77】提示不脱流（绝对定位会让它不参与列高，居中基准就不是输入框那一列了）"
  );
}
}

{
{
  const app78 = readAppUi();
  (/localStorage\.getItem\("thread-name-override-v1"\)/.test(app78) ? ok : fail)(
    "【78】本地名字覆盖表存在（thread-name-override-v1）"
  );
  (/const rememberThreadName = useCallback/.test(app78) && /const effectiveThreadName = useCallback/.test(app78) ? ok : fail)(
    "【78】有 rememberThreadName / effectiveThreadName（唯一写入点 + 唯一读取口径）"
  );
  // 覆盖必须贴在**每一处**引擎回包落地处，漏一处就会「刷新一下名字弹回去」
  const listSites = (app78.match(/withNameOverride\(withCwdOverride\(entry\)\)/g) || []).length;
  (listSites === 2 ? ok : fail)(
    `【78】两处 thread/list 入口都贴了名字覆盖（实际 ${listSites} 处 —— 漏一处刷新就回退）`
  );
  (/withNameOverride\(freshThread\)/.test(app78) ? ok : fail)(
    "【78】新建/导入会话本地落地时也贴覆盖（导入建的会话走的正是这条）"
  );
  (/withNameOverride\(loadedRaw\)/.test(app78) ? ok : fail)(
    "【78】resume 回包也贴覆盖（打开会话时顶栏标题才不会回退）"
  );
  // 写入点在乐观更新之前：引擎那份不可靠，本地必须先落
  const rn = app78.indexOf("async function renameThread");
  const body = rn >= 0 ? app78.slice(rn, rn + 1600) : "";
  (body && /rememberThreadName\(id, name\);[\s\S]{0,260}?setThreads\(\(current\) => current\.map\(applyName\)\)/.test(body) ? ok : fail)(
    "【78】renameThread 先落本地覆盖再做乐观更新（顺序反了就会被刷新覆盖）"
  );
  // 不许回退成「靠引擎回包显示」：改名后必须仍然调 refreshThreads（靠覆盖兜住），
  // 且失败提示不得说成「重命名失败」（本地已生效，说失败会让用户以为白改）
  (/已改名（引擎侧未同步：\$\{engineError\.message\}）/.test(body) ? ok : fail)(
    "【78】引擎侧同步失败时的措辞是「已改名（引擎侧未同步…）」而不是「重命名失败」"
  );
}
}

{
{
  const app79 = readAppUi();
  const css79 = readStyles();
  (!/wb-fold-failed/.test(app79) && !/\{failedCount\}\s*项失败/.test(app79) ? ok : fail)(
    "【79】折叠头不再渲染「N 项失败」文字（用户要求删除，别再回退）"
  );
  (!/\.wb-fold-failed\s*\{/.test(css79) ? ok : fail)(
    "【79】配套样式 .wb-fold-failed 已随文字一起删掉（不留死代码）"
  );
  (/wb-fold-state \$\{running \? "running" : "done"\}/.test(app79) ? ok : fail)(
    "【79】折叠头状态只有两态：进行中转圈 / 完成打勾（10-29 用户令：红色 ❌ 删掉，容易让人误会）"
  );
  /* ⛔ 10-29 用户令原话：「上面那个红色 ❌ 是什么玩意，删掉，不需要，容易让人误会」——
     非零退出常是正常探测（`git config --get` 未配 / 非仓库 `git status` / 策略拦截都返回非零），
     整轮打一个红叉只会让人以为出错了。失败细节仍在命令卡展开体（`.cmd-exit`）。
     ⚠️ 判据必须读**折叠头那个文件**：`readAppUi()` 是整包拼接，别的组件（timeline 等）
        本来就在用 CircleX，拿它查会恒红。 */
  const foldSrc79 = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8");
  (!/CircleX/.test(foldSrc79) ? ok : fail)(
    "【79】⛔ 折叠头不再渲染失败红叉（failedCount 参数保留但不再参与渲染）"
  );
  /* 10-29 用户令：编辑文件 / 修改文件 / 深度思考 / 使用技能 前方统一加**语义匹配**的图标。
     ⛔ 判据钉的是分组映射表本身（不是某一行的 `<LeadIcon>`），缺类目会掉进兜底扳手。 */
  (/const FOLD_GROUP_ICONS: Record<string, typeof Wrench> = \{/.test(app79)
    && /skill: Sparkles/.test(app79) && /read: FileText/.test(app79) && /reasoning: Brain/.test(app79)
    && /modify: FileCode2/.test(app79) && /command: TerminalSquare/.test(app79) ? ok : fail)(
    "【79】折叠头按分组选图标（使用技能=Sparkles / 查看=FileText / 深度思考=Brain / 编辑文件=FileCode2 / 运行命令=TerminalSquare）"
  );
}
}

{
{
  const app80 = readAppUi();
  const css80 = readStyles();
  // ① 浮层已按用户要求回滚，别再回来。
  // ⛔ 负向断言必须走 codeOnly：本仓库习惯在注释里写「某写法已删除/别再恢复」，按原文匹配
  //    会把注释里提到 approval-elsewhere 当成它还在 → 假红（见 codeOnly 的说明，09-18 踩过三次）。
  (!/approval-elsewhere/.test(codeOnly(app80)) && !/approval-elsewhere/.test(codeOnly(css80)) ? ok : fail)(
    "【80】跨会话待审批浮层已回滚（用户 09-21 明确不要第二处提醒入口，只留侧栏「需审批」徽标）"
  );
  // ② 侧栏徽标这条既有口径必须在（用户认可的就是它，别顺手删掉）
  (/threadAttention/.test(app80) && /需审批/.test(app80) && /\.thread-attention-badge/.test(css80) ? ok : fail)(
    "【80】侧栏「需审批 / 需选择 / 需确认」徽标仍在（用户认可的提醒口径）"
  );
  // ③ setNotice = 通知中心唯一入账通道。审批类文案一旦走它，就会被收进通知图标（用户明确不要）
  const noticeCalls = app80.split(/\r?\n/).filter((line) => /setNotice\(/.test(line) && !/const setNotice|setNotice = /.test(line));
  const leaks = noticeCalls.filter((line) => /审批|批准|requestApproval|requestUserInput|elicitation/i.test(line));
  (leaks.length === 0 ? ok : fail)(
    `【80】审批类文案不得走 setNotice（= 不进通知中心）：命中 ${leaks.length} 处${leaks.length ? " → " + leaks[0].trim().slice(0, 90) : ""}`
  );
  // ④ 通知中心的入账条件：仍只认「别的会话产生的通知」，不许被改成什么都收
  (/const belongsToOtherThread = Boolean\(threadId && threadId !== threadRef\.current\?\.id\)/.test(app80) ? ok : fail)(
    "【80】通知中心入账条件未放宽（仍只收「别的会话」的通知）"
  );
}
}

{
{
  const main81 = readMainSource();
  (/function applyWindowChrome\(dark: boolean\)/.test(main81) ? ok : fail)(
    "【81】存在 applyWindowChrome（主题 → 窗口原生外观的唯一入口）"
  );
  // 09-21 主进程按域拆分：窗口集合已收敛到 electron/features/window-bus（allBusWindows() =
  // 主窗口 + 全部独立弹窗，单一权威）。判据语义不变：切主题必须遍历**所有**窗口。
  (/(\[mainWindow, \.\.\.popoutWindows\]|allBusWindows\(\))/.test(main81) ? ok : fail)(
    "【81】切主题遍历「主窗口 + 全部独立窗口」（只改 mainWindow ⇒ 独立窗口深色下窗口钮看不见）"
  );
  (!/mainWindow\?\.setTitleBarOverlay/.test(main81) ? ok : fail)(
    "【81】不再单独给 mainWindow 设标题栏 overlay（旧写法正是漏掉独立窗口的原因）"
  );
  (!/symbolColor:\s*"#1b1b1a"/.test(main81) ? ok : fail)(
    "【81】窗口创建处不得写死浅色符号色（深色模式下新开的独立窗口会立刻复现「看不见但能点」）"
  );
  (/已给 \$\{targets\.length\} 个窗口下发标题栏符号色/.test(main81) ? ok : fail)(
    "【81】下发后打日志（含覆盖窗口数 + 已下发符号色）——⛔ 本版 Electron 没有 getTitleBarOverlay 读回接口，别写它（TS2551 会直接让构建失败）"
  );
  (!/getTitleBarOverlay\s*\(/.test(main81) ? ok : fail)(
    "【81】不**调用**不存在的 getTitleBarOverlay（本版 Electron 无此 API；注释里提到不算，只认带括号的调用）"
  );
}
}
}
