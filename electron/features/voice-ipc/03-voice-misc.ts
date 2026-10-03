/**
 * registerVoiceIpc3 —— registerVoiceIpc 按序切分出的第 3 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, shell, systemPreferences } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import { modelsSizeOnDisk } from "../../voice/model-store";
import {
  VOICE_RESOURCE_LABELS,
  isVoiceResourceEnabled,
  isVoiceResourceKind,
  loadVoiceSettings,
  setVoiceResourceEnabled,
  voiceResourceStates,
  type VoiceResourceKind,
} from "../../voice/voice-settings";
import { sendToWindow } from "../window-bus";
import type { registerVoiceIpc1 } from "./01-voice-hotkey-models";

/**
 * 每种资源对应的**目录名**（相对 modelsRoot()）。
 *
 * ⛔ `base` 是空串：三个基础模型仓库（ASR/VAD/TTS）各自是根下的一个子目录、彼此独立，
 *    没有一个能代表"整套基础模型"的父目录 ⇒ 删 base 只能删整个 modelsRoot()。
 *    这也是 `resourceDirOf` 对空串返回 root 的原因（root 自身在允许范围内）。
 */
const RESOURCE_DIRS: Record<VoiceResourceKind, string> = {
  base: "",
  zipvoice: ZIPVOICE_DIR,
  kws: KWS_DIR,
};

/** 每种资源「是否已安装」的判定（复用既有 ready 判定，不另造一套）。 */
const RESOURCE_INSTALLED: Record<VoiceResourceKind, (modelsRoot: string) => boolean> = {
  base: (root) => ALL_VOICE_REPOS.every((r) => existsSync(path.join(root, ...r.repo.split("/")))),
  zipvoice: (root) => zipvoiceReady(root),
  kws: (root) => kwsReady(root),
};

export function registerVoiceIpc3(ibA: ReturnType<typeof registerVoiceIpc1>) {
  const { voiceAudioForIpc, modelsRoot, svc, ipcHost } = ibA;
  ipcHost.handle("voice:profiles-preview", async (_event, input?: { id?: string; text?: string }) =>
    voiceAudioForIpc(await svc().previewVoice({ profileId: input?.id, text: input?.text }))
  );

  ipcHost.handle("voice:models-install", () => svc().installModels());
  ipcHost.handle("voice:models-cancel", () => ({ ok: svc().cancelInstall() }));
  ipcHost.handle("voice:models-import", async (_event, input: { sourceDir: string }) => {
    // ⛔ 10-03：停用状态下也拒绝导入。installModels 拦了但这条是**另一条入口** ——
    //   只拦一条就等于没拦（用户会从"本地导入"把 270MB 灌回来，停用形同虚设）。
    if (!isVoiceResourceEnabled(loadVoiceSettings(app.getPath("userData")), "base")) {
      return { ok: false, failures: ["语音基础模型已被停用 —— 请先重新启用再导入"] };
    }
    // 开发版：从开发者本机已下载的目录导入，按 repo 校验 SHA 后落盘到 userData/voice-models
    const { importRepoFromDir } = require("../../voice/model-store");
    const { ALL_VOICE_REPOS } = require("../../voice/model-manifest");
    const failures: string[] = [];
    for (const repo of ALL_VOICE_REPOS) {
      const f = await importRepoFromDir(modelsRoot(), input.sourceDir, repo, (progress: any) => {
        sendToWindow("voice:event", { type: "download", ...progress });
      });
      failures.push(...f.map((x: string) => `${repo.repo} → ${x}`));
    }
    await svc().refreshModelsReady();
    sendToWindow("voice:event", { type: "download", percent: 100, message: "导入完成" });
    sendToWindow("voice:event", { type: "downloadDone", ok: failures.length === 0, error: failures.slice(0, 3).join("；") });
    return { ok: failures.length === 0, failures };
  });
  ipcHost.handle("voice:models-reveal", () => {
    // 在文件管理器里打开模型目录（开发者验证下载内容用）
    return shell.openPath(modelsRoot());
  });

  // ── 已下载资源的三态管理：启用 / 停用 / 删除（10-03 用户要求）──
  //
  // 状态字段设计（真相源 = userData/voice-settings.json 的 resources 段）：
  //   resources[kind] === false → 停用；缺省或 true → 启用。
  //   为什么状态与文件分开放：模型目录会被「全部卸载」整个删掉，标记文件会一起消失，
  //   停用状态活不过卸载；而状态是几十字节、资源是几百 MB，生命周期本就不同。
  //
  // ⛔ 停用的语义边界（这三条决定了它是不是假功能）：
  //   1) **不删文件** —— 磁盘占用不变，重新启用立即可用，无需重下；
  //   2) **真的不加载** —— 判断点在 voice-service 的三处消费（installModels / zipvoice 合成 / kws 唤醒），
  //      停用后回退到内置音色或 asr 唤醒，并在日志里说明原因；
  //   3) **不再下载** —— 停用状态下点下载会被明确拒绝，而不是"下完不用"。

  /**
   * 白名单 + 路径双校验：渲染层传什么都不能删到 voice-models 之外。
   *
   * 用**类型谓词**返回（`kind is VoiceResourceKind`）而不是返回目录：校验通过这件事
   * 必须同时收窄调用方的类型，否则下游 `VOICE_RESOURCE_LABELS[kind]` 只能靠 `as any` 硬转
   * —— 那样白名单就退化成了运行时约定，编译期不再兜底。
   */
  const resourceDirOf = (kind: string): kind is VoiceResourceKind => {
    if (!isVoiceResourceKind(kind)) return false;
    const root = path.resolve(modelsRoot());
    if (!root) return false;
    // ⛔ base 的目录名是空串 ⇒ 解析结果就是 root 自身。它**是**合法的删除目标
    //    （三个仓库分散在根下，删 base 只能删整个根），所以这里允许 target === root；
    //    但绝不允许 target 落在 root 之外（".."、绝对路径、盘符都会被 startsWith 挡掉）。
    const target = path.resolve(root, RESOURCE_DIRS[kind]);
    return target === root || target.startsWith(root + path.sep);
  };
  /** 取目录字符串（调用前必须已通过 resourceDirOf 的白名单校验）。 */
  const dirOfKind = (kind: VoiceResourceKind): string => path.resolve(modelsRoot(), RESOURCE_DIRS[kind]);

  ipcHost.handle("voice:resource-set-enabled", async (_event, input: { kind?: string; enabled?: boolean }) => {
    const kind = String(input?.kind ?? "");
    if (!isVoiceResourceKind(kind)) return { ok: false, error: `未知的资源类型：${kind || "(空)"}` };
    // ⛔ 破坏性前置：删除一个正在跑的模型目录前必须先停掉持有句柄的 worker，
    //    否则 Windows 上 fs.rm 会 EBUSY（既有 models-uninstall 已踩过，用户看到的是
    //    「卸载失败但也没提示」）。停用/启用不走删除，但为一致性也在这里统一处理。
    const enabled = input?.enabled !== false;
    if (!enabled) svc().disposeIdleWorkers();
    const settings = setVoiceResourceEnabled(app.getPath("userData"), kind, enabled);
    // 唤醒是常驻监听：KWS 的启停必须立刻生效，否则「停了还在后台听着」（隐私问题，不只是体验）。
    if (kind === "kws" && svc().wakeListening()) {
      await svc().stopWakeListener();
      await svc().startWakeListener();
    }
    await svc().refreshModelsReady();
    return { ok: true, enabled, resources: voiceResourceStates(settings)[kind] };
  });

  ipcHost.handle("voice:resource-delete", async (_event, input: { kind?: string }) => {
    const kind = String(input?.kind ?? "");
    if (!resourceDirOf(kind)) return { ok: false, error: `未知的资源类型：${kind || "(空)"}` };
    const dir = dirOfKind(kind);
    // 停用中的资源拒绝删除：先让用户明确"我要启用它并重新下载"，
    // 避免"停用=安全暂存"被一次误点删除绕过（那等于停用形同虚设）。
    const settings = loadVoiceSettings(app.getPath("userData"));
    if (!isVoiceResourceEnabled(settings, kind)) {
      return { ok: false, error: `「${VOICE_RESOURCE_LABELS[kind]}」处于停用状态，请先重新启用再删除` };
    }
    // 与 models-uninstall 同款防御：解析后必须仍在 voice-models 内（防目录穿越）
    const root = path.resolve(modelsRoot());
    if (dir !== root && !dir.startsWith(root + path.sep)) {
      return { ok: false, error: "目标路径不在语音模型目录内，已取消删除" };
    }
    // ★ 必须先销毁工作线程：它们持有已加载的 onnx 文件句柄，Windows 上会让 fs.rm 报 EBUSY
    svc().disposeIdleWorkers();
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e: any) {
      return { ok: false, error: `删除失败：${e?.message ?? e}` };
    }
    await svc().refreshModelsReady();
    return { ok: true, kind };
  });

  /** 单个资源的状态（启用与否 + 是否已下载）。已下载仍走既有的 ready 判定，不重复造。 */
  ipcHost.handle("voice:resource-status", async (_event, input: { kind?: string }) => {
    const kind = String(input?.kind ?? "");
    if (!isVoiceResourceKind(kind)) return { ok: false, error: `未知的资源类型：${kind || "(空)"}` };
    if (!resourceDirOf(kind)) return { ok: false, error: "语音模型目录路径异常" };
    const settings = loadVoiceSettings(app.getPath("userData"));
    const dir = dirOfKind(kind);
    let bytes = 0;
    try { bytes = modelsSizeOnDisk(dir); } catch { bytes = 0; }
    return {
      ok: true,
      kind,
      enabled: isVoiceResourceEnabled(settings, kind),
      label: VOICE_RESOURCE_LABELS[kind],
      installed: RESOURCE_INSTALLED[kind](modelsRoot()),
      bytes,
      dir,
    };
  });

  ipcHost.handle("voice:models-uninstall", async () => {
    // 防御（破坏性操作必须显式收口）：只认 <userData>/voice-models 这一个专用子目录。
    // 万一将来路径拼错（比如退化成 userData 本身），宁可直接失败也不能端掉整个配置目录。
    const userData = app.getPath("userData");
    const expected = path.join(userData, "voice-models");
    const target = path.resolve(modelsRoot());
    if (!modelsRoot() || target !== path.resolve(expected) || target === path.resolve(userData)) {
      return { ok: false, error: "语音模型目录路径异常，已取消卸载" };
    }
    // 卸载 = 删除整个 voice-models 根目录（含 .part）；下次再点下载会重新拉。
    // ★ 必须先销毁「挂断后保活」的工作线程：它们持有已加载的 onnx 文件句柄，
    //   Windows 上会让 fs.rm 报 EBUSY（表现为「卸载失败但也没提示」）。
    svc().disposeIdleWorkers();
    await fs.rm(modelsRoot(), { recursive: true, force: true });
    await svc().refreshModelsReady();
    return { ok: true };
  });

  /** macOS 需要显式申请麦克风授权；Windows/Linux 直接按「已授权」处理。 */
  ipcHost.handle("voice:mic-permission", async () => {
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
