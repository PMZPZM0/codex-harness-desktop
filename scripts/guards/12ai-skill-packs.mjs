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
import { readFileSync } from "node:fs";
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
  ok(Array.isArray(catalog) && catalog.length === 3, `清单是 3 条（实测 ${Array.isArray(catalog) ? catalog.length : "非数组"}）`);
  const ids = catalog.map((pack) => pack.id);
  ok(new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9-]+$/.test(id)), "id 唯一且是 kebab-case");
  ok(catalog.every((pack) => /^[\w.-]+\/[\w.-]+$/.test(pack.repo)), "repo 都是 owner/name");
  ok(catalog.every((pack) => pack.license && pack.licenseUrl.includes(pack.repo)), "许可徽标与许可原文链接齐全（链接指向本仓库）");
  ok(catalog.every((pack) => pack.companion.startsWith("配套")), "每条都写了「配套工具」（用户点名的三要素之一）");
  ok(catalog.every((pack) => pack.description.length >= 12 && pack.size), "说明与体积都在（卡片不留空字段）");
}

/* ── ②③④ 安装器结构 ─────────────────────────────────────────────────── */
const feature = codeOnly(read("electron/features/skill-packs-ipc.ts"));
ok(/auditSkill\(content, await listFiles\(dir\)\)/.test(feature),
  "每个 SKILL.md 都过 auditSkill（⛔ 不许因来源知名就开旁路）");
ok(/mirrorCandidates\(/.test(feature) && /codeload\.github\.com\/\$\{pack\.repo\}\/zip\/refs\/heads\/main/.test(feature)
  && /expandZip\(archive, outDir\)/.test(feature),
  "下载走 gh-mirror 候选序（zip + 仓库自带解压器；⛔ Windows bsdtar 解 GitHub tar.gz 会 Can't create，实测踩过）");
ok(/const marker = await readMarker\(id\);\s*\n\s*if \(!marker\) throw new Error\("这个包不是通过本页安装的/.test(feature)
  && /target\.startsWith\(root \+ path\.sep\)/.test(feature),
  "卸载只认自己写的 marker + 目录穿越闸（用户自建技能不会被误删）");
ok(/if \(installed\.length\) await server\.restart\(\)/.test(feature),
  "装完重启引擎（不重启模型扫不到新技能）");
ok(/SKILL_SKIP_DIRS = new Set\(\["deprecated", "in-progress"/.test(feature),
  "跳过仓库里标注 deprecated / in-progress 的技能目录");
/* ★ 10-30 用户实测「安装卸载太快了，要真安装真卸载」——
   三条硬判据：下载要有真实字节进度、落盘要回读校验、卸载要回读确认。 */
ok(/createWriteStream\(target\)/.test(feature) && /onProgress\?\.\(received, total\)/.test(feature) && /BODY|content-length/i.test(feature),
  "下载是流式 + 报真实字节进度（⛔ 不许退回一口气 arrayBuffer：界面会像「点了就完成」）");
ok(/head !== "PK"/.test(feature) && /下载内容不是 zip/.test(feature),
  "落盘后校验 zip 魔数（镜像返回 200 + 错误页不算成功）");
ok(/写入后校验未通过/.test(feature) && /existsSync\(path\.join\(root, folder, "SKILL\.md"\)\)/.test(feature),
  "每个技能写完立即回读 SKILL.md（拷贝失败/进程被杀不能报成功）");
ok(/const remaining = marker\.skills\.filter/.test(feature) && /return \{ removed, remaining \}/.test(feature),
  "卸载后回读磁盘确认目录已不存在，并把删不掉的如实返回");
ok(/skills: \[\.\.\.installed\]/.test(feature) && !/skills: \[\.\.\.installed, \.\.\.skipped\]/.test(feature),
  "marker 只记真正写进去的目录（⛔ 记 skipped 会把用户的同名技能一起卸掉）");

/* ── ⑤ 接线 ─────────────────────────────────────────────────────────── */
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const channels = (manifest.channels ?? []).map((entry) => entry.channel);
ok(["skill-packs:list", "skill-packs:install", "skill-packs:uninstall"].every((name) => channels.includes(name))
  && manifest.count === manifest.channels.length,
  "manifest 三条通道齐全且 count 自洽");
const registry = read("electron/ipc-registry.ts");
ok(/\{ prefix: "skill-packs", count: 3,/.test(registry), "ipc-registry 登记了 skill-packs 前缀（count=3）");
ok(/"id": "skill-packs"/.test(read("electron/composition.json")) && /feat_skill_packs/.test(read("electron/composition.gen.ts")),
  "组合表启用该域（生成物里有 feat_skill_packs）");
const preload = read("electron/preload.ts");
ok(/"skill-packs:list"/.test(preload) && /"skill-packs:install"/.test(preload) && /"skill-packs:uninstall"/.test(preload),
  "preload 暴露三条方法（生成物，⛔ 不手改）");

const devtools = codeOnly(read("src/features/settings-devtools/DevtoolsSettingsSection.tsx"));
ok(/key: "skill-packs", icon: <PackageOpen/.test(devtools) && /openCard === "skill-packs"/.test(devtools)
  && /<SkillPacksPanel setNotice=\{setNotice\} \/>/.test(devtools),
  "开发工具一级卡片 + 二级弹窗都接上（两级 IA：面板不在一级页渲染）");

const panel = codeOnly(read("src/features/skill-packs/SkillPacksPanel.tsx"));
ok(/window\.codex\.listSkillPacks\(\)/.test(panel) && /window\.codex\.installSkillPack\(/.test(panel) && /window\.codex\.uninstallSkillPack\(/.test(panel),
  "面板只通过三条通道取数/操作");
/* ★ 10-30「要真安装真卸载」：界面结果必须以磁盘回读为准，不能一律绿色糊过去。 */
ok(/磁盘确认已写入/.test(panel) && /磁盘确认已不存在/.test(panel) && /没有新技能：/.test(panel),
  "界面结果以磁盘回读为准：写入数 / 已删净 / 「同名已存在」不得说成成功");
ok(/skill-pack-result \$\{result\.tone\}/.test(panel) && /tone: "error"/.test(panel),
  "失败与中性结果有不同的着色（不许一律绿色糊过去）");
ok(/打开技能目录/.test(panel) && /skillsRoot/.test(panel),
  "面板可一键打开技能目录（用户能自己核实装了什么）");
ok(!/mattpocock|diagram-design|HowToLiveBetter|\bMIT\b|CC BY/.test(panel),
  "⛔ 面板不许抄一份仓库/许可文案（单一真相源在主进程清单；类型字段名不算）");

const css = read("src/styles/34-devtools-cards.css");
const cssBlock = (css.match(/\.skill-pack-row \{[\s\S]*?\n\}/) ?? [""])[0];
ok(cssBlock.length > 0 && !/#[0-9a-fA-F]{3,6}\b/.test(cssBlock.replace(/var\(--danger, #c0392b\)/g, "")),
  "技能包列表样式存在且只用主题变量（不写死色值）");

console.log(`\n【skill-packs】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
