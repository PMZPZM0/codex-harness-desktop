/**
 * 内置技能独立开关 · 守卫（2026-10-06 立）
 *
 * 守的是用户那条需求的可执行部分：
 *   「把技能封装成**可独立切换**的开关，控制台新增开关项；**默认开启**；
 *     状态**持久化**，重启后保持用户上次设置，**不会自动重置为默认值**。」
 *
 * ⛔ 为什么必须真跑（本守卫一半以上的分量在这）：
 *   「重启后不会自己开回来」是**跨启动的时序行为**，静态看代码看不出对错 ——
 *   旧实现（只认 `SKILL.md.disabled`、且优先看 `SKILL.md` 在不在）读起来完全正常，
 *   实测却在重启时把停用技能**写回 SKILL.md**（引擎可见 = 关了还在生效）。
 *   同族教训：`11d` 的 TRUTH 存的其实是内容矩形自身，判据永远绿。
 *
 * ⚠️ 覆盖边界（如实声明）：**不真跑 IPC handler**。skills 域传递依赖会拉到
 *   `dev-runtimes.js` 的模块级 `fs.watch`（stub 环境下 ENOENT，拉不起来）。
 *   ⇒ 那一段的判据是「真跑它调用的池层函数」+「静态锚 handler 的**接线本身**」
 *     （锚 `setSkillPoolState(..., { globalDisabled: … })` 这行调用，不是锚注释）。
 *
 * ⛔ 负向断言一律先剥注释（`codeOnly`）：本文件头注就在讲这些坑，裸 `!/…/` 会被自己打成假红。
 */
import Module, { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./_ctx.mjs";

const require = createRequire(import.meta.url);

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【skills-switch】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (source) => String(source)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");

const packSrc = read("electron/skill-pack.ts");
const builtinSrc = read("electron/builtin-skills.ts");
const poolSrc = read("electron/skill-pool.ts");
const skillsIpcSrc = read("electron/features/skills-ipc.ts");
const pageSrc = read("src/features/settings-general/GeneralSettingsSection.tsx");
const widgetSrc = read("src/features/settings-general/BuiltinSkillSwitch.tsx");
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registrySrc = read("electron/ipc-registry.ts");

/* ── ① 停用态的文件名：两种形态必须同源，且判据要一起认 ────────────────── */
ok(/SKILL_FILE_POOL_DISABLED\s*=\s*"SKILL\.md\.pool-disabled"/.test(packSrc),
  "skill-pack 定义池停用文件名常量（与 skill-pool 的投影同源）");
ok(/\[SKILL_FILE_DISABLED,\s*SKILL_FILE_POOL_DISABLED\]/.test(codeOnly(builtinSrc)),
  "⛔⛔ 判「启用没有」时两种停用名**一起认**（只认一个 = 关掉的技能下次启动自己又开）");
ok(/disabledVariantOf\(dir\)\s*\?\?\s*activeFile/.test(codeOnly(builtinSrc)),
  "⛔ entries 循环以**停用态优先**取写入目标");
ok(!/existsSync\(activeFile\)\s*\n?\s*\?\s*activeFile/.test(codeOnly(builtinSrc)),
  "⛔ 负向：不许退回「优先看 SKILL.md 在不在」的旧判据（那就是重启复活本身）");
ok(/rel === SKILL_FILE \? disabledVariantOf\(target\)/.test(codeOnly(builtinSrc)),
  "目录型内置技能（zy-*）走同一判据（升级同步时不复活）");
ok((codeOnly(builtinSrc).match(/retireActiveCopyIfOff\(/g) || []).length >= 3,
  "并存态自愈被调用于两个域（entries + 目录型）+ 自身定义");
ok(!/["']SKILL\.md\.pool-disabled["']/.test(codeOnly(poolSrc)),
  "⛔ 负向：skill-pool 不再写字面量（一律走 skill-pack 常量，防两处漂移）");
ok(/if \(!String\(cwd \?\? ""\)\.trim\(\)\) return new Set\(\)/.test(codeOnly(poolSrc))
  && /if \(!String\(cwd \?\? ""\)\.trim\(\)\) return;/.test(codeOnly(poolSrc)),
  "池读写对**空 cwd** 有守卫（控制台开关可能在没打开工作区时被点；不许读/写相对路径）");

/* ── ② 主进程 handler 的接线（真跑它在池层，这里锚接线这一行）──────────── */
ok(/readGlobalDisabled\(codexHome\)\.has\(name\)/.test(codeOnly(skillsIpcSrc)),
  "开关读取走**全局停用集**（真相源），不另存一份");
ok(/setSkillPoolState\(String\(input\?\.cwd \?\? ""\), name, \{ globalDisabled: input\?\.enabled === false \}\)/.test(codeOnly(skillsIpcSrc)),
  "⛔ 开关写回 = setSkillPoolState(globalDisabled)（与技能页共享技能池同一真相源）");
ok(/globalSkillsDir\(codexHome\)/.test(codeOnly(skillsIpcSrc)),
  "开关先判技能是否**真的存在**（available），不存在时给出明确回执而不是静默失败");

/* ── ③ 渲染层：控制台的开关项 ─────────────────────────────────────────── */
ok(/<BuiltinSkillSwitch/.test(pageSrc) && /skill="i-have-adhd"/.test(pageSrc),
  "控制台页挂了这条技能对应的开关项");
ok(/from "\.\/BuiltinSkillSwitch"/.test(pageSrc), "控制台页确实引用了该组件（不是只写了标签）");
ok(/<ToggleSwitch/.test(widgetSrc) && !/<input[^>]*type=["']checkbox["']/.test(codeOnly(widgetSrc)),
  "⛔ 复用共享 ToggleSwitch（负向：不许散装写 checkbox；守卫【234】⑧ 同族）");
ok(!/localStorage\.setItem/.test(codeOnly(widgetSrc)),
  "⛔ 负向：开关态**不存渲染层**（只读 workspace；状态由主进程持久化，避免两份真相源）");
ok(/getBuiltinSkillSwitch/.test(widgetSrc) && /setBuiltinSkillSwitch/.test(widgetSrc),
  "组件通过新通道读写（不是直接改文件）");

/* ── ③b 共享技能池页：全局停用态必须**留恢复入口** ─────────────────────
   10-06 之前这个分支是死代码（界面上没有任何入口能产生「全局停用」）；控制台开关让它成了活路径，
   而原来的写法会给出**死胡同指引**（让用户去「我的技能」——那张卡片对内置技能本来就禁用）。 */
const poolUi = read("src/features/settings-skills/SkillPoolSection.tsx");
ok(/globalOff \? \{ globalDisabled: false \} : \{ projectDisabled: active \}/.test(codeOnly(poolUi)),
  "⛔ 池页在「全局停用」态下点开关 = 全局恢复（清全局停用集），不是只改本项目");
ok(!/disabled=\{globalOff/.test(codeOnly(poolUi)),
  "⛔ 负向：不许再把全局停用态的开关禁用掉（那就是没有恢复入口的死胡同）");

/* ── ④ 通道与 registry 账本 ───────────────────────────────────────────── */
const CHANNELS = ["skills:builtin-switch-get", "skills:builtin-switch-set"];
for (const ch of CHANNELS) {
  const entry = manifest.channels.find((c) => c.channel === ch);
  ok(Boolean(entry), `manifest 登记 ${ch}`);
  if (entry) ok(/cwd\?:/.test(entry.paramsDecl) === ch.endsWith("-set"), `${ch} 的 cwd 可选性符合设计（set 可空、get 不需要）`);
}
const skillsInManifest = manifest.channels.filter((c) => String(c.channel).startsWith("skills:")).map((c) => c.channel);
ok(skillsInManifest.length === 12, `skills 域在 manifest 里共 ${skillsInManifest.length} 条（10 + 新增 2）`);
const regLine = (registrySrc.match(/\{ prefix: "skills", count: (\d+),[\s\S]*?channels: \[([^\]]*)\]/) || []);
ok(regLine[1] === String(skillsInManifest.length),
  `⛔ ipc-registry 的 skills count（${regLine[1]}）== manifest 实际条数（${skillsInManifest.length}）`);
const regChannels = String(regLine[2] || "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
ok(regChannels.length === skillsInManifest.length && regChannels.every((c) => skillsInManifest.includes(c)),
  "⛔ ipc-registry 的通道清单与 manifest **逐条对齐**（漏一条【2】会红，这里提前拦）");

/* ── ⑤ 真跑：跨启动的启停往返（临时目录，绝不碰真实用户数据）────────── */
const root = mkdtempSync(path.join(os.tmpdir(), "skills-switch-"));
const userData = path.join(root, "userData");
const projectDir = path.join(root, "project");
const { mkdirSync } = await import("node:fs");
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });

const origLoad = Module._load;
const electronStub = {
  app: {
    getPath: (n) => (n === "userData" ? userData : path.join(root, n)),
    isPackaged: false, on() {}, once() {}, whenReady: () => Promise.resolve(),
  },
  BrowserWindow: function () {},
  nativeTheme: { shouldUseDarkColors: false },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  shell: {}, dialog: {}, clipboard: {},
};
Module._load = function (request) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

const NAME = "i-have-adhd";
try {
  const E = path.join(ROOT, "dist-electron");
  require(path.join(E, "runtime-paths.js")).initRuntimePaths();
  const builtin = require(path.join(E, "builtin-skills.js"));
  const pool = require(path.join(E, "skill-pool.js"));

  const skillsDir = path.join(userData, "codex-home", "skills");
  const dir = path.join(skillsDir, NAME);
  const snap = () => ({
    on: existsSync(path.join(dir, "SKILL.md")),
    poolOff: existsSync(path.join(dir, "SKILL.md.pool-disabled")),
  });

  /* 冷启动：默认开启 */
  await builtin.ensureBuiltinSkills(skillsDir);
  const s1 = snap();
  ok(s1.on === true && s1.poolOff === false, "真跑：默认状态 = 开启");

  /* 关掉 → 落盘持久化 */
  pool.setSkillPoolState(projectDir, NAME, { globalDisabled: true });
  const s2 = snap();
  ok(s2.on === false && s2.poolOff === true, "真跑：关掉后磁盘改名（引擎扫不到 = 不生效）");
  ok(readFileSync(path.join(userData, "codex-home", "skill-global-disabled.json"), "utf8").includes(NAME),
    "真跑：停用已写进全局停用集（唯一真相源）");

  /* ⛔⛔ 核心：模拟重启 —— 启动链会再跑一次 ensureBuiltinSkills */
  await builtin.ensureBuiltinSkills(skillsDir);
  const s3 = snap();
  ok(s3.on === false && s3.poolOff === true,
    "真跑：**重启后仍是关闭态**（用户点名要求：不会自动重置为默认值）");

  /* 会话启动时的池投影也不会把它弄回来 */
  pool.syncSkillPool(projectDir);
  const s4 = snap();
  ok(s4.on === false && s4.poolOff === true, "真跑：首个 thread/start 的池投影后仍是关闭态");

  /* UI 读到的与磁盘一致 */
  const d = pool.describeSkillPool(projectDir).skills.find((x) => x.name === NAME);
  ok(Boolean(d) && d.globalDisabled === true && d.active === false, "真跑：描述接口与磁盘一致（界面不会显示成开启）");

  /* 重开可逆 */
  pool.setSkillPoolState(projectDir, NAME, { globalDisabled: false });
  const s5 = snap();
  ok(s5.on === true && s5.poolOff === false, "真跑：重新开启后 SKILL.md 回来（可逆）");
  await builtin.ensureBuiltinSkills(skillsDir);
  ok(snap().on === true, "真跑：开启态同样经得起重启");

  /* 自愈：旧 bug 在线上用户磁盘上留下的「并存态」要被归位 */
  pool.setSkillPoolState(projectDir, NAME, { globalDisabled: true });
  copyFileSync(path.join(dir, "SKILL.md.pool-disabled"), path.join(dir, "SKILL.md"));
  const s6 = snap();
  ok(s6.on === true && s6.poolOff === true, "真跑：先造出并存态（前提）");
  await builtin.ensureBuiltinSkills(skillsDir);
  const s7 = snap();
  ok(s7.on === false && s7.poolOff === true, "真跑：并存态被**自愈**（关了就是关了，不让引擎再扫到）");
} catch (error) {
  ok(false, `真跑段抛异常：${String(error && error.stack || error).slice(0, 300)}`);
} finally {
  Module._load = origLoad;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录，删不掉无妨 */ }
}

console.log(`\n【skills-switch】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
