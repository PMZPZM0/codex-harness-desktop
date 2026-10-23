---
id: 2026-10-23-change-pptoken-默认-api-改为大陆线路-cnpptokencc
date: 2026-10-23
kind: change
area: model
title: PPtoken 默认 API 改为大陆线路 cn.pptoken.cc
tags: [pptoken, endpoint, cn, provider]
commits: []
files: [src/lib/pptoken-endpoints.ts, src/features/settings-model/ModelSettingsSection.tsx, src/features/auth/LoginScreen.tsx, scripts/guards/04-misc-and-tools.mjs]
importance: normal
---

# PPtoken 默认 API 改为大陆线路 cn.pptoken.cc

# PPtoken 默认 API 改为大陆线路

## 起因
用户：「ppCode 里面的供应商 pptoken 供应商的默认 api 地址错了，要用国内 cn 那个」。
此前默认 `https://api.pptoken.cc/v1`（国际线），国内用户应默认 `https://cn.pptoken.cc/v1`。

## 结论
- `PPTokenEndpoints` 第一项（默认）改为 `https://cn.pptoken.cc/v1`（大陆优化线路）；
  国际线 `https://api.pptoken.cc/v1` 保留为第二项 `pptoken-intl`，US / Claude 不变。
- 供应商推荐卡、编辑表单、登录预填统一读 `PPTokenEndpoints[0].url`，⛔ 不再写死 api 地址。
- 登录页的网关（sub2api 账号站点）仍保持 `api.pptoken.cc`，只改供应商 API 默认，避免账号登录链路受影响。
- 守卫【15】新增：端点表默认必须是 cn 且排在国际线之前，供应商卡不得再出现写死的 api 地址。

## 影响面
- 新配置 / 推荐卡默认走 cn；已有用户已保存的 baseUrl 不被改写（避免打断存量配置）。
- 三仓同步；云助手 UI 需部署。

## 验证
- `npm run check` 通过；守卫【15】真跑。
- 回滚：恢复端点表第一项与供应商卡字面量即可。
