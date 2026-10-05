/**
 * 前端开发板块（`ui-sketch`，2026-10-05 立；两轮改名：界面草图 → 手机前端UI → 前端开发）判据
 *
 * 起因与风险面：把第三方静态站（m3e-canvas 的 next 导出）嵌进应用，接缝一共**六处**——
 * 侧栏入口 / bag 开关 / AppView 挂载 / 自定义协议 / CSP / 随包产物。
 * ⛔ 这六处**没有任何一处会被 tsc 发现对不上**：少接一处，表现全是"静默白屏"或"点了没反应"，
 * 而 build 与预检照常绿（pet:// 的 CSP 事故就是同一型的假绿，见【232】②）。
 * 所以这里钉的是**接线本身**（不是"文件存在"），并把协议路径解析与文档合并两个纯函数
 * **真跑一遍**（判据必须打到行为，打到字符串会被注释顶成假红）。
 *
 * 10-05 下午加**写入通道**（用户点名：「Codex 可以直接调用这个工具，继续拼装 UI 界面」）后，
 * 接缝又添三处：工具面（part08 注册 ↔ part05 分发 ↔ barrel 导入）/ 会话单例（弹窗 attach ↔
 * 工具请求）/ 桥的写路径（`#docz=` 编码 ↔ 上游 arrive）。这三处同样全是 tsc 看不见的
 * （工具名两边对不上 = 引擎回 not registered；会话没 attach = 请求发进空气）。
 * 判据把 bridge 原文塞进 VM **真跑**（正常写入 / 无 CompressionStream 回落 / 上游拒收 /
 * 预览触发），并真跑会话单例的串行队列、关窗拒绝与 StrictMode 重挂载语义。
 *
 * 10-05 夜三件事：**一键预览**（用户：「加一个对话框预览这个UI界面」）—— 弹窗按钮 → 桥代点
 * 上游播放键 → preview-result 回执，三处字面量任一漂移都是"点了没反应"；**改名链**
 * sketch_* → mobile_ui_* → **frontend_***（随展示名：界面草图 → 手机前端UI → 前端开发，第三代
 * 用户点名「手机电脑 网页前端UI都有」）；**组件手册技能 frontend-canvas**（用户：「UI里面的组件…
 * 再丰富一些」，36 种字段速查 + 手机/电脑/网页三形态）。工具名两侧同源之外，常驻指令（第 13 条）
 * 与技能名也必须点名同一份东西（名字漂移 = 模型去找不存在的东西）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
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
ok(hub.includes("setUiSketchOpen(true)"), "更多里有「前端开发」，动作是开界面窗");
for (const page of ["knowledge-base", "component-library", "soul-market"]) {
  ok(hub.includes(`setSettingsPage("${page}")`), `更多里有跳设置页 ${page} 的入口`);
}
ok(["AI 画布工作流", "前端开发", "知识库", "组件库", "人格市场"].every((title) => hub.includes(`<strong>${title}</strong>`)), "五项文案齐全且锚的是**列表项标签本体**（<strong> 定界 —— 名字只出现在 title 属性里不算；10-05 夜变异实测抓出来的弱断言）");

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

/* 写入通道（10-05 下午）：桥侧的硬规矩 —— 写回只走**上游自己的导入**
   （分享哈希 `#docz=` → hashchange → arrive()，有校验、可 Ctrl+Z 撤销）。
   ⛔ 桥直接碰存储（setItem/removeItem）= 绕过上游的校验与撤销栈 ⇒ 明令禁止。
   运行时再验一遍（第十节 VM 真跑），静态这层先把形态钉住。 */
const bridgeCode = codeOnly(bridge);
ok(!/localStorage\.(setItem|removeItem)/.test(bridgeCode), "负向：桥从不写画布存储（写回只经上游导入通道 —— 跳过它 = 绕过上游校验与撤销栈）");
ok(/location\.hash = hash/.test(bridgeCode) && bridgeCode.includes('data.type === "load-doc"'), "桥实现 load-doc：把文档编码成分享哈希挂到 location.hash，落盘交给上游自己");
ok(!/appendChild\(|document\.cookie|indexedDB|sessionStorage/.test(bridgeCode), "负向：除分享哈希外不碰别的持久面（cookie / indexedDB / sessionStorage / DOM 注入一律不许）");

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

/* ───────────────────────── 六、真跑：摘要与任务正文 ───────────────────────── */

const doc = await import(pathToFileURL(join(ROOT, "src", "features", "ui-sketch", "sketch-doc.mjs")).href);

ok(doc.summarizeDoc(null).valid === false && doc.summarizeDoc({ groups: [], frames: [] }).valid === true, "真跑：summarizeDoc 只认上游的最低形状（groups + frames 两个数组）");

const sample = {
  title: "Recipes",
  frames: [{ id: "home", name: "Home", x: 0, y: 0, note: "列出已存菜谱" }, { id: "detail", name: "Recipe", x: 492, y: 0 }],
  groups: [
    { id: "g1", x: 0, y: 0, axis: "x", items: [{ id: "bar", kind: "topAppBar", label: "Recipes", icon: "menu", variant: "filled" }] },
    { id: "g2", x: 492, y: 112, axis: "y", items: [{ id: "r1", kind: "listItem", label: "Soup", icon: null, variant: "filled", action: { to: "detail", transition: "slide" }, note: "点开详情" }] },
  ],
};
const built = doc.buildSketchPrompt(sample);
ok(built.frames === 2 && built.items === 2, "真跑：摘要数得对（2 屏 / 2 部件）");
ok(built.text.includes('屏「Home」：列出已存菜谱') && built.text.includes('· topAppBar「Recipes」'), "真跑：任务正文按屏列出部件（坐标归属：组的 x 落进哪一屏）");
ok(built.text.includes('· listItem「Soup」 → 跳到「detail」 —— 点开详情'), "真跑：跳转关系与 note 都进正文（导航是草图最有价值的信息，note 上游本来就承诺原样进提示词）");
ok(!built.text.includes("g1") && !built.text.includes("nh-"), "真跑：正文不泄漏上游内部 id（对实现方没有意义，还会诱导它照抄）");
ok(doc.buildSketchPrompt({ title: "x", groups: [], frames: [] }).text === "", "真跑：空画布不产出任务（发一条空指令 = 白跑一个回合）");
ok(doc.buildSketchPrompt(null).text === "" && doc.buildSketchPrompt("不是文档").text === "", "真跑：形状不对时同样不产出");

/* ── 写回前置校验（10-05 下午）：口径**抄自上游的导入校验**（bundle 里 `fL`/`fz`/`fE`/`fT`
   四个判别式 + `lp`/`sZ` 两张表）。为什么必须在这里判：写回走「分享哈希 → 上游 arrive()」，
   文档不合规时上游**静默拒收**（哈希改了、画布没动）—— 模型拿不到任何可读反馈。
   每条断言都打到"该拒的拒、该放的行"，理由文案要点名问题种类（模型据此自改）。 ── */
const baseDoc = {
  frames: [{ id: "f1", name: "首页", x: 0, y: 0 }],
  groups: [{ id: "g1", x: 0, y: 0, axis: "x", items: [{ id: "i1", kind: "topAppBar", label: "标题", icon: null, variant: "filled" }] }],
};
const brokenDoc = (mutate) => { const copy = JSON.parse(JSON.stringify(baseDoc)); mutate(copy); return copy; };
ok(doc.validateSketchDoc(baseDoc).ok === true, "真跑：合法文档放行");
ok(doc.validateSketchDoc(null).ok === false && doc.validateSketchDoc({ frames: [], groups: [] }).ok === false, "真跑：不是文档 / 一个屏都没有 ⇒ 拒");
ok(doc.validateSketchDoc(brokenDoc((d) => { delete d.frames[0].name; })).reason.includes("屏"), "真跑：屏缺 name ⇒ 拒且原因点名屏（x、y 必须是数字是上游硬要求）");
ok(doc.validateSketchDoc(brokenDoc((d) => { d.groups[0].axis = "z"; })).ok === false, "真跑：axis 只认 x / y");
ok(doc.validateSketchDoc(brokenDoc((d) => { d.groups[0].items = []; })).ok === false, "真跑：空组 ⇒ 拒（上游要求每组至少一个部件）");
ok(doc.validateSketchDoc(brokenDoc((d) => { d.groups[0].items[0].kind = "tabBar"; })).reason.includes("kind"), "真跑：不在枚举的 kind ⇒ 拒且原因点名 kind（附常用示例）");
ok(doc.validateSketchDoc(brokenDoc((d) => { delete d.groups[0].items[0].variant; })).reason.includes("variant"), "真跑：variant 缺失 ⇒ 拒（上游 fz 里它是必填，不是可选）");
ok(doc.validateSketchDoc(brokenDoc((d) => { d.groups[0].items[0].icon = undefined; })).ok === false, "真跑：icon 必须显式写出（string 或 null，不能省）");
ok(doc.validateSketchDoc({ ...baseDoc, platform: "ios" }).ok === false, "真跑：platform 只认 android / web");
const allKindsPass = doc.SKETCH_ITEM_KINDS.every((kind) => doc.validateSketchDoc(brokenDoc((d) => { d.groups[0].items[0].kind = kind; })).ok === true);
ok(allKindsPass, `真跑：${doc.SKETCH_ITEM_KINDS.length} 种 kind 逐项可写（枚举里每一项都是放行的，不是抄来凑数）`);

/* 组件库面板 10-05 被用户判掉（「跟左边那些不适配，加进来没啥用」）⇒ 留负向断言防复活。
   ⛔ 必须过 codeOnly：本文件与板块自己的注释里必然会提到"组件库"三个字。 */
ok(!/组件库|loadCategory|SkinHost|UI_SKIN/.test(modal), "负向：草图弹窗里没有组件库面板（要浏览控件去「设置 → 组件库」，别在草图里再造一份）");
/* ⛔ 「桥是只读的」那条负向 10-05 下午**按用户要求翻转**（Codex 现在能写回）——
   但"写入口唯一"这条负向同样要钉：两处发 load-doc 就是两条真相（组件库面板的教训同型）。 */
ok(!/"load-doc"/.test(modal), "负向：弹窗自己不发生成 load-doc（写入口唯一 = 会话单例）");
ok(!/appendComponents|componentNote|encodeShareHash/.test(read("src/features/ui-sketch/sketch-doc.mjs")), "负向：纯函数层不残留写入侧的旧实现（删了面板就要删干净）");

/* ───────────────────────── 七、跨进程 / 跨产物的字面量对账 ───────────────────────── */

/* electron/ 与 src/ 是两份独立产物、互不 import ⇒ 同一个值各写一份字面量时必须逐字比对
   （本仓既有纪律：见 AGENTS.md「两个改了就影响所有会话的默认值」）。这里有三处字面量对子
   + 两张枚举表（kind / variant）。 */
ok(doc.SKETCH_DOC_KEY === "m3e:doc" && bridge.includes(`var DOC_KEY = "${doc.SKETCH_DOC_KEY}"`),
  "草图存储键两侧同源（桥在草图那一侧、常量在宿主这一侧，改一边就是「永远读不到」）");
const originLiteral = /export const SKETCH_ORIGIN = "([^"]+)"/.exec(read("src/features/ui-sketch/sketch-doc.mjs"))?.[1] ?? "";
ok(originLiteral === `${protocol.SKETCH_SCHEME}://app`, "渲染层的站点 origin 与主进程的协议名同源（协议改名不会让 iframe 报错，只会白屏）");
ok(/SyntaxError/.test(doc.describeDiag({ errors: ["SyntaxError: x"], root: false, boot: true, locks: true }))
  && /骨架屏/.test(doc.describeDiag({ root: false, boot: true, locks: true }))
  && /正常/.test(doc.describeDiag({ root: true, keys: 3, locks: true })),
  "真跑：诊断文案区分得开「脚本报错 / 停在骨架屏 / 一切正常」（跨源看不见里面，这是唯一的解释通道）");

/* ── 枚举对账（10-05 下午）：写回校验的 kind / variant 表抄自上游 bundle（`lp` / `sZ`），
   这里**直接从产物原文提取**再逐字比对 —— 上游换版剪掉/新增一个 kind，这里立刻红
   （手抄表迟早会漂；漏一个 kind = 上游能收的文档被我们前置校验拦成"错误"）。 ── */
const chunkDir = join(ROOT, "public", "sketch", "_next", "static", "chunks");
let bundleKinds = null;
let bundleVariants = null;
for (const file of readdirSync(chunkDir)) {
  if (!file.endsWith(".js")) continue;
  const text = readFileSync(join(chunkDir, file), "utf8");
  if (!bundleKinds) {
    const hit = /\["button","iconButton","fab","extendedFab","splitButton","fabMenu","chip","topAppBar"[^\]]*\]/.exec(text);
    if (hit) { try { bundleKinds = JSON.parse(hit[0]); } catch { bundleKinds = null; } }
  }
  if (!bundleVariants) {
    const hit = /\[\{key:"filled",label:"Filled"\}(?:,\{key:"[a-z]+",label:"[A-Za-z]+"\})+\]/.exec(text);
    if (hit) bundleVariants = [...hit[0].matchAll(/key:"([a-z]+)"/g)].map((match) => match[1]);
  }
  if (bundleKinds && bundleVariants) break;
}
ok(!!bundleKinds && !!bundleVariants, "从产物原文提取到上游的 kind / variant 枚举（提取不到 = 上游产物结构变了，必须人工核对后更新本守卫，别静默放过）");
ok(!!bundleKinds && JSON.stringify(bundleKinds) === JSON.stringify(doc.SKETCH_ITEM_KINDS), `kind 枚举与上游逐字同表（${doc.SKETCH_ITEM_KINDS.length} 种，顺序也要一致）`);
ok(!!bundleVariants && JSON.stringify(bundleVariants) === JSON.stringify(doc.SKETCH_ITEM_VARIANTS), "variant 枚举与上游逐字同表（5 种 —— 上游 fz 里 variant 是必填且必须在表内）");

/* ───────────────────────── 八、工具面接线（part08 注册 ↔ part05 分发） ───────────────────────── */

/* 两个工具名在两侧各写一份字面量（part08 注册进工具面 / part05 事件路由分发）——
   对不上时引擎回 `Dynamic tool frontend_xxx is not registered`，tsc 与 build 全绿。
   注册形态必须是**裸对象字面量**：一旦被写成开关条件（`...(on ? [tool] : [])`），
   中途打开开关也不出现在工具面（dynamicTools 只在 thread/start 与 resume 生效）。
   ⛔ 人名演化（都按用户拍板）：sketch_* → mobile_ui_* → **frontend_*（当前，随展示名「前端开发」）**；
   旧会话要切走再切回才出现新名字 —— dynamicTools 只在会话建立时注入。 */
const part08Code = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
const part05Code = codeOnly(read("src/features/app-state/parts/part05/event-router/02-request.tsx"));
const mobileUiTools = ["frontend_get_doc", "frontend_apply_doc"];

for (const toolName of mobileUiTools) {
  /* ⛔ 锚「前面是逗号」不是「前面是 `{`」：`...(条件 ? [{ type: "function", name: … }] : [])`
     这种包一层在裸 `{` 正则下照样绿（10-05 变异实测），必须钉住它是数组的直接元素。 */
  ok(new RegExp(`,\\n\\s*\\{\\n\\s*type: "function",\\n\\s*name: "${toolName}",`).test(part08Code), `${toolName} 以裸数组元素注册进工具表（不是 ...(条件 ? [ … ]) 包一层 —— dynamicTools 只在 start/resume 生效，带条件 = 中途打开也不出现）`);
  ok(part05Code.includes(`event.params?.tool === "${toolName}"`), `${toolName} 在事件路由有分发分支（注册了没分发 = 引擎回 not registered）`);
}
/* 改名不许留双门：旧名写回分发 = 同一个能力两条真相（项目在 subagent_invoke 上踩过同型）。
   两代旧名（sketch_* / mobile_ui_*）都不许残留。 */
ok(!["sketch_get_doc", "sketch_apply_doc", "mobile_ui_get_doc", "mobile_ui_apply_doc"].some((legacy) => part05Code.includes(`"${legacy}"`)), "负向：两代旧名（sketch_* / mobile_ui_*）都不残留在事件路由（改名 = 断干净，旧会话靠切走再切回）");

const getToolAt = part08Code.indexOf('name: "frontend_get_doc"');
const getTool = getToolAt >= 0 ? part08Code.slice(getToolAt, getToolAt + 700) : "";
ok(getToolAt >= 0 && /inputSchema: \{ type: "object", properties: \{\} \}/.test(getTool), "读工具不带参数（模型不用猜参数形状）");

const applyToolAt = part08Code.indexOf('name: "frontend_apply_doc"');
const applyTool = applyToolAt >= 0 ? part08Code.slice(applyToolAt, applyToolAt + 2400) : "";
ok(applyToolAt >= 0 && /required: \["doc"\]/.test(applyTool), "写工具的 doc 必填（漏了 = 模型可能不带文档就调）");
ok(applyTool.includes("先 frontend_get_doc"), "写工具描述要求先读再改（防模型凭记忆重写、把用户画布整个覆盖）");
ok(getTool.includes("前端开发") && applyTool.includes("前端开发"), "两个工具描述都用「前端开发」的叫法（用户改名拍板：手机 / 电脑 / 网页都归它）");
/* 组件覆盖（10-05 夜用户：「UI里面的组件…再丰富一些」）：**36 种 kind 全列进写工具描述**，
   每个名字都要独立出现（词界正则 —— `fab` 是 `extendedFab` 的子串，裸 includes 会假绿）。
   ⛔ 只列名字；字段级说明在内置技能 frontend-canvas（拿 description 当手册 = 每轮背几 KB）。 */
const missingKinds = doc.SKETCH_ITEM_KINDS.filter((kind) => !new RegExp(`(^|[^A-Za-z])${kind}([^A-Za-z]|$)`).test(applyTool));
ok(missingKinds.length === 0, `写工具描述列全 ${doc.SKETCH_ITEM_KINDS.length} 种组件名（缺：${missingKinds.join(" / ") || "无"}；名字要独立出现，不能只当别的词的一部分）`);
ok(getTool.includes("412×892") && getTool.includes("1280×800"), "读工具描述点名手机 / 电脑两种屏尺寸（412×892 / 1280×800）");

/* part05 只经 barrel 取用（域↔域禁深链内部文件，ARCHITECTURE-RULES 红线）——
   负向断言防深链；正向断言 import 的每个名字都在 barrel 的导出面里。 */
const barrelSketch = read("src/features/ui-sketch/index.ts");
const part05Import = /import \{([^}]+)\} from "\.\.\/\.\.\/\.\.\/\.\.\/ui-sketch"/.exec(part05Code)?.[1] ?? "";
const part05Names = part05Import.split(",").map((name) => name.trim()).filter(Boolean);
ok(part05Names.length >= 5 && part05Names.every((name) => new RegExp(`\\b${name}\\b`).test(barrelSketch)), `part05 从 barrel 取全部 ${part05Names.length} 个入口（都在 index.ts 导出）`);
ok(!/ui-sketch\//.test(part05Code), "负向：part05 不深链 ui-sketch 内部文件（深链 = 绕过 barrel 契约）");

/* 分发分支的行为窗口：锚在 else-if 的 tool 比较上（稳定），窗口内钉关键动作序列。 */
const getBranchAt = part05Code.indexOf('event.params?.tool === "frontend_get_doc"');
const getBranch = getBranchAt >= 0 ? part05Code.slice(getBranchAt, getBranchAt + 1600) : "";
ok(getBranchAt >= 0 && getBranch.includes("setUiSketchOpen(true)") && getBranch.includes("waitSketchReady()") && getBranch.includes("requestSketchDoc()"), "读分支：自动开窗 → 等桥就绪 → 发请求（三步缺一就发进空气）");
ok(getBranch.includes("readback.doc") && getBranch.includes("success: true"), "读分支：空画布给 success + 指引（空画布是合法结果，不是错误）");

const applyBranchAt = part05Code.indexOf('event.params?.tool === "frontend_apply_doc"');
const applyBranch = applyBranchAt >= 0 ? part05Code.slice(applyBranchAt, applyBranchAt + 2600) : "";
ok(applyBranchAt >= 0 && applyBranch.includes("validateSketchDoc(nextDoc)") && applyBranch.includes("applySketchDoc(nextDoc)"), "写分支：先过上游同口径的前置校验，再交给会话单例");
ok(applyBranch.indexOf("validateSketchDoc(nextDoc)") < applyBranch.indexOf("applySketchDoc(nextDoc)"), "写分支顺序：校验在前、写入在后（反了 = 上游静默拒收，模型拿不到可读原因）");
ok(applyBranch.includes("applied.ok"), "写分支回执以桥的 load-doc-result 为准（桥说没成功就不许报成功）");

/* ── 一键预览（10-05 夜，用户：「加一个对话框预览这个UI界面」）——三处字面量对账：
   弹窗按钮（发 preview）↔ 桥（找 play_arrow 键并点）↔ preview-result 回执（弹窗更新状态）。
   任一处漂移 = 点了没反应，且 tsc/build 全绿。⛔ 预览界面是上游自己渲染的，我们不模拟它。 ── */
ok(modal.includes("previewNow") && /onClick=\{previewNow\}/.test(modal) && modal.includes(">预览<"), "弹窗头部有「预览」按钮并接到 previewNow");
ok(modal.includes('post({ type: "preview" })'), "预览 = 经 post() 发一条 preview 消息给桥（预览界面是上游渲染的，宿主只发触发消息）");
ok(modal.includes('data.type === "preview-result"') && /setStatus\(data\.ok === true/.test(modal), "弹窗按桥的 preview-result 回执更新状态（找不到键 / 点击失败都要看得见）");
ok(modal.includes("previewNow") && modal.indexOf("if (!readyRef.current)") >= 0 && modal.indexOf("if (!readyRef.current)") < modal.indexOf('post({ type: "preview" })'), "预览前先过就绪态（没就绪给可读提示；按钮不许打空气）");
ok(bridgeCode.includes('data.type === "preview"') && bridgeCode.includes("play_arrow"), "桥实现 preview：定位上游的 play_arrow 键（图标 ligature 是语言无关的锚，title 随站点语言变）");
ok(bridgeCode.includes("button.click()") && bridgeCode.includes('"preview-result"'), "桥点击后回 preview-result 回执（点了没点到都要如实回报，不假装成功）");
ok(bridgeCode.includes("button.disabled") && bridgeCode.includes("getBoundingClientRect"), "桥只点可用的可见键（disabled / display:none 的面板键要跳过 —— 跳错键 = 预览从别的屏开始）");

/* 弹窗 ↔ 会话单例三个动作（缺 attach = 工具请求没有载体；feed 顺序反了 = 工具永远收不到回执）。 */
ok(modal.includes("attachSketchFrame(iframeRef.current ? iframeRef.current.contentWindow : null)"), "弹窗把 iframe 交给会话单例（attach 缺失 = 工具请求发进空气）");
/* ⛔ 用位置比较，不用「feed 后 N 字符内出现 ready 过滤」：10-05 夜插入 preview-result 分支后
   窗口自然变远，而那本就不是缺陷 —— feed 必须先于**所有**展示分支，这才是纪律。 */
ok(modal.indexOf("feedSketchMessage(data)") >= 0
  && modal.indexOf("feedSketchMessage(data)") < modal.indexOf('if (data.type !== "ready"')
  && modal.indexOf("feedSketchMessage(data)") < modal.indexOf('if (data.type === "preview-result"'), "弹窗先 feed（会话单例）再走展示分支（顺序反了工具永远收不到回执）");
ok(modal.includes("detachSketchFrame();"), "弹窗卸载时交还会话单例（关窗后在飞请求立即失败，不挂到超时）");

/* ── 常驻指令第 13 条（10-05 夜，「Codex 要知道用这个」）+ 组件手册技能（「UI里面的组件…再丰富一些」）
   ——与第 12 条 Uiverse 同款纪律：工具在表里模型未必主动用；组件细节放技能（渐进披露）。
   名字必须与 part08 的注册名同源（名字漂移 = 模型去找一个不存在的工具/技能）。
   ⛔ 名字断言**切指令块本体**再判：拿整份文件 includes 会被注释/旁文顶成假绿
   （10-05 夜变异实测：块里名字删一处、别处残留一处仍绿 ⇒ 现在按块切片）。 ── */
const devInstrSketch = read("electron/developer-instructions.ts");
const frontendInstrBlock = (() => {
  const at = devInstrSketch.indexOf("const FRONTEND_CANVAS_INSTRUCTIONS =");
  if (at < 0) return "";
  const end = devInstrSketch.indexOf("`;", at);
  return end > at ? devInstrSketch.slice(at, end + 2) : "";
})();
ok(frontendInstrBlock.length > 300, `切出第 13 条指令块本体（${frontendInstrBlock.length} 字符；切不到 = 常量被改名/挪走，下面几条不可信）`);
ok(/text \+= FRONTEND_CANVAS_INSTRUCTIONS;/.test(devInstrSketch), "第 13 条指令块真的拼进 developer_instructions（常量在、接线不在 = 白写）");
ok(frontendInstrBlock.includes("前端开发"), "指令里用「前端开发」的叫法（与界面同源，别的叫法 = 模型对不上入口）");
ok(frontendInstrBlock.includes("1280×800") && frontendInstrBlock.includes("412×892"), "指令点名手机 / 电脑两种屏尺寸（手机 412×892 / 电脑 1280×800）");
for (const toolName of mobileUiTools) {
  ok(frontendInstrBlock.includes(toolName), `指令块点名 ${toolName}（与 part08 注册名同源）`);
}
ok(frontendInstrBlock.includes("frontend-canvas"), "指令块指向组件手册技能 frontend-canvas（36 种字段速查的唯一落点）");

/* 组件手册技能（10-05 夜用户：「把那个内置组件的，按照这个前端UI支持的展示和拓展效果更新进去」）：
   注册（entries 名单）+ 内容（工具名 / 三形态 / 36 种全表）+ 中文导读，三处缺一不可 ——
   技能没进 entries = 永远不落盘；内容缺 kind = 模型读到半份手册；没导读 = 用户看不懂。 */
const builtinSkillsReg = read("electron/builtin-skills.ts");
const frontendSkillSrc = read("electron/builtin-skills/20-skill-frontend-canvas.ts");
ok(builtinSkillsReg.includes('["frontend-canvas", FRONTEND_CANVAS_SKILL]') && builtinSkillsReg.includes('from "./builtin-skills/20-skill-frontend-canvas"'), "frontend-canvas 注册进 ensureBuiltinSkills 的 entries 名单（不注册 = 永远不落盘，模型看不到）");
const skillMissingKinds = doc.SKETCH_ITEM_KINDS.filter((kind) => !new RegExp(`(^|[^A-Za-z])${kind}([^A-Za-z]|$)`).test(frontendSkillSrc));
ok(skillMissingKinds.length === 0, `组件手册覆盖全部 ${doc.SKETCH_ITEM_KINDS.length} 种 kind（缺：${skillMissingKinds.join(" / ") || "无"}）`);
ok(frontendSkillSrc.includes("frontend_get_doc") && frontendSkillSrc.includes("frontend_apply_doc"), "手册点名两个工具（与注册名同源）");
ok(frontendSkillSrc.includes("1280×800") && frontendSkillSrc.includes("platform"), "手册覆盖手机 / 电脑 / 网页三形态（屏尺寸 + platform）");
ok(read("electron/builtin-skills/00-skill-zh-notes.ts").includes('"frontend-canvas":'), "中文导读补了 frontend-canvas 一条（守卫【229】要求与 entries 一一对应）");

/* ───────────────────────── 九、真跑：会话单例 ───────────────────────── */

/* 会话单例是"宿主 ↔ 桥"的收发中枢，行为全是时序语义（串行队列 / 按 type 派发 / 关窗拒绝 /
   StrictMode 重挂载），静态读代码证明不了。这里用假窗口（postMessage 记账）+ 手动喂回执，
   把每条语义真跑出来。 */
const session = await import(pathToFileURL(join(ROOT, "src", "features", "ui-sketch", "sketch-session.mjs")).href);
const SOURCE = doc.SKETCH_BRIDGE_SOURCE;
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const catchErr = (promise) => promise.then(() => null, (error) => error);
const makeWin = () => ({ sent: [], postMessage(message) { this.sent.push(message); } });
const sentOf = (win, type) => win.sent.filter((message) => message.type === type);

ok(["attachSketchFrame", "detachSketchFrame", "feedSketchMessage", "isSketchReady", "waitSketchReady", "requestSketchDoc", "applySketchDoc"].every((name) => typeof session[name] === "function"), "会话单例七个入口齐全（弹窗 attach/feed、工具 request/apply、两侧 wait/is）");

const early = await catchErr(session.requestSketchDoc());
ok(early instanceof Error && /就绪/.test(early.message), "真跑：窗口没挂时 requestSketchDoc 立刻给可读拒绝（不是静默挂起）");

const winA = makeWin();
session.attachSketchFrame(winA);
ok(session.isSketchReady() === false, "真跑：attach 了但桥没答话 ⇒ 未就绪（就绪 = attach + ready 两件事）");
session.feedSketchMessage({ source: SOURCE, type: "ready" });
ok(session.isSketchReady() === true, "真跑：桥的 ready 一到即就绪");

/* 串行队列：两次请求不许相交（两次 hash 写入会互相踩，轮询会读到对方的中间态）。 */
const p1 = session.requestSketchDoc();
const p2 = session.requestSketchDoc();
await settle();
ok(sentOf(winA, "get-doc").length === 1, "真跑：两个并发请求只发出一条 get-doc（串行队列 —— 这是写回通道的硬要求）");
ok(sentOf(winA, "get-doc")[0].source === SOURCE, "真跑：出站消息带 source 标记（宿主自己的 postMessage 不会喂错会话）");

let p1Settled = false;
p1.then(() => { p1Settled = true; }, () => { p1Settled = true; });
session.feedSketchMessage({ source: SOURCE, type: "load-doc-result", ok: true });
await settle();
ok(p1Settled === false, "真跑：类型不匹配的回执不落定等待中的请求（按 type 匹配，不是先到先得）");

session.feedSketchMessage({ source: SOURCE, type: "doc", doc: { probe: 1 } });
const r1 = await p1;
ok(r1.doc && r1.doc.probe === 1, "真跑：doc 回执按 type 派发给等它的那个请求");

await settle();
ok(sentOf(winA, "get-doc").length === 2, "真跑：前一个请求落定后，排队中的第二个才发出（队列没有丢单）");
session.feedSketchMessage({ source: SOURCE, type: "doc", doc: { probe: 2 } });
const r2 = await p2;
ok(r2.doc && r2.doc.probe === 2, "真跑：第二单收到的是第二份回执（不串答）");

/* 写入：文档原样装进 load-doc；等待期间先到的 doc 消息不许顶掉 load-doc-result。 */
const probeDoc = { frames: [{ id: "f1", name: "首页", x: 0, y: 0 }], groups: [{ id: "g1", x: 0, y: 0, axis: "x", items: [{ id: "i1", kind: "topAppBar", label: "标题", icon: null, variant: "filled" }] }] };
const p3 = session.applySketchDoc(probeDoc);
await settle();
const sentLoad = sentOf(winA, "load-doc");
ok(sentLoad.length === 1 && sentLoad[0].doc === probeDoc, "真跑：applySketchDoc 把文档原样装进 load-doc（不经过纯函数层任何改写）");

let p3Settled = false;
p3.then(() => { p3Settled = true; }, () => { p3Settled = true; });
session.feedSketchMessage({ source: SOURCE, type: "doc", doc: { noise: true } });
await settle();
ok(p3Settled === false, "真跑：等待 load-doc-result 期间先到的 doc 消息不顶掉它（桥成功时会先 post doc 再 post 结果，顺序不保证）");

session.feedSketchMessage({ source: SOURCE, type: "load-doc-result", ok: true, doc: probeDoc });
const r3 = await p3;
ok(r3.ok === true && r3.error === "", "真跑：写入结果按桥的 load-doc-result 落定（ok 缺省为假 —— 没有回执不算成功）");

/* 关窗：在飞请求立即失败（工具调用不许挂到 15 秒超时）。 */
const winC = makeWin();
session.attachSketchFrame(winC);
session.feedSketchMessage({ source: SOURCE, type: "ready" });
const p4 = session.requestSketchDoc();
await settle();
session.detachSketchFrame();
await settle(10);
const e4 = await catchErr(p4);
ok(e4 instanceof Error && /关掉/.test(e4.message), "真跑：关窗时在飞请求被拒（绝不让工具调用挂到超时 —— 那是 15 秒的僵死）");

/* StrictMode：清理 → 同一提交内再挂载（同一个 contentWindow 对象），在飞请求不许被误杀。 */
const winD = makeWin();
session.attachSketchFrame(winD);
session.feedSketchMessage({ source: SOURCE, type: "ready" });
const p5 = session.requestSketchDoc();
await settle();
session.detachSketchFrame();
session.attachSketchFrame(winD);
await settle(10);
session.feedSketchMessage({ source: SOURCE, type: "doc", doc: { survived: true } });
const r5 = await p5;
ok(r5.doc && r5.doc.survived === true, "真跑：StrictMode 的 清理→立刻重挂载 不误杀在飞请求（0ms 延迟判定的由来）");

/* 就绪态语义：同一窗口重挂载保持；新窗口（真重开）作废重等。 */
session.attachSketchFrame(winD);
ok(session.isSketchReady() === true, "真跑：同一窗口重复 attach（同对象）不把就绪态打回（打回 = 永远等不到 ready，桥只 post 一次）");
const winE = makeWin();
session.attachSketchFrame(winE);
ok(session.isSketchReady() === false, "真跑：换了新窗口（真重开）就绪态作废，等桥重新 ready");

const timeoutErr = await catchErr(session.waitSketchReady(30));
ok(timeoutErr instanceof Error && /秒内没有就绪/.test(timeoutErr.message), "真跑：waitSketchReady 超时给可读解释（自动开窗后等不到桥时的唯一线索）");
session.feedSketchMessage({ source: SOURCE, type: "ready" });
let waitedOk = false;
try { await session.waitSketchReady(50); waitedOk = true; } catch { waitedOk = false; }
ok(waitedOk, "真跑：已就绪时 waitSketchReady 直接通过");

/* ───────────────────────── 十、真跑：桥的写通道（VM 跑原文） ───────────────────────── */

/* 桥跑在草图源里，宿主永远看不到它的 DOM / 异常 —— 唯一可观测面是它 post 出来的消息
   与 location.hash 的副作用。所以把桥原文塞进 node VM 真跑：假 window/localStorage，
   location.hash setter 扮演**上游 arrive()**（#docz= → inflateRaw 解码落盘；persist:false
   模拟上游拒收）。三个用例：正常写入 / 无 CompressionStream 回落 / 上游拒收。 */

const decodeSketchHash = (hash) => {
  if (hash.startsWith("#docz=")) return JSON.parse(inflateRawSync(Buffer.from(hash.slice(6), "base64url")).toString("utf8"));
  if (hash.startsWith("#doc=")) return JSON.parse(decodeURIComponent(hash.slice(5)));
  return null;
};

function makePreviewButton({ text = "play_arrow", disabled = false, visible = true } = {}) {
  const log = [];
  return {
    log,
    disabled,
    querySelector(selector) { return selector === "span.msr" ? { textContent: text } : null; },
    getBoundingClientRect() { return visible ? { width: 40, height: 40 } : { width: 0, height: 0 }; },
    click() { log.push("click"); },
  };
}

function runBridgeStandalone({ withCompression = true, persist = true, previewButtons = [] } = {}) {
  const handlers = {};
  const posted = [];
  const hashSets = [];
  const writes = [];
  const store = new Map();
  const windowStub = {
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    parent: { postMessage(message) { posted.push(message); } },
  };
  const localStorageStub = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { writes.push(["setItem", key]); store.set(key, String(value)); },
    removeItem(key) { writes.push(["removeItem", key]); store.delete(key); },
    key(index) { return [...store.keys()][index] ?? null; },
    get length() { return store.size; },
  };
  const locationStub = {};
  Object.defineProperty(locationStub, "hash", {
    get() { return hashSets.length ? hashSets[hashSets.length - 1] : ""; },
    set(value) {
      hashSets.push(value);
      if (!persist) return;
      /* 模拟上游 hashchange → arrive()：解码分享哈希并落盘。
         ⛔ 直接写 store，不走 stub.setItem —— writes 记录的是**桥**的写入，这里代表"上游"，不能混。 */
      const arrived = decodeSketchHash(value);
      if (arrived !== null) store.set("m3e:doc", JSON.stringify(arrived));
    },
  });
  const documentStub = {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === "button" ? previewButtons : []),
  };
  const syncSetTimeout = (fn) => { fn(); return 0; };

  new Function(
    "window", "localStorage", "location", "navigator", "document", "setTimeout",
    "btoa", "atob", "TextEncoder", "TextDecoder", "Response", "CompressionStream",
    bridge,
  )(
    windowStub, localStorageStub, locationStub, { locks: {} }, documentStub, syncSetTimeout,
    globalThis.btoa, globalThis.atob, TextEncoder, TextDecoder, Response,
    withCompression ? CompressionStream : undefined,
  );

  return {
    posted,
    hashSets,
    writes,
    feed: (message) => { for (const fn of handlers.message ?? []) fn({ data: { source: SOURCE, ...message } }); },
  };
}

const probeWriteDoc = {
  title: "探针",
  frames: [{ id: "f1", name: "首页", x: 0, y: 0, noteHistory: [{ at: 1 }] }],
  groups: [{
    id: "g1", x: 0, y: 0, axis: "x",
    items: [
      { id: "i1", kind: "image", label: "图", icon: null, variant: "filled", src: "data:image/png;base64,AAAA", noteHistory: [{ at: 2 }] },
      { id: "i2", kind: "image", label: "外链", icon: null, variant: "filled", src: "https://example.com/a.png" },
    ],
  }],
};

/* 用例 A：正常写入（CompressionStream 可用、上游落盘）。 */
const runA = runBridgeStandalone();
const readyPostA = runA.posted.find((message) => message.type === "ready");
ok(!!readyPostA && readyPostA.source === SOURCE && typeof readyPostA.diag === "object", "真跑：桥一加载就报 ready + 诊断包（宿主据此判就绪；跨源里这是唯一可见面）");
runA.feed({ type: "ping" });
const pingDocs = runA.posted.filter((message) => message.type === "doc");
ok(pingDocs.length === 1 && pingDocs[0].doc === null, "真跑：ping → 回 doc（空画布时 doc: null —— 合法结果，宿主给指引而不是报错）");

runA.feed({ type: "load-doc", doc: probeWriteDoc });
await settle(50);
const hashA = runA.hashSets[0] ?? "";
ok(hashA.startsWith("#docz="), "真跑：写入走 deflate-raw 分享哈希（#docz=，与上游 agent.md 的命令行编码同口径）");
const decodedA = hashA.startsWith("#docz=") ? decodeSketchHash(hashA) : null;
ok(!!decodedA && decodedA.title === "探针" && decodedA.frames.length === 1 && !("noteHistory" in decodedA.frames[0]), "真跑：哈希里 frames 的 noteHistory 已剪（与上游导出分享逐字同口径）");
const decodedItem1 = decodedA?.groups?.[0]?.items?.[0] ?? {};
const decodedItem2 = decodedA?.groups?.[0]?.items?.[1] ?? {};
ok(!("noteHistory" in decodedItem1) && !("src" in decodedItem1), "真跑：内联 data: 图源不随分享哈希外带（体积 + 隐私，上游 shareable 口径）");
ok(decodedItem2.src === "https://example.com/a.png", "真跑：http(s) 图源保留");
const resultA = runA.posted.find((message) => message.type === "load-doc-result");
ok(!!resultA && resultA.ok === true, "真跑：上游落盘（存储变化）后回 ok:true");
ok(runA.writes.length === 0, "真跑负向：整条写入链路桥自己一次 setItem/removeItem 都没有（写盘的是上游 arrive()，由 hash setter 模拟）");

/* 用例 B：无 CompressionStream 的老环境 → #doc= 回落（清理口径必须完全一致）。 */
const runB = runBridgeStandalone({ withCompression: false });
runB.feed({ type: "load-doc", doc: probeWriteDoc });
await settle(50);
ok((runB.hashSets[0] ?? "").startsWith("#doc="), "真跑：回落 #doc= 原文 URI 编码（上游两条导入通道都认）");
const decodedB = (runB.hashSets[0] ?? "").startsWith("#doc=") ? decodeSketchHash(runB.hashSets[0]) : null;
ok(!!decodedB && decodedB.groups[0].items[1].src === "https://example.com/a.png" && !("src" in decodedB.groups[0].items[0]), "真跑：回落路径的清理口径与压缩路径完全一致");
ok(runB.posted.find((message) => message.type === "load-doc-result")?.ok === true, "真跑：回落路径同样以桥回执为准");
ok(runB.writes.length === 0, "真跑负向：回落路径也不碰存储");
const hashCountBefore = runB.hashSets.length;
runB.feed({ source: "other-frame", type: "load-doc", doc: probeWriteDoc });
await settle(10);
ok(runB.hashSets.length === hashCountBefore, "真跑负向：没带 source 标记的 load-doc 一律不认（别的 frame 乱写画布不进这个门）");

/* 用例 C：上游拒收（存储始终不变）→ 20 轮后如实报失败，绝不乐观。 */
const runC = runBridgeStandalone({ persist: false });
runC.feed({ type: "load-doc", doc: probeWriteDoc });
await settle(50);
const resultC = runC.posted.find((message) => message.type === "load-doc-result");
ok(resultC?.ok === false && /无效/.test(resultC.error) && /Web Locks/.test(resultC.error), "真跑：上游拒收时给可读失败原因（校验不过 / 非可写实例），不假装成功");
ok(runC.writes.length === 0, "真跑负向：失败路径同样不碰存储（宁可失败也不绕过上游）");

/* 用例 D：一键预览（10-05 夜）—— 桥代点上游 play_arrow 键并如实回执。
   ⛔ VM 里的"上游按钮"是假 DOM 桩：这里验的是**桥的定位与回执语义**（跳过 disabled / 隐藏键、
   找不到不假装成功）；"真产物里的真按钮能被点到"由验收项 ⑫ 在真站上跑。 */
const previewBtn = makePreviewButton();
const disabledBtn = makePreviewButton({ disabled: true });
const hiddenBtn = makePreviewButton({ visible: false });
const runD = runBridgeStandalone({ previewButtons: [disabledBtn, hiddenBtn, previewBtn] });
runD.feed({ type: "preview" });
const previewResult = runD.posted.find((message) => message.type === "preview-result");
ok(previewBtn.log.length === 1 && disabledBtn.log.length === 0 && hiddenBtn.log.length === 0, "真跑：preview 只点可用的可见键（disabled / 隐藏键跳过 —— 跳错键 = 预览从别的屏开始）");
ok(previewResult?.ok === true && previewResult.source === SOURCE, "真跑：点到键就回 preview-result ok:true（宿主据此给「预览已开始」）");

const runD2 = runBridgeStandalone({ previewButtons: [] });
runD2.feed({ type: "preview" });
const previewMiss = runD2.posted.find((message) => message.type === "preview-result");
ok(previewMiss?.ok === false && /没找到/.test(previewMiss.error), "真跑：找不到播放键（骨架屏期间）回 ok:false + 可读原因，绝不假装成功");
ok(runD.writes.length === 0 && runD2.writes.length === 0, "真跑负向：预览路径桥自己一次 setItem/removeItem 都没有（预览 = 只读演示，持久面一律不沾）");

console.log(`\n【sketch】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
