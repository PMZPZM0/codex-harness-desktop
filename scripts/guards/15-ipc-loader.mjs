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
import { C, ROOT, join, ok, fail, readFileSync, existsSync } from "./_ctx.mjs";
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
}
