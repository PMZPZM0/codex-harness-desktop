/**
 * 自媒体工作台 · 随包版本与在线更新（11-16 用户令：控制台里能更新，更新完自适应现有布局）。
 *
 * 口径：
 * · **随包版本**（`resources/media-desk`，打包进 resourcesPath）是基线，⛔ 永不改写；
 * · **更新**装到 `<userData>/media-desk-vendor/<version>/`，用 `current.json` 指向它——
 *   不动安装目录、可回退（删 current.json 即回到随包版本）；
 * · 版本真相源 = npm 官方 `dsh-media-desk` 的 `dist-tags.latest`（镜像只用于下载加速）。
 * ⛔ 全程零新增依赖：tarball 用 `node:zlib` + 极简 tar 解析（只处理普通文件）。
 */
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { mkdirSync, writeFileSync as writeSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { app } from "electron";
import { compareVersions } from "../../version-utils";
import { gunzipSync } from "node:zlib";

/** 随包基线版本（与 resources/media-desk 同步；守卫 12? 会比对）。 */
export const MEDIA_DESK_BASE_VERSION = "2.6.2";

const PKG = "dsh-media-desk";
const REGISTRIES = [
  "https://registry.npmmirror.com",
  "https://registry.npmjs.org",
];

export type MediaDeskVersionInfo = {
  current: string;
  bundled: string;
  /** 当前用的是不是用户目录里的覆盖版本（false = 随包基线）。 */
  overridden: boolean;
};

/** `<userData>/media-desk-vendor`（惰性求值：守卫【91】）。 */
function vendorRoot(): string {
  return path.join(app.getPath("userData"), "media-desk-vendor");
}

/** 随包基线目录（打包后在 resourcesPath；开发态在仓库 resources/）。 */
export function bundledVendorDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "media-desk")
    : path.join(app.getAppPath(), "resources", "media-desk");
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** 生效中的工作台目录：优先 current.json 指向的覆盖版本，否则随包基线。 */
export async function activeVendorDir(): Promise<string> {
  try {
    const raw = await readFile(path.join(vendorRoot(), "current.json"), "utf8");
    const pointer = JSON.parse(raw) as { version?: string };
    const dir = path.join(vendorRoot(), String(pointer?.version ?? ""));
    if (pointer?.version && (await exists(path.join(dir, "index.html")))) return dir;
  } catch { /* 没有指针 / 指针坏了 ⇒ 回退随包 */ }
  return bundledVendorDir();
}

async function versionOf(dir: string): Promise<string> {
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    return String((JSON.parse(raw) as { version?: string })?.version ?? "").trim();
  } catch {
    return "";
  }
}

/** 当前生效版本（覆盖版本读它自己的 package.json，否则 = 随包基线常量）。 */
export async function mediaDeskVersionInfo(): Promise<MediaDeskVersionInfo> {
  const dir = await activeVendorDir();
  const overridden = !dir.startsWith(bundledVendorDir());
  const current = (overridden ? await versionOf(dir) : "") || MEDIA_DESK_BASE_VERSION;
  return { current, bundled: MEDIA_DESK_BASE_VERSION, overridden };
}


async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 查最新版：所有候选源都问，取最大（⛔ 镜像可能滞后，不能早退）。 */
export async function checkMediaDeskUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean; error?: string }> {
  const info = await mediaDeskVersionInfo();
  let latest = "";
  let lastError = "";
  for (const registry of REGISTRIES) {
    try {
      const data = await fetchJson(`${registry}/${PKG.replace("/", "%2F")}/latest`);
      const v = String(data?.version ?? "").trim();
      if (v && (!latest || compareVersions(v, latest) > 0)) latest = v;
    } catch (error) {
      lastError = String((error as Error)?.message ?? error);
    }
  }
  if (!latest) return { current: info.current, latest: info.current, hasUpdate: false, error: lastError || "查询失败" };
  return { current: info.current, latest, hasUpdate: compareVersions(latest, info.current) > 0 };
}

/** 极简 tar 解析：只落地普通文件，剥掉 npm 包的 `package/` 前缀。 */
function extractTarGz(gz: Buffer, destRoot: string): number {
  const tar = gunzipSync(gz);
  let off = 0;
  let files = 0;
  while (off + 512 <= tar.length) {
    const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) { off += 512; continue; }
    const size = parseInt(tar.subarray(off + 124, off + 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = tar.subarray(off + 345, off + 500).toString("utf8").replace(/\0.*$/, "");
    const full = prefix ? `${prefix}/${name}` : name;
    const dataStart = off + 512;
    if (type === "0" || type === "\0") {
      const rel = full.replace(/^package\//, "");
      if (rel && !rel.includes("..") && !path.isAbsolute(rel)) {
        const abs = path.join(destRoot, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeSync(abs, tar.subarray(dataStart, dataStart + size));
        files += 1;
      }
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}


/** npm 包 → 随包布局的拼装（见文件头映射）；宿主胶水沿用随包那份。 */
async function assembleVendor(pkgDir: string, destDir: string): Promise<void> {
  const { cp, mkdir: mk, writeFile: wf } = await import("node:fs/promises");
  await mk(destDir, { recursive: true });
  if (!(await exists(path.join(pkgDir, "dist", "client.js")))) throw new Error("上游包缺 dist/client.js");
  if (!(await exists(path.join(pkgDir, "src", "host.js")))) throw new Error("上游包缺 src/host.js");
  await cp(path.join(pkgDir, "dist", "client.js"), path.join(destDir, "client.js"));
  await mk(path.join(destDir, "host"), { recursive: true });
  await cp(path.join(pkgDir, "src"), path.join(destDir, "host"), { recursive: true });
  if (await exists(path.join(pkgDir, "assets"))) {
    await cp(path.join(pkgDir, "assets"), path.join(destDir, "assets"), { recursive: true });
  }
  /* 宿主胶水：一定是随包那份（⛔ 不从上游包拿，避免布局漂移） */
  const base = bundledVendorDir();
  for (const rel of ["index.html", "glue.js", "react-entry.js", "react.bundle.js"]) {
    if (!(await exists(path.join(base, rel)))) throw new Error(`随包缺 ${rel}（宿主编译产物不该缺席）`);
    await cp(path.join(base, rel), path.join(destDir, rel));
  }
  await wf(path.join(destDir, "host", "package.json"), JSON.stringify({ type: "module" }), "utf8");
  /* 版本真相：覆盖目录自己的 package.json（mediaDeskVersionInfo 读它；缺了就永远显示随包版本）。 */
  await wf(path.join(destDir, "package.json"), JSON.stringify({ name: PKG, version: path.basename(destDir) }, null, 2), "utf8");
}

/** 下载并把某个版本装进 userData（不动随包资源），成功后写 current.json 生效。 */
export async function installMediaDeskVersion(version: string, onProgress?: (percent: number) => void): Promise<{ version: string; dir: string }> {
  const v = String(version ?? "").trim();
  if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error("版本号不合法");
  const root = vendorRoot();
  await mkdir(root, { recursive: true });
  const target = path.join(root, v);
  const tmp = path.join(root, `.tmp-${v}`);
  const stageDir = path.join(tmp, "pkg");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  let lastError: unknown = new Error("下载失败");
  for (const registry of REGISTRIES) {
    const url = `${registry}/${PKG}/-/${PKG}-${v}.tgz`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const tmpFile = path.join(tmp, "pkg.tgz");
      /* 边下边报进度（有 content-length 才有百分比）。 */
      const total = Number(res.headers.get("content-length") ?? 0);
      let received = 0;
      const body = Readable.fromWeb(res.body as any);
      body.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0 && onProgress) onProgress(Math.min(1, received / total));
      });
      await pipeline(body, createWriteStream(tmpFile));
      const gz = await readFile(tmpFile);
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      const count = extractTarGz(gz, stageDir);
      if (count < 5) throw new Error("包内容为空");
      await assembleVendor(stageDir, target);
      if (!(await exists(path.join(target, "index.html"))) || !(await exists(path.join(target, "client.js")))
        || !(await exists(path.join(target, "host", "host.js")))) throw new Error("拼装后缺 index.html / client.js / host/host.js");
      await writeFile(path.join(root, "current.json"), JSON.stringify({ version: v, at: Date.now() }, null, 2), "utf8");
      await rm(tmp, { recursive: true, force: true });
      onProgress?.(1);
      return { version: v, dir: target };
    } catch (error) {
      lastError = error;
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(tmp, { recursive: true }).catch(() => undefined);
    }
  }
  throw new Error(`更新失败：${String((lastError as Error)?.message ?? lastError)}`);
}

