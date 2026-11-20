/**
 * Codex Harness 自更新（client side）—— GitHub 单源版
 *
 * 设计原则：更新源固定，用户零配置。
 *   - ⛔ 09-15 用户定稿：更新源**只剩 GitHub Releases**，自建发布站不再分发安装包
 *     （发布站只负责应用介绍与问题反馈），web 更新源代码整段删除
 *   - channel 固定 stable，不暴露 beta/canary 选项
 *   - 桌面端只有一个动作：检查更新 → 有新版本 → 下载并打开安装程序
 *   - 10-11 起网络走**国内镜像优先**（gh-proxy → ghfast → 直连，见 ./gh-mirror）：
 *     检查与下载都按候选序尝试、失败自动落下一档；安装包完整性由 asset.digest 的
 *     sha256 强制比对兜底（GitHub 对资产自带 digest，镜像篡改包体会在校验处被删掉）。
 *
 * 流程：checkLatestUpdate() 拉 GitHub Releases API（镜像序）→ downloadUpdate() 流式落盘
 *      （https + sha256 + 镜像序重试）→ installUpdate() 运行安装包
 */
import fs from "node:fs/promises";
import { existsSync, createWriteStream, createReadStream, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import https from "node:https";
import { app, shell } from "electron";
import { URL } from "node:url";
import { mirrorCandidates } from "./gh-mirror";
import { guardedFetch } from "./net-guard";

/** GitHub 开源仓库（唯一更新源，走 Releases API） */
export const GITHUB_REPO = "PMZPZM0/codex-harness-desktop";
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_LIST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/* ══════════════════════════════════════════════════════════════════════════
 * 产品线隔离（10-12 用户拍板：「codex harness 就抓 codexharness 的更新源，
 * 云助手就只抓云助手的更新源，不要混」）：
 *   桌面版：tag `v*`、资产 `Codex.Harness.Desktop-*`
 *   云助手：tag `cloud-v*`、资产 `CodexHarnessAssistant-*`
 * ⛔⛔ 为什么不能再用 /releases/latest：GitHub 的 latest 是**按发布时间**取最近一个
 *   stable，**不是 semver 最高**。10-11 助手线先踩（0.0.1 抓到桌面版 v0.0.38），
 *   10-12 桌面版反过来踩（v0.0.39 抓到刚发的 cloud-v0.0.3 ⇒ 用户点更新会装上助手！）。
 *   ⇒ **两条线都走 releases 列表 + 各自 tag 前缀过滤**，永不碰 latest。
 * ══════════════════════════════════════════════════════════════════════════ */
export const DESKTOP_TAG_PREFIX = "v";
export const ASSISTANT_TAG_PREFIX = "cloud-v";
export const ASSISTANT_ASSET_PREFIX = "CodexHarnessAssistant-";
export const ASSISTANT_CHANNEL = "assistant";

/** 订阅通道（固定 stable） */
export const UPDATE_CHANNEL = "stable";

export type ParsedVersion = { major: number; minor: number; patch: number; pre: string };

/** 解析 `v1.2.3` / `1.2.3` / `0.0.26-b` / `0.0.26-beta.1`；不是 semver 时返回 null。 */
export function parseVersion(input: string): ParsedVersion | null {
  const raw = String(input ?? "").trim().replace(/^v/i, "");
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-.]([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? "" };
}

/**
 * 语义化版本比较：a > b 返回 1，相等 0，a < b 返回 -1。
 * ⛔ 09-24 修：原先是「字符串不等 ⇒ hasUpdate」⇒ **任何不同的 tag（包括更旧的）都报有更新**，
 *    且 `0.0.26-b` 这类带后缀的版本与 `0.0.26` 的大小关系完全反直觉。
 * 规则（与 semver 一致）：先比 major/minor/patch 数值；打平后**有预发布后缀的小于正式版**，
 *    两边都有后缀时按字典序（`-b` < `-beta`，与 npm 的标识符比较同向）。
 * 非 semver 输入（解析失败）回退字符串比较 —— 但**不再是"不等即更新"**。
 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return String(a) === String(b) ? 0 : (String(a) > String(b) ? 1 : -1);
  for (const key of ["major", "minor", "patch"] as const) {
    if (A[key] !== B[key]) return A[key] > B[key] ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;   // 1.2.3 > 1.2.3-beta
  if (!B.pre) return -1;  // 1.2.3-beta < 1.2.3
  return A.pre > B.pre ? 1 : -1;
}

export type LatestInfo = {
  hasUpdate: boolean;
  reason: string;
  channel: string;
  version?: string;
  /** Release tag（形如 v0.0.48）：差分更新按 tag 拼 release 目录。 */
  tag?: string;
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
/** 读取 GitHub 更新元数据；走 Chromium 网络栈，避免 Node TLS 写入竞态。 */
async function requestJson(
  url: string,
  timeoutMs = 8000
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const response = await guardedFetch(url, {
    method: "GET",
    headers: { "User-Agent": "CodexHarness/0.1" },
  }, { timeoutMs });
  return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) };
}

/** GitHub 资产的 `digest` 形如 `sha256:abcd…`（10-11 实测 release 资产都带）；取不出则 undefined（跳过校验）。 */
function sha256Of(value: unknown): string | undefined {
  const m = String(value ?? "").trim().match(/(?:sha256:)?([0-9a-f]{64})/i);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * 检查更新（GitHub Releases，唯一源；网络走镜像序 —— gh-proxy → ghfast → 直连）
 * @param currentVersion 当前应用版本（形如 0.4.1，可带 v 前缀）
 * @param platform 按平台挑资产：win32→exe，darwin→mac zip
 * @param arch mac 下区分 x64/arm64
 */
export async function checkLatestUpdate(
  currentVersion: string,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
): Promise<LatestInfo> {
  // ⛔ 镜像序逐个试：第一个 2xx 的候选生效（10-11 实测 gh-proxy 通、ghfast API 403 秒返、直连兜底）。
  //    全挂才抛最后一条错误 —— 检查更新失败要让用户看到「试过三条路都不行」而不是只看到第一档的错。
  let lastError: unknown = new Error("no_candidate");
  for (const candidate of mirrorCandidates(GITHUB_RELEASES_LIST_API)) {
    try {
      const res = await requestJson(candidate);
      if (res.status < 200 || res.status >= 300) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      let releases: any[];
      try {
        const parsed = JSON.parse(res.body) as unknown;
        releases = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        lastError = new Error("invalid_json");
        continue;
      }
      // 只认桌面版产品线：`v*` tag、非草稿、非预发布；按 semver 从高到低试
      // （最高版本可能没有本平台资产 ⇒ 继续往下找，别让 mac 用户卡在"无资产"上）。
      const line = releases
        .filter((r: any) => String(r?.tag_name ?? "").startsWith(DESKTOP_TAG_PREFIX) && !r?.draft && !r?.prerelease)
        .sort((a: any, b: any) =>
          compareVersions(String(b.tag_name).replace(/^v/i, ""), String(a.tag_name).replace(/^v/i, "")),
        );
      if (line.length === 0) return { hasUpdate: false, reason: "no_desktop_release_yet", channel: UPDATE_CHANNEL, version: currentVersion };
      for (const rel of line) {
        const info = pickLatestFrom(rel, currentVersion, platform, arch);
        // 这个版本没有本平台资产 / 解析不出版本 ⇒ 不是"没有更新"，继续试下一个更早的
        if (info.reason === "no_asset_for_platform" || info.reason === "no_release") continue;
        return info;
      }
      return { hasUpdate: false, reason: "no_asset_for_platform", channel: UPDATE_CHANNEL, version: currentVersion };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** 从 release JSON 挑出本平台的资产并做版本判断（网络与解析分离，镜像重试不重复这段逻辑）。 */
function pickLatestFrom(
  release: any,
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): LatestInfo {
  if (!release?.tag_name) throw new Error("no_release");
  const version = String(release.tag_name).replace(/^v/i, "");
  // ⛔ 09-24 修：改为 semver 比较 —— 旧写法「字符串不等即更新」会把**更旧的 tag** 也报成有更新。
  //    同时尊重 GitHub 的 prerelease 标志：stable 通道下不推预发布版
  //    （**例外**：本地本身就是预发布版，如 0.0.26-b，否则 beta 用户永远收不到更新）。
  const localPre = Boolean(parseVersion(currentVersion)?.pre);
  const remotePre = Boolean(release?.prerelease) || Boolean(parseVersion(version)?.pre);
  if (remotePre && UPDATE_CHANNEL === "stable" && !localPre) {
    return { hasUpdate: false, reason: "prerelease_not_on_stable_channel", channel: UPDATE_CHANNEL, version };
  }
  if (compareVersions(version, currentVersion) <= 0) {
    return { hasUpdate: false, reason: "up_to_date", channel: UPDATE_CHANNEL, version };
  }
  // 按平台选资产：Windows → *.exe；mac → 按架构 *-mac-arm64.zip / *-mac-x64.zip（含 mac 即可）
  // ⛔ 10-12 产品线隔离：资产名也必须认 `Codex.Harness.Desktop-` 前缀 —— 云助手的资产
  //   同样是 .exe / *-mac.zip，光靠 tag 前缀过滤挡不住（同仓两条线，资产名形制雷同）。
  const assets: { name: string; browser_download_url: string; size?: number; digest?: string }[] = Array.isArray(release.assets) ? release.assets : [];
  let match: { name: string; browser_download_url: string; size?: number; digest?: string } | undefined;
  if (platform === "darwin") {
    match = assets.find((a) => a.name.startsWith("Codex.Harness.Desktop-") && a.name.includes("mac") && a.name.endsWith(".zip") && a.name.includes(arch));
  } else {
    match = assets.find((a) => a.name.startsWith("Codex.Harness.Desktop-") && a.name.endsWith(".exe"));
  }
  if (!match) return { hasUpdate: false, reason: "no_asset_for_platform", channel: UPDATE_CHANNEL, version };
  return {
    hasUpdate: true,
    reason: "available",
    channel: UPDATE_CHANNEL,
    version,
    tag: String(release.tag_name),
    filename: match.name,
    size: match.size,
    // ⛔ asset.digest（GitHub 自带的 sha256）→ updates-ipc 存进 lastUpdateInfo → 下载完强制比对。
    //   走镜像后这是「包体没被第三方换过」的唯一证据，摘掉 = 镜像可以静默换安装包。
    sha256: sha256Of(match.digest),
    changelog: release.body?.slice(0, 2000) || "",
    downloadUrl: match.browser_download_url,
  };
}

export type DownloadProgress = (info: {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}) => void;

/** 下载更新包到目标路径，边下边回报进度；给了 sha256 就必须校验通过。 */
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
  /* ⛔⛔ 11-15 用户实测「更新包/工具包下载几个小时」：这条链原来**没有响应头超时、没有停滞超时、
     没有速度下限**——搭上一个 6KB/s 的限速镜像就一路慢到底。
     ⇒ 三条保护（与 mirror-download.ts 同口径）：20s 拿不到响应头换源 / 60s 无数据换源 /
       下载满 12s 后平均 <200KB/s 且还有别的候选就换源（最后一个候选不因慢被掐死）。 */
  const hop = async (url: string, depth: number, hasAlternative = false): Promise<{ path: string; bytes: number }> => {
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
            hop(next, depth + 1, hasAlternative).then(resolve, reject);
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
          const firstByteAt = Date.now();
          /* 停滞 / 低速两个看门狗：命中就 destroy，由外层 catch 换下一个候选。 */
          const watchdog = setInterval(() => {
            const elapsedMs = Date.now() - firstByteAt;
            if (received === 0) {
              if (elapsedMs >= 60_000) { clearInterval(watchdog); req.destroy(new Error("60 秒没有任何数据")); }
              return;
            }
            const elapsedSec = elapsedMs / 1000;
            if (hasAlternative && elapsedSec >= 12 && received / elapsedSec < 200 * 1024) {
              clearInterval(watchdog);
              req.destroy(new Error(`太慢（${Math.round(received / elapsedSec / 1024)}KB/s），已换源`));
            }
          }, 1000);
          out.on("close", () => clearInterval(watchdog));
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
      req.setTimeout(20_000, () => req.destroy(new Error("20 秒拿不到响应头")));
      req.on("error", reject);
      req.end();
    });
  };
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  // ⛔ 镜像序逐条下载（10-11）：网络错 / HTTP 错 / sha256 校验不过都**删掉半截文件换下一档**；
  //    校验不过也换通道 —— 镜像是第三方反代，比对失败最可能是它动了包体，直连 GitHub 是基准真相
  //    （候选最后一条恒为直连）。非 GitHub 地址（自定义清单等）mirrorCandidates 只给一条，行为不变。
  const candidates = mirrorCandidates(releaseUrl);
  let lastError: unknown = new Error("no_candidate");
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const hasAlternative = candidateIndex < candidates.length - 1;
    await fs.rm(destPath, { force: true }).catch(() => undefined);
    try {
      const result = await hop(candidate, 0, hasAlternative);
      if (expectedSha256) {
        const actual = await sha256OfFile(result.path);
        if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
          await fs.rm(result.path, { force: true }).catch(() => undefined);
          lastError = new Error(`更新包校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），已删除下载文件`);
          continue;
        }
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (candidates.length > 1) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    await fs.rm(destPath, { force: true }).catch(() => undefined);
    throw new Error(`全部下载通道（直连 / hk.gh-proxy / gh-proxy）都失败了；最后一次：${detail}`);
  }
  throw lastError;
}

export type DifferentialDownloadResult = { path: string; version: string; differential: true };

/** 差分缓存自愈（11-20 重写 —— 11-19 那版理解是**错的**，它自己把差分废掉了）。
 *
 *  ⛔⛔ 真实机制（读 electron-updater / app-builder-lib 源码得出，别再改回去）：
 *   · 差分需要的是**上一版的安装包本体** `<updater 缓存>/installer.exe`（NSIS 差分的 oldFile）。
 *     这个文件由**安装器自己**在安装完成时写回：
 *     `app-builder-lib/templates/nsis/include/installer.nsh` →
 *     `copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"`。
 *     手工装 exe 也会写（同一条 section）—— 这点也和 11-19 的说法不同。
 *   · `current.blockmap` **不是必需品**：缺了它 updater 会拿 `latest.yml` 里的 blockmap URL
 *     去服务器下载**旧版本**的 blockmap（`AppUpdater.differentialDownloadInstaller`：
 *     「No cached blockmap for the old installer, downloading it from …」）。
 *   · 而且**整包下载完成后 updater 会主动删掉** `current.blockmap`（`done()` 的 else 分支，
 *     防止陈旧 blockmap 配上新文件「毒害」下一轮）。
 *  ⇒ 所以「缺 blockmap 就把 installer.exe 一起删掉」等于自断双腿：下一版没有 oldFile，
 *     差分必然失败→回退整包；整包装完又没有 blockmap ⇒ 再被判一次「配对失效」⇒ **永远整包**。
 *     这正是 11-19 之后连着几版都下 668MB 的真正原因（不是缓存坏了，是我们自己删的）。
 *
 *  ⇒ 现在只做**一件必要清理**：blockmap 孤零零存在、却没有 installer.exe 时删掉它
 *    （它对不上任何安装包，留着会被当成 oldBlockmap 导致 sha512 校验失败）。
 *    ⛔ 永远不许删 `installer.exe` —— 它是下一版差分唯一的 oldFile。 */
function healDifferentialCache(): void {
  try {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || "";
    if (!localAppData) return;
    const dir = path.join(localAppData, `${app.getName()}-updater`);
    const installer = path.join(dir, "installer.exe");
    const blockmap = path.join(dir, "current.blockmap");
    if (!existsSync(installer) && existsSync(blockmap)) rmSync(blockmap, { force: true });
  } catch {
    /* 自愈是尽力而为：失败不影响正常下载 */
  }
}

/** 本机是否已具备差分条件。
 *  ⛔ 11-20 修正：**只看 `installer.exe`**（上一版的安装包本体）；blockmap 缺了 updater 会自己下载，
 *    所以「blockmap 不在」不等于「本次会是整包」—— 11-19 用「成对」当判据，把能差分的机器也报成整包。
 *  用途：用户选了「补丁」而本机确实没有安装包缓存时，界面必须**明说本次会下完整包**。 */
export function hasDifferentialBaseline(): boolean {
  try {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || "";
    if (!localAppData) return false;
    const dir = path.join(localAppData, `${app.getName()}-updater`);
    return existsSync(path.join(dir, "installer.exe"));
  } catch {
    return false;
  }
}

/** ⛔⛔ 11-15 用户实测「点重启安装，应用关了、安装提醒一闪就没装」的根因在这里：
 *  差分包是 electron-updater 下的，**它不是"一个可以随便 spawn 的 exe 路径"** ——
 *  直接 `spawn(pending.exe)` 起的是**交互式 NSIS 向导 + UAC 提权框**（11-16 起
 *  nsis.oneClick=true 已改为每用户一键安装，不再有向导/UAC；这段历史说明保留），
 *  而我们同时 `app.quit()` ⇒ 应用消失、向导被挡在后面/被用户当垃圾关掉 ⇒ 什么都装不上。
 *  正解是让**下载它的那个 autoUpdater 自己去装**：`quitAndInstall(true, true)` 会带 `/S`
 *  静默安装并在装完自动拉起新版本，用户点一次就完事（这也是 electron-updater 的唯一受支持路径）。
 *  ⇒ 这里记住"差分已就绪的那个 updater 实例"，供 `updates:restart-install` 优先使用。 */
let differentialUpdater: { quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void; version: string } | null = null;

/** 本次会话是否有一个「差分包已下载完、还没装」的版本在等重启。 */
export function hasPendingDifferential(): boolean {
  return Boolean(differentialUpdater);
}

/** 让 electron-updater 安装并自动重启。
 *  ⛔ 11-20 默认改成**非静默**（isSilent=false）：安装器会显示自己的进度页
 *    （`app-builder-lib/templates/nsis/oneClick.nsh` 只有 `MUI_PAGE_INSTFILES`，
 *    没有向导页/完成页 ⇒ 用户看到一个进度条窗口，装完自动关并拉起新版本）。
 *    这正是用户两次报「安装的时候没有进度条提醒」要的东西，且**零依赖**：
 *    不再需要我们自己的小窗进程（那条路要么慢、要么在打包后起不来）。 */
export function quitAndInstallDifferential(isSilent = false): void {
  const updater = differentialUpdater;
  if (!updater) throw new Error("no_pending_differential");
  updater.quitAndInstall(isSilent, true);
}

/** 10-25 差分更新：electron-updater + NSIS blockmap。
 *  ⛔ 只走 Windows NSIS；mac/其它平台直接抛错让上层回退完整包。
 *  ⛔ 仍按镜像候选序切 feed；任一候选失败继续下一档，全部失败由调用方回退完整下载。
 *  ⛔ 这里只下载并校验（electron-updater 会验 latest.yml 的 sha512），**不安装** ——
 *    安装仍走现有的 `updates:restart-install`，保持「先起安装包、再退出」的既有顺序。 */
export async function downloadUpdateDifferential(
  info: Pick<LatestInfo, "version" | "tag">,
  onProgress?: DownloadProgress,
): Promise<DifferentialDownloadResult> {
  if (process.platform !== "win32") throw new Error("differential_unsupported_platform");
  const version = String(info.version ?? "").trim();
  if (!version) throw new Error("differential_no_version");
  /* 先自愈缓存：缺一份就两份都删，让本轮重新建立成对基线（下一版用户才拿到几十兆差分）。 */
  healDifferentialCache();
  const releaseBase = `https://github.com/${GITHUB_REPO}/releases/download/${String(info.tag ?? `v${version}`)}`;
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.autoDownload = false;
  /* ⛔⛔ 11-20 回滚 11-19 的改动：这里曾改成 true（想「不点按钮、退出时也装完」），代价实测太大 ——
     true 会让 electron-updater 在**每一次 app quit**（含用户正常关应用）时自己调一次 quitAndInstall，
     于是「关应用」也变成一次静默安装；一旦那次安装失败（文件占用 / 全机版残留），
     用户就只看到「应用闪退、版本没变」，而且 update-install-pending.json 残留会让下次启动判成
     「上次安装失败」，更新状态机把自动安装挂起 —— 用户原话「再就无法更新了」。
     ⇒ 改回 false：只在用户显式点「立即重启」时装。配对缓存照样写回（quitAndInstall 走的就是 updater
        自己的安装器，与 autoInstallOnAppQuit 无关）。 */
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  let lastError: unknown = new Error("differential_failed");
  for (const feedUrl of mirrorCandidates(releaseBase)) {
    try {
      autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
      const check = await autoUpdater.checkForUpdates();
      const remoteVersion = String(check?.updateInfo?.version ?? "");
      if (remoteVersion && compareVersions(remoteVersion, version) !== 0) {
        throw new Error(`latest.yml 版本 ${remoteVersion} 与 Release ${version} 不一致`);
      }
      const onDownload = (progress: any) => {
        onProgress?.({
          receivedBytes: Number(progress?.transferred ?? 0),
          totalBytes: Number(progress?.total ?? 0),
          percent: Math.max(0, Math.min(1, Number(progress?.percent ?? 0) / 100)),
        });
      };
      autoUpdater.on("download-progress", onDownload);
      try {
        const files = await autoUpdater.downloadUpdate() as unknown as string[];
        const file = (Array.isArray(files) ? files : []).find((item) => item && existsSync(item));
        if (!file) throw new Error("差分下载完成但没有安装包文件");
        // ⛔ 记住这个已就绪的实例：重启安装必须由它 quitAndInstall（静默 + 装完自启），
        //   换个进程 spawn 那个 pending exe 只会弹交互向导（见 differentialUpdater 的说明）。
        differentialUpdater = { quitAndInstall: (silent, runAfter) => autoUpdater.quitAndInstall(silent, runAfter), version };
        return { path: file, version, differential: true };
      } finally {
        autoUpdater.removeListener("download-progress", onDownload);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** 流式计算文件 sha256（大安装包不整份读进内存）。 */
async function sha256OfFile(filePath: string): Promise<string> {  return new Promise((resolve, reject) => {
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

/** 清理下载目录里**旧的安装包**（10-17 用户令：「更新重启完成后把旧的安装包去了，否则更新一次就多一份」）。
 *
 *  ⛔ 为什么需要：安装包按**版本命名**（`Codex-Harness-Setup-<ver>.exe`），每个版本一个新文件，
 *     而下载目录全仓**没有任何清理** ⇒ 每更新一次就永久多一份，越积越大。
 *  ⛔ 保留**最新一个**：手动重装/回退时还能用；再旧的没有价值。
 *  ⛔ 只在**本应用自己的下载目录**（`Downloads/codex-harness`）里动手：⛔ 不递归、不越界 ——
 *     那是用户的下载目录，删错东西是重罪。只认安装包扩展名。
 *  ⛔ 静默 + 幂等：清不掉（被占用）就留着，⛔ 绝不影响启动。 */
export function pruneOldInstallers(dir: string): { removed: number; bytes: number } {
  const INSTALLER = /\.(exe|msi|dmg|pkg|zip|appimage|deb|rpm)$/i;
  const out = { removed: 0, bytes: 0 };
  try {
    if (!existsSync(dir)) return out;
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && INSTALLER.test(d.name))
      .map((d) => {
        const p = path.join(dir, d.name);
        try { const st = statSync(p); return { p, size: st.size, m: st.mtimeMs }; } catch { return null; }
      })
      .filter((x): x is { p: string; size: number; m: number } => x !== null)
      .sort((a, b) => b.m - a.m);           // 新的在前
    for (const f of files.slice(1)) {        // 保留最新一个
      try { unlinkSync(f.p); out.removed += 1; out.bytes += f.size; } catch { /* 单个失败不影响其它 */ }
    }
  } catch { /* 目录读不了就跳过（静默） */ }
  return out;
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
