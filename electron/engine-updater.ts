/**
 * Codex 引擎在线更新（设置页「Codex 引擎更新」配套模块）。
 *
 * 流程：registry 查最新稳定版 → 下载 @openai/codex@<ver>-win32-x64 tgz →
 * tar 解压到临时目录 → 校验新二进制 --version → 停引擎 → 替换 vendor 目录
 * （旧目录保留一代做回滚）→ 校验落位版本。失败自动回滚并重启引擎。
 *
 * 网络配套（09-27 与「开发工具」页的下载源统一）：
 * - 下载源 `app-settings.downloadSource`：auto / mirror → **国内镜像（npmmirror）在前**，
 *   失败回落 npmjs；direct → 官方源在前；ghproxy / ghfast 是 GitHub 加速通道、对 npm registry
 *   没有对应实现 ⇒ 回落 auto；每次更新现读，切完源下一次检查立即生效。
 * - 代理 `app-settings.engineProxyUrl`（如 http://127.0.0.1:7890）：走 HTTP CONNECT 隧道。
 *   ⛔ 代理是"怎么连"、下载源是"连谁"：配了代理时两个源都走隧道，但**先后顺序仍按下载源偏好**。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { app } from "electron";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import os from "node:os";
import { codexBinaryPath } from "./codex-server";
import { readAppSettings } from "./app-settings";

const NPMJS = "https://registry.npmjs.org";
const NPMMIRROR = "https://registry.npmmirror.com";
const PKG_NAME = "@openai/codex";
const TARBALL = PKG_NAME.split("/")[1];
const PLATFORM_SUFFIX = process.platform === "win32"
  ? (process.arch === "x64" ? "win32-x64" : "win32-arm64")
  : (process.arch === "arm64" ? (process.platform === "darwin" ? "darwin-arm64" : "linux-arm64") : (process.platform === "darwin" ? "darwin-x64" : "linux-x64"));
const USER_AGENT = "CodexHarness-EngineUpdater/1.0";

export type EngineUpdateProgress = { stage: string; detail?: string; percent?: number };

export type EngineVersionInfo = {
  current: string;
  latest: string;
  hasUpdate: boolean;
};

// ── HTTP 底座：直连 + HTTP CONNECT 代理隧道 ──

function connectThroughProxy(proxy: URL, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port || 80) });
    const fail = (err: Error) => { socket.destroy(); reject(err); };
    socket.setTimeout(timeoutMs, () => fail(new Error("代理连接超时")));
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`);
    });
    let header = "";
    const onData = (chunk: Buffer) => {
      header += chunk.toString("latin1");
      const idx = header.indexOf("\r\n\r\n");
      if (idx < 0) return;
      socket.off("data", onData);
      socket.setTimeout(0);
      socket.removeListener("error", fail);
      if (/^HTTP\/1\.[01] 2\d\d/.test(header)) resolve(socket);
      else fail(new Error(`代理 CONNECT 失败：${header.split("\r\n")[0]}`));
    };
    socket.on("data", onData);
  });
}

// registry JSON 很小：整包收完再解析；tarball 下载单独走流式函数。
async function fetchText(url: string, proxyUrl?: string, timeoutMs = 20000): Promise<string> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const port = Number(parsed.port || (isHttps ? 443 : 80));
  let socket: net.Socket;
  if (proxyUrl) {
    const proxy = new URL(proxyUrl);
    socket = await connectThroughProxy(proxy, parsed.hostname, port, timeoutMs);
  } else {
    socket = net.connect({ host: parsed.hostname, port });
  }
  if (isHttps) {
    socket = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: !allowInsecureTls() }) as unknown as net.Socket;
  }
  return new Promise((resolve, reject) => {
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error("请求超时")); });
    socket.once("error", (err) => reject(err));
    socket.write([
      `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
      `Host: ${parsed.hostname}`,
      `User-Agent: ${USER_AGENT}`,
      "Accept: application/json",
      "Connection: close",
      "\r\n",
    ].join("\r\n"));
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("close", () => {
      const raw = Buffer.concat(chunks);
      const idx = raw.indexOf("\r\n\r\n");
      if (idx < 0) return reject(new Error("响应格式异常"));
      const status = Number(raw.slice(0, idx).toString("latin1").match(/HTTP\/1\.[01] (\d+)/)?.[1] ?? 0);
      if (status !== 200) return reject(new Error(`HTTP ${status}`));
      resolve(raw.slice(idx + 4).toString("utf8"));
    });
  });
}

/** 流式下载（支持 HTTP 重定向与代理），供更新流程与测试使用 */
export async function downloadTo(
  url: string,
  dest: string,
  proxyUrl: string | undefined,
  onProgress: (percent: number) => void,
  timeoutMs = 120000,
  redirectsLeft = 3,
): Promise<void> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const port = Number(parsed.port || (isHttps ? 443 : 80));
  let socket: net.Socket;
  if (proxyUrl) {
    const proxy = new URL(proxyUrl);
    socket = await connectThroughProxy(proxy, parsed.hostname, port, timeoutMs);
  } else {
    socket = net.connect({ host: parsed.hostname, port });
  }
  if (isHttps) {
    socket = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: !allowInsecureTls() }) as unknown as net.Socket;
  }
  await new Promise<void>((resolve, reject) => {
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error("下载超时")); });
    socket.once("error", (err) => reject(err));
    socket.write([
      `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
      `Host: ${parsed.hostname}`,
      `User-Agent: ${USER_AGENT}`,
      "Accept: */*",
      "Connection: close",
      "\r\n",
    ].join("\r\n"));
    let raw = Buffer.alloc(0);
    let headerDone = false;
    let status = 0;
    let headers: Record<string, string> = {};
    let total = 0;
    let received = 0;
    let out: import("node:fs").WriteStream | null = null;
    const handleChunk = (chunk: Buffer) => {
      if (!headerDone) {
        raw = Buffer.concat([raw, chunk]);
        const idx = raw.indexOf("\r\n\r\n");
        if (idx < 0) return;
        const head = raw.slice(0, idx).toString("latin1").split("\r\n");
        status = Number(head[0]?.match(/HTTP\/1\.[01] (\d+)/)?.[1] ?? 0);
        for (const line of head.slice(1)) {
          const sep = line.indexOf(":");
          if (sep > 0) headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
        }
        headerDone = true;
        if (status === 301 || status === 302 || status === 303 || status === 307) {
          socket.destroy();
          const location = headers["location"];
          if (!location || redirectsLeft <= 0) return reject(new Error(`重定向异常（HTTP ${status}）`));
          const next = new URL(location, url).toString();
          downloadTo(next, dest, proxyUrl, onProgress, timeoutMs, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) { socket.destroy(); return reject(new Error(`HTTP ${status}`)); }
        total = Number(headers["content-length"] ?? 0) || 0;
        out = createWriteStream(dest);
        out.on("error", (err) => { socket.destroy(); reject(err); });
        out.on("finish", () => { out?.close(() => resolve()); });
        const rest = raw.slice(raw.indexOf("\r\n\r\n") + 4);
        if (rest.length) writeBody(rest);
        return;
      }
      writeBody(chunk);
    };
    const writeBody = (chunk: Buffer) => {
      received += chunk.length;
      out?.write(chunk);
      if (total) onProgress(Math.min(1, received / total));
    };
    socket.on("data", handleChunk);
    socket.on("close", () => {
      if (out && !out.writableEnded) out.end(() => resolve());
      else if (!headerDone) reject(new Error("连接提前断开"));
    });
  });
}

// ── registry 层 ──

/**
 * 下载源偏好（09-27）：与「开发工具」页同一套取值（`app-settings.downloadSource`），
 * 每次更新现读 ⇒ 切完源下一次检查立即生效，不用重启。
 * ⛔ ghproxy / ghfast 是 GitHub 加速通道，对 npm registry 没有对应实现 ⇒ 回落 auto
 *    （与工具链侧对浏览器内核的处理同源，别在这里假装支持）。
 */
async function readDownloadSource(): Promise<"auto" | "mirror" | "direct" | "proxy"> {
  try {
    const source = (await readAppSettings(app.getPath("userData"))).downloadSource;
    return source === "mirror" || source === "direct" || source === "proxy" ? source : "auto";
  } catch {
    return "auto";
  }
}

/**
 * 按源偏好排出两个 registry 的顺序。⛔ 代理是"怎么连"、下载源是"连谁"：
 * 配了代理就两个源都走隧道，但**先后顺序仍按偏好**（auto/mirror 镜像在前，direct 官方在前）。
 */
async function orderedRegistries(proxyUrl?: string): Promise<{ base: string; proxy?: string }[]> {
  const source = await readDownloadSource();
  const first = source === "direct" ? NPMJS : NPMMIRROR;
  const second = first === NPMJS ? NPMMIRROR : NPMJS;
  return [{ base: first, proxy: proxyUrl }, { base: second, proxy: proxyUrl }];
}

async function registryEndpoints(proxyUrl?: string): Promise<{ base: string; proxy?: string }[]> {
  return orderedRegistries(proxyUrl);
}

function trimVersion(raw: string): string {
  return String(raw).replace(/^codex-cli\s*/i, "").trim();
}

async function fetchLatestVersion(endpoints: { base: string; proxy?: string }[]): Promise<string> {
  let lastError: unknown = null;
  for (const ep of endpoints) {
    try {
      const body = await fetchText(`${ep.base}/${PKG_NAME}/latest`, ep.proxy);
      const meta = JSON.parse(body) as { version?: string };
      if (!meta.version) throw new Error("响应里没有 version 字段");
      return meta.version;
    } catch (err) { lastError = err; }
  }
  throw new Error(`查询最新版本失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// ── 版本与安装 ──

function runCommand(bin: string, args: string[], timeoutMs = 15000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = "";
    const collect = (d: Buffer) => { out += d.toString(); };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, out: out.trim() || "执行超时" }); }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, out: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim() }); });
  });
}

function tarExecutable(): string {
  // ⛔ mac 适配（09-17 审计）：darwin 用系统 bsdtar（/usr/bin/tar）。GUI 启动的进程 PATH 是
  // launchd 给的最小集，裸名 "tar" 在 PATH 被改过的环境里可能落空；能给绝对路径就给。
  if (process.platform === "darwin") {
    return existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "tar";
  }
  const sysTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync(sysTar) ? sysTar : "tar";
}

/** 读取当前引擎版本（失败返回空串） */
export async function currentEngineVersion(): Promise<string> {
  try {
    const bin = codexBinaryPath();
    if (!existsSync(bin)) return "";
    const { out } = await runCommand(bin, ["--version"]);
    return trimVersion(out);
  } catch { return ""; }
}

export async function checkEngineUpdate(proxyUrl?: string): Promise<EngineVersionInfo> {
  const current = await currentEngineVersion();
  const latest = await fetchLatestVersion(await registryEndpoints(proxyUrl || undefined));
  return { current, latest, hasUpdate: Boolean(latest) && latest !== current };
}

/** 平台包 vendor 目录（引擎二进制所在），同时是替换目标 */
function platformPackageDir(): { pkgDir: string; vendorDir: string; exeName: string } {
  const bin = codexBinaryPath(); // .../vendor/<target>/bin/codex.exe
  const exeName = path.basename(bin);
  const vendorDir = path.dirname(path.dirname(bin)); // vendor/<target>
  const pkgDir = path.dirname(path.dirname(vendorDir)); // node_modules/@openai/codex-win32-x64
  return { pkgDir, vendorDir, exeName };
}

export async function performEngineUpdate(
  proxyUrl: string | undefined,
  report: (progress: EngineUpdateProgress) => void,
): Promise<{ ok: boolean; version: string; message: string }> {
  const endpoints = await registryEndpoints(proxyUrl || undefined);
  const { vendorDir, exeName } = platformPackageDir();
  const targetTriple = path.basename(vendorDir); // x86_64-pc-windows-msvc 等

  report({ stage: "query", detail: "正在查询最新版本…" });
  let latest: string;
  try {
    latest = await fetchLatestVersion(endpoints);
  } catch (err) {
    return { ok: false, version: "", message: err instanceof Error ? err.message : String(err) };
  }
  const current = await currentEngineVersion();
  if (latest === current) return { ok: true, version: current, message: "已是最新版本" };

  const tarballVersion = `${latest}-${PLATFORM_SUFFIX}`;
  /* ⛔⛔ 暂存目录**必须与目标同卷**：`os.tmpdir()` 通常在 C:，而引擎可能装在 D:
     （系统盘 C: + 应用装 D: 是极常见的布局）⇒ 跨卷 `rename` 直接 `EXDEV: cross-device link
     not permitted`。实测现象就是「能下载、装不上」——因为**只有落位那一步失败**，下载/解压/自检全过。
     ⇒ 放到 `vendorDir` 的**父目录**下（必然同卷），rename 才有意义；跨卷仍由 `movePath` 兜底。 */
  const workRoot = path.join(path.dirname(vendorDir), `.engine-update-${Date.now()}`);
  await fs.mkdir(workRoot, { recursive: true });

  // 1) 下载 tarball：与 registry 同一套源顺序（镜像在前 / direct 时官方在前），配代理则都走隧道
  const tarballPath = path.join(workRoot, `codex-${tarballVersion}.tgz`);
  const candidates: { url: string; proxy?: string }[] = (await orderedRegistries(proxyUrl))
    .map(({ base, proxy }) => ({ url: `${base}/${PKG_NAME}/-/${TARBALL}-${tarballVersion}.tgz`, proxy }));
  let downloaded = false;
  let lastDownloadError: unknown = null;
  /* ⛔⛔ 换源**必须自解释**：这里是"依次试多个下载源"，每个候选失败都会重来一轮 0→100%。
     旧实现每轮只报「开始下载引擎包…」+ 进度 ⇒ 界面上看起来是**同一个下载重复了 6 次**
     （用户实测报「下载记录重复显示多次」）。⇒ 从第二个源起，明确写清"第几个源失败、为什么"。 */
  for (const [candIndex, cand] of candidates.entries()) {
    try {
      report({
        stage: "download",
        detail: candIndex === 0
          ? `开始下载引擎包 ${tarballVersion}…`
          : `第 ${candIndex} 个下载源失败（${(lastDownloadError as Error)?.message?.slice(0, 80) || "未知原因"}），换源重试…`,
        percent: 0,
      });
      await downloadTo(cand.url, tarballPath, cand.proxy, (percent) => report({ stage: "download", detail: "下载中", percent }));
      const stat = await fs.stat(tarballPath);
      if (stat.size < 1024 * 1024) throw new Error(`下载文件异常过小（${stat.size} 字节）`);
      downloaded = true;
      break;
    } catch (err) { lastDownloadError = err; }
  }
  if (!downloaded) {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, version: "", message: `下载失败：${lastDownloadError instanceof Error ? lastDownloadError.message : String(lastDownloadError)}` };
  }

  try {
    // 2) 解压
    report({ stage: "extract", detail: "解压引擎包…" });
    const extractDir = path.join(workRoot, "extract");
    await fs.mkdir(extractDir, { recursive: true });
    const tarResult = await runCommand(tarExecutable(), ["-xzf", tarballPath, "-C", extractDir], 120000);
    if (!tarResult.ok) throw new Error(`解压失败：${tarResult.out.slice(0, 200)}`);
    const newVendorDir = path.join(extractDir, "package", "vendor", targetTriple);
    const newBin = path.join(newVendorDir, "bin", exeName);
    if (!existsSync(newBin)) throw new Error("解压结果里找不到引擎二进制（目录结构变了？）");

    // 3) 校验新二进制版本
    report({ stage: "verify", detail: "校验新引擎…" });
    const probe = await runCommand(newBin, ["--version"]);
    if (!probe.ok || !trimVersion(probe.out).includes(latest)) {
      throw new Error(`新引擎自检失败：${probe.out.slice(0, 120) || "无法执行"}`);
    }

    // 4) 停引擎（调用方负责，见 main.ts handler），替换 vendor 目录
    report({ stage: "replace", detail: "替换引擎文件…" });
    const backupDir = `${vendorDir}.bak-1`;
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    try {
      await movePath(vendorDir, backupDir);
    } catch (err) {
      throw new Error(`引擎文件被占用（引擎未完全退出？）：${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await movePath(newVendorDir, vendorDir);
    } catch (err) {
      await movePath(backupDir, vendorDir).catch(() => undefined);
      /* ⛔ 提示要指向真因：EXDEV = 跨盘，不是「文件坏了」。旧文案只丢原始错误串，用户看不懂。 */
      const moveCode = (err as NodeJS.ErrnoException)?.code;
      const moveHint =
        moveCode === "EXDEV" ? "（跨盘移动：暂存目录与安装目录不在同一个卷）"
        : /^(EPERM|EBUSY|ENOTEMPTY)$/.test(String(moveCode ?? "")) ? "（文件被占用：引擎进程/杀软/索引器仍握着句柄，稍后重试即可）"
        : "";
      throw new Error(`落位失败${moveHint}（已回滚）：${err instanceof Error ? err.message : String(err)}`);
    }

    // 5) 落位复验
    const finalBin = path.join(vendorDir, "bin", exeName);
    const finalProbe = await runCommand(finalBin, ["--version"]);
    if (!finalProbe.ok || !trimVersion(finalProbe.out).includes(latest)) {
      // 回滚
      await fs.rm(vendorDir, { recursive: true, force: true }).catch(() => undefined);
      await movePath(backupDir, vendorDir).catch(() => undefined);
      throw new Error("替换后自检失败，已回滚旧版本");
    }
    report({ stage: "done", detail: `引擎已更新到 ${latest}` });
    return { ok: true, version: latest, message: `引擎已更新到 ${latest}` };
  } catch (err) {
    return { ok: false, version: current, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 目录移动：先 `rename`（同卷零拷贝、原子）；**跨卷（EXDEV）退化为复制 + 删除**。
 *
 *  ⛔ 为什么必须兜这个：`rename` 是**唯一**会因"跨盘"失败的文件操作，而
 *     「系统盘 C: + 应用装 D:」是极常见布局。不兜的后果不是报个错就完了 ——
 *     旧目录已经被移到 `.bak-1`、新目录又落不过去 ⇒ 引擎暂时不可用，只能靠回滚救回来，
 *     用户看到的是「下载 100%、装不上」。⛔ 这属于"防丢数据/可用性"的硬要求，不许省。 */
async function movePath(from: string, to: string): Promise<void> {
  /* ⛔⛔ 为什么必须重试（10-17 第二次实测）：跨盘问题修掉后，**同一台机器**立刻撞上
     `EPERM: operation not permitted, rename …` —— 两边都在 D: 盘，纯粹是 **Windows 文件占用**。
     真因：本函数前面刚用 `runCommand(newBin, ["--version"])` **执行过**要搬的那棵树里的 exe，
     Windows 会**短暂持有刚退出的进程映像**（此外还有杀软 / 索引器扫新解压的 ~100MB 树），
     此刻 rename 它的父目录就 EPERM。⇒ 与 `free-gateway-ipc.ts` 同款（那里 10-12 验收实测过），
     重试 5 次、间隔递增。⛔ 不重试的表现就是：下载/解压/自检全绿，落位一步失败并回滚。 */
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = String((err as NodeJS.ErrnoException)?.code ?? "");
      if (code === "EXDEV") {
        /* 跨卷：复制整棵树再删源。⛔ `dereference:false` —— 保留符号链接语义，别把链接展开成实体。 */
        await fs.cp(from, to, { recursive: true, force: true, errorOnExist: false, dereference: false });
        await fs.rm(from, { recursive: true, force: true });
        return;
      }
      /* ⛔ 只重试"瞬时占用"这一类；ENOENT / EACCES(权限) 等真错误立刻抛，别掩盖。 */
      if (attempt === 4 || !/^(EPERM|EBUSY|ENOTEMPTY)$/.test(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** TLS 校验开关（09-13 审计 P0）：默认**校验证书**。旧实现无条件 `rejectUnauthorized:false`，
 *  等于给企业代理/公共 Wi-Fi/被污染的 DNS 开了"把引擎包换成攻击者包"的窗口，而引擎包解压后
 *  会被当场执行（`runCommand(newBin, ["--version"])`）—— 比"下载被换"更靠前。
 *  自签名代理场景显式设 CODEX_HARNESS_INSECURE_TLS=1 才放行（并在日志里明确警告）。 */
function allowInsecureTls(): boolean {
  const on = process.env.CODEX_HARNESS_INSECURE_TLS === "1";
  if (on) console.warn("[updater] 已按 CODEX_HARNESS_INSECURE_TLS=1 关闭 TLS 证书校验（仅限自签名代理场景）");
  return on;
}