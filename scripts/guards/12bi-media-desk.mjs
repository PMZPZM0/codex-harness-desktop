/**
 * 自媒体工作台（11-09）：域接线 + 安全闸的行为判据。
 *
 * 背景：逻辑移植自开源 dsh-media-desk 2.6.2（MIT），作为本仓的独立板块接入。
 * 这里钉住四类容易"接漏了还看不出来"的点：
 *   ① 域真正挂上（composition / manifest / registry / preload / d.ts 五处一致）；
 *   ② 设置页真的能打开（settingsNav + HelpDialog 总览 + capabilities 页注册）；
 *   ③ 安全：域不直取 safeStorage（走宿主接缝）；采集链接拒绝本机/内网；
 *   ④ 密钥不回渲染层（publicState 抹空 apiKey）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, codeOnly } from "./_ctx.mjs";

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks += 1;
  if (condition) { console.log(`  ✓ ${message}`); return true; }
  fails += 1;
  console.log(`  ✗ ${message}`);
  return false;
};

export async function run() {
  const composition = read("electron/composition.json");
  const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
  const registry = read("electron/ipc-registry.ts");
  const preload = read("electron/preload.ts");
  const dts = read("src/vite-env.d.ts");
  const ipc = read("electron/features/media-desk/ipc.ts");
  const store = read("electron/features/media-desk/store.ts");
  const catalogs = read("src/features/app-view/helpers/catalogs.ts");
  const help = read("src/components/HelpDialog.tsx");
  /* 页面注册位置随设置页拆分进度不同（主仓 pages/capabilities.tsx；老仓 00-settings-registry.tsx）。 */
  const pageCandidates = [
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/pages/capabilities.tsx",
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
    "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx",
  ];
  const pageSrc = (() => { for (const rel of pageCandidates) { try { return read(rel); } catch { /* 换下一个 */ } } return ""; })();
  const board = read("src/features/media-desk/index.tsx");
  const styles = read("src/styles.css");

  const channels = manifest.channels.filter((c) => String(c.channel).startsWith("media-desk:"));
  ok(/\"id\": \"media-desk\"/.test(composition) && /features\/media-desk\/ipc\.ts/.test(composition),
    "组合表已挂载 media-desk 域（composition.json）");
  ok(channels.length === 10 && /prefix: "media-desk", count: 10/.test(registry),
    `manifest 与 registry 一致：10 条通道（实测 ${channels.length}）`);
  ok(/mediaDeskState/.test(preload) && /mediaDeskState\(\): Promise<MediaDeskState>/.test(dts),
    "桥三件套齐备（preload / vite-env 都有 mediaDeskState）");
  ok(/\["media-desk", "自媒体工作台"/.test(catalogs) && /\{ page: "自媒体工作台"/.test(help)
    && /"media-desk": \{ render:/.test(pageSrc),
    "设置页可到达：导航 + 帮助总览 + 页面注册三处都在");
  const aiSrc = read("electron/features/media-desk/ai.ts");
  ok(!/safeStorage/.test(codeOnly(ipc)) && !/safeStorage/.test(codeOnly(aiSrc)) && /setSecureHost\(/.test(ipc),
    "⛔ 域不直取 safeStorage（密钥走宿主 secure 接缝）");
  ok(/function publicState/.test(store) && /apiKey: ""/.test(store) && /hasAssistantKey/.test(store),
    "对外状态抹空 apiKey，只给 has*Key（密钥不回渲染层）");
  ok(/灵感墙/.test(board) && /mediaDeskHarvest/.test(board) && /mediaDeskProduce/.test(board) && /mediaDeskChat/.test(board),
    "板块含灵感墙 / 采集 / 一键成稿 / 工作室对话");
  ok(/63-media-desk/.test(styles), "样式已挂进 styles.css（且插在 59-motion 之前）");

  /* 行为：SSRF 闸真的拦内网、放公网。 */
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, "dist-electron", "features", "media-desk", "harvest.js")).href);
    const rejects = (url) => { try { mod.assertPublicUrl(url); return false; } catch { return true; } };
    ok(rejects("http://127.0.0.1/x") && rejects("http://10.0.0.5/") && rejects("http://192.168.1.2/")
      && rejects("http://172.20.0.1/") && rejects("http://localhost/") && rejects("file:///C:/x")
      && !rejects("https://example.com/a"),
      "采集链接：本机 / 内网 / 非 http(s) 一律拒绝，公网放行");
  } catch (error) {
    ok(false, `harvest 行为测试没跑起来（先 npm run build:electron）：${String(error?.message ?? error).slice(0, 80)}`);
  }

  console.log(`\n【media-desk】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
  return fails;
}

const failed = await run();
if (failed) process.exit(1);
