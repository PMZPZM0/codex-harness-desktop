// Codex 引擎一键升级脚本（升级口子，供后续频繁升级复用）。
//
// 用法：
//   node scripts/upgrade-codex-engine.cjs            # 升到 npm 最新稳定版
//   node scripts/upgrade-codex-engine.cjs 0.154.0    # 升到指定版本
//   node scripts/upgrade-codex-engine.cjs --verify-only  # 只跑探针验证，不改依赖
//
// 流程：确定目标版本（拒绝 alpha/beta/rc，除非 --force）→ 改 package.json →
// npm install → 校验平台包与二进制 → 独立 CODEX_HOME 起真实 app-server 跑
// 兼容探针（生产同款 config：重试键 + model_providers；RPC：initialize/
// collaborationMode/list/thread/list/config/read）。任一步失败给出回滚指引。
//
// 提示：safe-delete shim 可能拦 rmSync 清理，跑前可设 CODEBUDDY_SAFE_DELETE_ENABLED=0。
const { spawn, execSync } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PKG_JSON = path.join(ROOT, "package.json");

function walkDir(dir, ext, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(full, ext, cb);
    else if (ent.name.endsWith(ext)) cb(full);
  }
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  console.error("   回滚：git checkout package.json package-lock.json && npm install");
  process.exit(1);
}

function readInstalledVersion() {
  try {
    const p = require.resolve("@openai/codex-win32-x64/package.json", { paths: [ROOT] });
    return JSON.parse(fs.readFileSync(p, "utf8")).version.replace(/-win32-x64$/, "");
  } catch {
    return null;
  }
}

function latestStable() {
  const out = execSync("npm view @openai/codex dist-tags.latest", { encoding: "utf8" }).trim();
  return out;
}

function setDependency(version) {
  const raw = fs.readFileSync(PKG_JSON, "utf8");
  const re = /("@openai\/codex":\s*")[^"]+(")/;
  if (!re.test(raw)) fail('package.json 里找不到 "@openai/codex" 依赖行');
  fs.writeFileSync(PKG_JSON, raw.replace(re, `$1^${version}$2`));
  console.log(`  ✓ package.json 依赖改为 ^${version}`);
}

function npmInstall() {
  console.log("  … npm install（约 30s）");
  execSync("npm install --no-audit --no-fund", { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
}

function verifyBinary() {
  const dir = path.join(ROOT, "node_modules", "@openai", "codex-win32-x64");
  const bin = path.join(dir, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  if (!fs.existsSync(bin)) fail(`二进制不存在：${bin}`);
  const out = execSync(`"${bin}" --version`, { encoding: "utf8" }).trim();
  console.log(`  ✓ 引擎二进制：${out}`);
  return bin;
}

// ── 兼容探针：独立 CODEX_HOME 起真实 app-server ──
function probe(bin) {
  const home = path.join(process.env.TEMP || ROOT, `codex-upgrade-probe-${Date.now()}`);
  fs.mkdirSync(home, { recursive: true });
  // 生产同款 config：harness 会写入的键全带上，引擎若 deny 掉任何一键这里就会炸
  fs.writeFileSync(path.join(home, "config.toml"), [
    `model = "gpt-5-codex"`,
    `model_provider = "harness-probe"`,
    "",
    `[model_providers.harness-probe]`,
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    `request_max_retries = 10`,
    `stream_max_retries = 10`,
    `stream_idle_timeout_ms = 600000`,
  ].join("\n"));

  const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
  });
  let nextId = 1;
  const pending = new Map();
  let stderrBuf = "";
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  });
  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
  const request = (method, params, timeoutMs = 10000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " 超时")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return (async () => {
    const checks = [];
    try {
      await request("initialize", {
        clientInfo: { name: "codex_harness_desktop", title: "Codex Harness Desktop", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
      await sleep(600);
      checks.push(["initialize 握手（experimentalApi）", true, ""]);

      // collaborationMode/list：/plan 模式依赖
      try {
        const cm = await request("collaborationMode/list", {});
        const modes = Array.isArray(cm) ? cm.length : (cm?.modes?.length ?? "?");
        checks.push(["collaborationMode/list", true, `${modes} 个模式`]);
      } catch (e) { checks.push(["collaborationMode/list", false, e.message]); }

      // thread/list：看门狗心跳依赖
      try {
        const tl = await request("thread/list", { pageSize: 1 });
        checks.push(["thread/list", true, typeof tl?.data?.length === "number" ? `${tl.data.length} 条` : "ok"]);
      } catch (e) { checks.push(["thread/list", false, e.message]); }

      // config/read：确认重试键真的被解析进 modelProviders
      try {
        const v = await request("config/read", {});
        const src = v && typeof v === "object" ? (v.config ?? v) : null;
        const prov = src?.modelProviders?.["harness-probe"] ?? src?.model_providers?.["harness-probe"];
        const ok = prov && prov.request_max_retries === 10 && prov.stream_idle_timeout_ms === 600000;
        checks.push(["config/read 重试键回读", Boolean(ok), ok ? "request_max_retries=10, stream_idle_timeout_ms=600000" : JSON.stringify(prov).slice(0, 200)]);
      } catch (e) { checks.push(["config/read 重试键回读", false, e.message]); }

      // 方法表全量 diff：故意调不存在的方法，引擎报错会列出全部合法方法名；
      // 与 electron/ + src/ 里 harness 实际调用的方法做 diff，缺一个都不行。
      let engineMethods = [];
      try {
        await request("__probe/nonexistent__", {});
      } catch (e) {
        const idx = String(e.message).indexOf("expected one of");
        if (idx >= 0) {
          engineMethods = String(e.message).slice(idx + "expected one of".length)
            .split(",").map((s) => s.trim().replace(/`/g, "")).filter(Boolean);
        }
      }
      if (!engineMethods.length) {
        checks.push(["方法表 diff", false, "拿不到引擎方法表（报错格式变了？手动核对）"]);
      } else {
        const used = new Set();
        for (const dir of ["electron", "src"]) {
          for (const ext of [".ts", ".tsx"]) {
            walkDir(path.join(ROOT, dir), ext, (file) => {
              const text = fs.readFileSync(file, "utf8");
              const re = /(?:request|codex\.request)\(\s*"([a-zA-Z]+(?:\/[a-zA-Z]+)+)"/g;
              let mm; while ((mm = re.exec(text))) used.add(mm[1]);
            });
          }
        }
        const missing = [...used].filter((x) => !engineMethods.includes(x));
        checks.push([
          `方法表 diff（harness 用 ${used.size} 个）`, missing.length === 0,
          missing.length ? `引擎缺失: ${missing.join(", ")}` : "全部存在",
        ]);
      }
      return checks;
    } catch (e) {
      checks.push(["initialize 握手", false, e.message + (stderrBuf ? ` | stderr: ${stderrBuf.slice(0, 200)}` : "")]);
      return checks;
    } finally {
      child.kill();
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { console.warn(`  ! 探针临时目录未清掉（可手删）：${home}`); }
    }
  })();
}

(async () => {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify-only");
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("--"));
  const current = readInstalledVersion();

  console.log(`当前引擎版本：${current ?? "未知"}\n`);

  let version = target;
  if (!verifyOnly) {
    if (!version) {
      version = latestStable();
      console.log(`npm 最新稳定版：${version}`);
    }
    if (!force && /(alpha|beta|rc)/.test(version)) fail(`${version} 是预发布版，确认要上就加 --force`);
    if (version === current) {
      console.log("已是该版本，无需升级（要强制重装可先删 node_modules/@openai/codex*）");
      process.exit(0);
    }
    console.log(`\n[1/4] 升级依赖 → ${version}`);
    setDependency(version);
    console.log("\n[2/4] 安装");
    try { npmInstall(); } catch (e) { fail("npm install 失败：" + e.message); }
  } else {
    console.log("--verify-only：跳过依赖改动，只跑探针\n");
  }

  console.log("\n[3/4] 校验二进制");
  const bin = verifyBinary();

  console.log("\n[4/4] 兼容探针（独立 CODEX_HOME，生产同款 config）");
  const checks = await probe(bin);
  let allOk = true;
  for (const [name, ok, detail] of checks) {
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  }
  const installed = readInstalledVersion();
  console.log(`\n引擎：${installed}${allOk ? "，全部探针通过 ✅" : "，存在不兼容项 ❌"}`);
  if (!allOk) {
    if (!verifyOnly) fail("探针未全通过，不要上线该版本");
    process.exit(1);
  }
  process.exit(0);
})();
