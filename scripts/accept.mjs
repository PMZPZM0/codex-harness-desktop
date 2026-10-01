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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    id: "file-card-edit",
    name: "⑱ 文件卡片右键菜单 + md 表格弹窗编辑（09-26「像 WorkBuddy 那样」轮）",
    run: async (h) => {
      // 为什么这样测：md-table.mjs 是编辑保存的数据完整性基座（只回写表格块、其余原文逐字
      // 保留、代码块里的表格绝不识别），坏一行 = 用户文件被改坏，必须真代码真值表跑死；
      // saveFileAs 是新 IPC，桥存在 + 主进程可信根校验真的「拒绝」都要在真机验（假桥/校验
      // 被绕过 = 渲染层被注入即可把盘上任意文件拷走）。UI 右键交互本身由守卫【164】结构
      // 断言 + 用户真机验收覆盖（CDP 无法合成原生 contextmenu 到 React 卡片）。
      const mt = await import(pathToFileURL(join(ROOT, "src/lib/md-table.mjs")).href);
      const md = ["# t", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "```", "| x | y |", "| -- | -- |", "```", "", "尾。"].join("\n");
      const p1 = mt.parseMarkdownTables(md);
      h.check("① 只识别真表格（代码块里的不认）", p1.blocks.length === 1, `blocks=${p1.blocks.length}`);
      const edits = p1.blocks.map((b) => b.rows.map((r) => r.slice()));
      edits[0].push(["3", "4"]);
      const out = mt.renderMarkdownTables(md, edits);
      h.check("② 回写后原文段落与代码块逐字保留", out.includes("| x | y |") && out.endsWith("尾。") && out.includes("| 3"));
      const bridge = await h.eval(`(function(){ return typeof window.codex.saveFileAs; })()`);
      h.check("③ saveFileAs 桥存在（IPC 三件套生成面）", bridge === "function", `typeof=${bridge}`);
      const rejected = await h.eval(`(function(){
        return window.codex.saveFileAs("C:\\\\Windows\\\\win.ini").then(function(){ return "NOT_REJECTED"; }, function(e){ return String(e && e.message || e).slice(0, 120); });
      })()`);
      // 判据：handler 抛错（Electron 包装成 ERR_INVOKE_FAILED）= 未放行。原话被包装串截断，
      // 所以不匹配具体文案，只判「确实被拒」——放行才是事故。
      h.check("④ 主进程拒绝可信根外的源文件（另存为不是任意文件拷贝器）", !rejected.includes("NOT_REJECTED") && rejected.length > 0, String(rejected).slice(0, 80));
    },
  },
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
  {
    id: "settings-pages",
    name: "⑱ 设置页逐页可打开（26 页全过 —— 防 lazy chunk 缺失 / 导出名不匹配，0.0.27 事故）",
    run: async (h) => {
      // 为什么断言这一条：0.0.27 的安装包里，before-pack 把**所有懒加载 chunk** 当成「陈旧死重」
      // 删掉了（判据只认 index.html 的直接引用），于是点开任意设置页都报
      // `Cannot read properties of undefined (reading 'default')`。这类问题**只在打包形态暴露**，
      // dev 下 vite 直供源码永远看不到。本项 + 守卫【151】一起把它钉死。
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await wait(1500);
      const labels = await h.eval(`[...document.querySelectorAll(".settings-nav button")].map(b => b.textContent.trim())`);
      const list = Array.isArray(labels) ? labels : [];
      h.check("① 设置面板打开且有导航项（≥20）", list.length >= 20, `实得 ${list.length} 项`);
      if (list.length < 20) return;
      const bad = [];
      for (let i = 0; i < list.length; i++) {
        await h.eval(`(function(){ document.querySelectorAll(".settings-nav button")[${i}]?.click(); return 1; })()`);
        await wait(1100);
        const probe = await h.eval(`(function(){
          const m = document.querySelector(".settings-modal");
          if (!m) return "面板不见了";
          const t = m.innerText || "";
          return /重试加载应用|复制诊断信息|Cannot read properties of undefined|Failed to fetch dynamically imported/.test(t)
            ? "错误边界: " + t.slice(0, 100) : "ok";
        })()`);
        if (probe !== "ok") bad.push(`${list[i]} → ${probe}`);
        await h.eval(`(function(){ document.querySelectorAll(".settings-nav button")[0]?.click(); return 1; })()`);
        await wait(250);
      }
      h.check(`② ${list.length} 个设置页逐页打开无 ErrorBoundary`, bad.length === 0, bad.slice(0, 4).join(" ∣ "));
    },
  },
  {
    id: "laya-auto",
    name: "⑲ Laya 思考等级自动档（开发工具卡 / 自动开关 / 规则升档实时透出 / 手选立即生效）",
    run: async (h) => {
      // 为什么断言这一条：10-01 用户立项 laya 自动档并三次纠偏（没进度 / 延迟高 / 等级不透出）。
      // 判定分两层：规则锚点（架构/重构/拆分 ⇒ xhigh，0ms 纯本地，不依赖模型权重）+ laya 模型
      // （低/中分辨）。e2e 只验确定性链路：UI 在位、开关持久、规则路径芯片实时透出、手选立即
      // 覆盖；模型判定质量不在 e2e 范围（需 700MB 权重，离线矩阵已验：模型对「中以上」压缩，
      // 已改混合判定）。
      // ① 设置 → 开发工具有 Laya 卡
      await h.eval(`(function(){ document.querySelector('.sidebar-settings')?.click(); return 1; })()`);
      await wait(1400);
      const nav = await h.eval(`(function(){ const items=[...document.querySelectorAll('.settings-nav button')];
        const i=items.findIndex((b)=>(b.textContent||'').includes('开发工具')); if(i>=0) items[i].click(); return i; })()`);
      await wait(1200);
      const card = await h.eval(`!!document.querySelector('.laya-card')`);
      h.check("① 开发工具有「Laya 智能判断」卡（安装入口在位）", nav >= 0 && card, `nav=${nav} card=${card}`);

      // 关设置回主界面（设置弹窗右上角 ✕：aria-label 或 lucide-x 图标钮）
      await h.eval(`(function(){ const btns=[...document.querySelectorAll('.settings-modal button')];
        const x=btns.find((b)=>(b.getAttribute('aria-label')||'').includes('关闭')||b.querySelector('.lucide-x'));
        if (x) x.click(); return 1; })()`);
      await wait(1000);

      // ② 思考强度弹窗里的自动档开关：在位、能打开（开成功时面板按设计自动收起 ⇒ 重开读状态）
      await h.eval(`document.querySelector('.effort-trigger')?.click()`);
      await wait(700);
      const autoRow = await h.eval(`!!document.querySelector('.effort-picker-auto-btn')`);
      const wasOn = await h.eval(`document.querySelector('.effort-picker-auto')?.classList.contains('on')`);
      if (!wasOn) { await h.eval(`document.querySelector('.effort-picker-auto-btn')?.click()`); await wait(400); }
      // 面板已自动收起：重开读真实状态（存 localStorage，重开必然反映）
      await h.eval(`document.querySelector('.effort-trigger')?.click()`);
      await wait(700);
      const nowOn = await h.eval(`document.querySelector('.effort-picker-auto')?.classList.contains('on')`);
      h.check("② 自动档开关在位且可打开", autoRow && nowOn === true, `row=${autoRow} ${wasOn}→${nowOn}`);

      // 关弹窗（再点触发器）
      await h.eval(`document.querySelector('.effort-trigger')?.click()`);
      await wait(500);

      // ③ 规则锚点实时透出：草稿含 架构/重构/拆分 ⇒ 芯片 ≤2.5s 变「自动 · 极高」
      //   （预判 700ms 防抖 + 规则 0ms；不走 laya 模型——权重下载不在 e2e 范围）
      await h.eval(`(function(){
        const el=document.querySelector('.composer-editor');
        el?.focus(); document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, '把整个项目的状态层重构并迁移到新架构，按功能域拆分模块树');
        return 1; })()`);
      let chip3 = "";
      for (let i = 0; i < 10; i++) {
        await wait(500);
        chip3 = await h.eval(`document.querySelector('.effort-trigger-label')?.textContent || ""`);
        if (chip3.includes("极高") || chip3.includes("高")) break;
      }
      h.check("③ 规则升档实时透出：难任务草稿 → 芯片「自动 · 极高」", /自动.*极高/.test(chip3), chip3);

      // ④ 手选立即覆盖：点档位刻度（低→高两连击）⇒ 芯片立刻跟着变（不发送也生效）
      //   （commit 有 next!==value 守卫：当前档恰好等于所点档时不触发——两连击+变化断言免疫）
      await h.eval(`document.querySelector('.effort-trigger')?.click()`);
      await wait(600);
      const seen = [];
      for (const i of [0, 2]) {
        await h.eval(`(function(){
          const ticks=[...document.querySelectorAll('.effort-picker-ticks button')];
          ticks[${i}]?.click(); return 1; })()`);
        await wait(400);
        seen.push(await h.eval(`document.querySelector('.effort-trigger-label')?.textContent || ""`));
      }
      const chip4 = seen[seen.length - 1] ?? "";
      h.check("④ 手选立即覆盖：自动模式下点刻度芯片立刻跟随（≥1 次可见变化）",
        seen.some((s) => /^自动 · /.test(s) && !/极高/.test(s)), `seen=${seen.join(" → ")}`);

      // ⑤ 持久化 + 收尾还原：开关状态在 localStorage，验完清掉不污染后续
      const persist = await h.eval(`localStorage.getItem('effort-auto-v1') === '1'`);
      h.check("⑤ 自动开关持久化（localStorage v1）", persist === true, `v1=${persist}`);
      await h.eval(`localStorage.removeItem('effort-auto-v1')`);
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
const LATEST_ROUND = "10-01";
/** 每一项属于哪一轮。新增验收项**必须**登记在这里，否则默认轮次里跑不到（会打印警告）。 */
const ROUND_OF = {
  "laya-auto": "10-01",
  "file-card-edit": "09-26",
  "settings-pages": "09-25",
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
