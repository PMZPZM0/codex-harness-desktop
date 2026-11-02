/**
 * 对话输出/预览卡片（11-02 用户：「还缺哪些输出展示卡片和预览卡片，缺的都补上」）。
 *
 * 本轮补的四处常见缺口（都是**静默失败**型：tsc/预检全绿，界面就是少一块）：
 *   ① 工具产出文档（PDF/Word/Excel/PPT/CSV/压缩包/数据）没有产物卡 —— 只有媒体有；
 *   ② 网页搜索结果只在头部一行，结果列表看不到；
 *   ③ 右栏 CSV/TSV 只按纯文本显示，没有表格；
 *   ④ 工具输出/命令/diff 没有复制键（正文 Markdown 代码块早就有）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

const docMod = await import(pathToFileURL(join(ROOT, "src", "lib", "document-kind.mjs")).href);
ok(docMod.documentKindOf("C:\\a\\报表.xlsx") === "sheet" && docMod.documentKindOf("b/说明.pdf") === "doc"
  && docMod.documentKindOf("c/deck.pptx") === "slide" && docMod.documentKindOf("d/out.zip") === "archive"
  && docMod.documentKindOf("e/data.json") === "data" && docMod.documentKindOf("f/main.ts") === "",
  "文档产物分类：表格/文档/演示/压缩包/数据；代码源文件不抢回合文件卡的戏");
const collected = docMod.collectDocumentPaths('完成：C:\\out\\报表.xlsx 与 /tmp/report.pdf（15 帧 / 10 KB）', 8);
ok(collected.length === 2 && collected.some((x) => x.path.endsWith("报表.xlsx")) && collected.some((x) => x.path.endsWith("report.pdf")),
  "文档产物扫描：只收真实扩展名，不把「15 帧 / 10 KB」里的斜杠当成路径");
const resultSrc = read("src/features/media/FileResultCards.tsx");
ok(/openRightFile\(path\)/.test(resultSrc) && /shellOpen\?\.\(path\)/.test(resultSrc) && /collectDocumentPaths/.test(resultSrc),
  "文档产物卡：点击在右栏预览，右侧可用默认应用打开");
const itemSrc = read("src/features/session-queue/ItemView.tsx");
ok(/<FileResultCards text=\{mediaText\} \/>/.test(itemSrc) && /<MediaResultCards text=\{mediaText\} \/>/.test(itemSrc),
  "工具卡同时出媒体播放卡与文档产物卡（同一段产出文本，分工不重叠）");
ok(/webSearchResultsOf\(item\)/.test(itemSrc) && /className="web-search-results"/.test(itemSrc) && /openExternal\(result\.url\)/.test(itemSrc),
  "网页搜索出结果卡（标题/站点/摘要，点击外链）；拿不到结果仍回落一行");
const searchMod = await import(pathToFileURL(join(ROOT, "src", "lib", "web-search-results.mjs")).href);
const search = searchMod.webSearchResultsOf({ results: [{ url: "https://a.com/x", title: "A", snippet: "摘要" }, { link: "https://b.com" }, "https://a.com/x"] });
ok(search.length === 2 && search[0].host === "a.com" && search[1].title === "b.com",
  "搜索结果提取：兼容 url/link、去重、无标题回落 host");

const csv = await import(pathToFileURL(join(ROOT, "src", "lib", "csv-preview.mjs")).href);
const table = csv.parseDelimited('name,note\r\n"a,b","say ""hi"""\n', ",", 10, 10);
ok(table.rows.length === 2 && table.rows[1][0] === "a,b" && table.rows[1][1] === 'say "hi"',
  "CSV 解析：引号包裹、转义双引号、CRLF 都正确");
const many = csv.parseDelimited(Array.from({ length: 400 }, (_, i) => `r${i},x`).join("\n"), ",", 300, 40);
ok(many.rows.length === 300 && many.truncated, "CSV 预览超 300 行截断并标记");
const filePreviewSrc = read("src/features/app-view/AppView/03-workspace-files.tsx");
ok(/<CsvPreview text=\{state\.content\}/.test(filePreviewSrc) && /function CsvPreview/.test(filePreviewSrc),
  "右栏 CSV/TSV 渲染成表格（不再只是一大段文本）");

const codeSrc = read("src/features/shared/ToolCodeBlock.tsx");
ok(/className="tool-code-copy"/.test(codeSrc) && /copyTextToClipboard\(text\)/.test(codeSrc)
  && /\.tool-code-copy\s*\{/.test(read("src/styles/03-messages-turns.css")),
  "工具输出/命令/diff 有复制键（与正文代码块一致）");

console.log(`\n  【对话卡片】${checks - fails}/${checks} 通过`);
if (fails) process.exit(1);
