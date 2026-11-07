/**
 * QwenPaw headless `tools=0` 修复（11-07 立，**选项 C：运行时包装器**）
 *
 * 背景：`qwenpaw task`（headless）把 `ctx.workspace` 置空 ⇒ `AgentBuilder._get_local_workspace()`
 * 返回 None ⇒ `build_toolkit()` 落到 `tools = []`，模型没有任何可调用工具（只会吐函数调用文本）。
 *
 * 为什么不是改 site-packages：qwenpaw 是 wheel 安装，`pip install -U qwenpaw` 会静默覆盖
 * `cli/task_cmd.py`，补丁消失、tools 又回 0，而且不报错。
 * 现方案：应用自己的 `tools/cli-shims/qwenpaw(.cmd)` 排在 `python\Scripts` 之前，
 * 由 `tools/harness-qwenpaw.py` 在**运行时**给 `AgentBuilder.build` 包一层：
 * 仅当 `ctx.workspace is None` 时按 `ctx.workspace_dir` 造 Workspace + bootstrap_plugins。
 * 上游以后自己修了这条路径 ⇒ `ctx.workspace` 非空 ⇒ 包装器自动让路。
 *
 * 失效方式全是静默的（所以逐条钉）：
 *   · 垫片没排到 `python\Scripts` 之前 ⇒ 真 `qwenpaw.exe` 先命中，tools=0 原样复发；
 *   · 检测也带上垫片 ⇒ 没装 qwenpaw 的机器被判成「已安装」（面板与 @ 名单全错）；
 *   · 包装器把异常吞掉却不放行 ⇒ qwenpaw 整体起不来；
 *   · 包装器用 `tempfile.mkdtemp` 兜底 ⇒ 每个任务泄漏一个临时目录；
 *   · extraResources 漏登记 ⇒ 开发态好使、安装包里没有。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

let checks = 0;
let fails = 0;
let skips = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【qwenpaw-shim】${message}`);
  if (!condition) fails++;
};
const skip = (message) => {
  skips++;
  console.log(`  - 【qwenpaw-shim】${message}（跳过：本机未安装 qwenpaw）`);
};

/* ── 一、包装器本体 ─────────────────────────────────────────────────────── */
{
  ok(exists("resources/tools/harness-qwenpaw.py"), "包装器随包：resources/tools/harness-qwenpaw.py");
  /* ⛔ Python 的注释/docstring 不是 JS 注释，codeOnly 剥不掉 —— 这里按**调用形态**匹配，
     不按裸字面量（否则文档里写一句「不用 mkdtemp」就会把自己顶红）。 */
  const wrapper = read("resources/tools/harness-qwenpaw.py");
  ok(/AgentBuilder\.build/.test(wrapper) && /_harness_headless_workspace_patch/.test(wrapper),
    "在运行时包 AgentBuilder.build（带幂等标记，重复执行不会叠加）");
  ok(/getattr\(ctx, "workspace", None\) is None/.test(wrapper),
    "⛔ 只在 ctx.workspace 为空时补（上游修好后自动让路，不做第二份真相）");
  ok(/Workspace\(/.test(wrapper) && /bootstrap_plugins\(/.test(wrapper) && /build_bootstrap_kwargs\(\)/.test(wrapper),
    "补的是「真 Workspace + bootstrap_plugins」—— 只造空壳工具仍是 0");
  ok(!/tempfile\.mkdtemp\(/.test(wrapper),
    "⛔ 不用 mkdtemp 兜底（每个 headless 任务泄漏一个临时目录；改用 ~/.qwenpaw/workspaces/<agent>）");
  ok(/runpy\.run_module\("qwenpaw", run_name="__main__"\)/.test(wrapper),
    "补完照常执行 qwenpaw 入口（不接管参数解析）");
  ok(!/shutil|write_text|open\(/.test(wrapper),
    "⛔ 包装器不写任何文件（不碰 site-packages，升级覆盖不到它）");
  ok(/except Exception:/.test(wrapper),
    "包装器自身异常必须放行（宁可回到上游行为，也不能把 qwenpaw 弄坏）");
}

/* ── 二、PATH 垫片 ──────────────────────────────────────────────────────── */
{
  for (const name of ["qwenpaw.cmd", "qwenpaw", "copaw.cmd", "copaw"]) {
    ok(exists(`resources/tools/cli-shims/${name}`), `垫片存在：cli-shims/${name}`);
  }
  const winShim = read("resources/tools/cli-shims/qwenpaw.cmd");
  ok(/harness-qwenpaw\.py/.test(winShim) && /%TOOLS%\\python\\python\.exe/.test(winShim),
    "Windows 垫片：先用随包 Python 跑包装器");
  ok(/"python"\)/.test(winShim) && /-c "import qwenpaw"/.test(winShim) && /exit \/b 127/.test(winShim),
    "随包 Python 里没有 qwenpaw 时回落到 PATH 上的 python；都没有就 127（不静默假装成功）");
  const posixShim = read("resources/tools/cli-shims/qwenpaw");
  ok(/harness-qwenpaw\.py/.test(posixShim) && /\.\.\/python\/bin\/python3/.test(posixShim)
    && /python3/.test(posixShim) && /\bexec\b/.test(posixShim) && /exit 127/.test(posixShim),
    "POSIX 垫片：随包 python3 优先、PATH python3 兜底、exec 转发参数");
}

/* ── 三、接线：PATH 顺序 / 检测排除 / 打包 / check 链 ─────────────────────── */
{
  const toolchain = read("electron/toolchain.ts");
  ok(/includeShims/.test(toolchain) && /"cli-shims"/.test(toolchain),
    "augmentedPath 带上 cli-shims（默认带，可关）");
  const shimAt = toolchain.indexOf('"cli-shims"');
  const scriptsAt = toolchain.indexOf('"python\\\\Scripts"');
  ok(shimAt >= 0 && scriptsAt >= 0 && shimAt < scriptsAt,
    "⛔ 垫片目录必须排在 python\\Scripts 之前（否则真 qwenpaw.exe 先命中，修复不生效）");

  const agents = read("electron/cli-agents.ts");
  ok(/cliProcessEnv\(\{ includeShims: false \}\)/.test(agents),
    "⛔ 检测（locateBinary）排除垫片 —— 否则没装 qwenpaw 也被判「已安装」");

  const pkg = JSON.parse(read("package.json"));
  const resources = pkg.build?.extraResources ?? [];
  ok(resources.some((entry) => entry.from === "resources/tools/harness-qwenpaw.py" && entry.to === "tools/harness-qwenpaw.py"),
    "extraResources 登记包装器（安装包里也有）");
  ok(resources.some((entry) => entry.from === "resources/tools/cli-shims" && entry.to === "tools/cli-shims"),
    "extraResources 登记垫片目录");
  ok(String(pkg.scripts?.check ?? "").includes("12bh-qwenpaw-shim.mjs"),
    "package.json check 链已登记本守卫");

  const command = read("src/lib/cli-command.mjs");
  ok(/qwenpaw: 'qwenpaw task -i "\{prompt\}" --max-iters 20 -t 540'/.test(command),
    "命令模板保持 `qwenpaw task …`（修复走 PATH 垫片，不改模板、不改用户档案）");
}

/* ── 四、行为：包装器与垫片真跑 --version（不碰网络） ─────────────────────── */
{
  const win = process.platform === "win32";
  const python = win
    ? join(ROOT, "resources", "tools", "python", "python.exe")
    : join(ROOT, "resources", "tools", "python", "bin", "python3");
  const canImport = (() => {
    if (!existsSync(python)) return false;
    try {
      execFileSync(python, ["-c", "import qwenpaw"], { timeout: 30_000, stdio: "ignore" });
      return true;
    } catch { return false; }
  })();
  if (!canImport) {
    skip("包装器 --version");
    skip("垫片 --version");
  } else {
    const viaWrapper = execFileSync(python, [join(ROOT, "resources", "tools", "harness-qwenpaw.py"), "--version"], {
      timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    ok(/QwenPaw,\s*version\s*\d/.test(viaWrapper),
      "包装器转发 qwenpaw 入口（--version 正常输出版本）");
    if (win) {
      const shims = join(ROOT, "resources", "tools", "cli-shims");
      const viaShim = execFileSync("cmd", ["/c", "qwenpaw --version"], {
        timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${shims};${process.env.PATH ?? ""}` },
        windowsVerbatimArguments: true,
      });
      ok(/QwenPaw,\s*version\s*\d/.test(viaShim),
        "垫片经 cmd 真跑通（PATH 命中 cli-shims → 包装器 → qwenpaw）");
    } else {
      skip("垫片 --version（非 Windows 由 CI / 真机覆盖）");
    }
  }
}

console.log(`\n【qwenpaw-shim】${checks - fails}/${checks} 通过${skips ? `（跳过 ${skips} 项）` : ""}${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
