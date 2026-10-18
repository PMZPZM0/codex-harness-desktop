/**
 * 右栏「变更」四个范围判据（10-18 实修）
 *
 * 用户截图框住右栏：未暂存 / 已暂存 / 全部分支更改 / 上一轮更改，问「是不是真实的」。
 * 实测结论：
 *   · 未暂存 / 已暂存 = 真 Git diff；
 *   · 上一轮更改 = 真回合 diff（不走 Git）；
 *   · **全部分支更改名不副实**：旧实现是 `git diff HEAD`，和未暂存显示的是同一类东西，
 *     分支上已提交的改动看不到 ⇒ 本轮改为「上游/主分支 merge-base → diff」；
 *   · Git 缺失时只有死文案，没有安装入口 ⇒ 本轮加「一键安装 Git」与可见错误。
 *
 * 失效方式：范围参数退回旧三元 / 分支起点用错 / 错误又静默成空列表 / 安装按钮没接 runtime:install。
 * 行为由验收 `git-review` 真跑（临时仓库的已提交改动 + 工作区改动）覆盖。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【git-review】${message}`);
  if (!condition) fails++;
};

/* ── 一、纯函数：范围参数 / 错误文案 / 基准分支候选 ───────────────────────── */
const { GIT_BASE_CANDIDATES, NO_BRANCH_BASE_NOTE, diffArgsForScope, gitFailureMessage } = await import("../../electron/git-review.ts");
{
  const unstaged = diffArgsForScope("unstaged");
  const staged = diffArgsForScope("staged");
  ok(JSON.stringify(unstaged) === JSON.stringify(["diff"]), "未暂存 = git diff");
  ok(JSON.stringify(staged) === JSON.stringify(["diff", "--cached"]), "已暂存 = git diff --cached");
  ok(diffArgsForScope("head") === null && diffArgsForScope("last") === null, "head（分支起点）/ last（回合 diff）不走普通 diff 参数");
  ok(GIT_BASE_CANDIDATES.includes("origin/HEAD") && GIT_BASE_CANDIDATES.includes("main") && GIT_BASE_CANDIDATES.includes("master"),
    "分支起点候选：上游 → origin/HEAD → main → master");
  ok(typeof NO_BRANCH_BASE_NOTE === "string" && NO_BRANCH_BASE_NOTE.includes("没有可比较"), "找不到基准分支时有明确说明（不静默）");

  ok(gitFailureMessage(null, "").includes("未找到 Git"), "找不到 Git ⇒ 指向「设置 → 开发工具」安装");
  ok(gitFailureMessage(128, "fatal: not a git repository (or any of the parent directories): .git").includes("不是 Git 仓库"),
    "不是 Git 仓库 ⇒ 明确说明（不是「没有改动」）");
  ok(gitFailureMessage(128, "fatal: ambiguous argument 'HEAD': unknown revision").includes("还没有任何提交"),
    "空仓库（无 HEAD）⇒ 明确说明");
  ok(gitFailureMessage(124, "partial output").includes("超时"), "超时 ⇒ 明确说明");
  ok(gitFailureMessage(1, "fatal: something broke").includes("something broke"), "其它失败 ⇒ 带第一行原因");
}

/* ── 二、主进程：分支起点 / 可信根 / 错误返回 ─────────────────────────────── */
const gitIpc = codeOnly(read("electron/features/git-ipc.ts"));
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registry = read("electron/ipc-registry.ts");
const review = codeOnly(read("src/features/storage-settings/StorageSettings.tsx"));
{
  ok(gitIpc.includes('scope === "head"') && gitIpc.includes("findBranchBase") && gitIpc.includes("merge-base"),
    "head 走「找分支起点 → merge-base → diff」（不再只是 git diff HEAD）");
  ok(gitIpc.includes("@{upstream}") && gitIpc.includes("GIT_BASE_CANDIDATES") && gitIpc.includes("rev-parse"),
    "先查 @{upstream}，再按候选表找基准分支");
  ok(gitIpc.includes('runGit(cwd, ["diff", mb])') && gitIpc.includes("NO_BRANCH_BASE_NOTE"),
    "分支起点 diff 覆盖已提交 + 工作区；无基准时退回 HEAD 并带说明");
  ok(gitIpc.includes("isInsideOrEqualTrustedRoots") && gitIpc.includes("拒绝读取 Git 变更"),
    "cwd 必须落在可信工作区（渲染层传任意目录读不了 Git）");
  ok(gitIpc.includes('reject(new Error(gitFailureMessage(null') && gitIpc.includes("error:"),
    "Git 缺失会 reject（渲染层进入安装分支）；非零退出把原因放进 error");
  const entry = (manifest.channels ?? manifest).find((channel) => channel.channel === "git:diff");
  ok(!!entry && String(entry.returns).includes("error?: string"), "manifest 的 git:diff 返回面带 error");
  ok(registry.includes('"git:diff"'), "registry 仍登记 git:diff");
}

/* ── 三、渲染层：四个范围真交互 + 安装入口 ───────────────────────────────── */
{
  ok(review.includes("reviewScopes") && review.includes("全部分支更改") && review.includes("上一轮更改"),
    "四个范围都在（未暂存 / 已暂存 / 全部分支更改 / 上一轮更改）");
  ok(review.includes("reviewScopeHints") && review.includes("merge-base") && review.includes("回合记录"),
    "每个范围都有真实语义提示（分支起点 / 回合 diff，不是空标签）");
  ok(review.includes("setGitError(result.error") && review.includes("git-note"),
    "非零退出 / 无基准分支的原因在面板里可见（不再只是「没有改动」）");
  ok(review.includes("installRuntime(\"git\")") && review.includes("一键安装 Git") && review.includes("gitMissing"),
    "Git 缺失时有一键安装按钮（接 runtime:install，装完自动刷新）");
  ok(review.includes("上一轮改动") && review.includes("lastDiff"),
    "上一轮更改用 lastDiff（回合记录），不经过 Git");
}

/* ── 四、IPC 参数前置校验：minArgs 不许超过真正传过去的参数个数 ───────────────
   10-18 实测事故：manifest 里 `paramsImpl` 是「调用方签名」（cwd, scope 两个参数），但
   `invokeArgs` 把它们打包成**一个对象** ⇒ 生成器旧算法按参数个数算 minArgs ⇒ 12 条这种形态的
   通道（git:diff / fs:write / ssh:* / connectors:set-enabled …）每次调用都被 `__ipc` 拒成
   ERR_MISSING_ARGS，界面上是「读了但永远是空的」。这里钉住生成物的**真实参数个数**。 */
{
  const preload = read("electron/preload.ts");
  const lines = [...preload.matchAll(/__ipc\("([^"]+)", (\d+), \[(.*?)\]\)/g)];
  ok(lines.length > 300, `preload 生成段解析出 ${lines.length} 条 __ipc 调用（样本够大，断言不是恒真）`);
  const topLevel = (s) => {
    let depth = 0, count = 0;
    const text = s.trim();
    if (!text) return 0;
    count = 1;
    for (const ch of text) {
      if ("([{<".includes(ch)) depth++;
      else if (")]}>".includes(ch)) depth--;
      else if (ch === "," && depth === 0) count++;
    }
    return count;
  };
  const bad = lines.filter(([, , minArgs, args]) => Number(minArgs) > topLevel(args));
  ok(bad.length === 0, `没有「minArgs > 实传参数个数」的通道（违规：${bad.map(([, ch, n, a]) => `${ch}(${n}>${topLevel(a)})`).join("、") || "无"}）`);
  ok(/gitDiff: \(cwd: string, scope: string\) => __ipc\("git:diff", 1, \[\{ cwd, scope \}\]\)/.test(preload),
    "git:diff 的 minArgs = 1（单对象实参；写成 2 会让右栏「变更」永远报缺参）");
}

console.log(`\n【git-review】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
