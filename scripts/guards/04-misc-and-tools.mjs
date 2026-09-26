/**
 * 预检守卫组：04-misc-and-tools
 * 分节：【输入框草稿 + 通知会话名前缀】【多窗口事件过滤】【工具下载源】【首启体检】【工具安装验证】【15】【16】（原 L2432–L2892）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, createRequire, existsSync, fail, join, mainSrc, ok, pathToFileURL, readAppUi, readFileSync, readMainSource, readStyles, readdirSync, relative,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【输入框草稿 + 通知会话名前缀】原 L2432–L2455 ══ */
  {
console.log(C.bold("\n【输入框草稿 + 通知会话名前缀】切会话/关应用不丢输入；通知能看出是哪个会话"));
{
  const draftSrc = readFileSync(join(ROOT, "src/lib/composer-draft.mjs"), "utf8");
  (/export function draftKeyFor/.test(draftSrc) && /export function loadDraft/.test(draftSrc) && /export function saveDraft/.test(draftSrc))
    ? ok("草稿模块三函数齐全（draftKeyFor / loadDraft / saveDraft）")
    : fail("composer-draft.mjs 缺函数 —— 输入框草稿持久化失效");
  (/draftKeyFor\(/.test(draftSrc) && /100 \* 1024/.test(draftSrc))
    ? ok("草稿键与 100KB 上限在位（键按会话隔离，超长不撑爆 localStorage）")
    : fail("草稿键/长度上限被改 —— 会话草稿会互相串或撑爆存储");
  const appD = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  (/saveDraft\(thread\?\.id \?\? null, value\);/.test(appD))
    ? ok("输入框 onPromptChange 即时落盘（闭包里的 thread 是当前会话，键不会写错）")
    : fail("onPromptChange 不落盘草稿了 —— 打字内容只在内存里，切走/重启即丢");
  (/draftJustRestoredRef\.current = true;[\s\S]{0,80}setPrompt\(loadDraft\(/.test(appD) && /beforeunload/.test(appD))
    ? ok("恢复动作带防抖跳过标记 + 关应用前 beforeunload 落盘（恢复值不写错键、重启不丢）")
    : fail("草稿恢复/关应用落盘被摘 —— 恢复值会写进旧会话键或重启丢草稿");
  // ⛔ 锚 showToast 的**专属**前缀表达式（scopedNotice 也含 `【${name}】`，裸锚该字样会被它顶成假绿）
  (/function threadNameOf\(threadId: string\)/.test(appD) && /const prefix = name \? `【\$\{name\}】` : "";/.test(appD))
    ? ok("会话通知前缀会话名（showToast 带 threadId 参数 + 【会话名】前缀）")
    : fail("通知前缀会话名的实现被摘 —— 在别的会话看不到通知是哪个会话发的");
  (/showToast\("已停止限流重试", "不再自动重发该消息", threadId\)/.test(appD) && /showToast\("限流重试放弃"/.test(appD))
    ? ok("会话级通知调用点已带 threadId（限流重试等后台会话通知能看出归属）")
    : fail("会话级通知调用点丢了 threadId —— 后台会话的通知又不带会话名了");
}
  }

  /* ══ 【117】把已有的自检能力真正接到用户手上（09-23）══
     ⛔ 反面教材（本次发现两处）：`app-diagnostics.ts` 注释写着"内置斜杠命令 /doctor 支撑"、
     `02-model-thread-settings.tsx` 注释写着"与引擎 sideband 的模型切换事件互为补充" ——
     两处**代码里都不存在**。注释声称能力 = 最危险的假象（下一个人会以为它已经在了）。 */
  {
    console.log(C.bold("\n【117】环境自查接到用户手上（/doctor + 错误提示里的「自查」按钮）"));
    const appB = readAppUi();
    const catSrc = readFileSync(join(ROOT, "src/features/app-view/helpers/catalogs.ts"), "utf8");
    (/name: "doctor"/.test(catSrc) ? ok : fail)(
      "【117】命令目录里有 /doctor（否则 /help 不列、斜杠面板也不给）"
    );
    // ⛔ 断言按 readAppUi 的口径写（`bag.` 前缀被剥掉）—— 写成 `bag.runEnvironmentCheck(` 会假红。
    (/name === "doctor"\) await runEnvironmentCheck\(\);/.test(appB) ? ok : fail)(
      "【117】斜杠命令分发真的接了 doctor 分支（原状态：注释说支持、分发里没有 ⇒ 输入 /doctor 没人接）"
    );
    (/runEnvironmentCheck: \(\) => Promise<void>;/.test(readFileSync(join(ROOT, "src/features/app-state/parts/bag-types.ts"), "utf8"))
      ? ok : fail)("【117】runEnvironmentCheck 已登记进 Bag");
    (/await window\.codex\.doctor\(/.test(appB) && /setInfoModal\(\{ title: "环境自查"/.test(appB) ? ok : fail)(
      "【117】自查走真实通道 app:doctor 并把结论落到信息弹窗"
    );
    (/tone === "error"[\s\S]{0,400}自查<\/button>/.test(appB) ? ok : fail)(
      "【117】错误提示上有一键「自查」入口（只在 error 语气出现，平时不添噪音）"
    );
  }

  /* ══ 【116】输入体验与每轮注入（09-23：构建指纹 / Ctrl+Enter / 听写不吞字 / 当前时间）══
     四件事同属"输入侧可观测性与顺手程度"这一类，判据尽量落在**真跑**（纯函数）与**接线**上。 */
  {
    console.log(C.bold("\n【116】输入体验与每轮注入：构建指纹 / Ctrl+Enter 换行 / 听写不打断手打 / 每轮当前时间"));
    const appI = readAppUi();
    const viteSrc = readFileSync(join(ROOT, "vite.config.ts"), "utf8");

    /* ① 构建指纹：必须**构建期注入**，且界面能看见 —— 回答"你正在跑的是哪一份产物" */
    (/__BUILD_STAMP__: JSON\.stringify\(/.test(viteSrc) ? ok : fail)(
      "【116】构建指纹在 vite define 里构建期注入（运行时读 dist 只能说明磁盘上有什么）"
    );
    (/const buildStamp = __BUILD_STAMP__;/.test(appI) ? ok : fail)(
      "【116】应用侧 buildStamp 取自构建期注入"
    );
    (!/buildStamp = "20\d{6}-\d{4}"/.test(appI) ? ok : fail)(
      "【116】不许退回硬编码的构建指纹（原值 20260831-1830 过期 23 天无人发现 = 给用户假信息）"
    );
    (/\{buildStamp\}/.test(appI) && /\{bundleFile\}/.test(appI) && /copyBuildDiagnostics/.test(appI) ? ok : fail)(
      "【116】界面显示「构建指纹 + 产物名」并提供复制诊断信息（09-23 事故：跑的实例不是最新构建时无法自证）"
    );
    (/import\.meta\.url/.test(appI) ? ok : fail)(
      "【116】产物名取自 import.meta.url（运行真相），不是去读 dist 目录"
    );

    /* ② 回车语义：Enter 发送；Shift/Ctrl/Cmd+Enter 换行；⛔ 输入法组字期间一律不发送 */
    (/event\.nativeEvent\?\.isComposing \|\| event\.keyCode === 229/.test(appI) ? ok : fail)(
      "【116】回车提交先挡输入法组字（isComposing / keyCode 229）—— 否则打中文时按回车确认候选词会把半截消息发出去"
    );
    (!/event\.key === "Enter" && !event\.shiftKey/.test(appI) ? ok : fail)(
      "【116】旧判据 `Enter && !shiftKey` 已移除（它把 Ctrl+Enter 也当发送，与快捷键一览自相矛盾）"
    );
    // ⛔ 中间会夹注释（说明为什么不能用 insertLineBreak）⇒ 不能只允许空白，否则假红。
    (/if \(event\.ctrlKey \|\| event\.metaKey\) \{\s*event\.preventDefault\(\);[\s\S]{0,500}?document\.execCommand\("insertText", false, "\\n"\);/.test(appI)
      ? ok : fail)(
      "【116】Ctrl/Cmd+Enter 自己插换行（insertLineBreak 对 plaintext-only 是空操作，改走 insertText）"
    );
    const shortcutSrc = readFileSync(join(ROOT, "src/features/app-view/constants/03-ui-options.tsx"), "utf8");
    (/\{ keys: \["Enter"\], desc: "发送消息" \}/.test(shortcutSrc) && /keys: \["Shift\+Enter", "Ctrl\+Enter"\]/.test(shortcutSrc)
      ? ok : fail)(
      "【116】快捷键一览与实现一致（Enter 发送 / Shift+Enter·Ctrl+Enter 换行）"
    );

    /* ③ 听写不打断手动编辑：真跑纯函数 */
    // ⛔ readAppUi() 只并 `.ts`/`.tsx`（不并 `.mjs`）⇒ 调用点只可能有 **1** 处；别把"import 行"也算进去
    //    （第一版写成 >= 2 就假红了：import 语句里没有括号）。
    (/import \{ mergeDictation \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/dictation-merge\.mjs";/.test(appI)
      && (appI.match(/mergeDictation\(\{/g) || []).length === 1 ? ok : fail)(
      `【116】听写回填走 mergeDictation（唯一调用点；实测 ${(appI.match(/mergeDictation\(\{/g) || []).length} 处）`
    );
    (!/setPrompt\(\[dictationBaseRef\.current\.trim\(\), stage\.userText\.trim\(\)\]/.test(appI) ? ok : fail)(
      "【116】不许退回 `setPrompt(base + 整段字幕)` 覆盖式回填（听写期间手打的字会被下一次 partial 抹掉）"
    );
    (/dictationWrittenRef/.test(appI) ? ok : fail)(
      "【116】用「上次写下的字幕」当位标判断用户是否动过输入框（dictationWrittenRef 在位）"
    );
    const dm = await import(pathToFileURL(join(ROOT, "src/lib/dictation-merge.mjs")).href);
    const first = dm.mergeDictation({ base: "原有草稿", written: "", current: "原有草稿", dictation: "第一段" });
    const second = dm.mergeDictation({ base: first.base, written: first.written, current: first.text, dictation: "第二段" });
    (second.text === "原有草稿 第二段" && second.userEdited === false ? ok : fail)(
      `【116】连续 partial 只替换上一次字幕（实得「${second.text}」）`
    );
    const typed = dm.mergeDictation({ base: "原有草稿", written: "第一段", current: "原有草稿 第一段 用户手打的话", dictation: "第二段" });
    (typed.userEdited === true && typed.text.includes("用户手打的话") && typed.text.includes("第二段") ? ok : fail)(
      `【116】听写期间手打的内容必不被覆盖（实得「${typed.text}」）`
    );
    const dictEmpty = dm.mergeDictation({ base: "", written: "", current: "", dictation: "只有字幕" });
    (dictEmpty.text === "只有字幕" ? ok : fail)("【116】空输入框 + 字幕 = 只有字幕（不产生多余空格）");
    ((appI.match(/dictationWrittenRef\.current = ""/g) || []).length >= 3 ? ok : fail)(
      `【116】听写起点与结束都清零位标（实测 ${(appI.match(/dictationWrittenRef\.current = ""/g) || []).length} 处）—— 漏清零会被误判成"用户动过"`
    );

    /* ④ 每轮注入当前时间：真跑 + 隐藏块必须被剥掉 + 不许塞进 config.toml */
    const nb = await import(pathToFileURL(join(ROOT, "src/lib/now-block.mjs")).href);
    const fixedNow = nb.nowText(new Date(2026, 8, 23, 10, 47));   // 2026-09-23 是周三
    (fixedNow === "2026-09-23 10:47（周三）" ? ok : fail)(`【116】当前时间文案含星期（实测「${fixedNow}」）`);
    const block = nb.nowBlock(new Date(2026, 8, 23, 10, 47));
    (block.startsWith("\n\n[当前时间]\n") && block.endsWith("[时间结束]\n") ? ok : fail)(
      "【116】注入块形态稳定（成对标签，便于剥离）"
    );
    ((appI.match(/nowBlock\(\)/g) || []).length >= 2 ? ok : fail)(
      `【116】发送与排队两条路径都带当前时间块（实测 ${(appI.match(/nowBlock\(\)/g) || []).length} 处）`
    );
    const strip = await import(pathToFileURL(join(ROOT, "src/lib/harness-block-strip.mjs")).href);
    const cleaned = strip.stripHarnessBlocks("帮我看看今天几号" + block);
    (!cleaned.includes("当前时间") && cleaned.includes("帮我看看今天几号") ? ok : fail)(
      "【116】时间块在气泡/标题里被剥掉（模型看得见、用户不该看见）"
    );
    const plainText = "讨论一下 [当前时间] 这个标签怎么用";
    (strip.stripHarnessBlocks(plainText) === plainText ? ok : fail)(
      "【116】用户正文里单独提到该标签时不被误剥（只有成对闭合才剥）"
    );
    const devInstr = readFileSync(join(ROOT, "electron/developer-instructions.ts"), "utf8");
    (!/nowBlock|当前时间/.test(devInstr) ? ok : fail)(
      "【116】时间不许写进 developer_instructions：那份文本要落盘并被 instructionsOutdated 比对，放每轮变化的值会恒真 ⇒ 反复重写 config.toml"
    );
  }

  /* ══ 【多窗口事件过滤】原 L2457–L2474 ══ */
  {
console.log(C.bold("\n【多窗口事件过滤】过期上报必须放行 / 生命周期事件必须跨会话送达 / 渲染层要心跳"));
{
  const mainSrc = readMainSource();
  const appH = readAppUi();
  // ① 只要有一个窗口的上报过期，整体不可信 → 放行（否则过期窗口正在看的会话被裁掉事件）
  (/let anyStale = false;/.test(mainSrc) && /if \(!anyFresh \|\| anyStale\) return null;/.test(mainSrc))
    ? ok("watchedThreadIds 过期上报即整体放行（不会把「另一个窗口正在看的会话」裁掉）")
    : fail("过期上报又被当成「没人看」了 —— 两个窗口一起跑时，前台会话的事件会被裁掉（只转圈不出内容）");
  // ② aborted/failed/interrupted/error 必须跨会话送达（后台会话的熄灭与 429 重试依赖它们）
  const cross = mainSrc.slice(mainSrc.indexOf("const RENDERER_CROSS_SESSION_METHODS"), mainSrc.indexOf("const RENDERER_CROSS_SESSION_METHODS") + 700);
  (["turn/aborted", "turn/failed", "turn/interrupted", "error"].every((m) => cross.includes(`"${m}"`)))
    ? ok("生命周期事件跨会话白名单齐全（aborted/failed/interrupted/error）")
    : fail("生命周期事件又不在白名单里 —— 后台会话的停止/绿点/429 重试会永久卡住");
  // ③ 渲染层心跳：只在上报 id 变化时发一次 ⇒ 停留超 30s 就被判过期
  (/setInterval\(report, 15_000\)/.test(appH) && /addEventListener\("focus", report\)/.test(appH))
    ? ok("渲染层活跃会话上报带 15s 心跳 + 窗口聚焦补报（新鲜度不会自己过期）")
    : fail("活跃会话上报没有心跳 —— 停留超过 30s 主进程就以为「不知道它在看什么」");
}
  }

  /* ══ 【工具下载源】原 L2476–L2497 ══ */
  {
console.log(C.bold("\n【工具下载源】设置持久化 + 三条下载通道都认源 + 页面选择器在位"));
{
  const mainSrc2 = readMainSource();
  const appS = readAppUi();
  const runtimeSrc = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  // ① 工具链脚本按 DOWNLOAD_SOURCE 分通道：六种源都要有分派，且每种都带「直连」回落
  (/const SOURCE = \(process\.env\.DOWNLOAD_SOURCE \|\| "auto"\)\.toLowerCase\(\);/.test(runtimeSrc)
    && ["direct", "mirror", "ghproxy", "ghfast", "proxy"].every((s) => runtimeSrc.includes(`case "${s}"`))
    && /ghfast\.top/.test(runtimeSrc))
    ? ok("install-runtimes.cjs 按 DOWNLOAD_SOURCE 分通道（auto/mirror/ghproxy/ghfast/direct/proxy，均回落直连）")
    : fail("install-runtimes.cjs 的下载源分派被摘 —— 页面上选了源工具链也不认");
  // ② 主进程把源传下去：runtime:install 现读 + 三条通道（工具链 env / npm / 浏览器内核）都接线
  (/async function readDownloadSource\(\)/.test(mainSrc2) && /DOWNLOAD_SOURCE: downloadSource/.test(mainSrc2)
    && /runNpmInstall\(id, "cloakbrowser", "CloakBrowser", downloadSource\)/.test(mainSrc2)
    && /runBrowserDownload\(id, node, cli, \["install", "chromium"\], "浏览器内核", downloadSource\)/.test(mainSrc2))
    ? ok("主进程三条下载通道都接了 downloadSource（工具链 env / npm registry / 浏览器内核）")
    : fail("主进程没把下载源传下去 —— 选了源也只有部分通道生效");
  // ③ 页面选择器在位：六个选项 + 保存走 app-settings（选完下一次下载生效）
  (/changeDownloadSource/.test(appS) && /value="ghfast"/.test(appS) && /saveAppSettings\(\{ downloadSource: next \}\)/.test(appS))
    ? ok("开发工具页下载源选择器在位（六档选项，写入 app-settings 即时生效）")
    : fail("开发工具页的下载源选择器被摘 —— 用户没法换源");
}
  }

  /* ══ 【首启体检】原 L2499–L2509 ══ */
  {
console.log(C.bold("\n【首启体检】工作区已移出，不再有把弹窗带走的「去选择」岔路"));
{
  const dialogSrc = readFileSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"), "utf8");
  const appE = readAppUi();
  (!/id: "workspace"/.test(dialogSrc) && !dialogSrc.includes('"model" | "workspace"') && !dialogSrc.includes("FolderOpen"))
    ? ok("体检清单已无工作区项（必选岔路连同「去选择」按钮一起移除）")
    : fail("工作区又回到体检里了 —— 用户点「去选择」会带走弹窗，工具就没装");
  (!appE.includes('id === "workspace"') || !/envItems[\s\S]{0,400}workspace.{0,200}go: "workspace"/.test(appE))
    ? ok("App 侧体检状态不再构造工作区项（一键安装直奔工具下载）")
    : fail("App 侧仍把工作区算进体检 —— 弹窗还会被工作区岔路带走");
}
  }

  /* ══ 【工具安装验证】原 L2511–L2521 ══ */
  {
console.log(C.bold("\n【工具安装验证】verify 只是快照，失败不得连坐整个安装"));
{
  const runtimeSrc2 = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  // Windows main() 的 verify 段：git/rg/uv/cmake/conda/gcc/ffmpeg/code 必须走 safeVerify（try/catch 非致命）；
  // conda 失败时附「路径含空格」的已知限制说明（conda.exe 启动器限制，环境本身已装好）。
  (/const safeVerify = \(label, command/.test(runtimeSrc2)
    && ["git", "rg", "uv", "cmake", "conda", "gcc", "ffmpeg", "code"].every((label) => runtimeSrc2.includes(`safeVerify("${label}"`))
    && !/\[verify conda\]", runCommand/.test(runtimeSrc2))
    ? ok("verify 全部非致命（safeVerify 包裹；conda 失败附空格路径限制说明）")
    : fail("verify 又变回致命了 —— 单条验证失败会把装好的工具连坐成「安装失败」");
}
  }

  /* ══ 【15】原 L2524–L2545 ══ */
  {
console.log(C.bold("\n【15】供应商列表：点开关（启用/停用）右侧详情必须跟随"));
{
  // 09-21 架构改造：块已搬到 src/features/settings-* ⇒ 统一走 readAppUi()；
  // 「开关块」的上下文窗口必须落在**实际承载它的文件**里（拼接后 indexOf 会跨文件，窗口语义失真）
  const appSrc5 = readAppUi();
  const providerSwitchHost = (() => {
    const p = join(ROOT, "src/features/settings-model/ModelSettingsSection.tsx");
    return existsSync(p) ? readFileSync(p, "utf8") : appSrc5;
  })();
  // ⛔ 用户 09-14 实测：点开关（开启某个供应商）后右侧还停在上一个供应商的界面 ——
  //    因为开关的 onClick 只 stopPropagation()，把行点击（切详情）也拦掉了。
  // ⛔ 检查窗口必须限定在「开关」各自的上下文里：裸 stopPropagation 这个模式在文件别处也有，
  //    全文件扫会假红（本轮踩过）。取每个 .provider-switch 出现点之前的 2600 字符做上下文。
  const swIdx = providerSwitchHost.indexOf("provider-switch-ui");
  const swBlock = providerSwitchHost.slice(Math.max(0, swIdx - 2600), swIdx);
  !/onClick=\{\(event\) => event\.stopPropagation\(\)\}/.test(swBlock)
    ? ok("供应商开关不再裸 stopPropagation（拦冒泡时同时把详情切过去）")
    : fail("供应商开关又是裸 stopPropagation —— 点开关后右侧会停在旧界面");
  /setEditingProvider\(p\.provider\)/.test(swBlock)
    ? ok("开关的 onClick 里确实切了编辑对象（setEditingProvider）")
    : fail("开关 onClick 里没有切编辑对象 —— 详情不会跟随");
}
  }

  /* ══ 【16】原 L2548–L2892 ══ */
  {
console.log(C.bold("\n【16】统一内置 provider id（新会话一律绑 harness，切供应商无需会话迁移）"));
{
  const libSrc = readFileSync(join(ROOT, "src/lib/provider-continuity.mjs"), "utf8");
  /export const HARNESS_PROVIDER_ID = "harness"/.test(libSrc)
    ? ok("纯模块导出统一 id 常量（harness）")
    : fail("没有统一 id 常量 —— 新会话又会绑用户配置的真实 id，切供应商还是要迁移");
  const judge = libSrc.slice(libSrc.indexOf("export function shouldAlignProvider"));
  /if \(bound === HARNESS_PROVIDER_ID\) return false;/.test(judge)
    ? ok("★ 绑定统一 id 视为天然对齐（不会再触发迁移/提示）")
    : fail("判定没短路统一 id —— 每次打开会话都会判定「绑定 ≠ 激活」");
  const appSrc6 = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  const pc = appSrc6.slice(appSrc6.indexOf("const providerConfig = useMemo"), appSrc6.indexOf("const providerConfig = useMemo") + 1200);
  /modelProvider: HARNESS_PROVIDER_ID/.test(pc) && /model_provider: HARNESS_PROVIDER_ID/.test(pc) && /\[HARNESS_PROVIDER_ID\]: \{/.test(pc)
    ? ok("新建会话的使用点绑 HARNESS_PROVIDER_ID（三处：modelProvider / model_provider / providers 键）")
    : fail("providerConfig 又绑回 customModel.provider —— 新会话会产生新的绑定差异");
  const mig = appSrc6.slice(appSrc6.indexOf("async function migrateThreadToProvider"), appSrc6.indexOf("async function alignThreadToProvider"));
  /modelProvider: HARNESS_PROVIDER_ID/.test(mig) && /threadProviderRef\.current\.set\(threadId, HARNESS_PROVIDER_ID\)/.test(mig)
    ? ok("迁移过的会话也绑统一 id（从此永久对齐，不再迁移）")
    : fail("迁移后仍绑真实 id —— 同一个会话会被反复迁移");
  const mainSrc6 = readMainSource();
  /\[model_providers\.harness\]/.test(mainSrc6) && /model_provider = "harness"/.test(mainSrc6)
    ? ok("config.toml 恒写 harness 段 + 顶层 model_provider 指向它（永远指向当前生效供应商）")
    : fail("config.toml 没有 harness 段 —— 引擎解析不到统一 id");

  // ⛔ 09-15 实测验证：新增/删除供应商后，**旧会话仍必须可用**（用户问「会不会又卡 BUG」）。
  //    两条机制缺一不可：
  //    ① 历史 id 别名段（aliasToml）——旧版本创建的会话 rollout 里记的是具体 provider id
  //       （pttoken / relay-* / 用户自定义 id）。该 id 从供应商列表删掉后，引擎若无对应段
  //       会报 "Model provider not found"、会话打不开。别名段把它指向当前生效供应商兜底。
  //       实测：复制真实 rollout、只改 session_meta.model_provider=已删除 id → 启动即补别名段，
  //       打开该会话 26 条历史正常渲染、发消息写回该会话本身、零错误。
  //    ② harness 防重护栏（stripHarnessTable）——档案里若混入 id=harness 的条目，
  //       会与恒写的 harness 段重复 → TOML duplicate key → 引擎拒载整份配置 = 应用全瘫。
  /collectSessionProviderIds/.test(mainSrc6) && /aliasIds/.test(mainSrc6) && /历史会话别名 → 当前生效供应商/.test(mainSrc6)
    ? ok("★ 历史 id 别名段机制在（旧会话引用的已删除供应商 id 仍能解析，会话打不开=灾难）")
    : fail("别名段机制缺失 —— 删掉/改名供应商后，引用它的旧会话会报 provider not found 打不开");
  /stripHarnessTable/.test(mainSrc6) && /model_providers\.harness/.test(mainSrc6)
    ? ok("★ harness 段防重护栏在（档案里混入 id=harness 不会产生 duplicate key 全瘫）")
    : fail("防重护栏缺失 —— 档案混入 harness 条目会写出重复 TOML 段，引擎拒载配置=应用全瘫");
  // 洞明的 systemPrompt 带技能包**绝对路径**，而内置专家 ensure 是「按 teamId 存在即不更新」——
  // 安装位置一变（开发版 ↔ 打包版、项目目录改名/搬家），存档里的旧路径就失效，而专家读不到
  // 技能包时**不报错、静默降级**。下面用**编译产物**跑真行为断言（真实现，不是文本匹配）。
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let et = null;
  try { et = req(join(ROOT, "dist-electron/expert-teams.js")); } catch { et = null; }
  if (!et || typeof et.syncSkillsPath !== "function" || typeof et.syncSkillsPathInTeam !== "function") {
    fail("dist-electron/expert-teams.js 缺 syncSkillsPath / syncSkillsPathInTeam —— 技能包路径无法随安装位置自愈");
  } else {
    // 注意：buildDongmingExpertTeam 收的是**技能库根目录**，它自己会拼 `/dongming-code-review`。
    // 所以「当前真实路径」必须从它生成的提示词里读回来，不能手写 —— 手写会多拼一层子目录，断言假红。
    const base = et.buildDongmingExpertTeam("D:/old-place/resources/expert-skills").lead.systemPrompt;
    const OLD = et.readSkillsPath(base);
    const NEW = et.readSkillsPath(et.buildDongmingExpertTeam("E:/new-place/resources/expert-skills").lead.systemPrompt);
    const next = et.syncSkillsPath(base, NEW);
    next && next.includes(NEW) && !next.includes(OLD) && next.split(NEW).join(OLD) === base
      ? ok("★ 技能包路径变了只换那一段（其余内容逐字保留）")
      : fail("路径同步改动了路径之外的内容，或没替换成功");
    et.syncSkillsPath(base, OLD) === null
      ? ok("路径没变时返回 null（不写盘、不刷时间戳）")
      : fail("路径没变仍返回新值 —— 每次启动都会重写专家档案，掩盖真实变更");
    const stripped = base.split("\n").filter((l) => !l.includes(et.SKILLS_PATH_MARK) && !l.includes("都在这个目录下") && !l.includes("技能列表里没有")).join("\n");
    const refilled = et.syncSkillsPath(stripped, NEW);
    refilled && refilled.includes(NEW) && refilled.includes(et.SKILLS_PATH_MARK)
      ? ok("老播种 / 路径行被删 → 自动补回兜底段")
      : fail("缺路径行时不补回 —— 老存档里的洞明永远读不到技能包");
    et.syncSkillsPathInTeam(et.buildZhiweiExpertTeam(), et.buildDongmingExpertTeam(NEW)) === null
      ? ok("teamId 不匹配时不动手（不会把洞明的路径写到别的专家上）")
      : fail("teamId 校验缺失 —— 可能误改其它专家配置");
    /syncSkillsPathInTeam\(stored, solo\)/.test(mainSrc6)
      ? ok("启动 ensure 已接入路径同步（已存在 ≠ 已最新）")
      : fail("main.ts 没接入 syncSkillsPathInTeam —— 安装位置一变，洞明静默读不到技能包");
  }
}

// ---------- 【17】回合时序规范化（09-15「更早消息按钮与内容对不上」修复的纯逻辑守卫） ----------
{
  const { orderTurnsByTime, mergeTurnListsById, visibleTurnWindow } = await import("../../src/lib/turn-order.mjs");
  const appSrc7 = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  const mk = (id, startedAt) => ({ id, startedAt, items: [], status: "completed" });
  // 用户真实事故形状：mergeLongerStreams 盲目前插部分快照 → [3..8, 1, 2]（最旧的贴到末尾）
  const corrupted = [3, 4, 5, 6, 7, 8, 1, 2].map((n) => mk(`t${n}`, 1000 + n));
  const fixed = orderTurnsByTime(corrupted);
  fixed.map((t) => t.id).join(",") === "t1,t2,t3,t4,t5,t6,t7,t8"
    ? ok("orderTurnsByTime 把乱序回合按 startedAt 规范化（用户事故形状 [3..8,1,2] → [1..8]）")
    : fail("orderTurnsByTime 排序不正确 —— 回合顺序错乱会再次出现");
  const missing = mergeTurnListsById([mk("t3", 1003), mk("t4", 1004)], [mk("t1", 1001)]);
  missing.length === 3 && missing[0].id === "t1"
    ? ok("mergeTurnListsById 去重合并 + 时序收口（部分快照不再盲目前插）")
    : fail("mergeTurnListsById 合并结果不对 —— 乱序/重复回合会再次进入状态");
  const dup = mergeTurnListsById([mk("t1", 1001), mk("t2", 1002)], [mk("t2", 1002), mk("t3", 1003)]);
  dup.length === 3
    ? ok("mergeTurnListsById 同 id 去重（游标翻页不再产生重复回合）")
    : fail("mergeTurnListsById 没去重 —— 「游标原地打转」的重复回合会回来");
  const live = [mk("old", 5000), mk("streaming")]; // 直播回合无 startedAt → 视为最新，排在最后
  const win = visibleTurnWindow(live, 5);
  win.ordered[win.ordered.length - 1]?.id === "streaming" && win.visible.length === 2
    ? ok("visibleTurnWindow：无 startedAt 的直播回合排最后 + 窗口切片正确")
    : fail("visibleTurnWindow 对直播回合/窗口切片的处理不对 —— 正在进行的回合可能被挤丢");
  /visibleTurnWindow\(thread\?\.turns/.test(appSrc7)
    ? ok("时间线渲染入口走 visibleTurnWindow（渲染前时序规范化）")
    : fail("时间线渲染没有走时序规范化 —— 状态乱序会直接画到界面上");
  /mergeTurnListsById\(mergedTurns, extraTurns\)/.test(appSrc7) && /mergeTurnListsById\(c\.turns \?\? \[\], earlier\)/.test(appSrc7)
    ? ok("mergeLongerStreams 与 loadEarlierTurns 都走去重时序合并（事故源头收口）")
    : fail("回合合并仍有盲目前插/拼接 —— 顺序错乱源头未收口");
}
// ---------- 【18】用户气泡不得悬浮遮挡后代内容（09-15 实测事故） ----------
// 事故：为了「发送后钉住用户消息、消掉一屏留白」，给当前回合的用户气泡加了
//   position: sticky; top: 54px; z-index: 5; background: var(--bg);
// 结果气泡变成不透明白底浮层，盖住同回合内从 top:170 起的助手消息（实测重叠 [170,204]），
// 表现是「消息中间几行被竖着切断」。2026-09-15 已撤销，回归文档流。
// 判据：用户气泡（.user-message / .user-message-stack）**不得**同时具备
//   ① 脱离文档流的定位（sticky/fixed/absolute）② 不透明底色 ③ 正向 z-index
// 三者同时命中即「会遮挡后代内容」，构建期直接拦下。
{
  const css = readStyles();
  // 抓所有以 .user-message 开头（含 .user-message-stack）的选择器块
  const blocks = [];
  const re = /([^{}]*\.user-message(?:-stack)?[^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) blocks.push({ sel: m[1].trim(), body: m[2] });
  const offenders = [];
  for (const b of blocks) {
    const floats = /position\s*:\s*(sticky|fixed|absolute)/.test(b.body);
    // 不透明底色：background / background-color 且不是 transparent / rgba(x,x,x,0)
    const bgRaw = (b.body.match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1] || "";
    const solid = !!bgRaw && !/transparent|rgba\([^)]*,\s*0\s*\)|none/.test(bgRaw);
    const z = Number((b.body.match(/z-index\s*:\s*(-?\d+)/) || [])[1] ?? 0);
    if (floats && solid && z > 0) offenders.push(b.sel + "  →  " + bgRaw.trim());
  }
  offenders.length === 0
    ? ok("用户气泡不使用「悬浮 + 不透明底 + z-index」组合（不会遮挡后代内容）")
    : fail("用户气泡是悬浮遮罩，会盖住同回合的助手消息：\n        " + offenders.join("\n        "));

  // 09-15 反转：当前回合/流式回合**必须**用真实高度（content-visibility: visible），
  // 否则高度会在「真实值 / 估算值 300px / 0」之间塌陷 → 用户看到「消息滚过时闪一下」。
  // 实测：26ms 内 scrollHeight 在 1073/993/1213/913 之间反复跳。
  /\.turn-group\.running[^{}]*\{[^{}]*content-visibility:\s*visible/.test(css)
    ? ok("流式回合用真实高度（content-visibility: visible）—— 不会高度塌陷闪烁")
    : fail("流式回合没关掉 content-visibility —— 内容高度会在真实值/估算值间塌陷，滚动时闪一下");

  const app = readAppUi();
  // 09-15：sticky 方案已彻底删除（连开关一起），不许再以任何形式回来
  /STICKY_USER_SLOT/.test(app)
    ? fail("STICKY_USER_SLOT 又出现了 —— sticky 方案已整体撤销，不要再引入")
    : ok("sticky 方案已彻底移除（无 STICKY_USER_SLOT 残留）");
  // 09-15 新方案：留白「只补缺口 + 内容增长时单向收缩到 0」。
  // 撑满一屏（clientHeight）会让滚动范围多出一屏（用户实测「怎么滚都没到真底」），已废弃。
  /const shrinkAnchorPad = /.test(app) && /anchorPadAppliedRef/.test(app)
    ? ok("发送锚定留白会随内容收缩（滚到底 = 真底，无多余空间）")
    : fail("留白没有收缩逻辑 —— 内容长起来后底部会多出一大段空白，滚不到真底");
}

// ---------- 【19】just-sent 必须挂在 .user-message 上（09-15 实测「发消息没有过渡动画」） ----------
// 事故：入场动画的 CSS 选择器是 `.user-message.just-sent`（要求同一元素同时具备两个类），
// 但代码把 just-sent 挂在**外层** .user-message-stack 上 → 选择器永不匹配。
// 实测：stack 的 animationName = "none"；把类挂到 .user-message 上立刻得到
//   "user-msg-send-in / 0.55s"。用户观感 = 「发消息没有过渡动画」。
{
  const app = readAppUi();
  const css = readStyles();

  // ① 类必须挂在内层 .user-message 的 className 里
  const innerOk = /message user-message[\s\S]{0,160}?justSent \? " just-sent"/.test(app);
  innerOk
    ? ok("just-sent 挂在 .user-message（与 CSS 选择器同元素）")
    : fail("just-sent 没有挂在 .user-message 上 —— CSS 是 .user-message.just-sent，挂外层不生效（发消息无入场动画）");

  // ② 不许再往 .user-message-stack 上挂（那是错的元素）
  /user-message-stack\$\{justSent/.test(app)
    ? fail("just-sent 又被挂回 .user-message-stack —— 该元素没有任何 just-sent 样式，动画不会播")
    : ok("just-sent 没挂在 .user-message-stack（不会再挂错元素）");

  // ③ 动画规则与光斑规则仍在（防止有人「修」成删 CSS）
  /@keyframes user-msg-send-in/.test(css)
    ? ok("入场动画 @keyframes user-msg-send-in 在（动画不会被误删）")
    : fail("@keyframes user-msg-send-in 缺失 —— 入场动画丢了");
  /\.user-message\.just-sent\s*\{/.test(css)
    ? ok("动画选择器 .user-message.just-sent 在（与挂载元素一致）")
    : fail(".user-message.just-sent 选择器缺失 —— 动画匹配不上");
}

// ---------- 【20】调度（09-15）：Codex 调度 专家/专家团/子智能体 干活的四层防护 ----------
{
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let dp = null;
  try { dp = req(join(ROOT, "dist-electron/dispatch.js")); } catch { dp = null; }
  const mainSrc9 = readMainSource();
  const appSrc9 = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  if (!dp || typeof dp.canDispatchFrom !== "function") {
    fail("dist-electron/dispatch.js 缺 canDispatchFrom —— 调度硬闸无法断言");
  } else {
    // L3 执行侧硬闸（不靠提示词、不靠注册侧，给了工具也不认）
    const blocked = dp.canDispatchFrom({ isDelegated: true });
    !blocked.ok && /委派会话/.test(String(blocked.reason ?? ""))
      ? ok("★ L3 硬闸：被委派会话再发起调度被拒（防套娃的最后一道）")
      : fail("被委派会话没被拦住 —— 专家调专家会无限套娃");
    dp.canDispatchFrom({ isDelegated: false, depth: 0 }).ok
      ? ok("L3 硬闸放行用户直连会话（depth=0）")
      : fail("正常会话被误拦 —— 调度根本用不起来");
    // 入口位置文案同源（09-21）：调度开关**唯一**渲染点在顶栏（DispatchMenu 里 composer 变体
    // 没有任何调用点，是死代码），所以位置文案只能指向顶栏 —— 拒绝语曾写「输入框的调度开关」，
    // 而模型会把这句原样转告用户 ⇒ 用户去输入框找、找不到。
    const dpSrc9 = readFileSync(join(ROOT, "electron/dispatch.ts"), "utf8");
    const dispatchEntry9 = (appSrc9.match(/<DispatchMenu/g) || []).length;
    dispatchEntry9 === 1 && /<DispatchMenu\s+topbar/.test(appSrc9)
      ? ok("★ 调度开关唯一渲染点＝顶栏（App.tsx 里只有一处 <DispatchMenu topbar>）")
      : fail(`调度开关渲染点 ${dispatchEntry9} 处 / 未用 topbar 变体 —— 双入口会让「在哪开」说不清`);
    /顶栏/.test(dpSrc9) && !/输入框的调度开关/.test(dpSrc9)
      ? ok("★ L3 拒绝文案指向真实入口（顶栏调度开关）")
      : fail("调度权限恢复文案未指向顶栏 —— 开关只在顶栏渲染，用户找不到");
    !dp.canDispatchFrom({ depth: dp.MAX_DEPTH }).ok
      ? ok(`L3 深度闸：depth >= MAX_DEPTH(${dp.MAX_DEPTH}) 拒绝`)
      : fail("深度闸失效 —— 调用链可以无限延长");
    /* L4「总量闸」已于 09-25 **删除**（用户：「直接把并发限制删了吧」；与渲染层供应商并发闸一起）。
       ⛔ 判据 = **取值**（产物里不得再导出 admitDispatch / maxConcurrentDispatch / 档位常量），
       不是"常量存在"——用户要求的是删除，不许悄悄复活。L3 深度闸（canDispatchFrom）仍保留。 */
    (typeof dp.admitDispatch !== "function" && typeof dp.maxConcurrentDispatch !== "function"
      && dp.MAX_CONCURRENT_DISPATCH_CONSERVATIVE === undefined && dp.MAX_CONCURRENT_DISPATCH_HIGH === undefined
      ? ok("L4 调度并发闸已删除（用户 09-25 要求；保留 L3 深度闸）")
      : fail("调度并发闸又出现了 —— 用户 09-25 明确要求删除，不许复活"));
    const clipped = dp.clipDispatchOutput("x".repeat(dp.MAX_OUTPUT_CHARS + 500), "th-1");
    clipped.length <= dp.MAX_OUTPUT_CHARS && /th-1/.test(clipped)
      ? ok("回传输出超长被截断且指向完整会话（不撑爆调用方上下文）")
      : fail("输出没有截断 —— 长产出会撑爆调用方上下文");
    // 目录 / 开关
    const targets9 = [
      { kind: "expert", key: "a", name: "甲", profession: "", description: "" },
      { kind: "team", key: "b", name: "乙", profession: "", description: "" },
      { kind: "subagent", key: "c", name: "丙", profession: "", description: "" },
    ];
    dp.filterTargetsBySwitch(targets9, { enabled: false }).length === 0
      ? ok("总开关关闭时不暴露任何可调度对象")
      : fail("总开关关了仍能看到可调度对象");
    const onlyTeam = dp.filterTargetsBySwitch(targets9, { enabled: true, expert: false, team: true, subagent: false });
    onlyTeam.length === 1 && onlyTeam[0].kind === "team"
      ? ok("三类勾选分别生效（取消专家/子智能体后只剩专家团）")
      : fail("勾选过滤不生效");
    dp.resolveDispatchTarget(targets9, { kind: "expert", name: "a" }).target?.name === "甲"
      && dp.resolveDispatchTarget(targets9, { kind: "expert", name: "甲" }).target?.key === "a"
      ? ok("目标解析同时认 key 与显示名（模型传中文名也能命中）")
      : fail("目标解析只认一种写法 —— 模型传中文名就会失败");
    !dp.resolveDispatchTarget(targets9, { kind: "expert", name: "不存在" }).target
      ? ok("目标不存在时返回可读错误（含当前可用清单）")
      : fail("目标解析对不存在的名字不报错");
    // L1 提示词层（软防护，但必须覆盖三类对象且措辞不能误伤本职能力）
    const teamBlock = dp.delegateScopeBlock({ kind: "team", name: "研发交付团" });
    /只能调度\*\*本团队/.test(teamBlock) && /不要调用其他专家团/.test(teamBlock)
      ? ok("★ L1 文案：专家团主理人只许调度本团成员、不许跨团/跨类型")
      : fail("专家团约束文案缺失 —— 主理人会跨团或跨类型乱调");
    /不要调用其他专家、专家团或子智能体/.test(dp.delegateScopeBlock({ kind: "expert", name: "洞明" }))
      ? ok("★ L1 文案：被委派的专家/子智能体直接干活、不许转派")
      : fail("被委派者没被禁止转派 —— 提示词层防护缺失");
    /不要委派给任何人/.test(dp.delegateScopeBlock({ kind: "member", name: "承枢" }))
      ? ok("L1 文案：团队成员直接干活不转派")
      : fail("团队成员约束文案缺失");
    // L2 注册侧（渲染层不给工具）
    /dispatchIsDelegated \? \[\] : subAgentTools/.test(appSrc9)
      ? ok("★ L2 注册侧：委派会话不注册 subAgentTools")
      : fail("委派会话仍会拿到 subAgentTools —— 套娃入口没关");
    // ⛔ 09-16 起调度工具改走内置 MCP（引擎硬约束：dynamicTools 只在 thread/start 生效，
    // resume/fork/turn/start 全部不认 —— 渲染层 dynamic 注册对老会话永远不可见）
    !/name: "agent_invoke"/.test(appSrc9)
      ? ok("★ 渲染层不再用 dynamicTools 注册 agent_invoke（对老会话无效，改走 MCP）")
      : fail("App.tsx 仍存在 dynamic agent_invoke 注册 —— 与 MCP 双通道会让模型混乱");
    /mcp_servers\.harness-dispatch/.test(mainSrc9) && /dispatchMcpTools\(\)/.test(mainSrc9) && /ensureDispatchHttp/.test(mainSrc9)
      ? ok("★ 内置调度 MCP 已接线（HTTP 直连 + /mcp 端点 + config.toml 注入）")
      : fail("调度 MCP 通道缺失 —— 老会话永远拿不到调度工具");
    // MCP 协议三件套：POST（JSON-RPC）+ GET（SSE 长连接，引擎 rmcp 客户端必开，缺了报
    // "fail to get common stream: Unexpected content type: None"）+ DELETE（会话终止）
    /text\/event-stream/.test(mainSrc9) && /req\.method === "GET"/.test(mainSrc9)
      ? ok("★ /mcp 端点提供 SSE 长连接（引擎 streamable-http 客户端必需）")
      : fail("缺 SSE 端点 —— 引擎连上也会立刻报 content type 错误");
    // 固定端口 + 令牌持久化：url 跨运行必须稳定，否则引擎连上一次运行的死端口
    /DISPATCH_FIXED_PORT/.test(mainSrc9) && /dispatch-token\.txt/.test(mainSrc9)
      ? ok("★ 调度 MCP 端口固定 + 令牌持久化（config 的 url 跨运行稳定）")
      : fail("端口/令牌每次变化 —— 引擎会连死端口，工具注册不上");
    /ownedMcpServers\.has\(ownedBase\)/.test(mainSrc9)
      ? ok("★ MCP 子段按 base 名归属（harness-dispatch.env 不再被当用户段拼回 → 重复键）")
      : fail("MCP 子段归属判定缺失 —— config.toml 会写出重复段，引擎拒载整份配置");
    // 09-16 用户实测「Codex 说归档了但侧栏还在」：MCP 归档端必须真调引擎 thread/archive，
    // 只标登记表的话侧栏（archived:false 过滤）不生效。
    /agent_archive_sessions/.test(mainSrc9) && /server\.request\("thread\/archive"/.test(mainSrc9)
      ? ok("★ 调度归档真调引擎 thread/archive（只标登记表 → 侧栏不消失）")
      : fail("归档只标登记表 —— 侧栏会话不会消失（09-16 用户实测踩过）");
    // 09-16 用户要求「调度完头像停留 20 秒，方便用户查看内容」
    /DELEGATE_RAIL_LINGER_MS/.test(appSrc9) && /20\d\d\d/.test(appSrc9)
      ? ok("★ 调度头像轨跑完停留 20 秒（用户要求：方便查看内容）")
      : fail("头像跑完立刻消失 —— 用户没时间看内容");
    /dispatchMcpCount !== 1/.test(mainSrc9)
      ? ok("★ 启动自愈检测调度 MCP 段缺失/重复（老配置自动重写）")
      : fail("启动自愈不检测调度 MCP 段 —— 老配置永远不会被修复");
    /canDispatchFrom\(/.test(mainSrc9) && /delegateRegistry\.register/.test(mainSrc9)
      ? ok("主进程调度入口接了硬闸与登记表")
      : fail("主进程没接硬闸 —— 只靠提示词拦不住");
    /\.\.\.\(teamTools\.length \? \{ dynamicTools: teamTools \} : \{\}\)/.test(mainSrc9)
      ? ok("dynamicTools 只给专家团主理人会话（其余被调会话一律不带调度工具）")
      : fail("dynamicTools 传参条件变了 —— 确认没有给执行型会话挂调度工具");
    // .d.mts 同步守卫（09-15 踩坑：allowJs=false，改了 .mjs 不改 .d.mts 会报 has no exported member）
    const dmts9 = readFileSync(join(ROOT, "src/lib/thread-runtime.d.mts"), "utf8");
    /dispatch: DispatchConfig/.test(dmts9) && /emptyDispatch\(\): DispatchConfig/.test(dmts9) && /dispatchSignature\(raw: unknown\): string/.test(dmts9)
      ? ok("thread-runtime.d.mts 已同步 dispatch 声明（.mjs 导出必须有配套 .d.mts）")
      : fail("thread-runtime.d.mts 缺 dispatch 声明 —— TS 会报 has no exported member");
    // ⛔ 「开关确认后重放 resume 同步工具面」是假绿（09-16 四个决定性实验：resume/fork/
    // turn/start/queue/start 都不认 dynamicTools，引擎只在 thread/start 收）—— 已改为 MCP 通道。
    // 这里钉住教训：applyDispatch 里不允许再出现「resume 补注册工具」的复活。
    !/resumeThreadLight\(\{ threadId: id, dynamicTools/.test(appSrc9)
      ? ok("★ 已移除无效的 resume 重放（dynamicTools 只在 thread/start 生效，引擎硬约束）")
      : fail("applyDispatch 又出现了 resume 重放 —— 那条路是假绿（引擎不认）");
    typeof dp.dispatchOffNoticeText === "function" && /调度已关闭/.test(dp.dispatchOffNoticeText())
      ? ok("关闭开关也有告知文案（权限收回要立刻让对方知道）")
      : fail("缺关闭告知文案");
    /agents:off-notice/.test(mainSrc9) && /dispatchOffNotice\(/.test(appSrc9)
      ? ok("关闭告知的 IPC 链路在（main handler + 渲染层调用）")
      : fail("关闭告知链路缺失");
    // 运行状态行的词库（09-16 扩充）：规模、按活动分、不得照搬竞品原文
    const phraseBlock = /const RUN_PHRASES = \[([\s\S]*?)\];/.exec(appSrc9)?.[1] ?? "";
    const phraseCount = (phraseBlock.match(/^\s*"/gm) || []).length;
    phraseCount >= 30
      ? ok(`话语池 ${phraseCount} 条（够丰富，不容易撞句）`)
      : fail(`话语池只有 ${phraseCount} 条 —— 用户很快就会看到重复`);
    /RUN_PHRASES_BY_ACTIVITY/.test(appSrc9) && /function pickRunPhrase/.test(appSrc9)
      ? ok("按活动类型各有专属话语 + 通用池兜底")
      : fail("话语没有按活动分 —— 全是通用句，不够贴切");
    !/WorkBuddy|Claude|Cursor|Copilot|GPT/.test(phraseBlock)
      ? ok("★ 话语池不含竞品品牌名（自创文案，不照搬）")
      : fail("话语池混进了竞品品牌名 —— 必须自创");
  }
}

// 【21】模型上下文：顶层 model_context_window 必须保持「不生成 + 主动清理」（09-16 用户实测 bug）
//  背景：它是引擎的**全局单值**，一旦写下就覆盖 catalog 里每个模型各自的 context_window →
//  只有「写配置那一刻生效的模型」的上下文是对的，切到别的模型仍是旧值（UI 显示的就是它）。
//  探针实证：scripts/probe-context-window.cjs（写顶层：模型 B 的 1M 被压成 128000；不写：B → 1000000）。
//  ⚠️ 断言必须用 (cond ? ok : fail) 形式：ok()/fail() 只接受一个消息参数，写成 ok(msg, cond) 会恒绿。
{
  const mainSrc = readMainSource();
  const noGen = !/`model_context_window\s*=\s*\$\{/.test(mainSrc);
  (noGen ? ok : fail)("【21】applyCustomModel 不再生成顶层 model_context_window（生成即全局覆盖每模型上下文）");
  const hasLegacy = /const legacyContextKey\s*=/.test(mainSrc);
  (hasLegacy ? ok : fail)("【21】保留废止键残留检查 legacyContextKey（老版本写下的旧值必须主动清掉）");
  const noOldCond = !/if \(written\s*!==\s*wanted/.test(mainSrc);
  (noOldCond ? ok : fail)("【21】自愈不再用 written !== wanted 判定（不写该键后该条件恒真，会每次启动整份重写）");
  const tomlLib = readFileSync(join(ROOT, "electron/config-toml.ts"), "utf8");
  const keyKept = /HARNESS_CONFIG_KEYS\s*=\s*new Set\(\[[^\]]*"model_context_window"/.test(tomlLib);
  (keyKept ? ok : fail)("【21】HARNESS_CONFIG_KEYS 仍含 model_context_window（留着才能丢弃旧值，移出会原样拼回）");
}

/* ---------- 【126】钉顶不与折叠/流式互抢视口（09-23 深夜真机打点实锤后落守卫） ----------
 * 事故：过程段自动折叠是 ~240ms 的 grid-rows 过渡，动画每帧都让内容变矮一点 ——
 * pin-shrink-follow 在流式期间逐帧追收缩，与流式增长互抢视口：一次回合里视口被拖上去
 * 两轮（top 2461→2270 / 2684→2472）再被推回来（gap 137→44→-110→-520），即用户报的
 * 「一会在上、一会在下」。修法 = 流式期间（1.2s 内有 packet-reveal）不追收缩；
 * 且 pin-fix 的迟到 rAF 必须在「已交棒」时退出（实测 pad 被踹得 111→147→111 翻烙饼）。 */
{
  const bottomSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "02-seg", "01-hook-events-bottom-state.tsx"), "utf8").replace(/\r/g, "");
  const pinSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part03", "01-remote-bot-pin", "02-pin-scroll-anchor.tsx"), "utf8").replace(/\r/g, "");
  /* ① 流式静默门：pin-shrink-follow 的条件里必须有 lastRevealAt 时效判定（剥离注释再验，
     注释里含同名字串会自造假绿 —— 09-23 已踩过一次）。
     ⛔ 09-26 起判据是**分相位**的 followDist：交棒前（钉顶期）= bodyDist（正文底，思考不取消
        钉顶）；交棒后（锚点已滚出视口）= 全量 dist（新思考卡必须跟 —— 用户截图：交棒后
        新思考卡被窗口底裁掉）。判据锚 handedOver 接线，缺它 = 跟随期思考永远不跟。 */
  const codeOnly = bottomSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  (/const handedOver = bag\.pinGapLockedRef\.current !== null && bag\.pinGapLockedRef\.current === bag\.pinnedAnchorKeyRef\.current;/.test(codeOnly) ? ok : fail)(
    "【126】跟随判据分相位：交棒信号（gap 锁 === 当前锚 key）必须存在（交棒后新思考卡才跟）"
  );
  (/const followDist = handedOver \? dist : bodyDist;/.test(codeOnly) ? ok : fail)(
    "【126】followDist 必须由 handedOver 决定（交棒后用全量 dist —— 写死 bodyDist = 截图事故本身）"
  );
  (/shrankBy > 1 && followDist > 0 && Date\.now\(\) - lastRevealAt > 1200/.test(codeOnly) ? ok : fail)(
    "【126】pin-shrink-follow 在流式期间不追折叠收缩（1.2s 内有揭示就跳过，缺口由文字增长填平）"
  );
  /* ② lastRevealAt 必须真的有人写（packet-reveal 的 rAF 里置时刻）——门没数据源 = 恒假绿 */
  (/const onPacketReveal = \(\) => requestAnimationFrame\(\(\) => \{\s*\n\s*lastRevealAt = Date\.now\(\);/.test(bottomSrc) ? ok : fail)(
    "【126】lastRevealAt 在 onPacketReveal 里置时刻（静默门的数据源）"
  );
  /* ③ pin-fix 迟到 rAF 的交棒守卫：锁在手上就退出，不许与 pad-shrink 抢写 */
  (/if \(bag\.pinGapLockedRef\.current !== null && bag\.pinGapLockedRef\.current === bag\.pinnedAnchorKeyRef\.current\) return;/.test(pinSrc) ? ok : fail)(
    "【126】pin-fix 的 rAF 在已交棒（gap 锁定）时退出 —— 迟到的纠偏会与 pad-shrink 逐帧互踹"
  );
  /* ④ 反向绊线：pin-shrink-follow 的条件不许被改回「无条件追收缩」（那会当场回到翻转形态） */
  (!/if \(prevBottom && shrankBy > 1 && followDist > 0\) \{/.test(codeOnly) ? ok : fail)(
    "【126】pin-shrink-follow 不许回到无条件的「变矮就追」（就是上下翻转事故本身）"
  );
}

/* ══ 【139】移动远控的控制面凭据不得只凭 deviceId 换发（09-24，评估报告 §1）══
   漏洞形态：`/api/pair` 免鉴权 + 「老朋友」快路只验 `approved.has(deviceId)` 就 grantCookies。
   因 accessToken 每次启动重生成、deviceId 却**永久持久化无过期**，该快路会用长期不变的 deviceId
   现场重铸全新有效 token ⇒ deviceId 泄露一次 = 永久访问权；而 deviceId 是客户端自造的非秘密，
   局域网 http 回退还明文过网。拿到凭据即可 new-thread + send-message，而手机新建的会话固定是
   `approvalPolicy:"never"` + `sandbox:"danger-full-access"` ⇒ 宿主机任意命令执行。
   修法 = 配对时下发设备秘密（服务端只留 sha256），快路必须同时持有它。 */
{
  const remoteSrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  const pairAt = remoteSrc.indexOf('url.startsWith("/api/pair")');
  const statusAt = remoteSrc.indexOf('if (url.startsWith("/api/pair-status"))');
  const fast = pairAt >= 0 && statusAt > pairAt ? remoteSrc.slice(pairAt, statusAt) : "";
  (/\bsecretHash\b/.test(fast) && /timingSafeEqual/.test(fast) ? ok : fail)(
    "【139】「老朋友」快路必须同时验设备秘密（常量时间比对）—— 只认 deviceId 等于把一次性泄漏放大成永久访问权"
  );
  (!/approved\.has\(deviceId\)\)\s*\{[\s\S]{0,200}?grantCookies\(/.test(fast) ? ok : fail)(
    "【139】不得退回「只看 approved.has(deviceId) 就 grantCookies」的形态（漏洞本体）"
  );
  (/secretHash: sha256Hex\(secret\)/.test(remoteSrc) && /randomBytes\(32\)/.test(remoteSrc) ? ok : fail)(
    "【139】审批时生成设备秘密且**只存 sha256**（明文不进持久化文件）"
  );
  (/secretHash\?: string/.test(remoteSrc) ? ok : fail)(
    "【139】历史记录兼容：secretHash 可选 ⇒ 老设备自动回落完整配对，而不是被静默承认"
  );
  (remoteSrc.includes("deviceSecret: issuedSecret") ? ok : fail)(
    "【139】/api/pair-status 一次性交付秘密（随后随请求记录一起删除）"
  );
  (/KEY_SECRET/.test(remoteSrc) ? ok : fail)(
    "【139】配对页存下秘密（只存服务端不存手机 = 老朋友永远认不出来，功能直接坏）"
  );
}

/* ══ 【140】看门狗是**有意停用**的，不得被"顺手接回来"（09-24，评估报告 §4.1 复核结论）══
   评估报告原判"死代码 / 开关骗人"，复核后**推翻**：startWatchdog/stopWatchdog 是空实现，
   但那是 2026-09-09 **用户拍板**的整体移除 —— 原因是心跳误判（MCP worker 慢/忙时 thread/list
   超时）会触发无意义重启、丢掉全部内存线程 ⇒ **用户会话莫名跳回欢迎页**。
   ⇒ 正确做法是把残留的误导性注释与设置项说明改写清楚，而**不是**把心跳接回来。
   本守卫把这个决策钉住：谁要恢复，必须先让这条变红并回答"忙碌闸怎么办"。 */
{
  const serverSrc = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  (/startWatchdog\(\) \{\}/.test(serverSrc) && /stopWatchdog\(\) \{\}/.test(serverSrc) ? ok : fail)(
    "【140】看门狗保持有意停用（空实现）—— 恢复必须先加忙碌闸，否则会打断运行中的会话/丢内存线程"
  );
  (!/this\.heartbeatTimer = setInterval/.test(serverSrc) ? ok : fail)(
    "【140】不得把 heartbeat 接回定时器（心跳误判 = 用户会话莫名跳回欢迎页，09-09 已拍板移除）"
  );
  (/看门狗已整体移除/.test(serverSrc) ? ok : fail)(
    "【140】保留「为什么移除」的原始取证注释（删了就没人知道这是刻意的）"
  );
  const settingsSrc = readFileSync(join(ROOT, "electron", "app-settings.ts"), "utf8");
  (/engineWatchdog: ⛔ \*\*已停用/.test(settingsSrc) ? ok : fail)(
    "【140】app-settings 的 engineWatchdog 说明必须写明「已停用」（不能继续声称它工作）"
  );
  const refsSrc = readFileSync(join(ROOT, "electron", "runtime-refs.ts"), "utf8");
  (/startWatchdog\/stopWatchdog` 目前是\*\*空实现\*\*/.test(refsSrc) ? ok : fail)(
    "【140】runtime-refs 的 syncEngineWatchdog 注释必须写明它当前什么都不做"
  );
  /* 反向绊线：没有任何界面把它渲染成"可用开关"（否则等于给用户一个假承诺）。
     ⛔ 排除 *.d.ts：vite-env.d.ts 是**生成的设置形状镜像**，出现字段名不等于渲染开关。 */
  const uiHits = [];
  {
    const walkUi = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { walkUi(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
        if (readFileSync(p, "utf8").includes("engineWatchdog")) uiHits.push(relative(ROOT, p).replace(/\\/g, "/"));
      }
    };
    walkUi(join(ROOT, "src"));
  }
  (uiHits.length === 0 ? ok : fail)(
    `【140】渲染层不得暴露 engineWatchdog 开关（它是停用能力，暴露 = 假承诺）${uiHits.length ? "，命中：" + uiHits.slice(0, 3).join("；") : ""}`,
  );

  /* ── 【164】md 表格解析/回写（09-26 文件弹窗编辑的纯函数基座） ──
     ⛔ 硬约束：只动表格块，其余原文逐字保留；代码块里的「表格样子」绝不是数据表格。 */
  {
    const mt = await import(pathToFileURL(join(ROOT, "src/lib/md-table.mjs")).href);
    const fixture = [
      "# 标题",
      "",
      "| 项 | 内容 |",
      "| --- | --- |",
      "| 品牌 | 苏泊尔 |",
      "| 含\\|竖线 | 值2 |",
      "",
      "```md",
      "| 这 | 是 |",
      "| -- | -- |",
      "| 代码块 | 示例 |",
      "```",
      "",
      "结尾段落。",
    ].join("\n");
    const parsed = mt.parseMarkdownTables(fixture);
    (parsed.blocks.length === 1 ? ok : fail)(
      `【164】代码块里的表格不被识别（实测识别 ${parsed.blocks.length} 块，期望 1）`
    );
    (parsed.blocks[0].rows[2][0] === "含|竖线" ? ok : fail)(
      "【164】\\| 转义还原成单元格内的字面竖线（不拆列）"
    );
    const edits = parsed.blocks.map((b) => b.rows.map((r) => r.slice()));
    edits[0][1][1] = "改过的值";
    edits[0].push(["新增行", "新增值"]);
    const out = mt.renderMarkdownTables(fixture, edits);
    (out.includes("```md") && out.includes("| 这 | 是 |") && out.includes("| 代码块 | 示例 |") ? ok : fail)(
      "【164】回写时代码块逐字保留（序列化器不许碰表格块以外的行）"
    );
    (out.startsWith(fixture.slice(0, fixture.indexOf("| 项"))) && out.endsWith("结尾段落。") ? ok : fail)(
      "【164】非表格内容（标题/段落）逐字保留"
    );
    (out.includes("改过的值") && out.includes("新增行") && out.includes("含\\|竖线") ? ok : fail)(
      "【164】编辑生效且回写时重新转义字面竖线"
    );
    const reparsed = mt.parseMarkdownTables(out);
    (reparsed.blocks.length === 1 && reparsed.blocks[0].rows.length === 4 ? ok : fail)(
      "【164】回写产物可再次解析且行数正确（roundtrip 稳定）"
    );
    // ── 渲染层接线（静态）：三处断点都会让功能静默失灵 ──
    const cards = readFileSync(join(ROOT, "src/features/shared/InlineCards.tsx"), "utf8");
    ((cards.match(/onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); setMenu\(/g) || []).length >= 2 ? ok : fail)(
      `【164】消息卡片与引用行都挂了右键菜单（实测 ${(cards.match(/onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); setMenu\(/g) || []).length} 处）`
    );
    (cards.includes("openFileTextEditor(menu.path, menu.name)") ? ok : fail)(
      "【164】菜单「编辑」走 openFileTextEditor 槽位（直接 setPastedText 会绕过 kind 分流 = 读写通道错配）"
    );
    (cards.includes("window.codex.saveFileAs(menu.path)") ? ok : fail)(
      "【164】菜单「另存为」走 dialog:save-as 通道（源校验在主进程）"
    );
    (cards.includes("isEditableTextFile(menu.path)") && cards.includes("BINARY_EXTENSIONS") ? ok : fail)(
      "【164】「编辑」只对文本类文件开放（与 useFilePreview 同源口径，二进制写回即损坏）"
    );
    const dlg = readFileSync(join(ROOT, "electron/features/dialog-ipc.ts"), "utf8");
    (/dialog:save-as[\s\S]{0,600}isInsideTrustedRoots\(src\)/.test(dlg) ? ok : fail)(
      "【164】dialog:save-as 源文件必须落在可信根内（否则渲染层被注入即可把盘上任意文件拷走）"
    );
    const timeline = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8");
    (timeline.includes('pastedText.kind === "file" ? fileEditTransport : undefined') ? ok : fail)(
      "【164】kind=file 时编辑窗必须挂 fs 通道 transport（不挂 = 工作区文件写进粘贴文本目录）"
    );
  }
}
  }
}
