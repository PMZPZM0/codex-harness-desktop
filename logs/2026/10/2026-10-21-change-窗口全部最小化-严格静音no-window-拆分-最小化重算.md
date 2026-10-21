---
id: 2026-10-21-change-窗口全部最小化-严格静音no-window-拆分-最小化重算
date: 2026-10-21
kind: change
area: voice
title: 窗口全部最小化 ⇒ 严格静音（no-window 拆分 + 最小化重算）
tags: [voice, multiwindow, minimize, announce]
commits: [7ffba51, 19d69dca, b4f0f65a]
files: []
importance: normal
---

# 窗口全部最小化 ⇒ 严格静音（no-window 拆分 + 最小化重算）

用户令（10-21）：「窗口全部缩小了……希望这种情况下也严格静音，把 no-window 改成『全部让位』」。
这是上一轮我自己标出的已知取舍，用户拍板收紧。

**根因是两层，缺一层都不成立**：
① **语义混用**：`pickAnnounceOwner` 的候选是过滤掉最小化窗口后的 live（`visible && !minimized`），
   于是「一个窗口都没登记」（启动早期/未注册）与「有窗口但全缩了」共用同一个 `no-window`
   ⇒ handler 只能统一 `owner:true` 保底 ⇒ 两窗口全缩时**两边都以为自己该念**（叠加 + 对着空气说）。
② **事件缺口**：`browser-window-focus` **不会**在最小化/还原时触发 ⇒ 就算裁决改对，
   「全部最小化」永远算不出来：owner 还停在上次焦点的窗口，它继续念。

**改动**（`04-announce-owner.ts`）：
· 拆两个 reason：`candidates.length===0` ⇒ `no-window`（保底可播）；
  `live.length===0` ⇒ **`all-minimized`**（让位）。
· handler：`owner: reason !== "all-minimized"` —— 全缩 ⇒ 全员 false；零窗口仍 true 保底
  （⛔ 宁可多念一次，也不能因一次算不出来就永久静音）。
· 挂 `minimize/restore/show/hide` 重算 owner，`WeakSet` 去重（窗口增减会反复触发，
  不去重会越挂越多、每个都广播一次）。
· 文件头口径同步：**应用整体失焦 ≠ 窗口本身不可见** —— 前者继续「最后活跃那个念」，后者静音。

**判据**：`pickAnnounceOwner` 真跑 8 组（单窗口最小化 / 双窗口全缩 / 一缩一可见 / 全失焦不缩 /
全 visible=false / 零窗口）全部符合；守卫 11z **182/182**（原「算不出就保底」1 条拆 4 条）。
全链 check EXIT=0 零红。三仓 7ffba51 / 19d69dca / b4f0f65a；**只改主进程 ⇒ 无需部署渲染层**。

⛔ 过程坑（并行线在同时构建，两次打断 check）：
· 第一次 `ENOENT public/pets/harness-lizi/look-03.webp` —— 对方正在改写宠物素材，文件存在但被替换；
· 第二次 `ENOENT dist/assets` —— `npm run build` 成功后，对方的 `clean-dist` 把 dist 清空了，
  守卫 11c 读不到产物直接 crash（表现为 EXIT=1 但 **0 条 ✗**，容易被误判成「断言没事」）。
  ⇒ 判据：**EXIT=1 且 0 红时先看日志尾部有没有 crash**，别只看 ✗ 计数。
