/**
 * 界面草图板块（`ui-sketch`，2026-10-05 立）判据
 *
 * 起因与风险面：把第三方静态站（m3e-canvas 的 next 导出）嵌进应用，接缝一共**六处**——
 * 侧栏入口 / bag 开关 / AppView 挂载 / 自定义协议 / CSP / 随包产物。
 * ⛔ 这六处**没有任何一处会被 tsc 发现对不上**：少接一处，表现全是"静默白屏"或"点了没反应"，
 * 而 build 与预检照常绿（pet:// 的 CSP 事故就是同一型的假绿，见【232】②）。
 * 所以这里钉的是**接线本身**（不是"文件存在"），并把协议路径解析与文档合并两个纯函数
 * **真跑一遍**（判据必须打到行为，打到字符串会被注释顶成假红）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const norm = (text) => text.replace(/\s+/g, " ").trim();

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【sketch】${message}`);
  if (!condition) fails++;
};

/* ───────────────────────── 一、侧栏「···更多」 ───────────────────────── */

const side = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));

ok(/onClick=\{\(\) => setMoreHubOpen\(true\)\}/.test(side), "「···更多」按钮真的开窗（有 setMoreHubOpen(true)，不是只写着文案）");
ok(/\{moreHubOpen && \(/.test(side), "更多弹窗挂在 moreHubOpen 条件上（⛔ 被改成恒假也算断言通过，所以两条都要钉）");
ok(/className="sidebar-tab"[^>]*aria-expanded=\{moreHubOpen\}/.test(side), "按钮带 aria-expanded（无障碍状态与开窗同源）");

/** hub 窗口：aria-label="更多" → 下一个稳定标记 {projectFilter（⛔ 不用固定字符窗口） */
const hubAt = side.indexOf('aria-label="更多"');
const hubEnd = hubAt >= 0 ? side.indexOf("{projectFilter &&", hubAt) : -1;
const hub = hubAt >= 0 ? side.slice(hubAt, hubEnd > hubAt ? hubEnd : hubAt + 3200) : "";
ok(hub.length > 400, "取到「更多」弹窗的内容窗口（取不到 = 锚点被挪走，下面的分项断言全部不可信）");
ok(hub.includes("setDramaCanvasOpen(true)"), "更多里有「AI 画布工作流」，动作是开画布");
ok(hub.includes("setUiSketchOpen(true)"), "更多里有「界面草图」，动作是开草图");
for (const page of ["knowledge-base", "component-library", "soul-market"]) {
  ok(hub.includes(`setSettingsPage("${page}")`), `更多里有跳设置页 ${page} 的入口`);
}
ok(["AI 画布工作流", "界面草图", "知识库", "组件库", "人格市场"].every((title) => hub.includes(title)), "五项文案齐全");

/** 导航区窗口：aria-label="导航" → 首个 </div>（区内不许有嵌套 div，这是【180】同一口径） */
const navAt = side.indexOf('aria-label="导航"');
const navEnd = navAt >= 0 ? side.indexOf("</div>", navAt) : -1;
const nav = navAt >= 0 && navEnd > navAt ? side.slice(navAt, navEnd) : "";
ok(nav.length > 200, "取到导航区窗口");
ok(!nav.includes("<span>知识库</span>") && !nav.includes("<span>AI 画布工作流</span>"), "知识库 / AI 画布工作流不再平铺在导航区（已收进更多）");
ok(nav.includes("<span>更多</span>"), "导航区里换成了「更多」一项");
ok(!/setSettingsPage\("backup"\)/.test(side), "负向：更多里也不许把「会话备份」入口放回侧栏（【180】同一条纪律）");

/* ───────────────────────── 二、板块接线四处 ───────────────────────── */

const part02 = codeOnly(read("src/features/app-state/parts/part02/03-thread-switch-update/02-update-ui-settings.tsx"));
ok(/const \[uiSketchOpen, setUiSketchOpen\] = useState\(false\);/.test(part02), "bag 里声明了「开没开」这一位（与 dramaCanvasOpen 同档）");
ok(/bag\.uiSketchOpen = uiSketchOpen as typeof bag\.uiSketchOpen/.test(part02) && /return \{[^}]*uiSketchOpen, setUiSketchOpen/.test(part02), "part02 既写 bag 又在 return 面导出（漏一个 = 别人拿不到）");

const bagTypes = read("src/features/app-state/parts/bag-types.ts");
ok(bagTypes.includes("uiSketchOpen: boolean;") && /setUiSketchOpen: React\.Dispatch<React\.SetStateAction<boolean>>;/.test(bagTypes), "bag-types 登记了这一位与它的 setter（漏了 tsc 会红，但顺序/类型写错是静默的）");

const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
ok(/\{uiSketchOpen \&& \(/.test(appView) || appView.includes("{uiSketchOpen && ("), "AppView 按开关渲染草图浮层");
ok(appView.includes("<UiSketchModal") && appView.includes("onClose={() => setUiSketchOpen(false)}"), "浮层接了 onClose（关不掉的模态是回归）");
ok(appView.includes("pendingCommandTextRef.current = text;"), "「交给 Codex」走 ref 塞任务（与画布同一条已验证通路，不受 setPrompt 滞后影响）");

const modal = codeOnly(read("src/features/ui-sketch/UiSketchModal.tsx"));
ok(!/\bbag\./.test(modal), "板块自包含：不直接读 bag（状态只从 props 进、开关只有那一位）");
ok(modal.includes("SKETCH_ENTRY_URL") && /<iframe[\s\S]{0,200}src=\{SKETCH_ENTRY_URL\}/.test(modal), "iframe 的 src 取自建站点常量（不在两处写死 URL）");
ok(modal.includes("data.source !== SKETCH_BRIDGE_SOURCE") || modal.includes("source !== SKETCH_BRIDGE_SOURCE"), "入站消息按 source 标记过滤（不收别人的 postMessage）");
ok(modal.includes('post({ type: "ping" })'), "iframe load 后先 ping（不 ping 就永远不知道桥在不在）");
ok(modal.includes("onLoad=") && modal.includes("setTimeout"), "桥有超时兜底（白屏必须给出可读原因，不许静默）");
ok(/data-bridge=\{bridgeError \? "timeout" : bridgeReady \? "ready" : "pending"\}/.test(modal), "浮层暴露 data-bridge 状态位（验收项「桥握手成功」唯一可观测的判据 —— 跨源 iframe 读不到 DOM）");

/* ───────────────────────── 三、协议与 CSP 三处 ───────────────────────── */

const mainTs = codeOnly(read("electron/main.ts"));
ok(/registerSchemesAsPrivileged\(\[[\s\S]*?scheme: SKETCH_SCHEME[\s\S]*?standard: true[\s\S]*?\]\);/.test(mainTs), "main.ts 把 sketch 声明成 standard 特权协议（缺 standard = 绝对路径全解析错）");
const bootTs = codeOnly(read("electron/features/boot.ts"));
ok(bootTs.includes("protocol.handle(SKETCH_SCHEME, (request) => sketchResponse(request.url));"), "boot.ts 真的接了这个协议（声明了没人接 = iframe 永久空白）");
/* ⛔ 只取 **meta 的 content 字面量本体**，不拿整份 index.html 去正则：文件里讲解 CSP 的注释
   必然写着 `frame-src` 与 `sketch:` 两个词，10-05 变异实测——摘掉真指令后断言照样绿，
   因为匹配从更早那条注释一路跑到了后面（本项目第五次栽在"锚点命中注释"上）。 */
const csp = /<meta http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/.exec(read("index.html"))?.[1] ?? "";
ok(csp.length > 200, "取到 CSP 字面量本体（取不到 = meta 被挪走，下面两条都不可信）");
ok(/frame-src[^;]*sketch:/.test(csp), "CSP 的 frame-src 显式放行 sketch:（本仓口径：* 不覆盖自定义协议，漏写是静默白屏）");
ok(/object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp), "负向：加放行时没把 CSP 的既有硬约束摘掉");

/* ───────────────────────── 四、随包产物与桥同步 ───────────────────────── */

const bridge = read("scripts/sketch-bridge.js");
const HTML = "index.html";
for (const dir of ["public/sketch", "dist/sketch"]) {
  const index = join(ROOT, dir, HTML);
  if (!existsSync(index)) {
    ok(false, `${dir}/${HTML} 不存在（public/ 是提交进仓的源，dist/ 由 Vite 每次 build 拷出）`);
    continue;
  }
  const raw = readFileSync(index, "utf8");
  const html = norm(raw);
  /* ⛔ 只看 `</head>` 之前：body 里那段 React flight 数据原样嵌着 <head> 的元数据字符串，
     整文件正则会被它顶成假红/假绿（10-05 构建脚本就是在这里把产物咬断的）。 */
  const head = raw.slice(0, raw.indexOf("</head>") + 1);
  ok(html.includes(norm(bridge)), `${dir}: 桥的正文已经内联进去（⛔ 只改 scripts/sketch-bridge.js 不重跑构建 = 没生效）`);
  ok(!/<link[^>]+href=["']https:\/\/fonts\.(googleapis|gstatic)/.test(head), `${dir}: head 里的字体外链已换成本地路径`);
  ok(/<link[^>]+href=["']\/fonts\/roboto\.css/.test(head) === existsSync(join(ROOT, dir, "fonts", "roboto.css")), `${dir}: 本地字体样式表与引用同时存在（缺一边就是白图标）`);
  ok(html.includes('src="/_next/'), `${dir}: 资源引用仍是站点根绝对路径（与 protocol 的"站点即根"口径一对上才不 404）`);
}

const docs = ["public/sketch/CANVAS-BUILD.json", "public/sketch/LICENSE", "public/sketch/NOTICE", "scripts/build-sketch-bundle.mjs"];
for (const doc of docs) ok(existsSync(join(ROOT, doc)), `${doc} 在（出处 / MIT 许可 / 刷新工具，少一个将来没人知道这 4MB 是怎么来的）`);

/* ───────────────────────── 五、真跑：协议路径解析 ───────────────────────── */

const sketchRequire = createRequire(import.meta.url);
const protocol = sketchRequire(join(ROOT, "dist-electron", "sketch-protocol.js"));
const ROOT_DIR = join(ROOT, "dist", "sketch");

ok(protocol.sketchBundleReady(ROOT_DIR) === true, "真跑：dist/sketch 就绪判定为真");
ok(protocol.sketchBundleReady(join(ROOT, "dist", "definitely-not-here")) === false, "真跑：目录不在时为假（这条不为假说明判据是恒真的）");

const rootIndex = protocol.resolveSketchFile("sketch://app/", ROOT_DIR);
ok(rootIndex.ok === true && resolve(rootIndex.file) === resolve(join(ROOT_DIR, HTML)), "真跑：站点根落到 index.html（协议根 = 站点，绝对路径才对得上）");

const chunk = readdirSync(join(ROOT_DIR, "_next", "static", "chunks")).find((name) => name.endsWith(".js"));
const jsFound = protocol.resolveSketchFile(`sketch://app/_next/static/chunks/${chunk}`, ROOT_DIR);
ok(jsFound.ok === true && jsFound.mime === "text/javascript; charset=utf-8", "真跑：JS 的 Content-Type 是 text/javascript（MIME 不对时模块脚本会被 Chromium 拒执行）");

const escaped = protocol.resolveSketchFile("sketch://app/..%5C..%5Cwindows%5Cwin.ini", ROOT_DIR);
ok(escaped.ok === false && escaped.status === 403, "真跑：反斜杠编码的路径想逃出站点根 ⇒ 403（这是这条协议唯一真正的攻击面）");
const unicode = protocol.resolveSketchFile("sketch://app/%2e%2e%2f%2e%2e%2fpackage.json", ROOT_DIR);
ok(unicode.ok === false && (unicode.status === 403 || unicode.status === 404), "真跑：点号斜杠编码也出不去（403 或 404，绝不给仓库根的 package.json）");
ok(protocol.resolveSketchFile("sketch://app/harness.exe", ROOT_DIR).status === 415, "真跑：白名单外的扩展名 415");
ok(protocol.resolveSketchFile("sketch://app/_next/static/chunks/nope.js", ROOT_DIR).status === 404, "真跑：白名单内但不存在的文件 404");

/* ───────────────────────── 六、真跑：文档合并与提示词 ───────────────────────── */

const doc = await import(pathToFileURL(join(ROOT, "src", "features", "ui-sketch", "sketch-doc.mjs")).href);

ok(doc.summarizeDoc(null).valid === false && doc.summarizeDoc({ groups: [], frames: [] }).valid === true, "真跑：summarizeDoc 只认上游的最低形状（groups + frames 两个数组）");
const hash = doc.encodeShareHash({ title: "a&b", note: "#6750A4 + x" });
ok(hash.startsWith("#doc=") && !hash.includes("&") && hash.includes("%26") && hash.includes("%2B"), "真跑：#doc= 编码把 & 与 + 都转义了（漏一步上游只会收到半份文档）");

const buttons = { id: "serious-mule-65", cat: "Buttons", name: "Hover Button", author: "ada", html: "<button>x</button>" };
const loaders = { id: "abcd-1", cat: "loaders", name: "Spinner", author: "bob", html: "<div></div>" };
const first = doc.appendComponents({ title: "T", groups: [], frames: [] }, [buttons, loaders]);
const group = first.doc.groups[0];
ok(first.added.length === 2 && first.skipped.length === 0 && group.axis === "y" && group.items.length === 2, "真跑：两个组件追加成一个新组");
ok(group.items[0].kind === "button" && group.items[1].kind === "box", "真跑：类目 → 上游 kind 的映射生效（Buttons→button、loaders→box）");
ok(group.items.every((item) => typeof item.id === "string" && typeof item.label === "string" && (item.icon === null || typeof item.icon === "string") && item.variant === "filled"), "真跑：每个 item 都带上游必需的四件套 + variant（少一件整份文档会被 isProject 拒）");
ok(doc.componentNote(buttons).includes('ui_component_get("serious-mule-65")'), "真跑：note 里带组件 id 与取源码的工具名（上游把 note 原样写进它导出的提示词）");
const again = doc.appendComponents(first.doc, [buttons, loaders]);
ok(again.added.length === 0 && again.skipped.length === 2 && again.doc.groups.length === first.doc.groups.length, "真跑：重复送同一批是幂等的（连点两次不许堆两份）");
const withExisting = doc.appendComponents({ title: "T", groups: [{ id: "g", x: 100, y: 200, axis: "x", items: [{ id: "nh-keep", kind: "box", label: "k", icon: null, variant: "filled" }] }], frames: [{ id: "f", name: "Home", x: 0, y: 0 }] }, [buttons]);
ok(withExisting.doc.groups.length === 2 && withExisting.doc.groups[0].items[0].id === "nh-keep", "真跑：追加不动用户已有的组（只往 groups 尾部加）");
ok(doc.appendComponents({ title: "T", groups: [], frames: [] }, []).added.length === 0, "真跑：空选择不产生空组（上游 items 长度必须 ≥1）");
ok(doc.appendComponents("不是文档", [buttons]).doc === null, "真跑：文档不合法时返回 null 而不是硬拼一份");

const spot = doc.pickSpot({ groups: [{ x: 0, y: 0, items: [] }], frames: [{ x: 0, y: 0 }] });
ok(spot.x > 0 && spot.y > 0, "真跑：新组落在已有内容右下方（盖住用户摆好的东西是回归）");

const prompt = doc.buildComponentPrompt(first.doc, [buttons, loaders]);
ok(prompt.inlined === 2 && prompt.text.includes("<button>x</button>") && prompt.text.includes("原样使用"), "真跑：短组件直接把 HTML/CSS 放进任务正文");
const fat = { id: "fat-1", cat: "Cards", name: "Big", author: "eve", html: "<div>" + "z".repeat(doc.PROMPT_HTML_BUDGET) + "</div>" };
const mixed = doc.buildComponentPrompt(first.doc, [buttons, fat]);
ok(mixed.inlined === 1 && mixed.referenced === 1 && mixed.text.includes("#fat-1"), "真跑：超预算的那个改成只给 id，让引擎自己用 ui_component_get 取（⛔ 不许把正文截一半塞进去）");

/* ───────────────────────── 七、跨进程 / 跨产物的字面量对账 ───────────────────────── */

/* electron/ 与 src/ 是两份独立产物、互不 import ⇒ 同一个值各写一份字面量时必须逐字比对
   （本仓既有纪律：见 AGENTS.md「两个改了就影响所有会话的默认值」）。这里有三处这样的对子。 */
ok(doc.SKETCH_DOC_KEY === "m3e:doc" && bridge.includes(`var DOC_KEY = "${doc.SKETCH_DOC_KEY}"`),
  "草图存储键两侧同源（桥在草图那一侧、常量在宿主这一侧，改一边就是「永远读不到」）");
const originLiteral = /export const SKETCH_ORIGIN = "([^"]+)"/.exec(read("src/features/ui-sketch/sketch-doc.mjs"))?.[1] ?? "";
ok(originLiteral === `${protocol.SKETCH_SCHEME}://app`, "渲染层的站点 origin 与主进程的协议名同源（协议改名不会让 iframe 报错，只会白屏）");
ok(/SyntaxError/.test(doc.describeDiag({ errors: ["SyntaxError: x"], root: false, boot: true, locks: true }))
  && /骨架屏/.test(doc.describeDiag({ root: false, boot: true, locks: true }))
  && /正常/.test(doc.describeDiag({ root: true, keys: 3, locks: true })),
  "真跑：诊断文案区分得开「脚本报错 / 停在骨架屏 / 一切正常」（跨源看不见里面，这是唯一的解释通道）");

console.log(`\n【sketch】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
