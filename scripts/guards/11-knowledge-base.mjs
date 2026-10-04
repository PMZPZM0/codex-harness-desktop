/**
 * 知识库检索判据（2026-10-04，纯离线、可随预检跑）
 *
 * ⛔ 为什么是.mjs 而不是 .ts：预检是 node 直跑，改成 .mjs 不用先构建。
 *   判据直接对**编译产物** `dist-electron/knowledge-base.js` 取真实现 ——
 *   免得"源码改了、产物没重建、判据测的是旧逻辑"（本项目踩过）。
 *
 * 覆盖 docs/KNOWLEDGE-BASE.md §3/§6 的四条：
 *   1. 块间有重叠（跨界的句子至少在一块里完整）
 *   2. snippet 围绕 query 命中词，**不是固定取块首**
 *   3. 全文档与语义档 snippet 定位用**同一套** queryTerms
 *   4. limit 生效、不超上限
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KB = join(ROOT, "dist-electron", "knowledge-base.js");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【kb】${m}`); } };
const pass = (m) => { checks++; console.log(`  ✓ 【kb】${m}`); };

if (!readFileSync(KB, "utf8")) { /* 读不到下面自然报错 */ }
const mod = await import(`file://${KB.replace(/\\/g, "/")}?t=${Date.now()}`).catch(() => null);
if (!mod) {
  console.log("  ✗ 【kb】加载 dist-electron/knowledge-base.js 失败（先 npm run build:electron）");
  process.exit(1);
}
const { chunkText, addDocument, searchDocs, listDocs } = mod;

// ── 造一个临时项目（⛔ 不碰用户真实知识库目录） ──
const ws = mkdtempSync(join(tmpdir(), "kb-guard-"));
mkdirSync(join(ws, ".codex-harness", "knowledge"), { recursive: true });

try {
  // ── 判据 1：块间有重叠 ──
  // 夹具要够长才切得出多块（CHUNK_SIZE=700/ 块）——⛔ 短夹具会让后续判据全不执行，
  // 看着像"其它都过了"，实际是**没跑到**（假绿的一种）。
  const long = Array.from({ length: 120 }, (_, i) => `第${i}段讲的是一个独立知识点ABCDEFGH。`).join("\n\n");
  const chunks = chunkText(long);
  ok(chunks.length >= 3, `造出多块（实际 ${chunks.length}）`);
  let overlapHits = 0;
  for (let i = 1; i < chunks.length; i++) {
    // 后一块的开头应当能在前一块里找到 ⇒ 重叠真的存在
    const head = chunks[i].slice(0, 40);
    if (head.length >= 10 && chunks[i - 1].includes(head)) overlapHits++;
  }
  if (overlapHits > 0) pass(`块间重叠生效（${overlapHits}/${chunks.length - 1} 块有重叠头）`);
  else ok(false, "块间没有任何重叠 ⇒ 跨块句子召不回来（规范 §3 第 4 条未实现）");

  // ⛔⛔ 反证向判据（2026-10-04 实战踩到）：只查"有重叠"会**恒真**。
  //   原实现里 `current.slice(-CHUNK_OVERLAP)` 在 OVERLAP=0 时 `slice(-0)` 返回**整串**
  //   ⇒ 每块都含全文 ⇒ "后一块开头能在前一块找到" 永远成立。
  //   ⇒ 必须再加一条**反向判据**：块与块的重叠不得等于整块（那是"没切"而不是"重叠"）。
  const maxOv = Math.max(...chunks.map((c) => c.length));
  const anyFullDup = chunks.some((c, i) => i > 0 && c.length === maxOv && chunks[i - 1] === c);
  ok(!anyFullDup, "没有「整块重复」（slice(-0) 类缺陷的哨兵：整串重叠会让块数暴涨且每块含全文）");
  //块数不该爆炸：120 段 ≈ 数千字符，700/块 ⇒ 十几块量级。若上百块说明重叠写坏了。
  ok(chunks.length < 60, `块数合理（${chunks.length} 块，120 段文本）`);

  // ── 判据 2：snippet 围绕命中词，不是固定块首 ──
  addDocument(ws, {
    title: "检索判据样本",
    text: long + "\n\n特别标记段落XYZABC位于文档末尾附近。",
    source: "guard",
  });
  const hits = searchDocs(ws, "XYZABC", 5);
  const hit = hits.find((h) => h.chunkIndex >= chunks.length - 1) ?? hits[0];
  if (hit) {
    ok(hit.snippet.includes("XYZABC"), `snippet 含命中词（命中块 #${hit.chunkIndex}：${JSON.stringify(hit.snippet.slice(0, 60))}）`);
    // 命中词若不在块首，snippet 不该以文档开头（"第0段"）起头
    const startsAtDocHead = hit.snippet.replace(/^…/, "").startsWith("第0段");
    ok(!startsAtDocHead, "snippet 没有退回块首（规范 §6 第 1 条）");
  } else {
    console.log("  ✗ 【kb】查不到任何命中（前置不成立：文档没进去？）");
  }

  // ── 判据 3：limit 生效 ──
  const many = Array.from({ length: 30 }, (_, i) => `关键词KEEP${i} 出现在这里。`).join("\n\n");
  addDocument(ws, { title: "多命中样本", text: many, source: "guard" });
  const capped = searchDocs(ws, "KEEP", 3);
  ok(capped.length <= 3, `limit 生效（请求 3 → 返回 ${capped.length}）`);
  ok(listDocs(ws).length === 2, `文档数正确（${listDocs(ws).length}）`);

  // ── 判据 4：新增能力不得倒退（防"修精准度时把召回砍没了"） ──
  const before = searchDocs(ws, "第5段", 8);
  ok(before.length > 0, `常见查询仍能召回（${before.length} 条）`);

  // ── 判据 5（2026-10-04 补）：**语义档**的 snippet 也必须围绕命中词 ──
  //⛔ 之前只测了 searchDocs（全文档档），而真正的 bug 在 searchDocsSemantic里
  //   （`chunk.slice(0,260)` 取块首）。两条档的 snippet 定位必须各自被测到。
  // 做法：用一个**恒定返回同一向量**的假 embedding 逼它走语义档。
  if (typeof mod.searchDocsSemantic === "function") {
    const ws2 = mkdtempSync(join(tmpdir(), "kb-guard2-"));
    mkdirSync(join(ws2, ".codex-harness", "knowledge"), { recursive: true });
    try {
      const body = Array.from({ length: 120 }, (_, i) => `填充段落${i}ABCDE。`).join("\n\n")
        + "\n\n末尾独有关键词ZZQQ位于文档最末。";
      addDocument(ws2, { title: "语义档样本", text: body, source: "guard" });
      // ⛔ 夹具设计踩过的坑：给**所有块**同一个 [1,0] ⇒ 余弦全=1、排序取第一块
      //   ⇒ ZZQQ 根本不在被选中的块里 ⇒ 判据红，但那是**夹具错**不是实现错
      //   （「夹具坏了读成实现坏了」）。改成：只有**含 ZZQQ 的那块**给高分，
      //   其余给低分 ⇒ 必然选中末尾块，才测得到"snippet 是否围绕命中词"。
      const chunks2 = chunkText(body);
      const lastIdx = chunks2.findIndex((c) => c.includes("ZZQQ"));
      const docId = listDocs(ws2)[0].id;
      const docDir = join(ws2, ".codex-harness", "knowledge", "docs", docId);
      mkdirSync(docDir, { recursive: true });
      writeFileSync(
        join(docDir, "embeddings.json"),
        JSON.stringify({ vectors: chunks2.map((_, i) => (i === lastIdx ? [1, 0] : [0, 1])) }),
        "utf8",
      );
      ok(lastIdx >= 0, `夹具含 ZZQQ 的块存在（块 #${lastIdx}）`);
      const sem = await mod.searchDocsSemantic(ws2, "ZZQQ", 5, async () => [[1, 0]]);
      const semHit = sem?.[0];
      if (semHit) {
        ok(semHit.snippet.includes("ZZQQ"),
          `语义档 snippet 含命中词（${JSON.stringify(semHit.snippet.slice(0, 60))}）`);
        const atHead = semHit.snippet.replace(/^…/, "").startsWith("填充段落0");
        ok(!atHead, "语义档 snippet 没有退回块首（规范 §6 第 1 条 —— 这正是原 bug）");
      } else {
        ok(false, "语义档一条都没命中（前置不成立：向量缓存没被读到？）");
      }
    } finally {
      rmSync(ws2, { recursive: true, force: true });
    }
  } else {
    ok(false, "找不到 searchDocsSemantic —— 语义档无法测");
  }
} finally {
  rmSync(ws, { recursive: true, force: true });
}

console.log(`\n【kb】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
