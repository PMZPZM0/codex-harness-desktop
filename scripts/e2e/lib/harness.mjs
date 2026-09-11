// scripts/e2e/lib/harness.mjs
//
// 零依赖 E2E 框架：启动已构建的 Electron 应用（隔离 profile），经 CDP 驱动渲染层。
//
// 依赖应用主进程提供的两个测试开关（electron/main.ts:60 / :65）：
//   CODEX_HARNESS_USER_DATA   —— 把 userData 重定向到临时目录（完全隔离，不碰真实数据）
//   CODEX_HARNESS_DEBUG_PORT  —— 打开 CDP 调试端口
//
// 用法见 scripts/e2e/scenarios/*.mjs。

import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 取一个空闲回环端口，避免与用户正在运行的应用（9223）撞车 */
export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

export class ElectronHarness {
  /**
   * @param {{ root?: string, artifactsDir?: string, launchTimeoutMs?: number }} opts
   */
  constructor(opts = {}) {
    this.root = opts.root || process.cwd();
    this.launchTimeoutMs = opts.launchTimeoutMs ?? 60000;
    this.artifactsDir = opts.artifactsDir || join(this.root, ".e2e-artifacts");
    this.checks = [];
    this.stepIndex = 0;
    this.child = null;
    this.ws = null;
    this.port = 0;
    this.userDataDir = "";
    this.consoleLog = [];
    this._reqId = 0;
    this._pending = new Map();
  }

  // ---------- 启动 / 连接 ----------

  async launch() {
    this.port = await freePort();
    this.userDataDir = mkdtempSync(join(tmpdir(), "harness-e2e-"));
    mkdirSync(this.artifactsDir, { recursive: true });

    this.child = spawn(electronPath, ["."], {
      cwd: this.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEBUDDY_SAFE_DELETE_ENABLED: "0",
        CODEX_HARNESS_USER_DATA: this.userDataDir,
        CODEX_HARNESS_DEBUG_PORT: String(this.port),
        // 本机回环直连，绕开环境里的 HTTP_PROXY
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    });
    let out = "";
    const collect = (d) => {
      out += d.toString();
      out = out.slice(-20000);
    };
    this.child.stdout.on("data", collect);
    this.child.stderr.on("data", collect);
    this._childOutput = () => out;

    await this._waitCdp();
    await this._connect();
    await this._send("Runtime.enable");
    await this._send("Page.enable");
    // 收集渲染层 console，便于失败定位
    this.ws.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
          this.consoleLog.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
        }
      } catch {}
    });
    return this;
  }

  async _waitCdp() {
    const t0 = Date.now();
    while (Date.now() - t0 < this.launchTimeoutMs) {
      if (this.child.exitCode !== null) {
        throw new Error(`Electron 提前退出（code=${this.child.exitCode}）\n${this._childOutput()}`);
      }
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) return;
      } catch {}
      await sleep(400);
    }
    throw new Error(`CDP 端口未就绪（${this.launchTimeoutMs}ms）\n${this._childOutput()}`);
  }

  async _connect() {
    const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("未找到 page target：" + JSON.stringify(list.map((t) => t.type)));
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error("CDP WebSocket 连接失败"));
    });
    // 注意：ws 库 on("message") 回调首参是原始数据（Buffer/string），不是 MessageEvent
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.id && this._pending.has(m.id)) {
        this._pending.get(m.id)(m);
        this._pending.delete(m.id);
      }
    });
  }

  _send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this._reqId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this._pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`CDP ${method} 报错: ${m.error.message}`));
        else resolve(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // ---------- 渲染层操作 ----------

  /** 在页面上下文求值，返回可序列化结果 */
  async eval(expression) {
    const r = await this._send("Runtime.evaluate", {
      expression: `(() => { try { return (${expression}); } catch (e) { return "__ERR__:" + e.message; } })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const v = r?.result?.value;
    if (typeof v === "string" && v.startsWith("__ERR__:")) throw new Error("页面求值失败 " + v);
    return v;
  }

  /** 轮询直到表达式为真 */
  async waitFor(expression, { timeoutMs = 20000, intervalMs = 300, label = expression } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (e) {
        last = "err:" + e.message;
      }
      await sleep(intervalMs);
    }
    throw new Error(`等待超时：${label}（最后取值 ${JSON.stringify(last)}）`);
  }

  async exists(selector) {
    return (await this.eval(`!!document.querySelector(${JSON.stringify(selector)})`)) === true;
  }

  async count(selector) {
    return await this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  async text(selector) {
    return await this.eval(
      `(document.querySelector(${JSON.stringify(selector)})?.innerText || "").trim()`
    );
  }

  async bodyText(limit = 500) {
    return await this.eval(`(document.body?.innerText || "").slice(0, ${limit})`);
  }

  /** 原生点击（对 React 的 onClick 有效） */
  async click(selector) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`点击失败，元素不存在：${selector}`);
    await sleep(250);
  }

  /** 按可见文本点击：取「文本最短」的匹配元素（最内层），再向上找可点击祖先 */
  async clickByText(text, { exact = false } = {}) {
    const ok = await this.eval(`(() => {
      const t = ${JSON.stringify(text)};
      const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [contenteditable="true"], li, span, p, div')];
      let matches = all.filter(n => {
        const s = (n.innerText || "").trim();
        return ${exact ? "s === t" : "s.includes(t)"};
      });
      if (!matches.length) return false;
      // 取文本最短者 = 最贴近文本本身的元素；同长度再取层级最深的
      matches.sort((a, b) => {
        const d = (a.innerText || "").trim().length - (b.innerText || "").trim().length;
        if (d !== 0) return d;
        const depth = (el) => { let n = 0; while (el.parentElement) { n++; el = el.parentElement; } return n; };
        return depth(b) - depth(a);
      });
      const hit = matches[0];
      const target = hit.closest('button, a, [role="button"], [role="tab"]') || hit;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    })()`);
    if (!ok) throw new Error(`按文本点击失败：${text}`);
    await sleep(300);
  }

  /** 按 title（或 aria-label）属性点击——本项目大量按钮只有 title，没有可见文本 */
  async clickByTitle(title) {
    const ok = await this.eval(`(() => {
      const t = ${JSON.stringify(title)};
      const el = [...document.querySelectorAll('[title], [aria-label]')]
        .find(e => (e.getAttribute('title') || '').includes(t) || (e.getAttribute('aria-label') || '').includes(t));
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`按 title 点击失败：${title}`);
    await sleep(300);
  }

  /** 给 input/textarea/contenteditable 赋值并派发 React 能收到的事件 */
  async setInput(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      if (el.isContentEditable) {
        el.textContent = ${JSON.stringify(value)};
      } else {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter ? setter.call(el, ${JSON.stringify(value)}) : (el.value = ${JSON.stringify(value)});
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`输入失败，元素不存在：${selector}`);
    await sleep(150);
  }

  /** 键盘输入（走 CDP，更接近真实用户） */
  async pressKey(key, { text } = {}) {
    const base = { key, windowsVirtualKeyCode: key === "Enter" ? 13 : undefined };
    await this._send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(text ? { text } : {}) });
    await this._send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(120);
  }

  /** 用 CDP 真实输入文本到指定元素（对 contenteditable 最可靠，会触发 React 的 onInput） */
  async typeInto(selector, text) {
    const ok = await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`
    );
    if (!ok) throw new Error(`聚焦失败，元素不存在：${selector}`);
    await this._send("Input.insertText", { text });
    await sleep(250);
  }

  /** 清空输入框内容 */
  async clearInput(selector) {
    await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.focus(); document.execCommand("selectAll"); } })()`
    );
    const key = { key: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };
    await this._send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await this._send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(200);
  }

  /** 截图落盘，返回文件路径 */
  async screenshot(label) {
    const idx = String(++this.stepIndex).padStart(2, "0");
    const safe = String(label).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60);
    const dir = join(this.artifactsDir, "shots");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${idx}-${safe}.png`);
    const r = await this._send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  // ---------- 断言 ----------

  /** 记录一条断言结果 */
  check(label, condition, detail = "") {
    const ok = !!condition;
    this.checks.push({ label, ok, detail });
    const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
    return ok;
  }

  // ---------- 收尾 ----------

  async close() {
    try {
      this.ws?.close();
    } catch {}
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
      await sleep(600);
      // Electron 会派生多个子进程，兜底强杀本次实例
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /F /PID ${this.child.pid} /T`, { stdio: "ignore" });
        }
      } catch {}
    }
  }

  /** 汇总结果；返回是否全绿 */
  summary(title) {
    const pass = this.checks.filter((c) => c.ok).length;
    const fail = this.checks.length - pass;
    console.log("");
    console.log(`${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${title}：${pass}/${this.checks.length} 通过\x1b[0m`);
    if (fail) {
      console.log("\x1b[31m失败项：\x1b[0m");
      for (const c of this.checks.filter((x) => !x.ok)) console.log(`  - ${c.label} ${c.detail}`);
      if (this.consoleLog.length) {
        console.log("\x1b[31m渲染层 console.error：\x1b[0m");
        for (const l of this.consoleLog.slice(0, 10)) console.log("  -", l);
      }
    }
    return { pass, fail, ok: fail === 0 };
  }
}
