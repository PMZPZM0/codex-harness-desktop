/** 06-app-behavior 第 2/5 段：原 06-app-behavior.mjs L868–L1696（逐字搬运 + 各自成块）。
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
    const st = req(join(ROOT, "dist-electron", "tools", "session-tools.js"));
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
}

{
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
    (/"0\.2\.3"/.test(versionsSrc) && /computerUse: "0\.3\.6"/.test(versionsSrc) && !/playwright/i.test(versionsSrc) ? ok : fail)(
      "【141】版本表只剩 nuphus / computer-use / ponytail 等实际随包件（Playwright 已移除）"
    );
    const prepWinSrc = readFileSync(join(ROOT, "scripts", "prepare-windows-tools.cjs"), "utf8");
    const prepMacSrc = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
    (/require\("\.\/lib\/tools-versions\.cjs"\)/.test(prepWinSrc) && /require\("\.\/lib\/tools-versions\.cjs"\)/.test(prepMacSrc) ? ok : fail)(
      "【141】两个 prepare 脚本都从单一来源取版本（任一侧留字面量 = 漂移机制回来了）"
    );
    (!/const NUPHUS_VERSION = "/.test(prepWinSrc) ? ok : fail)("【141】Windows 侧不得再留自写版本字面量");
    (!/@nuphus\/nuphus-mcp@\d/.test(prepMacSrc) ? ok : fail)("【141】mac 侧不得再留自写 npm 版本字面量");
    (!/@playwright/.test(prepMacSrc) ? ok : fail)("【141】mac 侧不得再留 Playwright 安装/版本字面量");
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
  (!/cloakbrowser|cloak-cache|CLAUB_EXCLUDES/i.test(packScript) ? ok : fail)("【29】pack-automation 已移除 CloakBrowser 排除清单（该能力整体删除，不再有装回风险）");
}
}

{
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
    const { createSendAnimClaim, armSendAnimationClaim, claimSendAnimation, SEND_ANIM_DURATION_MS, SEND_CLAIM_TTL_MS } = await import("../../../src/lib/send-anim.mjs");
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

    /* 10-28 起快捷键不再硬编码分发，改为「按配置表匹配」：平台分叉搬到了
       `src/lib/shortcut-catalog.mjs` 的 bindingMatches（成对 hasMod / hasOtherMod）。
       ⛔ 判据必须跟到**当前真相源**：继续钉已删除的旧分发器字面串 = 界面正常、守卫永远红。 */
    const shortcutCatalogSrc = codeOnly(readFileSync(join(ROOT, "src", "lib", "shortcut-catalog.mjs"), "utf8"));
    (/const (mod|hasMod) = (mac|isMac) \? event\.metaKey : event\.ctrlKey;/.test(appCode)
      || /const hasMod = isMac \? event\.metaKey : event\.ctrlKey;/.test(shortcutCatalogSrc))
      ? ok("【30】快捷键命令键按平台分叉（mac = ⌘）")
      : fail("【30】快捷键写死 ctrlKey —— mac 上所有快捷键失效（⌘O 打开工作区也废）");
    // ⛔ 不能只匹配旧字面串（`!event.ctrlKey || … || event.metaKey`）—— 换成等价的
    //    `!mod || event.altKey || event.metaKey` 就漏检（反证实测为假绿）。改为**结构性**判据：
    //    分叉是**成对**的两行（mod / otherMod），所以 handler 体里 `event.metaKey` 恰好出现 2 次；
    //    再把它当干扰键拦一次（旧写法）就会变成 3 次，守卫立刻红。
    {
      /* 结构性判据（跟到新实现）：bindingMatches 里必须是**成对**分叉，
         且 metaKey 只出现在分叉与（mac 场景的）按下判断里 —— 数量被限定，多一处就红。 */
      const hasPair = /const hasMod = isMac \? event\.metaKey : event\.ctrlKey;/.test(shortcutCatalogSrc)
        && /const hasOtherMod = isMac \? event\.ctrlKey : event\.metaKey;/.test(shortcutCatalogSrc);
      const metaCount = (shortcutCatalogSrc.match(/event\.metaKey/g) || []).length;
      (hasPair && metaCount >= 2 && metaCount <= 4)
        ? ok("【30】metaKey 只用于成对平台分叉（没被当干扰键拦掉）")
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
    const { macHotkeyLabel, hotkeyLabel } = await import("../../../src/lib/hotkey.mjs");
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
}

{
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
}

{
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
}
}
