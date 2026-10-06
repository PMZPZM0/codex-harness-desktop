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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    id: "plugin-market-gitee",
    name: "⑲ 插件市场换源（Gitee 官方镜像 / 48 个 Codex 兼容插件 / 分类与文案）",
    run: async (h) => {
      // 为什么断言这一条：10-01 用户发现 SkillHub 插件源几乎全为 DeepSeek Harness（DSH）生态
      // 装不上，令换国内兼容源。新源 = Gitee 上的 Claude Code 官方插件市场镜像（48 个，
      // 100% .claude-plugin 兼容）。安装链路已在换源时用真实下载探针验证（10/10 文件成功）。
      // ① 市场清单真拉到：走真实 IPC（Gitee API），条目 ≥40 且全部带 pluginPath（=兼容）
      const list = await h.eval(`window.codex.listMarketPlugins({ page: 1, pageSize: 30 }).then((r) => ({
        total: r.total, first: r.items[0] ? { name: r.items[0].name, path: r.items[0].pluginPath, src: r.items[0].source } : null,
      })).catch((e) => ({ error: String(e) }))`);
      h.check("① 市场清单真拉到（Gitee 源 ≥40 个插件）",
        (list?.total ?? 0) >= 40 && list?.first?.path, JSON.stringify(list).slice(0, 140));
      // ② 条目指向 Gitee 镜像源（不再是 SkillHub / DSH）
      h.check("② 条目标注 Gitee 官方镜像且带兼容插件路径",
        list?.first?.src === "Gitee 官方镜像" && String(list?.first?.path ?? "").startsWith("plugins/"), JSON.stringify(list?.first));
      // ③ UI：打开插件设置页，市场标题换源文案 + 无 DSH 报错文案残留
      await h.eval(`(function(){ document.querySelector('.sidebar-settings')?.click(); return 1; })()`);
      await wait(1400);
      const nav = await h.eval(`(function(){ const items=[...document.querySelectorAll('.settings-nav button')];
        const i=items.findIndex((b)=>(b.textContent||'').trim()==='插件'); if(i>=0) items[i].click(); return i; })()`);
      await wait(1600);
      const ui = await h.eval(`(function(){
        const t=document.querySelector('.settings-modal')?.innerText||'';
        return { hasGitee: t.includes('Gitee 官方镜像'), noSkillhub: !t.includes('skillhub.cn/plugins'),
          cards: document.querySelectorAll('.plugin-market-card, .settings-modal [class*=market] [class*=card]').length }; })()`);
      h.check("③ 插件页文案已换源（Gitee 标注 + 无 skillhub 残留）",
        nav >= 0 && ui?.hasGitee && ui?.noSkillhub, JSON.stringify(ui).slice(0, 120));
    },
  },
  {
    id: "codex-official-market",
    name: "⑳ Codex 官方插件市场（GitHub openai/plugins 国内镜像 / 分类 / 安装入口与已装反馈）",
    run: async (h) => {
      // 为什么钉这一条：10-03 用户要「把 Codex 原生插件源内置进来，分好类，给安装入口 + 安装状态与已安装反馈」。
      // 真IPC + 真 DOM 两头都要验：静态守卫只能钉代码形态，钉不住「上游清单能不能真拉到」。
      const list = await h.eval(`window.codex.listOfficialMarketPlugins({ page: 1, pageSize: 30 }).then((r) => ({
        total: r.total, live: r.live, first: r.items[0] ? { slug: r.items[0].slug, path: r.items[0].pluginPath, cat: r.items[0].categoryZh, auth: r.items[0].authNote, ok: r.items[0].installable } : null,
        installedIds: r.installedIds,
      })).catch((e) => ({ error: String(e) }))`);
      h.check("① 官方清单真拉到（≥60 个插件，条目带仓库路径 / 分类 / 鉴权提示）",
        (list?.total ?? 0) >= 60 && list?.first?.path && list?.first?.cat && list?.first?.auth, JSON.stringify(list).slice(0, 200));
      // 上游网络不通时读内置快照 —— 但必须如实回传 live=false（不许冒充实时数据）
      h.check("② live 标志是布尔（true=实时上游 / false=内置快照，UI 据此提示）",
        typeof list?.live === "boolean", JSON.stringify(list?.live));
      const cats = await h.eval(`window.codex.listOfficialMarketCategories().then((r) => ({ n: r.length, keys: r.map((x) => x.displayName), sum: r.reduce((s, x) => s + x.count, 0) })).catch((e) => ({ error: String(e) }))`);
      h.check("③ 分类 tab 由清单现算（≥8 类且数量之和 = 条目总数）",
        (cats?.n ?? 0) >= 8 && cats?.sum === list?.total, JSON.stringify(cats).slice(0, 160));
      // UI：设置 → 插件 → 切到「Codex 官方插件」源
      await h.eval(`(function(){ document.querySelector('.sidebar-settings')?.click(); return 1; })()`);
      await wait(1400);
      await h.eval(`(function(){ const items=[...document.querySelectorAll('.settings-nav button')];
        const i=items.findIndex((b)=>(b.textContent||'').trim()==='插件'); if(i>=0) items[i].click(); return i; })()`);
      await wait(1600);
      const switched = await h.eval(`(function(){ const tabs=[...document.querySelectorAll('.market-source-switch .segmented-tabs button')];
        const t=tabs.find((b)=>(b.textContent||'').includes('Codex 官方')); if(t) t.click(); return tabs.length; })()`);
      await wait(2600);
      const ui = await h.eval(`(function(){ const box=document.querySelector('.codex-official-market');
        const modal=document.querySelector('.settings-modal')?.innerText||'';
        // 两个源共用 .plugin-market-block 容器皮肤 ⇒ 「Gitee 块消失」只能按标题文案判，不能按类名判
        const giteeTitle=[...document.querySelectorAll('.plugin-market-title')].some((el)=>(el.textContent||'').includes('来自 Gitee 官方镜像'));
        return { tabs: document.querySelectorAll('.market-source-switch .segmented-tabs button').length,
          hasBox: !!box, cards: document.querySelectorAll('.codex-official-market-card').length,
          addable: document.querySelectorAll('.codex-official-market-card .skill-add:not([disabled])').length,
          authNotes: document.querySelectorAll('.codex-official-market-auth').length,
          installedFlags: document.querySelectorAll('.codex-official-market-flag').length,
          mentionsRepo: modal.includes('openai/plugins'), giteeVisible: giteeTitle }; })()`);
      h.check("④ 插件页有两个源切换，切到官方源后卡片真渲染、Gitee 块让位（安装钮可用 = 有安装入口）",
        switched === 2 && ui?.hasBox && (ui?.cards ?? 0) > 0 && (ui?.addable ?? 0) > 0 && ui?.giteeVisible === false, JSON.stringify(ui).slice(0, 220));
      h.check("⑤ 每张卡片都带鉴权提示（装了不等于能用，「已安装」不许骗人）",
        (ui?.authNotes ?? 0) === (ui?.cards ?? -1) && ui?.mentionsRepo, JSON.stringify({ notes: ui?.authNotes, cards: ui?.cards, mentionsRepo: ui?.mentionsRepo }));
      // 已安装反馈：判定来自本地 marker（零网络通道），不是引擎 plugin/list 的命名巧合
      const local = await h.eval(`window.codex.listInstalledOfficialMarketPlugins().then((r) => ({ n: (r ?? []).length, sample: r?.[0]?.slug ?? null })).catch((e) => ({ error: String(e) }))`);
      h.check("⑥ 本地已装清单通道可用（零网络扫描；装了没被引擎认领也看得见，且与 list 回传的 installedIds 同源）",
        typeof local?.n === "number" && local.n === (list?.installedIds ?? []).length, JSON.stringify({ local, marketInstalled: list?.installedIds?.length }));
    },
  },
  {
    id: "ui-sketch",
    name: "㉑ 前端开发（三形态画布：入口链路 → 桥握手 → 手机+电脑屏 / platform web 真落盘 → 一键预览 → 原样还原，10-06 轮重写）",
    run: async (h) => {
      // 为什么必须真跑：这条链路的接缝（侧栏按钮 → bag 开关 → AppView 挂载 → sketch:// 协议
      // → CSP frame-src → 随包产物 + 内联桥）**每一个都能在 tsc/预检全绿的情况下静默白屏**
      // —— pet:// 当年就是这么漏过去的（【232】②）。只有真实构建产物 + 真实 CSP 才算数。
      // ⛔ 10-06 重写：探针从"单屏"升级为**三形态**（手机屏 412×892 + 电脑屏 1280×800 +
      //    platform "web"）—— 画布真实支持的形态此前从没在真产物上落过盘；检查编号同步
      //    改成执行顺序（旧版 ⑧ 垫底是历史编号，读起来对不上）。
      const opened = await h.eval(`(function(){
        const tabs=[...document.querySelectorAll('.sidebar-tabs .sidebar-tab')];
        const more=tabs.find((t)=>((t.textContent||'').trim()==='更多'));
        if(!more) return { found:false, tabs: tabs.map((t)=>(t.textContent||'').trim()) };
        more.click(); return { found:true }; })()`);
      h.check("① 侧栏导航区有「更多」入口（前置条件：找不到就整项作废，不许往下假通过）", opened?.found === true, JSON.stringify(opened).slice(0, 200));
      await wait(600);
      const hub = await h.eval(`(function(){ const m=document.querySelector('.more-hub-modal');
        if(!m) return { open:false };
        return { open:true, rows:[...m.querySelectorAll('.ext-hub-list > button strong')].map((s)=>(s.textContent||'').trim()),
          navTitles:[...document.querySelectorAll('.sidebar-tabs .sidebar-tab')].map((t)=>(t.textContent||'').trim()) }; })()`);
      h.check("② 弹窗五项齐全且「前端开发」在列，且知识库 / AI 画布工作流没有平铺回导航区",
        hub?.open === true && ["AI 画布工作流", "前端开发", "知识库", "组件库", "人格市场"].every((title) => (hub?.rows ?? []).includes(title))
          && !(hub?.navTitles ?? []).some((t) => t === "知识库" || t === "AI 画布工作流"),
        JSON.stringify({ rows: hub?.rows, nav: hub?.navTitles }));
      await h.eval(`(function(){ const rows=[...document.querySelectorAll('.more-hub-modal .ext-hub-list > button')];
        const row=rows.find((b)=>(b.textContent||'').includes("前端开发")); if(row) row.click(); return !!row; })()`);
      await h.waitFor(`!!document.querySelector('.ui-sketch-shell')`, { label: "前端开发浮层", timeoutMs: 15000 });
      const frame = await h.eval(`(function(){ const f=document.querySelector('.ui-sketch-frame');
        if(!f) return { has:false };
        const r=f.getBoundingClientRect(); const s=document.querySelector('.ui-sketch-shell').getBoundingClientRect();
        return { has:true, src:f.src, w:Math.round(r.width), h:Math.round(r.height), shellW:Math.round(s.width), shellH:Math.round(s.height) }; })()`);
      h.check("③ 浮层打开且 iframe 走随包协议、**占满整块主体**（不许再塞并排面板挤窄画布 —— 10-05 用户「上面按键遮住了」）",
        frame?.has === true && String(frame?.src).startsWith("sketch://")
          && Math.abs(frame.w - frame.shellW) <= 2 // 主体区 = shell 高 - 标题栏 - 状态条（约 71px），给 90 的余量
          && frame.h >= frame.shellH - 90 && frame.w > 900, JSON.stringify(frame));
      // 桥应答 = 协议 + CSP + 产物 + postMessage 四处同时通了（读不到 DOM，只能靠这个握手判）
      const ready = await h.waitFor(`document.querySelector('.ui-sketch-shell')?.getAttribute('data-bridge')==="ready"`,
        { label: "画布桥应答（data-bridge=ready）", timeoutMs: 25000 }).then(() => true).catch(() => false);
      const meta = await h.text(".ui-sketch-meta").catch(() => "");
      h.check("④ 与嵌入站的读回桥握手成功（这一条为假 = 协议/CSP/产物任一处断了，且不会有任何报错）", ready === true, `meta=${String(meta).slice(0, 90)}`);
      /* ⑤「取回画布」= 按需再走一次读通道。首帧那次 ready 只证明握手成立，
         不证明"用户改完之后随时读得到最新内容"—— 那才是这个按钮的语义。 */
      await h.eval(`(function(){ const btn=[...document.querySelectorAll('.ui-sketch-head button')].find((b)=>(b.textContent||'').includes('取回画布')); btn?.click(); return !!btn; })()`);
      await wait(900);
      const synced = await h.eval(`(function(){ return { status:(document.querySelector('.ui-sketch-status')?.textContent||'').trim(),
        warn:document.querySelector('.ui-sketch-warn')?.textContent||"" }; })()`);
      h.check("⑤「取回画布」走通读通道（状态条给出取回结果，且没有诊断告警）",
        synced?.status === "已取回当前画布" && !synced?.warn, JSON.stringify(synced).slice(0, 200));
      /* ⑥ 只证明"协议 + CSP + postMessage"三处通了还不够 —— 桥是内联在 <head> 的，
         编辑器 chunk 还没 hydration 也能应答 ready，那时画布其实还是骨架屏。
         这一条要的是**读回通道真的拿到了编辑器写进 localStorage 的文档**（标题栏才会出现「屏 / 部件」）。 */
      const booted = await h.waitFor(
        `(document.querySelector('.ui-sketch-meta')?.textContent || "").indexOf("部件") >= 0`,
        { label: "画布编辑器启动并回传文档", timeoutMs: 25000 }
      ).then(() => true).catch(() => false);
      const bootedMeta = await h.text(".ui-sketch-meta").catch(() => "");
      h.check("⑥ 嵌入站真的启动了、且把画布内容读回宿主（骨架屏不算通过）", booted === true, `meta=${String(bootedMeta).slice(0, 80)}`);
      /* ⑦–⑧ 写回通道（真产物验证）：工具面接线由守卫【283】静态钉死；这里真跑的是 **真实上游**
         会不会接受我们的分享哈希 —— 桥把文档编码成 `#docz=` 挂 location.hash，m3e 自己
         hashchange → arrive() 落盘。⛔ VM 守卫里那个"上游"是模拟的；只有这里能证明真产物收我们的编码。
         10-06 探针升级为**三形态**：手机屏（412×892）+ 电脑屏（1280×800，桌面专属组件 navRail）
         + platform "web" —— 画布真实支持的形态必须在真产物上落一次盘。
         ⛔ 探针先从画布读回原文档，测完写回去还原（持久 profile 不该被验收改脏）。 */
      const originalMeta = await h.text(".ui-sketch-meta").catch(() => "");
      const written = await h.eval(`(async function(){
        const f = document.querySelector('.ui-sketch-frame');
        if (!f || !f.contentWindow) return { error: 'no-iframe' };
        const SOURCE = 'codex-harness-sketch';
        const waitMsg = (type, ms) => new Promise((resolve) => {
          const on = (event) => { const d = event.data || {};
            if (d.source !== SOURCE || d.type !== type) return;
            window.removeEventListener('message', on); resolve(d); };
          window.addEventListener('message', on);
          setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, ms);
        });
        const readback = waitMsg('doc', 8000);
        f.contentWindow.postMessage({ source: SOURCE, type: 'get-doc' }, '*');
        const original = await readback;
        const probe = { title: '验收探针·三形态', platform: 'web',
          frames: [
            { id: 'acc-phone', name: '验收手机屏', x: 0, y: 0 },
            { id: 'acc-desktop', name: '验收电脑屏', x: 492, y: 0, w: 1280, h: 800 }],
          groups: [
            { id: 'acc-g1', x: 0, y: 0, axis: 'x', items: [
              { id: 'acc-i1', kind: 'topAppBar', label: '验收', icon: null, variant: 'filled' }] },
            { id: 'acc-g2', x: 492, y: 0, axis: 'x', items: [
              { id: 'acc-i2', kind: 'navRail', label: '', icon: null, variant: 'filled',
                tabs: [{ icon: 'home', label: '首页' }, { icon: 'search', label: '搜索' }, { icon: 'settings', label: '设置' }] }] },
            { id: 'acc-g3', x: 16, y: 112, axis: 'x', items: [
              { id: 'acc-i3', kind: 'avatar', label: '李', icon: null, variant: 'filled', size: 56 }] }] };
        const done = waitMsg('load-doc-result', 12000);
        f.contentWindow.postMessage({ source: SOURCE, type: 'load-doc', doc: probe }, '*');
        const result = await done;
        return { original: original ? original.doc : null, result: result ? { ok: result.ok === true, error: result.error || '' } : null };
      })()`);
      h.check("⑦ 写回通道真跑：真实上游接受我们的分享哈希（load-doc-result ok:true —— 这一步只有真产物能证明）",
        written?.result?.ok === true, JSON.stringify(written?.result ?? written).slice(0, 220));
      const metaChanged = await h.waitFor(
        `(document.querySelector('.ui-sketch-meta')?.textContent || '').indexOf("2 屏 / 3 部件") >= 0`,
        { label: "写入后宿主摘要更新", timeoutMs: 10000 }
      ).then(() => true).catch(() => false);
      h.check("⑧ 三形态 + 补丁组件都得真落盘：宿主摘要显示「2 屏 / 3 部件」（手机屏 + 电脑屏 + platform web + **补丁层的 avatar** 全被上游收下；排除「哈希改了、画布没动」的静默拒收）",
        metaChanged === true);
      /* ⑨ 一键预览（趁三形态探针还在 —— 手机屏 / 电脑屏都有内容；空画布时上游没什么可预览，
         所以这一项必须在探针落盘之后、还原之前跑）。上游那颗 play_arrow 键只有真实渲染出来
         才找得到；桥回执（点没点到）与宿主状态条（回执处理）两处都验，跨源里这是唯一可观测面，
         预览画面本身由上游渲染 —— 紧随其后的截图即视觉旁证。 */
      const preview = await h.eval(`(async function(){
        const f = document.querySelector('.ui-sketch-frame');
        if (!f || !f.contentWindow) return { error: 'no-iframe' };
        const SOURCE = 'codex-harness-sketch';
        const done = new Promise((resolve) => {
          const on = (event) => { const d = event.data || {};
            if (d.source !== SOURCE || d.type !== 'preview-result') return;
            window.removeEventListener('message', on); resolve(d); };
          window.addEventListener('message', on);
          setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, 8000);
        });
        f.contentWindow.postMessage({ source: SOURCE, type: 'preview' }, '*');
        const r = await done;
        return { result: r ? { ok: r.ok === true, error: r.error || '' } : null };
      })()`);
      await wait(900);
      const previewStatus = await h.text(".ui-sketch-status").catch(() => "");
      h.check("⑨ 一键预览真跑：真实产物里找到上游的播放键并点到（桥回执 ok:true，宿主状态条同步「预览已开始」）",
        preview?.result?.ok === true && String(previewStatus).includes("预览已开始"),
        JSON.stringify({ receipt: preview?.result ?? preview, status: String(previewStatus).slice(0, 80) }));
      // 截图前关掉宿主自己的引导浮层（环境体检；它启动后**异步**才弹 ⇒ 单点容易漏，间隔点三遍）
      await h.clickByText("全部稍后再说").catch(() => undefined);
      await wait(900);
      await h.clickByText("全部稍后再说").catch(() => undefined);
      await wait(600);
      await h.clickByText("全部稍后再说").catch(() => undefined);
      await wait(700);
      await h.screenshot("uisketch");
      /* ⑩ 还原放在截图之后（截图拍的是"三形态内容 + 预览已开"的画面；还原是收尾不留痕）。 */
      const restore = await h.eval(`(async function(){
        const f = document.querySelector('.ui-sketch-frame');
        const original = ${JSON.stringify(JSON.stringify(written?.original ?? null))};
        if (!f || !f.contentWindow || original === 'null') return { skipped: true };
        const SOURCE = 'codex-harness-sketch';
        const done = new Promise((resolve) => {
          const on = (event) => { const d = event.data || {};
            if (d.source !== SOURCE || d.type !== 'load-doc-result') return;
            window.removeEventListener('message', on); resolve(d); };
          window.addEventListener('message', on);
          setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, 12000);
        });
        f.contentWindow.postMessage({ source: SOURCE, type: 'load-doc', doc: JSON.parse(original) }, '*');
        const r = await done;
        return { ok: r ? r.ok === true : false };
      })()`);
      const metaRestored = restore?.skipped ? true : await h.waitFor(
        `(document.querySelector('.ui-sketch-meta')?.innerText || '').trim() === ${JSON.stringify(originalMeta)}`,
        { label: "还原后摘要回到进入前原文", timeoutMs: 10000 }
      ).then(() => true).catch(() => false);
      h.check("⑩ 验收不留痕：原文档写回后摘要回到进入前原文（画布原本为空时跳过还原，信息里注明）",
        restore?.skipped ? true : (restore?.ok === true && metaRestored === true),
        restore?.skipped ? "画布原本为空，探针文档留存" : JSON.stringify({ restoreOk: restore?.ok, metaRestored, originalMeta: String(originalMeta).slice(0, 60) }));
      /* ⛔ 捞一拍再关应用：Chromium 的 localStorage 是**惰性提交**（写入先攒在浏览器进程内存，
         约 5s 才落盘）——本项跑完 accept 立刻关应用，不预留这一拍，**还原那一次写入会随进程一起丢**，
         下次运行读到的还是探针文档（10-05 夜实测的 profile 反复漂移根因；⑦ 的写入因为早 5s+ 反而落上了）。 */
      await wait(6000);
      await h.eval(`(function(){ document.querySelector('.ui-sketch-head button[title="关闭"]')?.click(); return 1; })()`);
      await wait(500);
      const closed = await h.eval(`!!document.querySelector('.ui-sketch-shell')`);
      h.check("⑪ 关闭键真的收起浮层（关不掉的模态会挡住后面所有验收项）", closed === false, `stillOpen=${closed}`);
    },
  },
  {
    id: "file-summary",
    name: "㉓ 文件更改汇报 · 真回合全链路（运行中实时编辑行 + 收尾汇总卡 + 交互，10-06 两次重写）",
    run: async (h) => {
      /* 为什么这样测（10-06 重写 + 二次扩充，用户实况倒逼）：上一版用 window.dispatchEvent 注入假事件驱动卡片 ——
         它证明了「卡会画」，却放过了两条真实链路缺陷：渲染层监听的是**死信道**（window "message"
         全仓无发送方）、主进程广播的 turnId 是**线程 id**（卡按回合 id 取）。用户真机一跑就是空卡。
         本版**零注入**，真链路全段：
           · 真起一个引擎回合（模型 = echo + sleep 8 + 回 ok）——真 turn/started → 追踪器快照 → turn/completed → diff；
           · 回合进行中由**测试进程分两批**往会话工作区落 8 个文件 —— 谁写的文件不重要（追踪器只看目录差异），
             "主进程报告"这一环必是真的；上一版的 8 条 fixture 在这里变成盘上真文件（预览能真读盘）；
           · ③④ 断言**运行中**就有「编辑 <文件> +N -M」实时行、且第二批写入后行数长出来
             （用户 10-06 明确纠正的口径：**运行中是运行中的（数字跟在编辑行文件后面）；汇总是汇总** ——
             实时行由主进程每 2.5s 轻量重扫广播，sleep 8 就是给两次采样留的窗口）；
           · 广播必须从真通道 onHarnessEvent 到达、turnId 必须 == 真回合 id、汇总卡必须原样出现。
         ⛔ 偏离 09-12 「不发新消息」定稿一处的理由：不发消息就起不了真回合，而正是"注入式假回合"
            放过了整条链路 bug；本项只往**已有会话**现有回合后追加一个小回合（不新建会话）。
         ⛔ 前置：e2e profile 需已配模型（custom-model.json + custom-models.json；缺失时 send 会被
            「请先配置模型」拦下 → 本项红并给出提示）。 */
      const probeDirName = "accept-card-probe";
      let probeDir = null;
      try {
        /* ① 订阅真通道：事件的到达与 turnId 对错，都靠它作证（这是真 IPC 通道，不是 window message）。 */
        await h.eval(`(function(){
          window.__fswEvents = [];
          window.codex.onHarnessEvent(function(ev){ if (ev && ev.type === "turn-file-changes") window.__fswEvents.push(ev); });
          return 1; })()`);
        /* ① 等界面就绪再解析工作区：验收在应用刚连上 CDP 时就开跑，侧栏会话行可能还没渲染
           （实测 15ms 内直接查 = null 的假红）——先等「活跃会话行 + 输入框」出现。 */
        await h.waitFor(`!!document.querySelector(".thread-row.active") && !!document.querySelector(".composer-editor")`, { label: "界面就绪（活跃会话行 + 输入框）", timeoutMs: 30000 }).catch(() => undefined);
        const activeThread = await h.eval(`(async function(){
          const row = document.querySelector(".thread-row.active");
          const id = row ? row.getAttribute("data-thread-id") : null;
          if (!id) return null;
          const res = await window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc" });
          const hit = (res && res.data ? res.data : []).find(function(t){ return t.id === id; });
          return { id: String(id), cwd: hit && hit.cwd ? String(hit.cwd) : null }; })()`);
        const cwd = activeThread && activeThread.cwd;
        const activeThreadId = activeThread ? activeThread.id : null;
        h.check("① 前置：拿得到当前会话工作区（拿不到 = 追踪器无处快照，整项作废）",
          typeof cwd === "string" && cwd.length > 1, `cwd=${String(cwd).slice(0, 60)}`);
        if (typeof cwd !== "string" || cwd.length < 2) return;
        /* ①b 任务清单播种（10-06 夜三轮）：「任务清单必须由 Codex 自己更新」的展示链 ——
           真 IPC addTask → 主进程 tasks-changed 广播 → 渲染层 bag 刷新 → 胶囊出「步骤 0/2」。
           （Codex 侧走 task_add 工具，走的是同一条广播。）先清上一轮可能的残留（幂等）；收尾时删除。
           此刻无文件区（回合还没跑）⇒ 顺带验证「两区独立可显示、单独存在即居中」的规则。 */
        const seededIds = await h.eval(`(async function(){
          const list = await window.codex.listTasks();
          for (const t of list) { if (String(t.text||'').startsWith("验收步骤")) await window.codex.deleteTask(t.id); }
          const a = await window.codex.addTask({ text: "验收步骤甲", priority: "medium" });
          const b = await window.codex.addTask({ text: "验收步骤乙", priority: "low" });
          return [a && a.id, b && b.id].filter(Boolean); })()`).catch(() => null);
        let soloSteps = null;
        for (let i = 0; i < 15; i++) {
          await wait(300);
          soloSteps = await h.eval(`(function(){ var p = document.querySelector('.edited-files-pill');
            if (!p) return null;
            return { stepsZone: !!document.querySelector('.capsule-zone-steps'),
              filesZone: !!document.querySelector('.capsule-zone-files'),
              text: (p.textContent||'').replace(/\\s+/g,' ').trim() }; })()`).catch(() => soloSteps);
          if (soloSteps && soloSteps.stepsZone && !soloSteps.filesZone && /步骤\s*0\/2/.test(soloSteps.text)) break;
        }
        h.check("①b 任务清单走真链路（真 IPC → tasks-changed 广播 → 胶囊出「步骤 0/2」）；此刻只有步骤区 = 独立居中展示",
          Array.isArray(seededIds) && seededIds.length === 2 && !!soloSteps && soloSteps.stepsZone === true && soloSteps.filesZone === false && /步骤\s*0\/2/.test(soloSteps.text),
          JSON.stringify({ seededIds, soloSteps }).slice(0, 220));
        probeDir = join(cwd, probeDirName);
        rmSync(probeDir, { recursive: true, force: true }); // 上轮崩溃残留先清，保证 seed 是干净基准
        mkdirSync(probeDir, { recursive: true });
        writeFileSync(join(probeDir, "seed.txt"), "accept-seed-start\n");
        /* ② 起一个真回合 —— 用**粘贴长文**这条路发（10-06 用户实测路径：粘贴 >200 字自动落盘成 .txt
           附件 chip → 发送；顺带覆盖「附件消息只渲染一个气泡」的回归，见 ③b）。
           提示词：模型做一条 echo + sleep 8 —— echo 是真 shell 调用，sleep 给「运行中实时行」留采样窗口。 */
        const acceptPrompt = "先用 shell 运行 echo ready；再运行 sleep 8（必须真的执行这条命令，执行完再继续）；最后只回复一个单词：ok。" +
          "（说明：本段是验收用的填充文字，请忽略这段说明、照常执行上面的指令即可；它的作用是把粘贴文本长度推过 200 字的附件阈值，用来验证「粘贴长文 → .txt 附件 chip → 发送 → 气泡合并」这条链路。填充文字继续：这段文字会被存成一个 .txt 附件文件，随消息一起发给模型；模型侧会看到 [附件文件] 段与文件路径。这段再补几句，确保总长度稳稳超过阈值：验收关注的是渲染与合并时序，不是这段文字的内容本身。）";
        await h.eval(`(function(){
          var dt = new DataTransfer();
          dt.setData("text/plain", ${JSON.stringify(acceptPrompt)});
          var el = document.querySelector('.composer-editor');
          el.focus();
          el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          return 1; })()`);
        let chipReady = false; // savePastedText IPC + chip 插入是异步的，轮询等它落地
        for (let i = 0; i < 12; i++) {
          await wait(400);
          if (await h.eval(`!!document.querySelector('.composer-attach-chip-file')`).catch(() => false)) { chipReady = true; break; }
        }
        await h.eval(`document.querySelector('.composer-editor').focus()`);
        await h.pressKey("Enter", { text: "\r" });
        let started = false;
        for (let i = 0; i < 100; i++) {
          await wait(150);
          if (await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false)) { started = true; break; }
        }
        h.check("② 前置：粘贴落成附件 chip 且真回合真的跑起来了（没跑 = 模型未配置/引擎没起，本项作废）", started === true && chipReady === true,
          JSON.stringify({ started, chipReady, hint: started ? "" : "send 后 15s 未见运行态 —— 先确认 .e2e-profile/main 的 custom-model.json / custom-models.json 有可用模型" }));
        if (!started) return;
        /* ③b 粘贴附件消息中途**只渲染一个气泡**（10-06 用户实测「渲染两次」= 乐观气泡不合并：
           两侧可见文本都为空、旧匹配器直接落空到图片分支返回 false；修法 = userMessageMatchesInput
           按附件文件列表比对）。判据在**运行中**采样：**最后一个回合组内恰好 1 个气泡**（新消息），
           且**全局无 pending**（没合并的乐观气泡就挂成 pending 双影）。⛔ 不数整屏总数：
           会话里有历史消息、基线会被搅乱（10-06 实测踩过）。
           ⛔ 本循环必须放在落盘之前且尽快结束（合并通常 1~2s 内完成）：它拖久了会把两批写入
              拖到回合收尾之后（实测把 ③/④ 全拖红）。 */
        let bubbleSeen = null;
        let bubbleOk = false;
        for (let i = 0; i < 15; i++) {
          await wait(400);
          bubbleSeen = await h.eval(`(function(){
            var groups = [...document.querySelectorAll('.turn-group')];
            var last = groups[groups.length - 1];
            var all = [...document.querySelectorAll('.message.user-message')];
            return { inLastTurn: last ? last.querySelectorAll('.message.user-message').length : 0,
              pending: all.filter(function(n){ return n.classList.contains('pending'); }).length,
              running: !!document.querySelector('.send-button.is-pause') };
          })()`).catch(() => bubbleSeen);
          if (bubbleSeen && bubbleSeen.running && bubbleSeen.pending === 0 && bubbleSeen.inLastTurn === 1) { bubbleOk = true; break; }
          if (bubbleSeen && !bubbleSeen.running) break; // 回合都结束还没合并 = 真失败
        }
        h.check("③b 粘贴附件消息中途只渲染一个气泡（乐观气泡已合并，不出现 pending 双影——10-06 用户实测问题）",
          bubbleOk === true, JSON.stringify(bubbleSeen));
        /* ③ 回合进行中**分两批**落盘 8 个文件 —— 追踪器 diff 的唯一来源。
           ⛔ 必须在 turn/started（快照已拍）之后写：写入早于快照会进"改前状态"、diff 不报。
           ⛔ 分两批是给「运行中实时行」两次采样窗口：第二批写入后行数必须长出来 = 真在实时更新
             （运行中是运行中的、汇总是汇总 —— 用户 10-06 明确口径；实时行由主进程每 2.5s 轻量重扫广播）。 */
        const LIVE_OURS = ["notes.md", "data.json", "seed.txt", "app.css", "index.html", "util.mjs", "readme.txt", "logo.svg"];
        const liveRowsExpr = `(function(){
          return [...document.querySelectorAll('.live-edit-row')].map(function(r){
            return { text: (r.innerText||'').replace(/\\s+/g,' ').trim().slice(0,120),
              stats: [...r.querySelectorAll('.live-edit-stats b, .live-edit-stats i')].map(function(x){ return x.textContent; }).join(' '),
              icons: r.querySelectorAll('svg').length };
          });
        })()`;
        const ourLive = (rows) => (rows || []).filter((r) => LIVE_OURS.some((n) => String(r.text).includes(n)));
        writeFileSync(join(probeDir, "notes.md"), "# notes\n- alpha\n- beta\n");
        writeFileSync(join(probeDir, "data.json"), '{ "k": 1 }\n');
        writeFileSync(join(probeDir, "seed.txt"), "accept-seed-start\naccept-seed-append\n");
        /* 轮询等第一批实时行出现（主进程 2.5s 一拍 + 轻量重扫耗时 ⇒ 单次固定采样会偶发早于首次广播）。
           ⛔ 窗口按**慢工作区**取：本轮实测 cwd = 用户主目录这类大树时，一圈 walkLight 远超 2.5s，
             8s 窗口会假红（当时 ④ 拿到 8 行、③ 仍是 0）⇒ 15s。 */
        let liveFirst = [];
        for (let i = 0; i < 30; i++) {
          await wait(500);
          liveFirst = await h.eval(liveRowsExpr).catch(() => liveFirst);
          if (ourLive(liveFirst).length >= 2) break;
        }
        h.check("③ 运行中·实时行出现：回合进行中就有「编辑 <文件> +N -M」行（含刚写入的文件，且各自带数字与类型图标）",
          ourLive(liveFirst).length >= 2 && ourLive(liveFirst).every((r) => /[+-]\d/.test(r.stats) && r.icons >= 2),
          JSON.stringify(liveFirst). slice(0, 240));
        /* ④ 第二批落盘（4 文本 + 1 图片），等行数长出来 —— 证明数字是**跑着跳的**，不是收尾才一次算出。 */
        for (const [fileName, body] of [
          ["app.css", ".a{color:red}\n"],
          ["index.html", "<!doctype html><title>t</title>\n"],
          ["util.mjs", "export const add = (a,b)=>a+b;\n"],
          ["readme.txt", "hello accept\n"],
        ]) writeFileSync(join(probeDir, fileName), body);
        writeFileSync(join(probeDir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#e53935"/></svg>');
        let liveSecond = liveFirst;
        for (let i = 0; i < 30; i++) {
          await wait(400);
          liveSecond = await h.eval(liveRowsExpr).catch(() => liveSecond);
          if (ourLive(liveSecond).length > ourLive(liveFirst).length) break;
        }
        h.check("④ 运行中·实时更新：第二批文件写入后实时行数量长出来（数字是跑着跳的，不是收尾才算）",
          ourLive(liveSecond).length > ourLive(liveFirst).length,
          JSON.stringify({ first: ourLive(liveFirst).length, second: ourLive(liveSecond).length, names: ourLive(liveSecond).map((r) => String(r.text).split(" ")[1] || ""), hint: ourLive(liveSecond).length === 0 ? "实时行整组消失 = 回合先结束了（模型这次没真 sleep，第二批广播赶不上）" : "" }).slice(0, 300));
        /* ④b-④d 回合状态胶囊（10-06 夜三轮重构 · 用户对照 Qoder：「步骤 0/6 · 5 个文件已修改
           +177 -8」+「两区都可独立居中展示，多了另一方才拼接」+「放左边=步骤清单，放右边=文件」）：
           ④b 拼接形态（两区同时在）；④c 悬停右区出文件清单；④d 悬停左区出步骤清单。 */
        let capsule = null;
        for (let i = 0; i < 15; i++) {
          await wait(400);
          capsule = await h.eval(`(function(){
            var pill = document.querySelector('.edited-files-pill');
            if (!pill) return null;
            return { text: (pill.textContent||'').replace(/\\s+/g,' ').trim(),
              stepsZone: !!document.querySelector('.capsule-zone-steps'),
              filesZone: !!document.querySelector('.capsule-zone-files') };
          })()`).catch(() => capsule);
          if (capsule && capsule.stepsZone && capsule.filesZone) break;
          if (!await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => true)) break;
        }
        h.check("④b 胶囊拼接：任务清单 + 文件改动同时在 ⇒「步骤 N/M · X 个文件已修改 +N -M」（用户对照 Qoder 的形态）",
          !!capsule && capsule.stepsZone === true && capsule.filesZone === true && /步骤\s*0\/2/.test(capsule.text) && /个文件已修改/.test(capsule.text),
          JSON.stringify(capsule).slice(0, 220));
        if (capsule?.filesZone) await h.hover(".capsule-zone-files").catch(() => undefined);
        await wait(500);
        const capsulePop = await h.eval(`(function(){
          var p = document.querySelector('.edited-files-pop');
          var pill = document.querySelector('.edited-files-pill');
          if (!p) return null;
          var r = p.getBoundingClientRect();
          var pr = pill ? pill.getBoundingClientRect() : null;
          var gap = pr ? Math.abs((r.left + r.width / 2) - (pr.left + pr.width / 2)) : 0;
          var clamped = r.left <= 9 || r.right >= innerWidth - 9;
          return { rows: p.querySelectorAll('.edited-files-row').length,
            fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
            centered: gap <= 2 || clamped, gap: Math.round(gap),
            names: [...p.querySelectorAll('.edited-files-row code')].map(function(c){ return (c.textContent||'').trim(); }) };
        })()`).catch(() => null);
        const capsuleOurs = capsulePop ? LIVE_OURS.filter((n) => (capsulePop.names ?? []).some((x) => String(x).toLowerCase().includes(n))).length : 0;
        h.check("④c 悬停右区（文件）：出文件清单（自适应不被裁、以胶囊中心居中、含我们写的文件）",
          !!capsulePop && capsulePop.fits === true && capsulePop.centered === true && capsuleOurs >= 2,
          JSON.stringify({ capsulePop: capsulePop ? { rows: capsulePop.rows, fits: capsulePop.fits, centered: capsulePop.centered, gap: capsulePop.gap } : null, capsuleOurs }).slice(0, 240));
        await h.moveMouseAway().catch(() => undefined);
        await wait(300);
        await h.hover(".capsule-zone-steps").catch(() => undefined);
        await wait(600);
        const stepsPop = await h.eval(`(function(){
          var p = document.querySelector('.edited-files-pop');
          if (!p) return null;
          var r = p.getBoundingClientRect();
          return { rows: [...p.querySelectorAll('.turn-step-row span')].map(function(x){ return (x.textContent||'').trim(); }),
            fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
            hasTodo: !!p.querySelector('.turn-step-row:not(.done)') };
        })()`).catch(() => null);
        h.check("④d 悬停左区（步骤）：出步骤清单（两条播种任务原样在列、todo 态、自适应以内）",
          !!stepsPop && (stepsPop.rows ?? []).some((t) => t.includes("验收步骤甲")) && (stepsPop.rows ?? []).some((t) => t.includes("验收步骤乙")) && stepsPop.fits === true,
          JSON.stringify(stepsPop).slice(0, 240));
        await h.moveMouseAway().catch(() => undefined);
        /* ⑤ 等回合收尾（真 turn/completed → 主进程结算广播；收尾会先清 live 再发最终报告）。 */
        let ended = false;
        for (let i = 0; i < 600; i++) {
          await wait(200);
          if (!await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => true)) { ended = true; break; }
        }
        h.check("⑤ 前置：回合正常收尾（120s 内结束）", ended === true, ended ? "" : "超过 120s 仍在运行");
        await wait(1200); // 广播在 turn/completed 发出；给 UI 与 IPC 一拍
        /* ⑦ 真广播：从 onHarnessEvent 到达，且 turnId == DOM 里那个真回合的 id（旧版 bug：广播的是线程 id）。 */
        const turnId = await h.eval(`(function(){ const g=[...document.querySelectorAll('.turn-group[id^="turn-"]')]; const el=g[g.length-1]; return el ? el.id.replace('turn-','') : null; })()`);
        const eventsRaw = await h.eval(`JSON.stringify((window.__fswEvents||[]).map(function(ev){ return { turnId: String(ev.turnId||""), files: (ev.files||[]).map(function(f){ return { path: String(f.path||""), status: String(f.status||"") }; }) }; }))`);
        const events = JSON.parse(eventsRaw || "[]");
        const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase();
        const mine = (events || []).find((ev) => ev.turnId === turnId) ?? null;
        const mineFiles = mine?.files ?? [];
        const hasFile = (n, status) => mineFiles.some((f) => norm(f.path).endsWith("/" + n) && (!status || f.status === status));
        const allPresent = ["notes.md", "data.json", "app.css", "index.html", "util.mjs", "readme.txt", "logo.svg"].every((n) => hasFile(n, "added")) && hasFile("accept-card-probe/seed.txt", "modified");
        h.check("⑥ 真链路·广播到达：turnId == 真回合 id（10-06 修的 id 链；旧版发线程 id，永远对不上）",
          mine !== null, `turnId=${String(turnId).slice(0, 40)} events=${JSON.stringify(events).slice(0, 220)}`);
        h.check("⑦ 真链路·内容齐：广播里 7 个新文件(added) + seed.txt(modified) 全在",
          mine !== null && allPresent, JSON.stringify(mineFiles.map((f) => `${f.path.split("/").pop()}:${f.status}`)).slice(0, 260));
        /* ⑤b 收尾冻结（10-06 夜二改，用户实测「运行结束后，我查看过程没有 [这些 +N -M]」）：
           回合结束后编辑行**不再清场** —— 收成一块始终可见的「编辑 <文件> +N -M」，落在过程与
           最终答复之间。⛔ 读 textContent 而不是 innerText（折叠组收起时 innerText 是空串 ——
           项目排查方法论第 4 条点名过的坑），并断言**可见**（rect 高度 > 0）而不是只断言在 DOM 里
           （塞回折叠组里也能"存在"但看不见 —— 第一版就栽在这）。 */
        const frozenRows = await h.eval(`(function(){ const g=document.getElementById("turn-"+${JSON.stringify(turnId)}); if(!g) return null;
          return [...g.querySelectorAll('.live-edit-row')].map(function(r){ var rect = r.getBoundingClientRect();
            return { text:(r.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90), visible: rect.height > 0,
              stats:[...r.querySelectorAll('.live-edit-stats b, .live-edit-stats i')].map(function(x){return x.textContent;}).join(' ') }; }); })()`).catch(() => null);
        const frozenOurs = (frozenRows || []).filter((r) => LIVE_OURS.some((n) => String(r.text).includes(n)));
        h.check("⑤b 收尾后编辑行冻结保留且可见（回合结束过程里仍有「编辑 <文件> +N -M」行；不展开折叠也看得见）",
          frozenOurs.length >= 2 && frozenOurs.every((r) => /[+-]\d/.test(r.stats) && r.visible === true),
          JSON.stringify({ rows: frozenRows, ours: frozenOurs.length }).slice(0, 260));
        /* ⑤c 落盘（10-06 夜二改）：最终报告写进 <userData>/turn-file-changes/<threadId>.json ——
           重启后「已更改」卡与编辑行靠它在 thread/resume 时重播复活（读盘对账，当真数据检查）。 */
        let storeDetail = "";
        let storeOk = false;
        try {
          const storePath = join(h.userDataDir, "turn-file-changes", `${activeThreadId}.json`);
          const parsed = JSON.parse(readFileSync(storePath, "utf8"));
          const entry = parsed?.turns?.[turnId];
          const names = (entry?.files ?? []).map((f) => String(f.path).replace(/\\/g, "/").toLowerCase());
          storeOk = !!entry && names.some((p) => p.endsWith("/notes.md")) && names.some((p) => p.endsWith("/seed.txt"));
          storeDetail = `turns=${Object.keys(parsed?.turns ?? {}).length} files=${names.length}`;
        } catch (error) { storeDetail = String(error?.message ?? error).slice(0, 140); }
        h.check("⑤c 落盘：最终报告已写进 userData/turn-file-changes/<threadId>.json（重启后卡与编辑行复活的唯一数据源）",
          storeOk === true, storeDetail);
        /* ⑧ 卡片：真广播驱动的真卡（数据链路已由 ⑥⑦ 证明为真，这里验渲染与交互）。 */
        const cardSel = `document.getElementById("turn-" + ${JSON.stringify(turnId)})?.querySelector(".completed-changes")`;
        const head = await h.eval(`(function(){ const c=${cardSel};
          return c ? { text:(c.querySelector('summary')?.textContent||'').trim(), visible: c.querySelectorAll('.completed-file').length } : null; })()`);
        h.check("⑧ 「已更改 N 个文件」卡出现且折叠态先显 2 行（用户 10-06 夜令：最多一次展示 2 行，多的自动收纳；N = 卡内总行数，含环境噪声行）",
          !!head && /已更改\s*\d+\s*个文件/.test(head.text) && head.visible === 2, JSON.stringify(head));
        if (!head) return;
        const totalFiles = Number((head.text.match(/已更改\s*(\d+)\s*个文件/) || [])[1] ?? 0);
        /* ⑨ 展开：6 → 全部（我们的 8 个文件一个都不许缺）。 */
        const collapse = await h.eval(`(function(){ const c=${cardSel}; if(!c) return null;
          const more=c.querySelector('.completed-more');
          const before=c.querySelectorAll('.completed-file').length;
          const text=(more?.textContent||'').trim();
          more?.click();
          return { before, text }; })()`);
        await wait(300);
        const rowsAll = await h.eval(`(function(){ const c=${cardSel}; if(!c) return [];
          return [...c.querySelectorAll('.completed-file')].map(function(r){
            return { name: (r.querySelector('.completed-file-meta code')?.textContent||'').trim(),
              thumb: !!r.querySelector('.completed-file-thumb img'), isNew: !!r.querySelector('.completed-file-new') }; }); })()`);
        const names = (rowsAll ?? []).map((r) => r.name);
        h.check("⑨ 展开：2 行 + 「再显示 N 个文件」→ 全部行可见，且我们落的 8 个文件一个不缺",
          collapse?.before === 2 && /再显示\s*\d+\s*个文件/.test(collapse?.text || "") && (rowsAll?.length ?? 0) === totalFiles
            && ["notes.md", "data.json", "app.css", "index.html", "util.mjs", "readme.txt", "logo.svg", "seed.txt"].every((n) => names.some((x) => String(x).toLowerCase() === n || String(x).toLowerCase().endsWith("/" + n))),
          JSON.stringify({ collapse, totalFiles, names }).slice(0, 320));
        /* ⑩ 图片行：logo.svg 有缩略图 + 「新增」徽标（用户点名「还有生成的图片」）。 */
        const svgRow = (rowsAll ?? []).find((r) => String(r.name).toLowerCase().endsWith("logo.svg"));
        h.check("⑩ logo.svg 行显示缩略图 + 「新增」徽标", svgRow?.thumb === true && svgRow?.isNew === true, JSON.stringify(svgRow));
        /* ⑪ 点 notes.md 行 → 真文件预览弹窗（文件是盘上真货，预览器真读盘）。 */
        await h.eval(`(function(){ const c=${cardSel}; if(!c) return false;
          const row=[...c.querySelectorAll('.completed-file')].find((r)=>(r.querySelector('.completed-file-meta code')?.textContent||'').trim().toLowerCase()==='notes.md');
          if(!row) return false; row.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()`);
        const previewOpened = await h.waitFor(`!!document.querySelector('.file-preview')`, { label: "文件预览弹窗", timeoutMs: 8000 }).then(() => true).catch(() => false);
        const previewMeta = await h.text(".file-preview-meta").catch(() => "");
        h.check("⑪ 点行直接打开预览（弹窗打开，且预览的就是这一行的 notes.md）",
          previewOpened === true && String(previewMeta).includes("notes.md"), JSON.stringify({ previewOpened, previewMeta: String(previewMeta).slice(0, 80) }));
        await h.eval(`(function(){ document.querySelector('.file-preview .relay-modal-close')?.click(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return 1; })()`).catch(() => undefined);
        await wait(400);
        /* ⑫ 行右键 → 文件卡菜单两项点名（在文件夹中显示 = 「打开文件地址」/ 复制文件路径）。
           ⛔ 用 JS 派发 contextmenu（React 监听的正是这个原生事件）；派发后等一拍再读 DOM（setMenu 异步）。 */
        await h.eval(`(function(){ const c=${cardSel}; if(!c) return false;
          const row=[...c.querySelectorAll('.completed-file')].find((r)=>(r.querySelector('.completed-file-meta code')?.textContent||'').trim().toLowerCase()==='notes.md');
          if(!row) return false; const r=row.getBoundingClientRect();
          row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.left+40),clientY:Math.round(r.top+10)}));
          return true; })()`);
        await wait(300);
        const menuShown = await h.eval(`(function(){ const menu=document.querySelector('.file-card-menu');
          return { open: !!menu, items: menu? [...menu.querySelectorAll('button span')].map((s)=>(s.textContent||'').trim()) : [] }; })()`);
        h.check("⑫ 行右键弹出文件卡菜单，且含「在文件夹中显示」+「复制文件路径」（用户点名的两项）",
          menuShown?.open === true && (menuShown?.items ?? []).includes("在文件夹中显示") && (menuShown?.items ?? []).includes("复制文件路径"),
          JSON.stringify(menuShown));
        /* ⑬ 点「复制文件路径」：toast 是成功路径专属（.catch 只会给「复制失败」）。 */
        const copied = await h.eval(`(function(){ const b=[...document.querySelectorAll('.file-card-menu button')].find((x)=>(x.textContent||'').includes('复制文件路径'));
          if(!b) return false; b.click(); return true; })()`);
        await wait(600);
        const copyToast = await h.eval(`(function(){
          const nodes=[...document.querySelectorAll('.notice-toast, [class*="toast"]')];
          return nodes.some((el)=>{ const text=el.innerText||''; return text.includes('已复制文件路径') && text.includes('notes.md'); }); })()`).catch(() => false);
        h.check("⑬ 点「复制文件路径」成功回执：toast 同时带标题与文件名（成功路径专属）",
          copied === true && copyToast === true, JSON.stringify({ copied, copyToast }));
        await h.eval(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return 1; })()`).catch(() => undefined);
        await wait(300);
        /* ⑭ 收起重回 6 行（折叠往返闭合）。 */
        await h.eval(`(function(){ const c=${cardSel}; c?.querySelector('.completed-more')?.click(); return 1; })()`);
        await wait(300);
        const afterCollapse = await h.eval(`(function(){ const c=${cardSel}; return c? c.querySelectorAll('.completed-file').length : 0; })()`);
        h.check("⑭ 收起重回 2 行（收纳闭合往返）", afterCollapse === 2, `afterCollapse=${afterCollapse}`);
        /* ⑮ 收尾后：**文件区**消失（收尾由汇总卡接管）；**任务清单区保留**（有清单就有 —— 用户
           10-06 夜口径：任务清单还在就得能看到；两区独立渲染规则的另一半）。 */
        const afterSettle = await h.eval(`(function(){ var card = document.querySelector('.edited-files-card');
          if (!card) return { card: false };
          return { card: true, filesZone: !!document.querySelector('.capsule-zone-files'),
            stepsZone: !!document.querySelector('.capsule-zone-steps'),
            text: (document.querySelector('.edited-files-pill')?.textContent||'').replace(/\\s+/g,' ').trim() }; })()`);
        h.check("⑮ 回合结束后：文件区消失（收尾由汇总卡接管）、任务清单区保留（步骤 N/M 仍在）",
          !!afterSettle && afterSettle.card === true && afterSettle.filesZone === false && afterSettle.stepsZone === true && /步骤\s*0\/2/.test(afterSettle.text || ""),
          JSON.stringify(afterSettle));
        /* ⑯ 汇总卡行悬停出 diff 预览（10-06 用户图一：「鼠标放到汇总的修改的文件名上」；
            自适应落位不许被裁、左缘与该行对齐、含 @@ 差分行）。
            ⛔ 悬停前等**滚动静默**：`.timeline` 是 scroll-behavior:smooth，前面 ⑪-⑭ 的折叠/弹窗
            可能还留着平滑滚动在跑 —— 悬停后预览会被「外部滚动即关」正确关掉，造成假红
            （10-06 夜实测：完整序列后 2/3 次假红）。 */
        await h.eval(`(function(){ window.__lastScroll = Date.now(); if (!window.__scrollWatch) { window.__scrollWatch = 1;
          window.addEventListener('scroll', function(){ window.__lastScroll = Date.now(); }, true); } return 1; })()`).catch(() => undefined);
        const waitScrollQuiet = async () => { for (let i = 0; i < 20; i++) { await wait(200); if (await h.eval(`Date.now() - (window.__lastScroll || 0) > 500`).catch(() => false)) break; } };
        await waitScrollQuiet();
        /* ⛔ 悬停**重试至多 3 次**（10-06 夜实测：默认轮里紧随 ui-sketch 之后，CDP 真悬停会偶发
           落空 —— 单跑本项稳定通过、功能本身有独立探针佐证）。重试不掩盖缺陷：预览真坏了三次
           都中不了；全失败时输出 elementFromPoint 诊断便于下轮定位。 */
        let hoverPreview = null;
        let hoverAttempts = 0;
        for (; hoverAttempts < 3 && !hoverPreview; hoverAttempts++) {
          if (hoverAttempts > 0) { await h.moveMouseAway().catch(() => undefined); await wait(600); await waitScrollQuiet(); }
          await h.hover(".completed-changes .completed-file").catch(() => undefined);
          await wait(900);
          hoverPreview = await h.eval(`(function(){
            var p = document.querySelector('.completed-diff-preview');
            if (!p) return null;
            var r = p.getBoundingClientRect();
            var row = document.querySelector('.completed-changes .completed-file');
            var rr = row ? row.getBoundingClientRect() : null;
            return { vis: getComputedStyle(p).visibility, fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
              aligned: rr ? Math.abs(r.left - rr.left) <= 2 : null, hasDiff: (p.innerText||'').includes('@@') };
          })()`).catch(() => null);
        }
        if (!hoverPreview) {
          const diag = await h.eval(`(function(){ const row=document.querySelector('.completed-changes .completed-file');
            if(!row) return 'no-row'; row.scrollIntoView({block:'center',behavior:'instant'}); const r=row.getBoundingClientRect();
            const el=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
            return JSON.stringify({ top: el?(el.className||el.tagName).toString().slice(0,60):null, inRow: el?row.contains(el):null, scrollAgeMs: Date.now()-(window.__lastScroll||0) }); })()`).catch(() => 'diag-failed');
          console.log("  [⑯ 悬停诊断]", diag);
        }
        h.check("⑯ 汇总卡行悬停出 diff 预览（整矩形在视口内、左缘贴行、含 @@ 差分行）",
          !!hoverPreview && hoverPreview.vis === "visible" && hoverPreview.fits === true && hoverPreview.aligned === true && hoverPreview.hasDiff === true,
          JSON.stringify(hoverPreview) + ` attempts=${hoverAttempts}`);
        /* ⑯b 预览升级（10-06 夜二改，用户对照 Qoder：「他这种预览好看，鼠标放上去还能左右滚动和
           上下滚动，我们现在的 diff 预览好丑」）：行号槽 + 两轴滚动容器 + **面板内滚动不关窗**
           （合成 scroll 事件定向打到面板上——旧实现在捕获阶段一律关窗，这条会红）+ 展开钮在。 */
        const previewUp = await h.eval(`(function(){
          var p = document.querySelector('.completed-diff-preview');
          if (!p) return null;
          var body = p.querySelector('.diffp');
          if (body) body.dispatchEvent(new Event('scroll', { bubbles: true }));
          var line = p.querySelector('.diffp-line');
          return { hasBody: !!body, gutter: p.querySelectorAll('.diffp-no').length, rows: p.querySelectorAll('.diffp-line').length,
            overflow: body ? getComputedStyle(body).overflow : '', nowrap: line ? getComputedStyle(line).whiteSpace : '',
            hasExpand: !!p.querySelector('.completed-diff-expand') };
        })()`).catch(() => null);
        await wait(350);
        const previewStillOpen = await h.eval(`!!document.querySelector('.completed-diff-preview')`);
        h.check("⑯b 预览升级：行号槽 + 两轴滚动 + 面板内滚动不关窗 + 展开钮在（用户对照 Qoder 的预览形态）",
          !!previewUp && previewUp.hasBody === true && previewUp.gutter >= 2 && previewUp.rows >= 1
            && /auto|scroll/.test(String(previewUp.overflow)) && previewUp.nowrap === "pre"
            && previewUp.hasExpand === true && previewStillOpen === true,
          JSON.stringify({ previewUp, previewStillOpen }).slice(0, 260));
        await h.moveMouseAway().catch(() => undefined);
        await wait(500);
        const previewGone = await h.eval(`!document.querySelector('.completed-diff-preview')`);
        h.check("⑰ 鼠标移开后预览自动收起（不残留浮层）", previewGone === true, `stillOpen=${!previewGone}`);
        /* ⑱ 清理播种（10-06 夜三轮）：删掉两条任务 ⇒ 胶囊整体消失（两区都没有 = 不渲染，
           不留占位）。⛔ 收尾必删：播种落在持久 profile 的任务库里，泄漏会污染后续轮次。 */
        if (Array.isArray(seededIds) && seededIds.length) {
          await h.eval(`(async function(){ for (const id of ${JSON.stringify(seededIds)}) { await window.codex.deleteTask(id); } return 1; })()`).catch(() => undefined);
        }
        let capsuleGone = false;
        for (let i = 0; i < 10; i++) {
          await wait(300);
          capsuleGone = await h.eval(`!document.querySelector('.edited-files-card')`).catch(() => false);
          if (capsuleGone) break;
        }
        h.check("⑱ 删除任务后胶囊整体消失（没有内容就不占位 —— 两区独立渲染规则的收口）", capsuleGone === true, `gone=${capsuleGone}`);
        await h.screenshot("file-summary");
      } finally {
        /* 收尾：探针目录整体删掉（落在用户磁盘上的东西必须自己清干净；崩溃也不留）。 */
        if (probeDir) { try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* 尽力而为 */ } }
      }
    },
  },
  {
    id: "popup-fits",
    name: "㉔ 弹窗自适应普查：各弹出层整矩形落在视口内（贴边不被裁 —— 10-06 用户令「凡事弹窗类都要加自适应」）",
    run: async (h) => {
      /* 为什么这样测（用户 10-06 令）：弹出层贴右/下边缘被裁掉、展示不全，是最典型的静默 UI 缺陷
         （tsc 与静态守卫都看不见最终像素）。这里对**当轮可复现**的几类弹出层做运行时探针，
         判据统一 = **整矩形完全落在视口内**（fits），并专门验证「贴右边缘右键」的翻转路径。
         ⚠️ 顺序依赖：文件卡右键那两条依赖 file-summary 先跑（它建了「已更改」卡）。 */
      const FIT = `(function(sel){ var el = document.querySelector(sel); if (!el) return null; var r = el.getBoundingClientRect();
        return { fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rr: Math.round(r.right), vw: innerWidth, vh: innerHeight }; })`;
      await h.waitFor(`!!document.querySelector(".composer-editor")`, { label: "输入框就绪", timeoutMs: 30000 }).catch(() => undefined);
      /* ① composer 侧菜单逐个开：模型 / 档位 / 权限（.composer-setting → .composer-menu-pop）。
         「能开出来的」都必须是 fits —— 打不满 2 个算前置失败（选择器漂了）。 */
      const chips = await h.eval(`document.querySelectorAll('.composer-setting').length`).catch(() => 0);
      let opened = 0;
      let bad = null;
      for (let i = 0; i < Math.min(Number(chips) || 0, 6); i++) {
        await h.eval(`(function(){ var b = document.querySelectorAll('.composer-setting')[${i}]; if (b && !b.disabled) b.click(); return 1; })()`);
        await wait(350);
        const r = await h.eval(`${FIT}('.composer-menu-pop')`).catch(() => null);
        if (r) { opened += 1; if (!r.fits && !bad) bad = { i, r }; }
        await h.pressKey("Escape");
        await wait(250);
      }
      h.check("① composer 下拉菜单（模型/档位/权限…）整矩形落在视口内（开到几个查几个）",
        opened >= 2 && bad === null, JSON.stringify({ chips, opened, bad }).slice(0, 220));
      /* ② 文件卡右键菜单：**贴右边缘**右键 → 必须翻转（菜单往左展开）且整矩形 fits */
      const hasRow = await h.eval(`!!document.querySelector('.completed-changes .completed-file')`);
      h.check("② 前置：存在「已更改」卡可右键（默认轮里 file-summary 先跑会建卡；--only 单跑本项时没有属预期）", hasRow === true, `hasRow=${hasRow}`);
      if (hasRow) {
        await h.eval(`(function(){ var row = document.querySelector('.completed-changes .completed-file'); var r = row.getBoundingClientRect();
          row.scrollIntoView({ block: 'center' });
          var r2 = row.getBoundingClientRect();
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 4, clientY: Math.round(r2.top + 8) }));
          return 1; })()`);
        await wait(400);
        const fm = await h.eval(`${FIT}('.file-card-menu')`).catch(() => null);
        h.check("③ 文件卡菜单贴右边缘仍整矩形在视口内（翻转生效，不向右溢出被裁）",
          !!fm && fm.fits === true, JSON.stringify(fm));
        await h.pressKey("Escape");
        await wait(250);
      }
      /* ④ 收尾：浮层都已收起（不留悬挂菜单挡后面的截图/验收） */
      const leftovers = await h.eval(`document.querySelectorAll('.composer-menu-pop, .file-card-menu').length`);
      h.check("④ 普查后无悬挂菜单残留（都收干净）", leftovers === 0, `leftovers=${leftovers}`);
      await h.screenshot("popup-fits");
    },
  },
  {
    id: "composer-resize",
    name: "㉕ 输入框上下拖动把手：真拖改高、钳上下限、双击复位、持久化（10-06 夜三轮 · 用户对照 Qoder 图二）",
    run: async (h) => {
      /* 为什么真跑（用户令：「输入框加一个上下拖动功能，最高能拖动的高度记得设置好，还有最低的」）：
         拖动链路的失效方式全是静默的 —— 把手在但拖不动（监听没接）、上下限丢失（拖成 0px 或
         吃掉整个消息区）、变量没被样式消费（拖了高度不动）—— 静态守卫只钉形态，这里真拖。
         用**合成 PointerEvent**（pointerdown 打在把手上、move/up 打在 window —— 拖动实现就是
         window 级监听；真实鼠标与合成走同一路径）。⛔ 不用 CDP mousePressed：本机实测它不产生
         pointerdown（10-06 选区浮条排查的既有结论）。 */
      await h.waitFor(`!!document.querySelector(".composer-resize-handle") && !!document.querySelector(".composer-editor")`, { label: "输入框与把手就绪", timeoutMs: 30000 }).catch(() => undefined);
      const ready = await h.eval(`(function(){ var el=document.querySelector('.composer-resize-handle');
        return !!(el && el.getBoundingClientRect().height > 0); })()`).catch(() => false);
      h.check("① 前置：拖动把手在且可见（找不到整项作废，不许往下假通过）", ready === true, `ready=${ready}`);
      if (!ready) return;
      const heightOf = () => h.eval(`Math.round(document.querySelector('.composer-editor').getBoundingClientRect().height)`).catch(() => 0);
      /* ⛔ 合成拖拽必须**分 tick 派发**（pointerdown → 等一拍 → move → 等一拍 → up）：
         组件的 window 监听是在 pointerdown 之后的 effect 里才挂上的 —— 同一同步块连发会把
         move/up 丢在监听挂上之前（真鼠标事件天然分 tick，不会踩到）。 */
      const dragBy = async (dy) => {
        const y = await h.eval(`(function(){ var el=document.querySelector('.composer-resize-handle'); var r=el.getBoundingClientRect();
          return Math.round(r.top + r.height/2); })()`);
        await h.eval(`(function(){ var el=document.querySelector('.composer-resize-handle');
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientY: ${y} })); return 1; })()`);
        await wait(150);
        await h.eval(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: ${y + dy} }))`);
        await wait(100);
        await h.eval(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
        await wait(350);
      };
      /* 复位起点（上一轮可能留下固定高度）：双击 ⇒ 回到内容自适应。 */
      await h.eval(`(function(){ document.querySelector('.composer-resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 1; })()`);
      await wait(300);
      const h0 = await heightOf();
      /* ② 真拖向上 90px ⇒ 输入区变高（≈+90；若起点已近上限则等于上限 —— 用 ≥+60 判定）。 */
      await dragBy(-90);
      const h1 = await heightOf();
      h.check("② 向上拖 90px ⇒ 输入区真的变高（拖动链路接通）", h1 >= h0 + 60 && h1 > h0, `h0=${h0} h1=${h1}`);
      /* ③ 拖到极端高 ⇒ 钳在上限 min(55vh,560)；④ 拖到极端低 ⇒ 钳在下限 48。 */
      await dragBy(-10000);
      const maxH = await h.eval(`Math.min(Math.round(innerHeight*0.55), 560)`);
      const h2 = await heightOf();
      h.check("③ 拖到极端高度 ⇒ 钳在上限 min(55vh, 560px)（拖不爆，不挤没消息区）", Math.abs(h2 - maxH) <= 2, `h2=${h2} max=${maxH}`);
      await dragBy(100000);
      const h3 = await heightOf();
      h.check("④ 向下拖到底 ⇒ 钳在下限 48px（拖不小、不塌成 0）", Math.abs(h3 - 48) <= 2, `h3=${h3}`);
      const persisted = await h.eval(`localStorage.getItem('composer-editor-height')`);
      h.check("⑤ 落盘：拖动结果写进 localStorage（重启后恢复同一高度）", String(persisted) === "48", `stored=${persisted}`);
      /* ⑥ 双击复位：清存储 + 清固定高度（回到内容自适应）。 */
      await h.eval(`(function(){ document.querySelector('.composer-resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 1; })()`);
      await wait(300);
      const afterReset = await h.eval(`(function(){ var f=document.querySelector('.composer');
        return { stored: localStorage.getItem('composer-editor-height'),
          hasVar: f ? (f.style.getPropertyValue('--composer-editor-h')||'').length > 0 : null }; })()`);
      h.check("⑥ 双击复位：清除存储与固定高度（回到内容自适应）",
        afterReset?.stored === null && afterReset?.hasVar === false, JSON.stringify(afterReset));
      await h.screenshot("composer-resize");
    },
  },
  {
    id: "message-feedback",
    name: "㉒ 消息操作图标（用户消息复制贴右端 + 两段成功反馈，10-05 轮）",
    run: async (h) => {
      // 为什么真跑：这三件事全是"改坏了不会报错、只会悄悄变难看"的类型 ——
      // 顺序靠 flex 排、动画靠属性选择器命中 DOM，tsc 与静态守卫都看不见最终像素。
      /* ⛔ 先把宿主自己的引导浮层关掉再测拖选：10-05 排查"松手不弹"排了半天，真因是
         **环境体检弹窗盖在时间线上**，按坐标拖的那一下选到的是弹窗里的字（`.env-check-row`），
         浮条按规则正确地没弹 —— 不是应用的错，是测试的前置状态脏了。
         ⛔ 不能用 `h.clickByText("全部稍后再说")`：这一项**跑到拖选那一步才需要它**，而体检是
         启动后异步扫完才弹的 —— 开头点的那一次常常还没出现（10-05 实测 covered 全是 env-check-row）。
         所以做成可重入的：开头关一次，拖选前再关一次。 */
      const dismissOverlays = async () => {
        const closed = await h.eval(`(function(){ const box=document.querySelector(".env-check-modal");
          if(!box) return 0; const b=[...box.querySelectorAll("button")].find((x)=>/全部稍后再说/.test(x.textContent||""));
          if(!b) return -1; b.click(); return 1; })()`);
        await h.waitFor(`!document.querySelector(".env-check-modal")`, { label: "环境体检弹窗已关闭", timeoutMs: 4000 })
          .then(() => true).catch(() => false);
        return closed;
      };
      await dismissOverlays();
      /* 前置：应用启动时停在新任务（时间线是空的），必须先开一个**有历史**的会话。
         ⛔ 点 `.thread-row` 那个 div 不生效 —— 真正绑 onClick 的是行里面的按钮（10-05 实测：
         点 div 之后 .message 数量仍是 0，看着像"脚部没渲染"，其实根本没切会话）。
         ⛔ 也不能按行索引点：侧栏按最近活动重排，索引下一轮就不是同一条（项目铁律）。 */
      let footers = await h.eval(`document.querySelectorAll(".user-message-footer .message-footer").length`);
      if (!Number(footers)) {
        await h.eval(`(function(){ const rows=[...document.querySelectorAll(".thread-row")];
          const target=rows.find((r)=>(r.textContent||"").trim().length>3) || rows[0];
          if(!target) return 0; (target.querySelector("button")||target).click(); return 1; })()`);
        await h.waitFor(`document.querySelectorAll(".user-message-footer .message-footer").length > 0`,
          { label: "打开一个有历史消息的会话", timeoutMs: 15000 }).catch(() => undefined);
        footers = await h.eval(`document.querySelectorAll(".user-message-footer .message-footer").length`);
      }
      h.check("① 当前会话里有用户消息脚部（前置条件；找不到就整项作废，不许假通过）", Number(footers) > 0, `footers=${footers}`);
      /* ⛔ hover 才现身的项**仍占着 flex 位置**，所以"谁贴右端"取决于 DOM 顺序而非可见性 ——
         这正是用户看到的毛病：常驻复制左边还留着两个空位，看着就是没靠右。 */
      const order = await h.eval(`(function(){
        const f=document.querySelector(".user-message-footer .message-footer"); if(!f) return {found:false};
        const kids=[...f.children].map((el)=>({cls:String(el.className), right:Math.round(el.getBoundingClientRect().right)}));
        const copy=kids.find((k)=>k.cls.includes("message-action-default"));
        return {found:true, copyRight:copy?copy.right:-1, maxRight:Math.max(...kids.map((k)=>k.right)), n:kids.length}; })()`);
      h.check("② 用户消息的常驻复制贴着右端（其余 hover 项排在它左边）",
        order?.found === true && order.copyRight > 0 && order.copyRight === order.maxRight, JSON.stringify(order));
      /* ⛔ 把要观察的那颗按钮**钉在 window 上**再取值：时间线会随 toast/滚动重排，
         下一次 eval 的 `querySelector` 未必是同一个节点（10-05 在 main profile 上就这么读到过
         另一条消息的 idle 态，看着像"反馈没生效"）。 */
      const stage1 = await h.eval(`(function(){
        const b=document.querySelector(".user-message-footer .message-footer .message-action-default");
        if(!b) return {found:false}; window.__fbBtn=b; const r={found:true, color:getComputedStyle(b).color, opacity:getComputedStyle(b).opacity}; b.click(); return r; })()`);
      /* ⛔ 判定与取值必须在**同一次求值**里完成：成功窗口只有 1.1 秒，命中后再发一次 eval 就可能
         读到回位之后的值 —— 10-05 就出现过 phase=done 却 opacity=0.5 的"自相矛盾"读数，那是读早晚
         的问题，不是样式没生效。
         ⛔ 也不能借 h.waitFor 轮询：它固定 300ms 一次、且只回真假，一旦某次读数差一点就整条 null，
         看不出到底是哪一项没到（10-05 在这一步假失败过一次，排查半天只能自己写轮询把每次读数留下）。 */
      let done = null, seen = null;
      for (let poll = 0; poll < 8 && !done; poll++) {
        /* ⛔ 读数前把这一颗按钮的 transition **临时关掉**再取 computed style：过渡值是按帧推进的，
           页面被后台化 / 主线程被引擎占住时它会**停在中间值**（10-05 实测：同一份代码单跑读到 1，
           在 `npm run verify` 里停在 0.704 且 8 次轮询都没走完）。停在中间值不是样式没生效，
           所以判"生效了没有"要看**目标值** —— 关掉过渡取到的就是最终值，与帧调度彻底无关。 */
        const read = await h.eval(`(function(){ const b=window.__fbBtn; if(!b) return {missing:true};
          const prev=b.style.transition; b.style.transition="none"; const cs=getComputedStyle(b);
          const s={phase:b.getAttribute("data-phase"), title:b.title, anim:cs.animationName, color:cs.color,
            opacity:cs.opacity, hasCheck:!!b.querySelector("svg.lucide-check")};
          b.style.transition=prev;
          if(s.phase==="done" && s.hasCheck && Number(s.opacity)>0.9) return {settled:s};
          return {seen:s}; })()`);
        if (read?.settled) done = read.settled;
        else if (read?.seen) seen = read.seen;
        await wait(110);
      }
      const settled = !!done;
      h.check("③ 第一段反馈：图标换成对勾、CSS 动画真的命中（选择器与 data-phase 对得上）",
        stage1?.found === true && done?.phase === "done" && done?.anim === "message-action-pop" && done?.hasCheck === true,
        JSON.stringify({ done, seen }).slice(0, 220));
      h.check("④ 成功态文案改口 + 不 hover 也看得见（收藏/引用是 hover 项，点了之后鼠标移开也要能看到反馈）",
        settled === true && /已复制/.test(String(done?.title ?? "")) && Number(done?.opacity) > 0.9
          && Number(done?.opacity) > Number(stage1?.opacity ?? 0) && String(done?.color) !== String(stage1?.color),
        JSON.stringify({ before: { color: stage1?.color, opacity: stage1?.opacity }, done, seen }).slice(0, 260));
      await wait(1500);
      const stage2 = await h.eval(`(function(){ const b=window.__fbBtn; const cs=getComputedStyle(b);
        return {phase:b.getAttribute("data-phase"), anim:cs.animationName, title:b.title, hasCopy: !!b.querySelector("svg.lucide-copy")}; })()`);
      h.check("⑤ 第二段回位：1.1 秒后换回原图标、动画不重播（否则'变回去'会再弹一次）",
        stage2?.phase === "idle" && stage2?.anim === "none" && stage2?.hasCopy === true && /复制消息/.test(String(stage2?.title)), JSON.stringify(stage2));
      /* agent 侧：常驻是 复制 → 分支 → 时间（顺序不动），复制在最左。 */
      const agent = await h.eval(`(function(){
        const f=document.querySelector(".codex-turn .message-footer, .assistant-message .message-footer"); if(!f) return {found:false};
        const kids=[...f.children].map((el)=>({cls:String(el.className), left:Math.round(el.getBoundingClientRect().left)}));
        const copy=kids.find((k)=>k.cls.includes("message-action-default"));
        return {found:true, copyIsLeftmost: !!copy && copy.left === Math.min(...kids.map((k)=>k.left)), forkLabelled: [...f.querySelectorAll("button")].some((b)=>(b.textContent||"").includes("分支")), text:f.innerText.slice(0,40)}; })()`);
      h.check("⑥ Codex 消息脚部也在同一套按钮上（复制仍在最左，顺序未被改动）", agent?.found === true && agent?.copyIsLeftmost === true, JSON.stringify(agent).slice(0, 200));
      const agentStage = await h.eval(`(function(){ const b=document.querySelector(".codex-turn .message-footer .message-action-default, .assistant-message .message-footer .message-action-default");
        if(!b) return {found:false}; window.__fbAgent=b; b.click(); return {found:true}; })()`);
      const agentDone = await h.waitFor(`(function(){ const b=window.__fbAgent;
        return !!b && b.getAttribute("data-phase")==="done" && !!b.querySelector("svg.lucide-check"); })()`,
        { label: "agent 侧成功态", timeoutMs: 1000 }).then(() => true).catch(() => false);
      h.check("⑦ 两段反馈对 agent 消息同样生效（用户原话：「Codex 消息下面也是所有图标做两段反馈」）",
        agentStage?.found === true && agentDone === true, JSON.stringify({ agentStage, agentDone }));
      /* ── 选区浮条（10-05 用户：「对话框加一个选择文字，自动弹出来 复制和添加到对话两个选项」）──
         用 Range API 直接构造选区：不依赖真实拖拽。⛔ 必须挑**在视口里**的文本节点 ——
         时间线很长，第一个长文本节点常在滚动区外面，range 的 rect 是负数，
         浮条按视口坐标定位就会跑到屏幕外，测出来像"定位错了"其实是选错了节点（10-05 实测踩过）。 */
      /* ⛔ 必须验 `sel.toString()` 真的取到了字：代码块 / 工具卡片这类区域带 `user-select:none`，
         addRange 之后 isCollapsed 是 false、range.toString() 也有字，但**文档选区取不到内容**
         （10-05 在 main profile 实测：选中 "chcp 65001>nul" 那段，sel.toString() 是空串）。
         这种地方本来就不该弹浮条（没字可复制），所以是测试要跳过，不是应用要改。 */
      const selectIn = async () => h.eval(`(function(){
        const host=document.querySelector(".timeline"); if(!host) return {ok:false, why:"没有 .timeline"};
        const walker=document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let node=null;
        while((node=walker.nextNode())){
          const trimmed=(node.textContent||"").trim(); if(trimmed.length<=16) continue;
          const probe=document.createRange(); probe.selectNodeContents(node); const box=probe.getBoundingClientRect();
          if(box.top<60 || box.bottom>window.innerHeight-60) continue;
          const raw=node.textContent||""; const start=raw.indexOf(trimmed);
          const range=document.createRange(); range.setStart(node, start+1); range.setEnd(node, start+15);
          const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          const chosen=sel.toString();
          if(chosen.trim().length<8) continue;
          return {ok:true, chosen, top:Math.round(box.top)};
        }
        return {ok:false, why:"找不到视口内、且真的可选（非 user-select:none）的文本节点"}; })()`);
      const selected = await selectIn();
      const barUp = await h.waitFor(`!!document.querySelector(".selection-action-bar")`, { label: "选区浮条弹出", timeoutMs: 4000 })
        .then(() => true).catch(() => false);
      /* ⑨ 一次量四件事：portal 到 body（挂在时间线里会被祖先的 transform 改掉 fixed 的包含块）、
         贴着**选区末行**（上一版取整个选区的 union rect，跨段选择时浮条会跑到离选区很远的地方）、
         轻浮层档、完整在视口内。10-05 用户实测「按键在那么远」就是前两件事没做对。 */
      const bar = await h.eval(`(function(){ const b=document.querySelector(".selection-action-bar"); if(!b) return {found:false};
        const cs=getComputedStyle(b); const r=b.getBoundingClientRect();
        const s=window.getSelection(); const rs=s&&s.rangeCount?s.getRangeAt(0).getClientRects():[];
        const last=rs.length?rs[rs.length-1]:null;
        return {found:true, pos:cs.position, z:cs.zIndex, parent:(b.parentElement&&b.parentElement.tagName)||"",
          labels:[...b.querySelectorAll("button")].map((x)=>(x.textContent||"").trim()),
          inView:r.top>=0 && r.left>=0 && r.right<=window.innerWidth && r.height>0,
          gapToSel: last?Math.round(Math.abs(r.bottom-last.top)):null, scrim:!!document.querySelector(".selection-action-scrim")}; })()`);
      h.check("⑧ 在消息区选中文字会自动弹出浮条，三个动作齐全（选整条 / 复制 / 添加到对话）",
        selected?.ok === true && barUp === true && bar?.found === true
          && JSON.stringify(bar?.labels) === '["选整条","复制","添加到对话"]', JSON.stringify({ selected, bar }).slice(0, 220));
      h.check("⑨ 浮条 portal 到 body、贴着选区末行（≤44px）、轻浮层档且在视口内；⛔ 没有全屏遮罩（它会抢走拖选命中）",
        bar?.parent === "BODY" && bar?.pos === "fixed" && bar?.z === "1001" && bar?.inView === true
          && Number(bar?.gapToSel) >= 0 && Number(bar?.gapToSel) <= 44 && bar?.scrim === false, JSON.stringify(bar));
      /* ⑩ 真拖选回归（10-05 用户：「拖动的时候一直闪全选内容，停下来又不闪」）：
         按下 → 连续移动 → **过程中浮条必须一次都不出现**，松手后才弹一次；
         同时验证选区真的建起来了（上一版的全屏遮罩会把命中目标抢走，选区被反复重置 = 闪）。 */
      /* ⛔ 这一段的页面侧代码**不能有 await 循环**：`h.eval` 的 CDP 回包上限 20 秒，而长会话里
         够长的文本节点有几百个，「逐个 scrollIntoView + sleep 320ms」扫到第 60 个就超时
         （10-05 实测：`CDP Runtime.evaluate 超时`）。改成一次同步扫描挑**已经在视口里**的那一行，
         顶多再滚一格重扫。 */
      /* ⛔ 拖之前先把上一轮的选区清掉：浮条还浮在那儿，`elementFromPoint` 就会命中浮条自己，
         每一行都被"命中不在时间线内"筛掉 ⇒ dragFrom 恒为 null 的假失败（10-05 实测）。 */
      await h.eval(`(function(){ window.getSelection()?.removeAllRanges(); return 1; })()`);
      await h.waitFor(`!document.querySelector(".selection-action-bar")`, { label: "上一轮浮条已收起", timeoutMs: 3000 })
        .then(() => true).catch(() => false);
      await dismissOverlays();   // 体检是异步扫完的，可能正好这会儿冒出来
      /* ⛔ 取点用**行矩形**（getClientRects 的每一行），不用整个文本节点的联合矩形：
         多行段落的联合矩形左边界属于最宽那一行，按 (left+2, 竖直中心) 取的那一点常落在**行与行之间**，
         命中的是覆盖在正文上的元素（消息定位尺那一类），于是每一行都被"命中不在时间线内"筛掉
         —— 10-05 实测 dragFrom 恒为 null（scanned 726 / covered 9）就是这个坑。 */
      const dragScan = (scroll) => h.eval(`(function(){
        const host=document.querySelector(".timeline"), wrap=document.querySelector(".timeline-wrap");
        if(!host||!wrap) return {why:"没有 .timeline / .timeline-wrap"};
        if(${scroll}) wrap.scrollTop=Math.max(0, wrap.scrollTop+(${scroll}));
        const stat={scanned:0, noBody:0, offscreen:0, covered:[], found:null};
        const w=document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n;
        while((n=w.nextNode())){ stat.scanned++;
          const t=(n.textContent||"").trim(); if(t.length<24) continue;
          const el=n.parentElement; if(!el) continue;
          // 只从正文里挑：脚部/按钮/浮条自己的字拖不出选区
          if(!el.closest(".message-body") || el.closest("button, .message-footer, .selection-action-bar, style, script")) { stat.noBody++; continue; }
          const pr=document.createRange(); pr.selectNodeContents(n);
          const rects=[...pr.getClientRects()].filter((r)=>r.width>30 && r.height>6);
          for(const r of rects){
            if(r.top<90 || r.bottom>window.innerHeight-90) { stat.offscreen++; continue; }
            const x=Math.round(r.left+4), y=Math.round(r.top+r.height/2);
            const hit=document.elementFromPoint(x, y);
            const label=hit ? (hit.tagName+"."+String(hit.className).slice(0,18)) : "无";
            // ⛔ 该点必须真的落在这行字（或它的祖先）上：有弹窗/覆盖层压着时按坐标拖会选到别人的字
            if(!hit || !wrap.contains(hit) || !(hit===el || el.contains(hit) || hit.contains(el))) { stat.covered.push(label); continue; }
            stat.found={x:x, y:y, to:Math.round(r.right-4), hit:label, text:t.slice(0,16)}; break;
          }
          if(stat.found) break; }
        return stat; })()`);
      const dragProbe = await dragScan(0);
      if (!dragProbe?.found) dragProbe.found = (await dragScan(-260)).found ?? null;
      const dragFrom = dragProbe?.found ?? null;
      let during = null, afterRelease = null, draggedLen = null;
      if (dragFrom) {
        await h._send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragFrom.x, y: dragFrom.y, button: "left", clickCount: 1 });
        for (let step = 1; step <= 10; step++) {
          await h._send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.min(dragFrom.to, dragFrom.x + step * 24), y: dragFrom.y, button: "left", buttons: 1 });
          await wait(25);   // 全程远短于 220ms 的防抖窗口？不：每动一下都重置计时 ⇒ 过程里一次都不渲染
        }
        during = await h.eval(`!!document.querySelector(".selection-action-bar")`);
        draggedLen = await h.eval(`(window.getSelection()||{toString:()=>""}).toString().length`);
        await h._send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragFrom.to, y: dragFrom.y, button: "left", clickCount: 1 });
        await wait(600);
        afterRelease = await h.eval(`!!document.querySelector(".selection-action-bar")`);
      }
      h.check("⑩ 真拖选：过程中浮条一次都不闪，松手才弹一次，且选区真的建起来了（遮罩不再抢命中）",
        !!dragFrom && during === false && afterRelease === true && Number(draggedLen) > 4,
        JSON.stringify({ dragFrom, during, afterRelease, draggedLen, scanned: dragProbe?.scanned, noBody: dragProbe?.noBody, offscreen: dragProbe?.offscreen, covered: (dragProbe?.covered ?? []).slice(0, 4), why: dragProbe?.why }).slice(0, 260));
      await h.screenshot("selection-bar");   // 趁浮条还贴着选区留一张图给人看（⛔ 清选区之后就拍不到了）
      await h.eval(`(function(){ window.getSelection()?.removeAllRanges(); return 1; })()`);
      await wait(400);
      /* ⛔ 真鼠标点击（按坐标发 mousePressed/mouseReleased），不用 el.click()：
         合成点击**绕过命中测试**，"浮条被别的东西盖住、点不动"这种问题它永远测不出来
         —— 上一版就是因此全绿、用户一上手就点不动（10-05）。 */
      const realClick = async (index) => {
        const point = await h.eval(`(function(){ const b=[...document.querySelectorAll(".selection-action-bar button")][${index}];
          if(!b) return null; const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
        if (!point) return { point: null };
        const hit = await h.eval(`(function(){ const e=document.elementFromPoint(${point.x},${point.y});
          const bar=document.querySelector(".selection-action-bar"); if(!e||!bar) return {onBar:false, at:"无元素"};
          return {onBar: bar.contains(e), at:(e.closest("button")&&e.closest("button").textContent||e.tagName).trim().slice(0,10)}; })()`);
        await h._send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        await h._send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        return { point, ...hit };
      };
      /* 每一轮点按钮前都要**重新选一次字**：上一轮的收尾会清掉选区（浮条跟着收），
         不重选就变成"点一个不存在的按钮"，测出来是假失败（10-05）。 */
      const barAgain = async (label) => {
        const found = await selectIn();
        const up = await h.waitFor(`!!document.querySelector(".selection-action-bar")`, { label, timeoutMs: 4000 })
          .then(() => true).catch(() => false);
        return { found, up };
      };
      /* ⑩「选整条消息」：真点之后**选区必须真的变大**，而且不能把操作条的字一起选进去 ——
         agent 消息的 MessageFooter 就渲染在 .message-body 里面（ItemView.tsx:184），
         整块 selectNodeContents 就会连「复制 / 分支 / 15:16」一起进选区。 */
      const wholeRound = await barAgain("选整条那一轮浮条");
      const beforeLen = await h.eval(`(window.getSelection()||{toString:()=>""}).toString().replace(/\\s+/g,"").length`);
      const wholeClicked = await realClick(0);
      /* ⛔ "扩到整条"的尺子用**独立量出来的这条消息正文长度**，不用"比原来多 8 个字"：
         会话里很短的消息（这条就 22 字）会卡在阈值上，差一个字就是假失败（10-05 实测 len=22 / 要求 >22）。
         留 25% 余量是因为代码块一类 `user-select:none` 的区域进不了文档选区，却算在 textContent 里。 */
      const whole = await h.eval(`(function(){ const s=window.getSelection(); const t=s?s.toString():"";
        const n=s&&s.anchorNode; const el=n?(n.nodeType===1?n:n.parentElement):null;
        const msg=el&&el.closest&&el.closest(".message"); const body=msg&&(msg.querySelector(".message-body")||msg);
        const flat=(x)=>String(x||"").replace(/\\s+/g,"").length;
        const foot=body? [...body.querySelectorAll(".message-footer, .user-message-footer")].map((f)=>flat(f.textContent)).reduce((a,b)=>a+b,0) : 0;
        return {len:flat(t), tail:t.trim().slice(-14), inMessage:!!msg,
          expected: body? flat(body.textContent)-foot : -1,
          barStillUp:!!document.querySelector(".selection-action-bar")}; })()`);
      h.check("⑪「选整条消息」选区真的扩到整条、落在同一条消息里，且浮条不立刻消失（反馈看得见）",
        wholeRound?.up === true && wholeClicked?.onBar === true
          && Number(whole?.len) > Number(beforeLen)
          && Number(whole?.len) >= Math.min(Number(whole?.expected) * 0.75, 20)
          && whole?.inMessage === true && whole?.barStillUp === true,
          JSON.stringify({ beforeLen, expected: whole?.expected, len: whole?.len, up: wholeRound?.up, clicked: wholeClicked?.at }).slice(0, 220));
      h.check("⑫ 扩出来的文本尾部不含操作条的字（复制 / 分支 / 时间）",
        !/(复制|分支|已复制|\d{1,2}:\d{2})$/.test(String(whole?.tail ?? "")), `tail=${JSON.stringify(whole?.tail)}`);
      await h.waitFor(`!document.querySelector(".selection-action-bar")`, { label: "反馈播完后自动收起", timeoutMs: 3000 })
        .then(() => true).catch(() => false);
      /* ⑫ 复制（真鼠标，按坐标打）*/
      const copyRound = await barAgain("复制那一轮浮条");
      const copyClicked = await realClick(1);
      const copyFeedback = await h.waitFor(`(function(){ const b=[...document.querySelectorAll(".selection-action-bar button")][1];
        return !!b && b.getAttribute("data-phase")==="done" && !!b.querySelector("svg.lucide-check"); })()`,
        { label: "真点击后进入成功态", timeoutMs: 900 }).then(() => true).catch(() => false);
      await h.waitFor(`!document.querySelector(".selection-action-bar")`, { label: "反馈播完后自动收起", timeoutMs: 3000 })
        .then(() => true).catch(() => false);
      h.check("⑬ 真鼠标点得到复制（命中测试落在浮条自己的按钮上）+ 反馈看得见、播完才自动收起",
        copyRound?.up === true && !!copyClicked?.point && copyClicked?.onBar === true && copyFeedback === true,
        JSON.stringify({ copyRound, copyClicked, copyFeedback }).slice(0, 220));
      /* ⑬ 添加到对话 */
      const appendRound = await barAgain("添加到对话那一轮浮条");
      const appendClicked = await realClick(2);
      const quoteUp = await h.waitFor(`!!document.querySelector(".quote-bar")`, { label: "引用条出现", timeoutMs: 4000 })
        .then(() => true).catch(() => false);
      const quoted = await h.text(".quote-bar-text").catch(() => "");
      await h.eval(`(function(){ document.querySelector('.quote-bar button[title="取消引用"]')?.click(); return 1; })()`);
      await wait(400);
      const quoteCleared = await h.eval(`!!document.querySelector(".quote-bar")`);
      h.check("⑭「添加到对话」= 复用输入框上方那条可取消的引用条（不另造第二份引用实现），取消后清干净",
        appendRound?.found?.ok === true && appendRound?.up === true && appendClicked?.onBar === true && quoteUp === true && String(quoted).trim().length > 0 && quoteCleared === false,
        JSON.stringify({ chosen: appendRound?.found?.chosen, appendRound: appendRound?.up, appendClicked, quoted: String(quoted).slice(0, 30), quoteCleared }).slice(0, 240));
      // 收尾：清掉测试留下的选区，否则浮条会出现在截图里、也会挡后面几项
      await h.eval(`(function(){ window.getSelection()?.removeAllRanges(); return 1; })()`);
      await wait(400);
      // 截图前关掉宿主自己的引导浮层（环境体检），否则挡住时间线看不清
      await dismissOverlays();
      await wait(400);
      await h.screenshot("message-feedback");
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
const LATEST_ROUND = "10-06";
/** 每一项属于哪一轮。新增验收项**必须**登记在这里，否则默认轮次里跑不到（会打印警告）。 */
const ROUND_OF = {
  "ui-sketch": "10-06",   // ⛔ 10-06 重写：三形态探针（手机+电脑屏 / platform web 真落盘）+ 预览 + 还原；编号改执行顺序
  "file-summary": "10-06",   // 文件更改汇报卡：运行中行/胶囊 + 收尾卡 + 悬停 diff 预览 + 交互（10-06 两次重写）
  "popup-fits": "10-06",   // ⛔ 10-06 新增：弹窗自适应普查（用户令「凡事弹窗类都要加自适应，不能被裁剪」）
  "composer-resize": "10-06",   // 10-06 夜三轮新增：输入框上下拖动把手（用户对照 Qoder 图二）
  "message-feedback": "10-05",   // 10-05 轮：消息操作图标的两段反馈 + 用户消息复制贴右端（历史项，默认轮不再跑 —— 回归证据）
  "plugin-market-gitee": "10-03",
  "codex-official-market": "10-03",   // 本轮新项；Gitee 项同轮重跑（插件页加了源切换，两个源都得看一眼）
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
