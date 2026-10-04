---
id: 2026-10-04-change-mac-桌面自动化后端换成-open-computer-use
date: 2026-10-04
kind: change
area: automation
title: mac 桌面自动化后端换成 open-computer-use
tags: [desktop-automation, computer-use, mac, packaging, mcp]
commits: [b59a8fb]
files: [scripts/prepare-mac-tools.cjs, electron/automation-policy.ts, electron/capability-registry.ts]
importance: high
---

# mac 桌面自动化后端换成 open-computer-use

## 结论

mac 的桌面自动化后端换成 **open-computer-use**（随包内置），Windows 保持 nuphus + 我们自己的 UIA 控件清单通道。
⛔ 硬约束：**同一时刻只留一条真实键鼠通道** —— mac 上把 nuphus 的 15 个 `desktop_*` 整组掩掉，浏览器组不受影响。

## 依据

- 用户 10-04 拍板：「mac 版本就用 computer use 随包内置，Windows 就用 nuphus」。
- `open-computer-use`（MIT）是对 Codex 原生 computer use 的开源复刻：9 个工具同名同语义、也是 stdio MCP、
  走 Accessibility 拿控件清单。npm 包**已内置四平台二进制**（解包 ~13MB），`postinstall` 实测只打印安装提示
  ⇒ CI 用 `--ignore-scripts` 也装得动（少跑一段第三方脚本）。
- 为什么必须掩掉 nuphus 桌面组：两套真实键鼠通道同时在工具表里，模型会随机挑一个，出问题也分不清是谁；
  而「设置 → 开发工具」的能力链路必须显示**实际会用的那一个**（显示与落盘同源是本项目反复修的同类 bug）。
- 为什么 command 不能写裸命令名：装进 `.app` 之后 PATH 里没有 `open-computer-use`，
  会得到一个"注册了但静默起不来"的服务器 —— 这类问题源码侧看不出来。

## 影响面

- `scripts/lib/tools-versions.cjs` 新增 `computerUse`（版本单一来源）；
  `scripts/prepare-mac-tools.cjs` 装包 + **裁掉 `dist/windows`/`dist/linux`** + 补 `Contents/MacOS/*` 执行位 + 记入 mac 清单；
  `scripts/verify-packaged-tools.cjs` darwin 分支加三条产物校验（主程序存在 / 执行位 / 不残留别的平台二进制）。
- `electron/toolchain.ts` 新增 `computerUseLauncher()`（launcher 与 .app 都在才算就绪）；
  `electron/automation-policy.ts` 新增 `COMPUTER_USE_MCP_SERVER` / `COMPUTER_USE_TOOLS` / `shouldRegisterComputerUse`，
  并给 `nuphusDisabledTools` 加可选 `platform` 参数（默认当前平台 ⇒ 老调用点行为不变）；
  `electron/features/custom-model-apply.ts` 注册 `[mcp_servers.computer-use]` + 进 `ownedMcpServers`；
  `electron/capability-registry.ts` 桌面能力改为三后端（nuphus-desktop / uia-desktop / computer-use-desktop）按平台取唯一 active；
  `electron/features/capabilities-ipc.ts` 探针补两个就绪字段。
- 守卫【274】八条（含**真跑** `nuphusDisabledTools` 与 `resolveCapabilities` 比对两平台结论），
  `EXPECTED_CHECKS` 3069→3077；AGENTS.md 补一节。

## 验证

- Windows 侧：预检绿（【273】9 条 + 【274】8 条全过，其中 mac 掩码与能力链路是真跑产物断言，两平台结论相反）；
  `tsc -p electron` 0 错误。
- mac 侧：**未真机验证**。签名/公证、Gatekeeper 放行、首次「辅助功能 + 屏幕录制」授权体验只能在 mac 上跑出来；
  本轮只做到"产物层校验就位 + 静态判据正确"。第一次跑 mac CI 时若红，优先看这三条。

## 回滚

`git revert b59a8fb`。mac 包体积回落 ~13MB（裁剪后实际进包的更少）；配置面残留 `[mcp_servers.computer-use]` 一段，
下次保存模型时会被 harness 重写掉（该段在 `ownedMcpServers` 里）。

## 并发事故记录（值得留着）

上一条提交（`031e8b6` 等）用宽范围 `git add` 把**我刚单独暂存**的 `_ctx` EXPECTED_CHECKS=3077 与
`09-structural` 棘轮 3737 两行扫进了他们那个 commit，却没带上我对应的守卫代码
⇒ HEAD 一度处于「数字比实际断言数高」的红态（预检会报"断言凭空消失"）。
本提交补齐守卫后数字重新对得上。**教训**：共享文件用「HEAD + 仅我一行」单独暂存只是降低风险，
不能消除撞车 —— 只要另一路还在用宽 add，正确做法仍是**做完立刻整批提交**，别在索引里过夜。
