// 覆盖层焦点归还单测（node:test，零新依赖）。
// 用法: node scripts/verify-focus-return.mjs
// 流程: 用 tsc 把 src/lib/focus-return.ts 编译成 CJS 到 .test-tmp/，再用假 DOM 跑断言。
// 覆盖: 遮罩关闭归还、遮罩仍在/已有焦点不抢、归还目标被卸载走兜底、
//       非遮罩失焦不打扰、原生 confirm/alert 包装、dispose 清理。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const outFile = join(tmpDir, "focus-return.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscBin)) {
  console.error("FATAL: typescript not installed");
  process.exit(1);
}
mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });
execFileSync(process.execPath, [
  tscBin,
  join(root, "src", "lib", "focus-return.ts"),
  "--module", "commonjs",
  "--target", "es2020",
  "--outDir", tmpDir,
  "--skipLibCheck",
  "--esModuleInterop",
], { stdio: "inherit" });
if (!existsSync(outFile)) {
  console.error("FATAL: tsc produced no output");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { installFocusReturn, OVERLAY_SELECTOR } = require(outFile);

// --- 假 DOM ---
function makeEnv() {
  const alive = new Set();
  let overlay = null; // 当前挂载的遮罩（模拟 .modal-backdrop）
  const listeners = { focusin: [], focusout: [] };
  const body = { id: "body" };
  const doc = {
    activeElement: body,
    body,
    querySelector: (selector) => (selector === OVERLAY_SELECTOR ? overlay : null),
    contains: (node) => alive.has(node),
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
    removeEventListener: (type, listener) => {
      listeners[type] = (listeners[type] || []).filter((entry) => entry !== listener);
    },
  };
  const queue = [];
  const env = {
    doc,
    schedule: (callback) => queue.push(callback),
    getFallback: () => env.fallback,
    win: {},
    fallback: null,
  };
  const el = (id, { inOverlay = false, overlayClass = ".modal-backdrop" } = {}) => {
    const node = {
      id,
      focusCalls: 0,
      lastOptions: undefined,
      focus(options) {
        this.focusCalls += 1;
        this.lastOptions = options;
        doc.activeElement = node;
      },
      closest: (selector) => {
        if (!inOverlay) return null;
        const classes = String(selector).split(",").map((entry) => entry.trim());
        return classes.includes(overlayClass) ? overlay : null;
      },
    };
    alive.add(node);
    return node;
  };
  return {
    env,
    doc,
    body,
    el,
    setOverlay(value) { overlay = value; },
    detach: (node) => alive.delete(node),
    flush: () => { const pending = queue.splice(0); for (const cb of pending) cb(); },
    dispatch: (type, event) => { for (const listener of listeners[type] || []) listener(event); },
    listenerCount: (type) => (listeners[type] || []).length,
  };
}

// 场景骨架：输入框有焦点 → 打开遮罩 → 焦点进入遮罩内按钮 → 遮罩卸载（焦点落空）
function openThenClose({ keepOverlay = false } = {}) {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  const dispose = installFocusReturn(harness.env);
  harness.doc.activeElement = composer;
  harness.dispatch("focusin", { target: composer }); // 记录归还目标

  const backdrop = harness.el("backdrop");
  harness.setOverlay(backdrop);
  const button = harness.el("confirm-button", { inOverlay: true });
  button.focus();
  harness.dispatch("focusout", { target: composer, relatedTarget: button }); // 正常切换：不干预
  harness.dispatch("focusin", { target: button }); // 遮罩内焦点：不覆盖 saved

  // 关闭遮罩：焦点从遮罩内按钮上落空
  harness.setOverlay(keepOverlay ? backdrop : null);
  harness.detach(backdrop);
  harness.detach(button);
  harness.doc.activeElement = harness.body;
  harness.dispatch("focusout", { target: button, relatedTarget: null });
  return { ...harness, composer, button, dispose };
}

test("遮罩关闭后焦点归还给打开前的输入框", () => {
  const h = openThenClose();
  h.flush();
  assert.equal(h.composer.focusCalls, 1, "应把焦点还给输入框");
  assert.deepEqual(h.composer.lastOptions, { preventScroll: true });
});

test("遮罩仍在打开状态时不抢焦点", () => {
  const h = openThenClose({ keepOverlay: true });
  h.flush();
  assert.equal(h.composer.focusCalls, 0);
});

test("焦点已有明确去处时不抢焦点", () => {
  const h = openThenClose();
  const other = h.el("other-input");
  h.doc.activeElement = other; // 关闭后焦点其实落在别处
  h.flush();
  assert.equal(h.composer.focusCalls, 0);
  assert.equal(other.focusCalls, 0);
});

test("归还目标已被卸载时兜底到主输入框", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  const fallbackInput = harness.el("fallback-composer");
  harness.env.fallback = fallbackInput;
  installFocusReturn(harness.env);
  harness.doc.activeElement = composer;
  harness.dispatch("focusin", { target: composer });

  const backdrop = harness.el("backdrop");
  harness.setOverlay(backdrop);
  const button = harness.el("button", { inOverlay: true });
  button.focus();
  harness.dispatch("focusin", { target: button });

  harness.setOverlay(null);
  harness.detach(backdrop);
  harness.detach(button);
  harness.detach(composer); // 归还目标本身已被卸载
  harness.doc.activeElement = harness.body;
  harness.dispatch("focusout", { target: button, relatedTarget: null });
  harness.flush();

  assert.equal(fallbackInput.focusCalls, 1, "应兜底到主输入框");
  assert.equal(composer.focusCalls, 0, "已卸载的元素不该再被聚焦");
});

test("非遮罩内的失焦不干预（不打扰用户主动点击空白）", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  installFocusReturn(harness.env);
  harness.doc.activeElement = composer;
  harness.dispatch("focusin", { target: composer });
  harness.doc.activeElement = harness.body;
  harness.dispatch("focusout", { target: composer, relatedTarget: null });
  harness.flush();
  assert.equal(composer.focusCalls, 0, "用户主动失焦不该被拉回来");
});

test("有 relatedTarget 的正常焦点切换不触发归还", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  const next = harness.el("next");
  harness.env.fallback = composer;
  installFocusReturn(harness.env);
  const backdrop = harness.el("backdrop");
  harness.setOverlay(backdrop);
  const button = harness.el("button", { inOverlay: true });
  harness.dispatch("focusout", { target: button, relatedTarget: next });
  harness.flush();
  assert.equal(composer.focusCalls, 0);
});

test("归还目标取最近一次遮罩外的焦点元素", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  const searchBox = harness.el("chat-search");
  harness.env.fallback = composer;
  installFocusReturn(harness.env);
  harness.doc.activeElement = composer;
  harness.dispatch("focusin", { target: composer });
  searchBox.focus();
  harness.dispatch("focusin", { target: searchBox });

  const backdrop = harness.el("backdrop");
  harness.setOverlay(backdrop);
  const button = harness.el("button", { inOverlay: true });
  button.focus();
  harness.dispatch("focusin", { target: button });

  harness.setOverlay(null);
  harness.detach(backdrop);
  harness.detach(button);
  harness.doc.activeElement = harness.body;
  harness.dispatch("focusout", { target: button, relatedTarget: null });
  harness.flush();
  assert.equal(searchBox.focusCalls, 2, "应还给关闭遮罩前的 chat-search（含最初手动那次）");
  assert.equal(composer.focusCalls, 0);
});

test("命名不同的遮罩容器（info-modal-mask / palette-backdrop）同样识别", () => {
  for (const overlayClass of [".info-modal-mask", ".palette-backdrop"]) {
    const harness = makeEnv();
    const composer = harness.el("composer");
    harness.env.fallback = composer;
    installFocusReturn(harness.env);
    harness.doc.activeElement = composer;
    harness.dispatch("focusin", { target: composer }); // 记录遮罩外的归还目标

    const backdrop = harness.el(overlayClass);
    harness.setOverlay(backdrop);
    const button = harness.el("overlay-button", { inOverlay: true, overlayClass });
    button.focus();
    harness.dispatch("focusin", { target: button }); // 遮罩内焦点不得覆盖 saved

    harness.setOverlay(null);
    harness.detach(backdrop);
    harness.detach(button);
    harness.doc.activeElement = harness.body;
    harness.dispatch("focusout", { target: button, relatedTarget: null });
    harness.flush();

    assert.equal(composer.focusCalls, 1, `${overlayClass} 关闭后应归还给遮罩外的输入框`);
    assert.equal(button.focusCalls, 1, `${overlayClass} 内按钮只应有最初那次手动 focus`);
  }
});

test("焦点元素被移除（删除消息等）导致落空时同样归还", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  installFocusReturn(harness.env);
  harness.doc.activeElement = composer;
  harness.dispatch("focusin", { target: composer });

  const rowButton = harness.el("row-button"); // 遮罩外，但随后随列表行一起被移除
  rowButton.focus();
  harness.dispatch("focusout", { target: composer, relatedTarget: rowButton });
  harness.dispatch("focusin", { target: rowButton });
  harness.detach(rowButton);
  harness.doc.activeElement = harness.body;
  harness.dispatch("focusout", { target: rowButton, relatedTarget: null });
  harness.flush();
  assert.equal(rowButton.focusCalls, 1, "只有最初那次手动 focus");
  assert.equal(composer.focusCalls, 1, "归还目标已随列表行卸载，兜底给主输入框");
  assert.equal(harness.doc.activeElement, composer, "焦点最终落在兜底输入框上");
});

test("原生 confirm 返回值透传，关闭后归还焦点", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  harness.doc.activeElement = composer;
  let seen = null;
  harness.env.win = { confirm: (message) => { seen = message; return true; } };
  installFocusReturn(harness.env);
  harness.dispatch("focusin", { target: composer });

  harness.doc.activeElement = harness.body; // 原生对话框关闭后焦点落空
  const result = harness.env.win.confirm("确认删除？");
  assert.equal(result, true, "返回值应透传");
  assert.equal(seen, "确认删除？", "参数应透传");
  harness.flush();
  assert.equal(composer.focusCalls, 1, "对话框关闭后应归还焦点");
});

test("原生 alert 同样包装且异常时也归还", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  harness.doc.activeElement = composer;
  const nativeAlert = () => { throw new Error("boom"); };
  harness.env.win = { alert: nativeAlert };
  installFocusReturn(harness.env);
  harness.dispatch("focusin", { target: composer });
  harness.doc.activeElement = harness.body;
  assert.throws(() => harness.env.win.alert("x"), /boom/);
  harness.flush();
  assert.equal(composer.focusCalls, 1, "异常路径也要归还焦点");
});

test("dispose 解绑监听并还原原生方法", () => {
  const harness = makeEnv();
  const composer = harness.el("composer");
  harness.env.fallback = composer;
  const nativeConfirm = () => false;
  harness.env.win = { confirm: nativeConfirm };
  const dispose = installFocusReturn(harness.env);
  dispose();
  assert.equal(harness.listenerCount("focusin"), 0);
  assert.equal(harness.listenerCount("focusout"), 0);
  assert.equal(harness.env.win.confirm, nativeConfirm, "原生 confirm 应还原");
});
