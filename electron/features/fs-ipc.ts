/**
 * fs-ipc（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：**受信任根约束的本地文件读写**（写 / 读预览 / 存在性探测）。
 * 搬出符号：IPC handler fs:write / fs:read / fs:exists。
 * 消费方：渲染层文件落盘（harness-image 协议口径）、InlineFileCards 灰显、本地预览。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、通道归并）。
 * 跨域符号：
 *   - isInsideTrustedRoots：主进程可信根判定（被 external:open 的 filePreviewAllowed 共用），
 *     经 `import … from "../main"` 取用 —— **活绑定**，且**只在 handler 回调体内求值**
 *     （模块体不碰跨域符号）⇒ 不受 main.ts 模块体执行顺序影响（【91】复发防线：
 *     main.ts 的 `app.setPath("userData", …)` 在其 import 之前执行，顶层求值会拿到错的 userData）。
 *   - fileStat / sizeLabel：来自 ./app-diagnostics（文件 stat 与体积可读化），不依赖 main.ts。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行（早于 whenReady）。
 */
import { ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileStat, sizeLabel } from "./app-diagnostics";
import { isInsideTrustedRoots } from "../runtime-refs";

ipcMain.handle("fs:write", async (_event, input: { path: string; content: string; root: string }) => {
  const resolved = path.resolve(input.path);
  // ⛔ 隐私加固（09-19 审计高危）：原校验的 root 由渲染层传入——传 root:"C:\\" 即绕过校验，
  // 等于"任意路径写文件"。root 参数不再参与判定，一律收敛到主进程自己的可信根集合
  // （各会话工作目录 + userData + 用户亲自用系统对话框选过的路径，同 harness-image 协议口径）。
  if (!isInsideTrustedRoots(resolved)) throw new Error("仅允许保存会话工作区与应用数据目录内的文件");
  await fs.writeFile(resolved, input.content, "utf8");
  return { ok: true };
});
// 本地读文件：预览文件内容（Base64 返回，渲染层解码）。取代转发给引擎的 fs/readFile——
// 引擎的 fs/readFile 是给 AI 用的工具，非任务上下文会失败或返回结构不一致。
ipcMain.handle("fs:read", async (_event, input: { path: string }) => {
  const target = path.resolve(input.path);
  // ⛔ 隐私加固（09-19 审计高危）：预览通道原来是"任意路径读"——渲染层被注入（XSS）即可
  // 读全盘文件（含系统敏感目录）。收敛到可信根：会话工作目录、userData、用户选过的路径。
  // 口径与 harness-image 协议（09-13 审计 S5）完全一致，合法预览不受影响。
  if (!isInsideTrustedRoots(target)) throw new Error("仅允许预览会话工作区与应用数据目录内的文件");
  const stat = fileStat(target);
  if (!stat || !stat.isFile()) throw new Error(`文件不存在或不可读：${input.path}`);
  const size = stat.size;
  if (size > 2 * 1024 * 1024) throw new Error(`文件过大（${sizeLabel(size)}），预览仅支持 2MB 以内`);
  const buf = await fs.readFile(target);
  return { dataBase64: buf.toString("base64"), size };
});
// 探测文件是否存在（InlineFileCards 用：不存在的引用文件灰显，点击不再直接报 os error 2）
ipcMain.handle("fs:exists", async (_event, input: { path: string }) => {
  try {
    const target = path.resolve(input.path);
    const stat = fileStat(target);
    return { exists: Boolean(stat && stat.isFile()) };
  } catch {
    return { exists: false };
  }
});
