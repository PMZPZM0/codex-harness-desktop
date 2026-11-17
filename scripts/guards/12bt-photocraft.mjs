/**
 * 12bt-photocraft —— PhotoCraft（开源 Photoshop 重写）全链路守卫（11-15；11-17 改为 Launcher 安装）。
 *
 * 11-17 用户令：「这个也走跟其他应用一样那个软件安装，这边负责识别联动」「不要直接下载安装」。
 * 钉住：
 *   ① **宿主不再自己下载/安装**：无 release 下载、无 SHA256SUMS、无 install 链接；
 *      路径全部来自 Craft 全家桶的安装扫描（`installedCraftApp("photocraft")`），老安装只作兜底；
 *   ② CLI 工具 7 个动作：命令 id 白名单 + 参数上限 + 路径可信根闸 + 输出不得覆盖输入；
 *   ③ MCP 段由 applyCustomModel 在已安装时生成，roots 限 userData/photocraft-io；
 *   ④ 技能 / 常驻指令 / 图片卡入口齐全；PhotoCraft 与其它 App 同一个详情弹窗（⛔ 不再有独立安装卡）；
 *   ⑤ 许可 MIT/Apache-2.0，不冒充 ArtCraft 官方。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【photocraft】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const CORE = "electron/photocraft.ts";
const DOMAIN = "electron/features/photocraft-ipc.ts";
const SKILL = "electron/builtin-skills/33-skill-photocraft.ts";
const CARD = "src/features/settings-devtools/PhotoCraftCard.tsx";
const DEVTools = "src/features/settings-devtools/DevtoolsSettingsSection.tsx";
const TOOL = "src/features/app-state/parts/part08/01-seg.tsx";
const DISPATCH = "src/features/app-state/parts/part05/event-router/02-request.tsx";
const MEDIA = "src/features/status/TurnMediaCards.tsx";

/* ── ① 识别与联动（⛔ 宿主不下载不安装） ─────────────────────── */
{
  const core = codeOnly(read(CORE));
  ok(core.includes('PHOTOCRAFT_REPO = "storytold/photocraft"'), "来源锚定官方仓 storytold/photocraft");
  ok(!/releases\/download/.test(core) && !/SHA256SUMS/.test(core) && !/downloadThroughMirrors/.test(core)
    && !/installPhotoCraftFromGitHub/.test(core),
    "⛔ 宿主不再自己下载/安装（跟其它 App 一样由 Launcher 安装）");
  ok(/installedCraftApp\("photocraft"\)/.test(core) && /photocraftCliPath[\s\S]{0,500}?cliPath/.test(core)
    && /photocraftGuiPath[\s\S]{0,500}?exePath/.test(core),
    "CLI / GUI 路径来自 Craft 安装扫描（Launcher 装在哪都能认）");
  ok(/photocraftInstallDir/.test(core) && /existsSync\(paths\.cli\)/.test(core),
    "老安装（tools/photocraft）作为兜底，升级后不断档");
  ok(/installedCraftApp/.test(read("electron/artcraft.ts")), "artcraft 导出单 App 安装查询（供工具解析路径）");
  const dev = read("electron/features/dev-runtimes.ts");
  ok(!/photocraft: \{ name: "PhotoCraft/.test(dev) && !/\| "photocraft"/.test(dev) && !/"photocraft" \|/.test(dev),
    "PhotoCraft 不再是宿主运行时（开发工具 / 组件更新列表里没有它）");
  const rt = read("electron/features/runtime-ipc.ts");
  ok(!/photocraft: \{ repo: PHOTOCRAFT_REPO/.test(rt) && !/installPhotoCraftFromGitHub/.test(rt) && !/PHOTOCRAFT_REPO/.test(rt),
    "更新链与安装分派里都没有 PhotoCraft（装/更都归 Launcher）");
}

/* ── ② CLI 工具（7 通道） ─────────────────────────────────── */
{
  const dom = codeOnly(read(DOMAIN));
  ok(["status", "info", "convert", "run", "batch", "commands", "open"].every((name) => dom.includes(`photocraft:${name}`)),
    "IPC 七个动作齐全（status/info/convert/run/batch/commands/open）");
  ok(/isInsideOrEqualTrustedRoots/.test(dom) && /photocraft-io|ioRoot/.test(dom),
    "路径闸：可信根（会话目录 / userData）或 photocraft-io");
  ok(/输出不能与输入同一路径/.test(dom), "⛔ 输出不得覆盖输入（原图保护）");
  ok(/\^\[a-z\]\[a-zA-Z0-9_\.\]\{1,80\}\$/.test(dom), "命令 id 白名单正则");
  ok(/length > 20/.test(dom) && /text\.length > 8192/.test(dom), "命令条数与单条参数上限");
  ok(/total > 20000/.test(dom) && !/65536/.test(dom),
    "全部参数合计 ≤20KB（Windows CreateProcess 命令行 32767 字符上限；⛔ 旧 64KB 会让 spawn 直接失败）");
  ok(/dir: installDir/.test(dom) && /sizeBytes: installDir \? dirSizeBytes\(installDir\)/.test(dom),
    "status 回传实际安装目录与体积（界面「安装位置」用）");
  ok(/spawn\(cli, args, \{ windowsHide: true \}\)/.test(read(CORE)) && !/execSync\(/.test(codeOnly(read(CORE))) && !/shell:\s*true/.test(codeOnly(read(CORE))),
    "⛔ 只 spawn 参数数组、不开 shell（不 exec / 不用 shell:true）");
  const preload = read("electron/preload.ts");
  ok(["photocraftStatus", "photocraftInfo", "photocraftConvert", "photocraftRun", "photocraftBatch", "photocraftCommands", "photocraftOpen"].every((name) => preload.includes(`${name}:`)),
    "preload 桥已生成七个方法（跑过 gen:ipc）");
  const manifest = read("electron/ipc-channels.manifest.json");
  ok((manifest.match(/"channel": "photocraft:/g) || []).length === 7, "manifest 七条通道");
  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "photocraft", count: 7, status: "in-features"/.test(registry), "registry 记账（7 通道）");
  ok(/"id": "photocraft"[\s\S]{0,120}?"enabled": true/.test(read("electron/composition.json")), "组合表启用 photocraft 域");
}

/* ── ③ MCP 段 ─────────────────────────────────────────────── */
{
  const core = codeOnly(read(CORE));
  ok(/photocraftMcpSection/.test(core) && /mcp_servers\.\$\{PHOTOCRAFT_MCP_SERVER\}/.test(core), "MCP 段生成函数（服务器名常量单一来源）");
  ok(/--automation-read-root/.test(core) && /--automation-write-root/.test(core) && /ioRoot/.test(core),
    "MCP roots 限 photocraft-io（读/写各一条）");
  ok(/--no-gpu/.test(core), "MCP 默认 CPU 渲染（无显示环境也能跑）");
  const apply = read("electron/features/custom-model-apply.ts");
  ok(/import \{[^}]*photocraftMcpSection[^}]*\} from "\.\.\/photocraft"/.test(apply) && /\.\.\.photocraftMcpSection\(\)/.test(apply),
    "config 生成时拼入 MCP 段（已安装才写）");
  ok(/PHOTOCRAFT_MCP_SERVER,[^]{0,120}?\.\.\.connectors/.test(apply) && /delete mcpOverrides\[PHOTOCRAFT_MCP_SERVER\]/.test(apply),
    "photocraft 段登记为 harness 所属并清掉旧覆盖快照（卸载后不被当作用户段复活）");
  ok(/photocraftMcpRegistered/.test(core), "状态可回报 MCP 是否已写入");
}

/* ── ④ 工具 / 指令 / 技能 / 弹窗 / 图片入口 ────────────────── */
{
  const tool = codeOnly(read(TOOL));
  ok(/name: "photocraft"/.test(tool) && /enum: \["status", "commands", "info", "run", "convert", "batch", "open"\]/.test(tool),
    "dynamicTool photocraft 注册（七动作）");
  ok(/输出路径不能与输入相同/.test(tool), "工具描述写明原图保护边界");
  ok(/Craft 全家桶/.test(tool) && !/开发工具 → PhotoCraft 图像编辑/.test(tool),
    "工具描述指向 Craft 全家桶入口（⛔ 不再指向已撤销的独立卡）");
  const dispatch = codeOnly(read(DISPATCH));
  const helper = codeOnly(read("src/features/app-state/parts/part05/event-router/photocraft-tool.ts"));
  ok(/event\.params\?\.tool === "photocraft"/.test(dispatch) && /runPhotoCraftTool\(/.test(dispatch),
    "事件路由分派到 Photocraft 工具（分发体拆在 photocraft-tool.ts）");
  ok(/photocraftRun\(/.test(helper) && /photocraftBatch\(/.test(helper), "工具分发体接到 IPC（run / batch）");
  const dev = read("electron/developer-instructions.ts");
  ok(/PHOTOCRAFT_INSTRUCTIONS/.test(dev) && /text \+= PHOTOCRAFT_INSTRUCTIONS;/.test(dev), "常驻指令第 21 条已接线");
  ok(/ArtCraft Launcher/.test(dev) && !/about 137 MB/.test(dev), "指令写明由 Launcher 安装（⛔ 不再让用户下 137MB）");
  ok(existsSync(join(ROOT, SKILL)), "技能文件存在");
  const skill = read(SKILL);
  ok(/name: photocraft/.test(skill) && /photocraft/.test(skill), "技能名与工具同源");
  ok(/不覆盖原图/.test(skill), "技能写明原图保护");
  ok(/Launcher/.test(skill) && !/按需下载官方便携包/.test(skill), "技能写明由 Launcher 安装");
  const registry = read("electron/builtin-skills.ts");
  ok(/PHOTOCRAFT_SKILL/.test(registry) && /\["photocraft", PHOTOCRAFT_SKILL\]/.test(registry), "builtin-skills 登记");
  ok(/^\s*"photocraft": `# PhotoCraft/m.test(read("electron/builtin-skills/00-skill-zh-notes.ts")), "中文导读已补");
  const distributed = read("src/features/app-view/constants/01-notices-labels.tsx");
  ok(/^\s*"photocraft",\s*$/m.test(distributed), "# 面板保底名单含 photocraft");
  const devtools = read(DEVTools);
  const suite = read("src/features/settings-devtools/ArtCraftSuite.tsx");
  ok(/openCard === "artcraft"/.test(devtools), "PhotoCraft 在 Craft 全家桶入口内");
  ok(!existsSync(join(ROOT, CARD)) && !/PhotoCraftCard/.test(suite),
    "PhotoCraft 不再有独立安装卡（与其它 App 同一详情弹窗，⛔ 不另起一套）");
  ok(/app\.key === "photocraft" \? "photocraft"/.test(suite), "PhotoCraft 的工具名保持 photocraft（不改成 craft_photocraft）");
  ok(/安装位置/.test(suite), "PhotoCraft 详情弹窗与其它 App 一样展示安装位置/修改");
  const groups = read("src/features/settings-devtools/runtime-groups.tsx");
  ok(!/"photocraft"/.test(groups), "运行时分类列表不再登记 PhotoCraft");
  const media = read(MEDIA);
  ok(/photocraftOpen\(\{ path \}\)/.test(media) && /turn-media-edit/.test(media), "图片卡「在 PhotoCraft 中编辑」入口");
  ok(/\.turn-media-edit/.test(read("src/styles/39-media-preview.css")), "图片卡入口样式在位");
}

/* ── ⑤ 许可与打包 ─────────────────────────────────────────── */
{
  const pkg = JSON.parse(read("package.json"));
  ok(!(pkg.build?.extraResources ?? []).some((entry) => JSON.stringify(entry).includes("photocraft")),
    "⛔ 不随包（安装交给 Launcher，宿主只识别联动）");
  const notices = read("THIRD_PARTY_NOTICES.md");
  ok(/storytold\/photocraft/.test(notices) && /Apache-2\.0/.test(notices), "第三方声明登记来源与许可");
  ok(/不冒充|ArtCraft/.test(notices), "声明不冒充 ArtCraft 官方");
}

console.log(`\n【photocraft】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
