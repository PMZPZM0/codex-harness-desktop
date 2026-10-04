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
import { fileURLToPath } from "node:url";

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
  ok(nSub > 0, "子智能体类非 0（面板「子智能体」那一行）");

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
  const desc = dispatchToolDescription(targets);
  ok(desc.length > 40, "工具描述非空（" + desc.length + " 字符）");
  ok(desc.includes("subagent") || desc.includes("子智能体"), "描述里出现子智能体（模型才知道能派谁）");

  /* ⛔⛔ 2026-10-04 用户报「我只选了子智能体，点确认之后就只自动发送子智能体调度提示词」——
     两个漏：① 描述不按勾选生成（三类全列）② 勾选变了不重取描述。
     ⇒ 判据：只勾一类时，描述必须**只列那一类**、且对其余两类**显式否定**。 */
  {
    const only = dispatchToolDescription(targets, { expert: false, team: false, subagent: true });
    ok(/只开启了：子智能体/.test(only), "只勾子智能体时描述首句写明「只开启了：子智能体」");
    ok(!only.includes('kind="expert"') && !only.includes('kind="team"'),
      "只勾子智能体时**不列**任何专家/专家团条目（列了模型就会派错）");
    ok(/【专家】本会话\*\*未开启\*\*/.test(only) && /【专家团】本会话\*\*未开启\*\*/.test(only),
      "未勾选的类别被**显式否定**（不是隐藏 —— 隐藏会让模型以为不存在而反复试错）");
    ok(only.includes('kind="subagent"'), "勾选的子智能体仍然列出");
    // 反向：全勾时三类都要出现
    const all = dispatchToolDescription(targets, { expert: true, team: true, subagent: true });
    ok(all.includes('kind="expert"') && all.includes('kind="team"') && all.includes('kind="subagent"'),
      "三类全勾时三类都列出（不得被 allow 误伤）");
    // 退化：allow=null 时全列（保持旧行为，不让描述变空）
    const dflt = dispatchToolDescription(targets, null);
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
  ok(/delegatedRailRuns\.length > 0/.test(
    readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/01-timeline.tsx"), "utf8"),
  ), "主会话下方渲染 DelegatedRail（被调度会话出现在主会话下）");
}

console.log("\n【dpcat】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
