/**
 * 回合网页来源（汇总卡右下角 favicon 条，10-12 立）判据。
 *
 * 失效方式全是有害且静默的：
 *   · 提取面扩大到工具输出 ⇒ npm/cargo 日志里的每个链接都被算成"访问过的网站"（噪音爆炸）；
 *   · 本机地址（127.0.0.1 / localhost）没滤 ⇒ 模型探自己网关的每次调用都进"网页来源"；
 *   · hooks 被挪到 early return 之后 ⇒ 运行中回合 sources 从 0 长出来时 React 直接崩；
 *   · 弹层不 portal 到 body ⇒ 回合卡恒等 transform 把 fixed 降级（10-06 审查弹窗同款事故）。
 * 真实提取逻辑是纯函数 —— 这里直接 import 跑真值表；静态部分钉接线与形态。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";
import { collectTurnWebSources } from "../../src/lib/turn-web-sources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【turn-web】${message}`);
  if (!condition) fails++;
};

/* ── 一、纯函数真值表（node 直接跑真实现）────────────────────────────── */
{
  // ① 三条通道都提取：命令行 / 工具参数 / webSearch
  const turn = {
    items: [
      { type: "commandExecution", command: 'playwright-cli open "https://docs.python.org/3/library/asyncio.html"' },
      { type: "mcpToolCall", server: "nuphus", tool: "browser_open", arguments: { url: "https://github.com/openai/codex" } },
      { type: "webSearch", query: "electron 43 release notes", results: "见 https://www.electronjs.org/blog/electron-43 与其他来源" },
      { type: "agentMessage", text: "https://should-not-count.example.com" }, // 正文不算
      { type: "mcpToolCall", server: "x", tool: "y", arguments: { path: "/tmp/report.md" }, output: "https://output-only.example.com" },
    ],
  };
  const hosts = collectTurnWebSources(turn).map((s) => s.host);
  ok(hosts.includes("docs.python.org") && hosts.includes("github.com") && hosts.includes("www.electronjs.org"),
    "命令行 / 工具参数 / webSearch 结果三条通道都提取");
  ok(!hosts.includes("should-not-count.example.com") && !hosts.includes("output-only.example.com"),
    "⛔ 正文与工具输出不提取（npm/cargo 日志全是噪音链接）；工具参数仍提取");

  // ② host 去重（首次出现序）+ 本机地址过滤 + 尾标点修剪
  const turn2 = {
    items: [
      { type: "commandExecution", command: "curl https://registry.npmmirror.com/a, 然后 curl https://registry.npmmirror.com/b。" },
      { type: "mcpToolCall", tool: "open", arguments: { url: "http://127.0.0.1:18900/v1/models" } },
      { type: "commandExecution", command: "curl http://localhost:3000/health" },
    ],
  };
  const sources2 = collectTurnWebSources(turn2);
  ok(sources2.length === 1 && sources2[0].host === "registry.npmmirror.com" && sources2[0].url === "https://registry.npmmirror.com/a",
    "按 host 去重（保首次 URL）+ 尾标点修剪");
  ok(!sources2.some((s) => /127\.0\.0\.1|localhost/.test(s.host)), "⛔ 本机地址不算网页来源");

  // ③ 空回合 / 缺字段安全
  ok(collectTurnWebSources(null).length === 0 && collectTurnWebSources({ items: [{ type: "webSearch" }] }).length === 0,
    "空回合 / 缺字段安全（不抛）");
}

/* ── 二、静态接线（渲染层；10-13 用户令「放到下面吧，跟下面这个在一行」→ 迁到 MessageFooter）── */
{
  const status = read("src/features/status/Status.tsx");
  const comp = read("src/features/shared/TurnWebSources.tsx");
  const footer = read("src/features/shared/MessageFooter.tsx");
  const turnView = read("src/features/session-turn/SessionTurn/03-turn-view.tsx");
  const css = read("src/styles/04-cards-tools.css");
  const compCode = codeOnly(comp);

  ok(turnView.includes('from "../../../lib/turn-web-sources.mjs"') && turnView.includes("webSources={collectTurnWebSources(turn)}"),
    "回合视图把纯函数提取的来源传进 MessageFooter（单一口径）");
  ok(/webSources\?: Array<\{ url: string; host: string \}>/.test(footer),
    "MessageFooter 挂 webSources 插槽 prop");
  ok(/\{isAgent && webSources && webSources\.length > 0 && <TurnWebSources sources=\{webSources\} inline \/>\}/.test(footer),
    "MessageFooter 行尾渲染来源条（跟 分支/耗时/token/收藏 同一行）；⛔ 有来源才渲染");
  ok(footer.indexOf("{extraIcon}") < footer.indexOf("<TurnWebSources sources={webSources} inline />"),
    "来源条贴 footer 最右端（extraIcon 之后）");
  const statusCode = codeOnly(status);
  ok(!statusCode.includes("TurnWebSources") && !statusCode.includes("turn-web-sources"),
    "⛔ 汇总卡不再渲染来源条（挪进 footer 后别留两份 —— 单一挂载点）");

  ok(/export const WEB_SOURCE_VISIBLE = 3/.test(compCode), "最多直显 3 个圆标（用户定稿）");
  ok(compCode.includes("createPortal(") && compCode.includes("document.body"), "全量弹层 portal 到 body（回合卡恒等 transform 会降级 fixed）");
  ok(compCode.includes("window.codex.openExternal"), "点击走默认浏览器（openExternal）");
  ok(compCode.includes("favicon.im") && compCode.includes("s2/favicons") && compCode.includes("web-favicon-fallback"),
    "favicon 两级远程源 + 首字母色块兜底");
  ok(compCode.indexOf("const [openAll, setOpenAll] = useState(false);") < compCode.indexOf("if (!sources.length) return null;"),
    "⛔ hooks 在 early return 之前（运行中 sources 从 0 长出来时不崩 hook 序）");
  ok(compCode.includes('aria-label={`查看全部 ${sources.length} 个网页来源`}') && compCode.includes("web-favicon-more"),
    "「···」三点钮 = 查看全部（多出 rest 个）");

  ok(/\.web-favicon \{[^}]*border-radius: 50%;/.test(css) && /completed-web-inline/.test(comp),
    "圆标形态 + inline 形态类");
  ok(/\.message-footer \.completed-web-inline \{[^}]*margin-left: auto;[^}]*border-top: none;/.test(css),
    "footer 内嵌：margin-left auto 贴行尾 + 去掉卡片里的分隔线");
  ok(/\.completed-web-pop \{[^}]*position: fixed;[^}]*z-index: 1000;/.test(css), "弹层 fixed + 轻浮层档 z-index 1000");
}

/* ── 三、check 链登记 ─────────────────────────────────────────────────── */
ok(JSON.parse(read("package.json")).scripts.check.includes("12g-turn-web-sources.mjs"), "package.json check 链已登记本守卫");

console.log(`\n【turn-web】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
