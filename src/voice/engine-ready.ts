/**
 * 播报引擎就绪状态（10-31，用户：「我没有下载语音模型啊，怎么开开关语音播报」）。
 *
 *  ⛔⛔ 问题不是"漏同步"，是**这个门控从来不存在**：10-26 的 f29dfbfae 只把
 *     「设置 → 语音通话 → 语音播报」那张卡片的开关与引擎就绪联动，
 *     而回合头的 📢 会话开关（`SessionAnnounceToggle`）和主进程下发的
 *     「当前语音播报：已开启」都没查过模型装没装 —— 于是没装模型时：
 *       · 📢 亮着（看起来一切正常）
 *       · 模型被告知"播报开着"，回复里就说「我会把关键结论念给你」
 *       · 真播的时候没有引擎 ⇒ **静默失败**（连报错都没有）
 *     三仓（桌面 / PPcode / 云助手）是同一份代码，所以三边现象一致。
 *
 *  ⛔ 单一真相源：`voice:models-status`（与设置页那张卡片同一份判据）。
 *    这里不自己推磁盘，也不缓存"用户选的是哪个引擎"——**任一套引擎可用就算就绪**
 *    （用户可以只装 Kokoro/情感语音而不装基础模型）。
 *  ⛔ 探针只起一次；`downloadDone` 到达就重拉（装完立刻能开播报，不必重启）。
 */
let ready = true;               // 未探测前按"就绪"处理：⛔ 不要用 false 当初始值，那会把正常用户误标成不可用
let started = false;
const listeners = new Set<() => void>();

export function getAnnounceEngineReady(): boolean {
  return ready;
}

export function subscribeAnnounceEngineReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 重新探测（可安全重复调用：并发只会多发一次 IPC）。 */
export async function refreshAnnounceEngineReady(): Promise<void> {
  try {
    const st: any = await window.codex.voiceModelsStatus?.();
    if (!st) return;
    /* 与 `use-voice-settings-section-state` 的 packs 同口径：
       基础模型按「就绪文件数 == 总数」；Kokoro 要求 ready 且 runnable；
       情感语音要求 ready 且 **runnable === true**（缺 onnxruntime 时不算就绪）。 */
    const total = Number(st?.totalFiles ?? 0);
    const base = total > 0 ? Number(st?.readyFiles ?? 0) === total : Boolean(st?.ready);
    const kokoro = Boolean(st?.kokoro?.ready) && st?.kokoro?.runnable !== false;
    const emotivoice = Boolean(st?.emotivoice?.ready) && st?.emotivoice?.runnable === true;
    const next = base || kokoro || emotivoice;
    if (next === ready) return;
    ready = next;
    for (const fn of [...listeners]) fn();
  } catch {
    /* 读不到就保持现状（⛔ 不假装能用，也不假装不能用） */
  }
}

/** 起一次探针：立刻探一次，之后 `downloadDone` 再探。重复调用无副作用。 */
export function startAnnounceEngineProbe(): void {
  if (started) return;
  started = true;
  void refreshAnnounceEngineReady();
  try {
    window.codex.onVoiceEvent?.((event: any) => {
      if (event?.type === "downloadDone") void refreshAnnounceEngineReady();
    });
  } catch { /* 忽略：没有该桥时仅剩首次探测 */ }
}
