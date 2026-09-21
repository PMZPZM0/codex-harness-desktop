/**
 * 计划可编辑构件的**真实渲染断言**（服务端渲染同一份组件代码）。
 *
 * 为什么需要（09-21）：真机 e2e 里没能把界面切进一个已有会话（点侧栏行后仍停在欢迎页 ——
 * 那是 e2e 驱动的问题，不是功能问题），于是"有 plan item 时 PlanEditor 渲染成什么样"缺少证据。
 * 这里用 `react-dom/server` 把**同一份 src/components/PlanEditor.tsx** 渲染成 HTML 后断言 ——
 * 比 grep 源码强得多（真的执行了组件代码），且确定性强、能挂进 check 链长期守。
 *
 * ⛔ 它**不能**替代真机 e2e 覆盖的东西：样式观感、与真实 plan item 的接线。
 *    这两条分别由人眼截图与预检【87】的接线断言负责。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as planSteps from "../src/lib/plan-steps.mjs";

const source = fs.readFileSync(new URL("../src/components/PlanEditor.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  fileName: "PlanEditor.tsx",
}).outputText;

// lucide 图标在 SSR 里只需要能渲染（不必是真实 SVG）
const iconStub = () => React.createElement("i", { "data-icon": "1" });
// ⛔ `exports` 必须与 `module.exports` 指向**同一个对象**：转译产物的 CommonJS 输出写的是
//    `exports.X = ...`，而读的人通常看 `module.exports` —— 两者不同源就会拿到 undefined。
const moduleObj = { exports: {} };
const context = {
  // jsx: React 模式生成的代码直接引用全局 `React`（不是从 require 拿）—— 必须注入到 vm 作用域
  React,
  require: (name) => {
    if (name === "react") return React;
    if (name === "lucide-react") return new Proxy({}, { get: () => iconStub });
    if (name.includes("plan-steps")) return planSteps;
    throw new Error("verify-plan-editor: 未预期的 import → " + name);
  },
  module: moduleObj,
  exports: moduleObj.exports,
  console,
};
vm.runInNewContext(js, context);
const { PlanEditor } = moduleObj.exports;
// ⛔ 注意：`memo(...)` 返回的是**对象**（{ $$typeof, type, compare }）而不是函数 —— 别按 function 断言。
assert.ok(PlanEditor && (typeof PlanEditor === "function" || typeof PlanEditor === "object"), "PlanEditor 必须导出（memo 包装后是对象）");

const render = (text) => renderToStaticMarkup(React.createElement(PlanEditor, { itemId: "t1", text, onSubmit: () => undefined }));

// ① 基本形态：3 条（含 1 条已完成）+ 交回按钮
const html = render("先看现状，再动手。\n\n- [ ] 改 A\n- [x] 改 B\n- [ ] 改 C");
assert.ok(html.includes('class="plan-editor"'), "根节点必须是 .plan-editor");
assert.ok(html.includes('data-steps="3"'), "应渲染出 3 条（data-steps 是给验收/断言用的锚点）");
assert.equal((html.match(/class="plan-step /g) || []).length + (html.match(/class="plan-step"/g) || []).length, 3, "应渲染出 3 个 .plan-step");
assert.ok(/class="plan-step done"/.test(html) || /class="plan-step [^"]*done/.test(html), "已完成条目要带 done 类（视觉上划线）");
assert.ok(html.includes("交给 Codex"), "必须有交回按钮");
assert.ok(html.includes("加一条"), "必须有加条目按钮");
assert.ok(html.includes("1/3 已完成"), "进度显示应为 1/3");
assert.ok(html.includes('data-dirty="0"'), "初始未被改动 ⇒ data-dirty=0");

// ② 前置说明原样渲染（不参与编辑，但用户要能看见）
assert.ok(html.includes("先看现状"), "intro 必须渲染出来（丢了等于信息丢失）");

// ③ 无条目时不炸（真实场景：模型给了纯文字计划）
const empty = render("只有一段说明，没有条目。");
assert.ok(empty.includes('data-steps="0"'), "零条目也要正常渲染");
assert.ok(empty.includes("交给 Codex"), "零条目时按钮仍在（disabled 由属性表达）");

// ④ 文案里的特殊字符必须被转义（XSS 面：计划内容来自模型输出）
const risky = render('- [ ] <img src=x onerror="alert(1)"> & "引号"');
assert.ok(!/<img/i.test(risky), "模型给的文本必须被转义，不能原样进 HTML");
assert.ok(risky.includes("&lt;img") || risky.includes("&amp;lt;img"), "应看到转义后的实体");

// ⑤ 交回内容是 markdown（组件把编辑结果交给上层，上层再发消息）—— 序列化由 lib 保证
assert.equal(serializeRoundTrip(), true, "lib 的序列化必须与解析往返一致");

function serializeRoundTrip() {
  const text = "- [ ] 一\n- [x] 二";
  const parsed = planSteps.parsePlan(text);
  return planSteps.serializePlan(parsed.intro, parsed.steps) === text;
}

console.log("PASS: plan editor 真实渲染（条目/完成态/intro/空态/转义）+ 交回按钮与进度 + lib 往返一致");
