#!/usr/bin/env node
/**
 * Laya × 知识库 判定校准（2026-10-04，方案 1：先校准再谈效果）
 *
 * ⛔ 为什么存在：dispatch-rpc.ts 里三处阈值（写入门禁 0.6 / 重复拦截 0.6 / 检索过滤 0.6）
 *   是拍脑袋值 —— laya 的思考等级功能当年实测发现 multilingual checkpoint 有**系统性偏置**
 *   （对中高档压缩到 medium），不校准就不知道这些阈值是松是紧。
 *
 * 做什么：拉起本机 laya-serve（权重已缓存，秒级），跑三组夹具：
 *   ① 写入门禁 —— 6 条真知识 vs 6 条废话，输出各阈值下的准确率/误杀率；
 *   ② 重复拦截 —— 3 对改写重复（应判 duplicate）+ 2 对不同主题（应判 new）；
 *   ③ 检索过滤 —— 1 组查询 × 6 候选（2 相关 4 不相关），逐条 relevant/irrelevant。
 * 按置信度 0.40~0.85 逐档统计，最后打印推荐阈值。
 *
 * 用法：node scripts/calibrate-laya-kb.mjs            （跑全量并给建议）
 *      node scripts/calibrate-laya-kb.mjs --keep      （跑完不杀服务，便于反复调）
 *
 * ⛔ 只读本地服务，不联网；权重走 ~/.cache/huggingface（convaiinnovations/laya）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");

/* ── 解析 python：与 laya-service 同源优先级，另兜底 python.fat-laya（本机实测 laya 装在这） ── */
function resolvePython() {
  const candidates = [
    process.env.LAYA_PYTHON,
    join(ROOT, "resources", "tools", "python", "python.exe"),
    join(ROOT, "resources", "tools", "python.fat-laya", "python.exe"),
  ].filter(Boolean);
  for (const bin of candidates) {
    if (!existsSync(bin)) continue;
    const probe = spawnSync(bin, ["-c", "import laya"], { encoding: "utf8", timeout: 60_000 });
    if (probe.status === 0) return bin;
    console.log(`  （跳过 ${bin}：import laya 失败）`);
  }
  return null;
}

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── laya HTTP（与 laya-service.layaDecide 同协议）── */
async function decide(port, key, state, questions, timeoutMs = 15_000) {
  const res = await fetch(`http://127.0.0.1:${port}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ state, questions, model: "multilingual" }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).answers ?? {};
}

/** ⛔ 与 laya-service.parseVerdict 同口径：置信读 answer_confidence（所选答案的校准概率），
 *  `confidence` 是行动门限（实测可能低到 0.10），不能当判定置信用。 */
function verdictOf(ans) {
  if (!ans || typeof ans !== "object") return null;
  const choice = String(ans.choice ?? "").toLowerCase();
  if (!choice) return null;
  const confidence = Number(ans.answer_confidence ?? ans.probabilities?.[choice] ?? ans.confidence ?? 0);
  return { choice, confidence };
}

/* ── 夹具 ── */
const WORTH = [
  "接口规则：写 config.toml 的键值走 config/value/write 必须带 mergeStrategy: \"replace\"，缺了整条请求被拒 Invalid request。",
  "决策：知识库分块 CHUNK_SIZE=700 字符、块间重叠 80 字符——跨界的句子至少在一块里完整，召回才不漏。",
  "踩坑：slice(-0) 返回整串而不是空串，CHUNK_OVERLAP=0 时每块都含全文，判据恒真。负数下标入参必须先判 0。",
  "配置说明：语音模型走 sherpa-onnx 三件套，识别 4 种常见目录布局，SHA256 校验后落盘到 userData/voice-models/。",
  "结论：压缩线永远在下面是 item 类型大小写不匹配导致整条链静默失配，修法是把 type 归一小写再入档。",
  "规范：所有临时产物一律写 .workbuddy/tmp/，不许落仓库根和盘根；临时脚本跑完即删。",
];
const JUNK = [
  "好的，我知道了，谢谢！",
  "嗯嗯，那就这样吧，回头再说。",
  "今天中午吃什么呢，好纠结啊，附近新开了家川菜馆。",
  "稍等，我切个屏，马上回来。",
  "哈哈哈哈这个表情包太好笑了。",
  "帮我看看现在几点了？",
];
const DUP_PAIRS = [
  {
    base: "决策：供应商最大并发 DEFAULT_MAX_CONCURRENCY=10，主进程 custom-model-types.ts 与渲染层 concurrency.mjs 两处字面量必须同源，改一处必须同步另一处。",
    para: "已经定了：最大并发数默认 10（DEFAULT_MAX_CONCURRENCY），custom-model-types.ts 和渲染侧 concurrency.mjs 里各写了一份字面量，两边要一起改。",
  },
  {
    base: "踩坑：e2e 持久 profile .e2e-profile/main 被另一个实例占用时，新实例表现为启动卡住、界面文件更新中，像应用被改坏了。正确处置是 --profile 另开一份。",
    para: "注意：跑 e2e 时如果 .e2e-profile/main 被别的实例占着，新实例会启动卡死、报界面文件正在更新，看着像改坏了应用——其实用 --profile 换个名字就好。",
  },
  {
    base: "规范：所有中间产物（命令回显、探针 dump、截图、临时脚本）一律写进 .workbuddy/tmp/，不许落仓库根，更不许落 D 盘根。",
    para: "临时文件管理：命令回显、扫描输出、截图这类中间产物统一放到 .workbuddy/tmp 目录，禁止堆在仓库根目录或 D 盘根目录。",
  },
];
const NEW_PAIRS = [
  {
    base: "决策：知识库分块 CHUNK_SIZE=700 字符、块间重叠 80 字符。",
    para: "决策：自动压缩比例默认 0.6，渲染层与主进程两侧同源，改动时两侧一起改。",
  },
  {
    base: "配置说明：语音模型走 sherpa-onnx 三件套，落盘到 userData/voice-models/。",
    para: "踩坑：PowerShell 按 GBK 写管道时汉字尾字节可能是反斜杠的 ASCII 码，输出 JSON 直接被打断，脚本必须强制 UTF-8 输出。",
  },
];
const RERANK_QUERY = "知识库的分块规则是什么？块间重叠多少字符？";
const RERANK_CANDIDATES = [
  { title: "知识库索引规范", text: "分块 CHUNK_SIZE=700 字符，块间重叠 80 字符，跨界的句子至少在一块里完整。", rel: true },
  { title: "KB 存储布局", text: "文档存 docs/<docId>.md 与 .json 元信息，向量缓存在 .cache/embeddings/，可随时重建。", rel: false },
  { title: "压缩链结论", text: "宿主真压缩摘要：超过自动压缩阈值 0.6 时换新会话把历史压下去，压缩比例两侧同源。", rel: false },
  { title: "分块与重叠", text: "块间必须有重叠，否则跨界句子召回不到；重叠不得等于整块，那是没切而不是重叠。", rel: true },
  { title: "办公室渲染", text: "遮挡顺序 = 显示器、桌、人、椅，三件物体各按自己的地面基线 y 排 zIndex。", rel: false },
  { title: "Windows 脚本坑", text: "PowerShell 5.1 按 GBK 写管道，汉字尾字节可能是反斜杠的 ASCII 码，JSON 会被打断。", rel: false },
];

/* ── 统计（verdicts = laya answers 里**问题名**下的原始应答，不是按选项名键控——第一版在这翻过车） ── */
function thresholdTable(items, note) {
  const rows = [];
  for (let t = 0.40; t <= 0.8501; t += 0.05) {
    let right = 0, wrong = 0, abstain = 0;
    for (const it of items) {
      const v = verdictOf(it.verdicts);
      if (!v || v.confidence < t) { abstain++; continue; }
      if (v.choice === it.expect) right++; else wrong++;
    }
    const decided = right + wrong;
    rows.push({ t: t.toFixed(2), acc: decided ? ((right) / decided).toFixed(2) : "-", wrong, abstain });
  }
  return rows;
}

function printTable(rows, note) {
  console.log(`  阈值  准确率  判错  弃权   ${note}`);
  for (const r of rows) console.log(`  ${r.t}   ${r.acc}    ${r.wrong}     ${r.abstain}`);
}

async function main() {
  const py = resolvePython();
  if (!py) { console.error("✗ 找不到装了 laya 的 python（试过 LAYA_PYTHON / python / python.fat-laya）"); process.exit(1); }
  console.log(`python: ${py}`);
  const port = await freePort();
  const key = "calib-local";
  const child = spawn(py, ["-c", "from laya.serve import main; main()"], {
    env: { ...process.env, LAYA_HOST: "127.0.0.1", LAYA_PORT: String(port), LAYA_API_KEY: key, LAYA_MODELS: "multilingual", LAYA_PRELOAD: "1", LAYA_THREADS: "4" },
    stdio: "ignore", windowsHide: true,
  });
  const kill = () => { try { child.kill(); } catch { /* 已退出 */ } };
  process.on("exit", () => { if (!KEEP) kill(); });
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { up = true; break; }
    } catch { /* 还没起 */ }
    await sleep(1000);
  }
  if (!up) { console.error("✗ laya-serve 120s 内没起来（首启要拉权重，机器慢可重试）"); kill(); process.exit(1); }
  console.log(`laya-serve 就绪 :${port}，开始跑夹具…\n`);
  const t0 = Date.now();

  /* ① 写入门禁 */
  const gateItems = [];
  // 问法 v2（v1 实测把 6 条真知识全判 junk ⇒ 不可用）：改成两分类等长描述、中性提问
  const GATE_Q = { type: "choice", instructions: "下面是一条用户想让 AI 存进项目知识库的内容。判断它属于哪一类。", criteria: { knowledge: "项目知识：开发规范、技术结论、踩坑经验、配置或接口说明、决策记录，有实质信息量。", chatter: "非知识：寒暄、闲聊、情绪表达、口头招呼、无实义内容。" } };
  for (const text of WORTH) {
    const a = await decide(port, key, text.slice(0, 4000), { g: GATE_Q });
    gateItems.push({ expect: "knowledge", verdicts: a.g });
  }
  for (const text of JUNK) {
    const a = await decide(port, key, text.slice(0, 4000), { g: GATE_Q });
    gateItems.push({ expect: "chatter", verdicts: a.g });
  }
  console.log("① 写入门禁（knowledge=6 / chatter=6，问法 v2）");
  printTable(thresholdTable(gateItems), "误杀真知识比漏放废话更伤");
  console.log(gateItems.map((it, i) => { const v = verdictOf(it.verdicts); return `${it.expect}｜${v?.choice ?? "-"} ${v?.confidence?.toFixed(2) ?? "-"}｜${(i < WORTH.length ? WORTH : JUNK)[i % WORTH.length].slice(0, 24)}`; }).join("\n"));

  /* ② 重复拦截 */
  const dupItems = [];
  for (const pair of [...DUP_PAIRS.map((p) => ({ ...p, expect: "duplicate" })), ...NEW_PAIRS.map((p) => ({ ...p, expect: "new" }))]) {
    const a = await decide(port, key, `${pair.base}\n${pair.para}`.slice(0, 4000), {
      d: { type: "choice", instructions: `已有知识条目：\n${pair.base.slice(0, 400)}\n新写入内容：\n${pair.para.slice(0, 400)}\n判断新内容相对这条已有条目是否重复。`, criteria: { duplicate: "重复：讲的是同一件事，已有条目已覆盖，没有新增信息", new: "新知识：内容不同或有新增信息，值得另存一条" } },
    });
    dupItems.push({ expect: pair.expect, verdicts: a.d });
  }
  console.log("\n② 重复拦截（duplicate=3 / new=2）");
  printTable(thresholdTable(dupItems), "判 duplicate 会拒写，宁漏放不误杀");
  console.log(dupItems.map((it) => { const v = verdictOf(it.verdicts); return `${it.expect}｜${v?.choice ?? "-"} ${v?.confidence?.toFixed(2) ?? "-"}`; }).join("\n"));

  /* ③ 检索过滤 */
  const relItems = [];
  // 问法 v3（v1/v2 实测模型把一切候选都判 relevant ⇒ 不可用）：换成与「重复判断」同构的主题比对
  for (const c of RERANK_CANDIDATES) {
    const a = await decide(port, key, RERANK_QUERY.slice(0, 4000), {
      r: { type: "choice", instructions: `问题主题：知识库的分块规则（块大小、块间重叠）\n候选内容：${c.title} —— ${c.text.slice(0, 200)}\n候选内容与问题主题是不是同一件事？`, criteria: { related: "同一件事：候选内容讨论的就是问题问的主题，或直接回答它", unrelated: "别的事情：候选内容讨论的是其他主题" } },
    });
    relItems.push({ expect: c.rel ? "related" : "unrelated", verdicts: a.r });
  }
  console.log("\n③ 检索过滤（related=2 / unrelated=4，问法 v3 主题比对）");
  printTable(thresholdTable(relItems), "判 unrelated 会丢弃候选，宁保留不误删");
  console.log(relItems.map((it, i) => { const v = verdictOf(it.verdicts); return `${it.expect}｜${v?.choice ?? "-"} ${v?.confidence?.toFixed(2) ?? "-"}｜${RERANK_CANDIDATES[i].title}`; }).join("\n"));

  console.log(`\n总耗时 ${(Date.now() - t0) / 1000 | 0}s`);
  console.log("⛔ 阈值取舍原则：写入门禁挑「误杀=0」的档（拦错废话比放过废话代价小）；重复拦截与检索过滤挑「判错=0 且弃权少」的档。回填 dispatch-rpc.ts 三处 minConfidence 并同步守卫。");
  if (!KEEP) kill();
}

main().catch((err) => { console.error(err); process.exit(1); });
