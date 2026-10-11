/**
 * 本地 HTML→MP4 判据（html-video 域，2026-10-11，纯离线、可随预检跑）
 *
 * ⛔ 三条最容易「看起来接好了、其实调的到才怪」的接缝：
 *   ① **模型得调得到**（用户原话「没有工具 codex 调用不了的」）：域注册三处齐全 + 网关工具
 *      `video_render_html` 定义与执行端都在 + 能力技能里写了它 —— 少一处模型就永远调不到；
 *   ② **零 ffmpeg**：编码靠运行时自带的 MP4 编码器（`MediaRecorder` + `video/mp4`）——
 *      不许引入 ffmpeg / 外部编码器（本机实测没有 CLI，307MB 也不该随包）；
 *   ③ **路径两道闸**：源（可信根 + .html 白名单）与输出（可信根）都要挡 —— 这是加载任意本地文件的入口。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【hv】${m}`); } };

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = read("electron/ipc-channels.manifest.json");
/* ⛔ 这份注册表**必须读原文**：note 里常出现 glob 片段（路径后面跟星号、星号星号再跟斜杠），
   `codeOnly()` 的块注释正则会把它当成注释开头，一路吞到下一个闭合标记 —— 实测 codeOnly 只活下来
   7975/28719 字符，model-viewer 之后的域清单**全没了**（用 codeOnly 读它的守卫都在静默失明）。
   本条是**正向**断言（条目真的在），读原文即可；负向断言才必须过 codeOnly。 */
const registry = read("electron/ipc-registry.ts");
const composition = read("electron/composition.json");
const engine = codeOnly(read("electron/html-video.ts"));
const ipc = codeOnly(read("electron/features/html-video-ipc.ts"));
const core = read("electron/features/dispatch-core.ts");
const rpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
const preload = read("electron/preload.ts");
const envDts = read("src/vite-env.d.ts");
const capSkill = read("electron/builtin-skills/14-skill-harness-api.ts");

/* ── ① 注册三处 + 网关工具（模型调得到的完整链）── */
ok(manifest.includes('"channel": "html-video:render"'), "manifest 登记了 html-video:render（IPC 单一真相源）");
ok(registry.includes('prefix: "html-video"') && /prefix: "html-video", count: 1/.test(registry), "ipc-registry 记了 html-video 域（count=1）");
ok(composition.includes('"id": "html-video"') && composition.includes('"features/html-video-ipc.ts"'), "composition.json 登记了 html-video 域（会被组合层挂载）");
ok(preload.includes("htmlVideoRender") && envDts.includes("htmlVideoRender"), "生成物里两处都有 htmlVideoRender（preload 内联段 + vite-env 生成段）");
ok(core.includes('name: "video_render_html"'), "网关工具 video_render_html 有定义（模型经 harness_tools 才调得到）");
ok(rpc.includes('name === "video_render_html"'), "网关执行端有 video_render_html 分支（只定义不执行 = 死工具）");
ok(capSkill.includes("html-video"), "能力技能 harness-api 里写了 html-video（模型读技能才知道有这个能力）");

/* ── ② 零 ffmpeg：编码靠运行时自带 ── */
ok(engine.includes("MediaRecorder") && engine.includes("video/mp4;codecs=avc1") && engine.includes("captureStream(0)") && engine.includes("requestFrame()"),
  "引擎用 MediaRecorder + video/mp4 + captureStream(0)/requestFrame（帧数可控）");
ok(engine.includes("Page.startScreencast") && engine.includes("screencastFrameAck"), "抓帧走 CDP screencast（Chromium 自己出 JPEG，比逐帧 capturePage 快）");
ok(!/ffmpeg|child_process|spawn\(/i.test(engine), "⛔ 不许引 ffmpeg / 起外部进程（本机没有 ffmpeg CLI，307MB 也不该随包）");
ok(engine.includes('buf.slice(4, 8).toString("ascii") !== "ftyp"'), "产出后校验 MP4 box 头（ftyp 在偏移 4..8 —— ⛔ 曾写成 8..12 把自己判成失败）");

/* ── ③ 路径两道闸 ── */
ok(engine.includes("isInsideTrustedRoots") && engine.includes("/\\.(html?|htm)$/i"), "源：可信根 + .html/.htm 白名单（这是加载任意本地文件的入口）");
ok(engine.includes("https?:") && engine.includes("file://"), "http(s) 与 file:// 两条源路径都在（本地文件走 file:// + 白名单，URL 直接放行）");
ok(ipc.includes("isInsideTrustedRoots") && ipc.includes('endsWith(".mp4")'), "输出：越界拒 + 自动补 .mp4 后缀");
ok(engine.includes("nodeIntegration: false") && engine.includes("contextIsolation: true") && engine.includes("sandbox: true"), "舞台窗与编码窗都不给 node 集成（加载外部 HTML 的窗口必须裸跑）");
ok(engine.includes('"will-navigate"') && engine.includes("if (url !== src.url) e.preventDefault()"), "舞台窗禁止导航走：will-navigate 只在目标**不是**给定源时拦截（写成无条件拦截会把首次加载也挡掉）");

console.log(`\n【hv】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
