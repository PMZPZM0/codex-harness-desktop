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
/* ⛔ 10-29 用户令：协议**故意**不再判可信根（任意位置的音视频都要能播）。
   断言反转：MIME 白名单 + 拒未知扩展必须仍在，可信根必须**不在**（防有人把闸加回去）。 */
ok(
  boot.includes("MEDIA_MIME") && boot.includes("Unsupported media type") && !boot.includes("isInsideTrustedRoots"),
  "harness-media 两件套：MIME 白名单 + 拒未知扩展；⛔ 不再判可信根（10-29 用户令）",
);
ok(
  main.includes('"harness-media"') && /stream:\s*true/.test(main),
  "main 注册 harness-media scheme 且 stream=true（否则 video 拿不到流）",
);
ok(/media-src[^;]*harness-media:/.test(html), "CSP media-src 放行 harness-media:");
ok(Boolean(pkg.dependencies?.["hls.js"]), "hls.js 已进依赖（Chromium 不原生播 m3u8）");

/* ── 渲染层：弹窗 / 懒加载 / 三处入口 ── */
ok(appView.includes("<MediaPreviewBridge") && /runningTurnIdsRef={app.runningTurnIdsRef}/.test(appView), "AppView 挂了 <MediaPreviewBridge />（并把当前会话/回合传进去，播放记录才能归到正确回合）");
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
  moekoe.includes('process.platform === "darwin"') && moekoe.includes("/Applications") && moekoe.includes("ditto") && moekoe.includes(".zip"),
  "macOS 适配：/Applications 检测 + zip 用 ditto 解压 + open -a 启动（不是拿 Windows exe）",
);
ok(
  moekoeCore.includes('platform === "darwin"') && moekoeCore.includes("arm64") && moekoeCore.includes(".dmg"),
  "Mac 安装包按 arm64/x64 选 .zip/.dmg（发布包有 arm64 与 x64 两种）",
);
ok(
  moekoe.includes("ppage_id=356753938"),
  "MoeKoe 取流带客户端同款 ppage_id（缺了它付费歌会被判风控/只给 60 秒试听）",
);
ok(
  moekoeCard.includes("仅用于接口调用") && instructions.includes("API invocation only"),
  "MoeKoe 声明：仅接口调用 / 未收费 / 未二创 已写进卡片与常驻指令",
);
ok(
  devtoolsSrc.includes("仅用于第三方接口调用") && instructions.includes("free and not a derivative work"),
  "影视源声明：仅第三方接口调用/检索，不下载/不缓存/不代理，版权归源站",
);
ok(
  moekoe.includes("/search/lyric") && moekoe.includes("/lyric?") && moekoe.includes("/privilege/lite") && moekoe.includes("normalizeMoeKoeSearchType"),
  "MoeKoe 已接文档接口：搜索类型 / 歌词 / 音质权限",
);
for (const name of ["moekoe_lyric", "moekoe_qualities"]) {
  ok(core.includes(`"${name}"`) && rpc.includes(`"${name}"`), `MoeKoe 工具 ${name} 在网关与执行端成对存在`);
}
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
  moekoeCard.includes("kugoumusicapi-docs.4everland.app") && moekoeCard.includes("API 文档") && instructions.includes("kugoumusicapi-docs.4everland.app"),
  "MoeKoe 卡片有 API 文档跳转/复制，常驻指令也带文档地址（Codex 可自己查）",
);
ok(
  moekoeCore.includes("gh-proxy.com") && moekoeCore.includes("ghfast.top") && moekoe.includes("MOEKOE_MIRRORS") && moekoe.includes("confirm !== true"),
  "国内镜像安装通道（官方同款 gh-proxy 优先 + ghfast 兜底）+ 未确认不安装的硬闸",
);
ok(
  moekoeCore.includes("https://api.github.com/repos/iAJue/MoeKoeMusic/releases/latest") && moekoeCore.includes("music.moekoe.cn/download.html") && moekoe.includes("MOEKOE_RELEASE_API"),
  "安装走官方下载源：music.moekoe.cn 同款 iAJue/MoeKoeMusic 最新 release（不是第三方打包站）",
);
ok(
  /platform === "darwin"[\s\S]{0,900}arm64[\s\S]{0,900}x64/.test(moekoeCore) && /wantIa32[\s\S]{0,300}ia32/.test(moekoeCore),
  "安装包按系统+架构检测：macOS arm64/x64、Windows ia32/x64（⛔ 不给 Mac 发 exe、不给 Apple Silicon 发 x64）",
);
ok(
  moekoeCore.includes("pickMoeKoeInstaller") && moekoeCore.includes("hash_offset") && moekoeCore.includes("20028"),
  "安装包选择 + 取流响应归一化（试听/风控识别）",
);
for (const name of ["moekoe_status", "moekoe_search", "moekoe_play", "moekoe_install"]) {
  ok(core.includes(`"${name}"`) && rpc.includes(`"${name}"`), `MoeKoe 工具 ${name} 在网关与执行端成对存在`);
}
ok(rpc.includes("type: args.type"), "moekoe_search 的 type 参数真的传给主进程（否则永远只搜单曲）");
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

/* ── 播放器迷你模式 + 播报浮层让位（11-01 用户令）──────────────────────────
   「开了这个窗口只能 ❌ 掉才能继续干活」+「音乐也要能边听边干活」+「播报悬浮图标/弹窗不能在任何弹窗上」。 */
const previewSrc = codeOnly(read("src/features/media/MediaPreview.tsx"));
const previewCss = read("src/styles/39-media-preview.css");
const dialogCss2 = read("src/styles/18-openai-dialog.css");
ok(/const \[mini, setMini\] = useState\(false\)/.test(previewSrc) && /is-mini/.test(previewSrc) && /startMiniDrag/.test(previewSrc),
  "视频/音频可缩成迷你悬浮窗（同一 DOM ⇒ 播放不中断；标题栏可拖动）");
ok(/requestPictureInPicture|PictureInPicture2/.test(previewSrc) && /playbackRate = rate/.test(previewSrc) && /requestFullscreen/.test(previewSrc),
  "视频：倍速 / 画中画 / 全屏三件都在（原生 controls 没有稳定的倍速菜单）");
ok(/setLoop/.test(previewSrc) && /skip\(-15\)/.test(previewSrc) && /skip\(15\)/.test(previewSrc) && /media-audio-rate/.test(previewSrc),
  "音频：±15 秒 / 循环 / 倍速");
ok(/\.media-preview-backdrop\.is-mini \{[^}]*pointer-events: none;[^}]*z-index: 70/s.test(previewCss),
  "迷你窗不吃点击（pointer-events:none）、z=70（低于设置页 80 / 全局模态 400）");
ok(/\.media-video-bar \{[^}]*display: flex;/s.test(previewCss) && /\.media-video-title \{/s.test(previewCss) && !/\.media-video-tools \{[^}]*position: absolute/s.test(previewCss),
  "视频工具条是上方独立一行（标题+倍速/画中画/全屏），⛔ 不浮在画面上（用户实测位置不对）");
ok(/recordMediaPlayback/.test(previewSrc) && /recordMediaPlayback/.test(codeOnly(read("src/lib/media-playback-store.mjs"))) && /<TurnMediaCard/.test(codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"))),
  "回合汇总下方有播放卡（点击重开；视频/音频同一逻辑）—— 记录 → 卡片 → 回合视图三处接线");
ok(/open\(event, true\)/.test(previewSrc) && /if \(!fromEngine\) return;/.test(previewSrc) && /if \(!turnId\) return;/.test(previewSrc),
  "⛔ 只有引擎打开（Codex 调了视频/音乐工具）且当时有运行中回合才记卡片（用户自己点附件不算）");
ok(/kind !== "video" && kind !== "audio"/.test(previewSrc),
  "⛔ 只给视频/音乐出播放卡（media_preview 也能开 3D 模型，卡片点了会按视频重开 —— 审查发现）");
ok(/body:has\(\[class\*="backdrop"\]\) \.voice-float-layer/.test(dialogCss2) && /body:has\(\[class\*="backdrop"\]\) \.voice-announce-bar/.test(dialogCss2),
  "任何弹窗打开时播报悬浮球与播报条一律隐藏（半透明遮罩下也不露出、不挡按钮）");

/* ── 音乐取流：主链 403/HTML 时换 backup，MIME 笼统时补（11-01 用户实测播放失败）────── */
const bootSrc = codeOnly(read("electron/features/boot.ts"));
const musicStreamsSrc = codeOnly(read("electron/music-streams.ts"));
ok(/Array\.isArray\(urls\)/.test(musicStreamsSrc) && /urls: string\[\]/.test(musicStreamsSrc),
  "音乐取流令牌保留全部候选地址（主链 + backupUrl）");
ok(/for \(const candidate of candidates\)/.test(bootSrc) && /musicMimeOf\(candidate\)/.test(bootSrc)
  && /!isOk \|\| \(!isMedia && type !== "application\/octet-stream"\)/.test(bootSrc),
  "harness-music 协议：按候选逐个试，403/HTML 换下一条；MIME 笼统时按扩展名补");

console.log(`
【media】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
