---
id: 2026-10-03-change-内置-codex-官方插件市场第二数据源并放出引擎自带官方卡片
date: 2026-10-03
kind: change
area: plugins
title: 内置 Codex 官方插件市场（第二数据源）并放出引擎自带官方卡片
tags: [plugins, market, ipc, github-mirror]
commits: [1520231]
files: [electron/codex-official-market.ts, electron/features/codex-official-market-ipc.ts, src/features/codex-official-market/CodexOfficialMarketSection.tsx]
importance: high
---

# 内置 Codex 官方插件市场（第二数据源）并放出引擎自带官方卡片

## 结论

插件页新增**第二个插件市场数据源**：Codex 官方插件市场（GitHub `openai/plugins`，65 个官方插件），
做成独立板块 `codex-official-market`（域前缀 = 目录名 = CSS 前缀），走国内镜像 gh-proxy 下载；
同轮**放出**引擎自带的 `openai-api-curated` 官方市场卡片（撤销此前"整源隐藏"的决定，用户 10-03 改判）。

## 依据（全部实测，非推断）

- 上游清单 = `.agents/plugins/marketplace.json`（65 条，name=openai-curated）+ `.agents/plugins/api_marketplace.json`
  （50 条子集）。**清单里没有简介与显示名** —— 它们在各插件的 `plugins/<slug>/.codex-plugin/plugin.json` 里，
  逐个抓要 62 个请求 ⇒ 文案改为**生成快照** `electron/codex-official-catalog.gen.ts`
  （生成器 `scripts/gen-codex-official-catalog.mjs`，英文逐字来自上游、截首句 ≤180 字符，不改写）。
- 62 条 `source.source="local"` 可一键安装；3 条指向**外部仓库**（CrowdStrike ×2 + Qodo 的 git-subdir）⇒ 标不可安装。
- 体积：62 个插件共 **51.13 MB**（> 50MB 内置口径 ⇒ 不随包）；单插件最多 **795** 个文件（zoom）
  ⇒ `MAX_FILES` 必须放宽（沿用 Gitee 源的 300 会直接拒装 4 个合法插件）；最大单文件 2.09 MB。
- **65 条全部要求鉴权**（ON_INSTALL 58 / ON_USE 7），其中 15 条（gmail / teams / sharepoint / adobe / shopify …）
  的简介自己写着"通过已配置的 X 应用连接器" ⇒ 依赖 ChatGPT 账号。所以每张卡片带 `authNote`，
  避免"已安装 = 能用"的错觉。
- 镜像实测：`gh-proxy.com` 能代理 `raw.githubusercontent.com` **与** `api.github.com`（后者共享速率池剩余 3000+，
  未登录直连限 60 次/小时）；`ghfast.top` 在本机不通 ⇒ 顺序 gh-proxy → ghfast → 直连。
- 引擎侧三条实证沿用 Gitee 源（【245】）：`plugin/install` 的 `marketplacePath` 必须传**清单文件**（传目录报 os error 5）、
  写完文件必须 `plugin/install` + 重启引擎、"装没装"的真相源是**本地 marker**（`.codex-official.json`）不是引擎列表。

## 影响面

- 新增：`electron/codex-official-market.ts`（基座）· `electron/features/codex-official-market-ipc.ts`（域，5 通道）
  · `electron/codex-official-catalog.gen.ts`（生成物）· `scripts/gen-codex-official-catalog.mjs`
  · `src/features/codex-official-market/`（渲染层，**自包含本地 state，不进 bag**）
  · `src/styles/25-codex-official-market.css`
- 改动：`PluginsMarketSection.tsx`（源切换，两个源各用自己的分类 tab）· part04 删 `openai-api-curated` 过滤
  · manifest +5 通道（398）· `ipc-registry` 记账 · `composition.json` 启用域 77→78 · 能力清单重生成
  · 守卫【254】11 条 + 【255】11 条，`EXPECTED_CHECKS` 3005 → 3027 · `accept.mjs` 新增本轮项 ⑳
- 用户可感知：设置 → 插件 → 顶部「Claude 插件镜像 / Codex 官方插件」切换；官方源卡片带中文名称、简介、
  鉴权提示；安装走六步进度弹层；已装卡片显示「✓ 已安装」+ 独立卸载钮（两段式确认）。

## 验证

- `npm run check` 绿（含 3027 条守卫、bag-types 1400 项零漂移、require 断链 0）。
- 行为探针（纯 node 跑 `dist-electron/codex-official-market.js` 真实现，临时目录、不碰真实 codex-home）：**14/14**
  —— 真下载 clickup、marker/清单落盘、装完 `installed=true`、卸载删目录并摘条目、
  三条删除防御（越界 slug / 绝对路径 / 点开头目录）全部拒。
- 验收 `node scripts/accept.mjs --only codex-official --profile ofm`：**6/6**（清单 65 条 live=true、10 个分类数量之和 = 65、
  切源后 18 张卡片真渲染且安装钮可用、每卡片都有鉴权提示、零网络通道与 list 的 installedIds 同源）。
- 变异测试 3 条全部如期变红（镜像顺序 / 重新加回 api-curated 过滤 / 事件 type 改回共用）⇒ 新断言非恒真。
- 截图 `.e2e-artifacts/shots/01-official-market.png`：卡片 318×158、鉴权行 296×17、11 个 tab、标题溢出 0。

## 回滚

`git revert` 本提交即可；数据面残留两处可手删（都不影响真实用户配置）：
`<codexHome>/plugins/codex-official-market/`（已装插件与本地清单）与 config.toml 里的
`[marketplaces.codex-official-market]` 段（只有装过插件才会写）。

## 已知边界（明确不做，等用户点头再扩）

- 引擎**没认领**的官方插件在本板块有 ✓ 与卸载，但不进下方「已安装」卡片区 —— 那里的 union 目前只扫 Gitee 目录
  （part04/part05 的 `localOnly` 分流只认一个市场）。补齐要给 union 加"市场"维度，属 bag 改动，未擅自扩。
- 不做 `fs`/`path` 类接缝化；本板块直接读 `codexHome`（同 Gitee 源口径）。
