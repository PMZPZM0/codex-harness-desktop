// scripts/accept.mjs —— **唯一验收入口**（CDP 直连）
//
// 用户 09-12 三次定稿，全部体现在这个文件里：
//   ① 「把旧的验收流程删干净，每次都写最新的 cpd 脚本验收，不然你老是卡住」
//      → 旧的 `scripts/e2e/scenarios/*` + 增量哈希 runner 已删除（preflight【7】硬守卫不许回来）。
//      **09-24 重申同一条**：09-12 / 09-13 / 09-22 三轮共 24 个验收项已从本文件删除，只留最新轮。
//      要找回：`git show faeaa3c1:scripts/accept.mjs`（删前最后版本），并回 CHECKS 后登记轮次。
//   ② 「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」
//      → 跑在**跨轮次复用的持久 profile** 上，首次把真实 profile 的会话历史搬进来，之后一轮轮叠加。
//   ③ 「用旧会话测试，不要一直新建会话」
//      → 所有验收项都只在**已有会话**上操作；不新建会话、不发新消息。
//
// 用法：
//   node scripts/accept.mjs                  # 默认只跑最新一轮（LATEST_ROUND）
//   node scripts/accept.mjs --all            # 全量（发版闸门）
//   node scripts/accept.mjs --list            # 列出验收项（含各自轮次）
//   node scripts/accept.mjs --only reveal     # 只跑 id 含 reveal 的项
//   node scripts/accept.mjs --keep            # 跑完不关应用
//   node scripts/accept.mjs --profile main    # 换一个持久 profile 名
//   CODEX_HARNESS_RESEED=1 node scripts/accept.mjs   # 强制重灌真实配置/历史
//
// ⛔ 新增验收项**必须**登记进 ROUND_OF（否则默认轮跑不到它 —— 09-24 踩过）。
// 被测 profile：`.e2e-profile/<name>/`（已 gitignore，含真实对话内容，勿入库）

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectronHarness } from "./e2e/lib/harness.mjs";
// 正文 markdown 分块（渲染层用的就是这一份；验收项 ⑰ 跑它的真值表）
import { splitMarkdown } from "../src/lib/markdown-blocks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 最长的一条 assistant 正文字数（「进来就在实时进度」的判据用它，与具体回合序号无关）
const BODY_LEN = `(() => {
  let max = 0;
  for (const b of document.querySelectorAll(".assistant-message .message-body")) {
    const n = (b.innerText || "").length;
    if (n > max) max = n;
  }
  return max;
})()`;

/** 点侧栏第 i 个会话行（只用旧会话） */
const clickRow = (h, i) => h.eval(`(() => {  const list = [...document.querySelectorAll(".thread-row")];
  const btn = list[${i}] && list[${i}].querySelector("button");
  if (!btn) return false;
  btn.click();
  return true;
})()`);

/** 全局档案的「当前模型」——也就是用户做配置体检时模型**真正读到**的那两份文件：
 *  `custom-model.json` 顶层 model + `config.toml` 顶层 model。
 *  会话级作用域修好之后，切会话模型**不许**再改写它们（09-14 用户实测「模型还是串全局」的根源）。 */
const globalArchiveOf = (h) => {
  let archive = "";
  let provider = "";
  try {
    const j = JSON.parse(readFileSync(join(h.userDataDir, "custom-model.json"), "utf8"));
    archive = String(j.model ?? "");
    provider = String(j.provider ?? "");
  } catch { /* 文件不在就留空 */ }
  let toml = "";
  try {
    const top = readFileSync(join(h.userDataDir, "codex-home", "config.toml"), "utf8").split(/\n(?=\[)/)[0];
    toml = (top.match(/^\s*model\s*=\s*"([^"]*)"/m) ?? [])[1] ?? "";
  } catch { /* 同上 */ }
  return { archive, provider, toml };
};

// ─────────────────────────────────────────────────────────────────────────────
// 本轮验收项（**每次改动只改这一段**；不再对应的旧项直接删掉，别攒着）
// ─────────────────────────────────────────────────────────────────────────────
const CHECKS = [
  {
    id: "shot-editor",
    name: "⑮ 截图编辑器：覆盖层出现/标注/确认落盘（09-24 编辑器轮）",
    run: async (h) => {
      // 为什么断言这一条：截图现在「两种模式都先进覆盖层编辑器，确认才出图」（用户 09-24：
      // 「截图完没有编辑功能，就只是消失了」）。CDP 测不了真实鼠标拖框，但编辑态内部状态
      // （bar 显隐、撤销栈、finish→IPC→落盘→事件→toast）全链路可从 DOM/文件侧验证。
      // （覆盖层交互期间窗口 hide/恢复与 toast 文案均已在上轮真机冒烟验证）
      await h.eval(`(function(){ void window.codex.screenshotCapture("region"); return 1; })()`);
      // ⛔ 覆盖层是 data: URL 页面，target 注册早于 DOM 就绪 ⇒ evalInTarget 一次求值 false 不代表
      //    失败（冒烟里 sleep 掩盖过）—— 必须轮询到 true
      let ready = false;
      for (let i = 0; i < 20 && !ready; i++) {
        await new Promise((r) => setTimeout(r, 300));
        ready = await h.evalInTarget("data:text/html", `(function(){ return !!document.getElementById('ink'); })()`)
          .then((v) => v === true).catch(() => false);
      }
      h.check("① 框选覆盖层出现（编辑器挂载）", ready);
      if (!ready) return;
      const editing = await h.evalInTarget("data:text/html", `(function(){
        sx=200; sy=150; ex=600; ey=380; enterEdit(rect());
        pickTool('pen');
        var mk=function(t,x,y){return new MouseEvent(t,{clientX:x,clientY:y,button:0,bubbles:true});};
        ink.dispatchEvent(mk('mousedown',250,200));
        ink.dispatchEvent(mk('mousemove',320,240));
        ink.dispatchEvent(mk('mouseup',320,240));
        return JSON.stringify({ bar: bar.style.display, stack: stack.length });
      })()`).then((v) => JSON.parse(v)).catch(() => null);
      h.check("② 拖框进编辑态 + 画笔入撤销栈", !!editing && editing.bar === "flex" && editing.stack >= 1, JSON.stringify(editing));
      await h.evalInTarget("data:text/html", `(function(){ finish(); return true; })()`).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500));
      const toast = await h.eval(`(document.body.innerText || "").indexOf("已截图") >= 0`);
      h.check("③ 确认后事件到达渲染层（toast）", toast === true);
    },
  },

  {
    id: "history-search",
    name: "⑯ 当前会话搜索：顶栏 🔍 面板 + 只搜本会话 + 点击跳到命中消息（09-24 二次修订）",
    run: async (h) => {
      // 为什么断言这一条：面板 = **当前会话**搜索（用户 09-24 明确「只展示当前会话的历史记录，
      // 不要展示其他的」——跨会话搜索会搜出已归档/已删会话，点进去只能报错）。
      // 判据链：面板可开 → 搜不存在的词必定「没有匹配」（证明确实有搜索在跑）→
      // 搜消息区真实存在的词必定命中 → 点击后该消息拿到 .msg-search-hit-current 高亮。
      const hasBtn = await h.eval(`!!document.querySelector('.topbar .history-search-wrap button.icon-button')`);
      h.check("① 顶栏 🔍 按钮存在（通知入口已删）", hasBtn === true && !(await h.eval(`!!document.querySelector('.topbar .notice-center-wrap')`)));
      await h.click(".topbar .history-search-wrap button.icon-button");
      const panel = await h.eval(`!!document.querySelector('body > .history-search-panel input')`);
      h.check("② 面板 portal 到 body（输入框可交互）", panel === true);
      if (!panel) return;
      // ⛔ 前置条件：当前会话必须有正文，否则后面「搜到的词」根本不存在（09-24 踩过：
      //    环境停在空会话/未选工作区时，取词为空、搜索恒 0 命中，会把产品问题与环境问题混在一起）。
      //    没有正文就逐个点侧栏会话，直到有内容；始终没有 ⇒ 明确报环境不满足，不产生假绿/假红。
      let bodies = await h.eval(`document.querySelectorAll('.timeline .message-body').length`);
      for (let i = 0; bodies === 0 && i < 6; i++) {
        await h.eval(`document.querySelectorAll('.thread-row')[${i}]?.click()`);
        await new Promise((r) => setTimeout(r, 2200));
        bodies = await h.eval(`document.querySelectorAll('.timeline .message-body').length`);
      }
      h.check("[前置] 当前会话有正文可供搜索", bodies > 0, `正文块 ${bodies}`);
      if (bodies === 0) return;
      // 负向：不存在的词 ⇒ 必须是「当前会话里没有匹配的消息」（而不是跨会话结果）
      await h.typeInto(".history-search-panel input", "zzz_不存在的词_zzz");
      await new Promise((r) => setTimeout(r, 600));
      const emptyText = await h.eval(`(document.querySelector('.history-search-panel')?.innerText || "")`);
      h.check("③ 不存在的词 ⇒ 明确「当前会话里没有匹配」", emptyText.includes("当前会话里没有匹配的消息"), emptyText.slice(0, 60));
      // ⛔ 关键：**不要剥离空白**再取词 —— DOM 里是「请严格\n按顺序」，剥离后成了
      // 「请严格按顺序」，而 rollout 原文里两段之间仍有换行 ⇒ indexOf 必然失败（踩过两次）。
      // `[\u4e00-\u9fa5]{6,}` 天然不跨换行/标点 ⇒ 取到的子串在原文里也是连续的。
      const seed = await h.eval(`(function(){
        const raw = Array.from(document.querySelectorAll('.timeline .message-body'))
          .map((el) => el.innerText || "").join("\\n");
        const zh = raw.match(/[\\u4e00-\\u9fa5]{6,}/);
        if (zh) return zh[0].slice(0, 6);
        const en = raw.match(/[A-Za-z]{6,}/);
        return en ? en[0].slice(0, 6) : "";
      })()`);
      h.check("④ 取得当前会话的真实关键词", typeof seed === "string" && seed.length >= 4, JSON.stringify(seed));
      if (typeof seed !== "string" || seed.length < 4) return;
      await h.eval(`(function(){
        const el = document.querySelector('.history-search-panel input');
        el.value = "";
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await h.typeInto(".history-search-panel input", seed);
      await new Promise((r) => setTimeout(r, 800));
      const hitCount = await h.eval(`document.querySelectorAll('.history-search-panel .history-search-item').length`);
      h.check("⑤ 搜真实关键词有命中（只搜当前会话）", hitCount > 0, `命中 ${hitCount} 处，关键词 ${JSON.stringify(seed)}`);
      if (!hitCount) return;
      await h.click(".history-search-panel .history-search-item");
      await new Promise((r) => setTimeout(r, 1200));
      const highlighted = await h.eval(`!!document.querySelector('.msg-search-hit-current')`);
      h.check("⑥ 点击结果 ⇒ 该消息在会话区高亮（跳到了那条消息）", highlighted === true);
      await h.pressKey("Escape");
      await h.screenshot("当前会话搜索-命中高亮");
    },
  },

  {
    id: "md-render",
    name: "⑰ 正文 Markdown：列表尾行不缩进 + 行首/行尾全角空格不渲染成空白（09-24 用户两次截图）",
    run: async (h) => {
      // 为什么断言这一条：用户两次截图报「最后一个总是歪的，前面空那么多」。两种成因都落在
      // src/lib/markdown-blocks.mjs：① 列表尾部顶格的结语行被 CommonMark 当 lazy 续行、
      // 吞进最后一个 <li>（从 marker 之后起排）；② 行首/行尾的**全角空格 U+3000** ——
      // HTML 只折叠 ASCII 空白，U+3000 会实打实渲染成一块可见空白。
      // 这里既跑**真代码真值表**（与渲染层同一模块，不是复制品），也在真机里扫历史消息正文。
      const fs1 = "\u3000";
      const ord = splitMarkdown(["27. 一鸣惊人", "30. 四通八达", "1–10 全是「数字开头」"].join("\n"));
      h.check("① 列表尾部顶格结语 ⇒ 独立段落（不再被吞进最后一个 li）", ord.length === 1 && /\n\n1–10/.test(ord[0]), JSON.stringify(ord));
      const fsCase = splitMarkdown(["30. 四面八方", "", fs1 + "这次与上一版不重复。"].join("\n"));
      h.check("② 行首全角空格被去掉（U+3000 不被 HTML 折叠 = 一块可见空白）", fsCase.length === 2 && !fsCase[1].includes(fs1), JSON.stringify(fsCase));
      const indented = ["1. 甲", "   续行"];
      h.check("③ 反向：缩进的列表续行不动（作者本意就是项内换行）", splitMarkdown(indented.join("\n")).join("\n") === indented.join("\n"));
      const fenced = ["```js", fs1 + "const a = 1;", "```"];
      h.check("④ 反向：围栏内的全角空格原样保留（代码内容一个字符都不许动）", splitMarkdown(fenced.join("\n")).join("\n") === fenced.join("\n"));

      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      h.check("[前置] 有历史会话可看（≥1）", rows >= 1, `thread-row=${rows}`);
      await clickRow(h, 0);
      await new Promise((r) => setTimeout(r, 1500));
      const bodies = Number(await h.eval(`document.querySelectorAll(".timeline .message-body").length`)) || 0;
      // ⛔ 防恒真：正文没渲染出来时，"没有全角空格"是空跑，必须把这条前置也断言掉
      h.check("[前置] 消息区确实渲染出了正文（否则下一条等于没测）", bodies > 0, `message-body=${bodies}`);
      const bad = await h.eval(`(() => {
        const out = [];
        document.querySelectorAll(".timeline .message-body").forEach((el) => {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.nodeValue || "";
            if (!t) continue;
            // 代码块里的文本是代码内容，不参与（围栏内本来就保留原样）
            if (n.parentElement && n.parentElement.closest("pre, code, .code-highlight")) continue;
            if (/^[\\u3000\\u00A0]/.test(t) || /[\\u3000\\u00A0]$/.test(t)) out.push(t.slice(0, 20));
          }
        });
        return JSON.stringify(out.slice(0, 3));
      })()`);
      const list = JSON.parse(String(bad));
      h.check("⑤ 真机：消息正文里没有行首/行尾全角空格（会渲染成可见空白）", list.length === 0, String(bad));

      // ⑥ 引用块样式 —— 09-24 用户第三次截图的**真因**：模型用 `> 1–10 全是…` 给列表收尾，
      //    而全仓此前一条 blockquote 样式都没有 ⇒ 浏览器默认 margin: 1em 40px（左右各缩 40px、
      //    零可见标记）⇒ 看起来「最后一行凭空歪了、前面空那么多」。
      //    量法是往页面里挂一段等价结构读**计算样式**（纯 CSS 判据，与 React 无关），量完即移除。
      const bq = await h.eval(`(() => {
        const host = document.createElement("div");
        host.className = "markdown";
        host.style.cssText = "position:absolute;left:-9999px;top:0";
        host.innerHTML = "<blockquote><p>引用块样式测量</p></blockquote>";
        document.body.appendChild(host);
        const el = host.querySelector("blockquote");
        const cs = getComputedStyle(el);
        const r = { marginLeft: cs.marginLeft, marginRight: cs.marginRight, borderLeftWidth: cs.borderLeftWidth, paddingLeft: cs.paddingLeft };
        host.remove();
        return JSON.stringify(r);
      })()`);
      const bqs = JSON.parse(String(bq));
      h.check("⑥ 真机：引用块不再是浏览器默认的左右各 40px（且左侧有可见竖条）", parseFloat(bqs.marginLeft) <= 8 && parseFloat(bqs.borderLeftWidth) >= 1, String(bq));
      await h.screenshot("正文渲染-列表尾行与全角空格");
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 脚手架（通常不用动）
// ─────────────────────────────────────────────────────────────────────────────

async function enterMain(h) {
  await h.waitFor(
    `(document.body && document.body.innerText.includes("直接进入")) || !!document.querySelector(".app-shell")`,
    { label: "引导页或主界面", timeoutMs: 40000 }
  );
  if (await h.eval(`document.body.innerText.includes("直接进入")`)) {
    await h.clickByText("暂时不登录，直接进入").catch(() => undefined);
  }
  await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "app-shell 挂载", timeoutMs: 30000 });
  await wait(1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// 验收范围：**默认只跑「本轮」的项**（2026-09-13 用户严令后的流程改写）
//   用户原话：「验收流程是死的嘛，你不会重新写嘛」「只能测试最新改动，不要浪费我token」。
//   所以范围不再是"靠自觉加 --only"，而是**流程默认就只跑最新一轮**：
//     · 默认（不带参数）→ 只跑 LATEST_ROUND 那一轮；
//     · `--only <id>`    → 只跑指定项（本轮的项要反复迭代时用）；
//     · `--all`          → 全量（**发版/里程碑闸门**，平时不要用；跑之前先说明理由）；
//     · `--list`         → 列出全部项并标注所属轮次。
//   历史项不删（它们仍然是回归证据），但**永远不会在默认路径上被执行** ——
//   这样"每次只测最新改动"是机制保证的，不再依赖我记不记得。
// ─────────────────────────────────────────────────────────────────────────────
const LATEST_ROUND = "09-24";
/** 每一项属于哪一轮。新增验收项**必须**登记在这里，否则默认轮次里跑不到（会打印警告）。 */
const ROUND_OF = {
  "shot-editor": "09-24",
  "history-search": "09-24",
  "md-render": "09-24",
  // ⛔ 2026-09-24：用户要求「把旧的验收脚本删掉，只验收最新的」⇒ 09-12 / 09-13 / 09-22 三轮的
  //    24 项已从本文件删除（含它们的 helper 若有）。要找回：`git show faeaa3c1:scripts/accept.mjs`
  //    （删前的最后版本），把它们并回 CHECKS 并在此登记轮次即可。
  // ⛔ 新增验收项**必须**在这里登记本轮，否则默认轮（LATEST_ROUND）跑不到它。
};
const roundOf = (id) => ROUND_OF[id] ?? "(未登记)";

if (flag("list")) {
  console.log(`验收项（默认只跑最新一轮 ${LATEST_ROUND}；--all 才全量）：`);
  for (const c of CHECKS) console.log(`  [${roundOf(c.id).padEnd(7)}] ${c.id.padEnd(18)} ${c.name}`);
  process.exit(0);
}

const only = value("only", "");
const all = flag("all");
const selected = only
  ? CHECKS.filter((c) => c.id.includes(only))
  : all
    ? CHECKS
    : CHECKS.filter((c) => roundOf(c.id) === LATEST_ROUND);
if (!selected.length) {
  console.error(`没有匹配 --only ${only} 的验收项；可用：${CHECKS.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const unscoped = selected.filter((c) => roundOf(c.id) === "(未登记)").map((c) => c.id);
if (unscoped.length) console.log(`\x1b[33m⚠️ 这些验收项没登记轮次，不会被默认跑到：${unscoped.join(", ")}（请加进 ROUND_OF）\x1b[0m`);
console.log(`\x1b[90m验收范围：${only ? `--only ${only}` : all ? "全量（--all，发版闸门）" : `最新一轮 ${LATEST_ROUND}`}（${selected.length} 项：${selected.map((c) => c.id).join(", ")}）\x1b[0m`);

const missing = [
  ["dist/index.html", "npm run build:vite"],
  ["dist-electron/main.js", "npm run build:electron"],
].filter(([p]) => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error("\x1b[31m验收前置检查失败：构建产物缺失\x1b[0m");
  for (const [p, cmd] of missing) console.error(`  - 缺 ${p} → 先跑 \`${cmd}\``);
  process.exit(1);
}

const h = new ElectronHarness({
  root: ROOT,
  artifactsDir: join(ROOT, ".e2e-artifacts"),
  namePrefix: "",
  // 跨轮次复用的持久 profile（首次会把真实配置 + 真实会话历史搬进来）
  profileName: value("profile", "main"),
});

const t0 = Date.now();
const results = [];
try {
  await h.launch();
  console.log("\x1b[90m(应用已启动，CDP 已连接)\x1b[0m\n");
  await enterMain(h);
  for (const check of selected) {
    const st = Date.now();
    console.log(`\x1b[36m── ${check.name}\x1b[0m`);
    try {
      await check.run(h);
      results.push({ id: check.id, ok: true, ms: Date.now() - st });
    } catch (e) {
      console.log(`  \x1b[31m✗ 验收项异常：${e.message}\x1b[0m`);
      try {
        const p = await h.screenshot(`失败-${check.id}`);
        console.log(`  \x1b[90m失败截图：${p}\x1b[0m`);
      } catch { /* 截图失败不影响结论 */ }
      results.push({ id: check.id, ok: false, ms: Date.now() - st, error: e.message });
    }
  }
} catch (e) {
  console.error(`\x1b[31m启动阶段失败：${e.message}\x1b[0m`);
  results.push({ id: "(启动)", ok: false, ms: Date.now() - t0, error: e.message });
} finally {
  if (flag("keep")) console.log("\n\x1b[33m--keep：应用保持运行\x1b[0m");
  else {
    // ⛔ 绝不在回合运行中关应用（09-13 用户指出：「每次测试消息都不看完，你能发现
    // 什么bug，总是运行中就杀应用」）。跑完所有验收项后如果还有回合在流式，等它跑完
    // （上限 5 分钟）再退出——半路杀掉等于把最关键的证据扔了，而且会把"没跑完"误报成失败。
    for (let i = 0; i < 300; i++) {
      const busy = await h.eval(`!!document.querySelector(".timeline-bottom-spacer.compact")`).catch(() => false);
      if (!busy) break;
      if (i === 0) console.log("\x1b[90m(还有回合在流式：等它跑完再关应用…)\x1b[0m");
      await wait(1000);
    }
    await h.close();
  }
}

const summary = h.summary("验收");
console.log("\n\x1b[1m验收项耗时：\x1b[0m");
for (const r of results) {
  console.log(`  ${r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${r.id.padEnd(18)} \x1b[90m${r.ms}ms\x1b[0m${r.error ? `  ${r.error}` : ""}`);
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；截图：.e2e-artifacts/shots；被测 profile：${h.userDataDir}\n`);

process.exit(summary.ok && results.every((r) => r.ok) ? 0 : 1);
