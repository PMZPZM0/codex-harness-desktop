/**
 * Codex Harness 自更新（client side）—— 简化版
 *
 * 设计原则：更新源固定，用户零配置。
 *   - 发布站地址硬编码（UPDATE_SERVER_URL），不再读 update-config.json
 *   - channel 固定 stable，不再暴露 beta/canary 选项
 *   - 桌面端只有一个动作：检查更新 → 有新版本 → 下载并打开安装程序
 *
 * 流程：checkLatestUpdate() 拉 /api/latest → downloadUpdate() 流式落盘 → installUpdate() 运行安装包
 */
import fs from "node:fs/promises";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { shell } from "electron";
import { URL } from "node:url";

/** 发布中心地址（网页源，自建发布站） */
export const UPDATE_SERVER_URL = "https://www.jvszzp.ltd";

/** GitHub 开源仓库（GitHub 源，走 Releases API） */
export const GITHUB_REPO = "PMZPZM0/codex-harness-desktop";
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** 更新源类型：web = 自建发布站；github = GitHub Releases */
export type UpdateSource = "web" | "github";

/** 订阅通道（固定 stable） */
export const UPDATE_CHANNEL = "stable";

export type LatestInfo = {
  hasUpdate: boolean;
  reason: string;
  channel: string;
  version?: string;
  filename?: string;
  size?: number;
  sha256?: string;
  changelog?: string;
  mandatory?: boolean;
  uploadedAt?: number;
  downloadUrl?: string;
};

// ============== HTTP 工具（不走 axios / fetch，保持零依赖） ==============
function requestJson(
  url: string,
  timeoutMs = 8000
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("invalid_url"));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: { "User-Agent": "CodexHarness/0.1" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

/** 把服务端返回的相对 downloadUrl 补全为绝对地址 */
function absolutize(downloadUrl: string): string {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return new URL(downloadUrl, UPDATE_SERVER_URL).toString();
}

/**
 * 检查更新（可切换网页源 / GitHub 源）
 * @param currentVersion 当前应用版本（形如 0.4.1，可带 v 前缀）
 * @param source 更新源（默认 web，自建发布站）
 * @param platform 当前平台（github 源按平台挑资产：win32→exe，darwin→mac zip）
 * @param arch 当前架构（github 源 mac 下区分 x64/arm64）
 */
export async function checkLatestUpdate(
  currentVersion: string,
  source: UpdateSource = "web",
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
): Promise<LatestInfo> {
  if (source === "github") return checkGitHubUpdate(currentVersion, platform, arch);

  const u = new URL("/api/latest", UPDATE_SERVER_URL);
  u.searchParams.set("channel", UPDATE_CHANNEL);
  u.searchParams.set("platform", platform === "darwin" ? `mac-${arch}` : "windows");
  if (currentVersion) u.searchParams.set("current", currentVersion);
  const res = await requestJson(u.toString());
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  let info: LatestInfo;
  try {
    info = JSON.parse(res.body) as LatestInfo;
  } catch {
    throw new Error("invalid_json");
  }
  // 服务端给的是 /api/releases/:id/download 相对路径，桌面端需要绝对地址
  if (info.downloadUrl) info.downloadUrl = absolutize(info.downloadUrl);
  return info;
}

/** GitHub Releases 源：拉 latest release，按平台/架构挑资产 */
async function checkGitHubUpdate(currentVersion: string, platform: NodeJS.Platform, arch: string): Promise<LatestInfo> {
  const res = await requestJson(GITHUB_RELEASES_API);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  let release: any;
  try {
    release = JSON.parse(res.body) as any;
  } catch {
    throw new Error("invalid_json");
  }
  if (!release?.tag_name) throw new Error("no_release");
  const version = String(release.tag_name).replace(/^v/i, "");
  // 当前已是最新则无需下载
  if (version === currentVersion) {
    return { hasUpdate: false, reason: "up_to_date", channel: UPDATE_CHANNEL, version };
  }
  // 按平台选资产：Windows → *.exe；mac → 按架构 *-mac-arm64.zip / *-mac-x64.zip（含 mac 即可）
  const assets: { name: string; browser_download_url: string; size?: number }[] = Array.isArray(release.assets) ? release.assets : [];
  let match: { name: string; browser_download_url: string; size?: number } | undefined;
  if (platform === "darwin") {
    match = assets.find((a) => a.name.includes("mac") && a.name.endsWith(".zip") && a.name.includes(arch));
  } else {
    match = assets.find((a) => a.name.endsWith(".exe"));
  }
  if (!match) return { hasUpdate: false, reason: "no_asset_for_platform", channel: UPDATE_CHANNEL, version };
  return {
    hasUpdate: true,
    reason: "available",
    channel: UPDATE_CHANNEL,
    version,
    filename: match.name,
    size: match.size,
    changelog: release.body?.slice(0, 2000) || "",
    downloadUrl: match.browser_download_url,
  };
}

export type DownloadProgress = (info: {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}) => void;

export async function downloadUpdate(
  releaseUrl: string,
  destPath: string,
  onProgress?: DownloadProgress,
  expectedSha256?: string,
): Promise<{ path: string; bytes: number }> {
  const parsed = new URL(absolutize(releaseUrl));
  // ⛔ 只允许 https（09-13 审计 P0）：这条链的产物会被 `shell.openPath` 当安装包执行，
  // 明文 http 给中间的代理/DNS/公共 Wi-Fi 留了一个"把安装包换掉"的窗口。
  if (parsed.protocol !== "https:") throw new Error(`更新包地址必须是 https（收到 ${parsed.protocol}）`);
  const lib = https;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const result = await new Promise<{ path: string; bytes: number }>((resolve, reject) => {
    const req = lib.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: { "User-Agent": "CodexHarness/0.1" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const total = parseInt(String(res.headers["content-length"] ?? "0"), 10) || 0;
        const out = createWriteStream(destPath);
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (onProgress) {
            onProgress({
              receivedBytes: received,
              totalBytes: total,
              percent: total ? received / total : 0,
            });
          }
        });
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => resolve({ path: destPath, bytes: received }));
        });
        out.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });

  // ⛔ 完整性校验（09-13 审计 P0）：`sha256` 字段以前从下发到使用**全链路没人比对** ——
  // 下载 → `shell.openPath()` 直接执行，等于"发布站被换掉就静默装上攻击者的包"。
  // 现在：有期望哈希就必须匹配，不匹配**删文件并报错**；没有期望哈希则只接受 https（上面已强制）。
  if (expectedSha256) {
    const actual = await sha256OfFile(result.path);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      await fs.rm(result.path, { force: true }).catch(() => undefined);
      throw new Error(`更新包校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），已删除下载文件`);
    }
  }
  return result;
}

/** 流式计算文件 sha256（大安装包不整份读进内存）。 */
async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** 默认下载目录 = app.getPath('downloads') 下的 codex-harness 子目录 */
export function defaultDownloadDir(appDownloads: string): string {
  return path.join(appDownloads, "codex-harness");
}

/**
 * 运行下载好的安装包（交给系统默认程序，Windows 下即启动安装向导）
 * @returns 是否成功唤起
 */
export async function installUpdate(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const err = await shell.openPath(filePath);
  // shell.openPath 成功返回空字符串，失败返回错误描述
  return !err;
}

/** 文件是否存在（同步） */
export function fileExists(p: string): boolean {
  return existsSync(p);
}
