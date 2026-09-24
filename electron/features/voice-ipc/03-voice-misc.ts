/**
 * registerVoiceIpc3 —— registerVoiceIpc 按序切分出的第 3 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, ipcMain, shell, systemPreferences } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import { sendToWindow } from "../window-bus";
import type { registerVoiceIpc1 } from "./01-voice-hotkey-models";

export function registerVoiceIpc3(ibA: ReturnType<typeof registerVoiceIpc1>) {
  const { voiceAudioForIpc, voiceModelsRoot, voiceService } = ibA;
  ipcMain.handle("voice:profiles-preview", async (_event, input?: { id?: string; text?: string }) =>
    voiceAudioForIpc(await voiceService.previewVoice({ profileId: input?.id, text: input?.text }))
  );

  ipcMain.handle("voice:models-install", () => voiceService.installModels());
  ipcMain.handle("voice:models-cancel", () => ({ ok: voiceService.cancelInstall() }));
  ipcMain.handle("voice:models-import", async (_event, input: { sourceDir: string }) => {
    // 开发版：从开发者本机已下载的目录导入，按 repo 校验 SHA 后落盘到 userData/voice-models
    const { importRepoFromDir } = require("../../voice/model-store");
    const { ALL_VOICE_REPOS } = require("../../voice/model-manifest");
    const failures: string[] = [];
    for (const repo of ALL_VOICE_REPOS) {
      const f = await importRepoFromDir(voiceModelsRoot, input.sourceDir, repo, (progress: any) => {
        sendToWindow("voice:event", { type: "download", ...progress });
      });
      failures.push(...f.map((x: string) => `${repo.repo} → ${x}`));
    }
    await voiceService.refreshModelsReady();
    sendToWindow("voice:event", { type: "download", percent: 100, message: "导入完成" });
    sendToWindow("voice:event", { type: "downloadDone", ok: failures.length === 0, error: failures.slice(0, 3).join("；") });
    return { ok: failures.length === 0, failures };
  });
  ipcMain.handle("voice:models-reveal", () => {
    // 在文件管理器里打开模型目录（开发者验证下载内容用）
    return shell.openPath(voiceModelsRoot);
  });
  ipcMain.handle("voice:models-uninstall", async () => {
    // 防御（破坏性操作必须显式收口）：只认 <userData>/voice-models 这一个专用子目录。
    // 万一将来路径拼错（比如退化成 userData 本身），宁可直接失败也不能端掉整个配置目录。
    const userData = app.getPath("userData");
    const expected = path.join(userData, "voice-models");
    const target = path.resolve(voiceModelsRoot);
    if (!voiceModelsRoot || target !== path.resolve(expected) || target === path.resolve(userData)) {
      return { ok: false, error: "语音模型目录路径异常，已取消卸载" };
    }
    // 卸载 = 删除整个 voice-models 根目录（含 .part）；下次再点下载会重新拉。
    // ★ 必须先销毁「挂断后保活」的工作线程：它们持有已加载的 onnx 文件句柄，
    //   Windows 上会让 fs.rm 报 EBUSY（表现为「卸载失败但也没提示」）。
    voiceService.disposeIdleWorkers();
    await fs.rm(voiceModelsRoot, { recursive: true, force: true });
    await voiceService.refreshModelsReady();
    return { ok: true };
  });

  /** macOS 需要显式申请麦克风授权；Windows/Linux 直接按「已授权」处理。 */
  ipcMain.handle("voice:mic-permission", async () => {
    if (process.platform !== "darwin") return { status: "granted" };
    try {
      const current = systemPreferences.getMediaAccessStatus("microphone");
      if (current === "granted") return { status: "granted" };
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return { status: granted ? "granted" : current };
    } catch (error: any) {
      return { status: "unknown", error: String(error?.message ?? error) };
    }
  });
  return {  };
}
