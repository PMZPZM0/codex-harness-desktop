/**
 * HTML 实时预览板块判据（10-18 立）
 *
 * 用户令：「写 html 文件的时候，自动打开右边浏览器，会话窗口可以自动缩小一点比例，
 * 把右边展示全，实时渲染 html 内容」。
 *
 * 失效方式全是有害且往往静默的：
 *   · 监听路径不校验可信根 / 扩展名 ⇒ 渲染层能借预览读任意文件；
 *   · 监听单文件而不是目录 ⇒ 编辑器「写临时文件再 rename」的原子保存跟丢，页面不再更新；
 *   · 每次 live 报告都把累计文件全带回来 ⇒ 在两个 HTML 间来回跳（seen 集合漏了）；
 *   · 用普通 reload ⇒ file:// 走 Chromium 缓存，看起来「实时」其实一直是旧页面；
 *   · 后台专家会话写 HTML 也抢当前右栏 ⇒ 用户正在看的页面被切走；
 *   · 独立弹窗没有右栏却挂桥 ⇒ 无效监听 + 潜在空引用。
 * 行为（真写 HTML / 真重载）由验收 `html-preview` 覆盖；本守卫钉纯函数、接线与边界。
 * 独立守卫（不进 _ctx MODULES 计数），已挂进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【html-preview】${message}`);
  if (!condition) fails++;
};

/* ── 一、纯函数：HTML 识别 / 选目标 / file URL / store ───────────────────── */
const { HTML_FILE_RE, isHtmlPath, pickHtmlPreviewPath } = await import("../../src/features/html-preview/html-file.mjs");
const { toFileUrl } = await import("../../src/lib/file-url.mjs");
const store = await import("../../src/lib/html-preview-store.mjs");
{
  ok(HTML_FILE_RE.test("a.html") && isHtmlPath("a.htm") && isHtmlPath("dir/A.XHTML") && !isHtmlPath("a.css") && !isHtmlPath("html"),
    "只认 .html / .htm / .xhtml（大小写不敏感），CSS/文本不算");
  const files = [
    { path: "a.html", status: "added" },
    { path: "b.htm", status: "modified" },
    { path: "c.html", status: "deleted" },
  ];
  ok(pickHtmlPreviewPath(files, "", []) === "b.htm",
    "首次报告：挑最新一个未删的 HTML（删除的不预览）");
  ok(pickHtmlPreviewPath(files, "a.html", ["a.html", "b.htm"]) === "a.html",
    "都见过：保持上次那个，不来回跳");
  ok(pickHtmlPreviewPath(files, "", ["a.html"]) === "b.htm", "新出现一个未见过的 HTML ⇒ 切到它");
  ok(pickHtmlPreviewPath([{ path: "a.html", status: "deleted" }], "", []) === "", "全是删除 / 没有 HTML ⇒ 不预览");

  const url = toFileUrl("D:\\项目\\a b.html");
  ok(url === "file:///D:/%E9%A1%B9%E7%9B%AE/a%20b.html" && !url.includes("%3A") && !url.includes("\\"),
    "toFileUrl：中文逐段编码、盘符冒号保留、反斜杠归一（10-17 两个空白页坑）");

  const events = [];
  const off = store.subscribeHtmlPreview((event) => events.push(event));
  store.setHtmlPreview({ path: "a.html", url: "file:///a.html" });
  store.notifyHtmlPreviewChanged("b.html");
  store.notifyHtmlPreviewChanged("a.html");
  off();
  store.setHtmlPreview(null);
  ok(events.length === 2 && events[0]?.reason === "open" && events[1]?.reason === "changed" && events[1]?.path === "a.html",
    "store：打开/变更只通知对应文件，退订后不再通知");
}

/* ── 二、主进程域：可信根 / 目录 watch / 防抖 / 清理 ───────────────────────── */
const domain = codeOnly(read("electron/features/html-preview-ipc.ts"));
{
  ok(/defineFeature<null>\(\{[\s\S]{0,120}?id: "html-preview"/.test(domain),
    "独立域：defineFeature id = html-preview");
  ok(domain.includes('ipcHost.handle("html-preview:watch"') && domain.includes('ipcHost.handle("html-preview:unwatch"'),
    "watch / unwatch 两个通道在");
  ok(domain.includes("isInsideTrustedRoots") && domain.includes("HTML_FILE_RE.test"),
    "路径先过可信根 + 扩展名白名单（渲染层传什么都越不出去）");
  ok(domain.includes("fs.watch(dir") && domain.includes("persistent: false") && domain.includes("name !== base"),
    "监听**目录**并按 basename 过滤（原子保存不跟丢；不拖住 Node 退出）");
  ok(/setTimeout\([\s\S]{0,200}?\}, 120\)/.test(domain) && domain.includes("clearTimeout(debounce)"),
    "120ms 防抖（一次保存的多条事件合并成一条）");
  ok(domain.includes('type: "html-preview:changed"') && domain.includes("broadcastHarnessEvent"),
    "变更广播 harness 事件 html-preview:changed（渲染层用同一条 onHarnessEvent 收）");
  ok(domain.includes("ctx.effect(() => () => stopWatch())") && domain.includes("watcher.close()"),
    "换文件 / 卸载 / 退出都会 close 监听器");
  ok(!/\breadFile(Sync)?\s*\(/.test(domain),
    "主进程不读 HTML 正文（预览由 webview 渲染，避免把文件内容搬进 IPC）");
}

/* ── 三、IPC 三件套 + 组合表 ──────────────────────────────────────────────── */
const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registry = read("electron/ipc-registry.ts");
const composition = JSON.parse(read("electron/composition.json"));
const preload = read("electron/preload.ts");
const catalog = read("src/lib/extensibility-catalog.mjs");
{
  const channels = (manifest.channels ?? manifest).map((entry) => entry.channel);
  ok(channels.includes("html-preview:watch") && channels.includes("html-preview:unwatch"),
    "manifest 有 html-preview:watch / unwatch");
  ok(registry.includes('prefix: "html-preview"') && registry.includes('"html-preview:watch"') && registry.includes('"html-preview:unwatch"'),
    "registry 登记了 html-preview（prefix + 两条通道）");
  const row = (composition.domains ?? []).find((entry) => entry.id === "html-preview");
  ok(!!row && row.enabled === true && row.file === "features/html-preview-ipc.ts" && row.export === "htmlPreviewFeature",
    "组合表启用 html-preview 且 file/export 对得上（gen:domains 才会挂）");
  ok(preload.includes("htmlPreviewWatch") && preload.includes("htmlPreviewUnwatch"),
    "preload 生成物有 htmlPreviewWatch / htmlPreviewUnwatch");
  const count = Number(/IPC_CHANNEL_COUNT = (\d+)/.exec(catalog)?.[1] ?? -1);
  ok(count === Number(manifest.count), `拓展接口页的 IPC 计数与 manifest 一致（${count} vs ${manifest.count}）`);
}

/* ── 四、渲染层：自动开 / 加宽 / 只跟当前会话 / 无缓存重载 ─────────────────── */
const bridge = codeOnly(read("src/features/html-preview/HtmlPreviewBridge.tsx"));
const browser = codeOnly(read("src/components/BrowserPane.tsx"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const paths = codeOnly(read("src/features/app-view/helpers/paths.ts"));
const fileUrl = read("src/lib/file-url.mjs");
const fileUrlCode = codeOnly(fileUrl);
{
  ok(bridge.includes('"turn-file-changes-live"') && bridge.includes('"turn-file-changes"'),
    "桥同时听运行中 live 与收尾报告（回合太快没赶上 live 也能开）");
  ok(bridge.includes("currentThreadHasTurn") && bridge.includes("turn?.id") && bridge.includes("thread?.turns"),
    "只认当前会话的回合（后台专家/被调度会话写 HTML 不抢右栏）");
  ok(bridge.includes("liveTurnsRef") && /liveTurnsRef\.current\.has\(turnId\)/.test(bridge) && /liveTurnsRef\.current\.delete\(turnId\)/.test(bridge),
    "收尾报告只认本会话 live 过的回合（切回会话重播的历史报告不自动打开已有 HTML —— 用户 10-18 实测）");
  ok(bridge.includes("pickHtmlPreviewPath") && bridge.includes("seenRef"),
    "用 seen 集合选新文件（累计报告不会在两个 HTML 间来回跳）");
  ok(bridge.includes("htmlPreviewWatch?.({ path })") && bridge.includes("openInBrowserPane") && bridge.includes("setPanelWidth"),
    "检测到 HTML：主进程 watch + 打开右栏浏览器 + 自动加宽");
  ok(bridge.includes("PANEL_RATIO = 0.45") && bridge.includes("PANEL_MIN = 360") && bridge.includes("PANEL_MAX = 560"),
    "加宽比例：窗口 45%，钳在 360~560（会话区缩一点、右栏不外溢）");
  ok(appView.includes("HtmlPreviewBridge") && /!popoutThreadId && <HtmlPreviewBridge/.test(appView),
    "桥只在主窗口挂（独立弹窗没有右栏）");
  ok(browser.includes("subscribeHtmlPreview") && browser.includes("reloadIgnoringCache"),
    "BrowserPane 订阅 store，文件变了用 reloadIgnoringCache（普通 reload 会吃 file:// 缓存）");
  ok(browser.includes('from "../lib/html-preview-store.mjs"') && !browser.includes("features/html-preview/store"),
    "BrowserPane 从**基座** store 订阅（src/components 不反向 import 域 —— 守卫【130】）");
  ok(!bridge.includes("app-state/useHarnessApp") && bridge.includes("export type HtmlPreviewHost"),
    "桥只依赖结构化 HtmlPreviewHost（不深链 app-state 的 HarnessAppApi —— 守卫【130】）");
  ok(browser.includes('event.reason !== "changed"') && browser.includes("active.url !== event.url"),
    "只重载当前标签且 URL 对得上的预览（用户导航到别处不抢）");
  ok(!/function toFileUrl/.test(paths) && /export \{ toFileUrl \} from "\.\.\/\.\.\/\.\.\/lib\/file-url\.mjs"/.test(paths),
    "toFileUrl 已下沉基座并被 helpers re-export（预览板块不深链 app-view）");
  ok(!fileUrlCode.includes("D%3A") && fileUrl.includes("盘符冒号") && fileUrlCode.includes("encodeURIComponent(seg)"),
    "file-url 基座保留盘符冒号 / 逐段编码的 10-17 修复（负向断言先剥注释）");
}

console.log(`\n【html-preview】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
