/**
 * 预检守卫组：03-runtime-boot
 * 分节：【5】【6】【7】【8】【9】【10】【11】【12】【13】【14】（原 L1728–L2430）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  ALIGN_RESULT, C, CONTINUITY_TEXT, ROOT, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, mkdtempSync, planCompletedFold, readAppUi, readFileSync, readMainSource, readStyles, readVoiceCallFloatSrc, rmSync, shouldAlignProvider, spawnSync, statSync, tmpdir, warn,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【5】原 L1728–L1760 ══ */
  {
console.log(C.bold("\n【5】启动链健壮性（boot 副作用不得裸 await）"));
{
  // 为什么是硬失败：主进程 boot 是 `app.whenReady().then(async () => { … })`——里面任何一处
  // await 抛出都会变成 unhandled rejection，**整条启动链就此中断、引擎根本不 spawn**，
  // 表现是「界面能打开、发消息完全没有回复」，日志里只有一行 EPERM（09-11 实测：
  // memory-mode.json 写不进去）。下面三处是已知副作用点，必须各自 try/catch 兜底降级；
  // 以后往 boot 里加类似步骤，请照此办理。
  if (!mainSrc) {
    warn("找不到 electron/main.ts，跳过启动链守卫");
  } else {
    const guarded = [
      /try\s*\{\s*await applyMemoryMode\(await readMemoryMode\(\)\);\s*\}/,
      /try\s*\{\s*await scheduler\.start\(\);\s*\}/,
      /try\s*\{\s*await remote\.start\(\);\s*\}/,
    ];
    const missing = guarded.filter((re) => !re.test(mainSrc)).length;
    missing === 0
      ? ok("boot 的 applyMemoryMode / scheduler.start / remote.start 都有 try/catch 兜底")
      : fail(`boot 里有 ${missing} 处副作用没兜底 —— 裸 await 抛出会掐死引擎启动（界面能开但毫无回复）`);
    // 身份引导存量迁移（09-12）也必须满足两条：带 try/catch，且在 server.start() **之前**跑完
    // （引擎启动后档案才改就晚了——新会话可能已经按旧档案注入过引导）。
    if (!/migrateGreetedForExistingUsers\s*\(/.test(mainSrc)) {
      fail("main.ts 没有调用 migrateGreetedForExistingUsers —— 存量用户（有历史会话、档案无 greeted）升级后会被当成初次见面再引导一遍");
    } else {
      const iMig = mainSrc.indexOf("migrateGreetedForExistingUsers(");
      const iStart = mainSrc.indexOf("await server.start()");
      const guardedMig = /try\s*\{[^}]*migrateGreetedForExistingUsers\s*\(/.test(mainSrc);
      iMig > 0 && iStart > 0 && iMig < iStart && guardedMig
        ? ok("存量身份引导迁移在 server.start() 之前、且有 try/catch 兜底")
        : fail(`存量身份引导迁移位置不对（iMig=${iMig} iStart=${iStart} 有兜底=${guardedMig}）—— 必须在 server.start() 之前且包 try/catch`);
    }
  }
}
  }

  /* ══ 【6】原 L1762–L1799 ══ */
  {
console.log(C.bold("\n【6】零阻塞宿主（codex:request 链上禁止同步磁盘 I/O）"));
{
  // 为什么是硬失败（09-12 多会话性能）：所有会话共用**同一个主进程事件循环**，而
  // codex:request 的处理链上只要出现同步文件读写，那段时间里**所有会话**的事件转发
  // 全部停摆 —— 这正是「多会话一起卡」的形态（实测曾有 9.9ms/次的同步 rollout 扫描，
  // 且渲染层每个回合结束都打一发）。所以这两个函数（内部是 readdirSync/readFileSync/
  // statSync + 逐行 JSON.parse）**不允许**再出现在 main.ts 里；它们已被 worker 版替代。
  //
  // 以后要往 codex:request 链上加"要看磁盘"的能力：先用 worker / 异步 fs，
  // 或把结果缓存在内存里；不要直接调同步函数。
  const SYNC_IO_CALLS = ["listRolloutThreads", "enrichThreadWithRolloutTools"];
  if (!mainSrc) {
    warn("找不到 electron/main.ts，跳过零阻塞宿主守卫");
  } else {
    const hits = SYNC_IO_CALLS.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(mainSrc));
    hits.length === 0
      ? ok("codex:request 链上没有任何同步磁盘 I/O 调用（rollout 扫描已移出主进程）")
      : fail(`main.ts 仍在调用同步 I/O 函数：${hits.join(", ")} —— 会阻塞所有会话的事件转发（应改用 worker 版）`);
  }
  // 附带守卫：worker 源码的内联产物必须存在且不落后于源文件。
  // 它由 `node scripts/gen-rollout-worker.mjs` 生成（已挂进 build:electron）——产物缺失
  // 会让打包后的应用 new Worker 直接失败、侧栏兜底与 resume 增强全丢。
  {
    const workerSrc = join(ROOT, "electron", "rollout-worker.cjs");
    const workerGen = join(ROOT, "electron", "rollout-worker-source.ts");
    if (!existsSync(workerSrc)) {
      fail("缺少 electron/rollout-worker.cjs（rollout 磁盘 I/O 的 worker 实现）");
    } else if (!existsSync(workerGen)) {
      fail("缺少 electron/rollout-worker-source.ts —— 先跑 `node scripts/gen-rollout-worker.mjs`（build:electron 已含）");
    } else {
      const srcM = statSync(workerSrc).mtimeMs;
      const genM = statSync(workerGen).mtimeMs;
      genM + 1 >= srcM
        ? ok("rollout worker 内联产物已生成且不落后于源文件")
        : fail("electron/rollout-worker-source.ts 落后于 rollout-worker.cjs —— 重新生成（build:electron 会做）");
    }
  }
}
  }

  /* ══ 【7】原 L1801–L1883 ══ */
  {
console.log(C.bold("\n【7】验收入口唯一化 + 持久 profile（带历史，不得回落成空白临时目录）"));
{
  // 为什么是硬失败（09-12 用户两次定稿，原话「把旧的验收流程删干净，每次都写最新的 cpd 脚本
  // 验收，不然你老是卡住」/「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）：
  //   ① 旧的「一堆历史场景 + 增量哈希 runner」：改一处主进程源码就连带选中十几个历史场景，
  //      一轮十几分钟，人卡在等它跑完 → **不允许再回来**；
  //   ② 收成一条 `scripts/accept.mjs`（CDP 直连），跑在**跨轮次复用的持久 profile** 上，
  //      首次把真实会话历史搬进来 → 测的才是有历史的真实形态。
  // 结构上必须满足这几条，缺一条这层能力就悄悄退化了：
  //   ① 旧流程（scenarios/ + run.mjs）确实已删除，验收入口只有 accept.mjs；
  //   ② harness 支持持久 profile（profileName → <root>/.e2e-profile/<name>，close 不删）；
  //   ③ 首次构建 profile 时会把**真实会话历史**搬进来（否则侧栏零会话，测了等于没测）；
  //   ④ `_rolloutFiles` 支持 { since } 过滤 —— 否则历史文件会把「本轮数据」的断言顶成假绿；
  //   ⑤ profile 目录必须被 gitignore —— 它含真实对话内容与本机 Key 密文。
  const legacy = ["scripts/e2e/run.mjs", "scripts/e2e/scenarios"];
  const leftovers = legacy.filter((p) => existsSync(join(ROOT, p)));
  leftovers.length === 0
    ? ok("旧的场景验收流程已删干净（scripts/e2e/run.mjs、scenarios/ 均不存在）")
    : fail(`旧的场景验收流程又回来了：${leftovers.join(", ")} —— 验收入口必须只有 scripts/accept.mjs`);
  const acceptPath = join(ROOT, "scripts", "accept.mjs");
  if (!existsSync(acceptPath)) {
    fail("缺少 scripts/accept.mjs（唯一验收入口）");
  } else {
    const acceptSrc = readFileSync(acceptPath, "utf8");
    /profileName:\s*value\("profile",\s*"main"\)/.test(acceptSrc)
      ? ok("accept.mjs 跑在持久 profile 上（默认 .e2e-profile/main，跨轮次累积历史）")
      : fail("accept.mjs 没有用持久 profile（profileName）—— 又会回到「每次拉起来都没有历史记录」");
  }
  const harnessPath = join(ROOT, "scripts", "e2e", "lib", "harness.mjs");
  if (!existsSync(harnessPath)) {
    fail("缺少 scripts/e2e/lib/harness.mjs（CDP 驱动）");
  } else {
    const src = readFileSync(harnessPath, "utf8");
    // 注意：判据必须锚在**代码**上，不能只搜 ".e2e-profile" 字样——注释里就写着这串，
    // 反证时整段实现删掉、只留注释也会假绿（实测踩过）。
    const hasResolve = /_resolveProfileDir\s*\(/.test(src) && /join\(\s*this\.root\s*,\s*"\.e2e-profile"/.test(src);
    hasResolve
      ? ok("harness 支持持久 profile（.e2e-profile/<name>，跨轮次复用、close 不删）")
      : fail("harness 丢了持久 profile 能力（_resolveProfileDir / .e2e-profile）—— 又回到「每轮空白 profile」了");
    const hasHistory = /export function seedRealSessionHistory\s*\(/.test(src)
      && /seedRealSessionHistory\s*\(this\.userDataDir\)/.test(src);
    hasHistory
      ? ok("首次建 profile 会把真实会话历史搬进来（侧栏不是空的）")
      : fail("harness 不再搬真实会话历史（seedRealSessionHistory）—— 空侧栏测不出切会话类问题");
    const hasSince = /_rolloutFiles\s*\(\s*opts\s*=\s*\{\}\s*\)/.test(src) && /since/.test(src);
    hasSince
      ? ok("harness 的 rollout 扫描支持 { since } 过滤（断言本轮数据不被历史顶成假绿）")
      : fail("harness._rolloutFiles 不支持 { since } —— 持久 profile 下历史文件会让「本轮」断言假绿");
  }
  const giPath = join(ROOT, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  /^\.e2e-profile\/?\s*$/m.test(gi)
    ? ok(".e2e-profile/ 已被 gitignore（含真实对话内容 + 本机 Key 密文，绝不入库）")
    : fail(".gitignore 里缺 .e2e-profile/ —— 持久 profile 含真实对话内容与 Key 密文，必须排除");

  // 身份引导的判据标记必须与 App.tsx 的注入文本同源。
  // 为什么是硬失败：判据一旦和真实注入文本脱钩，断言就会**恒定假绿**
  // （比如改文案后老标记再也匹配不到 → 「次会话没有引导」永远成立，等于没断言）。
  // 另注：判据只能看 rollout 里 role === "developer" 的消息——项目 AGENTS.md 里就有
  // 一段写着「初次见面」的文档，e2e 工作区 = 项目根 → 对整份文本 includes 会恒为真。
  {
    const appPath = join(ROOT, "src", "App.tsx");
    const inspectPath = join(ROOT, "scripts", "e2e", "lib", "rollout-inspect.mjs");
    if (!existsSync(appPath) || !existsSync(inspectPath)) {
      warn("找不到 App.tsx 或 rollout-inspect.mjs，跳过身份引导判据守卫");
    } else {
      const appSrc = readAppUi();   // 09-21 改造期：统一口径
      const inspectSrc = readFileSync(inspectPath, "utf8");
      const injected = /const IDENTITY_ONBOARD_INSTRUCTIONS = \[\s*"([^"]+)"/.exec(appSrc)?.[1] ?? "";
      const marker = /export const GREETING_MARKER = "([^"]+)"/.exec(inspectSrc)?.[1] ?? "";
      const guardsRole = /payload\?\.role === "developer"/.test(inspectSrc);
      if (!injected) fail("App.tsx 里找不到 IDENTITY_ONBOARD_INSTRUCTIONS 的首句（判据守卫失效）");
      else if (!marker) fail("rollout-inspect.mjs 里找不到 GREETING_MARKER 导出");
      else if (!injected.startsWith(marker)) {
        fail(`身份引导判据标记与注入文本不同源：marker=${marker.slice(0, 24)}… 注入首句=${injected.slice(0, 24)}…（断言会恒定假绿）`);
      } else if (!guardsRole) {
        fail("身份引导判据没有限定 role === \"developer\" —— 会被项目 AGENTS.md 的文档文本顶成假红");
      } else {
        ok("身份引导判据与 App.tsx 注入文本同源，且只看 developer 消息（不会被 AGENTS.md 干扰）");
      }
    }
  }
}
  }

  /* ══ 【8】原 L1885–L1927 ══ */
  {
console.log(C.bold("\n【8】打包必备件：随包 automation-tools.zip（发布包三大安装项的前提）"));
{
  // 为什么是硬失败（09-12 用户实测发布包故障，原话「桌面自动化和浏览器自动化还有浏览内核，
  // 这三个都下载安装不了，直接下载失败」）：
  //   实测 v0.0.13 的 GitHub Release **只有两个 mac zip**，没有 automation-tools.zip 资产；
  //   而旧代码在「随包 zip 缺失」时是 **warn 后静默放过**，应用侧再回落去拉那个 404 地址 →
  //   用户看到「直接下载失败」，浏览器内核两项（依赖该包里的 playwright-cli / cloakbrowser）
  //   跟着一起废。结论：**包里没有 zip 的安装包就是坏包**，打包必须失败而不是放行。
  // 这里直接**跑一遍 before-pack**（指向一个空的 tools 根）来验证它真的会硬失败；
  // 再验证逃生阀 AUTOMATION_ZIP_OPTIONAL=1 能放行（否则发布链路会被彻底卡死）。
  const beforePack = join(ROOT, "scripts", "before-pack.cjs");
  if (!existsSync(beforePack)) {
    fail("缺少 scripts/before-pack.cjs —— 打包前不再保证 automation-tools.zip 存在");
  } else {
    const emptyRoot = join(ROOT, ".e2e-artifacts", "empty-tools-probe");
    try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    mkdirSync(emptyRoot, { recursive: true });
    // 必须**真的调用**那个导出的钩子（直接 `node before-pack.cjs` 只是加载模块、永远退出 0）
    const invoke = `require(${JSON.stringify(beforePack)})().then(() => process.exit(0), (e) => { console.error(String((e && e.message) || e)); process.exit(1); });`;
    const strict = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: emptyRoot, AUTOMATION_ZIP_OPTIONAL: "" },
    });
    const relaxed = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: emptyRoot, AUTOMATION_ZIP_OPTIONAL: "1" },
    });
    try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    strict.status !== 0
      ? ok("缺 automation-tools.zip 时 before-pack 会**中止打包**（不发坏包）")
      : fail("before-pack 在缺 zip 时仍然放行 —— 会打出「三大安装项全废」的坏包");
    relaxed.status === 0
      ? ok("逃生阀 AUTOMATION_ZIP_OPTIONAL=1 可显式放行（发布链路不会被卡死）")
      : fail("AUTOMATION_ZIP_OPTIONAL=1 也无法放行 —— 需要出无自动化包的版本时会卡死");
  }
  // 应用侧不得再回落在线下载（那个地址 404，只会把真问题藏起来）
  if (mainSrc) {
    const hasUrlFallback = /AUTOMATION_TOOLS_URL/.test(mainSrc) || /--url=\$\{AUTOMATION_TOOLS_URL\}/.test(mainSrc);
    hasUrlFallback
      ? fail("main.ts 又出现了 AUTOMATION_TOOLS_URL 在线回落 —— 那个 Release 资产不存在，只会变成「下载失败」")
      : ok("应用侧只认随包 zip（解压安装），不再回落到不存在的在线地址");
  }
}
  }

  /* ══ 【151】打包期 dist 裁剪判据：必须是「可达闭包」（09-25 事故）══
     现场：0.0.27 安装包点开**任意**设置页都 `Cannot read properties of undefined (reading 'default')`。
     根因：before-pack 的 pruneStaleDistAssets 只保留 index.html 里出现的 assets/xxx，而 vite 的懒加载
     chunk（写成 `import("./X.js")`）**一个都不在 index.html 里** ⇒ 被整批当死重删掉；CI 里
     `process.env.CI` 恒真 ⇒ 裁剪默认执行 ⇒ 每个包都是坏的。 */
  {
    console.log(C.bold("\n【151】打包期 dist 裁剪：可达闭包判据（防懒加载 chunk 被当死重删掉）"));
    const bpPath = join(ROOT, "scripts", "before-pack.cjs");
    const bpSrc = existsSync(bpPath) ? readFileSync(bpPath, "utf8") : "";
    (bpSrc.includes("function reachableAssets") ? ok : fail)("【151】裁剪判据走可达闭包 reachableAssets()（⛔ 只看 index.html 直接引用会删光懒加载 chunk）");
    (!/const referenced = new Set\(\);\s*\n\s*for \(const m of html\.matchAll/.test(bpSrc) ? ok : fail)("【151】旧的「只收集 index.html 引用」写法不得回归");
    (/live\.size < Math\.min\(/.test(bpSrc) ? ok : fail)("【151】安全阀在：闭包结果小得离谱就一律不删（宁留死重，不删活文件）");

    let bp = null;
    try {
      bp = (await import(pathToFileURL(bpPath).href)).default;
    } catch (error) {
      fail(`【151】before-pack.cjs 加载失败：${error?.message ?? error}`);
    }
    const distAssets = join(ROOT, "dist", "assets");
    const distHtml = join(ROOT, "dist", "index.html");
    if (!bp?.reachableAssets || !existsSync(distAssets) || !existsSync(distHtml)) {
      warn("【151】dist 未构建 ⇒ 跳过「真跑闭包」检查（静态断言已做）");
    } else {
      const { readdirSync } = await import("node:fs");
      const html = readFileSync(distHtml, "utf8");
      const entries = [...html.matchAll(/assets\/([A-Za-z0-9._/-]+)/g)].map((m) => m[1].split("/").pop());
      const live = bp.reachableAssets(distAssets, [...new Set(entries)]);
      const all = readdirSync(distAssets).filter((n) => statSync(join(distAssets, n)).isFile());
      const lazy = all.filter((n) => /^(ModelSettingsSection|MemoryCenterSection|GeneralSettingsSection|SkillsCenterSection)-/.test(n));
      (live.size >= all.length - 2 ? ok : fail)(`【151】真跑：可达闭包几乎覆盖全部产物（${live.size}/${all.length}）`);
      (lazy.length > 0 && lazy.every((n) => live.has(n)) ? ok : fail)(`【151】真跑：懒加载 chunk 未被判死重（抽样 ${lazy.length} 个）`);
    }
  }

  /* ══ 【152】自定义数据目录：setPath 必须走 resolveStartupUserData（09-25）══
     现场：用户要求「数据目录可自定义，重启生效」。指路牌 = 默认目录下 data-dir.json，
     迁移在下次启动**引擎 spawn 之前**由 data-dir.ts 执行（唯一无进程写文件的时机）。
     ⛔ 若有人把 main.ts 的 setPath 改回裸 env 判断，指路牌/迁移整条链路会静默失效。 */
  {
    console.log(C.bold("\n【152】自定义数据目录：启动链与指路牌"));
    const ddPath = join(ROOT, "electron", "data-dir.ts");
    const ddSrc = readFileSync(ddPath, "utf8");
    const mainSrc = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
    (/app\.setPath\("userData",\s*resolveStartupUserData\(\)\)/.test(mainSrc) ? ok : fail)("【152】main.ts 的 setPath 走 resolveStartupUserData()（裸 env 判断不得回归）");
    (/CODEX_HARNESS_USER_DATA/.test(ddSrc) ? ok : fail)("【152】env 覆盖优先级保留（CODEX_HARNESS_USER_DATA）");
    (ddSrc.includes("data-dir.json") && ddSrc.includes("defaultUserDataDir") ? ok : fail)("【152】指路牌落在默认目录（appData 锚点）下的 data-dir.json");
    (ddSrc.includes('base === "data-dir.json"') ? ok : fail)("【152】迁移排除指路牌本体（复制它会把新目录也标上旧指路）");
    (/copySync\(|copyAsync\(/.test(ddSrc) && /setImmediate/.test(ddSrc) ? ok : fail)("【152】迁移 = 差量复制 + 分批 yield（保存时就地迁 + 启动只做秒级增量；⛔ 全量同步复制会让启动卡死成「起不来」，09-25 实测事故）");
    (ddSrc.includes("MIGRATION_SKIP") && ddSrc.includes("memory-mcp") && ddSrc.includes("voice-models") ? ok : fail)("【152】迁移排除可重建大目录（memory-mcp 可重装 / voice-models 可重下 / 各类缓存）");
    (ddSrc.includes("MIGRATED_MARKER") ? ok : fail)("【152】迁移完成标记存在（半迁移自愈：目标非空但无标记 ⇒ 续迁，否则数据缺失不自愈）");
    (/catch[\s\S]{0,120}回退默认/.test(ddSrc) ? ok : fail)("【152】迁移失败回退默认目录（绝不静默丢数据）");
    // data-dir.ts 必须是叶子：不得 import 项目内模块（否则 main.ts 模块体早期 import 会连带求值，【91】）
    (!/from "\.\//.test(ddSrc) ? ok : fail)("【152】data-dir.ts 是叶子模块（不 import 项目内模块，【91】惰性求值纪律）");
    const ipcSrc = readFileSync(join(ROOT, "electron", "features", "data-dir-ipc.ts"), "utf8");
    (ipcSrc.includes("dataDir:read") && ipcSrc.includes("dataDir:prepare") ? ok : fail)("【152】dataDir IPC 两通道已注册");
    (!ipcSrc.includes("dataDir:relaunch") ? ok : fail)("【152】不重复注册 relaunch（复用既有 app:relaunch）");
    /* ⛔ MCP 记忆安装器必须跟随数据目录（09-25 用户实测：切到 D:\11 后「装了但永远显示未安装」——
       安装器把服务装进硬编码旧锚点，引擎在新目录找 ⇒ 永远对不上）。两处缺一不可。 */
    const mcpIpcSrc = readFileSync(join(ROOT, "electron", "features", "memory-rpa-ipc.ts"), "utf8");
    (mcpIpcSrc.includes('CODEX_HARNESS_USER_DATA: app.getPath("userData")') ? ok : fail)("【152】spawn MCP 安装器时显式传当前 userData（否则安装器装进旧锚点）");
    const instSrc = readFileSync(join(ROOT, "scripts", "install-memory-mcp.cjs"), "utf8");
    (instSrc.includes("data-dir.json") ? ok : fail)("【152】安装器自身也读指路牌（用户手工复制命令跑时不带 env）");
    const genSrc = readFileSync(join(ROOT, "src", "features", "settings-general", "GeneralSettingsSection.tsx"), "utf8");
    (genSrc.includes("prepareDataDir") && genSrc.includes("readDataDir") ? ok : fail)("【152】设置 → 通用页有数据目录入口（否则用户无处修改）");
  }

  /* ══ 【9】原 L1929–L1974 ══ */
  {
console.log(C.bold("\n【9】过程折叠不得吞掉正文（长正文/最终答复永远是正文锚点）"));
{
  // 09-12 用户反馈「折叠消息把 codex 最后汇报的也折叠进去了」。
  // 实测某会话 rollout 条目序列：… AgentMessage(712字) → DynamicToolCall → Reasoning → AgentMessage(80字)。
  // 旧的「完成态」把「除最后一条正文以外的**全部**内容」塞进一个折叠组，而“最后一条正文”挑中的
  // 是那条 80 字收尾 → 712 字的**汇报本身**被当过程收了起来。这里跑真实现断言行为。
  const unit = (id, type, text = "") => ({ item: { id, type, text }, kind: type === "agentMessage" ? "body" : "foldable" });
  const units = [
    unit("tool1", "commandExecution"),
    unit("thinking1", "reasoning"),
    unit("body712", "agentMessage", "报".repeat(712)),
    unit("tool2", "dynamicToolCall"),
    unit("thinking2", "reasoning"),
    unit("body80", "agentMessage", "收".repeat(80)),
  ];
  const plan = planCompletedFold(units, "body80");
  const bodies = plan.filter((p) => p.kind === "body").map((p) => p.unit.item.id);
  const folded = plan.filter((p) => p.kind === "fold").flatMap((p) => p.units.map((u) => u.item.id));
  bodies.includes("body712")
    ? ok("长正文（712 字汇报）留在折叠组外 —— 不会再被「耗时」吞掉")
    : fail(`长正文被折叠进去了（folded=${folded.join(",")}）—— 用户报的正是这个`);
  bodies.includes("body80")
    ? ok("最终答复（80 字收尾）也留在折叠组外")
    : fail("最终答复被折叠进去了");
  !folded.includes("body712") && !folded.includes("body80")
    ? ok("折进过程组的只有工具/思考等真过程单元")
    : fail(`正文混进了过程组：${folded.join(",")}`);
  folded.includes("tool1") && folded.includes("thinking1") && folded.includes("tool2")
    ? ok("工具与思考仍照常收进过程组（折叠能力没被削弱）")
    : fail(`过程单元没被收进去（folded=${folded.join(",")}）—— 折叠功能被改坏了`);

  // ★ 用户中途插进来的消息（队列「立即」/ steer）不许被折进过程组（用户 09-13 定稿：
  //   「折叠还是一样的原理，过程都折叠，展示总结，用户中间发的消息不折叠进去」）。
  const midUnits = [
    unit("toolA", "commandExecution"),
    unit("userMid", "userMessage", "跑10轮"),
    unit("thinkingA", "reasoning"),
    unit("agentEnd", "agentMessage", "收".repeat(80)),
  ];
  const midPlan = planCompletedFold(midUnits, "agentEnd");
  const midBodies = midPlan.filter((p) => p.kind === "body").map((p) => p.unit.item.id);
  const midFolded = midPlan.filter((p) => p.kind === "fold").flatMap((p) => p.units.map((u) => u.item.id));
  midBodies.includes("userMid")
    ? ok("用户中途插入的消息留在折叠组外（不会被过程折叠吞掉）")
    : fail(`用户消息被折进过程组了（folded=${midFolded.join(",")}）—— 用户明确要求不折叠进去`);
}
  }

  /* ══ 【10】原 L1979–L2028 ══ */
  {
console.log(C.bold("\n【10】滚动与锚定状态：单一 owner + 默认值不许回退"));

{
  const appSrc = readAppUi();
  const utilsSrc = readFileSync(join(ROOT, "src", "components", "scroll-utils.ts"), "utf8");

  // ① jumpToBottom 的第三个参数必须保持**必传**：一旦回退成可选并给 scrollHeight 默认值，
  //    "滚到底"就会重新变成"滚进尾部留白"（切回会话用户消息被切在视口顶 + 下方一大片空白）。
  !/getTarget\s*\?:/.test(utilsSrc) && /getTarget:\s*\(scroller: HTMLElement\)\s*=>\s*number/.test(utilsSrc)
    ? ok("jumpToBottom 的目标解析函数是必传参数（不会悄悄回退成 scrollHeight）")
    : fail("jumpToBottom 的 getTarget 又变成可选了 —— 默认值 scrollHeight 会把视口滚进尾部留白");

  // ② 「到底部」类落点不得再直写 scrollHeight：主时间线一律走 contentTailTarget。
  //    `contentRef` / `bodyRef` 是**卡片内部**的滚动容器（工具输出卡、思考卡），
  //    里面没有尾部留白，`scrollTop = scrollHeight` 在那里是正确的语义 —— 放行。
  const srcLines = appSrc.split("\n");
  const rawScrollHeightHits = srcLines
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((entry) => /scrollTop\s*=\s*(scroller|el)\.scrollHeight/.test(entry.line))
    // 卡片内部的滚动容器（工具输出卡 contentRef / 思考卡 bodyRef）里没有尾部留白，
    // `scrollTop = scrollHeight` 在那里是正确的语义 —— 按"上文 15 行内绑定的容器"放行。
    .filter((entry) => {
      const context = srcLines.slice(Math.max(0, entry.no - 15), entry.no).join("\n");
      return !/contentRef\.current|bodyRef\.current/.test(context);
    });
  rawScrollHeightHits.length === 0
    ? ok("主时间线没有「scrollTop = scrollHeight」的直写（内容底部一律经 contentTailTarget 计算）")
    : fail(`主时间线仍有直写 scrollHeight 的落点：${rawScrollHeightHits.map((h) => `L${h.no}`).join(", ")}`);

  // ③ 锚定标志的写者数量做成"预算"：新增写入点就红，逼作者先想清楚这是不是第二个 owner。
  //    （09-13 之前「回到底部」按钮就绕过 releaseToUser 直写 anchorTopRef，留下半死的锚定状态。）
  const anchorWriters = appSrc
    .split("\n")
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((entry) => /anchorTopRef\.current\s*=/.test(entry.line) && !entry.line.startsWith("*") && !entry.line.startsWith("//"));
  // 预算 7 → 9（09-19 已按守卫要求审计过新增的两个写者，**确认不是第二个 owner**）：
  //   `armPinForReleasedQueue`（true：排队消息释放时建立钉顶意图）与 `disarmPinIntent`
  //   （false：释放失败时撤回该意图）—— 二者同属"**发送意图**"的生命周期，与正常发送的
  //   send-arm 是同一件事的两个方向；写滚动条 / 留白的 owner 仍然只有 `pinSentMessage` 一处
  //   （本文件下面那条"落点全部经 contentTailTarget"的断言仍在把这件事钉死）。
  const ANCHOR_WRITER_BUDGET = 9; // 发送 2 处 + releaseToUser + 长消息 + 切换分支 + 声明初始化 + 队列 arm/disarm
  anchorWriters.length <= ANCHOR_WRITER_BUDGET
    ? ok(`锚定状态写者 ${anchorWriters.length} 处（预算 ${ANCHOR_WRITER_BUDGET}）—— 没有新增第二 owner`)
    : fail(`锚定状态写者增到 ${anchorWriters.length} 处（预算 ${ANCHOR_WRITER_BUDGET}）：${anchorWriters.map((w) => `L${w.no}`).join(", ")} —— 请先确认是不是又出现了第二个 owner，再调预算`);

  // ④ 点「回到底部」这类按钮必须走 releaseToUser（统一复位全部锚定状态），不许直写标志。
  /releaseToUserRef\.current\("button"\)/.test(appSrc)
    ? ok("「回到底部」按钮走 releaseToUser 统一复位（不再直写锚定标志）")
    : fail("「回到底部」按钮没有走 releaseToUser —— 直写标志会漏掉 pinGapLocked/pinFix 等复位");
}
  }

  /* ══ 【11】原 L2034–L2201 ══ */
  {
console.log(C.bold("\n【11】09-13 审计 P0 修复不得回退（引擎生命周期 / 启动链容错 / 远控鉴权 / 权限不提权）"));

{
  const serverSrc = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const mainSrc = readMainSource();
  const remoteSrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  const appSrc = readAppUi();

  // ① 主动停止时不许自动拉起引擎（否则退出/更新过程中会重新 spawn 孤儿 codex.exe，抢 codex.exe 占用）
  const stopBody = serverSrc.slice(serverSrc.indexOf("  stop() {"), serverSrc.indexOf("  private write("));
  /this\.stopping = true/.test(stopBody) && /removeAllListeners\("exit"\)/.test(stopBody)
    ? ok("引擎 stop() 置 stopping 标志并摘掉 exit 监听（不会被自己的 exit→fail→restart 拉起）")
    : fail("stop() 没有置 stopping 或没摘 exit 监听 —— 退出时会把引擎重新 spawn 出来");
  /if \(this\.stopping\) \{/.test(serverSrc)
    ? ok("fail() 在主动停止时直接返回（不再无条件 restart）")
    : fail("fail() 缺少 stopping 判断 —— 主动停止会被自动重启反转");

  // ② 配置文件损坏不能让启动链断掉（曾导致"窗口根本不创建"，且进程持单实例锁，双击永远秒退）
  const readCustom = mainSrc.slice(mainSrc.indexOf("async function readCustomModel()"), mainSrc.indexOf("async function readCustomModels()"));
  !/throw error;/.test(readCustom)
    ? ok("readCustomModel 解析失败不再 throw（坏配置改名备份后按空配置继续启动）")
    : fail("readCustomModel 又抛异常了 —— 配置写坏一次就会永远打不开窗口");

  // ③ 远控控制面必须有鉴权，且不得再自动改系统防火墙策略
  // （配对端点 /api/pair* 是"投名状"入口，允许匿名；其余一律走 authorize）
  /private authorize\(/.test(remoteSrc) && /!this\.authorize\(req, res, url\)\) return;/.test(remoteSrc)
    ? ok("远控所有路由（含 WS 升级）统一走 authorize 鉴权")
    : fail("remote.ts 缺少统一鉴权入口 —— 控制面会再次对局域网裸奔");
  !/advfirewall", \["firewall", "add"/.test(remoteSrc)
    ? ok("远控不再自动添加防火墙放行规则（改由用户显式放行）")
    : fail("remote.ts 又在自动改系统防火墙策略了");

  // ③-b 09-13 二次加固：二维码/配对链接不得夹带凭据 + 必须有「6 位配对码 + 电脑端审批」
  //     （能力式 URL 会随链接、截图、浏览器历史、隧道日志外泄；拿到链接就等于拿到
  //      danger-full-access agent 的控制权。这两条都不适合用 CDP 验，钉在预检里）
  const pairUrlAuthBody = remoteSrc.slice(remoteSrc.indexOf("  pairUrlAuth() {"), remoteSrc.indexOf("  pairUrlAuth() {") + 400);
  const pairUrlForBody = remoteSrc.slice(remoteSrc.indexOf("  pairUrlFor("), remoteSrc.indexOf("  pairUrlFor(") + 400);
  const bindBody = remoteSrc.slice(remoteSrc.indexOf("  createBindSession("), remoteSrc.indexOf("  createBindSession(") + 700);
  !/accessToken/.test(pairUrlAuthBody) && !/accessToken/.test(pairUrlForBody) && !/k=\$\{this\.accessToken\}/.test(bindBody)
    ? ok("配对地址/二维码不再夹带一次性凭据（不再是能力式 URL）")
    : fail("配对地址又把 accessToken 拼进 URL 了 —— 链接或截图一泄露就等于交出控制权");
  /rotatePairingCode\(/.test(remoteSrc) && /checkPairingCode\(/.test(remoteSrc) && /approvePair\(/.test(remoteSrc) && /onPairRequest/.test(remoteSrc)
    ? ok("首次连接走「6 位配对码 + 电脑端审批」（配对码可轮换、审批有批准入口）")
    : fail("远控缺配对码或电脑端审批入口 —— 又退回成「扫码即控制」");

  // ③-c 09-13 语音通话审视的防回退：电平不进 state / 外发光不逐帧 paint blur / 静音拦截在喂识别之前
  const floatSrc = readVoiceCallFloatSrc();
  const cssSrc = readStyles();
  !/setLevel\(/.test(floatSrc)
    ? ok("语音电平不进 React state（走 ref + body 级 CSS 变量，通话中不再每块音频全量重渲）")
    : fail("VoiceCallFloat 又用 setLevel() 驱动电平了 —— 每块音频全量重渲通话 UI");
  const avatarBlock = cssSrc.slice(cssSrc.indexOf(".voice-call-avatar {"), cssSrc.indexOf(".voice-call-avatar::before"));
  const orbBlock = cssSrc.slice(cssSrc.indexOf(".voice-mascot-orb {"), cssSrc.indexOf(".voice-mascot-orb::before"));
  const ballBlock = cssSrc.slice(cssSrc.indexOf(".voice-ball {"), cssSrc.indexOf(".voice-ball::before"));
  // 只查 box-shadow **声明**（transform/opacity 里的 var(--voice-level) 是合成器友好的合法用法）
  const blurGlow = (block) => (block.match(/box-shadow\s*:[^;]*;/g) ?? []).some((decl) => /var\(--voice-level/.test(decl));
  !blurGlow(avatarBlock) && !blurGlow(orbBlock) && !blurGlow(ballBlock)
    ? ok("外发光不再用 box-shadow blur 逐帧 paint（已改 ::before 光晕层 opacity/scale）")
    : fail("avatar/orb/悬浮球的外发光又回到 box-shadow blur —— 全屏遮罩上逐帧 paint，通话全程掉帧");
  /mutedRef\.current\).*?return;/.test(floatSrc.replace(/\r?\n\s*/g, " ")) || /if \(mutedRef\.current\) \{ applyLevel\(0\); return; \}/.test(floatSrc)
    ? ok("静音在喂识别之前拦截（voiceAudio 不收静音期的音频）")
    : fail("静音没有在喂识别之前拦截 —— 静音期间麦克风还在往识别送音频");

  // ④ 引擎 thread.status 是对象，不许再按字符串比较（否则"在跑"判据恒假）
  !/params\.status !== "inProgress"/.test(appSrc) && !/input\.status === "inProgress"/.test(readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8"))
    ? ok("运行态判据按 status?.type 判定（不会再因对象/字符串比较而恒假）")
    : fail("又有地方按字符串比较 engine thread.status —— 在跑会话会被判成已停止");

  // ⑥ 更新链必须有完整性校验，且安装路径不得由渲染层决定（否则 = 任意 exe 落盘并执行）
  const updSrc = readFileSync(join(ROOT, "electron", "updates.ts"), "utf8");
  const engineUpdSrc = readFileSync(join(ROOT, "electron", "engine-updater.ts"), "utf8");
  /sha256OfFile\(/.test(updSrc) && /expectedSha256/.test(updSrc)
    ? ok("应用更新包下载后比对 sha256（不匹配即删除并报错）")
    : fail("updates.ts 又不校验 sha256 了 —— 发布站被换掉就会静默装上攻击者的包");
  /更新包地址必须是 https/.test(updSrc)
    ? ok("应用更新包只允许 https（挡住明文替换）")
    : fail("updates.ts 又允许 http 明文下载安装包");
  // ⛔ 09-16 实测：GitHub 的 browser_download_url 是 **302** 到 release-assets.githubusercontent.com，
  //    而 downloadUpdate 过去是裸 request + `status >= 300 reject`，不跟随重定向 ⇒ 用户点「下载并安装」
  //    直接报 HTTP 302。这个坑直到 v0.0.18 才暴露（09-15 才切 GitHub 单源，而当时仓库 0 个 release，
  //    检查更新拿不到东西，从没走到下载这步）。守卫锚定「确实存在跟随重定向的分支」。
  //    反证（本地 HTTPS mock，不依赖外网）：摘掉该分支 → 下载报 HTTP 302，见 tmp 验收脚本。
  (/res\.headers\.location/.test(updSrc) && /MAX_REDIRECTS/.test(updSrc) && /new URL\(res\.headers\.location, url\)/.test(updSrc) ? ok : fail)(
    "updates.ts 下载跟随重定向（GitHub 资产是 302 → release-assets.githubusercontent.com）"
  );
  // ⛔ 第二条必须锚定「重定向分支**内部**确实调用了 hop（即下一跳会重新过协议校验）」——
  //    第一版只查 `const hop = async (url: string, depth: number)` 与 https 抛错两段文本存在，
  //    把整个重定向分支摘掉后这两段仍在，守卫照样绿（反证时发现的假绿）。
  (/hop\(next, depth \+ 1\)\.then\(resolve, reject\);/.test(updSrc) && /const hop = async \(url: string, depth: number\)/.test(updSrc) && /if \(parsed\.protocol !== "https:"\) throw/.test(updSrc) ? ok : fail)(
    "updates.ts 重定向逐跳校验 https（下一跳走 hop 重新校验，防降级到明文替换安装包）"
  );
  /lastVerifiedUpdatePath/.test(mainSrc) && /path_not_verified/.test(mainSrc)
    ? ok("updates:install 只接受刚校验通过的那个文件（渲染层给不了任意路径）")
    : fail("updates:install 又能被渲染层指定任意安装路径了");
  !/rejectUnauthorized: false/.test(engineUpdSrc)
    ? ok("引擎更新默认校验 TLS 证书（自签名场景需显式 CODEX_HARNESS_INSECURE_TLS=1）")
    : fail("engine-updater.ts 又无条件关闭 TLS 校验 —— 下载物会被当场执行（--version 探针）");

  // ⑦ 渲染层入参校验层（09-13 审计 S5；09-19 用户拍板「隐私第一」后全面收紧 fs 通道）
  const mainForSec = readMainSource();
  // ⛔ fs:write / fs:read 一律收敛到主进程可信根集合（09-19 用户明令「用户隐私必须重之重」，
  //   推翻 09-13 的「保持原语义」决策）：fs:write 原来用渲染层自报的 root 判包含（传 C:\ 即绕过），
  //   fs:read 原来完全无校验（任意路径读）。两条守卫都锚定 handler 内部出现 isInsideTrustedRoots 调用。
  const fsWrite = mainForSec.slice(mainForSec.indexOf('ipcMain.handle("fs:write"'), mainForSec.indexOf('ipcMain.handle("fs:read"'));
  /isInsideTrustedRoots\(resolved\)/.test(fsWrite)
    ? ok("fs:write 收敛到主进程可信根（渲染层自报的 root 不再参与判定，09-19 用户拍板收紧）")
    : fail("fs:write 又用渲染层可控的 root 做校验或去掉了可信根收敛 —— 等于任意路径写文件");
  const fsReadFrom = mainForSec.indexOf('ipcMain.handle("fs:read"');
  const fsReadNext = mainForSec.indexOf("ipcMain.handle(", fsReadFrom + 20);
  const fsRead = mainForSec.slice(fsReadFrom, fsReadNext > fsReadFrom ? fsReadNext : undefined);
  (/isInsideTrustedRoots\(target\)/.test(fsRead) ? ok : fail)(
    "fs:read 收敛到可信根（会话工作目录 + userData + 用户选过的路径，不再任意读全盘文件）"
  );
  // shell:reveal / updates:reveal 同口径收敛
  const shellReveal = mainForSec.slice(mainForSec.indexOf('ipcMain.handle("shell:reveal"'), mainForSec.indexOf('ipcMain.handle("shell:reveal"') + 900);
  (/isInsideOrEqualTrustedRoots\(target\)/.test(shellReveal) ? ok : fail)(
    "shell:reveal 收敛到可信根（含根本身：reveal 工作区 / userData 目录是合法用法）"
  );
  const updReveal = mainForSec.slice(mainForSec.indexOf('ipcMain.handle("updates:reveal"'), mainForSec.indexOf('ipcMain.handle("updates:install"'));
  (/lastVerifiedUpdatePath/.test(updReveal) && /path_not_verified/.test(updReveal)
    ? ok("updates:reveal 只允许定位刚下载并通过校验的安装包（与 updates:install 同口径）")
    : fail("updates:reveal 又能被渲染层指定任意路径 showItemInFolder 了"));
  // terminal:restart 的 cwd 必须验证存在且是目录
  const termRestart = mainForSec.slice(mainForSec.indexOf('ipcMain.handle("terminal:restart"'), mainForSec.indexOf('ipcMain.handle("git:diff"'));
  (/fileStat\(cwd\)/.test(termRestart) && /isDirectory\(\)/.test(termRestart)
    ? ok("terminal:restart 校验 cwd 是真实存在的目录（终端可交互 cd，故做存在性校验而非白名单）")
    : fail("terminal:restart 又直收渲染层 cwd 且不验证了"));
  // thread/list 也要记账 cwd（fs 通道可信根才能覆盖未 resume 过的侧栏会话）。
  // ⛔ 09-19 两次假红教训（都出在锚点上，记下来防再犯）：
  //   ① 锚 `threadCwd.set(String(r.thread.id)` 到 `if (method === "thread/resume")` 的区间 +
  //     {0,200} 窗口 —— 窗口小于分支注释长度，恒红；
  //   ② 锚整份 main.ts 第一处 `method === "thread/list"`（3700 行列表增强块）+ 900 字符窗口
  //     —— 记账分支在 ~3748 行，窗口够不到，仍恒红。
  //   正解：锚**记账分支独有**的文本 `method === "thread/list" && Array.isArray(r?.data)`，
  //   全仓只有记账分支长这样，窗口随便取都落在正确位置。
  const listBranchAt = mainForSec.indexOf('method === "thread/list" && Array.isArray(r?.data)');
  const listBranch = listBranchAt >= 0 ? mainForSec.slice(listBranchAt, listBranchAt + 900) : "";
  (/threadCwd\.set\(tid, tcwd\)/.test(listBranch)
    ? ok("thread/list 响应记账 cwd（可信根集合覆盖侧栏全部会话，旧会话文件预览不被误伤）")
    : fail("thread/list 不再记账 cwd —— 未 resume 过的会话文件预览会被可信根校验误伤"));
  // index.html 必须带 CSP（封外链脚本 / object / base / form 劫持）
  let indexHtml = "";
  try { indexHtml = readFileSync(join(ROOT, "index.html"), "utf8"); } catch { /* 读不到在下面报 */ }
  (/Content-Security-Policy/.test(indexHtml) && /object-src 'none'/.test(indexHtml) && /base-uri 'self'/.test(indexHtml) && /form-action 'none'/.test(indexHtml)
    ? ok("index.html 带 CSP（封外链脚本注入 + object/base/form 劫持；inline 脚本为 srcdoc 可视化卡片保留）")
    : fail("index.html 的 CSP 被摘了 —— 渲染层渲染模型输出/渠道消息时注入脚本可加载外部代码"));
  // external:open / browser:popout 不得无条件放行 file:
  !/url\.protocol !== "file:"\s*\)\s*throw new Error\("Unsupported URL"\)/.test(mainForSec)
    ? ok("external:open / popout 不再无条件放行 file:（只允许工作区内的 .html）")
    : fail("external:open 又放行任意 file: 了 —— 渲染层可让系统执行任意本地程序");
  // harness-image 必须收敛路径
  /protocol\.handle\("harness-image"[\s\S]{0,1200}?Forbidden/.test(mainForSec)
    ? ok("harness-image 协议收敛到图片 + 可信根内（不再任意读文件）")
    : fail("harness-image 协议没有路径收敛 —— 它是默认 session 上的任意文件读取原语");
  // 导航与新窗口收敛必须有
  /will-navigate/.test(mainForSec) && /setWindowOpenHandler/.test(mainForSec) && /will-attach-webview/.test(mainForSec)
    ? ok("主窗口导航 / 新窗口 / webview 挂载都有收敛（此前全仓零命中）")
    : fail("缺少 will-navigate / setWindowOpenHandler / will-attach-webview 收敛");
  // commands:delete 必须限定在命令目录内
  /只能删除自定义命令目录内的文件/.test(mainForSec)
    ? ok("commands:delete 限定在自定义命令目录内（deleteCustomCommand 是裸 fs.rm）")
    : fail("commands:delete 又变成任意路径删除了");

  // ⑤ 权限判据不得再"怀疑污染就落到全局默认"（曾把用户选的只读静默提成完全访问）
  !/const recordTrusted =/.test(appSrc) && /saferSandbox\(/.test(appSrc)
    ? ok("会话权限取「记录 / 全局默认」中更保守的一方（不会静默提权）")
    : fail("权限判据又回到「记录==引擎值即污染 → 落全局默认」—— 那会把只读会话悄悄变成完全访问");
}
  }

  /* ══ 【12】原 L2206–L2258 ══ */
  {
console.log(C.bold("\n【12】09-14 切换丝滑化不得回退（diff 行级虚拟化 / 按会话事件裁剪 / 窗口与位置记忆）"));

{
  const appSrc2 = readAppUi();
  const mainSrc2 = readMainSource();
  const cssSrc = readStyles();

  // ① 大 diff 行级虚拟化：组件存在 + 真的接进 ToolCodeBlock + 几何常量与 CSS 行高一致
  const hasVirtualComponent = /const VirtualDiffLines = memo\(/.test(appSrc2);
  const wiredInToolCode = /virtualizable\s*\n?\s*\?\s*<VirtualDiffLines/.test(appSrc2) || /<VirtualDiffLines text=\{text\}/.test(appSrc2);
  hasVirtualComponent && wiredInToolCode
    ? ok("大 diff 行级虚拟化已接线（VirtualDiffLines 在 ToolCodeBlock 内生效）")
    : fail("VirtualDiffLines 没接线到 ToolCodeBlock —— 写了不用等于没写");
  const lineHeightMatch = /const DIFF_LINE_HEIGHT = (\d+)/.exec(appSrc2);
  const cssLineHeight = /\.virtual-diff-line \{[^}]*height: (\d+)px/.exec(cssSrc);
  lineHeightMatch && cssLineHeight && lineHeightMatch[1] === cssLineHeight[1]
    ? ok(`虚拟化行高与 CSS 一致（${lineHeightMatch[1]}px）`)
    : fail(`虚拟化行高与 CSS 不一致（js=${lineHeightMatch?.[1] ?? "?"} css=${cssLineHeight?.[1] ?? "?"}）—— 会导致滚动错位`);
  // 只在 diff + 行数超阈值 + 未折行 + 非追字时启用（否则会破坏折行/流式）
  /language === "diff" && !revealing && !settings\.wrap && lineCount > DIFF_VIRTUAL_THRESHOLD/.test(appSrc2)
    ? ok("虚拟化启用条件收窄（仅 diff / 大文件 / 不折行 / 非流式追字）")
    : fail("虚拟化启用条件放宽了 —— 折行或流式追字场景会错位");

  // ② 按会话事件裁剪：必须真的 return null（而不是继续记账放行），且保留逃生阀与空事件保护
  const filterBody = mainSrc2.slice(mainSrc2.indexOf("function filterForRenderer"), mainSrc2.indexOf("function filterForRenderer") + 1200);
  /return null;/.test(filterBody)
    ? ok("按会话事件裁剪真的在裁（filterForRenderer 命中即 return null）")
    : fail("filterForRenderer 又变成无条件放行了 —— 多会话时 N 倍无用事件照旧跨进程");
  /HARNESS_EVENT_FILTER !== "off"/.test(mainSrc2)
    ? ok("裁剪保留逃生阀（HARNESS_EVENT_FILTER=off 一键回放行）")
    : fail("裁剪没有逃生阀 —— 线上出问题时无法不改代码回退");
  /watchedThreadIds\(\)/.test(mainSrc2) && /popoutThreadIds\.values\(\)/.test(mainSrc2)
    ? ok("裁剪把「独立弹窗锁定的会话」也算作必须放行（否则弹窗会永久转圈）")
    : fail("裁剪没考虑弹窗锁定会话 —— 弹窗会收不到自己的事件");
  // 09-21 主进程按域拆分：启动编排（含 server.on("event"）已搬到 features/boot.ts ⇒
  //   「从 server.on("event" 起 400 字符内」这种**位置敏感**写法会因拼接后首处匹配偏移而假红。
  //   判据语义不变：这段判空必须存在（不关心它在哪个文件、离多远）。
  const forwardedGuard = mainSrc2;
  /const forwarded = filterForRenderer\(event\);\s*if \(forwarded\) broadcastCodexEvent\(forwarded\)/.test(forwardedGuard)
    ? ok("裁剪结果先判空再广播（null 不会当成空事件发给渲染层）")
    : fail("裁剪后没有判空就广播 —— 渲染层会收到空事件");

  // ③ 窗口与阅读位置记忆：切回命中缓存时必须保留（不能被下一次重构顺手改回无条件重置）
  /const keepWindow = Boolean\(threadCacheRef\.current\.get\(id\)\)/.test(appSrc2)
    ? ok("命中缓存的切换会保留展开的渲染窗口")
    : fail("openThread 又无条件把渲染窗口重置成 TURN_WINDOW —— 切回长会话内容会缩水");
  /function recallScrollOffset/.test(appSrc2) && /rememberScrollPosition\(threadRef\.current\?\.id/.test(appSrc2)
    ? ok("离开时记阅读位置、切回时还原（贴底会话不记忆）")
    : fail("阅读位置记忆链断了一环（记或还原缺一）");
  /function touchTurnWindow/.test(appSrc2) && /TURN_WINDOW_MEMORY_KEEP/.test(appSrc2)
    ? ok("窗口记忆有 LRU 上限（长跑不会无界增长）")
    : fail("窗口记忆没有淘汰上限 —— 会话多了会一直涨");
}
  }

  /* ══ 【13】原 L2262–L2339 ══ */
  {
console.log(C.bold("\n【13】供应商自动接力（切换供应商后旧会话直接用：原地迁移优先 + fork 接力兜底）"));
{
  // ① 判定纯函数：绑定未知一律不迁（不猜引擎绑定），绑定相同不迁，绑定不同才迁
  shouldAlignProvider("ppz123", "ppz456") === true
    ? ok("绑定 ≠ 激活 → 需要对齐")
    : fail("绑定 ≠ 激活却判定不需要对齐 —— 切换供应商后旧会话会继续用旧 Key 撞 401");
  shouldAlignProvider("ppz123", "ppz123") === false
    ? ok("绑定 = 激活 → 不需要对齐（打开会话零开销）")
    : fail("绑定相同时也判定要迁 —— 每次打开会话都会白跑一次 resume");
  shouldAlignProvider(undefined, "ppz123") === false && shouldAlignProvider("", "ppz123") === false
    ? ok("★ 绑定未知 → 不迁移（引擎是绑定的唯一权威，拿不到就不猜）")
    : fail("绑定未知就迁移 —— 会误迁（旧行为只在已确认绑定差异时才迁）");
  shouldAlignProvider("ppz123", "") === false
    ? ok("激活未知 → 不迁移")
    : fail("激活供应商未知就迁移 —— 迁到空目标会把会话弄坏");

  // ② 结果语义 + 文案（用户可感知的三个点：接力 / 历史没丢 / 旧会话已归档）
  const rs = Object.values(ALIGN_RESULT).join(",");
  rs === "same,migrated,relayed,failed"
    ? ok("结果语义齐全（same/migrated/relayed/failed）")
    : fail("ALIGN_RESULT 语义变了：" + rs);
  const txts = Object.values(CONTINUITY_TEXT).map((f) => f("甲 · m1")).join(" | ");
  /自动接力/.test(txts)
    ? ok("文案点明「自动接力」（用户要知道这是接力不是新开）")
    : fail("文案没提自动接力");
  /历史上下文与聊天记录完整保留/.test(txts)
    ? ok("★ 文案点明「历史上下文与聊天记录完整保留」（用户最关心的）")
    : fail("文案没有说明历史没丢 —— 用户会以为聊天记录没了");
  /原会话已归档/.test(CONTINUITY_TEXT.relayed("甲 · m1"))
    ? ok("接力文案点明「原会话已归档」（侧栏不留两坨）")
    : fail("接力文案没提旧会话归档");

  // ③ 接线守卫：统一入口 + 四个场景都走它
  const appSrc3 = readAppUi();   // 09-21 改造期：统一口径（App.tsx + src/features/** + lib + hooks），代码可能已搬到 features/
  /async function alignThreadToProvider\(/.test(appSrc3)
    ? ok("存在统一入口 alignThreadToProvider（四个场景共用一套行为与文案）")
    : fail("找不到 alignThreadToProvider —— 迁移逻辑又散回各处了");
  const alignCalls = (appSrc3.match(/alignThreadToProvider\(/g) ?? []).length;
  alignCalls >= 5
    ? ok(`四个场景都接了统一入口（打开/发送/401/切换，共 ${alignCalls} 处）`)
    : fail(`只有 ${alignCalls} 处引用 —— 有场景还在直接调 migrateThreadToProvider`);
  {
    const openPart = appSrc3.slice(appSrc3.indexOf("const willRealign"), appSrc3.indexOf("const willRealign") + 1400);
    /void alignThreadToProvider\(/.test(openPart)
      ? ok("打开会话即对齐且不阻塞打开（void，不 await）")
      : fail("打开会话的对齐是 await 的 —— 打开动作会被迁移卡住");
    /runningThreadIdsRef\.current\.has\(id\)/.test(openPart)
      ? ok("打开即对齐带「运行中不打断」守卫")
      : fail("打开即对齐没有运行中守卫 —— 可能打断正在跑的会话");
    /shouldAlignProvider\(resultProvider, activeNow\?\.provider\)/.test(openPart)
      ? ok("打开即对齐的判定走纯函数（绑定未知不迁）")
      : fail("打开即对齐自己写了一套判定 —— 与纯函数口径可能不一致");
  }
  /willRealign && activeNow\s*$/m.test(appSrc3) || /willRealign && activeNow\n\s*\?/.test(appSrc3)
    ? ok("★ 即将接力的会话，模型回填取激活模型（不让旧记录把迁移结果覆盖回去）")
    : fail("模型回填没考虑即将接力 —— 迁移写入会被 openThread 的旧值覆盖（丢更新）");
  /thread\/fork/.test(appSrc3) && /thread\/delete", \{ threadId \}/.test(appSrc3) && !/await archiveThread\(threadId\)/.test(appSrc3)
    ? ok("接力成功后旧会话自动删除（09-15 用户定稿：只保留新的，fork 自带完整历史）")
    : fail("接力兜底缺一环（fork 或 旧会话删除）—— 侧栏会留两坨/历史会丢");
  // 09-14 统一 provider id：接力后登记的是统一 id（HARNESS_PROVIDER_ID），不再登记 target.provider
  /threadProviderRef\.current\.set\(next\.id, (?:target\.provider|HARNESS_PROVIDER_ID)\)/.test(appSrc3)
    ? ok("接力后的新会话登记了真实绑定（下次发送不再重复迁移）")
    : fail("接力后没登记新绑定 —— 每次发送都会再迁一次");

  // ⛔ 09-15「新增的模型选不了」回归守卫：调用方**禁止**拿引擎真实绑定直接跟供应商 id 裸比较。
  //    统一内置 provider id（harness）之后，会话绑定恒为 `harness`、生效供应商是 `custom906`，
  //    裸比较恒为真 → 每次发送都误判「供应商变了」：① setProviderModel 默认 restart，每次发送
  //    都重启引擎；② setModelId(updated.model) 把用户刚选的模型改回供应商顶层 model（用户看到
  //    「选完一发消息就弹回旧模型」）。判定必须一律走 shouldAlignProvider（它明确「绑 harness
  //    = 天然对齐」）。断言按「裸比较的调用点」计数：只允许出现在纯模块内部。
  {
    const rawComparisons = appSrc3.match(/boundProvider\s*!==\s*(?:customModel\.provider|active\.provider|active\?\.provider)/g) ?? [];
    rawComparisons.length === 0
      ? ok("★ 供应商对齐判定全走 shouldAlignProvider（无裸比较：绑 harness 天然对齐）")
      : fail(`检测到 ${rawComparisons.length} 处裸比较 \`boundProvider !== <供应商id>\` —— ` +
             `统一 provider id 后恒为真，会导致每次发送重启引擎 + 用户选的模型被改回去（09-15 用户实测）`);
  }
}
  }

  /* ══ 【14】原 L2342–L2430 ══ */
  {
console.log(C.bold("\n【14】历史分页懒加载（首屏一页 / 滚一屏补一页 / 上下文不受影响）"));
{
  // 09-21：标尺/滚动窗口那批断言盯的代码随 MessageRuler 搬进了 features/session-turn ⇒
// 改走 readAppUi()（App.tsx + features/** + lib/*.ts + hooks/*.ts），与改造期其它内容断言同一口径。
const appSrc4 = readAppUi();
  const win = Number((appSrc4.match(/const TURN_WINDOW = (\d+);/) ?? [])[1] ?? NaN);
  Number.isFinite(win) && win > 0 && win <= 30
    ? ok(`首屏窗口 = ${win} 回合（用户 09-14 定稿：只挂最近 5 个回合，越少越快）`)
    : fail(`TURN_WINDOW = ${win} —— 窗口被改回全量/超大值，长会话首屏又会卡`);
  const page = Number((appSrc4.match(/const TURNS_PAGE = (\d+);/) ?? [])[1] ?? NaN);
  Number.isFinite(page) && page > 0 && page <= 40
    ? ok(`续载页大小 = ${page} 回合（一页一页，单次请求数据量有上限）`)
    : fail(`TURNS_PAGE = ${page} —— 页大小失控`);
  const lightSig = appSrc4.slice(appSrc4.indexOf("async function resumeThreadLight"), appSrc4.indexOf("async function resumeThreadLight") + 2200);
  /* ⛔ 允许参数带类型标注：09-22 给 resumeThreadLight 补了 `turnBudget: number = bag.TURNS_PAGE`
     —— 不加标注会推断出**字面量类型 5**（默认值来自 `const TURNS_PAGE = 5`），与 bag-types 的
     `number` 分叉，被【93】守卫抓到。本断言盯的是「预算仍是 TURNS_PAGE」，不是「参数没有标注」。 */
  /turnBudget(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*=\s*TURNS_PAGE/.test(lightSig)
    ? ok("打开会话只取一页（resume 不再让引擎水合全部历史）")
    : fail("resumeThreadLight 的取数预算不再是 TURNS_PAGE —— 首屏数据量又回到全量");
  /turnsCursorRef\.current\.set/.test(lightSig)
    ? ok("取页同时记下游标（往上滚能续到更早，不会重拉最新页）")
    : fail("取页没有记游标 —— 续拉会重复拉最新一页");
  const scrollFn = appSrc4.slice(appSrc4.indexOf("function onTimelineScroll"), appSrc4.indexOf("function onTimelineScroll") + 700);
  /userScrolledRef\.current/.test(scrollFn)
    ? ok("★ 自动续载只认「真实用户滚动」（滚轮/触摸/翻页键/拖滚动条）")
    : fail("自动续载又只看 scrollTop —— 打开会话的程序化滚动会让「用户没滚也加载」");
  const anchorFn = appSrc4.slice(appSrc4.indexOf("async function loadEarlierTurns"), appSrc4.indexOf("async function loadEarlierTurns") + 4200);
  /anchorTopBefore/.test(anchorFn) && /isConnected/.test(anchorFn)
    ? ok("★ 位置补偿用锚点元素位移（content-visibility 下 scrollHeight 不可靠）")
    : fail("位置补偿退回 scrollHeight 增量 —— 上方插入内容会把用户看的内容顶飞");
  /setEarlierLoadingId/.test(anchorFn) && /load-earlier-hint/.test(appSrc4)
    ? ok("续载有可见提示（不再是静默加载）")
    : fail("续载没有载入提示");
  /userScrolledRef\.current = false/.test(appSrc4)
    ? ok("切换会话时重置「用户滚过」标记（新会话需重新滚才自动续载）")
    : fail("切换会话没重置用户滚动标记 —— 切过去没滚也会自动加载");
  // 载入提示不许常驻（用户 09-14 实测「一直常驻，切会话都在」：续载请求挂起会让提示与
  // 防重入锁一起卡住，该会话再也加载不了更早历史）。三重保护缺一不可：
  /turns\/list timeout/.test(anchorFn) && /Promise\.race/.test(anchorFn)
    ? ok("续载请求有超时保护（引擎慢/挂起时不会卡住加载状态）")
    : fail("续载请求没有超时保护 —— 请求挂起会让「正在载入」常驻");
  /hintTimer = window\.setTimeout/.test(anchorFn) && /clearTimeout\(hintTimer\)/.test(anchorFn)
    ? ok("提示有兜底计时器（异常路径也会自动清除）")
    : fail("提示没有兜底清除 —— 任何异常路径都会留下常驻提示");
  /setEarlierLoadingId\(null\)/.test(appSrc4)
    ? ok("切换会话时清掉提示（不留上一次的加载态）")
    : fail("切换会话没清提示 —— 会串会话残留");
  // 滚回最新必须把往上滚展开的渲染窗口收回来（用户 09-14：「滚上去看历史、再滚下来，
  // 切换会话回来它还在渲染，不方便」）；⛔ 只收窗口、不动数据（否则再看历史要重新请求）。
  const collapseFn = appSrc4.slice(appSrc4.indexOf("function collapseTurnWindow"), appSrc4.indexOf("function collapseTurnWindow") + 700);
  /TURN_WINDOW/.test(collapseFn) && !/turns:/.test(collapseFn) && !/setThread/.test(collapseFn)
    ? ok("★ 窗口回收只重置渲染窗口（不动 thread.turns / 不触发拉取）")
    : fail("窗口回收动了数据 —— 收起后再看历史得重新请求，且可能与引擎状态打架");
  const scrollFn2 = appSrc4.slice(appSrc4.indexOf("function onTimelineScroll"), appSrc4.indexOf("function onTimelineScroll") + 900);
  /collapseTurnWindow\(id\)/.test(scrollFn2) && /clientHeight/.test(scrollFn2)
    ? ok("★ 滚回最新（贴底）即收回窗口，切会话回来是初始态")
    : fail("没有「贴底即收回窗口」—— 展开过的历史会一直撑着渲染");
  // 刻度尺窗口（用户 09-18 改口径：「跟着懒加载来 / 往上滚过一直透出不对，要滚动渲染刻度线」
  // —— 09-14 的「已加载全部留在尺子上（pad 压缩）」在页数一多时会全量塞成密集柱，且与视口无关，
  // 现改为**滑动窗口跟随滚动位置**，固定槽高、容量封顶）
  (/\(h \/ total - 2\) \/ 3/.test(appSrc4))
    ? fail("刻度尺还在按「全部塞上尺子」反解压缩 pad —— 用户 09-18 已改口径：滑动窗口跟滚动")
    : ok("刻度尺不再全量塞刻度（pad 压缩反解已删，固定槽高 14px）");
  (/windowSize = Math\.min\(Math\.max\(4, visibleCount\), RULER_MAX\)/.test(appSrc4))
    ? ok("刻度窗口容量封顶（RULER_MAX）—— 已加载页数再多也不会全量透出")
    : fail("刻度窗口没有上限 —— 又会随懒加载页数堆成密集柱");
  // ⛔ 只查常量值没有鉴别力：必须查**使用点**是否真的绑了 RULER_PAGE（反证过：把使用点改回
  //    固定格数，常量断言照样绿）。
  /direction \* RULER_PAGE/.test(appSrc4)
    ? ok("滚轮使用点真的按页滑（direction * RULER_PAGE）")
    : fail("滚轮使用点没绑 RULER_PAGE —— 又回到固定格数地滑");
  /setWindowOffset\(0\); \}, \[currentIndex\]\)/.test(appSrc4)
    ? ok("刻度选区只在阅读位置变化时归位（加载新页不会把选区拽走）")
    : fail("加载新页会把刻度选区拽回最新 —— 往上滚看历史时选区会乱跳");
  // 滚轮滑窗声音反馈（用户 09-19：「鼠标放上去上下滑动，加一个声音反馈，选最贴合的」）：
  // 合成棘轮咔哒（src/lib/wheel-tick.mjs，无音频资产）；⛔ 只在窗口真的移动时响——
  // 响与不响的判据依赖最新 state，所以滚轮闭包必须走 wheelCtxRef（顺路修掉的 stale closure）。
  (/const next = Math\.max\(-ctxNow\.currentIndex, Math\.min\(maxOffset, ctxNow\.windowOffset \+ direction \* RULER_PAGE\)\);[\s\S]{0,220}if \(next === ctxNow\.windowOffset\) return;[\s\S]{0,120}setWindowOffset\(next\);[\s\S]{0,80}playWheelTick\(direction\);/.test(appSrc4))
    ? ok("刻度尺滚轮：先算 next、窗口真移动才 setWindowOffset + 播放棘轮咔哒（到顶/到底静默）")
    : fail("刻度尺滚轮的声音反馈被摘了 —— 或窗口移动判定没走 wheelCtxRef 最新值");
  (/const wheelCtxRef = useRef\(\{ allMarks, windowSize, currentIndex, windowOffset \}\);/.test(appSrc4) && /wheelCtxRef\.current = \{ allMarks, windowSize, currentIndex, windowOffset \};/.test(appSrc4))
    ? ok("滚轮监听的 stale closure 已修（最新 state 经 wheelCtxRef 进闭包）")
    : fail("滚轮监听又在闭包里直读 state —— 首帧绑死后钳制/容量全用旧值");
  const tickSrc = readFileSync(join(ROOT, "src/lib/wheel-tick.mjs"), "utf8");
  (/THROTTLE_MS/.test(tickSrc) && /UP_FREQ/.test(tickSrc) && /DOWN_FREQ/.test(tickSrc) && /catch/.test(tickSrc))
    ? ok("滑窗音效模块：方向音调区分 + 30ms 节流 + 异常静默降级（音频挂起绝不拖垮滚轮交互）")
    : fail("wheel-tick.mjs 缺节流/方向音调/静默降级 —— 声音会把滚轮交互搞挂或吵人");
}
  }

  /* ══ 【123】系统托盘（09-23 用户：「系统托盘里面常驻 + 右键功能菜单齐全」）══ */
  {
    console.log(C.bold("\n【123】系统托盘：图标随包 / 菜单现建 / 关闭到托盘开关 / 退出链路"));
    const traySrc = existsSync(join(ROOT, "electron", "tray.ts"))
      ? readFileSync(join(ROOT, "electron", "tray.ts"), "utf8").replace(/\r/g, "")
      : "";
    (traySrc ? ok : fail)("【123】electron/tray.ts 存在");

    // ① 图标：三份 PNG 必须是**真 PNG 且尺寸符合约定**（渲染脚本按 32/16/32 出图）
    const icons = [
      { file: "tray.png", size: 32, who: "Windows/Linux 彩色图" },
      { file: "trayTemplate.png", size: 16, who: "macOS 模板图 1x" },
      { file: "trayTemplate@2x.png", size: 32, who: "macOS 模板图 2x" },
    ];
    for (const icon of icons) {
      const p = join(ROOT, "build", icon.file);
      if (!existsSync(p)) { fail(`【123】缺托盘图标 build/${icon.file}（${icon.who}）—— 跑 scripts/build-tray-icon.cjs`); continue; }
      const buf = readFileSync(p);
      const isPng = buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
      const w = buf.length >= 24 ? buf.readUInt32BE(16) : 0;
      const h = buf.length >= 24 ? buf.readUInt32BE(20) : 0;
      (isPng && w === icon.size && h === icon.size ? ok : fail)(
        `【123】build/${icon.file} 是 ${icon.size}x${icon.size} PNG（实得 ${w}x${h}${isPng ? "" : " 非 PNG"}，${icon.who}）`
      );
    }
    // ⛔ 打包白名单：build/ 不在 files 里 ⇒ 打包版 icons 全丢，托盘在用户机上变"看不见的图标"
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const filesList = Array.isArray(pkg?.build?.files) ? pkg.build.files : [];
    const missing = icons.map((i) => `build/${i.file}`).filter((f) => !filesList.includes(f));
    (missing.length === 0 ? ok : fail)(
      `【123】package.json files 白名单带上三个托盘图（缺 ${missing.join(" / ") || "无"}）—— 漏了打包版就无图标`
    );
    // ⛔ 托盘子图必须**与应用图标同源**（09-24 用户：「桌面快捷图标是啥样的，任务栏跟系统托盘就啥样，
    //   同步好」）。应用图标母版 = build/icon-a-spark.svg（build/icon.ico 就是它渲染的，任务栏与桌面
    //   快捷方式用的都是 icon.ico）；首版托盘是手写的另一版简化图 ⇒ 肉眼不一致（星标位置/缺光标条）。
    //   判据：脚本必须从母版 SVG 读图，且不得再出现手写的彩色 SVG 常量。
    const trayScript = existsSync(join(ROOT, "scripts", "build-tray-icon.cjs"))
      ? readFileSync(join(ROOT, "scripts", "build-tray-icon.cjs"), "utf8") : "";
    (/icon-a-spark\.svg/.test(trayScript) && !/const COLOR_SVG/.test(trayScript) ? ok : fail)(
      "【123】托盘子图与应用图标同源（build-tray-icon.cjs 从 icon-a-spark.svg 读母版，不再手写另一版）"
    );
    // 反向：files 白名单不许被改成 "build/**"（会把 icon.ico 等一起塞进包，白名单应保持最小）
    (!filesList.includes("build/**") && !filesList.includes("build/*") ? ok : fail)(
      "【123】files 白名单仍是最小集（没有整体放开 build/**）"
    );

    // ② 图标路径与平台分叉（mac 用模板图；dev/打包两处都能解析到）
    (/process\.platform === "darwin" \? "trayTemplate\.png" : "tray\.png"/.test(traySrc) ? ok : fail)(
      "【123】图标按平台分叉（mac 必须用 Template 图，否则深色菜单栏上是糊块）"
    );
    (/path\.join\(app\.getAppPath\(\), "build"/.test(traySrc) ? ok : fail)(
      "【123】托盘图标锚在 app.getAppPath()（dev=仓库根 / 打包=asar 根），不是 __dirname"
    );
    // ⛔ 图标读不到时不许静默：isEmpty 要打日志（否则就是"托盘在但看不见"，最难查）
    (/image\.isEmpty\(\)/.test(traySrc) && /console\.warn\(/.test(traySrc) ? ok : fail)(
      "【123】图标为空时打日志继续（不让托盘静默变成看不见的图标）"
    );

    // ③ 菜单**弹出时现建**：缓存住就会说假话（「运行中 N 个任务」「显示/隐藏」都是实时值）
    const popups = (traySrc.match(/popUpContextMenu\(Menu\.buildFromTemplate\(buildAppTrayMenu\(deps\)\)\)/g) || []).length;
    (popups >= 2 ? ok : fail)(
      `【123】右键/左键(mac) 两处都在弹出时现建菜单（实得 ${popups} 处，需 ≥2）`
    );
    (!/setContextMenu\(/.test(traySrc) ? ok : fail)(
      "【123】没有 setContextMenu 缓存菜单 —— 状态行会过期说假话"
    );
    // 菜单条目面（用户要「功能齐全」）：显隐 / 状态 / 关闭到托盘开关 / 打开数据目录 / 看日志 / 退出
    const entries = ["显示主窗口", "隐藏主窗口", "运行中：", "空闲", "关闭窗口时最小化到托盘", "打开数据目录", "查看引擎日志", "退出 Codex Harness Desktop"];
    const missingEntry = entries.filter((e) => !traySrc.includes(e));
    (missingEntry.length === 0 ? ok : fail)(
      `【123】菜单条目齐（缺 ${missingEntry.join(" / ") || "无"}）`
    );
    (/setToolTip\(`Codex Harness Desktop \$\{app\.getVersion\(\)\}`\)/.test(traySrc) ? ok : fail)(
      "【123】托盘 tooltip 带版本号（悬停即可确认在跑哪一版）"
    );

    // ④ 接线：main.ts 创建 + before-quit 销毁 + 退出前绕开关窗守卫
    const mainTray = readMainSource();
    (/createAppTray\(\{/.test(mainTray) ? ok : fail)("【123】main.ts 真正创建托盘（不是只写了模块）");
    (/destroyAppTray\(\)/.test(mainTray) ? ok : fail)(
      "【123】before-quit 销毁托盘（Windows 上不销毁会残留到鼠标划过才消失）"
    );
    {
      // 退出链路：托盘「退出」与 before-quit 都必须在 app.quit 前把 closeConfirmed 置真，
      // 否则关窗守卫会把 quit 变成 hide ⇒ **点了退出却只是把窗口藏起来**。
      // ⛔ 实现落在 main.ts 的托盘依赖里（tray.ts 里的 `quit: () => void` 只是类型声明），
      //    所以判据必须切 main.ts —— 早先切 tray.ts 切到的是类型声明，恒假红。
      const trayQuitImpl = mainTray.slice(mainTray.indexOf("quit: () => {"), mainTray.indexOf("quit: () => {") + 200);
      const beforeQuit = mainTray.slice(mainTray.indexOf('app.on("before-quit"'), mainTray.indexOf('app.on("before-quit"') + 560);
      (/closeConfirmed = true[\s\S]{0,80}app\.quit\(\)/.test(trayQuitImpl) ? ok : fail)(
        "【123】托盘「退出」先置 closeConfirmed 再 app.quit（否则退不掉）"
      );
      (/closeConfirmed = true/.test(beforeQuit) ? ok : fail)(
        "【123】before-quit 里也置 closeConfirmed（覆盖 Cmd+Q / 系统关机等其它退出路径）"
      );
    }

    // ⑤ 「关闭窗口时最小化到托盘」：默认关 + 必须排在"还有任务在跑"确认框**之前**
    const appSettingsSrc = readFileSync(join(ROOT, "electron", "app-settings.ts"), "utf8");
    (/closeToTray\?: boolean;/.test(appSettingsSrc) ? ok : fail)("【123】app-settings 有 closeToTray 开关（默认关）");
    (/export function closeToTrayEnabled\(\): boolean \{[\s\S]{0,160}readAppSettingsSync/.test(mainTray) ? ok : fail)(
      "【123】closeToTrayEnabled 读 app-settings 缓存（托盘里一勾即生效，无需重启）"
    );
    const winFactory = readFileSync(join(ROOT, "electron", "features", "window-factory.ts"), "utf8").replace(/\r/g, "");
    const closeHandler = winFactory.slice(winFactory.indexOf('on("close"'), winFactory.indexOf('on("closed"'));
    const atHide = closeHandler.indexOf("closeToTrayEnabled()");
    const atDialog = closeHandler.indexOf("dialog.showMessageBox");
    (atHide >= 0 && atDialog >= 0 && atHide < atDialog ? ok : fail)(
      "【123】closeToTray 分支排在「还有任务在跑」确认框之前（隐藏不中断回合，不该弹警告）"
    );
    (/mutableState\.mainWindow\?\.hide\(\)/.test(closeHandler) ? ok : fail)(
      "【123】开启后 close 是 hide 而不是 close（引擎/调度器/渠道机器人继续跑）"
    );
  }

  /* ══ 【136】委派并发闸不得被"残留运行中记录"永久占满（09-24，评估报告 §4.3）══
     status="running" 是**持久化**的，只有 delegation 的成功/失败两条路径会清；应用被中断
     （崩溃 / 关窗 / 引擎被杀）就永远留着 ⇒ runningCount() 只增不减 ⇒ 攒满
     MAX_CONCURRENT_DISPATCH(4) 后 **admitDispatch 永久拒绝所有委派**，且跨重启累积
     （prune() 只清 finished，救不了）。修法 = 启动时收敛 + 该窗口内的记忆构建必须降级。 */
  {
    const registrySrc = readFileSync(join(ROOT, "electron", "delegate-registry.ts"), "utf8");
    (/async reconcileRunning\([\s\S]{0,900}?status: "failed"/.test(registrySrc) ? ok : fail)(
      "【136】delegate-registry 有 reconcileRunning：把残留 running 记录收成 failed（否则并发闸永久占满）"
    );
    (/reconcileRunning\([\s\S]{0,400}?this\.activeThreads\.delete\(key\)/.test(registrySrc) ? ok : fail)(
      "【136】收敛时同步清 activeThreads（漏了头像轨会挂着一条永不结束的记录）"
    );
    (/if \(count\) this\.scheduleSave\(\)/.test(registrySrc) ? ok : fail)(
      "【136】收敛幂等：无残留不写盘（避免每次启动白写一次）"
    );
    const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    const atReconcile = bootSrc.indexOf("reconcileRunning()");
    const atServerStart = bootSrc.indexOf("await server.start();");
    (atReconcile >= 0 && atServerStart >= 0 && atReconcile < atServerStart ? ok : fail)(
      "【136】启动链在 server.start() 之前 await reconcileRunning（放在之后 = 首个委派仍可能被占满的闸拒掉）"
    );
    const delegationSrc = readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8");
    (/buildDelegateMemory\(\{[\s\S]{0,400}?\}\)\.catch\(/.test(delegationSrc) ? ok : fail)(
      "【136】buildDelegateMemory 失败必须降级（它位于 register() 之后、try 之前，抛出即泄漏一个 running 槽位）"
    );
  }

  /* ══ 【137】墓碑加载不得有"已置位但数据未到"的窗口（09-24，评估报告 §4.4）══
     原实现在 await **之前**置 deletedThreadsLoaded=true ⇒ 与启动竞争的第一次 thread/list
     看到空墓碑集 ⇒ 把已删会话合并回侧栏（09-18 修掉的「删除后重启复活」以竞态复发）。 */
  {
    const delSrc = readFileSync(join(ROOT, "electron", "features", "thread-deletion.ts"), "utf8");
    const loadBody = delSrc.slice(delSrc.indexOf("async function loadDeletedThreads"), delSrc.indexOf("async function rememberDeletedThread"));
    /* ⛔ 判据用**位置比较**而不是前瞻正则：要表达的是「置位必须发生在读盘之后」。
       第一版写成 /deletedThreadsLoaded = true;(?![\s\S]{0,40}?await)/ —— 修好后置位确实
       后面没有 await（它在 try/catch 之后），于是恒判红（假红）。 */
    const atFlag137 = loadBody.indexOf("deletedThreadsLoaded = true");
    const atRead137 = loadBody.indexOf("await fs.readFile");
    (atRead137 >= 0 && atFlag137 > atRead137 ? ok : fail)(
      "【137】置位必须晚于读盘（在 await 之前置位 ⇒ 并发首调看到空墓碑 ⇒ 已删会话复活）"
    );
    (/let deletedThreadsLoad: Promise<void> \| null = null;/.test(delSrc) ? ok : fail)(
      "【137】用共享 in-flight promise 让并发调用者等到同一份数据（且仍只读一次盘）"
    );
    (/if \(deletedThreadsLoad\) return deletedThreadsLoad;/.test(loadBody) ? ok : fail)(
      "【137】并发入口返回同一个 promise（返回 undefined 等于不等）"
    );
  }
  /* ══ 【144】更新检查必须做 semver 比较（09-24 §3.5）═════════════════════════
     原实现 `version === currentVersion` 才判「已是最新」⇒ **任何不同的 tag（包括更旧的）
     都报 hasUpdate:true**，而当前版本 0.0.26-b 带后缀，字符串比较完全没有大小语义。
     判据：① 源码不再用字符串不等判更新；② 有 compareVersions / parseVersion；
     ③ stable 通道下尊重 prerelease；④ **跑编译产物里的真函数**做行为断言（不是看文本）。 */
  {
    const updSrc = readFileSync(join(ROOT, "electron", "updates.ts"), "utf8");
    (!/version\s*===\s*currentVersion/.test(updSrc) ? ok : fail)(
      "【144】不再用「字符串不等」判定有更新（更旧的 tag 也会被误报成更新）"
    );
    (/export function compareVersions\(/.test(updSrc) && /export function parseVersion\(/.test(updSrc) ? ok : fail)(
      "【144】updates.ts 导出 compareVersions / parseVersion（语义化版本比较）"
    );
    (/release\?\.prerelease|release\.prerelease/.test(updSrc) && /UPDATE_CHANNEL === "stable"/.test(updSrc) ? ok : fail)(
      "【144】stable 通道尊重 GitHub prerelease 标志（预发布版不推给 stable 用户）"
    );
    // 行为断言：import dist-electron 产物，跑真函数
    const distUpd = join(ROOT, "dist-electron", "updates.js");
    if (!existsSync(distUpd)) {
      fail("【144】dist-electron/updates.js 不存在（先构建再跑预检）—— 行为断言无法执行");
    } else {
      try {
        const mod = await import(pathToFileURL(distUpd).href);
        const cmp = mod.compareVersions;
        const cases = [
          ["0.0.26", "0.0.25", 1],
          ["0.0.25", "0.0.26", -1],
          ["0.0.26", "0.0.26", 0],
          ["0.0.26-b", "0.0.26", -1],
          ["0.0.26", "0.0.26-b", 1],
          ["0.0.26-b", "0.0.26-a", 1],
          ["1.0.0", "0.9.9", 1],
        ];
        const wrong = cases.filter(([a, b, want]) => cmp(a, b) !== want);
        (wrong.length === 0 ? ok : fail)(
          `【144】compareVersions 行为正确（${cases.length} 组用例：更旧不报更新 / 预发布小于正式版 / 相等为 0）${wrong.length ? "，失败：" + wrong.map(([a, b, w]) => `${a} vs ${b} 期望${w}`).join("；") : ""}`
        );
      } catch (e) {
        fail(`【144】dist-electron/updates.js 行为断言执行失败：${e && e.message ? e.message : String(e)}`);
      }
    }
  }
  /* ══ 【145】截图快捷键 + 收藏夹：从「只看文本」升级为行为断言（09-24 §2.8）════
     报告实测：`electron/accelerator.ts` 在所有守卫里 **0 命中**；收藏夹只有 regex 存在性断言
     ⇒「快捷键注册坏了 / 收藏删除坏了」照发。两者恰好都是**纯函数/纯数据层**
     （accelerator 无副作用；favorites 收 userData 参数）⇒ 可以直接 import 编译产物跑真实现，
     收藏夹用 mkdtempSync 的临时目录，**不碰用户真实数据**。 */
  {
    const distAcc = join(ROOT, "dist-electron", "accelerator.js");
    if (!existsSync(distAcc)) {
      fail("【145】dist-electron/accelerator.js 不存在（先构建）—— 快捷键行为断言无法执行");
    } else {
      try {
        const acc = await import(pathToFileURL(distAcc).href);
        const s = acc.sanitizeAccelerator;
        const cases = [
          // 输入 → 期望（关键不变量：至少一个修饰键；修饰键按 MODIFIER_ORDER 归一并去重；主键大写）
          ["shift+ctrl+s", "CommandOrControl+Alt+A", "Ctrl+Shift+S"],
          ["Ctrl+S", "CommandOrControl+Alt+A", "Ctrl+S"],          // 单 Ctrl+S 合法（不是单键）
          ["S", "CommandOrControl+Alt+A", "CommandOrControl+Alt+A"], // ⛔ 无修饰键 ⇒ 回落（否则全局吞字母）
          ["", "CommandOrControl+Alt+A", "CommandOrControl+Alt+A"],
          ["ctrl+shift+alt+a", "X", "Ctrl+Alt+Shift+A"],
          ["CommandOrControl+Shift+Alt+A", "X", "CommandOrControl+Alt+Shift+A"],
          ["ctrl+F5", "X", "Ctrl+F5"],
        ];
        const wrong = cases.filter(([input, fb, want]) => s(input, fb) !== want);
        (wrong.length === 0 ? ok : fail)(
          `【145】sanitizeAccelerator 行为正确（${cases.length} 组：无修饰键回落 / 修饰键归一排序 / 主键大写）${wrong.length ? "，失败：" + wrong.map(([i, , w]) => `${i} 期望 ${w}`).join("；") : ""}`
        );
        const labelCases = [
          ["CommandOrControl+Shift+Alt+A", false, "Ctrl+Shift+Alt+A"],
          ["CommandOrControl+Shift+Alt+A", true, "⌘⇧⌥A"],
        ];
        const labelWrong = labelCases.filter(([a, mac, want]) => acc.acceleratorLabel(a, mac) !== want);
        (labelWrong.length === 0 ? ok : fail)(
          `【145】acceleratorLabel 行为正确（Windows 显示 Ctrl/Win，mac 显示 ⌘⇧⌥）${labelWrong.length ? "，失败：" + labelWrong.map(([a, m, w]) => `${a}/${m} 期望 ${w}`).join("；") : ""}`
        );
      } catch (e) {
        fail(`【145】accelerator 行为断言执行失败：${e && e.message ? e.message : String(e)}`);
      }
    }

    const distFav = join(ROOT, "dist-electron", "favorites.js");
    if (!existsSync(distFav)) {
      fail("【145】dist-electron/favorites.js 不存在（先构建）—— 收藏夹行为断言无法执行");
    } else {
      let tmp = "";
      try {
        const fav = await import(pathToFileURL(distFav).href);
        tmp = mkdtempSync(join(tmpdir(), "harness-fav-guard-"));
        // ⛔ addFavorite 返回 { items, item } —— id 要从返回值或直接读回里取，不能猜
        const first = await fav.addFavorite(tmp, { kind: "text", title: "A", content: "内容A" });
        await fav.addFavorite(tmp, { kind: "text", title: "B", content: "内容B" });
        const list = await fav.readFavorites(tmp);
        const ids = list.map((x) => x.id);
        (list.length === 2 && ids.every(Boolean) && Boolean(first.item?.id) ? ok : fail)(
          `【145】addFavorite 真落盘并可读回（实测 ${list.length} 条）`
        );
        // ⛔ 核心不变量：删除只认显式 id —— 空 id 列表必须一条都不删
        const emptyDel = await fav.deleteFavorites(tmp, []);
        (emptyDel.removed === 0 && (await fav.readFavorites(tmp)).length === 2 ? ok : fail)(
          `【145】deleteFavorites 空 id 列表不删任何条目（实测 removed=${emptyDel.removed}）`
        );
        const oneDel = await fav.deleteFavorites(tmp, [ids[0]]);
        const afterOne = await fav.readFavorites(tmp);
        (oneDel.removed === 1 && afterOne.length === 1 && afterOne[0].id === ids[1] ? ok : fail)(
          `【145】deleteFavorites 只删指定 id（实测 removed=${oneDel.removed}，剩 ${afterOne.length} 条）`
        );
        const cleared = await fav.clearFavorites(tmp);
        (cleared.removed === 1 && (await fav.readFavorites(tmp)).length === 0 ? ok : fail)(
          `【145】clearFavorites 是独立动作且计数正确（实测 removed=${cleared.removed}）`
        );
      } catch (e) {
        fail(`【145】收藏夹行为断言执行失败：${e && e.message ? e.message : String(e)}`);
      } finally {
        try { if (tmp) rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
      }
    }
  }
}
