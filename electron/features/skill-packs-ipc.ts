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
import { mirrorCandidates } from "../gh-mirror";
import { sendToWindow } from "./window-bus";
import { SKILL_PACKS, type SkillPackDef } from "../skill-packs-catalog";

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

/** 走镜像候选序下载一个文件；全部失败时给中文原因（把试过的源列出来，便于用户自查网络）。 */
async function download(url: string, target: string): Promise<void> {
  const tried: string[] = [];
  for (const candidate of mirrorCandidates(url)) {
    try {
      const res = await fetch(candidate, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
      if (!res.ok) { tried.push(`${new URL(candidate).host}(HTTP ${res.status})`); continue; }
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (error) {
      tried.push(`${new URL(candidate).host}(${String((error as { message?: unknown })?.message ?? error).slice(0, 40)})`);
    }
  }
  throw new Error(`下载失败：${tried.join(" → ")}`);
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
  const present = marker ? marker.skills.filter((folder) => existsSync(path.join(skillsRoot(), folder, "SKILL.md"))) : [];
  return {
    ...pack,
    installed: Boolean(marker) && present.length > 0,
    installedSkills: present,
    installedAt: marker?.installedAt ?? "",
  };
}

async function installPack(id: string): Promise<{ installed: string[]; skipped: string[]; rejected: string[] }> {
  const pack = SKILL_PACKS.find((entry) => entry.id === id);
  if (!pack) throw new Error("未知的技能包");
  const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "skill-pack-install", packId: id, stage, message, at: Date.now() });
  const work = path.join(app.getPath("temp"), `skill-pack-${id}-${Date.now()}`);
  const archive = path.join(work, "pack.zip");
  const outDir = path.join(work, "out");
  try {
    await fs.mkdir(outDir, { recursive: true });
    emit("download", "正在下载…");
    await download(`https://codeload.github.com/${pack.repo}/zip/refs/heads/main`, archive);
    emit("extract", "正在解压…");
    await expandZip(archive, outDir);
    const roots = await fs.readdir(outDir);
    const repoRoot = roots.length === 1 ? path.join(outDir, roots[0]) : outDir;
    const skillsDir = path.join(repoRoot, "skills");
    if (!existsSync(skillsDir)) throw new Error("这个仓库里没有 skills/ 目录");
    const dirs = await findSkillDirs(skillsDir);
    if (!dirs.length) throw new Error("skills/ 里没有找到 SKILL.md");
    const root = skillsRoot();
    await fs.mkdir(root, { recursive: true });
    const installed: string[] = [];
    const skipped: string[] = [];
    const rejected: string[] = [];
    for (const dir of dirs) {
      const folder = path.basename(dir).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      if (!folder) continue;
      if (existsSync(path.join(root, folder))) { skipped.push(folder); continue; }
      const content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
      const findings = auditSkill(content, await listFiles(dir));
      if (findings.length) { rejected.push(`${folder}（${findings.join("；")}）`); continue; }
      emit("install", `正在安装 ${folder}…`);
      await fs.cp(dir, path.join(root, folder), { recursive: true });
      installed.push(folder);
    }
    const marker: PackMarker = { id, repo: pack.repo, license: pack.license, skills: [...installed, ...skipped], installedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(markerFile(id)), { recursive: true });
    await fs.writeFile(markerFile(id), JSON.stringify(marker, null, 2), "utf8");
    emit("complete", installed.length ? `已安装 ${installed.length} 个技能` : "没有新技能可装");
    // 技能目录变了必须重启引擎，模型才会重新扫描到这个技能（与技能导入/市场安装同口径）
    if (installed.length) await server.restart();
    return { installed, skipped, rejected };
  } finally {
    void fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function uninstallPack(id: string): Promise<{ removed: string[] }> {
  const marker = await readMarker(id);
  if (!marker) throw new Error("这个包不是通过本页安装的，未做删除");
  const root = path.resolve(skillsRoot());
  const removed: string[] = [];
  for (const folder of marker.skills) {
    const target = path.resolve(root, folder);
    // ⛔ 目录穿越闸：只删技能根目录内、且是自己 marker 记下的目录
    if (!target.startsWith(root + path.sep)) continue;
    if (!existsSync(target)) continue;
    await fs.rm(target, { recursive: true, force: true });
    removed.push(folder);
  }
  await fs.rm(markerFile(id), { force: true });
  if (removed.length) await server.restart();
  return { removed };
}

export const skillPacksFeature = defineFeature<null>({
  id: "skill-packs",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("skill-packs: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("skill-packs:list", async () => Promise.all(SKILL_PACKS.map(packState)));
    ipcHost.handle("skill-packs:install", async (_event, input: { id?: string } = {}) => {
      const id = String(input?.id ?? "");
      if (!PACK_IDS.has(id)) throw new Error("未知的技能包");
      return installPack(id);
    });
    ipcHost.handle("skill-packs:uninstall", async (_event, input: { id?: string } = {}) => {
      const id = String(input?.id ?? "");
      if (!PACK_IDS.has(id)) throw new Error("未知的技能包");
      return uninstallPack(id);
    });
  },
});
