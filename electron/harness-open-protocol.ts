/**
 * `harness-open` 自定义协议（11-24）。
 *
 * 为什么需要它：PPT 实时预览页是 `file://` 页面（右栏浏览器里的本地 HTML），
 * 里面调不到 IPC —— 用户点「用其他应用打开」时没有任何通道能触达主进程。
 * 自定义协议是唯一不引入 preload 的办法。
 *
 * ⛔⛔ 安全闸只有一个：**扩展名白名单**。`shell.openPath` 对 `.exe` / `.bat` / `.ps1`
 *    等同于「直接执行」，如果任意页面都能让系统打开任意文件，就等于给网页一个
 *    本地代码执行入口。所以这里只放行办公文档，其余一律 415。
 * ⛔ 不做路径存在性/可信根校验：与项目 10-29 的既定立场一致（预览/打开不判可信根），
 *    真正的闸门是「这类文件双击也只是被办公软件打开」。
 */
import { protocol, shell } from "electron";

/** 允许交给系统默认应用打开的文件类型（办公文档；⛔ 绝不加入可执行/脚本类）。 */
const OPENABLE = /\.(pptx?|pptm|potx|ppsx?|key|odp|xlsx?|xlsm|xlsb|csv|ods|docx?|docm|odt|rtf|pdf)$/i;

/**
 * 注册协议：`harness-open://open?path=<绝对路径>` → 用系统默认程序打开。
 * 返回 200 = 已交给系统；415 = 类型不在白名单；500 = 系统没有关联程序（body 是原因文案）。
 */
export function registerHarnessOpenProtocol(): void {
  protocol.handle("harness-open", async (request) => {
    const target = new URL(request.url).searchParams.get("path") ?? "";
    if (!target) return new Response("Missing path", { status: 400 });
    if (!OPENABLE.test(target)) return new Response("Unsupported file type", { status: 415 });
    try {
      const failure = await shell.openPath(target);
      return new Response(failure || "ok", { status: failure ? 500 : 200 });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  });
}
