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
let musicStreams = "";
try {
  boot = read("dist-electron/features/boot.js");
  main = read("dist-electron/main.js");
  preload = read("dist-electron/preload.js");
  core = read("dist-electron/features/dispatch-core.js");
  rpc = read("dist-electron/features/dispatch-rpc.js");
  sources = read("dist-electron/media-sources.js");
  musicStreams = read("dist-electron/music-streams.js");
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

/* ── MoeKoe Music（10-20）：本地 API 对接 + 安装通道 + 应用内播放 ── */
const moekoe = codeOnly(read("electron/moekoe.ts"));
const moekoeCore = codeOnly(read("electron/moekoe-core.ts"));
const devRuntimesSrc = codeOnly(read("electron/features/dev-runtimes.ts"));
const runtimeIpcSrc = codeOnly(read("electron/features/runtime-ipc.ts"));
const devtoolsSrc = codeOnly(read("src/features/settings-devtools/DevtoolsSettingsSection.tsx"));
const moekoeCard = codeOnly(read("src/features/settings-devtools/MoeKoeCard.tsx"));
ok(
  moekoe.includes("127.0.0.1:6521") && moekoe.includes("/search") && moekoe.includes("/song/url") && moekoe.includes("/register/dev"),
  "MoeKoe 对接：6521 /register/dev → /search → /song/url（不是模拟 UI 点击）",
);
ok(
  moekoe.includes("MoeKoe Music.exe") && moekoe.includes("Program Files") && moekoe.includes("findMoeKoeExe"),
  "安装检测覆盖自定义盘符的 Program Files（本机 D:\\Program Files\\MoeKoe Music）",
);
ok(
  moekoe.includes("ppage_id=356753938"),
  "MoeKoe 取流带客户端同款 ppage_id（缺了它付费歌会被判风控/只给 60 秒试听）",
);
ok(
  devRuntimesSrc.includes("moekoe:") && devRuntimesSrc.includes("findMoeKoeExe"),
  "开发工具 runtime 清单登记 MoeKoe，并用 exe 检测安装态（自定义盘符也能识别）",
);
ok(
  runtimeIpcSrc.includes('id === "moekoe"') && runtimeIpcSrc.includes("installMoeKoe"),
  "runtime:install 有 MoeKoe 专用分支：国内镜像下载 → 等安装向导完成 → 启动",
);
ok(
  runtimeIpcSrc.includes("moekoe_install") && runtimeIpcSrc.includes("不要用 install-runtimes"),
  "MoeKoe 安装失败提示词走 moekoe_install，不指向不存在的 runtime 脚本",
);
ok(
  devtoolsSrc.includes("MoeKoeCard") && devtoolsSrc.includes('"moekoe"') && moekoeCard.includes("安装 MoeKoe Music") && moekoeCard.includes("runtime-progress-bar"),
  "开发工具页有 MoeKoe 安装卡（手动安装/启动 + 复用 runtime 进度）",
);
ok(
  moekoe.includes("gh-proxy.com") && moekoe.includes("ghfast.top") && moekoe.includes("confirm !== true"),
  "国内镜像安装通道 + 未确认不安装的硬闸",
);
ok(
  moekoeCore.includes("pickMoeKoeInstaller") && moekoeCore.includes("hash_offset") && moekoeCore.includes("20028"),
  "安装包选择 + 取流响应归一化（试听/风控识别）",
);
for (const name of ["moekoe_status", "moekoe_search", "moekoe_play", "moekoe_install"]) {
  ok(core.includes(`"${name}"`) && rpc.includes(`"${name}"`), `MoeKoe 工具 ${name} 在网关与执行端成对存在`);
}
ok(
  instructions.includes("moekoe_search") && instructions.includes("MoeKoe") && instructions.includes("VIP"),
  "常驻指令写了 MoeKoe 用法、VIP 限制与安装确认规则",
);
ok(
  boot.includes('"harness-music"') && boot.includes("getMusicStream") && main.includes('"harness-music"') && /media-src[^;]*harness-music:/.test(html),
  "harness-music 令牌代理仍在（MoeKoe 取流交给应用内播放器）",
);
ok(
  musicStreams.includes("createMusicStream") && musicStreams.includes("getMusicStream") && media.includes("poster?: string") && mediaKind.includes("harness-music:"),
  "取流令牌 + 音频封面 + mediaDisplaySrc 放行 harness-music:",
);
ok(
  !pkg.dependencies?.axios && !pkg.dependencies?.cheerio && !pkg.dependencies?.["crypto-js"],
  "MusicFree 插件依赖已移除（专注 MoeKoe，不把远程插件运行时带进包）",
);

console.log(`
【media】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
