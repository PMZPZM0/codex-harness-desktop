import test from "node:test";
import assert from "node:assert/strict";
import { parseFlowchartSpec, layoutFlowchart, FLOW_LIMIT } from "../src/features/graph/flowchart-spec.mjs";
import { buildFlowSvg, buildFlowHtml, buildFlowJson, FLOW_EXPORT_FORMATS } from "../src/features/graph/export-flow.mjs";

const SPEC = {
  title: "四态",
  direction: "TD",
  nodes: [
    { id: "idle", label: "未压缩", note: "增长", tone: "blue" },
    { id: "compacting", label: "压缩中", tone: "amber" },
    { id: "done", label: "完成", tone: "green", shape: "pill" },
  ],
  edges: [
    { from: "idle", to: "compacting", label: "越过阈值" },
    { from: "compacting", to: "done", label: "error", dashed: true, tone: "red" },
  ],
};

const parse = (obj) => parseFlowchartSpec(JSON.stringify(obj));

test("解析：正常规格 + 默认值回落", () => {
  const s = parse(SPEC);
  assert.equal("error" in s, false);
  assert.equal(s.nodes.length, 3);
  assert.equal(s.edges.length, 2);
  assert.equal(s.direction, "TD");
  assert.equal(parse({ nodes: [{ id: "a", tone: "neon" }] }).nodes[0].tone, "blue");
});

test("解析：坏输入都有可执行错误，不抛异常", () => {
  assert.ok("error" in parseFlowchartSpec("{ not json }"));
  assert.ok("error" in parse({ nodes: [] }));
  assert.ok("error" in parse({ nodes: Array.from({ length: FLOW_LIMIT + 1 }, (_, i) => ({ id: "n" + i })) }));
});

test("解析：重名节点去重、缺失端点/自环的连线丢弃", () => {
  const s = parse({ nodes: [{ id: "a" }, { id: "a" }], edges: [{ from: "a", to: "a" }, { from: "a", to: "zzz" }] });
  assert.equal(s.nodes.length, 1);
  assert.equal(s.edges.length, 0);
});

test("布局：TD 分层顺序 + 同层不重叠 + 有环不崩", () => {
  const s = parse(SPEC);
  const laid = layoutFlowchart(s);
  const byId = Object.fromEntries(laid.nodes.map((n) => [n.id, n]));
  assert.ok(byId.idle.y < byId.compacting.y);
  assert.ok(byId.compacting.y < byId.done.y);
  assert.ok(laid.width > 100 && laid.height > 100);

  const cyc = parse({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] });
  assert.equal(layoutFlowchart(cyc).nodes.length, 2);
});

test("布局：LR 主方向是 x", () => {
  const s = parse({ ...SPEC, direction: "LR" });
  const byId = Object.fromEntries(layoutFlowchart(s).nodes.map((n) => [n.id, n]));
  assert.ok(byId.idle.x < byId.compacting.x);
});

test("导出：SVG 含标签/箭头/虚线/语义色，且无外部引用", () => {
  const s = parse(SPEC);
  const svg = buildFlowSvg(s, layoutFlowchart(s));
  assert.ok(svg.startsWith("<?xml"));
  for (const label of ["未压缩", "压缩中", "完成", "越过阈值"]) assert.ok(svg.includes(label));
  assert.ok(svg.includes('marker-end="url(#fa)"'));
  assert.ok(svg.includes('stroke-dasharray="5 4"'));
  assert.ok(svg.includes("#A32D2D"));
  assert.ok(!/https?:\/\//.test(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "")));
});

test("导出：HTML 单文件 + JSON 可再解析", () => {
  const s = parse(SPEC);
  const html = buildFlowHtml(s, buildFlowSvg(s, layoutFlowchart(s)));
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("<title>四态</title>"));
  assert.ok(!html.includes("<?xml"));

  const back = JSON.parse(buildFlowJson(s));
  assert.equal(back.nodes.length, 3);
  assert.equal(back.nodes[2].shape, "pill");
  assert.equal("error" in parseFlowchartSpec(JSON.stringify(back)), false);
});

test("格式清单：图片类 + 文档类，均带适用场景", () => {
  assert.equal(FLOW_EXPORT_FORMATS.length, 4);
  assert.ok(FLOW_EXPORT_FORMATS.every((f) => f.label && f.hint));
  assert.ok(FLOW_EXPORT_FORMATS.some((f) => f.id === "png"));
  assert.ok(FLOW_EXPORT_FORMATS.some((f) => f.id === "html"));
});
