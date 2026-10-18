/**
 * 中文友好的文本匹配（纯函数、零依赖）：分词 · 相关性门槛 · 加权评分 · snippet 定位。
 *
 * ⛔⛔ 为什么必须有这个模块（2026-10-10 实测抓到的真 bug）：
 *   知识库全文档档原来用 `query.toLowerCase().split(/\s+/)` 分词 —— **中文没有空格**，
 *   `"记忆库容量"` 切出来就是一个整串 token，`indexOf` 只能命中**完全连续**的同一串；
 *   而文档里写的是「记忆库**的**注入预算」⇒ 实测召回 **0 条**（查询里手动加空格才有 1 条）。
 *   ⇒ 中文检索的可用性不能建立在「用户记得加空格」上。
 *
 * 分词口径与 `electron/memory-fabric.ts` 的 `tokenize()` **保持一致**（那边有实跑背书：
 * 「查一个项目里没有的词，召回了 6 条」就是靠 isRelevant 的双阈值压下去的）。
 * ⛔ 为什么不直接 import 记忆那一侧：① 知识库是叶子模块，不该拉起 memory-layers /
 *   role-memory 一整条链；② 守卫【11l】钉住了记忆侧的 isRelevant 必须**内联可验**
 *   （断言含 `shortHits / shortTotal >= 0.34` 字面量）⇒ 那边不能改成 import。
 *   ⇒ 两侧各自持有同口径实现，改动时**必须同时改**（守卫 11-knowledge-base 有一条端到端
 *     实测断言钉住"中文无空格查询必须召回"，任一侧改坏都会红）。
 */

/** CJK 判定（含扩展 A 区） */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
/** 词边界：空白 + 中英标点 */
const SEP = /[\s,.;:!?，。；：！？、"'“”‘’（）()\[\]【】{}<>《》/\\|·—～]+/;

/**
 * 查询分词。产出三类 token（语义互补）：
 *   ① **整词**：按空白与标点切出的片段（ASCII 词与中文短语都收）—— 长 token 有区分度；
 *   ② **中文双字 bigram**：中文没有空格，只有 bigram 才能在「记忆库容量」↔「记忆库的容量」
 *      这种词形变化下召回（句内标点拆开时 ① 命不中，② 仍能命中）；
 *   ⛔ **不收单字**：中文单字命中率天然偏高（"的/是/在"），收进来只会让无关块也"命中"。
 */
export function tokenizeQuery(query: string): string[] {
  const s = String(query ?? "").toLowerCase().trim();
  if (!s) return [];
  const out = new Set<string>();
  /* ① 整词 */
  for (const piece of s.split(SEP)) {
    const p = piece.trim();
    if (!p) continue;
    if (!CJK.test(p)) out.add(p);            // 纯 ASCII/数字：整词（含 kb、pnpm 这类短词）
    else if (p.length >= 2) out.add(p);      // 中文短语：整串（单字留给 ② 排除）
  }
  /* ② 中文双字 bigram + ASCII 双字（跨标点滑窗，故用去掉标点的 dense） */
  const dense = s.replace(/[^\u4e00-\u9fff\w]+/g, "");
  for (let i = 0; i + 1 < dense.length; i += 1) {
    const a = dense[i];
    const b = dense[i + 1];
    if (CJK.test(a) && CJK.test(b)) out.add(a + b);
  }
  return [...out];
}

/** token 权重：越长越有区分度。⛔ 短 token 权重必须低 —— 否则一个只碰巧含"容量"的块
 *  会排在真正讲了「记忆库容量」的块前面。 */
export function tokenWeight(token: string): number {
  const n = token.length;
  if (n >= 4) return 4;
  if (n === 3) return 3;
  if (n === 2) return 1.5;
  return 1;
}

/**
 * 相关性门槛。⛔ 不能是「命中任意 token 就算」：分词产出 bigram 后，
 * 查「蓝绿部署」会拆出「部」「署」「蓝绿」…，随便哪条含一个 bigram 就算命中 ⇒
 * 查一个项目里没有的词也会召回一堆（记忆侧实跑抓到过 6 条噪声）。
 * ⇒ 长 token（≥3 字）命中任意一个即算相关；短 token 必须命中**足够比例**才算。
 */
export function isChunkRelevant(chunk: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const lower = chunk.toLowerCase();
  let shortHits = 0;
  let shortTotal = 0;
  for (const t of tokens) {
    if (t.length >= 3) { if (lower.includes(t)) return true; continue; }
    shortTotal += 1;
    if (lower.includes(t)) shortHits += 1;
  }
  if (!shortTotal) return false;
  /* ⛔ 门槛 0.34：低于它基本是噪声（中文短 token 命中率天然偏高）。
     例外：查询很短（≤2 个 token）时要求至少命中 1 个。 */
  return shortTotal <= 2 ? shortHits >= 1 : shortHits / shortTotal >= 0.34;
}

/** 加权原始分：Σ 权重 × (1 + 词频加成)。词频加成饱和在 8 次 —— 同一个词刷满一整块
 *  不该把分数顶到天上（那会淹没"命中了另一个更有区分度的词"的块）。 */
export function scoreChunk(chunk: string, tokens: string[]): number {
  const lower = chunk.toLowerCase();
  let raw = 0;
  for (const t of tokens) {
    let count = 0;
    let at = lower.indexOf(t);
    while (at >= 0) { count += 1; at = lower.indexOf(t, at + t.length); }
    if (!count) continue;
    raw += tokenWeight(t) * (1 + Math.min(count - 1, 7) * 0.2);
  }
  return raw;
}

/** 该 query 的理论满分（所有 token 都命中且词频饱和）—— 用来把原始分归一到 0..1。
 *  ⛔ 归一化是必须的：语义档的 cosine 本来就在 0..1，而全文档档的加权和是 0.5~30 量级；
 *  两档分数要放进**同一张表**排序就必须同量纲（规范 docs/KNOWLEDGE-BASE.md §6 第 2 条）。 */
export function maxChunkScore(tokens: string[]): number {
  return tokens.reduce((sum, t) => sum + tokenWeight(t) * (1 + 7 * 0.2), 0);
}

/** snippet 定位：取**最长命中 token** 的出现位置（长 token 更有信息量；
 *  长度相同取更靠前的）。全不命中返回 -1。 */
export function bestHitIndex(chunk: string, tokens: string[]): number {
  const lower = chunk.toLowerCase();
  let best = -1;
  let bestLen = -1;
  for (const t of tokens) {
    const at = lower.indexOf(t);
    if (at < 0) continue;
    if (t.length > bestLen || (t.length === bestLen && (best < 0 || at < best))) {
      best = at;
      bestLen = t.length;
    }
  }
  return best;
}
