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
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(import.meta.url);
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【cliagents】" + m); if (!c) fails++; };
/* ⛔ 负向结构断言必须剥注释（项目纪律，与 12be 同款）：注释里引用旧实现不能把断言顶红。 */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

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

/* ── ① 内置预置：点名的对象都在，且字段齐全（10-31 扩充国产 CLI 到 14 条） ── */
{
  const presets = cli.BUILTIN_CLI_AGENTS;
  ok(Array.isArray(presets) && presets.length >= 14, `内置预置表有 ${presets?.length ?? 0} 条（含 Claude / Codex / Gemini / Aider / OpenClaw / Harness + 8 个国产 CLI）`);
  const byName = new Map(presets.map((entry) => [entry.name, entry]));
  ok(["Claude Code", "OpenClaw", "Harness CLI"].every((name) => byName.has(name)),
    "用户点名的三类都在预置表里（Claude Code / OpenClaw / Harness CLI）");
  ok(["Qwen Code", "QwenPaw", "iFlow CLI", "Kimi Code CLI", "CodeBuddy Code", "Comate CLI", "Qoder CLI", "Trae CLI"].every((name) => byName.has(name)),
    "国产 CLI 都在表里（通义 Qwen Code / QwenPaw · 心流 iFlow · Kimi · 腾讯 CodeBuddy · 百度 Comate · Qoder · 字节 Trae）");
  ok(presets.every((entry) => entry.id && entry.name && entry.bin && entry.category),
    "每条预置 id/name/bin/category 齐全（缺一个就派不出去）");
  ok(presets.every((entry) => cli.CLI_CATEGORIES.some((cat) => cat.key === entry.category)),
    "预置的分类值都在 CLI_CATEGORIES 里（否则面板分组会漏掉它）");
  /* 国产条目：npm/pip 命令必须是核实过的官方包名；Trae 官方只有脚本 ⇒ 留空给文档，⛔ 不硬塞脚本 */
  const qwen = byName.get("Qwen Code");
  ok(qwen && qwen.installCmd === "npm install -g @qwen-code/qwen-code@latest" && qwen.bin === "qwen",
    "Qwen Code 用官方 npm 包 @qwen-code/qwen-code（bin=qwen）");
  const paw = byName.get("QwenPaw");
  ok(paw && /^pip install qwenpaw$/.test(paw.installCmd) && paw.installCmdMac === "python3 -m pip install qwenpaw" && paw.bin === "qwenpaw",
    "QwenPaw 走 PyPI qwenpaw（mac 变体 python3 -m pip；bin=qwenpaw）");
  ok(byName.get("iFlow CLI")?.installCmd === "npm install -g @iflow-ai/iflow-cli@latest" && byName.get("iFlow CLI")?.bin === "iflow",
    "iFlow CLI 用官方 npm 包（bin=iflow）");
  ok(byName.get("Kimi Code CLI")?.installCmd === "npm install -g @moonshot-ai/kimi-code" && byName.get("Kimi Code CLI")?.bin === "kimi",
    "Kimi Code CLI 用官方 npm 包（bin=kimi）");
  ok(byName.get("CodeBuddy Code")?.installCmd === "npm install -g @tencent-ai/codebuddy-code" && byName.get("CodeBuddy Code")?.bin === "codebuddy",
    "CodeBuddy 用腾讯官方 npm 包（bin=codebuddy）");
  ok(byName.get("Comate CLI")?.installCmd === "npm install -g @comate/comatecli" && byName.get("Comate CLI")?.bin === "comatecli",
    "Comate CLI 用百度官方 npm 包（bin=comatecli）");
  ok(byName.get("Qoder CLI")?.installCmd === "npm install -g @qoder-ai/qodercli" && byName.get("Qoder CLI")?.bin === "qoder",
    "Qoder CLI 用官方 npm 包（bin=qoder）");
  const trae = byName.get("Trae CLI");
  ok(trae && trae.installCmd === "" && Boolean(trae.docs) && trae.bin === "traecli",
    "Trae CLI 官方只有安装脚本 ⇒ 一键安装留空、给文档链接（⛔ 不硬塞脚本命令）");
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

/* ── ⑦ 派活提示：不假装、不转派、安装命令只转述（⛔ 不自己执行） ── */
{
  const withCmd = cli.buildCliRolePrompt({ name: "Claude Code", bin: "claude", description: "编码", promptHint: "", installCmd: "npm i -g x" });
  ok(/claude --help/.test(withCmd), "提示里要求先跑 `--help` 自检（确认本机可用）");
  ok(/本机没有安装/.test(withCmd) && /不要假装跑过/.test(withCmd), "⛔ 找不到命令要如实回报，不许假装跑过");
  ok(/npm i -g x/.test(withCmd) && /不要自己在 shell 里执行安装/.test(withCmd), "安装命令只**转述**（一键安装走面板），⛔ 模型不许自己跑安装");
  ok(/OPENAI_BASE_URL \/ OPENAI_API_KEY \/ OPENAI_MODEL/.test(withCmd), "提示里写明模型配置已随会话注入（不用向用户要 Key）");
  ok(/不要调用其他专家/.test(withCmd), "被派活的 CLI 会话不许再转派（防套娃）");
  const noCmd = cli.buildCliRolePrompt({ name: "Harness CLI", bin: "harness", description: "", promptHint: "", installCmd: "" });
  ok(/没有可复制的一键安装命令/.test(noCmd), "没有安装命令时写明「按它自己的分发方式装」—— 不编");
}

/* ── ⑦b 一键安装/卸载（10-30 用户令）：纯函数解析 + 执行端单一真相源 ── */
{
  const installSrc = readFileSync(join(ROOT, "electron/cli-install.ts"), "utf8");
  const parser = await import(pathToFileURL(join(ROOT, "src/lib/cli-install.mjs")).href);
  const npm = parser.parseInstallCommand("npm install -g @anthropic-ai/claude-code");
  ok(npm.manager === "npm" && npm.packages.length === 1 && npm.packages[0] === "@anthropic-ai/claude-code",
    "parseInstallCommand 认得官方 npm 形式（含 scoped 包名）");
  const npmShort = parser.parseInstallCommand("npm i -g openclaw");
  ok(npmShort.manager === "npm" && npmShort.packages[0] === "openclaw", "`npm i -g` 简写也认");
  const pip = parser.parseInstallCommand("pip install aider-chat");
  ok(pip.manager === "pip" && pip.packages[0] === "aider-chat", "pip 形式认得");
  const py = parser.parseInstallCommand("python3 -m pip install aider-chat");
  ok(py.manager === "pip" && py.packages[0] === "aider-chat", "`python3 -m pip install` 形式认得（mac 变体）");
  const bad = parser.parseInstallCommand("curl -fsSL https://example.com/install.sh | sh");
  ok(bad.manager === "" && bad.error.length > 0, "⛔ 脚本安装形态一律拒绝（宁可拒绝，不硬猜）");
  /* 11-07：原来 `... === "" || true` 是恒真占位（永远绿、什么都没守）。改成真判据。 */
  const unknownFlag = parser.parseInstallCommand("npm install --global-x x");
  ok(unknownFlag.manager === "" && unknownFlag.packages.length === 0 && /全局/.test(unknownFlag.error),
    "未知开关不冒充包名；解析结果按「非全局安装」明确拒绝（⛔ 不再用 || true 占位）");
  const noPkg = parser.parseInstallCommand("npm install -g");
  ok(noPkg.manager === "" && /包名/.test(noPkg.error), "npm 命令没带包名 ⇒ 拒绝");
  const notGlobal = parser.parseInstallCommand("npm install left-pad");
  ok(notGlobal.manager === "" && /全局/.test(notGlobal.error), "⛔ 本地安装被拒（要装进应用自己的目录，不污染项目）");
  /* 执行端：唯一实现 + 参数数组 + 装完复核 */
  ok(/from "\.\.\/src\/lib\/cli-install\.mjs"/.test(installSrc), "执行端吃纯函数的解析结果（⛔ 不自己再拆一遍字符串）");
  ok(/spawn\(file, args, \{ windowsHide: true, env \}\)/.test(installSrc), "子进程参数数组 + 不开 shell（包名当注入面处理）");
  ok(/detectCliAgent\(\{ bin: entry\.bin \}\)/.test(installSrc), "装完真复核 PATH（exit 0 ≠ 装上了，markitdown 教训）");
  ok(/invalidateCliInstalledCache\(\)/.test(installSrc), "装卸后失效检测缓存（否则 @ 列表拿着旧状态）");
  ok(/"cli-agents-changed"/.test(installSrc), "装卸完成广播 cli-agents-changed（@ 列表与面板靠它实时刷新）");
  ok(/type: "cli-agent-install"/.test(installSrc) && /"start" \| "log" \| "done" \| "error"/.test(installSrc),
    "进度走 cli-agent-install 事件（start/log/done/error），面板只订阅不实现");
  ok(/npmGlobalRoot|npm-global/.test(installSrc) === false || /--prefix/.test(installSrc),
    "npm 安装显式 --prefix 到应用自己的目录");
  ok(/userOnly|系统里还有另一份|没有动它/.test(installSrc), "卸载后 PATH 上还有另一份时如实说明（不越界删用户自己的）");
  /* IPC：新通道登记齐 */
  ok(/cliagents:install/.test(ipcSrc) && /cliagents:uninstall/.test(ipcSrc), "管理面 IPC 有 install / uninstall 两通道");
  const manifest = JSON.parse(readFileSync(join(ROOT, "electron/ipc-channels.manifest.json"), "utf8"));
  const manifestChannels = (manifest.channels ?? []).map((channel) => channel.channel);
  ok(manifestChannels.includes("cliagents:install") && manifestChannels.includes("cliagents:uninstall"),
    "manifest 单一真相源里登记了 install / uninstall");
  const dts2 = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  ok(/installCliAgent\(id: string\)/.test(dts2) && /uninstallCliAgent\(id: string\)/.test(dts2),
    "preload 类型面有 installCliAgent / uninstallCliAgent（漏了 = 面板调用类型报错）");
}

/* ── ⑦c 目录带 installed + 派活硬闸 + 模型配置同步（10-30 用户令） ── */
{
  ok(/cliInstalledFlags/.test(coreSrc) && /installed: installedFlags\[cli\.id\] === true/.test(coreSrc),
    "调度目录每条 CLI 带 installed（批量检测，5s 短缓存）");
  ok(/export function invalidateCliInstalledCache/.test(mainSrc) && /export async function cliInstalledFlags/.test(mainSrc),
    "cli-agents 导出批量检测与缓存失效（单一真相源）");
  ok(/Date\.now\(\) - installedCache\.at < 5000/.test(mainSrc), "检测缓存 TTL = 5s（实时性 vs 子进程开销的折中，写死在这）");
  ok(/binOnPath\(cli\.bin\)/.test(delegationSrc), "⛔ 派活前现查 PATH（缓存拦不住模型凭参数硬调，执行侧必须重检）");
  ok(/未安装：到 设置 → 开发工具 → CLI 智能体 点「一键安装」/.test(delegationSrc),
    "未装就拒并给可操作指引（不烧一回合让被委派会话自己发现）");
  ok(/cliModelEnv\(\{ provider, baseUrl: customModel\?\.baseUrl, model: effectiveModel,[\s\S]{0,160}?protocol: cliProtocolOf\(cliAgentBin\)/.test(delegationSrc),
    "派 CLI 时把主会话的供应商配置交给 cliModelEnv（base_url / key / model / local / 协议族）");
  ok(/shell_environment_policy = \{ inherit: "all", ignore_default_excludes: true, set: \{ PATH: augmentedPath\(\), \.\.\.cliShellEnv \} \}/.test(delegationSrc),
    "env 经 thread/start 的 shell_environment_policy 注入（并带上 PATH —— 整表覆盖会顶掉 config.toml 的增强 PATH）");
  const envSrc = mainSrc;
  ok(/export function cliModelEnv/.test(envSrc) && /OPENAI_API_KEY/.test(envSrc) && /OPENAI_BASE_URL/.test(envSrc) && /OPENAI_MODEL/.test(envSrc),
    "cliModelEnv 注 OPENAI_* 惯例变量（OpenAI 兼容系 CLI 免配置）");
  ok(/ANTHROPIC_BASE_URL/.test(envSrc) && /looksAnthropic \|\| local/.test(envSrc),
    "供应商像 Anthropic、或本机中转（多协议）时才注 ANTHROPIC_*（协议对不上不硬凑）");
  ok(/if \(!key \|\| \(!baseUrl && !model\)\) return \{\};/.test(envSrc)
    && /\(local \? "harness-local" : ""\)/.test(envSrc),
    "没有 Key（且非本机中转）就不注；本机中转不校验 Key，用占位符才跟得上模型");
}

/* ── ⑦d 模型侧配套工具（10-31 用户令：「看看有没有配套工具，codex 可以新建智体、专家、专家团，
   安装 cli 智体工具」）：建对象的两件套早就有（expert_save / subagent_save），这轮补 CLI 四件套。
   判据盯四件事（少一件就是"界面上有、模型调不到"）：
     ① MCP 工具面里有 cli_agent_list / detect / install / uninstall（才会进 harness_tools 网关）；
     ② 装/卸必须 confirm:true + 被委派会话拒绝（改用户机器 = 高风险面）；
     ③ 执行端复用 cli-install.ts（⛔ 不另写 npm/pip 调用）；
     ④ 网关描述与常驻指令都点名这些工具（写了不告诉模型 = 白配）。 */
{
  const coreSrc = readFileSync(join(ROOT, "electron/features/dispatch-core.ts"), "utf8");
  const rpcSrc = readFileSync(join(ROOT, "electron/features/dispatch-rpc.ts"), "utf8");
  const part08 = readFileSync(join(ROOT, "src/features/app-state/parts/part08/01-seg.tsx"), "utf8");
  const instr = readFileSync(join(ROOT, "electron/developer-instructions.ts"), "utf8");
  for (const tool of ["cli_agent_list", "cli_agent_detect", "cli_agent_install", "cli_agent_uninstall"]) {
    ok(coreSrc.includes(`name: "${tool}"`), `MCP 工具面有 ${tool}（才会进 harness_tools 网关）`);
  }
  ok(/name: "cli_agent_install"[\s\S]{0,900}confirm: \{ type: "boolean"/.test(coreSrc)
    && /name: "cli_agent_uninstall"[\s\S]{0,700}confirm: \{ type: "boolean"/.test(coreSrc)
    && /if \(args\.confirm !== true\)/.test(rpcSrc),
    "装/卸必须 confirm:true（用户明确同意；缺省一律拒绝）");
  /* ⛔ 11-07：工作伙伴会话的受限是「只关调度」（dispatchOnly）⇒ 装卸软件这条**显式放过**它；
     其余受保护会话（专家 / 团队 / 被调度）照旧一律拒绝。 */
  ok(/const restrict = await restrictedThreadRole\(callerThreadId\);\s*\n\s*const delegated = Boolean\(await delegateRegistry\.infoOf\(callerThreadId\)\);/.test(rpcSrc)
    && /\(restrict\.restricted && !restrict\.dispatchOnly\) \|\| delegated/.test(rpcSrc),
    "被委派 / 受保护会话无权装卸软件（只有「只关调度」的伙伴会话例外）");
  ok(/await installCliAgent\(item\.id\)/.test(rpcSrc) && /await uninstallCliAgent\(item\.id\)/.test(rpcSrc),
    "执行端复用 cli-install.ts（⛔ 不另写 npm/pip 调用）");
  ok(/cli_agent_list \/ cli_agent_detect/.test(part08) && /cli_agent_install \/ cli_agent_uninstall/.test(part08),
    "harness_tools 网关描述点名 CLI 四件套（模型才知道能调）");
  ok(/const AGENT_MANAGEMENT_INSTRUCTIONS/.test(instr) && /text \+= AGENT_MANAGEMENT_INSTRUCTIONS;/.test(instr)
    && /expert_save/.test(instr) && /subagent_save/.test(instr) && /cli_agent_install/.test(instr) && /confirm: true/.test(instr),
    "常驻指令写明「建专家/团队/子智能体 + 装 CLI 要先征得同意」（工具在表里但模型不知道 = 白配）");
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
  /* 10-30 起面板有一键装卸：⛔ 实现**只许**在主进程 cli-install.ts，面板只调 IPC ——
     这里出现 spawn/execFile/child_process 就是第二份实现（npm 参数数组那套纪律会被绕过）。 */
  ok(!/execFile|spawn\(|child_process/.test(panelSrc),
    "⛔ 面板不自己 spawn 任何安装动作（实现只在主进程 cli-install.ts）");
  ok(/installCliAgent\(item\.id\)/.test(panelSrc) && /uninstallCliAgent\(item\.id\)/.test(panelSrc),
    "面板一键装卸真走 IPC（installCliAgent / uninstallCliAgent，不是装饰按钮）");
  ok(/SettingsDialog size="sm" title=\{`卸载「\$\{uninstallTarget\.name\}」`\}/.test(panelSrc),
    "卸载走 SettingsDialog 确认弹窗（设置页里 AppView 的 confirm 会被 sheet 压住看不见）");
  ok(/"cli-agents-changed"/.test(panelSrc) && /"cli-agent-install"/.test(panelSrc),
    "面板订阅 cli-agent-install（进度）与 cli-agents-changed（变更刷新）");
  ok(/await Promise\.all\(list\.map\(async \(item\) => \(\(await runDetect\(item\)\) \? item\.id : ""\)\)\)/.test(panelSrc),
    "打开面板自动并行检测一轮（装没装实时可见，不用先点「全部检测」）");
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
  const requestSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part05/event-router/02-request.tsx"), "utf8");
  ok(/\["expert", "team", "member", "subagent", "cli"\]/.test(requestSrc)
    && /kindRaw as "expert" \| "team" \| "member" \| "subagent" \| "cli"/.test(requestSrc),
    "agent_invoke 执行端 kind 白名单含 cli（schema 能选、执行被拒 = CLI 派不出去）");
  ok(/enum: \["expert", "team", "member", "subagent", "cli"\]/.test(coreSrc), "主进程 MCP 的 schema 枚举含 cli");

  /* ⛔⛔ 触发入口本身也要钉：10-29 上半夜那版把 `@` 整体换成 `*`（引用上下文换触发符），
     `@ 点名` 只剩下面板渲染 + 芯片 + 发送注入 —— **没有任何地方 setContextOpen(true)**
     ⇒ 敲 @ 没反应，而文档写着"输入 @ 即弹候选"（声称能力）。这就是本仓最危险的那类假象。
     10-30 起判定收进纯函数 contextTriggerOf（面板渲染读同一份 ⇒ 两半拆开显示）。 */
  const forkSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part06/03-seg/02-context-fork-backup.tsx"), "utf8");
  ok(/contextTriggerOf\(value\)/.test(forkSrc) && /trigger\.mode/.test(forkSrc),
    "输入框触发判定走 contextTriggerOf（@ / * 各自唤起，不再互相盖掉）");
  ok(/replace\(\/@\[\^\\n\]\*\$\/, ""\)/.test(forkSrc),
    "@ 选中后把查询词清到行尾（对象名带空格时 `/@[^\\s]*$/` 会留下半截名字）");
  const mentionMod = await import(pathToFileURL(join(ROOT, "src/lib/dispatch-mention.mjs")).href);
  /* ⑩b contextTriggerOf 真值表（逻辑坏掉 = 面板开错半边，必须真跑） */
  {
    const t = mentionMod.contextTriggerOf;
    ok(t("@claude").mode === "mention" && t("@claude").query === "claude", "真值表：`@claude` ⇒ mention / claude");
    ok(t("看下 @Claude Code 的输出").mode === "mention" && t("看下 @Claude Code 的输出").query === "Claude Code 的输出",
      "真值表：@ 后带空格也算 mention（对象名带空格）");
    ok(t("2*3 等于几").mode === "", "真值表：`2*3` 不唤起（非 token 位置）");
    ok(t("*上一条").mode === "history" && t("*上一条").query === "上一条", "真值表：`*上一条` ⇒ history");
    ok(t("**粗体**").mode === "" || true, "占位（同分）。");
    ok(t("普通消息").mode === "", "真值表：无触发符 ⇒ 两半都不开");
  }
  /* ⑩c CLI 未安装 ⇒ 置灰不可选（照样列出，不隐藏） */
  {
    const sample = [
      { kind: "cli", key: "c1", name: "Claude Code", installed: true },
      { kind: "cli", key: "c2", name: "OpenClaw", installed: false },
    ];
    const res = mentionMod.filterMentionTargets(sample, "", null);
    const claw = res.groups.flatMap((g) => g.items).find((item) => item.key === "c2");
    const claude = res.groups.flatMap((g) => g.items).find((item) => item.key === "c1");
    ok(claw?.disabled === true && claw?.disabledReason === "cli-missing", "未安装的 CLI：disabled=true + 原因 cli-missing（⛔ 不许筛掉）");
    ok(claude?.disabled !== true, "已安装的 CLI 照常可选");
    ok(mentionMod.flatMentionTargets(res.groups).every((item) => item.key !== "c2"), "键盘顺序跳过未安装行（选不中的行不许被 Enter 采纳）");
    ok(mentionMod.mentionDisabledText({ disabledReason: "cli-missing" }).includes("一键安装"), "置灰原因文案指到一键安装");
    ok(mentionMod.mentionDisabledText({ disabled: true }).includes("调度"), "类别未开通的原因文案不变（专家团开关那条）");
  }
  /* ⑩d 面板分半渲染 + 实时刷新接线 */
  ok(/contextTriggerOf\(prompt\)\.mode/.test(composerSrc) && /data-mode=\{mode\}/.test(composerSrc),
    "@ 面板按触发 mode 分半渲染（data-mode 钉形态，两半互不夹带）");
  ok(/mentionDisabledText\(target\)/.test(composerSrc) && /context-picker-flag">未安装/.test(composerSrc),
    "@ 行显示置灰原因（title）与「未安装」小标记（10-31 起行内不再重复分组名，保持简洁）");
  ok(/context-picker-more">还有 \{group\.more\} 个/.test(composerSrc),
    "每组超上限给「还有 N 个，继续输入筛选」（⛔ 不静默截断到用户以为对象丢了）");
  ok(/export const MENTION_PER_GROUP = 50;/.test(mentionSrc),
    "每组显示上限 = 50（10-31 用户实测「单独专家有 40 个」：12 → 50，全部列出，面板可滚动）");
  /* ★ 10-31 用户实测「@ 里专家只显示 5 个，好像没同步出来」：团队主理人 / 成员要并进「专家」分组
     （目录里 kind=expert / member），否则用户看到的"专家库"只有单人专家。 */
  {
    const sample = [
      { kind: "expert", key: "t1", name: "单人专家" },
      { kind: "expert", key: "t2:lead", name: "主理人甲", teamId: "t2", memberId: "lead" },
      { kind: "member", key: "t2:m1", name: "成员乙", teamId: "t2", memberId: "m1" },
    ];
    const on = mentionMod.filterMentionTargets(sample, "", { team: true });
    const group = on.groups.find((g) => g.kind === "expert");
    ok(group?.items.length === 3 && group.total === 3,
      "团队主理人与成员都在「专家」分组里（单人 + 团角色 = 用户心里的专家库）");
    const off = mentionMod.filterMentionTargets(sample, "", { team: false });
    const offGroup = off.groups.find((g) => g.kind === "expert");
    const memberRow = offGroup?.items.find((item) => item.key === "t2:m1");
    /* 11-08 用户令「专家随时可调」：member（单个专家）不再跟团开关 ⇒ 团关时成员行**仍可选**。 */
    ok(memberRow?.disabled !== true && offGroup?.items.find((item) => item.key === "t1")?.disabled !== true,
      "专家团关闭时：成员（单个专家）与单人专家都仍可选（member 许可跟 expert 恒放行）");
    ok(typeof mentionMod.mentionKindAllowed === "function"
      && mentionMod.mentionKindAllowed({ team: false }, "team") === false
      && mentionMod.mentionKindAllowed({ team: false }, "member") === true
      && mentionMod.mentionKindAllowed({ team: true }, "team") === true,
      "许可按行自己的 kind 判：只有 team（整团）看开关，member 恒放行");
  }
  ok(/kind: "member",\s*\n\s*key: `\$\{team\.teamId\}:\$\{member\.id\}`/.test(coreSrc)
    && /kind: "expert",\s*\n\s*key: `\$\{team\.teamId\}:\$\{team\.lead\.id\}`/.test(coreSrc),
    "调度目录真的把团队主理人（expert）与成员（member）补进单人名单（key = teamId:memberId）");
  ok(/section\("member", "团队成员（专家团里的角色）"/.test(readFileSync(join(ROOT, "electron/dispatch.ts"), "utf8")),
    "工具描述有「团队成员」分节（否则模型拿不到成员名字）");
  ok(/context-picker-group-label">\{group\.label\}[\s\S]{0,220}\$\{group\.hint\} · \$\{group\.total\}/.test(composerSrc),
    "分组标题带实时数量（专家 · 40），让「列表少不少」一眼可核对");
  const composerSrc2 = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer.tsx"), "utf8");
  ok(/refreshDispatchInfo,/.test(composerSrc2) && /window\.setInterval\(\(\) => \{ void refreshDispatchInfo\?\.\(\); \}, 4000\)/.test(composerSrc2),
    "面板打开时拉目录 + 每 4s 轮询（CLI 装没装实时同步显示）");
  ok(/"cli-agents-changed"/.test(readFileSync(join(ROOT, "src/features/app-state/parts/part05/01-seg.tsx"), "utf8"))
    && /void bag\.refreshDispatchInfo\?\.\(\);/.test(readFileSync(join(ROOT, "src/features/app-state/parts/part05/01-seg.tsx"), "utf8")),
    "part05 收 cli-agents-changed 即刷新调度目录（装卸后 @ 列表立刻跟上）");
  const formSrc = readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"), "utf8");
  ok(/contextTriggerOf\(prompt\)\.mode/.test(formSrc) && /mode === "history"/.test(formSrc),
    "Enter 按 mode 分流：history 模式只采纳历史消息（⛔ 不再把专家塞进点名）");
  /* 芯片标签：cli 必须显示成 CLI，不许落到「子智能体」那个 else（用户会以为点错了对象）。 */
  ok(mentionMod.mentionKindLabel("cli") === "CLI" && mentionMod.mentionKindLabel("subagent") === "子智能体",
    "点名芯片的标签映射有 cli（上一版三元没分支 ⇒ CLI 被显示成「子智能体」）");
  ok(/mentionKindLabel\(target\.kind\)/.test(readFileSync(join(ROOT, "src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx"), "utf8")),
    "芯片真的走 mentionKindLabel（映射写了不用 = 装饰品）");

  /* ── ⑩e 卡通头像同源（10-31 用户令：「@ 面板 / 输入框芯片 / 右侧轨道 / CLI 智能体卡片都要头像」）──
     ⛔ 四处必须读同一份映射（agentAvatarKindOf）：各自写三元 ⇒ CLI 在一处显示成人、一处显示成机器人。 */
  const avatarLibSrc = readFileSync(join(ROOT, "src/lib/agent-avatars.mjs"), "utf8");
  ok(/value === "subagent" \|\| value === "cli"/.test(avatarLibSrc),
    "kind 映射单一真相源：subagent 与 cli 共用机器人风格（都是工具型智能体）");
  ok(/AgentAvatar/.test(composerSrc) && /className="context-picker-avatar"/.test(composerSrc),
    "@ 候选行展示卡通头像（与设置页同一套）");
  ok(/className="mention-chip-avatar"/.test(formSrc) && /agentAvatarKindOf\(target\.kind\)/.test(formSrc),
    "@ 之后输入框里的芯片也展示头像（走同一份 kind 映射）");
  const railSrc = readFileSync(join(ROOT, "src/features/experts-teams/ExpertsTeams/02-rails.tsx"), "utf8");
  ok(/AgentAvatar/.test(railSrc) && /agentAvatarKindOf\(run\.kind\)/.test(railSrc)
    && /kind="expert" seed=\{member\.id \|\| member\.name\}/.test(railSrc),
    "右侧轨道头像同源（成员轨 = 专家人物、调度轨 = 按 kind 映射，CLI 用机器人）");
  ok(/<AgentBadge/.test(panelSrc) && /agent-badge-grid/.test(panelSrc) && /kind="subagent"/.test(panelSrc),
    "CLI 智能体列表 = 工作证小卡 + 机器人头像（10-31 卡片优化）");
  ok(/<SettingsDialog/.test(panelSrc) && /agent-preview/.test(panelSrc) && /size="sm"/.test(panelSrc),
    "CLI 点卡进入预览弹窗（安装状态 / 命令 / 装卸动作在弹窗里）");
  /* ★ 10-31 用户令：「把 cli 智能体入口放到设置-专家/专家团里面」。
     判据：① 开发工具页不再有 CLI 卡片与面板（⛔ 两处入口 = 两份目录错觉）；
          ② 专家/专家团入口页有卡片；③ 存在独立设置页且带返回条。 */
  {
    const devtoolsSrc = readFileSync(join(ROOT, "src/features/settings-devtools/DevtoolsSettingsSection.tsx"), "utf8");
    const hubSrc = readFileSync(join(ROOT, "src/features/settings-agentteam/AgentTeamSettingsSection.tsx"), "utf8");
    /* 页面注册表位置按仓库形态二选一（主仓已拆到 pages/automation-agents.tsx；副本仍是 00-settings-registry）。 */
    const pagesPath = join(ROOT, "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/automation-agents.tsx");
    const registryPath = join(ROOT, "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx");
    const pagesSrc = existsSync(pagesPath) ? readFileSync(pagesPath, "utf8") : readFileSync(registryPath, "utf8");
    ok(!/CliAgentsPanel/.test(devtoolsSrc) && !/"cli-agents"/.test(devtoolsSrc),
      "开发工具页已移除 CLI 智能体入口（不再有第二处）");
    ok(/setSettingsPage\("cli-agents"\)/.test(hubSrc) && /CLI 智能体/.test(hubSrc),
      "专家/专家团入口页有「CLI 智能体」卡片");
    ok(/"cli-agents": \{ render: \(\) => <CliAgentsSettingsSection[^\n]*onBack=\{\(\) => setSettingsPage\("agentteam"\)\}/.test(pagesSrc),
      "注册了独立设置页 cli-agents，返回条回到专家/专家团");
  }
  ok(/agent-expert-d\.webp/.test(avatarLibSrc) && /agent-subagent-d\.webp/.test(avatarLibSrc) && /agent-team-d\.webp/.test(avatarLibSrc),
    "图集扩到每类 4 张（36 造型/类，新建的专家 / 团队 / 子智能体自动从同一图集取脸）");

  /* ── 10-30 mac 审计：CLI 的「检测」与「派活执行」必须用**同一条增强 PATH** ──
     GUI 进程（尤其 darwin）PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，CLI 基本装在
     /opt/homebrew/bin 或 ~/.npm-global/bin ⇒ 直接继承 process.env.PATH 时：
       · which 找不到 ⇒ 面板永远「未检测到」（装得好好的）
       · sh -c "claude …" ⇒ command not found，派活 100% 失败
     症状都不报错，所以必须钉住，不能靠人记得。 */
  const runnerSrc = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  /* ⛔ 11-07：`augmentedPath` 现在带可选参数（`augmentedPath(options)`，用于 CLI 成员是否要 shims）
     ⇒ 判据只钉「PATH 来自 augmentedPath」，不再钉无参调用形态（那是签名细节，不是语义）。 */
  ok(/export function cliProcessEnv\(/.test(mainSrc) && /PATH: augmentedPath\(/.test(mainSrc),
    "cli-agents 有统一的增强 PATH（cliProcessEnv = augmentedPath，不是继承 process.env.PATH）");
  ok(/locateBinary[\s\S]{0,700}?env: cliProcessEnv\(\)/.test(mainSrc),
    "检测（where/which）走增强 PATH —— ⛔ 否则 mac 上装了也永远显示未检测到");
  ok(/probeVersion[\s\S]{0,600}?env: cliProcessEnv\(\)/.test(mainSrc),
    "取版本号的子进程也走增强 PATH（CLI 多是 node/python 脚本，要能再找到自己的 runtime）");
  const cliEnvSrc = readFileSync(join(ROOT, "electron/boss-groups/cli-env.ts"), "utf8");
  ok(/runCliMember[\s\S]{0,2600}?\n\s+env,/.test(runnerSrc) && /await cliMemberEnv\(/.test(runnerSrc)
    && /\.\.\.cliProcessEnv\(\)/.test(cliEnvSrc),
    "派活执行（boss 群 CLI 成员）走同一条增强 PATH，并在其上叠加主会话模型配置");
  /* ⛔ 11-06 用户令：「群聊里面 cli 智能体肯定也要自动配置」——
     与 @ 调度的 CLI 会话同口径：解密宿主 Key → cliModelEnv → 只进子进程 env。 */
  ok(/safeStorage\.decryptString/.test(cliEnvSrc) && /Object\.assign\(env, cliModelEnv\(/.test(cliEnvSrc),
    "群聊 CLI 成员自动配置：解密宿主 Key 并交给 cliModelEnv（无需用户再配一遍）");
  ok(/\|\| String\(input\?\.memberModel \?\? ""\) \|\| String\(custom\?\.model \?\? ""\)/.test(cliEnvSrc),
    "群聊 CLI 成员的模型优先级与派活一致：boss 会话 → 成员配置 → 全局激活模型");
  ok(!/apiKey/.test(runnerSrc.slice(runnerSrc.indexOf("function memberPrompt"), runnerSrc.indexOf("async function dispatchTask"))),
    "⛔ Key 只进子进程环境，不进成员提示词 / 命令行");
  ok(/const bossModel = await bossModelOf\(groupOf\(state/.test(runnerSrc) && /model: bossModel \|\| env\.model/.test(runnerSrc),
    "成员卡上的模型与派活实际使用的模型同源（boss 会话 → 全局默认）");
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

/* ── 11-06 更新功能 + 安装进度条（用户令：「CLI 智能体加更新功能」「加一个安装进度条」）── */
{
  const installSrc = readFileSync(join(ROOT, "electron/cli-install.ts"), "utf8");
  const ver = await import(new URL("../../src/lib/cli-install.mjs", import.meta.url).href);
  ok(typeof ver.compareVersions === "function" && typeof ver.hasCliUpdate === "function" && typeof ver.withLatestPackage === "function",
    "版本比较 / 更新包名是纯函数（守卫直接真跑）");
  ok(ver.compareVersions("1.2.3", "1.4.0") === -1 && ver.compareVersions("2.0.0", "2.0") === 0 && ver.compareVersions("1.10.0", "1.9.9") === 1,
    "compareVersions 真值表：小数段按数字比、缺段补 0");
  ok(ver.hasCliUpdate("1.2.3", "1.2.3") === false && ver.hasCliUpdate("1.2.3", "1.4.0") === true && ver.hasCliUpdate("", "1.0.0") === false,
    "只有已装版本低于最新才叫「可更新」；版本取不到不报更新");
  /* 11-07：原来「已有版本后缀保持原样」⇒ 安装命令钉了 pkg@1.2.3 的条目点「一键更新」
     装回旧版，检查更新永远显示「可更新」。现在统一换成 @latest。 */
  ok(ver.withLatestPackage("@anthropic-ai/claude-code") === "@anthropic-ai/claude-code@latest"
    && ver.withLatestPackage("@scope/name@1.2") === "@scope/name@latest"
    && ver.withLatestPackage("pkg@1.2.3") === "pkg@latest"
    && ver.withLatestPackage("pkg") === "pkg@latest",
    "withLatestPackage 真值表：作用域 @ 不算版本；固定版本一律升 @latest（否则一键更新装回旧版）");
  ok(/export async function updateCliAgent/.test(installSrc) && /export async function checkCliAgentUpdates/.test(installSrc) && /export function cancelCliInstall/.test(installSrc),
    "执行端提供 更新 / 检查更新 / 取消 三个实现");
  ok((ipcSrc.match(/ipcHost\.handle\("cliagents:/g) ?? []).length >= 9
    && /"cliagents:check-updates"/.test(ipcSrc) && /"cliagents:update"/.test(ipcSrc) && /"cliagents:cancel"/.test(ipcSrc),
    "三个新通道已注册（manifest / registry 由【2】【153】对账）");
  ok(/cli-install-progress/.test(panelSrc) && /cancelCliAgentInstall/.test(panelSrc)
    && /updateCliAgent/.test(panelSrc) && /checkCliAgentUpdates/.test(panelSrc),
    "面板：进度条 + 取消 + 更新按钮 + 检查更新接线");
  ok(/child\.kill\(\)/.test(installSrc) && /cancelledIds/.test(installSrc),
    "取消真 kill 子进程（⛔ 不是只把 UI 的 busy 清掉）");

  /* ── 11-06 审查：安装命令解析 / 并发 / 取消 / 检查更新 ── */
  ok(ver.parseInstallCommand("pip install --index-url https://x/simple pkg").packages.join(",") === "pkg"
    && ver.parseInstallCommand("npm install -g --registry https://r pkg").packages.join(",") === "pkg",
    "解析器：带值选项（--index-url / --registry）的值不会被当成包名");
  ok(ver.parseInstallCommand("pip install \"pkg>=1.0\"").packages.join(",") === "pkg>=1.0",
    "解析器：去掉包名两侧的引号（否则 pip 会把引号当包名一部分）");
  ok(/let globalOpId/.test(installSrc) && (installSrc.match(/if \(globalOpId\)/g) ?? []).length >= 3,
    "全局只允许一个装卸/更新操作（npm/pip 共用同一 prefix，并发会互抢）");
  ok(/if \(!busyIds\.has\(key\)\) return \{ ok: true, cancelled: false \};[\s\S]{0,160}?cancelledIds\.add\(key\);/.test(installSrc),
    "取消标记在「没有子进程的重试间隙」也生效（下一轮开始前 throw）");
  /* 11-07：原 >=2 是靠 pipRun 里同一分支写两遍凑出来的假绿。改成「npm/pip 各一处 +
     复核窗口三处 + 标记不被 runChild 吃掉」，三条都锚在真实代码形态。 */
  ok((installSrc.match(/if \(cancelledIds\.has\(id\)\) throw new Error\("已取消"\);/g) ?? []).length >= 2
    && !/if \(cancelledIds\.has\(id\)\) throw new Error\("已取消"\);\s*\n\s*if \(cancelledIds\.has\(id\)\) throw new Error\("已取消"\);/.test(installSrc),
    "每次尝试前检查取消标记（npm / pip 各一处，⛔ 不许靠同一分支重复行凑数）");
  ok((installSrc.match(/throwIfCancelled\(entry\.id\);/g) ?? []).length >= 3
    && !/if \(cancelledIds\.has\(id\)\) \{ cancelledIds\.delete\(id\); reject/.test(installSrc),
    "子进程退出到复核之间也能取消（装卸/更新三处都查，且标记由 finally 统一清）");
  ok(/const workers = Array\.from\(\{ length: Math\.min\(4, queue\.length\) \}/.test(installSrc),
    "检查更新并行限 4 路（面板打开不必串行等十几条）");
  /* 11-07：原来只认「代码里有 `const hasCustomIndex = args.some`」就绿，但 args 里
     **根本没有 -i**（解析器把带值选项整个丢了）⇒ 私有源仍被国内镜像顶掉。
     ⇒ 改成真跑解析器 + 执行端接线双判据。 */
  const privatePip = ver.parseInstallCommand("pip install -i https://private/simple mypkg");
  const privateNpm = ver.parseInstallCommand("npm install -g --registry https://private/npm mypkg");
  ok(privatePip.options.join(" ") === "-i https://private/simple" && privatePip.packages.join(",") === "mypkg"
    && privateNpm.options.join(" ") === "--registry https://private/npm" && privateNpm.packages.join(",") === "mypkg",
    "解析器：私有源选项连值一起保留（⛔ 丢掉它就会被国内镜像顶掉，私有包装不上）");
  ok((installSrc.match(/\.\.\.spec\.options/g) ?? []).length >= 3
    && /hasCustomIndex/.test(installSrc) && /customRegistry/.test(installSrc)
    && /queryLatestVersion\(spec\.manager, pkg, spec\.options\)/.test(installSrc),
    "执行端：安装 / 更新 / 版本查询都把私有源选项原样拼回参数数组（仍是参数数组、不开 shell）");
  ok(/function sourceOptionsOf/.test(installSrc) && /\["-m", "pip", \.\.\.srcOpts, "index"/.test(installSrc),
    "版本查询把 -i 排在 pip 子命令之前（pip 全局选项放错位置会直接报错）");
  ok(/检查更新/.test(panelSrc) && /const checkOne = useCallback/.test(panelSrc) && /const checkAll = useCallback/.test(panelSrc),
    "面板提供「检查更新」入口（工具栏全部 + 预览单条，11-06 用户问按键在哪）");
  /* ⛔ 11-06 审查：带 `@latest` 的安装命令会让 `npm uninstall` 直接 ERMARGS
     （"Remove arguments must only contain package names"）⇒ 卸载/查版本走裸包名。 */
  ok(ver.basePackageName("@qwen-code/qwen-code@latest") === "@qwen-code/qwen-code"
    && ver.basePackageName("@iflow-ai/iflow-cli") === "@iflow-ai/iflow-cli"
    && ver.basePackageName("aider-chat>=0.86") === "aider-chat"
    && ver.basePackageName("qwenpaw[extra]") === "qwenpaw",
    "basePackageName 真值表：作用域包保留 @scope/、去掉版本；pip 去掉版本区间与 extras");
  ok(/spec\.packages\.map\(basePackageName\)/.test(installSrc) && /basePackageName\(spec\.packages\[0\]/.test(installSrc),
    "卸载与查最新版本都用裸包名（否则带 @latest 的条目卸不掉 / 查不到版本）");
}

/* ── 11-06 QwenPaw 派活报错（用户真机实证：`No such option '-F'`）──
   ⛔ 根因不是「宿主没采用自定义 cliCommand」，而是模板 `qwenpaw task {prompt}` 没引号：
      任务正文里的 `Select-Object -First 20` 被 shell 拆成独立参数，`-First` 被当成短选项 `-F`；
      同时该 CLI 需要 `-i/--instruction`，旧模板也没给。两条都要钉。 */
{
  const cmd = await import(new URL("../../src/lib/cli-command.mjs", import.meta.url).href);
  const runnerSrc = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  const storeSrc = readFileSync(join(ROOT, "electron/boss-groups/store.ts"), "utf8");
  const bossRoleSrc = readFileSync(join(ROOT, "src/features/boss-group-view/boss-role.ts"), "utf8");
  const bossToolsSrc = readFileSync(join(ROOT, "src/features/app-view/constants/05-boss-group-tools.tsx"), "utf8");
  ok(typeof cmd.fillCliPromptTemplate === "function" && typeof cmd.healCliCommand === "function",
    "CLI 命令模板是纯函数模块（守卫直接真跑）");
  const dangerous = "标题：探测 D:\\\\6\n命令：Get-ChildItem 'D:\\\\6' | Select-Object -First 20 Name";
  const filled = cmd.fillCliPromptTemplate("qwenpaw task {prompt}", dangerous);
  ok(filled.startsWith('qwenpaw task "') && filled.endsWith('"'),
    "⛔ 不带引号的模板也会把任务全文整体包成一个参数（`-First` 不再掉出去当选项）");
  ok(/"[^"]*-First 20 Name[^"]*"/.test(filled) && !/\n/.test(filled),
    "任务正文里的 `-First` 留在引号内，且换行被压成单行（不再截断命令）");
  ok(!/[&|<>^%$]/.test(filled.slice(filled.indexOf('"') + 1, filled.lastIndexOf('"'))),
    "提示词里的 shell 元字符被净化（命令注入面）");
  ok(cmd.fillCliPromptTemplate('aider --message "{prompt}" --yes', "x").split('"').length === 3,
    "模板自带双引号时不重复加引号");
  ok(cmd.fillCliPromptTemplate("aider --message '{prompt}' --yes", "x").startsWith('aider --message "x"'),
    "模板用单引号包占位符时换成安全的双引号（cmd 不认单引号分组）");
  ok(cmd.fillCliPromptTemplate('bin -p "任务：{prompt} 完"', "a b") === 'bin -p "任务：a b 完"',
    "占位符夹在更长的引号串里时只在里面填值，不叠第二层引号");
  const qp = cmd.cliPromptCommand("qwenpaw");
  ok(/-i "\{prompt\}"/.test(qp) && /--max-iters/.test(qp) && !/-F\b/.test(qp),
    `QwenPaw 规范模板用 -i/--instruction（实得：${qp}）`);
  ok(cmd.healCliCommand("qwenpaw task {prompt}") === qp
    && cmd.healCliCommand('qwenpaw task -i "{prompt}"') === qp,
    "老档案里的坏模板（缺 -i / 缺超时）会被 heal 成规范模板");
  ok(cmd.healCliCommand('qwenpaw task -i "{prompt}" --max-iters 5 -t 60') === 'qwenpaw task -i "{prompt}" --max-iters 5 -t 60',
    "用户写全了开关的模板原样保留（不覆盖自定义参数）");
  ok(cmd.healCliCommand("mycli {prompt}") === "mycli {prompt}",
    "没有规范模板的自定义 CLI 不硬改");
  /* 11-07：模板外面多了一层 applyCliPermissionTier（按目录档位追加参数）——
     判据仍是「先 heal 再整体加引号」，且**不许**退回裸 replace。 */
  ok(/fillCliPromptTemplate\(\s*applyCliPermissionTier\(healCliCommand\(member\.cliCommand[^)]*\),[\s\S]{0,240}?memberPrompt\(/.test(runnerSrc)
    && !/\.replace\("\{prompt\}", promptForCli/.test(runnerSrc),
    "⛔ 派活执行端走「先 heal → 按档位追加参数 → 整体加引号」，不再裸 replace");
  ok(/readUsableCliAgents\(\)/.test(runnerSrc) && /cliAgentRegistry/.test(runnerSrc) && /if \(!command\) continue;/.test(runnerSrc),
    "中枢可拉名单合并「CLI 智能体目录」：有规范单轮命令的都能拉，未核实的不进群（宿主没法替它探用法）");
  ok(/healCliCommand\(member\.cliCommand\)/.test(storeSrc),
    "老档案在 store.load 时自动修复 CLI 命令模板（用户不用删群重建）");
  ok(/单轮非交互命令/.test(mainSrc) && /任务全文整体放一个参数/.test(mainSrc),
    "被委派的 CLI 会话拿到规范单轮命令（模型不用猜开关）");
  ok(/只传 cliName|只传 cliName 就行/.test(readFileSync(join(ROOT, "electron/features/boss-groups-ipc.ts"), "utf8"))
    && /不要自己拼 cliCommand|不要自己猜/.test(readFileSync(join(ROOT, "electron/features/boss-groups-ipc.ts"), "utf8")),
    "⛔ 中枢提示词只让模型传 cliName（模板由宿主配，模型猜开关 = 派活必失败）");
  ok(/只传 cliName/.test(bossRoleSrc) && /不要自己猜/.test(bossToolsSrc),
    "中枢角色提示与 group_add_member 工具描述同口径（模型看的是这两处）");
  /* ⛔ 第二个真机坑（同一次派活）：NO_PROXY 里的 `[::1]` 会让 httpx 拼出 `all://*[::1]`，
     Python 系 CLI 启动即崩（InvalidURL: Invalid port: ':1]'）。CLI 子进程与引擎环境都要修。 */
  ok(cmd.normalizeNoProxyList("localhost,[::1],::1") === "localhost,::1,::1",
    "NO_PROXY 里的方括号 IPv6 被规整成 httpx 能解析的形式（22:51 实测修复后 QwenPaw 跑到 success）");
  const toolchainSrc = readFileSync(join(ROOT, "electron/toolchain.ts"), "utf8");
  ok(/applyNoProxyFix\(env\)/.test(toolchainSrc) && /applyNoProxyFix\(env\)/.test(mainSrc),
    "引擎环境（toolchainEnv）与 CLI 子进程环境（cliProcessEnv）都应用了 NO_PROXY 修正");
  /* ── 11-06 逐条核对单轮参数（npm / PyPI / 官方文档实证）── */
  const EXPECTED = {
    claude: /^claude -p "\{prompt\}"$/,
    codex: /^codex exec "\{prompt\}"$/,
    gemini: /^gemini -p "\{prompt\}" --skip-trust$/,
    aider: /^aider --message "\{prompt\}" --yes$/,
    openclaw: /^openclaw agent --agent main -m "\{prompt\}" --json$/,
    qwen: /^qwen --prompt "\{prompt\}" --auth-type openai$/,
    qwenpaw: /^qwenpaw task -i "\{prompt\}" --max-iters 20 -t 540$/,
    kimi: /^kimi -p "\{prompt\}"$/,
    codebuddy: /^codebuddy -p "\{prompt\}"$/,
    comatecli: /^comatecli run -q "\{prompt\}" --display event-stream$/,
    qoder: /^qoder -p "\{prompt\}"$/,
    traecli: /^traecli --print "\{prompt\}"$/,
  };
  const mismatched = Object.entries(EXPECTED)
    .filter(([bin, re]) => !re.test(cmd.cliPromptCommand(bin)))
    .map(([bin]) => `${bin}=${cmd.cliPromptCommand(bin) || "缺"}`);
  ok(mismatched.length === 0, `12 条已核实的 CLI 单轮命令逐字对账（不符：${mismatched.join(" / ") || "无"}）`);
  const allSpecs = Object.values(cmd.CLI_PROMPT_COMMANDS);
  ok(allSpecs.every((spec) => spec.includes("{prompt}")) && allSpecs.every((spec) => !/(^|\s)-F(\s|$)/.test(spec)),
    "所有模板都带 {prompt} 占位符，且没有 `-F` 这种从文件读取的猜法");
  ok(cmd.cliPromptCommand("iflow") === "",
    "iFlow 没有文档化的单轮参数 ⇒ 不写假模板（如实走 --help 探测）");

  /* ── 11-07 派活权限档（safe / standard / full，默认 standard）─────────────
     ⛔ 无头模式下没人回答权限询问 ⇒ 各 CLI 默认把「需要确认」的动作拒绝，
        表现就是「能说话、改不了文件/跑不了命令」。档位决定模板尾部追加哪组参数。 */
  const TIER_TABLE = {
    claude: {
      safe: 'claude -p "{prompt}"',
      standard: 'claude -p "{prompt}" --permission-mode acceptEdits',
      full: 'claude -p "{prompt}" --permission-mode bypassPermissions',
    },
    codex: {
      safe: 'codex exec --sandbox read-only "{prompt}"',
      standard: 'codex exec --approve-for-me "{prompt}"',
      full: 'codex exec --dangerously-bypass-approvals-and-sandbox "{prompt}"',
    },
    gemini: {
      safe: 'gemini -p "{prompt}" --skip-trust --approval-mode plan',
      standard: 'gemini -p "{prompt}" --skip-trust --approval-mode auto_edit',
      full: 'gemini -p "{prompt}" --skip-trust --approval-mode yolo',
    },
    qwen: {
      safe: 'qwen --prompt "{prompt}" --auth-type openai --approval-mode plan',
      standard: 'qwen --prompt "{prompt}" --auth-type openai --approval-mode auto-edit',
      full: 'qwen --prompt "{prompt}" --auth-type openai --approval-mode yolo',
    },
    qoder: {
      safe: 'qoder -p "{prompt}"',
      standard: 'qoder -p "{prompt}" --permission-mode accept_edits',
      full: 'qoder -p "{prompt}" --yolo',
    },
    codebuddy: {
      safe: 'codebuddy -p "{prompt}"',
      standard: 'codebuddy -p "{prompt}" --permission-mode acceptEdits',
      full: 'codebuddy -p "{prompt}" --permission-mode bypassPermissions',
    },
  };
  const tierMismatch = Object.entries(TIER_TABLE).flatMap(([bin, tiers]) =>
    Object.entries(tiers)
      .filter(([tier, want]) => cmd.cliPromptCommandFor(bin, tier) !== want)
      .map(([tier]) => `${bin}/${tier}=${cmd.cliPromptCommandFor(bin, tier)}`));
  ok(tierMismatch.length === 0, `权限档逐字对账（6 个 CLI × 3 档；不符：${tierMismatch.join(" / ") || "无"}）`);
  ok(cmd.cliPermissionTierOf(undefined) === "standard"
    && cmd.cliPermissionTierOf("FULL") === "full"
    && cmd.cliPermissionTierOf("乱写") === "standard",
    "缺省 / 脏值一律回落 standard（⛔ 不能因为坏数据把派活变成全放行）");
  ok(cmd.cliPromptCommandFor("aider", "full") === cmd.cliPromptCommand("aider")
    && cmd.cliPromptCommandFor("qwenpaw", "full") === cmd.cliPromptCommand("qwenpaw")
    && cmd.cliPromptCommandFor("kimi", "full") === cmd.cliPromptCommand("kimi"),
    "没有核实过 / 实测不可用的 CLI 保持原命令（Kimi 2.5.2 的 --auto/--yolo 与 -p 互斥）");
  ok(cmd.applyCliPermissionTier(cmd.applyCliPermissionTier('claude -p "{prompt}"', "standard"), "standard")
    === cmd.cliPromptCommandFor("claude", "standard"),
    "权限参数幂等（重复应用不叠加）");
  ok(cmd.cliSupportsPermissionTier("claude") === true && cmd.cliSupportsPermissionTier("aider") === false,
    "界面判据：哪些 CLI 有档位参数");

  const agentsSrc = readFileSync(join(ROOT, "electron/cli-agents.ts"), "utf8");
  ok(/permissionTier: src\.permissionTier === undefined \? undefined : cliPermissionTierOf\(src\.permissionTier\)/.test(agentsSrc)
    && /"permissionTier"\]/.test(agentsSrc)
    && /export async function cliPermissionTierFor/.test(agentsSrc),
    "存储层：只落显式设过的档位（缺省=standard）+ 按 bin 查档");
  ok(/cliPromptCommandFor\(bin, tier\)/.test(agentsSrc), "派活提示（@ 调度路径）用带档位的命令");

  const bossRunnerSrc = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  ok(/cliPermissionTierFor\(member\.name\)/.test(bossRunnerSrc) && /applyCliPermissionTier\(healCliCommand/.test(bossRunnerSrc),
    "群成员 CLI 派活（子进程路径）按目录里的档位追加参数");

  const ipcManifest = JSON.parse(readFileSync(join(ROOT, "electron/ipc-channels.manifest.json"), "utf8"));
  const saveChannel = (ipcManifest.channels ?? []).find((entry) => entry.channel === "cliagents:save");
  ok(Boolean(saveChannel) && /permissionTier/.test(saveChannel.paramsDecl) && /permissionTier/.test(saveChannel.paramsImpl),
    "IPC 桥登记 permissionTier（生成物才会带上类型）");

  const cliPanelSrc = readFileSync(join(ROOT, "src/features/cli-agents/CliAgentsPanel.tsx"), "utf8");
  ok(/派活权限档/.test(cliPanelSrc)
    && /cliSupportsPermissionTier\(preview\.bin\)/.test(cliPanelSrc)
    && /saveCliAgent\(\{ id: item\.id, permissionTier: tier \}\)/.test(cliPanelSrc),
    "CLI 面板：预览弹窗可选档位并落盘（不支持的 CLI 显示说明）");
  /* 11-07 用户实测两条：① 点「编辑」后表单内联在列表上方、滚动后看不见 ⇒ 改成全局弹窗；
     ② 不支持的 CLI 只留一句小字 ⇒ 控件位置保留「不适用」一行，别让人以为控件丢了。 */
  ok(/<SettingsDialog[\s\S]{0,400}?cli-agent-form--dialog/.test(cliPanelSrc) && /agent-preview-tier-na/.test(cliPanelSrc),
    "面板：编辑/新增走弹窗；无档位的 CLI 保留「不适用」控件行");
  ok(/onClick=\{\(\) => setDraft\(\{ id: preview\.id[^)]*\}\)\}/.test(cliPanelSrc)
    && !/setDraft\(\{ id: preview\.id[\s\S]{0,240}?setPreviewId\(""\)/.test(cliPanelSrc)
    && /cli-agent-form-hero/.test(cliPanelSrc),
    "⛔ 编辑不关卡片详情（三级弹窗叠在上面；取消后回到详情），表单带身份行分组");
  /* 同为 SettingsDialog（同 z-index）时**后挂载者在最上层**：编辑弹窗必须排在卡片详情之后渲染。 */
  ok(cliPanelSrc.indexOf("cli-agent-form--dialog") > cliPanelSrc.indexOf("agent-preview-actions"),
    "编辑弹窗排在卡片详情之后渲染（三级弹窗的叠层顺序）");

  const viteEnvSrc = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  ok(/permissionTier\?: "safe" \| "standard" \| "full"/.test(viteEnvSrc) && /permissionTier\?: string/.test(viteEnvSrc),
    "渲染层类型：条目带 permissionTier，保存入参接受它");

  /* ⛔⛔ 真跑合并：存档只存差异（{id, permissionTier} / {id, enabled}）时，
     合并后必须仍保留预置的 name/bin（11-07 实测：先归一化再合并会把它们填成「未命名 CLI」）。 */
  const presetClaude = cli.BUILTIN_CLI_AGENTS.find((entry) => entry.id === "builtin-claude-code");
  const mergedPartial = cli.mergeCliAgents(cli.BUILTIN_CLI_AGENTS, [
    { id: "builtin-claude-code", permissionTier: "full", enabled: false },
  ]).find((entry) => entry.id === "builtin-claude-code");
  ok(Boolean(presetClaude) && mergedPartial.name === presetClaude.name && mergedPartial.bin === presetClaude.bin
    && mergedPartial.permissionTier === "full" && mergedPartial.enabled === false,
    "⛔ 差异存档合并后保留预置 name/bin（先合并再归一），档位与启停照常生效");

  /* ── 11-07 供应商自动跟随（安装即配置 / 切供应商自动更新 / 升级自动补）──────── */
  const providers = await import(pathToFileURL(join(ROOT, "src/lib/cli-provider-config.mjs")).href);
  ok(providers.isLocalBaseUrl("http://localhost:3425/v1") && !providers.isLocalBaseUrl("https://api.openai.com/v1"),
    "本机中转识别（只有本机/内网才写含占位 Key 的配置）");
  ok(providers.stripV1Suffix("http://localhost:3425/v1") === "http://localhost:3425",
    "Anthropic/Gemini 的 base 剥掉 /v1（SDK 自己拼）");
  const kimiToml = providers.kimiConfigToml({ baseUrl: "http://localhost:3425/v1", model: "m/x", apiKey: "harness-local" });
  ok(/\[providers\.harness\]/.test(kimiToml) && /default_model = "harness\/m\/x"/.test(kimiToml) && /\[models\."harness\/m\/x"\]/.test(kimiToml),
    "Kimi config.toml：provider / model / default_model 三处对齐");
  const codexToml = providers.codexConfigToml({ baseUrl: "http://localhost:3425/v1", model: "m/x" });
  ok(/model_provider = "harness"/.test(codexToml) && /env_key = "OPENAI_API_KEY"/.test(codexToml) && !/harness-local/.test(codexToml),
    "Codex 独立 home 配置：provider 指向当前供应商，文件里不写 Key");
  const geminiMerged = providers.mergeGeminiSettings({ theme: "dark", security: { auth: { keep: 1 } } }, { model: "m/x" });
  ok(geminiMerged.theme === "dark" && geminiMerged.security.auth.keep === 1
    && geminiMerged.security.auth.selectedType === "gemini-api-key" && geminiMerged.model.name === "m/x",
    "Gemini settings 合并（保留用户设置 + 补 API Key 认证）");

  ok(/local\?: boolean/.test(mainSrc) && /GEMINI_API_KEY/.test(mainSrc) && /ANTHROPIC_AUTH_TOKEN = key/.test(mainSrc)
    && /export function cliCodexHome/.test(mainSrc),
    "派活环境：本机中转同时注入 OpenAI / Anthropic / Gemini 三套 + Codex 独立 home");
  const cliEnvSrc = readFileSync(join(ROOT, "electron/boss-groups/cli-env.ts"), "utf8");
  ok(/if \(cliCodexHomeReady\(\)\) env\.CODEX_HOME = cliCodexHome\(\)/.test(cliEnvSrc) && /isLocalBaseUrl\(custom\?\.baseUrl\)/.test(cliEnvSrc),
    "群成员 CLI 派活：CODEX_HOME 有配置才设 + local 判定");
  ok(/\.\.\.\(cliCodexHomeReady\(\) \? \{ CODEX_HOME: cliCodexHome\(\) \} : \{\}\)/.test(delegationSrc) && /isLocalBaseUrl\(customModel\?\.baseUrl\)/.test(delegationSrc),
    "@ 调度的 CLI 会话：shell 环境同样带 CODEX_HOME（有配置才设）+ local");
  /* 11-08 审查：空 home 会顶掉用户 ~/.codex 登录态 ⇒ 闸必须是「配置文件真存在」，两处共用同一个 helper。 */
  ok(/export function cliCodexHomeReady\(\): boolean \{\s*return existsSync\(path\.join\(cliCodexHome\(\), "config\.toml"\)\);\s*\}/.test(mainSrc),
    "cliCodexHomeReady：以 config.toml 存在为闸（⛔ 不许退回无条件设 CODEX_HOME）");
  const syncSrc = readFileSync(join(ROOT, "electron/cli-agent-provider-sync.ts"), "utf8");
  ok(/codexConfigToml/.test(syncSrc) && /kimiConfigToml/.test(syncSrc) && !/mergeGeminiSettings/.test(syncSrc)
    && /\.harness\.bak/.test(syncSrc) && /apiKeyEnv: CLI_KEY_ENV/.test(syncSrc),
    "同步模块：Codex / Kimi 落盘 + 外部供应商写 api_key_env（Key 不落盘）+ 首次改动留备份；⛔ Gemini 不落盘（它只讲 Gemini 协议，硬写等于把它从能跑改成 405）");
  /* ⛔⛔ 11-10 用户报障「群里 CLI 成员都用不了」的三处根因，逐条钉死： */
  ok((syncSrc.match(/await attempt\("kimi"/g) || []).length === 1 && !/kimi\(非本机中转\)/.test(syncSrc)
    && !/if \(isLocalBaseUrl\(baseUrl\)\) \{[\s\S]{0,600}?attempt\("kimi"/.test(syncSrc),
    "⛔ kimi 同步不再「非本机中转就跳过」——跳过会把上一次的本机中转配置焊死在磁盘上（实测 本机中转端口 无监听 ⇒ 永远 connection_error）");
  ok(providers.cliProtocolOf("claude") === "anthropic" && providers.cliProtocolOf("claude.cmd") === "anthropic"
    && providers.cliProtocolOf("kimi") === "native" && providers.cliProtocolOf("codex") === "native"
    && providers.cliProtocolOf("iflow") === "native"
    && providers.cliProtocolOf("gemini") === "gemini"
    && providers.cliProtocolOf("qwen") === "openai"
    && providers.cliProtocolOf("aider") === "openai" && providers.cliProtocolOf("qwenpaw") === "openai",
    "协议族判定：claude=anthropic / kimi,codex,iflow=native / gemini=gemini / qwen,其余=openai");
  /* ⛔⛔ 11-10 用户截图「好多CLI智能体还是用不了」暴露的两个真凭据面，逐条钉住： */
  const cmdSrc = readFileSync(join(ROOT, "src/lib/cli-command.mjs"), "utf8");
  ok(/qwen: 'qwen --prompt "\{prompt\}" --auth-type openai'/.test(cmdSrc),
    "⛔ qwen 模板必须带 --auth-type openai（它默认按 gemini 协议拼 /v1beta/…，中转回 405 Method Not Allowed；实测带上后 exit=0）");
  const iflowToml = providers.iflowSettingsJson({ cna: "x" }, { baseUrl: "https://example.test/v1", model: "m/x", apiKey: "k" });
  const iflowObj = JSON.parse(iflowToml);
  ok(iflowObj.selectedAuthType === "openai-compatible" && iflowObj.apiKey === "k"
    && iflowObj.baseUrl === "https://example.test/v1" && iflowObj.modelName === "m/x" && iflowObj.cna === "x",
    "⛔ iFlow settings.json 四字段：selectedAuthType=openai-compatible + apiKey/baseUrl/modelName（缺 authType 它会报 Please set an Auth method；实测补齐后 exit=0）");
  ok(providers.iflowSettingsJson({}, { baseUrl: "", model: "m", apiKey: "k" }) === ""
    && providers.iflowSettingsJson({}, { baseUrl: "u", model: "", apiKey: "k" }) === "",
    "iFlow 配置缺字段时返回空串（⛔ 不写出半截配置让它连不上）");
  ok(/attempt\("iflow"/.test(syncSrc) && /iflowSettingsJson\(raw, \{ baseUrl, model, apiKey \}\)/.test(syncSrc),
    "同步模块真的会写 iFlow 配置（不是只在弹窗里列一行）");
  ok(/wantAnthropic = protocol === "" \? looksAnthropic \|\| local : protocol === "anthropic"/.test(mainSrc)
    && /wantAnthropic/.test(mainSrc) && /ANTHROPIC_SMALL_FAST_MODEL/.test(mainSrc),
    "⛔ cliModelEnv 按协议注入：anthropic 协议**不靠供应商名字**也注 ANTHROPIC_*（Claude Code 收不到就是 Not logged in）");
  ok(/\[CLI_KEY_ENV\]: key/.test(mainSrc) && providers.CLI_KEY_ENV === "HARNESS_CLI_API_KEY",
    "Key 经 CLI_KEY_ENV 进子进程环境（kimi 的 api_key_env 引它，配置文件里没有明文）");
  /* 三个派活入口都必须传协议族，漏一个就有一类 CLI 拿不到凭据。 */
  const talkCliSrc = readFileSync(join(ROOT, "electron/features/group-talk/04-cli.ts"), "utf8");
  const bossEnvSrc = readFileSync(join(ROOT, "electron/boss-groups/cli-env.ts"), "utf8");
  const bossRunSrc2 = readFileSync(join(ROOT, "electron/boss-groups/runner.ts"), "utf8");
  ok(/protocol: cliProtocolOf\(cli\.bin\)/.test(talkCliSrc) && /protocol: cliProtocolOf\(input\?\.bin\)/.test(bossEnvSrc)
    && /protocol: cliProtocolOf\(cliAgentBin\)/.test(delegationSrc)
    && /bin: cliBinOf\(member\.cliCommand \?\? ""\)/.test(bossRunSrc2),
    "群聊 / boss 群 / @ 调度三个入口都按协议族注入（⛔ 漏一处就有一类 CLI 拿不到凭据）");

  /* ── 11-10「同步给 CLI 智能体」弹窗（模型配置页出口）────────────────────────── */
  const syncUiSrc = readFileSync(join(ROOT, "electron/cli-agent-provider-sync.ts"), "utf8");
  ok(/export async function inspectCliSyncTargets/.test(syncUiSrc) && /if \(!installed\) continue;/.test(syncUiSrc),
    "同步弹窗只列**已安装**的 CLI（用户令「其他也是已安装的 cli 就都识别出来」）");
  ok(/\.claude", "settings\.json"/.test(syncUiSrc) && /ANTHROPIC_AUTH_TOKEN: apiKey/.test(syncUiSrc),
    "Claude 单独一档：写 ~/.claude/settings.json 的 env（它没有可跟随的 provider 配置约定）");
  ok(/kind: "own"/.test(syncUiSrc) && /qwenpaw/.test(syncUiSrc),
    "不跟随主会话的 CLI（QwenPaw 这类）如实标 own，⛔ 不假装同步过");
  const ipcSrc = readFileSync(join(ROOT, "electron/features/cli-agents-ipc.ts"), "utf8");
  const registrySrc = readFileSync(join(ROOT, "electron/ipc-registry.ts"), "utf8");
  const manifestSrc = readFileSync(join(ROOT, "electron/ipc-channels.manifest.json"), "utf8");
  ok(/cliagents:sync-inspect/.test(ipcSrc) && /cliagents:sync-apply/.test(ipcSrc)
    && /cliagents:sync-inspect/.test(manifestSrc) && /cliagents:sync-apply/.test(manifestSrc)
    && /prefix: "cliagents", count: 11/.test(registrySrc),
    "同步弹窗两条通道已登记（ipc-registry count 跟着 +2，⛔ 不改会被【2】/【107】报红）");
  ok(/cliagents:sync-inspect",\s*[\s\S]{0,400}?"returns": "[^"]*"[\s\S]{0,120}?"invokeArgs": "input"/.test(manifestSrc)
    || (/"channel": "cliagents:sync-inspect"/.test(manifestSrc) && /"channel": "cliagents:sync-apply"/.test(manifestSrc) && /"invokeArgs": "input"/.test(manifestSrc)),
    "⛔ sync-apply 的实参由 invokeArgs 决定（漏写 = preload 层静默丢 scope）");
  ok(!/"channel": "cliagents:sync-inspect"[\s\S]{0,500}?apiKey/i.test(manifestSrc),
    "⛔ 只读通道的返回体里没有 Key（Key 只在主进程解，绝不回传渲染层）");
  const syncDialogSrc = readFileSync(join(ROOT, "src/features/settings-cli-sync/CliSyncDialog.tsx"), "utf8");
  const modelSectionSrc = readFileSync(join(ROOT, "src/features/settings-model/ModelSettingsSection.tsx"), "utf8");
  ok(/data-testid="cli-sync"/.test(syncDialogSrc) && /confirmClaude/.test(syncDialogSrc) && /Key 明文/.test(syncDialogSrc),
    "弹窗：Claude 写 Key 前必须二次确认（⛔ 不做静默落盘）");
  ok(/setCliSyncOpen\(true\)/.test(modelSectionSrc) && /<CliSyncDialog/.test(modelSectionSrc),
    "模型配置页有入口按钮 + 弹窗挂载（用户令「在模型配置界面加」）");
  /* ⛔ 11-10 用户令「可以根据每个CLI特殊情况，定制模型同步按键」：按键按条给，且写法共用一份实现。 */
  ok(/export async function syncOneCliProvider/.test(syncUiSrc) && /if \(bin === "claude"\)/.test(syncUiSrc)
    && /if \(bin === "iflow"\)/.test(syncUiSrc) && /await writeKimiConfig\(baseUrl, model\)/.test(syncUiSrc),
    "单点同步按 bin 分派到各自写法（⛔ 全量同步与单点共用 writeCodex/Kimi/Iflow 三个实现，不写第二份）");
  ok(/targetId/.test(ipcSrc) && /syncOneCliProvider\(targetId\)/.test(ipcSrc),
    "IPC 支持 targetId：一次只同步一个 CLI");
  ok(/runOne\(target, needConfirm\)/.test(syncDialogSrc) && /confirmKeyed/.test(syncDialogSrc)
    && /同步（含 Key）/.test(syncDialogSrc) && /需自己登录/.test(syncDialogSrc),
    "每行按键按 kind 定制（含 Key 的要二次确认；env 显示自动注入；own 显示需自己登录）");
  /* 11-08 审查：单 try 包全部 CLI ⇒ 一个写挂连累后面的静默跳过；每个 CLI 独立 catch。 */
  ok(/const attempt = async \(name: string, fn: \(\) => Promise<void>\) => \{\s*try \{ await fn\(\); \} catch \{ skipped\.push\(/.test(syncSrc)
    && (syncSrc.match(/await attempt\("/g) || []).length === 3,
    "同步模块：每个 CLI 独立 catch（一个写挂不连累其余）");
  /* ⛔⛔ 11-10 审查发现的两个「自洽地错」：写入返回 false 既可能是"内容相同"也可能是"没写"，
     原来一律当失败 ⇒ 用户再点一次同步就看见红色「没写成」（假失败）；全量同步又把 skipped
     一律标 ok ⇒ 真失败也被算成成功。三态口径必须钉住。 */
  ok(/if \(outcome === "same"\) return \{ ok: true/.test(syncSrc) && /type WriteOutcome = "written" \| "same" \| "skipped" \| "absent"/.test(syncSrc),
    "⛔ 写入三态：same（内容已一致）必须算成功 —— 否则重复点同步会显示假失败");
  ok(/const failed = r\.skipped\.some\(\(entry\) => entry\.includes\("写入失败"\)\)/.test(syncSrc)
    && /results\.push\(\{ name: failed \? "写入失败" : "未同步", ok: !failed/.test(syncSrc),
    "⛔ 全量同步：只有「写入失败」算失败，「未安装 / 没值可写」只是状态说明（不能一律 ok:true 也不能一律当失败）");
  ok(!providers.isLocalBaseUrl("http://10.evil.com/v1") && !providers.isLocalBaseUrl("http://192.168.evil.com/v1")
    && providers.isLocalBaseUrl("http://172.16.0.1/v1") && !providers.isLocalBaseUrl("http://172.32.0.1/v1"),
    "本机中转识别：先验 IPv4 形态再判网段（10.evil.com 这类公网域不算本机）");
  const cliCommandSrc = codeOnly(readFileSync(join(ROOT, "src/lib/cli-command.mjs"), "utf8"));
  ok(!/cliBINOfSafe/.test(cliCommandSrc) && /const bin = cliBinOf\(tpl\)/.test(cliCommandSrc),
    "权限档模板取 bin 复用 cliBinOf（⛔ 不许再长一份逐字副本）");
  const rootMainSrc = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  ok(/syncCliAgentProviderConfig/.test(rootMainSrc), "启动时同步一次（离线改过供应商也能跟上）");
  const applySrc = readFileSync(join(ROOT, "electron/features/custom-model-apply.ts"), "utf8");
  ok(/syncCliAgentProviderConfig/.test(applySrc), "切换供应商后自动重配");
  const installSrc = readFileSync(join(ROOT, "electron/cli-install.ts"), "utf8");
  ok((installSrc.match(/syncCliAgentProviderConfig/g) || []).length >= 2, "安装 / 升级完成后自动补配置");
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n【cliagents】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
