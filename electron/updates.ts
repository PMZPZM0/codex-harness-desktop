/**
 * Codex Harness 自更新（client side）—— GitHub 单源版
 *
 * 设计原则：更新源固定，用户零配置。
 *   - ⛔ 09-15 用户定稿：更新源**只剩 GitHub Releases**，自建发布站不再分发安装包
 *     （发布站只负责应用介绍与问题反馈），web 更新源代码整段删除
 *   - channel 固定 stable，不暴露 beta/canary 选项
 *   - 桌面端只有一个动作：检查更新 → 有新版本 → 下载并打开安装程序
 *
 * 流程：checkLatestUpdate() 拉 GitHub Releases API → downloadUpdate() 流式落盘（https+sha256）→ installUpdate() 运行安装包
 */
import fs from "node:fs/promises";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import https from "node:https";
import { shell } from "electron";
import { URL } from "node:url";

/** GitHub 开源仓库（唯一更新源，走 Releases API） */
export const GITHUB_REPO = "PMZPZM0/codex-harness-desktop";
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

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
// 唯一调用方是 GitHub Releases API（恒 https），不再需要 http 分支
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
    const req = https.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: { "User-Agent": "CodexHarness/0.1" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
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

/**
 * 检查更新（GitHub Releases，唯一源）
 * @param currentVersion 当前应用版本（形如 0.4.1，可带 v 前缀）
 * @param platform 按平台挑资产：win32→exe，darwin→mac zip
 * @param arch mac 下区分 x64/arm64
 */
export async function checkLatestUpdate(
  currentVersion: string,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
): Promise<LatestInfo> {
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
  // ⛔ 09-16 实测：GitHub 的 `browser_download_url` **不是**资源本身，而是 302 到
  //    `release-assets.githubusercontent.com`（带签名的临时地址）。这里过去是裸 https.request +
  //    `status >= 300 就 reject`，**不跟随重定向** ⇒ 用户点「下载并安装」直接报 `HTTP 302`。
  //    这个坑直到 v0.0.18 才暴露：09-15 才把更新源切成 GitHub 单源，而当时仓库 0 个 release，
  //    检查更新拿不到东西，从来没走到过下载这一步。现在跟随最多 5 跳。
  const MAX_REDIRECTS = 5;
  const hop = async (url: string, depth: number): Promise<{ path: string; bytes: number }> => {
    const parsed = new URL(url);
    // ⛔ 只允许 https（09-13 审计 P0）：这条链的产物会被 `shell.openPath` 当安装包执行，
    // 明文 http 给中间的代理/DNS/公共 Wi-Fi 留了一个"把安装包换掉"的窗口。
    // 重定向的每一跳都要重新校验，防止从 https 掉到 http。
    if (parsed.protocol !== "https:") throw new Error(`更新包地址必须是 https（收到 ${parsed.protocol}）`);
    return await new Promise<{ path: string; bytes: number }>((resolve, reject) => {
      const req = https.request(
        {
          method: "GET",
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          headers: { "User-Agent": "CodexHarness/0.1" },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // 重定向：跟随（GitHub → release-assets.githubusercontent.com）
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (depth >= MAX_REDIRECTS) {
              reject(new Error(`更新包地址重定向次数过多（>${MAX_REDIRECTS}）`));
              return;
            }
            let next: string;
            try {
              next = new URL(res.headers.location, url).toString();
            } catch {
              reject(new Error(`更新包地址重定向目标非法：${String(res.headers.location).slice(0, 120)}`));
              return;
            }
            hop(next, depth + 1).then(resolve, reject);
            return;
          }
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
  };
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const result = await hop(releaseUrl, 0);

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
