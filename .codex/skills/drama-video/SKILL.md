---
name: drama-video
description: AI 短剧成片流水线技能——分镜表 → 首帧 → 视频 → 配音的完整操作手册。当用户要「把剧本变短剧 / 生成分镜视频 / 逐镜出片 / 短剧画布配合」时使用。依赖内置 video:* 通道（8 家厂商）与 builtin:generate-image、voice:speak。
---

# drama-video：AI 短剧成片流水线

配套：短剧画布（侧栏「AI 短剧无限画布」）+ 视频制作专家团。分镜表 JSON 是**唯一真源**。

## 数据流（闭环）

```
剧本 → 分镜表 JSON（.drama-canvas/storyboards/<片名>.json）
     → 画布「展开」成卡（每镜一张 shot 卡）
     → 首帧（builtin:generate-image，回填 first_frame）
     → 视频（video:submit → video:poll 5s → video:download 落盘，回填 video）
     → 配音（voice:speak → drama-canvas:asset-write，回填 audio/duration）
     → 交付核对：每镜 first_frame / video / audio 三字段齐全
```

## 视频生成通道（video:*）

| 通道 | 用途 |
|---|---|
| `video:providers` | 8 家厂商清单 + `configured` 标志（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） |
| `video:config-save` | 存厂商凭证（设置 → 插件 → 内置接口卡也能配） |
| `video:submit` | `{providerId, mode:"t2v"\|"i2v", prompt, image?, model?, duration?}` → `{jobId}` |
| `video:poll` | `{providerId, jobId}` → `{status, url?}`（5s 间隔，最长 10 分钟） |
| `video:download` | `{url, workspace, name}` → `{path, bytes}`（落 `<workspace>/.drama-canvas/assets/video/`） |

**厂商选择规则**：本地首帧文件 → 只能选 base64 类（可灵/智谱/MiniMax/Runway/Veo）；
万相/Seedance/Luma 是 url-only，需要公网图片地址。没有首帧 → t2v。

## 硬规则

1. 分镜表 JSON 为唯一真源；改画布必须回写（画布的写回钩子已自动做）。
2. 没配凭证就**明确告知去哪配**（插件市场 → 内置接口卡），⛔ 不许编造视频 URL。
3. 交付核对用字段判据（first_frame/video/audio 是否都回填），不用"我觉得完成了"。
4. 提交成功 ≠ 交付：回执只证明任务建了；`video:poll` 到 succeeded + download 落盘才算数。
