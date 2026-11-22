---
id: 2026-11-22-incident-v0078-首发-mac-arm64-的-npm-ci-崩exit-196-加重试并重推-tag
date: 2026-11-22
kind: incident
area: release
title: v0.0.78 首发 mac arm64 的 npm ci 崩（exit 196）→ 加重试并重推 tag
tags: [release, ci, mac]
commits: []
files: []
importance: high
---

# v0.0.78 首发 mac arm64 的 npm ci 崩（exit 196）→ 加重试并重推 tag

v0.0.78 / PP v0.1.26 发布完成（两仓 + macOS），含一次 CI 偶发失败的处理。

结果（均为 draft=false、assets=uploaded）：
- 主仓 v0.0.78：`…-win-x64.exe` 672.2MB、`…-arm64-mac.zip`、`…-x64-mac.zip` 912.2MB（+ blockmap/latest.yml）。
- PP v0.1.26：`PPcode-0.1.26-win-x64.exe` 673.4MB、`-arm64-mac.zip` 897.5MB、`-x64-mac.zip` 913.8MB。

过程中的失败与处置：
- 首轮 mac arm64 作业在 `Install dependencies`（npm ci）3 分钟崩掉，注解给出 `exit code 196`
  （npm 的「Exit handler never called」已知 bug）。同一提交的 win 作业同一步通过 ⇒ 与仓库内容无关。
- 加固：两份 workflow 的 npm ci 改 `npm ci || (sleep 5 && npm ci)`，两仓同轮同步。
- 处置：确认当时无正式 Release（API 404）⇒ 删远端 tag → tag 移到加固提交 → 重推触发新一轮，
  三端全绿；内容与版本号不变（仍是 0.0.78）。
- 教训：mac 资产的正确名字是 `…-arm64-mac.zip` / `…-x64-mac.zip`（不是 `…-mac-arm64.zip`）；
  无 token 时查失败原因用 `/actions/jobs/{id}` 的步骤结论 + `/check-runs/{id}/annotations`，
  日志下载接口需要鉴权。
