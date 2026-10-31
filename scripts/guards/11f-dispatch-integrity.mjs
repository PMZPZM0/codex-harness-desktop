// 一次性判据：调度 catalog 的**两端一致性**。
// ⛔ 起因：用户面板里专家/专家团/子智能体三项都是 0，但主进程实测有 12 个团 + 2 个子智能体。
//    ⇒ 要判的是「主进程算出的 targets」与「UI 渲染用的 kind 口径」是否一致，
//      而不是读代码猜（我今天已经因为读代码猜错两次）。
//
// 判据做的事：
//   ① 真跑 buildDispatchCatalog（注入真实 userData）⇒ 拿真实 targets
//   ② 按 UI 的 countOf 口径（expert/team/subagent 三类）统计
//   ③ 断言三类都非 0（专家团/专家 ≥1、子智能体 ≥1）
//   ④ 反向：确认 DispatchTargetEntry 的 kind 联合类型与 UI 的三行 key 一致
import { createRequire } from "node:module";
import { mkdtempSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【dpcat】" + m); if (!c) fails++; };

const REAL = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Codex Harness Desktop");
const req = createRequire(import.meta.url);
const UD = mkdtempSync(join(tmpdir(), "dpcat-"));
for (const f of ["expert-teams.json", "sub-agents.json"]) {
  if (existsSync(join(REAL, f))) copyFileSync(join(REAL, f), join(UD, f));
}

//桩 electron：只需要 app.getPath
const stub = { app: { getPath: () => UD, isPackaged: false, getAppPath: () => ROOT, name: "probe" } };
const NodeModule = req("node:module");
const origLoad = NodeModule._load;
NodeModule._load = function (request) {
  if (request === "electron") return stub;
  return origLoad.apply(this, arguments);
};

try {
  // ① 真跑（编译产物，和运行时同一份逻辑）
  const fileIO = req(join(ROOT, "dist-electron/expert-teams/02-team-file-io.js"));
  const path = req("node:path");
  fileIO.setExpertTeamsFile(path.join(UD, "expert-teams.json"));
  const rp = req(join(ROOT, "dist-electron/runtime-paths.js"));
  rp.initRuntimePaths();
  const core = req(join(ROOT, "dist-electron/features/dispatch-core.js"));
  const targets = await core.buildDispatchCatalog();
  ok(Array.isArray(targets), "buildDispatchCatalog() 返回数组（" + targets.length + " 条）");

  // ② 按 UI 的 countOf 口径统计
  const countOf = (kind) => targets.filter((t) => t.kind === kind).length;
  const nExpert = countOf("expert");
  const nTeam = countOf("team");
  const nSub = countOf("subagent");
  console.log("  · expert=" + nExpert + " team=" + nTeam + " subagent=" + nSub + " member=" + countOf("member"));

  ok(nExpert > 0, "专家类非 0（面板「专家」那一行）—— 0 就是数据没到 UI");
  ok(nTeam > 0, "专家团类非 0（面板「专家团」那一行）");
  /* ⛔⛔ 10-27 用户令：「不要内置子智能体…这个卡片删除」⇒ 出厂**没有**内置子智能体，
     用户不自己建就是 0 条 ⇒ 这里不能再断言"非 0"（那是数据依赖，不是契约）。
     ⛔ 但结构契约仍要验（分节 / kind / 勾选过滤）⇒ 下面用**探针条目**把 0 条的情形补齐。 */
  ok(nSub === 0 || targets.filter((t) => t.kind === "subagent").every((t) => Boolean(t.name)),
    "子智能体条目都有名字（0 条也合法：出厂无内置，用户自己建的才有）");
  const probeTargets = (nSub > 0 ? targets : [...targets, { kind: "subagent", name: "结构探针", description: "guard 结构断言用的探针条目" }])
    // 10-29 晚：CLI 智能体也进目录 —— 探针里没有它，下面「cli 分节」的断言就永远是空转
    .concat([{ kind: "cli", key: "probe-cli", name: "CLI 探针", profession: "编码 CLI", description: "guard 结构断言用的 CLI 探针" }]);

  // ③ 每条都必须有名字（UI 直接显示 target.name）
  const noName = targets.filter((t) => !t.name);
  ok(noName.length === 0, "每条都有 name（" + noName.length + " 条缺）");

  // ④ kind 口径一致：DispatchTargetEntry 的联合类型 ⊇ UI 三行
  const dts = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  // ⚠️ 判据自己踩过的坑：正则只匹配到最后一个 `| "subagent"`（因为 `"[a-z]+"\s*\|\s*` 贪婪到末尾）
  //   ⇒ expert/team 报"不含"。改用「取整行再逐个抠引号内容」，不依赖联合类型的书写形状。
  const kindLine = dts.split("\n").find((l) => /kind:.*"expert"/.test(l)) ?? "";
  const kinds = [...kindLine.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  for (const k of ["expert", "team", "subagent"]) {
    ok(kinds.includes(k), "DispatchTargetEntry.kind 含 " + k + "（UI 有这一行）");
  }
  // member 是第四类，UI 不渲染 —— 记下来而不是当成 bug
  if (kinds.includes("member")) {
    const withMember = countOf("member");
    console.log("  ⓘ kind='member' 有 " + withMember + " 条但 UI 不单独成行（成员归在所属团里）");
  }

  // ⑤ 工具描述非空（模型靠它知道有哪些对象可派）
  const { dispatchToolDescription } = req(join(ROOT, "dist-electron/dispatch.js"));
  const desc = dispatchToolDescription(probeTargets);
  ok(desc.length > 40, "工具描述非空（" + desc.length + " 字符）");
  ok(desc.includes("subagent") || desc.includes("子智能体"), "描述里出现子智能体（模型才知道能派谁）");

  /* 10-29 两轮定稿：专家 / 子智能体**恒可用**，专家团是唯一开关 ⇒ 描述只有两种生产形态
     （团关 / 团开）。判据钉住：团关时专家与子智能体照常列出、只有团被显式否定；
     并且必须写明"别让用户去开开关"（否则模型会让用户去点一个不存在的开关）。 */
  {
    const teamOff = dispatchToolDescription(probeTargets, { expert: true, team: false, subagent: true });
    ok(/专家、子智能体、CLI 智能体可直接派（不需要任何开关）/.test(teamOff),
      "团关时首句写明「专家、子智能体、CLI 智能体可直接派、不需要任何开关」");
    ok(teamOff.includes('kind="cli"'), "团关时 CLI 智能体**仍列出**（它与专家 / 子智能体同待遇，不受专家团开关影响）");
    ok(teamOff.includes('kind="expert"') && teamOff.includes('kind="subagent"'),
      "团关时专家与子智能体**仍列出**（它们不该被开关误伤）");
    ok(/【专家团】本会话\*\*未开启\*\*/.test(teamOff), "只有专家团被显式否定（不是隐藏 —— 隐藏会让模型反复试错）");
    ok(!teamOff.includes('kind="team"'), "团关时不列团条目（只留一句显式否定，避免模型去试）");
    ok(/不要把「先去调度面板开启」当成前置条件/.test(teamOff),
      "⛔ 明确禁止把「去开开关」当前置条件（10-29 实测：模型让用户去勾一个已不存在的项）");

    const teamOn = dispatchToolDescription(probeTargets, { expert: true, team: true, subagent: true });
    ok(teamOn.includes('kind="expert"') && teamOn.includes('kind="team"') && teamOn.includes('kind="subagent"'),
      "团开时三类都列出");
    ok(!/未开启/.test(teamOn), "团开时没有任何否定段");

    const dflt = dispatchToolDescription(probeTargets, null);
    ok(dflt.includes('kind="expert"') && dflt.includes('kind="subagent"'), "allow=null 退化为全列（旧行为不破）");
  }

  /*⛔⛔ 2026-10-04 用户报「提示词写错了」——
     原版把三类**平铺成一个无分节的列表**，每行只写个「专家」「子智能体」前缀，
     模型据此自己挑 ⇒ 用户开了子智能体、明确要派子智能体，模型却派了专家。
     根因不是"没列出来"，而是**没把"选谁"讲清**：三类适用场景完全不同，
     平铺后模型只能靠名字猜。
     ⇒ 判据钉三件事：① 三类各自分节且带适用场景 ② 有"用户点名哪类就派哪类"的硬规则
       ③ 每行带 kind="…"（模型据此知道 name 该配哪个 kind 参数）。*/
  // ⚠️ 分节标题带限定词（`【专家（单人）】`/`【专家团（多人协作）】`/`【子智能体（你自定义的角色）】`）
  //   ⇒ 判据不能写死 `【专家】`（那是 06 段的另一处），要用前缀匹配。
  for (const [label, kind] of [["专家", "expert"], ["专家团", "team"], ["子智能体", "subagent"]]) {
    const sectionLine = desc.split("\n").find((l) => l.includes("【" + label) && l.includes("】")) ?? "";
    ok(sectionLine.length > 0, "描述里【" + label + "…】独立成节（平铺会让模型派错类型）");
    ok(/适合/.test(sectionLine), "【" + label + "…】这一节写明了适用场景（当前：" + (sectionLine.slice(0, 46) || "无") + "）");
    ok(desc.includes('kind="' + kind + '"'), "每个 " + label + " 条目带 kind=\"" + kind + "\"（模型据此配 kind 参数）");
  }
  ok(/用户(说|点名|没指定)/.test(desc) && /就派那一类|挑\*\*最贴切/.test(desc),
    "描述里有「用户点名哪一类就派哪一类」的硬规则（否则模型自由发挥派错类型）");
  ok(desc.includes("不要把子智能体当专家用"), "描述里有「三类不可互换」的显式警告");
} finally {
  rmSync(UD, { recursive: true, force: true });
}

/* ── 会话级归属（10-29 用户令）：同一个专家 / 专家团 / 子智能体被多个会话复用时的隔离边界 ──
   三条边界（缺一条就会串）：
     · 委派会话：每次派活 `thread/start` **新线程**（不复用）⇒ 上下文天然隔离；
     · 团队成员：成员线程按 (团运行会话, 团, 成员) 复用 —— **必须带 owner**，否则 A 会话派过的
       成员会被 B 会话 resume，B 就带着 A 的历史（用户点名的"数据混淆"）；
     · 产出与归档：一律按 `originThreadId` 归属，跨会话不许投递 / 不许归档。 */
{
  const runs = readFileSync(join(ROOT, "electron/team-runs.ts"), "utf8");
  const ti = readFileSync(join(ROOT, "electron/team-invoke.ts"), "utf8");
  const del = readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8");
  ok(/export function memberThreadKey\(ownerThreadId: string, teamId: string, memberId: string\)/.test(runs)
    && /norm\(ownerThreadId\) \|\| "-"/.test(runs),
    "⛔ 成员线程复用键含 ownerThreadId（同一成员在不同会话里是不同线程）");
  ok(/memberThreadOf\(ownerThreadId, team\.teamId, member\.id\)/.test(ti)
    && /rememberMemberThread\(ownerThreadId, team\.teamId, member\.id, memberThreadId\)/.test(ti),
    "⛔ 团队派活按 owner 取/记成员线程（接线，不是写了没接）");
  ok(/server\.request\("thread\/start"/.test(del)
    && !/memberThreadOf|rememberMemberThread/.test(del),
    "委派（专家/子智能体/团长）每次新建线程，不复用历史会话 ⇒ 上下文不跨会话");
  ok(/record\.originThreadId !== origin/.test(readFileSync(join(ROOT, "electron/features/agents-ipc.ts"), "utf8"))
    && /record\.originThreadId !== callerThreadId/.test(readFileSync(join(ROOT, "electron/features/dispatch-rpc.ts"), "utf8")),
    "⛔ 归档/回报按 originThreadId 归属（跨会话归档一律失败）");
}

// ── ⑥ 被调度的会话不能再调度（权限闸三处都在）──
// ⛔ 这套闸是 09-16 建的，**不在渲染层**（按钮 disabled 只是 UX），真正的闸在主进程。
//    用户 10-04 报「被调度的会话不能再去调度」时曾怀疑被删 ⇒ 用静态判据钉死。
{
  const rpc = readFileSync(join(ROOT, "electron/features/dispatch-rpc.ts"), "utf8");
  const core = readFileSync(join(ROOT, "electron/features/dispatch-core.ts"), "utf8");
  ok(/if \(name === "agent_invoke"\)/.test(rpc), "agent_invoke 有执行端分支");
  ok(/agent_invoke[\s\S]{0,400}restrictedThreadRole/.test(rpc), "⛔ agent_invoke 受 restrictedThreadRole 闸（被调度/专家会话不能对外派人）");
  ok(/canDispatchFrom\(\{[\s\S]{0,300}isDelegated/.test(rpc), "闸里带 isDelegated（被调度的会话再派活会被拦）");
  ok(/depth:\s*originRecord\?\.depth/.test(rpc), "闸里带 depth（防多层嵌套调度）");
  ok(/if \(await delegateRegistry\.infoOf\(threadId\)\)/.test(core), "被调度的临时会话被识别为 restricted");
  ok(/teamRunStore\.teamOfThread\(threadId\)/.test(core), "专家/专家团会话被识别为 restricted");
  // 渲染层只是 UX，也钉一下（否则用户会看到"能点但没反应"）
  const seg = readFileSync(join(ROOT, "src/features/app-state/parts/part09/02-seg.tsx"), "utf8");
  ok(/restrictedLabel=\{bag\.threadRole\.restricted/.test(seg), "顶栏调度按钮把 restrictedLabel 传下去（UI 层也禁）");
  // ② 勾选变化必须重取描述（否则"点了确认却还是旧提示词"）
  const roles = readFileSync(join(ROOT, "src/features/app-state/parts/part06/01-seg/02-runtime-dispatch-roles.tsx"), "utf8");
  ok(/dispatchToolDescription\(tid\)/.test(roles) || /dispatchToolDescription\(\w+\)/.test(roles),
    "⛔ 渲染层把 threadId 传给 dispatchToolDescription（无参 ⇒ 主进程拿不到勾选、只能三类全列）");
  ok(/const tid = bag\.threadRef\.current\?\.id/.test(roles), "threadId 走 threadRef 读（闭包旧值会串会话）");
  ok(/dispatchKey/.test(roles) && /dispatchKey\]\);/.test(roles),
    "勾选变化会重取描述（effect 依赖含 dispatchKey）");
  // preload / 类型签名同步
  ok(/dispatchToolDescription: \(threadId: string\)/.test(
    readFileSync(join(ROOT, "electron/preload.ts"), "utf8")),
    "preload 签名带 threadId 且 arity=1（改了签名不同步 ⇒ IPC 静默丢参）");
  ok(/dispatchToolDescription\(threadId: string\)/.test(
    readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8")),
    "vite-env.d.ts 签名同步（不同步 ⇒ tsc 不报、运行时丢参）");
  ok(/agents:tool-description", async \(_event, threadId: string\)/.test(
    readFileSync(join(ROOT, "electron/features/agents-ipc.ts"), "utf8")),
    "主进程 handler 接 threadId 并按 dispatch 开关生成 allow");
  /* ⭐ 10-05：这条轨的门槛从 `runs.length > 0` 改成 `!railTeam`（普通会话**永远**有这条轨，
     办公室入口就挂在它末位）。⇒ 判据改成结构式，且**钉住"不许退回 runs.length"**——
     那正是"没调度过 ⇒ 没有轨道 ⇒ 入口无处安放"的病根（用户 10-05 报的入口位置问题）。
     ⛔ 用注释剥离后的源码判负向：本文件/被测文件里的说明文字同样会写出那个表达式。 */
  {
    const tlRaw = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8");
    const tlCode = tlRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const at = tlCode.indexOf("<DelegatedRail");
    const block = at >= 0 ? tlCode.slice(at, tlCode.indexOf("/>", at)) : "";
    ok(at >= 0 && /runs=\{delegatedRailRuns\}/.test(block),
      "主会话下方渲染 DelegatedRail，且接到本会话的 delegatedRailRuns（被调度会话出现在主会话下）");
    ok(/!railTeam/.test(tlCode) && !/delegatedRailRuns\.length\s*>\s*0/.test(tlCode),
      "⛔ 该轨按「非专家团会话」渲染（⛔ 不用 runs.length 当门槛：没调度过就没有轨道 = 办公室入口无处安放）");
  }
}

// ── ⑦ 调度工具必须真的在模型工具面里（10-05 用户报「调度工具用不了」的结构判据）──
// ⛔⛔ 起因：10-04 把调度改成"只走内置 MCP harness-dispatch"，而**引擎 0.157 把 MCP 工具整批
//    延迟暴露**（`input[0].additional_tools` 里一个都没有，`functions.exec` 说明里写着
//    "…listed in ALL_TOOLS"）⇒ 模型连调 `expert_list` / `agent_invoke` 都是
//    `unsupported call`，而宿主同时注入「【调度已开启】…可派对象：知微…」的告知。
//    ⇒ 下面这些判据钉的是「告知」与「工具」**必须同时到位**，且**不许按开关条件注册**
//      （dynamicTools 只在 thread/start / thread/resume 生效，带条件注册就会出现
//       "用户中途打开调度、工具面却不重建" —— 真机实证：会话 15:35:32 建立、15:35:54 才注入告知）。
{
  const seg08 = readFileSync(join(ROOT, "src/features/app-state/parts/part08/01-seg.tsx"), "utf8");
  const req = readFileSync(join(ROOT, "src/features/app-state/parts/part05/event-router/02-request.tsx"), "utf8");
  const core2 = readFileSync(join(ROOT, "electron/features/dispatch-core.ts"), "utf8");

  ok(/name: "agent_invoke"/.test(seg08), "buildDynamicTools 注册了 agent_invoke（模型工具面的唯一来源）");
  // ⛔ 两个代码形态**各自锚定**，⛔ 不用 `[\s\S]{0,N}` 字符窗口把它们串起来 —— 中间插几行
  //    注释就会假红，而每次假红都诱人把 N 调大，最后等于没约束（本仓库踩过：窗口 220→600→877）。
  ok(/required: \["kind", "name", "query"\]/.test(seg08),
    "agent_invoke 带完整 inputSchema（空 schema ⇒ 模型只能瞎猜参数）");
  ok(/name: "agent_archive_sessions"/.test(seg08),
    "agent_archive_sessions 也注册了（描述里让模型「用户同意后归档」，没工具就是空话）");

  // ⛔ 负向：注册侧**不得**再按开关条件注册 —— 中途开开关时 thread/start 早已过去，工具面不会重建。
  //    （09-16~10-04 那版用 `emptyDispatch()` / `loadThreadRuntime()` 在这里取开关，正是要防它回潮。
  //      ⚠️ 注意不能用 `loadThreadRuntime` 做判据：本文件另有 `loadThreadRuntimeRaw(`，会假红。）
  ok(!/emptyDispatch\(/.test(seg08) && !/loadThreadRuntime\(/.test(seg08),
    "⛔ 调度工具**不许按开关条件注册**（带了条件 ⇒ 用户打开调度后工具面仍是旧的，等于没修）");

  // 描述兜底文案与 MCP 孪生同源：两边都必须把「以会话里那条告知为准」写出来
  //（electron/ 与 src/ 互不 import ⇒ 各留一份字面量，只能靠这条防漂移）
  const SHARED = "以会话里那条「调度范围已更新」的告知为准";
  ok(seg08.includes(SHARED) && core2.includes(SHARED),
    "⛔ 调度工具描述两侧同源（渲染层兜底 + dispatch-core 的 MCP 孪生都把会话级真相指向那条告知）");

  // 分发端：分支必须接到**现有 IPC**（与 MCP 执行端共用 runDelegatedTask 硬闸），不许另写一套。
  //（同上分离锚定：`event.params?.tool === "…"` 与 `window.codex.<fn>(` 各是代码形态、各自唯一。）
  ok(/event\.params\?\.tool === "agent_invoke"/.test(req) && /window\.codex\.invokeAgent\(/.test(req),
    "渲染层 agent_invoke 分发接 invokeAgent（agents:invoke → runDelegatedTask，与 MCP 同一处闸）");
  ok(/event\.params\?\.tool === "agent_archive_sessions"/.test(req) && /window\.codex\.archiveDelegates\(/.test(req),
    "渲染层 agent_archive_sessions 分发接 archiveDelegates");
  ok((req.match(/const dispatchOrigin = String\(event\.params\?\.threadId/g) || []).length === 2,
    "⛔ 两处发起方身份都取**引擎下发的** threadId（取 bag.threadRef 会串会话 / 让模型有机会伪造发起方）");

  /* ── 组 G：委托登记表的**生命周期**（10-05 收尾）──────────────────────────────
     起因：修「调度完办公室没人」时暴露的三件相邻欠账，一起钉住 ——
       · 记录**跟着会话一起走**（删除 ⇒ 忘掉；归档 ⇒ 留着，那只是"收起"不是"不存在"）；
       · 7 天保留期此前**从未被调用**（prune 写好了、全仓没有调用点 ⇒ 文件只增不减）；
       · 归档的 `threadIds` 是模型可控参数，必须校验**归属**（否则能归档别的会话派出的委托）。 */
  {
    const bootSrc = readFileSync(join(ROOT, "electron/features/boot.ts"), "utf8");
    const codexSrc = readFileSync(join(ROOT, "electron/features/codex-ipc.ts"), "utf8");
    const regSrc = readFileSync(join(ROOT, "electron/delegate-registry.ts"), "utf8");
    const agentsSrc = readFileSync(join(ROOT, "electron/features/agents-ipc.ts"), "utf8");
    const rpcSrc = readFileSync(join(ROOT, "electron/features/dispatch-rpc.ts"), "utf8");

    ok(/async forget\(threadIds: string\[\]\)/.test(regSrc) && /async forgetDeleted\(deadIds: Set<string>\)/.test(regSrc),
      "登记表实现了 forget / forgetDeleted（删会话时把记录一起带走）");
    // ⛔ 两条删除入口都要清：引擎侧通知（boot）+ 渲染层 thread/delete（codex-ipc）—— 漏一条就留幽灵
    ok(/delegateRegistry\.forget\(\[goneId\]\)/.test(bootSrc) && /delegateRegistry\.forget\(\[purgeTarget\]\)/.test(codexSrc),
      "⛔ 两条删除入口都清登记表（boot 的事件分支 + codex-ipc 的 finally）");
    ok(/forgetDeleted\(deletedThreadIds\)/.test(bootSrc) && /delegateRegistry\.prune\(\)/.test(bootSrc),
      "⛔ 启动做墓碑对账 + 跑 7 天保留期清理（prune 此前无调用点 = 只增不减）");
    ok(/record\.originThreadId !== origin/.test(agentsSrc) && /record\.originThreadId !== callerThreadId/.test(rpcSrc),
      "⛔ 归档校验归属（IPC 用引擎下发的 origin / MCP 用 callerThreadId）");
    ok(!/record\.originThreadId !== String\(args\.originThreadId/.test(rpcSrc),
      "⛔ MCP 侧不许拿 args.originThreadId 当归属判据（那是模型自己填的，等于自证）");
  }
}

/* ── 「等回合结束」必须认**四类**结束事件（10-10 用户反馈：委派"每次调用都撞 10 分钟硬超时"）──
   ⛔ 同型缺陷主进程出现两处：`main/03-turn-summary.ts` 与 `scheduler.ts` 都只认
   completed/aborted/failed、漏 `turn/interrupted` ⇒ 那个 Promise **永不 settle**，
   只能白等满超时（委派 10 分钟 / 定时任务 90 分钟）才收场 —— 用户看到的正是
   "会话停在停止" / "撞 10 分钟硬超时"。
   ⛔ 另：turn 类事件的回合 id 在 `params.turn.id`（`params.turnId` 只是 item 类事件的字段），
   取错 = 增量聚合那条路恒空（被 finals 回退掩盖，看不出坏）。 */
{
  const summarySrc = readFileSync(join(ROOT, "electron/main/03-turn-summary.ts"), "utf8");
  const schedSrc = readFileSync(join(ROOT, "electron/scheduler.ts"), "utf8");
  const FOUR = /\["turn\/completed", "turn\/aborted", "turn\/failed", "turn\/interrupted"\]/;
  ok(FOUR.test(summarySrc),
    "⛔ 委派/共享等待器认四类结束事件（漏 turn/interrupted ⇒ 被中断的委派永不 settle，白等满超时）");
  ok(FOUR.test(schedSrc), "⛔ 定时任务等待器认四类结束事件（漏了 ⇒ 被中断的回合白等 90 分钟才收场）");
  ok(/params\.turn\?\.id \?\? params\.turnId/.test(schedSrc),
    "⛔ 定时任务的回合 id 取 `params.turn.id`（turn 类事件没有 params.turnId —— 取错 = 增量聚合恒空）");
  ok(/\$\{Math\.round\(timeoutMs \/ 60_000\)\} 分钟/.test(summarySrc),
    "⛔ 超时文案用**实际**值（写死「10 分钟」而实际传 300_000 就是撒谎）");
}

/* ── 「委派超时 ⇒ 转后台」（10-10 用户令：超时不判失败）──────────────────────────
   ⛔ 关键不变量：等待到点**不能**标 failed —— 成员的回合在引擎里还在跑，
   原来标 failed 会让面板显示"停止/失败"而活儿还在干（用户看到的正是这个矛盾）。
   ⇒ 保持 running，由引擎事件在回合真正结束时收敛（delegate-settle）。
   ⛔ 那个收敛点必须独立于 await —— 只靠 delegation/teams-ipc 的 await 路径的话，
   宿主一提前放手，记录就永远停在 running（下次启动自愈会把它误标成"应用重启中断"）。 */
{
  const delSrc = readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8");
  const teamSrc = readFileSync(join(ROOT, "electron/team-invoke.ts"), "utf8");   // 10-22：成员调度实现搬到 team-invoke.ts（渲染层与主进程兜底共用）
  const settleSrc = readFileSync(join(ROOT, "electron/delegation/delegate-settle.ts"), "utf8");
  const bootSettle = readFileSync(join(ROOT, "electron/features/boot.ts"), "utf8");
  ok(/error\?\.code === TURN_WAIT_TIMEOUT_CODE/.test(delSrc) && /TURN_WAIT_BACKGROUND_NOTE/.test(delSrc),
    "委派等待到点 ⇒ 转后台（⛔ 不标 failed —— 否则面板显示「停止」而活儿还在干）");
  ok(/error\?\.code === TURN_WAIT_TIMEOUT_CODE/.test(teamSrc) && /TURN_WAIT_BACKGROUND_NOTE/.test(teamSrc),
    "团队成员等待到点 ⇒ 同样转后台");
  ok(/settleBackgroundRunsOnTurnEnd\(event\)/.test(bootSettle),
    "⛔ boot 在引擎事件流里收敛后台运行（宿主提前放手后，没有它记录会永远停在 running）");
  ok(/isTurnEndMethod/.test(settleSrc) && !/TURN_END_METHODS = new Set/.test(settleSrc),
    "收敛点认**四类**结束事件（走共享真相源 isTurnEndMethod —— 与 waitForTurnCompletion 同口径）");
  ok(/isRunningThread\(threadId\)/.test(settleSrc) && /activeRunOfThread\(threadId\)/.test(settleSrc),
    "⛔ 只在仍认为 running 时收敛（正常路径已收敛的不重复广播）");
}

/* ── 「转后台 ⇒ 完成后自动回报发起会话」（10-10 用户令「像轮询那样自动喂回主会话」）────────
   ⛔ 执行者不可能是被委派会话自己 —— 它也是回合制，结果回来时它早停了 ⇒ 只能宿主代投。
   ⛔ 去重闸：只有打过 pendingReport 标（= 走过转后台分支）的才投 —— 同步跑通的委派，结果
   已经随 agent_invoke 返回值交回主会话，再投就是两份。
   ⛔ 载体必须走**引擎队列**（发起会话空闲立即启动 / 忙则排队，不用判断忙闲）；
   ⛔ 绝不能 thread/start + turn/start（那会打断发起会话正在跑的回合）。 */
{
  const delRepSrc = readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8");
  const teamRepSrc = readFileSync(join(ROOT, "electron/team-invoke.ts"), "utf8");
  const reportSrc = readFileSync(join(ROOT, "electron/delegation/delegate-report.ts"), "utf8");
  const settleRepSrc = readFileSync(join(ROOT, "electron/delegation/delegate-settle.ts"), "utf8");
  ok(/reportBackgroundResult\(/.test(settleRepSrc) && /pendingReport/.test(settleRepSrc),
    "⛔ 收敛点只在 pendingReport（= 走过转后台分支）时投回报（同步跑通的委派去重，不投第二份）");
  ok(/thread\/queue\/add/.test(reportSrc) && /thread\/queue\/start/.test(reportSrc) && !/turn\/start/.test(codeOnly(reportSrc)),
    "⛔ 回报载体 = 引擎**队列**（空闲立即跑 / 忙则排队）；⛔ 绝不能 turn/start（会打断正在跑的回合）");
  ok(/thread\/resume/.test(reportSrc),
    "投递前先 resume（发起会话的回合可能早已结束、线程已被引擎卸载 ⇒ 不加载就投不进队列）");
  ok(/DELEGATE_REPORT_MAX_PER_WINDOW/.test(reportSrc) && /DELEGATE_REPORT_WINDOW_MS/.test(reportSrc),
    "回报有**额度闸**（防「回报 → 又派活 → 又超时 → 又回报」滚雪球烧钱）");
  ok(/markPendingReport\(/.test(delRepSrc) && /markPendingReportByThread\(/.test(teamRepSrc),
    "⛔ 两条链路（委派 / 团队成员）转后台时都打「待回报」标");
}

/* ── 渠道三件套的「回合收尾」必须认四类结束事件（10-10 用户反馈：渠道里回复到一半再无下文）────
   channel-bot（飞书）· bot-stream（微信/Telegram 流式）· im-inbound ×3（兜底投递）原来都只认
   turn/completed ⇒ 被中断 / 失败的回合：飞书用户收不到回复、微信流式气泡停在「进行中」、
   兜底监听器永不摘除（泄漏）。⇒ 统一走 electron/turn-end.ts 的 isTurnEndMethod ——
   本月同型缺陷共抓到 7 处后立的**唯一真相源**，⛔ 新代码不许再手写事件名枚举。 */
{
  const chSrc = codeOnly(readFileSync(join(ROOT, "electron/channel-bot.ts"), "utf8"));
  const streamSrc = codeOnly(readFileSync(join(ROOT, "electron/bot-stream.ts"), "utf8"));
  const inboundSrc = codeOnly(readFileSync(join(ROOT, "electron/features/im-inbound.ts"), "utf8"));
  ok(/isTurnEndMethod\(/.test(chSrc) && /finishTurn\(params, /.test(chSrc),
    "⛔ 渠道机器人收尾认四类（漏了 ⇒ 被中断的回合用户收不到任何下文）");
  ok(/case "turn\/aborted":[\s\S]{0,60}?case "turn\/failed":[\s\S]{0,60}?case "turn\/interrupted"/.test(streamSrc),
    "⛔ 流式会话收尾认四类（漏了 ⇒ 流式气泡停在「进行中」、收尾补发不发 —— 用户截图正是它）");
  ok(!/event\.method !== "turn\/completed"/.test(inboundSrc)
    && (inboundSrc.match(/onTurnDone\(/g) ?? []).length >= 4,
    "⛔ 三条入站路径（微信/Telegram/通用）统一走 onTurnDone（裸写 completed 判据 = 监听器泄漏 + 无下文）");
  const turnEndOk = existsSync(join(ROOT, "electron/turn-end.ts")) && /isTurnEndMethod/.test(readFileSync(join(ROOT, "electron/turn-end.ts"), "utf8"));
  ok(turnEndOk, "共享真相源 electron/turn-end.ts 就位（本月同型缺陷共 7 处后立）");
}

/* ── 专家团：会不会自己埋头干（10-26 用户令「看看有没有漏洞，干活会不会积极调度」）──
   ⛔ 这块此前**一条断言都没有**：协作铁律可以被随手改掉而没人发现。 */
{
  const teamTools = readFileSync(join(ROOT, "electron/expert-teams/06-team-tools.ts"), "utf8");
  ok(/你不亲自干活/.test(teamTools) && /先派活，再说话/.test(teamTools),
    "专家团铁律：⛔ 不亲自干活（可交付物必须来自成员）+ 先派活再动手");
  ok(/team_phase_invoke/.test(teamTools) && /并行/.test(teamTools),
    "并行阶段走 team_phase_invoke（并行由宿主保证，不靠模型自觉）");
  const teamsIpc = readFileSync(join(ROOT, "electron/features/teams-ipc.ts"), "utf8");
  ok(/第一步就把可并行的子任务/.test(teamsIpc),
    "团队首条任务指令也要求「第一步就派活」（否则主理人容易先自己写一版）");
  /* ⛔ 成员会话**不挂任何 dynamicTools** ⇒ 成员不能再派活，不会指数爆炸（team-invoke.ts 里明写） */
  const teamInvoke = readFileSync(join(ROOT, "electron/team-invoke.ts"), "utf8");
  ok(!/dynamicTools/.test(codeOnly(teamInvoke)),
    "⛔ 成员会话不挂 dynamicTools（成员不能再派活 ⇒ 不会嵌套爆炸）");
  /* ⛔ 派活必须宿主侧校验「团队存在 / 启用 / 成员归属」——模型编个 id 不能派出去 */
  ok(/成员「\$\{input\.memberId\}」不存在于专家团/.test(teamInvoke) && /已停用/.test(teamInvoke),
    "派活有宿主侧校验（团队存在 / 未停用 / memberId 属于该团）");
}

/* ── 旧团队会话补种（10-26）：铁律只在建会话时拼进系统提示词 ⇒ 老会话拿不到 ── */
{
  const sendSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part08/02-seg/send.tsx"), "utf8");
  ok(/teamThreadConfigRef\.current\.has\(id\)/.test(sendSrc)
    && /isTeamLeadThread\(id\)/.test(sendSrc)
    && /markSeeded\(id, "team", TEAM_SEED_VERSION\)/.test(sendSrc)
    && /TEAM_DISPATCH_SUPPLEMENT/.test(sendSrc),
    "旧团队主理人会话补发一次团队纪律（先派活 / 不亲自干），带记账只补一次");
  /* ⛔⛔ 认人必须**跨重启**：teamThreadConfigRef 是内存 ref，重开应用就空了 ⇒
     只靠它的话，旧会话（正是要修的场景）永远补不上。主进程那份持久名单才是关键。 */
  const runs = readFileSync(join(ROOT, "electron", "team-runs.ts"), "utf8");
  ok(/leads: Record<string, true>/.test(runs) && /setThreadLead\(/.test(runs)
    && /leads: \{ \.\.\.this\.threadsDoc\.leads \}/.test(runs),
    "主进程持久化「主理人会话」名单（leads 字段：写 / 读 / 随 team-threads:map 导出）");
  ok(/teamRunStore\.setThreadLead\(started\.thread\.id\)/.test(readFileSync(join(ROOT, "electron", "features", "teams-ipc.ts"), "utf8")),
    "开团（主理人）会话时才标记 leads（⛔ 成员会话不标 ⇒ 不会把「别自己干」发给成员）");
  ok(/setTeamLeadThreads\(Object\.keys\(leadIds\)\)/.test(readFileSync(join(ROOT, "src/features/app-state/parts/part02/01-mcp-teams-plan/02-team-roles-import.tsx"), "utf8")),
    "渲染层把主进程那份名单灌进来（重启后也认得出旧团队会话）");
  const seeds = readFileSync(join(ROOT, "src/lib/prompt-seeds.mjs"), "utf8");
  ok(/你不亲自干活/.test(seeds) && /先派活，再说话/.test(seeds),
    "补发文案与 06-team-tools.ts 的铁律同义（新旧会话行为一致）");
}

/* ══ 10-30 用户令：@ 候选列表按调度开通状态联动 ══
   「未开通专家团调度时列表中的『专家团』项置灰不可选，开通后自动恢复为可选中高亮，
     并确保该联动逻辑随开关状态实时更新、与提示词描述保持一致」。
   ⛔ 这里判三件事，都是"读代码猜不出来"的：
     ① 纯函数层真的按 allow 打 disabled（且**不隐藏** —— 隐藏会让用户以为团队没了）；
     ② 键盘顺序跳过置灰行（否则 Enter 能把灰行加进点名）；
     ③ 渲染层/提示词与本实现同口径（三处任一漂移，用户看到的就和模型读到的不一致）。 */
{
  const mention = await import(pathToFileURL(join(ROOT, "src", "lib", "dispatch-mention.mjs")).href);
  const { dispatchToolDescription: describeDispatch } = req(join(ROOT, "dist-electron/dispatch.js"));
  const sample = [
    { kind: "expert", key: "e1", name: "单人专家" },
    { kind: "team", key: "t1", name: "软件开发专家团" },
    { kind: "subagent", key: "s1", name: "评审员" },
  ];
  const offRes = mention.filterMentionTargets(sample, "", { team: false });
  const offTeam = offRes.groups.find((g) => g.kind === "team");
  const offExpert = offRes.groups.find((g) => g.kind === "expert");
  ok(Boolean(offTeam) && offTeam.off === true && offTeam.items.every((t) => t.disabled === true),
    "团关时：专家团**仍列出**但整组 off、每行 disabled（⛔ 不许改成「筛掉」）");
  ok(Boolean(offExpert) && offExpert.off === false && offExpert.items.every((t) => !t.disabled),
    "团关时：专家不受影响（置灰只作用于未开通的类别）");
  ok(mention.flatMentionTargets(offRes.groups).every((t) => t.kind !== "team"),
    "键盘顺序（↑↓/Enter）跳过置灰行 —— 否则 Enter 会把灰行加进点名");
  ok(mention.firstMentionTarget(sample, "", { team: false })?.kind === "expert",
    "Enter 采纳第一条**可选**候选（置灰时不会落到专家团）");

  const onRes = mention.filterMentionTargets(sample, "", { team: true });
  const onTeam = onRes.groups.find((g) => g.kind === "team");
  ok(Boolean(onTeam) && onTeam.off === false && onTeam.items.every((t) => !t.disabled),
    "团开时：专家团恢复可选中（同一份数据，只换 allow）");

  /* 渲染层接线：allow 必须取自**顶层状态** activeDispatch（拨开关即重渲染 ⇒ 真正"实时"），
     且行上用原生 disabled（不可点 + 不在 tab 序），并给组挂 is-off 供置灰样式。 */
  const composer = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8");
  ok(/filterMentionTargets\(dispatchInfo\?\.targets \?\? \[\], contextQuery, activeDispatch\)/.test(composer)
    && /disabled=\{Boolean\(target\.disabled\)\}/.test(composer)
    && /context-picker-group\$\{group\.off \? " is-off"/.test(composer),
    "@ 面板按 activeDispatch 联动（组 is-off + 行原生 disabled），⛔ 不是「过滤掉」也不是「点一下才更新」");

  const form = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer", "02-composer-form.tsx"), "utf8");
  ok(/mentionEnterPlan\(dispatchInfo\?\.targets \?\? \[\], contextQuery, activeDispatch\)/.test(form)
    && /plan\.disabledOnly/.test(form),
    "输入框 Enter 走 mentionEnterPlan（候选全置灰时什么都不做，⛔ 不许掉进历史消息分支）");
  ok(mention.mentionEnterPlan(sample, "", { team: false }).disabledOnly === false
    && mention.mentionEnterPlan([{ kind: "team", key: "t1", name: "软件开发专家团" }], "软件开发", { team: false }).disabledOnly === true,
    "只有置灰候选时 Enter 判定为 disabledOnly（不误插历史消息）");

  /* 提示词同口径：模型要能解释「@ 里专家团是灰的」= 没开开关，不是团队不存在。 */
  const desc = describeDispatch(sample, { expert: true, team: false, subagent: true, cli: true });
  ok(/输入框的 @ 选择列表/.test(desc) && /置灰/.test(desc) && /立刻/.test(desc),
    "调度提示词写明「@ 列表按开通状态联动：未开通置灰不可选、开通后立刻恢复」");
  const block = mention.mentionBlockOf([{ kind: "team", name: "软件开发专家团" }]);
  ok(/置灰不可选/.test(block) && /实时/.test(block),
    "点名指令块同口径（③ 未开启不硬派 + ④ 列表置灰的解释话术）");

  /* ⛔⛔ 10-31 用户令「被调度的子智能体 / CLI / 专家 / 专家团 / 成员默认跟随主会话的模型配置」：
     三条派活链的模型链都必须带「发起方会话级模型」一环（originSessionModel），且排在
     实体存档模型（member.model）之前 —— 否则发起方换了模型，被派会话还跑在旧模型 + 旧供应商
     （实测：成员被建在 harness 供应商下拿着 custom964，引擎拒「供应商不一致」建不起来）。 */
  const catalogSrc = readFileSync(join(ROOT, "electron/main/01-model-catalog.ts"), "utf8");
  const delSrc = readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8");
  const tiSrc = readFileSync(join(ROOT, "electron/team-invoke.ts"), "utf8");
  ok(/export async function originSessionModel\(/.test(catalogSrc) && /offered\.some\(\(m\) => m\.id === raw/.test(catalogSrc),
    "originSessionModel 存在：发起方会话级模型 + 按激活供应商清单归一（不在清单回落全局）");
  ok(/originSessionModel\(origin, threadRuntimeStore\)/.test(delSrc) && /originRuntimeModel \|\| undefined\)\s*\|\| customModel\?\.model/.test(delSrc),
    "delegation 模型链：发起方会话级模型排在全局激活模型之前");
  ok(/originSessionModel\(String\(input\.leadThreadId \?\? ""\), threadRuntimeStore\)/.test(tiSrc)
    && /input\.model \|\| originModel \|\| member\.model/.test(tiSrc),
    "team-invoke 成员模型链：发起方会话级模型排在 member.model 存档之前");
  const runnerSrc = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  ok(/async function bossModelOf\(group: BossGroup\)/.test(runnerSrc)
    && /await bossModelOf\(group\)\) \|\| member\.model/.test(runnerSrc),
    "中枢群成员跟随 boss 会话模型（建线程与每次派活两处都在 member.model 之前）");
}

console.log("\n【dpcat】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
