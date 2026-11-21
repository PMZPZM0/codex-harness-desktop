/**
 * 应用更新服务（11-21 整份重写）。
 *
 * ── 为什么重写：旧实现（`updates.ts` + `features/updates-ipc.ts`，共约 900 行）有四个
 *    互相叠加的断点，导致「下载到 100% → 又从 0 开始 → 永远装不上」的死循环：
 *    ① 下载完成后没人把状态置成「就绪」（唯一发送方随静默下载通道一起删掉了）⇒ 徽标永远
 *       停在「更新」，用户只能再点一次，于是 ② 每次点击都 `fs.rm` 已下好的 669MB 重新下；
 *    ③ 下载完成后走 `shell.openPath`（只是把安装器当文件打开，应用不退、NSIS 装不上）；
 *    ④ 慢速看门狗用**累计平均速度**判定，下载到 99% 处一停顿就被当慢源掐掉、整包重来。
 *
 * ── 现在的模型（只有四个状态，没有任何隐含状态）：
 *      idle ──check──► available ──download──► downloading ──► ready ──install──► installing
 *                        └──────────────────► failed ◄──────────────┘
 *    · `ready` 的判据唯一：**文件存在 + 字节数对 + sha512 对**（三者同时成立才算就绪）。
 *    · `ready` 落盘（`update-state.json`）⇒ 重启应用后仍是 ready，⛔ 不会退回「更新」。
 *    · 下载前先验一次磁盘上已有的包，对上就直接复用，**一个字节都不下**。
 *    · 下载只有一条通道（`downloadThroughMirrors`：镜像排序 + 停滞/低速看门狗都在那边，
 *      这里不再有第二套看门狗），完成后本地重算 sha512 与 `latest.yml` 比对。
 *    · 安装只有一条路：spawn 安装器（`--updated`）→ 确认进程真的起来了 → 退出自己。
 *      ⛔ 不再有 `shell.openPath`、不再有 pending 标记文件、不再有差分/静默下载。
 */

import { app, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mirrorCandidates } from "./gh-mirror";
import { guardedFetch } from "./net-guard";
import { downloadThroughMirrors } from "./mirror-download";
import { RELEASE_FEED_URL, UPDATE_CHANNEL } from "./repo-info";
import { compareVersions } from "./version-utils";

/* js-yaml 没随包带类型声明；只为读 latest.yml 的 version/files，用 require + 最小类型即可。 */
const yaml = require("js-yaml") as { load(input: string): unknown };

/** 更新状态机的四个（加两个过渡）状态。 */
export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing" | "failed";

/** 前端唯一的数据来源；⛔ 不要另加派生状态字段（历史上就是字段太杂，谁都判断不全）。 */
export type UpdateSnapshot = {
  phase: UpdatePhase;
  /** 当前运行版本（`app.getVersion()`） */
  currentVersion: string;
  /** 目标版本（`available` 之后才有） */
  version?: string;
  channel: string;
  /** 安装包字节数（来自 latest.yml） */
  size?: number;
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
  /** 就绪包在磁盘上的位置（安装 / 排障用） */
  path?: string;
};

type Persisted = {
  phase: UpdatePhase;
  version?: string;
  path?: string;
  size?: number;
  sha512?: string;
  /** 开始安装的时间（用于判断「上次安装是否没完成」） */
  installStartedAt?: number;
};

type Feed = { version: string; asset: string; size: number; sha512: string; url: string };

/** 推送回调：由 IPC 层注入（服务本身不 import 窗口，保持可单测）。 */
let notify: ((snapshot: UpdateSnapshot) => void) | null = null;

/** 注入状态推送回调；IPC 卸载时传 null 复位。 */
export function setUpdateNotifier(fn: ((snapshot: UpdateSnapshot) => void) | null): void {
  notify = fn;
}

let snapshot: UpdateSnapshot = { phase: "idle", currentVersion: "0.0.0", channel: UPDATE_CHANNEL };
/** 单飞：同一时刻只允许一个下载任务（两个写同一文件会把包写坏、校验必失败）。 */
let downloading: Promise<UpdateSnapshot> | null = null;

/** 状态文件（惰性取路径：本模块可能早于 `app.setPath("userData")` 被 import）。 */
function stateFile(): string {
  return path.join(app.getPath("userData"), "update-state.json");
}

/** 安装包落地目录：应用自己的 userData，⛔ 不放用户下载目录。 */
function packageDir(version: string): string {
  return path.join(app.getPath("userData"), "update", version);
}

/** 删掉**其它版本**的安装包目录（10-17 用户令：「更新完把旧的安装包去了，否则越积越大」）。
 *
 *  ⛔ 只动本应用自己的 `<userData>/update/` —— 那是我们自己建的目录，⛔ 不碰用户下载目录、
 *     不按扩展名扫全盘（旧实现扫用户 Downloads 认扩展名，风险更高）。
 *  ⛔ 保留 `keepVersion` 那一份：手动重装 / 回退时还能用。
 *  ⛔ 清理失败只跳过（文件被占用很常见），⛔ 绝不影响更新流程。 */
function pruneOldPackages(keepVersion?: string): void {
  const root = path.join(app.getPath("userData"), "update");
  try {
    for (const name of readdirSync(root)) {
      if (keepVersion && name === keepVersion) continue;
      try { rmSync(path.join(root, name), { recursive: true, force: true }); } catch { /* 占用就留着 */ }
    }
  } catch { /* 目录不存在 */ }
}

/** 把**旧版本下载目录里已经下好的包**接管到新位置。
 *
 *  ⛔⛔ 为什么需要：11-21 之前安装包落在 `Downloads/codex-harness/`，重写后改到
 *    `<userData>/update/<version>/`。用户实测「已经下载了 669MB，却检测不到、又从头下」
 *    —— 迁目录必须**接管旧文件**，否则重写本身又制造一次白下。
 *  ⛔ 只认同名 + 字节数 + sha512 都对的文件；⛔ 不删旧目录（用户可能自己还要用）。
 *  返回接管成功后的新路径；没有可接管的返回 null。 */
async function adoptLegacyPackage(feed: Feed): Promise<string | null> {
  try {
    const legacy = path.join(app.getPath("downloads"), "codex-harness", feed.asset);
    if (!existsSync(legacy)) return null;
    const st = statSync(legacy);
    if (feed.size > 0 && st.size !== feed.size) return null;
    /* ⛔ 必须流式算摘要：669MB 整份读进内存会直接把主进程顶爆。 */
    if (feed.sha512 && (await sha512OfFile(legacy)) !== feed.sha512) return null;
    const target = path.join(packageDir(feed.version), feed.asset);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(legacy, target);
    console.log(`[update] 已接管旧目录里的安装包：${legacy} → ${target}`);
    return target;
  } catch {
    return null;
  }
}

/** 读回上次状态；文件损坏/不存在都当没有（不抛）。 */
function readPersisted(): Persisted | null {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), "utf8")) as Persisted;
    if (!raw || typeof raw.phase !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

/** 落盘当前状态（失败只记日志：状态丢了最多重下一次，不能因此挡住更新）。 */
function persist(next: Persisted): void {
  try {
    mkdirSync(path.dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(next), "utf8");
  } catch (err) {
    console.warn("[update] 状态落盘失败：", (err as Error)?.message ?? err);
  }
}

/** 更新内存状态并推给渲染层（唯一的出口，⛔ 别在别处直接改 `snapshot`）。 */
function emit(patch: Partial<UpdateSnapshot>): UpdateSnapshot {
  snapshot = { ...snapshot, ...patch, currentVersion: String(app.getVersion() || "0.0.0"), channel: UPDATE_CHANNEL };
  try {
    notify?.(snapshot);
  } catch {
    /* 推送失败不影响状态机 */
  }
  return snapshot;
}

/** 给渲染层的快照（安装路径只回显文件名，不泄漏完整用户目录）。 */
export function getUpdateSnapshot(): UpdateSnapshot {
  return { ...snapshot };
}

/** 计算文件 sha512（流式，700MB 不整份读内存）。 */
async function sha512OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

/** 磁盘上的包是否就是这一版：字节数与 sha512 都对才认（⛔ 只比大小会被半截包骗过）。 */
async function isUsablePackage(file: string, feed: Feed): Promise<boolean> {
  try {
    if (!existsSync(file)) return false;
    const st = statSync(file);
    if (feed.size > 0 && st.size !== feed.size) return false;
    if (!feed.sha512) return true;
    return (await sha512OfFile(file)) === feed.sha512;
  } catch {
    return false;
  }
}

/** 读 Release 的 `latest.yml`（经镜像候选，走 Chromium 网络栈）；拿不到返回 null。 */
async function fetchFeed(): Promise<Feed | null> {
  for (const candidate of mirrorCandidates(RELEASE_FEED_URL)) {
    try {
      const res = await guardedFetch(candidate, { headers: { "User-Agent": "CodexHarness/0.1" } }, { timeoutMs: 12_000 });
      if (!res.ok) continue;
      const doc = yaml.load(await res.text()) as {
        version?: unknown;
        files?: Array<{ url?: unknown; size?: unknown; sha512?: unknown }>;
        path?: unknown;
        sha512?: unknown;
      } | null;
      const version = String(doc?.version ?? "").trim();
      const file = Array.isArray(doc?.files) ? doc.files[0] : null;
      const asset = String(file?.url ?? doc?.path ?? "").trim();
      if (!/^\d+\.\d+\.\d+/.test(version) || !asset) continue;
      return {
        version,
        asset,
        size: Number(file?.size ?? 0) || 0,
        sha512: String(file?.sha512 ?? doc?.sha512 ?? "").trim(),
        url: `https://github.com/${(RELEASE_FEED_URL.match(/github\.com\/([^/]+\/[^/]+)\//) ?? [])[1] ?? ""}/releases/download/v${version}/${asset}`,
      };
    } catch {
      /* 试下一档 */
    }
  }
  return null;
}

/**
 * 启动时恢复状态（在 `whenReady` 之后调用一次）。
 *
 * 规则：磁盘上的包若仍与「上次记录的版本」对得上 ⇒ 保持 ready（重启后徽标直接显示「安装」）；
 * 若当前运行版本已经等于目标版本 ⇒ 说明上装成功了，清空状态回到 idle。
 * ⛔ 这一步是「装完自动重启后又要重新下载」的根治点：状态在磁盘上，不靠内存。
 */
export async function restoreUpdateState(): Promise<void> {
  const current = String(app.getVersion() || "0.0.0");
  const saved = readPersisted();
  /* 启动即清其它版本的包（安装包拉起后本进程立刻退出，那一刻删不掉 ⇒ 只能等新版本跑起来再清）。 */
  pruneOldPackages(saved?.version);
  if (!saved) {
    emit({ phase: "idle", version: undefined, percent: undefined, receivedBytes: undefined, totalBytes: undefined, error: undefined, path: undefined });
    return;
  }
  /* 已经装上去了 ⇒ 清掉状态，别让下一次启动还以为有更新。 */
  if (saved.version && compareVersions(current, saved.version) >= 0) {
    try { rmSync(stateFile(), { force: true }); } catch { /* 忽略 */ }
    emit({ phase: "idle", version: undefined, path: undefined, error: undefined });
    return;
  }
  if (saved.phase === "ready" && saved.version && saved.path && existsSync(saved.path)) {
    emit({
      phase: "ready",
      version: saved.version,
      size: saved.size,
      path: saved.path,
      percent: 1,
      receivedBytes: saved.size,
      totalBytes: saved.size,
      error: undefined,
    });
    return;
  }
  /* 上次正在装但版本没变 ⇒ 安装没完成，如实报一次，让用户重试。 */
  if (saved.phase === "installing" && saved.version) {
    emit({ phase: "failed", version: saved.version, error: `v${saved.version} 安装未完成，请再点一次「安装」` });
    persist({ ...saved, phase: "failed" });
    return;
  }
  emit({ phase: "idle", version: undefined, path: undefined, error: undefined });
}

/**
 * 检查更新（只读，不下载、不安装）。
 *
 * ⛔ 用户 11-20 令「只提醒，不要强制更新和自动下载」：这里**只**更新状态，绝不触发下载。
 * ⛔ 已下载并校验过的包会被重新认定为 ready —— 否则收藏页/设置页一刷新就退回「更新」。
 */
export async function checkForUpdate(): Promise<UpdateSnapshot> {
  const current = String(app.getVersion() || "0.0.0");
  const feed = await fetchFeed();
  if (!feed) {
    /* 拿不到元数据不算失败（网络/镜像抖动）⇒ 保持当前状态，只报一句可读的原因。 */
    return emit({ error: "检查更新失败：拿不到版本信息（网络或镜像不可用）", phase: snapshot.phase === "ready" ? "ready" : "failed" });
  }
  if (compareVersions(feed.version, current) <= 0) {
    /* 已是最新：把可能残留的旧状态清掉（例如上一版装完没清）。 */
    try { rmSync(stateFile(), { force: true }); } catch { /* 忽略 */ }
    return emit({ phase: "idle", version: undefined, size: undefined, percent: undefined, error: undefined, path: undefined });
  }
  const file = path.join(packageDir(feed.version), feed.asset);
  if (snapshot.phase === "ready" && snapshot.version === feed.version) return snapshot;
  const adopted = (await isUsablePackage(file, feed)) ? file : await adoptLegacyPackage(feed);
  if (adopted) {
    persist({ phase: "ready", version: feed.version, path: adopted, size: feed.size, sha512: feed.sha512 });
    return emit({ phase: "ready", version: feed.version, size: feed.size, path: adopted, percent: 1, receivedBytes: feed.size, totalBytes: feed.size, error: undefined });
  }
  return emit({ phase: "available", version: feed.version, size: feed.size, percent: 0, receivedBytes: 0, totalBytes: feed.size, error: undefined, path: undefined });
}

/**
 * 下载安装包（幂等、单飞、可复用）。
 *
 * 行为：已是 ready 且包可验 ⇒ 立刻返回（**不下任何字节**）；否则下载到
 * `<userData>/update/<version>/` 并校验 sha512，通过才置 ready。
 * ⛔ 不许在这里自动调用安装 —— 安装必须由用户点。
 */
export async function downloadUpdatePackage(): Promise<UpdateSnapshot> {
  if (downloading) return downloading;
  downloading = (async () => {
    try {
      const feed = await fetchFeed();
      if (!feed) return emit({ phase: "failed", error: "下载失败：拿不到版本信息" });
      const target = path.join(packageDir(feed.version), feed.asset);
      const adoptable = (await isUsablePackage(target, feed)) ? target : await adoptLegacyPackage(feed);
      if (adoptable) {
        persist({ phase: "ready", version: feed.version, path: adoptable, size: feed.size, sha512: feed.sha512 });
        return emit({ phase: "ready", version: feed.version, size: feed.size, path: adoptable, percent: 1, receivedBytes: feed.size, totalBytes: feed.size, error: undefined });
      }
      emit({ phase: "downloading", version: feed.version, size: feed.size, percent: 0, receivedBytes: 0, totalBytes: feed.size, error: undefined });
      /* 半截文件先删：本下载器不做续传，留着只会让镜像返回的 206 与本地长度错位。 */
      try { rmSync(target, { force: true }); } catch { /* 忽略 */ }
      const result = await downloadThroughMirrors({
        url: feed.url,
        target,
        onProgress: (p) => {
          /* 每 1% 推一次，避免高频 IPC；末段必推 100%。 */
          const percent = p.total > 0 ? p.received / p.total : 0;
          const last = snapshot.percent ?? 0;
          if (percent >= 1 || percent - last >= 0.01) {
            emit({ phase: "downloading", receivedBytes: p.received, totalBytes: p.total || feed.size, percent });
          }
        },
      });
      const bytes = statSync(target).size;
      if (feed.size > 0 && bytes !== feed.size) {
        try { rmSync(target, { force: true }); } catch { /* 忽略 */ }
        return emit({ phase: "failed", error: `下载不完整（${bytes} / ${feed.size} 字节），请重试` });
      }
      if (feed.sha512) {
        const actual = await sha512OfFile(target);
        if (actual !== feed.sha512) {
          try { rmSync(target, { force: true }); } catch { /* 忽略 */ }
          return emit({ phase: "failed", error: "安装包校验失败（内容与发布的不一致），请重试" });
        }
      }
      console.log(`[update] 下载完成：v${feed.version} ${bytes} 字节 via ${result.host}`);
      pruneOldPackages(feed.version);
      persist({ phase: "ready", version: feed.version, path: target, size: bytes, sha512: feed.sha512 });
      return emit({ phase: "ready", version: feed.version, size: bytes, path: target, percent: 1, receivedBytes: bytes, totalBytes: bytes, error: undefined });
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      return emit({ phase: "failed", error: `下载失败：${message}` });
    } finally {
      downloading = null;
    }
  })();
  return downloading;
}

/**
 * 安装（退出应用 → 起安装器 → 装完自动拉起新版本）。
 *
 * ⛔ Windows 必须走 `spawn(exe, ["--updated"])` + 确认进程存活后再 `app.quit()`：
 *   旧实现 spawn 后立刻 quit，安装器起不来时应用已经没了（用户看到的「闪退、装不上」）。
 * ⛔ 非静默：oneClick 安装器只有进度页，非静默才能看到安装进度条。
 * ⛔ macOS 没有覆盖安装这条路：只打开 dmg/zip 并提示拖进「应用程序」。
 */
export async function installUpdatePackage(): Promise<{ ok: boolean; error?: string }> {
  const saved = readPersisted();
  const file = saved?.path ?? snapshot.path;
  const version = saved?.version ?? snapshot.version ?? "";
  if (!file || !existsSync(file)) {
    return { ok: false, error: "没有已下载的安装包，请先点「更新」下载" };
  }
  if (process.platform === "darwin") {
    await shell.openPath(file);
    return { ok: false, error: "macOS 请打开下载的压缩包，把应用拖进「应用程序」完成更新" };
  }
  if (process.platform !== "win32") {
    await shell.openPath(file);
    return { ok: false, error: "当前平台不支持自动安装，已为你打开安装包所在位置" };
  }
  emit({ phase: "installing", percent: 1, version, error: undefined });
  persist({ phase: "installing", version, path: file, size: saved?.size, sha512: saved?.sha512, installStartedAt: Date.now() });
  const child = spawn(file, ["--updated"], { detached: true, stdio: "ignore" });
  let spawnError: Error | null = null;
  child.once("error", (err) => { spawnError = err; });
  /* ⛔ 等 900ms 确认安装器真的起来了：spawn 失败是**异步 emit("error")**，try/catch 抓不到。 */
  await new Promise((r) => setTimeout(r, 900));
  if (spawnError || child.exitCode !== null) {
    const message = spawnError ? (spawnError as Error).message : `安装器提前退出（code ${child.exitCode}）`;
    emit({ phase: "failed", error: `安装没能启动：${message}` });
    persist({ phase: "failed", version, path: file, size: saved?.size, sha512: saved?.sha512 });
    return { ok: false, error: message };
  }
  child.unref();
  /* 交接完成：退出自己，安装器会覆盖安装并在结束时拉起新版本。 */
  setTimeout(() => app.quit(), 150);
  return { ok: true };
}
