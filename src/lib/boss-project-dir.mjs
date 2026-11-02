/**
 * 「指挥中枢」自动新建项目目录的候选根（纯函数，node 可直接 import 跑真值表）。
 *
 * 10-25 用户令：自动在「软件安装的对应盘」建项目目录。
 * ⛔ 11-02 mac 实测截图：`ENOENT: mkdir '/指挥中枢项目-…'` —— mac 没有盘符，
 *    `path.parse(execPath).root` 恒为 `/`，而根目录只读 ⇒ 必然失败。
 *    ⇒ mac / linux 改为「文稿」优先、用户目录兜底（不碰 .app 内部）。
 * ⛔ 按**目标平台**选 path.win32 / path.posix，而不是宿主平台 —— 否则纯函数
 *    在 Windows 上测 mac 分支会得到反斜杠路径（假红）。
 */

import path from "node:path";

/**
 * @param {{ platform: string, execPath?: string, home?: string }} input
 * @returns {string[]} 按顺序尝试的根目录（不存在/不可写的由调用方 catch 后试下一个）
 */
export function bossProjectRoots({ platform, execPath, home }) {
  if (platform === "win32") {
    const base = path.win32.dirname(String(execPath || ""));
    const root = path.win32.parse(base).root || base;
    return root ? [root] : [];
  }
  const userHome = String(home || "");
  if (!userHome) return [];
  const p = path.posix;
  return [p.join(userHome, "Documents"), userHome];
}
