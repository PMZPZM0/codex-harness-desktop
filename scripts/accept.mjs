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
import { execFileSync } from "node:child_process";
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
        const tabs=[...document.querySelectorAll('.sidebar-nav .sidebar-tab')];
        const names=tabs.map((t)=>(t.textContent||'').trim());
        const front=tabs.find((t)=>(t.textContent||'').includes('前端 UI · 组件库'));
        if(!front) return { found:false, tabs:names };
        front.click(); return { found:true, tabs:names }; })()`);
      h.check("① 侧栏有「前端 UI · 组件库」能力入口，且「更多」已删除（前置条件：找不到就整项作废）",
        opened?.found === true && !(opened?.tabs ?? []).includes("更多"), JSON.stringify(opened).slice(0, 260));
      await wait(600);
      const guideOverview = await h.eval(`(function(){ return {
        title:(document.querySelector('.sidebar-guide-heading strong')?.textContent||'').trim(),
        tutorial:[...document.querySelectorAll('.sidebar-guide-foot button')].some((b)=>(b.textContent||'').includes('使用教程')),
        cards:[...document.querySelectorAll('.sidebar-guide-cap.is-action')].map((b)=>(b.textContent||'').trim()),
        foot:[...document.querySelectorAll('.sidebar-guide-foot button')].map((b)=>(b.textContent||'').trim()),
        modals:document.querySelectorAll('.sidebar-guide').length, infoModals:document.querySelectorAll('.info-modal').length }; })()`);
      h.check("② 能力入口先弹概览：大卡片直接可点，底部只保留「使用教程」（此时只有 1 个弹窗）",
        guideOverview?.title === "前端 UI · 组件库" && guideOverview?.tutorial === true
          && ["3800+ 现成控件", "可视化画布", "AI 画布工作流"].every((t) => (guideOverview?.cards ?? []).some((c) => c.includes(t)))
          && !(guideOverview?.foot ?? []).some((t) => t.includes("打开组件库") || t.includes("前端开发画布"))
          && guideOverview?.modals === 1 && guideOverview?.infoModals === 1, JSON.stringify(guideOverview));
      await h.eval(`(function(){ const b=[...document.querySelectorAll('.sidebar-guide-foot button')].find((x)=>(x.textContent||'').includes('使用教程')); if(!b) return 0; b.click(); return 1; })()`);
      await wait(350);
      const guideTutorial = await h.eval(`(function(){ return {
        title:(document.querySelector('.sidebar-guide-heading strong')?.textContent||'').trim(),
        steps:document.querySelectorAll('.sidebar-guide-steps li').length,
        examples:document.querySelectorAll('.sidebar-guide-example').length,
        modals:document.querySelectorAll('.sidebar-guide').length, infoModals:document.querySelectorAll('.info-modal').length }; })()`);
      h.check("②a 点「使用教程」在同一个弹窗内切换（仍只有 1 个弹窗，步骤与示例齐全）",
        String(guideTutorial?.title || '').includes("使用教程") && guideTutorial?.steps >= 3 && guideTutorial?.examples >= 1
          && guideTutorial?.modals === 1 && guideTutorial?.infoModals === 1, JSON.stringify(guideTutorial));
      await h.eval(`(function(){ const card=[...document.querySelectorAll('.sidebar-guide-cap.is-action')].find((b)=>(b.textContent||'').includes("可视化画布")); if(card) card.click(); return !!card; })()`);
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
      // （10-07 起首启「环境体检」弹窗已删，以前这里的三连点「全部稍后再说」不再需要）
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
    id: "pet-activity",
    name: "🐤 桌面宠物活动气泡 · 真回合（running→review 持久 + 独立窗 + 打开清已看 + 拖拽）",
    run: async (h) => {
      /* 10-21 用户对照 Qoder：「宠物事件驱动和对应状态效果比我们好很多」。
         本项零注入：真起一个引擎回合 → 主进程活动归约 → 宠物/活动气泡两个独立窗 → 打开清已看。
         ⛔ 只住 e2e profile，不碰真实宠物设置；结束时 petHide 防浮窗 target 污染后续项。 */
      try {
        await h.waitFor(`!!document.querySelector(".composer-editor")`, { label: "输入框就绪", timeoutMs: 30000 });
        const shown = await h.eval(`window.codex.petShow().then((x)=>({ open: x.open, enabled: x.settings?.enabled })).catch((e)=>({ error: String(e && e.message || e) }))`);
        h.check("① 宠物能打开（独立透明窗 + 设置 enabled）", shown?.error == null && shown?.enabled === true, JSON.stringify(shown));

        const cwd = await h.eval(`localStorage.getItem("workspace") || ${JSON.stringify(ROOT)}`);
        const started = await h.eval(`(async function(){
          try {
            const cm = await window.codex.getCustomModel().catch(()=>null);
            const startedThread = await window.codex.request("thread/start", { cwd: ${JSON.stringify(cwd)} });
            const thread = startedThread?.thread || startedThread;
            const turn = await window.codex.request("turn/start", {
              threadId: thread.id,
              input: [{ type: "text", text: "请先运行 shell 命令 Start-Sleep -Seconds 3，然后只回复：活动测试完成。", text_elements: [] }],
              model: cm?.model || "deepseek-v4.1-flash",
              effort: "medium",
              approvalPolicy: "never",
              sandboxPolicy: { type: "dangerFullAccess" }
            });
            return { threadId: thread.id, turnId: turn?.turn?.id || turn?.id || "" };
          } catch (e) { return { error: String(e && e.message || e) }; }
        })()`).catch((e) => ({ error: String(e?.message || e) }));
        h.check("② 真回合已启动（模型/会话可用）", !!started?.threadId && !started?.error, JSON.stringify(started).slice(0, 240));
        if (!started?.threadId) return;

        let running = null;
        for (let i = 0; i < 24; i++) {
          await wait(400);
          const signal = await h.eval(`window.codex.petState().then((x)=>x.signal)`).catch(() => null);
          running = (signal?.activities ?? []).find((item) => item.threadId === started.threadId) ?? null;
          if (running) break;
        }
        h.check("③ running 活动出现（标题 / 详情 / canStop 真值）",
          running?.status === "running" && !!running?.title && running?.canStop === true,
          JSON.stringify(running).slice(0, 280));

        let completed = null;
        for (let i = 0; i < 40; i++) {
          await wait(500);
          const signal = await h.eval(`window.codex.petState().then((x)=>x.signal)`).catch(() => null);
          const hit = (signal?.activities ?? []).find((item) => item.threadId === started.threadId);
          if (hit?.status === "completed") { completed = hit; break; }
        }
        h.check("④ 回合完成 → 活动 completed（不是被清掉/回 idle）", completed?.status === "completed", JSON.stringify(completed).slice(0, 240));

        await wait(1200);
        const later = await h.eval(`window.codex.petState().then((x)=>x.signal)`).catch(() => null);
        const still = (later?.activities ?? []).find((item) => item.threadId === started.threadId);
        h.check("⑤ review 持久：1.2s 后仍在本轮完成态（Qoder 同款，不自动回 idle）",
          later?.phase === "review" && still?.status === "completed",
          JSON.stringify({ phase: later?.phase, status: still?.status }).slice(0, 160));

        let card = null;
        for (let i = 0; i < 16; i++) {
          card = await h.evalInTarget("pet=activity", `(function(){
            const cards=[...document.querySelectorAll('.pet-activity-card')];
            const splash=document.querySelector('.boot-splash');
            return { count: cards.length, text: cards.map((c)=>c.innerText).join("\\n"),
              splashVisible: !!splash && getComputedStyle(splash).display !== "none",
              buttons: [...document.querySelectorAll('.pet-activity-btn')].map((b)=>(b.innerText||"").trim()) };
          })()`).catch(() => null);
          if (card?.count > 0) break;
          await wait(300);
        }
        h.check("⑥ 独立活动窗出现任务卡（标题/状态 + 打开按钮；无启动页白底）",
          (card?.count ?? 0) >= 1 && String(card?.text ?? "").includes("本轮已完成") && (card?.buttons ?? []).includes("打开")
            && card?.splashVisible === false,
          JSON.stringify(card).slice(0, 260));

        const clicked = await h.evalInTarget("pet=activity", `(function(){
          const b=[...document.querySelectorAll('.pet-activity-btn.open')][0]; if(!b) return false; b.click(); return true;
        })()`).catch(() => false);
        let cleared = false;
        for (let i = 0; i < 16; i++) {
          await wait(300);
          const signal = await h.eval(`window.codex.petState().then((x)=>x.signal)`).catch(() => null);
          if (!(signal?.activities ?? []).some((item) => item.threadId === started.threadId)) { cleared = true; break; }
        }
        let activeId = "";
        for (let i = 0; i < 20; i++) {
          activeId = await h.eval(`document.querySelector('.thread-row.active')?.getAttribute('data-thread-id') || ""`).catch(() => "");
          if (activeId === started.threadId) break;
          await wait(300);
        }
        h.check("⑦ 点「打开」→ 活动清空（已看）+ 主窗切到该会话", clicked === true && cleared === true && activeId === started.threadId,
          JSON.stringify({ clicked, cleared, activeId, threadId: started.threadId }).slice(0, 220));

        const before = await h.eval(`window.codex.petState().then((x)=>x.bounds)`).catch(() => null);
        await h.eval(`window.codex.petDragStart({ screenX: 0, screenY: 0 })`).catch(() => undefined);
        await h.eval(`window.codex.petDragMove({ screenX: 50, screenY: 20 })`).catch(() => undefined);
        await wait(200);
        const during = await h.eval(`window.codex.petState().then((x)=>x.bounds)`).catch(() => null);
        await h.eval(`window.codex.petDragEnd()`).catch(() => undefined);
        h.check("⑧ 手动拖拽真移动窗口（不再依赖 app-region）",
          !!before && !!during && (during.x !== before.x || during.y !== before.y),
          JSON.stringify({ before, during }).slice(0, 220));
        await h.screenshot("pet-activity");
      } finally {
        await h.eval(`window.codex.petHide().catch(()=>undefined)`).catch(() => undefined);
      }
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
           · 真起一个引擎回合（模型 = echo + sleep 12 + 回 ok）——真 turn/started → 追踪器快照 → turn/completed → diff；
           · 回合进行中由**测试进程分两批**往会话工作区落 8 个文件 —— 谁写的文件不重要（追踪器只看目录差异），
             "主进程报告"这一环必是真的；上一版的 8 条 fixture 在这里变成盘上真文件（预览能真读盘）；
           · ③④ 断言**运行中**就有「编辑 <文件> +N -M」实时行、且第二批写入后行数长出来
             （用户 10-06 明确纠正的口径：**运行中是运行中的（数字跟在编辑行文件后面）；汇总是汇总** ——
             实时行由主进程每 2.5s 轻量重扫广播，sleep 就是给两次采样留的窗口；夜六轮 8→12 是给
             ④e「运行中全完成 ⇒ 步骤区隐藏」留出「断言完成时回合仍在跑」的余量）；
           · 广播必须从真通道 onHarnessEvent 到达、turnId 必须 == 真回合 id、汇总卡必须原样出现；
           · 夜六轮任务清单生命周期（用户实测「清单不会自动消失」「新回合，旧的任务清单还在」）：
             ①c 没在跑不渲染胶囊 → ①d 真发送清上一轮种子 → ④a 运行中重播种出「步骤 0/2」（独立居中）
             → ④b 悬停步骤清单 → ④c/④d 运行中全完成隐藏、还原回显 → ④e 悬停文件清单
             → ④f 拼接（**页内采样日志**，与慢工作区广播时延解耦）→ ⑮ 收尾后整卡双双消失
             （清单仍在库里 = 隐藏不是删除）。⛔ ③④ 的实时行全部**作用域到本回合组**（turnIdLive）：
             全局查询会把历史回合的冻结行数进来 —— 慢工作区实测 3→16/24 的假"增长"。
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
           （实测 15ms 内直接查 = null 的假红）。
           ⛔ 目标会话的 cwd 必须 == **注入的工作区根**（本项随后往 ROOT 写探针文件、从 ROOT 算
           diff）：profile 清档重播种后自动打开的会话 cwd 可能是别处老目录（10-07 实测：diff
           恒 0 ⇒ 全链假红），而旧 profile 里"碰巧"是 ROOT 会话所以一直没暴露。
           ⇒ 先找 cwd 匹配、按最近活动排序的第一条点开；没有就新建（新建会话 cwd = 注入工作区）。 */
        await h.waitFor(`!!document.querySelector(".composer-editor") && (!!document.querySelector(".thread-row") || !!document.querySelector(".sidebar-tab"))`, { label: "界面就绪（输入框 + 侧栏）", timeoutMs: 30000 }).catch(() => undefined);
        const normCwd = (s) => String(s ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        const wantedCwd = normCwd(ROOT);
        const threadSnap = await h.eval(`(async function(){
          const active = document.querySelector(".thread-row.active");
          const list = await window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc" });
          return { entries: (list && list.data ? list.data : []).map(function(t){ return { id: String(t.id), cwd: String(t.cwd || "") }; }),
            activeId: active ? String(active.getAttribute("data-thread-id") || "") : "" };
        })()`).catch(() => null);
        const rootThread = ((threadSnap && threadSnap.entries) || []).find((t) => normCwd(t.cwd) === wantedCwd) || null;
        let openState = "none";
        if (rootThread && threadSnap.activeId === rootThread.id) openState = "already";
        else if (rootThread) {
          const sel = `.thread-row[data-thread-id="${rootThread.id}"]`;
          openState = await h.eval(`(function(){ const row = document.querySelector(${JSON.stringify(sel)}); if (!row) return "no-row"; (row.querySelector("button") || row).click(); return "clicked"; })()`).catch(() => "eval-err");
        }
        if (openState === "none" || openState === "no-row" || openState === "eval-err") {
          await h.eval(`(function(){ const b = [...document.querySelectorAll(".sidebar-tab")].find(function(x){ return (x.textContent || "").includes("新建任务"); }); if (!b) return 0; b.click(); return 1; })()`);
          openState = "created";
        }
        if (openState !== "already") {
          await h.waitFor(`!!document.querySelector(".thread-row.active")`, { label: "目标会话已打开", timeoutMs: 20000 }).catch(() => undefined);
          await wait(800);
        }
        const activeThread = await h.eval(`(async function(){
          const row = document.querySelector(".thread-row.active");
          const id = row ? row.getAttribute("data-thread-id") : null;
          if (!id) return null;
          const res = await window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc" });
          const hit = (res && res.data ? res.data : []).find(function(t){ return t.id === id; });
          return { id: String(id), cwd: hit && hit.cwd ? String(hit.cwd) : null }; })()`);
        const cwd = activeThread && activeThread.cwd;
        const activeThreadId = activeThread ? activeThread.id : null;
        h.check("① 前置：当前会话工作区 == 注入工作区根（探针文件写在 ROOT、diff 也从 ROOT 算；不是就整项作废，⛔ 不许用别目录的会话蒙混）",
          typeof cwd === "string" && normCwd(cwd) === wantedCwd, `cwd=${String(cwd).slice(0, 60)} wanted=${ROOT} openState=${openState}`);
        if (typeof cwd !== "string" || normCwd(cwd) !== wantedCwd) return;
        /* ①b 任务清单播种（10-06 夜三轮；夜四轮加固；夜六轮重排）：真 IPC + **新一轮自动开新清单** ——
           先清空任务库 → 播一个「已完成的旧轮哨兵」→ 再 add [甲,乙]：第一条 add 触发「全完成清单
           自动清掉」（用户实测「旧清单叠进新任务」的修复），最终清单只该剩 [甲,乙]（store 级断言）。
           ⛔ 夜六轮起播种阶段不再断言胶囊可见（没在跑不渲染 —— 见 ①c）；这两条的命运：
             被 ② 的真发送整单清掉（①d），随后在运行中重播（④a）。收尾时删除。 */
        const seededIds = await h.eval(`(async function(){
          const list = await window.codex.listTasks();
          for (const t of list) { await window.codex.deleteTask(t.id); }
          const old = await window.codex.addTask({ text: "旧轮哨兵" });
          await window.codex.updateTask({ id: old.id, patch: { status: "done" } });
          const a = await window.codex.addTask({ text: "验收步骤甲", priority: "medium" });
          const b = await window.codex.addTask({ text: "验收步骤乙", priority: "low" });
          return [a && a.id, b && b.id].filter(Boolean); })()`).catch(() => null);
        const sentinelState = await h.eval(`(async function(){ const list = await window.codex.listTasks();
          return { sentinel: list.some(function(t){ return String(t.text||"").includes("旧轮哨兵"); }), count: list.length }; })()`).catch(() => null);
        h.check("①b2 新一轮 task_add 自动开新清单：全完成清单被自动清掉（旧清单不叠进新任务 —— 用户 10-06 夜四轮实测）",
          !!sentinelState && sentinelState.sentinel === false && sentinelState.count === 2, JSON.stringify(sentinelState));
        /* ①c 没在跑 ⇒ 不渲染胶囊（10-06 夜六轮 R1，用户实测「清单不会自动消失」）：清单在库（2 条）
           但回合没在跑，整卡就该不渲染 —— 步骤区与文件区同款：只活在运行中。 */
        let idleCapsule = null;
        for (let i = 0; i < 10; i++) {
          idleCapsule = await h.eval(`(function(){ return { card: !!document.querySelector('.edited-files-card'),
            stepsZone: !!document.querySelector('.capsule-zone-steps'), running: !!document.querySelector('.send-button.is-pause') }; })()`).catch(() => idleCapsule);
          if (idleCapsule && idleCapsule.running === false) break;
          await wait(300);
        }
        h.check("①c 回合没在跑 ⇒ 胶囊整卡不渲染（库里还有 2 条清单也不显示 —— 用户「清单不会自动消失」的修法）",
          !!idleCapsule && idleCapsule.running === false && idleCapsule.card === false && idleCapsule.stepsZone === false,
          JSON.stringify(idleCapsule));
        probeDir = join(cwd, probeDirName);
        rmSync(probeDir, { recursive: true, force: true }); // 上轮崩溃残留先清，保证 seed 是干净基准
        mkdirSync(probeDir, { recursive: true });
        writeFileSync(join(probeDir, "seed.txt"), "accept-seed-start\n");
        /* ② 起一个真回合 —— 用**粘贴长文**这条路发（10-06 用户实测路径：粘贴 >200 字自动落盘成 .txt
           附件 chip → 发送；顺带覆盖「附件消息只渲染一个气泡」的回归，见 ③b）。
           提示词：模型做一条 echo + sleep 24 —— echo 是真 shell 调用，sleep 给「运行中实时行」留采样窗口
           （夜六轮 8→12；10-07 二次加长 12→24：清档后的新会话 + 大树工作区让 ③/④e 轮询与轻量重扫
           都变慢，12s 窗口里第二批常落在收尾之后 ⇒ ④ 实时增长与 ⑦ 内容齐双双假红，实测两次）。 */
        const acceptPrompt = "先用 shell 运行 echo ready；再运行 sleep 24（必须真的执行这条命令，执行完再继续）；最后只回复一个单词：ok。" +
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
        /* ①d 新回合开工清旧账（10-06 夜六轮 R2，用户实测「新回合，旧的任务清单还在」）：这次真发送
           必须把 ①b 播的 [甲,乙] 整单清掉（tasks:clear 挂在 send 的空闲直发路径、首个 startTurn
           之前 await 落地 ⇒ 此刻运行态已出现 = 清空必然已落地，无需轮询）。 */
        const wiped = await h.eval(`(async function(){ const list = await window.codex.listTasks();
          const ids = new Set(${JSON.stringify(seededIds ?? [])});
          return { count: list.length, idsGone: list.every(function(t){ return !ids.has(t.id); }),
            hasJia: list.some(function(t){ return String(t.text||"").includes("验收步骤甲"); }),
            hasYi: list.some(function(t){ return String(t.text||"").includes("验收步骤乙"); }) }; })()`).catch(() => null);
        h.check("①d 新回合开工清旧账：真发送把上一轮种子清单整单清掉（旧清单不跨回合 —— 10-06 夜六轮实测问题）",
          !!wiped && wiped.idsGone === true && wiped.hasJia === false && wiped.hasYi === false, JSON.stringify(wiped));
        /* 抓本回合的组 id（③④ 的实时行只数**本回合自己的**行 —— cwd = 用户主目录这类慢工作区里，
           walkLight 一圈远超 2.5s，历史回合的冻结行会在长轮询窗口里混进来把行数搅成 16/24；
           作用域到回合组后 3→8 才是真增长）。
           顺带装**胶囊采样器**（页内 300ms 定时器）：④b 的「拼接窗口」只在"跑着 + 每 2.5s 广播"
           的交叉点出现，慢工作区会把窗口整段推过回合结束（实测 ④b 轮询等到回合都收了还是 null）
           —— 采样与 CDP 轮询时序解耦，窗口出现过就一定被记下。 */
        let turnIdLive = null;
        for (let i = 0; i < 20; i++) {
          turnIdLive = await h.eval(`(function(){ const g=[...document.querySelectorAll('.turn-group[id^="turn-"]')]; const el=g[g.length-1]; return el ? el.id.replace('turn-','') : null; })()`).catch(() => null);
          if (turnIdLive) break;
          await wait(250);
        }
        await h.eval(`(function(){ window.__capLog = []; if (window.__capTimer) clearInterval(window.__capTimer);
          window.__capTimer = setInterval(function(){ var pill = document.querySelector('.edited-files-pill');
            window.__capLog.push({ running: !!document.querySelector('.send-button.is-pause'),
              steps: !!document.querySelector('.capsule-zone-steps'), files: !!document.querySelector('.capsule-zone-files'),
              text: pill ? (pill.textContent||'').replace(/\\s+/g,' ').trim() : null });
            if (window.__capLog.length > 400) window.__capLog.shift(); }, 300);
          return 1; })()`).catch(() => undefined);
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
        /* ④a 运行中·步骤区（10-06 夜六轮重排；原 ①b 的「真 IPC → 广播 → 胶囊」链条搬到这里）：
           ①d 已证这次发送清了旧种子 ⇒ 在**运行中**重播两条 = 「新回合自己的清单从零挂上来」的
           真实形态；此刻还没有文件改动广播 ⇒ 胶囊应只出步骤区 = 两区独立渲染规则的现场证明。 */
        const reseededIds = await h.eval(`(async function(){
          const a = await window.codex.addTask({ text: "验收步骤甲", priority: "medium" });
          const b = await window.codex.addTask({ text: "验收步骤乙", priority: "low" });
          return [a && a.id, b && b.id].filter(Boolean); })()`).catch(() => null);
        let soloSteps = null;
        for (let i = 0; i < 12; i++) {
          await wait(250);
          soloSteps = await h.eval(`(function(){ var p = document.querySelector('.edited-files-pill');
            if (!p) return null;
            return { stepsZone: !!document.querySelector('.capsule-zone-steps'),
              filesZone: !!document.querySelector('.capsule-zone-files'),
              running: !!document.querySelector('.send-button.is-pause'),
              text: (p.textContent||'').replace(/\\s+/g,' ').trim() }; })()`).catch(() => soloSteps);
          if (soloSteps && soloSteps.stepsZone && !soloSteps.filesZone && /步骤\s*0\/2/.test(soloSteps.text)) break;
        }
        h.check("④a 运行中步骤区走真链路（真 IPC → tasks-changed 广播 → 胶囊出「步骤 0/2」）；此刻只有步骤区 = 独立居中展示",
          Array.isArray(reseededIds) && reseededIds.length === 2 && !!soloSteps && soloSteps.stepsZone === true
            && soloSteps.filesZone === false && soloSteps.running === true && /步骤\s*0\/2/.test(soloSteps.text),
          JSON.stringify({ reseededIds, soloSteps }).slice(0, 220));
        /* ④b 悬停左区（步骤）：出步骤清单（两条播种任务原样在列、todo 态、自适应以内）。
           ⛔ 夜六轮搬到**落盘之前**：此刻回合必然还在跑（后面 ③④ 的慢轮询会滑过回合结束点，
           旧位置等到那时悬停，胶囊可能已经随收尾消失 —— 实测整组假红）。 */
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
        h.check("④b 悬停左区（步骤）：出步骤清单（两条播种任务原样在列、todo 态、自适应以内）",
          !!stepsPop && (stepsPop.rows ?? []).some((t) => t.includes("验收步骤甲")) && (stepsPop.rows ?? []).some((t) => t.includes("验收步骤乙")) && stepsPop.fits === true,
          JSON.stringify(stepsPop).slice(0, 240));
        await h.moveMouseAway().catch(() => undefined);
        /* ④c/④d 运行中全完成 ⇒ 步骤区隐藏、还原 ⇒ 回来（10-06 夜四轮令；夜六轮把检验点从「收尾后」
           搬到**运行中**并提到落盘之前 —— 旧位置在回合结束后标记完成，夜六轮起「没在跑就不显示」
           会把那条断言顶成恒真；提前后 running=true 由同刻采样自证，且不依赖任何慢广播）。 */
        const midDigest = await h.eval(`(async function(){
          const list = await window.codex.listTasks();
          for (const t of list) { await window.codex.updateTask({ id: t.id, patch: { status: "done" } }); }
          return list.length; })()`).catch(() => 0);
        let midHidden = null;
        for (let i = 0; i < 10; i++) {
          midHidden = await h.eval(`(function(){ return { stepsZone: !!document.querySelector('.capsule-zone-steps'),
            running: !!document.querySelector('.send-button.is-pause') }; })()`).catch(() => midHidden);
          if (midHidden && midHidden.stepsZone === false) break;
          await wait(250);
        }
        h.check("④c 运行中全完成 ⇒ 步骤区隐藏（回合仍在跑时断言 —— 不是靠「收尾整卡消失」蹭过的恒真）",
          midDigest >= 2 && !!midHidden && midHidden.stepsZone === false && midHidden.running === true, JSON.stringify(midHidden));
        await h.eval(`(async function(){ const list = await window.codex.listTasks();
          for (const t of list) { await window.codex.updateTask({ id: t.id, patch: { status: "todo" } }); }
          return 1; })()`).catch(() => undefined);
        let midBack = null;
        for (let i = 0; i < 10; i++) {
          midBack = await h.eval(`!!document.querySelector('.capsule-zone-steps')`).catch(() => midBack);
          if (midBack === true) break;
          await wait(250);
        }
        h.check("④d 全部还原 todo ⇒ 步骤区回来（证明 ④c 的隐藏是状态驱动，不是清单没了）",
          midBack === true, `back=${midBack}`);
        /* ③ 回合进行中**分两批**落盘 8 个文件 —— 追踪器 diff 的唯一来源。
           ⛔ 必须在 turn/started（快照已拍）之后写：写入早于快照会进"改前状态"、diff 不报。
           ⛔ 分两批是给「运行中实时行」两次采样窗口：第二批写入后行数必须长出来 = 真在实时更新
             （运行中是运行中的、汇总是汇总 —— 用户 10-06 明确口径；实时行由主进程每 2.5s 轻量重扫广播）。 */
        const LIVE_OURS = ["notes.md", "data.json", "seed.txt", "app.css", "index.html", "util.mjs", "readme.txt", "logo.svg"];
        /* ⛔ 作用域 = **本回合的组**（turnIdLive）：全局查询会把历史回合的冻结行一起数进来
           （慢工作区下实测 3 → 16/24 的假"增长"，甚至可能把 ③ 顶成没广播也过的恒真）。 */
        const liveRowsExpr = `(function(){
          const g = document.getElementById("turn-" + ${JSON.stringify(turnIdLive)});
          if (!g) return [];
          return [...g.querySelectorAll('.live-edit-row')].map(function(r){
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
        /* ④e 悬停右区（文件）：出文件清单（自适应不被裁、以胶囊中心居中、含我们写的文件）。
           ⛔ 夜六轮搬到 ③ 之后（首个带文件的实时广播刚落地、回合还在跑）：再晚就要排到 ④ 的
           慢轮询之后，那时回合可能已收尾、胶囊整卡消失 —— 实测假红。 */
        if (await h.eval(`!!document.querySelector('.capsule-zone-files')`).catch(() => false)) {
          await h.hover(".capsule-zone-files").catch(() => undefined);
          await wait(500);
        }
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
        h.check("④e 悬停右区（文件）：出文件清单（自适应不被裁、以胶囊中心居中、含我们写的文件）",
          !!capsulePop && capsulePop.fits === true && capsulePop.centered === true && capsuleOurs >= 2,
          JSON.stringify({ capsulePop: capsulePop ? { rows: capsulePop.rows, fits: capsulePop.fits, centered: capsulePop.centered, gap: capsulePop.gap } : null, capsuleOurs }).slice(0, 240));
        await h.moveMouseAway().catch(() => undefined);
        /* ④ 第二批落盘（4 文本 + 1 图片），等行数长出来 —— 证明数字是**跑着跳的**，不是收尾才一次算出。 */
        for (const [fileName, body] of [
          ["app.css", ".a{color:red}\n"],
          ["index.html", "<!doctype html><title>t</title>\n"],
          ["util.mjs", "export const add = (a,b)=>a+b;\n"],
          ["readme.txt", "hello accept\n"],
        ]) writeFileSync(join(probeDir, fileName), body);
        writeFileSync(join(probeDir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#e53935"/></svg>');
        let liveSecond = liveFirst;
        /* 轮询窗口 12s→24s（10-07）：本仓这种大树工作区里一圈 walkLight 要几秒，2.5s 一拍实际更慢，
           12s 只覆盖约两拍；sleep 24 给了余量，窗口也跟着放宽（成功即 break，只在失败时付出等待）。 */
        for (let i = 0; i < 60; i++) {
          await wait(400);
          liveSecond = await h.eval(liveRowsExpr).catch(() => liveSecond);
          if (ourLive(liveSecond).length > ourLive(liveFirst).length) break;
        }
        h.check("④ 运行中·实时更新：第二批文件写入后实时行数量长出来（数字是跑着跳的，不是收尾才算）",
          ourLive(liveSecond).length > ourLive(liveFirst).length,
          JSON.stringify({ first: ourLive(liveFirst).length, second: ourLive(liveSecond).length, names: ourLive(liveSecond).map((r) => String(r.text).split(" ")[1] || ""), hint: ourLive(liveSecond).length === 0 ? "实时行整组消失 = 回合先结束了（模型这次没真 sleep，第二批广播赶不上）" : "" }).slice(0, 300));
        /* ④f 胶囊拼接（10-06 夜三轮重构 · 用户对照 Qoder「步骤 0/6 · 5 个文件已修改 +177 -8」；
           夜六轮改为读**页内采样日志**）：两区同时在这一拍里的形态 —— 慢工作区（cwd=用户主目录）
           会把"跑着 + 有文件广播"的窗口整段推过回合结束，CDP 轮询等到收尾也等不到（实测 ④b
           整组假红）；采样器 300ms 一拍与回合时序解耦，窗口出现过就必被记下。 */
        const capLog = await h.eval(`JSON.stringify(window.__capLog||[])`).then((raw) => JSON.parse(raw || "[]")).catch(() => []);
        const concatSeen = capLog.find((e) => e.running === true && e.steps === true && e.files === true
          && /步骤\s*0\/2/.test(e.text || "") && /个文件已修改/.test(e.text || ""));
        h.check("④f 胶囊拼接：任务清单 + 文件改动同时在 ⇒「步骤 N/M · X 个文件已修改 +N -M」（采样日志命中；运行中形态）",
          !!concatSeen, JSON.stringify({ samples: capLog.length, hit: concatSeen ?? null }).slice(0, 220));
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
        /* ⑪（10-18 改口径）行点击已改为右栏「审阅」（用户令）；文件预览入口保留在右键菜单的
           「打开」上 —— 本项挪到 ⑬ 之后验证，避免与 ⑫ 抢同一个菜单。 */
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
        /* ⑪ 文件预览入口：右键菜单「打开」（行点击现在进右栏审阅，不再开居中小弹窗）。 */
        await h.eval(`(function(){ const c=${cardSel}; if(!c) return false;
          const row=[...c.querySelectorAll('.completed-file')].find((r)=>(r.querySelector('.completed-file-meta code')?.textContent||'').trim().toLowerCase()==='notes.md');
          if(!row) return false; const r=row.getBoundingClientRect();
          row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.left+40),clientY:Math.round(r.top+10)}));
          return true; })()`);
        await wait(300);
        const openedFromMenu = await h.eval(`(function(){ const b=[...document.querySelectorAll('.file-card-menu button')].find((x)=>(x.textContent||'').trim()==='打开');
          if(!b) return false; b.click(); return true; })()`);
        const previewOpened = await h.waitFor(`!!document.querySelector('.file-preview')`, { label: "文件预览弹窗", timeoutMs: 8000 }).then(() => true).catch(() => false);
        const previewMeta = await h.text(".file-preview-meta").catch(() => "");
        h.check("⑪ 行右键「打开」→ 文件预览弹窗（行点击已改为右栏审阅，预览入口在右键菜单）",
          openedFromMenu === true && previewOpened === true && String(previewMeta).includes("notes.md"),
          JSON.stringify({ openedFromMenu, previewOpened, previewMeta: String(previewMeta).slice(0, 80) }));
        await h.eval(`(function(){ document.querySelector('.file-preview .relay-modal-close')?.click(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return 1; })()`).catch(() => undefined);
        await wait(400);
        /* ⑭ 收起重回 6 行（折叠往返闭合）。 */
        await h.eval(`(function(){ const c=${cardSel}; c?.querySelector('.completed-more')?.click(); return 1; })()`);
        await wait(300);
        const afterCollapse = await h.eval(`(function(){ const c=${cardSel}; return c? c.querySelectorAll('.completed-file').length : 0; })()`);
        h.check("⑭ 收起重回 2 行（收纳闭合往返）", afterCollapse === 2, `afterCollapse=${afterCollapse}`);
        /* ⑮ 收尾后：**文件区与步骤区双双消失 = 胶囊整卡不渲染**（10-06 夜六轮，用户实测「清单不会
           自动消失」「新回合，旧的任务清单还在」—— 两区同款：只活在回合运行中，与文件区的收尾
           行为对齐）。此刻库里 [甲,乙] 仍是 todo（④e2 还原过）⇒ 消失只能来自「没在跑」这条规则，
           不是全完成蹭出来的。⛔ 清单仍在库里 = 隐藏不是删除（跨回合残留由下一回合开工清）。 */
        const afterSettle = await h.eval(`(async function(){
          const list = await window.codex.listTasks();
          return { card: !!document.querySelector('.edited-files-card'),
            running: !!document.querySelector('.send-button.is-pause'),
            stepsInStore: list.filter(function(t){ return String(t.text||"").startsWith("验收步骤"); }).length }; })()`);
        h.check("⑮ 回合结束后：文件区与步骤区双双消失（胶囊整卡不渲染；清单仍在库里 2 条 = 隐藏不是删除）",
          !!afterSettle && afterSettle.card === false && afterSettle.running === false && afterSettle.stepsInStore === 2,
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
        /* ⛔ 悬停目标 = **本回合自己的卡**（近在底部，无需长距离编程滚动）。10-06 夜四轮实测：
           用全局首个 `.completed-changes`（= 最老的卡，视口上方 2000+px）会踩到时间线长列表的
           布局/贴底逻辑 —— scrollIntoView 之后真实落点漂移，鼠标落在空处（mouseenter 一次都不触发，
           重试也救不了）。作用域与 ⑧–⑭ 的 cardSel 同款。
           ⛔ 悬停重试至多 3 次仍保留（短距离悬停的偶发落空兜底）；全失败时输出诊断。 */
        const hoverRowSel = `#turn-${turnId} .completed-changes .completed-file`;
        let hoverPreview = null;
        let hoverAttempts = 0;
        for (; hoverAttempts < 3 && !hoverPreview; hoverAttempts++) {
          if (hoverAttempts > 0) { await h.moveMouseAway().catch(() => undefined); await wait(600); await waitScrollQuiet(); }
          await h.hover(hoverRowSel).catch(() => undefined);
          await wait(900);
          hoverPreview = await h.eval(`(function(){
            var p = document.querySelector('.completed-diff-preview');
            if (!p) return null;
            var r = p.getBoundingClientRect();
            var row = document.querySelector(${JSON.stringify(hoverRowSel)});
            var rr = row ? row.getBoundingClientRect() : null;
            return { vis: getComputedStyle(p).visibility, fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
              aligned: rr ? Math.abs(r.left - rr.left) <= 2 : null, hasDiff: (p.innerText||'').includes('@@') };
          })()`).catch(() => null);
        }
        if (!hoverPreview) {
          const diag = await h.eval(`(function(){ const row=document.querySelector(${JSON.stringify(hoverRowSel)});
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
        /* ⑯c 鼠标移进预览后必须**持续展示**（10-18 用户实测：「鼠标放上去，这个框框闪一下就没了，
           鼠标放在上面就要一直展示」）。旧实现 160ms 关闭宽限会在指针走到面板前先关掉。 */
        await h.hover(".completed-diff-preview").catch(() => undefined);
        await wait(900);
        const previewStays = await h.eval(`!!document.querySelector('.completed-diff-preview')`);
        h.check("⑯c 鼠标移进预览后保持展示（不再闪没 —— 用户 10-18 实测）", previewStays === true, `stays=${previewStays}`);
        await h.moveMouseAway().catch(() => undefined);
        await wait(500);
        const previewGone = await h.eval(`!document.querySelector('.completed-diff-preview')`);
        h.check("⑰ 鼠标移开后预览自动收起（不残留浮层）", previewGone === true, `stillOpen=${!previewGone}`);
        /* ⑱d 右栏「审阅」自动带出最新回合的文件（10-18 用户：「每次最新回合中已修改的文件，
           都要在这里面展示」）—— 不先点卡片，直接开右栏审阅。 */
        await h.eval(`(function(){ if(!document.querySelector('.context-panel')) document.querySelector('.tb-right-panel')?.click(); return 1; })()`);
        await wait(600);
        await h.eval(`(function(){ const b=[...document.querySelectorAll('.panel-tab')].find((x)=>(x.textContent||'').trim()==='审阅'); b?.click(); return 1; })()`);
        let latestReview = null;
        for (let i = 0; i < 20; i++) {
          await wait(300);
          latestReview = await h.eval(`(function(){
            var panel=document.querySelector('.turn-review-panel');
            if(!panel) return null;
            return { files:document.querySelectorAll('.turn-review-file').length,
              lines:document.querySelectorAll('.turn-review-diff .diffp-line').length,
              hasAt:(document.querySelector('.turn-review-diff')?.innerText||'').includes('@@') };
          })()`).catch(() => latestReview);
          if (latestReview && latestReview.files > 0) break;
        }
        h.check("⑱d 右栏「审阅」自动展示最新回合的全部文件 + diff（不用先点卡片）",
          !!latestReview && latestReview.files >= 1 && latestReview.lines >= 1 && latestReview.hasAt === true,
          JSON.stringify(latestReview).slice(0, 220));
        /* ⑱e 每个文件块的 diff 可折叠 / 展开（用户 10-18：「没有文件折叠功能」）——
           Qoder 的连续审阅是「文件块堆叠 + 每块头部折叠」，不是只折叠整个文件列表。 */
        const fileSectionsBefore = await h.eval(`document.querySelectorAll('.turn-review-file-section .diffp').length`);
        await h.eval(`document.querySelector('.turn-review-file-toggle')?.click()`);
        await wait(250);
        const fileSectionsCollapsed = await h.eval(`document.querySelectorAll('.turn-review-file-section .diffp').length`);
        await h.eval(`document.querySelector('.turn-review-file-toggle')?.click()`);
        await wait(250);
        const fileSectionsExpanded = await h.eval(`document.querySelectorAll('.turn-review-file-section .diffp').length`);
        h.check("⑱e 每个文件块的 diff 可折叠 / 展开（Qoder 同款文件折叠）",
          fileSectionsBefore >= 1 && fileSectionsCollapsed === fileSectionsBefore - 1 && fileSectionsExpanded === fileSectionsBefore,
          JSON.stringify({ fileSectionsBefore, fileSectionsCollapsed, fileSectionsExpanded }));
        /* ⑱e2 目录树筛选：输入一个不存在的关键字 ⇒ 树为空；清空 ⇒ 文件回来。 */
        const filterBefore = await h.eval(`(function(){
          var input=document.querySelector('.turn-review-filter input');
          var before=document.querySelectorAll('.turn-review-file').length;
          if(!input) return before;
          var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(input,'__no_such_file__');
          input.dispatchEvent(new Event('input',{bubbles:true}));
          return before;
        })()`);
        await wait(250);
        const filterEmpty = (await h.eval(`({ files:document.querySelectorAll('.turn-review-file').length, noMatch:!!document.querySelector('.turn-review-no-match') })`).catch(() => null)) ?? { files: 0, noMatch: false };
        await h.eval(`(function(){
          var input=document.querySelector('.turn-review-filter input');
          if(!input) return 1;
          var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(input,'');
          input.dispatchEvent(new Event('input',{bubbles:true}));
          return 1;
        })()`);
        await wait(250);
        const filterRestored = (await h.eval(`document.querySelectorAll('.turn-review-file').length`).catch(() => 0)) ?? 0;
        h.check("⑱e2 审阅文件树可按名称筛选并清空恢复（Qoder 左侧筛选框）",
          (filterBefore ?? 0) >= 1 && filterEmpty.files === 0 && filterEmpty.noMatch === true && filterRestored >= (filterBefore ?? 1),
          JSON.stringify({ filterBefore, filterEmpty, filterRestored }));
        /* ⑱e3/⑱e4 三点菜单：四项都在；拆分/堆叠 + 自动换行都是真行为。 */
        await h.eval(`document.querySelector('.turn-review-menu-wrap > button')?.click()`);
        await wait(200);
        const menuItems = (await h.eval(`Array.from(document.querySelectorAll('.turn-review-menu button')).map(function(b){return (b.textContent||'').trim();})`).catch(() => [])) ?? [];
        h.check("⑱e3 三点菜单包含堆叠/拆分、仅空白变更、自动换行（Qoder 同款四项）",
          ["堆叠", "拆分", "隐藏仅空白变更", "启用自动换行"].every((label) => menuItems.some((item) => item.includes(label))),
          JSON.stringify(menuItems).slice(0, 220));
        await h.eval(`(function(){ var b=Array.from(document.querySelectorAll('.turn-review-menu button')).find(function(x){return (x.textContent||'').includes('拆分');}); b?.click(); return 1; })()`);
        await wait(300);
        const splitOn = (await h.eval(`({ dom:!!document.querySelector('.turn-review-diff .diffp-split'), anyDiff:!!document.querySelector('.turn-review-diff .diffp'), pref:localStorage.getItem('turn-review:view') })`).catch(() => null)) ?? {};
        await h.eval(`document.querySelector('.turn-review-menu-wrap > button')?.click()`);
        await wait(150);
        await h.eval(`(function(){ var b=Array.from(document.querySelectorAll('.turn-review-menu button')).find(function(x){return (x.textContent||'').includes('堆叠');}); b?.click(); return 1; })()`);
        await wait(250);
        const splitOff = await h.eval(`!document.querySelector('.turn-review-diff .diffp-split')`);
        await h.eval(`document.querySelector('.turn-review-menu-wrap > button')?.click()`);
        await wait(150);
        await h.eval(`(function(){ var b=Array.from(document.querySelectorAll('.turn-review-menu button')).find(function(x){return (x.textContent||'').includes('启用自动换行');}); b?.click(); return 1; })()`);
        await wait(250);
        const wrapOn = await h.eval(`!!document.querySelector('.turn-review-diff .diffp.is-wrap')`);
        await h.eval(`document.querySelector('.turn-review-menu-wrap > button')?.click()`);
        await wait(150);
        await h.eval(`(function(){ var b=Array.from(document.querySelectorAll('.turn-review-menu button')).find(function(x){return (x.textContent||'').includes('关闭自动换行');}); b?.click(); return 1; })()`);
        await wait(250);
        const wrapOff = await h.eval(`!document.querySelector('.turn-review-diff .diffp.is-wrap')`);
        h.check("⑱e4 拆分/堆叠与自动换行切换真实生效（split 落 DOM + pref；换行 class 往返）",
          splitOn.pref === "split" && splitOn.anyDiff === true && splitOff === true && wrapOn === true && wrapOff === true,
          JSON.stringify({ splitOn, splitOff, wrapOn, wrapOff }).slice(0, 260));
        /* ⑱c 汇总卡文件点击 → 右栏「审阅」（10-18 用户对照 Qoder：「已修改的文件加一个可以点击，
           然后右边展示右边这样的」）。行点击不再开居中小弹窗；右栏展示整轮文件清单 + 带行号 diff。 */
        await h.eval(`(function(){ if(document.querySelector('.context-panel')) document.querySelector('.tb-right-panel')?.click(); return 1; })()`);
        await wait(500);
        await h.eval(`document.querySelector(${JSON.stringify(hoverRowSel)})?.click()`);
        let turnReview = null;
        for (let i = 0; i < 20; i++) {
          await wait(300);
          turnReview = await h.eval(`(function(){
            var panel=document.querySelector('.turn-review-panel');
            if(!panel) return null;
            var tab=[...document.querySelectorAll('.panel-tab.active')].map(function(b){ return (b.textContent||'').trim(); });
            return { context:!!document.querySelector('.context-panel'), tab:tab.join(','), panel:true,
              files:document.querySelectorAll('.turn-review-file').length,
              lines:document.querySelectorAll('.turn-review-diff .diffp-line').length,
              hasAt:(document.querySelector('.turn-review-diff')?.innerText||'').includes('@@') };
          })()`).catch(() => turnReview);
          if (turnReview) break;
        }
        h.check("⑱c 点击汇总卡文件行 → 右栏「审阅」页展示带行号 diff（用户 10-18 对照 Qoder）",
          !!turnReview && turnReview.context === true && turnReview.tab.includes("审阅") && turnReview.panel === true
            && turnReview.files >= 1 && turnReview.lines >= 1 && turnReview.hasAt === true,
          JSON.stringify(turnReview).slice(0, 260));
        /* ⑱a（10-06 夜六轮删除）：旧版「收尾后标记全完成 ⇒ 胶囊隐藏」在「没在跑就不渲染」生效后
           退化成恒真断言（收尾本来就不显示）。「全部完成 ⇒ 步骤区隐藏」的唯一有效检验点搬到了
           运行中的 ④e/④e2。 */
        /* ⑱b 清理播种（10-06 夜三轮；夜六轮改为整库清）：任务库**全部清空** ⇒ 胶囊保持不渲染
           （清理 + 收口）。⛔ 收尾必删：播种落在持久 profile 的任务库里，泄漏会污染后续轮次；
           整库清是因为运行中可能混入模型自建的清单。 */
        await h.eval(`(async function(){ const list = await window.codex.listTasks();
          for (const t of list) { await window.codex.deleteTask(t.id); } return 1; })()`).catch(() => undefined);
        let capsuleGone = false;
        for (let i = 0; i < 10; i++) {
          await wait(300);
          capsuleGone = await h.eval(`!document.querySelector('.edited-files-card')`).catch(() => false);
          if (capsuleGone) break;
        }
        h.check("⑱b 删除任务后胶囊保持不渲染（没有内容就不占位 —— 两区独立渲染规则的收口）", capsuleGone === true, `gone=${capsuleGone}`);
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
      /* ④-⑦ 工作区菜单（📁，10-06 夜八轮用户实测「点图标都不会自动消失、其他地方点不了、
         关都关不掉」）：开 → 整矩形 fits → **点外面即关**（window mousedown 判外部，非阻塞）
         → 重开 → Esc 关（双退路）。
         ⛔ CDP 合成点击绕开 OS 拖拽判定 —— 这里证的是**关闭逻辑接线**；「顶栏拖拽区吞真实
         鼠标点击」那类只有真机暴露，靠守卫 11e 的结构判据（backdrop 无拖拽豁免 / 非阻塞接线）钉。 */
      const wsBtn = await h.eval(`!!document.querySelector('.tb-workspace')`);
      h.check("④ 前置：工作区按钮（📁，标题最前）在", wsBtn === true, `wsBtn=${wsBtn}`);
      if (wsBtn) {
        await h.eval(`(function(){ document.querySelector('.tb-workspace').click(); return 1; })()`);
        await wait(400);
        const cm = await h.eval(`${FIT}('.ctx-menu')`).catch(() => null);
        h.check("⑤ 工作区菜单整矩形落在视口内（自适应：贴边钳制由 useAnchoredPopover 兜底）", !!cm && cm.fits === true, JSON.stringify(cm));
        await h.eval(`(function(){ document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return 1; })()`);
        await wait(300);
        const closedByClick = await h.eval(`!document.querySelector('.ctx-menu')`);
        h.check("⑥ 点菜单外即关（window mousedown 判外部 —— 非阻塞，点图标一次就关闭且图标照常生效）", closedByClick === true, `closed=${closedByClick}`);
        await h.eval(`(function(){ document.querySelector('.tb-workspace').click(); return 1; })()`);
        await wait(350);
        await h.pressKey("Escape");
        await wait(300);
        const closedByEsc = await h.eval(`!document.querySelector('.ctx-menu')`);
        h.check("⑦ Esc 关闭工作区菜单（键盘退路，守卫 11e ⑨ 钉接线）", closedByEsc === true, `closed=${closedByEsc}`);
      }
      /* ⑧ 收尾：浮层都已收起（不留悬挂菜单挡后面的截图/验收） */
      const leftovers = await h.eval(`document.querySelectorAll('.composer-menu-pop, .file-card-menu, .ctx-menu').length`);
      h.check("⑧ 普查后无悬挂菜单残留（都收干净）", leftovers === 0, `leftovers=${leftovers}`);
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
      /* ①b 把手**骑在输入框顶边框上**（10-06 夜九轮用户令「放到输入框边框上，不要放里面，
         可以稍微长一点点」）：把手中线 == .composer 顶边框线（±2px）；胶囊宽度按「加长后」查
         （≥50px，内置旧版 40px 会红）。 */
      const saddle = await h.eval(`(function(){ var el=document.querySelector('.composer-resize-handle');
        var box=document.querySelector('.composer'); if(!el||!box) return null;
        var hr=el.getBoundingClientRect(); var br=box.getBoundingClientRect();
        var grip=el.querySelector('.composer-resize-grip'); var gr=grip?grip.getBoundingClientRect():null;
        return { handleMid: Math.round((hr.top+hr.bottom)/2), borderY: Math.round(br.top), gripW: gr?Math.round(gr.width):0 }; })()`).catch(() => null);
      h.check("①b 把手骑在输入框顶边框上（中点贴边框线 ±2px）+ 胶囊已加长（≥50px）",
        !!saddle && Math.abs(saddle.handleMid - saddle.borderY) <= 2 && saddle.gripW >= 50, JSON.stringify(saddle));
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
    id: "goal-bar",
    name: "㉖ /goal 目标条：set 出现 / 引擎计时跳动 / 编辑往返 / 暂停·继续·删除（10-06 夜五轮 · 用户对照 Qoder）",
    run: async (h) => {
      /* 为什么真跑（用户对照 Qoder 提的形态 + 三条动作）：暂停/继续走的是 `thread/goal/set` 的
         status 字段（10-06 隔离引擎实测支持；引擎**没有** goal/pause|resume RPC）——「编辑」的
         状态保持、暂停对正在跑回合的 interrupt、删除=clear，全是静默失效型接线，只有真跑能证。
         ⚠️ 本项放在默认轮**最后**：⑤ 的「继续」会拉起一个**真引擎的自动续跑回合**（我们会在
         ⑥ 立刻暂停+中断它）；开头防御性 clear 残留目标，避免上一轮失败留下的活跃目标乱跑。 */
      await h.waitFor(`!!document.querySelector(".thread-row.active") && !!document.querySelector(".composer-editor")`, { label: "界面就绪", timeoutMs: 40000 }).catch(() => undefined);
      const threadId = await h.eval(`(function(){ var row=document.querySelector('.thread-row.active'); return row ? row.getAttribute('data-thread-id') : null; })()`);
      h.check("① 前置：拿得到活动会话 id（拿不到整项作废）", typeof threadId === "string" && threadId.length > 8, `id=${String(threadId).slice(0, 20)}`);
      if (typeof threadId !== "string" || threadId.length < 9) return;
      const goalRequest = (method, params) => h.eval(`(async function(){ try { return await window.codex.request(${JSON.stringify(method)}, ${JSON.stringify(params)}); } catch (error) { return { error: String(error && error.message || error) }; } })()`);
      await goalRequest("thread/goal/clear", { threadId });
      await wait(500);
      const barAbsent = await h.eval(`!document.querySelector('.goal-bar')`);
      h.check("② 前置：无目标时目标条不渲染（先清残留——上一轮失败可能留下活跃目标）", barAbsent === true, `absent=${barAbsent}`);

      /* ③ set(paused 起步：不触发自动续跑，保证本段确定性) ⇒ 目标条出现：🎯「目标 · N秒」+ 内容 + 已暂停 + 三键 */
      await goalRequest("thread/goal/set", { threadId, objective: "验收目标条", status: "paused" });
      let bar = null;
      for (let i = 0; i < 25; i++) {
        await wait(300);
        bar = await h.eval(`(function(){ var b=document.querySelector('.goal-bar'); if(!b) return null;
          return { title:(b.querySelector('.goal-bar-title')||{}).textContent||'', text:(b.querySelector('.goal-bar-text')||{}).textContent||'',
            state:(b.querySelector('.goal-bar-state')||{}).textContent||'', btns:b.querySelectorAll('.goal-bar-btn').length }; })()`).catch(() => bar);
        if (bar && /目标 · \d/.test(bar.title)) break;
      }
      h.check("③ set(paused) 后目标条出现：🎯「目标 · N秒」+ 内容 + 已暂停 + 编辑/删除/继续三键",
        !!bar && /^目标 · \d+秒$/.test(bar.title) && bar.text === "验收目标条" && bar.state === "已暂停" && bar.btns === 3,
        JSON.stringify(bar));
      /* ④ 编辑往返：点编辑 → 弹窗改文本 → 确定 ⇒ 文本更新，且仍「已暂停」（编辑不动状态） */
      await h.eval(`document.querySelectorAll('.goal-bar-btn')[0]?.click()`);
      const modal = await h.waitFor(`!!document.querySelector('.app-prompt-form [name="promptText"]')`, { label: "编辑目标弹窗", timeoutMs: 6000 }).then(() => true).catch(() => false);
      let edited = false;
      if (modal) {
        await h.eval(`(function(){ var el=document.querySelector('.app-prompt-form [name="promptText"]'); el.value="验收目标条（改）"; el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        await h.eval(`document.querySelector('.app-prompt-form .app-prompt-actions button[type="submit"]')?.click()`);
        for (let i = 0; i < 15; i++) {
          await wait(300);
          edited = await h.eval(`(document.querySelector('.goal-bar-text')||{}).textContent === "验收目标条（改）"`).catch(() => false);
          if (edited) break;
        }
      }
      h.check("④ 编辑往返：弹窗改文本 → 目标条更新，且状态仍「已暂停」（编辑保持原状态，不误触发续跑）",
        modal === true && edited === true, JSON.stringify({ modal, edited }));
      /* ⑤ 继续 ⇒ 引擎自动续跑：状态「自动推进中」+ 计时开始跳（两次读数不同）+ 真回合被拉起 */
      await h.eval(`(function(){ var btns=[...document.querySelectorAll('.goal-bar-btn')]; var last=btns[btns.length-1]; last&&last.click(); return 1; })()`);
      let live = null;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        live = await h.eval(`(function(){ var b=document.querySelector('.goal-bar'); if(!b) return null;
          return { state:(b.querySelector('.goal-bar-state')||{}).textContent||'', title:(b.querySelector('.goal-bar-title')||{}).textContent||'',
            running: !!document.querySelector('.send-button.is-pause') }; })()`).catch(() => live);
        if (live && live.state === "自动推进中") break;
      }
      const tickA = live ? live.title : "";
      await wait(2600);
      const tickB = await h.eval(`(document.querySelector('.goal-bar-title')||{}).textContent || ""`).catch(() => "");
      const ranForReal = await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false);
      h.check("⑤ 继续：状态回「自动推进中」且计时在跳（两次读数不同 = 引擎侧计时 + 活动态每秒跳）",
        !!live && live.state === "自动推进中" && /目标 · \d/.test(tickA) && /目标 · \d/.test(tickB) && tickA !== tickB,
        JSON.stringify({ live, tickA, tickB }));
      await h.screenshot("goal-bar-live");
      /* ⑥ 暂停 ⇒ 「已暂停」+ 正在跑的回合被中断（引擎的 paused 只停下一次续跑，回合要 interrupt） */
      await h.eval(`(function(){ var btns=[...document.querySelectorAll('.goal-bar-btn')]; var last=btns[btns.length-1]; last&&last.click(); return 1; })()`);
      let paused = false;
      let stopped = false;
      for (let i = 0; i < 60; i++) {
        await wait(300);
        const st = await h.eval(`(function(){ var b=document.querySelector('.goal-bar'); return { state: b ? ((b.querySelector('.goal-bar-state')||{}).textContent||'') : '',
          running: !!document.querySelector('.send-button.is-pause') }; })()`).catch(() => null);
        if (st && st.state === "已暂停") paused = true;
        if (!ranForReal || (st && !st.running)) stopped = true;
        if (paused && stopped) break;
      }
      h.check("⑥ 暂停：状态「已暂停」+ 正在跑的续跑回合被中断（interrupt 接线成立）",
        paused === true && stopped === true, JSON.stringify({ paused, stopped, ranForReal }));
      /* ⑦ 删除 ⇒ 目标条消失 + 引擎 goal 清空（stopGoalLoop → thread/goal/clear） */
      await h.eval(`document.querySelectorAll('.goal-bar-btn')[1]?.click()`);
      let gone = false;
      for (let i = 0; i < 20; i++) {
        await wait(300);
        gone = await h.eval(`!document.querySelector('.goal-bar')`).catch(() => false);
        if (gone) break;
      }
      const engineGoal = await goalRequest("thread/goal/get", { threadId });
      h.check("⑦ 删除：目标条消失、引擎 goal 已清空（再开局也不会自动推进）",
        gone === true && !(engineGoal && engineGoal.goal), JSON.stringify({ gone, engineGoal }).slice(0, 220));
      await h.screenshot("goal-bar-deleted");
    },
  },
  {
    id: "status-lights",
    name: "㉗ 输入框底栏动态状态灯：空闲无灯 / 目标灯（tone）/ 最多一盏 / 窗口自适应隐藏（10-12 轮）",
    run: async (h) => {
      /* 真跑理由：行为级断言（结构由守卫 12d 钉）；挂起灯不走真队列防污染，接线由 12d 钉 */
      await h.waitFor(`!!document.querySelector(".thread-row.active") && !!document.querySelector(".composer-editor")`, { label: "界面就绪", timeoutMs: 40000 }).catch(() => undefined);
      const threadId = await h.eval(`(function(){ var row=document.querySelector('.thread-row.active'); return row ? row.getAttribute('data-thread-id') : null; })()`);
      h.check("① 前置：拿得到活动会话 id（拿不到整项作废）", typeof threadId === "string" && threadId.length > 8, `id=${String(threadId).slice(0, 20)}`);
      if (typeof threadId !== "string" || threadId.length < 9) return;
      const rpc = (method, params) => h.eval(`(async function(){ try { return await window.codex.request(${JSON.stringify(method)}, ${JSON.stringify(params)}); } catch (error) { return { error: String(error && error.message || error) }; } })()`);
      /* 防御性清场：持久 profile 可能残留排队消息（上一轮失败留下的）—— ② 要断言"空闲无灯"，
         残留队列会让它假红。清干净再断言。 */
      const queued = await rpc("thread/queue/list", { threadId, limit: 100 });
      for (const entry of (queued && queued.data) || []) {
        await rpc("thread/queue/delete", { threadId, queuedSubmissionId: entry.id ?? entry.queuedSubmissionId });
      }
      await rpc("thread/goal/clear", { threadId });
      await wait(900);
      const idle = await h.eval(`document.querySelector('.composer-status-lights') === null`);
      h.check("② 空闲时一盏都不亮（无状态 = 无节点，不是隐藏的空壳）", idle === true, `queuedResidual=${((queued && queued.data) || []).length}`);
      /* ③ 目标灯：goal/set(paused) → 灯出现 + tone-muted + 最多一盏（单节点轮换制） */
      await rpc("thread/goal/set", { threadId, objective: "验收状态灯", status: "paused" });
      let light = null;
      for (let i = 0; i < 30; i++) {
        await wait(300);
        light = await h.eval(`(function(){ var el=document.querySelector('.composer-status-light'); if(!el) return null;
          return { cls: el.className, title: el.getAttribute('title')||'', label: (el.querySelector('.light-label')||{}).textContent||'',
            count: document.querySelectorAll('.composer-status-light').length }; })()`).catch(() => light);
        if (light && /目标模式/.test(light.title)) break;
      }
      h.check("③ 目标灯亮：目标模式 · 已暂停（tone-muted）+ 同一时刻只有一盏（单节点轮换制）",
        !!light && light.count === 1 && /tone-muted/.test(light.cls) && /目标模式/.test(light.title) && /已暂停/.test(light.title) && light.label === "目标模式",
        JSON.stringify(light));
      /* ④ 窗口自适应（用户令「跟着窗口大小自适应隐藏」）：CDP 视口模拟 —— ≤1060px 整块隐藏、
         1240px 收文字只留图标、复原后原样。用 Emulation 不真改窗口：断言完即复原。 */
      await h._send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
      await wait(500);
      const narrow = await h.eval(`(function(){ var el=document.querySelector('.composer-status-lights'); return el ? getComputedStyle(el).display : 'gone'; })()`);
      await h._send("Emulation.setDeviceMetricsOverride", { width: 1240, height: 800, deviceScaleFactor: 1, mobile: false });
      await wait(500);
      const mid = await h.eval(`(function(){ var wrap=document.querySelector('.composer-status-lights'); var label=wrap?wrap.querySelector('.light-label'):null;
        return { wrap: wrap?getComputedStyle(wrap).display:'gone', label: label?getComputedStyle(label).display:'visible' }; })()`);
      await h._send("Emulation.clearDeviceMetricsOverride", {});
      await wait(500);
      const restored = await h.eval(`(function(){ var el=document.querySelector('.composer-status-light'); return el ? getComputedStyle(el).display !== 'none' : false; })()`);
      h.check("④ 窗口自适应：≤1060px 整块隐藏 → 1240px 收文字只留图标 → 复原后可见",
        narrow === "none" && mid && mid.wrap !== "none" && mid.wrap !== "gone" && mid.label === "none" && restored === true,
        JSON.stringify({ narrow, mid, restored }));
      await h.screenshot("status-lights");
      /* ⑤ 清目标 ⇒ 灯灭（状态源是唯一真相源，清了不残留）。
         ⛔ 走 UI 删除键（stopGoalLoop = 本地清 + RPC clear），不走裸 RPC：引擎对 clear
         不一定广播事件，宿主自己的删除路径才同时清两处（goal-bar ⑦ 同款）。 */
      await h.eval(`document.querySelectorAll('.goal-bar-btn')[1]?.click()`);
      let gone = false;
      for (let i = 0; i < 25; i++) {
        await wait(300);
        gone = await h.eval(`document.querySelector('.composer-status-lights') === null`).catch(() => false);
        if (gone) break;
      }
      const engineGoalAfter = await rpc("thread/goal/get", { threadId });
      h.check("⑤ 点目标条删除键：灯跟着灭、引擎 goal 已清空（不残留）",
        gone === true && !(engineGoalAfter && engineGoalAfter.goal), JSON.stringify({ gone, engineGoalAfter }).slice(0, 200));
    },
  },
  {
    id: "newbie-guide",
    name: "㉖ 新手引导：侧栏常驻入口 + 迷你设置弹窗（新手/高级两组、图示+文字、映射跳转、版本日志、拓展开发；10-07 轮，10-18 扩内容）",
    run: async (h) => {
      /* 为什么真跑（用户 10-07 令 + 追问「这个新手引导不能被对话选项遮住」）：
         入口位置（列表之外、账户行之上、不被滚动内容盖住）、点击开合、映射跳转（弹窗关 →
         设置页真停在「模型」）、版本日志（真数据、来自 whatsnew:history）—— 全是最终态才成立的
         东西，静态守卫只看结构，这里跑行为。 */
      await h.waitFor(`!!document.querySelector(".guide-entry") && !!document.querySelector(".composer-editor")`, { label: "引导入口与界面就绪", timeoutMs: 30000 }).catch(() => undefined);
      /* ⛔ ① 的命中测试必须等**启动页摘掉**：boot-splash 是全屏覆盖层，还在时 elementFromPoint
         会命中它（实测假红一次）—— 入口本身没问题，是跑得比启动页退场早。 */
      await h.waitFor(`!document.querySelector(".boot-splash")`, { label: "启动页已摘", timeoutMs: 60000 }).catch(() => undefined);
      await wait(400);
      /* ① 入口常驻：在 .thread-list 之外、账户行之上、可见且命中自身（不被任何东西遮住） */
      const entryPos = await h.eval(`(function(){
        var entry = document.querySelector('.guide-entry');
        if (!entry) return null;
        var list = document.querySelector('.thread-list');
        var row = document.querySelector('.account-row');
        var er = entry.getBoundingClientRect();
        var lr = list ? list.getBoundingClientRect() : null;
        var rr = row ? row.getBoundingClientRect() : null;
        var el = document.elementFromPoint(Math.round(er.left + er.width / 2), Math.round(er.top + er.height / 2));
        return { vis: er.height > 0 && er.width > 0,
          belowList: lr ? er.top >= lr.bottom - 1 : null,
          aboveRow: rr ? er.bottom <= rr.top + 1 : null,
          hitSelf: el ? (el === entry || entry.contains(el)) : null };
      })()`).catch(() => null);
      h.check("① 入口常驻在会话列表之外、账户行之上、可见且可点（不被列表内容遮住 —— 用户点名的一条）",
        !!entryPos && entryPos.vis === true && entryPos.belowList === true && entryPos.aboveRow === true && entryPos.hitSelf === true,
        JSON.stringify(entryPos));
      if (!entryPos?.vis) { h.check("①b 前置缺失：入口不存在，本项作废", false, "guide-entry 缺失"); return; }
      /* ② 点击弹窗：左选项 ≥5 个 + 右内容区在；默认停在第一节（快速上手） */
      await h.eval(`document.querySelector('.guide-entry').click()`);
      let opened = null;
      for (let i = 0; i < 12; i++) {
        await wait(250);
        opened = await h.eval(`(function(){
          var modal = document.querySelector('.guide-modal');
          if (!modal) return null;
          var rect = modal.getBoundingClientRect();
          return { fits: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
            nav: [...modal.querySelectorAll('.guide-nav-item')].map(function(b){ return (b.textContent||'').trim(); }),
            groups: [...modal.querySelectorAll('.guide-nav-group')].map(function(b){ return (b.textContent||'').trim(); }),
            tier: (modal.querySelector('.guide-tier-pill')?.textContent||'').trim(),
            active: (modal.querySelector('.guide-nav-item.active')?.textContent||'').trim(),
            title: (modal.querySelector('.guide-body-head h3')?.textContent||'').trim() };
        })()`).catch(() => opened);
        if (opened) break;
      }
      h.check("② 点击弹出迷你设置（左选项/右内容、整矩形在视口内、默认停在第一节「快速上手」）",
        !!opened && opened.fits === true && (opened.nav ?? []).length >= 5 && opened.active === "快速上手" && opened.title.length > 0,
        JSON.stringify(opened).slice(0, 240));
      if (!opened) return;
      const nav0 = opened.nav ?? [];
      /* ②a 分组（10-18 用户：「分新手和高级教程」）：两组组标题 + 默认节的层级徽章 */
      h.check("②a 左导航分「新手教程 / 高级教程」两组，默认节带「新手」徽章",
        (opened.groups ?? []).join("|") === "新手教程|高级教程" && opened.tier === "新手",
        JSON.stringify({ groups: opened.groups, tier: opened.tier }).slice(0, 200));
      /* ②b 图示 + 文字（10-18 用户：「把应用功能都扫一遍，做一个详细的新手教程，画图+字结合起来」）：
         章节要够多（详细）、每节带图、界面速览那张是**窗格分区 SVG**、其它节是流程/并列/分层示意图。 */
      const figureProbe = async (label) => {
        await h.eval(`(function(){ var b=[...document.querySelectorAll('.guide-nav-item')].find(function(x){ return (x.textContent||'').trim()===${JSON.stringify(label)}; }); b?.click(); return 1; })()`);
        await wait(300);
        return h.eval(`(function(){
          var fig=document.querySelector('.guide-body .guide-figure');
          if(!fig) return { found:false };
          var rect=fig.getBoundingClientRect();
          var svg=fig.querySelector('svg');
          return { found:true, kind:(fig.className||'').replace('guide-figure','').trim(),
            visible: rect.height > 40 && rect.width > 200,
            nodes: fig.querySelectorAll('.guide-figure-node, .guide-figure-pane, .guide-figure-layer').length,
            svg: svg ? { h: Math.round(svg.getBoundingClientRect().height), texts: svg.querySelectorAll('text').length } : null,
            caption: (fig.querySelector('.guide-figure-caption')?.textContent||'').trim().length }; })()`);
      };
      const windowFigure = await figureProbe("界面速览");
      h.check("②b 界面速览：内联 SVG 窗口分区图（5 区标注 + 说明文字）",
        windowFigure?.found === true && windowFigure.kind.includes('is-window') && windowFigure.visible === true
          && !!windowFigure.svg && windowFigure.svg.texts >= 10 && windowFigure.caption > 0,
        JSON.stringify(windowFigure));
      const flowFigure = await figureProbe("一次对话");
      h.check("②c 内容节带示意图（流程/并列/分层）：至少有 3 个盒子 + 图注",
        flowFigure?.found === true && flowFigure.visible === true && flowFigure.nodes >= 3 && flowFigure.caption > 0,
        JSON.stringify(flowFigure));
      h.check("②d 教程足够详细：左选项 ≥ 20 节（前端开发/组件库/生图/视频/专家团队/个性化/人格市场/拓展开发等都在）",
        (nav0 ?? []).length >= 20
          && ["前端开发", "组件库", "生图", "视频", "专家团队", "个性化", "人格市场", "拓展开发"].every((label) => nav0.includes(label)),
        `nav=${(nav0 ?? []).length} ${JSON.stringify(nav0).slice(0, 240)}`);
      /* ②e 高级教程里的「拓展开发」：层级徽章=高级、正文有真接口名与命令、带重点提醒卡 */
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.guide-nav-item')].find(function(x){ return (x.textContent||'').trim()==='拓展开发'; }); b?.click(); return 1; })()`);
      await wait(300);
      const apiSection = await h.eval(`(function(){
        var modal=document.querySelector('.guide-modal'); if(!modal) return null;
        var body=modal.querySelector('.guide-body');
        var text=(body?.textContent||'');
        return { tier:(modal.querySelector('.guide-tier-pill')?.textContent||'').trim(),
          hasPage:text.includes('拓展接口'), hasSkill:text.includes('harness-api'),
          hasGen:text.includes('npm run gen:ipc'), hasGuard:text.includes('scripts/guards'),
          tip:!!body.querySelector('.guide-tip') };
      })()`);
      h.check("②e 高级教程有「拓展开发」：高级徽章 + 真接口名（拓展接口/harness-api/gen:ipc/guards）+ 提醒卡",
        !!apiSection && apiSection.tier === "高级" && apiSection.hasPage === true && apiSection.hasSkill === true
          && apiSection.hasGen === true && apiSection.hasGuard === true && apiSection.tip === true,
        JSON.stringify(apiSection).slice(0, 240));
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.guide-nav-item')].find(function(x){ return (x.textContent||'').trim()==='快速上手'; }); b?.click(); return 1; })()`);
      await wait(200);
      /* ③ 左选项：三个设置页映射 + 更新日志**置底**（用户：「版本更新日志默认在最下面」） */
      const nav = opened.nav ?? [];
      h.check("③ 左选项含 模型/开发工具/人格市场 三映射，且「更新日志」置底",
        ["配置模型", "开发工具", "人格市场"].every((label) => nav.includes(label)) && nav[nav.length - 1] === "更新日志",
        JSON.stringify(nav));
      /* ④ 映射跳转：切到「配置模型」→ 点「打开设置」→ 引导弹窗关、真设置页打开且**停在模型页** */
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.guide-nav-item')].find(function(x){ return (x.textContent||'').trim()==='配置模型'; }); b?.click(); return 1; })()`);
      await wait(300);
      await h.eval(`document.querySelector('.guide-action')?.click()`);
      let jumped = null;
      for (let i = 0; i < 16; i++) {
        await wait(300);
        jumped = await h.eval(`(function(){
          var guide = !!document.querySelector('.guide-modal');
          var modal = document.querySelector('.settings-modal');
          var active = modal ? (modal.querySelector('.settings-nav button.active')?.textContent||'').trim() : null;
          return { guideClosed: !guide, settingsOpen: !!modal, activePage: active };
        })()`).catch(() => jumped);
        if (jumped && jumped.settingsOpen && jumped.activePage) break;
      }
      h.check("④ 映射跳转到位：弹窗关闭 + 设置页打开且左栏停在「模型」（不是只打开了设置）",
        !!jumped && jumped.guideClosed === true && jumped.settingsOpen === true && jumped.activePage === "模型",
        JSON.stringify(jumped));
      await h.pressKey("Escape");
      await wait(400);
      /* ⑤ 版本更新日志：置底项 → 真数据列表（版本号 + 日期 + 条目；数据 = whatsnew:history 单源） */
      await h.eval(`document.querySelector('.guide-entry').click()`);
      await wait(350);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.guide-nav-item')].find(function(x){ return (x.textContent||'').trim()==='更新日志'; }); b?.click(); return 1; })()`);
      let releases = null;
      for (let i = 0; i < 20; i++) {
        await wait(300);
        releases = await h.eval(`(function(){
          var rows = [...document.querySelectorAll('.guide-release')];
          if (!rows.length) return null;
          var head = rows[0].querySelector('.guide-release-head');
          return { count: rows.length, first: (head?.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 40),
            firstItems: rows[0].querySelectorAll('li').length,
            linked: !!rows[0].querySelector('.guide-release-link') };
        })()`).catch(() => releases);
        if (releases) break;
      }
      h.check("⑤ 版本更新日志是真数据（≥1 条 vX.Y.Z + 条目列表 + 完整说明入口）",
        !!releases && releases.count >= 1 && /^v\d+\.\d+\.\d+/.test(releases.first || "") && releases.firstItems >= 1,
        JSON.stringify(releases).slice(0, 200));
      /* ⑥ Esc 关闭 + 无残留 */
      await h.pressKey("Escape");
      await wait(350);
      const closed = await h.eval(`!document.querySelector('.guide-modal')`);
      h.check("⑥ Esc 关闭引导弹窗（与既有弹窗口径一致）", closed === true, `closed=${closed}`);
      await h.screenshot("newbie-guide");
    },
  },
  {
    id: "laya-judge",
    name: "㉘ Laya 判断工具：装了才暴露；未装时执行端明确拒绝（10-18 轮）",
    run: async (h) => {
      /* 为什么真跑：条件暴露与执行端「未安装 / 预热 / 判断」都是运行期行为；Laya 是否安装随机器不同，
         所以两条路径都要成立：未装 ⇒ 直接调用必须拒绝且不偷偷安装；已装 ⇒ 至少真判一次或明确回报预热。 */
      const status = await h.eval(`window.codex.layaStatus()`).catch(() => null);
      h.check("① Laya 状态可读（前置）", !!status && typeof status.installed === "boolean", JSON.stringify(status).slice(0, 200));
      if (!status) return;
      if (!status.installed) {
        const missing = await h.eval(`window.codex.layaJudge({ preset: "knowledge_gate", state: "项目约定：提交前必须运行 npm run check。" })`).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
        h.check("② 未安装：直接调用执行端返回「未安装」，且说明工具需要装了才出现",
          missing?.ok === false && /未安装/.test(String(missing?.error ?? "")) && /laya_judge/.test(String(missing?.error ?? "")),
          JSON.stringify(missing).slice(0, 260));
        const after = await h.eval(`window.codex.layaStatus()`).catch(() => null);
        h.check("③ 未安装路径没有偷偷安装（installed 仍为 false）", after?.installed === false, JSON.stringify(after).slice(0, 160));
        return;
      }
      let result = null;
      for (let i = 0; i < 3; i++) {
        result = await h.eval(`window.codex.layaJudge({ preset: "knowledge_gate", state: "项目约定：所有提交前必须运行 npm run check；这是团队必须遵守的工程规范。", timeoutMs: 8000 })`).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
        if (result?.ok) break;
        await wait(3000);
      }
      const judged = result?.ok === true && /Laya (判断|弃权)/.test(String(result?.output ?? ""));
      const warming = result?.ok === false && /正在预热/.test(String(result?.error ?? ""));
      h.check("② 已安装：执行端可达（真判一次，或明确回报正在预热）", judged || warming, JSON.stringify(result).slice(0, 260));
      const invalid = await h.eval(`window.codex.layaJudge({ preset: "custom", state: "x", instructions: "判断", criteria: { only: "一个选项" } })`).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      h.check("③ 参数校验：custom 少于 2 个选项会被明确拒绝", invalid?.ok === false && /2~6/.test(String(invalid?.error ?? "")), JSON.stringify(invalid).slice(0, 220));
    },
  },
  {
    id: "html-preview",
    name: "㉙ HTML 实时预览：写 HTML 自动开右栏并实时重载（10-18 轮）",
    run: async (h) => {
      /* 为什么真跑：自动开右栏、按比例加宽、webview 无缓存重载都是运行期行为；
         用**真回合 + 测试进程写文件**走 turn-file-watch 真链路（与 file-summary 同款），
         再用 webview 的 executeJavaScript 读 guest 的 document.title 验证「内容真的换了」。 */
      const target = join(ROOT, "html-preview-acceptance.html");
      const cleanup = () => { try { rmSync(target, { force: true }); } catch { /* ignore */ } };
      cleanup();
      const clicked = await h.eval(`(function(){ const b=[...document.querySelectorAll('.sidebar-tab')].find((x)=>(x.textContent||'').includes('新建任务')); if(!b) return 0; b.click(); return 1; })()`).catch(() => 0);
      h.check("① 点到「新建任务」（前置）", clicked === 1, `clicked=${clicked}`);
      if (clicked !== 1) return;
      await wait(1200);
      /* 先收起右栏（如果开着）：验证是「写 HTML 自动打开的」，不是本来就开着。 */
      const closedPanel = await h.eval(`(function(){ if(!document.querySelector('.context-panel')) return true; const b=document.querySelector('.tb-right-panel'); if(!b) return false; b.click(); return true; })()`).catch(() => false);
      await wait(500);
      h.check("②a 前置：右栏已收起（验证是自动打开的）", closedPanel === true, `closedPanel=${closedPanel}`);
      await h.eval(`(function(){ const dt=new DataTransfer(); dt.setData("text/plain", "请先用 shell 运行 sleep 8（必须真的执行），然后只回复：好。不要做别的。"); const el=document.querySelector('.composer-editor'); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles:true, cancelable:true })); return 1; })()`);
      await wait(500);
      await h.pressKey("Enter", { text: "\r" });
      let running = false;
      for (let i = 0; i < 80; i++) {
        await wait(200);
        if (await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false)) { running = true; break; }
      }
      h.check("② 前置：真回合真的跑起来了（没跑 = 模型未配置/引擎没起，本项作废）", running === true, `running=${running}`);
      if (!running) return;
      /* 快照可能正好在读目录：先写一版、等 2s 再写一版 —— 两版之间必有一版落在快照之后。 */
      writeFileSync(target, "<!doctype html><html><head><meta charset=\"utf-8\"><title>preview-v0</title></head><body><h1>v0</h1></body></html>", "utf8");
      await wait(2000);
      writeFileSync(target, "<!doctype html><html><head><meta charset=\"utf-8\"><title>preview-v1</title></head><body><h1>v1</h1></body></html>", "utf8");
      let opened = null;
      for (let i = 0; i < 60; i++) {
        await wait(500);
        opened = await h.eval(`(function(){
          const shell = document.querySelector('.app-shell');
          const panel = document.querySelector('.context-panel');
          const tab = document.querySelector('.panel-tab.active');
          const wv = document.querySelector('webview');
          const tracks = shell ? getComputedStyle(shell).gridTemplateColumns.split(' ').map(parseFloat) : [];
          return { panel: !!panel, tab: (tab?.textContent||'').trim(), src: wv ? String(wv.getAttribute('src')||'') : '', width: tracks[tracks.length-1] || 0, inner: window.innerWidth };
        })()`).catch(() => opened);
        if (opened?.panel && opened.tab.includes("浏览器") && /html-preview-acceptance\.html/i.test(decodeURIComponent(opened.src))) break;
      }
      h.check("③ 写 HTML 后自动打开右栏浏览器并加载该文件",
        !!opened && opened.panel === true && opened.tab.includes("浏览器") && /html-preview-acceptance\.html/i.test(decodeURIComponent(opened.src)),
        JSON.stringify(opened).slice(0, 260));
      await wait(700);
      const widened = await h.eval(`(function(){ const shell=document.querySelector('.app-shell'); if(!shell) return 0; const tracks=getComputedStyle(shell).gridTemplateColumns.split(' ').map(parseFloat); return tracks[tracks.length-1]||0; })()`).catch(() => 0);
      h.check("④ 右栏自动加宽（窗口 45% 档，≥360px）", widened >= 360, `width=${widened} inner=${opened?.inner}`);
      if (!opened?.panel) { cleanup(); return; }
      writeFileSync(target, "<!doctype html><html><head><meta charset=\"utf-8\"><title>preview-v2</title></head><body><h1>v2</h1></body></html>", "utf8");
      let title = "";
      for (let i = 0; i < 40; i++) {
        await wait(300);
        title = await h.eval(`(function(){ const wv=document.querySelector('webview'); if(!wv || typeof wv.executeJavaScript!=='function') return ''; return wv.executeJavaScript('document.title').catch(function(){ return ''; }); })()`).catch(() => "");
        if (title === "preview-v2") break;
      }
      h.check("⑤ 文件改动后 webview 实时刷新（guest 标题从 v1 变 v2）", title === "preview-v2", `title=${title}`);
      /* ⑥ 用户 10-18 实测：「正常我进去不要每次都打开对话框里面已有的 html 文件」。
         resume 会把历史回合的文件报告重播成同一个 turn-file-changes 事件；没有 live 记录的
         历史报告必须被忽略。这里真切走再切回，验证右栏不会被历史报告重新打开。 */
      for (let i = 0; i < 40; i++) {
        await wait(500);
        if (!(await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false))) break;
      }
      await wait(1500);
      const tid = await h.eval(`(function(){ const shell=document.querySelector('.app-shell'); const sid=shell?shell.getAttribute('data-thread-id'):''; if(sid) return sid; const row=document.querySelector('.thread-row.active'); return row ? row.getAttribute('data-thread-id') : ''; })()`).catch(() => "");
      h.check("⑥ 前置：读到当前会话 id（切回测试）", typeof tid === "string" && tid.length > 10, `tid=${tid}`);
      if (tid) {
        await h.eval(`(function(){ if(document.querySelector('.context-panel')) document.querySelector('.tb-right-panel')?.click(); return 1; })()`);
        await wait(600);
        const switched = await h.eval(`(function(){
          const rows=[...document.querySelectorAll('.thread-row')];
          const other=rows.find((row)=>row.getAttribute('data-thread-id') && row.getAttribute('data-thread-id')!==${JSON.stringify(tid)});
          if(!other) return 0; other.click(); return 1;
        })()`).catch(() => 0);
        await wait(1500);
        await h.eval(`(function(){ if(document.querySelector('.context-panel')) document.querySelector('.tb-right-panel')?.click(); return 1; })()`);
        await wait(600);
        await h.eval(`(function(){ const row=[...document.querySelectorAll('.thread-row')].find((r)=>r.getAttribute('data-thread-id')===${JSON.stringify(tid)}); row?.click(); return !!row; })()`);
        await wait(3000);
        const reopened = await h.eval(`!!document.querySelector('.context-panel')`).catch(() => true);
        h.check("⑥ 切回会话：历史 HTML 报告重播不自动打开已有文件（用户实测「进去不要每次都打开」）", switched === 1 && reopened === false, JSON.stringify({ switched, reopened }));
      }
      cleanup();
    },
  },
  {
    id: "git-review",
    name: "㉚ 右栏变更：四个范围真实可用 + 分支起点 + Git 缺失可安装（10-18 轮）",
    run: async (h) => {
      /* 用户截图框住右栏「变更」下拉问「是不是真实的」。旧实现里「全部分支更改」只是
         git diff HEAD（和未暂存同类，分支已提交改动看不到）⇒ 这里用临时仓库真跑：
         分支上提交一次 + 工作区再改一次，head 必须同时看到两段，unstaged 只能看到后一段。 */
      const repo = join(h.userDataDir ?? join(ROOT, ".e2e-profile", "main"), "git-review-acceptance");
      const gitBin = process.platform === "win32" ? join(ROOT, "resources", "tools", "git", "cmd", "git.exe") : join(ROOT, "resources", "tools", "git", "bin", "git");
      const git = (list) => execFileSync(existsSync(gitBin) ? gitBin : "git", list, {
        cwd: repo,
        env: { ...process.env, GIT_AUTHOR_NAME: "Acceptance", GIT_AUTHOR_EMAIL: "acceptance@example.com", GIT_COMMITTER_NAME: "Acceptance", GIT_COMMITTER_EMAIL: "acceptance@example.com" },
        encoding: "utf8",
        windowsHide: true,
      });
      try {
        rmSync(repo, { recursive: true, force: true });
        mkdirSync(repo, { recursive: true });
        try { git(["init", "-b", "main"]); } catch { git(["init"]); git(["checkout", "-b", "main"]); }
        writeFileSync(join(repo, "base.txt"), "one\n");
        git(["add", "base.txt"]);
        git(["commit", "-m", "base"]);
        git(["checkout", "-b", "feature"]);
        writeFileSync(join(repo, "base.txt"), "one\ntwo\n");
        git(["add", "base.txt"]);
        git(["commit", "-m", "feature"]);
        writeFileSync(join(repo, "base.txt"), "one\ntwo\nthree\n");
        const call = async (scope) => h.eval(`window.codex.gitDiff(${JSON.stringify(repo)}, ${JSON.stringify(scope)})`).catch((error) => ({ error: String(error?.message ?? error) }));
        const head = await call("head");
        h.check("① 全部分支更改 = 分支起点 diff（含分支已提交 + 工作区）",
          head?.code === 0 && /\+two/.test(String(head?.output ?? "")) && /\+three/.test(String(head?.output ?? "")),
          JSON.stringify({ code: head?.code, error: head?.error, sample: String(head?.output ?? "").slice(0, 120) }));
        const unstaged = await call("unstaged");
        h.check("② 未暂存 = 只含工作区未 add 的改动（不含分支已提交的 +two）",
          unstaged?.code === 0 && /\+three/.test(String(unstaged?.output ?? "")) && !/\+two/.test(String(unstaged?.output ?? "")),
          JSON.stringify({ code: unstaged?.code, sample: String(unstaged?.output ?? "").slice(0, 120) }));
        git(["add", "base.txt"]);
        const staged = await call("staged");
        const afterStage = await call("unstaged");
        h.check("③ 已暂存 = 只含暂存区改动；未暂存随之为空",
          staged?.code === 0 && /\+three/.test(String(staged?.output ?? "")) && !/\+three/.test(String(afterStage?.output ?? "")),
          JSON.stringify({ staged: String(staged?.output ?? "").slice(0, 80), unstaged: String(afterStage?.output ?? "").slice(0, 80) }));
        await h.eval(`(function(){ if(!document.querySelector('.context-panel')) document.querySelector('.tb-right-panel')?.click(); return 1; })()`);
        await wait(500);
        await h.eval(`(function(){ const b=[...document.querySelectorAll('.panel-tab')].find((x)=>(x.textContent||'').includes('变更')); b?.click(); return 1; })()`);
        await wait(500);
        await h.eval(`document.querySelector('.scope-btn')?.click()`);
        const menu = await h.eval(`(function(){ return [...document.querySelectorAll('.scope-menu button')].map((b)=>(b.textContent||'').trim()); })()`);
        h.check("④ 下拉四个范围真实存在（未暂存 / 已暂存 / 全部分支更改 / 上一轮更改）",
          ["未暂存", "已暂存", "全部分支更改", "上一轮更改"].every((label) => menu.includes(label)), JSON.stringify(menu));
        const missingUi = await h.eval(`!!document.querySelector('.git-missing')`);
        const installBtn = await h.eval(`!!document.querySelector('.git-missing .primary-setting')`);
        h.check("⑤ 当前工作区 Git 可用；若缺 Git 则必须有一键安装按钮", missingUi === false || installBtn === true, JSON.stringify({ missingUi, installBtn }));
        await h.eval(`(function(){ const b=[...document.querySelectorAll('.scope-menu button')].find((x)=>(x.textContent||'').trim()==='全部分支更改'); b?.click(); return 1; })()`);
        await wait(700);
        const branchLabel = await h.eval(`(document.querySelector('.scope-btn')?.textContent||'').trim()`);
        h.check("⑥ 切到「全部分支更改」不报缺 Git / 不空白", branchLabel.includes("全部分支更改"), branchLabel);
        await h.eval(`document.querySelector('.scope-btn')?.click()`);
        await h.eval(`(function(){ const b=[...document.querySelectorAll('.scope-menu button')].find((x)=>(x.textContent||'').trim()==='上一轮更改'); b?.click(); return 1; })()`);
        await wait(500);
        h.check("⑦ 切到「上一轮更改」可用（真实回合 diff，不崩溃）", (await h.eval(`(document.querySelector('.scope-btn')?.textContent||'').includes('上一轮更改')`)) === true, "");
      } finally {
        try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  },
  {
    id: "compact-line",
    name: "㉗ 压缩线：真压缩 → 宿主侦测 → 压缩线出现（10-07 轮）",
    run: async (h) => {
      /* 为什么真跑（10-07 用户：「压缩线会常驻显示嘛…压缩完，自动继续会话」）：
         当前引擎对压缩**不发 item 事件**（压缩 item 只落 rollout）⇒ 「rollout 对账 → 落盘 →
         广播 → 渲染层画线」整条宿主侦测链都是运行期行为，tsc 与静态守卫全看不见。
         这里用「新建会话 + 两条短回合 + 手动 thread/compact/start」走**真链路**（小上下文 =
         秒级、低成本；自动压缩（阈值触发）由探针与守卫覆盖，手动压缩走的是同一条侦测链）。 */
      /* ① 新建任务（避开历史会话的状态耦合；也保证 thread 有新 id 可追） */
      const clicked = await h.eval(`(function(){ const b=[...document.querySelectorAll('.sidebar-tab')].find((x)=>(x.textContent||'').includes('新建任务')); if(!b) return 0; b.click(); return 1; })()`);
      h.check("① 点到「新建任务」（前置；点不到则整项作废）", clicked === 1, `clicked=${clicked}`);
      if (clicked !== 1) return;
      await wait(1500);
      const sendMsg = async (text) => {
        await h.eval(`(function(){ const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(text)}); const el = document.querySelector('.composer-editor'); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 1; })()`);
        await wait(600);
        await h.pressKey("Enter", { text: "\r" });
      };
      const waitTurnIdle = async (timeoutMs) => {
        let ran = false;
        for (let i = 0; i < timeoutMs / 1000; i++) {
          const busy = await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false);
          if (busy) ran = true;
          if (ran && !busy) return true;
          await wait(1000);
        }
        return false;
      };
      /* ② 两条短回合：给压缩一点可总结的内容（引擎对"完全空"的会话可能不产出压缩 item） */
      await sendMsg("请只回复：收到一。不要调用任何工具。");
      const d1 = await waitTurnIdle(120000);
      await sendMsg("请只回复：收到二。不要调用任何工具。");
      const d2 = await waitTurnIdle(120000);
      h.check("② 新会话两条短回合都跑完（前置条件）", d1 === true && d2 === true, `d1=${d1} d2=${d2}`);
      if (!(d1 && d2)) return;
      /* ③ 取当前会话 id（真正的 id 从侧栏活动行读 —— 不猜） */
      const tid = await h.eval(`(function(){ const row = document.querySelector('.thread-row.active'); return row ? row.getAttribute('data-thread-id') : null; })()`);
      h.check("③ 读到活动会话 id（前置条件）", typeof tid === "string" && tid.length > 10, `tid=${tid}`);
      if (typeof tid !== "string" || tid.length < 10) return;
      /* ④ 手动压缩（与渲染层「压缩」按钮同一个引擎 RPC；手动压缩的回合不经 turn/start，
         正是宿主侦测链的判据之一） */
      await h.eval(`window.codex.request("thread/compact/start", { threadId: ${JSON.stringify(tid)} }).catch(() => undefined)`);
      /* ⑤ 压缩线出现（宿主侦测 → 落盘 → 广播 → 渲染层）。小上下文秒级；上限 120s 防慢机。 */
      /* ⛔ 10-18：10-17 的四态模型会先渲染一条**运行中**分隔线（带「停止」按钮）——
         这里要等的是**已完成**那条，否则运行线抢先命中、④ 必然假红（实测）。 */
      let line = null;
      for (let i = 0; i < 120; i++) {
        await wait(1000);
        line = await h.eval(`(function(){
          const d = [...document.querySelectorAll('.compact-divider')].find(function(el){ return /--(settled|success)/.test(el.className) && el.className.indexOf('--running') < 0; }) || null;
          if (!d) return null;
          const msgs = [...document.querySelectorAll('.message.user-message')];
          return { cls: d.className, text: (d.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 60),
            aboveLastUser: msgs.length ? d.getBoundingClientRect().top <= msgs[msgs.length-1].getBoundingClientRect().top : null,
            belowLastUser: msgs.length ? d.getBoundingClientRect().top >= msgs[msgs.length-1].getBoundingClientRect().bottom - 2 : null,
            inViewport: d.getBoundingClientRect().top >= -2 && d.getBoundingClientRect().bottom <= window.innerHeight + 2,
            userMsgs: msgs.length };
        })()`).catch(() => null);
        if (line) break;
      }
      h.check("④ 压缩线出现（宿主侦测链路真跑：rollout 对账 → 落盘 → 广播 → 渲染）",
        !!line && /--(settled|success)/.test(String(line.cls)) && line.text.includes("压缩"),
        JSON.stringify(line).slice(0, 200));
      if (!line) return;
      /* ⑥ 锚点：线在用户消息**上方**（压缩线跟着历史往上走 —— 用户点名的一条） */
      /* ⛔ 10-18 二改（用户：「我刚刚压缩的，压缩完成就不见了」）：手动压缩跑成空回合、被「空推进回合整组不渲染」
         过滤掉 ⇒ 锚点按压缩时间落在最后一个「先于压缩」的回合之后 = **最后一条消息之后**（压缩发生处）。 */
      h.check("⑤ 压缩线落在**压缩发生处**：最后一条消息之后、且在视口内（不是被扔到视口外的窗口顶部）",
        line.belowLastUser === true && line.inViewport === true && line.userMsgs >= 2,
        JSON.stringify({ belowLastUser: line.belowLastUser, inViewport: line.inViewport, userMsgs: line.userMsgs }));

      /* ⑥b 用户 10-18：「每次发新消息他都在上面，没有跟着历史消息往上顶」。
         判据：压完再发一条消息，线必须仍在**这条新消息之上**（线是历史项，不跟着新消息往下跑）。 */
      const lineTopNow = () => h.eval(`(function(){
        var d=[...document.querySelectorAll('.compact-divider')].find(function(el){ return /--(settled|success)/.test(el.className) && el.className.indexOf('--running') < 0; });
        return d ? Math.round(d.getBoundingClientRect().top) : null; })()`);
      const lineTopBefore = await lineTopNow();
      await sendMsg("请只回复：收到三。不要调用任何工具。");
      const d3 = await waitTurnIdle(120000);
      await wait(800);
      const lineTopAfter = await lineTopNow();
      const newestMsgTop = await h.eval(`(function(){ var m=[...document.querySelectorAll('.message.user-message')].pop(); return m ? Math.round(m.getBoundingClientRect().top) : null; })()`);
      h.check("⑥b 新消息到来后压缩线**不跟着往下跑**（线仍在新消息之上）",
        typeof lineTopBefore === "number" && d3 === true && typeof lineTopAfter === "number" && typeof newestMsgTop === "number" && lineTopAfter < newestMsgTop - 2,
        JSON.stringify({ lineTopBefore, lineTopAfter, newestMsgTop, d3 }));
      /* ⑦c 刻度尺绿段（用户 10-18：「刻度线里面如那两个中间产生压缩线，就在那两个中间产生一个绿色线」）。
         前置 = 刻度尺可见（内容够高才会渲染）；手动压缩是「末尾情形」⇒ 绿段在最后一个刻度之后。 */
      const rulerMark = await h.eval(`(function(){
        var ruler=document.querySelector('.message-ruler'); if(!ruler) return { visible:false };
        var seg=ruler.querySelector('.ruler-compaction');
        var ticks=[...ruler.querySelectorAll('.ruler-tick')];
        var last=ticks[ticks.length-1];
        return { visible:true, hasSegment:!!seg, afterLastTick: !!(seg && last && last.nextElementSibling === seg),
          color: seg ? getComputedStyle(seg).backgroundColor : null, ticks:ticks.length }; })()`);
      h.check("⑦c 刻度尺上画出压缩绿段（手动压缩 = 末尾情形 ⇒ 绿段在最后一个刻度之后）",
        rulerMark?.visible !== true ? true : (rulerMark?.hasSegment === true && rulerMark?.afterLastTick === true),
        JSON.stringify(rulerMark));
      /* ⑦ 落盘：重启/切会话重播的真相源（presist 在广播之前，线出现即可读） */
      const storeFile = join(h.userDataDir ?? join(ROOT, ".e2e-profile", "main"), "compaction-records", `${tid}.json`);
      let stored = null;
      try { stored = JSON.parse(readFileSync(storeFile, "utf8")); } catch { /* 缺失下面报 */ }
      h.check("⑥ 侦测记录落盘（userData/compaction-records/<threadId>.json —— 重启后 resume 重播的真相源）",
        !!stored && Array.isArray(stored.records) && stored.records.length >= 1 && typeof stored.records[stored.records.length - 1].turnId === "string",
        existsSync(storeFile) ? JSON.stringify(stored).slice(0, 160) : `缺失：${storeFile}`);
      await h.screenshot("compact-line");
    },
  },
  {
    id: "free-gateway",
    name: "㉙ 免费模型网关：推荐卡在场+免责声明+真链路下载/启动/模型清单（10-12 轮）",
    run: async (h) => {
      /* 为什么真跑（10-12 用户立项）：侧车是第三方开源项目，下载/启动/取 Key/模型清单全是运行期行为；
         下载约 12MB（幂等：已下载秒回），启动起真进程等 /health。注册供应商需要模型清单非空
         （未登录渠道也可能有匿名免费模型），注册成功与否依赖上游，这里验到「清单通道真通」为止。 */
      await h.waitFor(`!document.querySelector(".boot-splash")`, { label: "启动页已摘", timeoutMs: 60000 }).catch(() => undefined);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.icon-button, [title*="设置"]')].find(function(x){ return (x.getAttribute('aria-label')||x.title||'').includes('设置'); }); b&&b.click(); return 1; })()`);
      await wait(600);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.settings-nav button')].find(function(x){ return (x.textContent||'').trim()==='模型'; }); b&&b.click(); return 1; })()`);
      /* ⛔ 模型页是 lazy chunk，700ms 后可能还没挂载（10-12 连续两轮 null 假红实测）——waitFor 推荐卡真出现 */
      await h.waitFor(`!!document.querySelector('.free-gateway-entry')`, { label: "免费模型网关推荐卡出现", timeoutMs: 15000 }).catch(() => undefined);
      await wait(300);
      const card = await h.eval(`(function(){ var c=document.querySelector('.free-gateway-entry'); return c ? { present: true, disclaimer: (c.textContent||'').includes('与本项目开发者无关') } : null; })()`);
      h.check("① 推荐卡在场且带免责声明（与本项目开发者无关）", !!card && card.present === true && card.disclaimer === true, JSON.stringify(card));
      if (!card) return;
      const st0 = await h.eval(`window.codex.freeGatewayStatus().then(function(r){ return JSON.stringify(r); }, function(e){ return "ERR " + (e.message || e); })`);
      h.check("② 状态通道真通（downloaded/running 字段在）", typeof st0 === "string" && st0.includes("downloaded"), String(st0).slice(0, 160));
      /* ⛔ 下载同启动：不在 CDP eval 里 await（首下 12MB 慢网络可超 20s）——触发后轮询 downloaded。 */
      const dlKick = await h.eval(`(function(){ try { window.codex.freeGatewayDownload(); return "kicked"; } catch (e) { return "ERR " + (e.message || e); } })()`);
      h.check("③ 下载已触发（幂等短路：已下载秒回）", dlKick === "kicked", String(dlKick));
      if (dlKick !== "kicked") return;
      let downloaded = false;
      for (let i = 0; i < 120; i++) {
        await wait(1000);
        const st = await h.eval(`window.codex.freeGatewayStatus().then(function(r){ return JSON.stringify({ downloaded: r.downloaded, stage: r.stage }); }).catch(function(){ return "{}"; })`).catch(() => "{}");
        if (String(st).includes("\"downloaded\":true")) { downloaded = true; break; }
      }
      h.check("④ 本体下载完成（gh 镜像真链路）", downloaded, "120s 内未完成则上游通道全挂");
      if (!downloaded) return;
      /* ⛔ 不在 CDP eval 里 await 启动（冷启动可超 20s，Runtime.evaluate 会超时）——
         触发后轮询状态，等 /health 就绪。 */
      const kick = await h.eval(`(function(){ try { window.codex.freeGatewayStart(); return "kicked"; } catch (e) { return "ERR " + (e.message || e); } })()`);
      h.check("⑤ 启动已触发（幂等：已有健康实例则直接复用）", kick === "kicked", String(kick));
      if (kick !== "kicked") return;
      let running = false, stRunning = "";
      for (let i = 0; i < 75; i++) {
        await wait(1000);
        stRunning = await h.eval(`window.codex.freeGatewayStatus().then(function(r){ return JSON.stringify({ running: r.running, port: r.port }); }).catch(function(){ return "{}"; })`).catch(() => "{}");
        if (String(stRunning).includes("\"running\":true")) { running = true; break; }
      }
      h.check("⑥ 网关运行中（真进程 /health 就绪 + 端口在）", running, String(stRunning).slice(0, 160));
      if (!running) return;
      const models = await h.eval(`window.codex.freeGatewayModels().then(function(r){ return JSON.stringify(r); }, function(e){ return "ERR " + (e.message || e); })`);
      h.check("⑦ 模型清单通道真通（返回数组；是否非空取决于上游渠道）", typeof models === "string" && models.includes("models"), String(models).slice(0, 200));
      await h.eval(`window.codex.freeGatewayStop().catch(function(){ return 1; })`);
      await h.screenshot("free-gateway");
    },
  },
  {
    id: "web-sources",
    name: "㉙' 汇总卡右下角「网页来源」：favicon 圆标 ≤3 + 「···」全量弹层 + 默认浏览器打开（10-12 轮）",
    run: async (h) => {
      /* 为什么真跑：来源条的数据来自**回合 items 的真实工具调用**（commandExecution 命令里的 URL），
         注入造不出引擎事件 —— 与 file-summary 同口径，用真回合真 curl。断言打最后一条来源条
         （会话里可能有旧回合的条，querySelector 全局首个会打错回合 —— 10-06 悬停假红同款坑）。 */
      await h.waitFor(`!!document.querySelector('.composer-editor')`, { label: "输入框就绪", timeoutMs: 30000 }).catch(() => undefined);
      /* ① 新会话 + 发一条含 4 个 URL 的真回合（模型逐条 curl ⇒ 4 host ⇒ 3 圆标 + 「···」） */
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.sidebar-tab')].find(function(x){ return (x.textContent||'').includes('新建任务'); }); if(b) b.click(); return 1; })()`);
      await wait(1200);
      const prompt = "请用 shell 依次真的运行这4条 curl 并各用一行汇报返回里的标题：curl -s https://example.com 、curl -s https://www.wikipedia.org 、curl -s https://github.com 、curl -s https://registry.npmmirror.com 。不要做别的事情。";
      await h.eval(`(function(){
        var dt = new DataTransfer();
        dt.setData("text/plain", ${JSON.stringify(prompt)});
        var el = document.querySelector('.composer-editor');
        el.focus();
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        return 1; })()`);
      await wait(500);
      await h.eval(`document.querySelector('.composer-editor').focus()`);
      await h.pressKey("Enter", { text: "\r" });
      let started = false;
      for (let i = 0; i < 20; i++) {
        await wait(750);
        if (await h.eval(`!!document.querySelector('.send-button.is-pause')`).catch(() => false)) { started = true; break; }
      }
      h.check("① 真回合跑起来了（前置：模型未配置则本项作废）", started === true, `started=${started}`);
      if (!started) return;
      /* ② 等来源条满足「3 圆标 + 更多钮」（≤180s：4 条 curl 的真回合）；⛔ 锚最后一条（最新回合） */
      let ready = false;
      for (let i = 0; i < 180; i++) {
        await wait(1000);
        ready = await h.eval(`(function(){
          var rows = document.querySelectorAll('.completed-web-row');
          var row = rows[rows.length - 1];
          if (!row) return false;
          return !!row.querySelector('.web-favicon-more');
        })()`).catch(() => false);
        if (ready) break;
      }
      const rowInfo = await h.eval(`(function(){
        var rows = document.querySelectorAll('.completed-web-row');
        var row = rows[rows.length - 1];
        if (!row) return { row: false };
        return { row: true,
          icons: [...row.querySelectorAll('.web-favicon:not(.web-favicon-more)')].length,
          more: !!row.querySelector('.web-favicon-more'),
          rightAligned: Math.abs(row.getBoundingClientRect().right - document.querySelector('.composer-editor').getBoundingClientRect().right) < 400 };
      })()`).catch(() => ({ row: false }));
      h.check("② 最新回合的来源条出现：3 圆标 + 「···」更多钮（用户定稿口径）",
        ready === true && rowInfo.row === true && rowInfo.icons === 3 && rowInfo.more === true, JSON.stringify(rowInfo));
      if (!rowInfo.more) { await h.screenshot("web-sources"); return; }
      /* ③ 点「···」→ 全量弹层（portal 到 body），条目覆盖全部 4 站；Esc 可关 */
      await h.eval(`(function(){ var rows=document.querySelectorAll('.completed-web-row'); rows[rows.length-1].querySelector('.web-favicon-more').click(); return 1; })()`);
      await wait(600);
      const pop = await h.eval(`(function(){
        var pops = document.body.querySelectorAll(':scope > .completed-web-pop');
        var p = pops[pops.length - 1];
        if (!p) return { pop: false };
        var items = [...p.querySelectorAll('.completed-web-item code')].map(function(c){ return c.textContent; });
        return { pop: true, items: items, visible: p.getBoundingClientRect().width > 100 };
      })()`).catch(() => ({ pop: false }));
      h.check("③ 「···」弹出全量弹层：≥4 条网页条目（hosts 在列）",
        pop.pop === true && pop.visible === true && (pop.items ?? []).length >= 4
          && pop.items.some((x) => /example\.com|wikipedia|github|npmmirror/.test(x ?? "")), JSON.stringify(pop).slice(0, 260));
      await h.pressKey("Escape");
      await wait(400);
      const closed = await h.eval(`document.body.querySelectorAll(':scope > .completed-web-pop').length === 0`).catch(() => false);
      h.check("④ Esc 关闭全量弹层", closed === true, `closed=${closed}`);
      await h.screenshot("web-sources");
    },
  },
  {
    id: "devtools-install-ux",
    name: "㉘ 开发工具安装体验：常驻提示词复制图标 + 失败完整报错弹窗（10-11 轮）",
    run: async (h) => {
      /* 为什么真跑（10-11 用户令）：常驻图标在不在、点了有没有反馈，是运行期才成立的最终态；
         失败弹窗的真触发需要真装失败（不可确定性地复现），其结构与层级顺序由守卫 11y 钉死，
         这里验**用户能走到的部分**：图标常驻在卡上、点击出确认 toast、失败摘要行平时不出现。 */
      /* ① 前置：开设置 → 开发工具 → 打开「运行时与工具链」二级弹窗 */
      await h.waitFor(`!!document.querySelector('.topbar-actions, .task-title')`, { label: "主界面就绪", timeoutMs: 30000 }).catch(() => undefined);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.icon-button, [title*="设置"]')].find(function(x){ return (x.getAttribute('aria-label')||x.title||'').includes('设置'); }); if(b){ b.click(); return 1; } return 0; })()`);
      await wait(600);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.settings-nav button')].find(function(x){ return (x.textContent||'').trim()==='开发工具'; }); if(b){ b.click(); return 1; } return 0; })()`);
      await wait(700);
      const card = await h.eval(`!!document.querySelector('.devtools-card[data-card="runtime"]')`);
      h.check("① 开发工具页打开且「运行时与工具链」卡片在（前置条件）", card === true, `card=${card}`);
      if (card !== true) return;
      await h.eval(`document.querySelector('.devtools-card[data-card="runtime"]').click()`);
      let dialog = null;
      for (let i = 0; i < 10; i++) {
        await wait(300);
        dialog = await h.eval(`!!document.querySelector('.settings-dialog')`);
        if (dialog) break;
      }
      h.check("② 二级弹窗「运行时与工具链」打开（前置条件）", dialog === true, `dialog=${dialog}`);
      if (!dialog) return;
      /* ③ 前置：无失败残留（失败摘要行不该凭空出现）；错误弹窗也不该自动弹出 */
      const pre = await h.eval(`({ failedRows: document.querySelectorAll('.runtime-failed').length, errModal: !!document.querySelector('.devtools-error-backdrop') })`);
      h.check("③ 无失败残留：失败摘要与错误弹窗初始都不出现（前置条件，防上一步状态污染）",
        pre.failedRows === 0 && pre.errModal === false, JSON.stringify(pre));
      /* ④ 常驻图标：可下载工具的卡片上有「复制安装提示词」图标（≥1 个） */
      const icons = await h.eval(`(function(){ var b=[...document.querySelectorAll('.runtime-prompt-copy')]; return { count: b.length, sample: b.length ? (b[0].getAttribute('aria-label')||'') : "" }; })()`);
      h.check("④ 常驻「复制安装提示词」图标在卡上（≥1 个，带可读 aria-label）",
        icons.count >= 1 && icons.sample.length > 0, JSON.stringify(icons).slice(0, 160));
      if (icons.count < 1) return;
      /* ⑤ 点击 → 可见反馈（确认 toast：.notice-text 出现「安装提示词」字样） */
      await h.eval(`document.querySelector('.runtime-prompt-copy').click()`);
      let toast = null;
      for (let i = 0; i < 8; i++) {
        await wait(250);
        toast = await h.eval(`(function(){ var t=[...document.querySelectorAll('.notice-text')].find(function(x){ return (x.textContent||'').includes('安装提示词'); }); return t ? (t.textContent||'').trim().slice(0, 80) : null; })()`);
        if (toast) break;
      }
      h.check("⑤ 点图标有可见反馈：确认 toast 出现（复制成功用户看得见）", typeof toast === "string" && toast.includes("安装提示词"), `toast=${toast}`);
      await h.screenshot("devtools-install-ux");
      /* 每步自收尾：Esc 关掉二级弹窗（错误弹窗未开，不涉及层叠） */
      await h.pressKey("Escape");
      await wait(400);
    },
  },
  {
    id: "boot-intro",
    name: "㉙ 550C 开机动画：外观页设置行 + Shadow DOM 预览 + Esc 跳过（10-12 轮）",
    run: async (h) => {
      /* 为什么真跑：动画活在 **Shadow DOM** 里（样式 / 标记 / 驱动全在影子树），静态守卫看得见源码，
         却看不见"影子树真建起来了、样式真注入了、跳过真生效"。启动那条路径（16 秒片头）在验收时
         早已播完（本套项串行、前面几项要跑分钟级），所以这里验**可确定复现的那条**：外观设置行 →
         预览 → 影子树成形 → Esc 跳过 → 档位落盘。启动首帧与三条不播判据由守卫 20-boot-intro 钉。 */
      await h.waitFor(`!!document.querySelector('.topbar-actions, .task-title')`, { label: "主界面就绪", timeoutMs: 30000 }).catch(() => undefined);
      /* ① 开设置 → 外观 */
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.icon-button, [title*="设置"]')].find(function(x){ return (x.getAttribute('aria-label')||x.title||'').includes('设置'); }); if(b){ b.click(); return 1; } return 0; })()`);
      await wait(600);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.settings-nav button')].find(function(x){ return (x.textContent||'').trim()==='外观'; }); if(b){ b.click(); return 1; } return 0; })()`);
      await wait(700);
      const row = await h.eval(`!!document.querySelector('.boot550c-actions')`);
      h.check("① 外观页「开机动画」行在（前置条件）", row === true, `row=${row}`);
      if (row !== true) { await h.pressKey("Escape"); return; }
      /* ② 档位三选一 + 配色四选一 */
      const groups = await h.eval(`({ modes: document.querySelectorAll('[aria-label="开机动画"] button').length, schemes: document.querySelectorAll('[aria-label="开机动画配色"] button').length })`);
      h.check("② 档位 3 个 + 配色 4 个（用户 10-11 拍板「四套保留、可在设置里切」）",
        groups.modes === 3 && groups.schemes === 4, JSON.stringify(groups));
      /* ③ 切到「完整」：harness 把档位钉成 off ⇒ 预览按钮初始是 disabled（关闭档不播，设计如此）。
         必须先切到可播档，预览才点得动 —— 这一步同时把「关闭档 ⇒ 预览禁用」这条判据验掉。 */
      const beforeDisabled = await h.eval(`document.querySelector('.boot550c-actions .secondary-setting').disabled`);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('[aria-label="开机动画"] button')].find(function(x){ return (x.textContent||'').includes('完整'); }); b && b.click(); })()`);
      await wait(300);
      const afterEnable = await h.eval(`({ mode: localStorage.getItem('boot-intro'), disabled: document.querySelector('.boot550c-actions .secondary-setting').disabled })`);
      h.check("③ 关闭档下预览禁用；切「完整」后启用并落盘（档位是预览的闸）",
        beforeDisabled === true && afterEnable.disabled === false && afterEnable.mode === "full",
        JSON.stringify({ beforeDisabled, ...afterEnable }));
      /* ④ 预览 → 影子树成形（宿主 + #boot + #logo） */
      await h.eval(`(function(){ var b=document.querySelector('.boot550c-actions .secondary-setting'); b && b.click(); })()`);
      let shadow = null;
      for (let i = 0; i < 12; i++) {
        await wait(250);
        shadow = await h.eval(`(function(){ var host=document.querySelector('.boot550c-host'); if(!host||!host.shadowRoot) return null; var r=host.shadowRoot; var b=host.getBoundingClientRect(); return { boot: !!r.querySelector('#boot'), logo: !!r.querySelector('#logo'), styles: r.querySelectorAll('style').length, w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight, parent: host.parentElement === document.body }; })()`);
        if (shadow) break;
      }
      h.check("④ 预览：Shadow DOM 成形（.boot550c-host + 影子树内 #boot 与 #logo）",
        !!shadow && shadow.boot === true && shadow.logo === true, JSON.stringify(shadow));
      /* ④b 铺满视口：宿主必须真的盖住整屏（祖先成为 containing block 时 fixed 会退化、
         只盖住设置内容列 —— 实测截图就是这么暴露的；光验"节点在"抓不到）。 */
      h.check("④b 宿主机铺满视口且挂在 body（containing block 退化的防线）",
        !!shadow && shadow.parent === true && Math.abs(shadow.w - shadow.vw) <= 2 && Math.abs(shadow.h - shadow.vh) <= 2,
        shadow ? `rect=${shadow.w}x${shadow.h} viewport=${shadow.vw}x${shadow.vh} body=${shadow.parent}` : "无");
      /* ④c 驱动真的在跑：挂载只证明"节点在"，描边才证明 550C 驱动真被启动（截图刚挂载那一刻是空黑，
         光看截图会误判"没渲染"）。playBoot 从 250ms 起逐条给 logo 路径补描边（opacity 0.08 → 1）。 */
      await wait(1500);
      const drawn = await h.eval(`(function(){ var host=document.querySelector('.boot550c-host'); if(!host||!host.shadowRoot) return null; var ps=host.shadowRoot.querySelectorAll('#logo path'); var n=0; ps.forEach(function(p){ if (parseFloat(getComputedStyle(p).opacity) > 0.5) n++; }); return { total: ps.length, drawn: n }; })()`);
      h.check("④c 驱动已在描边 logo（opacity>0.5 的路径 ≥1 ⇒ 动画真在跑，不是一块静止黑）",
        !!drawn && drawn.drawn >= 1, JSON.stringify(drawn));
      h.check("⑤ 影子树里注入了样式（移植 CSS + 增强层 ≥2 个 style 元素）",
        !!shadow && shadow.styles >= 2, `styles=${shadow ? shadow.styles : null}`);
      await h.screenshot("boot-intro");
      /* ⑥ Esc 跳过 ⇒ 预览关闭（宿主从 DOM 移除）。⛔ 前置必须是"刚才真的在播" —— 否则
         `!querySelector(...)` 在"从没出现过"时也成立 = 假绿（本轮首跑就踩了这条）。 */
      if (shadow) {
        await h.pressKey("Escape");
        let gone = false;
        for (let i = 0; i < 12; i++) {
          await wait(250);
          gone = (await h.eval(`!document.querySelector('.boot550c-host')`)) === true;
          if (gone) break;
        }
        h.check("⑥ Esc 跳过 ⇒ 预览关闭（宿主从 DOM 移除，不会一直盖着界面）", gone === true, `gone=${gone}`);
      } else {
        h.check("⑥ Esc 跳过 ⇒ 预览关闭（宿主从 DOM 移除，不会一直盖着界面）", false, "前置未成立：预览从未成形 ⇒ 无法判跳过");
      }
      /* 自收尾：切回「关闭」（harness 每次启动也注入 off，保持 profile 一致）；关掉设置页 */
      await h.eval(`(function(){ var b=[...document.querySelectorAll('[aria-label="开机动画"] button')].find(function(x){ return (x.textContent||'').includes('关闭'); }); b && b.click(); })()`);
      await wait(300);
      await h.pressKey("Escape");
      await wait(400);
    },
  },
  {
    id: "message-feedback",
    name: "㉒ 消息操作图标（用户消息复制贴右端 + 两段成功反馈，10-05 轮）",
    run: async (h) => {
      // 为什么真跑：这三件事全是"改坏了不会报错、只会悄悄变难看"的类型 ——
      // 顺序靠 flex 排、动画靠属性选择器命中 DOM，tsc 与静态守卫都看不见最终像素。
      /* （10-07：首启「环境体检」弹窗已整体删除 —— 以前它异步弹出来盖住时间线、拖选会选到
         弹窗里的字（`.env-check-row`）；现在启动后不再有任何引导浮层，这段前置清理随之撤掉。） */
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
      await h.screenshot("message-feedback");
    },
  },
  {
    id: "md-block-copy",
    name: "㉚ 块级复制（表格 + 代码块）：常驻可见 + 两段反馈 + 剪贴板真拿到 TSV/代码原文（10-14 轮 · 用户截图：上面那块是代码块、下面那块是表格）",
    run: async (h) => {
      /* 为什么真跑：这是"悬停才显形 + 点了变对勾再淡回"的纯交互，静态守卫只能证明选择器写了；
         它看不见三件事 —— ① CSS `:hover` 对**合成事件**不响应（必须真移动鼠标）；
         ② 两段动画的选择器漏掉这颗按钮（变色有、弹动无）；③ 复制出去的到底是不是一张表。
         ⛔ 剪贴板**只能从系统剪贴板读回来**：`navigator.clipboard.readText()` 被本应用的权限处理器挡着
           （只放行 media），`window.codex` 是 contextBridge 冻结对象 ⇒ 打不了 spy。
           这里用**真 Ctrl+V** 把剪贴板粘进输入框再比对 —— 走的正是用户那条路。
         ⛔ 表格来源选**文件预览**（右栏项目树 → 点开一个含表格的 .md）而不是让模型现写一张：
           模型回表格要几十秒且不保证照做（10-14 实测两次都没等到），而**渲染组件是同一份**
           （`MD_COMPONENTS.table` 同时供正文 / 文件预览 / 复审报告），交互链路完全一致。
         ⛔ 期望值**不硬编码文档内容**（文档会改）：改成拿 DOM 里的行列形状去对剪贴板文本的形状。 */
      await h.waitFor(`!!document.querySelector(".app-shell")`, { label: "主界面", timeoutMs: 40000 }).catch(() => undefined);
      await wait(2000);
      // 右栏默认可能收起；展开后切到「项目树」
      await h.eval(`(function(){ var b=document.querySelector('.tb-right-panel'); if (b && !document.querySelector('.context-panel')) b.click(); return 1; })()`);
      await wait(700);
      const tabOk = await h.eval(`(function(){ var b=[...document.querySelectorAll('.panel-tab')].find(function(x){ return (x.title||'')==='项目树'; }); if(!b) return false; b.click(); return true; })()`);
      let treeRows = 0;
      for (let i = 0; i < 20; i++) {
        await wait(400);
        treeRows = Number(await h.eval(`document.querySelectorAll('[data-tree-path]').length`)) || 0;
        if (treeRows > 0) break;
      }
      h.check("① 前置：右栏「项目树」可用（这趟链路从这里点开一个含表格的 .md）", tabOk === true && treeRows > 0, JSON.stringify({ tabOk, treeRows }));
      if (tabOk !== true || treeRows === 0) return;
      // 优先 AGENTS.md（仓库根、必含表格）；找不到就随便挑一个 .md
      const opened = await h.eval(`(function(){
        var all=[...document.querySelectorAll('[data-tree-path]')];
        var pick=all.find(function(x){ return /AGENTS\\.md$/i.test(x.getAttribute('data-tree-path')||''); })
          || all.find(function(x){ return /\\.md$/i.test(x.getAttribute('data-tree-path')||''); });
        if(!pick) return null; var p=pick.getAttribute('data-tree-path'); pick.click(); return p; })()`);
      let preview = null;
      for (let i = 0; i < 24; i++) {
        await wait(500);
        preview = await h.eval(`(function(){
          var root=document.querySelector('.file-preview-markdown');
          var tables=root ? root.querySelectorAll('table').length : 0;
          var wraps=root ? root.querySelectorAll('.md-table-wrap').length : 0;
          return { root: !!root, tables: tables, wraps: wraps, buttons: root ? root.querySelectorAll('.md-table-copy').length : 0 }; })()`);
        if (preview && preview.tables > 0) break;
      }
      h.check("② 前置：预览里渲染出表格，且**每张表都带** .md-table-wrap + 复制按钮（漏一张就是没接住）",
        !!preview && preview.tables > 0 && preview.wraps === preview.tables && preview.buttons === preview.tables,
        JSON.stringify({ file: opened, ...preview }));
      if (!preview || preview.tables === 0) return;

      await h.moveMouseAway().catch(() => undefined);
      await wait(400);
      const idle = await h.eval(`(function(){
        var w=document.querySelector('.file-preview-markdown .md-table-wrap');
        var b=w && w.querySelector('.md-table-copy'); if(!b) return { found:false };
        var cs=getComputedStyle(b), wr=w.getBoundingClientRect(), br=b.getBoundingClientRect();
        // 底色必须**不透明**（rgba(...,0) 会漏出表头文字 = 压在字上看不清）
        var solid = !!cs.backgroundColor && !/rgba\\(.*,\\s*0\\)$/.test(cs.backgroundColor);
        return { found:true, opacity:cs.opacity, pe:cs.pointerEvents, position:cs.position, color:cs.color,
          bg:cs.backgroundColor, solid:solid, border:cs.borderTopWidth, shadow:cs.boxShadow,
          dRight:Math.round(wr.right-br.right), dTop:Math.round(br.top-wr.top) }; })()`);
      h.check("③ 常驻可见且醒目（用户 10-14：「旧消息我没看见」⇒ 不许 hover 才显形）：不 hover 也在，可点、右上角 ≤10px、不透明底色 + 边框 + 阴影",
        idle?.found === true && idle.position === "absolute" && Math.abs(idle.dRight) <= 10 && Math.abs(idle.dTop) <= 10
          && Number(idle.opacity) === 1 && idle.pe === "auto" && idle.solid === true
          && parseFloat(idle.border) >= 1 && String(idle.shadow) !== "none",
        JSON.stringify(idle));

      // ⛔ 悬停必须悬到**按钮自己**身上：悬到容器中心时 `:hover` 只命中容器，
      //   按钮自己的 `:hover` 规则不生效（10-14 实测：读到前后配色一模一样）。
      await h.hover(".file-preview-markdown .md-table-copy").catch(() => undefined);
      await wait(500);
      const hovered = await h.eval(`(function(){
        var w=document.querySelector('.file-preview-markdown .md-table-wrap'); var b=w && w.querySelector('.md-table-copy');
        if(!b) return { found:false };
        var prev=b.style.transition; b.style.transition='none'; var cs=getComputedStyle(b); b.style.transition=prev;
        return { found:true, opacity:cs.opacity, color:cs.color, bg:cs.backgroundColor }; })()`);
      h.check("④ 悬停是「配色加重」而不是显隐开关：hover 时颜色/底色变化、但始终可见可点",
        hovered?.found === true && Number(hovered.opacity) === 1
          && (String(hovered.color) !== String(idle?.color) || String(hovered.bg) !== String(idle?.bg)),
        JSON.stringify({ idle: { color: idle?.color, bg: idle?.bg }, hovered }).slice(0, 240));

      // 记下这张表的行列形状（一会儿对剪贴板文本的形状）
      const shape = await h.eval(`(function(){
        var t=document.querySelector('.file-preview-markdown table');
        var rows=[...t.rows].map(function(r){ return [...r.cells].map(function(c){ return String(c.textContent||'').replace(/\\s+/g,' ').trim(); }); });
        return { rows: rows.length, cellsPerRow: rows.map(function(r){ return r.length; }), head: rows[0] }; })()`);
      const click = await h.eval(`(function(){
        var w=document.querySelector('.file-preview-markdown .md-table-wrap'); var b=w && w.querySelector('.md-table-copy');
        if(!b) return { found:false }; window.__mdCopyBtn=b; b.click(); return { found:true }; })()`);
      let done = null, seen = null;
      for (let poll = 0; poll < 8 && !done; poll++) {
        const read = await h.eval(`(function(){ var b=window.__mdCopyBtn; if(!b) return { missing:true };
          var prev=b.style.transition; b.style.transition='none'; var cs=getComputedStyle(b); b.style.transition=prev;
          var s={ phase:b.getAttribute('data-phase'), title:b.title, anim:cs.animationName, opacity:cs.opacity,
            hasCheck:!!b.querySelector('svg.lucide-check') };
          if (s.phase==='done' && s.hasCheck && Number(s.opacity)>0.9) return { settled:s }; return { seen:s }; })()`);
        if (read?.settled) done = read.settled;
        else if (read?.seen) seen = read.seen;
        await wait(110);
      }
      h.check("⑤ 第一段反馈：换成对勾 + 弹动动画真命中（`[data-phase=done]` 的选择器必须带上这颗按钮）",
        click?.found === true && done?.phase === "done" && done?.anim === "message-action-pop" && done?.hasCheck === true,
        JSON.stringify({ done, seen }).slice(0, 220));

      // 剪贴板内容：真 Ctrl+V 粘进一个**测试自己的 textarea** 再读回，按形状比对（不硬编码文档内容）。
      // ⛔ 不能粘进输入框：应用的粘贴处理会把 >200 字的文本存成 .txt 附件（这张表 393 字），
      //   粘出来的是附件 chip 而不是文本（10-14 实测踩到）。textarea 不经过那条逻辑。
      await h.eval(`(function(){ var old=document.getElementById('__clipProbe'); if(old) old.remove();
        var ta=document.createElement('textarea'); ta.id='__clipProbe';
        ta.style.cssText='position:fixed;left:8px;top:8px;width:320px;height:80px;z-index:99999';
        document.body.appendChild(ta); ta.focus(); return 1; })()`);
      await h._send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
      await h._send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
      await wait(600);
      const pasted = await h.eval(`(function(){ var ta=document.getElementById('__clipProbe'); var v=ta?String(ta.value||''):''; if(ta) ta.remove(); return v; })()`);
      const lines = String(pasted).split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
      const shapeOk = lines.length === shape?.rows
        && lines.every((line, i) => line.split("\t").length === shape.cellsPerRow[i])
        && !/\|/.test(String(pasted))
        && String(lines[0] ?? "").split("\t")[0] === String(shape?.head?.[0] ?? "");
      h.check("⑥ 系统剪贴板里是**整张表的 TSV**（行数/列数与原表一致、首格是表头首格、无 markdown 竖线残留）",
        shapeOk, JSON.stringify({ gotRows: lines.length, wantRows: shape?.rows, gotFirst: String(lines[0] ?? "").slice(0, 60), wantHead: shape?.head }).slice(0, 260));

      await wait(1400);
      const stage2 = await h.eval(`(function(){ var b=window.__mdCopyBtn; if(!b) return { missing:true };
        var cs=getComputedStyle(b);
        return { phase:b.getAttribute('data-phase'), anim:cs.animationName, title:b.title, hasCopy:!!b.querySelector('svg.lucide-copy') }; })()`);
      h.check("⑦ 第二段回位：1.1 秒后换回复制图标、动画不重播（否则「变回去」会再弹一次）",
        stage2?.phase === "idle" && stage2?.anim === "none" && stage2?.hasCopy === true && /复制表格/.test(String(stage2?.title)),
        JSON.stringify(stage2));
      /* ⑤b-⑤d 代码块（用户 10-14 截图「上面没有，下面有了」—— 上面那块正是围栏代码块）：
         同一个按钮、同一套两段反馈；⛔ 按钮锚在外层 pre 上，所以横向滚动时它不会跟着代码滚走。 */
      const codeInfo = await h.eval(`(function(){
        var wraps=[...document.querySelectorAll('.file-preview-markdown .md-code-wrap')];
        if(!wraps.length) return { found:false };
        var w=wraps[0], b=w.querySelector('.md-code-copy'), pre=w.closest('pre');
        if(!b) return { found:true, hasButton:false, total:wraps.length };
        var cs=getComputedStyle(b), br=b.getBoundingClientRect(), pr=pre?pre.getBoundingClientRect():null;
        return { found:true, hasButton:true, total:wraps.length, opacity:cs.opacity, pe:cs.pointerEvents,
          anchorIsPre: !!pre, dRight: pr?Math.round(pr.right-br.right):null, dTop: pr?Math.round(br.top-pr.top):null }; })()`);
      h.check("⑤b 代码块也有复制按钮、常驻可见、且锚在**外层 pre** 的右上角（横向滚动时不会跟着滚走）",
        codeInfo?.found === true && codeInfo.hasButton === true && codeInfo.anchorIsPre === true
          && codeInfo.opacity === "1" && codeInfo.pe === "auto"
          && Math.abs(codeInfo.dRight) <= 14 && Math.abs(codeInfo.dTop) <= 14,
        JSON.stringify(codeInfo));
      const codeClick = await h.eval(`(function(){ var w=document.querySelector('.file-preview-markdown .md-code-wrap'); var b=w && w.querySelector('.md-code-copy');
        if(!b) return {found:false}; window.__mdCodeBtn=b; b.click(); return {found:true}; })()`);
      let codeDone = null, codeSeen = null;
      for (let poll = 0; poll < 8 && !codeDone; poll++) {
        const read = await h.eval(`(function(){ var b=window.__mdCodeBtn; if(!b) return {missing:true};
          var prev=b.style.transition; b.style.transition='none'; var cs=getComputedStyle(b); b.style.transition=prev;
          var s={phase:b.getAttribute('data-phase'), title:b.title, anim:cs.animationName, hasCheck:!!b.querySelector('svg.lucide-check')};
          if (s.phase==='done' && s.hasCheck) return {settled:s}; return {seen:s}; })()`);
        if (read?.settled) codeDone = read.settled;
        else if (read?.seen) codeSeen = read.seen;
        await wait(110);
      }
      h.check("⑤c 代码块那一下同样走两段反馈（对勾 + message-action-pop，标题改「已复制代码」）",
        codeClick?.found === true && codeDone?.phase === "done" && codeDone?.anim === "message-action-pop" && /已复制代码/.test(String(codeDone?.title ?? "")),
        JSON.stringify({ codeDone, codeSeen }).slice(0, 200));
      await h.eval(`(function(){ var old=document.getElementById('__clipProbe'); if(old) old.remove();
        var ta=document.createElement('textarea'); ta.id='__clipProbe';
        ta.style.cssText='position:fixed;left:8px;top:8px;width:320px;height:80px;z-index:99999';
        document.body.appendChild(ta); ta.focus(); return 1; })()`);
      await h._send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] });
      await h._send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2 });
      await wait(600);
      const codeClip = await h.eval(`(function(){ var ta=document.getElementById('__clipProbe'); var v=ta?String(ta.value||''):''; if(ta) ta.remove(); return v; })()`);
      const codeDom = await h.eval(`(function(){ var w=document.querySelector('.file-preview-markdown .md-code-wrap');
        var el=w && w.querySelector('.code-highlight'); return el ? String(el.textContent||'') : ''; })()`);
      const codeFirstLine = String(codeClip).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 3) ?? "";
      h.check("⑤d 剪贴板里是**代码原文**（非空，且首行能在渲染出的代码里找到同一段 —— 不是把行号或别的块复制走了）",
        codeFirstLine.length > 3 && String(codeDom).includes(codeFirstLine.slice(0, 20)),
        JSON.stringify({ clipChars: String(codeClip).length, firstLine: codeFirstLine.slice(0, 40) }).slice(0, 200));
      /* ⑤e 每个代码块都要有复制入口（10-15 用户截图：「三块里就中间的没有」—— 中间那块是
         ``` 后**不写语言**的裸围栏，此前与行内 code 一起被提前 return ⇒ 既不高亮也没按钮）。
         ⛔ 这里只断言**入口覆盖率**：AGENTS.md 里全是带语言的围栏，没有裸围栏可测；
         「裸围栏也判成块级」这件事由守卫 12o 的 react-markdown **真跑**覆盖（比在这里等一个
         恰好含裸围栏的文件稳）。 */
      const allBlocks = await h.eval(`(function(){
        var root=document.querySelector('.file-preview-markdown'); if(!root) return { found:false };
        var pres=[...root.querySelectorAll('pre')];
        return { found:true, pres:pres.length,
          withoutWrap:pres.filter(function(p){ return !p.querySelector('.md-code-wrap'); }).length }; })()`);
      h.check("⑤e 渲染出的**每个** pre 都拿到了复制入口（漏一个就是又有块级没接住）",
        allBlocks?.found === true && allBlocks.pres > 0 && allBlocks.withoutWrap === 0,
        JSON.stringify(allBlocks));
      await h.screenshot("md-block-copy");
      // 收尾：关掉预览，别把右栏占着影响后面的项
      await h.pressKey("Escape");
      await wait(400);
    },
  },
  {
    id: "refresh-receipt",
    name: "⑳ 刷新回执：点刷新 ⇒「正在刷新…」⇒ 覆盖「完成 / 失败：原因」（不再是点了没反应）",
    run: async (h) => {
      // 为什么断言这一条（10-16 用户）：「检查一下应用现在有的一些，刷新，现在很多刷新都没有弹窗
      // 反馈刷新状态」—— 清点下来全应用 30 处刷新里 27 处**成功静默**、其中 6 处连失败都静默。
      // 本项真点一次设置页的刷新钮，把通知浮层的变化**序列**录下来：
      // ⛔ 定时轮询会漏掉「正在…」那一帧（它可能只存在几十毫秒）⇒ 用 MutationObserver 录 DOM 变化。
      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await wait(1500);
      const opened = await h.eval(`(function(){
        var b=[...document.querySelectorAll('.settings-nav button')].find(function(x){ return (x.textContent||'').trim()==='MCP'; });
        if (!b) return 0; b.click(); return 1; })()`);
      h.check("① 前置：设置页打开并停在「MCP」页", opened === 1, `opened=${opened}`);
      if (opened !== 1) return;
      await wait(1200);
      const hasBtn = await h.eval(`document.querySelector('button[title="刷新 MCP 状态"]') ? 1 : 0`);
      h.check("② 前置：刷新按钮在位（title=刷新 MCP 状态）", hasBtn === 1, `hasBtn=${hasBtn}`);
      if (hasBtn !== 1) return;
      // 开始录制通知浮层文案（装 observer 在点击之前）
      await h.eval(`(function(){
        window.__receiptSeq = [];
        var grab = function(){
          var t = document.querySelector('.notice-text');
          var s = t ? (t.textContent||'').trim() : '';
          if (!s) return;
          if (window.__receiptSeq[window.__receiptSeq.length-1] !== s) window.__receiptSeq.push(s);
        };
        grab();
        window.__receiptObs = new MutationObserver(grab);
        window.__receiptObs.observe(document.body, { childList: true, subtree: true, characterData: true });
        return 1; })()`);
      await h.eval(`(function(){ document.querySelector('button[title="刷新 MCP 状态"]').click(); return 1; })()`);
      // 刷新走引擎 RPC（逐个连接器查状态）⇒ 终态可能好几秒才到；轮询等它，别用固定 sleep 猜。
      const deadline = Date.now() + 25000;
      let seqNow = [];
      while (Date.now() < deadline) {
        seqNow = await h.eval(`window.__receiptSeq || []`);
        const arr = Array.isArray(seqNow) ? seqNow : [];
        if (arr.some((x) => /^刷新 MCP 状态(完成|失败：)/.test(x))) break;
        await wait(400);
      }
      const rec = await h.eval(`(function(){
        try { window.__receiptObs && window.__receiptObs.disconnect(); } catch (e) {}
        var t = document.querySelector('.notice-text');
        return { seq: window.__receiptSeq || [], now: t ? (t.textContent||'').trim() : '' }; })()`);
      const list = Array.isArray(rec?.seq) ? rec.seq : [];
      const shown = list.join(" → ") || String(rec?.now || "(无)");
      h.check("③ 点刷新弹出回执（成功不再静默 —— 这就是用户报的那个）",
        list.some((x) => x.includes("刷新 MCP 状态")), shown.slice(0, 140));
      h.check("④ 运行中可见：「正在刷新 MCP 状态…」",
        list.includes("正在刷新 MCP 状态…"), shown.slice(0, 140));
      h.check("⑤ 结束态覆盖为终态回执（「完成」或「失败：原因」，不留「正在」挂着）",
        list.some((x) => /^刷新 MCP 状态(完成|失败：)/.test(x)) && !list[list.length - 1].startsWith("正在"),
        shown.slice(0, 140));
      await h.screenshot("刷新回执");
      await h.pressKey("Escape");
      await wait(300);
    },
  },  {
    id: "provider-exclusive",
    name: "㉛ 供应商互斥（正反两向）：关掉当前生效再启用另一个 ⇒ 档案里永远只有一个 enabled，切回也成立（10-15 轮 · 用户报「云端模型启用后豆包没自动停用」）",
    run: async (h) => {
      /* 为什么真跑：`enabled` 有三个写入者（设置页开关 / 保存 / 云端同步），"一次只能一个"的收敛必须
         落在 store 层并**真写盘**才算数。真值表与三条路径的接线由守卫 12q 钉；这里走真界面 + 真文件：
         ① 关掉当前生效供应商 → 档案 0 个 enabled；② 启用另一个 → 恰好 1 个且生效档案跟着切；
         ③ 再关掉它、切回原来那个（反向）→ 仍恰好 1 个。收尾恢复到进来的状态。
         ⛔ 两个实测坑（都踩过）：**关掉当前生效供应商会重启引擎** ⇒ 界面状态晚一拍，
           必须等开关**真的解锁**再点下一次；列表里还有 PPtoken 推荐卡 / 免费网关推荐卡（也是
           `.provider-item` 但**没有** `.provider-dot`）⇒ 断言一律作用到「有 dot 的真实供应商行」。
         ⛔ UI 的置灰只防"同时开两个"的直接点击 ⇒ 反向链路必须走「先关后开」，那正是用户会做的操作。 */
      const readJson = (name) => {
        try { return JSON.parse(readFileSync(join(h.userDataDir, name), "utf8")); } catch { return null; }
      };
      const enabledOf = (list) => (Array.isArray(list) ? list.filter((r) => r && r.enabled !== false).map((r) => r.provider) : []);
      const waitUntil = async (predicate, timeoutMs = 25000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          if (await predicate()) return true;
          await wait(300);
        }
        return false;
      };
      const switchState = (providerName) => h.eval(`(function(){
        var items=[...document.querySelectorAll('.provider-item')].filter(function(el){ return !!el.querySelector('.provider-dot'); });
        var row=items.find(function(el){ var s=el.querySelector('.provider-name-row strong') || el.querySelector('strong'); return s && (s.textContent||'').trim() === ${JSON.stringify(providerName)}; });
        if(!row) return { found:false };
        var input=row.querySelector('.provider-switch input');
        var label=row.querySelector('.provider-switch');
        return { found:true, hasInput:!!input, disabled: input?!!input.disabled:null, checked: input?!!input.checked:null,
          onClass: label? !label.classList.contains('off') : null, dot: !!row.querySelector('.provider-dot.on') }; })()`);
      const clickSwitch = async (providerName) => {
        const before = await switchState(providerName);
        await h.eval(`(function(){
          var items=[...document.querySelectorAll('.provider-item')].filter(function(el){ return !!el.querySelector('.provider-dot'); });
          var row=items.find(function(el){ var s=el.querySelector('.provider-name-row strong') || el.querySelector('strong'); return s && (s.textContent||'').trim() === ${JSON.stringify(providerName)}; });
          var input=row && row.querySelector('.provider-switch input'); if(input) input.click(); return 1; })()`);
        return before;
      };
      const uiCounts = () => h.eval(`(function(){
        var rows=[...document.querySelectorAll('.provider-item')].filter(function(el){ return !!el.querySelector('.provider-dot'); });
        var on=rows.filter(function(el){ var l=el.querySelector('.provider-switch'); return l && !l.classList.contains('off'); });
        return { rows: rows.length, on: on.length,
          onNames: on.map(function(el){ var s=el.querySelector('strong'); return s?(s.textContent||'').trim():''; }),
          dotNames: rows.filter(function(el){ return !!el.querySelector('.provider-dot.on'); }).map(function(el){ var s=el.querySelector('strong'); return s?(s.textContent||'').trim():''; }) }; })()`);

      await h.eval(`(function(){ document.querySelector(".sidebar-settings")?.click(); return 1; })()`);
      await wait(1500);
      await h.eval(`(function(){ var b=[...document.querySelectorAll('.settings-nav button')].find(function(x){ return (x.textContent||'').trim()==='模型'; }); if(b) b.click(); return 1; })()`);
      await wait(1500);

      const list0 = readJson("custom-models.json");
      const rows0 = Array.isArray(list0) ? list0 : [];
      const enabled0 = enabledOf(list0);
      const active0 = readJson("custom-model.json");
      h.check("① 前置：档案可读、≥2 个供应商、当前恰好 1 个启用（本项在这基础上正反各切一次）",
        rows0.length >= 2 && enabled0.length === 1,
        JSON.stringify({ n: rows0.length, enabled: enabled0, active: active0?.provider }));
      if (rows0.length < 2 || enabled0.length !== 1) return;
      const first = rows0.find((r) => r.provider === enabled0[0]);
      const second = rows0.find((r) => r.provider !== enabled0[0]);
      if (!first || !second) return;
      const ui0 = await uiCounts();
      h.check("② 前置：界面里「有 dot 的真实供应商」与档案对得上，且只有一个开关是开的",
        ui0?.rows === rows0.length && ui0?.on === 1 && ui0?.onNames[0] === first.name, JSON.stringify(ui0));
      if (ui0?.rows !== rows0.length || ui0?.on !== 1) return;

      // ③ 关掉当前生效的 A（UI 允许）→ 档案 0 个启用；等界面解锁（关当前会重启引擎，状态晚一拍）
      const beforeOff = await clickSwitch(first.name);
      const zero = await waitUntil(() => enabledOf(readJson("custom-models.json")).length === 0);
      const unlocked = await waitUntil(async () => {
        const s = await switchState(second.name);
        return s?.found === true && s.disabled === false;
      });
      h.check("③ 关掉当前生效供应商 ⇒ 档案 0 个 enabled，且另一个供应商的开关**真的解锁**（否则「先停用再启用」走不通）",
        beforeOff?.found === true && beforeOff?.disabled !== true && zero === true && unlocked === true,
        JSON.stringify({ before: beforeOff, enabled: enabledOf(readJson("custom-models.json")), unlocked }));

      // ④ 启用 B → 恰好 1 个 enabled、生效档案切到 B、界面对上
      const beforeOn = await clickSwitch(second.name);
      const onlyB = await waitUntil(() => {
        const e = enabledOf(readJson("custom-models.json"));
        return e.length === 1 && e[0] === second.provider && readJson("custom-model.json")?.provider === second.provider;
      });
      const uiB = await waitUntil(async () => {
        const c = await uiCounts();
        return c?.on === 1 && c?.onNames[0] === second.name && c?.dotNames[0] === second.name;
      });
      h.check("④ 启用 B ⇒ 档案里**恰好一个** enabled（B）+ 生效档案切到 B + 界面只有一个开、dot 在 B（不再留下第二个绿开关）",
        beforeOn?.disabled !== true && onlyB === true && uiB === true,
        JSON.stringify({ before: beforeOn, enabled: enabledOf(readJson("custom-models.json")), active: readJson("custom-model.json")?.provider, ui: await uiCounts() }));

      // ⑤ 反向：关掉 B、切回 A ⇒ 仍恰好一个（A），收尾即恢复进来时的状态
      await clickSwitch(second.name);
      const zero2 = await waitUntil(() => enabledOf(readJson("custom-models.json")).length === 0);
      const unlocked2 = await waitUntil(async () => {
        const s = await switchState(first.name);
        return s?.found === true && s.disabled === false;
      });
      const backA = await clickSwitch(first.name);
      const onlyA = await waitUntil(() => {
        const e = enabledOf(readJson("custom-models.json"));
        return e.length === 1 && e[0] === first.provider && readJson("custom-model.json")?.provider === first.provider;
      });
      h.check("⑤ 反向链路同样成立：关 B → 开 A ⇒ 恰好一个 enabled（A）+ 生效档案回到 A",
        zero2 === true && unlocked2 === true && backA?.disabled !== true && onlyA === true,
        JSON.stringify({ zero: zero2, unlocked: unlocked2, before: backA, enabled: enabledOf(readJson("custom-models.json")), active: readJson("custom-model.json")?.provider }));
      await h.pressKey("Escape");
      await wait(400);
    },
  },
  {
    id: "scroll-anchor",
    name: "㉛ 上滚续载：视口不跳（同一锚点回合的视口 top 保持 ±4px）",
    run: async (h) => {
      /* 10-19 用户实测「上滚续页会跳到上一页最上面」：单次双 rAF 补偿后，content-visibility
         的真实行高结算会把内容再推一次 ⇒ 改为多帧收敛。这里真跑：滚到 300 → 点「加载更早」→
         同一个 .turn-group 节点的视口 top 必须守住（±4px），且回合数确实变多（非恒真）。 */
      await h.waitFor(`!!document.querySelector(".timeline") && document.querySelectorAll(".thread-row").length > 0`, { label: "主界面", timeoutMs: 40000 }).catch(() => undefined);
      await wait(2000);
      const rows = Number(await h.eval(`document.querySelectorAll(".thread-row").length`)) || 0;
      let opened = false;
      for (let i = 0; i < Math.min(rows, 10) && !opened; i++) {
        await h.eval(`(function(){ var rows=[...document.querySelectorAll(".thread-row")]; rows[${i}] && rows[${i}].click(); return 1; })()`);
        await wait(1600);
        opened = Boolean(await h.eval(`!!document.querySelector(".timeline .load-earlier-turns")`));
      }
      h.check("① 前置：找到一个有「加载更早」按钮的长会话（历史多到需要分页）", opened === true, JSON.stringify({ rows }));
      if (!opened) return;
      await h.eval(`(function(){ var el=document.querySelector(".timeline"); el.scrollTop = 300; return Math.round(el.scrollTop); })()`);
      await wait(300);
      const before = await h.eval(`(function(){
        var el=document.querySelector(".timeline");
        var groups=[...el.querySelectorAll(".turn-group")];
        var anchor=groups.find(function(n){ return n.getBoundingClientRect().bottom > 0; });
        window.__scrollAnchorProbeId = anchor ? anchor.id : "";
        return { id: window.__scrollAnchorProbeId, top: anchor ? Math.round(anchor.getBoundingClientRect().top) : null, groups: groups.length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
      })()`);
      const clicked = await h.eval(`(function(){ var b=document.querySelector(".timeline .load-earlier-turns"); if(!b) return false; b.click(); return true; })()`);
      /* 10-20：模拟真实滚轮 —— 用户滚轮触发续载后通常还会继续滚一段惯性。
         旧补偿会在这里取消，插入高度直接把视图顶走；新补偿按内容坐标增量，不受影响。 */
      await wait(250);
      await h.eval(`(function(){ var el=document.querySelector(".timeline"); el.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,bubbles:true,cancelable:true})); return 1; })()`);
      await wait(150);
      await h.eval(`(function(){ var el=document.querySelector(".timeline"); el.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,bubbles:true,cancelable:true})); return 1; })()`);
      await wait(700);
      const readAfter = () => h.eval(`(function(){
        var el=document.querySelector(".timeline");
        var a=window.__scrollAnchorProbeId ? document.getElementById(window.__scrollAnchorProbeId) : null;
        var inside=!!(a && el.contains(a));
        return { id: window.__scrollAnchorProbeId || null, connected: inside, top: inside ? Math.round(a.getBoundingClientRect().top) : null,
          groups: el.querySelectorAll(".turn-group").length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
      })()`);
      const after = await readAfter();
      h.check("② 续载后同一锚点回合的视口位置保持（±4px）—— 按稳定 turn id 重新解析，允许节点被 React 替换",
        clicked === true && Boolean(before.id) && after.connected === true && before.top != null && after.top != null && Math.abs(after.top - before.top) <= 4,
        JSON.stringify({ before, after, shift: after.top != null && before.top != null ? after.top - before.top : null }));
      h.check("③ 续载确实加载了更早的回合（回合数变多 ⇒ 断言不是恒真）",
        after.groups > before.groups, JSON.stringify({ before: before.groups, after: after.groups }));
      /* 10-20：真实滚轮 + 自动续载路径（先测，趁历史还没被点按钮翻完）。
         用户实际是滚轮滚到近顶自动触发；CDP 真滚轮（不是合成 WheelEvent）滚到 724 →
         真滚 -10；应自动加载、同一锚点视口 top 保持；补偿自身不许触发连环加载。 */
      {
        const rect = await h.eval(`(function(){ var el=document.querySelector(".timeline"); var r=el.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
        const autoBefore = await h.eval(`(function(){
          var el=document.querySelector(".timeline");
          el.scrollTop = 724;
          var groups=[...el.querySelectorAll(".turn-group")];
          var anchor=groups.find(function(n){ return n.getBoundingClientRect().bottom > 0; });
          window.__autoAnchorId = anchor ? anchor.id : "";
          return { id: window.__autoAnchorId, top: anchor ? Math.round(anchor.getBoundingClientRect().top) : null, groups: groups.length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
        })()`);
        await wait(300);
        await h._send("Input.dispatchMouseEvent", { type: "mouseWheel", x: rect.x, y: rect.y, deltaX: 0, deltaY: -10 });
        await wait(2200);
        const autoAfter = await h.eval(`(function(){
          var el=document.querySelector(".timeline");
          var a=window.__autoAnchorId ? document.getElementById(window.__autoAnchorId) : null;
          var inside=!!(a && el.contains(a));
          return { id: window.__autoAnchorId || null, connected: inside, top: inside ? Math.round(a.getBoundingClientRect().top) : null,
            groups: el.querySelectorAll(".turn-group").length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
        })()`);
        h.check("④ 真滚轮自动续载：确实预取了更早回合，且不是无界连环加载",
          autoAfter.groups > autoBefore.groups && autoAfter.groups - autoBefore.groups <= 15,
          JSON.stringify({ before: autoBefore, after: autoAfter, loaded: autoAfter.groups - autoBefore.groups }));
        h.check("⑤ 真滚轮自动续载：同一锚点视口 top 保持 ±30px（真滚轮本身会滚几 px；不允许 343px 级位移）",
          autoAfter.connected === true && autoBefore.top != null && autoAfter.top != null && Math.abs(autoAfter.top - autoBefore.top) <= 30,
          JSON.stringify({ before: autoBefore, after: autoAfter, shift: autoAfter.top != null && autoBefore.top != null ? autoAfter.top - autoBefore.top : null }));
      }

      /* 10-20：再翻一页 —— 前面的自动续载已经滚动过视图，先重新钉住当前视口锚点再点。 */
      const secondBefore = await h.eval(`(function(){
        var el=document.querySelector(".timeline");
        el.scrollTop = 300;
        var groups=[...el.querySelectorAll(".turn-group")];
        var anchor=groups.find(function(n){ return n.getBoundingClientRect().bottom > 0; });
        window.__scrollAnchorProbeId2 = anchor ? anchor.id : "";
        return { id: window.__scrollAnchorProbeId2, top: anchor ? Math.round(anchor.getBoundingClientRect().top) : null, groups: groups.length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
      })()`);
      await wait(300);
      const clicked2 = await h.eval(`(function(){ var b=document.querySelector(".timeline .load-earlier-turns"); if(!b) return false; b.click(); return true; })()`);
      if (clicked2) {
        await wait(250);
        await h.eval(`(function(){ var el=document.querySelector(".timeline"); el.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,bubbles:true,cancelable:true})); return 1; })()`);
        await wait(150);
        await h.eval(`(function(){ var el=document.querySelector(".timeline"); el.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,bubbles:true,cancelable:true})); return 1; })()`);
        await wait(700);
        const after2 = await h.eval(`(function(){
          var el=document.querySelector(".timeline");
          var a=window.__scrollAnchorProbeId2 ? document.getElementById(window.__scrollAnchorProbeId2) : null;
          var inside=!!(a && el.contains(a));
          return { id: window.__scrollAnchorProbeId2 || null, connected: inside, top: inside ? Math.round(a.getBoundingClientRect().top) : null,
            groups: el.querySelectorAll(".turn-group").length, scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight };
        })()`);
        h.check("③b 连续第二页仍按同一 turn id 钉住（±4px）",
          after2.connected === true && secondBefore.top != null && after2.top != null && Math.abs(after2.top - secondBefore.top) <= 4,
          JSON.stringify({ before: secondBefore, after2, shift: after2.top != null && secondBefore.top != null ? after2.top - secondBefore.top : null }));
        h.check("③c 第二页确实又加载了更早回合", after2.groups > secondBefore.groups, JSON.stringify({ first: secondBefore.groups, second: after2.groups }));
      }
      // 收尾：切回最新会话（别把后续项留在旧会话上）
      await h.eval(`(function(){ var rows=[...document.querySelectorAll(".thread-row")]; rows[0] && rows[0].click(); return 1; })()`);
      await wait(600);
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
const LATEST_ROUND = "10-21";   // 10-21 轮：桌面宠物活动气泡（Qoder 式事件驱动）；10-19 的 scroll-anchor 转回归证据
// 上一轮（10-06）的五个验收项仍是回归证据：--only <id> 单跑，或 --all 全量。
/** 每一项属于哪一轮。新增验收项**必须**登记在这里，否则默认轮次里跑不到（会打印警告）。 */
const ROUND_OF = {
  "ui-sketch": "10-06",   // ⛔ 10-06 重写：三形态探针（手机+电脑屏 / platform web 真落盘）+ 预览 + 还原；编号改执行顺序
  "file-summary": "10-06",   // 文件更改汇报卡：运行中行/胶囊 + 收尾卡 + 悬停 diff 预览 + 交互（10-06 两次重写）
  "popup-fits": "10-06",   // ⛔ 10-06 新增：弹窗自适应普查（用户令「凡事弹窗类都要加自适应，不能被裁剪」）
  "composer-resize": "10-06",   // 10-06 夜三轮新增：输入框上下拖动把手（用户对照 Qoder 图二）
  "goal-bar": "10-06",   // 10-06 夜五轮新增：/goal 目标条（用户对照 Qoder：计时 + 编辑/删除/暂停；默认轮最后一项，含真续跑回合）
  "newbie-guide": "10-07",   // 10-07 轮：新手引导（侧栏常驻入口 + 迷你设置弹窗；左选项/右内容/映射跳转/版本日志）
  "laya-judge": "10-18",   // 10-18 轮：Laya 判断工具（装了才暴露；未装拒绝且不自动安装；纯函数真值表由守卫 12s 钉）
  "html-preview": "10-18",   // 10-18 轮：HTML 实时预览（真回合写 HTML → 自动开右栏浏览器 + 加宽 + 文件变更重载）
  "git-review": "10-18",   // 10-18 轮：右栏变更四个范围（临时仓库验证分支起点 + 暂存/未暂存 + UI 下拉）
  "scroll-anchor": "10-19",   // 10-19 轮：上滚续载视口不跳（同一锚点回合的视口 top 保持 ±4px）
  "pet-activity": "10-21",   // 10-21 轮：桌宠活动气泡（running→review 持久 + 独立窗 + 打开清已看 + 拖拽）
  "compact-line": "10-07",   // 10-07 夜十一轮：压缩线（新会话 + 短回合 + 手动压缩 → 宿主侦测真链路 → 线出现 + 落盘）
  "devtools-install-ux": "10-11",   // 10-11 轮：开发工具安装体验（常驻提示词复制图标 + 失败完整报错弹窗；层级顺序由守卫 11y 钉）
  "free-gateway": "10-12",   // 10-12 轮：免费模型网关（第三方开源侧车 + 一键注册供应商；免责声明为契约）   // 10-11 轮：开发工具安装体验（常驻提示词复制图标 + 失败完整报错弹窗；层级顺序由守卫 11y 钉）
  "boot-intro": "10-12",   // 10-12 轮：550C 开机动画（外观页设置行 + Shadow DOM 预览 + Esc 跳过 + 档位落盘；启动首帧与三不播判据由守卫 20-boot-intro 钉）⛔ 必须跟着 LATEST_ROUND 走，否则默认轮跑不到它 = 保护关着
  "web-sources": "10-12",   // 10-12 轮：汇总卡右下角网页来源条（真回合 4 curl → 3 圆标 + 「···」全量弹层；提取真值表由守卫 12g 钉）
  "status-lights": "10-12",   // 10-12 轮：输入框底栏动态状态灯（最多一盏 + 轮换 + 窗口自适应隐藏；结构由守卫 12d 钉）
  "md-block-copy": "10-12",
  "provider-exclusive": "10-12",   // 10-15 加：供应商互斥正反两向（关当前→开另一个→切回；档案里永远只有一个 enabled）   // 10-14 加：块级复制（表格 + 代码块）—— 常驻可见 + 两段反馈 + 剪贴板拿到 TSV/代码原文；结构由守卫 12o 钉
                              // ⛔ 登记在**当前轮**（LATEST_ROUND 仍是 10-12）⇒ 默认轮跑得到它，且不动别人的覆盖
  "refresh-receipt": "10-16",   // 10-16 轮：刷新回执（设置页刷新钮真点一次，MutationObserver 录「正在… → 完成/失败」序列；结构面由守卫 11u ⑤ 逐个登记）
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
