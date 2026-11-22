/**
 * 12ai-skill-packs —— 精选技能包（10-30 用户令：榜单里有用的做成开发工具页按需下载）。
 *
 * 链路五道，断任何一道 = 用户「点了安装没反应 / 装出来是脏东西 / 删掉了别人的技能」：
 *   ① 清单真值表（三条、id 唯一、仓库/许可/配套说明齐全 —— 文案是核实过的事实）；
 *   ② 安全闸：每个 SKILL.md 必过 auditSkill；
 *   ③ 下载走 gh-mirror 候选序（gh-proxy → ghfast → 直连）；
 *   ④ 卸载只认自己写的 marker + 目录穿越闸；
 *   ⑤ 接线：manifest / registry / composition / preload / 开发工具卡片 / 面板接入。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【skill-packs】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

/* ── ① 清单真值表（真跑）────────────────────────────────────────────── */
let catalog = null;
try {
  catalog = (await import(pathToFileURL(join(ROOT, "electron", "skill-packs-catalog.ts")).href)).SKILL_PACKS;
} catch (error) {
  ok(false, `skill-packs-catalog.ts 读不到：${error?.message ?? error}`);
}
if (catalog) {
  /* 11-19 扩编：3 → 5（新增 taste-skill / gsap-skills）。判据改成「至少 5 且必需 id 都在」，
   这样以后再加包不会因为数字对不上而误红，但仍能抓住「整个清单被清空 / 少了包」这类真问题。 */
  const requiredPackIds = ["matt-pocock-skills", "diagram-design", "how-to-live-better", "taste-skill", "gsap-skills", "shendeng"];
  ok(Array.isArray(catalog) && catalog.length >= requiredPackIds.length && requiredPackIds.every((id) => catalog.some((pack) => pack?.id === id)),
    `清单含全部必需技能包（实测 ${Array.isArray(catalog) ? catalog.length : "非数组"} 条）`);
  const ids = catalog.map((pack) => pack.id);
  ok(new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9-]+$/.test(id)), "id 唯一且是 kebab-case");
  /* 11-19：随包内置的包没有 GitHub 仓库（Playwright 用随包技能、cheat-on 本来就在包里）⇒ 跳过 repo 校验。 */
  ok(catalog.filter((pack) => !pack.bundled).every((pack) => /^[\w.-]+\/[\w.-]+$/.test(pack.repo)), "外部包的 repo 都是 owner/name（内置包豁免）");
  ok(catalog.every((pack) => pack.license && pack.licenseUrl.includes(pack.repo)), "许可徽标与许可原文链接齐全（链接指向本仓库）");
  ok(catalog.every((pack) => pack.companion.startsWith("配套")), "每条都写了「配套工具」（用户点名的三要素之一）");
  ok(catalog.every((pack) => pack.description.length >= 12 && pack.size), "说明与体积都在（卡片不留空字段）");
  /* 11-20 用户令：第三方内容要带声明（非医疗 / 署名 / 非商业限制）—— 清单是单一真相源。 */
  ok(catalog.some((pack) => pack?.id === "shendeng" && /不替代医疗/.test(String(pack?.notice ?? "")) && /CC BY-NC/.test(String(pack?.license ?? ""))),
    "神灯带使用声明（心理引导不替代医疗诊断 + CC BY-NC 非商业限制）");
}

/* ── ②③④ 安装器结构 ─────────────────────────────────────────────────── */
const feature = codeOnly(read("electron/features/skill-packs-ipc.ts"));
ok(/auditSkill\(content, await listFiles\(dir\)\)/.test(feature),
  "每个 SKILL.md 都过 auditSkill（⛔ 不许因来源知名就开旁路）");
const downloader = codeOnly(read("electron/mirror-download.ts"));
ok(/downloadThroughMirrors\(/.test(feature) && /codeload\.github\.com\/\$\{pack\.repo\}\/zip\/refs\/heads\/main/.test(feature)
  && /expandZip\(archive, outDir\)/.test(feature)
  && /mirrorCandidates\(/.test(downloader) && /rankMirrors/.test(downloader),
  "下载走统一镜像下载器（自动选最快源 + 停滞换源；zip + 仓库自带解压器）");
/* ⛔ 11-21：marker 允许为空（随包包早年只写了目录级凭据）—— 契约不是「必须有 marker」，
   而是「只删本包凭据的目录」：有 marker 走 marker，没有就按目录凭据扫（pack 必须是随包包）。 */
ok(/const marker = await readMarker\(id\);/.test(feature)
  && /if \(!pack\?\.bundled\) throw new Error\("这个包不是通过本页安装的/.test(feature)
  && /target\.startsWith\(root \+ path\.sep\)/.test(feature),
  "卸载只认本包凭据（marker 或目录凭据）+ 目录穿越闸（用户自建技能不会被误删）");
ok(/if \(installed\.length\) \{[\s\S]{0,200}?await server\.restart\(\)/.test(feature),
  "装完重启引擎（不重启模型扫不到新技能；重启前先推「正在让引擎重新扫描」阶段）");
ok(/SKILL_SKIP_DIRS = new Set\(\["deprecated", "in-progress"/.test(feature),
  "跳过仓库里标注 deprecated / in-progress 的技能目录");
/* ★ 10-30 用户实测「安装卸载太快了，要真安装真卸载」——
   三条硬判据：下载要有真实字节进度、落盘要回读校验、卸载要回读确认。 */
ok(/createWriteStream\(target\)/.test(downloader) && /onProgress\?\.\(/.test(downloader) && /content-length/i.test(downloader)
  && /onProgress: \(p\) =>/.test(feature) && /percent: p\.total \? p\.percent : 0/.test(feature),
  "下载是流式 + 真实百分比/速度进度（⛔ 不许退回一口气 arrayBuffer：界面会像「点了就完成」）");
ok(/head !== "PK"/.test(downloader) && /expectZipMagic/.test(feature),
  "落盘后校验 zip 魔数（镜像返回 200 + 错误页不算成功）");
/* ⛔ 11-03 用户：「没有取消 / 下载好慢」—— 取消必须真的中止下载并回滚本次写入的目录。 */
ok(/skill-packs:cancel/.test(feature) && /activeInstalls\.get\(id\)[\s\S]{0,120}?controller\.abort\(\)/.test(feature)
  && /new AbortController\(\)[\s\S]{0,160}?installPack\(id, controller\.signal\)/.test(feature),
  "安装可取消：skill-packs:cancel 中止下载信号（IPC 回执 cancelled）");
ok(/DownloadCancelledError/.test(feature) && /for \(const folder of installed\) await fs\.rm/.test(feature)
  && /cancelled: true/.test(feature),
  "取消后回滚本次已拷贝目录（marker 未写，不能留下半套技能）");
ok(/stalled = true; controller\.abort\(\)/.test(downloader) && /stallMs/.test(downloader),
  "下载停滞自动换源（镜像挂起不再无限等待 = 用户说的「装半天装不上」）");
ok(/写入后校验未通过/.test(feature) && /existsSync\(path\.join\(root, folder, "SKILL\.md"\)\)/.test(feature),
  "每个技能写完立即回读 SKILL.md（拷贝失败/进程被杀不能报成功）");
ok(/const remaining = owned\.filter/.test(feature) && /return \{ removed, remaining, kept \}/.test(feature),
  "卸载后回读磁盘确认目录已不存在，并把删不掉的如实返回");
/* 11-20 神灯（单根 SKILL.md 仓库）：安装目录名取 frontmatter name，不落成 shendeng-main。 */
ok(/dir === repoRoot \? await skillNameFromFile\(dir\)/.test(feature) && /const folder = \(rawName \|\| path\.basename\(dir\)\)/.test(feature),
  "单根技能仓库按 frontmatter name 建目录（⛔ 不落成 repo-main 这种解压名）");
ok(/skills: \[\.\.\.installed\]/.test(feature) && !/skills: \[\.\.\.installed, \.\.\.skipped\]/.test(feature),
  "marker 只记真正写进去的目录（⛔ 记 skipped 会把用户的同名技能一起卸掉）");
/* ★ 10-30 用户令「不要能卸载内置技能」：安装写归属凭据，卸载按凭据删（marker 被改也删不到别人的技能） */
ok(/\.skill-pack\.json/.test(feature) && /packId: id/.test(feature),
  "每个装进去的技能写归属凭据 .skill-pack.json（packId）");
ok(/owner === id\) owned\.push\(folder\); else kept\.push\(folder\);/.test(feature) && /return \{ removed, remaining, kept \}/.test(feature),
  "卸载只删带本包凭据的目录；内置 / 插件 / 用户自建的技能一律不动（kept 如实报出）");

/* ── ⑤ 接线 ─────────────────────────────────────────────────────────── */
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const channels = (manifest.channels ?? []).map((entry) => entry.channel);
ok(["skill-packs:list", "skill-packs:install", "skill-packs:cancel", "skill-packs:uninstall"].every((name) => channels.includes(name))
  && manifest.count === manifest.channels.length,
  "manifest 四条通道齐全（含 cancel）且 count 自洽");
const registry = read("electron/ipc-registry.ts");
ok(/\{ prefix: "skill-packs", count: 4,/.test(registry), "ipc-registry 登记了 skill-packs 前缀（count=4）");
ok(/"id": "skill-packs"/.test(read("electron/composition.json")) && /feat_skill_packs/.test(read("electron/composition.gen.ts")),
  "组合表启用该域（生成物里有 feat_skill_packs）");
const preload = read("electron/preload.ts");
ok(/"skill-packs:list"/.test(preload) && /"skill-packs:install"/.test(preload)
  && /"skill-packs:cancel"/.test(preload) && /"skill-packs:uninstall"/.test(preload),
  "preload 暴露四条方法（生成物，⛔ 不手改）");

const devtools = codeOnly(read("src/features/settings-devtools/DevtoolsSettingsSection.tsx"));
ok(/key: "skill-packs", icon: <PackageOpen/.test(devtools) && /openCard === "skill-packs"/.test(devtools)
  && /<SkillPacksPanel setNotice=\{setNotice\} \/>/.test(devtools),
  "开发工具一级卡片 + 二级弹窗都接上（两级 IA：面板不在一级页渲染）");

const panel = codeOnly(read("src/features/skill-packs/SkillPacksPanel.tsx"));
ok(/window\.codex\.listSkillPacks\(\)/.test(panel) && /window\.codex\.installSkillPack\(/.test(panel)
  && /window\.codex\.cancelSkillPack\(/.test(panel) && /window\.codex\.uninstallSkillPack\(/.test(panel),
  "面板只通过四条通道取数/操作");
ok(/runtime-progress-bar/.test(panel) && /event\.percent/.test(panel) && /event\.speed/.test(panel)
  && /skill-pack-cancel/.test(panel) && /已取消本次安装/.test(panel),
  "安装中显示百分比 / 速度 / 进度条，右侧按钮变「取消」；取消结果中性展示");
ok(/const activeInstalls = new Map/.test(feature) && /正在安装中，请稍候或先取消/.test(feature),
  "同一技能包不允许并发安装（避免两份下载同时写 skills 目录）");
/* 11-20 用户令「加上声明和注释，和 github 跳转」：声明卡片/预览都展示；仓库可显式跳 GitHub。 */
ok(/row\.notice/.test(panel) && /preview\.notice/.test(panel) && /className="skill-pack-notice/.test(panel)
  && /GitHub 仓库/.test(panel) && /window\.codex\.openExternal\(`https:\/\/github\.com\/\$\{preview\.repo\}`\)/.test(panel),
  "声明（卡片 + 预览）与 GitHub 显式跳转都在（跳转走 openExternal，不在应用内导航）");
/* ★ 10-30「要真安装真卸载」：界面结果必须以磁盘回读为准，不能一律绿色糊过去。 */
ok(/磁盘确认已写入/.test(panel) && /磁盘确认已不存在/.test(panel) && /没有新技能：/.test(panel),
  "界面结果以磁盘回读为准：写入数 / 已删净 / 「同名已存在」不得说成成功");
ok(/skill-pack-result \$\{result\.tone\}/.test(panel) && /tone: "error"/.test(panel),
  "失败与中性结果有不同的着色（不许一律绿色糊过去）");
ok(/打开技能目录/.test(panel) && /skillsRoot/.test(panel),
  "面板可一键打开技能目录（用户能自己核实装了什么）");
ok(/不是本包安装的目录，已保留未动/.test(panel),
  "界面把「不是本包安装、已保留」说清楚（用户能确认内置技能没被动）");
ok(!/mattpocock|diagram-design|HowToLiveBetter|\bMIT\b|CC BY/.test(panel),
  "⛔ 面板不许抄一份仓库/许可文案（单一真相源在主进程清单；类型字段名不算）");

const css = read("src/styles/34-devtools-cards.css");
const cssBlock = (css.match(/\.skill-pack-row \{[\s\S]*?\n\}/) ?? [""])[0];
ok(cssBlock.length > 0 && !/#[0-9a-fA-F]{3,6}\b/.test(cssBlock.replace(/var\(--danger, #c0392b\)/g, "")),
  "技能包列表样式存在且只用主题变量（不写死色值）");

/* ── 11-19 工具画像（用户令：普通会话不需要常驻这么多工具／专家按岗位给子集）────────────
   判据只锚结构与自洽，⛔ 不锚具体名单长度（名单会随需求变，锚死就会天天红）。 */
const profilesSrc = readFileSync(ROOT + "/electron/tool-profiles.ts", "utf8");
const grab = (name) => {
  const m = profilesSrc.match(new RegExp("export const " + name + "[^=]*=\\s*\\[([\\s\\S]*?)\\]"));
  return m ? [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]) : [];
};
const catalogTools = grab("HOST_TOOL_CATALOG");
const coreTools = grab("CORE_TOOLS");
ok(coreTools.length >= 8 && coreTools.length <= 24, `【工具画像】CORE_TOOLS 是精选子集（实测 ${coreTools.length} 个）`);
ok(coreTools.every((name) => catalogTools.includes(name)), "【工具画像】CORE_TOOLS 全部在 HOST_TOOL_CATALOG 里（⛔ 漏登记 = 默认保留 = 没纳入画像）");
ok(/export const TOOL_PROFILES_ENABLED\s*=\s*(true|false)/.test(profilesSrc), "【工具画像】有 TOOL_PROFILES_ENABLED 回滚开关（置 false 即恢复全量）");
ok(/roleKeyOf/.test(profilesSrc) && /设计|engineering|工程/.test(profilesSrc), "【工具画像】岗位判定走 roleKeyOf（识别不出岗位时回落 CORE）");

/* ── 11-21 首回合瘦身（用户令：前缀压到 ~30k token，能力不阉割）────────────────────────
   三处必须同时成立，否则「省 token」会变成「功能消失」：
     ① 内置 MCP 段 `enabled = false`（schema 不进引擎前缀）；
     ② 宿主网关仍能按需拉起它们（parseLazyBuiltinServers）；
     ③ 常驻指令走精简版，全文落盘 harness-dev-guide.md 可读。 */
const applySrc = read("electron/features/custom-model-apply.ts");
const bridgeSrc = read("electron/mcp-bridge.ts");
ok((applySrc.match(/enabled = false/g) ?? []).length >= 5 && /enabled = false/.test(read("electron/photocraft.ts")) && /enabled = false/.test(read("electron/artcraft.ts")),
  "【上下文】内置 MCP 默认 enabled=false（Craft/PhotoCraft/桌面后端/UIA/REA 不再常驻 schema）");
ok(/parseLazyBuiltinServers/.test(bridgeSrc) && /listLazyBuiltinTools/.test(bridgeSrc) && /enabled === false/.test(bridgeSrc),
  "【上下文】宿主网关按需拉起内置 MCP（能力保留：mcp_tools 查、mcp_call 调）");
ok(/leanDevInstructions/.test(read("electron/developer-instructions.ts"))
  && /lean: appSettings\.leanContext !== false/.test(read("electron/main/12-skill-discipline.ts"))
  && /harness-dev-guide\.md/.test(applySrc),
  "【上下文】常驻指令默认精简，完整细则落盘 harness-dev-guide.md 供按需读取");

/* ── 11-22 首轮再瘦身（用户令：5.7W → 极限剩，缓存命中与能力都不能伤）──────────────
   三处各自独立，任何一处回退都会把首轮打回 5W+，但都不会让能力消失。 */
{
  const ipcSrc = read("electron/features/codex-ipc.ts");
  ok(/hostKind === "normal"[\s\S]{0,900}filterToolSurface/.test(ipcSrc)
    && /restrictedThreadRole/.test(ipcSrc),
    "【上下文】resume 也按 CORE 画像收窄（⛔ 只在确认 normal 时裁；否则老会话被 58 个工具整份覆盖）");
  ok(/features\.multi_agent=false/.test(read("electron/codex-server.ts")),
    "【上下文】引擎启动关闭 deprecated multi_agent（multi_agent_v1 schema 实测 9.8KB）");
  ok(statSync(ROOT + "/AGENTS.md").size < 32768 && existsSync(ROOT + "/docs/AGENTS-DETAILS.md"),
    "【上下文】AGENTS.md 压回引擎默认上限内，查阅型细则外置 docs/AGENTS-DETAILS.md");
  /* 11-22 二轮：真实会话实测技能索引 29,158 字符（116 个技能，第三方包描述很长）⇒ 只下发名字 + 路径。
     ⛔ 省 token 的前提是**检索补齐**：find_skills 必须覆盖引擎实际暴露的全部根。 */
  const serverSrc = read("electron/codex-server.ts");
  const skillsIpcSrc = read("electron/features/skills-ipc.ts");
  ok(/features\.omit_skill_descriptions=true/.test(serverSrc),
    "【上下文】技能索引只下发名字 + 路径（omit_skill_descriptions）");
  ok(/\.system/.test(skillsIpcSrc) && /\.agents["'],\s*"skills"/.test(skillsIpcSrc),
    "【上下文】find_skills 覆盖 codex-home/skills、.system 与 ~/.agents/skills（省描述后仍可按用途检索）");
}

console.log("\n【随包包的真实装态（11-21 修「别的电脑安装不了 / 装了也不更新状态」）】");
/* 根因：旧实现把「随包源目录里有技能」直接当 installed ⇒ 每台机器都显示已安装，
   界面只给「更新」不给「安装」，点完也看不出变化；且随包包没写包级凭据，装完卸不掉。 */
ok(/async function installedBundledOf/.test(feature)
  && /installed: present\.length > 0/.test(feature)
  && !/installed: pack\.bundled \? present\.length > 0/.test(feature),
  "装态来自**用户技能目录**（⛔ 不再拿随包源目录当「已安装」）");
ok(/const bundledSkills = pack\.bundled \? await bundledSkillsOf\(pack\.bundled\.dir\) : \[\]/.test(feature)
  && /\n\s*bundledSkills,/.test(feature),
  "源清单与装态分开下发（bundledSkills = 可装清单，installed = 真装了）");
ok(/installedBundledOf\(pack\.id, bundledSkills\)/.test(feature)
  && /String\(stamp\?\.packId \?\? ""\) === packId/.test(feature),
  "随包技能认领只认本包凭据（用户自己的同名技能没有凭据，不算已装）");
ok(/repo: "bundled", skills: merged/.test(feature),
  "随包包安装后写**包级**凭据（否则装完点卸载会报「不是通过本页安装的」）");
ok(/folders = await installedBundledOf/.test(feature) && /没有找到本包装过的技能目录/.test(feature),
  "卸载支持随包包：无包级凭据时按目录凭据扫（旧安装也能卸）");
ok(/server\.restart\(\)\.catch\(\(error: Error\)/.test(feature),
  "引擎重启失败不把「技能已拷好」报成安装失败");
ok(/else if \(row\.bundled\)[\s\S]{0,420}primary-setting[\s\S]{0,160}安装/.test(panel),
  "界面：随包但**未装** ⇒ 主按钮「安装」（旧实现永远只给「更新」，用户看不出装没装）");
ok(/else if \(row\.installed\)[\s\S]{0,420}skill-pack-remove/.test(panel),
  "界面：已装（含随包包）⇒ 「更新 + 卸载」");

console.log(`\n【skill-packs】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
