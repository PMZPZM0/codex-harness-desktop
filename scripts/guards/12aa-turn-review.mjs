/**
 * 汇总卡 → 右栏「审阅」判据（10-18 立，同日按 Qoder 截图扩成连续审阅）
 *
 * 用户对照 Qoder：「已修改的文件加一个可以点击，然后右边展示右边这样的」+
 * 「看截图，把功能加齐全，然后图一样子文件折叠展开」。
 * 落点：汇总卡文件行/审查按钮 → 基座 store → 右栏「审阅」页：
 *   整轮文件逐块堆叠、每块可折叠、目录树筛选/折叠、堆叠/拆分、仅空白变更、自动换行。
 *
 * 失效方式：行点击仍开居中小弹窗 / store 只在域内（基座组件反向 import）/ 右栏没有审阅页 /
 * 只展示一个文件的 diff / 文件块不能折叠 / 三个菜单项没有真行为 / 切文件把右栏重新打开。
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【turn-review】${message}`);
  if (!condition) fails++;
};

/* ── 一、store：打开 / 切换 / 退订 ───────────────────────────────────────── */
const store = await import("../../src/lib/turn-review-store.mjs");
{
  const events = [];
  const off = store.subscribeTurnReview((event) => events.push(event));
  store.setTurnReview({ turnId: "t1", selectedPath: "a.ts", files: [{ path: "a.ts", added: 1, deleted: 2, diff: "@@ -1 +1 @@" }, { path: "b.ts", added: 3, deleted: 0 }] });
  store.selectTurnReviewFile("b.ts");
  store.selectTurnReviewFile("missing.ts");
  const state = store.getTurnReview();
  store.primeTurnReview({ turnId: "t2", selectedPath: "c.ts", files: [{ path: "c.ts", added: 4, deleted: 0, diff: "@@ -0 +1 @@" }] });
  const primed = store.getTurnReview();
  off();
  store.selectTurnReviewFile("a.ts");
  ok(events.length === 3 && events[0]?.reason === "open" && events[1]?.reason === "select" && events[2]?.reason === "prime",
    "点文件 = open，面板内切文件 = select，最新回合自动带出 = prime（后两者都不打开右栏）");
  ok(primed?.turnId === "t2" && primed?.files.length === 1 && primed?.selectedPath === "c.ts",
    "prime 新回合会替换整轮文件与选中项");
  ok(state?.selectedPath === "b.ts" && state?.files.length === 2 && state?.files[0].diff.includes("@@"),
    "store 保存整轮文件清单与选中文件；非法路径忽略");
}

/* ── 二、汇总卡：行点击 / 审查按钮都进右栏 ───────────────────────────────── */
const status = codeOnly(read("src/features/status/Status.tsx"));
const turnView = codeOnly(read("src/features/session-turn/SessionTurn/03-turn-view.tsx"));
{
  ok(status.includes("setTurnReview") && status.includes("selectedPath: path") && status.includes("diff: file.diffs.join"),
    "汇总卡把整轮文件（含 diff 原文）与选中路径写进 store");
  ok(/onClick=\{\(\) => openReview\(file\.path\)\}/.test(status) && /title="在右栏审阅这个文件的完整 diff"[\s\S]{0,120}?openReview\(file\.path\)/.test(status),
    "文件行点击与「审查」按钮都打开右栏审阅（不再开居中小弹窗）");
  ok(status.includes("title={`点击在右栏查看改动：${file.path}`}") && status.includes("openPath(menu.path, menu.name)"),
    "行提示改成「右栏查看改动」；右键菜单的「打开」仍走文件预览");
  ok(status.includes("primeTurnReview") && status.includes("isLastTurn") && status.includes("reviewSignature") && status.includes("clearTurnReview"),
    "最新回合自动带出（isLastTurn 门；历史回合不覆盖；无文件时清空）");
  ok(turnView.includes("isLastTurn={isLastTurn}"), "TurnView 把 isLastTurn 传给汇总卡");
}

/* ── 三、右栏审阅页 + 打开桥 ─────────────────────────────────────────────── */
const panelSrc = codeOnly(read("src/features/status/TurnReviewPanel.tsx"));
const diffSrc = codeOnly(read("src/features/status/DiffPreview.tsx"));
const bridge = codeOnly(read("src/features/status/TurnReviewBridge.tsx"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const reviewPanel = codeOnly(read("src/features/app-view/AppView/03-review-panel.tsx"));
const css = read("src/styles/05-composer-input.css");
const diffCss = read("src/styles/04-cards-tools.css");
{
  ok(panelSrc.includes("useSyncExternalStore") && panelSrc.includes("DiffPreviewBody") && panelSrc.includes("FileTypeIcon"),
    "审阅页订阅 store，diff 用带行号的 DiffPreviewBody，文件用类型图标");
  ok(panelSrc.includes("buildTurnReviewTree") && panelSrc.includes("collectTurnReviewFolders") && panelSrc.includes("relativeTurnReviewPath")
    && panelSrc.includes("turn-review-folder") && panelSrc.includes("turn-review-filter") && panelSrc.includes("turn-review-collapse-all"),
    "目录树：按相对路径分组、筛选框、文件夹逐个/全部折叠（Qoder 截图同款）");
  ok(panelSrc.includes("renderFiles.map") && panelSrc.includes("ReviewFileSection") && panelSrc.includes("turn-review-file-section")
    && panelSrc.includes("turn-review-file-head") && panelSrc.includes("toggleAllFiles") && panelSrc.includes("allFilesCollapsed")
    && panelSrc.includes("collapsedFiles"),
    "整轮文件 diff 逐块堆叠展示，每个文件块可折叠 + 工具栏「收起/展开全部文件变更」");
  ok(panelSrc.includes("MAX_CONTINUOUS_FILES") && panelSrc.includes("MAX_CONTINUOUS_LINES") && panelSrc.includes("singleFileMode")
    && panelSrc.includes("previousFile") && panelSrc.includes("nextFile") && panelSrc.includes("turn-review-large-diff"),
    "超过 64 文件 / 5000 改动行切单文件模式，并给上一个/下一个文件");
  ok(panelSrc.includes("viewMode") && panelSrc.includes("hideWhitespaceOnly") && panelSrc.includes("wrap")
    && panelSrc.includes("堆叠") && panelSrc.includes("拆分") && panelSrc.includes("隐藏仅空白变更")
    && panelSrc.includes("显示仅空白变更") && panelSrc.includes("启用自动换行") && panelSrc.includes("关闭自动换行"),
    "三点菜单四项都有真状态：堆叠/拆分 + 仅空白变更 + 自动换行（Qoder 同款）");
  ok(panelSrc.includes("readPreference") && panelSrc.includes("writePreference") && panelSrc.includes("turn-review:view")
    && panelSrc.includes("turn-review:wrap") && panelSrc.includes("turn-review:hide-whitespace") && panelSrc.includes("turn-review:tree"),
    "四个显示偏好落 localStorage（重开应用仍保留）");
  ok(panelSrc.includes("scrollIntoView") && panelSrc.includes("selectFile") && panelSrc.includes("sectionRefs"),
    "点目录树文件只切选中并滚到对应 diff 块（不重新打开右栏）");
  ok(panelSrc.includes("writeClipboard") && panelSrc.includes("onOpenFile") && panelSrc.includes("deletedFile"),
    "文件块头部有复制路径 / 打开文件（删除的文件禁用打开）");
  ok(panelSrc.includes("还没有选中的文件") && panelSrc.includes("在对话里的「已更改 N 个文件」汇总卡"),
    "未选中时有可操作的说明（不是空白）");
  /* ⛔ 10-22 用户截图：空态曾是 row 布局 ⇒ 图标 + 标题 + 说明挤一行，标题被折成「还没有选/中的文件」。
     必须是纵向堆叠（图标在上、标题、说明），且标题不许在词中间断。 */
  ok(/\.turn-review-panel\.is-empty \{[^}]*flex-direction: column/.test(css)
    && /\.turn-review-panel\.is-empty strong \{[^}]*line-height/.test(css),
    "空态纵向堆叠 + 标题行高（⛔ 退回 row 会把「还没有选中的文件」折成两行）");
  ok(diffSrc.includes('view = "unified"') && diffSrc.includes("wrap = false") && diffSrc.includes("ignoreWhitespaceOnly = false")
    && diffSrc.includes("diffp-split") && diffSrc.includes("data-diff-view"),
    "DiffPreviewBody 支持统一/拆分、换行、仅空白过滤三种显示参数");
  ok(css.includes(".turn-review-file-section") && css.includes(".turn-review-file-head") && css.includes(".turn-review-menu")
    && css.includes(".turn-review-large-diff") && css.includes(".turn-review-filter-clear"),
    "审阅页样式：文件块 / 三点菜单 / 单文件提示 / 筛选清除");
  ok(diffCss.includes(".diffp-split .diffp-inner") && diffCss.includes(".diffp-split-row") && diffCss.includes(".diffp.is-wrap .diffp-line"),
    "拆分视图与自动换行的样式在基座 diff 样式表（悬停预览复用同一份实现）");
  ok(bridge.includes('event?.reason === "open"') && !/reason === "select"[\s\S]{0,80}?onOpen/.test(bridge),
    "打开桥只在 open 时打开右栏；select 不重新打开（滚动位置不被重置）");
  ok(appView.includes("<TurnReviewBridge") && appView.includes('app.setRightTab("turn-review")') && appView.includes("0.42"),
    "AppView 挂桥：开右栏 + 切审阅页 + 自动加宽（窗口 42%）");
  ok(reviewPanel.includes('rightTab === "turn-review"') && reviewPanel.includes("<TurnReviewPanel") && reviewPanel.includes(">审阅<")
    && reviewPanel.includes('active={rightTab === "turn-review"}') && reviewPanel.includes("onOpenFile"),
    "右栏有「审阅」标签页；面板只在激活时渲染 diff（隐藏页不白算）+ 打开文件接回会话");
  {
    /* 10-22 用户：「侧边栏终端按键可以删了，替换成审阅图标」。默认面板宽 308px，
       五个标签排不下 ⇒ 审阅被挤出可视区（横向滚动才能点到），所以撤终端、审阅顶到第二位。 */
    const stripBlock = reviewPanel.match(/<div className="tabstrip-tabs">([\s\S]*?)<\/div>/);
    const strip = stripBlock ? stripBlock[1] : "";
    const order = [">变更<", ">审阅<", ">浏览器<", ">文件<"].map((x) => strip.indexOf(x));
    ok(Boolean(strip) && !/>终端</.test(strip) && order.every((v) => v >= 0) && order.every((v, i) => i === 0 || order[i - 1] < v),
      "⛔ 右栏标签 = 变更/审阅/浏览器/文件（终端撤掉、审阅顶到第二位；项目树 10-22 起改叫「文件」）");
    ok(/rightTab === "terminal"[\s\S]{0,240}?<TerminalPanel/.test(reviewPanel),
      "终端页仍保留（Ctrl+J / 命令面板可开，只是没有常驻标签）");
    ok(!/TerminalSquare/.test(reviewPanel),
      "⛔ 撤掉终端标签后不许留死导入（TerminalSquare）");
  }
  ok(reviewPanel.includes('from "../../status"'),
    "右栏从 status 的 barrel 取面板（⛔ 不深链域内部文件）");
}

/* ── 四、纯函数真跑：目录树 / 仅空白过滤 / 拆分视图 ───────────────────────── */
const treeLib = await import("../../src/lib/turn-review-tree.mjs");
const diffLib = await import("../../src/lib/diff-view.mjs");
{
  const root = "D:\\repo";
  const files = [
    { path: "D:\\repo\\src\\b.ts", added: 1, deleted: 0 },
    { path: "D:\\repo\\src\\nested\\a.ts", added: 2, deleted: 1 },
    { path: "D:\\repo\\README.md", added: 1, deleted: 1 },
  ];
  ok(treeLib.relativeTurnReviewPath(files[1].path, root) === "src/nested/a.ts",
    "relativeTurnReviewPath 去掉工作区前缀并统一斜杠");
  const tree = treeLib.buildTurnReviewTree(files, root);
  ok(tree.dirs.length === 1 && tree.dirs[0].name === "src" && tree.dirs[0].dirs[0]?.name === "nested"
    && tree.dirs[0].dirs[0].files[0]?.name === "a.ts" && tree.files[0]?.name === "README.md",
    "buildTurnReviewTree 按目录分组、目录与文件按名称排序");
  ok(treeLib.collectTurnReviewFolders(tree).join(",") === "src,src/nested",
    "collectTurnReviewFolders 收集嵌套文件夹（「收起全部文件夹」用）");

  const real = diffLib.parseDiffLines("@@ -1,4 +1,4 @@\n const a = 1;\n-  const b = 2;\n+    const b = 2;\n-const c = 3;\n+const c = 4;\n const d = 5;\n");
  const filtered = diffLib.filterWhitespaceOnlyRows(real);
  ok(filtered.some((row) => row.kind === "del" && row.text === "const c = 3;")
    && !filtered.some((row) => row.text === "  const b = 2;")
    && filtered.some((row) => row.text === "const d = 5;"),
    "filterWhitespaceOnlyRows 只删「归一化后相同」的增删对，真正的改动与上下文保留");
  const wsOnly = diffLib.parseDiffLines("@@ -1 +1 @@\n-a b\n+ a  b\n");
  ok(diffLib.filterWhitespaceOnlyRows(wsOnly).length === 0,
    "整块只有空白变更 ⇒ 连 hunk 头一起隐藏（不留空块）");
  const splitRows = diffLib.buildSplitDiffRows(real);
  ok(splitRows.filter((row) => row.kind === "pair").length === 4
    && splitRows.some((row) => row.left?.text === "  const b = 2;" && row.right?.text === "    const b = 2;"),
    "buildSplitDiffRows 按序左右配对（上下文两侧同内容）");
  ok(diffLib.isSingleSidedDiff(diffLib.parseDiffLines("@@ -0,0 +1,2 @@\n+a\n+b\n")) === true
    && diffLib.isSingleSidedDiff(real) === false,
    "单边新增/删除识别为单边（拆分视图自动退回统一视图）");
}

/* ── 10-25【118 尾】完成态折叠：汇总正文之后不许再有折叠组 ──────────────────
   用户实测（截图实证）：「又出折叠会话到消息尾部了…重启应用，就跑到消息汇总下面」
   +「必须全部进大折叠」。
   真因：上游给的 item 顺序里，**最终答复后面可能还有过程单元**（引擎随后才补记那条
   工具调用；重启走历史快照路径时更常见）⇒ 旧实现把它 flush 成**第二个折叠组**，
   那个组渲染在**汇总消息下面**（「使用技能 ADH 写法」芯片落在汇总正文下方）。
   修法（src/lib/turn-fold-plan.mjs）：尾巴里的过程单元**前移**并入同一个大折叠组。
   细则与全部形态在独立回归脚本 scripts/verify-fold-tail.mjs（真跑 + 退出码判成败）。
   ⛔ 本文件不在【265】棘轮名单 ⇒ 细则写这里；07-turn-fold.mjs 只许缩不许长。 */
{
  const res = spawnSync(process.execPath, [join(ROOT, "scripts", "verify-fold-tail.mjs")], { encoding: "utf8", timeout: 60000 });
  const out = String(res.stdout ?? "") + String(res.stderr ?? "");
  ok(res.status === 0,
    `【118 尾】折叠尾巴回归全绿（汇总正文永远是最后一项；过程全进唯一大折叠组；scripts/verify-fold-tail.mjs exit=${res.status}）`
    + (res.status === 0 ? "" : `\n${out.slice(-600)}`));
}

/* ── 【118 变更页】右栏默认变更 + 主题界面 + 搜索 + 自适应不裁剪（10-25 用户）──
   「侧边栏展开空唠唠的，展开默认展示变更界面…设计一个主题界面，加搜索框搜索内容，
     内容根据尺寸自适应展示全，不要裁剪」。 */
{
  const reviewPanel = codeOnly(read("src/features/storage-settings/StorageSettings.tsx"));
  const rightState = read("src/features/app-state/parts/part01/05-engine-ssh-connectors.tsx");
  const toggle = read("src/features/app-state/parts/part09/02-seg.tsx");
  const css = read("src/styles/05-composer-input.css");
  ok(/rightTab[^\n]*useState<string>\(\(\) => "review"\)/.test(rightState)
    && /!bag\.rightTab\) bag\.setRightTab\("review"\)/.test(toggle),
    "右栏展开默认 = 变更（状态初值 + 切换按钮兜底，两处都改）");
  ok(/review-hero/.test(reviewPanel) && /review-search/.test(reviewPanel)
    && /normalizedQuery/.test(reviewPanel) && /file\.content\.toLowerCase\(\)\.includes\(normalizedQuery\)/.test(reviewPanel)
    && /visibleFiles/.test(reviewPanel) && /FileTypeIcon/.test(reviewPanel),
    "变更页有主题总览卡、搜索框（路径 + diff 内容双匹配）、文件类型图标");
  ok(/\.review-file-path \{[^}]*overflow-wrap:\s*anywhere/.test(css)
    && !/\.review-file-path \{[^}]*text-overflow:\s*ellipsis/.test(css)
    && /\.review-panel-themed \{[^}]*overflow-x:\s*hidden/.test(css),
    "路径换行展示全（⛔ 不再 ellipsis 裁剪），面板横向不溢出");
}

console.log(`\n【turn-review】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
