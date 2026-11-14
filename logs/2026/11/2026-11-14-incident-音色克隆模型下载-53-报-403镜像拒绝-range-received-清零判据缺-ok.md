---
id: 2026-11-14-incident-音色克隆模型下载-53-报-403镜像拒绝-range-received-清零判据缺-ok
date: 2026-11-14
kind: incident
area: voice
title: 音色克隆模型下载 53% 报 403（镜像拒绝 Range + received 清零判据缺 ok）
tags: [voice, zipvoice, download, mirror, http403]
commits: [8c8b55d51]
files: [electron/voice/model-store.ts, scripts/guards/11z-voice-call.mjs]
importance: high
---

# 音色克隆模型下载 53% 报 403（镜像拒绝 Range + received 清零判据缺 ok）

## 现象

用户在「设置 → 语音通话 → 音色克隆」下载 ZipVoice 模型（sherpa-onnx tar.bz2，109 MB）时，进度到 **53%** 报「HTTP 403」，反复重试都停在同一位置。

## 根因（两条，缺一不可）

### ① 续传请求带 Range，部分镜像直接 403

`downloadOnce` 在已有 `.part` 时发 `Range: bytes=<offset>-`。下载断流（45 秒无数据）后会按镜像顺序换源，换源后的第一个请求就是**续传请求**。

11-14 实测三个源的响应：

| 源 | 无 Range | 带 Range |
|---|---|---|
| `github.com` 直连 | 302 | 302（跳转目标本机不可达） |
| `ghfast.top` | **000（连不上）** | **403** |
| `gh-proxy.com` | 200 | **206** |

而 `GITHUB_MIRROR_PREFIXES` 旧顺序是 `[ghfast, gh-proxy]` ⇒ 一旦从 ghfast 换源，必然 403；旧逻辑把 403 当终态直接失败，`.part` 原样留着，用户每次重试都死在同一百分比。

### ② 更隐蔽：`received` 清零的判据少了 `response.ok`

```ts
// 旧：任何非 206 响应都当成「服务器不支持续传」
if (received > 0 && response.status !== 206) received = 0;
```

403 / 5xx 也会落到这一行，把 `received` 清零。于是即使后面新增「403 ⇒ 去掉 Range 重来」的分支，条件 `received > 0` 已经不成立 —— **降级分支恒不可达**。

这一点是靠探针抓出来的：首轮实现只加了 403 分支，探针输出 `case1_ok=false range_hits=1 plain_hits=0`，说明走的是普通失败路径，根本没进降级。

## 修法

1. `downloadOnce` 增加 `rangeFallback`：`403 && received > 0` ⇒ 删 `.part`、以**无 Range** 递归重来一次（`rangeFallback: false`，只降级一次，避免对真无权限的地址无限重试）。
2. 清零判据改为 `if (received > 0 && response.ok && response.status !== 206) received = 0;`
3. `GITHUB_MIRROR_PREFIXES` 顺序改为 `[gh-proxy.com, ghfast.top]`（保留 ghfast 作最后手段）。
4. `downloadOnce` 加 `export`，理由与 `runtime-ipc.ts` 的 `fallbackPromptFor` 同款：这类「换个源就死在某个百分比」的问题只能靠真跑验证。

## 判据

**探针**（本地起 HTTP 服务器：带 Range → 403、无 Range → 200 + 200KB 内容），3/3：

- `case1`：预置 `.part`（100KB）⇒ 1 次 Range 被 403 ⇒ 自动删件重下 ⇒ 成功且 SHA256 匹配（`range_hits=1 plain_hits=1`）
- `case2`（对照组）：`rangeFallback: false` ⇒ 必须失败（否则说明断言恒真、测不出东西）
- `case3`：无 `.part` ⇒ 无 Range 直达成功（`range_hits=0`）

**守卫** `11z-voice-call.mjs` 新增三条（含反向断言：禁止退回不带 `response.ok` 的清零判据）。

**真实链路**：`gh-proxy` 大偏移续传 `Range: bytes=58000000-58065535` → **206 + 65536 字节**，用户当前那 53% 的 `.part` 可以直接接着下。

`npm run check` 预检通过；三仓同步（主仓 `8c8b55d51` / PPcode `e05a80af` / 云助手 `47eaab3f`）。

## 用户侧动作

主进程改动 **需要重启应用**才生效。重启后重新点「下载音色克隆模型」：已有的 `.part` 会先尝试续传，若源回 403 会自动丢掉半截从头下，不需要手工删缓存。

## 遗留

- `ghfast.top` 目前对本机完全不可用（无 Range 连接失败）。本次只是把它排到最后，未删除 —— 若长期不可用可考虑整条移除。
- 同类「镜像对 Range 不友好」的风险也存在于 KaiHeiLa / Kokoro 等走同一条 `downloadUrlToFile` 的资源，本次的 403 降级对它们同样生效（但未逐一实测）。
