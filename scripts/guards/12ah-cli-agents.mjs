// CLI 智能体板块（10-29 用户令）的判据：**真跑**编译产物，不是字符串比对。
//
// 用户原话：「在开发工具界面新增一个「CLI 智能体」模块，用于统一管理和接入各类 CLI 工具…
//   按类型对已接入的 CLI 进行分类管理，并提供搜索功能…同时将该 CLI 接入到「@」调用体系中，
//   使其与子智能体、专家、专家团保持一致，可通过 @ 直接调用」。
//
// 这个板块最容易出的三种错，逐条钉住：
//   a) **编造安装命令**：installCmd 必须是核实过的官方来源，核实不到就留空 —— 用户复制一条装不上的
//      命令，比不给命令更糟（本仓纪律：「文案声称的能力」是最危险的假象）；
//   b) **派活旁路**：CLI 必须走 `agent_invoke(kind="cli")` → runDelegatedTask（同一套闸门 / 登记 /
//      工作区 / 归属），⛔ 不许另开一条直连引擎的通道（09-14 `subagents:invoke` 的教训）；
//   c) **声明了能力却没接线**：目录 / 闸门 / 工具描述 / @ 分组 / 工具 schema 五处，少一处就是
//      "面板上看得见、模型调不到"或反过来。
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(import.meta.url);
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【cliagents】" + m); if (!c) fails++; };

/* ⛔ 真跑要用 userData —— 给它一个空临时目录（模块顶层不取路径，只有落盘时才取）。 */
const sandbox = mkdtempSync(join(tmpdir(), "cliagents-guard-"));
const stub = { app: { getPath: () => sandbox, isPackaged: false, getAppPath: () => ROOT, name: "p" } };
const NodeModule = req("node:module");
const origLoad = NodeModule._load;
NodeModule._load = function (request) {
  if (request === "electron") return stub;
  return origLoad.apply(this, arguments);
};
const cli = req(join(ROOT, "dist-electron/cli-agents.js"));
const dp = req(join(ROOT, "dist-electron/dispatch.js"));
NodeModule._load = origLoad;

const mainSrc = readFileSync(join(ROOT, "electron/cli-agents.ts"), "utf8");
const ipcSrc = readFileSync(join(ROOT, "electron/features/cli-agents-ipc.ts"), "utf8");
const coreSrc = readFileSync(join(ROOT, "electron/features/dispatch-core.ts"), "utf8");
const delegationSrc = readFileSync(join(ROOT, "electron/features/delegation.ts"), "utf8");
const panelSrc = readFileSync(join(ROOT, "src/features/cli-agents/CliAgentsPanel.tsx"), "utf8");
const mentionSrc = readFileSync(join(ROOT, "src/lib/dispatch-mention.mjs"), "utf8");
const composerSrc = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer.tsx"), "utf8");
const segSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part08/01-seg.tsx"), "utf8");
const dts = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");

/* ── ① 内置预置：三个点名对象都在，且字段齐全 ── */
{
  const presets = cli.BUILTIN_CLI_AGENTS;
  ok(Array.isArray(presets) && presets.length >= 6, `内置预置表有 ${presets?.length ?? 0} 条（Claude / Codex / Gemini / Aider / OpenClaw / Harness）`);
  const byName = new Map(presets.map((entry) => [entry.name, entry]));
  ok(["Claude Code", "OpenClaw", "Harness CLI"].every((name) => byName.has(name)),
    "用户点名的三类都在预置表里（Claude Code / OpenClaw / Harness CLI）");
  ok(presets.every((entry) => entry.id && entry.name && entry.bin && entry.category),
    "每条预置 id/name/bin/category 齐全（缺一个就派不出去）");
  ok(presets.every((entry) => cli.CLI_CATEGORIES.some((cat) => cat.key === entry.category)),
    "预置的分类值都在 CLI_CATEGORIES 里（否则面板分组会漏掉它）");
}

/* ── ② 不编造安装命令（核实不到就留空） ── */
{
  const harness = cli.BUILTIN_CLI_AGENTS.find((entry) => entry.id === "builtin-harness-cli");
  ok(harness && harness.installCmd === "", "Harness CLI 没有公开包名 ⇒ installCmd 留空（⛔ 不编一条装不上的命令）");
  const claude = cli.BUILTIN_CLI_AGENTS.find((entry) => entry.id === "builtin-claude-code");
  ok(claude && /@anthropic-ai\/claude-code/.test(claude.installCmd), "Claude Code 写的是官方 npm 包名");
  const openclaw = cli.BUILTIN_CLI_AGENTS.find((entry) => entry.id === "builtin-openclaw");
  ok(openclaw && /npm (install|i) -g openclaw/.test(openclaw.installCmd), "OpenClaw 用的是官方站点的安装命令");
  // 反向：预置里不许出现"看起来像命令但没人核实"的占位（例如 <your-cli> / TODO）
  ok(cli.BUILTIN_CLI_AGENTS.every((entry) => !/TODO|<your|xxx/i.test(entry.installCmd)),
    "⛔ 预置里没有 TODO / 占位命令（占位命令 = 假装能装）");
}

/* ── ③ 规范化 ── */
{
  ok(cli.normalizeCliBin("C:\\\\tools\\\\claude.cmd") === "claude" && cli.normalizeCliBin('"openclaw.exe"') === "openclaw",
    "可执行名归一化：去路径、去引号、去 .cmd/.exe 后缀");
  const bad = cli.normalizeCliAgent({ name: "x", category: "不存在的分类", bin: "x" });
  ok(bad.category === "custom", "非法分类回落 custom（不回落到 coding 去冒充编码 CLI）");
  ok(cli.normalizeCliAgent({ name: "x", bin: "x" }).enabled === true
    && cli.normalizeCliAgent({ name: "x", bin: "x", enabled: false }).enabled === false,
    "enabled 缺省 true（默认可用）、只有显式 false 才算关");
}

/* ── ④ 内置 + 用户态合并 ── */
{
  const merged = cli.mergeCliAgents(cli.BUILTIN_CLI_AGENTS, [{ id: "builtin-openclaw", enabled: false }, { id: "my-cli", name: "我的 CLI", bin: "mine", category: "custom" }]);
  ok(merged.some((entry) => entry.id === "builtin-claude-code" && entry.builtin),
    "内置条目永远在（用户态里没提到也补回来 —— 否则升级后预置会消失）");
  ok(merged.find((entry) => entry.id === "builtin-openclaw")?.enabled === false,
    "用户对内置条的改动生效（关掉 OpenClaw）");
  ok(merged.some((entry) => entry.id === "my-cli" && !entry.builtin), "自定义条目追加进来（builtin=false）");
  ok(merged.filter((entry) => entry.id === "builtin-openclaw").length === 1, "同 id 不重复（合并按 id 覆盖，不是各来一份）");
}

/* ── ⑤ 保存 / 删除的硬约束（真落盘到临时 userData） ── */
{
  const noBin = await cli.saveCliAgent({ name: "空入口", bin: "" });
  ok(noBin.ok === false && /可执行名/.test(noBin.error ?? ""), "没有可执行名 ⇒ 拒绝保存（派不出去的条目不该进目录）");
  const saved = await cli.saveCliAgent({ name: "我的 CLI", bin: "mine", category: "custom", description: "探针" });
  ok(saved.ok === true && saved.item?.bin === "mine", "新增自定义 CLI 成功");
  const dup = await cli.saveCliAgent({ name: "我的 CLI", bin: "other" });
  ok(dup.ok === false && /已经有一个/.test(dup.error ?? ""), "重名被拒（@ 候选里两个同名 → 派错对象）");
  const delBuiltin = await cli.removeCliAgent("builtin-claude-code");
  ok(delBuiltin.ok === false && /关掉/.test(delBuiltin.error ?? ""), "内置条目不能删，只能关停（删了下次启动还会回来）");
  const delMine = await cli.removeCliAgent(saved.item.id);
  ok(delMine.ok === true, "自定义条目可以删");
  const after = await cli.readCliAgents();
  ok(after.length === cli.BUILTIN_CLI_AGENTS.length, "删完之后回到只有内置表的规模（用户态文件不残留）");
}

/* ── ⑥ 检测：找不到就是"没装"，不是异常 ── */
{
  const missing = await cli.detectCliAgent({ bin: "definitely-not-a-real-cli-9f3a" });
  ok(missing.installed === false && missing.error === "", "找不到的 CLI ⇒ installed=false 且不报错（没装是常态）");
  const empty = await cli.detectCliAgent({ id: "builtin-harness-cli", bin: "" });
  ok(typeof empty.installed === "boolean", "检测拿不到可执行名也不抛（面板上按「检测」不该炸）");
}

/* ── ⑦ 派活提示：不假装、不转派、安装命令只转述 ── */
{
  const withCmd = cli.buildCliRolePrompt({ name: "Claude Code", bin: "claude", description: "编码", promptHint: "", installCmd: "npm i -g x" });
  ok(/claude --help/.test(withCmd), "提示里要求先跑 `--help` 自检（确认本机可用）");
  ok(/本机没有安装/.test(withCmd) && /不要假装跑过/.test(withCmd), "⛔ 找不到命令要如实回报，不许假装跑过");
  ok(/npm i -g x/.test(withCmd) && /不要自己执行安装/.test(withCmd), "安装命令只**转述**，不自己执行");
  ok(/不要调用其他专家/.test(withCmd), "被派活的 CLI 会话不许再转派（防套娃）");
  const noCmd = cli.buildCliRolePrompt({ name: "Harness CLI", bin: "harness", description: "", promptHint: "", installCmd: "" });
  ok(/没有可复制的一键安装命令/.test(noCmd), "没有安装命令时写明「按它自己的分发方式装」—— 不编");
}

/* ── ⑧ 调度接线：目录 / 闸门 / 描述 / 解析（真跑 dispatch.js） ── */
{
  const probe = [{ kind: "cli", key: "builtin-claude-code", name: "Claude Code", profession: "编码 CLI", description: "编码 CLI" }];
  const resolved = dp.resolveDispatchTarget(probe, { kind: "cli", name: "Claude Code" });
  ok(resolved.target?.key === "builtin-claude-code", "resolveDispatchTarget 能按 kind+name 命中 CLI（模型传的是名字）");
  ok(dp.dispatchKindAllowed("cli", null).ok === true
    && dp.dispatchKindAllowed("cli", { expert: false, team: false, subagent: false, cli: false }).ok === true,
    "CLI 恒可派（面板没有它的开关，手改 false 也不生效）");
  ok(dp.filterTargetsBySwitch(probe, null).length === 1, "filterTargetsBySwitch 保留 CLI（否则目录给模型的清单里没有它）");
  const desc = dp.dispatchToolDescription([...probe, { kind: "team", key: "t1", name: "施工队", profession: "", description: "" }], { expert: true, team: false, subagent: true });
  ok(/【CLI 智能体（本机命令行工具）】/.test(desc) && desc.includes('kind="cli"'), "工具描述有独立的 CLI 分节（模型知道有这一类、以及什么时候选它）");
  ok(/kind=cli/.test(dp.dispatchToolDescription(probe, null)) || /命令行/.test(dp.dispatchToolDescription(probe, null)),
    "描述里说清 CLI 是「在本机调 shell 跑命令」，不是另一个专家");
}

/* ── ⑨ 接线（源码级）：目录来源 / 派活分支 / IPC 域 / 面板 ── */
{
  ok(/readUsableCliAgents/.test(coreSrc) && /kind: "cli"/.test(coreSrc),
    "buildDispatchCatalog 真的把 CLI 并进目录（含 kind=cli，⛔ 不塞进 subagent 冒充）");
  ok(/readUsableCliAgents/.test(delegationSrc) && /target\.kind === "cli"/.test(delegationSrc),
    "runDelegatedTask 有 cli 分支（否则派活会掉进「专家不存在」）");
  ok(!/buildCliRolePrompt/.test(delegationSrc) || /buildCliRolePrompt\(cli\)/.test(delegationSrc),
    "派活用的是 buildCliRolePrompt（提示词只有一处真相源）");
  ok(/cliagents:list/.test(ipcSrc) && /cliagents:detect/.test(ipcSrc) && /cliagents:save/.test(ipcSrc) && /cliagents:remove/.test(ipcSrc),
    "管理面四通道齐（list / detect / save / remove）");
  // ⛔ 面板不许自己执行安装：静默在用户机器上装东西是最不该有的"顺手"
  ok(!/execFile|spawn\(|npm install -g|child_process/.test(panelSrc),
    "⛔ 面板不执行任何安装动作（只复制命令）");
}

/* ── ⑩ @ 接入：分组 / 指令块 / 空态 / 类型 ── */
{
  const order = ["expert", "subagent", "cli", "team"];
  const groups = mentionSrc.match(/kind: "(expert|subagent|cli|team)"/g)?.map((hit) => hit.split('"')[1]) ?? [];
  ok(order.every((kind) => groups.includes(kind)), `@ 候选四类都在（${groups.join(" / ")}）`);
  ok(groups.indexOf("cli") < groups.indexOf("team"), "CLI 排在专家团之前（重的类别放最后）");
  ok(/kind=cli（CLI 智能体）/.test(mentionSrc) && /本机没装/.test(mentionSrc),
    "点名指令块写明 CLI 的失败转述规则（装了没装都要如实回）");
  ok(/CLI 智能体/.test(composerSrc), "@ 面板空态文案含 CLI（否则用户以为不支持）");
  ok(/kind: "expert" \| "team" \| "member" \| "subagent" \| "cli"/.test(dts), "DispatchTargetEntry 的 kind 联合含 cli");
  ok(/enum: \["expert", "team", "member", "subagent", "cli"\]/.test(segSrc), "渲染层 agent_invoke 的 schema 枚举含 cli（漏了 = 模型被前端拒）");
  ok(/enum: \["expert", "team", "member", "subagent", "cli"\]/.test(coreSrc), "主进程 MCP 的 schema 枚举含 cli");

  /* ⛔⛔ 触发入口本身也要钉：10-29 上半夜那版把 `@` 整体换成 `*`（引用上下文换触发符），
     `@ 点名` 只剩下面板渲染 + 芯片 + 发送注入 —— **没有任何地方 setContextOpen(true)**
     ⇒ 敲 @ 没反应，而文档写着"输入 @ 即弹候选"（声称能力）。这就是本仓最危险的那类假象。 */
  const forkSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part06/03-seg/02-context-fork-backup.tsx"), "utf8");
  ok(/lastIndexOf\("@"\)/.test(forkSrc) && /at > star/.test(forkSrc),
    "⛔ 输入 @ 真的会打开候选面板（按最后出现的 @ 与 * 分工，不再互相盖掉）");
  ok(/replace\(\/@\[\^\\n\]\*\$\/, ""\)/.test(forkSrc),
    "@ 选中后把查询词清到行尾（对象名带空格时 `/@[^\\s]*$/` 会留下半截名字）");
  /* 芯片标签：cli 必须显示成 CLI，不许落到「子智能体」那个 else（用户会以为点错了对象）。 */
  const mentionMod = await import(pathToFileURL(join(ROOT, "src/lib/dispatch-mention.mjs")).href);
  ok(mentionMod.mentionKindLabel("cli") === "CLI" && mentionMod.mentionKindLabel("subagent") === "子智能体",
    "点名芯片的标签映射有 cli（上一版三元没分支 ⇒ CLI 被显示成「子智能体」）");
  ok(/mentionKindLabel\(target\.kind\)/.test(readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"), "utf8")),
    "芯片真的走 mentionKindLabel（映射写了不用 = 装饰品）");

  /* ── 10-30 mac 审计：CLI 的「检测」与「派活执行」必须用**同一条增强 PATH** ──
     GUI 进程（尤其 darwin）PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，CLI 基本装在
     /opt/homebrew/bin 或 ~/.npm-global/bin ⇒ 直接继承 process.env.PATH 时：
       · which 找不到 ⇒ 面板永远「未检测到」（装得好好的）
       · sh -c "claude …" ⇒ command not found，派活 100% 失败
     症状都不报错，所以必须钉住，不能靠人记得。 */
  const runnerSrc = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  ok(/export function cliProcessEnv\(\)/.test(mainSrc) && /augmentedPath\(\)/.test(mainSrc),
    "cli-agents 有统一的增强 PATH（cliProcessEnv = augmentedPath，不是继承 process.env.PATH）");
  ok(/locateBinary[\s\S]{0,700}?env: cliProcessEnv\(\)/.test(mainSrc),
    "检测（where/which）走增强 PATH —— ⛔ 否则 mac 上装了也永远显示未检测到");
  ok(/probeVersion[\s\S]{0,600}?env: cliProcessEnv\(\)/.test(mainSrc),
    "取版本号的子进程也走增强 PATH（CLI 多是 node/python 脚本，要能再找到自己的 runtime）");
  ok(/runCliMember[\s\S]{0,2000}?env: cliProcessEnv\(\)/.test(runnerSrc),
    "派活执行（boss 群 CLI 成员）走同一条增强 PATH —— ⛔ 只修检测不修执行 = 检测得到、跑不起来");
  ok(/process\.platform === "win32" \? "where" : "which"/.test(mainSrc),
    "平台分叉只发生在一处（win `where` / 其余 `which`，⛔ 不许写死 where）");

  /* ── 10-30 mac 指令适配：安装命令必须「本机跑得通」 ──
     事故类型同 mac 的 `where`：命令本身合法，只是在 mac 上不存在（裸 pip）。
     判据：凡是**不是 npm** 的安装命令，必须给 mac 变体；否则 mac 用户复制了也装不上。 */
  const presets2 = cli.BUILTIN_CLI_AGENTS;
  ok(presets2.every((entry) => typeof entry.installCmdMac === "string"),
    "每条预置都带 installCmdMac 字段（空串 = 两端同一条命令，不是「忘了填」）");
  const nonNpm = presets2.filter((entry) => entry.installCmd && !/^npm (install|i) -g /.test(entry.installCmd));
  ok(nonNpm.every((entry) => Boolean(entry.installCmdMac)),
    `非 npm 的安装命令都给了 mac 变体（实得 ${nonNpm.map((e) => e.name + "→" + (e.installCmdMac || "缺")).join(" / ") || "无"}）`);
  ok(presets2.find((entry) => entry.id === "builtin-aider")?.installCmdMac === "python3 -m pip install aider-chat",
    "Aider 的 mac 变体是 `python3 -m pip install aider-chat`（mac 上多数环境没有裸 pip）");
  ok(/function withPlatformCmd\(preset: CliAgentDef\)[\s\S]{0,220}?process\.platform === "darwin" && preset\.installCmdMac/.test(mainSrc),
    "平台替换只在 darwin 生效、且只对「有 mac 变体」的条目生效");
  ok(/const base = withPlatformCmd\(preset\);[\s\S]{0,160}?\.\.\.base, \.\.\.override/.test(mainSrc),
    "⛔ 先换平台命令再盖用户改动（反序 = 用户改过的安装命令被 mac 变体盖回去）");
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n【cliagents】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
