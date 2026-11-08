/**
 * dialog-ipc —— **系统文件对话框**（浏览 / 添加目录 / 选图片 / 选文件 / 选私钥 / 另存为）
 *
 * 域：dialog(6)
 * 通道：dialog:directory / directory-at / images / files / ssh-key / save-as
 *
 * ── 10-03：改为插件形态 + 接缝化（方案 §6 阶段 2/3）────────────────────────
 * `dialog` 原先直接 `import { dialog } from "electron"`，现在经 `inject: ["ipc", "host"]`
 * 取 `host.dialog`。接缝层强制项不涉及本域（window.create 才强制隔离三项）。
 *
 * 跨域符号经 `../runtime-refs` 取用 —— **活绑定**（TS→CJS 编译成属性访问），
 * 且**只在 handler 回调体内求值**（模块体不碰跨域符号）⇒ 不受 main.ts 模块体执行顺序影响
 * （【91】复发防线：main.ts 的 `app.setPath("userData", …)` 是模块体语句，本模块在其之前被
 *  import 加载 —— 顶层求值会拿到错的 userData）。
 *   - `mainWindow`：主窗口实例（创建前为 null，handler 运行时已就绪）。
 *   - `trustPicked`：把用户亲自选过的路径登记进可信根（安全收敛口径，见 main.ts trustedRoots）。
 *
 * ⛔ **安全口径逐字保留**：`dialog:save-as` 的**源**必须落在可信根内（与 fs:read 同口径，
 *   防渲染层被注入后把盘上任意文件拷走）；**目标**不设限——「另存为」的语义就是写到
 *   用户指定的位置。
 */
import { existsSync } from "node:fs";
import fsP from "node:fs/promises";
import path from "node:path";
import { isInsideTrustedRoots, mainWindow, trustPicked } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const DIALOG_CHANNELS = [
  "dialog:directory", "dialog:directory-at", "dialog:images",
  "dialog:files", "dialog:ssh-key", "dialog:save-as",
  "dialog:project-dir",
];

export const dialogFeature = defineFeature<null>({
  id: "dialog",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    const host = ctx.get<HostCaps>("host");
    if (!ipcHost) throw new Error("dialog: 缺少 ipc 服务（宿主未提供）");
    if (!host) throw new Error("dialog: 缺少 host 接缝（宿主未提供）");
    /* ⛔⛔ 11-08 用户截图（「选项目地址的时候，这弹窗会掉下去」）：
       系统对话框的 **owner 窗口**决定谁被压到后面 —— 原来六个通道一律以 `mainWindow` 作父窗，
       于是从「工作伙伴」独立窗口（`?teamPopout=1`）里点「选择」时，Windows 把 owner（主窗口）
       顶到最前、独立窗口连同刚填了一半的新建群弹窗沉下去。
       ⇒ owner 一律取**发起请求的那个窗口**（`event.sender` 反查），查不到才回落主窗口
       （主窗口在模块体里可能还是 null，handler 运行时已就绪，语义不变）。 */
    const ownerOf = (event: unknown) =>
      host.window.fromWebContents((event as { sender?: unknown } | null)?.sender) ?? mainWindow;

    ipcHost.handle("dialog:directory", async (event) => {
      const result = await host.dialog.showOpenDialog(ownerOf(event), { properties: ["openDirectory", "createDirectory"] });
      if (result.canceled) return null; trustPicked(result.filePaths); return result.filePaths[0];
    });
    // /add-dir：从指定起始目录打开选择器（目录不存在时回落到默认行为）
    ipcHost.handle("dialog:directory-at", async (event, startPath: string) => {
      const start = startPath && existsSync(startPath) ? startPath : undefined;
      const result = await host.dialog.showOpenDialog(ownerOf(event), { properties: ["openDirectory", "createDirectory"], defaultPath: start });
      if (result.canceled) return null; trustPicked(result.filePaths); return result.filePaths[0];
    });
    ipcHost.handle("dialog:images", async (event) => {
      const result = await host.dialog.showOpenDialog(ownerOf(event), {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (result.canceled) return []; trustPicked(result.filePaths); return result.filePaths;
    });
    ipcHost.handle("dialog:files", async (event) => {
      const result = await host.dialog.showOpenDialog(ownerOf(event), {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "All files", extensions: ["*"] }],
      });
      if (result.canceled) return []; trustPicked(result.filePaths); return result.filePaths;
    });
    // 私钥文件选择器：设置页「浏览…」按钮
    ipcHost.handle("dialog:ssh-key", async (event, startPath?: string) => {
      const start = startPath && existsSync(path.dirname(startPath)) ? path.dirname(startPath) : undefined;
      const result = await host.dialog.showOpenDialog(ownerOf(event), {
        title: "选择 SSH 私钥文件",
        properties: ["openFile"],
        defaultPath: start,
        filters: [{ name: "SSH 私钥", extensions: ["", "pem", "key", "ppk", "id_rsa", "id_ed25519"] }, { name: "All files", extensions: ["*"] }],
      });
      return result.canceled || !result.filePaths?.length ? null : result.filePaths[0];
    });

    // 另存为：文件卡片右键「另存为…」（09-26）。⛔ 源文件必须落在可信根内（与 fs:read 预览同口径，
    // 防渲染层被注入后把盘上任意文件拷走）；目标路径由用户亲自经系统对话框选定——「另存为」的语义
    // 就是写到用户指定的任意位置，目标不设可信根限制。
    ipcHost.handle("dialog:save-as", async (event, sourcePath: string) => {
      const src = path.resolve(typeof sourcePath === "string" ? sourcePath : "");
      if (!src || !isInsideTrustedRoots(src)) throw new Error("仅允许保存会话工作区与应用数据目录内的文件");
      const stat = await fsP.stat(src).catch(() => null);
      if (!stat?.isFile()) throw new Error(`文件不存在：${sourcePath}`);
      const result = await host.dialog.showSaveDialog(ownerOf(event), { defaultPath: path.basename(src) });
      if (result.canceled || !result.filePath) return { ok: false };
      await fsP.copyFile(src, result.filePath);
      return { ok: true, savedTo: result.filePath };
    });

    // 新建项目弹窗（10-25，ZCode 式三选一）：
    //   { parent, name } —— 在用户亲选的父目录下创建项目文件夹（mkdir recursive）；
    //   { path }        —— 校验输入的路径是已存在的目录，不存在不放行（不替用户创建）。
    // 两种形态的最终目录都登记进可信根（与 dialog:directory 同口径）。
    ipcHost.handle("dialog:project-dir", async (_event, input: { parent?: string; name?: string; path?: string }) => {
      const clean = (v: unknown) => String(v ?? "").trim();
      if (clean(input.path)) {
        const dir = path.resolve(clean(input.path));
        const stat = await fsP.stat(dir).catch(() => null);
        if (!stat?.isDirectory()) return { ok: false, error: "这个目录不存在（或不是文件夹）—— 用「新建文件夹」创建它，或检查路径" };
        trustPicked([dir]);
        return { ok: true, dir };
      }
      const parent = clean(input.parent);
      const name = clean(input.name);
      if (!parent || !name) return { ok: false, error: "请先选父目录并填写文件夹名" };
      if (/[\\/:*?"<>|]/.test(name)) return { ok: false, error: "文件夹名不能包含 \\ / : * ? \" < > |" };
      const dir = path.join(path.resolve(parent), name);
      try {
        await fsP.mkdir(dir, { recursive: true });
      } catch (error: any) {
        return { ok: false, error: `创建失败：${String(error?.message ?? error)}` };
      }
      trustPicked([dir]);
      return { ok: true, dir };
    });

    ctx.effect(() => {
      for (const ch of DIALOG_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
