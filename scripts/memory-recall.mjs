#!/usr/bin/env node
/**
 * 记忆**召回口径**（10-17，P0-2）
 *
 * ⛔⛔ 为什么必须补：此前**所有**验证都只回答"该不该写"（写入判据），**从不回答"找不找得到"**。
 *    而生态里的共识是 —— **记忆的质量等于召回的质量，不是存了多少**（SkillHub `agent-memory-systems`）。
 *    没有这个口径，改动只能证明"判据按预期工作"，证明不了"记忆有用"。
 *
 * 测的是**换措辞还找不找得到**：查询与条目**刻意不共享字面**（"正则匹配中文失败" vs
 * "别用 \\b 匹配中文"）。⛔ 用例若用条目原文当查询，命中率必然 100%，那种口径是自欺。
 *
 * 两条检索路径都测（它们是两套实现，必须分别有口径）：
 *   · L7 碎片池：`MemoryStore.search`（词命中 × 分类权重 × 时间衰减）
 *   · 知识库：`text-match` 的 bigram（中文分词）
 *
 * 用法：node scripts/memory-recall.mjs [--json]
 * ⛔ 判据是**回归**：改动不许让命中率变差（守卫【memGate】钉住下界）。
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const AS_JSON = process.argv.includes("--json");

const { MemoryStore } = await mod("dist-electron/memory-store.js");
const tm = await mod("dist-electron/text-match.js");
const { CORRECTION_CATEGORY, PITFALL_CATEGORY, SOP_CATEGORY } = await mod("dist-electron/memory-lessons.js");

/** 样本集：全部取自**本项目的真实纪律**（不是编的），措辞与查询刻意错开。 */
const FIXTURE = [
  ["上游地址只许一个决策点，两处各写会互相覆盖", SOP_CATEGORY],
  ["网络抖动被当成删除会重复建库，必须区分确定 404 与未知", PITFALL_CATEGORY],
  ["中文检索必须用 bigram 分词，按空白切分对无空格中文零召回", PITFALL_CATEGORY],
  ["内容高度变化后必须重算贴底，两个 owner 都要覆盖", PITFALL_CATEGORY],
  ["暗色下原生控件按浅色绘制，computed 会骗人，必须 appearance none", PITFALL_CATEGORY],
  ["令牌会轮换，配置里存快照会失效，要做令牌环", PITFALL_CATEGORY],
  ["别用反斜杠 b 匹配中文，CJK 不属于单词字符", PITFALL_CATEGORY],
  ["巨文件棘轮的口径是净代码行，不是总行数", SOP_CATEGORY],
  ["判据必须真的接线，只存在不接等于没有", PITFALL_CATEGORY],
  ["用户说保留甲去掉乙时，先把乙的每个拥有者列全再删", CORRECTION_CATEGORY],
  ["删除前必须客户端侧核验归属，别信上游的过滤参数", CORRECTION_CATEGORY],
  ["管道接 head 会让进程收到管道中断信号而退出", PITFALL_CATEGORY],
  ["断言要锚行为不要锚注释文本", PITFALL_CATEGORY],
  ["苹果系统上路径要用 path.join，读文件要容忍回车换行", SOP_CATEGORY],
  ["写入判据是启发式，被拒必须留痕便于复盘", SOP_CATEGORY],
  ["云端记忆在对话层注入，没有记忆读写接口", SOP_CATEGORY],
  ["每账号一把用户钥匙，隔离靠它不靠实例", SOP_CATEGORY],
  ["记忆技能默认启用不可停用，关掉不会报错只会静默失效", SOP_CATEGORY],
  ["敏感信息默认不记，密钥不能落盘", SOP_CATEGORY],
  ["同一现象出现第二次要升级成技能，不要再写一条记忆", SOP_CATEGORY],
];

/** 查询：**改过措辞**（口语、换词、不共用字面），直指 FIXTURE 里对应下标。 */
const QUERIES = [
  ["两个地方都设置服务地址会怎样", 0],
  ["为什么会出现重复建库", 1],
  ["中文搜索搜不到东西", 2],
  ["改了内容高度之后滚动位置不对", 3],
  ["暗色主题下按钮变成白色", 4],
  ["换了密钥之后旧配置为什么失效", 5],
  ["正则匹配中文失败", 6],
  ["文件行数超标怎么算", 7],
  ["写了断言但没生效", 8],
  ["用户要求删掉某个功能该怎么做", 9],
  ["批量删除误删了别人的数据", 10],
  ["启动应用后自己退出了", 11],
  ["断言总是误报", 12],
  ["苹果电脑上读文件多了个字符", 13],
  ["拒绝了写入怎么知道原因", 14],
  ["云端记忆有查询接口吗", 15],
  ["怎么区分不同用户的记忆", 16],
  ["记忆技能能关掉吗", 17],
  ["用户贴了密码会怎样", 18],
  ["同样的问题又犯了", 19],
];

const dir = mkdtempSync(join(tmpdir(), "recall-"));
const file = join(dir, "memory.json");
const stamp = Date.now();
writeFileSync(
  file,
  JSON.stringify(
    FIXTURE.map(([content, category], i) => ({ id: `fx-${i}`, content, category, confidence: 0.9, updatedAt: stamp - i * 3600_000 })),
    null,
    2,
  ),
  "utf8",
);

const store = new MemoryStore(file);
const rows = [];
for (const [query, want] of QUERIES) {
  const hits = await store.search(query, 5);
  const idx = hits.findIndex((h) => h.id === `fx-${want}`);
  /* 知识库侧：bigram 打分（取最高分的条目下标） */
  const tokens = tm.tokenizeQuery(query);
  let best = -1;
  let bestScore = 0;
  FIXTURE.forEach(([content], i) => {
    const s = tm.scoreChunk(content, tokens);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  rows.push({ query, want, top1: idx === 0, top5: idx >= 0, rank: idx + 1, bigramTop1: best === want, wantText: FIXTURE[want][0].slice(0, 24) });
}

const n = rows.length;
const pct = (c) => Math.round((c / n) * 100);
const stat = {
  queries: n,
  poolTop1: pct(rows.filter((r) => r.top1).length),
  poolTop5: pct(rows.filter((r) => r.top5).length),
  bigramTop1: pct(rows.filter((r) => r.bigramTop1).length),
};

rmSync(dir, { recursive: true, force: true });

/* ⛔ 回归下界：**不许让召回变差**。改动如果掉到线下，直接非零退出。
   取当前实测值**下探一档**作为地板（不是目标值）——留出正常波动的余量，只在真退化时打红。 */
const FLOOR = { poolTop1: 70, poolTop5: 80, bigramTop1: 65 };
const CHECK = process.argv.includes("--check");

if (AS_JSON) {
  console.log(JSON.stringify({ ...stat, floor: FLOOR, rows }, null, 2));
} else {
  console.log(`\n记忆召回口径（${n} 条查询，措辞与条目刻意错开）`);
  console.log(`  L7 碎片池 首位命中  ${stat.poolTop1}%   ·  前五命中 ${stat.poolTop5}%`);
  console.log(`  知识库 bigram 首位命中  ${stat.bigramTop1}%`);
  const miss = rows.filter((r) => !r.top5);
  if (miss.length) {
    console.log(`\n  ⛔ 前五都没命中的 ${miss.length} 条（召回缺口）：`);
    for (const m of miss) console.log(`     「${m.query}」 → 期望「${m.wantText}…」`);
  }
  const near = rows.filter((r) => r.top5 && !r.top1);
  if (near.length) {
    console.log(`\n  ⚠️ 命中但不在首位（排序问题，非召回问题）${near.length} 条：`);
    for (const m of near.slice(0, 8)) console.log(`     「${m.query}」 → 第 ${m.rank} 位`);
  }
  if (CHECK) {
    const below = Object.entries(FLOOR).filter(([k, v]) => stat[k] < v);
    console.log(below.length
      ? `\n  ✗ 低于回归地板：${below.map(([k, v]) => `${k} ${stat[k]}% < ${v}%`).join(" · ")}`
      : `\n  ✓ 全部高于回归地板（${Object.entries(FLOOR).map(([k, v]) => `${k}≥${v}`).join(" · ")}）`);
    if (below.length) process.exitCode = 1;
  }
}
