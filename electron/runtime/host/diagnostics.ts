/**
 * 崩溃取证与图片占位兜底（10-04 阶段 1 内核瘦身，从 main.ts 下沉）。
 *
 * ⛔ 为什么它们属于内核、而不是某个功能域：
 *   ·崩溃日志的落盘点是 **userData/voice-crash.log**，但**写入的触发源**是渲染进程死 /
 *     主进程未捕获异常 —— 这两件事都在**应用级**，不属于任何功能域。
 *     （文件名里的 voice 是历史沿革：最早只为语音闪退取证，后来成了通用崩溃日志。）
 *   · 图片占位响应同理：它是**协议层的兜底**（图集/缩略图取不到时给一张1x1 透明 PNG），
 *     而协议的接线与可信根校验属内核边界（见 main.ts 的 harness-image 注册处）。
 *
 * ⛔⛔ 搬迁纪律（这三条是本项目踩过三轮的坑，见 MEMORY.md §4「搬迁判据」）：
 *   ① `app.getPath("userData")` 必须**惰性求值**（本文件里的路径都在函数体内算）——
 *     main.ts 模块体第 159 行才 `app.setPath("userData", …)`，模块体求值会拿到默认目录，
 *     路径静默漂移。守卫【91】就是那次事故的复发防线。
 *   ② `app.on(...)` 的**退订函数**要交给 `ctx.effect`，否则域/模块卸载后钩子残留，
 *     再挂一次会重复触发。本文件由内核直接调一次，不需要退订（进程级订阅）。
 *   ③ **不得让取证失败影响主流程** —— 写日志、读GPU 状态全部 try/catch 吞掉。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/** 1x1 透明 PNG（base64），图片文件缺失时的兜底响应。 */
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** 图片占位响应（1x1 透明 PNG）。 */
export function placeholderPngResponse(): Response {
  return new Response(Buffer.from(PLACEHOLDER_PNG_B64, "base64"), {
    headers: { "content-type": "image/png" },
  });
}

/**
 * 崩溃取证（09-12 新增）：用户反馈「开实时语音一会就闪退」，但应用跑 e2e 之外的路径
 * 没有任何崩溃日志——渲染进程一死 → 窗口关闭 → window-all-closed → app.quit()，
 * 从用户视角就是「应用自己没了」，且不留证据。
 * 两件事一起做：① 落盘确切原因（reason/exitCode/时间）到 userData/voice-crash.log；
 * ② 渲染进程异常退出时重载窗口（应用不再整体退出），把「闪退」降级成「闪一下自动恢复」。
 */
export function logCrash(scope: string, detail: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${scope} ${typeof detail === "string" ? detail : JSON.stringify(detail)}\n`;
    // ⛔ 路径惰性：见文件头①。app.getPath 在模块体求值会拿到 setPath 之前的默认目录。
    void fs.appendFile(path.join(app.getPath("userData"), "voice-crash.log"), line).catch(() => undefined);
    console.error("[crash]", line.trim());
  } catch {
    /* 取证失败不能影响主流程 */
  }
}

/**
 * 装上崩溃取证与GPU 诊断（进程级订阅，无退订 —— 生命周期同进程）。
 *
 * 幂等：重复调用不会重复挂钩子。守卫【272】会钉这一条（重复挂 = 同一次崩溃写两行日志）。
 */
let installed = false;

export function installCrashDiagnostics(): void {
  if (installed) return;
  installed = true;

  app.on("render-process-gone", (_event, contents, details) => {
    logCrash("renderer-gone", { reason: details?.reason, exitCode: details?.exitCode });
    if (details?.reason === "clean-exit") return;
    try {
      if (!contents.isDestroyed()) contents.reload();
    } catch {
      /* 重载失败就交给用户手动重开 */
    }
  });

  process.on("uncaughtException", (error) => logCrash("main-uncaught", String(error?.stack ?? error)));
  process.on("unhandledRejection", (reason) => logCrash("main-unhandled", String((reason as any)?.stack ?? reason)));

  void app.whenReady().then(() => {
    try {
      const gpuStatus = app.getGPUFeatureStatus();
      console.log("[gpu] feature status:", JSON.stringify(gpuStatus));
    } catch {
      /* 诊断日志，失败不影响启动 */
    }
  });
}