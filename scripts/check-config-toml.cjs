/**
 * config.toml 拆分/重建的回归测试。
 *
 * 为什么需要它：harness 每次保存模型、个性化、MCP 启停都会整份重写 config.toml。
 * 一个字节写错引擎就起不来，而这类错误在界面上只表现为「没生效」，很难定位。
 * 这里直接喂真实的配置文件（默认取应用 userData 里的那份），跑完必须仍是合法 TOML。
 *
 * 用法：node scripts/check-config-toml.cjs [config.toml 路径]
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  collectMcpServerNames,
  extractMcpSection,
  preserveUserConfig,
} = require("../dist-electron/config-toml.js");

const defaultPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Codex Harness Desktop",
  "codex-home",
  "config.toml",
);
const target = process.argv[2] || defaultPath;
let raw;
try {
  raw = fs.readFileSync(target, "utf8");
} catch (error) {
  console.log(`跳过：读不到 ${target}（${error.code ?? error.message}）`);
  process.exit(0);
}

const failures = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

// 用 python 的 tomllib 做权威校验：regex 拆分过的文本到底还是不是合法 TOML。
// 找不到 python 时降级为只跑正则断言——宁可少查一项，也不要检查不起来。
let PYTHON = null;
function findPython() {
  if (PYTHON !== null) return PYTHON;
  const candidates = [
    process.env.HARNESS_PY,
    "python",
    "python3",
    path.join(os.homedir(), ".workbuddy/binaries/python/versions/3.13.12/python.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["-c", "import tomllib"], { stdio: "ignore" });
      PYTHON = candidate;
      return PYTHON;
    } catch { /* 换下一个候选 */ }
  }
  PYTHON = false;
  return PYTHON;
}

function tomlValid(text) {
  const python = findPython();
  if (!python) return { ok: true, keys: "(未找到 python，跳过 TOML 解析校验)" };
  const tmp = path.join(os.tmpdir(), `harness-toml-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
  fs.writeFileSync(tmp, text);
  try {
    const out = execFileSync(python, [
      "-c",
      "import tomllib,sys;d=tomllib.load(open(sys.argv[1],'rb'));print(sorted(d.keys()))",
      tmp,
    ], { encoding: "utf8" });
    return { ok: true, keys: out.trim() };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message).split("\n").slice(-3).join(" ") };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 忽略清理失败 */ }
  }
}

console.log(`目标：${target}（${raw.length} 字符）\n`);

// 1. 原始文件本身必须合法，否则后面的比对没有基准
const base = tomlValid(raw);
check("原始 config.toml 是合法 TOML", base.ok, base.ok ? `顶层键 ${base.keys}` : base.error);

// 2. preserveUserConfig 的输出必须仍可解析（它是拼回新配置的尾部）
const kept = preserveUserConfig(raw);
const keptCheck = tomlValid(kept);
check("preserveUserConfig 输出是合法 TOML", keptCheck.ok, keptCheck.ok ? "" : keptCheck.error);

// 3. harness 拥有的段落不能出现在 preserved 里，否则重写时会重复表头导致解析失败
for (const section of ["model_providers", "windows", "tools", "sandbox_workspace_write", "features", "mcp_servers"]) {
  check(`preserved 里没有 [${section}]`, !new RegExp(`^\\s*\\[${section}[.\\]]`, "m").test(kept));
}
check("preserved 里没有 harness 重新生成的顶层键", !/^\s*(model|model_context_window|model_provider|developer_instructions)\s*=/m.test(kept));

// 4. 用户自己管的段落必须留下（插件注册被抹掉是历史上真出过的事故）
const userSections = ["projects", "marketplaces", "plugins", "hooks"];
const lostUserSection = userSections.filter((name) => new RegExp(`^\\s*\\[${name}[.\\]]`, "m").test(raw) && !new RegExp(`^\\s*\\[${name}[.\\]]`, "m").test(kept));
check("用户段落（projects/marketplaces/plugins/hooks）全部保留", lostUserSection.length === 0, lostUserSection.length ? `丢了 ${lostUserSection.join("、")}` : "");

// 5. MCP 段抽取：每个 [mcp_servers.X] 都要能完整抠出来，且自身是合法 TOML
const names = collectMcpServerNames(raw);
check("识别到 MCP 服务器", names.length > 0, names.length ? names.join("、") : "这份配置里没有 MCP 段（属正常）");
for (const name of names) {
  const section = extractMcpSection(raw, name);
  const single = tomlValid(section);
  check(`抽取 [mcp_servers.${name}]`, Boolean(section.trim()) && single.ok, single.ok ? "" : single.error);
}

// 6. 模拟一次完整重建：harness 头部 + preserved + 全部启用的 MCP 段
const rebuilt = [
  'model = "test-model"',
  "model_context_window = 1000",
  'model_provider = "custom"',
  'developer_instructions = """hello"""',
  "",
  ...names.flatMap((name) => [extractMcpSection(raw, name), ""]),
  "",
  "[tools]",
  "web_search = true",
  "",
  ...(kept ? [kept, ""] : []),
].join("\n");
const rebuiltCheck = tomlValid(rebuilt);
check("重建后的完整 config.toml 是合法 TOML", rebuiltCheck.ok, rebuiltCheck.ok ? `顶层键 ${rebuiltCheck.keys}` : rebuiltCheck.error);

// 7. 停用内置 MCP 后重建（覆盖表生效路径）
const withoutNuphus = rebuilt
  .split("\n")
  .filter((line, index, all) => {
    if (!/^\s*\[mcp_servers\.nuphus\]/.test(line)) return true;
    for (let i = index + 1; i < all.length; i += 1) if (/^\s*\[/.test(all[i])) return false;
    return false;
  })
  .join("\n");
const offCheck = tomlValid(withoutNuphus);
check("停用 nuphus 后仍是合法 TOML", offCheck.ok, offCheck.ok ? "" : offCheck.error);
if (names.includes("nuphus")) {
  check("停用后确实没有 nuphus 段", !/^\s*\[mcp_servers\.nuphus\]/m.test(withoutNuphus));
}

console.log("");
if (failures.length) {
  console.log(`${failures.length} 项失败：`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("config.toml 拆分/重建全部通过");
