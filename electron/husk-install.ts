/**
 * husk-install（11-14）—— Husk 的 IPA / TIPA 按需下载（iPhone 上跑 Android 的开源项目）
 *
 * Husk（Leviidev/Husk，GPL-2.0-or-later）不是电脑端程序：它提供的是 iPhone 用的
 * Husk.ipa（SideStore/AltStore/TrollStore）与 Husk.tipa（TrollStore 专用），必须经侧载工具
 * 装到 iPhone（iOS 15.5+）。所以这里的「安装」= 从 GitHub release 镜像序下载官方安装包 +
 * SHA256 校验 + 落 tools/husk，电脑侧只负责准备好文件与官方指南；
 * ⛔ 不从 Windows 直接往 iPhone 装（需要签名/侧载工具与真机）。
 *
 * ⛔ 只下载官方发布资产，不修改、不重签名、不打包它的代码（GPL 外部工具，不进依赖面）。
 * ⛔ 更新 = 重新下载同名文件覆盖（version.txt / version-tipa.txt 与 release tag 对齐）。
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeToolsRoot } from "./toolchain";
import { mirrorCandidates } from "./gh-mirror";
import { downloadThroughMirrors } from "./mirror-download";
import { guardedFetch } from "./net-guard";
import { emitRuntimeProgress, isCancelRequested, trackRuntimeProc } from "./features/dev-runtimes";
import type { DevRuntimeId } from "./features/dev-runtimes";

export const HUSK_REPO = "Leviidev/Husk";
/** 官方安装指南（SideStore / AltStore / TrollStore 三条路）。 */
export const HUSK_GUIDE_URL = "https://itslevii.dev/docs/install";
/** 官方 AltStore/SideStore 源（在 Sources › + 里添加）。 */
export const HUSK_SOURCE_URL = "https://itslevii.dev/repo.json";

/** Husk 的文件落点（IPA / TIPA + 版本号，没有运行时数据）。 */
export function huskPaths() {
  const root = path.join(writeToolsRoot(), "husk");
  return {
    root,
    ipa: path.join(root, "Husk.ipa"),
    tipa: path.join(root, "Husk.tipa"),
    versionFile: path.join(root, "version.txt"),
    tipaVersionFile: path.join(root, "version-tipa.txt"),
  };
}

/** 读已装（已下载）的 IPA 版本；更新链用它判断是否有新版。 */
export function huskInstalledVersion(): string {
  try { return readFileSync(huskPaths().versionFile, "utf8").trim(); } catch { return ""; }
}

/** 读已下载的 TIPA 版本（TrollStore 专用包；与 IPA 独立更新）。 */
export function huskTipaInstalledVersion(): string {
  try { return readFileSync(huskPaths().tipaVersionFile, "utf8").trim(); } catch { return ""; }
}

/** GitHub release 资产的官方 sha256（新版 API 带 digest；拿不到就返回空，不假装校验过）。 */
async function fetchAssetDigest(assetName: string): Promise<string> {
  for (const candidate of mirrorCandidates(`https://api.github.com/repos/${HUSK_REPO}/releases/latest`)) {
    try {
      const res = await guardedFetch(candidate, {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/vnd.github+json" },
      }, { timeoutMs: 20_000 });
      if (!res.ok) continue;
      const json = (await res.json()) as { assets?: Array<{ name?: unknown; digest?: unknown }> };
      const row = (json.assets ?? []).find((asset) => String(asset.name ?? "") === assetName);
      const digest = String(row?.digest ?? "").toLowerCase();
      if (digest.startsWith("sha256:")) return digest.slice(7);
      if (/^[0-9a-f]{64}$/.test(digest)) return digest;
    } catch { /* 下一个镜像 */ }
  }
  return "";
}

type HuskKind = "ipa" | "tipa";

/** 下载 / 更新 Husk 安装包（version = release tag，例如 3.4）。 */
export async function installHuskFromGitHub(id: DevRuntimeId, version: string, kind: HuskKind = "ipa"): Promise<void> {
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`Husk 版本号异常：${version}`);
  const paths = huskPaths();
  const staging = path.join(writeToolsRoot(), kind === "ipa" ? ".husk-download" : ".husk-tipa-download");
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const asset = kind === "ipa" ? "Husk.ipa" : "Husk.tipa";
  const target = path.join(staging, asset);
  emitRuntimeProgress(id, `@@STAGE 下载 ${asset}`);
  emitRuntimeProgress(id, `正在下载 Husk ${version}（${asset}，约 142 MB）…`);
  try {
    const actualSha = (await downloadThroughMirrors({
      url: `https://github.com/${HUSK_REPO}/releases/download/${version}/${asset}`,
      target,
      expectZipMagic: true,
      isCancelled: () => isCancelRequested(id),
      onProgress: (p) => {
        emitRuntimeProgress(id, `@@PROGRESS ${p.total ? p.percent : 0}`);
        const mb = p.total
          ? `${(p.received / 1048576).toFixed(1)} MB / ${(p.total / 1048576).toFixed(1)} MB`
          : `${(p.received / 1048576).toFixed(1)} MB`;
        emitRuntimeProgress(id, `正在下载 ${asset}（${mb}）`);
      },
    })).sha256;
    if (isCancelRequested(id)) throw new Error("已取消");
    emitRuntimeProgress(id, "校验 SHA256…");
    const expectedSha = await fetchAssetDigest(asset);
    if (expectedSha && actualSha && expectedSha !== actualSha) {
      throw new Error(`${asset} SHA256 校验失败（下载可能被截断）：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}… —— 请重试`);
    }
    await fs.mkdir(paths.root, { recursive: true });
    const finalPath = kind === "ipa" ? paths.ipa : paths.tipa;
    const next = `${finalPath}.tmp`;
    await fs.copyFile(target, next);
    await fs.rename(next, finalPath);
    await fs.writeFile(kind === "ipa" ? paths.versionFile : paths.tipaVersionFile, version + "\n", "utf8");
    emitRuntimeProgress(id, "@@PROGRESS 100");
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 下载 / 更新 TrollStore 专用的 Husk.tipa。 */
export async function installHuskTipaFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  await installHuskFromGitHub(id, version, "tipa");
}

/** 打开系统文件管理器并选中已下载的安装包（优先 IPA，其次 TIPA）。 */
export function revealHuskFile(): void {
  const { ipa, tipa, root } = huskPaths();
  const target = existsSync(ipa) ? ipa : existsSync(tipa) ? tipa : root;
  if (!existsSync(target)) return;
  try {
    if (process.platform === "win32") spawn("explorer.exe", ["/select,", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn("open", ["-R", target], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 打开失败不影响状态 */ }
}

/** 给 Codex/界面用的一行事实：IPA / TIPA 在不在、版本与大小。 */
export function huskInstallFacts(): {
  installed: boolean; version: string; path: string; sizeBytes: number;
  tipaInstalled: boolean; tipaVersion: string; tipaPath: string; tipaSizeBytes: number;
} {
  const { ipa, tipa } = huskPaths();
  let sizeBytes = 0;
  let tipaSizeBytes = 0;
  try { sizeBytes = existsSync(ipa) ? statSync(ipa).size : 0; } catch { /* 读不到按 0 */ }
  try { tipaSizeBytes = existsSync(tipa) ? statSync(tipa).size : 0; } catch { /* 读不到按 0 */ }
  return {
    installed: existsSync(ipa),
    version: huskInstalledVersion(),
    path: existsSync(ipa) ? ipa : "",
    sizeBytes,
    tipaInstalled: existsSync(tipa),
    tipaVersion: huskTipaInstalledVersion(),
    tipaPath: existsSync(tipa) ? tipa : "",
    tipaSizeBytes,
  };
}
