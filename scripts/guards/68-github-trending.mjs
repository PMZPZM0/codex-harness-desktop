#!/usr/bin/env node
/**
 * 68-github-trending —— 设置「GitHub 热门」页（11-20 用户令）
 *
 * 钉住四件事：
 *   ① 设置导航最底有「GitHub 热门」，并真实注册了页面渲染（不是只加导航）；
 *   ② 数据走国内镜像（gh-proxy 优先、直连兜底），每页 10 条、共 10 页、日/周/月三榜；
 *   ③ 简介翻译走主进程 prompt:translate（模型优先、MyMemory 兜底），不在渲染层直连翻译接口；
 *   ④ 设置页白名单同步（自定义入口能添加它）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks += 1;
  if (!condition) fails += 1;
  console.log(`  ${condition ? "✓" : "✗"} 【github-trending】${message}`);
};

const nav = read("src/features/app-view/helpers/catalogs.ts");
const registry = read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx");
const discover = (() => {
  try { return read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/discover.tsx"); } catch { return ""; }
})();
const page = read("src/features/github-trending/index.tsx");
const prompt = read("electron/features/prompt-ipc.ts");
const manifest = read("electron/ipc-channels.manifest.json");
const ipcRegistry = read("electron/ipc-registry.ts");
const extensions = read("electron/features/extensions-ipc.ts");

ok(/\"github-trending\",\s*\"GitHub 热门\"/.test(nav) && /group:\s*\"发现\"/.test(nav),
  "设置导航最底新增「发现 → GitHub 热门」");
ok((/github-trending/.test(registry) || /github-trending/.test(discover))
  && (/GithubTrendingPage/.test(registry) || /GithubTrendingPage/.test(discover)),
  "设置注册表有 github-trending 的真实渲染分支（不是只有导航项）");
ok(/gh-proxy\.com\/https:\/\/\$\{api\}/.test(page) && /per_page=100/.test(page)
  && /PAGE_SIZE\s*=\s*10/.test(page) && /PAGE_COUNT\s*=\s*10/.test(page)
  && /daily:\s*\{[^}]*days:\s*1/.test(page) && /weekly:\s*\{[^}]*days:\s*7/.test(page)
  && /monthly:\s*\{[^}]*days:\s*30/.test(page),
  "数据走 gh-proxy 国内镜像（直连兜底），每页 10 条 / 共 10 页 / 日周月三档");
ok(/translateTexts/.test(page) && /github-trending-zh-v1/.test(page) && /writeTransCache/.test(page),
  "简介翻译走主进程通道并落本地缓存（同一仓库不重复翻译）");
ok(/prompt:translate/.test(prompt) && /api\.mymemory\.translated\.net/.test(prompt) && /parseTranslatedArray/.test(prompt),
  "主进程 prompt:translate：模型批量翻译，失败回落 MyMemory");
ok(/\"channel\": \"prompt:translate\"/.test(manifest) && /prompt:translate/.test(ipcRegistry),
  "prompt:translate 已登记 manifest + IPC 注册表（生成器会产出 preload / d.ts）");
ok(extensions.includes('"github-trending"'),
  "自定义功能入口的设置页白名单包含 github-trending");

console.log(`\n【github-trending】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
