/**
 * 回合文件追踪诊断（10-07）。
 *
 * 背景：用户实测「mac 上消息汇总下面的已编辑文件不展示」——链路（回合开始记快照 → 收尾算差异 →
 * 广播 → 渲染层画卡）两侧**全平台同构、无平台分支**，断点只可能落在若干个**静默跳过点**之一，
 * 而打包版 mac 应用的控制台输出不可见（Finder 启动 → stdout 丢弃）⇒ console.warn 收集不到。
 * 这里把追踪链的关键事实**落盘**到 <userData>/turn-files-diag.log（JSON 行）：
 *   · 快照跳过（空 id / cwd 不在磁盘 / 回合 id 缺失）—— 记原因与具体值；
 *   · 遍历根目录失败（mac TCC 权限 EPERM/EACCES 的实锤点）—— 记 errno 与路径；
 *   · 快照为空 / 收尾时无快照 / 每次收尾报告心跳（files 数就是「链路跑没跑」的证据）。
 * mac 上复现一次后把该文件发回即可定位断点。
 *
 * ⛔ 与 memory-capture-debug 同款纪律：写日志本身失败绝不影响主流程；单文件上限 512KB 超出清空重写。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 512 * 1024;

export function debugTurnFiles(entry: Record<string, unknown>) {
  try {
    const file = path.join(app.getPath("userData"), "turn-files-diag.log");
    try { if (fs.statSync(file).size > MAX_BYTES) fs.writeFileSync(file, "", "utf8"); } catch { /* 文件不存在：继续追加 */ }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch { /* 诊断失败不影响主流程 */ }
}
