---
id: 2026-11-10-incident-codex-调自媒体工作台的四个缺口网关未点名-协议只认-chat-metric-缺平台-失败当
date: 2026-11-10
kind: incident
area: media-desk
title: Codex 调自媒体工作台的四个缺口：网关未点名 / 协议只认 chat / metric 缺平台 / 失败当成功
tags: [media-desk, gateway, codex, wireapi]
commits: []
files: [electron/features/media-desk/{ai, tool}.ts, src/features/app-state/parts/part08/01-seg.tsx]
importance: normal
---

# Codex 调自媒体工作台的四个缺口：网关未点名 / 协议只认 chat / metric 缺平台 / 失败当成功

## 背景
用户问「codex 调用这个整个流程能不能跑通」。对 `harness_tools → dispatchRpcCall → media_desk → 本地宿主` 整条链做复核（静态 + 真 Electron 探针 11 步）。

## 结论
链路本身是通的：网关工具表 41 个能力里含 media_desk，state / capture / draft / schedule / style / delete / undo 实测全过。但发现四个「半通」缺口，已补：
1. **模型不知道有这个工具**：`harness_tools` 的 description 列了一堆能力却没写 media_desk（`dispatchMcpTools` 里有、description 里没有）⇒ 在 part08 网关描述里点名，并写了「不确定先 state」。
2. **文字模型只认 chat/completions**：responses 供应商会静默走宿主兜底（结构草稿 + notice），用户以为「成稿跑通了」其实没调模型 ⇒ ai.ts 按 `wireApi` 双协议（与 prompt-polish.ts 同口径），embed 的 activeModel 带上 wireApi。
3. **metric 一直失败**：上游对非法/缺失 platform 直接丢字段并抛「数据需要平台」⇒ tool 里改成必填 + 中文清单；平台清单改成上游真值（原来的「通用」在上游不存在）。
4. **失败当成功**：draft/produce 只回 production 原对象（可达 20 万字，JSON 截断会变非法），failed/cancelled 也返回 ok:true ⇒ 改为摘要（status/error/notice/文章前 5000 字/图片数），failed/cancelled 回 ok:false。另补 insights 动作（复盘：播放/互动率/平台分布/Top 内容）。

## 依据
- 探针（隔离 userData）：`gateway-eligible-has-media_desk true total 41`；11 步输出见本轮记录；无模型环境下 draft 返回 done + notice（兜底草稿），metric 无 platform 时返回中文必填提示，带 platform 成功、insights 返回真实汇总。
- 守卫 12bi 28 条：4 处变异（删枚举 insights / 破坏 wireApi 分支 / 删 failed 判断 / 删网关描述）全部抓红。
- 注意：动态工具只在 thread/start 与 resume 注入 ⇒ **老会话要切走再切回**才有新描述。

## 影响面
- `electron/features/media-desk/{ai,tool}.ts`、`embed.ts`、`dispatch-core.ts`、`src/features/app-state/parts/part08/01-seg.tsx`。
- 用户侧：老会话切换后，模型能看到并调用 media_desk；responses 供应商可正常出 AI 稿；排期/复盘/数据记录都能由 Codex 跑。

## 回滚
回退本轮提交；数据格式未变。若只回滚 part08 描述，工具仍可被 `name="list"` 发现，但模型不会主动用。
