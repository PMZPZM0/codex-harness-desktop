---
id: 2026-10-26-milestone-v0048-发版指挥中枢自己拉人派活-mac-适配两处真缺口
date: 2026-10-26
kind: milestone
area: release
title: v0.0.48 发版：指挥中枢自己拉人派活 + mac 适配两处真缺口
tags: [release, v0.0.48, mac, boss]
commits: [6064acb20, d3ea91fca]
files: [docs/releases/v0.0.48.md, electron/whats-new-notes.ts]
importance: high
---

# v0.0.48 发版：指挥中枢自己拉人派活 + mac 适配两处真缺口

# v0.0.48 发版（10-26）

## 范围

`v0.0.47..HEAD` = **296 个提交**（94 fix / 83 feat / 78 docs / 11 test）。主题：指挥中枢（创世 boss 群）
从「能派活」走到「能自己拉人、验收、出成品」，并把它从假群聊界面改回真正的会话；语音悬浮球换脸、
语音合成引擎可选、新人引导。

## 流程与判据

| 步骤 | 结果 |
|---|---|
| mac 适配审计（`mac-audit.mjs v0.0.47 HEAD`） | 50 条命中（exe 3 / win32 6 / ctrl-key 26 / backslash 15），darwin/winpath/powershell/appdata 全 0；**2 处真缺口已修** |
| 版本对齐 4 处 | package.json 0.0.48 / lock ×2 / whats-new / `docs/releases/v0.0.48.md` |
| `npm run check` | **13 项红 → 0**（详见下） |
| 三仓同步 | 主仓 `6064acb20` · PPcode `6892cb07` · 云助手 `c87cd7a3`（已部署） |
| 三仓重建产物 | 主仓 ✓ / PPcode ✓ / 云助手 ✓ + deploy 哈希校验一致 |
| tag | `v0.0.48`（轻量）已推，CI 三端构建 |

## mac 两处真缺口

1. `NewProjectDialog`「粘贴路径」只认 `C:\` 盘符 ⇒ mac 粘贴 `/Users/…` 被判"不是绝对路径"，新建项目走不通。
   改跨平台绝对路径判定（盘符 / UNC / `/` 开头）。
2. 知识库设置页路径写死 `\.codex-harness\knowledge` ⇒ mac 显示 `/a\b\c`。改按平台取分隔符。

## 顺手修的第三个「品牌串号」

三个机器人网关（telegram / dingtalk / wecom-webhook）凭据落点写死
`AppData\Roaming\Codex Harness Desktop` 且模块顶层求值：
- mac 上该路径不存在（应为 `~/Library/Application Support/`）；
- PPcode 的 userData 是 `%APPDATA%\PPcode` ⇒ 读写到**另一个应用**的数据。
改惰性 `app.getPath("userData")`（env 优先，测试隔离用）。

## check 13 项红 → 0（全部是断言指向已改实现或已删对象）

| 守卫 | 性质 | 处理 |
|---|---|---|
| 11d 办公室轨道 | 新增中枢会话分支 | 两支都钉（`bossGroupId` / 普通会话） |
| 11v ④c 分类视图 | 10-25 撤下 | `Layers` → `ListChecks` |
| 11v ⑤ app-lock 色相 | **代码错**（red 不在六色板） | 改 `amber` |
| 12ad / 12o 验收登记 | 指向被「验收脚本收敛为 3 项」删除的对象 | 去掉空断言（留痕说明） |
| 12q 云端目录行 | 实现收敛更严格 | 断言精确化 |
| 12h 静默下载 | 一刀切禁 `input.` 与差分 `input.mode` 冲突 | 收紧为「禁地址/路径/哈希字段」，P0 意图保留 |
| 03 scrollHeight | 群面板 feed 是内部滚动容器 | 放行 `feedRef`（与 contentRef/bodyRef 同口径） |
| 06 180×4 | 侧栏改版（新建任务/指挥中枢/拓展功能；搜索移视图行） | 跟随并保留「搜索靠后」意图 |
| 06 232 | 应用锁包了 `AppLockGate` | 跟随 |
| 06 154 | 办公室分间改 Map | 跟随 |
| 03 152 | 启动 userData 先算变量 | 跟随 |
| 09 棘轮 | 守卫自身变长 | 按实测更新 5 个基线 |
| 93 bag-types | 5 个字段漏登记 + setViewTab 三值 | 补齐 |

## 三仓同步的坑（本轮实证）

- `09-structural.mjs` 的行数棘轮**按各仓实测**，不能整份拷 ⇒ 守卫脚本本身不同步（各仓版本本就不同：
  守卫 22 主仓 204 / 副本 202）。
- 副本版本线更早：PPcode/云助手**没有** `setUpdateMode` 与 shell 窗口按钮通道 ⇒ 对应改动不适用，
  不能盲拷（会出现「补了没用的字段」或「改了不存在的代码」）。
- `logs/index.jsonl` 各仓条目数不同 ⇒ 只拷条目，各仓自己 `reindex`。
