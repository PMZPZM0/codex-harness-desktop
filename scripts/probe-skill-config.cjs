// 引擎 SkillConfig / skills/config/write 探针：验证技能级配置模型。
//
// 背景：WorkBuddy 的 SKILL.md 有 allowed-tools（白名单），我们想复刻到 Codex Harness。
// 引擎二进制有 SkillConfig(3 elements) 与 skills/config/write RPC，但不确定支持哪些字段。
// 本探针起真实 app-server，先 skills/list 看技能对象结构，再逐候选字段 skills/config/write，
// 用错误信息反推出引擎接受的字段名。
//
// 跑法：node scripts/probe-skill-config.cjs
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const home = `D:/tmp-codex-skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
fs.mkdirSync(home, { recursive: true });
// 造一个最小技能目录，让 skills/list 有东西可看
const skillDir = path.join(home, "skills", "probe-skill");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
  "---",
  "name: probe-skill",
  "description: 探针技能，验证技能级配置模型",
  "---",
  "",
  "遇到问题时用这个技能",
].join("\n"));
const cfg = [
  `model = "gpt-5-codex"`,
  `model_provider = "harness-probe"`,
  "",
  `[model_providers.harness-probe]`,
  `name = "harness-probe"`,
  `base_url = "http://127.0.0.1:1"`,
  `env_key = "CODEX_HARNESS_API_KEY"`,
  `wire_api = "responses"`,
  "requires_openai_auth = false",
].join("\n");
fs.writeFileSync(path.join(home, "config.toml"), cfg);

const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
});

let nextId = 1;
const pending = new Map();
let stderrBuf = "";
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const entry = pending.get(msg.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(msg.id);
  msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
});
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
const request = (method, params, timeoutMs = 6000) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryConfigWrite(label, params) {
  try {
    const v = await request("skills/config/write", params, 6000);
    console.log(`  ✅ ${label.padEnd(34)} → ${JSON.stringify(v).slice(0, 200)}`);
  } catch (e) {
    const msg = e.message;
    console.log(`  ❌ ${label.padEnd(34)} → ${msg.slice(0, 180)}`);
  }
}

(async () => {
  try {
    await request("initialize", { clientInfo: { name: "codex_harness_desktop", title: "probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    await sleep(800);

    console.log("=== skills/list 返回的技能对象结构 ===");
    try {
      const v = await request("skills/list", { cwds: [home], forceReload: true }, 8000);
      const skills = (v.data ?? []).flatMap((entry) => entry.skills ?? []);
      console.log(JSON.stringify(skills, null, 2).slice(0, 1200));
    } catch (e) { console.log("  skills/list 失败:", e.message); }

    console.log("\n=== skills/config/write 候选字段（用错误信息反推） ===");
    await tryConfigWrite("path 定位", { path: skillDir, enabled: true });
    await tryConfigWrite("name 定位", { name: "probe-skill", enabled: true });
    await tryConfigWrite("approval_mode", { name: "probe-skill", approval_mode: "ask" });
    await tryConfigWrite("approval_policy", { name: "probe-skill", approval_policy: "on-request" });
    await tryConfigWrite("allowed_tools", { name: "probe-skill", allowed_tools: ["Bash"] });
    await tryConfigWrite("disabled_tools", { name: "probe-skill", disabled_tools: ["Bash"] });
    await tryConfigWrite("enabled_tools", { name: "probe-skill", enabled_tools: ["Bash"] });
    await tryConfigWrite("include_instructions", { name: "probe-skill", include_instructions: true });
    await tryConfigWrite("empty object", {});

    console.log("\n=== 带 enabled 一起传，看是否有未知字段被拒绝 ===");
    await tryConfigWrite("enabled + approval_mode", { name: "probe-skill", enabled: true, approval_mode: "ask" });
    await tryConfigWrite("enabled + allowed_tools", { name: "probe-skill", enabled: true, allowed_tools: ["Bash"] });
    await tryConfigWrite("enabled + disabled_tools", { name: "probe-skill", enabled: true, disabled_tools: ["Bash"] });
    await tryConfigWrite("enabled + include_instructions", { name: "probe-skill", enabled: true, include_instructions: false });
    await tryConfigWrite("enabled 只读字段", { name: "probe-skill", enabled: true });
    await tryConfigWrite("enabled=false 停用", { name: "probe-skill", enabled: false });

    console.log("\n=== skills/list（config/write 之后，看是否出现字段） ===");
    try {
      const v = await request("skills/list", { cwds: [home], forceReload: true }, 8000);
      const skills = (v.data ?? []).flatMap((entry) => entry.skills ?? []);
      const skill = skills.find((s) => (s.name || s.path || "").includes("probe"));
      console.log(JSON.stringify(skill, null, 2).slice(0, 800));
    } catch (e) { console.log("  skills/list 失败:", e.message); }
  } catch (e) {
    console.log("顶层异常:", e.message);
  } finally {
    child.kill();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 引擎未完全退出 */ }
  }
  process.exit(0);
})();
