---
id: 2026-10-05-change-3d-模型预览接入网关-preview-3d-到应用内弹窗的全链联动
date: 2026-10-05
kind: change
area: model-viewer
title: 3D 模型预览接入：网关 preview_3d 到应用内弹窗的全链联动
tags: [model-viewer, preview3d, gateway, skill]
commits: []
files: [electron/features/model-viewer-ipc.ts, electron/features/dispatch-rpc.ts, electron/features/dispatch-core.ts, src/features/model-viewer/ModelViewerModal.tsx, scripts/guards/12-model-viewer.mjs]
importance: normal
---

# 3D 模型预览接入：网关 preview_3d 到应用内弹窗的全链联动

## 背景

用户 10-05 拍板：接 3D 能力要「联动性做好，生成 3D 图了 Codex 要晓得怎么去调用、打开预览」。
仓库里已有鲁班（model-3d-lead，内置六专家之一，Lux3D → GLB 管线）与内置技能 3d-modeling，
但宿主侧没有任何 3D 工具 —— 专家知道「说」，宿主接不住「看」。

## 结论

六接缝全链接入（守卫【mv】13 条逐段钉住）：

1. **模型库**：@google/model-viewer ^4.3.1（依赖），渲染层**懒加载**（vite 独立分块实测 1000KB，
   主包零开销）。⛔ 顶层 import 会把主包撑大，守卫钉住必须 `import()`。
2. **model-viewer 域**（`electron/features/model-viewer-ipc.ts`）：`model-viewer:read`（manifest/registry/
   composition 登记，415 通道 / 84 域）。读模型字节 Uint8Array 结构化克隆直传（不转 base64，省 33% 内存）。
3. **路径闸 resolveModelPath**（网关与读通道共用）：isInsideTrustedRoots（内核独占，经 runtime-refs）
   + 扩展名白名单 .glb/.gltf + 256MB 上限（ponytail 注明天花板与 model:// 流式升级路径）。
4. **网关 preview_3d**（dispatch-core 声明 + dispatch-rpc 执行端 + part08 网关描述三处同步）：
   路径过闸 → sendToWindow("model-viewer:open")。推送通道是**手写桥**（onModelViewerOpen，不在 manifest，
   同 runtime:progress 口径）。
5. **渲染层 ModelViewerBridge**（AppView 挂载，经 barrel；自包含本地 state 不进 bag）：
   Blob URL 喂 `<model-viewer>`，CSP connect-src 已放行 blob:（零 CSP 改动）；revokeObjectURL 配对防泄漏。
6. **联动知识面**：技能 3d-modeling 补「宿主内 3D 预览」节、中文导读、鲁班种子 systemPrompt/SOP
   （工作方式第 3 步：每拿到一个 GLB 同轮调 preview_3d）。

## 依据

- 实测坑（守卫变异抓出，比结论本身值钱）：① 闸断言第一版读**源码**，变异改**产物**抓不住 ⇒ 断言必须
  查产物层；② 产物里调用被 tsc 改写成 `!(0, runtime_refs_1.isInsideTrustedRoots)(candidate)`，
  源码形态正则恒红；③ 挂载断言只查符号名会命中 import 行（删 JSX 假绿）⇒ 钉 `<ModelViewerBridge />`。
- React 19 的自定义元素声明挂 `declare module "react"`（全局 JSX 命名空间已不存在）；
  TS 5.9 BlobPart 不收 ArrayBufferLike ⇒ 显式收窄。
- ⛔ 内置专家「已存在不覆盖」（main.ts ensure 语义）—— 老用户存档里的鲁班提示词不会刷新，
  靠技能 + 网关描述两条常驻通道兜底（对所有会话可见）。

## 影响面

- 引擎拿到/产出 .glb/.gltf 后调 `harness_tools { name: "preview_3d", args: { path } }` 即在应用内弹窗；
  未调用时零行为变化（弹窗不挂载任何东西，主包不变大）。
- `npm run check` EXIT=0（0 红）；【265】棘轮 vite-env.d.ts 785→787；EXPECTED_CHECKS 实测回填 3180。
- ⛔ 未跑 accept（改主进程 + 本轮 accept.mjs 被并发会话占用）；弹窗交互待用户实测一次
  （工作区放一个 GLB → 让 Codex 调 preview_3d）。

## 回滚

`git revert <本次提交>`；依赖 @google/model-viewer 随回滚卸载；无数据迁移、无配置残留。
