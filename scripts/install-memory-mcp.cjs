#!/usr/bin/env node
/**
 * 可选的「MCP 记忆服务」按需安装器（@vheins/local-memory-mcp）。
 *
 * ⛔ 设计前提（用户 09-25 明确）：这个服务**不内置**——不进 package.json 依赖、不随包发布，
 *    由用户在 设置 → 记忆 → 记忆后端 里自主选择是否安装/启用。装到应用 userData 下的独立目录，
 *    卸载就是删目录（与语音模型 `install-voice-models.cjs` 同一套路）。
 *
 * ⛔⛔ 为什么这么绕（09-25 第二版，真机踩出来的三条）：
 *   ① **必须用「应用自带的 node」装 + 跑**，不能用 Electron 的 node：better-sqlite3 按
 *      `NODE_MODULE_VERSION`(ABI) 取预编译产物 —— 实测 Electron 43 的 ABI 是 **149**、
 *      自带 node 24 是 **137**、系统 node 22 是 **127**，三者互不通用。用 electron.exe 当
 *      runner ⇒ 装得再好也会 `Could not locate the bindings file`。
 *   ② **不能依赖 postinstall**：npm 的 postinstall 会派生子进程（prebuild-install / esbuild install.js），
 *      受限环境直接装失败。所以这里显式 `--ignore-scripts`，改为**自己把原生绑定下载解包**。
 *   ③ **必须真握手验证**：装完只判文件存在 = 把坏安装报成"已就绪"，用户选了 MCP 却写不进记忆。
 *
 * 用法：
 *   node install-memory-mcp.cjs              # 安装（已装且可用则跳过）
 *   node install-memory-mcp.cjs --check      # 只查状态（退出码 0=已装，2=未装）
 *   node install-memory-mcp.cjs --verify     # 真跑一次 MCP 握手（0=可用）
 *   node install-memory-mcp.cjs --uninstall  # 卸载（删目录）
 *   node install-memory-mcp.cjs --force      # 已装也重来一遍（修坏安装）
 *
 * 落点：<userData>/memory-mcp/（node_modules 在里面）
 * 输出：单行 JSON 到 stdout（便于 IPC 解析），人类可读进度走 stderr。
 * 退出码：0=成功/已装；1=失败；2=未安装（仅 --check）。
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

// 强制清掉宿主注入项（同 e2e harness / 语音模型安装器）
delete process.env.NODE_OPTIONS;
delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const doCheck = args.includes("--check");
const doUninstall = args.includes("--uninstall");
const doVerify = args.includes("--verify");
const doForce = args.includes("--force");

function userDataRoot() {
  if (process.env.CODEX_HARNESS_USER_DATA) return process.env.CODEX_HARNESS_USER_DATA;
  if (process.platform === "win32") return path.join(process.env.APPDATA || os.homedir(), "Codex Harness Desktop");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Codex Harness Desktop");
  return path.join(os.homedir(), ".config", "Codex Harness Desktop");
}

const ROOT = path.join(userDataRoot(), "memory-mcp");
const SERVER_REL = ["node_modules", "@vheins", "local-memory-mcp", "bin", "mcp-memory-server.js"];
const serverPath = path.join(ROOT, ...SERVER_REL);
const PKG_DIR = path.join(ROOT, "node_modules", "@vheins", "local-memory-mcp");
const NATIVE_DIR = path.join(ROOT, "node_modules", "better-sqlite3");

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function log(msg) {
  process.stderr.write(`[memory-mcp] ${msg}\n`);
}

function status() {
  const installed = fs.existsSync(serverPath);
  let version = null;
  try {
    const pkg = path.join(PKG_DIR, "package.json");
    if (fs.existsSync(pkg)) version = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch (e) { /* 忽略 */ }
  return { installed, version: version || undefined, root: ROOT, serverPath: installed ? serverPath : undefined };
}

/* ── 应用自带的 node / npm（新电脑无需预装 Node.js）────────────────────────────
   两个落点：
     · 打包版：本脚本被 extraResources 放到 `<resources>/tools/install-memory-mcp.cjs`，
       自带 node 在同级 `tools/node/node.exe`；
     · 开发版：本脚本在 `<repo>/scripts/`，自带 node 在 `<repo>/resources/tools/node/node.exe`。 */
function bundledNode() {
  const cands = [
    path.join(__dirname, "node", process.platform === "win32" ? "node.exe" : "node"),
    path.join(__dirname, "..", "resources", "tools", "node", process.platform === "win32" ? "node.exe" : "node"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
function npmCliFor(nodeExe) {
  const cli = path.join(path.dirname(nodeExe), "node_modules", "npm", "bin", "npm-cli.js");
  return fs.existsSync(cli) ? cli : null;
}

const NODE = bundledNode();
const NPM_CLI = NODE ? npmCliFor(NODE) : null;

/* ── 极简下载器（跟随重定向；不用 spawn curl，避开受限环境的进程限制）── */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("重定向过多"));
    const req = https.get(url, { headers: { "user-agent": "codex-harness-installer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ← ${url}`));
      }
      const tmp = dest + ".part";
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          try { fs.renameSync(tmp, dest); } catch (e) { return reject(e); }
          resolve(dest);
        });
      });
      out.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("下载超时（60s）")));
  });
}

/* ── 多通道下载（09-25 真机：GitHub Releases 直连在国内常中断 —— curl 实测 `exit 56`；
      同一 URL 走本地代理 / ghfast 镜像则 10s 内完成且字节数一致）──
   依次试：直连 → ghfast.top → gh-proxy.com，每通道 2 次；全失败才报错，并把各通道原因拼出来。 */
function mirrorUrls(url) {
  if (!/^https:\/\/github\.com\//.test(url)) return [url];
  return [url, `https://ghfast.top/${url}`, `https://gh-proxy.com/${url}`];
}

async function downloadAny(url, dest) {
  const errors = [];
  for (const u of mirrorUrls(url)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await download(u, dest);
        return { ok: true, via: u };
      } catch (e) {
        errors.push(`${new URL(u).host}${attempt > 1 ? `(第${attempt}次)` : ""}: ${e.message}`);
      }
    }
  }
  return { ok: false, error: errors.join(" / ") };
}

/* ── 解 tar.gz：**纯 JS**（zlib + 极简 tar 头解析），不 spawn tar / cmd。
   ⛔ 真机实测（09-25）：`spawnSync("tar", …, { shell:true })` 在 Windows 上会经 cmd.exe，
      受限环境直接 `EBUSY` ⇒ 安装器整个卡在「预编译包取不到」的假象里。
      自己解还顺带免掉「系统没有 tar」这一类依赖（新电脑更稳）。 */
function extractFromTarGz(tarGzPath, wantSuffix, destPath) {
  const zlib = require("node:zlib");
  const tar = zlib.gunzipSync(fs.readFileSync(tarGzPath));
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    let allZero = true;
    for (const b of header) { if (b !== 0) { allZero = false; break; } }
    if (allZero) break; // 两个全零块 = 归档结束
    const name = header.subarray(0, 100).toString("utf8").split("\0")[0];
    const size = parseInt(header.subarray(124, 136).toString("utf8").split("\0")[0].trim(), 8) || 0;
    const type = String.fromCharCode(header[156] || 48); // "0"=普通文件
    const dataOff = off + 512;
    if (name.endsWith(wantSuffix) && (type === "0" || type === "5" || type === "\0")) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, tar.subarray(dataOff, dataOff + size));
      return { ok: true, name, bytes: size };
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return { ok: false };
}

/* ── 补原生绑定：better-sqlite3 的 .node 必须与**运行服务的那个 node** 的 ABI 匹配 ──
   ⛔ 本脚本自己就跑在目标 node 上（主进程用自带 node 拉起），所以 process.versions.modules
      就是正确 ABI，不需要猜、也不需要 spawn 探测。 */
async function ensureNativeBinding() {
  if (!fs.existsSync(NATIVE_DIR)) return { ok: false, error: "better-sqlite3 未安装（npm install 没成功）" };
  const target = path.join(NATIVE_DIR, "build", "Release", "better_sqlite3.node");
  if (fs.existsSync(target)) return { ok: true, already: true, abi: process.versions.modules };

  const pkg = JSON.parse(fs.readFileSync(path.join(NATIVE_DIR, "package.json"), "utf8"));
  const abi = process.versions.modules;
  const plat = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch;
  const file = `better-sqlite3-v${pkg.version}-node-v${abi}-${plat}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkg.version}/${file}`;
  const dest = path.join(ROOT, file);
  log(`补原生绑定：ABI=${abi} → ${file}`);
  try {
    const dl = await downloadAny(url, dest);
    if (!dl.ok) throw new Error(`所有下载通道都失败（${dl.error}）`);
    const ex = extractFromTarGz(dest, "better_sqlite3.node", target);
    if (!ex.ok) throw new Error("解包里没有 better_sqlite3.node");
    try { fs.rmSync(dest, { force: true }); } catch (e) { /* 忽略 */ }
  } catch (e) {
    return { ok: false, error: `预编译包取不到（${e.message}）`, url, abi };
  }
  if (!fs.existsSync(target)) return { ok: false, error: "解包后仍未找到 better_sqlite3.node", url };
  return { ok: true, downloaded: true, abi, url };
}

/* ── 跑 npm install：用**异步 spawn**（不是 spawnSync）。
   ⛔ 为什么不用 spawnSync：真机实测（09-25）宿主里 spawnSync 起 node 会失败（受限环境返回
      `status=null` 且 stdout/stderr 全空，错误只藏在 `r.error` 里 —— 旧版把这类失败报成
      「npm install 失败（多数是网络）」，把环境问题说成网络问题，误导排查）。
      异步 spawn 与 --verify 同一路子，真机可行，还能顺带把输出回传 UI。 */
function runNpmInstall(nodeExe, npmArgs) {
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(nodeExe, npmArgs, {
        cwd: ROOT,
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "" },
      });
    } catch (e) {
      return resolve({ status: null, out: "", err: String(e && e.message ? e.message : e) });
    }
    let out = "", err = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* 已退出 */ }
      resolve({ status: -1, out, err: err + "\n[超时 10 分钟]" });
    }, 10 * 60 * 1000);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ status: null, out, err: err + "\n" + String(e.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: code, out, err }); });
  });
}

/* ── --verify：**真起一次服务做 MCP 握手**（用自带 node，与引擎侧同一个运行时）── */
function verifySync(nodeExe) {
  if (!fs.existsSync(serverPath)) return { installed: false, verified: false, error: "未安装" };
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(nodeExe, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    let out = "", err = "", done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) { /* 已退出 */ }
      resolve({ ...status(), ...r });
    };
    const timer = setTimeout(() => finish({ verified: false, error: "超时：15s 内未完成 MCP 握手（服务可能卡在加载原生模块）", detail: String(err || out).slice(-400) }), 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes('"result"')) { clearTimeout(timer); finish({ verified: true }); }
    });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); finish({ verified: false, error: "进程无法启动：" + e.message }); });
    child.on("exit", (c) => {
      if (c !== 0) { clearTimeout(timer); finish({ verified: false, error: "服务退出码 " + c, detail: String(err).slice(-400) }); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "harness-installer", version: "2.0" } } }) + "\n");
  });
}

async function main() {
  if (doCheck) {
    const s = status();
    emit({ ...s, node: NODE || null, abi: process.versions.modules });
    process.exit(s.installed ? 0 : 2);
  }

  if (doUninstall) {
    try {
      fs.rmSync(ROOT, { recursive: true, force: true });
      emit({ installed: false, removed: true, root: ROOT });
      process.exit(0);
    } catch (e) {
      emit({ installed: true, removed: false, error: String(e.message) });
      process.exit(1);
    }
  }

  if (!NODE) {
    emit({ installed: false, error: "找不到应用自带的 node（tools/node）。⛔ 不使用系统 Node —— ABI 可能与运行时不一致", root: ROOT });
    process.exit(1);
  }
  const nodeExe = NODE;
  const abi = process.versions.modules;

  if (doVerify) {
    const r = await verifySync(nodeExe);
    emit({ ...r, node: nodeExe, abi });
    process.exit(r.verified ? 0 : 1);
  }

  const before = status();
  if (before.installed && !doForce) {
    // 已装：顺手确保原生绑定在（老安装可能缺），再握手确认
    const nat = await ensureNativeBinding();
    const v = await verifySync(nodeExe);
    if (v.verified) {
      emit({ ...v, node: nodeExe, abi, skipped: true, native: nat });
      process.exit(0);
    }
    log(`已装但握手失败（${v.error}）⇒ 尝试修复安装`);
  }

  fs.mkdirSync(ROOT, { recursive: true });
  const manifestPath = path.join(ROOT, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({
      name: "codex-harness-memory-mcp",
      private: true,
      version: "1.0.0",
      description: "可选安装：@vheins/local-memory-mcp（MCP 记忆服务），由 Codex Harness Desktop 按需装入",
    }, null, 2) + "\n");
  }

  /* ⛔ 显式 --ignore-scripts：postinstall 会派生子进程（prebuild-install / esbuild install.js），
     受限环境必挂。跳过它们之后，我们**自己**把 better-sqlite3 的 .node 补上（见 ensureNativeBinding）。 */
  const npmArgs = [NPM_CLI, "install", "@vheins/local-memory-mcp@latest", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"];
  log(`安装到 ${ROOT}`);
  log(`${nodeExe} ${npmArgs.join(" ")}`);
  const r = await runNpmInstall(nodeExe, npmArgs);
  if (r.status !== 0) {
    const tail = String(r.out || "").concat(String(r.err || "")).split("\n").filter(Boolean).slice(-8).join("\n");
    log(`安装失败（status=${r.status}）：\n${tail}`);
    emit({
      installed: false,
      error: r.status === null ? `npm 进程起不来（环境限制或安全策略）：${String(r.err).slice(-200)}` : "npm install 失败（多数是网络：取不到 npm registry）",
      detail: tail.slice(0, 600),
      root: ROOT,
      abi,
      node: nodeExe,
    });
    process.exit(1);
  }

  const nat = await ensureNativeBinding();
  log(nat.ok ? `原生绑定就位（ABI ${abi}）` : `原生绑定缺失：${nat.error}`);

  const after = status();
  if (!after.installed) {
    emit({ installed: false, error: "安装后未找到服务入口", root: ROOT, expect: serverPath });
    process.exit(1);
  }

  const v = await verifySync(nodeExe);
  if (!v.verified) {
    emit({ ...v, node: nodeExe, abi, native: nat, error: v.error || "握手失败", hint: "服务装上了但起不来：看 detail（常见=原生绑定 ABI 不匹配 / 缺预编译包）" });
    process.exit(1);
  }
  log(`安装完成 v${after.version}，握手通过（ABI ${abi}）`);
  emit({ ...v, node: nodeExe, abi, native: nat, installedAt: new Date().toISOString() });
  process.exit(0);
}

main().catch((e) => {
  emit({ installed: false, error: String(e && e.message ? e.message : e), root: ROOT });
  process.exit(1);
});
