/**
 * 预检守卫组：02-session-logic
 * 分节：【4】【4a-2】【4a-3】【4a-4】【4a-4b】【4a-5】【4a-6】【4b】【4c】【4d】【4e】【4f】【4g】（原 L499–L1725）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, OWN_WRITE_TTL_MS, ROOT, SESSION_SCOPE_HEADING, composeScopeInstructions, createAec, createEchoGate, createSentenceChunker, createSpeakFilter, emptyRuntime, existsSync, fail, isOwnEcho, join, legacyMirror, mainSrc, migrateRuntime, normalizeNumbers, normalizeRuntime, numberToChinese, ok, patchRuntime, preloadSrc, readAppUi, readFileSync, readMainSource, readStyles, readVoiceCallFloatSrc, readVoiceSettingsSrc, rememberOwnWrite, resampleLinear, resolveModelForOpen, rmsOf, runtimeSignature, sessionScopeBlock, sessionScopeSignature, shouldSyncOpenThread, stripScopeBlock, toSpeakableText, warn,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【4】原 L499–L584 ══ */
  {
console.log(C.bold("\n【4】纯逻辑行为断言（模型选择的作用域：每个会话独立）"));

if (typeof resolveModelForOpen !== "function") {
  fail("src/lib/model-scope.mjs 没有导出 resolveModelForOpen");
} else {
  // 每条都先断言「喂进去的确实是这两个值」，再断言输出——防假通过
  const cases = [
    {
      name: "会话有记录 → 用会话自己的（哪怕全局是别的模型）【会话独立的核心】",
      input: { stored: "custom:p:mine", global: "custom:p:global" },
      want: "custom:p:mine",
    },
    {
      name: "会话还没记录 → 用全局默认（新建 / 从没选过的会话）",
      input: { stored: "", global: "custom:p:global" },
      want: "custom:p:global",
    },
    {
      name: "会话记录与全局都空 → 空串（交调用方兜底）",
      input: { stored: "", global: "" },
      want: "",
    },
    {
      name: "字段缺省（undefined）不炸：按「没记录」处理",
      input: {},
      want: "",
    },
    {
      name: "两者相同 → 原值返回",
      input: { stored: "custom:p:same", global: "custom:p:same" },
      want: "custom:p:same",
    },
  ];

  for (const c of cases) {
    const got = resolveModelForOpen(c.input);
    // 前置条件：输入原样（防止用例自身写错导致断言无意义）
    const inputIntact =
      (c.input.stored === undefined || typeof c.input.stored === "string") &&
      (c.input.global === undefined || typeof c.input.global === "string");
    if (!inputIntact) fail(`${c.name} —— 用例输入本身不合法`);
    if (got === c.want) ok(c.name);
    else fail(`${c.name} —— 期望 ${JSON.stringify(c.want)}，实际 ${JSON.stringify(got)}`);
  }

  // 改「全局默认模型」时要不要顺手同步当前会话：只有真有会话打开才是 true
  const scopeCases = [
    { name: "有会话打开 → 同步到该会话（用户改了就该生效）", input: "thread-abc", want: true },
    { name: "无会话（欢迎页）→ 只改全局默认，别碰任何会话", input: "", want: false },
    { name: "undefined → 不同步（防拼出 'undefined' 这样的幽灵会话键）", input: undefined, want: false },
  ];
  for (const c of scopeCases) {
    const got = shouldSyncOpenThread(c.input);
    got === c.want ? ok(c.name) : fail(`${c.name} —— 期望 ${c.want}，实际 ${got}`);
  }

  // 接线守卫：openThread 的模型回填必须走这层判定（防日后退回「无条件用会话记录」或
  // 「全局后改就覆盖会话」——后者会把所有旧会话的模型选择冲掉，与「会话独立」冲突）
  const appSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readAppUi() : "";
  if (!appSrc) {
    warn("找不到 src/App.tsx，跳过接线守卫");
  } else {
    const wired = /const storedModel = resolveThreadModel\(id\);/.test(appSrc);
    // ⛔ 09-22：不再锁死相对路径层数。接线随架构改造落进 features/app-state/parts/part06
    //   与 features/app-view/helpers/runtime，相对路径变成 `../../../../lib/model-scope.mjs`；
    //   原来只认 `./lib/…`（App 同级）会让这条**假红**（此前它恰好靠 App.tsx 里一条
    //   已死的同名 import 撑着 —— 那条死导入清掉后本断言才暴露出位置过时）。
    //   断言意图是「app 代码确实 import 了 model-scope」，与深度无关。
    const imported = /from "[^"]*lib\/model-scope\.mjs"/.test(appSrc);
    wired && imported
      ? ok("openThread 回填已接上 resolveThreadModel（且 import 了 model-scope）")
      : fail(`openThread 模型回填未接上作用域判定（import=${imported} wire=${wired}）`);

    // 写入点守卫：`default-model` 全仓库只许在 applyGlobalModelChoice 里写一次。
    // 散落写入 = 绕过「有会话才同步、其它会话一律不动」的作用域规则（09-11 返工的根因）。
    const writes = appSrc.match(/setItem\(\s*"default-model"/g) ?? [];
    writes.length === 1
      ? ok("`default-model` 只有一处写入（applyGlobalModelChoice 统一入口）")
      : fail(`\`default-model\` 有 ${writes.length} 处写入，应全部收敛到 applyGlobalModelChoice——散落写入会绕过作用域规则`);

    const helperUsesScope = /shouldSyncOpenThread\(openId\)/.test(appSrc);
    helperUsesScope
      ? ok("applyGlobalModelChoice 按 shouldSyncOpenThread 决定是否同步当前会话")
      : fail("applyGlobalModelChoice 没走 shouldSyncOpenThread —— 改全局默认会波及别的会话");
  }
}
  }

  /* ══ 【4a-2】原 L588–L669 ══ */
  {
console.log(C.bold("\n【4a-2】会话作用域块（会话级配置下发到会话自己的 instructions）"));

{
  const base = "You are a fully capable autonomous engineering agent. LANGUAGE: 简体中文。";
  const scope = {
    threadId: "01a09cb0-f2f8-7fb3-9de0-1b3bd5238a07",
    model: "glm-5.3-flash",
    provider: "custom906",
    effort: "ultra",
    sandbox: "danger-full-access",
    approval: "never",
    workspace: "D:\\生图专用文件",
  };

  // ① 块里必须真的写出四项会话级取值（缺一项模型就答不全，09-14 体检实测的坑）
  const block = sessionScopeBlock(scope);
  const wantLines = [`模型：${scope.model}`, `思考档位：${scope.effort}`, `执行权限：${scope.sandbox}`, `审批 ${scope.approval}`, `工作区：${scope.workspace}`];
  const missing = wantLines.filter((line) => !block.includes(line));
  missing.length === 0
    ? ok("作用域块含 模型/档位/权限/工作区 四项会话级取值")
    : fail(`作用域块缺项：${missing.join(" / ")}`);

  // ② 必须显式否定「全局顶层 = 当前配置」——这正是模型报错模型的原因
  const deniesGlobal = block.includes("不代表当前会话") && block.includes("一律以本节为准");
  deniesGlobal
    ? ok("作用域块显式声明全局顶层 model/effort 不代表当前会话")
    : fail("作用域块没说清「全局顶层 ≠ 当前会话」——模型会继续读 config.toml 顶部自报旧模型");

  // ③ 签名：模型/档位/权限变了必须变（否则不会重新下发）；工作区变了不必重发
  const sig = sessionScopeSignature(scope);
  const sameSig = sessionScopeSignature({ ...scope, workspace: "D:\\other", threadId: "other" });
  sig === sameSig ? ok("签名只看 模型/供应商/档位/权限（工作区变动不触发重发）") : fail("签名把工作区/会话 ID 也算进去了——会无谓重发");
  const modelChanged = sessionScopeSignature({ ...scope, model: "deepseek-v4-flash" });
  modelChanged !== sig ? ok("签名随模型变化（切模型后必定重新下发作用域）") : fail("换模型后签名不变 → 切了模型模型仍自报旧模型");
  const effortChanged = sessionScopeSignature({ ...scope, effort: "high" });
  effortChanged !== sig ? ok("签名随思考档位变化") : fail("换档位后签名不变 → 体检的档位项会读到旧值");

  // ④ 组合：基线原样在前（否则作用域块会把语言/工具/自动化说明顶掉），块在后
  const composed = composeScopeInstructions(base, block);
  composed.startsWith(base) ? ok("组合结果以全局基线开头（不顶掉 nuphus-call / 语言 / 自动化说明）") : fail("组合结果丢掉了基线——模型会不知道内置工具怎么用");
  composed.indexOf(SESSION_SCOPE_HEADING) > composed.indexOf(base) ? ok("作用域块拼在基线之后") : fail("作用域块位置不对");

  // ⑤ 幂等：反复下发不许叠加（每次改档位都发一次，叠加会长到失控）
  const twice = composeScopeInstructions(composed, sessionScopeBlock({ ...scope, effort: "high" }));
  const headings = twice.split(SESSION_SCOPE_HEADING).length - 1;
  headings === 1 ? ok("反复下发幂等（作用域块只有一份）") : fail(`反复下发后作用域块出现 ${headings} 份——历史块没被剥离`);
  twice.includes("思考档位：high") ? ok("幂等组合保留了最新档位") : fail("幂等组合把最新档位弄丢了");
  stripScopeBlock(composed) === base ? ok("strip 能还原出原始基线") : fail("strip 不能还原基线（幂等剥离有偏差）");

  // ⑥ 缺项防护：不能拼出 undefined / null（旧会话可能没有工作区等字段）
  const sparse = sessionScopeBlock({ threadId: "t", model: "glm-5.3-flash" });
  !/undefined|null/.test(sparse) ? ok("缺项回落为占位符，不拼出 undefined/null") : fail("缺项拼出了 undefined/null");
  composeScopeInstructions("", block) === block ? ok("无基线时只下发作用域块") : fail("无基线时组合结果异常");

  // 接线守卫：App.tsx 必须真的把作用域塞进会话级 instructions（否则纯函数再对也没生效）
  const scopeSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readAppUi() : "";
  if (!scopeSrc) {
    warn("找不到 src/App.tsx，跳过会话作用域接线守卫");
  } else {
    // ⛔ 09-22：同 model-scope —— 引用者现在是 parts/part06 与 parts/part08，
    //   相对路径为 `../../../../lib/session-scope.mjs`；不再锁死 `./lib/…` 这个深度。
    const imported = /from "[^"]*lib\/session-scope\.mjs"/.test(scopeSrc);
    // 下发点：collaborationMode 块里必须真的带上 developer_instructions（不能只 import 不用）
    // 下发点：collaborationMode 块里必须真的带上 developer_instructions（不能只 import 不用）。
    // 允许外面再包一层（09-19 起语气块用 composeMoodInstructions 包在作用域块外）——
    // 判据仍是「这条通道确实接上了」，不锁死拼接层数。
    const wired = /collaborationMode:\s*\{[\s\S]{0,400}?developer_instructions:\s*(?:composeMoodInstructions\(\s*)?composeScopeInstructions\(/.test(scopeSrc);
    // 覆盖三条路径：新建会话（thread/start 注入 + pushSessionScope）、打开旧会话、设置变更
    const covered = /pushSessionScope\(/.test(scopeSrc) && /buildSessionScope\(/.test(scopeSrc) && /thread\/settings\/update", \{ threadId: thread\.id, \.\.\.values/.test(scopeSrc);
    imported && wired && covered
      ? ok("会话作用域已接进 thread/settings/update 的 collaborationMode.settings.developer_instructions")
      : fail(`会话作用域未接上（import=${imported} wire=${wired} covered=${covered}）——模型仍会去读全局 config.toml 顶层自报模型`);

    // 反泄漏守卫（09-14 用户实测「模型还是串全局」的次因）：档案对账（setProviderModel apply:true
    // 会改写 custom-model.json / config.toml 顶层 model）**必须**先判「当前有没有打开的会话」，
    // 否则切会话模型会把全局档案写成该会话的模型 → 别的会话自查读全局就报成别人的模型。
    const archiveGuarded = /if \(threadRef\.current\?\.id\) return;[\s\S]{0,600}?setProviderModel\(\{ provider, model: match\[2\], apply: true/.test(scopeSrc);
    archiveGuarded
      ? ok("全局档案对账已加「无会话才写」守卫（切会话模型不再改写全局档案）")
      : fail("全局档案对账缺少会话守卫——切会话模型会把 custom-model.json / config.toml 顶层 model 改成该会话的模型");
  }
}
  }

  /* ══ 【4a-3】原 L673–L750 ══ */
  {
console.log(C.bold("\n【4a-3】会话运行时配置（模型/档位/权限收敛到一个对象）"));

{
  const rtSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readAppUi() : "";

  // ① 空态：字段恒在（不然后面的对账逻辑又要到处 ?? ""）
  const empty = emptyRuntime();
  const hasAllFields = ["model", "effort", "sandbox", "approval"].every((k) => k in empty) && empty.rev === 0;
  hasAllFields ? ok("空运行时四个字段恒在（rev 从 0 起）") : fail(`空运行时字段不全：${JSON.stringify(empty)}`);

  // ② 归一化：坏 JSON / 缺字段 / 类型不对都不能炸，也不能吐 undefined
  const messy = normalizeRuntime({ model: undefined, effort: 5, sandbox: null, approval: "never" });
  messy.model === "" && messy.effort === "5" && messy.sandbox === "" && messy.approval === "never"
    ? ok("归一化：缺项回落空串、非字符串转字符串，不吐 undefined/null")
    : fail(`归一化结果异常：${JSON.stringify(messy)}`);
  normalizeRuntime("not-an-object").model === "" ? ok("归一化：非对象输入回落到空运行时") : fail("归一化：非对象输入没有兜住");

  // ③ 迁移：旧三键族只在「新键没有值」时说话（这是旧键唯一还能生效的时刻）
  const fromLegacy = migrateRuntime({ model: "custom:custom906:glm-5.3-flash", effort: "ultra", permissions: { sandbox: "danger-full-access", approval: "never" } });
  fromLegacy.model === "custom:custom906:glm-5.3-flash" && fromLegacy.effort === "ultra" && fromLegacy.sandbox === "danger-full-access" && fromLegacy.approval === "never"
    ? ok("迁移：新键缺失时从旧三键族补齐（含权限对象）")
    : fail(`迁移没补齐旧值：${JSON.stringify(fromLegacy)}`);
  const stringPerms = migrateRuntime({ permissions: JSON.stringify({ sandbox: "read-only", approval: "on-request" }) });
  stringPerms.sandbox === "read-only" ? ok("迁移：permissions 为 JSON 字符串也能解析") : fail("迁移：permissions 字符串形态解析失败");

  // ④ 新键优先：新键有值时旧键**一律忽略**（否则又变成两处权威，回到分叉老路）
  const newWins = migrateRuntime({ runtime: { model: "custom:custom906:deepseek-v4-flash", effort: "high" }, model: "custom:custom906:glm-5.3-flash", effort: "ultra" });
  newWins.model === "custom:custom906:deepseek-v4-flash" && newWins.effort === "high"
    ? ok("迁移：新键有值时旧键一律忽略（旧键只是镜像，不具权威性）")
    : fail(`迁移让旧值盖掉了新值：${JSON.stringify(newWins)}`);

  // ⑤ 打补丁：只改传入的字段，其余原样保留（以前三键族分家最容易互相踩空）
  const patched = patchRuntime(fromLegacy, { effort: "low" });
  patched.changed && patched.runtime.effort === "low" && patched.runtime.model === fromLegacy.model && patched.runtime.sandbox === fromLegacy.sandbox
    ? ok("打补丁：只覆盖传入字段，其余原样保留")
    : fail(`打补丁污染了其它字段：${JSON.stringify(patched.runtime)}`);

  // ⑥ 空值不抹掉已有值（等价旧 helper 的「空值直接 return」——对账逻辑不许把选择清成空）
  const noop = patchRuntime(fromLegacy, { model: "", effort: undefined });
  noop.changed === false && noop.runtime.model === fromLegacy.model
    ? ok("打补丁：空串/undefined 不抹掉已有值（changed=false，不落盘）")
    : fail("打补丁把已有值清成了空——对账逻辑会误伤用户的选择");

  // ⑦ rev 递增：只有真变化才 +1（给后续多窗口并发保护留的钩子）
  patchRuntime(fromLegacy, { model: "custom:custom906:deepseek-v4-flash" }).runtime.rev === fromLegacy.rev + 1
    ? ok("rev 只在真变化时递增（多窗口互踩可据此判定）")
    : fail("rev 没有按变化递增");

  // ⑧ 签名：四项齐全才变，用于「要不要重新下发给引擎」的去重
  runtimeSignature(fromLegacy) !== runtimeSignature({ ...fromLegacy, approval: "on-request" })
    ? ok("签名覆盖 模型/档位/沙箱/审批 四项")
    : fail("签名漏掉了权限项——改权限后不会重新下发作用域");

  // ⑨ 镜像是派生值：只写不读（读取路径若再从旧键取值，等于把三处存放又救活了）
  const mirror = legacyMirror(fromLegacy);
  mirror.model === fromLegacy.model && JSON.parse(mirror.permissions).sandbox === fromLegacy.sandbox
    ? ok("旧键镜像是派生值（模型/权限与新键一致）")
    : fail(`旧键镜像与新键不一致：${JSON.stringify(mirror)}`);

  // ⑩ 接线守卫：App.tsx 里六个 helper 必须全部走单一对象，不许再有裸的旧键 setItem
  if (!rtSrc) {
    warn("找不到 src/App.tsx，跳过会话运行时接线守卫");
  } else {
    const legacyWrites = (rtSrc.match(/setItem\(\s*(?:"|`)(?:thread-model-|thread-effort-|thread-permissions-)/g) ?? []).length;
    // 镜像写的是 `LEGACY_PREFIX.model + id`（常量拼接），所以**字面量**前缀的写入应当归零
    legacyWrites === 0
      ? ok("旧三键族已无散落写入（镜像统一经 LEGACY_PREFIX 常量派生）")
      : fail(`旧三键族仍有 ${legacyWrites} 处字面量写入——应全部经 saveThreadRuntime 派生`);
    const helpersGoThroughRuntime = /function saveThreadModel\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc)
      && /function saveThreadEffort\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc)
      && /function saveThreadPermissions\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc);
    helpersGoThroughRuntime
      ? ok("模型/档位/权限三个 save helper 全部走 saveThreadRuntime 单一入口")
      : fail("还有 helper 在直接写旧键——三处存放没真正收敛");
    const readsGoThroughRuntime = /function loadThreadModel\(id: string\): string \{\s*return loadThreadRuntime\(id\)\.model;/.test(rtSrc);
    readsGoThroughRuntime ? ok("读取也统一走 loadThreadRuntime（旧键只在迁移时被读）") : fail("读取路径仍在直接读旧键");
  }
}
  }

  /* ══ 【4a-4】原 L754–L788 ══ */
  {
console.log(C.bold("\n【4a-4】多窗口并发保护（会话运行时配置由主进程权威落盘 + 跨窗口广播）"));

{
  const readMaybe = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const mainSrc = readMainSource();
  /* preload 是自包含单文件（09-23 深夜改内联：沙箱 preload 不许 require 相对模块） */
  const preloadSrc = readMaybe("electron/preload.ts");
  const storeSrc = readMaybe("electron/thread-runtime-store.ts");
  const appSrc2 = readAppUi();   // 09-21 改造期：统一口径

  if (!storeSrc || !mainSrc || !preloadSrc || !appSrc2) {
    warn("找不到主进程/渲染层源文件，跳过多窗口接线守卫");
  } else {
    storeSrc.includes("字段级合并") || /\.\.\.current,\s*\.\.\.fields/.test(storeSrc)
      ? ok("主进程 store 是字段级合并（不是整对象覆盖）——两个窗口改不同字段时不丢更新")
      : fail("主进程 store 疑似整对象覆盖：并发写不同字段会互相抹掉（04 断言会红）");
    /baseRev\s*!==\s*current\.rev/.test(storeSrc)
      ? ok("主进程按 baseRev 做冲突检测（等价 ZCode 的 revision）")
      : fail("主进程没有 baseRev 冲突检测——过期写入会静默覆盖别人的改动");
    /thread-runtime:patch/.test(mainSrc) && /thread-runtime:seed/.test(mainSrc) && /thread-runtime:get/.test(mainSrc)
      ? ok("三个 IPC 通道齐备（get / seed / patch）")
      : fail("IPC 通道不全（get/seed/patch 缺一）——渲染层对不上主进程");
    /broadcastHarnessEvent\(\{ type: "thread-runtime"/.test(mainSrc)
      ? ok("变更后广播到所有窗口（多窗口界面才能跟着变）")
      : fail("主进程改了却没广播——另一个窗口界面不会更新，下次写入会拿旧值覆盖回去");
    /patchThreadRuntime:\s*\(input/.test(preloadSrc) && /getThreadRuntime:/.test(preloadSrc)
      ? ok("preload 已透出 getThreadRuntime / patchThreadRuntime")
      : fail("preload 没透出会话运行时通道");
    /event\.type === "thread-runtime"/.test(appSrc2) && /admitThreadRuntime\(tid, \(event as any\)\.runtime, \{ fromRemote: true \}\)/.test(appSrc2)
      ? ok("渲染层订阅了 thread-runtime 广播并收敛到界面（admitThreadRuntime）")
      : fail("渲染层没订阅广播——跨窗口改动不会反映到界面");
    /void syncThreadRuntimeWithMain\(id\)/.test(appSrc2)
      ? ok("打开会话时与主进程对齐（无记录则播种、有记录以主进程为准）")
      : fail("openThread 没有与主进程对齐——本地镜像与权威值会各说各话");
  }
}
  }

  /* ══ 【4a-4b】原 L792–L857 ══ */
  {
console.log(C.bold("\n【4a-4b】会话运行时写入的「回声识别」（自己切模型不该提示别的窗口改了）"));

{
  const mine = { model: "custom:custom906:glm-5.3-flash", effort: "high", sandbox: "danger-full-access", approval: "never", rev: 3 };
  const store = new Map();
  const T0 = 1_000_000;
  rememberOwnWrite(store, "thread-1", mine, T0);

  // ① 同签名、TTL 内 = 自己的回声（主进程把自己的写入原样广播回来，且常早于 React 提交 state）
  isOwnEcho(store, "thread-1", { ...mine, rev: 4 }, T0 + 120)
    ? ok("自己刚写出去的运行时（同签名）在 TTL 内被判为回声 → 不提示「另一个窗口改了」")
    : fail("回声没被认出来——用户自己切模型会弹「另一个窗口更新了…」（09-14 实测误报）");

  // ② rev 不参与签名：主进程回填自己的 rev 后仍要认出回声（否则误报会复发）
  const sigIgnored = runtimeSignature({ ...mine, rev: 999 }) === runtimeSignature({ ...mine, rev: 0 });
  sigIgnored && isOwnEcho(store, "thread-1", { ...mine, rev: 999 }, T0 + 200)
    ? ok("签名忽略 rev（主进程的版本号不参与回声判定）")
    : fail("签名把 rev 算进去了——主进程回填 rev 后回声判不出来，误报会复发");

  // ③ 别的窗口改的是**别的值** → 不是回声（必须提示 + 同步界面）
  isOwnEcho(store, "thread-1", { ...mine, model: "custom:custom906:deepseek-v4-flash" }, T0 + 300)
    ? fail("不同取值也被当成自己的回声——别的窗口的改动会被静默吞掉（用户看不到同步提示）")
    : ok("别的窗口改成不同取值 → 不是回声（会提示并同步界面）");

  // ④ 别的会话的同值写入不能算本会话的回声（key 必须带 threadId）
  isOwnEcho(store, "thread-2", mine, T0 + 300)
    ? fail("回声表没按会话区分——A 会话的写入会把 B 会话的改动误判成回声")
    : ok("回声表按会话区分（threadId 参与 key）");

  // ⑤ TTL 过期后不再算回声（表不会长期污染判定）
  isOwnEcho(store, "thread-1", mine, T0 + OWN_WRITE_TTL_MS + 1)
    ? fail("TTL 失效后仍判为回声——表会长期把真事件吞掉")
    : ok(`超过 ${OWN_WRITE_TTL_MS}ms 的回声记录自动失效`);

  // ⑥ **只认最近一次写入**：一次用户动作可能连写多次（切模型先写档位、再写模型），
  //    中间态不能被当成「自己的回声」——否则另一个窗口恰好把值改回那个中间态时会被静默吞掉
  //    （实测：多窗口场景 ② 就是这么假红的）。
  const multi = new Map();
  const step1 = { ...mine, effort: "medium" };                       // 中间态（先写档位）
  const step2 = { ...step1, model: "custom:custom906:deepseek-v4-flash" }; // 再写模型
  rememberOwnWrite(multi, "thread-1", step1, T0);
  rememberOwnWrite(multi, "thread-1", step2, T0 + 10);
  isOwnEcho(multi, "thread-1", step2, T0 + 20)
    ? ok("最近一次写入仍被判为回声")
    : fail("最近一次写入没被判为回声——自己的回声会漏出去当提示");
  isOwnEcho(multi, "thread-1", step1, T0 + 30)
    ? fail("中间态仍被当成回声——另一个窗口把值改回中间态时会被静默吞掉（多窗口场景 ② 实测假红）")
    : ok("中间态不再算回声（只认最近一次写入）");

  // ⑦ 每会话只留一条记录（不随写入次数增长）
  const perThread = new Map();
  for (let i = 0; i < 50; i += 1) rememberOwnWrite(perThread, "thread-1", { ...mine, effort: `e${i}` }, T0 + i);
  perThread.size === 1
    ? ok("回声表每会话只留一条（不随写入次数增长）")
    : fail(`回声表按次增长：size=${perThread.size}`);

  // 接线守卫：渲染层必须真的用这两个纯函数，且广播分支要跳过提示
  const rtSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readAppUi() : "";
  if (!rtSrc) {
    warn("找不到 src/App.tsx，跳过回声接线守卫");
  } else {
    /rememberOwnWrite\(ownRuntimeWrites, id, runtime\)/.test(rtSrc) && /isOwnEcho\(ownRuntimeWrites, id, next\)/.test(rtSrc)
      ? ok("App.tsx 用纯函数做回声判定（写入时登记、广播时比对）")
      : fail("App.tsx 没有接回声判定——自己切模型仍会误报「另一个窗口改了」");
  }
}
  }

  /* ══ 【4a-5】原 L861–L906 ══ */
  {
console.log(C.bold("\n【4a-5】审批卡：一行摘要 + 点开预览（多条不占满输入框）"));

{
  const uiSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readAppUi() : "";
  const cssSrc = existsSync(join(ROOT, "src", "styles.css")) ? readStyles() : "";

  if (!uiSrc || !cssSrc) {
    warn("找不到 src/App.tsx 或 src/styles.css，跳过审批卡形态守卫");
  } else {
    // ① 形态：一行条（compact）+ 摘要按钮 + 可展开细节
    /className=\{`approval-card compact \$\{expanded \? "expanded" : ""\}`\}/.test(uiSrc)
      ? ok("审批卡用 compact 形态（收起态只占一行）")
      : fail("审批卡不是 compact 形态——会退回「每条一张大卡」（两条就占满输入框上方）");
    /className="approval-summary"/.test(uiSrc) && /setExpanded\(/.test(uiSrc)
      ? ok("摘要行可点开/收起（点一下预览正文）")
      : fail("摘要行不可展开——用户要的「可以预览审批内容」没实现");
    /\{expanded && \(/.test(uiSrc)
      ? ok("正文只在展开时渲染（DOM 里不常驻大块内容）")
      : fail("正文无条件渲染——收起态也会被撑成大卡（反证 F5 实测 heights 148/73/108）");
    // ② 要用户填东西的两类必须默认展开（收起了没法填）
    /useState\(\(\) => isUserInput \|\| isElicitation\)/.test(uiSrc)
      ? ok("问问题 / MCP elicitation 默认展开（不展开就没法填，属可用性）")
      : fail("需要输入的两类没有默认展开——收起了用户没法填");
    // ③ 多条统一收进限高容器
    /className="approval-stack" data-count=\{mine\.length\}/.test(uiSrc)
      ? ok("多条审批收进 .approval-stack（整体限高，条数再多也不推挤输入框）")
      : fail("审批卡没有统一容器——多条会一路往下堆");
    // ④ CSS：容器滚动 + 行高不压缩 + 摘要省略号
    const stackRule = cssSrc.match(/\.approval-stack\s*\{[^}]*\}/)?.[0] ?? "";
    /max-height:/.test(stackRule) && /overflow-y:\s*auto/.test(stackRule)
      ? ok("CSS：stack 限高 + overflow-y auto（多条出滚动条）")
      : fail("CSS：stack 没限高/没滚动——多条会把输入框顶出视口");
    // flex 列默认压缩子项（flex-shrink:1），行高会被压到 24px 且永不溢出 → 必须 flex: none
    /\.composer-wrap \.approval-stack \.approval-card\s*\{[^}]*flex:\s*none/.test(cssSrc)
      ? ok("CSS：行不参与压缩（flex:none，否则行高被压、滚动条永不出现）")
      : fail("CSS：缺少 flex:none——flex 列会把每行压扁且不产生滚动（实测 8 条时 scrollable=false）");
    /\.approval-card\.compact \.approval-peek\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSrc)
      ? ok("CSS：摘要行超长省略（长命令不把按钮挤出可视区）")
      : fail("CSS：摘要行没有省略号——长命令会撑破一行布局");
    // ⑨ 窄窗口自适应：`.composer-wrap` 是 .workspace 的 grid item，默认 min-width:auto
    // = 内容 min-content → 一行 nowrap 长命令会把整列撑到 1150px（实测），按钮被挤出可视区。
    /\.workspace\s*>\s*\.composer-wrap\s*\{[^}]*min-width:\s*0/.test(cssSrc)
      ? ok("CSS：输入区作为 grid item 已 min-width:0（窄窗口不被长命令撑宽）")
      : fail("CSS：缺少 `.workspace > .composer-wrap { min-width: 0 }`——窄窗口下审批行会被长命令撑到视口外，允许/拒绝看不见（反证 F6 实测 stackW=1150 / actionsRight=1153）");
  }
}
  }

  /* ══ 【4a-6】原 L910–L952 ══ */
  {
console.log(C.bold("\n【4a-6】弹窗/浮层窄窗口自适应（固定宽度必须有视口夹取）"));

{
  const cssSrc2 = existsSync(join(ROOT, "src", "styles.css")) ? readStyles() : "";
  if (!cssSrc2) {
    warn("找不到 src/styles.css，跳过弹窗自适应静态守卫");
  } else {
    // 弹窗/菜单/浮层的类名特征（与 e2e narrow-dialogs 场景覆盖的是同一批组件）
    const DIALOG = /modal|dialog|popup|palette|pop-|sheet|overlay|drawer|picker|dropdown|agent-ask|approval|goals-pop|thread-row-menu/;
    const blocks = [...cssSrc2.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const offenders = [];
    for (const m of blocks) {
      const sel = m[1].split("\n").pop().trim();
      if (!DIALOG.test(sel)) continue;
      const body = m[2];
      const fixedWidth = Number((body.match(/(?:^|[;{\s])width\s*:\s*(\d{3,4})px\s*;/) || [])[1] || 0);
      if (!fixedWidth || fixedWidth < 340) continue;
      // 同一 block 里必须有视口相对夹取（max-width: 92vw / min(...vw) / calc(100vw - x) / 100%）
      const clamped = /max-width\s*:[^;]*(vw|100%|calc\()/.test(body) || /width\s*:\s*min\(/.test(body);
      if (!clamped) offenders.push({ sel, fixedWidth });
    }
    offenders.length === 0
      ? ok(`固定宽度 ≥340px 的弹窗都有视口夹取（检查了 ${blocks.filter((m) => DIALOG.test(m[1].split("\n").pop().trim())).length} 个弹窗/浮层规则）`)
      : fail(`这些弹窗是固定宽度且没有视口夹取，窄窗口会被裁到视口外：${offenders.map((o) => `${o.sel}(${o.fixedWidth}px)`).join("、")}——改为 width: min(${offenders[0].fixedWidth}px, 100%) 或补 max-width: 92vw`);

    // 输入框浮层用「贴住输入区左右边」的定位，天然自适应；两条都丢才会撑出视口
    const paletteRule = cssSrc2.match(/\.command-palette,\s*\.context-picker\s*\{[^}]*\}/)?.[0] ?? "";
    /left:\s*0/.test(paletteRule) && /right:\s*0/.test(paletteRule)
      ? ok("输入框浮层（# / @ / 命令面板）用 left:0 + right:0 贴住输入区（天然自适应）")
      : fail("输入框浮层不再贴左右边——窄窗口下会溢出视口（改回了固定宽度？）");
    // ⛔ 选择器要带词边界：`\.info-modal` 会先匹配到 `.info-modal-mask`，把掩罩的规则当成弹窗本体
    // （实测这条写松了会假红——掩罩本来就不该有宽度约束）。
    const ruleOf = (name) => cssSrc2.match(new RegExp(`\\.${name}(?![\\w-])[^{]*\\{[^}]*\\}`))?.[0] ?? "";
    const applyModals = ["connector-setup-modal", "expert-team-editor-modal", "subagent-editor-modal", "command-editor-modal", "memory-config-modal", "info-modal"];
    const missingClamp = applyModals.filter((name) => {
      const rule = ruleOf(name);
      return !rule || !/min\(|max-width|100vw|width:\s*100%/.test(rule);
    });
    missingClamp.length === 0
      ? ok("编辑器类弹窗（连接器 / 专家团队 / 子代理 / 命令 / 记忆 / 信息）都有视口或百分比约束")
      : fail(`编辑器弹窗缺少宽度约束：${missingClamp.join("、")}`);
  }
}
  }

  /* ══ 【4b】原 L956–L1108 ══ */
  {
console.log(C.bold("\n【4b】语音通话纯逻辑（回声消除 / 回声门控 / 断句）"));

{
  // 重采样：采样率相同时必须原样返回（不做无谓的插值，避免引入失真）
  const src = new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
  const same = resampleLinear(src, 16000, 16000);
  same === src ? ok("重采样：同采样率原样返回（不重复插值）") : fail("重采样：同采样率不应复制/变换");
  const half = resampleLinear(new Float32Array(1600), 16000, 8000);
  half.length === 800 ? ok("重采样：16k → 8k 长度减半") : fail(`重采样：期望 800，实际 ${half.length}`);

  // 能量：静音必须是 0，满幅正弦约 0.707
  rmsOf(new Float32Array(1024)) === 0 ? ok("能量：静音 = 0") : fail("能量：静音应为 0");
  const sine = new Float32Array(1600);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
  const sineRms = rmsOf(sine);
  Math.abs(sineRms - 0.7071) < 0.02 ? ok(`能量：满幅正弦 ≈ 0.707（实际 ${sineRms.toFixed(3)}）`) : fail(`能量：满幅正弦期望 ≈0.707，实际 ${sineRms.toFixed(3)}`);

  // --- 回声消除：合成一条线性回声路径，验证真的压下去了 ---
  // 用宽带噪声：正弦下「任意延迟都等价于同频不同相」，滤波器怎么都能减干净，测不出对齐问题
  const N = 12000;
  const ECHO_DELAY = 40;
  const noiseAt = (len, seed) => {
    const out = new Float32Array(len);
    let state = seed >>> 0;
    for (let i = 0; i < len; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = ((state / 0xffffffff) * 2 - 1) * 0.3;
    }
    return out;
  };
  const far = noiseAt(N, 999);
  const mic = new Float32Array(N);
  for (let i = 0; i < N; i++) mic[i] = i - ECHO_DELAY >= 0 ? far[i - ECHO_DELAY] * 0.5 : 0;

  const aec = createAec({ filterLength: 128, delay: 32, step: 0.2 });
  const out = new Float32Array(N);
  const CHUNK = 256;
  for (let off = 0; off < N; off += CHUNK) {
    out.set(aec.process(mic.subarray(off, off + CHUNK), far.subarray(off, off + CHUNK)), off);
  }
  const tailStart = N - 4000;
  const erle = 20 * Math.log10(rmsOf(mic.subarray(tailStart)) / Math.max(rmsOf(out.subarray(tailStart)), 1e-12));
  erle > 12
    ? ok(`回声消除：纯回声段抑制 ${erle.toFixed(1)} dB（>12dB 判定有效）`)
    : fail(`回声消除：抑制只有 ${erle.toFixed(1)} dB，滤波器没收敛`);

  // 前置条件断言：确认这段输入里**确实有回声**，否则上面那条断言等于没测
  rmsOf(mic) > 0.05 ? ok("回声消除：用例输入确有回声（前置条件成立）") : fail("回声消除：用例输入没有回声，断言无意义");

  // 双讲冻结：冻结时只减不学，滤波器不会跟着跑
  const frozenAec = createAec({ filterLength: 128, delay: 32, step: 0.2 });
  frozenAec.setFrozen(true);
  const frozenOut = new Float32Array(N);
  for (let off = 0; off < N; off += CHUNK) {
    frozenOut.set(frozenAec.process(mic.subarray(off, off + CHUNK), far.subarray(off, off + CHUNK)), off);
  }
  const frozenErle = 20 * Math.log10(rmsOf(mic.subarray(tailStart)) / Math.max(rmsOf(frozenOut.subarray(tailStart)), 1e-12));
  frozenErle < 3
    ? ok("回声消除：全程冻结时滤波器不收敛（证明冻结真的生效）")
    : fail(`回声消除：冻结后仍收敛了 ${frozenErle.toFixed(1)} dB，冻结没生效`);

  // --- 回声门控：起播静音不压零；单块尖峰不算；持续人声才算；双讲期间地板冻住 ---
  // 回归用例（09-12 用户实测「我没说话，播报也会自动断」）：旧实现把**第一块**直接当回声
  // 地板，而播报刚起步那几十毫秒是静音 → 地板≈0 → 之后任何回声都超阈 → 播报被自己打断。
  const quietGate = createEchoGate({ echoGateDb: 6 });
  let quietFalse = false;
  for (let i = 0; i < 30; i++) {
    quietGate.update(0.0002, true); // 播报起步的静音段
    if (quietGate.doubleTalk) quietFalse = true;
  }
  for (let i = 0; i < 30; i++) {
    quietGate.update(0.006, true); // 之后的稳态回声：比起步静音大 30 倍，仍属回声量级
    if (quietGate.doubleTalk) quietFalse = true;
  }
  quietFalse === false
    ? ok("门控：起播静音不再把地板压到 0（回归：播报不会被自己打断）")
    : fail("门控：起播静音后误判插话 —— 播报会被自动打断（旧 bug 回归）");

  // 起播学习期：前若干块只学地板，即使突然变响也不判插话（避开起音瞬态）
  const seeded = createEchoGate({ echoGateDb: 6 });
  let earlyFire = false;
  for (let i = 0; i < 8; i++) {
    seeded.update(0.01, true);
    if (seeded.doubleTalk) earlyFire = true;
  }
  earlyFire === false ? ok("门控：起播学习期内不判插话（起音瞬态不误触发）") : fail("门控：起播学习期就判了插话");

  const gate = createEchoGate({ echoGateDb: 6 });
  for (let i = 0; i < 8; i++) gate.update(0.01, true); // 学习期
  gate.update(0.01, true);
  gate.doubleTalk === false ? ok("门控：稳态回声不误判为插话") : fail("门控：稳态回声被误判为插话");
  gate.update(0.5, true);
  gate.doubleTalk === false ? ok("门控：单块能量尖峰不判插话（去抖生效）") : fail("门控：单块尖峰就判插话（去抖失效）");
  let fired = false;
  for (let i = 0; i < 6; i++) {
    gate.update(0.5, true);
    if (gate.doubleTalk) fired = true;
  }
  fired ? ok("门控：持续人声（连续多块超阈）→ 判定插话") : fail("门控：持续人声没被识别");
  // 连喊 80 次：无冻结时地板会爬升、越喊越难打断；有冻结时地板纹丝不动，80 帧全部判插话。
  const floorBefore = gate.floor;
  let stayed = true;
  for (let i = 0; i < 80; i++) {
    gate.update(0.5, true);
    if (!gate.doubleTalk) stayed = false;
  }
  stayed
    ? ok("门控：双讲期间地板冻结（连喊 80 次仍判插话，不会越喊越难打断）")
    : fail("门控：地板被插话带高，越说越难打断（冻结失效）");
  Math.abs(gate.floor - floorBefore) < 1e-9
    ? ok(`门控：双讲期间地板数值不变（保持 ${floorBefore.toFixed(4)}）`)
    : fail(`门控：地板在双讲期间被抬高了（${floorBefore.toFixed(4)} → ${gate.floor.toFixed(4)}）`);
  gate.update(0.5, false);
  gate.doubleTalk === false && gate.floor === 0
    ? ok("门控：播报停止后复位（下次播报重新学习地板）")
    : fail("门控：播报停止后未复位");

  // 首句阈值：模型开头常常几十字没有句号，首句必须比后续句子更早出声（跟手感）
  const firstFast = createSentenceChunker({ maxChars: 60 });
  const firstOut = firstFast.push("这是一句没有任何标点符号而且很长的话用来验证首句是不是会提前切出来");
  firstOut.length === 1 && firstOut[0].length <= 10
    ? ok(`断句：首句提前切出（${firstOut[0].length} 字，阈值 10，不等满 60 字）`)
    : fail(`断句：首句没有提前切出（${JSON.stringify(firstOut).slice(0, 60)}）`);
  // 反证口径：09-13 审计 ④ 把首句阈值从 18 压到 10，这里必须跟着压，
  // 否则「阈值被改回 18」这种回归照不出来（10 也算 ≤18）
  const firstOld = createSentenceChunker({ maxChars: 60, firstMaxChars: 18 });
  const oldOut = firstOld.push("这是一句没有任何标点符号而且很长的话用来验证首句是不是会提前切出来");
  oldOut[0].length > firstOut[0].length
    ? ok(`断句：首句阈值确实变小了（18 字 → ${firstOut[0].length} 字，首块合成更快出声）`)
    : fail("断句：首句阈值没有随审计 ④ 调小（firstMaxChars 还是 18）");
  const later = firstFast.push("第二句同样没有标点但是首句已经出过声了所以应该按 60 字阈值继续攒着" + "补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字");
  later.length === 0 || later[0].length > 18
    ? ok("断句：首句之后回到常规阈值（不会一直碎句）")
    : fail("断句：首句之后仍在碎切（阈值没回到 maxChars）");

  // --- 断句：句读即切、超长在软断点切、结尾 flush ---
  const hard = createSentenceChunker({ maxChars: 10 });
  const got1 = hard.push("你好。");
  got1.length === 1 && got1[0] === "你好。" ? ok("断句：遇到句号立即成句") : fail(`断句：句号未切，实际 ${JSON.stringify(got1)}`);
  hard.push("abc").length === 0 ? ok("断句：未到句读且不超长 → 继续攒") : fail("断句：短句被提前切了");

  const hardCut = createSentenceChunker({ maxChars: 10 });
  const got2 = hardCut.push("abcdefghijklmn");
  got2.length === 1 && got2[0] === "abcdefghij"
    ? ok("断句：无标点超长 → 按上限硬切（避免长回答憋着不出声）")
    : fail(`断句：硬切结果不对，实际 ${JSON.stringify(got2)}`);
  const tail2 = hardCut.flush();
  tail2.length === 1 && tail2[0] === "klmn" ? ok("断句：flush 吐出残留") : fail(`断句：flush 结果不对，实际 ${JSON.stringify(tail2)}`);

  const soft = createSentenceChunker({ maxChars: 10 });
  const got3 = soft.push("abc,defghijkl");
  got3.length === 1 && got3[0] === "abc," ? ok("断句：超长时优先在逗号处切") : fail(`断句：软断点结果不对，实际 ${JSON.stringify(got3)}`);
}
  }

  /* ══ 【4c】原 L1112–L1269 ══ */
  {
console.log(C.bold("\n【4c】语音链路（打断世代号 / 朗读视图 / 听写预热 / 延迟 / AEC 对齐 / 来源标记）"));

{
  // ===== ② 朗读视图：给人看的 markdown → 给耳朵听的口语 =====
  const codeFilter = createSpeakFilter();
  const s1 = codeFilter.push("先看这段代码：");
  const s2 = codeFilter.push("```ts");
  const s3 = codeFilter.push("const answer = 42;");
  const s4 = codeFilter.push("```");
  s1.length > 0 && s2 === "" && s3 === ""
    ? ok("朗读视图：代码块整段不念（围栏内逐行丢弃）")
    : fail(`朗读视图：代码块没被丢弃（${JSON.stringify([s2, s3]).slice(0, 80)}）`);
  /代码块/.test(s4)
    ? ok("朗读视图：代码块用一句占位提示代替（用户知道「有代码，看屏幕」）")
    : fail(`朗读视图：代码块收尾没有占位提示（实际 ${JSON.stringify(s4)}）`);

  const tableFilter = createSpeakFilter();
  const t1 = tableFilter.push("| 指标 | 值 |");
  const t2 = tableFilter.push("| --- | --- |");
  const t3 = tableFilter.push("| gap | 54 |");
  /表格/.test(t1) && t2 === "" && t3 === ""
    ? ok("朗读视图：表格整段不念（只留一句占位）")
    : fail(`朗读视图：表格没被丢弃（${JSON.stringify([t1, t2, t3]).slice(0, 80)}）`);

  const inline = toSpeakableText("见 https://example.com/a/b 的 **锚点** 🎉 与 `code`，文件 C:\\Users\\me\\a.ts");
  !/http|\*\*|🎉|`/.test(inline) && /锚点/.test(inline) && /路径/.test(inline) && /code/.test(inline)
    ? ok(`朗读视图：URL/加粗/emoji/路径/反引号都清掉了（"${inline.slice(0, 40)}…"）`)
    : fail(`朗读视图：行内清洗不完整（实际 "${inline}"）`);

  numberToChinese(10) === "十" && numberToChinese(105) === "一百零五" && numberToChinese(20005) === "二万零五" && numberToChinese(1000000) === "一百万"
    ? ok("朗读视图：中文读数正确（十 / 一百零五 / 二万零五 / 一百万）")
    : fail(`朗读视图：中文读数不对（${[10, 105, 20005, 1000000].map(numberToChinese).join(" / ")}）`);

  const spokenNum = normalizeNumbers("2026-09-13 12:30 覆盖率 98%，耗时 3.5 秒，共 1,234 条");
  /二零二六年九月十三日/.test(spokenNum) && /十二点三十分/.test(spokenNum) && /百分之九十八/.test(spokenNum) && /三点五/.test(spokenNum) && /一千二百三十四/.test(spokenNum)
    ? ok("朗读视图：日期/时间/百分数/小数/千分位都中文化了")
    : fail(`朗读视图：数字中文化不完整（实际 "${spokenNum}"）`);

  // 前置条件式反证：标识符**必须**原样保留，否则会把 GPT-4 念成「GPT 四」、1.2.3 念成「一点二点三」
  normalizeNumbers("GPT-4 与 v2 接口、H264、版本 1.2.3") === "GPT-4 与 v2 接口、H264、版本 1.2.3"
    ? ok("朗读视图：紧贴字母/版本号的数字不动（GPT-4 / v2 / H264 / 1.2.3）")
    : fail(`朗读视图：把标识符里的数字也改了（实际 "${normalizeNumbers("GPT-4 与 v2 接口、H264、版本 1.2.3")}"）`);

  toSpeakableText("---") === "" && toSpeakableText("🎉") === "" && toSpeakableText("```") === ""
    ? ok("朗读视图：清完为空 → 调用方可直接跳过合成（不会合成空音频）")
    : fail(`朗读视图：纯记号文本没有被清空（${JSON.stringify([toSpeakableText("---"), toSpeakableText("🎉"), toSpeakableText("```")])}）`);

  // ===== ⑤ AEC 延迟线：真实设备量级的回声延迟（旧用例 delay=32/回声 40 样本，恰好落在可覆盖区间，测不出失配） =====
  // ⚠️ 必须用**宽带信号**（噪声）而不是正弦：单频正弦的任意延迟都等价于「同频不同相」，
  //    256 抽头的滤波器照样能把它减干净（实测正弦下错配也会「压 150dB」）→ 测不出对齐。
  //    噪声不可预测，只有抽头窗口真的覆盖到那个延迟才减得掉。
  const noiseOf = (len, seed = 12345) => {
    const out = new Float32Array(len);
    let state = seed >>> 0;
    for (let i = 0; i < len; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = ((state / 0xffffffff) * 2 - 1) * 0.3;
    }
    return out;
  };
  const M = 24000;
  const ECHO_OFFSET = 600; // 37.5ms @16k：外放/蓝牙量级，**大于** 256 抽头 → 延迟线不校正就压不掉
  const far = noiseOf(M);
  const micEcho = new Float32Array(M);
  for (let i = 0; i < M; i++) micEcho[i] = i - ECHO_OFFSET >= 0 ? far[i - ECHO_OFFSET] * 0.5 : 0;
  const runAec = (aec) => {
    const buf = new Float32Array(M);
    for (let off = 0; off < M; off += 256) {
      buf.set(aec.process(micEcho.subarray(off, off + 256), far.subarray(off, off + 256)), off);
    }
    return buf;
  };
  const tailAt = M - 8000;
  const erleOf = (buf) => 20 * Math.log10(rmsOf(micEcho.subarray(tailAt)) / Math.max(rmsOf(buf.subarray(tailAt)), 1e-12));

  const alignedAec = createAec({ filterLength: 256, delay: 0, maxDelay: 1024, step: 0.2 });
  alignedAec.setDelay(ECHO_OFFSET);
  const erleAligned = erleOf(runAec(alignedAec));
  const blindAec = createAec({ filterLength: 256, delay: 0, maxDelay: 1024, step: 0.2 });
  const erleBlind = erleOf(runAec(blindAec));

  alignedAec.delay === ECHO_OFFSET ? ok(`AEC：setDelay 生效（延迟线 = ${ECHO_OFFSET} 样本）`) : fail(`AEC：setDelay 没生效（delay=${alignedAec.delay}）`);
  erleAligned > 12
    ? ok(`AEC：校正延迟线后 600 样本回声被压 ${erleAligned.toFixed(1)} dB`)
    : fail(`AEC：校正延迟线后仍只压了 ${erleAligned.toFixed(1)} dB —— 延迟线没起作用`);
  erleBlind < 6
    ? ok(`AEC：不校正延迟线时压不掉（${erleBlind.toFixed(1)} dB）—— 证明上面那条断言真的在测「对齐」`)
    : fail(`AEC：不校正也能压 ${erleBlind.toFixed(1)} dB —— 这条断言测不出对齐问题（用例不成立）`);
  alignedAec.setDelay(999999);
  alignedAec.delay === 1024 ? ok("AEC：setDelay 越界被夹到 maxDelay（不会写坏延迟线）") : fail(`AEC：setDelay 越界没夹住（${alignedAec.delay}）`);

  // ===== 静态接线守卫（主进程/引擎侧 CDP 测不到，按 AGENTS.md 铁律 5 钉在这里） =====
  const readSrc = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc = readVoiceCallFloatSrc();
  const serviceSrc = readSrc("electron/voice/voice-service.ts");
  const settingsSrc = readSrc("electron/voice/voice-settings.ts");
  const workersSrc = readSrc("electron/voice/workers.ts");
  const preloadSrcV = readSrc("electron/preload.ts");

  if (!floatSrc || !serviceSrc || !settingsSrc || !workersSrc) {
    warn("找不到语音源码，跳过语音接线守卫");
  } else {
    // ① 打断：引擎把「被打断的回合」标出来，渲染层据此丢弃半句
    const statusChecked = /turn\/completed[\s\S]{0,600}?turn\?\.status/.test(serviceSrc) && /aborted/.test(serviceSrc);
    const abortedHandled = /event\.type === "turnDone"[\s\S]{0,300}?event\.aborted[\s\S]{0,120}?bumpSpeechEpoch/.test(floatSrc);
    const epochOnFinal = /event\.type === "final"[\s\S]{0,300}?bumpSpeechEpoch\(\)/.test(floatSrc);
    const epochGuard = /epoch !== speechEpochRef\.current/.test(floatSrc) && /if \(epoch !== speechEpochRef\.current\) return/.test(floatSrc);
    statusChecked && abortedHandled && epochOnFinal && epochGuard
      ? ok("① 打断：世代号 + turn.status=interrupted 双保险（在途合成与断句器半句都会被丢弃）")
      : fail(`① 打断链路不完整（status=${statusChecked} aborted=${abortedHandled} final=${epochOnFinal} epochGuard=${epochGuard}）`);

    // ③ 听写：先开麦再加载识别线程 + 补静音不再写死 3 秒 + 线程保活
    const captureIdx = floatSrc.indexOf("await startCapture();");
    const voiceStartIdx = floatSrc.indexOf("await window.codex.voiceStart(");
    captureIdx > 0 && voiceStartIdx > captureIdx
      ? ok("③ 听写：startCall 里先开麦（startCapture）再加载识别线程（voiceStart）")
      : fail(`③ 听写：开麦与加载顺序没换过来（capture=${captureIdx} voiceStart=${voiceStartIdx}）—— 开头 1~3 秒又会丢字`);
    const prebufferWired = /PREBUFFER_MAX_SAMPLES/.test(floatSrc) && /prebufferRef\.current = \[\]/.test(floatSrc) && /for \(const block of pending\) window\.codex\.voiceAudio\(block\)/.test(floatSrc) && /liveRef\.current = true/.test(floatSrc);
    prebufferWired
      ? ok("③ 听写：加载期间的音频暂存并在就绪后按序回灌（回灌后才切实时链路，顺序不乱）")
      : fail("③ 听写：暂存/回灌链路没接全（prebufferRef / liveRef / 回灌循环）");
    const silenceParam = /finishSilenceSec/.test(workersSrc) && !/sampleRate \* 3/.test(workersSrc);
    const keepAlive = /WORKER_KEEPALIVE_MS/.test(serviceSrc) && /parkIdle\("asr"/.test(serviceSrc) && /takeIdle\("asr"/.test(serviceSrc);
    silenceParam && keepAlive
      ? ok("③ 听写：松手补静音改为 rule2+0.3（不再 3 秒）+ 挂断后线程保活复用")
      : fail(`③ 听写：松手/保活优化缺失（silence=${silenceParam} keepAlive=${keepAlive}）`);

    // ④ 延迟：默认端点阈值 + 老档案迁移 + 提前端点
    const rule2Default = /asr: \{ rule1: 2\.4, rule2: 0\.8/.test(settingsSrc);
    const migrated = /VOICE_SETTINGS_VERSION/.test(settingsSrc) && /migrateSettings\(raw\)/.test(settingsSrc) && /1\.2/.test(settingsSrc);
    const endpointWired = /voice:endpoint-now/.test(mainSrc) && /voiceEndpointNow/.test(preloadSrcV) && /voiceEndpointNow\(\)/.test(floatSrc);
    rule2Default && migrated && endpointWired
      ? ok("④ 延迟：rule2 默认 0.8 + 老档案迁移（只改还是旧默认 1.2 的档案）+ 提前端点接线")
      : fail(`④ 延迟链路不完整（rule2=${rule2Default} migrate=${migrated} endpoint=${endpointWired}）`);

    // ⑤ AEC：参考环容量、延迟线校正、与浏览器 AEC 不叠加、麦克风设置读取顺序
    const ringOk = /REF_RING_SECONDS = 30/.test(floatSrc) && /CAPTURE_RATE \* REF_RING_SECONDS/.test(floatSrc);
    const delayWired = /maxDelay: AEC_MAX_DELAY_SAMPLES/.test(floatSrc) && /\.setDelay\?\.\(/.test(floatSrc) && /outputLatency/.test(floatSrc);
    const noDoubleAec = /browserAec/.test(floatSrc) && /useSelfAec/.test(floatSrc) && /aecRef\.current = useSelfAec/.test(floatSrc);
    const micReadIdx = floatSrc.indexOf("micSettingsRef.current = mic;");
    const gumIdx = floatSrc.indexOf("navigator.mediaDevices.getUserMedia(");
    micReadIdx > 0 && gumIdx > micReadIdx
      ? ok("⑤ AEC：麦克风/回声消除设置先读后用（第一次通话就生效）")
      : fail(`⑤ AEC：设置读取仍在 getUserMedia 之后（sett=${micReadIdx} gum=${gumIdx}）`);
    ringOk && delayWired && noDoubleAec
      ? ok("⑤ AEC：参考环 30s + 按播放领先量写入 + outputLatency 校正延迟线 + 浏览器 AEC 开启时不叠加 NLMS")
      : fail(`⑤ AEC 接线不完整（ring=${ringOk} delay=${delayWired} noDouble=${noDoubleAec}）`);

    // ⑥ 来源标记：引擎要能区分「语音消息」与「打字消息」
    const prefixDefined = /export const VOICE_MESSAGE_PREFIX = "\[语音\] "/.test(serviceSrc);
    const prefixUsed = /const input = \[\{ type: "text", text: `\$\{VOICE_MESSAGE_PREFIX\}\$\{text\}`/.test(serviceSrc);
    const bothPaths = (serviceSrc.match(/^\s+input,$/gm) ?? []).length >= 2;
    const trigger = /turnTrigger: VOICE_TURN_TRIGGER/.test(serviceSrc);
    prefixDefined && prefixUsed && bothPaths && trigger
      ? ok("⑥ 来源标记：语音消息带 [语音] 前缀（turn/start 与排队两条路径都带）+ turnTrigger=voice")
      : fail(`⑥ 来源标记不完整（def=${prefixDefined} use=${prefixUsed} both=${bothPaths} trigger=${trigger}）`);
  }
}
  }

  /* ══ 【4d】原 L1273–L1395 ══ */
  {
console.log(C.bold("\n【4d】语音唤醒（同音容错匹配 / 端点复位 / 配置即时生效）"));

{
  // 纯逻辑跑的是**编译产物**（electron/voice/wake-match.ts → dist-electron/voice/wake-match.js）：
  // 主进程代码 CDP 测不到，但它是纯函数，直接把真正会上线的那份 require 进来断言。
  let wakeMatch = null;
  try {
    wakeMatch = await import("../../dist-electron/voice/wake-match.js");
  } catch (error) {
    fail(`语音唤醒纯逻辑产物读不到（先 npm run build）：${error?.message ?? error}`);
  }

  if (wakeMatch) {
    const { buildHomophoneMap, createWakeMatcher, normalizeWakeText, phraseVocabHint } = wakeMatch;

    // lexicon 样本照抄真实 lexicon.txt 的写法（注音 + 声调符号）：柯/科 同音，哥 不同声母
    const LEXICON = [
      "柯 ㄎ ㄜ ˉ",
      "科 ㄎ ㄜ ˉ",
      "可 ㄎ ㄜ ˇ",
      "客 ㄎ ㄜ ˋ",
      "哥 ㄍ ㄜ ˉ",
      "小 ㄒ ㄧ ㄠ ˇ",
      "消 ㄒ ㄧ ㄠ ˉ",
      "多字词 ㄉ ㄨ ㄛ ˉ ㄗ ㄘ ˊ", // 多字条目必须被忽略（读音是拼接的）
    ].join("\n");
    const homo = buildHomophoneMap(LEXICON);
    homo.get("柯")?.has("科") && homo.get("柯")?.has("可")
      ? ok(`唤醒：同音表按读音归类（柯 ≈ ${[...(homo.get("柯") ?? [])].join("")}）`)
      : fail("唤醒：同音表没把 柯/科/可 归为一类（lexicon 解析错了）");
    homo.get("柯")?.has("哥") === false
      ? ok("唤醒：不同声母不算同音（柯 ㄎㄜ ≠ 哥 ㄍㄜ）")
      : fail("唤醒：把 哥 也当成 柯 的同音字 —— 会把「小哥」这种日常词误唤醒");

    const matcher = createWakeMatcher({ phrase: "小柯小柯", homophones: homo });
    // 正例：探针实测到的真实识别结果（合成音频 → 唤醒配置识别）
    const positives = [
      ["小柯小柯", "完全正确（探针实测出现过）"],
      ["小科小科", "同音常用字（说小科小科时模型常写成小柯小柯）"],
      ["消客小客", "探针实测「说小可小可」的输出：同音不同调"],
      ["嗯，小科小科，帮我看下", "前后有别的字（滑窗）"],
    ];
    for (const [text, note] of positives) {
      matcher.match(text) ? ok(`唤醒：match("${text}") = true（${note}）`) : fail(`唤醒：漏唤醒 —— match("${text}") 应为 true（${note}）`);
    }
    // 负例：不能为了「能唤醒」把门槛放到把日常话也当唤醒
    const negatives = [
      ["小哥小哥", "声母听错：故意不匹配（否则「小哥」天天误唤醒）"],
      ["哎呀这个项目真不错", "无关内容"],
      ["小", "只说了一半"],
      ["", "空文本"],
    ];
    for (const [text, note] of negatives) {
      matcher.match(text) === false ? ok(`唤醒：match("${text}") = false（${note}）`) : fail(`唤醒：误唤醒 —— match("${text}") 应为 false（${note}）`);
    }
    // 前置条件：同音容错确实在起作用（去掉同音表后「小科小科」必须匹配不上）
    const exactOnly = createWakeMatcher({ phrase: "小柯小柯", homophones: null });
    exactOnly.match("小科小科") === false && exactOnly.match("小柯小柯") === true
      ? ok("唤醒：同音容错真的在起作用（无同音表时只认精确匹配）")
      : fail("唤醒：同音表接没接上分不出来 —— 这条断言没意义");
    createWakeMatcher({ phrase: "  " }).ready === false
      ? ok("唤醒：空唤醒词永不命中（不会把每句话都当唤醒）")
      : fail("唤醒：空唤醒词也能命中 —— 会疯狂误唤醒");
    normalizeWakeText(" 小 柯，小柯。 ") === "小柯小柯"
      ? ok("唤醒：归一化去掉空白与标点")
      : fail(`唤醒：归一化不对（${normalizeWakeText(" 小 柯，小柯。 ")}）`);
    // 词表可达性提示：柯 不在 tokens 里（真实模型 2002 项词表就是这种情况）→ 必须提示
    phraseVocabHint("小柯小柯", "小 1\n哥 2\n科 3") .includes("柯")
      ? ok("唤醒：唤醒词含词表外字时给出提示（这正是默认词「小柯小柯」时好时坏的原因）")
      : fail("唤醒：没有提示词表外字，用户无从知道该换词");
    phraseVocabHint("小科小科", "小 1\n科 2") === ""
      ? ok("唤醒：唤醒词全在词表内时不打扰用户")
      : fail("唤醒：词表内也报警，提示会被无视");
  }

  // ===== 接线守卫（唤醒是常驻监听，主进程侧 CDP 测不到）=====
  const readSrc2 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc2 = readVoiceCallFloatSrc();
  const serviceSrc2 = readSrc2("electron/voice/voice-service.ts");
  const settingsUiSrc = readVoiceSettingsSrc();

  if (!floatSrc2 || !serviceSrc2 || !settingsUiSrc) {
    warn("找不到语音源码，跳过唤醒接线守卫");
  } else {
    // ① 开关/唤醒词改了必须立刻重挂（旧实现依赖数组只有 [phase] → 打开开关毫无反应）
    const depsOk = /\}, \[phase, wakeCfg\.enabled, wakeCfg\.phrase\]\);/.test(floatSrc2);
    const broadcast = /type: "settings", settings: next/.test(mainSrc);
    const listensSettings = /event\?\.type === "settings"/.test(floatSrc2);
    depsOk && broadcast && listensSettings
      ? ok("唤醒：设置变更即时生效（主进程广播 settings + effect 依赖含开关与唤醒词）")
      : fail(`唤醒：改了设置不重挂（deps=${depsOk} 广播=${broadcast} 监听=${listensSettings}）`);

    // ② 命中后不得用 effect 里捕获的 startCall（threadId 会过期）
    const refForwarded = /startCallRef\.current\(\)/.test(floatSrc2) && /const startCallRef = useRef/.test(floatSrc2);
    const noStaleCall = !/event\.type === "wake"[\s\S]{0,400}?\bstartCall\(\)/.test(floatSrc2);
    refForwarded && noStaleCall
      ? ok("唤醒：命中后经 startCallRef 取最新闭包（不会用到过期的 threadId）")
      : fail(`唤醒：命中路径仍可能用过期闭包（ref=${refForwarded} 无裸调用=${noStaleCall}）`);

    // ③ 匹配与复位在主进程：渲染层不再拿文本、不再自己 includes
    const mainMatches = /wakeMatcher\?\.match\(text\)/.test(serviceSrc2);
    const endpointReset = /if \(endpoint\)[\s\S]{0,300}?request\("reset"/.test(serviceSrc2);
    const preloaded = /await this\.wakeAsr\.request\("create"\)/.test(serviceSrc2);
    const noRenderMatch = !/norm\.includes\(wake\.phrase\)/.test(floatSrc2) && !/includes\(wakeCfg\.phrase\)/.test(floatSrc2);
    mainMatches && endpointReset && preloaded && noRenderMatch
      ? ok("唤醒：匹配在主进程 + 每次端点复位识别流 + 启动即预热模型（不再每块回传整坨文本）")
      : fail(`唤醒：主进程侧不完整（match=${mainMatches} reset=${endpointReset} 预热=${preloaded} 渲染层无匹配=${noRenderMatch}）`);

    // ④ 背压：忙时攒块、空了合并发送（旧实现每块无条件 invoke → 越积越慢）
    const backpressure = /let busy = false;/.test(floatSrc2) && /pending\.push\(raw\)/.test(floatSrc2) && /const pump = \(\) => \{/.test(floatSrc2) && /MAX_PENDING/.test(floatSrc2);
    backpressure
      ? ok("唤醒：识别忙时攒块合并发送（有背压上限，不会无限积压）")
      : fail("唤醒：没有背压 —— 识别跟不上时会越积越慢");

    // ⑤ 失败必须可见 + 「最近听到什么」必须显示得出来
    //    判据要落在**启动失败那条分支**上（catch 块里也有一处 patchWakeState，只匹配调用会让守卫放水）
    const failureVisible = /if \(!started\?\.ok\) \{[\s\S]{0,240}?patchWakeState\(\{ listening: false, error:/.test(floatSrc2);
    const statusShown = /wakeState\.heard/.test(settingsUiSrc) && /subscribeWakeState/.test(settingsUiSrc);
    failureVisible && statusShown
      ? ok("唤醒：启动失败会提示 + 设置页显示「最近听到什么」（诊断可见）")
      : fail(`唤醒：失败静默或诊断不可见（失败提示=${failureVisible} 状态显示=${statusShown}）`);
  }
}
  }

  /* ══ 【4e】原 L1399–L1524 ══ */
  {
console.log(C.bold("\n【4e】语音唤醒关键词模型（KWS，读音匹配；关键词生成器对照模型自带样例验证）"));

{
  let kwsMod = null;
  try {
    kwsMod = await import("../../dist-electron/voice/kws-keywords.js");
  } catch (error) {
    fail(`关键词生成器产物读不到（先 npm run build）：${error?.message ?? error}`);
  }

  if (kwsMod) {
    const { buildKeywordLines, parseLexiconReadings, zhuyinToSyllable } = kwsMod;

    // 对照验证：模型自带 keywords_raw.txt（中文）↔ keywords.txt（拼音 token）8 对，
    // 生成器必须原样复现 —— 这是判断注音→拼音表对不对**唯一**可信的判据。
    const GROUND_TRUTH = [
      ["你好军哥", "n ǐ h ǎo j ūn g ē @你好军哥"],
      ["蛋哥蛋哥", "d àn g ē d àn g ē @蛋哥蛋哥"],
      ["小爱同学", "x iǎo ài t óng x ué @小爱同学"],
      ["你好问问", "n ǐ h ǎo w èn w èn @你好问问"],
      ["小艺小艺", "x iǎo y ì x iǎo y ì @小艺小艺"],
      ["小米小米", "x iǎo m ǐ x iǎo m ǐ @小米小米"],
      ["林美丽", "l ín m ěi l ì @林美丽"],
      ["你好西西", "n ǐ h ǎo x ī x ī @你好西西"],
    ];
    // 模型自带的注音（与音色模型 lexicon.txt 同一套写法）：手写这批读音，避免依赖本机模型文件
    const LEXICON = [
      "你 ㄋ ㄧ ˇ", "好 ㄏ ㄠ ˇ", "军 ㄐ ㄩ ㄣ ˉ", "哥 ㄍ ㄜ ˉ",
      "蛋 ㄉ ㄢ ˋ", "小 ㄒ ㄧ ㄠ ˇ", "爱 ㄞ ˋ", "同 ㄊ ㄨ ㄥ ˊ", "学 ㄒ ㄩ ㄝ ˊ",
      "问 ㄨ ㄣ ˋ", "艺 ㄧ ˋ", "米 ㄇ ㄧ ˇ", "林 ㄌ ㄧ ㄣ ˊ", "美 ㄇ ㄟ ˇ", "丽 ㄌ ㄧ ˋ",
      "西 ㄒ ㄧ ˉ", "柯 ㄎ ㄜ ˉ", "助 ㄓ ㄨ ˋ", "手 ㄕ ㄡ ˇ",
    ].join("\n");
    const readings = parseLexiconReadings(LEXICON);
    readings.size >= 15
      ? ok(`关键词：注音词典解析出 ${readings.size} 个字`)
      : fail(`关键词：注音词典解析数量异常（${readings.size}）`);

    let matched = 0;
    for (const [phrase, expected] of GROUND_TRUTH) {
      const built = buildKeywordLines({ phrase, readings });
      const got = built.lines[0]?.line ?? "(空)";
      if (got === expected) matched += 1;
      else fail(`关键词：与模型自带样例不一致 —— ${phrase}\n      期望 ${expected}\n      实际 ${got}`);
    }
    matched === GROUND_TRUTH.length
      ? ok(`关键词：${matched}/${GROUND_TRUTH.length} 行与模型自带 keywords.txt 完全一致（注音→拼音→声母/韵母拆分全对）`)
      : fail(`关键词：只有 ${matched}/${GROUND_TRUTH.length} 行与模型样例一致`);

    const target = buildKeywordLines({ phrase: "小柯小柯", readings });
    target.lines[0]?.line === "x iǎo k ē x iǎo k ē @小柯小柯"
      ? ok("关键词：默认唤醒词「小柯小柯」→ `x iǎo k ē x iǎo k ē @小柯小柯`（探针实测该行命中 3/4、零误触发）")
      : fail(`关键词：默认唤醒词生成错误（${target.lines[0]?.line}）`);

    // 前置条件/反证口径：j/q/x 后的 ü 必须写成 u（军 jūn / 学 xué）——写错就是 token 表里不存在的韵母
    const jun = zhuyinToSyllable(["ㄐ", "ㄩ", "ㄣ", "ˉ"]);
    const xue = zhuyinToSyllable(["ㄒ", "ㄩ", "ㄝ", "ˊ"]);
    jun?.final === "ūn" && xue?.final === "ué"
      ? ok("关键词：j/q/x 后的 ü 写成 u（军 ūn / 学 ué，与模型样例一致）")
      : fail(`关键词：ü 的拼写规则不对（军=${jun?.final} 学=${xue?.final}）`);
    // 舌尖元音：ㄓ/ㄔ/ㄕ/ㄖ/ㄗ/ㄘ/ㄙ 单独成音节时写作 zhi/chi/shi/ri/zi/ci/si（声调在韵母上：世 → sh ì）
    const shi = zhuyinToSyllable(["ㄕ", "ˋ"]);
    const zhi = zhuyinToSyllable(["ㄓ", "ˉ"]);
    shi?.initial === "sh" && shi?.final === "ì" && zhi?.initial === "zh" && zhi?.final === "ī"
      ? ok("关键词：舌尖元音音节（ㄕ ˋ → sh ì）能正确转换（lexicon 里这类字很多）")
      : fail(`关键词：舌尖元音音节转换失败（世=${shi?.initial}/${shi?.final} 之=${zhi?.initial}/${zhi?.final}）`);

    // 无法转换时**必须报出来**，不能生成一条永远唤不醒的关键词
    const unknown = buildKeywordLines({ phrase: "小柯𠀀", readings });
    unknown.unknownChars.length > 0 || unknown.lines.some((l) => l.missing.length > 0)
      ? ok("关键词：查不到读音/不在 token 表时如实上报（不会静默生成无效关键词）")
      : fail("关键词：无效字被静默吞掉 —— 用户会遇到「唤不醒且无提示」");
    const empty = buildKeywordLines({ phrase: "   ", readings });
    empty.lines.length === 0 ? ok("关键词：空唤醒词不生成任何行") : fail("关键词：空唤醒词生成了行");
  }

  // ===== KWS 接线守卫 =====
  const readSrc3 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const serviceSrc3 = readSrc3("electron/voice/voice-service.ts");
  const workersSrc3 = readSrc3("electron/voice/workers.ts");
  const settingsUiSrc3 = readVoiceSettingsSrc();
  const manifestSrc = readSrc3("electron/voice/model-manifest.ts");
  const storeSrc = readSrc3("electron/voice/model-store.ts");

  if (!serviceSrc3 || !workersSrc3 || !settingsUiSrc3) {
    warn("找不到语音源码，跳过 KWS 接线守卫");
  } else {
    // ① 首选关键词模型、失败再回退识别模型（顺序反了就等于白装）
    const kwsFirst = serviceSrc3.indexOf("if (kwsReady(this.deps.modelsRoot))") > 0
      && serviceSrc3.indexOf("if (kwsReady(this.deps.modelsRoot))") < serviceSrc3.indexOf("startWakeAsrFallback(");
    kwsFirst
      ? ok("KWS：唤醒优先用关键词模型，装不上/转不出关键词才回退识别模型")
      : fail("KWS：引擎选择顺序不对（回退分支排在关键词模型之前）");

    // ② 关键词落盘在 userData（模型目录只读语义），且命中即 reset（否则同句反复命中）
    const kwFile = /voice-kws/.test(serviceSrc3) && /keywords\.txt/.test(serviceSrc3);
    const kwsWorkerReset = /keyword/.test(workersSrc3) && /if \(keyword\) spotter\.reset\(stream\)/.test(workersSrc3);
    kwFile && kwsWorkerReset
      ? ok("KWS：keywords.txt 写在 userData + worker 命中后立即 reset 识别流")
      : fail(`KWS：关键词落盘或 reset 缺失（file=${kwFile} reset=${kwsWorkerReset}）`);

    // ③ 关键词行必须来自生成器（不许手拼拼音），且要按 token 表过滤
    const usesBuilder = /buildKeywordLines\(/.test(serviceSrc3) && /parseLexiconReadings\(/.test(serviceSrc3);
    const filtersMissing = /filter\(\(line\) => line\.missing\.length === 0\)/.test(serviceSrc3);
    usesBuilder && filtersMissing
      ? ok("KWS：关键词行由生成器产出并按模型 token 表过滤（无效行不会写进 keywords.txt）")
      : fail(`KWS：关键词生成没走生成器或没过滤（builder=${usesBuilder} filter=${filtersMissing}）`);

    // ④ 换唤醒词必须重挂（keywordsFile 是 worker 启动参数，改词不重建 = 还在等旧词）
    const rearm = /stopWakeListener\(\)\.then\(\(\) => this\.startWakeListener\(\)\)/.test(serviceSrc3);
    rearm ? ok("KWS：改唤醒词后重建 worker（keywordsFile 是启动参数，不重建就还在等旧词）") : fail("KWS：改唤醒词没有重挂 worker");

    // ⑤ 安装链路 + UI 入口（模型 31MB，按需下载；不装也能用回退）
    const installChain = /voice:kws-install/.test(mainSrc) && /voiceKwsInstall/.test(preloadSrc) && /ensureKws\(/.test(storeSrc);
    const uiEntry = /installKws\(\)/.test(settingsUiSrc3) && /voiceKwsInstall\(\)/.test(settingsUiSrc3);
    const archive = /KWS_ARCHIVE/.test(manifestSrc) && /kwsReady/.test(manifestSrc) && /b2f7c89690dc8ce4c6ed6afeab7cd800c36ad1421fb6b6302b4a4b194cf7f35f/.test(manifestSrc);
    installChain && uiEntry && archive
      ? ok("KWS：安装链路（归档 SHA256 + ensureKws + IPC + 设置页一键下载）齐全")
      : fail(`KWS：安装链路不完整（chain=${installChain} ui=${uiEntry} archive=${archive}）`);

    // ⑥ 关键词模型不能进「主模型齐备」判定：它只服务唤醒，缺了不该把整个语音功能挡住
    const notInAll = !/ALL_VOICE_REPOS[^\n]*KWS/.test(manifestSrc) && /KWS_REPO/.test(manifestSrc) === false;
    notInAll
      ? ok("KWS：关键词模型不参与「主模型是否齐备」判定（不装也能用通话/听写）")
      : fail("KWS：关键词模型被算进了主模型齐备判定 —— 没装唤醒模型的用户会看到「语音模型未下载完整」");
  }
}
  }

  /* ══ 【4f】原 L1528–L1617 ══ */
  {
console.log(C.bold("\n【4f】麦克风错误翻译（唤醒/通话共用）+ 模型下载（可取消 / 会换源提速）"));

{
  // ===== 纯逻辑：错误翻译（用户实测界面直接显示过英文原文 Requested device not found）=====
  let describeMicError = null;
  try {
    ({ describeMicError } = await import("../../src/lib/mic-error.mjs"));
  } catch (error) {
    fail(`麦克风错误翻译模块读不到：${error?.message ?? error}`);
  }
  if (describeMicError) {
    const notFound = describeMicError(Object.assign(new Error("Requested device not found"), { name: "NotFoundError" }));
    /未找到可用的麦克风设备/.test(notFound) && /(1)/.test(notFound) && !/^Requested device not found$/.test(notFound)
      ? ok("麦克风错误：NotFoundError → 中文说明 + 三步排查（不再把英文原文丢给用户）")
      : fail(`麦克风错误：NotFoundError 没翻译（${notFound}）`);
    /权限/.test(describeMicError(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })))
      ? ok("麦克风错误：NotAllowedError → 权限提示")
      : fail("麦克风错误：NotAllowedError 没翻译");
    /独占/.test(describeMicError(Object.assign(new Error("Could not start audio source"), { name: "NotReadableError" })))
      ? ok("麦克风错误：NotReadableError → 「被别的程序独占」提示")
      : fail("麦克风错误：NotReadableError 没翻译");
    /OverconstrainedError/.test(describeMicError(Object.assign(new Error("bad constraints"), { name: "OverconstrainedError" })))
      ? ok("麦克风错误：OverconstrainedError → 参数/设备提示")
      : fail("麦克风错误：OverconstrainedError 没翻译");
    // 兜底：未知错误也必须带前缀（便于在日志里认出来），且不能是空串
    const unknown = describeMicError(new Error("weird failure"));
    /^打开麦克风失败：/.test(unknown) && unknown.length > 8
      ? ok("麦克风错误：未知错误有兜底前缀（不会显示空白提示）")
      : fail(`麦克风错误：未知错误兜底不对（${unknown}）`);
  }

  const readSrc4 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc4 = readVoiceCallFloatSrc();
  const storeSrc4 = readSrc4("electron/voice/model-store.ts");
  const settingsUiSrc4 = readVoiceSettingsSrc();

  if (!floatSrc4 || !storeSrc4 || !settingsUiSrc4) {
    warn("找不到源码，跳过【4f】接线守卫");
  } else {
    // ① 两条采集链路共用同一份翻译（旧实现只有通话侧有，唤醒侧直接漏英文）
    const usesTranslator = (floatSrc4.match(/describeMicError\(/g) ?? []).length >= 2;
    const noRawLeak = !/patchWakeState\(\{ listening: false, error: String\(error\?\.message/.test(floatSrc4);
    usesTranslator && noRawLeak
      ? ok("唤醒：麦克风错误与通话共用一份翻译（唤醒侧不再漏原生英文）")
      : fail(`唤醒：错误翻译没共用或仍有裸英文（translator=${usesTranslator} raw=${!noRawLeak}）`);

    // ② 唤醒要重试 + 用设置里的设备（旧实现硬编码 constraints，用户换的麦不生效）
    const retries = /for \(let attempt = 0; attempt < 3/.test(floatSrc4);
    const usesSettingsMic = /micCfg\.deviceId/.test(floatSrc4) && /wakeConstraint/.test(floatSrc4);
    retries && usesSettingsMic
      ? ok("唤醒：麦克风失败重试 3 次 + 使用设置里选的设备/开关")
      : fail(`唤醒：缺重试或用的是硬编码设备（retry=${retries} settingsMic=${usesSettingsMic}）`);

    // ③ 下载可取消：UI 有按钮 + 取消**保留**断点（旧实现取消也把残file 删了 → 下次从头来）
    const cancelUi = /取消下载/.test(settingsUiSrc4) && /voiceKwsCancel\(\)/.test(settingsUiSrc4);
    const cancelKeepsPartial = /cancelled: true/.test(storeSrc4) && !/error\?\.fatal \|\| signal\?\.aborted/.test(storeSrc4);
    cancelUi && cancelKeepsPartial
      ? ok("下载：设置页有「取消下载」，且取消保留已下载部分（下次点下载续传）")
      : fail(`下载：取消不完整（ui=${cancelUi} keepPartial=${cancelKeepsPartial}）`);

    // ④ 提速：候选地址并发探测排序 + 连接超时 + 速度下限换源 + 进度显示速度
    //    判据要落在**调用点**上：只查函数定义的话，把调用删掉守卫照样绿（反证时踩到过）
    const ordered = /await orderCandidatesByLatency\(candidates, signal\)/.test(storeSrc4)
      && /async function orderCandidatesByLatency\(/.test(storeSrc4);
    const connTimeout = /headersTimeoutMs/.test(storeSrc4) && /AbortController/.test(storeSrc4);
    const speedFloor = /minSpeedBytesPerSec/.test(storeSrc4) && /alternativesLeft/.test(storeSrc4);
    const speedShown = /MB\/s/.test(storeSrc4);
    ordered && connTimeout && speedFloor && speedShown
      ? ok("下载：候选地址按实测首字节排序 + 连接超时 + 太慢自动换源 + 进度带 MB/s")
      : fail(`下载：提速项缺失（order=${ordered} timeout=${connTimeout} speedFloor=${speedFloor} shown=${speedShown}）`);
  }
}

// 接线守卫：语音悬浮入口必须真的挂到 App 上（防「组件写了但没接」）
{
  const appPath = join(ROOT, "src", "App.tsx");
  if (!existsSync(appPath)) {
    warn("找不到 src/App.tsx，跳过语音接线守卫");
  } else {
    const appSrc = readAppUi();   // 09-21 改造期：统一口径
    /* ⛔ 路径层数无关：09-22 后 JSX 搬到 src/features/app-view/AppView.tsx（深两层），
       同一句 import 变成 "../../components/VoiceCallFloat"。判据语义不变：
       必须真的 import 了它，且真的挂了（带 threadId）。 */
    const imported = /import\s+VoiceCallFloat\s+from\s+["'][^"']*\/components\/VoiceCallFloat["']/.test(appSrc);
    const mounted = /<VoiceCallFloat\s+threadId=/.test(appSrc);
    imported && mounted
      ? ok("语音悬浮入口已挂载到 App（且带 threadId）")
      : fail(`语音悬浮入口未接线（import=${imported} mounted=${mounted}）`);
  }
}
  }

  /* ══ 【4g】原 L1623–L1725 ══ */
  {
console.log(C.bold("\n【4g】Bot Channel 配对门卫（授权码 + 电脑端审批，跑编译产物真实现）"));
{
  const botPairPath = join(ROOT, "dist-electron", "bot-pairing.js");
  let BotPairingService = null;
  try { BotPairingService = (await import("file://" + botPairPath.replace(/\\/g, "/"))).BotPairingService; }
  catch { fail(`bot-pairing 编译产物读不到（先 npm run build）`); }
  if (BotPairingService) {
    const notifications = [];
    const gate = new BotPairingService(() => "135790", (req) => notifications.push(req), () => undefined);
    // ① 未批准聊天 + 普通消息 → 只收到配对引导（消息不会到达引擎）
    const guide = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "帮我看看这个报错");
    guide.action === "guide" && /配对码/.test(guide.message)
      ? ok("未批准聊天：普通消息只收到配对引导（不执行）")
      : fail(`未批准聊天没有引导或直接放行（${JSON.stringify(guide).slice(0, 80)}）`);
    // ② 配对码错误 → 仍引导（且不产生审批请求）
    gate.onChannelMessage("qq", "chat-1", "QQ 测试", "000000");
    notifications.length === 0
      ? ok("配对码错误不会进入审批队列")
      : fail("错码也触发了审批请求 —— 输码校验失效");
    // ③ 授权码正确 → 挂起等电脑端审批（此刻消息仍不放行）
    const wait = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "135790");
    wait.action === "wait" && Boolean(wait.rid)
      ? ok("授权码正确 → 挂起等电脑端审批（给出 rid）")
      : fail(`授权码正确却没挂起（${JSON.stringify(wait).slice(0, 80)}）`);
    const stillGuide = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "还没批准呢再发一条");
    stillGuide.action === "guide"
      ? ok("审批通过前该聊天仍被拦截")
      : fail("审批还没通过消息就放行了 —— 门卫失效");
    // ④ 电脑端批准 → 同聊天放行
    gate.approve(wait.rid) ? null : fail("approve(rid) 返回失败 —— 审批流转断了");
    const allowed = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "再发一条正常消息");
    allowed.action === "allow" ? ok("电脑端批准后同聊天放行") : fail("批准后仍被拦截 —— 批准没写进已批准表");
    // ⑤ 冷却：连续错 5 次触发锁定（挡暴力试码）
    const gate2 = new BotPairingService(() => "246810", () => undefined, () => undefined);
    let locked = null;
    for (let i = 0; i < 6; i++) locked = gate2.onChannelMessage("wx", "chat-2", "微信", "111111");
    locked.action === "guide" && /锁定/.test(locked.message)
      ? ok("连续错 5 次触发冷却锁定（挡暴力试码）")
      : fail(`错码没有冷却锁定（最后一次 ${JSON.stringify(locked).slice(0, 80)}）`);
    // ⑥ 反证：门卫形同虚设的情形 = 所有消息都 allow —— 这里用"已批准表"对照证明 ① 的拦截真的由批准状态驱动
    gate.revoke("qq", "chat-1");
    const afterRevoke = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "撤销后再发一条");
    afterRevoke.action === "guide" ? ok("撤销已批准聊天后重新回到拦截（revoke 生效）") : fail("撤销后仍放行 —— revoke 没删批准表");
  }
}


// ---------- 【4h】内置音色与试听反馈（09-13：换开源预设 + 试听提速可停止） ----------
{
  // 预设清单：旧的两个预设已下线；新预设必须「wav + 精确参考文本」成对且文件随包存在
  //（ZipVoice 铁律：文本对不上音质明显劣化，所以每个预设都必须有官方成对转写）。
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, "resources", "voice-presets", "presets.json"), "utf8"));
    const list = Array.isArray(raw) ? raw : [];
    const ids = list.map((p) => p.id);
    list.length >= 2 ? ok(`随包内置音色预设 ${list.length} 个（开源项目官方成对样本）`) : fail("内置音色预设少于 2 个 —— presets.json 可能被清空");
    !ids.includes("taiwan-female") && !ids.includes("jarvis-butler")
      ? ok("已下线预设（台湾腔小美/贾维斯风）不再随包提供")
      : fail("下线预设又回来了 —— taiwan-female / jarvis-butler 必须移除");
    const missingPair = list.filter((p) => !p.wav || !p.refText || !existsSync(join(ROOT, "resources", "voice-presets", String(p.wav))));
    missingPair.length === 0
      ? ok("全部预设「wav + 参考文本」成对且音频文件存在")
      : fail(`预设缺 wav/参考文本或音频文件缺失：${missingPair.map((p) => p.id).join(", ")}`);
  } catch (error) {
    fail(`voice-presets/presets.json 不可读：${error.message}`);
  }

  // 试听提速：previewVoice 必须复用缓存的 worker（旧实现 finally 里 terminate = 每次冷启动）
  const voiceSrc = readFileSync(join(ROOT, "electron", "voice", "voice-service.ts"), "utf8");
  const previewStart = voiceSrc.indexOf("async previewVoice(");
  const previewEnd = voiceSrc.indexOf("schedulePreviewDispose(): void", previewStart);
  const previewBody = previewStart >= 0 && previewEnd > previewStart ? voiceSrc.slice(previewStart, previewEnd) : "";
  previewBody.includes("this.previewTts") && previewBody.includes("this.previewTtsKey")
    ? ok("音色试听复用缓存的预览 worker（模型常驻，第二次试听秒出）")
    : fail("previewVoice 又改成每次新建 worker —— 试听会退回「半天才出声」");
  !/finally\s*\{[^}]*terminate/.test(previewBody)
    ? ok("试听结束不再立刻销毁 worker（空闲 5 分钟才回收）")
    : fail("previewVoice 在 finally 里 terminate —— 缓存被每次清掉");

  // 试听反馈：设置页必须有「合成中 → 播放中（可停止）」三态
  const settingsSrc = readVoiceSettingsSrc();
  settingsSrc.includes("playCtlRef") && settingsSrc.includes('"playing"')
    ? ok("试听有播放态反馈且播放中可停止")
    : fail("试听反馈缺失 —— 只有合成中、没有播放态/停止按钮");

  // 09-13 徽章键映射：主进程 channels:status 的微信键是 weixin，机器人档案存的是 wechat
  // —— 不映射的话扫码成功后状态永远「未连接」（映射丢失 = 回归）
  const appSrc = readAppUi();
  appSrc.includes("CHANNEL_STATUS_KEY") && appSrc.includes('wechat: "weixin"')
    ? ok("渠道状态键已映射（wechat→weixin，连接后徽章即时变「已连接」）")
    : fail("徽章键映射丢失（CHANNEL_STATUS_KEY）—— 扫码成功后状态又会卡在「未连接」");
  appSrc.includes("bot-pair-banner") || appSrc.includes("botPairState")
    ? ok("机器人管理面板内嵌配对卡（码 + 待审批）")
    : fail("机器人面板的配对码横条丢失 —— 用户又要回「手机远控」看码");

  // 机器人档案持久化 + 已连接渠道自动恢复卡片（09-13 用户实丢档案 + 「已连接机器人没显示」）
  appSrc.includes("botsGet") && appSrc.includes("botsSet") && !/localStorage\.setItem\(.bots./.test(appSrc)
    ? ok("机器人档案持久化到主进程（userData/bots.json，不再只存 localStorage）")
    : fail("机器人档案又退回 localStorage 直写 —— 清缓存/换实例会整单丢失");
  appSrc.includes("channelsStatus?.() ?? Promise.resolve({})")
    ? ok("档案为空时从渠道登录态自动恢复机器人卡片（已连接的不会隐身）")
    : fail("已连接渠道的卡片自动恢复缺失 —— 登录态在、卡片丢了就隐身");
}

  /* ══ 【156】侧栏「按来源分类」视图（09-25 用户要求）══════════════════════
     会话按来源归类：主代理 / 专家团主理人 / 团队成员子任务 / 专家调度 / 子智能体调度 / 专家团调度。
     口径收在纯模块 src/lib/thread-source.mjs ⇒ 这里**真跑**它断言分类判定与分组
     （⛔ 只查字面量的断言抓不到分类逻辑跑偏 —— 分类错了 UI 照样渲染）。 */
  {
    console.log(C.bold("\n【156】侧栏「按来源分类」视图"));
    const appSrc2 = readAppUi();
    (appSrc2.includes('viewTab === "source"') ? ok : fail)("【156】侧栏有「分类」视图分支（第三个 view tab）");
    (appSrc2.includes("groupThreadsBySource") ? ok : fail)("【156】分类视图走纯模块 groupThreadsBySource（口径单一真相源）");
    try {
      const mod = await import("file://" + join(ROOT, "src", "lib", "thread-source.mjs").replace(/\\/g, "/"));
      const cases = [
        [{ isTeamMember: true, teamId: "t1", delegateKind: "member" }, "member"],
        [{ delegateKind: "expert" }, "expert"],
        [{ delegateKind: "subagent" }, "subagent"],
        [{ delegateKind: "team" }, "team"],
        [{ teamId: "t1" }, "lead"],
        [{}, "main"],
      ];
      const bad = [];
      for (const [input, expect] of cases) {
        const got = mod.classifyThreadSource(input);
        if (got !== expect) bad.push(JSON.stringify(input) + "=" + got + "(期望" + expect + ")");
      }
      (bad.length === 0 ? ok : fail)("【156】分类判定 6 例全对" + (bad.length ? "（" + bad.join("；") + "）" : ""));
      (mod.classifyThreadSource({ isTeamMember: true, delegateKind: "team" }) === "member" ? ok : fail)("【156】成员身份优先于调度记录（members 映射权威，不靠标题猜）");
      const groups = mod.groupThreadsBySource(
        [{ id: "a", updatedAt: 1 }, { id: "b", updatedAt: 2 }, { id: "c", updatedAt: 3 }],
        { delegateRecords: { b: { kind: "expert" } }, teamThreadIndex: { c: "t1" }, teamMemberThreadIds: new Set(), pinnedThreadIds: [] }
      );
      const keys = groups.map((g) => g.key).join(",");
      (keys === "source:main,source:lead,source:expert" ? ok : fail)("【156】分组顺序与键名正确（实得 " + keys + "）");
      (groups.every((g) => g.label && g.items.length) ? ok : fail)("【156】每组都有标签与成员（空类不出现）");
      /* 调度归属（09-25 用户：「谁调度的，那个就要生成分类在调度的会话下面」）—— 真跑四条边界 */
      const kids = mod.buildDispatchChildren(
        [{ id: "p" }, { id: "c1" }, { id: "orphan" }, { id: "deep" }, { id: "skip" }, { id: "mutualA" }, { id: "mutualB" }],
        {
          c1: { originThreadId: "p", kind: "expert", name: "知微" },
          orphan: { originThreadId: "gone", kind: "expert" },
          deep: { originThreadId: "c1", kind: "subagent" },   // 父自己也被调度 ⇒ 不收编（单层）
          skip: { originThreadId: "p", kind: "member" },
          mutualA: { originThreadId: "mutualB" },
          mutualB: { originThreadId: "mutualA" },
        },
        { skipIds: new Set(["skip"]) }
      );
      (kids.childrenOf["p"]?.length === 1 && kids.childrenOf["p"][0].threadId === "c1" ? ok : fail)("【156】父在列表 ⇒ 收编到父行下（" + JSON.stringify(kids.childrenOf["p"] ?? []) + "）");
      (!kids.childIds.has("orphan") ? ok : fail)("【156】父不在列表 ⇒ 不收编（回退来源分组，会话不消失）");
      (!kids.childIds.has("deep") ? ok : fail)("【156】父自身也被调度 ⇒ 不收编（只做单层，避免看不出层级）");
      (!kids.childIds.has("skip") ? ok : fail)("【156】skipIds（团队成员会话）不收编（交给既有团队聚类，避免重复渲染）");
      (!kids.childIds.has("mutualA") && !kids.childIds.has("mutualB") ? ok : fail)("【156】互为父子的环 ⇒ 都不收编");
      const groupedAfter = mod.groupThreadsBySource(
        [{ id: "p", updatedAt: 2 }, { id: "c1", updatedAt: 1 }],
        { delegateRecords: { c1: { originThreadId: "p", kind: "expert" } } }
      );
      (groupedAfter.every((g) => !g.items.some((t) => t.id === "c1")) ? ok : fail)("【156】被收编的会话不再出现在来源分组（避免同一会话两处显示）");

      /* ── 「分组」（按时间）视图已按用户要求删除（09-25：「分组可以删了」）──
         ⛔ 负向断言：不许有人把第三个 tab / groups 分支加回来。 */
      (!appSrc2.includes('setViewTab("groups")') && !appSrc2.includes("按时间分组") ? ok : fail)("【156】⛔ 侧栏「分组」（按时间）视图已删除，不得加回");
      const bagTypesSrc2 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "bag-types.ts"), "utf8");
      (!/viewTab: "groups"/.test(bagTypesSrc2) ? ok : fail)("【156】viewTab 类型只有 projects|source（旧偏好值在 part03 回落到 projects）");

      /* ── 被调度会话跟随主对话的项目地址（09-25 用户要求：「不要新开项目地址」）──
         真跑 resolveGroupCwd 五条边界（⛔ 只查字面量抓不到口径跑偏）。 */
      const cwdMap = mod.resolveGroupCwd(
        [
          { id: "lead", cwd: "D:\\proj" },
          { id: "child", cwd: "D:\\proj\\sub" },
          { id: "grand", cwd: "D:\\other" },
          { id: "orphan", cwd: "D:\\solo" },
          { id: "member", cwd: "D:\\tmp\\wt" },
          { id: "cycA", cwd: "D:\\a" },
          { id: "cycB", cwd: "D:\\b" },
        ],
        {
          delegateRecords: {
            child: { originThreadId: "lead" },
            grand: { originThreadId: "child" },        // 链式：跟随祖父
            orphan: { originThreadId: "gone" },        // 父不在列表
            cycA: { originThreadId: "cycB" },
            cycB: { originThreadId: "cycA" },
          },
          teamThreadIndex: { lead: "t1", member: "t1" },
          teamMemberThreadIds: new Set(["member"]),
        }
      );
      (cwdMap.child === "D:\\proj" ? ok : fail)("【156】被调度会话跟随发起调度的会话 cwd（实得 " + cwdMap.child + "）");
      (cwdMap.grand === "D:\\proj" ? ok : fail)("【156】链式调度一路跟随到最顶层主对话 cwd（实得 " + cwdMap.grand + "）");
      (cwdMap.orphan === "D:\\solo" ? ok : fail)("【156】父不在列表 ⇒ 回退自己的 cwd（⛔ 不许把会话弄丢）");
      (cwdMap.member === "D:\\proj" ? ok : fail)("【156】团队成员会话跟随本团主理人 cwd（实得 " + cwdMap.member + "）");
      (cwdMap.cycA && cwdMap.cycB ? ok : fail)("【156】互为父子的环 ⇒ 不死循环，各自返回自己的 cwd");
      (appSrc2.includes("resolveGroupCwd") && appSrc2.includes("dispatchCwdMap") ? ok : fail)("【156】项目分组用有效 cwd（part03 接线 resolveGroupCwd / dispatchCwdMap）");
      /* ⛔ 断言写法注意：readAppUi() 会归一化（剥掉 `bag.` 前缀），别按源码字面量写正则。 */
      (/cwdMap\[entry\.id\][\s\S]{0,200}?该项目下已无对话/.test(appSrc2) ? ok : fail)("【156】删除整个项目按**有效 cwd** 取目标（否则跟随过来的被调度会话删不掉 / 误删他项目会话）");
    } catch (error) {
      fail("【156】thread-source.mjs 加载失败：" + error.message);
    }
  }
  }
}
