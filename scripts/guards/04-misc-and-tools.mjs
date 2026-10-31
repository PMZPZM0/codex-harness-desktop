/**
 * 预检守卫组：04-misc-and-tools
 * 分节：【输入框草稿 + 通知会话名前缀】【多窗口事件过滤】【工具下载源】【首启体检（已删·负向）】【工具安装验证】【15】【16】（原 L2432–L2892）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, createRequire, existsSync, fail, join, mainSrc, ok, pathToFileURL, readAppUi, readFileSync, readMainSource, readSettingsSurface, readStyles, readdirSync, relative, warn,
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
  (/showToast\("已停止限流重试", "不再自动重发该消息", threadId\)/.test(appD) && /showToast\("上游余额或订阅额度已用完"/.test(appD))
    ? ok("会话级通知调用点已带 threadId（限流等后台会话通知能看出归属；放弃文案 = 余额/额度提示，10-02 口径）")
    : fail("会话级通知调用点丢了 threadId 或余额提示文案被摘 —— 后台会话的通知看不出归属/不知道该查余额");
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
  // ② 主进程把源传下去：runtime:install 现读 + 两条通道（工具链 env / npm registry）都接线
  (/async function readDownloadSource\(\)/.test(mainSrc2) && /DOWNLOAD_SOURCE: downloadSource/.test(mainSrc2)
    && /runNpmInstall\(id, "rea-agents", "REA 逆向分析", downloadSource\)/.test(mainSrc2)
    && !/runBrowserDownload/.test(mainSrc2))
    ? ok("主进程两条下载通道都接了 downloadSource（工具链 env / npm registry；Playwright 内核已移除）")
    : fail("主进程没把下载源传下去 —— 选了源也只有部分通道生效");
  // ③ ⛔ 10-01 用户定稿：镜像切换不暴露给用户 —— 选择器必须被摘；主进程恒走国内优先 auto
  //    （老用户存过的 direct/proxy 一律作废；general 页的源标签是只读展示，不算切换入口）
  const devtoolsSrc = readFileSync(join(ROOT, "src", "features", "settings-devtools", "DevtoolsSettingsSection.tsx"), "utf8");
  (!/changeDownloadSource/.test(devtoolsSrc) && !/下载源选择/.test(devtoolsSrc) && !/value: "ghfast"/.test(devtoolsSrc))
    ? ok("开发工具页不再暴露下载源选择（统一国内镜像优先，失败自动回落官方源）")
    : fail("下载源选择器还在 —— 用户不该看到镜像切换选项");
  const drSrc = readFileSync(join(ROOT, "electron", "features", "dev-runtimes.ts"), "utf8");
  (/return "auto";/.test(drSrc) && !/source === "proxy"/.test(drSrc))
    ? ok("主进程 readDownloadSource 恒返 auto（旧存储的非国内源一律作废）")
    : fail("readDownloadSource 还在读旧存储值 —— 老用户存过的官方直连会继续生效");
}
  }

  /* ══ 【首启体检】组件已删（10-07 用户令）—— 负向防复活 ══ */
  {
console.log(C.bold("\n【首启体检】已删（10-07 用户令：有新手引导入口了）—— 防复活"));
{
  const appE = readAppUi();
  (!existsSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx")) ? ok : fail)(
    "⛔ EnvCheckDialog 组件不许复活（首启弹窗已删；新手引导 = 侧栏常驻入口）"
  );
  (!/envCheckOpen|EnvCheckDialog|installEnvMissing/.test(codeOnly(appE)) ? ok : fail)(
    "⛔ app-ui 层 env 体检状态/调用全清零（envCheckOpen 一族 / installEnvMissing / 弹窗渲染）"
  );
  (!/env-check|env-install-pill/.test(readStyles()) ? ok : fail)(
    "⛔ env-check / env-install-pill 样式全清除（防死样式回头）"
  );
  const shellSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8"));
  (/<NewbieGuide/.test(shellSrc) ? ok : fail)(
    "新手引导常驻入口在位（体检的替代物 —— 删旧必须有新：侧栏底部 NewbieGuide）"
  );
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

  /* ══ 【工具取消/卸载】10-07 重构（用户要求「实时进度+取消+卸载反馈，不允许无响应」）══ */
  {
console.log(C.bold("\n【工具取消/卸载】10-07 重构的四条不变量"));
{
  const runtimeSrc3 = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  const drSrc3 = readFileSync(join(ROOT, "electron", "features", "dev-runtimes.ts"), "utf8");
  const rtSrc3 = readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8");
  /* ⛔ 10-10 两级 IA：运行时列表搬进了「运行时与工具链」弹窗面板 —— 锚点跟着走
     （内容零改写，四个串仍在同一份实现里；断言语义不变：取消键 + 卸载行内二次确认）。 */
  const devtoolsSrc3 = readFileSync(join(ROOT, "src", "features", "settings-devtools", "RuntimeToolsPanel.tsx"), "utf8");
  const capSrc3 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "04-runtime-commands-account", "01-dev-runtimes-capability.tsx"), "utf8");
  // ① @@TARGET：下载落盘路径报给主进程 —— 取消后按它清临时文件（锚「写出行」本身，防顺手改成 console.log）
  (/process\.stdout\.write\("@@TARGET " \+ file \+ "\\n"\)/.test(runtimeSrc3))
    ? ok("install-runtimes.cjs 下载前输出 @@TARGET（取消清临时文件的锚点）")
    : fail("@@TARGET 被摘 —— 取消安装后找不到半截下载产物在哪，临时文件清不掉");
  // ② 杀进程树：安装器(node) 下面挂着 curl/7z 孙进程，只 kill 父进程留孤儿
  (/taskkill", \["\/pid", String\(child\.pid\), "\/T", "\/F"\]/.test(drSrc3) && /pkill", \["-P", String\(child\.pid\)\]/.test(drSrc3) && /@@TARGET/.test(drSrc3))
    ? ok("cancelRuntimeInstall 杀进程树（win taskkill /T / POSIX pkill）+ 解析 @@TARGET 记临时文件")
    : fail("取消安装没杀进程树或没记 @@TARGET —— 孤儿 curl 继续写文件，清理是句空话");
  // ③ runtime:cancel 通道 + 取消改判：杀进程导致的 reject 要回执 cancelled 而不是报错
  (/"runtime:cancel"/.test(rtSrc3) && /if \(isCancelRequested\(id\)\) return \{ ok: true, cancelled: true, runtimes: runtimeList\(\) \};/.test(rtSrc3) && /clearCancelRequest\(id\);/.test(rtSrc3))
    ? ok("runtime:cancel 通道在位；install 收尾把「杀进程 reject」改判成 cancelled 回执")
    : fail("runtime:cancel 没接全 —— 取消后用户看到的是一句安装报错而不是「已取消」");
  // ④ 卸载进度：大目录逐文件删要几秒，必须分批发 percent（不允许无响应状态）
  (/async function removeTargetsWithProgress/.test(rtSrc3) && /stage: "正在删除文件", percent/.test(rtSrc3) && /await removeTargetsWithProgress\(id, targets\);/.test(rtSrc3))
    ? ok("卸载走 removeTargetsWithProgress（分批删 + 按字节比例发进度）")
    : fail("卸载又变回一把 fs.rm 了 —— 大目录删几秒全程无反馈（用户明确点名不允许）");
  // ⑤ 渲染层：取消按钮 + 卸载行内二次确认 + cancelled 事件处理，三件都在
  (/runtime-cancel/.test(devtoolsSrc3) && /cancelDevRuntime\(runtime\.id\)/.test(devtoolsSrc3) && /confirmUninstall === runtime\.id/.test(devtoolsSrc3) && /确认卸载/.test(devtoolsSrc3))
    ? ok("工具卡：安装中给「取消」，卸载先行内二次确认（真删不可恢复）")
    : fail("工具卡取消/二次确认被摘 —— 卸载一击即删、下载停不下来都是回潮");  (/if \(event\.cancelled\)/.test(capSrc3) && /已取消下载，临时文件已清理/.test(capSrc3) && /bag\.setRuntimeUninstalling/.test(capSrc3))
    ? ok("进度事件处理：cancelled 分支回落状态并提示（取消 ≠ 失败）")
    : fail("渲染层没处理 cancelled 事件 —— 取消后「正在安装」挂着不动（无响应状态）");
  // ⑥ 通道账本：runtime 前缀 5 条（【2】只验 manifest 自洽，这里钉人读的账本别漏登记）
  (/prefix: "runtime", count: 7/.test(readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8")) && /"runtime:cancel"/.test(readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8")))
    ? ok("ipc-registry runtime 账本 count=7（含 10-12 的 update-check/update）且含 runtime:cancel")
    : fail("runtime 账本没登记 runtime:cancel —— 预检【2】会红，且读账本的人不知道有这条通道");
}

/* ── 【dtIA】开发工具页 = 两级信息架构（10-10 用户要求）──────────────────────────
   「一级主界面以分类卡片展示各功能板块，点击卡片后通过二级弹窗展示对应内容，
    弹窗内容**不得内嵌**到主界面中」。
   ⛔ 为什么必须钉：这类"看起来只是排版"的改版最容易在后续维护里被顺手退回 ——
   往一级页里塞回一块面板只是一行 JSX 的事，而 tsc 与视觉测试都看不出来
   （退回去就是用户 10-10 反馈的那条长滚动堆叠）。 */
console.log(C.bold("\n【dtIA】开发工具页两级 IA 契约"));
{
  const dtPage = readFileSync(join(ROOT, "src", "features", "settings-devtools", "DevtoolsSettingsSection.tsx"), "utf8");
  const dtReg = readSettingsSurface();
  const dtCss = readFileSync(join(ROOT, "src", "styles", "34-devtools-cards.css"), "utf8");
  const dtStylesEntry = readFileSync(join(ROOT, "src", "styles.css"), "utf8");

  /* ① 一级 = 卡片网格：6 张分类卡，且每张卡都有对应的弹窗分支（key 一一对应） */
  const CARD_KEYS = ["runtime", "capability", "phone", "laya", "domains", "plugins"];
  const missingCard = CARD_KEYS.filter((k) => !new RegExp(`key: "${k}"`).test(dtPage));
  (missingCard.length === 0 ? ok : fail)(`一级页 6 张分类卡片齐全（缺：${missingCard.join("/") || "无"}）`);
  /* 结构指纹：卡片用 `data-card={card.key}` 渲染（DOM 上可定位）—— 后续 UI 断言靠它选元素。 */
  (/data-card=\{card\.key\}/.test(dtPage) ? ok : fail)("卡片网格以 card.key 渲染 data-card（DOM 定位锚）");
  const missingDialog = CARD_KEYS.filter((k) => !new RegExp(`openCard === "${k}"`).test(dtPage));
  (missingDialog.length === 0 ? ok : fail)(`每张卡片都有对应的二级弹窗分支（缺：${missingDialog.join("/") || "无"}）`);

  /* ② ⛔⛔ 内容只在弹窗里：四个面板组件 + 两个声明式插槽都必须紧跟在自己的弹窗分支内 */
  const inDialog = (name) => new RegExp(`openCard === "[a-z]+"[\\s\\S]{0,700}?${name}`).test(dtPage);
  const panelNames = ["RuntimeToolsPanel", "CapabilityChainPanel", "PhoneHarnessCard", "LayaCard"];
  const leaked = panelNames.filter((n) => !inDialog(n));
  (leaked.length === 0 ? ok : fail)(`⛔ 四个面板只在弹窗分支里渲染（漏回一级页的：${leaked.join("/") || "无"}）`);
  (inDialog("settings.devtools.bottom") && inDialog("settings.devtools.declared-plugins") ? ok : fail)(
    "⛔ 两个声明式插槽的消费点也在弹窗里（一级页不放 ⇒ 同一 id 全局只消费一次）"
  );
  (/<SettingsDialog/.test(dtPage) ? ok : fail)("二级载体统一走 SettingsDialog（⛔ 不许各面板自造弹窗 —— 规范要一致）");

  /* ③ 注册表不再消费这两个插槽（消费点已移进弹窗；id 与注册方式不变 ⇒ 声明式插件照旧能挂） */
  (!/settings\.devtools\.(bottom|declared-plugins)/.test(codeOnly(dtReg)) ? ok : fail)(
    "⛔ 注册表不再渲染这两个插槽（否则同一 id 被消费两次 ——【268-c】红，且功能域会画两遍）"
  );

  /* ④ 视觉规范：卡片 / 弹窗样式在独立样式表里，且已接进入口（⛔ @import 次序即级联优先级） */
  (/\.devtools-card\b/.test(dtCss) && /\.settings-dialog-backdrop\b/.test(dtCss) && /z-index:\s*900/.test(dtCss) ? ok : fail)(
    "卡片与弹窗样式齐备（弹窗遮罩 z=900 —— 设置内弹窗档，与 memory 系弹窗同规范）"
  );
  (/styles\/34-devtools-cards/.test(dtStylesEntry) ? ok : fail)("样式表已接进 src/styles.css");
}

/* ── 【extIA】拓展接口页 = 两级信息架构（10-10 用户要求，与开发工具页同一套规范）────────
   「一级主界面以分类卡片展示各功能板块，点击卡片后通过二级弹窗展示对应内容，
    弹窗内容**不得内嵌**到主界面中」。
   ⛔ 为什么钉：往一级页塞回一块明细只是一行 JSX 的事，tsc 与视觉测试都看不出来；
     而且这是**第二个**做两级 IA 的页面 —— 顺带钉住"两页共用同一套组件与 CSS"
     （各写一套 = 从第一天起埋下规范漂移的种子）。
   ⛔ 位置说明：本块**不能**放 09-structural（它在【265】"只许缩不许长"的棘轮名单里，
     加断言会把行数顶上去直接红）—— 与【dtIA】同族，统一放在这里。 */
console.log(C.bold("\n【extIA】拓展接口页两级 IA 契约"));
{
  const extSrc = readFileSync(join(ROOT, "src", "features", "settings-extensibility", "ExtensibilitySettingsSection.tsx"), "utf8");
  const extCss = readFileSync(join(ROOT, "src", "styles", "34-devtools-cards.css"), "utf8");
  (/className="settings-cards"/.test(extSrc) && /className="settings-card"/.test(extSrc) ? ok : fail)(
    "一级用通用分类卡片（.settings-card*）"
  );
  (/data-group=\{card\.group\}/.test(extSrc) && /EXTENSIBILITY_GROUPS/.test(extSrc) ? ok : fail)(
    "卡片按 catalog 的分组生成（⛔ 分类不许在页面里另写一份）"
  );
  /* ⛔⛔ 明细只在弹窗里：ext-item 必须出现在 <SettingsDialog> 之后（即弹窗分支内）。 */
  const dialogAt = extSrc.indexOf("<SettingsDialog");
  const itemAt = extSrc.indexOf('className="ext-item"');
  (dialogAt > 0 && itemAt > dialogAt ? ok : fail)(
    "⛔ 拓展点明细只渲染在二级弹窗里（⛔ 不内嵌回一级页 —— 那正是用户反馈的长滚动堆叠）"
  );
  (dialogAt > 0 ? ok : fail)("二级载体统一走 SettingsDialog（⛔ 不许自造弹窗：与开发工具页共用一套规范）");
  /* ⛔ 换行必须容错（`\r?\n`）：主仓工作区是 LF、PPcode 副本是 CRLF —— 锚死 `\n` 会让
     同一条断言在主仓绿、在副本红（10-10 实测：PPcode check 多出这一条红）。
     10-11 选择器收窄成 `button.settings-card`（裸 `.settings-card` 把控制台页的
     div 信息卡也压成了竖排标签 —— 用户截图实测），断言跟着锚新形态。 */
  (/\.devtools-card,\r?\nbutton\.settings-card \{/.test(extCss) ? ok : fail)(
    "⛔ 两页卡片样式**同源**（button.settings-card / .devtools-card 是同一份 CSS 的并列选择器；⛔ 不许退回裸 .settings-card —— 那会把 div 信息卡也压扁）"
  );
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
  (/setEditingProvider\(p\.provider\)/.test(swBlock) || (/selectProviderDraft\(p, isPseudoPptoken\)/.test(swBlock) && /setEditingProvider\(p\.provider\)/.test(providerSwitchHost)))
    ? ok("开关的 onClick 里确实切了编辑对象（setEditingProvider；大卡片经 selectProviderDraft 单源）")
    : fail("开关 onClick 里没有切编辑对象 —— 详情不会跟随");
  const ppEndpointsSrc = readFileSync(join(ROOT, "src", "lib", "pptoken-endpoints.ts"), "utf8");
  ((ppEndpointsSrc.includes('url: "https://cn.pptoken.cc/v1"')
    && ppEndpointsSrc.indexOf('url: "https://cn.pptoken.cc/v1"') < ppEndpointsSrc.indexOf('url: "https://api.pptoken.cc/v1"')
    && providerSwitchHost.includes("PPTokenEndpoints[0].url")
    && !providerSwitchHost.includes('baseUrl: "https://api.pptoken.cc/v1"')) ? ok : fail)(
    "【15】PPtoken 默认 API = 大陆线路（端点表默认 cn，供应商卡不再写死 api）"
  );
  const providerHookSrc15 = readFileSync(join(ROOT, "src", "hooks", "useModelProviders.ts"), "utf8");
  const providerEventSrc15 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8");
  (!providerSwitchHost.includes('disabled={!isPseudoPptoken && p.enabled === false && customModel != null && customModel.provider !== p.provider}')
    && !providerSwitchHost.includes('customDraft.enabled === false && customModel != null && customModel.provider !== editingProvider') ? ok : fail)(
    "【15】启用新供应商不被 UI 禁用（主进程会自动停用旧的，不让用户先手动关）"
  );
  (providerHookSrc15.includes("cloudModelsSync") && /customDraft\.provider === "cloud"/.test(providerHookSrc15) ? ok : fail)(
    "【15】云端供应商刷新走 cloud-models 目录（⛔ 不再拿 /models 探活）"
  );
  (/provider-activated[\s\S]{0,400}?refreshActive/.test(providerEventSrc15) ? ok : fail)(
    "【15】provider-activated 后刷新整张供应商列表（旧开关同步变灰）"
  );
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

  /* ══ 【230】造梦师技能内置（09-30 用户：「zy-cinematic-realism 这个技能很火，给专家安排上 +
     顺便做成内置技能」）══ 技能树随包分发（resources/expert-skills/，CC BY-NC 4.0），
     画意 / 剪承团按场景点名 + 绝对路径兜底；引擎侧整树复制进 codexHome/skills。 */
  {
    const skillMd230 = join(ROOT, "resources", "expert-skills", "zy-cinematic-realism", "SKILL.md");
    (existsSync(skillMd230) && /^name:\s*zy-cinematic-realism/m.test(readFileSync(skillMd230, "utf8")) ? ok : fail)(
      "【230】造梦师技能树随包分发（resources/expert-skills/…/SKILL.md 存在且 frontmatter name 正确）"
    );
    const market230 = JSON.parse(readFileSync(join(ROOT, "resources", "expert-skills", ".claude-plugin", "marketplace.json"), "utf8"));
    (Array.isArray(market230.plugins) && market230.plugins.some((p) => p.name === "zy-cinematic-realism") ? ok : fail)(
      "【230】expert-skills 市场清单已登记（漏登记 = 引擎发现不了这个技能包）"
    );
    (/zy-cinematic-realism/.test(readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8")) ? ok : fail)(
      "【230】THIRD_PARTY_NOTICES 已登记（CC BY-NC 4.0 —— NC 许可不署名 = 违约）"
    );
    if (et && typeof et.imageGenExpert === "function" && typeof et.videoProductionTeam === "function") {
      const fake230 = "D:/fake-root/resources/expert-skills";
      const gen230 = et.imageGenExpert((p) => p, fake230);
      (gen230.lead.systemPrompt.includes(fake230 + "/zy-cinematic-realism") && /造梦师/.test(gen230.lead.systemPrompt) ? ok : fail)(
        "【230】画意按场景点名造梦师且绝对路径从参数拼出（写死 = 搬家后静默读不到）"
      );
      const vid230 = et.videoProductionTeam((p) => p, fake230);
      (vid230.lead.systemPrompt.includes(fake230 + "/zy-cinematic-realism") && /Base Lock/.test(vid230.lead.systemPrompt) ? ok : fail)(
        "【230】剪承团首帧链路点名造梦师（Base Lock + Shot Delta 接首帧锚定规则）"
      );
    } else {
      warn("【230】dist-electron 未构建 ⇒ 跳过专家接线真行为断言");
    }
    const bs230 = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
    (/ensureBuiltinSkillDirs\(skillsDir\)/.test(bs230) && bs230.includes("zy-cinematic-realism") ? ok : fail)(
      "【230】builtin-skills 接入目录型内置（ensureBuiltinSkillDirs 未接线 = codexHome/skills 里永远没有造梦师）"
    );
    /* 【229】内置技能中文导读全覆盖（09-30 用户：「内置技能都加上中文注释」）：
       entries 名单与 00-skill-zh-notes.ts 的 keys 一一对应 —— 漏一个 = 那个技能没有中文导读。
       ⛔ 抽名只在 entries 数组块内做（RETIRED_SKILLS 也是 [name, *_SKILL] 形状，但退役技能不落盘、不需要导读）。 */
    const entriesBlock230 = /const entries: \[string, string\]\[\] = \[([\s\S]*?)\n  \];/.exec(bs230)?.[1] ?? "";
    const entryNames230 = [...entriesBlock230.matchAll(/\["([a-z0-9-]+)",\s*[A-Z0-9_]+_SKILL\]/g)].map((m) => m[1]);
    const noteKeys230 = [...readFileSync(join(ROOT, "electron", "builtin-skills", "00-skill-zh-notes.ts"), "utf8").matchAll(/^  "([a-z0-9-]+)":/gm)].map((m) => m[1]);
    (entryNames230.length > 0 && entryNames230.every((n) => noteKeys230.includes(n)) ? ok : fail)(
      `【229】内置技能中文导读全覆盖（entries ${entryNames230.length} 个 / notes ${noteKeys230.length} 个；缺：${entryNames230.filter((n) => !noteKeys230.includes(n)).join(",") || "无"}）`
    );
    /* ⛔ # 面板保底名单同步（09-30 用户：「就算是内置，也要在#面板里面透出来」）：
       constants 的 BUILTIN_DISTRIBUTED_SKILLS 必须 = 00-skill-zh-notes keys + 目录型内置（zy）——
       名单漏一个 = 那个内置技能在 # 面板缺席（引擎清单要等重扫，保底是唯一无条件透出的通道）。 */
    const fallback230src = readFileSync(join(ROOT, "src", "features", "app-view", "constants", "01-notices-labels.tsx"), "utf8");
    const fbBlock230 = /export const BUILTIN_DISTRIBUTED_SKILLS: string\[\] = \[([\s\S]*?)\];/.exec(fallback230src)?.[1] ?? "";
    const fbNames230 = [...fbBlock230.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    const expected230set = new Set([...noteKeys230, "zy-cinematic-realism"]);
    (fbNames230.length === expected230set.size && fbNames230.every((n) => expected230set.has(n)) ? ok : fail)(
      `【229】# 面板保底名单与内置技能一一对应（名单 ${fbNames230.length} 个 / 应为 ${expected230set.size} 个；缺：${[...expected230set].filter((n) => !fbNames230.includes(n)).join(",") || "无"}）`
    );
    (/BUILTIN_DISTRIBUTED_SKILLS\] push\(\{ name \}\)|for \(const name of BUILTIN_DISTRIBUTED_SKILLS\) push/.test(readAppUi()) ? ok : fail)(
      "【229】mergedSkillCatalog 已接保底透出（名单加了但没合并 = 白搭）"
    );
  }
}

// ---------- 【17】回合时序规范化（09-15「更早消息按钮与内容对不上」修复的纯逻辑守卫） ----------
{
  const { orderTurnsByTime, mergeTurnListsById, visibleTurnWindow, turnHistoryPlan } = await import("../../src/lib/turn-order.mjs");
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
  /* 10-21 虚拟滚动条：窗口上方还有多少回合 = 已加载但被窗口截掉 + 元数据里更早且未加载。
     ⛔ 元数据里的重复/更新条目不能重复计数；没有游标时（历史已全量）旧元数据不许撑出空白。 */
  const stubs15 = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, startedAt: 1000 + i }));
  const loaded10 = Array.from({ length: 10 }, (_, i) => mk(`t${i + 5}`, 1005 + i));
  const planA = turnHistoryPlan(stubs15, loaded10, 5, true);
  planA.hiddenLoaded === 5 && planA.hiddenStubs === 5 && planA.hiddenCount === 10 && planA.visible[0]?.id === "t10"
    ? ok("turnHistoryPlan：窗口上方 = 已加载隐藏 5 + 未加载元数据 5（总 10）")
    : fail("turnHistoryPlan 计数不对 —— 滚动条覆盖的历史条数会偏（用户要的「知道回合条数」失效）");
  const planNoMore = turnHistoryPlan(stubs15, loaded10, 5, false);
  planNoMore.hiddenStubs === 0 && planNoMore.hiddenCount === 5
    ? ok("turnHistoryPlan：没有游标时忽略未加载元数据（revert 旧条目不会撑出永远加载不出的空白）")
    : fail("无游标时仍按旧元数据算未加载回合 —— revert 后会留下永远加载不出的占位区");
  const staleStubs = Array.from({ length: 21 }, (_, i) => ({ id: `t${i}`, startedAt: 1000 + i }));
  const planStale = turnHistoryPlan(staleStubs, loaded10, 5, true);
  planStale.hiddenCount === 10
    ? ok("turnHistoryPlan：比窗口新的陈旧/直播元数据不计入上方占位")
    : fail("turnHistoryPlan 把窗口之后的元数据也算进了上方隐藏数 —— 占位区高度会失真");
  const dupStubs = [...stubs15, ...loaded10.map((t) => ({ id: t.id, startedAt: t.startedAt }))];
  turnHistoryPlan(dupStubs, loaded10, 5, true).hiddenCount === 10
    ? ok("turnHistoryPlan：已加载回合在元数据里出现时不重复计数")
    : fail("turnHistoryPlan 重复计数已加载回合 —— 占位区会多出一截");
  /* 滑窗：tail=2 时窗口整体上移，最新 2 个折进底部占位区；上方已加载 3 + 未加载 5。 */
  const slidePlan = turnHistoryPlan(stubs15, loaded10, 5, true, 2);
  slidePlan.visible[0]?.id === "t8" && slidePlan.hiddenLoaded === 3 && slidePlan.hiddenStubs === 5
    && slidePlan.hiddenCount === 8 && slidePlan.hiddenBelow === 2
    ? ok("turnHistoryPlan 滑窗：tail=2 ⇒ 窗口 t8..t12，上方 3+5、下方 2（DOM 恒 5 个回合）")
    : fail("turnHistoryPlan 滑窗切片/计数不对 —— 全量加载后又会把整段历史挂进 React");
  const clampPlan = turnHistoryPlan(stubs15, loaded10, 5, true, 99);
  clampPlan.visible[0]?.id === "t5" && clampPlan.hiddenBelow === 5
    ? ok("turnHistoryPlan 滑窗：tail 被钳到 len−窗口大小（不会把窗口滑出列表）")
    : fail("turnHistoryPlan 未钳制 tail —— 越界空白/丢回合");
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
  /\.turn-group\.running[^{}]*\{[^{}]*content-visibility:\s*visible/.test(css) && /\.timeline \.turn-group[^{}]*\{[^{}]*content-visibility:\s*visible/.test(css)
    ? ok("流式/时间线历史回合用真实高度（content-visibility: visible）—— 不会高度塌陷/上滚被顶飞")
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
      ? ok("★ L3 拒绝文案指向真实入口（顶栏调度开关）")      : fail("调度权限恢复文案未指向顶栏 —— 开关只在顶栏渲染，用户找不到");
    /* ⛔ 10-11 用户报「独立弹窗里少了两个图标」⇒ 🔍 搜索与调度开关改为**主窗口与独立弹窗都渲染**
       （此前弹窗分支把整簇换成只剩「返回主应用」）。判据打在**位置关系**上：这两处必须在
       弹窗三元 `{bag.popoutThreadId ? (` **之外** —— 放回分支里就又会只剩一个按钮。
       ⛔ 顺序类断言先确认两个锚都在，别被 `indexOf` 的 -1 骗成恒真（本仓踩过这个假绿形态）。
       ⛔ 这里读**该文件原文**而不是 `readAppUi()`：聚合器对 `app-state/parts/**` 会剥掉 `bag.` 前缀
          （见 `_ctx.mjs` 的说明），带前缀的字面量在聚合面上永远匹配不到 —— 位置类断言本就该锚本文件。 */
    const seg09 = codeOnly(readFileSync(join(ROOT, "src/features/app-state/parts/part09/02-seg.tsx"), "utf8"));
    const ternIdx9 = seg09.indexOf("{bag.popoutThreadId ? (");
    const searchIdx9 = seg09.indexOf('className="history-search-wrap"');
    const dispatchIdx9 = seg09.indexOf("<DispatchMenu");
    ternIdx9 > 0 && searchIdx9 > 0 && dispatchIdx9 > 0 && searchIdx9 < ternIdx9 && dispatchIdx9 < ternIdx9
      ? ok("★ 🔍 搜索与调度开关在弹窗三元**之外**（两个窗口都渲染）")
      : fail("搜索/调度又回到 popout 分支里了 —— 独立弹窗会只剩「返回主应用」");
    /bag\.popoutThreadId \? \(\s*<button className="icon-button popout-return-btn"[\s\S]{0,400}?popout-open-btn/.test(seg09)
      ? ok("★ 弹窗三元只二选一「返回主应用 / 独立弹窗」两个按钮（别的按钮别塞回分支里）")
      : fail("弹窗三元里塞了别的按钮 —— 两个窗口的顶栏会不一致");
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
    /* 10-29 定稿：没有总开关；专家/子智能体恒在，专家团按 team 过滤（连旧记录里的 false 也不生效）。 */
    const dflt9 = dp.filterTargetsBySwitch(targets9, { enabled: false });
    dflt9.length === 2 && dflt9[0].kind === "expert"
      ? ok("默认目录 = 专家 + 子智能体（旧记录的 enabled 不再影响）") : fail("默认目录不对 —— 专家/子智能体应当恒在、专家团默认不在");
    const withTeam = dp.filterTargetsBySwitch(targets9, { enabled: true, expert: false, team: true, subagent: false });
    withTeam.length === 3
      ? ok("开启专家团后三类都在（旧记录里被关掉的专家/子智能体也算开）")
      : fail("专家团开启后目录不全");
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
    /* ⛔⛔ 10-04 用户拍板「调度开关就要对应生效工具，这个联动必须做好」——
       原判据（委派会话不注册 subAgentTools）已过时：那条通道**整体删除**了。为什么必须删：
       `subagent_invoke` 与「调度」开关**完全脱钩**（只要存在已启用子智能体就永远在，与总开关
       和「子智能体」勾选毫无关系），还与 MCP 的 agent_invoke 形成**两套调度工具**
       ⇒ 模型只挑名字最直白的那个，专家 / 专家团永远被绕过
       （用户症状：「只能调度子智能体」「取消了勾选还是它」「工具都乱了不知道用哪个」）。 */
    !/subagent_invoke/.test(codeOnly(appSrc9))
      ? ok("★ 单一调度通道：渲染层不再注册 subagent_invoke（三类并入 agent_invoke）")
      : fail("渲染层仍有 subagent_invoke —— 脱钩的旧通道会让模型只调子智能体");
    /* ⛔⛔ 通道侧也要断根（只删渲染层工具不够）：`subagents:invoke` 这条 IPC 仍然暴露给渲染层，
       它是**绕过全部调度闸门**的旁路 —— 不查「调度」勾选、不过 canDispatchFrom（身份/深度/独占锁）、
       **更不登记 delegateRegistry** ⇒ 它派出的会话不缩进在发起会话下面、也不上调度头像轨
       （用户症状同源：「被调度会话还不在主会话下面」—— 真机数据佐证：`delegate-threads.json`
       里 kind=subagent 的记录恒为 0）。⇒ 两条断言：通道不许复活 + 域不许再直连引擎派活。 */
    {
      const manifestJson = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
      const subagentsSrc = readFileSync(join(ROOT, "electron", "features", "subagents-ipc.ts"), "utf8");
      const channelGone = !(manifestJson.channels ?? []).some((entry) => entry.channel === "subagents:invoke");
      const noDirectStart = !/server\.request\(\s*["'](?:thread|turn)\/start["']/.test(codeOnly(subagentsSrc));
      (channelGone && noDirectStart ? ok : fail)(
        `★ subagents:invoke 旁路已断根（manifest 无该通道=${channelGone} + 域不直连引擎派活=${noDirectStart}）`
      );
    }
    /* ── 10-27 子智能体：设置表单与 Codex 工具同口径 ──────────────────────────
       用户：「新建子智能体更新一下，都是旧的，工具也是，还有配套的 code 自己新建子智能体工具」。
       旧工具自己写一份默认值（中文名当 id、强制继承/启用、不认模型/沙箱/审批）⇒
       模型保存一次就把用户在表单里改的配置抹掉。判据锚**接线与消费点**，不是常量存在。 */
    {
      const subCfg = readFileSync(join(ROOT, "electron", "subagent-config.ts"), "utf8");
      const coreSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8"));
      const rpcSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8"));
      const ipcSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "subagents-ipc.ts"), "utf8"));
      const delegateSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8"));
      const saveAt = coreSrc.indexOf('name: "subagent_save"');
      const saveSchema = saveAt >= 0 ? coreSrc.slice(saveAt, saveAt + 1600) : "";
      (["low", "medium", "high", "xhigh"].every((x) => saveSchema.includes(`"${x}"`))
        && /sandbox:\s*\{/.test(saveSchema) && /approvalPolicy:\s*\{/.test(saveSchema) && /model:\s*\{/.test(saveSchema)
        ? ok : fail)("★ subagent_save 工具带四档推理强度 + 模型/沙箱/审批（与表单同口径）");
      (/saveSubAgentConfig\(/.test(rpcSrc) && /saveSubAgentConfig\(/.test(ipcSrc)
        ? ok : fail)("★ IPC 保存与 Codex 工具走同一个 saveSubAgentConfig（不各写一份默认值）");
      (!/safeAgentId/.test(ipcSrc) && /normalizeEffort/.test(subCfg) && /safeAgentId/.test(subCfg)
        ? ok : fail)("★ id/档位归一只有一处实现（electron/subagent-config.ts）");
      (/subAgentConfig\??\.effort/.test(delegateSrc) && /subAgentConfig\.inheritSandbox/.test(delegateSrc)
        && /subAgentConfig\.inheritApproval/.test(delegateSrc) && /subAgentConfig\.inheritModel/.test(delegateSrc)
        ? ok : fail)("★ 派活真正消费子智能体的推理强度/模型/沙箱/审批（表单不再只写不读）");
    }
    /* 类别闸在执行端硬拦 kind（10-29 定稿：专家/子智能体**恒可用**，专家团是唯一开关）。 */
    (typeof dp.dispatchKindAllowed === "function"
      && dp.dispatchKindAllowed("expert", { expert: false, team: false, subagent: false }).ok === true
      && dp.dispatchKindAllowed("subagent", { expert: false, team: false, subagent: false }).ok === true
      && dp.dispatchKindAllowed("team", { expert: true, team: true, subagent: true }).ok === true
      && dp.dispatchKindAllowed("member", { expert: true, team: true, subagent: true }).ok === true
      && dp.dispatchKindAllowed("member", { expert: true, team: false, subagent: true }).ok === false
      && dp.dispatchKindAllowed("team", null).ok === false
      ? ok("★ 类别闸：专家/子智能体恒放行（连手改的 false 也不生效）、专家团默认拒绝（member 随 team）")
      : fail("dispatchKindAllowed 判据不对 —— 默认许可不是「专家/子智能体可用、专家团关闭」"));
    /dispatchKindAllowed\(input\.kind, originDispatch\)/.test(readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8"))
      ? ok("★ 勾选硬闸接线到 runDelegatedTask（agent_invoke 与 agents:invoke 两条入口共用一处闸）")
      : fail("dispatchKindAllowed 写了却没接进 runDelegatedTask —— 恒绿死函数");
    /* ⛔⛔ 10-05 **反转**（推翻 09-16 那条「改走内置 MCP」的判据）：引擎 0.157 起内置 MCP 的工具
       整批被**延迟暴露** —— 真机复现（独立 CODEX_HOME + mock provider 截获引擎真实请求体）：
       `input[0].additional_tools` 里只有 functions / clock / collaboration 三组 11 个工具，
       `agent_invoke` 一个都没有；`functions.exec` 的说明原话是 "…listed in ALL_TOOLS"。
       ⇒ 只走 MCP = 模型**根本看不到**这些工具，用户报「调度工具用不了」
         （trace：`codex_core::tools::router` … `unsupported call: agent_invoke`）。
       ⇒ 现在**必须**由渲染层注册 dynamicTool —— 实测注册后它以**非延迟**条目出现在工具面，
          模型调用由引擎以 `item/tool/call` 发回宿主执行。
       细节判据（不许按开关条件注册 / 描述两侧同源 / 分发接 IPC）在守卫 11f 的 ⑦ 段。 */
    /name: "agent_invoke"/.test(codeOnly(appSrc9))
      ? ok("★ 渲染层注册了 dynamicTool agent_invoke（引擎 0.157 不暴露 MCP 工具，这是模型唯一可见通道）")
      : fail("渲染层没注册 agent_invoke —— 模型工具面里不会出现它，调度直接不可用（10-04 用户现场）");
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
    /* 意图没变（09-16 用户要求）：**调度工具（team_member_invoke / team_phase_invoke）只给专家团
       主理人**，其余被调会话一律不带 —— 否则被派的执行型会话能互相套娃。
       10-05 角色私有记忆落地后，dynamicTools 的传参条件从「teamTools 非空」变成
       「teamTools 非空 **或** 有角色归属」（两类工具要合并进**同一个**数组，⛔ 不能写两个
       dynamicTools 键 —— 后者会覆盖前者，主理人反而丢掉自己的调度工具）。 */
    /* 10-10 用户令「全开 harness_tools」：数组里再挂**能力网关**（`buildDelegateHarnessTool`），
       且**无条件挂**（带开关条件 ⇒ 中途变化不生效，本项目已踩过）。
       ⛔⛔ 权限边界在执行端（`canDispatchFrom` / `restrictedThreadRole`），**不靠"给不给工具"**
       —— 所以这里不再有"绝不给 harness_tools"的负向断言；"给了网关 = 越权"是个**假命题**
       （工具可见 ≠ 操作被允许）。 */
    /* 10-21 step 标题落地后，工具面统一过 withStepParam（同一份数组，顺序与成员不变）。 */
    /dynamicTools: (?:withStepParam\()?\[\.\.\.teamTools, buildDelegateHarnessTool\(\), \.\.\.\(roleRef \? \[buildRoleMemoryTool\(roleRef\)\]/.test(mainSrc9)
      ? ok("dynamicTools = 调度工具 + 能力网关（+ 角色记忆写入）；⛔ 权限边界在执行端而非工具面")
      : fail("dynamicTools 的组装变了 —— 确认被委派会话拿得到网关、且调度工具仍只给主理人");
    // ⛔ 回归防线：这些工具必须**合并成一个数组**（写两个 dynamicTools 键会互相覆盖）
    (mainSrc9.match(/dynamicTools:/g) ?? []).length >= 1
      && !/\.\.\.\(teamTools\.length \? \{ dynamicTools: teamTools \}/.test(mainSrc9)
      ? ok("⛔ 团队工具 / 能力网关 / 角色记忆工具合并在同一个 dynamicTools 数组（没写第二个键）")
      : fail("⛔ dynamicTools 写了两个键 —— 后者覆盖前者，主理人会丢掉调度工具");
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
    /* 10-29：三个通知入口收敛成一个（总开关删除后只剩「逐类许可变化」）。 */
    (typeof dp.dispatchSelectionChangeNotice === "function"
      && /打开了「专家团」/.test(dp.dispatchSelectionChangeNotice(["team"], [], { expert: true, team: true, subagent: true }))
      && /关掉了「专家团」/.test(dp.dispatchSelectionChangeNotice([], ["team"], { expert: true, team: false, subagent: true }))
      && /agents:notice/.test(mainSrc9) && /window\.codex\.dispatchNotice\(/.test(appSrc9)
      && !/agents:(enabled|off)-notice/.test(mainSrc9) && !!dp.dispatchAllowOf
      ? ok("★ 告知收敛为一条：开团/关团两态都在，且旧的两条通道已删除")
      : fail("告知链路不对 —— 要么语义不全，要么旧通道又长回来了"));
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

/* ══ 【139b】手机远控的会话列表只显示标题（10-28 用户实测：一条消息正文把整屏撑满）══
   根因：会话行标题写成 `t.name || t.preview` —— 引擎的 preview 是**整条消息正文**，
   无标题的老会话直接把正文当标题，而 `.thread-row b` 又没有单行截断。
   判据锚**渲染代码形态**（标题走 threadTitle / 副标题只有时间 / 两行都省略），
   ⛔ 不要退化成"检查某个 CSS 类是否存在"（改回多行也照样绿）。 */
{
  const pageSrc = readFileSync(join(ROOT, "electron", "remote", "web-page.ts"), "utf8");
  const listAt = pageSrc.indexOf("async function loadThreads()");
  const listBody = listAt >= 0 ? pageSrc.slice(listAt, pageSrc.indexOf("function toggleThreads()")) : "";
  (/function threadTitle\(t\) \{/.test(pageSrc) && /title\.appendChild\(document\.createTextNode\(threadTitle\(t\)\)\)/.test(pageSrc) ? ok : fail)(
    "【139b】会话行标题必须走 threadTitle（截断 24 字），不得直接拿预览当标题"
  );
  (/querySelector\("small"\)\.textContent = new Date\(t\.updatedAt \* 1000\)\.toLocaleString\(\);/.test(pageSrc) ? ok : fail)(
    "【139b】会话行副标题只显示时间（不再拼预览正文）"
  );
  (!/t\.name \|\| t\.preview/.test(listBody) ? ok : fail)(
    "【139b】不得退回「name 缺失就整段 preview 当标题」—— 列表会被一条消息撑满一屏"
  );
  (/\.thread-row b\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis[^}]*\}/.test(pageSrc)
    && /\.thread-row small\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis[^}]*\}/.test(pageSrc) ? ok : fail)(
    "【139b】标题与副标题都必须单行省略（多行正文会把行高撑爆）"
  );
  (/class="new-thread"/.test(pageSrc) && /onclick="toggleThreads\(\)">← 返回/.test(pageSrc) ? ok : fail)(
    "【139b】会话面板必须有「返回」（列表空白时否则无退路）且新建按钮走胶囊样式"
  );
  (/会话列表加载失败/.test(pageSrc) && /retry\.textContent = "重试"/.test(pageSrc) ? ok : fail)(
    "【139b】会话列表加载失败必须显示原因 + 重试（引擎未就绪时不能只留一片白）"
  );
  const pairSrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  const autoAt = pairSrc.indexOf("async function autoLogin()");
  // 只取函数体（到行首的 `}`）：外面还有「有连接码就直接提交、否则 autoLogin」的分支，
  // ⛔ 用 indexOf("autoLogin();") 切片会把那段分支也算进来 ⇒ 「不带 code」判据假红。
  // ⛔ 用 "\n}" 而不是 "\n}\n"：工作树是 CRLF，行尾是 \r\n，后者永远找不到 ⇒ autoBody 为空 ⇒ 假红
  const autoEnd = autoAt >= 0 ? pairSrc.indexOf("\n}", autoAt) : -1;
  const autoBody = autoEnd > autoAt ? pairSrc.slice(autoAt, autoEnd) : "";
  (autoAt >= 0 && /autoLogin\(\)/.test(pairSrc) ? ok : fail)(
    "【139b】配对页必须尝试「设备秘密自动登录」—— accessToken 每次启动重生成，不自动换就得每次重批"
  );
  (/deviceSecret/.test(autoBody) && !/\bcode\b/.test(autoBody) ? ok : fail)(
    "【139b】自动登录只凭设备秘密、不带配对码（带 code 等于又要求人输一次）"
  );
  (/\.msg\.user\{[^}]*var\(--accent-soft\)/.test(pageSrc) && !/\.msg\.user\{[^}]*#1e1e1c/.test(pageSrc) ? ok : fail)(
    "【139b】用户气泡走浅色主色底，不得回到黑底白字"
  );
  (/renderMarkdownHtml/.test(pageSrc) && /_mdText/.test(pageSrc) && /MOBILE_MARKDOWN_SOURCE/.test(pageSrc) ? ok : fail)(
    "【139b】助手消息走 Markdown 渲染（页面内联的就是 src/lib/mobile-markdown.mjs 同一份源码）"
  );
  {
    const md = await import(pathToFileURL(join(ROOT, "src", "lib", "mobile-markdown.mjs")).href);
    const bold = md.renderMarkdownHtml("**粗**");
    const code = md.renderMarkdownHtml("`a<b`");
    const xss = md.renderMarkdownHtml("<img src=x onerror=1>");
    const jsLink = md.renderMarkdownHtml("[x](javascript:alert(1))");
    const okLink = md.renderMarkdownHtml("[站点](https://example.com)");
    const fence = md.renderMarkdownHtml("```js\nconst a = 1;\n```");
    const table = md.renderMarkdownHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    const list = md.renderMarkdownHtml("- 一\n- 二");
    const heading = md.renderMarkdownHtml("## 标题");
    (bold.includes("<strong>粗</strong>")
      && code.includes("<code>a&lt;b</code>")
      && xss.includes("&lt;img") && !xss.includes("<img")
      && !jsLink.includes("<a ")
      && okLink.includes('href="https://example.com"')
      && fence.includes('<pre class="md-pre"') && fence.includes("const a = 1;")
      && table.includes("<table>") && (table.match(/<td>/g) || []).length === 2
      && (list.match(/<li>/g) || []).length === 2
      && heading.includes("md-h2")
      ? ok : fail)(
      "【139b】Markdown 真跑：粗体 / 行内代码转义 / 围栏 / 表格 / 列表 / 标题，且原始 HTML 与 javascript: 链接都被挡"
    );
  }
  const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
  /* 10-31：步骤文案抽到叶子模块（实时与历史共用）⇒ 断言跟着看新文件 */
  const remoteStepSrc = readFileSync(join(ROOT, "electron", "remote-step.ts"), "utf8");
  (/kind: "step"/.test(bootSrc) && /event\.kind === "step"/.test(pageSrc) ? ok : fail)(
    "【139b】运行步骤：主进程按 item 事件转发（命令/文件/工具/搜索/思考），手机页渲染成可折叠「运行过程」"
  );
  (/kind: "think"/.test(bootSrc) && /summaryTextDelta/.test(bootSrc) && /event\.kind === "think"/.test(pageSrc) && /think-text/.test(pageSrc) ? ok : fail)(
    "【139b】思考内容：reasoning 摘要流转发到手机页实时展开（只报一行「思考」标签不算数）"
  );
  (/remoteThinkStreamed/.test(bootSrc) && /item\?\.type === "reasoning"/.test(bootSrc) && /reasoningItemText\(p\?\.item\)/.test(bootSrc) ? ok : fail)(
    "【139b】思考内容兜底：中转供应商不流式时，用 item/completed 的完整摘要补发（流式过的不重复；文本形状统一走 reasoningItemText）"
  );
  (/kind: "output"/.test(bootSrc) && /outputDelta/.test(bootSrc) && /event\.kind === "output"/.test(pageSrc) && /step-out/.test(pageSrc) ? ok : fail)(
    "【139b】命令输出同步：outputDelta 转发并挂在对应命令步骤下（桌面的命令卡有结果，手机不能只有一行命令）"
  );
  {
    const watchSrc = readFileSync(join(ROOT, "electron", "turn-file-watch.ts"), "utf8");
    (/turn-file-changes-live", threadId, turnId/.test(watchSrc) && /remoteFilesText/.test(bootSrc) && /event\.kind === "files"/.test(pageSrc) && /step-files/.test(pageSrc) ? ok : fail)(
      "【139b】文件变更 +N −M：宿主追踪器的 live 报告带 threadId 转发到手机，页面逐文件展示（引擎 fileChange 不带行数）"
    );
    (/kind: "ask"/.test(bootSrc) && /remoteAskOf/.test(bootSrc) && /event\.kind === "ask"/.test(pageSrc) && /ask-opt/.test(pageSrc) ? ok : fail)(
      "【139b】询问 / 审批可在手机上直接点：ask 卡片 + 选项按钮（引擎原生请求走 server.respond，agent_ask 走渲染层桥）"
    );
    (/kind: "notice"/.test(bootSrc) && /requestApproval/.test(bootSrc) && /event\.kind === "notice"/.test(pageSrc) && /step-notice/.test(pageSrc) ? ok : fail)(
      "【139b】无法结构化时回落「去电脑端确认」提示（绝不让人对着手机干等）"
    );
    (/exitCode/.test(bootSrc) ? ok : fail)(
      "【139b】命令结束状态：引擎带 exitCode / status 时给结论（不带就静默，不瞎猜）"
    );
    (/\?\? \.arguments/.test(remoteStepSrc) || /item\?\.arguments/.test(remoteStepSrc)) && /dynamicToolCall/.test(remoteStepSrc) ? ok : fail(
      "【139b】工具步骤带 server 前缀 + 参数摘要（与桌面工具卡同口径，手机上看得出来调了什么）"
    );
  }
  (/remoteThinkKey/.test(bootSrc) && /p\.delta \?\? p\.text/.test(bootSrc) ? ok : fail)(
    "【139b】思考去重按**条目**（按回合会把一轮里的第二段整段误跳过）；增量取 delta ?? text（两种字段都出现过）"
  );
  {
    const tcAt = bootSrc.indexOf('event.method === "turn/completed"');
    const tcBody = tcAt >= 0 ? bootSrc.slice(tcAt, tcAt + 2400) : "";
    (/turn\?\.items \?\? \[\]/.test(tcBody) && tcBody.indexOf('kind: "think"') >= 0 && tcBody.indexOf('kind: "think"') < tcBody.indexOf('kind: "done"') ? ok : fail)(
      "【139b】整轮结束兜底：从 turn.items 补发没发过的思考，且必须在 done **之前**（done 一到手机就折叠了运行块）"
    );
  }
  (/aborted\|failed\|interrupted/.test(bootSrc) && /turnRunning/.test(pageSrc) && /handleSend/.test(pageSrc) && /setRunning\(false\)/.test(pageSrc) ? ok : fail)(
    "【139b】运行中可一键停止：发送键切「停止」+ 中断/失败/中止同样发 done（否则停完一直挂「运行中」）"
  );
  /* 10-28 起新建会话统一走 startSession（newThread 只是带 boss 参数的薄壳） */
  const ssAt = pageSrc.indexOf("async function startSession(");
  const ssEnd = ssAt >= 0 ? pageSrc.indexOf("\nfunction ", ssAt) : -1;
  const ssBody = ssEnd > ssAt ? pageSrc.slice(ssAt, ssEnd) : "";
  (/stepBox = null/.test(ssBody) && /type: "new-thread", boss: Boolean\(boss\)/.test(ssBody) ? ok : fail)(
    "【139b】新建会话必须重置步骤容器 —— 旧容器已从 DOM 移除，不重置就看不到新回合的步骤（中枢/普通两条都必须走 startSession）"
  );
  const mainSrc = readMainSource();
  const gmAt = mainSrc.indexOf("getThreadMessages:");
  const gmEnd = gmAt >= 0 ? mainSrc.indexOf("newThread: async", gmAt) : -1;
  const gmBody = gmEnd > gmAt ? mainSrc.slice(gmAt, gmEnd) : "";
  (/stripHarnessBlocks\(/.test(gmBody) ? ok : fail)(
    "【139b】手机读历史必须剥掉注入块（常驻记忆 / 当前时间），否则整段机器文本铺进气泡"
  );
  (/role: "think"/.test(mainSrc) && /role: "step"/.test(mainSrc) && /运行过程 · /.test(pageSrc) ? ok : fail)(
    "【139b】读历史按原顺序回放思考与工具步骤（连续段收成「运行过程 · N 步」，位置不挪动）"
  );
  /* 10-28 审查修复的四处：每处都是「看着接好了，真机点下去是错的」那类 */
  (/if \(Array\.isArray\(event\.data\?\.files\)\) lastFilesData = event\.data\.files;/.test(pageSrc)
    && /if \(lastFilesData && lastFilesData\.length\) \{ render\(lastFilesData\); return; \}/.test(pageSrc) ? ok : fail)(
    "【139b】运行中「查看改动」必须优先用实时清单 —— 落盘报告要回合结束才写，拿它显示的是上一轮"
  );
  (/stepBox\.querySelectorAll\("\.ask-card"\)\.forEach\(\(node\) => node\.remove\(\)\);/.test(pageSrc) ? ok : fail)(
    "【139b】回合结束必须清掉没答的询问卡（卡已失效，留着点了也是死请求）"
  );
  (/if \(method\.includes\("permissions"\)\) return null;/.test(bootSrc) ? ok : fail)(
    "【139b】权限请求不得压成 approval 卡：回包形状是 {permissions, scope}，按 decision 回会被引擎拒"
  );
  (/questions\.length !== 1/.test(bootSrc) ? ok : fail)(
    "【139b】多问题 requestUserInput 不得只答一半（answers 要按 question id 全填，否则回落「去电脑端确认」）"
  );
  (/escapeHtmlText\(botName\)/.test(pageSrc) && /function escapeHtmlText/.test(pageSrc) ? ok : fail)(
    "【139b】绑定页的机器人名来自 URL 查询串，拼 HTML 前必须转义（同源 XSS 能借 cookie 调 RPC 控制电脑）"
  );
  (/会话加载失败/.test(pageSrc) && /retry\.textContent = "重试"/.test(pageSrc) ? ok : fail)(
    "【139b】消息加载失败必须留人 + 重试（网络抖一下就悄悄换新会话 = 用户看到「我的会话没了」）"
  );
  (/CodexHarnessRemote/.test(pageSrc) && /link\.href\.indexOf\(location\.origin\)/.test(pageSrc) ? ok : fail)(
    "【139b】安卓壳内链接改当前窗导航（target=_blank 在 WebView 里没窗口可开 = 点了没反应）"
  );
  /* 10-28 手机端首页（普通 / 中枢）：默认落首页，发消息才建会话 */
  (/readHomePrefs\(\);[\s\S]{0,200}?showHome\(\);/.test(pageSrc)
    && !/if \(currentThreadId\) \{ await loadMessages\(\); saveSession\(\); return; \}/.test(pageSrc) ? ok : fail)(
    "【139b】手机端默认落**首页**（开机不再自动恢复/新建会话 —— 用户令「不会一进去就是对话」）"
  );
  (/const startAsBoss = homeVisible && homeMode === "hub"/.test(pageSrc) && /rpc\(\{ type: "new-thread", boss: startAsBoss \}\)/.test(pageSrc) ? ok : fail)(
    "【139b】中枢首页发消息 = 建**中枢会话**（普通首页仍 boss:false）"
  );
  (/openNewThreadMenu/.test(pageSrc) && /add\("默认会话"/.test(pageSrc) && /add\("中枢会话"/.test(pageSrc) ? ok : fail)(
    "【139b】新建会话必须先选类型（默认会话 / 中枢会话两项）"
  );
  (/type: "boss-groups"/.test(pageSrc) && /home-group/.test(pageSrc) && /groupAvatarNode/.test(pageSrc) ? ok : fail)(
    "【139b】中枢首页群卡：群头像（成员首字拼图）+ 成员 + 事件 + 未读点（数据来自 boss-groups）"
  );
  /* 10-28 审查修复（都是「真机才看得出来」的那类） */
  (/#msglist\[hidden\]\{display:none\}/.test(pageSrc) ? ok : fail)(
    "【139b】首页要真正藏住消息区：#msglist 自带 display:flex，会盖掉 UA 的 [hidden]（必须显式 display:none）"
  );
  (/const seq = \+\+homeRenderSeq;/.test(pageSrc) && /if \(seq !== homeRenderSeq\) return;/.test(pageSrc) ? ok : fail)(
    "【139b】切首页页签防串台：慢网下旧请求回来不许覆盖新页签内容"
  );
  (/memberHasNews\(group, member\.id, seenAt\)/.test(pageSrc) ? ok : fail)(
    "【139b】群管理面板必须先取旧 seen 再 mark：否则「有新动静」永远显示不出来"
  );
  (/新建会话失败[\s\S]{0,220}?if \(homeVisible\) \{[\s\S]{0,140}?home-body/.test(pageSrc) ? ok : fail)(
    "【139b】首页态新建会话失败必须显示在首页上（消息区被首页盖着 = 用户看到「点了没反应」）"
  );
  (/thread-tag boss/.test(pageSrc) && /中枢调度/.test(pageSrc) && /kind === "boss"/.test(pageSrc) ? ok : fail)(
    "【139b】会话列表标签：中枢（带群名） / 中枢调度 —— 身份由主进程给出，手机端不自己猜"
  );
  {
    const relaySrc2 = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
    const mainSrc2 = readMainSource();
    (/this\.events\.brandName/.test(relaySrc2) && /this\.events\.newThread\?\.\(Boolean\(data\.boss\)\)/.test(relaySrc2) && /listBossGroups/.test(relaySrc2) ? ok : fail)(
      "【139b】手机页品牌名 / 中枢建会话 / 群快照都走主进程回调（⛔ 页面不硬编码品牌、不自造群数据）"
    );
    (/ensureBossHomeDir/.test(mainSrc2) && /registerBossSession\(id\)/.test(mainSrc2) ? ok : fail)(
      "【139b】手机建中枢会话：cwd = boss-home（AGENTS 即中枢职责）+ 登记中枢身份"
    );
    (/listBossGroupSummaries/.test(mainSrc2) ? ok : fail)(
      "【139b】群卡数据与桌面群列表**同一份**映射（⛔ 不各写一份，成员/事件/未完成不许漂移）"
    );
  }
}

/* ══ 【139c】手机远控走自建中转（安卓 App / 固定域名）：端口要固定、固定地址要压过隧道（10-28）══
   背景：安卓 App 与服务端 frp 都按**固定**地址与端口配置。端口每次启动随机、或二维码仍指向
   随机 trycloudflare 域名，用户装完 App 也连不上（症状是「连不上/每次地址都变」）。 */
{
  const relaySrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  (/export const REMOTE_PORT = 17891/.test(relaySrc) && /async start\(port = this\.resolvedPort\(\)\)/.test(relaySrc) && !/async start\(port = 0\)/.test(relaySrc) ? ok : fail)(
    "【139c】远控端口默认 17891 —— frpc 配的就是它，改回随机等于服务端转发永远对不上"
  );
  (/HARNESS_REMOTE_PORT/.test(relaySrc) && /remote-port\.txt/.test(relaySrc) ? ok : fail)(
    "【139c】端口可覆盖（桌面版与 PPcode 同机双开远控，不能抢同一个 17891）"
  );
  (/HARNESS_REMOTE_PUBLIC_URL/.test(relaySrc) && /private fixedPublicUrl\(\)/.test(relaySrc) && /remote-public-url\.txt/.test(relaySrc) ? ok : fail)(
    "【139c】支持固定公网地址（环境变量 + 数据目录 remote-public-url.txt）：二维码 / 配对链接 / 安全 cookie 都走它"
  );
  const baseBody = relaySrc.slice(relaySrc.indexOf("private externalBase()"), relaySrc.indexOf("private lanV4Address()"));
  (/fixedPublicUrl\(\)/.test(baseBody) && baseBody.indexOf("fixedPublicUrl()") < baseBody.indexOf("tunnelUrl") ? ok : fail)(
    "【139c】固定地址必须**优先于**隧道地址（否则二维码仍指向随机 trycloudflare 域名，App 无从连接）"
  );
  const tunnelBody = relaySrc.slice(relaySrc.indexOf("private startTunnel()"), relaySrc.indexOf("private fixedPublicUrl()"));
  (/fixedPublicUrl\(\)/.test(tunnelBody) && /return;/.test(tunnelBody) ? ok : fail)(
    "【139c】配了固定地址就不许再起 cloudflared（两条公网入口并存会让地址随机漂移）"
  );
  (/server\.once\("error", onError\)/.test(relaySrc) && /reject\(new Error\(/.test(relaySrc) ? ok : fail)(
    "【139c】固定端口 listen 失败必须 reject 并清 server —— 不挂 error 时 Promise 永远悬着，界面「点了没反应」"
  );
  (/const hashCode = \(location\.hash\.match/.test(relaySrc) && /if \(hashCode\) \{[\s\S]{0,120}submit\(\);/.test(relaySrc) ? ok : fail)(
    "【139c】配对页支持 #code= 自动提交 —— 安卓包内置地址后只让人输一次连接码"
  );
}

/* ══ 【139d】手机远控四件基础能力：＋ 图片 / 文件预览 / # 技能 / / 指令（10-28）══
   ⛔ 手机传来的路径是**外部输入**：图片只认刚落盘的上传目录，文件只认会话工作区；
      越界（`..`、绝对路径、盘符）一律拒绝。 */
{
  const relaySrc2 = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  const mainSrc2 = readMainSource();
  const pageSrc2 = readFileSync(join(ROOT, "electron", "remote", "web-page.ts"), "utf8");
  (/url === "\/api\/upload"/.test(relaySrc2) && /data:image/.test(relaySrc2) && /8 \* 1024 \* 1024/.test(relaySrc2) ? ok : fail)(
    "【139d】图片上传只收 dataUrl 图片且限 8MB（/api/upload）"
  );
  (/uploadsRoot/.test(mainSrc2) && /type: "localImage"/.test(mainSrc2) && /startsWith\(path\.resolve\(uploadsRoot\)/.test(mainSrc2) ? ok : fail)(
    "【139d】发图片只认 remote-uploads 目录内的路径（手机传来的绝对路径不许直接进引擎）"
  );
  (/safeJoin\(root, relPath\)/.test(mainSrc2) && /512 \* 1024/.test(mainSrc2) ? ok : fail)(
    "【139d】文件预览走 safeJoin + 大小上限（越界 / 超大 / 二进制都拒）"
  );
  (["catalog", "files-list", "file-read", "interrupt", "compact"].every((t) => relaySrc2.includes(`"${t}"`)) ? ok : fail)(
    "【139d】/api/rpc 覆盖 catalog / files-list / file-read / interrupt / compact"
  );
  (["openSheet", "/api/upload", "files-list", "insertText", "runCommand", "__remoteBack", "openApk"].every((t) => pageSrc2.includes(t)) ? ok : fail)(
    "【139d】手机页有 ＋ 菜单（图片 / 文件 / 技能 / 指令 / 安装包），链路 + 返回键钩子都接上"
  );
  (/url === "\/apk"/.test(relaySrc2) && /mirrorCandidates/.test(relaySrc2) && /apkFile/.test(relaySrc2) && /REMOTE_APK_RELEASE/.test(relaySrc2) ? ok : fail)(
    "【139d】安装包：/apk 按需从 GitHub Release 镜像链（gh-proxy→ghfast→直连）取并缓存到 apk-cache"
  );
  (/REMOTE_APK_SHA256/.test(relaySrc2) && /createHash\("sha256"\)/.test(relaySrc2) && /校验和不匹配/.test(relaySrc2) ? ok : fail)(
    "【139d】安装包必须按 sha256 校验（镜像可能被篡改；与 updates.ts 的 asset.digest 同口径）"
  );
  (/but found/.test(mainSrc2) && /先停止再压缩/.test(mainSrc2) && /realpathSync/.test(mainSrc2) ? ok : fail)(
    "【139d】停止按引擎真实 turnId 重试；压缩拒绝在回合中执行；文件读再做一次真实路径校验（防软链逃逸）"
  );
  (/thread\/archive/.test(mainSrc2) && /thread\/goal\/set/.test(mainSrc2) && /chm-effort/.test(pageSrc2) ? ok : fail)(
    "【139d】归档 / 设目标 / 思考强度（low/medium/high/xhigh 随消息下发）三件接线"
  );
  (["tasks", "turn-files", "file-diff", "goal-get"].every((t) => relaySrc2.includes(`"${t}"`)) ? ok : fail)(
    "【139d】任务清单 / 本轮改动 / 单文件 diff / 目标读取四个 RPC 都在"
  );
  (/openTurnDiff/.test(pageSrc2) && /refreshTasks/.test(pageSrc2) && /refreshGoal/.test(pageSrc2) && /storedReportsForThread/.test(mainSrc2) ? ok : fail)(
    "【139d】手机端：改动面板可点开单文件 diff；任务清单与目标条有刷新链路（数据取自落盘报告）"
  );
  {
    const bridgeSrc = readFileSync(join(ROOT, "src", "features", "app-view", "RemoteAskBridge.tsx"), "utf8");
    const viewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (/"answer"/.test(relaySrc2) && /server\.respond\(requestId/.test(mainSrc2) && /remote-agent-ask-answer/.test(bridgeSrc) && /<RemoteAskBridge/.test(viewSrc) ? ok : fail)(
      "【139d】询问回包：RPC answer → 主进程 server.respond（引擎原生）或渲染层桥 resolve（agent_ask），且桥已挂进 AppView"
    );
  }
  // 真跑路径守卫真值表（纯模块，node 直接 import）
  const rf = await import(pathToFileURL(join(ROOT, "src", "lib", "remote-files.mjs")).href);
  const root = "C:/work/proj";
  const inside = rf.safeJoin(root, "docs/a.md");
  const cases = [
    inside.endsWith("docs/a.md") || inside.endsWith("docs\\a.md"),
    rf.safeJoin(root, "../etc/passwd") === "",
    rf.safeJoin(root, "/etc/passwd") === "",
    rf.safeJoin(root, "C:/Windows/win.ini") === "",
    rf.safeJoin(root, "..") === "",
    rf.safeJoin(root, "") === "",
    rf.safeJoin(root, "sub/../a.md") !== "",
    rf.previewKind("a.png") === "image",
    rf.previewKind("a.md") === "text",
    rf.previewKind("a.exe") === "other",
  ];
  (cases.every(Boolean) ? ok : fail)(
    "【139d】safeJoin 真跑：目录内放行，`..` / 绝对路径 / 盘符 / 空串全拒；预览类型分档正确"
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


  /* ── 【250】窄屏下顶栏浮层不许压到原生窗口钮（10-03 用户截图）─────────────────
     背景：Windows 无边框窗的最小化/最大化/关闭是**原生** WCO，渲染层碰不到；
     顶栏靠 padding-right:145px 给它留位。09-13 已做「缩窗分级隐藏按钮」，
     但漏了工作区上下文选择器 `.ctx-picker` —— 它的**下拉浮层**是容器div 的孩子，
     `display:none` 藏不住它 ⇒ 浮层压在 WCO 上面（探针实测窗口 651px 时相交）。
     两条断言分别钉「CSS 收浮层」「逻辑兜底关状态」「145px 预留」，缺任一都还会复现：
       只加 CSS⇒ 开着浮层缩窄后按钮消失，浮层永久糊在窗口钮上且**点不掉**（死角）；
       只加逻辑⇒ 断点值与 CSS 不同源时两边打架，谁最后生效说不清。
     ⛔ 10-06 夜七轮：📁 工作区（.ctx-picker）按用户令从操作簇挪去**标题最前**
     （AppView.tsx 的 .task-title）—— 选择器前缀与 JSX 覆盖源都跟着换，别改回。 */
  {
    const topbarCss250 = readFileSync(join(ROOT, "src/styles/09-settings-workspace-memory.css"), "utf8");
    const narrowBlock250 = topbarCss250.slice(topbarCss250.indexOf("@media (width<=760px)"));
    (/@media \(width<=760px\)[\s\S]*?\.task-title \.ctx-picker,[\s\S]*?\.ctx-menu[\s\S]{0,200}display: none/.test(narrowBlock250) ? ok : fail)(
      "【250】窄屏（<=760px）必须连 .task-title .ctx-picker 容器与其 .ctx-menu 浮层一起隐藏（浮层是容器孩子，display:none 藏不住它；前缀 10-06 夜七轮随按钮挪位换过）"
    );
    const goalPal250 = readFileSync(join(ROOT, "src/features/app-state/parts/part01/06-goals-palette-commands.tsx"), "utf8");
    (/matchMedia\("\(width<=760px\)"\)/.test(goalPal250) && /ctxMenuOpen\)[\s\S]{0,400}setCtxMenuOpen\(false\)/.test(goalPal250) ? ok : fail)(
      "【250】缩到窄屏必须**逻辑关掉**工作区浮层（只靠 CSS 会出现「按钮没了 ⇒ 浮层点不掉」的死角）"
    );
    /* ⛔ 10-31 二次收紧：窗口钮由**原生 WCO**（46×3=138）改成自绘三钮（26×3 + 2 间 = 82）
       ⇒ 预留区 132 → **90**（= 82 + 8 呼吸；自绘簇贴在窗口右缘 6px 处，与顶栏卡片对齐）。 */
    (/padding-right: 112px/.test(readFileSync(join(ROOT, "src/styles/02-sidebar-threads.css"), "utf8")) ? ok : fail)(
      "【250】顶栏预留 96px（= 自绘三钮 88 + 8 呼吸）给窗口钮，操作簇右缘不再压到钮下面"
    );

    /* ⛔⛔ 本轮真正的根因（10-03 用户截图「搜索跟调度图标没有隐藏」）：
       09-13 那套断点**只列了当时存在的按钮**，后来新增的顶栏控件没人补进去——
       搜索 .history-search-wrap 与 目标进程 .tb-goals-entry 就一直漏在所有档之外，
       651px 下仍挤在原生钮预留区里。
       ⇒ 光钉「该藏的藏了」不够（上面三条都过了，它照样漏），必须钉**覆盖率**。

       ⛔⛔ 判据的坑（第一次写成「文件里出现过这个类名」= **假绿**，变异测试当场抓到）：
         CSS 里多个容器常写在**同一个选择器组**里（逗号分隔），删掉其中一个类名后
         「文件里还能搜到这个串」仍然成立 ⇒ 断言恒真、抓不到漏网。
         正确判据 = **逐个容器检查它自己那一行选择器**（行首匹配，排除逗号续行）。 */
    const topbarJsx250 = codeOnly(readFileSync(join(ROOT, "src/features/app-state/parts/part09/02-seg.tsx"), "utf8"));
    /* 10-06 夜七轮：📁 工作区（.ctx-picker）挪进了 AppView 的标题区 —— 覆盖源要看两个文件；
       ⛔ 一律过 codeOnly：part09 里现在有一段「已挪走、别加回」的注释提到 .ctx-picker，
       裸读会把注释当 JSX（负向断言当场假红 —— 项目方法论第 4 条同款坑）。 */
    const appViewJsx250 = codeOnly(readFileSync(join(ROOT, "src/features/app-view/AppView.tsx"), "utf8"));
    /* ⛔⛔ 10-11 用户**改判**（原话「这一排图标要根据窗口大小自适应隐藏，主界面上面这一排和
       独立弹窗这一排都要自适应隐藏」+ 追问「搜索也一起收」）：
       · 搜索（.history-search-wrap）**进最窄档 ≤640** —— 10-04 那条「豁免、不进任何断点」
         就此作废（原理由是"无替代入口"；Ctrl+Shift+F 仍在，用户接受）；
       · 调度（.dispatch-topbar-btn）此前**任何断点里都没有**（09-13 只列了当时存在的按钮）⇒ 补进 ≤860。
       ⛔ 两条都必须"CSS 收按钮 + 逻辑关状态"成对：只靠 CSS 会留下「按钮没了 ⇒ 浮层点不掉」的死角。 */
    const searchSrc250 = readFileSync(join(ROOT, "src/features/app-state/parts/part04/02-seg/02-chat-search-history.tsx"), "utf8");
    (/@media \(width<=640px\)[\s\S]*?\.topbar-actions \.history-search-wrap,[\s\S]{0,160}?\.history-search-panel[\s\S]{0,120}?display: none/.test(topbarCss250)
      && /matchMedia\("\(width<=640px\)"\)/.test(searchSrc250) && /setChatSearchOpen\(false\)/.test(searchSrc250) ? ok : fail)(
      "【250】搜索在 ≤640 最窄档：CSS 连按钮与 portal 浮层一起收 **且** 逻辑关掉面板（10-11 用户令；只靠 CSS = 点不掉的死角）"
    );
    (/^\s*\.topbar-actions \.dispatch-topbar-btn\s*[,{]/m.test(topbarCss250) ? ok : fail)(
      "【250】调度开关（.dispatch-topbar-btn）必须落在某个断点里（10-11：它此前一直漏在档外，用户报「窄了也不隐藏」）"
    );
    /* 覆盖名单（**每个控件都必须落在某个断点里**）：10-11 起把调度与搜索也纳入 ——
       搜索此前被"豁免"（10-04 口径），用户 10-11 改判后不再有豁免项。
       ⛔ 判据 = 它自己那一行选择器（行首锚定），不是"文件里出现过这个串"（本仓踩过这个假绿）。 */
    const CONTAINERS = ["ctx-picker", "task-menu-wrap", "dispatch-topbar-btn", "history-search-wrap"];
    const uncovered = CONTAINERS.filter((c) => {
      const inJsx = topbarJsx250.includes(c) || appViewJsx250.includes(c);
      if (!inJsx) return false;                       // 已从 JSX 移除 ⇒ 不用管
      // 精确匹配「这一行就是它」：行首可有缩进，类名后面必须是逗号或 {（不是逗号续行里的第二个）
      // 前缀二选一：旧位在 .topbar-actions，10-06 夜七轮后 📁 在 .task-title
      const ownLine = new RegExp("^\\s*\\.(?:topbar-actions|task-title)\\s+\\." + c + "\\s*[,{]", "m");
      return !ownLine.test(topbarCss250);
    });
    (uncovered.length === 0 ? ok : fail)(
      `【250】顶栏控件覆盖率：每个控件都必须落在某个断点里（缺：${uncovered.join("、") || "无"}）—— `
        + `09-13 那套只列了当时存在的按钮，新增控件会静默漏在档外（10-03 用户截图即此因）`
    );

    /* 10-06 夜七轮（用户截图圈出右侧 📁 并令「把文件图标放到最前面」+「标题长度固定，太长省略」）：
       三条钉住新布局 —— 位置（.task-title 内、重命名 strong 之前）、不许加回操作簇、标题定长。 */
    {
      const taskTitleAt = appViewJsx250.indexOf("`task-title ");
      const pickerAt = appViewJsx250.indexOf('className="ctx-picker"');
      const strongAt = appViewJsx250.indexOf('title="双击修改任务名称"');
      (taskTitleAt >= 0 && pickerAt > taskTitleAt && strongAt > pickerAt ? ok : fail)(
        "【250】📁 工作区（.ctx-picker）在**标题最前**：.task-title 内、重命名 strong 之前"
          + "（10-06 夜七轮用户令「把文件图标放到最前面」；顺序反了 = 图标跑到名字后面）"
      );
      (!topbarJsx250.includes("ctx-picker") ? ok : fail)(
        "【250】⛔ 操作簇（part09 topbarActionsNode）里不许再加回 .ctx-picker —— 📁 的唯一位置 = 标题最前，两份会叠出双菜单"
      );
      const threadsCss250 = readFileSync(join(ROOT, "src/styles/02-sidebar-threads.css"), "utf8");
      (/\.task-title strong \{[\s\S]*?text-overflow: ellipsis[\s\S]*?max-width: 300px[\s\S]*?\}/.test(threadsCss250) ? ok : fail)(
        "【250】标题定长 300px + 省略号（用户 10-06 夜七轮：「标题长度固定，太长的就省略，不要撑长」—— 原来是随窗口变的 min(42vw, 380px)）"
      );
      /* 10-06 夜八轮追加（用户令：「那个会话窗口左上角那个字最多 6 个字，其他省略」）：
         CSS 只能按像素裁（6em 在拉丁文下会放进十几个字符）⇒ 按 code point 截断。 */
      (/function truncateThreadTitle\(text: string, max = 6\): string \{/.test(appViewJsx250)
        && /const chars = \[\.\.\.value\];/.test(appViewJsx250)
        && /chars\.slice\(0, max\)\.join\(""\) \+ "…"/.test(appViewJsx250)
        && /truncateThreadTitle\(cleanThreadDisplayTitle\(/.test(appViewJsx250) ? ok : fail)(
        "【250】顶栏标题按**字符数**截断：最多 6 个字、超出补「…」（用户 10-06 夜八轮；⛔ 用 […value] 展开不用 slice —— 会劈开 emoji 代理对；⛔ 只在顶栏 render 处包一层，别顺手套进 cleanThreadDisplayTitle 影响侧栏）"
      );
    }
    // ⛔ 10-04 根因守卫：顶栏**必须**有溢出裁剪。缺了它，内容总宽超出可用宽度时
    //   flex 子项会溢出 padding 边界（margin-left:auto 在空间不足时归零）⇒
    //   操作簇直接落进 145px 原生钮预留区、盖在最小化/最大化/关闭上（用户实测截图）。
    //   这条是布局层的硬约束，与「哪个控件该隐藏」是两件事，别混。
    // ⛔⛔ 必须读**规则真正所在的文件**：`.topbar` 基础规则在 02-sidebar-threads.css，
    //   不是 topbarCss250（那是 09- 断点文件）—— 我第一版查错了文件，断言恒红。
    //   ⇒判据要钉「文件归属」而不是"某文件里有"：两个文件都可能放这条规则。
    const topbarBaseCss250 = readFileSync(join(ROOT, "src/styles/02-sidebar-threads.css"), "utf8");
    const topbarOverflowOk =
      /^\s*\.topbar\s*\{[^}]*overflow\s*:\s*hidden/m.test(topbarBaseCss250) ||
      /^\s*\.topbar\s*\{[\s\S]{0,400}?overflow\s*:\s*hidden[\s\S]{0,400}?\}/m.test(topbarBaseCss250);
    (topbarOverflowOk ? ok : fail)(
      "【250】顶栏必须有 overflow:hidden（缺了它，操作簇会溢出到原生窗口钮底下 —— "
        + "那是布局问题，加断点隐藏治不了；规则在 02-sidebar-threads.css）"
    );
    (uncovered.length === 0 ? ok : fail)(
      `【250】顶栏新增控件必须补进断点（漏：${uncovered.join("、") || "无"}）`
    );
    // 目标进程按钮是 .task-menu-wrap 的**孩子**，父容器藏了它自然一起藏；单独钉它不存在反而是错的
    // ⛔⛔ 10-11 用户再次改判（第三条口径，以本条为准）：原先这里有一条"搜索🔍 必须**不**出现在
    //   断点里"的反向断言（10-04 定的"无条件显示"）。用户 10-11 令「这一排图标要根据窗口大小
    //   自适应隐藏」+ 追问「搜索也一起收」⇒ 那条反向断言**整条删除**（留着会把新实现判红）。
    //   现在的正向要求在上面：搜索必须落在 **≤640 最窄档**，且与逻辑关状态成对。
    //   ⛔ 历史脉络（别再回退）：10-03 要求 980px 藏 → 10-04 改判"无条件显示" → 10-11 改判"最窄档藏"。

    const botChan250 = readFileSync(join(ROOT, "src/features/app-state/parts/part03/01-remote-bot-pin/01-bot-remote-channel.tsx"), "utf8");
    (/matchMedia\("\(width<=980px\)"\)/.test(botChan250) && /taskMenuOpen\)[\s\S]{0,400}setTaskMenuOpen\(false\)/.test(botChan250) ? ok : fail)(
      "【250】缩到 <=980px 必须**逻辑关掉**任务操作浮层（只靠 CSS ⇒ 按钮没了浮层点不掉）"
    );
  }

  /* ══ 【139f】飞书官方 CLI：按需安装 + 官方 device flow 登录 + Codex 工具（10-29）══
     安装/卸载复用开发工具的 runtime:install；登录必须是官方流程（auth login --no-wait）；
     工具执行一律参数数组 spawn（⛔ 不过 shell）。 */
  {
    const feishuSrc = readFileSync(join(ROOT, "electron", "features", "feishu-cli-ipc.ts"), "utf8");
    const runtimeSrc = readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8");
    const runtimesSrc = readFileSync(join(ROOT, "electron", "features", "dev-runtimes.ts"), "utf8");
    const toolSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "01-seg.tsx"), "utf8");
    const routerSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "event-router", "02-request.tsx"), "utf8");
    const cardSrc = readFileSync(join(ROOT, "src", "features", "settings-devtools", "FeishuCliCard.tsx"), "utf8");
    (runtimesSrc.includes('"feishu-cli": { name: "飞书 CLI"') && runtimesSrc.includes("lark-cli.exe") ? ok : fail)(
      "【139f】开发工具清单有「飞书 CLI」（按需安装，marker 指向 npm-global 里的 lark-cli 二进制）"
    );
    (runtimeSrc.includes('id === "feishu-cli"') && runtimeSrc.includes("--allow-scripts=") && runtimeSrc.includes("@larksuite/cli@") ? ok : fail)(
      "【139f】安装走 npm 国内镜像 + 放行 postinstall（二进制靠它下载）；⛔ 缺 allow-scripts 会装出空壳"
    );
    (runtimeSrc.includes("const NPM_ALLOW_SCRIPTS") && runtimeSrc.includes('NPM_ALLOW_SCRIPTS["feishu-cli"]') && runtimeSrc.includes("NPM_ALLOW_SCRIPTS[id as DevRuntimeId]") ? ok : fail)(
      "【139f】放行脚本的名单单一真相源：安装与在线更新两条路径都带 allow-scripts（⛔ 只在安装分支放行 ⇒ 点「更新」会把飞书二进制装丢，剩一个空壳）"
    );
    (runtimeSrc.includes("node_modules/@larksuite") && runtimeSrc.includes('"feishu-cli": { pkg: "@larksuite/cli"') ? ok : fail)(
      "【139f】卸载/在线更新都登记了 feishu-cli（包体 @larksuite/cli）"
    );
    (feishuSrc.includes("--no-wait") && feishuSrc.includes("--device-code") ? ok : fail)(
      "【139f】登录走官方 device flow（auth login --no-wait --json → --device-code）"
    );
    (feishuSrc.includes("let setupChild") && feishuSrc.includes("setupChild?.kill()") ? ok : fail)(
      "【139f】重复点「去配置」不会起第二个 config init 进程（先杀旧的；两个 CLI 抢同一份配置会写出半套）"
    );
    (feishuSrc.includes("shell.openExternal") && feishuSrc.includes('"feishu-cli:cancel"') && cardSrc.includes("feishuCliCancel") && cardSrc.includes("runtime-row") ? ok : fail)(
      "【139f】授权链接自动用默认浏览器打开 + 可取消授权 + 卡片三行用 runtime-row 结构（⛔ 只贴链接不拉起浏览器 / 自造无 CSS 的 step 结构 = 10-29 用户截图投诉那次）"
    );
    (feishuSrc.includes("identities") && feishuSrc.includes("userIdentity") && feishuSrc.includes("Boolean(data?.appId)") ? ok : fail)(
      "【139f】auth status 按**真实输出**解析（appId / identities.bot.ready / identities.user；⛔ 1.0.98 输出里没有 ok 字段，按 ok 判会永远「未配置」、卡片一直转）"
    );
    (feishuSrc.includes("runHintOf") && feishuSrc.includes("还没登录") && feishuSrc.includes("10 * 60_000") ? ok : fail)(
      "【139f】流程收口：工具失败回「下一步点哪里」的中文指引 + 配置进程最长挂 10 分钟（⛔ 只回英文原文 ⇒ 模型会反复重试；无限挂着 ⇒ 吃配置锁的僵尸进程）"
    );
    (cardSrc.includes("feishuPollOutcome") ? ok : fail)(
      "【139f】卡片轮询的链接/等待态归约走纯函数 feishuPollOutcome（真值表见本组末尾；⛔ 写在组件闭包里的判定没有判据，改坏了只能等用户截图）"
    );
    (feishuSrc.includes("spawn(binary, args") ? ok : fail)(
      "【139f】CLI 执行用参数数组 spawn（⛔ 模型传入的 args 不能拼 shell）"
    );
    (toolSrc.includes('name: "feishu_cli"') && routerSrc.includes('event.params?.tool === "feishu_cli"') ? ok : fail)(
      "【139f】Codex 侧有 feishu_cli 工具且分发到 feishu-cli:run"
    );
    (cardSrc.includes("feishuCliSetupStart") && cardSrc.includes("feishuCliLoginStart") && cardSrc.includes("feishuCliStatus") ? ok : fail)(
      "【139f】开发工具卡片：安装 / 配置应用 / 登录 / 状态四步齐全"
    );
    (cardSrc.includes("feishu-cli-cap-grid") && cardSrc.includes("怎么用") && cardSrc.includes("EXAMPLES") && readStyles().includes(".feishu-cli-guide") ? ok : fail)(
      "【139f】卡片下面有「能做什么 / 怎么用」说明区（两列能力 + 示例说法 + 注意项）且样式已写（⛔ 只有结构没有 CSS = 10-29 那次原生排版事故）"
    );
    (cardSrc.includes("重新配置") && cardSrc.includes("startSetup(true)") && cardSrc.includes("baseAppIdRef") && cardSrc.includes("Boolean(next.appId)") ? ok : fail)(
      "【139f】已配置后仍能「重新配置」换应用（靠 appId 变化判断切换完成；⛔ 没有这个出口 = 连错应用只能卸了重装）"
    );
    // 真值表：轮询归约（纯模块，node 直接 import）。⛔ 登录那一行是 10-29 事故的回归判据。
    const feishuCard = await import(pathToFileURL(join(ROOT, "src", "lib", "feishu-card.mjs")).href);
    const poll = (input) => JSON.stringify(feishuCard.feishuPollOutcome(input));
    const pollCases = [
      poll({ flow: "login", configured: true, loggedIn: false }) === JSON.stringify({ keepLink: true, clearBusy: false }),
      poll({ flow: "login", configured: true, loggedIn: true }) === JSON.stringify({ keepLink: false, clearBusy: true }),
      poll({ flow: "setup", configured: true, loggedIn: false }) === JSON.stringify({ keepLink: false, clearBusy: true }),
      poll({ flow: "setup", configured: false, loggedIn: false }) === JSON.stringify({ keepLink: false, clearBusy: false }),
      poll({ flow: "", configured: true, loggedIn: false }) === JSON.stringify({ keepLink: false, clearBusy: false }),
      // 10-29 晚：重新配置（换应用）——configured 本来就是 true，只有 appId 变了才算完成；
      // ⛔ 没变之前必须 keepLink=true（收链接 = 2 秒轮询断掉，与登录那次事故同型）
      poll({ flow: "reconfig", configured: true, loggedIn: false, appChanged: true }) === JSON.stringify({ keepLink: false, clearBusy: true }),
      poll({ flow: "reconfig", configured: true, loggedIn: false, appChanged: false }) === JSON.stringify({ keepLink: true, clearBusy: false }),
      // 10-29 审查：切换前旧应用仍是已登录态 —— reconfig 必须排在看 loggedIn **之前**，否则首轮轮询就收链接
      poll({ flow: "reconfig", configured: true, loggedIn: true, appChanged: false }) === JSON.stringify({ keepLink: true, clearBusy: false }),
    ];
    (pollCases.every(Boolean) ? ok : fail)(
      "【139f】轮询归约真值表：登录等待中（配置已完成）必须留链接继续轮询；登录成功才收；配置完成只收 setup 的链接"
    );
  }

  /* ══ 【139e】手机远控「装完即用」：内置隧道 + 中转网关（10-29）══
     背景：以前每台电脑都要人工装 frpc、服务器手工配通道 ⇒ 只有开发者能用。
     现在链路：App 内置隧道（主动连网关）→ 网关按设备 ID 路由 → 本机 17891。
     ⛔ 这三段任何一段被"简化掉"，普通用户装完就连不上。 */
  {
    const gwSrc = readFileSync(join(ROOT, "scripts", "relay-gateway.mjs"), "utf8");
    const tunnelSrc = readFileSync(join(ROOT, "electron", "relay-tunnel.ts"), "utf8");
    const relaySrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
    const tunnelPage = readFileSync(join(ROOT, "electron", "remote", "web-page.ts"), "utf8");
    /* android/ 只存在于主仓（AGENTS）⇒ 其它仓读不到时跳过 APK 断言，别让预检崩在这里 */ const androidFile = join(ROOT, "android", "app", "src", "main", "java", "com", "codexharness", "remote", "MainActivity.java"); const hasAndroid = existsSync(androidFile); const androidSrc = hasAndroid ? readFileSync(androidFile, "utf8") : "";

    /* 10-30 用户实机：手输 6 位码报「Value <!doctype ... cannot be converted to JSONObject」——
       根地址 /api/pair 被转去空的老通道（HTML）。现在网关按配对码/设备 cookie 找回对应电脑。 */
    /* 10-30：经 nginx /remote/ 反代时，网关必须知道对外前缀，否则 302 会把手机送到 /t/... 根路径（nginx 404）。 */
    /* 10-30 用户：首页 / 会话 / 断开连接收进左上角一个「☰」；当天晚些再令「顶上中间的 logo 删了」
       ⇒ 顶栏 = ☰ + 当前会话名 + 状态点（⛔ 居中品牌块与 brand-logo 不许回来）。 */
    (tunnelPage.includes('id="top-menu"') && tunnelPage.includes('id="thread-label"')
      && !tunnelPage.includes('id="btn-home"') && !tunnelPage.includes("<h1 id=\"title\"") && !tunnelPage.includes("brand-logo") ? ok : fail)(
      "【139e】手机页顶栏：☰ 菜单装首页/会话/断开连接；⛔ 顶部中间不再放品牌 logo"
    );
    const bridgeOk = !hasAndroid || (androidSrc.includes("AndroidRemote") && androidSrc.includes("JavascriptInterface"));
    (bridgeOk ? ok : fail)(hasAndroid
      ? "【139e】APK 注入 AndroidRemote 桥：网页菜单的「断开连接」才能清本机 cookie / 自动登录标记 / 设备秘密"
      : "【139e】本仓不含 android 工程（AGENTS：只存在于主仓）⇒ 跳过 APK 桥断言");
    (gwSrc.includes("RELAY_PATH_PREFIX") && gwSrc.includes("PATH_PREFIX}/t/${id}") && gwSrc.includes("Path=${PATH_PREFIX}/t/${id}") ? ok : fail)(
      "【139e】网关支持对外路径前缀：/t 响应的 Location 与 Set-Cookie Path 都带回去（直连 18443 时前缀为空，行为不变）"
    );
    (gwSrc.includes("handleRootPair") && gwSrc.includes("handleRootPairStatus") && gwSrc.includes("pairRoutes") && gwSrc.includes("Location: `${PATH_PREFIX}/t/${deviceId}${url}`") ? ok : fail)(
      "【139e】根地址也能配对：/api/pair 逐台在线电脑找配对码、/api/pair-status 按 rid 找回、已配对页面按 cookie 跳到 /t/<id>（⛔ 否则手输码拿到 HTML，APK 解析 JSON 直接炸）"
    );
    (gwSrc.includes("handleTunnelRequest") && gwSrc.includes("const match = url.match") && gwSrc.includes("tunnels.get(id)") ? ok : fail)(
      "【139e】网关按 /t/<设备ID> 路由到对应隧道（不是所有人共用一条通道）"
    );
    (gwSrc.includes("tokenHash") && gwSrc.includes('type !== "hello"') && !gwSrc.includes('searchParams.get("token")') ? ok : fail)(
      "【139e】设备身份：hello 帧校验令牌（TOFU 绑定）；⛔ 令牌不许放查询串（会进访问日志）"
    );
    (gwSrc.includes("proxyLegacy(req, res)") && gwSrc.includes("LEGACY_TARGET") ? ok : fail)(
      "【139e】网关保留旧通道（/t/ 以外的请求转回原端口）—— 已发出去的二维码/老 APK 不能失效"
    );
    (gwSrc.includes("Path=${PATH_PREFIX}/t/${id}") && gwSrc.includes("next.startsWith(\"/\")") ? ok : fail)(
      "【139e】网关必须重写 Location 与 Set-Cookie Path：否则手机跳出中转前缀、两台电脑的 cookie 互相覆盖"
    );
    (gwSrc.includes("MAX_INFLIGHT") && gwSrc.includes("MAX_PER_MINUTE") && gwSrc.includes("MAX_BODY") ? ok : fail)(
      "【139e】网关有并发/速率/体积上限（公网入口不许无限转发）"
    );
    (gwSrc.includes('url === "/apk"') && gwSrc.includes("APK_URL") ? ok : fail)(
      "【139e】网关公开 /apk 跳转（老 APK 的安装包入口坏了也能用浏览器更新）"
    );
    (tunnelSrc.includes("relay-device.json") && tunnelSrc.includes("randomBytes(32)") && tunnelSrc.includes("scheduleRetry") ? ok : fail)(
      "【139e】内置隧道身份稳定（设备 ID + 令牌落 userData）、断线退避重连"
    );
    (tunnelSrc.includes('type: "hello", token: this.identity.token') ? ok : fail)(
      "【139e】隧道连上先发 hello 帧（令牌不进 URL）"
    );
    (tunnelSrc.includes('state === "online" ? this.status.publicBase : ""') ? ok : fail)(
      "【139e】离线时 publicBase 为空 —— 二维码必须退回旧通道，不能给用户一个死地址"
    );
    (relaySrc.includes("startRelayTunnel()") && relaySrc.includes("RELAY_DEFAULT_BASE") && relaySrc.includes("const relay = this.relay?.publicBase();") ? ok : fail)(
      "【139e】远控服务启动即连中转，配对基址中转优先（离线才退回固定地址/临时隧道/局域网）"
    );
    (tunnelPage.includes("const PATH_PREFIX") && tunnelPage.includes('apiUrl("/api/rpc")') && !tunnelPage.includes('fetch("/api/') ? ok : fail)(
      "【139e】手机页所有接口走 PATH_PREFIX（经 /t/<id> 访问时绝对路径会跑出前缀）"
    );
    (tunnelPage.includes('apiUrl("/apk")') && !tunnelPage.includes('baseUrl + "/apk"') ? ok : fail)(
      "【139e】安装包入口用 apiUrl（旧实现引用了未定义的 baseUrl ⇒ 点了必抛错）"
    );
    (androidSrc.includes("baseOf(normalize(raw))") && androidSrc.includes("baseOf(stored)") && androidSrc.includes('indexOf("/r/")') ? ok : fail)(
      "【139e】APK 存扫码链接时必须保留 /t/<id> 前缀（只存 origin 会 404）"
    );
    (relaySrc.includes("let submitting = false") && relaySrc.includes("if (submitting) return") && !relaySrc.includes('location.href = API_BASE') ? ok : fail)(
      "【139e】配对防重复：自动提交与手点只发一次；审批后用 location.replace（⛔ href 会让返回键回到配对页）"
    );
    (gwSrc.includes("这台电脑还没连上") && gwSrc.includes("res.writeHead(503") ? ok : fail)(
      "【139e】旧地址连不上时要给人话（503 说明页），⛔ 不许把 socket hang up 原样甩给用户"
    );
    (relaySrc.includes("function resetSubmit()") && relaySrc.includes("resetSubmit(); el.className") ? ok : fail)(
      "【139e】配对被拒/过期/超时后必须解锁提交按钮（否则用户只能刷新页面）"
    );
    (gwSrc.includes("escapeHtml(error?.message") && gwSrc.includes("AbortSignal.timeout(60_000)") ? ok : fail)(
      "【139e】网关：错误文本转义 + 拉安装包带超时（坏镜像不许挂死请求）"
    );
    (gwSrc.includes("lastPong") && gwSrc.includes("REQ_TIMEOUT_MS = 20_000") ? ok : fail)(
      "【139e】网关有心跳与更短超时：隧道半死时手机不会干等 35s（返回前先判死并踢连接）"
    );
    ((function(){ const a=relaySrc.indexOf("const API_BASE = (function(){"); const k=relaySrc.indexOf("const STORAGE_HOST = location.host"); return a>=0 && k>a; })() ? ok : fail)(
      "【139e】配对页 API_BASE 必须先于存储键作用域声明（TDZ：先使用后声明 = 整段脚本挂掉、按钮点了没反应）"
    );
    (tunnelPage.includes("const STORAGE_HOST = location.host") && relaySrc.includes("const STORAGE_HOST = location.host") && relaySrc.includes("const legacyKey = (name) => name + API_BASE") ? ok : fail)(
      "【139e】手机记忆按主机分桶：同一部手机连两台电脑不互相覆盖，同一台电脑根地址与 /t 入口共享设备秘密（⛔ 旧的前缀分桶 = 每次重开都要重配对）"
    );
    (relaySrc.includes("const API_BASE = (function(){ const p = location.pathname") && !relaySrc.includes('fetch("/api/pair' ) ? ok : fail)(
      "【139e】配对页也必须走 API_BASE（中转路径下 /api/pair 绝对路径 = 配对永远失败）"
    );
    (gwSrc.includes("ensureApkFile") && gwSrc.includes("gh-proxy.com/") && gwSrc.includes("ghfast.top/") && !gwSrc.includes("Location: APK_URL") ? ok : fail)(
      "【139e】安装包由网关自己缓存后直发（镜像序 gh-proxy → ghfast → 直连）；⛔ 不许 302 到 GitHub（国内手机下不动）"
    );
    /* 真跑：把生成页面的 <script> 逐个交给 new Function 解析 ——
       一次手滑的括号（10-29 实测：localStorage 键加前缀写坏了）就让整页 JS 静默挂掉（空白 + 一直「连接中」）。 */
    {
      let pageSyntaxOk = true;
      try {
        const mod = await import(pathToFileURL(join(ROOT, "dist-electron", "remote", "web-page.js")).href);
        const build = mod.buildRemotePageHtml ?? mod.default?.buildRemotePageHtml;
        const html = build("mobile", undefined, undefined, "Codex Harness");
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
        for (const code of scripts) { try { new Function(code); } catch (error) { pageSyntaxOk = false; console.log("      页面脚本语法错误：", error.message); } }
      } catch (error) { pageSyntaxOk = false; console.log("      页面脚本解析失败：", error.message); }
      (pageSyntaxOk ? ok : fail)("【139e】手机页脚本必须能解析（括号/声明顺序错误会让整页 JS 静默挂掉）");
    }
    (relaySrc.includes("#code=") && relaySrc.includes("writeStore(KEY_CODE, code)") ? ok : fail)(
      "【139e】二维码带连接码（扫完自动配对）+ 手输电码按主机保存、下次自动填"
    );
    {
      let stripOk = false;
      try {
        const mod = await import(pathToFileURL(join(ROOT, "src", "lib", "harness-block-strip.mjs")).href);
        stripOk = mod.stripHarnessBlocks("<!--boss-role-->角色块<!--/boss-role-->你好") === "你好";
      } catch (error) { console.log("      剥离模块导入失败：", error.message); }
      (stripOk ? ok : fail)("【139e】手机读历史必须剥掉 <!--boss-role--> 角色块（用户截图：整块注入显示在气泡里）");
    }
    (androidSrc.includes("R.id.code") && androidSrc.includes("R.id.connect") && androidSrc.includes("R.id.scan") ? ok : fail)(
      "【139e】安卓首屏保留手输连接码 + 扫码（两个入口，同一个界面）"
    );
    ((androidSrc.includes("setOrientationLocked(true)") && readFileSync(join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8").includes('android:screenOrientation="portrait"') && readFileSync(join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8").includes("tools:replace=\"android:screenOrientation\"")) ? ok : fail)(
      "【139e】扫码页必须竖屏（zxing 默认 sensorLandscape，必须 tools:replace 覆盖）"
    );
    (androidSrc.includes("startConnect(code == null") && androidSrc.includes('"/api/pair"') && androidSrc.includes("pollApproval") && !androidSrc.includes("openChat(") ? ok : fail)(
      "【139e】配对在 App 内一次完成：手输码保留 + 直接 POST /api/pair 并轮询批准（⛔ 不再打开网页配对页）"
    );
    (androidSrc.includes("for (int attempt = 0; attempt < 3") && androidSrc.includes("removeIf") && androidSrc.includes("postDelayed(() -> web.loadUrl") ? ok : fail)(
      "【139e】冷启动自动登录要重试（中转未就绪不许让人白输码）+ Cookie 去重 + 进页前等一拍"
    );
    ((function(){ try { const ui=readFileSync(join(ROOT, "src/features/app-view/AppView/04-remote-approval.tsx"), "utf8"); return ui.includes("pullCode") && ui.includes("remotePairState") && ui.includes("setRemoteQr"); } catch(e) { return false; } })() ? ok : fail)(
      "【139e】弹窗里的配对码 / 二维码要跟着后台轮换自动换新（否则用户照旧码输，永远过期）"
    );
    ((function(){ const at = relaySrc.indexOf("private checkPairingCode"); const body = at >= 0 ? relaySrc.slice(at, at + 900) : ""; return body.includes("value === this.pairing.code") && body.includes("this.pairing.tries += 1") && body.indexOf("this.pairing.tries = 0") < body.indexOf("this.pairing.tries += 1"); })() ? ok : fail)(
      "【139e】配对码只有输错才计次（⛔ 输对/宽限命中必须先清零，第 10 次输对不能被作废）"
    );
    ((function(){ try { const ui=readFileSync(join(ROOT, "src/features/app-view/AppView/04-remote-approval.tsx"), "utf8"); return ui.includes("data-pair-code-value") && ui.includes("本窗口：") ; } catch(e) { return false; } })() ? ok : fail)(
      "【139e】配对面板要显示「本窗口的 6 位码 + 地址」——两台电脑的码不同，避免抄错窗口"
    );
    (relaySrc.includes("encodeURIComponent(this.pairingCode())") ? ok : fail)(
      "【139e】二维码必须用 pairingCode()（过期自动轮换），⛔ 不能把可能过期的码嵌进去"
    );
    (tunnelPage.includes("function maybeReauth") && tunnelPage.includes("data.error === \"unauthorized\"") ? ok : fail)(
      "【139e】电脑端重启后旧页面 401 必须自动重载恢复（⛔ 不能只弹「加载失败：unauthorized」等到用户手点）"
    );
    (relaySrc.includes("secretHash: typeof value.secretHash") ? ok : fail)(
      "【139e】已配对设备读盘必须带回 secretHash（丢了 = 重启电脑端后手机被迫重输码）"
    );
    (relaySrc.includes("DEVICE_TTL_MS") && relaySrc.includes("private pruneApproved()") && relaySrc.includes("this.pruneApproved();") ? ok : fail)(
      "【139e】已配对设备 30 天未连接自动清理（启动时 + 读列表时），列表不再无限增长"
    );
    /* 10-30 用户要求：加一个断开连接功能 —— 连接后右上角「断开」，清凭据回连接页。 */

    {
      /* 10-30 用户实测：「ppcode 手机 App 能看到思考，codex harness 手机 App 看不到」。
         根因：`thread/resume` 回读的 reasoning.summary 是**字符串数组**，流式 item 是对象数组；
         代码只读 part.text ⇒ 历史思考恒为空。这里真跑编译产物，两种形状都必须取到文本。 */
      let shapeOk = false;
      let wiringOk = false;
      try {
        const mod = await import(pathToFileURL(join(ROOT, "dist-electron", "reasoning-text.js")).href);
        const fn = mod.reasoningItemText ?? mod.default?.reasoningItemText;
        shapeOk = typeof fn === "function"
          && fn({ summary: [{ type: "summary_text", text: "增量摘要" }], content: [] }) === "增量摘要"
          && fn({ summary: ["回读摘要"], content: [] }) === "回读摘要"
          && fn({ summary: [], content: [{ type: "reasoning_text", text: "正文兜底" }] }) === "正文兜底"
          && fn({ summary: [""] }) === "";
        const bootSrc = readFileSync(join(ROOT, "electron/features/boot.ts"), "utf8");
        const botSrc = readFileSync(join(ROOT, "electron/bot-stream.ts"), "utf8");
        wiringOk = codeOnly(mainSrc).includes("reasoningItemText(")
          && bootSrc.includes("reasoningItemText(")
          && botSrc.includes("reasoningItemText(")
          && !/map\(\(part: any\) => String\(part\?\.text \?\? ""\)\)/.test(codeOnly(mainSrc));
      } catch (error) { console.log("      reasoning-text 产物解析失败：", error.message); }
      (shapeOk ? ok : fail)("【139e】思考文本两种形状都要取到（流式对象数组 / resume 回读字符串数组）");
      (wiringOk ? ok : fail)("【139e】手机历史 + 实时兜底 + 机器人转发统一走 reasoningItemText（⛔ 不许各写一份只认 part.text）");
    }
    /* 10-30 用户实测：「手机首页不选会话直接发消息会失败」。两条根因一起钉住：
       ① 建会话把**原始供应商 id** 传给引擎，而当前生效 provider 是统一的 harness ⇒ 首轮 turn/start 被拒；
       ② 从首页进入时要清掉上一段会话的残留气泡，发完自动停在会话视图。 */
    (tunnelPage.includes("const fromHome = homeVisible") && tunnelPage.includes('if (fromHome) list.innerHTML = "";')
      && tunnelPage.includes('await rpc({ type: "new-thread"') && tunnelPage.includes('await rpc({ type: "send-message"') ? ok : fail)(
      "【139e】首页直接发消息：先建会话再发送，并清掉上一段会话的残留消息（不选会话也能发）"
    );
    {
      /* 10-31 用户实测：「App 远程发起的会话模型用不了，电脑端发起的正常」。两条都要满足：
         ① 绑统一 harness 通道（传原始供应商 id 会被引擎拒）；
         ② base_url 必须过本地协议桥 bridgeDial（⛔ 用原始上游地址会绕过桥：chat 类上游拿不到适配、
            云通道拿不到注入凭据 ⇒ 发送成功但模型零输出）。 */
      const threadProviderSrc = readFileSync(join(ROOT, "electron", "thread-provider.ts"), "utf8");
      let providerOk = false;
      try {
        const mod = await import(pathToFileURL(join(ROOT, "dist-electron", "thread-provider.js")).href);
        const fn = mod.harnessProviderConfig ?? mod.default?.harnessProviderConfig;
        const bound = fn?.({ name: "云端模型", baseUrl: "https://example.com/v1", provider: "cloud" });
        const baseUrl = String(bound?.config?.model_providers?.harness?.base_url ?? "");
        providerOk = typeof fn === "function"
          && bound?.modelProvider === "harness"
          && bound?.config?.model_provider === "harness"
          && (baseUrl === "https://example.com/v1" || baseUrl.startsWith("http://127.0.0.1:"))
          && threadProviderSrc.includes("bridgeDial(providerId, model.baseUrl)")
          && JSON.stringify(fn({ provider: "openai-official" })) === "{}";
      } catch (error) { console.log("      thread-provider 产物解析失败：", error.message); }
      (providerOk ? ok : fail)("【139e】手机建会话：统一 harness 通道 + base_url 过本地协议桥（⛔ 原始地址 = 远程会话零输出）");
    }
    (codeOnly(mainSrc).includes("harnessProviderConfig(model)") && tunnelPage.includes("const BRAND_ICON")
      && tunnelPage.includes('logo.className = "home-logo"') && relaySrc.includes("this.events.brandIcon")
      && codeOnly(mainSrc).includes("brandIcon: remoteBrandIcon") ? ok : fail)(
      "【139e】手机首页图标 = 本仓自己的应用图标（brandIcon 从 main 贯通到页面；⛔ 不用写死的 ✦）"
    );
    /* 10-30 用户截图：PPcode 手机输完配对码在「已登录，正在进入… / 正在自动登录…」之间死循环。
       根因：网关**根地址配对**只回自己的 chm_dev，把电脑端的 harness_remote / harness_device 丢了
       ⇒ 跳 /t/<id>/r/mobile 仍判未授权 ⇒ 回配对页 ⇒ 再自动登录。 */
    (gwSrc.includes("const desktopCookies = out.headers?.[\"set-cookie\"]") && gwSrc.includes("jsonReply(res, 200, parsed, { \"set-cookie\": jar })") ? ok : fail)(
      "【139e】根地址配对必须把电脑端的登录 cookie 一起下发（⛔ 丢 cookie = 手机在配对页死循环）"
    );
    /* 10-30 用户：「同一个手机还要反复配对，连接状态持久化都没有」——两条根因各钉一条。
       ① accessToken 每次启动随机生成 ⇒ 手机 cookie 全废；② 手机 localStorage 键按 URL 前缀分桶
       ⇒ 根地址 / /t/<id> 两套互读不到，设备秘密丢失 = 每次重开都要重新输码。 */
    (relaySrc.includes("loadAccessToken(") && relaySrc.includes("remote-auth.json") && !/this\.accessToken = (?:require\("node:crypto"\)\.)?randomBytes\(16\)/.test(relaySrc) ? ok : fail)(
      "【139e】远控 accessToken 必须跨重启持久化（⛔ 每次启动随机生成 = 手机每次都要重新配对）"
    );
    (tunnelPage.includes("const STORAGE_HOST = location.host") && tunnelPage.includes("function readStore(")
      && tunnelPage.includes("function dropStore(") && relaySrc.includes("const KEY_TRIES")
      && relaySrc.includes("if (autoTries() >= 3)") ? ok : fail)(
      "【139e】手机侧记忆按主机分桶 + 自动登录熔断（⛔ 前缀分桶 = 设备秘密丢失；⛔ 无熔断 = 配对页死循环）"
    );
    /* 10-31 用户：「同一个手机都识别不出来，一个手机可以反复连接，旧的配对自动清掉」
       ⇒ 手机上报稳定指纹（UA/语言/时区/分辨率）；审批通过时清掉**同指纹**的旧记录。 */
    (relaySrc.includes("const DEVICE_FP") && relaySrc.includes("fingerprint: DEVICE_FP")
      && relaySrc.includes("info.fingerprint === req.fingerprint") ? ok : fail)(
      "【139e】同一台手机重新配对后自动清掉旧记录（稳定指纹；历史无指纹的只清同名且 24h 未连的）"
    );
    /* 10-31 用户：「codex harness App 老是显示配对失败/验证码过期，我填的对的」。两处根因：
       ① 机器上有残留进程占着远控端口 ⇒ 远控起不来，手机连的其实是别的/连不上；
       ② 到期轮换那一秒/手机还预填着旧码 ⇒ 输对了也被判过期。 */
    (relaySrc.includes("EADDRINUSE") && relaySrc.includes("listenOn(this.server, 0)") && relaySrc.includes("内建中转按实际端口转发") ? ok : fail)(
      "【139e】远控端口被占用必须退到临时端口（⛔ 残留进程占 17891 = 手机永远连不上）"
    );
    (relaySrc.includes("previousCode") && relaySrc.includes("rotatePairingCode(\"expiry\")") && relaySrc.includes("writeStore(KEY_CODE, \"\")") ? ok : fail)(
      "【139e】配对码到期有 2 分钟宽限；被判失效后手机端清掉预填旧码（⛔ 否则一直\"填的对却过期\"）"
    );
    /* 10-31 用户截图：同一台 Xiaomi 两条「已批准的设备」；且换过 deviceId 的手机识别不出来。 */
    (relaySrc.includes("private dedupeApproved") && relaySrc.includes("\"name:\" + String(info.name") ? ok : fail)(
      "【139e】旧重复设备记录合并（同名/同指纹只留最近连接的一条；⛔ 不同指纹不合并）"
    );
    (relaySrc.includes("const secretMatches = (hash") && relaySrc.includes("同一台手机换了设备 ID") ? ok : fail)(
      "【139e】同一台手机换 deviceId 时按设备秘密迁移记录（⛔ 只认秘密，deviceId 只是标签）"
    );
    const bootSrc139e = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    /* 10-31 用户：「运行状态不同步电脑端、电脑端停了手机不同步、还停止不了、报错反馈没有」。
       ⇒ 回合开始/结束都要推给手机：running（运行中）/ error（失败原因或已停止）/ done。 */
    (bootSrc139e.includes("kind: \"running\"") && bootSrc139e.includes("kind: \"error\"") && bootSrc139e.includes("const endedThreadId = String(p?.threadId ?? eventThreadId(p) ?? \"\")") ? ok : fail)(
      "【139e】手机同步运行状态：turn/started 推 running，aborted/failed 推 error（⛔ threadId 缺失要用 eventThreadId 兜底）"
    );
    (tunnelPage.includes("event.kind === \"running\"") && tunnelPage.includes("event.kind === \"error\"") && tunnelPage.includes("清单读取失败") ? ok : fail)(
      "【139e】手机页处理 running/error（按钮切停止、失败有可见文案；清单/目标读取失败不再静默空白）"
    );
    /* 10-31 用户：「手机点断开连接后，直接把配对设备删除掉，联动做好一点」 */
    (relaySrc.includes("url.startsWith(\"/api/disconnect\") && req.method === \"POST\"") && relaySrc.includes("socketDevice.socket.close()") && relaySrc.includes("this.deviceThreads.delete(deviceId)") ? ok : fail)(
      "【139e】手机断开要联动电脑端：撤销批准记录 + 关长连接 + 清会话映射（⛔ 只清手机 cookie = 两边不一致）"
    );
    (tunnelPage.includes("/api/disconnect") && tunnelPage.includes("localStorage.removeItem(storeKey(\"chm-pair-secret\"))") ? ok : fail)(
      "【139e】手机页「断开连接」先确认再通知电脑端，并清掉本机秘密（电脑端离线也要如实提示）"
    );
    /* 10-31 用户：「给手机 App 加一个白天黑夜切换功能」 */
    (tunnelPage.includes("id=\"theme-btn\"") && tunnelPage.includes("function toggleTheme()") && tunnelPage.includes("storeKey(THEME_KEY)") && tunnelPage.includes("html[data-theme=\"dark\"]") ? ok : fail)(
      "【139e】手机页白天/黑夜切换：按主机记住、默认跟随系统、暗色覆盖到气泡/输入框/面板/代码块"
    );
    (relaySrc.includes("chm-theme@") && relaySrc.includes("html[data-theme=\"dark\"]") ? ok : fail)(
      "【139e】配对页跟随手机主题（选过黑夜时配对页也是黑的）"
    );
    /* 10-31 用户：「首页花点心思，看着有点 low」+ 顶栏图标/拍照/表情 */
    (tunnelPage.includes("home-page") && tunnelPage.includes("home-quick") && tunnelPage.includes("home-thread") && tunnelPage.includes("type: \"list-threads\"") ? ok : fail)(
      "【139e】首页 v2：品牌卡 + 新建/中枢两个主行动 + 最近会话（⛔ 不再只有一句问候）"
    );
    (tunnelPage.includes("EMOJI_GROUPS") && tunnelPage.includes("function openEmoji") && !tunnelPage.includes("camera-pick") && !tunnelPage.includes("takePhoto") && tunnelPage.includes("选择会话") ? ok : fail)(
      "【139e】手机页：表情（与电脑端同一套）/ ⛔ 拍照入口已移除 / 菜单「选择会话」"
    );
    /* 10-31 用户：「语音输入、@ 指令，同步电脑端的」 */
    (tunnelPage.includes("function openMentions") && tunnelPage.includes("mentions: pendingMentions") && !tunnelPage.includes("function voiceInput") ? ok : fail)(
      "【139e】手机页 @ 提及（选中随消息上送；语音入口已按用户要求移除）"
    );
    (codeOnly(mainSrc).includes("buildDispatchCatalog") && codeOnly(mainSrc).includes("mobileMentionBlock(mentions)") && relaySrc.includes("allowedKinds") ? ok : fail)(
      "【139e】@ 提及与电脑端同一目录（专家/团队/子智能体/CLI），主进程过滤 kind 后注入点名块"
    );
    /* 10-31 用户：随系统动画、现代化过渡、菜单好看 */
    (tunnelPage.includes("prefers-reduced-motion") && tunnelPage.includes("@keyframes fade-up") && tunnelPage.includes("@keyframes home-in") && tunnelPage.includes(".ripple") && tunnelPage.includes("menu-group") ? ok : fail)(
      "【139e】手机页动效体系：入场/切换/涟漪/菜单弹出 + 跟随系统减弱动效；☰ 菜单带图标与说明"
    );
    (relaySrc.includes("mobile-remote-v0.1.16") ? ok : fail)(
      "【139e】安装包版本与 Release 对齐（0.1.16）"
    );
  }
}
