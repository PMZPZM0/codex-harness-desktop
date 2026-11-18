---
name: playwright-browser-automation
description: 用微软开源的 Playwright 做浏览器自动化：抓取、填表、截图、导出 PDF、跑端到端回归。当任务需要"真的打开网页点/填/截"，或要批量抓一组页面时读本技能；本应用内置浏览器能做的先走内置（更快、有登录态），需要脚本化/批量/CI 时才落 Playwright。
---

# Playwright 浏览器自动化

## 什么时候用
- 要**批量**打开一批 URL 抓同样字段（竞品调研、价格监控、批量截图）
- 要**脚本化**填表 / 点流程 / 下载附件，而不是靠人点
- 要把"打开页面 → 三个宽度截图 → 断言元素"做成可重复的检查（前端验收）
- ⛔ 只是看一眼页面 / 用现有登录态点两下 ⇒ 先用应用内置浏览器与 RPA，别为一次性任务装 Playwright

## 安装（一次性，国内建议走镜像）
```bash
npm i -D playwright            # 或 npm i -D @playwright/test（要跑测试时）
npx playwright install chromium
```
- 装浏览器二进制要下载 ~150 MB，慢的时候设 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`
- 系统依赖缺失时 `npx playwright install-deps`（Linux）；Windows 一般不需要
- ⛔ **装软件要先征得用户同意**（本应用的硬规则），不要自己静默 `npm i`

## 抓取：最小可用脚本
```js
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  /* ⛔ 不要 sleep：等具体条件 —— 元素、网络空闲、或响应 */
  await page.waitForSelector("[data-testid=price]", { timeout: 15_000 });
  const rows = await page.$$eval("[data-testid=row]", (els) =>
    els.map((el) => ({
      title: el.querySelector(".title")?.textContent?.trim() ?? "",
      price: el.querySelector("[data-testid=price]")?.textContent?.trim() ?? "",
    })),
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await browser.close();   // ⛔ 必须关：漏关会留僵尸进程、下次启动占端口
}
```

## 三个常用动作
| 目标 | 写法 |
|---|---|
| 批量截图（多宽度自检） | `for (const w of [1440, 768, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.screenshot({ path: \`shot-\${w}.png\`, fullPage: true }); }` |
| 导出 PDF | `await page.pdf({ path: "out.pdf", format: "A4", printBackground: true })`（仅 Chromium） |
| 存登录态复用 | 首次 `await context.storageState({ path: "state.json" })`；之后 `browser.newContext({ storageState: "state.json" })` |

## 稳定性要点（踩过的坑）
- **等条件不等时间**：`waitForSelector` / `waitForResponse` / `waitForLoadState("networkidle")`；`waitForTimeout` 只在调试时用
- **选择器优先级**：`data-testid` > 语义角色（`getByRole`）> 结构 CSS；⛔ 别用 nth-child 串长链路
- **并发**：同一浏览器开多个 context（各自 cookie），别开多个 browser 进程
- **反爬**：很多站点看 UA / 无头特征；先试 `channel: "chrome"` + 真实 UA，仍失败就如实说"抓不到"，不要写无限重试
- **合规**：只抓公开页面、遵守 robots 与站点条款；不绕过登录墙 / 付费墙

## 与本应用配合
- 需要**登录态**的站点：先在应用内置浏览器里登录（数据在 `persist:harness-browser` 分区），再用 `storageState` 导入 cookie
- 抓下来的表格直接落 CSV/Markdown，再用表格工具汇总；大页面截图走图片预览
- 要"每次发布前跑一遍"的检查 ⇒ 写进 `scripts/` 并挂到验收脚本，而不是每次让模型手敲
