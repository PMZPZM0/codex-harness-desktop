/**
 * husk-install（11-14）—— Husk 的 IPA 按需下载（iPhone 上跑 Android 的开源项目）
 *
 * Husk（Leviidev/Husk，GPL-2.0-or-later）不是电脑端程序：它提供的是 iPhone 用的
 * Husk.ipa / Husk.tipa，必须经 SideStore / AltStore / TrollStore 侧载到 iPhone（iOS 15.5+）。
 * 所以这里的「安装」= 从 GitHub release 镜像序下载官方 IPA + SHA256 校验 + 落 tools/husk，
 * 电脑侧只负责准备好安装包与官方指南；⛔ 不从 Windows 直接往 iPhone 装（需要签名/侧载工具与真机）。
 *
 * ⛔ 只下载官方发布资产，不修改、不重签名、不打包它的代码（GPL 外部工具，不进依赖面）。
 * ⛔ 更新 = 重新下载同名 IPA 覆盖（version.txt 与 release tag 对齐）；不做解压/安装。
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

/** Husk 的文件落点（只有一个 IPA + 版本号，没有运行时数据）。 */
export function huskPaths() {
  const root = path.join(writeToolsRoot(), "husk");
  return {
    root,
    ipa: path.join(root, "Husk.ipa"),
    versionFile: path.join(root, "version.txt"),
  };
}

/** 读已装（已下载）的 IPA 版本；更新链用它判断是否有新版。 */
export function huskInstalledVersion(): string {
  try { return readFileSync(huskPaths().versionFile, "utf8").trim(); } catch { return ""; }
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

/** 下载 / 更新 Husk.ipa（version = release tag，例如 3.4）。 */
export async function installHuskFromGitHub(id: DevRuntimeId, version: string): Promise<void> {
  if (!/^[0-9][0-9A-Za-z.\-]*$/.test(version)) throw new Error(`Husk 版本号异常：${version}`);
  const paths = huskPaths();
  const staging = path.join(writeToolsRoot(), ".husk-download");
  await fs.mkdir(staging, { recursive: true });
  const asset = "Husk.ipa";
  const target = path.join(staging, asset);
  emitRuntimeProgress(id, "@@STAGE 下载 Husk.ipa");
  emitRuntimeProgress(id, `正在下载 Husk ${version}（约 142 MB）…`);
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
        emitRuntimeProgress(id, `正在下载 Husk.ipa（${mb}）`);
      },
    })).sha256;
    if (isCancelRequested(id)) throw new Error("已取消");
    emitRuntimeProgress(id, "校验 SHA256…");
    const expectedSha = await fetchAssetDigest(asset);
    if (expectedSha && actualSha && expectedSha !== actualSha) {
      throw new Error(`Husk.ipa SHA256 校验失败（下载可能被截断）：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}… —— 请重试`);
    }
    await fs.mkdir(paths.root, { recursive: true });
    const next = `${paths.ipa}.tmp`;
    await fs.copyFile(target, next);
    await fs.rename(next, paths.ipa);
    await fs.writeFile(paths.versionFile, version + "\n", "utf8");
    emitRuntimeProgress(id, "@@PROGRESS 100");
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 打开系统文件管理器并选中 IPA（Windows Explorer / macOS Finder）。 */
export function revealHuskFile(): void {
  const { ipa, root } = huskPaths();
  const target = existsSync(ipa) ? ipa : root;
  if (!existsSync(target)) return;
  try {
    if (process.platform === "win32") spawn("explorer.exe", ["/select,", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn("open", ["-R", target], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 打开失败不影响状态 */ }
}

/** 给 Codex/界面用的一行事实：IPA 在不在、是否已有真机安装。 */
export function huskInstallFacts(): { installed: boolean; version: string; path: string; sizeBytes: number } {
  const { ipa } = huskPaths();
  let sizeBytes = 0;
  try { sizeBytes = existsSync(ipa) ? statSync(ipa).size : 0; } catch { /* 读不到按 0 */ }
  return { installed: existsSync(ipa), version: huskInstalledVersion(), path: existsSync(ipa) ? ipa : "", sizeBytes };
}
