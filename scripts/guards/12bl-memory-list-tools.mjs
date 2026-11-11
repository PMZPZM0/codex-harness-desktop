/**
 * 四个记忆板块的搜索 / 筛选 / 批量管理守卫（11-11）。
 * ⛔ 筛选与勾选逻辑**真跑** src/lib/memory-list-filter.mjs，不是 grep 源码；
 *    接线部分才用静态断言，并且逐个板块点名（漏一个板块就会红）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks++;
  console.log(`  ${cond ? "✓" : "✗"} 【memory-list-tools】${msg}`);
  if (!cond) fails++;
};

const mod = await import(pathToFileURL(join(ROOT, "src/lib/memory-list-filter.mjs")).href);
const { filterRows, matchesQuery, toggleSelection } = mod;

/* ① 纯函数真跑 */
{
  const rows = [
    { id: "feibi-path", name: "费比口径", type: "fact", scope: "project", status: "active", group: "g1", body: "三种算法" },
    { id: "daily-1107", name: "日报模板", type: "runbook", scope: "session", status: "superseded", group: "g1", body: "月结客户" },
    { id: "cat-top10", name: "类目前十", type: "fact", scope: "project", status: "active", group: "g2", body: "预付口径" },
    { id: "a1", name: "甘泉", type: "rule", scope: "rule", status: "active", group: "", body: "" },
  ];
  const textOf = (r) => `${r.id} ${r.name} ${r.body}`;
  ok(matchesQuery("甘泉", "甘") && !matchesQuery("甘泉", "泉x"), "中文短名按子串命中（⛔ 不分词，避免零召回）");
  ok(filterRows(rows, { query: "FEIBI", textOf }).length === 1, "搜索大小写不敏感，且命中 id");
  ok(filterRows(rows, { query: "月结", textOf }).length === 1, "搜索覆盖正文");
  ok(filterRows(rows, { query: "", textOf }).length === 4, "空搜索词不筛掉任何行");
  ok(filterRows(rows, {
    query: "", textOf,
    predicates: [(r) => r.scope === "project", (r) => r.status === "active"],
  }).length === 2, "多档筛选是 AND 组合（作用域 + 状态）");
  ok(filterRows(rows, {
    query: "甘泉", textOf, predicates: [(r) => r.scope === "project"],
  }).length === 0, "搜索与筛选同时生效，不会互相覆盖");
  const picked = toggleSelection(["a1"], ["feibi-path", "cat-top10"], true);
  ok(picked.length === 3 && picked.includes("feibi-path") && picked.includes("a1"), "全选只加当前可见 ids，已有选择不丢");
  ok(toggleSelection(picked, ["feibi-path"], false).length === 2, "取消只移除指定 ids");
  ok(toggleSelection([], ["x"], false).length === 0, "空集合取消不报错");
}

/* ② 四个板块逐个点名（shared / atoms 共用 MemoryAtomsPanel） */
{
  const atoms = read("src/features/memory-atoms/MemoryAtomsPanel.tsx");
  const groups = read("src/features/memory-atoms/GroupMemoryPanel.tsx");
  const boss = read("src/features/settings-memory/BossMemoryPanel.tsx");
  const section = read("src/features/settings-memory/MemoryCenterSection.tsx");
  ok(/rowKeyOf/.test(atoms) && /group: String\(e\.group/.test(groups), "两个条目面板都按 (group,id) 勾选/作废");
  ok(/<MemoryListTools[\s\S]*?actions=\{batchActions\}/.test(atoms), "项目共享记忆库 / 记忆条目：共用面板挂上工具条 + 批量动作");
  ok(/<MemoryListTools[\s\S]*?actions=\{batchActions\}/.test(groups), "工作伙伴记忆：挂上工具条 + 批量动作");
  ok(/<MemoryListTools[\s\S]*?actions=\{batchActions\}/.test(boss), "指挥中枢记忆：挂上工具条 + 批量动作");
  ok(/openCard === "shared"/.test(section) && /openCard === "atoms"/.test(section)
    && /openCard === "groups"/.test(section) && /openCard === "boss"/.test(section),
    "四个弹窗入口都在（⛔ 别只改三个就收工）");
  ok(/setChecked\(\[\]\)/.test(atoms) && /setChecked\(\[\]\)/.test(groups) && /setSelected\(\[\]\)/.test(boss),
    "⛔ 切筛选清选择，不许跨筛选误选看不见的行");
}

/* ③ 批量作废：复用引擎侧口径，⛔ 不物理删文件 */
{
  const manifest = read("electron/ipc-channels.manifest.json");
  const registry = read("electron/ipc-registry.ts");
  const ipc = read("electron/features/memory-ipc.ts");
  const tools = read("src/features/memory-list-tools/MemoryListTools.tsx");
  const css = read("src/styles/65-memory-list-tools.css");
  ok(/"channel": "memory:atoms:forget"/.test(manifest) && /"invokeArgs": "workspace, targets"/.test(manifest),
    "批量作废通道在 manifest（⛔ 实参只由 invokeArgs 决定：workspace, targets 一个都不能少）");
  ok(/prefix: "memory", count: 35,/.test(registry) && /"memory:atoms:forget"/.test(registry), "域计数跟着通道数改（35）");
  ok(/ipcHost\.handle\("memory:atoms:forget"/.test(ipc) && /runMemoryTool\(\{[\s\S]{0,160}name: "memory_forget"/.test(ipc),
    "⛔ 批量作废复用引擎侧 memory_forget（标 superseded + 重建索引，不写第二份口径）");
  ok(!/fs\.rm|unlink|rmSync/.test(ipc.slice(ipc.indexOf('"memory:atoms:forget"'), ipc.indexOf('"memory:atoms:forget"') + 900)),
    "⛔ 作废不是物理删除（文件保留可查）");
  ok(/role="alertdialog"/.test(tools) && /confirmText\(/.test(tools), "⛔ 所有批量动作都走页内二次确认");
  ok(/appearance: none/.test(css) && /\.mlt-check:checked/.test(css), "⛔ 暗色下原生控件逐处 appearance:none（含自定义勾选态）");
  /* 11-11 用户看截图点名「搜索框和输入框里面为啥要是灰色的，多难看」：
     --faint 是**淡文字色**，之前误拿它刷 AppSelect / checkbox 的背景 ⇒ 深灰实心块。
     ⛔ 四个板块共用这一份皮肤：改一处四处生效，也就不许任何一处再偷偷刷回来。 */
  ok(!/background:\s*var\(--faint\)/.test(css) && /background:\s*var\(--bg\)/.test(css),
    "⛔ 输入框 / 下拉不刷淡文字色当背景（四个板块共用同一份白底细边皮肤）");
  ok(/\.mlt-search-wrap:focus-within/.test(css) && !/background:\s*var\(--faint\)/.test(read("src/styles/63-memory-atoms.css")),
    "搜索框有 focus 反馈，且记忆面板其余输入框也没有第二处实心灰");
  ok(/boss-mem-scroll/.test(css) && /memory-atoms__row-wrap/.test(read("src/styles/63-memory-atoms.css")),
    "两种列表行都给勾选框留了位置（窄列不挤压标题）");
}

  /* 11-11 自审修复：数据完整性 + 两个边界（⛔ 自带读取，不依赖其它块作用域） */
  const a3 = read("src/features/memory-atoms/MemoryAtomsPanel.tsx");
  const g3 = read("src/features/memory-atoms/GroupMemoryPanel.tsx");
  const t3 = read("src/features/memory-list-tools/MemoryListTools.tsx");
  const i3 = read("electron/features/memory-ipc.ts");
  const s3 = read("electron/memory/atoms-store.ts");
  ok(/group: t\.group/.test(i3) && /rowKeyOf/.test(a3) && /group: String\(e\.group/.test(g3),
    "⛔ 批量作废按 (id, group) 精确定位：同 id 跨群时不许作废错那条");
  ok(/meta\.scope === "session"/.test(s3) && /\.\.\.\(group \? \[group\] : \[\]\)/.test(s3),
    "⛔ 写入侧按群分层落盘（读侧认两级目录，写侧不认 = 同 id 互相覆盖）");
  ok(/if \(selected\.length\) onSelectionChange\(\[\]\)/.test(t3),
    "搜索词变化清选择（⛔ 不许跨搜索误删看不见的行）");
  ok(/catch \{[\s\S]{0,120}finally/.test(t3),
    "确认动作异常有兜底（⛔ 不许 void 调用变成未捕获拒绝）");
console.log(`【memory-list-tools】${checks - fails}/${checks} 通过`);
if (fails) { console.error(`\n✗ ${fails} 项未通过`); process.exit(1); }
