/** 07-turn-fold 第 6/6 段：原 07-turn-fold.mjs L4567–L5210（逐字搬运 + 各自成块）。
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



export async function run() {
{
{
    const cmdSrc = readFileSync(join(ROOT, "src", "lib", "command-display.mjs"), "utf8").replace(/\r/g, "");
    const foldSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8").replace(/\r/g, "");
    const cmdCode = cmdSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const foldCode = foldSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (/export function commandIntentOf\(/.test(cmdCode) ? ok : fail)("【127】commandIntentOf 纯函数存在（命令的二级意图）");
    (/const raw = item\.command \? String\(item\.command\) : "";[\s\S]{0,120}group: commandIntentOf\(raw\)/.test(foldCode) ? ok : fail)(
      "【127】commandExecution 按 commandIntentOf 分组（不许一律 command —— 那是「全是运行命令」的根因）"
    );
    (/import \{ diffStats \} from "\.\/diff-stats";/.test(foldCode) && /const next = diffStats\(String\(change\?\.diff \?\? ""\)\);/.test(foldCode) ? ok : fail)(
      "【127】fileChange 用 diffStats 数 +/- 行（与明细卡同一真相源，不许另写一份解析）"
    );
    (/编辑 \{t}/.test(foldSrc) ? ok : fail)("【127】modify 词表用「编辑」（对齐用户截图「编辑 xxx.mjs」）");
    (/\+?\$\{editAdd\} -\$\{editDel\}/.test(foldCode) || /\+\$\{editAdd\} -\$\{editDel\}/.test(foldSrc) ? ok : fail)(
      "【127】摘要尾巴带聚合行数（+N -M —— 真实状态映射）"
    );
    (/SHELL_NAMES\.test\(basename\(commaHead\[1\]\)\)/.test(cmdCode) ? ok : fail)(
      "【127】剥壳认逗号形态启动器（pwsh.exe,-Command —— 不剥则目标提取会把 pwsh 路径当文件）"
    );
    /* ⛔ 运行态思考归段必须带事件顺序兜底（09-23 用户：「下一个正文输出的时候，深度思考板块
       没有被收纳到正文工具折叠里面去」）：上游经常不给 reasoning 回传 completed ⇒ 只看
       status/duration 会把它永远当直播。规则 = 后面已出现工具/正文 ⇒ 必然已结束，进折叠段。
       SessionQueue 的 reasoningActive 有同款规则 —— 两边必须一致，改一边必须同步另一边。 */
    (/const laterWork = units\.slice\(index \+ 1\)\.some\(\(next\) => next\.item\.type !== "reasoning"\);/.test(foldCode) ? ok : fail)(
      "【127】buildSegments 的思考直播判定带事件顺序兜底（后面有工具/正文 ⇒ 折叠段）"
    );
    (/&& !turnFinished;/.test(foldCode) ? ok : fail)(
      "【127】回合结束后不存在直播思考（buildSegments 的 turnFinished 收口）"
    );
    /* ── 表头真实映射（09-24 用户附截图：「这个还是显示已运行没有显示具体的真实映射」）── */
    const termSrc = readFileSync(join(ROOT, "src", "features", "terminal", "TerminalPanel.tsx"), "utf8").replace(/\r/g, "");
    const termCode = termSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (/export function commandPurpose\(/.test(cmdCode) ? ok : fail)("【127】commandPurpose 纯函数存在（从脚本输出标签提炼用途）");
    (/export const INTENT_VERB = \{ read: "查看", search: "定位", modify: "编辑", command: "运行" \}/.test(cmdCode) ? ok : fail)(
      "【127】意图→动词表存在（查看/定位/编辑/运行）"
    );
    (!/const verb = [^;]*"已运行"[^;]*;/.test(termCode) && /const intentVerb = INTENT_VERB\[intent\]/.test(termCode) ? ok : fail)(

      "【127】命令行表头动词按意图映射（⚠️ 不许退回写死的「已运行」—— 那正是用户截图里的问题）"
    );

    /* ⛔ 10-21 新增：命令标题改为**动作短语**（WorkBuddy 形态：标题是人话，命令原文退到次要位置）。
       语义来源只能是命令字面（引擎不给 description）⇒ 认不出必须返回空串、由调用方退回旧 hint，
       ⛔ 绝不许拼一个假动作（"执行操作"这种）—— 那是本仓记过的「注释/文案声称能力」同类假象。 */
    (/export function commandAction\(/.test(cmdCode) ? ok : fail)("【127】commandAction 纯函数存在（命令的动作短语）");
    (/const ACTION_RULES = \[/.test(cmdCode) && /跑守卫 \$\{String\(m\[1\]\)/.test(cmdCode) ? ok : fail)(
      "【127】动作规则表存在且覆盖本仓守卫脚本（`scripts/guards/<名>.mjs` → 「跑守卫 <名>」）"
    );
    (/return out\.length > max \? `\$\{out\.slice\(0, max\)\}…` : out;/.test(cmdCode) ? ok : fail)(
      "【127】动作短语有长度上限（表头是一行，超长截断而不是挤压状态图标）"
    );
    (cmdCode.includes('if (!out) return "";') ? ok : fail)("【127】⛔ 认不出动作时返回空串（不许兜底成假动作）");
    (/import \{ INTENT_VERB, commandAction, commandIntentOf/.test(termCode) ? ok : fail)(
      "【127】命令卡真的 import 了 commandAction（声明了不用 = 装饰品）"
    );
    // 10-29 晚：并行线 7b49fa4ef 把局部变量 command 改名成 commandText（headline 另带失败后缀）
    //   ⇒ 判据跟着**实现语义**走（动作优先、认不出退回 verb），不钉变量拼写。
    (/const action = command\w* \? commandAction\(command\w*\) : "";/.test(termCode) && /\{headline \|\| verb\}/.test(termCode) ? ok : fail)(
      "【127】命令卡表头优先用动作短语、认不出退回 verb（`headline || verb`）"
    );
    (/const headline = headlineText && !\(waitingForApproval && running\)/.test(termCode) ? ok : fail)(
      "【127】动作短语只给审批态让位（技能态已整体搬去技能卡 10-29，命令卡不再因子句让位）"
    );
    /* ⛔⛔ 10-29 用户实测截图：「这个图标全部一样了」—— 每条命令都挂 SquareTerminal，
       14px 下外框+内部符号糊成一枚绿方块，读文件 / 建目录 / 看 git 配置 / 跑脚本 长得一模一样。
       ⇒ 判据两条：① 有按动作分类的映射函数且真的被用；② 表头不许再写死 TerminalSquare。 */
    (/function iconOfCommand\(/.test(termCode) && /const CmdIcon = iconOfCommand\(commandText, intent\)/.test(termCode) ? ok : fail)(
      "【127】命令卡图标按动作分类（读 / 改 / 找 / 目录 / git / 命令）并且真的接了"
    );
    (!/<span className="cmd-icon"><TerminalSquare/.test(termCode) ? ok : fail)(
      "【127】⛔ 命令卡表头图标不再写死 TerminalSquare（否则所有行一个样）"
    );
    /* ★ 10-30 用户实测（截图 + rollout 双证）：会话 cwd 是 D:\测试，模型却在命令里
       `cd 'D:\Codex Harness Desktop'; … .\src\lib\command-display.mjs` ⇒ 卡片把相对路径按**会话目录**
       拼成 D:\测试\src\lib\…，点开就是「文件不存在或不可读」。
       ⛔ 下面这几条**真跑纯函数**（import 源码执行），不是查字符串 —— 解析规则改坏了必须当场红。 */
    {
      const cmdMod = await import(pathToFileURL(join(ROOT, "src", "lib", "command-display.mjs")).href);
      const liveCmd = `cd 'D:\\Codex Harness Desktop'; $f = '.\\src\\lib\\command-display.mjs'; Copy-Item $f`;
      (cmdMod.commandWorkdir(liveCmd) === "D:\\Codex Harness Desktop" ? ok : fail)(
        "【127】commandWorkdir 能解析命令开头的 cd（绝对目录）"
      );
      (cmdMod.resolveCommandTarget(liveCmd, ".\\src\\lib\\command-display.mjs") === "D:\\Codex Harness Desktop\\src\\lib\\command-display.mjs" ? ok : fail)(
        "【127】相对目标按**命令自己的 cd 目录**补全（⛔ 不是会话目录 —— 会话目录拼出来是死链）"
      );
      (cmdMod.resolveCommandTarget("Get-Content .\\a.mjs", ".\\a.mjs") === ".\\a.mjs" ? ok : fail)(
        "【127】命令没 cd 时不猜目录，原样返回（下游按会话目录兜底）"
      );
      (cmdMod.resolveCommandTarget("cd ..; ls", ".\\a.txt") === ".\\a.txt" ? ok : fail)(
        "【127】相对 cd（`cd ..`）推不出真目录 ⇒ 原样返回，不许瞎拼"
      );
      (cmdMod.resolveCommandTarget("cd 'D:\\x'; cat D:\\other\\b.txt", "D:\\other\\b.txt") === "D:\\other\\b.txt" ? ok : fail)(
        "【127】本来就是绝对路径的 ⇒ 不动（不许被 cd 目录改写）"
      );
    }
    /* ★ 10-30 第二次反馈（同一现象）：卡片路径**根本不存在**时（会话目录拼出来的死链），
       用会话台账里的同名真实文件回落一次。⛔ 这几条也**真跑纯函数**。 */
    {
      const fb = await import(pathToFileURL(join(ROOT, "src", "lib", "path-fallback.mjs")).href);
      const B = "\\";
      const req = ["D:", "测试", "src", "lib", "command-display.mjs"].join(B);
      const known = ["D:", "Codex Harness Desktop", "src", "lib", "command-display.mjs"].join(B);
      (fb.pickKnownPathFallback({ requested: req, known, workspace: ["D:", "测试"].join(B) }) === known ? ok : fail)(
        "【127】卡片死链按会话台账回落同名真实文件（用户现场：会话 D:\\测试、真文件在宿主仓）"
      );
      (fb.pickKnownPathFallback({ requested: req, known: ["D:", "x", "src", "app", "command-display.mjs"].join(B), workspace: ["D:", "测试"].join(B) }) === "" ? ok : fail)(
        "【127】⛔ 目录尾段对不上就不回落（宁可报不存在，也不许点开不相干的同名文件）"
      );
      (!fb.pickKnownPathFallback({ requested: req, known: req, workspace: ["D:", "测试"].join(B) }) ? ok : fail)(
        "【127】路径本来就对（同一路径）时不回落"
      );
      {
        const preview = readFileSync(join(ROOT, "src", "hooks", "useFilePreview.ts"), "utf8");
        const rail = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "03-workspace-files.tsx"), "utf8");
        const bridge = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "RightFileBridge.tsx"), "utf8");
        /* 10-30：居中预览与右栏跳转都必须走同一个回落实现（`path-fallback`）；
           右栏的解析已提前到**广播前**（`registerRightFileResolver`）—— ⛔ 三个入口各写一份
           拼路径逻辑，就是"修好一个、另外两个照旧"的来源。 */
        (/resolveForOpen\(/.test(preview) && /lookupKnownFile/.test(preview)
          && /resolveExistingFile\(/.test(rail)
          && /registerRightFileResolver\(/.test(bridge) && /resolveForOpen\(/.test(bridge)
          ? ok : fail)("【127】三处入口（居中预览 / 右栏 / 跳转桥）都接同一套回落，⛔ 别只改一处");
      }
      /* ★ 10-30 二轮：台账里存的常是 **URL 编码**形态（`D:/Codex%20Harness%20Desktop/src/lib/x.mjs`，
         来自 file:// 链接）⇒ 原样入库永远"不存在"（实测：用户那张卡就是因为它点不开）。
         ⇒ 入库与取用两侧都要解一次。 */
      {
        const pathsSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "paths.ts"), "utf8");
        (/function decodeMaybeEncodedPath\(/.test(pathsSrc) && /decodeMaybeEncodedPath\(match\[1\]\)/.test(pathsSrc)
          ? ok : fail)("【127】会话台账入库前解百分号编码（编码态路径永远打不开）");
        const fbSrc = readFileSync(join(ROOT, "src", "lib", "path-fallback.mjs"), "utf8");
        (/decodeURIComponent\(rawKnown\)/.test(fbSrc) ? ok : fail)("【127】回落取用台账值时也解一次（老缓存/其它来源兜住）");
      }
      /* 真跑：用**仓库里真实存在的文件**验证「死链 → 落到同名真文件」，而不是只查字符串 */
      {
        const realFile = join(ROOT, "src", "lib", "command-display.mjs");
        const deadRoot = join(ROOT, "__dead_dir__");
        const requested = join(deadRoot, "src", "lib", "command-display.mjs");
        const pickedNow = fb.pickKnownPathFallback({ requested, known: realFile, workspace: deadRoot });
        (existsSync(realFile) && pickedNow === realFile ? ok : fail)(
          "【127】真跑：死链在同一工作区假设下落到真实文件（磁盘上确实存在）"
        );
      }
    }
    /* 接线：点击必须走 openTarget。⛔ 退回 raw target 就恢复成本次要修的死链。 */
    (/const openTarget = commandText && target \? resolveCommandTarget\(commandText, target\) : target;/.test(termCode)
      && /onOpenFile\(openTarget\)/.test(termCode) && !/onOpenFile\(target\)/.test(termCode)
      ? ok : fail)(
      "【127】命令卡点击用 openTarget（按命令 cd 解析），⛔ 不再用会话目录拼出来的 raw target"
    );
    /* 10-29 用户实测：「编辑文件 / 运行过程中 / 运行完成后那个都不见了」——
       动作短语一旦命中就只剩「写文件」这种无状态说法，运行中和已完成长得一样。
       ⇒ 运行时补「正在」前缀（只给 action：purpose/原文不是动词短语，拼「正在」是病句）。 */
    // 10-29：动作短语尾部的文件名已剥到 `actionVerb`（⛔ 表头不能出现两次文件名）⇒ 前缀基于 actionVerb
    (/running && actionVerb \? `正在\$\{actionVerb\}`/.test(termCode) ? ok : fail)(
      "【127】运行中的命令卡补「正在」前缀（否则运行中与已完成在表头上完全一样）"
    );
    /* 10-29 用户实测：「读文件 TerminalPanel.tsx TerminalPanel.tsx」——文件名重复两次。
       根因是动作规则把文件名拼进短语，表头后面还有一枚 cmd-target ⇒ 必须剥掉尾部目标名。 */
    (/const actionVerb = targetName && action\.endsWith\(targetName\)/.test(termCode) ? ok : fail)(
      "【127】动作短语尾部的文件名要剥掉（表头只留一处文件名，且那一处可点）"
    );
    /* 10-29 用户实测：「文件名字都没有亮，点击也不会联动右边展开」——
       文件名必须是**可点按钮**（onOpenFile → 右侧预览），而不是一段死文本。
       10-30：点击传的是 `openTarget`（按命令自己的 cd 解析过的绝对路径），不再是 raw target。 */
    (/className="cmd-target is-link"/.test(termCode) && /onOpenFile\(openTarget\)/.test(termCode) ? ok : fail)(
      "【127】命令卡文件名可点（联动右侧预览），且不再是死文本"
    );
    /* 10-29 用户令：「编辑文件 / 修改文件 / 生成文件，只要动了文件后面都要加 +N -M」。
       ⛔ 真跑纯函数：写文件才有统计（数组 2 行 → +2），读文件必须返回 null。 */
    {
      const { commandWriteStats } = await import(pathToFileURL(join(ROOT, "src", "lib", "command-display.mjs")).href);
      const write = commandWriteStats("Set-Content .\\a.txt @('x','y')");
      const read = commandWriteStats("Get-Content a.txt");
      ok(write?.added === 2 && read === null,
        "【127】写文件命令才有行数统计（数组 2 行 → +2；读文件 → 不给统计）");
    }
    /* ★ 10-29 用户实测令：「中间有失败，不要在这里显示×显示√就行了」——
       结束的命令行一律 ✓：非零退出大多是正常探测（`git config --get user.name` 没配就 exit 1、
       非仓库里 `git status` 也非零），标成失败只会让人误以为出错。
       ⛔ 退出码仍留在展开体（.cmd-exit），细节不丢；⛔ 不许退回按 exitCode 标 error / 追加「失败」。
       ⛔ 判据取**命令卡切片**（"失败" 在终端面板的加载失败文案里是合法的，不能全文件一刀切）。 */
    const cardSlice = termCode.slice(termCode.indexOf("export function CommandExecutionCard"), termCode.indexOf("export function TerminalPanel"));
    (/const status: ActionStatus = running \? \(waitingForApproval \? "pending" : "running"\) : "done";/.test(cardSlice) ? ok : fail)(
      "【127】结束的命令行状态恒为 done（✓），不按退出码标 ×（10-29 用户令）"
    );
    (cardSlice.length > 1000 && !/失败/.test(cardSlice) ? ok : fail)(
      "【127】命令卡里不再出现「失败」字样（10-29 同一句令；退出码只在展开体里以「退出码 N」出现）"
    );
    (/failed && <div className="cmd-exit">/.test(cardSlice) ? ok : fail)(
      "【127】退出码仍留在展开体（状态收敛不等于细节丢失）"
    );
    (/\[purpose, target\]\.filter\(Boolean\)\.join\(" · "\)/.test(termCode) ? ok : fail)(
      "【127】元信息串 = 用途 · 目标（10-22 起只在**展开体**里显示，看不出目的才算没映射）"
    );
    /* ★ 10-22 用户要求（附 WorkBuddy 截图）：「默认仅展示中文名称，隐藏具体命令内容；每条命令支持
       展开看完整命令；折叠态后面不再显示地址与耗时」。
       ⛔ 表头里再出现命令行/耗时 = 这条需求被打回；⛔ 展开体里必须仍是引擎原文（能照着复现）。 */
    const headSlice = termCode.slice(termCode.indexOf('className="cmd-head"'), termCode.indexOf("<Fold open={open}>"));
    (headSlice.length > 200 && !/cmd-command|displayCommand/.test(headSlice) ? ok : fail)(
      "【127】折叠行不含命令原文（10-22：默认只展示中文，命令内容收进展开体）"
    );
    (!/cmd-duration/.test(headSlice) ? ok : fail)(
      "【127】折叠行不含耗时（10-22 同一句：「不再显示地址与耗时信息」）"
    );
    (/aria-expanded=\{open\}/.test(headSlice) ? ok : fail)(
      "【127】折叠行带 aria-expanded（读屏也知道现在展开没）"
    );
    /* 10-22 二改：用户先要「明确的标识」，看到实测后改成「不要文字、悬停才浮出箭头」。
       ⛔ 两侧都要钉：有箭头（.cmd-toggle）、没有文案（cmd-toggle-text）。 */
    (/className="cmd-toggle"/.test(headSlice) && !/cmd-toggle-text/.test(headSlice) ? ok : fail)(
      "【127】折叠行只有悬停浮现的箭头，没有「展开/收起」字样（用户 10-22 二改）"
    );
    (/\.cmd-card \.cmd-toggle \{[^}]*visibility: hidden/.test(readStyles()) && /\.cmd-card \.cmd-head:hover \.cmd-toggle/.test(readStyles()) ? ok : fail)(
      "【127】箭头默认隐藏、整行 hover 才显形（visibility 保留占位 ⇒ 不抖）"
    );
    (/className="cmd-title-hint"/.test(termCode) && /className="cmd-duration"/.test(termCode) ? ok : fail)(
      "【127】地址/用途 + 耗时搬到展开体元信息行（信息不丢，只是不占折叠行）"
    );
    (/const codeText = \[\s*\n\s*command,/.test(termCode) ? ok : fail)(
      "【127】展开体第一段仍是引擎原文 command（用户要照着复现）"
    );
    /* ★ 10-22 同类需求扩到**所有操作卡**（读取/编辑/查看…）：「统一显示中文，不再显示地址和耗时，
       点击展开看详细内容」。⛔ 表头不许再出现 info（地址/工具名/入参）；⛔ 英文 status 不许上表头。 */
    const cardsSrc = readFileSync(join(ROOT, "src", "features", "session-cards", "SessionCards.tsx"), "utf8").replace(/\r/g, "");
    const itemsSrc = readFileSync(join(ROOT, "src", "features", "session-queue", "ItemView.tsx"), "utf8").replace(/\r/g, "");
    const cardsCode = cardsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const itemsCode = itemsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (!/className="action-info"/.test(cardsCode) ? ok : fail)(
      "【127】操作卡表头不再放 action-info（10-22：地址类信息只进展开体）"
    );
    (/const hasBody = info != null \|\| children != null;/.test(cardsCode) && /className="action-meta"/.test(cardsCode) ? ok : fail)(
      "【127】详情搬进展开体（action-meta），且**有 info 就能点开**（⛔ 以前没有 children 的卡点了没反应）"
    );
    (/className="action-toggle"/.test(cardsCode) && !/action-toggle-text/.test(cardsCode) && /aria-expanded=\{open\}/.test(cardsCode) ? ok : fail)(
      "【127】操作卡同一形态：悬停浮现的箭头（无文案）+ aria-expanded"
    );
    (!/statusText=\{item\.status/.test(itemsCode) ? ok : fail)(
      "【127】⛔ 英文 status（completed / inProgress）不许再上表头（10-22：统一中文）"
    );
    (!/formatDuration\(item\.durationMs\) \|\| label/.test(itemsCode) ? ok : fail)(
      "【127】工具卡表头不再显示耗时（耗时随详情进展开体）"
    );
    (!/verb=\{item\.type\}/.test(itemsCode) ? ok : fail)(
      "【127】兜底卡标题不许直接用英文枚举 `item.type`（改「其他操作」，原文进展开体）"
    );
    /* 「精确到文件，不要再地址」（用户 10-22 补的一句）：折叠行给文件名，完整路径留展开体。 */
    (/className="action-target"/.test(cardsCode) && /const targetName = target \? basename\(target\) : "";/.test(termCode) ? ok : fail)(
      "【127】命令卡折叠行「精确到文件」：目标只取 basename（完整路径在展开体元信息行）"
    );
    (/const howName = basename\(argSummary\(item\.arguments, 400\) \|\| ""\);/.test(itemsCode) && /target=\{howName/.test(itemsCode) ? ok : fail)(
      "【127】工具卡折叠行给文件名（⛔ 先按 400 字取完整入参再 basename —— 48 字截断后再剥会只剩半截）"
    );
    (/\(\?!\[A-Za-z0-9_-\]\)/.test(cmdCode) ? ok : fail)(
      "【127】目标提取带尾部负向断言（防 `.codex-harness` 被截成半截 `.codex`）"
    );
    /* ── 技能归属映射（09-24 用户：「还有使用了技能类似没看见」）── */
    const toolLib = join(ROOT, "src", "lib", "tool-display.mjs");
    const itemSrc = readFileSync(join(ROOT, "src", "features", "session-queue", "ItemView.tsx"), "utf8").replace(/\r/g, "");
    const itemCode = itemSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const toolCode = existsSync(toolLib) ? readFileSync(toolLib, "utf8").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "") : "";
    (existsSync(toolLib) && /export function skillOfItem\(/.test(toolCode) ? ok : fail)(
      "【127】tool-display.mjs 的 skillOfItem 存在（技能归属纯函数）"
    );
    (/const skill = skillOfItem\(item\);[\s\S]{0,320}group: "skill"/.test(foldCode) ? ok : fail)(
      "【127】折叠原子优先按技能归类（命中 ⇒ group=skill，摘要出「使用技能 …」）"
    );
    (/skill: \{ topic: "使用技能 \{t\}"/.test(foldSrc) ? ok : fail)("【127】词表有 skill 档（使用技能）");
    (/const skill = skillOfItem\(item\);/.test(itemCode) && /<code>\{skill \? skill\.label : title\}<\/code>/.test(itemCode) ? ok : fail)(
      "【127】工具卡详情显示技能中文名（10-22 起在展开体里；使用技能而不是「调用 server/tool」）"
    );
    /* ── 技能 / 插件 / MCP 「怎么用的」（09-24 用户：「技能，插件，mcp 等等都要展示出来怎么用了」）── */
    (/export function argSummary\(/.test(toolCode) ? ok : fail)("【127】argSummary 纯函数存在（从入参提炼「怎么用了」）");
    (/const source = skill \? "技能" : isMcp \? "MCP" : "插件";/.test(itemCode) ? ok : fail)(
      "【127】工具卡标明来源：技能 / MCP / 插件（mcpToolCall=MCP，dynamicToolCall=插件动态工具）"
    );
    (/className="action-arg"/.test(itemCode) ? ok : fail)("【127】工具卡显示关键入参（用了什么 url/路径/查询词）");
    /* ── ⑱ 工具卡标题 = 模型自己写的「这一步在干什么」（10-21，参照 WorkBuddy 的工具卡形态）────
       命令卡只能从字面反推（commandAction）；工具卡有**语义通道**：工具面里注入一个可选 `step`，
       模型调用时填一句中文 ⇒ 卡片直接拿它当标题，工具名与入参退到次级行。
       ⛔ 引擎内置的 exec_command / shell **走不了这条路**（0.162.1 二进制原文：
          "`justification` requires an explicit `sandbox_permissions`"）—— 填了就变成审批请求，
          所以引擎内置命令仍是 commandAction 规则推断，两条通道各管一半，别混。 */
    const stepLib = join(ROOT, "src", "lib", "step-note.mjs");
    const stepCode = existsSync(stepLib) ? readFileSync(stepLib, "utf8").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "") : "";
    (existsSync(stepLib) && /export function withStepParam\(/.test(stepCode) && /export function stripStepParam\(/.test(stepCode) && /export function stepOf\(/.test(stepCode) ? ok : fail)(
      "【127】step-note.mjs 三件套齐（注入 / 剥离 / 读取 —— 单一真相源，⛔ 不许各工具 schema 各写一份）"
    );
    const codexIpcSrc = readFileSync(join(ROOT, "electron", "features", "codex-ipc.ts"), "utf8").replace(/\r/g, "");
    (/withStepParam\(\(params as any\)\.dynamicTools\)/.test(codexIpcSrc) && /syncToolSurfaceAsync\(codexHome, resumeThreadId, withStepParam\(resumeTools\)/.test(codexIpcSrc) ? ok : fail)(
      "【127】注入点是主进程工具面**两处**（thread/start MCP 合并后 + resume 改写 rollout 首行前）—— ⛔ 少 resume 那处，老会话 resume 一次就退回无 step 的旧形态"
    );
    const bridgeSrc = readFileSync(join(ROOT, "electron", "mcp-bridge.ts"), "utf8").replace(/\r/g, "");
    (/stripStepParam\(args && typeof args === "object"/.test(bridgeSrc) ? ok : fail)(
      "【127】⛔ 转发前剥离 `step`（严校验的 MCP 服务器会把它当非法入参；剥离点只放 callMcpTool 一处）"
    );
    (/const step = skill \? "" : stepOf\(item\.arguments\);/.test(itemCode) && /const verb = step[\s\S]{0,80}: skill/.test(itemCode) ? ok : fail)(
      "【127】工具卡标题优先 `step`，但**技能态优先**（读 SKILL.md 也是一次工具调用，不许被「看一眼」盖掉技能名）"
    );
    (/case "mcpToolCall": \{[\s\S]{0,600}stepOf\(item\.arguments\)/.test(foldCode) ? ok : fail)(
      "【127】折叠芯片同样优先 `step`（芯片只有一行，人话比「名 · 参数」好读）"
    );
    const delegateSrc = readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8").replace(/\r/g, "");
    const teamsSrc = readFileSync(join(ROOT, "electron", "features", "teams-ipc.ts"), "utf8").replace(/\r/g, "");
    (/withStepParam\(\[\.\.\.teamTools/.test(delegateSrc) && /withStepParam\(\[teamTool, teamPhaseTool/.test(teamsSrc) ? ok : fail)(
      "【127】委派 / 团队会话的工具面也包了（主进程自己发的 thread/start **不经过** codex-ipc 拦截）"
    );
    /* 运行时真跑（⛔ 只断言源码文本会「自洽地错」：正则绿着、函数是坏的也照样过） */
    {
      const stepMod = await import("../../../src/lib/step-note.mjs");
      const sample = { type: "function", name: "t", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } };
      const once = stepMod.withStepParam([sample])[0];
      const twice = stepMod.withStepParam([once])[0];
      (Boolean(once.inputSchema.properties.step) && JSON.stringify(once) === JSON.stringify(twice) ? ok : fail)(
        "【127】`step` 注入**幂等**且不碰 required（重复注入不会长出两个键）"
      );
      (JSON.stringify(stepMod.stripStepParam({ q: "x", step: "播放" })) === JSON.stringify({ q: "x" }) ? ok : fail)(
        "【127】转发前剥离**真的**去掉了 `step`（其余入参一字不动）"
      );
      (stepMod.stepOf({ step: "很".repeat(41) }) === "" && stepMod.stepOf({ step: "" }) === "" ? ok : fail)(
        "【127】⛔ 空 / 超长的 `step` 一律当没填（返空串 ⇒ 调用方退回原标签，绝不显示半句话）"
      );
    }

    (/mcp: \{ topic: "调用 MCP \{t\}"/.test(foldSrc) && /plugin: \{ topic: "用插件 \{t\}"/.test(foldSrc) ? ok : fail)(
      "【127】词表有 mcp / plugin 两档（不再混进含糊的「调用服务」）"
    );
    /* ⛔ 命中文路径（09-24 实测：`markitdown D:/x/报告.pdf` 取不到目标 ⇒ 只剩技能名） */
    (/const SEG = "\[A-Za-z0-9_\.@%~\+\\\\u4e00-\\\\u9fff-\]"/.test(cmdCode) ? ok : fail)(
      "【127】commandTarget 的路径段允许中文（否则中文文件名取不到目标）"
    );
    (/SKILL_PATH_RE\s*=/.test(toolCode) && /byPath\[1\]/.test(toolCode) ? ok : fail)(
      "【127】技能识别带目录路径兜底（`…/skills/<名>/…`，用户自建技能名不在内置表也照样显示）"
    );
    (/cache\[\\\\\/\]\[A-Za-z0-9\._-\]\+\[\\\\\/\]\)?/.test(toolCode) ? ok : fail)(
      "【127】插件路径取插件名而不是 vendor 名（`plugins/cache/<vendor>/<plugin>`，取错等于没信息）"
    );
    /* ── 技能使用卡（10-29 用户：「为啥使用技能是运行命令呢…做一个使用技能展示，不要展示运行命令」）──
       ⛔ 技能从命令卡里**整体搬出**：命中技能 ⇒ ItemView 走 skill-usage 的卡，命令卡不再兼职。
          以下判据钉的就是这次搬家的三件事：路由、动词、说明（映射反馈）。 */
    const skillSrc = readFileSync(join(ROOT, "src/features/skill-usage/SkillUsageCard.tsx"), "utf8").replace(/\r/g, "");
    const skillCode = skillSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    (/if \(skillOfItem\(item\)\) return <SkillUsageCard/.test(itemsCode) ? ok : fail)(
      "【127】命中技能的命令走**技能卡**（ItemView 分流，命令卡完全不参与 ⇒ 不会出现「正在运行命令」）"
    );
    (!/skillOfItem|skillTargetLabel/.test(termCode) ? ok : fail)(
      "【127】⛔ 命令卡里不再有技能分支（一份形态一个渲染口；两处兼职必然漂移）"
    );
    (/const skill = skillOfItem\(item\);/.test(skillCode) && /skill\.description/.test(skillCode) ? ok : fail)(
      "【127】技能卡带**说明**（「这个技能是干什么的」常驻表头第二行 —— 用户要的映射反馈）"
    );
    (/running \? "正在使用技能"[\s\S]{0,90}"使用技能失败"[\s\S]{0,50}"已使用技能"/.test(skillCode) ? ok : fail)(
      "【127】技能卡动词按技能走（正在使用技能 / 使用技能失败 / 已使用技能 三态齐全）"
    );
    (/target=\{<code>\{skill\.label\}<\/code>\}/.test(skillCode) ? ok : fail)(
      "【127】技能卡表头显示技能中文名（不许退回剥壳后的命令原文）"
    );
    (!/skill-usage-command|command\}<\/code>/.test(skillCode) ? ok : fail)(
      "【127】⛔ 技能卡不展示命令原文（用户 10-29：「不要展示运行命令」）"
    );
    /* 运行时真跑（⛔ 只断言源码文本会「自洽地错」）：动作行与「打开技能说明」的路径判定 */
    {
      const toolMod = await import("../../../src/lib/tool-display.mjs");
      (toolMod.skillActionOf('Get-Content -LiteralPath "C:/a/skills/x/SKILL.md"') === "读取技能说明"
        && toolMod.skillActionOf("node C:/a/skills/x/run.mjs") === "运行技能脚本 run.mjs"
        && toolMod.skillActionOf("echo hi") === "执行技能命令"
        && toolMod.skillActionOf("") === "" ? ok : fail)(
        "【127】技能卡动作行真跑（读说明 / 跑脚本 / 其余；认不出返空串 ⇒ 不显示假动作）"
      );
      (toolMod.skillFilePathOf("Get-Content 'C:/a/skills/x/SKILL.md'") === "C:/a/skills/x/SKILL.md"
        && toolMod.skillFilePathOf("cat SKILL.md") === "" ? ok : fail)(
        "【127】⛔ 只有绝对路径才给「打开技能说明」（相对 SKILL.md 交给 onOpenFile 会去开错文件）"
      );
    }
    (/skillTargetLabel\(/.test(foldCode) ? ok : fail)(
      "【127】折叠芯片的技能目标走 skillTargetLabel（半截路径 / 技能目录内 / 纯点目录 一律丢弃）"
    );
    (/const isDotDir = \(v\) => \/\^\\\.\[A-Za-z0-9_-\]\+\$\/.test\(v\);/.test(toolCode) ? ok : fail)(
      "【127】纯点目录段（`.workbuddy`）丢弃 —— commandTarget 会把它误当扩展名先命中"
    );
    (/export function registerKnownSkills\(/.test(toolCode) && /KNOWN_SKILLS\.get\(/.test(toolCode) ? ok : fail)(
      "【127】技能显示支持本地清单（目录名 → descriptionZh/description，自建技能才看得懂）"
    );
    const skillHostPart = join(ROOT, "src", "features", "app-state", "parts", "part01", "03-accounts-connectors-rate-limit", "01-accounts-connectors-skills.tsx");
    (existsSync(skillHostPart) && /window\.codex\?\.listLocalSkills\?\.\(\)/.test(readFileSync(skillHostPart, "utf8")) ? ok : fail)(
      "【127】启动把 skills:local-list 喂进展示层（不注册就退回目录名）"
    );
    (/if \(hay && item\?\.arguments\) hay \+= /.test(toolCode) ? ok : fail)(
      "【127】工具入参也纳入技能匹配串（技能路径可能只出现在 arguments 里）"
    );
  }
}

{
{
    const mdSrc = readFileSync(join(ROOT, "src", "features", "markdown", "Markdown.tsx"), "utf8");
    if (/from "\.\.\/\.\.\/lib\/markdown-blocks\.mjs"/.test(mdSrc)) ok("【149】Markdown.tsx 的分块取自 src/lib/markdown-blocks.mjs");
    else fail("【149】Markdown.tsx 必须 import src/lib/markdown-blocks.mjs（分块逻辑只允许一份）");
    if (/function splitMarkdown/.test(codeOnly(mdSrc))) fail("【149】Markdown.tsx 又出现本地 splitMarkdown 实现（两份必然漂移）");
    else ok("【149】Markdown.tsx 无本地分块实现残留");

    const soft = (lines) => splitMarkdown(lines.join("\n"));
    const ord = soft(["27. 一鸣惊人", "30. 四通八达", "1–10 全是「数字开头」"]);
    if (ord.length === 1 && /\n\n/.test(ord[0]) && ord[0].endsWith("1–10 全是「数字开头」")) ok("【149】有序列表尾部的顶格结语行前补空行（不再落进最后一个 li）");
    else fail("【149】有序列表尾部结语仍被当 lazy 续行：" + JSON.stringify(ord));
    const unl = soft(["- 甲", "- 乙", "（结语）"]);
    if (unl.length === 1 && /\n\n（结语）$/.test(unl[0])) ok("【149】无序列表同款处理");
    else fail("【149】无序列表尾部结语未处理：" + JSON.stringify(unl));
    const indented = ["1. 甲", "   缩进续行"];
    if (soft(indented).join("\n") === indented.join("\n")) ok("【149】缩进的续行不动（作者本意是列表项内续行）");
    else fail("【149】缩进续行被误拆：" + JSON.stringify(soft(indented)));
    const plain = ["只是一段普通文字。"];
    if (soft(plain).join("\n") === plain.join("\n")) ok("【149】纯段落原样不动");
    else fail("【149】纯段落被改动：" + JSON.stringify(soft(plain)));
    const fenced = ["```js", "1. 甲", "结语"];
    if (soft(fenced).join("\n") === fenced.join("\n")) ok("【149】围栏内（含流式未闭合）不注入空行 —— 否则会改动代码块内容");
    else fail("【149】围栏内被注入空行：" + JSON.stringify(soft(fenced)));

    // ⛔ math 块同理（09-27 接入公式渲染时补）：`$$ … $$` 内的空行**不许切块** —— 否则跨空行的
    //   多行公式被切成两块、两半各含落单的 `$$`，rehype-katex 认不出，直接渲染成字面 `$$` 文本。
    //   实测当时四种形态里只有「多行 + 含空行」会坏，而模型输出多行公式常带空行 ⇒ 必须钉住。
    const mathMulti = ["$$", "E = mc^2", "", "F = ma", "$$"];
    const mathBlocks = soft(mathMulti);
    if (mathBlocks.length === 1) ok("【149】多行公式（含空行）不切块（切了会各含落单 $$ ⇒ 渲染成字面文本）");
    else fail("【149】多行公式被切成 " + mathBlocks.length + " 块：" + JSON.stringify(mathBlocks));
    const inlineMath = ["$$E = mc^2$$ 前面的说明", "", "后一段"];
    if (soft(inlineMath).length === 2) ok("【149】单行完整公式（$$…$$ 自成一对）不翻转 math 状态（否则会把后续内容整段吞掉）");
    else fail("【149】单行公式被误判：" + JSON.stringify(soft(inlineMath)));
    const dollarVars = ["echo $HOME 与 $PATH", "", "下一段"];
    if (soft(dollarVars).length === 2) ok("【149】shell 变量（$VAR）不触发 math 状态");
    else fail("【149】shell 变量被误当公式：" + JSON.stringify(soft(dollarVars)));

    // 09-24 二次反馈（截图里列表 → 空档 → **仍然缩进**的两行）⇒ 另一种成因：正文行首的
    // **全角空格 U+3000**。它在 HTML 里不被折叠（只有 ASCII 空格会被折叠），会实打实渲染成
    // 一块可见空白。行尾那种还会把长行挤折、多出一行，所以两端都去。
    const fs1 = "\u3000";
    if (trimInvisibleSpace(fs1 + "甲" + fs1) === "甲") ok("【149】行首/行尾全角空格被去掉（U+3000 不被 HTML 折叠，会渲染成可见空白）");
    else fail("【149】全角空格未被去掉：" + JSON.stringify(trimInvisibleSpace(fs1 + "甲" + fs1)));
    if (trimInvisibleSpace("甲 乙\u00a0") === "甲 乙") ok("【149】U+00A0（不换行空格）同理处理");
    else fail("【149】U+00A0 未处理：" + JSON.stringify(trimInvisibleSpace("甲 乙\u00a0")));
    const fsCase = soft(["30. 四面八方", "", fs1 + "这次与上一版不重复。"]);
    if (fsCase.length === 2 && !fsCase[1].includes(fs1) && fsCase[1].endsWith("这次与上一版不重复。")) ok("【149】端到端：带行首全角空格的结语段不再缩进");
    else fail("【149】端到端未生效：" + JSON.stringify(fsCase));
    const fsFence = ["```js", fs1 + "const a = 1;", "```"];
    if (soft(fsFence).join("\n") === fsFence.join("\n")) ok("【149】围栏内的全角空格原样保留（代码内容一个字符都不许动）");
    else fail("【149】围栏内被改动：" + JSON.stringify(soft(fsFence)));

    // 09-24 真因（用户第三次截图，源文本实测是 `> 1–10 全是…`）：**引用块**。全仓此前一条
    // blockquote 样式都没有 ⇒ 走浏览器默认 `margin: 1em 40px`（左右各缩 40px、零可见标记）
    // = 用户看到的「最后一行凭空歪了、前面空那么多」。必须有显式样式（含左侧竖条）。
    const styles = readStyles();
    if (/\.markdown blockquote\s*\{[^}]*border-left/.test(styles)) ok("【149】引用块有显式样式（左竖条 + 小内边距），不再吃浏览器默认的左右各 40px");
    else fail("【149】.markdown blockquote 缺样式 —— 会退回浏览器默认 margin: 1em 40px（用户报的「歪 + 前面空一块」）");
  }
}

{
{
  const itemSrc = readFileSync(join(ROOT, "src", "features", "shared", "ReasoningCard.tsx"), "utf8").replace(/\r/g, "");
  const styles54 = readStyles();
  // ⓪ 单一真相源（09-26 教训：两份逐字相同的 ReasoningCard 并存，修一份漏另一份，
  //    探针 fit 生效率 0/25 才暴露）。调用点只许 import 共享组件，本地定义 = 事故复发。
  (!/function ReasoningCard\(/.test(readFileSync(join(ROOT, "src", "features", "session-queue", "ItemView.tsx"), "utf8")) ? ok : fail)(
    "【161】⛔ 思考卡单一真相源：session-queue/ItemView 里不得再有本地 ReasoningCard 实现"
  );
  (/export function ReasoningCard/.test(itemSrc) ? ok : fail)(
    "【161】思考卡真相源 = src/features/shared/ReasoningCard.tsx（共享导出）"
  );
  // ① 正文一律走 portal 浮窗（直播与 done 预览同一条路）——内联 Fold 展开已退役：
  //    思考不占消息流布局，工具卡不再被撑出视口（用户 09-26 定稿）。
  (/createPortal\(/.test(itemSrc) ? ok : fail)("【161】自适应模式的正文 = portal 浮窗（直播与预览同路）");
  (!/Fold open=\{open\}/.test(itemSrc) ? ok : fail)("【161】⛔ 内联 Fold 展开不得回归（那是「撑走工具卡」本身）");
  // ② 浮窗与输入框同宽同列（JS 每帧取 composerRect.width/left 写内联样式）。
  (/compR\.width/.test(itemSrc) && /compR\.left/.test(itemSrc) ? ok : fail)(
    "【161】浮窗与输入框同宽同列（width/left 取自 composerRect）"
  );
  // ③ 垂直**按空间自适应**（09-26 用户定稿「位置不固定每次都在下方」）：下方够放下方、
  //    不够放上方、两侧都不够取空间大的一侧；rAF 每帧重选边（追字/滚动/缩放都自适应）。
  (/const spaceBelow = compTop - 8 - chipR\.bottom;/.test(itemSrc) && /const spaceAbove = chipR\.top - 8;/.test(itemSrc) && /spaceAbove >= spaceBelow/.test(itemSrc) && /requestAnimationFrame\(loop\)/.test(itemSrc) ? ok : fail)(
    "【161】浮窗方向按空间自适应（下方/上方/取大侧钳边界），rAF 每帧重选边"
  );
  // ④ macOS 缩放特效：spawn 放大放出 / suck 缩回芯片（forwards 停在消失帧再卸载，
  //    卸载延迟 240ms——直接卸载会跳过特效）；transform-origin 钉在芯片所在的左上角。
  (/reasoning-float-spawn/.test(styles54) && /reasoning-float-suck/.test(styles54) && /transform-origin: 0 0;/.test(styles54) ? ok : fail)(
    "【161】spawn/suck 特效 + transform-origin 0 0（从芯片放大/缩回）必须都在 CSS"
  );
  (/exiting \? "sucking" : ""/.test(itemSrc) && /setTimeout\(\(\) => setExiting\(false\), 240\)/.test(itemSrc) ? ok : fail)(
    "【161】完成吸入 = .sucking 挂 240ms 再卸载（直接卸载会跳过特效）"
  );
  // ⑤ 正文 ≈ 4 行（96px）内部滚动：浮窗高度由此决定（不再有 260px 内联展开）。
  (/max-height: 144px;/.test(styles54) ? ok : fail)(
    "【161】浮窗正文 6 行（144px，09-26 用户要求加高）内部滚动 —— 撑高与裁切从此与思考无关"
  );
  // ⑥ 直播跟随贴底；done 预览不跟（从头读）。
  (/if \(el && reasoningFollowRef\.current\) el\.scrollTop = el\.scrollHeight;/.test(itemSrc) ? ok : fail)(
    "【161】直播跟随 = 每 tick 贴底（最新一行始终可见）"
  );
  // ⑦ 接管只认「真有内部滚动条」的滚轮/触摸（外层滚动冒泡不许误杀卡内跟随）。
  (/const onWheel = \(\) => \{ if \(el\.scrollHeight > el\.clientHeight \+ 1\) reasoningFollowRef\.current = false; \};/.test(itemSrc) ? ok : fail)(
    "【161】卡内接管只认「真有内部滚动条」的滚轮（外层滚动冒泡不许误杀）"
  );
  // ⑩ 吸入动画期间冻结追字（09-26 用户报「完成后展开卡顿一下」）：完成瞬间剩余全文
  //    一次性灌进浮窗 + 定时器每 16ms setDisplayed，与 suck 同帧抢主线程 = 卡顿。
  //    冻结到动画播完再放全文——那时浮窗已卸载，setDisplayed 只重渲染流内芯片，零成本。
  (/if \(exiting\) return;/.test(itemSrc) ? ok : fail)(
    "【161】吸入期间冻结追字（动画播完再放全文，卸载后零成本）"
  );
  // ⑧ 整面可点收起（09-26 用户定稿「留白地方做成折叠收纳的按键」）：点空白/头部收起，
  //    点正文例外（选字/滚动不能误收）。
  (/closest\("\.reasoning-body"\)/.test(itemSrc) && /onClick=\{\(event\) =>/.test(itemSrc) ? ok : fail)(
    "【161】浮窗整面可点收起（点正文例外——选字/滚动不误收）"
  );
  // ⑨ 面板身份色：左 accent 色条 + 头箭头主题蓝（09-26 用户要求加颜色区分；都在 CSS）。
  (/border-left: 3px solid var\(--accent\);/.test(styles54) && /color: var\(--accent\);/.test(styles54) ? ok : fail)(
    "【161】浮窗身份色 = 左 accent 色条 + 头箭头主题蓝（09-26 用户要求）"
  );
  // ⑪ 回合结束**幻影浮窗**（10-06 用户报「所有思考板块在回合结束时会重复播放一次缩放效果」；
  //    animationstart 实测：大折叠重挂载 + 残留揭示标记会让浮窗凭空 spawn→suck 一遍）。
  //    三处修法缺一不可：初始揭示不许用过期标记复活 / 揭示 effect 非直播态清标记且不认标记 /
  //    回合结束后浮窗只认用户显式点开。
  (/if \(running && marked != null && text\.startsWith\(marked\)\) return marked;/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 初始揭示：续播标记只在直播（running）时可用（回合结束重挂载不许复活 revealing）"
  );
  (/if \(!running && !revealing\) bufferedReasoningRevealStarts\.delete\(String\(item\.id\)\);\n\s*const markedStart = running \? bufferedReasoningRevealStarts\.get\(String\(item\.id\)\) : null;/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 揭示 effect：非直播态先清续播标记、且不读它（残留标记 + 文本补写 = 幻影开窗）"
  );
  (/const popupOpen = displayMode === "auto" && open && Boolean\(displayed\) && \(running \? \(streamingNow \|\| manualOpen !== null\) : manualOpen === true\);/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 回合结束后浮窗只认用户显式点开（自动揭示/状态 flicker 一律不许凭空开窗）"
  );
  // ⑫ ⛔⛔ 10-07 组件级探针实测（**单块思考直播期间放大 10 次 / 缩小 10 次**，卡片在
  //    `live open` 与 `live collapsed` 之间来回跳，而头部一直写着「深度思考中」）：
  //    引擎按**大块**投递 reasoning delta，两块之间 16ms 追字定时器必然追平 ⇒ remaining<=0。
  //    旧写法在这里无条件 setRevealing(false) ⇒ open 与 popupOpen 双双转假 ⇒ 浮窗卸载(suck)
  //    → 下一块到达又重挂(spawn) ⇒ 用户报的「经常缩小放大来回闪」+「明明在思考却不自动展开」。
  //    修法 = **直播期间追平了也不收**，收只由 `!running && revealing` 一条决定（两处必须都在）。
  (/if \(running\) return;\n\s*setRevealing\(false\);\n\s*bufferedReasoningRevealStarts\.delete\(String\(item\.id\)\);/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 直播期间追字追平**不许收**（remaining<=0 只是这批大块放完，不是本块结束）"
  );
  (/if \(!running\) \{\n\s*bufferedReasoningRevealStarts\.delete\(String\(item\.id\)\);\n\s*setRevealing\(false\);\n\s*\}/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 追字定时器跑完同样只在非直播态才收（否则每批大块都会关一次浮窗）"
  );
  // ⑬ 10-07 用户报「上个思考板块已经输出完了，下个思考板块出来时，它还会闪一下缩放」：
  //    本块直播结束而**自动**收起时用户没做任何操作，却看到上一块缩成一个小点。
  //    ⇒ 吸入动画只留给用户自己点收起（manualOpen === false 是 toggle 的唯一产出）。
  (/if \(!headRef\.current\?\.isConnected \|\| manualOpen !== false\) \{ setExiting\(false\); return; \}/.test(itemSrc) ? ok : fail)(
    "【161】⛔ 吸入动画只在用户点收起来时播（自动收起/被父容器带走一律静默）"
  );
  // ⑭ 10-20 两种展示形态（用户：「一个长条里面按行展示思考内容（也可以点击展开），
  //    一个是现在的自适应展开展示，默认现在的自适应」）：
  //    · 默认值必须是 auto —— 模式键缺失/非法时一律回落自适应，不能让老用户升级后突然换形态；
  //    · strip 模式走独立组件（消息流内联），不许复制一份追字/直播判据；
  //    · 两档都从控制台切换，且即时生效（同窗 CustomEvent + 跨窗 storage）。
  {
    const stripSrc = readFileSync(join(ROOT, "src", "features", "shared", "ReasoningStrip.tsx"), "utf8").replace(/\r/g, "");
    const modeSrc = readFileSync(join(ROOT, "src", "lib", "reasoning-display-mode.ts"), "utf8").replace(/\r/g, "");
    const generalSrc = readFileSync(join(ROOT, "src", "features", "settings-general", "GeneralSettingsSection.tsx"), "utf8").replace(/\r/g, "");
    const appearanceSrc = readFileSync(join(ROOT, "src", "features", "settings-appearance", "AppearanceSettingsSection.tsx"), "utf8").replace(/\r/g, "");
    const stylesEntry = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    (modeSrc.includes('localStorage.getItem(KEY) === "strip" ? "strip" : "auto"') && /useReasoningDisplayMode/.test(modeSrc) && /window.dispatchEvent\(new CustomEvent/.test(modeSrc) && /addEventListener\("storage"/.test(modeSrc) ? ok : fail)(
      "【161】展示模式默认 auto、非法值回落 auto；同窗事件 + 跨窗 storage 即时同步"
    );
    (/displayMode === "strip"[\s\S]{0,160}<ReasoningStrip/.test(itemSrc) && /<ReasoningStrip head=\{head\} text=\{displayed\} running=\{running\} revealing=\{revealing\} \/>/.test(itemSrc) ? ok : fail)(
      "【161】strip 模式复用同一份 displayed/追字状态（不复制直播判据）"
    );
    (/aria-expanded=\{expanded\} onClick=\{toggle\}/.test(stripSrc) && /setExpanded\(\(current\) => !current\)/.test(stripSrc) && /reasoning-strip-sep/.test(stripSrc) && /reasoning-strip-preview/.test(stripSrc) && /lines\[lines\.length - 1\]/.test(stripSrc) ? ok : fail)(
      "【161】收起态与过程行同款：标题 + · 最新一行（取最后一条非空行）+ 展开箭头"
    );
    (/\.reasoning-strip\.done \.reasoning-strip-preview\s*\{[^}]*justify-content: flex-start;/.test(styles54)
      && /\.reasoning-strip\.done \.reasoning-strip-preview\.is-overflowing\s*\{[^}]*justify-content: flex-end;/.test(styles54)
      && /reasoning-strip-preview\$\{overflowing \? " is-overflowing" : ""\}/.test(stripSrc)
      && /content\.scrollWidth > el\.clientWidth \+ 1/.test(stripSrc) && !/requestAnimationFrame\(tick\)/.test(stripSrc) && !/el\.scrollLeft/.test(stripSrc) ? ok : fail)(
      "【161】完成态短内容紧跟标题（左对齐），只有超宽才 flex-end 露尾部；不再循环滚动 / 无 scrollLeft"
    );
    (!/\.reasoning-strip\.done \.reasoning-strip-preview(?!\.is-overflowing)\s*\{[^}]*justify-content: flex-end;/.test(styles54) ? ok : fail)(
      "【161】负向：完成态不许无条件 flex-end（短内容会被推到最右、标题与正文间空一大截）"
    );
    (/\.reasoning-strip-marquee\.is-scrolling/.test(styles54) && /@keyframes reasoning-strip-marquee/.test(styles54) && /animation-play-state: paused/.test(styles54) && /prefers-reduced-motion/.test(styles54) && /\.reasoning-strip-body \{[\s\S]{0,200}max-height: min\(50vh, 420px\)/.test(styles54) && /styles\/40-reasoning-strip/.test(stylesEntry) ? ok : fail)(
      "【161】直播横滚用 CSS transform（不触发 scroll 事件 ⇒ 时间线不上下抖）；悬停暂停 / 减少动效静止；展开全文最高 50vh"
    );
    (appearanceSrc.includes("思考板块展示") && appearanceSrc.includes('setReasoningDisplayMode("auto")') && appearanceSrc.includes('setReasoningDisplayMode("strip")') && appearanceSrc.includes('aria-label="思考板块展示"') && appearanceSrc.indexOf("思考板块展示") < appearanceSrc.indexOf("<FunctionMenuSettings") && !generalSrc.includes("思考板块展示") ? ok : fail)(
      "【161】设置 → 外观有两档切换（自适应展开 / 长条按行），在「功能入口」上方，点击即时生效"
    );
    // ⑮ 用户 10-20 审查「回合内容超长时，运行中会不会有不进折叠的」：
    //    直播只把**当前正在直播的思考**内联；已结束的思考与所有 foldable 过程
    //    （工具/命令/编辑/搜索/看图/协作/子智能体）进过程段。没有外层折叠组的直播末段
    //    统一上限 8 条，超过收起；正文/用户消息/计划/生成图不隐藏。完成后全进「耗时」大折叠。
    {
      const turnFoldSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8").replace(/\r/g, "");
      const planSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold-plan.mjs"), "utf8").replace(/\r/g, "");
      const queueSrc = readFileSync(join(ROOT, "src", "features", "session-queue", "SessionQueue.tsx"), "utf8").replace(/\r/g, "");
      const cardsSrc = readFileSync(join(ROOT, "src", "features", "session-cards", "SessionCards.tsx"), "utf8").replace(/\r/g, "");
      (/buildSegments\(units, !running\)/.test(queueSrc) && !/inlineThinking/.test(queueSrc) && /planCompletedFold\(units, finalUnit\.item\.id\)/.test(queueSrc) && !/planCompletedFold\(units, finalUnit\.item\.id, \{/.test(queueSrc) ? ok : fail)(
        "【161】直播用原分段（已结束思考进过程段）；完成态全交 planCompletedFold 大折叠（无 thinking 旁路）"
      );
      (/unitLimit=\{seg\.kind === "foldable" \? 8 : undefined\}/.test(queueSrc) && /unitLimit\?: number/.test(cardsSrc) && /<CappedToolRun label="过程"/.test(cardsSrc) ? ok : fail)(
        "【161】直播末段统一上限 8 条：工具/命令/编辑/搜索/看图/已结束思考都收；正文段不传 unitLimit（不藏正文）"
      );
      (/unit\.kind === "thinking" && !thinkingLive/.test(turnFoldSrc) && !/inlineThinking/.test(turnFoldSrc) && !/inlineThinking && isThinking\(unit\)/.test(planSrc) ? ok : fail)(
        "【161】只有当前直播思考内联；完成计划不为 thinking 开旁路"
      );
      (/const hasText = Boolean\(text\.trim\(\)\)/.test(stripSrc) && /hasText && !expanded \?/.test(stripSrc) && /hasText && expanded \?/.test(stripSrc) && /disabled=\{!hasText\}/.test(stripSrc) ? ok : fail)(
        "【161】正文为空时只留标题行（不画空长条身体；等待首段 delta 时也不出现空白块）"
      );
    }
  }
}
}

{
{
  const activitySrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part06", "02-seg", "01-turn-runtime-activity.tsx"), "utf8").replace(/\r/g, "");
  const part04Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  const part05Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  // ① 扫描跳过 contextCompaction：压缩 item 不是任何一种「活动」，不许被 switch 当成未知兜底。
  (/if \(isCompactionItem\(item\)\) continue;/.test(activitySrc) ? ok : fail)(
    "【163】runActivity 扫描跳过 contextCompaction（压缩不是「生成回复」，指示归分隔线与 toast）"
  );
  // ② 压缩进行中如实说「正在整理上下文」（10-28）：说在写回复是错的，但静默会让人以为卡死。
  (/compactPendingRef\.current\.has\([^)]*\)\) return "正在整理上下文";/.test(activitySrc) ? ok : fail)(
    "【163】压缩进行中如实说「正在整理上下文」（既不说在写回复，也不再静默）"
  );
  // ③ 压缩完成必须结算运行态（两个完成事件都要接）：turn/started 点亮的状态没人熄灭 = 永久挂。
  ((part05Src.match(/bag\.settleAfterCompaction\(/g) || []).length >= 2 ? ok : fail)(
    "【163】item/completed(contextCompaction) 与 thread/compacted 都必须调 settleAfterCompaction（缺一处就有挂起路径）"
  );
  // ④ 结算的守卫：本会话还有真实在跑 item（非压缩）时绝不动 —— 回合中途的自动压缩
  //    不能把真回合的运行态打停（「运行莫名停止」同类事故零容忍）。
  (/!isCompactionItem\(item\)\) return;/.test(part04Src) ? ok : fail)(
    "【163】settleAfterCompaction 有「真回合在跑就不动」守卫（自动压缩不许打断真回合）"
  );
  // ⑤ 反向绊线：结算不许漏 setActiveTurnId（只清 sending 不清 turn id = 状态条照样挂着）。
  (/bag\.setSending\(false\);[\s\S]{0,80}bag\.setActiveTurnId\(null\);/.test(part04Src) ? ok : fail)(
    "【163】settleAfterCompaction 必须同时清 sending 与 activeTurnId（漏一个状态条就还挂着）"
  );
  // ⑥ 成功提示条件化（09-26 用户截图「还在转圈就报成功」）：item/completed 只代表一个压缩
  //    completed 到达即认为本次压缩结束：**先** prune 收敛线程里其它压缩项，再报成功、再结算。
  //    ⛔ 不许回到「扫线程 item 判断还有没有在跑」的写法（09-26 用户「现在根本压缩成功不了」）：
  //      started/completed 两阶段 id 不一致时会残留一条 inProgress，判定被永久抑制 ⇒ 永远报不出成功。
  ((() => {
    const i = part05Src.indexOf('item/completed" && isCompactionItem');
    if (i < 0) return false;
    const branch = part05Src.slice(i, i + 1200);
    const pruneAt = branch.indexOf("pruneSupersededCompactions");
    const successAt = branch.indexOf('setCompactEventState("success")');
    return pruneAt >= 0 && successAt > pruneAt && !branch.includes("stillCompacting");
  })() ? ok : fail)(
    "【163】completed 即报成功，且先 prune 收敛残留压缩项（扫 item 判定会被残留 inProgress 永久抑制）"
  );
  // ⑦ 权威信号停转：thread/compacted 到达时本地把还挂着的 inProgress 压缩 item 落成
  //    completed（引擎侧 completed 迟到/缺失时分隔线会永远转圈）。
  //    ⛔ 锚到**分支边界**而非固定字符窗口（09-26 实测：分支里插几行就假红过一次）。
  ((() => {
    const i = part05Src.indexOf('event.method === "thread/compacted"');
    if (i < 0) return false;
    const nextBranch = part05Src.indexOf("} else if (event.method ===", i);
    const branch = part05Src.slice(i, nextBranch > 0 ? nextBranch : i + 3000);
    return branch.includes('status: "completed"') && branch.includes("settleAfterCompaction");
  })() ? ok : fail)(
    "【163】thread/compacted 必须本地落平还挂着的 inProgress 压缩 item（分隔线停转不依赖引擎补发）"
  );
    /* ── 【165】压缩线位置归位（09-26 两次修 + 10-07 改锚：09-26 把线固定在「最新一条用户消息」上方，
     但它每帧重算 ⇒ 新消息一来线跟着往下跑、不随历史往上走（用户 10-07：「压缩线跟着历史消息往上走」）；
     10-07 改锚 = 以**压缩 item 自己所在回合**为界，取该回合(含)之前最近一条用户消息回合的正上方） */
  {
    const turnView = readFileSync(join(ROOT, "src/features/session-turn/SessionTurn/03-turn-view.tsx"), "utf8");
    const timeline = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8");
    (turnView.includes("!isCompactionItem(item)") && !turnView.includes("items={responseItems}") ? ok : fail)(
      "【165】回合内容区剔除压缩线（TurnFoldStream 只吃 foldItems，线不许再落回内容末尾）"
    );
    /* ⛔ 10-24 锚点同步：`compactToast` 必须先按会话过滤（`threadCompactToast`）再交给
       compactionStateOf —— 否则 A 会话的压缩成功会让 B 会话刻度尺长出假绿线（用户实测）。 */
    (timeline.includes("compactionStateOf(ordered, threadCompactToast?.state)") && timeline.includes("cs.state === \"done\" ? cs.item : null") ? ok : fail)(
      "【165】timeline 层扫描最后一条已完成压缩 item（与 pruneSupersededCompactions 同口径）"
    );
    ((() => { const a = timeline.indexOf("compactionLine && i === insertBefore"); const b = timeline.indexOf("<MemoTurnView"); return a >= 0 && b >= 0 && a < b; })() ? ok : fail)(
      "【165】压缩线插在目标回合**之前**（不是回合后面）"
    );
    (timeline.includes("const boundaryTurnId = lastCompactionTurnId || String(hostCompaction?.turnId ?? \"\")")
      && /insertBefore = resolveCompactionAnchor\(visible, boundaryTurnId, \{[^}]*\}\)/.test(timeline) ? ok : fail)(
      "【165】压缩线锚点 = **压缩 item 自己所在回合**（10-07：取该回合(含)之前最近一条用户消息的正上方）——"
        + "新消息到来线**不动**（旧口径「永远黏最新一条用户消息」会让线跟着新消息往下跑，用户实测点出）。10-18 起锚点收进纯函数 resolveCompactionAnchor（守卫 12r 跑真值表：边界不在已加载窗口时锚顶部）"
    );
    // ⛔ 同屏最多一条「已完成」压缩线（09-26 用户截图「两条压缩线」）：settled 兜底必须在归位处
    //    （else-if 与 compactionLine 互斥），不许再单独挂在时间线尾部。
    ((timeline.match(/compact-divider--settled/g) || []).length === 2
      && /\} else if \(hostCompaction && insertBefore >= 0\)/.test(timeline)
      && /\} else if \(compactToast && compactToast\.state !== "running"/.test(timeline) ? ok : fail)(
      "【165】已完成压缩线两条渲染互相排斥（引擎 item 优先 → 宿主侦测记录 → toast 兜底；三源同一锚点，同屏只出一条）"
    );
    const part04Prune = readFileSync(join(ROOT, "src/features/app-state/parts/part04/01-seg.tsx"), "utf8");
    (/let keep = keepId;/.test(part04Prune) && /keep = String\(last\?\.id \?\? ""\);/.test(part04Prune) ? ok : fail)(
      "【165】prune 空 id 也收敛（保留最后一条）——否则多余压缩项留在时间线里 = 多条线"
    );
    /* 10-17 用户令推翻旧契约：压缩期**必须有可见线**（in-progress 项归位渲染 running 线），否则像卡死；
       compact toast 转圈只兜"引擎没落 in-progress 项"的底（两者条件互斥，不同屏）。 */
    ((/runningCompactionTurnId/.test(timeline) && /compactionStateOf\(/.test(timeline) && /cs\.state === "compacting"/.test(timeline)) ? ok : fail)(
      "【165】归位**优先**渲染运行中的压缩线（in-progress 项所在回合）——压缩期必须有可见提示，否则像卡死"
    );
    ((/compact-divider--running/.test(timeline) && /停止压缩/.test(timeline)) ? ok : fail)(
      "【165】运行中压缩线带转圈 + 可手动停止（与运行状态条同款语义，09-26 用户要求）"
    );
    /* 10-07 新增链（当前引擎压缩不发 item 事件）：主进程侦测 → 落盘 → 广播 → resume 重播 → 渲染层第三源。
       ⛔ 10-07 二次修正：首版「非渲染层回合才查」已被大会话实测证伪 —— 自动压缩是**内联**在用户回合里
       完成的（记录 turn_id == 用户回合 id），必须按**记录本体**归因。 */
    const watchSrc = existsSync(join(ROOT, "electron", "compaction-watch.ts"))
      ? readFileSync(join(ROOT, "electron", "compaction-watch.ts"), "utf8") : "";
    (watchSrc.includes("watchTurnCompleted") && watchSrc.includes("checkCompactionAsync") && watchSrc.includes("thread-compacted-host") && watchSrc.includes("record.turnId === id") ? ok : fail)(
      "【165】主进程压缩侦测（compaction-watch：增量扫 rollout + 记录按 turn_id 归因 → 广播 thread-compacted-host）"
    );
    (!watchSrc.includes("rendererTurns") ? ok : fail)(
      "【165】⛔ 不许退回「非渲染层回合才查」的旧判据（10-07 实测：自动压缩内联在用户回合里，那套会把真实压缩全部丢掉、存储恒空）"
    );
    const workerSrc165 = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
    (workerSrc165.includes("compactionScanOffsets") && workerSrc165.includes("item_completed") && workerSrc165.includes('item.type === \"ContextCompaction\"') && workerSrc165.includes("turnId: payload.turn_id") ? ok : fail)(
      "【165】rollout 增量扫描的记录归因（偏移表 + item_completed + item.type=ContextCompaction + 取 payload.turn_id —— 压缩记录写在回合开头，只读尾部 N 字节会被同回合的后续输出挤出窗口）"
    );
    const bootSrc165 = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    (watchSrc.includes("persistThread") && /writeFileSync/.test(watchSrc)
      && bootSrc165.includes('setCompactionWatchDirs(path.join(app.getPath("userData"), "compaction-records")') ? ok : fail)(
      "【165】压缩侦测记录落盘（boot 注入 userData/compaction-records + watch 侧原子写；重启后 resume 重播的真相源）"
    );
    (bootSrc165.includes("watchTurnCompleted(String(p?.threadId ?? \"\"), turnIdOf(p))") ? ok : fail)(
      "【165】boot 在 turn/completed 挂侦测钩子（每个回合结束都查 —— 内联压缩记在用户回合名下，不许只查引擎自发回合）"
    );
    const codexIpcSrc165 = readFileSync(join(ROOT, "electron", "features", "codex-ipc.ts"), "utf8");
    (codexIpcSrc165.includes("storedCompactionsForThread") && codexIpcSrc165.includes("dropStoredCompactions") ? ok : fail)(
      "【165】codex-ipc：resume 重播压缩记录 + 删除会话清落盘"
    );
    (!codexIpcSrc165.includes("noteRendererTurn") ? ok : fail)(
      "【165】codex-ipc 不再登记渲染层回合（归因改走记录本体，登记表已删 —— 不许复活）"
    );
    (existsSync(join(ROOT, "src", "lib", "compaction-records.mjs")) && timeline.includes("compactionRecordFor(thread.id)") ? ok : fail)(
      "【165】渲染层第三源接线（compaction-records.mjs + 时间线读 compactionRecordFor）"
    );
    (timeline.includes("useSyncExternalStore(subscribeCompactions, compactionVersion)") ? ok : fail)(
      "【165】压缩记录订阅接线（记录一变即重渲染 —— 广播到达时无其它 state 更新，不许等被动重渲染 = 竞态）"
    );
  }
  /* ── 【166】压缩 item 判定唯一口径 + 挂载兜底（09-26 rollout 取证） ──
     ⛔ 引擎落盘/事件的压缩 item 类型是 PascalCase「ContextCompaction」，各处硬写 camelCase
     会让整条压缩链静默不命中（item 不进 thread ⇒ 线只剩尾部 toast 兜底 ⇒ 用户三次看到「线在下面」）。
     ⛔ 压缩 item 的 turnId 常指向宿主不知道的引擎内部回合 ⇒ mergeItem 丢弃 ⇒ 必须挂载兜底。 */
  {
    const libSrc = readFileSync(join(ROOT, "src/lib/compaction-item.mjs"), "utf8");
    (libSrc.includes(".toLowerCase()") ? ok : fail)("【166】压缩判定大小写不敏感（唯一口径模块）");
    const uiFiles = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(entry.name)) uiFiles.push(p);
      }
    })(join(ROOT, "src/features"));
    const hardCoded = uiFiles.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /[=!]==?\s*"contextCompaction"|!==\s*"contextCompaction"/.test(s);
    });
    (hardCoded.length === 0 ? ok : fail)(
      "【166】渲染层/事件处理不许硬写 camelCase 判定（一律 isCompactionItem）" + (hardCoded.length ? "，命中：" + hardCoded.slice(0, 3).map((f) => f.replace(ROOT, "")).join("；") : "")
    );
    // ⛔ 压缩可手动停止（09-26 用户：「压缩的时候要跟运行状态一样，可以手动停止」）：
    //    running 线必须有「停止」按钮 → cancelCompaction；且本地**先**落成 cancelled 再中断引擎
    //    （中断后完成事件可能永远不来，靠事件熄灯会永久转圈）。
    {
      const tl = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8");
      const p4 = readFileSync(join(ROOT, "src/features/app-state/parts/part04/01-seg.tsx"), "utf8");
      (tl.includes("compact-divider-cancel") && tl.includes("() => app.cancelCompaction()") ? ok : fail)(
        "【166】压缩进行中提供「停止」按钮（与运行状态同款可中断）"
      );
      ((() => {
        const i = p4.indexOf("function cancelCompaction()");
        if (i < 0) return false;
        const body = p4.slice(i, i + 600);
        return body.indexOf('state: "cancelled"') >= 0 && body.indexOf("bag.interrupt()") > body.indexOf('state: "cancelled"');
      })() ? ok : fail)(
        "【166】取消压缩：本地先落 cancelled 再中断引擎（顺序反了会永久转圈）"
      );
      (tl.includes('compactToast.state === "cancelled"') ? ok : fail)("【166】已取消状态有独立呈现（中性色 + 停止图标）");
    }

    // ⛔ 回合结束兜底熄灯（09-26：引擎 16:33 就压缩完了，界面转圈 15 分钟）——压缩不跨回合，
    //    turn/completed 一定到，用它兜底与「item 类型大小写 / turnId 归属」统统解耦。
    ((() => {
      const p5 = readFileSync(join(ROOT, "src/features/app-state/parts/part05/01-seg.tsx"), "utf8").replace(/\r/g, "");
      // turn/completed 在文件里出现多次（审查模式分支也有一处）⇒ 任一分支带兜底即通过
      const hits = [...p5.matchAll(/method === "turn\/completed"/g)].map((m) => m.index ?? -1).filter((i) => i >= 0);
      return hits.some((i) => {
        const branch = p5.slice(i, i + 900);
        return branch.includes('current?.state === "running"') && branch.includes("上下文压缩成功");
      });
    })() ? ok : fail)(
      "【166】回合结束必须兜底熄灭压缩指示（running → 成功；不依赖压缩完成事件被识别）"
    );
    const turnView2 = readFileSync(join(ROOT, "src/features/session-turn/SessionTurn/03-turn-view.tsx"), "utf8");
    (/if \(userItems\.length === 0 && !hasRealContent\) return null;/.test(turnView2) ? ok : fail)(
      "【166】空推进回合整组不渲染（引擎把压缩跑成独立回合，否则只留一条孤零零的耗时灰线，用户截图「三条线」）"
    );
  }
}
}
}
