/**
 * 12bt-photocraft —— PhotoCraft（开源 Photoshop 重写）全链路守卫（11-15）。
 *
 * 用户令「github 有开源仓库，看看原理、对我们有啥用」⇒ P1 按需下载 + 工具、P2 MCP、P3 图片卡 GUI 入口。
 * 钉住：
 *   ① 只从官方 GitHub release 下载便携包（镜像序 + SHA256SUMS 校验），⛔ 不随包；
 *   ② CLI 工具 7 个动作：命令 id 白名单 + 参数上限 + 路径可信根闸 + 输出不得覆盖输入；
 *   ③ MCP 段由 applyCustomModel 在已安装时生成，roots 限 userData/photocraft-io；
 *   ④ 技能 / 常驻指令 / 开发工具卡 / 更新行 / 图片卡入口齐全；
 *   ⑤ 卸载重建 config（去掉 MCP 段）并重启引擎；
 *   ⑥ 许可 MIT/Apache-2.0，不冒充 ArtCraft 官方。
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

/* ── ① 安装链 ─────────────────────────────────────────────── */
{
  const core = codeOnly(read(CORE));
  ok(core.includes('PHOTOCRAFT_REPO = "storytold/photocraft"'), "来源锚定官方仓 storytold/photocraft");
  ok(/releases\/download\/v\$\{version\}\/\$\{asset\}/.test(core), "按目标版本下载 release 资产（⛔ 不永远 latest）");
  ok(/SHA256SUMS\.txt/.test(core) && /mirrorCandidates\(url\)/.test(core), "校验哈希来自官方 SHA256SUMS（镜像序取）");
  ok(/photocraft-\$\{version\}-windows-\$\{arch\}-portable\.zip/.test(core)
    && /photocraft-cli-\$\{version\}-macos-universal\.zip/.test(core),
    "Windows/mac 资产名与官方 release 一致（win 便携 zip / mac CLI zip）");
  ok(/sevenZip.*7z\.exe|existingToolPath\("sevenzip", "7z\.exe"\)/.test(core) && /tarExecutable\(\)/.test(core),
    "解压走随包 7-Zip / 系统 tar（参数数组，不开 shell）");
  ok(/version\.txt/.test(core) && /photocraftInstalledVersion/.test(core), "版本文件落盘 + 已装版本读取");
  const dev = read("electron/features/dev-runtimes.ts");
  ok(/photocraft: \{ name: "PhotoCraft 图像编辑"/.test(dev) && /marker: "photocraft"/.test(dev),
    "开发工具运行时登记（marker = photocraft 目录）");
  const rt = read("electron/features/runtime-ipc.ts");
  ok(/photocraft: \{ repo: PHOTOCRAFT_REPO/.test(rt), "GITHUB_UPDATEABLE 更新链登记");
  ok(/id === "photocraft"\)[^]{0,400}?installPhotoCraftFromGitHub/.test(rt), "安装分派接入 GitHub 直下型");
  ok(/id === "photocraft"\) return photocraftInstalledVersion\(\)/.test(rt), "已装版本按 PhotoCraft 的 version.txt 读");
  ok(/id === "photocraft"\) \{[\s\S]{0,240}?removePhotoCraftMcpSection\(\)[\s\S]{0,240}?restartServerWhenIdle/.test(rt),
    "卸载后直接删除 MCP 段（不依赖 config 重建时序）并重启引擎");
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
  ok(/length > 20/.test(dom) && /text\.length > 8192/.test(dom), "命令条数与参数大小上限");
  ok(/actions-\$\{Date\.now\(\)\}|batch-\$\{Date\.now\(\)\}/.test(dom) && /fs\.rm\(actionsFile/.test(dom),
    "批量动作文件写进 ioRoot 且用完即删");
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

/* ── ④ 工具 / 指令 / 技能 / 卡片 / 图片入口 ────────────────── */
{
  const tool = codeOnly(read(TOOL));
  ok(/name: "photocraft"/.test(tool) && /enum: \["status", "commands", "info", "run", "convert", "batch", "open"\]/.test(tool),
    "dynamicTool photocraft 注册（七动作）");
  ok(/输出路径不能与输入相同/.test(tool), "工具描述写明原图保护边界");
  const dispatch = codeOnly(read(DISPATCH));
  const helper = codeOnly(read("src/features/app-state/parts/part05/event-router/photocraft-tool.ts"));
  ok(/event\.params\?\.tool === "photocraft"/.test(dispatch) && /runPhotoCraftTool\(/.test(dispatch),
    "事件路由分派到 Photocraft 工具（分发体拆在 photocraft-tool.ts）");
  ok(/photocraftRun\(/.test(helper) && /photocraftBatch\(/.test(helper), "工具分发体接到 IPC（run / batch）");
  const dev = read("electron/developer-instructions.ts");
  ok(/PHOTOCRAFT_INSTRUCTIONS/.test(dev) && /text \+= PHOTOCRAFT_INSTRUCTIONS;/.test(dev), "常驻指令第 21 条已接线");
  ok(existsSync(join(ROOT, SKILL)), "技能文件存在");
  const skill = read(SKILL);
  ok(/name: photocraft/.test(skill) && /photocraft/.test(skill), "技能名与工具同源");
  ok(/不覆盖原图/.test(skill), "技能写明原图保护");
  const registry = read("electron/builtin-skills.ts");
  ok(/PHOTOCRAFT_SKILL/.test(registry) && /\["photocraft", PHOTOCRAFT_SKILL\]/.test(registry), "builtin-skills 登记");
  ok(/^\s*"photocraft": `# PhotoCraft/m.test(read("electron/builtin-skills/00-skill-zh-notes.ts")), "中文导读已补");
  const distributed = read("src/features/app-view/constants/01-notices-labels.tsx");
  ok(/^\s*"photocraft",\s*$/m.test(distributed), "# 面板保底名单含 photocraft");
  const devtools = read(DEVTools);
  const suite = read("src/features/settings-devtools/ArtCraftSuite.tsx");
  ok(/<PhotoCraftCard/.test(suite) && /openCard === "artcraft"/.test(devtools),
    "PhotoCraft 卡片收进 Craft 全家桶的层级 3 弹窗（11-16 三级结构）");
  const card = read(CARD);
  ok(/RuntimeUpdateRow[\s\S]{0,200}?id="photocraft"/.test(card), "卡片内更新行（GitHub 直下型）");
  ok(/MCP 连接器/.test(card) && /在 PhotoCraft 中编辑/.test(card), "卡片写明 MCP 与图片入口");
  const groups = read("src/features/settings-devtools/runtime-groups.tsx");
  ok(/DEDICATED_IDS = \[[^\]]*"photocraft"/.test(groups), "专用卡片不重复进分类列表");
  const media = read(MEDIA);
  ok(/photocraftOpen\(\{ path \}\)/.test(media) && /turn-media-edit/.test(media), "图片卡「在 PhotoCraft 中编辑」入口");
  ok(/\.turn-media-edit/.test(read("src/styles/39-media-preview.css")), "图片卡入口样式在位");
}

/* ── ⑤ 许可与打包 ─────────────────────────────────────────── */
{
  const pkg = JSON.parse(read("package.json"));
  ok(!(pkg.build?.extraResources ?? []).some((entry) => JSON.stringify(entry).includes("photocraft")),
    "⛔ 不随包（137MB ⇒ 按需下载）");
  const notices = read("THIRD_PARTY_NOTICES.md");
  ok(/storytold\/photocraft/.test(notices) && /Apache-2\.0/.test(notices), "第三方声明登记来源与许可");
  ok(/不冒充|ArtCraft/.test(notices), "声明不冒充 ArtCraft 官方");
}

console.log(`\n【photocraft】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
