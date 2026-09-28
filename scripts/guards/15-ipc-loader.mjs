/**
 * 预检守卫组：15-ipc-loader —— **IPC 模块的加载完整性**。
 *
 * ⛔ 立此组的事故（2026-09-28 用户现场）：
 *   「排队消息定时不了」，报 `[ERR_NO_HANDLER] queue-timer:set: No handler registered`。
 *   排查结果：handler 文件在、manifest 在、ipc-registry 在、preload 在 —— **四处齐全**，
 *   唯一缺的是 `electron/main.ts` 里的那一行 `import "./features/queue-timer-ipc"`。
 *   缺它的后果是：整个模块体不执行 ⇒ `ipcMain.handle` 从未调用 ⇒ 该域所有通道**静默全废**
 *   （不报编译错、不报 lint、预检也全绿）。这类"少一行引用"的错误没有任何其他网能接住。
 *
 * 判据是**结构性**的：以 `ipc-registry.ts` 为唯一真相源，逐个要求「in-features 的 file
 * 必须被启动链引用」—— 新增域时自动纳入，不需要在这里维护名单。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync, existsSync, codeOnly } from "./_ctx.mjs";
import fs from "node:fs";
import path from "node:path";

/** 启动链的引用面：main.ts + electron/main/*.ts（域模块也可能被 main/ 下的子模块引入）。 */
function loaderSources() {
  const out = [join(ROOT, "electron", "main.ts")];
  const mainDir = join(ROOT, "electron", "main");
  if (existsSync(mainDir)) {
    for (const e of fs.readdirSync(mainDir, { withFileTypes: true })) {
      if (e.isFile() && /\.ts$/.test(e.name)) out.push(path.join(mainDir, e.name));
    }
  }
  return out.map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
}

export async function run() {
  console.log(C.bold("\n【194】IPC 模块加载完整性（registry → 启动链）"));

  const registrySrc = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
  // registry 条目形如：{ prefix, count, status: "in-features", file: "features/xxx.ts", ... }
  const files = [...new Set(
    [...registrySrc.matchAll(/status:\s*"in-features"[\s\S]{0,200}?file:\s*"([^"]+)"/g)].map((m) => m[1]),
  )];
  (files.length > 10 ? ok : fail)(
    `【194】从 ipc-registry 解析出 in-features 模块清单（拿到 ${files.length} 个 —— 解析失配会让本组静默恒真）`
  );

  const loaders = loaderSources();
  const unloaded = [];
  for (const rel of files) {
    const base = rel.replace(/\.ts$/, "");           // features/queue-timer-ipc
    // 允许两种写法：`import "./features/x"` 与 `from "./features/x"`
    const hit = loaders.some(({ text }) =>
      new RegExp(`from\\s+"\\./${base}"`).test(text) || new RegExp(`import\\s+"\\./${base}"`).test(text),
    );
    if (!hit) unloaded.push(rel);
  }
  (unloaded.length === 0 ? ok : fail)(
    `【194】每个 in-features 模块都被启动链 import（漏引用 ⇒ 该域所有通道静默报 No handler registered）${
      unloaded.length ? "：未引用 " + unloaded.join(" / ") : ""
    }`
  );

  /* 事故本体回归：queue-timer 域必须真的被 main.ts 引用（这条写死也值得 —— 它被真踩过） */
  const mainText = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  (/import\s+"\.\/features\/queue-timer-ipc"/.test(mainText) ? ok : fail)(
    "【194】main.ts 引用了 queue-timer-ipc（09-28「排队消息定时不了」的直接病根）"
  );

  /* 反向：启动链里 import 的 features 模块必须都存在（防笔误路径 —— tsc 对字面量 require/import
     的模块解析是可靠的，但纯副作用 import 的路径错在 tsc 下也会报，这里只做存在性兜底） */
  const missing = [];
  for (const { text } of loaders) {
    for (const m of text.matchAll(/^\s*import\s+"\.\/(features\/[^"]+)";/gm)) {
      if (!existsSync(join(ROOT, "electron", `${m[1]}.ts`))) missing.push(m[1]);
    }
  }
  (missing.length === 0 ? ok : fail)(
    `【194】启动链引用到的 features 模块文件都存在${missing.length ? "：缺 " + missing.join(" / ") : ""}`
  );

  /* ── ③ 导出式注册函数**必须有调用点** ──────────────────────────────────────────
     ⛔ 09-28 二次事故（同一类病的变体）：`export function registerVideoGen()` 全仓库
     **零调用点** ⇒ 6 个 video: 通道的 ipcMain.handle 从未执行 ⇒ 渲染层 invoke 抛
     「No handler registered」⇒ 组件 catch 成空数组 ⇒ 用户现场「视频生成接口一直加载中…，
     根本配置不了」（厂商列表空，弹窗里一个都配不了）。
     ⛔ 上一版【194】只查「模块被 import」，接不住这一层：**模块进来了、里面的注册函数没人调**。
     判据：每个 `export function register*` 的定义之外，至少还要有一次 `registerXxx(`。 */
  {
    const files = [];
    const collect = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") collect(p); }
        else if (e.name.endsWith(".ts")) files.push(p);
      }
    };
    collect(join(ROOT, "electron"));
    const sources = files.map((f) => ({ file: f, code: codeOnly(readFileSync(f, "utf8")) }));
    const all = sources.map((s) => s.code).join("\n");
    const defined = [];
    const definedNoArg = [];
    for (const s of sources) {
      for (const m of s.code.matchAll(/export function (register[A-Za-z0-9]+)\s*\(([^)]*)\)/g)) {
        defined.push({ name: m[1], file: s.file });
        // 无参注册函数（如 registerVideoGen()）语义 = 「import 即注册」，只能调一次；
        // 带参的（deps / 窗口对象）可能按模式或按窗口合法多次调用，不做次数约束。
        if (m[2].trim() === "") definedNoArg.push({ name: m[1], file: s.file });
      }
    }
    const countOf = (name) => [...all.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].length;
    const orphan = defined.filter((d) => countOf(d.name) <= 1);
    (orphan.length === 0 ? ok : fail)(
      `【194】每个 export function register* 都有调用点（孤儿：${orphan.map((o) => `${o.name} @ ${path.relative(ROOT, o.file)}`).join("; ") || "无"}）—— 无调用点 ⇒ 该域所有通道静默全废`
    );
    // ⛔ 反向：**无参**注册函数只能有一处调用。Electron 对同一 channel 二次 `ipcMain.handle`
    //    会直接抛「Attempted to register a second handler」⇒ 主进程起不来。
    //    （带参的 registerBusWindow / registerRelayIpc 按窗口或按模式调用，不受此限。）
    const multi = definedNoArg.filter((d) => countOf(d.name) > 2);
    (multi.length === 0 ? ok : fail)(
      `【194】无参 register* 至多一处调用点（多次 = 重复注册同一通道，Electron 直接抛错）：${multi.map((m) => m.name).join(", ") || "无"}`
    );
  }
}
