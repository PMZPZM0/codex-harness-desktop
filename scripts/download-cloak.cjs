// CloakBrowser Chromium 内核下载器：多连接分段 + 断点续传 + Clash 代理隧道 +
// SHA256SUMS 签名校验，下载后解压到 resources/tools/cloak-cache/chromium-<ver>/。
// 用法：node scripts/download-cloak.cjs [--direct] [--proxy=127.0.0.1:7897] [--parts=8]
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const VERSION = "146.0.7680.177.5";
const TAG = "chromium-v" + VERSION;
const ZIP_NAME = "cloakbrowser-windows-x64.zip";
const URLS = [
  `https://github.com/CloakHQ/cloakbrowser/releases/download/${TAG}/${ZIP_NAME}`,
  `https://cloakbrowser.dev/${TAG}/${ZIP_NAME}`,
];
const SIG_URLS = [
  `https://github.com/CloakHQ/cloakbrowser/releases/download/${TAG}/SHA256SUMS`,
  `https://github.com/CloakHQ/cloakbrowser/releases/download/${TAG}/SHA256SUMS.sig`,
];
const SIGNING_KEYS = ["MKFKwIhUcKWq5xTuNA0Ovg99njcDEcEJvmWYYhApvaU="];

const args = process.argv.slice(2);
const proxyArg = args.find((a) => a.startsWith("--proxy="));
const PROXY = proxyArg ? proxyArg.slice(8) : "127.0.0.1:7897";
const DIRECT = args.includes("--direct");
const PARTS = Number((args.find((a) => a.startsWith("--parts=")) || "--parts=8").slice(8)) || 8;

const appRoot = path.resolve(__dirname, "..");
const cacheDir = path.join(appRoot, "resources", "tools", "cloak-cache");
const zipPath = path.join(cacheDir, ZIP_NAME);
const binaryDir = path.join(cacheDir, `chromium-${VERSION}`);

function log(msg) { console.log(`[cloak-dl ${new Date().toISOString().slice(11, 19)}] ${msg}`); }

// 通过 Clash 建立 CONNECT 隧道，返回原始 TCP socket（TLS 由 https 模块协商）
function connectViaProxy(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: PROXY.split(":")[0], port: Number(PROXY.split(":")[1]), method: "CONNECT", path: `${host}:${port}` });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`CONNECT ${res.statusCode}`)); return; }
      resolve(socket);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("CONNECT 超时")); });
    req.end();
  });
}

// 单跳请求（https 模块协商 TLS；代理时用 createConnection 包 CONNECT 隧道）
function fetchOnce(urlStr, headers, proxy, onChunk) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const options = { host: u.host, port: 443, path: u.pathname + u.search, method: "GET", headers, agent: false, servername: u.host, rejectUnauthorized: false };
    if (proxy) options.createConnection = () => connectViaProxy(u.host, 443).then((raw) => tls.connect({ socket: raw, servername: u.host, rejectUnauthorized: false }));
    const req = https.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, u).toString() });
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); reject(new Error(`HTTP ${res.statusCode} ${urlStr}`)); return; }
      res.on("data", (chunk) => { try { onChunk(chunk); } catch (err) { req.destroy(err); } });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
      res.on("error", reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error("读超时")));
    req.on("error", reject);
    req.end();
  });
}

// 带重定向的请求
async function fetchRedirect(urlStr, headers, proxy, onChunk) {
  let url = urlStr;
  for (let hop = 0; hop < 6; hop++) {
    const result = await fetchOnce(url, headers, proxy, onChunk);
    if (result.redirect) { url = result.redirect; continue; }
    return result;
  }
  throw new Error("重定向次数过多");
}

// 探测文件总大小（Range: bytes=0-0 读 content-range）
async function contentLength(urlList, proxy) {
  let lastError;
  for (const url of urlList) {
    for (const p of [proxy, false]) {
      try {
        const result = await fetchRedirect(url, { Range: "bytes=0-0", "user-agent": "cloak-dl/1.0" }, p, () => {});
        const cr = result.headers["content-range"];
        if (cr) { const total = Number(cr.split("/")[1]); if (total > 0) return { url, total }; }
        if (result.headers["content-length"]) return { url, total: Number(result.headers["content-length"]) };
      } catch (err) { lastError = err; }
    }
  }
  throw lastError || new Error("无法探测文件大小");
}

// 下载一个分段：[start, end]，断点续传到 partFile，内部自动重试
async function downloadSegment(idx, url, start, end, proxy) {
  const partFile = `${zipPath}.part${idx}`;
  const expected = end - start + 1;
  for (let attempt = 1; attempt <= 40; attempt++) {
    const have = fs.existsSync(partFile) ? fs.statSync(partFile).size : 0;
    if (have >= expected) return partFile;
    const fd = fs.openSync(partFile, "a");
    const pos = start + have;
    let written = have;
    const useProxy = !DIRECT && attempt % 4 !== 0;
    try {
      await fetchRedirect(url, { Range: `bytes=${pos}-${end}`, "user-agent": "cloak-dl/1.0" }, useProxy, (chunk) => {
        fs.writeSync(fd, chunk);
        written += chunk.length;
      });
      fs.closeSync(fd);
      if (written >= expected) return partFile;
      log(`分段 ${idx} 中断于 ${Math.round(written / 1048576)}/${Math.round(expected / 1048576)}MB，续传`);
    } catch (err) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      if (attempt % 8 === 0) log(`分段 ${idx} 第 ${attempt} 次失败：${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`分段 ${idx} 重试耗尽`);
}

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(path.join(binaryDir, "chrome.exe"))) { log("内核已存在，无需下载"); return; }

  // 1. 探测大小 + 分段并行下载
  const { url, total } = await contentLength(URLS, DIRECT ? false : PROXY);
  log(`目标：${url}（共 ${Math.round(total / 1048576)}MB，${PARTS} 线程）`);
  const segSize = Math.ceil(total / PARTS);
  const progress = setInterval(() => {
    let done = 0;
    for (let i = 0; i < PARTS; i++) {
      const f = `${zipPath}.part${i}`;
      if (fs.existsSync(f)) done += fs.statSync(f).size;
    }
    log(`进度 ${Math.round(done / 1048576)}/${Math.round(total / 1048576)}MB（${Math.round((done / total) * 100)}%）`);
  }, 30000);
  await Promise.all(Array.from({ length: PARTS }, (_, i) => {
    const start = i * segSize;
    const end = Math.min(total - 1, start + segSize - 1);
    if (start > end) return Promise.resolve(null);
    return downloadSegment(i, url, start, end);
  }));
  clearInterval(progress);

  // 2. 合并分段 + 哈希校验
  const hash = crypto.createHash("sha256");
  const out = fs.openSync(zipPath, "w");
  for (let i = 0; i < PARTS; i++) {
    const f = `${zipPath}.part${i}`;
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    hash.update(buf);
    fs.writeSync(out, buf);
    fs.unlinkSync(f);
  }
  fs.closeSync(out);
  const size = fs.statSync(zipPath).size;
  log(`合并完成：${Math.round(size / 1048576)}MB`);
  if (size !== total) { console.error(`大小不符：期望 ${total} 实际 ${size}`); process.exit(1); }
  const actualHash = hash.digest("hex");

  // 3. 校验清单签名与哈希（失败仅告警）
  try {
    const sumChunks = [];
    await fetchRedirect(SIG_URLS[0], { "user-agent": "cloak-dl/1.0" }, DIRECT ? false : PROXY, (c) => sumChunks.push(c));
    const sums = Buffer.concat(sumChunks).toString();
    const sigChunks = [];
    await fetchRedirect(SIG_URLS[1], { "user-agent": "cloak-dl/1.0" }, DIRECT ? false : PROXY, (c) => sigChunks.push(c));
    const sig = Buffer.concat(sigChunks);
    const verify = (pubB64, data, sigBuf) => {
      const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubB64, "base64")]);
      return crypto.verify(null, data, crypto.createPublicKey({ key: spki, format: "der", type: "spki" }), sigBuf);
    };
    log(`SHA256SUMS 签名校验：${SIGNING_KEYS.some((k) => verify(k, sums, sig)) ? "通过" : "未通过（仅核对哈希）"}`);
    const entry = sums.split("\n").find((l) => l.includes(ZIP_NAME));
    if (entry) {
      const expected = entry.trim().split(/\s+/)[0];
      if (actualHash === expected) log("SHA256 哈希核对：一致 ✓");
      else { console.error(`SHA256 不一致：期望 ${expected} 实际 ${actualHash}`); fs.unlinkSync(zipPath); process.exit(1); }
    } else log("清单中未找到 zip 条目，跳过哈希核对");
  } catch (err) { log(`校验清单获取失败（跳过）：${err.message}`); }

  // 4. 解压（PowerShell ZipFile API，先解到临时目录）
  const tmpDir = path.join(cacheDir, "_extract");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  log("开始解压…");
  execFileSync("powershell", ["-NoProfile", "-Command",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:CB_ARCHIVE, $env:CB_DEST)"],
    { timeout: 300000, env: { ...process.env, CB_ARCHIVE: zipPath, CB_DEST: tmpDir } });
  log("解压完成");

  // 5. 单层子目录拍平 + 校验 chrome.exe + 写版本标记 + 清理
  let src = tmpDir;
  const entries = fs.readdirSync(tmpDir);
  if (entries.length === 1 && fs.statSync(path.join(tmpDir, entries[0])).isDirectory()) src = path.join(tmpDir, entries[0]);
  fs.rmSync(binaryDir, { recursive: true, force: true });
  fs.renameSync(src, binaryDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (!fs.existsSync(path.join(binaryDir, "chrome.exe"))) {
    console.error("解压后未找到 chrome.exe，目录内容：" + fs.readdirSync(binaryDir).join(", "));
    process.exit(1);
  }
  fs.writeFileSync(path.join(cacheDir, "latest_version_windows-x64"), VERSION);
  fs.unlinkSync(zipPath);
  log(`完成：${binaryDir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
