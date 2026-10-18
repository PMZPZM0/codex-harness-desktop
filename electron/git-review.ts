/**
 * Git 变更面板 · 纯判定（10-18 实修右栏「变更」四个范围）。
 *
 * 背景：右栏「全部分支更改」原先只是 `git diff HEAD`（工作区相对 HEAD），
 * 和「未暂存」显示的是同一类东西，分支上已经提交的改动根本看不到。
 * 这里把各范围的**参数语义**与错误文案抽成纯函数，主进程只负责跑 Git。
 */
export const GIT_BASE_CANDIDATES = ["origin/HEAD", "origin/main", "origin/master", "main", "master"] as const;

/** 普通 diff 的参数；head（全部分支更改）需要先找分支起点，返回 null。 */
export function diffArgsForScope(scope: string): string[] | null {
  if (scope === "staged") return ["diff", "--cached"];
  if (scope === "unstaged") return ["diff"];
  return null;
}

/** 把 Git 的失败翻成用户能照着做的话（code=null 表示根本没找到 Git）。 */
export function gitFailureMessage(code: number | null, output: string): string {
  if (code === null) {
    return "未找到 Git：请先在「设置 → 开发工具」安装 Git，或确认系统 PATH 里能执行 git 命令。";
  }
  const text = String(output ?? "");
  if (/not a git repository/i.test(text)) {
    return "当前工作区不是 Git 仓库：请在项目目录执行 git init，或先打开一个 Git 项目。";
  }
  if (/ambiguous argument 'HEAD'|unknown revision|bad revision/i.test(text)) {
    return "当前仓库还没有任何提交（HEAD 不存在）：先提交一次，或用「未暂存」查看工作区文件。";
  }
  if (code === 124) return `Git 命令超时：${text.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? "仓库过大或磁盘繁忙"}`;
  const first = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return first ? `Git 命令失败（code ${code}）：${first.slice(0, 300)}` : `Git 命令失败（code ${code}）`;
}

/** 分支起点 diff 的说明：没有基准分支时退回工作区 diff，必须告诉用户看的是什么。 */
export const NO_BRANCH_BASE_NOTE = "当前分支没有可比较的上游/基准分支，显示的是工作区相对 HEAD 的改动。";
