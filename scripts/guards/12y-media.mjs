/**
 * 媒体预览 / 影视源判据（media 域，2026-10-20；纯离线，随预检跑）
 *
 * 链路：本地协议（Range/206 + 可信根）→ hls.js 懒加载 → MediaPreview 弹窗 → 三处入口；
 * 影视源：内置/userData 覆盖 → 并发搜索 → 详情 → 直链内播/网页外开。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (condition, message) => { checks++; if (!condition) { fails++; console.log(`  ✗ 【media】${message}`); } };
const read = (path) => readFileSync(join(ROOT, path), "utf8");

let boot = "", main = "", preload = "", core = "", rpc = "", sources = "";
try {
  boot = read("dist-electron/features/boot.js");
  main = read("dist-electron/main.js");
  preload = read("dist-electron/preload.js");
  core = read("dist-electron/features/dispatch-core.js");
  rpc = read("dist-electron/features/dispatch-rpc.js");
  sources = read("dist-electron/media-sources.js");
} catch {
  console.log("  ✗ 【media】读 dist-electron 产物失败（先 npm run build:electron）");
  process.exit(1);
}
const html = read("index.html");
const pkg = JSON.parse(read("package.json"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const styles = read("src/styles.css");
const media = codeOnly(read("src/features/media/MediaPreview.tsx"));
const mediaKind = codeOnly(read("src/lib/media-kind.mjs"));
const inlineCards = codeOnly(read("src/features/shared/InlineCards.tsx"));
const userMessage = codeOnly(read("src/features/shared/UserMessageView.tsx"));
const itemView = codeOnly(read("src/features/session-queue/ItemView.tsx"));
const instructions = codeOnly(read("electron/developer-instructions.ts"));

/* ── 本地媒体协议：安全 + 拖动进度 ── */
ok(boot.includes('"harness-media"'), "boot 注册了 harness-media 协议");
ok(
  boot.includes("createReadStream") && boot.includes("toWeb") && boot.includes("Content-Range") && boot.includes("206"),
  "harness-media 必须是流式 + Range/206（整文件读内存 = 大视频卡死）",
);
ok(
  boot.includes("isInsideTrustedRoots") && boot.includes("MEDIA_MIME") && boot.includes("Unsupported media type"),
  "harness-media 安全三件套：可信根 + MIME 白名单 + 拒未知扩展（⛔ 任意文件读取面）",
);
ok(
  main.includes('"harness-media"') && /stream:\s*true/.test(main),
  "main 注册 harness-media scheme 且 stream=true（否则 video 拿不到流）",
);
ok(/media-src[^;]*harness-media:/.test(html), "CSP media-src 放行 harness-media:");
ok(Boolean(pkg.dependencies?.["hls.js"]), "hls.js 已进依赖（Chromium 不原生播 m3u8）");

/* ── 渲染层：弹窗 / 懒加载 / 三处入口 ── */
ok(appView.includes("<MediaPreviewBridge />"), "AppView 挂了 <MediaPreviewBridge />");
ok(styles.includes("styles/39-media-preview"), "styles.css 引入 39-media-preview");
ok(
  media.includes('import("hls.js")') && media.includes("controls") && media.includes("AudioPlayer"),
  "MediaPreview：hls.js 懒加载 + 原生视频 controls + 自绘音频",
);
ok(
  media.includes("openModelViewer") && media.includes("mediaDisplaySrc") && media.includes("registerMediaPreview"),
  "3D 复用 ModelViewerModal；本地路径统一 mediaDisplaySrc；基座通过 ui-channels 打开",
);
ok(
  inlineCards.includes("openMediaPreview") && userMessage.includes("openMediaPreview") && itemView.includes("MediaResultCards"),
  "三处入口齐全：助手文件卡 / 用户附件 / 工具产物",
);
ok(
  mediaKind.includes("m3u8") && mediaKind.includes("isHlsSource") && mediaKind.includes("harness-media://"),
  "media-kind：HLS 识别 + harness-media 双编码入口",
);

/* ── preload / 网关 / 执行端 ── */
ok(
  /onMediaPreviewOpen:\s*\(listener/.test(preload) && preload.includes('"media-preview:open"'),
  "preload 推送桥 onMediaPreviewOpen → media-preview:open",
);
for (const name of ["media_source_search", "media_source_detail", "media_source_open", "media_preview"]) {
  ok(core.includes(`"${name}"`), `网关能力清单包含 ${name}`);
}
ok(
  rpc.includes('"media_source_search"') && rpc.includes('"media_source_detail"') && rpc.includes('"media_source_open"') && rpc.includes('"media_preview"'),
  "dispatch-rpc 四个执行端都在（缺一 = 模型看得到却调不动）",
);
ok(
  sources.includes('sendToWindow("media-preview:open"') && sources.includes("shell.openExternal"),
  "media_source_open：直链推内播 / 网页页交浏览器",
);
ok(
  sources.includes("media-sources.json") && sources.includes("normalizeSourceConfig") && sources.includes("net.fetch"),
  "影视源：userData 覆盖 + 源校验 + 主进程 net.fetch（渲染层不受 CORS 限制）",
);
ok(
  sources.includes('protocol !== "http:"') && sources.includes('protocol !== "https:"'),
  "媒体地址只放行 http(s)（⛔ file:/javascript: 不进播放器/浏览器）",
);
ok(
  instructions.includes("media_source_search") && instructions.includes("media_preview"),
  "常驻指令写了影视源与 media_preview 的用法（工具在表里但模型不知道 = 白配）",
);

console.log(`\n【media】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
