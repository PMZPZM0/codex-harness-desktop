/**
 * 团队模式 · 扩展能力单测（用量账本 / 群菜单 / 卡片解析）
 * ⛔ 纯函数测试，不碰 IPC、不碰 React。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_LEDGER_ENTRIES,
  appendLedger,
  formatChars,
  formatMs,
  normalizeLedgerEntry,
  summarizeLedger,
} from "../src/lib/team-ledger.mjs";
import {
  DEFAULT_GROUP_MENU,
  MENU_MAX_ITEMS,
  addMenuLeaf,
  findMenuLeaf,
  flattenMenu,
  menuPickResult,
  normalizeMenu,
  removeMenuLeaf,
  shouldShowMenuButton,
} from "../src/lib/team-menu.mjs";
import { cardToPlain, parseCard, parseInline } from "../src/lib/team-card.mjs";

/* ── 用量账本（豆包 §2.④：维度是 (agent, 触发来源)）────────────────────────── */

test("账本：缺 memberId 判无效；source 不认识时归 human", () => {
  assert.equal(normalizeLedgerEntry({ chars: 10 }), null);
  const e = normalizeLedgerEntry({ memberId: "a", source: "乱写", chars: -5, ms: -1 });
  assert.equal(e.source, "human");
  assert.equal(e.chars, 0, "负数收敛成 0（⛔ 别让脏数据把汇总算成负的）");
  assert.equal(e.ok, true, "默认算成功");
  assert.equal(normalizeLedgerEntry({ memberId: "a", ok: false }).ok, false);
});

test("账本：追加有上限，超了丢最老的", () => {
  let list = [];
  for (let i = 0; i < MAX_LEDGER_ENTRIES + 5; i += 1) {
    list = appendLedger(list, { memberId: "a", at: i, chars: i });
  }
  assert.equal(list.length, MAX_LEDGER_ENTRIES);
  assert.equal(list[0].at, 5);
  assert.equal(list[list.length - 1].at, MAX_LEDGER_ENTRIES + 4);
});

test("账本汇总：按 (伙伴, 来源) 拆，窗口外的不要，失败单独计数", () => {
  const now = 1_000_000_000_000;
  const day = 24 * 3600 * 1000;
  const entries = [
    { memberId: "a", partnerName: "承枢", source: "human", at: now - day, chars: 100, ms: 1000, ok: true },
    { memberId: "a", partnerName: "承枢", source: "human", at: now - day * 2, chars: 300, ms: 3000, ok: false, error: "超时" },
    { memberId: "b", partnerName: "执舵", source: "automation", at: now - day * 3, chars: 50, ms: 500, ok: true },
    /* 窗口外（8 天前）—— 不该进 7 天汇总 */
    { memberId: "b", partnerName: "执舵", source: "human", at: now - day * 8, chars: 9999, ms: 9999, ok: true },
  ];
  const s = summarizeLedger(entries, { nowMs: now, days: 7 });
  assert.equal(s.total.count, 3, "窗口外的不计");
  assert.equal(s.total.chars, 450);
  assert.equal(s.total.failed, 1);
  assert.equal(s.total.partners, 2, "两个伙伴");
  assert.equal(s.byPartner[0].memberId, "a", "按字数降序（a=400 > b=50）");
  assert.equal(s.byPartner[0].avgMs, 2000, "均耗时 = 总/次数");
  assert.equal(s.byPartner[0].failed, 1);
  const sourceMap = Object.fromEntries(s.bySource.map((x) => [x.source, x.count]));
  assert.deepEqual(sourceMap, { human: 2, automation: 1 });

  /* 按群过滤 */
  const g = summarizeLedger(
    [{ memberId: "a", groupId: "g1", at: now, chars: 10 }, { memberId: "a", groupId: "g2", at: now, chars: 20 }],
    { nowMs: now, days: 7, groupId: "g1" },
  );
  assert.equal(g.total.chars, 10);
});

test("账本：全窗（days=0）不按时间过滤；格式化不出现负号", () => {
  const s = summarizeLedger([{ memberId: "a", at: 1, chars: 5 }], { days: 0, nowMs: 100 });
  assert.equal(s.total.count, 1, "days=0 ⇒ 从 0 起算");
  assert.equal(formatChars(0), "0");
  assert.equal(formatChars(12345), "1.2 万");
  assert.equal(formatChars(-10), "0");
  assert.equal(formatMs(800), "800ms");
  assert.equal(formatMs(1500), "1.5s");
  assert.equal(formatMs(80000), "1m20s");
});

/* ── 群菜单（飞书 §3）──────────────────────────────────────────────────────── */

test("菜单：叶子必须有 prompt，分组不能当叶子点；重复 key 只留第一个", () => {
  const tree = normalizeMenu([
    { key: "a", label: "A", prompt: "   " },              // 没 prompt 的叶子 ⇒ 丢
    { key: "b", label: "B", children: [{ key: "b1", label: "B1", prompt: "干这个" }] },
    { key: "b1", label: "重名", prompt: "x" },            // key 重复 ⇒ 丢
    { key: "", label: "没 key", prompt: "x" },
  ]);
  assert.deepEqual(tree.map((x) => x.key), ["b"]);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].prompt, "干这个");
});

test("菜单：只有一级（MENU_MAX_DEPTH=2），超过的孙子层被丢掉而不是崩", () => {
  const tree = normalizeMenu([
    { key: "g", label: "G", children: [{ key: "c", label: "C", prompt: "p", children: [{ key: "x", label: "X", prompt: "y" }] }] },
  ]);
  assert.equal(tree[0].children[0].children.length, 0, "第三层不认");
});

test("菜单：摊平带上分组名；按 key 找得到；按钮只在非空时出现", () => {
  const leaves = flattenMenu(DEFAULT_GROUP_MENU);
  assert.ok(leaves.length >= 6);
  assert.ok(leaves.some((x) => x.fullLabel === "汇报 / 今日进展"));
  assert.equal(findMenuLeaf(DEFAULT_GROUP_MENU, "report-daily")?.label, "今日进展");
  assert.equal(findMenuLeaf(DEFAULT_GROUP_MENU, "不存在"), null);
  assert.equal(shouldShowMenuButton({ menu: [] }), false);
  assert.equal(shouldShowMenuButton({ menu: DEFAULT_GROUP_MENU }), true);
});

test("菜单：点一项只给 prompt + 回显，⛔ 不自动发送", () => {
  const r = menuPickResult(DEFAULT_GROUP_MENU, "deliver-plan");
  assert.equal(r.ok, true);
  assert.ok(r.prompt.includes("验收标准"));
  assert.ok(r.message.includes("填进输入框"));
  assert.equal(menuPickResult(DEFAULT_GROUP_MENU, "ghost").ok, false);
});

test("菜单：加自定义指令进「自定义」分组，key 不重复；删空分组会消失", () => {
  let t = addMenuLeaf(DEFAULT_GROUP_MENU, { label: "查库存", prompt: "查一下当前库存" });
  const custom = t.find((x) => x.key === "custom");
  assert.equal(custom?.children.length, 1);
  assert.equal(custom?.children[0].key, "custom-1");
  t = addMenuLeaf(t, { label: "查库存2", prompt: "再查一次" });
  assert.deepEqual(t.find((x) => x.key === "custom").children.map((c) => c.key), ["custom-1", "custom-2"]);

  t = removeMenuLeaf(t, "custom-1");
  t = removeMenuLeaf(t, "custom-2");
  assert.equal(t.some((x) => x.key === "custom"), false, "删空的分组不留空壳");

  /* 空 label / 空 prompt ⇒ 原样返回（⛔ 不造一个点不了的项） */
  assert.deepEqual(addMenuLeaf(DEFAULT_GROUP_MENU, { label: "", prompt: "x" }), normalizeMenu(DEFAULT_GROUP_MENU));
});

test("菜单：一级最多 MENU_MAX_ITEMS 项", () => {
  const many = Array.from({ length: MENU_MAX_ITEMS + 5 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, prompt: "p" }));
  assert.equal(normalizeMenu(many).length, MENU_MAX_ITEMS);
});

/* ── 卡片解析（飞书 §2.2 的本地等价物）────────────────────────────────────── */

test("卡片：标题/段落/表格/列表/代码/引用 各归各类", () => {
  const md = [
    "## 本周汇总",
    "",
    "已完成 3 件事。",
    "",
    "| 门店 | 销量 |",
    "|---|---|",
    "| A | 120 |",
    "| B | 86 |",
    "",
    "- 第一点",
    "- 第二点",
    "",
    "```js",
    "const a = 1;",
    "```",
    "",
    "> 引用一句",
  ].join("\n");
  const blocks = parseCard(md);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "table", "list", "code", "quote"]);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[2].header, ["门店", "销量"]);
  assert.deepEqual(blocks[2].rows, [["A", "120"], ["B", "86"]]);
  assert.deepEqual(blocks[3].items, ["第一点", "第二点"]);
  assert.equal(blocks[4].lang, "js");
  assert.equal(blocks[5].text, "引用一句");
});

test("卡片：代码块里的符号不解析；没闭合也照样收尾", () => {
  const blocks = parseCard(["```", "## 这不是标题", "- 这不是列表", "```"].join("\n"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "code");
  assert.ok(blocks[0].text.includes("## 这不是标题"));

  const open = parseCard(["```", "没闭合"].join("\n"));
  assert.equal(open[0].type, "code");
  assert.equal(open[0].text, "没闭合");
});

test("卡片：整齐的表格不会误判（缺分隔行就是普通段落）", () => {
  const blocks = parseCard("| a | b |");
  assert.equal(blocks[0].type, "paragraph");
});

test("行内：粗体/代码/链接；非 http 协议当文本", () => {
  const spans = parseInline("**粗** 与 `code` 和 [站](https://a.com) 以及 [坏](javascript:alert(1))");
  assert.equal(spans[0].type, "strong");
  assert.equal(spans[2].type, "code");
  assert.equal(spans[4].type, "link");
  assert.equal(spans[4].href, "https://a.com");
  assert.ok(spans.slice(5).every((s) => s.type === "text"), "javascript: 不进 link");
});

test("纯文本预览：表格摊平、长度截断", () => {
  const plain = cardToPlain("| a | b |\n|---|---|\n| 1 | 2 |", 20);
  assert.ok(plain.includes("a"));
  assert.ok(plain.length <= 21, `截断后长度异常：${plain.length}`);
  assert.ok(cardToPlain("x".repeat(300), 50).endsWith("…"));
});
