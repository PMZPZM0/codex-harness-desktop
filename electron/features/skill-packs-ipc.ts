/**
 * 精选技能包（skill-packs，10-30 立）
 *
 * 用户令（10-30）：「榜单里看看哪些有用，放到开发工具界面做按需下载，配套好看的 UI、实用说明、配套工具」。
 * 结论：榜单里只有「技能类」的三项适合内置安装（其余是独立 App / 竞品工作台 / 只支持 mac），
 *   ⇒ 本板块只做**技能包**：仓库里 `skills/` 下的 SKILL.md 目录，一键装到 `<codex-home>/skills`。
 *
 * ⛔ 与技能市场的分工：市场（Gitee / Codex 官方）是**整仓插件**；这里只取 `skills/` 子树，
 *   一个包可能带多个技能，装完列出装了哪些、跳过哪些。
 * ⛔ 每个 SKILL.md 必过 `auditSkill`（09-23 用户明令：任何技能安装前必须审）——不许因为
 *   「来源是知名仓库」开旁路。
 * ⛔ 只认自己写下的 marker 才允许卸载：用户在技能页自己建的目录不许被这里误删。
 * ⛔ 下载走 gh-mirror 的候选序（gh-proxy → ghfast → 直连），与更新/市场同一条纪律。
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { codexHome, server } from "../runtime-refs";
import { globalSkillsDir } from "../skill-pack";
import { auditSkill, expandZip } from "../skills-market";
import { downloadThroughMirrors, DownloadCancelledError } from "../mirror-download";
import { sendToWindow } from "./window-bus";
import { SKILL_PACKS, type SkillPackDef } from "../skill-packs-catalog";

/** 给用户看的体积（1024 进制，与卡片上的「约 N MB」同口径）。 */
function mb(bytes: number): string {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "0 MB";
}

const PACK_IDS = new Set(SKILL_PACKS.map((pack) => pack.id));
const SKILL_SKIP_DIRS = new Set(["deprecated", "in-progress", ".git", "node_modules", "__pycache__"]);

type PackMarker = { id: string; repo: string; license: string; skills: string[]; installedAt: string };

function skillsRoot() {
  return globalSkillsDir(codexHome);
}

function markerFile(id: string) {
  return path.join(codexHome, "skill-packs", `${id}.json`);
}

async function readMarker(id: string): Promise<PackMarker | null> {
  try {
    const raw = JSON.parse(await fs.readFile(markerFile(id), "utf8"));
    if (!raw || !Array.isArray(raw.skills)) return null;
    return raw as PackMarker;
  } catch {
    return null;
  }
}

/** 下载速度文案（给 UI 的 message 用；进度条本身用 percent 字段）。 */
function speedText(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
}

/** 递归找含有 SKILL.md 的目录（仓库里可能按 engineering / productivity 再分一层）。 */
async function findSkillDirs(root: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const found: string[] = [];
  let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[] = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md")) return [root];
  for (const entry of entries) {
    if (!entry.isDirectory() || SKILL_SKIP_DIRS.has(entry.name)) continue;
    found.push(...await findSkillDirs(path.join(root, entry.name), depth + 1));
  }
  return found;
}

async function listFiles(dir: string, base = dir, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const out: string[] = [];
  let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    out.push(path.relative(base, full).replace(/\\/g, "/"));
    if (entry.isDirectory()) out.push(...await listFiles(full, base, depth + 1));
  }
  return out;
}

async function packState(pack: SkillPackDef) {
  const marker = await readMarker(pack.id);
  /* 随包内置的包没有 marker（不是下载装的）⇒ 技能列表直接扫 resources/expert-skills/<dir>。 */
  const present = pack.bundled
    ? await bundledSkillsOf(pack.bundled.dir)
    : marker
      ? marker.skills.filter((folder) => existsSync(path.join(skillsRoot(), folder, "SKILL.md")))
      : [];
  return {
    ...pack,
    /* 11-19：分类 / 包内技能 / 配套专家一并下发（界面按分类分组、逐条展示与做「拆开」）。 */
    category: pack.category,
    skills: pack.skills ?? [],
    experts: pack.experts ?? [],
    /* 随包内置：装没装由磁盘算，界面据此隐藏下载/卸载按钮。 */
    bundled: Boolean(pack.bundled),
    /** 市场原位注册的内置包：界面不提供「更新」（随应用升级）。 */
    bundledMarket: Boolean(pack.bundled?.market),
    installed: pack.bundled ? present.length > 0 : Boolean(marker) && present.length > 0,
    installedSkills: present,
    installedAt: marker?.installedAt ?? "",
    /** 技能根目录（界面「打开技能目录」用；用户本来就有这个目录） */
    skillsRoot: skillsRoot(),
  };
}

/** 仓库里没有 `skills/` 时：扫 root 下 ≤2 层的 SKILL.md 目录（单技能仓库，如 Leonxlnx/taste-skill）。 */
async function findSkillDirsInRepo(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 2) return;
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (existsSync(path.join(dir, "SKILL.md"))) { out.push(dir); return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };
  await walk(root, 0);
  return out;
}

/** 随包内置技能：扫 resources/expert-skills/<dir>（根 SKILL.md 或 skills/<n>/SKILL.md）。 */
function bundledBaseDir(dir: string): string {
  const root = path.join(process.resourcesPath ?? "", "expert-skills", dir);
  const fallback = path.join(app.getAppPath(), "resources", "expert-skills", dir);
  return existsSync(root) ? root : fallback;
}

async function bundledSkillsOf(dir: string): Promise<string[]> {
  const base = bundledBaseDir(dir);
  if (!existsSync(base)) return [];
  /* 有的包**同时**有根 SKILL.md 和 skills/ 子技能（cheat-on-content 就是：根 + 15 个子技能）
     ⇒ 两边都收，按名字去重，别只取根目录那一个。 */
  const out: string[] = [];
  if (existsSync(path.join(base, "SKILL.md"))) out.push(path.basename(base));
  const inner = path.join(base, "skills");
  if (existsSync(inner)) {
    for (const name of await fs.readdir(inner).catch(() => [] as string[])) {
      if (existsSync(path.join(inner, name, "SKILL.md")) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

type InstallResult = { installed: string[]; skipped: string[]; rejected: string[]; bytes: number; cancelled?: boolean };

/** 随包内置包「更新」：把 resources 里的技能同步到技能目录（覆盖本包旧拷贝，跳过他人同名）。 */
async function syncBundledPack(pack: SkillPackDef, emit: (stage: string, message: string) => void): Promise<InstallResult> {
  /* ⛔ 市场原位注册的包（cheat-on-content）：文件已在 resources 里被 config.toml 注册，
     再拷一份到 skills 目录 = 同一技能被两处发现（本项目踩过）。这里只如实回报。 */
  if (pack.bundled?.market) return { installed: [], skipped: [], rejected: [], bytes: 0 };
  const root = skillsRoot();
  const dir = pack.bundled?.dir ?? "";
  const base = bundledBaseDir(dir);
  if (!existsSync(base)) throw new Error("随包技能目录缺失（安装包不完整）");
  const sources: Array<{ name: string; from: string }> = [];
  if (existsSync(path.join(base, "SKILL.md"))) sources.push({ name: path.basename(base), from: base });
  const inner = path.join(base, "skills");
  if (existsSync(inner)) {
    for (const name of await fs.readdir(inner).catch(() => [] as string[])) {
      if (existsSync(path.join(inner, name, "SKILL.md"))) sources.push({ name, from: path.join(inner, name) });
    }
  }
  if (!sources.length) throw new Error("随包目录里没有可同步的技能");
  await fs.mkdir(root, { recursive: true });
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const [index, item] of sources.entries()) {
    const target = path.join(root, item.name);
    let ownedByMe = !existsSync(target);
    if (existsSync(target)) {
      try {
        const owned = JSON.parse(await fs.readFile(path.join(target, ".skill-pack.json"), "utf8")) as { packId?: string };
        ownedByMe = String(owned?.packId ?? "") === pack.id;
      } catch { ownedByMe = false; }
      if (!ownedByMe) { skipped.push(item.name); continue; }
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    }
    emit("install", `正在同步 ${item.name}（${index + 1}/${sources.length}）…`);
    await fs.cp(item.from, target, { recursive: true });
    await fs.writeFile(path.join(target, ".skill-pack.json"), JSON.stringify({ packId: pack.id, repo: "bundled", installedAt: new Date().toISOString() }, null, 2), "utf8").catch(() => undefined);
    installed.push(item.name);
  }
  if (installed.length) {
    emit("restart", "正在让引擎重新扫描技能…");
    await server.restart();
  }
  return { installed, skipped, rejected: [], bytes: 0 };
}

async function installPack(id: string, signal?: AbortSignal, options: { update?: boolean } = {}): Promise<InstallResult> {
  const pack = SKILL_PACKS.find((entry) => entry.id === id);
  if (!pack) throw new Error("未知的技能包");
  const emit = (stage: string, message: string, extra: { percent?: number; speed?: string; host?: string } = {}) =>
    sendToWindow("harness:event", { type: "skill-pack-install", packId: id, stage, message, at: Date.now(), ...extra });
  /* 随包内置包没有下载：直接走同步分支（同样支持 update，覆盖本包旧拷贝）。 */
  if (pack.bundled) return syncBundledPack(pack, (stage, message) => emit(stage, message));
  const cancelled = () => Boolean(signal?.aborted);
  const work = path.join(app.getPath("temp"), `skill-pack-${id}-${Date.now()}`);
  const archive = path.join(work, "pack.zip");
  const outDir = path.join(work, "out");
  const installed: string[] = [];
  const root = skillsRoot();
  try {
    await fs.mkdir(outDir, { recursive: true });
    emit("download", "正在选择最快的下载源…", { percent: 0 });
    const dl = await downloadThroughMirrors({
      url: `https://codeload.github.com/${pack.repo}/zip/refs/heads/main`,
      target: archive,
      signal,
      expectZipMagic: true,
      onProgress: (p) => {
        const speed = speedText(p.bytesPerSec);
        emit("download", p.total
          ? `正在下载 ${mb(p.received)} / ${mb(p.total)}${speed ? ` · ${speed}` : ""}（${p.host}）`
          : `正在下载 ${mb(p.received)}${speed ? ` · ${speed}` : ""}（${p.host}）`,
        { percent: p.total ? p.percent : 0, speed, host: p.host });
      },
    });
    const bytes = dl.bytes;
    if (cancelled()) throw new DownloadCancelledError();
    emit("extract", `下载完成（${mb(bytes)}），正在解压…`, { percent: 100 });
    await expandZip(archive, outDir);
    if (cancelled()) throw new DownloadCancelledError();
    const roots = await fs.readdir(outDir);
    const repoRoot = roots.length === 1 ? path.join(outDir, roots[0]) : outDir;
    /* ⛔ 不再强制要求 skills/：单技能仓库（如 taste-skill）技能就在根目录或一层子目录里。 */
    const skillsDir = path.join(repoRoot, "skills");
    const dirs = existsSync(skillsDir) ? await findSkillDirs(skillsDir) : await findSkillDirsInRepo(repoRoot);
    if (!dirs.length) throw new Error("仓库里没有找到任何 SKILL.md");
    await fs.mkdir(root, { recursive: true });
    const skipped: string[] = [];
    const rejected: string[] = [];
    for (const dir of dirs) {
      if (cancelled()) throw new DownloadCancelledError();
      const folder = path.basename(dir).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      if (!folder) continue;
      const target = path.join(root, folder);
      if (existsSync(target)) {
        /* 更新模式：只覆盖**本包自己装的**目录（读凭据里的 packId）；
           ⛔ 用户自己的同名技能 / 别的包装的 / 内置技能一律不碰（继续走 skipped）。 */
        let ownedByPack = false;
        try {
          const owned = JSON.parse(await fs.readFile(path.join(target, ".skill-pack.json"), "utf8")) as { packId?: string };
          ownedByPack = String(owned?.packId ?? "") === id;
        } catch { ownedByPack = false; }
        if (!(options.update && ownedByPack)) { skipped.push(folder); continue; }
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
      const content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
      const findings = auditSkill(content, await listFiles(dir));
      if (findings.length) { rejected.push(`${folder}（${findings.join("；")}）`); continue; }
      emit("install", `正在写入 ${folder}（${installed.length + 1}/${dirs.length}）…`);
      await fs.cp(dir, path.join(root, folder), { recursive: true });
      // ⛔ 写完立即回读校验：拷贝失败/进程被杀时不能报成功
      if (!existsSync(path.join(root, folder, "SKILL.md"))) { rejected.push(`${folder}（写入后校验未通过）`); continue; }
      /* 10-30 用户令「不要能卸载内置技能」：每个技能目录里留一份**归属凭据**。
         卸载只删带本包凭据的目录 —— 即使 marker 文件被写坏/手工改过，也删不到
         内置技能、插件技能或用户自己放的技能。 */
      await fs.writeFile(path.join(root, folder, ".skill-pack.json"), JSON.stringify({ packId: id, repo: pack.repo, installedAt: new Date().toISOString() }, null, 2), "utf8").catch(() => undefined);
      installed.push(folder);
    }
    if (cancelled()) throw new DownloadCancelledError();
    // ⛔ marker 只记**我们真的写进去的**目录：skipped 是同名已存在（可能是用户自己的技能），
    //   记进来会导致卸载时把它们一起删掉（实测：卸载把两个预装技能也删了）。
    const marker: PackMarker = { id, repo: pack.repo, license: pack.license, skills: [...installed], installedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(markerFile(id)), { recursive: true });
    await fs.writeFile(markerFile(id), JSON.stringify(marker, null, 2), "utf8");
    emit("complete", installed.length ? `磁盘已确认写入 ${installed.length} 个技能` : "没有新技能可装", { percent: 100 });
    // 技能目录变了必须重启引擎，模型才会重新扫描到这个技能（与技能导入/市场安装同口径）
    if (installed.length) {
      emit("restart", "正在让引擎重新扫描技能…", { percent: 100 });
      await server.restart();
    }
    return { installed, skipped, rejected, bytes };
  } catch (error) {
    if (error instanceof DownloadCancelledError || cancelled()) {
      /* 取消后回滚本次已经拷贝进去的技能目录（marker 还没写，留着会变成"用户自己的技能"，
         卸载也清不掉）。只删本次新建的目录 —— skipped 的同名目录不在列表里。 */
      for (const folder of installed) await fs.rm(path.join(root, folder), { recursive: true, force: true }).catch(() => undefined);
      emit("cancelled", "已取消，临时文件与已写入的目录已清理");
      throw new DownloadCancelledError();
    }
    throw error;
  } finally {
    void fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 卸载后**回读磁盘**确认目录真的没了（⛔ 不能只凭 rm 返回就报「已卸载」）。
 *  ⛔ 用户 10-30 令「不要能卸载内置技能」：只删**本包装的时候留下凭据**（.skill-pack.json 的 packId）
 *     的目录。内置技能、插件提供的技能、用户自己放的技能一律不碰（kept 里如实报出）。
 */
async function uninstallPack(id: string): Promise<{ removed: string[]; remaining: string[]; kept: string[] }> {
  const marker = await readMarker(id);
  if (!marker) throw new Error("这个包不是通过本页安装的，未做删除");
  const root = path.resolve(skillsRoot());
  const owned: string[] = [];
  const kept: string[] = [];
  for (const folder of marker.skills) {
    const target = path.resolve(root, folder);
    // ⛔ 目录穿越闸：只处理技能根目录内、且是自己 marker 记下的目录
    if (!target.startsWith(root + path.sep)) continue;
    if (!existsSync(target)) continue;
    const stamp = await fs.readFile(path.join(target, ".skill-pack.json"), "utf8").catch(() => "");
    let owner = "";
    try { owner = String(JSON.parse(stamp)?.packId ?? ""); } catch { owner = ""; }
    if (owner === id) owned.push(folder); else kept.push(folder);
  }
  const removed: string[] = [];
  for (const folder of owned) {
    const target = path.join(root, folder);
    await fs.rm(target, { recursive: true, force: true });
    if (!existsSync(target)) removed.push(folder);
  }
  const remaining = owned.filter((folder) => existsSync(path.join(root, folder)));
  if (remaining.length) {
    // 有删不掉的（被占用/权限）：marker 只留剩下的，下次还能继续清
    await fs.writeFile(markerFile(id), JSON.stringify({ ...marker, skills: remaining }, null, 2), "utf8").catch(() => undefined);
  } else {
    await fs.rm(markerFile(id), { force: true });
  }
  if (removed.length) await server.restart();
  return { removed, remaining, kept };
}

export const skillPacksFeature = defineFeature<null>({
  id: "skill-packs",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("skill-packs: 缺少 ipc 服务（宿主未提供）");

    /** 正在安装的包 → 中止信号。取消 = abort 下载（extract/写盘阶段按 signal 自查后退出）。 */
    const activeInstalls = new Map<string, AbortController>();
    ipcHost.handle("skill-packs:list", async () => Promise.all(SKILL_PACKS.map(packState)));
    ipcHost.handle("skill-packs:install", async (_event, input: { id?: string; update?: boolean } = {}) => {
      const id = String(input?.id ?? "");
      if (!PACK_IDS.has(id)) throw new Error("未知的技能包");
      if (activeInstalls.has(id)) throw new Error("这个技能包正在安装中，请稍候或先取消");
      const controller = new AbortController();
      activeInstalls.set(id, controller);
      try {
        return await installPack(id, controller.signal);
      } catch (error) {
        if (error instanceof DownloadCancelledError) {
          return { installed: [], skipped: [], rejected: [], bytes: 0, cancelled: true };
        }
        throw error;
      } finally {
        activeInstalls.delete(id);
      }
    });
    ipcHost.handle("skill-packs:cancel", async (_event, input: { id?: string } = {}) => {
      const id = String(input?.id ?? "");
      const controller = activeInstalls.get(id);
      if (!controller) return { cancelled: false };
      controller.abort();
      return { cancelled: true };
    });
    ipcHost.handle("skill-packs:uninstall", async (_event, input: { id?: string } = {}) => {
      const id = String(input?.id ?? "");
      if (!PACK_IDS.has(id)) throw new Error("未知的技能包");
      return uninstallPack(id);
    });

    ctx.effect(() => {
      for (const channel of ["skill-packs:list", "skill-packs:install", "skill-packs:cancel", "skill-packs:uninstall"]) {
        ipcHost.removeHandler(channel);
      }
    });
  },
});
