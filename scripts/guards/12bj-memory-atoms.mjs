/**
 * 记忆原子（Memory Atoms）—— 11-10 用户令：
 *   「按豆包那套全面改造我们的记忆系统，给我们自己新制定一套自己的，要比他的更好」
 *   「记忆和记忆工具配套更新，专家群 / 专家团群 / CLI 智能体群分别定制一套」
 *
 * ⛔ 这个守卫跑**编译产物**（dist-electron/memory/*.js），真跑输入输出，不是 grep 源码：
 *   格式解析、摘要截断、状态过滤、召回排序、冲突检出、预算截断、三类群策略差异。
 * ⛔ 跑之前必须 `npm run build`（产物缺失时本守卫直接判红并说明，而不是静默跳过）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【memory-atoms】${message}`);
  if (!condition) fails++;
};

const distDir = join(ROOT, "dist-electron", "memory");
const need = ["atoms-format.js", "atoms-select.js", "group-memory-policy.js", "atoms-store.js"];
const missing = need.filter((f) => !existsSync(join(distDir, f)));
if (missing.length) {
  ok(false, `编译产物缺失（${missing.join("、")}）—— 先 npm run build 再跑本守卫`);
  process.exit(fails ? 1 : 0);
}
const load = (f) => import(pathToFileURL(join(distDir, f)).href);
const fmt = await load("atoms-format.js");
const sel = await load("atoms-select.js");
const pol = await load("group-memory-policy.js");
const store = await load("atoms-store.js");

/* ── ① 格式：解析 / 必填 / 坏文件 ───────────────────────────── */
{
  const good = `---
id: feibi-path
summary: "费比取数口径"
type: fact
scope: project
status: active
confidence: confirmed
created: 2026-11-06
updated: 2026-11-06
source:
  kind: session
  ref: "oc_21d4 - 蒋杭超"
tags: [生意参谋, 费比]
supersedes: []
expiresAt: ""
evidence:
  - src/lib/x.mjs#fn
---

正文第一条。
`;
  const parsed = fmt.parseAtom(good);
  ok(Boolean(parsed) && parsed.meta.id === "feibi-path" && parsed.meta.tags.length === 2
    && parsed.meta.source.kind === "session" && parsed.meta.evidence[0] === "src/lib/x.mjs#fn",
    "frontmatter 子集解析：嵌套 source / 行内 tags / evidence 列表都对");

  /* ⛔ 坏文件必须返回 null —— 当成空条目就会静默覆盖原文件（CLI 配置上踩过的同一个坑）。 */
  ok(fmt.parseAtom("没有 frontmatter 的纯文本") === null, "⛔ 没有 frontmatter ⇒ null（不当空条目）");
  ok(fmt.parseAtom("---\nid: x\n---\n正文") === null, "⛔ 缺 summary ⇒ null（不能被索引）");
  ok(fmt.parseAtom("---\nsummary: 只有摘要\n---\n正文") === null, "⛔ 缺 id ⇒ null");

  const long = "这是一个很长很长的摘要".repeat(10);
  const cut = fmt.oneLineSummary(long, 40);
  ok(cut.length <= 40 && cut.endsWith("…"), `摘要按字符截断（${cut.length} ≤ 40，中文不被切半）`);
}

/* ── ② 生命周期：status / 到期 ─────────────────────────────── */
{
  const base = { id: "a", summary: "s", type: "fact", scope: "project", confidence: "confirmed", created: "2026-01-01", updated: "2026-01-01", source: { kind: "workspace", ref: "x" }, tags: [], supersedes: [], expiresAt: "", evidence: [] };
  ok(fmt.isInjectable({ ...base, status: "active" }) === true, "active 可注入");
  ok(fmt.isInjectable({ ...base, status: "superseded" }) === false, "⛔ superseded 永不注入（旧结论不许继续生效）");
  ok(fmt.isInjectable({ ...base, status: "expired" }) === false, "⛔ expired 永不注入");
  ok(fmt.isInjectable({ ...base, status: "active", expiresAt: "2020-01-01" }, Date.parse("2026-11-10")) === false,
    "⛔ expiresAt 到期自动失效（不用等 gc）");
}

/* ── ③ 召回：排序 / 状态过滤 / 冲突 / 预算 ─────────────────── */
{
  const doc = (id, summary, body, extra = {}) => ({
    meta: { id, summary, type: "fact", scope: "project", confidence: "confirmed", created: "2026-11-01", updated: "2026-11-01", status: "active", source: { kind: "workspace", ref: "x" }, tags: [], supersedes: [], expiresAt: "", evidence: [], ...extra },
    body,
  });
  const docs = [
    doc("feibi", "费比取数口径", "生意参谋 费比 三种口径 全店 个人 净额 6.16% 8.82% 9.52%", { tags: ["费比", "生意参谋"] }),
    doc("unrelated", "配色规范", "主色 #E8952A 辅助灰阶", { tags: ["视觉", "配色"] }),
    doc("old", "旧的费比结论", "费比 9.9%", { tags: ["费比", "生意参谋"], status: "superseded" }),
  ];
  const res = sel.selectAtoms(docs, { query: "费比的三种口径分别是多少", now: Date.parse("2026-11-10") }, { indexMaxChars: 400, recallLimit: 2, bodyMaxChars: 200 });
  ok(res.recalled.length > 0 && res.recalled[0].meta.id === "feibi", "按任务召回：相关条目排第一");
  ok(!res.indexText.includes("[[old]]"), "⛔ 索引里不出现 superseded 条目");
  ok(!res.recalled.some((r) => r.meta.id === "old"), "⛔ 召回也不返回 superseded 条目");

  /* 预算下限是 200（太小没意义）⇒ 用例要够多条目才可能溢出：这里补 4 条长摘要。 */
  const many = [...docs];
  for (let i = 0; i < 4; i += 1) many.push(doc(`x${i}`, "一条摘要写得比较长以便把索引预算挤爆的条目" + i, "正文"));
  const tight = sel.selectAtoms(many, { query: "", now: Date.now() }, { indexMaxChars: 200, recallLimit: 0 });
  ok(tight.indexDropped > 0, "索引超预算时明确计数（indexDropped > 0，不静默丢）");

  /* 冲突：同 type + tags 重合 ≥2 + 数字不同 ⇒ 报出来，不静默择一。 */
  const conflict = sel.findConflicts([
    doc("a", "费比 A", "本期 6.16%", { tags: ["费比", "口径"] }),
    doc("b", "费比 B", "本期 9.52%", { tags: ["费比", "口径"] }),
  ]);
  ok(conflict.length === 1 && conflict[0].includes("a") && conflict[0].includes("b"),
    "⛔ 互相矛盾的 active 条目会被标成待裁决（不静默挑一条）");
}

/* ── ④ 三类群策略：专家 / 专家团 / CLI 必须真的不同 ─────────── */
{
  ok(pol.groupKindOf({ hasTeam: true, hasCli: true, expertCount: 4 }) === "team", "群类型判定：有团槽 ⇒ 专家团群");
  ok(pol.groupKindOf({ hasCli: true }) === "cli", "群类型判定：只有 CLI ⇒ CLI 群");
  ok(pol.groupKindOf({ expertCount: 3 }) === "expert", "群类型判定：多个独立专家 ⇒ 专家群");

  const teamLead = pol.policyOf("team", "lead");
  const teamMember = pol.policyOf("team", "member");
  const cli = pol.policyOf("cli", "cli");
  const expert = pol.policyOf("expert", "member");

  ok(teamLead.supersede === "any" && teamMember.supersede === "own",
    "专家团：主理人可取代任何人，成员只能取代自己（权威链）");
  ok(teamLead.writable.includes("rule") && !teamMember.writable.includes("rule"),
    "⛔ 专家团：团级规则只有主理人能写");
  ok(cli.writable.length === 0 && cli.render === "plain",
    "⛔ CLI 群：写不了（宿主代写）+ 只能吃纯文本");
  ok(cli.recallLimit < expert.recallLimit, "CLI 召回条数更少（它的上下文最贵）");
  ok(expert.supersede === "own" && expert.render === "markdown",
    "专家群：平级、只能取代自己、吃 markdown");

  const deny = pol.writableCheck(cli, "project");
  ok(deny.ok === false && /写不了记忆/.test(deny.reason ?? ""), "CLI 写入被拒时给出人话原因（不是静默失败）");
  ok(pol.writableCheck(teamMember, "rule").ok === false, "成员写团级规则被拒");
  ok(pol.writableCheck(teamLead, "rule").ok === true, "主理人写团级规则通过");

  const plain = pol.renderPlainForCli([{ summary: "费比口径", body: "见 [[feibi]] 与 entries/project/x.md\n--- 分隔 ---", flag: "待验证" }]);
  ok(!plain.includes("[[") && !plain.includes("entries/") && plain.includes("待验证"),
    "CLI 纯文本渲染：去掉双链与文件路径，保留置信标记");
}

/* ── ⑤ 存储：路径常量与原子写 ─────────────────────────────── */
{
  ok(store.atomsRootOf("D:/x").endsWith(join(".codex-harness", "memory", "atoms")),
    "存储根 = <workspace>/.codex-harness/memory/atoms");
  /* 源码里必须能看到 tmp+rename（半截文件 = 解析失败 = 那条记忆静默消失）。 */
  const src = readFileSync(join(distDir, "atoms-store.js"), "utf8");
  ok(/rename/.test(src) && /\.tmp/.test(src), "写入走 tmp + rename（崩掉不留半截条目）");
}

/* ── ⑥ 群级隔离（用户确认：每个群一套独立记忆）──────────── */
{
  const fmtSrc = readFileSync(join(distDir, "atoms-format.js"), "utf8");
  const injectSrc = readFileSync(join(distDir, "group-memory-inject.js"), "utf8");
  ok(/group:/.test(fmtSrc), "条目带 group 归属（序列化里出现 group 字段）");
  ok(/d\.meta\.group === groupId/.test(injectSrc) && /groupId/.test(injectSrc),
    "⛔ 群级隔离：session 域只注入本群条目（少了这层 A 群口径会漏进 B 群）");
  ok(/project|rule/.test(injectSrc) && /session/.test(injectSrc),
    "project/rule 域仍跨群共享、session 域按群隔离（两类口径分开）");
}

/* ── ⑦ 工具执行端身份（11-11 全链路验收发现的问题）─────────────────────────────
   ⛔ 原来 policyOf 写死 ("plain","member") ⇒ 主会话让模型「记住这条口径」会被拒写 project，
      而界面手动编辑却能写 ⇒ 同一条记忆两套口径。这里**真跑编译产物**钉住两种身份。 */
{
  const tool = await load("atoms-tool.js");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "atoms-guard-"));
  const writeAs = (seat) => tool.runMemoryTool({
    name: "memory_write", workspace: tmp, seat,
    args: { id: `guard-${seat}`, summary: `身份 ${seat} 探针`, body: "验收用临时条目。", scope: "project" },
  });
  const owner = await writeAs("owner");
  const member = await writeAs("member");
  ok(owner.ok === true, "主会话 seat=owner 能写 project（⛔ 别把主会话误判成群成员）");
  ok(member.ok === false && /不能写 project/.test(String(member.error ?? "")),
    "群成员 seat=member 仍被拒写 project（修主会话不许放开权限）");
  const toolSrc = readFileSync(join(ROOT, "electron/memory/atoms-tool.ts"), "utf8");
  const rpcSrc = readFileSync(join(ROOT, "electron/features/dispatch-rpc.ts"), "utf8");
  ok(/policyOf\(input\.kind \?\? "plain", input\.seat \?\? "member"\)/.test(toolSrc)
    && !/policyOf\("plain", "member"\)/.test(toolSrc),
    "⛔ 策略由宿主注入的 kind/seat 决定（缺省仍是最小权限 member），不许写死");
  ok(/seat: restrict\.restricted \? "member" : "owner"/.test(rpcSrc),
    "⛔ 执行端按调用者身份传 seat（⛔ 不让模型自报；漏了就是主会话被当群成员）");
  rmSync(tmp, { recursive: true, force: true });
}

/* ── ⑧ 方案第 11/12 项（用户 11-11 点名「11 12 13 还没完成」）───────────────── */
{
  const ipcSrc = readFileSync(join(ROOT, "electron/features/memory-ipc.ts"), "utf8");
  const groupSrc = readFileSync(join(ROOT, "src/features/memory-atoms/GroupMemoryPanel.tsx"), "utf8");
  const engineSrc = readFileSync(join(ROOT, "electron/features/dispatch-core.ts"), "utf8");
  ok(/function memoryPolicyRows\(\)/.test(ipcSrc) && /policyOf\("expert"/.test(ipcSrc)
    && /policies: memoryPolicyRows\(\)/.test(ipcSrc),
    "⛔ 群策略说明由主进程 policyOf 生成并随 list 返回（前端不写第二份口径）");
  ok(/群策略说明/.test(groupSrc) && /setPolicies/.test(groupSrc),
    "工作伙伴记忆面板渲染三类群策略说明（方案第 12 项）");
  ok(/name: "memory_recall"/.test(engineSrc) && /name: "memory_write"/.test(engineSrc)
    && /name: "memory_forget"/.test(engineSrc),
    "引擎工具三件套已暴露（方案第 11 项：forget 承担 supersede / expired 作废）");
  const archiveSrc = readFileSync(join(ROOT, "electron/features/artifact-archive.ts"), "utf8");
  const migrateSrc = readFileSync(join(ROOT, "scripts/artifacts-migrate.mjs"), "utf8");
  ok(/archiveDirName/.test(archiveSrc) && /YYYYMMDD/.test(archiveSrc)
    && /archiveFiles\(/.test(migrateSrc) && /--apply/.test(migrateSrc),
    "产物区按 日期-短名 归档（方案第 13 项：落盘模块 + 默认 dry-run 的迁移脚本）");
}

/* ── ⑨ 作废按群精确定位（11-11 自审发现的数据完整性问题）─────────────────
   entries/session/<群id>/<id>.md 允许同一 id 在多个群各存一份；只按 id 找会作废错群。 */
{
  const tool = await load("atoms-tool.js");
  const store = await load("atoms-store.js");
  const ws = mkdtempSync(join(tmpdir(), "atoms-forget-"));
  try {
    for (const g of ["g1", "g2"]) {
      const w = await tool.runMemoryTool({ name: "memory_write", workspace: ws,
        args: { id: "same-id", summary: `${g} 口径`, body: "正文", scope: "session", group: g } });
      if (!w.ok) throw new Error(w.error);
    }
    const { docs } = await store.readAtoms(ws);
    ok(docs.filter((d) => d.meta.id === "same-id").length === 2, "同一 id 在两个群各存一份（复现跨群场景）");
    const r = await tool.runMemoryTool({ name: "memory_forget", workspace: ws,
      args: { id: "same-id", group: "g2", reason: "自审" } });
    const { docs: after } = await store.readAtoms(ws);
    const g1 = after.find((d) => d.meta.id === "same-id" && d.meta.group === "g1");
    const g2 = after.find((d) => d.meta.id === "same-id" && d.meta.group === "g2");
    ok(r.ok && g1?.meta.status === "active" && g2?.meta.status === "superseded",
      "⛔ 作废带 group 只命中本群那条（不带 group 会误作废别的群的记忆）");
    const ws2 = mkdtempSync(join(tmpdir(), "atoms-forget2-"));
    try {
      await tool.runMemoryTool({ name: "memory_write", workspace: ws2, args: { id: "dup", summary: "无群", body: "正文", scope: "session" } });
      await tool.runMemoryTool({ name: "memory_write", workspace: ws2, args: { id: "dup", summary: "g1", body: "正文", scope: "session", group: "g1" } });
      const r2 = await tool.runMemoryTool({ name: "memory_forget", workspace: ws2, args: { id: "dup" } });
      const { docs: d2 } = await store.readAtoms(ws2);
      const plain = d2.find((d) => d.meta.id === "dup" && !d.meta.group);
      const grouped = d2.find((d) => d.meta.id === "dup" && d.meta.group === "g1");
      ok(r2.ok && plain?.meta.status === "superseded" && grouped?.meta.status === "active",
        "⛔ 不带 group 只作废无群条目，不误伤同 id 的群记忆");
    } finally { rmSync(ws2, { recursive: true, force: true }); }
  } finally { rmSync(ws, { recursive: true, force: true }); }
}
console.log(`【memory-atoms】${checks - fails}/${checks} 通过`);
if (fails) {
  console.error(`\n✗ ${fails} 项未通过`);
  process.exit(1);
}
