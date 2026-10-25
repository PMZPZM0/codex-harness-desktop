---
id: 2026-10-25-change-语音通话加三张合成引擎卡片kokoro-真接通并可按需下载
date: 2026-10-25
kind: change
area: voice
title: 语音通话加三张合成引擎卡片，Kokoro 真接通并可按需下载
tags: [voice, tts, kokoro, emotivoice, 按需下载]
commits: []
files: []
importance: high
---

# 语音通话加三张合成引擎卡片，Kokoro 真接通并可按需下载

用户令：把语音模型卡片放到语音通话界面，模型按需下载，原有模型保留，三个模型卡片做好看一点，每个优势劣势都写清楚；随后追加「安排国内镜像源，和留更新通道」。

本轮交付（桌面版主线）：

一、合成引擎三选一（设置 → 语音 → 合成引擎）
· 三张并列卡片：轻量播报（vits-zh-ll，5 音色）、自然多音色（Kokoro v1.1 int8，103 音色）、情感语气（EmotiVoice，2014 音色）。
· 每张卡写清定位 + 优势 + 劣势，数字全部为实测（体积、SHA256、RTF），不写「更快更好」这类空话。
· 三个包各自独立目录、独立下载、独立删除：下载新的不动旧的，删掉新的旧的照样能用（原有模型保留）。
· 不用 disabled 表达「能不能用」：EmotiVoice 缺推理运行时也照常可点，点了给明确说明。

二、Kokoro 是真接通（不是只画卡）
· sherpa-onnx-node 1.13.8 支持 kokoro 模型配置，本机实测：加载 2.0s、sampleRate=24000、numSpeakers=103。
· 应用自己的 TTS worker（dist-electron/voice/workers.js 的 TTS_WORKER_SOURCE）走同一份源码端到端验证：合成 4.00s 中文，RTF 2.52（2 线程），换音色正常。
· 中文含标点 / 数字 / 中英混排均无告警。
· 音色表 103 条从模型 ONNX 元数据 speaker_names 逐条抠出（顺序与官方 voices.bin 一致，不能错位）。

三、踩到并修掉的坑（都是实测，不是猜）
① mergeSettings 是显式字段映射 —— 新加的 engine 字段会被吞掉，sid 还会被夹死在 0..4（Kokoro 有 103 个音色）。已改成 engine 显式透传 + sid 上界跟着引擎走。
② 换引擎后 TTS worker 不会自动换模型（模型在 create 时就固定），必须重建线程；试听 worker 的缓存 key 也必须带引擎。
③ 音色表必须跟着引擎走（主进程按当前引擎给），否则下拉里会出现别的引擎的音色。
④ IPC 清单里无参通道的 paramsImpl 必须是空串（写 "0" 会生成 `(0) =>` 语法错误，preload 直接编译不过）。
⑤ 清单里的 voiceSettingsGet / voiceSettingsSet 返回类型在 HEAD 就已过期（缺 ball.style），渲染层 as Settings 直接 TS2352 报错 —— 已按 electron 侧权威形状订正。

四、按需下载 + 国内镜像 + 更新通道
· 归档型下载：Kokoro 整包 140MB（GitHub，走 ghfast/gh-proxy 镜像前缀链），解压 206MB；装完回读就绪判定，不信下载器说成功。
· EmotiVoice 逐文件下载（SimBERT 走 ModelScope 国内直连，自导出 ONNX 走托管基址常量）；托管基址为空时明确报错，绝不静默当成功。
· 更新通道：托管基址 + 版本号收在 EMOTIVOICE_ONNX_BASE / EMOTIVOICE_ONNX_VERSION 两个常量里，换 CDN 或换模型版本只改这里，下载逻辑不动。

五、用户追加提问：有没有能实时通话语音（不转文字）的模型
· 本轮三个模型都是「文字→语音」，做不到不转文字的实时通话。
· 真 S2S 是另一类模型（语音进语音出，文本不在关键路径）：Moshi（Kyutai，7B，Apache-2.0，真全双工，约 200ms，英文为主）、Qwen3-Omni-30B-A3B（211ms 首包，Apache-2.0）、MiniCPM-o 2.6/4.5、GLM-4-Voice、Step-Audio 2、LFM2-Audio-1.5B（1.5B，边缘可跑）、NVIDIA PersonaPlex-7B。
· 但本产品的 agent 链必须是「语音→文字→Codex→文字→语音」：S2S 模型不能驱动工具调用与改代码，换过去等于把整个 agent 换掉。
· 云端方案成本参考：OpenAI gpt-realtime 双向全双工约 18 美元/小时。

判据
· 引擎往返实测 11 项全过（默认 vits / 切 kokoro 后 engine 与 sid 持久 / 重启后仍在 / 切回 vits 越界被夹 / 非法引擎回落 / 老档案迁移仍 vits）。
· 应用自身 worker 端到端出中文（4.00s，RTF 2.52 @2 线程，峰值 0.422）。
· tsc -b 全绿；npm run build 通过；语音守卫 216/216 通过；IPC 桥与 preload 实参守卫全绿。
· 卡片视觉：浅色 + 暗色两套截图实拍核对（Electron capturePage，内联真实 CSS），无截断、按钮底部对齐、暗色可读。
