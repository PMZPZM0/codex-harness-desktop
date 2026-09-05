/**
 * Codex 引擎在线更新（设置页「Codex 引擎更新」配套模块）。
 *
 * 流程：registry 查最新稳定版 → 下载 @openai/codex@<ver>-win32-x64 tgz →
 * tar 解压到临时目录 → 校验新二进制 --version → 停引擎 → 替换 vendor 目录
 * （旧目录保留一代做回滚）→ 校验落位版本。失败自动回滚并重启引擎。
 *
 * 网络配套：
 * - 设置了代理（app-settings.json engineProxyUrl，如 http://127.0.0.1:7890）：
 *   走 HTTP CONNECT 隧道访问 registry.npmjs.org 官方源。
 * - 未设代理：先试国内 npmmirror 直连，失败再试 npmjs 直连。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import os from "node:os";
import { codexBinaryPath } from "./codex-server";

const NPMJS = "https://registry.npmjs.org";
const NPMMIRROR = "https://registry.npmmirror.com";
const PKG_NAME = "@openai/codex";
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
    socket = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: false }) as unknown as net.Socket;
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
    socket = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: false }) as unknown as net.Socket;
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

async function registryEndpoints(proxyUrl?: string): Promise<{ base: string; proxy?: string }[]> {
  if (proxyUrl) return [{ base: NPMJS, proxy: proxyUrl }, { base: NPMMIRROR, proxy: proxyUrl }];
  // 无代理：国内镜像直连优先，官方源直连兜底
  return [{ base: NPMMIRROR }, { base: NPMJS }];
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
  const workRoot = path.join(os.tmpdir(), `codex-engine-update-${Date.now()}`);
  await fs.mkdir(workRoot, { recursive: true });

  // 1) 下载 tarball：镜像优先（下载量大，镜像快），代理配置则用官方源
  const tarballPath = path.join(workRoot, `codex-${tarballVersion}.tgz`);
  const candidates: { url: string; proxy?: string }[] = proxyUrl
    ? [{ url: `${NPMJS}/${PKG_NAME}/-/${PKG_NAME.split("/")[1]}-${tarballVersion}.tgz`, proxy: proxyUrl }, { url: `${NPMMIRROR}/${PKG_NAME}/-/${PKG_NAME.split("/")[1]}-${tarballVersion}.tgz`, proxy: proxyUrl }]
    : [{ url: `${NPMMIRROR}/${PKG_NAME}/-/${PKG_NAME.split("/")[1]}-${tarballVersion}.tgz` }, { url: `${NPMJS}/${PKG_NAME}/-/${PKG_NAME.split("/")[1]}-${tarballVersion}.tgz` }];
  let downloaded = false;
  let lastDownloadError: unknown = null;
  for (const cand of candidates) {
    try {
      report({ stage: "download", detail: `开始下载引擎包 ${tarballVersion}…`, percent: 0 });
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
      await fs.rename(vendorDir, backupDir);
    } catch (err) {
      throw new Error(`引擎文件被占用（引擎未完全退出？）：${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await fs.rename(newVendorDir, vendorDir);
    } catch (err) {
      await fs.rename(backupDir, vendorDir).catch(() => undefined);
      throw new Error(`落位失败（已回滚）：${err instanceof Error ? err.message : String(err)}`);
    }

    // 5) 落位复验
    const finalBin = path.join(vendorDir, "bin", exeName);
    const finalProbe = await runCommand(finalBin, ["--version"]);
    if (!finalProbe.ok || !trimVersion(finalProbe.out).includes(latest)) {
      // 回滚
      await fs.rm(vendorDir, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(backupDir, vendorDir).catch(() => undefined);
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
