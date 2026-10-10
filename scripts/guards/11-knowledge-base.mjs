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
import { codeOnly } from "./_ctx.mjs";
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

  // ── 判据 4b（2026-10-10 新增）：**中文无空格查询必须能召回** ──────────────
  // ⛔⛔ 这是实测抓到的真 bug 的回归防线：全文档档原来用 `query.toLowerCase().split(/\s+/)`
  //   分词 ⇒ 中文没有空格，"记忆库容量" 切出来是一个整串 token，`indexOf` 只能命中
  //   **完全连续**的同一串；而文档里写的是「记忆库**的**容量」⇒ 实测召回 **0 条**
  //   （查询里手动加个空格才有 1 条）。⇒ 夹具故意让**查询用词 ≠ 文档用词**且**不含空格**，
  //   这正是用户最自然的提问方式。0 条 = 那个 bug 回来了。
  {
    const zhWs = mkdtempSync(join(tmpdir(), "kb-guard-zh-"));
    mkdirSync(join(zhWs, ".codex-harness", "knowledge"), { recursive: true });
    try {
      addDocument(zhWs, { title: "中文召回样本", text: "记忆库的容量上限是三万字。超过之后尾部内容会被截断。", source: "guard" });
      const zhHits = searchDocs(zhWs, "记忆库容量", 5);
      ok(zhHits.length > 0, `中文无空格查询能召回（"记忆库容量" → ${zhHits.length} 条）`);
      // ⛔ 反向：放宽分词最容易引入的副作用是"什么都能召回" —— 库里没有的词必须 0 条。
      const missHits = searchDocs(zhWs, "量子纠缠西瓜糖", 5);
      ok(missHits.length === 0, `库里没有的词不召回（防分词放宽 ⇒ 噪声召回，实际 ${missHits.length} 条）`);
    } finally {
      rmSync(zhWs, { recursive: true, force: true });
    }
  }

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

  // ── 判据 6（2026-10-04 用户问「写入知识库的工具有配置好后」补）：模型侧必须有**写**工具 ──
  // ⛔ 缺口真相：当时 `kb:add-text` / `kb:add-files` 通道**只有 IPC、没有模型工具** ⇒
  //   用户只能手动在设置页里存，Codex 自己写不进去。能力清单里还列着通道名 ⇒
  //   读代码会以为"配好了"。⇒ 必须钉工具清单里的**读写两侧**都在。
  {
    const branchOf = (src, tool) => {
      const i = src.indexOf(`name === "${tool}"`);
      if (i < 0) return "";
      const j = src.indexOf('if (name === "', i + 10);
      return src.slice(i, j < 0 ? i + 4000 : j);
    };
    const core = readFileSync(join(ROOT, "dist-electron", "features", "dispatch-core.js"), "utf8");
    const rpc = readFileSync(join(ROOT, "dist-electron", "features", "dispatch-rpc.js"), "utf8");
    const toolNames = [...core.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    ok(toolNames.includes("knowledge_search"), "模型侧有 knowledge_search（读）");
    ok(toolNames.includes("knowledge_add"), "模型侧有 knowledge_add（写）—— 缺它就退化成只能手动存");
    // ⛔ 声明了不等于能跑：执行端也必须有同名分支
    ok(/name === "knowledge_add"/.test(rpc), "knowledge_add 有执行端分支（只声明不接 = 点了没反应）");
    // ⚠️ 权限闸：被委派会话不该能改项目知识库（同⛔ 用结构边界，不用固定窗口）
    ok(
      /restrictedThreadRole/.test(branchOf(rpc, "knowledge_add")),
      "knowledge_add 受 restrictedThreadRole 闸（专家/被调度会话不许写知识库）",
    );
    /*⛔⛔ 判据 7（2026-10-04 用户问「读和写还有索引工具都有了吧」查出来的缺口）：
       补向量原来**只在 UI 两条路径**里调（knowledge-base-ipc.ts 的 add-text / add-files），
       模型这条路绕过了它 ⇒ 模型写进去的知识**只有全文索引、没有向量索引**，
       语义检索永远召不回，**且用户看不到任何报错**。
       ⚠️ 这类缺口只看"工具在不在清单里"抓不到 —— 必须钉**写入路径有没有接索引**。
       ⛔⛔ 判据形状：不能用「`knowledge_add[\s\S]{0,900}embedInBackground`」这种
       **固定字符窗口** —— 实测真实距离 1671 字符（我注释写长了），窗口不够就恒红。
       ⇒ 改成「**取该工具分支到下一个 `if (name ===` 之间**的片段」（结构边界，与长度无关）。
       这与「切片窗口不能靠下一个 handler / 用结构不用字符数」是同一条纪律。 */
    const addBranch = branchOf(rpc, "knowledge_add");
    ok(
      /embedInBackground/.test(addBranch) && /kbEmbeddingInstalled/.test(addBranch),
      "knowledge_add 会补语义向量索引（否则模型写的知识只有全文索引、语义档永远召不回）",
    );
    // ⛔⛔ 查**产物**时必须用 **CJS 形态**：TS 的 `export function` 编译成
    //   `exports.xxx = xxx`，产物里**搜不到 "export function"**。
    //   我第一版写 `/export function embedInBackground/` ⇒ 恒红，差点以为"没导出"。
    ok(
      /exports\.embedInBackground\s*=/.test(
        readFileSync(join(ROOT, "dist-electron", "features", "knowledge-base-ipc.js"), "utf8"),
      ),
      "embedInBackground 已导出（模型侧要复用它，否则又变成两套索引逻辑）—— 查 CJS 形态 exports.x =",
    );

    /* ── 判据 8（2026-10-04 用户拍板「Laya 未装照旧、装了增强」；2026-10-05 按校准改形）──
       校准（scripts/calibrate-laya-kb.mjs）定案：写入门禁（knowledge/chatter 问法）与重复拦截可用，
       **检索相关性过滤不可用**（三种问法模型都把一切候选判 relevant，0.80+ 置信）⇒ 已砍。
       ⛔ fail-open 是命门：Laya 未装 / 未就绪 / 超时 = 弃权放行，门禁绝不能丢知识。
       ⛔ UI 手动路径（knowledge-base-ipc.ts）不许接门禁 —— 用户手动导入是明确意图，不掺模型判断。 */
    const layaDist = readFileSync(join(ROOT, "dist-electron", "features", "laya-service.js"), "utf8");
    ok(/exports\.layaJudge\s*=/.test(layaDist), "layaJudge 已导出（软增强的唯一入口，查 CJS 形态）");
    ok(/exports\.layaJudgeAll\s*=/.test(layaDist), "layaJudgeAll 已导出（重复拦截用一次 HTTP 多问，不许 N 次往返）");
    // 就绪门槛：layaJudge 必须先查 proc/ready（⛔ 不为一次判断拉起 1.7GB 服务 —— 思考档同款纪律）。
    // ⛔ 锚在 **函数体**（async function layaJudge 起）：文件头的 exports 赋值块在所有函数体之前，
    //   从 exports.layaJudge 往后搜 `!proc || !ready` 会命中 **layaDecideEffort** 的同款判断 ⇒ 假绿。
    // ⛔ 窗口必须**止于 layaJudgeAll 的函数声明**：layaFn 若切到文件尾，正则会命中
    //   layaJudgeAll 里的同款就绪判断 ⇒ 变异改坏 layaJudge 本体也不红（实测抓过）。
    const layaFn = layaDist.slice(
      layaDist.indexOf("async function layaJudge"),
      layaDist.indexOf("async function layaJudgeAll") < 0 ? undefined : layaDist.indexOf("async function layaJudgeAll"),
    );
    ok(
      /!\s*proc\s*\|\|\s*!\s*ready[\s\S]*?Promise\.race/.test(layaFn),
      "layaJudge 先查服务就绪再判 + 超时兜底（未就绪弃权，不为判断拉起服务）",
    );
    ok(
      /answer_confidence\s*\?\?/.test(layaDist),
      "判定置信读 answer_confidence（校准实测：confidence 是行动门限、可能低到 0.10，拿它判定会全部弃权）",
    );
    const searchBranch = branchOf(rpc, "knowledge_search");
    ok(
      /layaJudge/.test(addBranch) && /"chatter"/.test(addBranch) && /未写入知识库/.test(addBranch),
      "knowledge_add 接了 Laya 写入门禁（校准问法 knowledge/chatter，判 chatter 拒写并说明）",
    );
    // ⛔ fail-open 形状：写入门禁自己的 try/catch 必须存在于「第一个 layaJudge → layaJudgeAll」
    //   的窗口内。光搜 `layaJudge…catch` 不够 —— 分支后段重复拦截还有第二个 try/catch，会顶替命中
    //   （变异实测：删掉门禁的 catch，正则靠重复拦截的 catch 假绿）。
    const gateSection = addBranch.slice(
      addBranch.indexOf("layaJudge"),
      addBranch.indexOf("layaJudgeAll") < 0 ? undefined : addBranch.indexOf("layaJudgeAll"),
    );
    ok(
      /catch/.test(gateSection),
      "写入门禁 fail-open（layaJudge 环节被 try/catch 包住，异常不拦写入）",
    );
    ok(
      /searchDocs/.test(addBranch) && /"duplicate"/.test(addBranch),
      "knowledge_add 接了 Laya 重复拦截（同名挡不住换标题的重复内容，校准 4/5、错在漏放方向）",
    );
    // 负向断言（校准定案）：检索不许接 Laya 过滤 —— 模型把一切候选判 relevant，接上只会随机丢真命中。
    ok(
      !/layaJudge/.test(searchBranch),
      "knowledge_search 不接 Laya 过滤（校准三问法全不可用；想加回来必须先重跑校准并推翻结论）",
    );
    ok(
      /Laya 智能判断/.test(core),
      "knowledge_add 工具描述写了 Laya 门禁（模型不知道门禁存在 = 被拒后不知所措）",
    );
    // 负向断言：UI 手动路径不接门禁。⛔ 查**源码**必须过 codeOnly 剥注释（注释里提 laya 会假红）
    ok(
      !/laya/i.test(codeOnly(readFileSync(join(ROOT, "electron", "features", "knowledge-base-ipc.ts"), "utf8"))),
      "UI 手动路径（kb:add-text / kb:add-files）不接 Laya 门禁（用户手动导入是明确意图）",
    );
  }
} finally {
  rmSync(ws, { recursive: true, force: true });
}

console.log(`\n【kb】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
