/**
 * 语音通话设置（完整配套）：
 *   音色（带**试听**） / 语速 / 音量 / 麦克风（选择 + 电平测试 + 降噪回声消除开关）
 *   / 断句灵敏度 / 识别线程数 / 打断灵敏度 / 打断方式 / 模型镜像源
 *
 * 设计：每条设置**单独一张卡片**——标题一行、控件铺满卡片宽度、提示在底部。
 *
 * 状态由主进程持有（userData/voice-settings.json），通过 IPC 读写；
 * 改值后立即同步到主进程，**下一次**开始通话时生效（音色试听是即时的）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Keyboard, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Zap } from "lucide-react";
import { decodeFloat32Base64 } from "../voice/audio-transport";

type Settings = {
  tts: { sid: number; speed: number; volume: number };
  asr: { rule1: number; rule2: number; rule3: number; numThreads: number };
  mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
  barge: { gateDb: number; mode: "auto" | "manual" };
  modelHost: "auto" | "huggingface" | "hf-mirror";
  hotkey: { enabled: boolean; accelerator: string };
  dictationHotkey: { enabled: boolean; accelerator: string };
  wake: { enabled: boolean; phrase: string };
  ball: { visible: boolean; hints: boolean };
};
type Meta = {
  ttsVoices: Record<number, string>;
  modelHosts: Record<string, string>;
};

/** 试听时把 samples 播出来（独立于通话的播放链路，用最简单的 AudioContext） */
async function playSamples(samples: Float32Array | undefined, sampleRate: number | undefined) {
  if (!samples || !sampleRate) return;
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.onended = () => { void ctx.close().catch(() => undefined); };
  src.start();
}

export default function VoiceSettingsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // 试听
  const [auditioning, setAuditioning] = useState(false);
  // 麦克风列表 + 电平测试
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  // 快捷键录入中（通话快捷键 / 长按听写快捷键）
  const [capturing, setCapturing] = useState<"call" | "dictation" | null>(null);
  // 唤醒词草稿（输完失焦/回车才落盘，避免每敲一个字就写一次文件）
  const [wakePhraseDraft, setWakePhraseDraft] = useState("");
  const micTestRef = useRef<{ stop: () => void } | null>(null);
  /** 设置从主进程读回来后，同步一次唤醒词草稿 */
  const wakePhraseSyncedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    window.codex.voiceSettingsGet()
      .then((res) => {
        if (!alive) return;
        setSettings(res.settings as Settings);
        setMeta({ ttsVoices: res.ttsVoices, modelHosts: res.modelHosts });
      })
      .catch((e: any) => onNotice(`读取语音设置失败：${e?.message ?? e}`));
    // 设备列表：标签要授权后才可读，拿不到就退化成「麦克风 N」
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        if (!alive) return;
        const inputs = (devices ?? []).filter((d) => d.kind === "audioinput");
        setMics(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` })));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [onNotice]);

  // 卸载时停掉电平测试
  useEffect(() => () => { micTestRef.current?.stop(); }, []);

  const apply = useCallback((patch: Partial<Settings>) => {
    if (!settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const next: Settings = {
      ...settings,
      ...patch,
      tts: { ...settings.tts, ...(patch.tts ?? {}) },
      asr: { ...settings.asr, ...(patch.asr ?? {}) },
      mic: { ...settings.mic, ...(patch.mic ?? {}) },
      barge: { ...settings.barge, ...(patch.barge ?? {}) },
    };
    setSettings(next);
    window.codex.voiceSettingsSet(patch)
      .then((saved) => setSettings(saved as Settings))
      .catch((e: any) => onNotice(`保存语音设置失败：${e?.message ?? e}`))
      .finally(() => { savingRef.current = false; setSaving(false); });
  }, [settings, onNotice]);

  const audition = useCallback(async () => {
    if (!settings || auditioning) return;
    setAuditioning(true);
    try {
      const r = await window.codex.voicePreviewVoice({ sid: settings.tts.sid, speed: settings.tts.speed });
      if (!r.ok) { onNotice(`试听失败：${r.error ?? "未知"}`); return; }
      const samples = decodeFloat32Base64(r.audioBase64);
      if (!samples.length) { onNotice("试听失败：合成结果没有音频数据"); return; }
      await playSamples(samples, r.sampleRate);
    } catch (e: any) {
      onNotice(`试听失败：${e?.message ?? e}`);
    } finally {
      setAuditioning(false);
    }
  }, [settings, auditioning, onNotice]);

  const toggleMicTest = useCallback(async () => {
    if (micTesting) {
      micTestRef.current?.stop();
      micTestRef.current = null;
      setMicTesting(false);
      setMicLevel(0);
      return;
    }
    if (!settings) return;
    try {
      const constraint: MediaTrackConstraints = {
        echoCancellation: settings.mic.echoCancellation,
        noiseSuppression: settings.mic.noiseSuppression,
        autoGainControl: settings.mic.autoGainControl,
      };
      if (settings.mic.deviceId) constraint.deviceId = { ideal: settings.mic.deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 8));
        raf = requestAnimationFrame(tick);
      };
      tick();
      micTestRef.current = {
        stop: () => {
          cancelAnimationFrame(raf);
          src.disconnect();
          void ctx.close().catch(() => undefined);
          stream.getTracks().forEach((t) => t.stop());
        },
      };
      setMicTesting(true);
    } catch (e: any) {
      // 报错人话化：用户截图反馈「麦克风测试用不了」时，原始报错只有英文名
      // （实测无设备机器上是 NotFoundError | Requested device not found），看不出该修什么。
      const name = String(e?.name ?? "");
      const friendly = name === "NotFoundError"
        ? "系统里没有检测到可用的麦克风输入设备——请确认麦克风已接好、未被禁用，且已在「Windows 设置 → 隐私和安全性 → 麦克风」里允许桌面应用使用。"
        : name === "NotAllowedError"
          ? "麦克风权限被拒绝——请在「Windows 设置 → 隐私和安全性 → 麦克风」里允许桌面应用访问麦克风，然后重试。"
          : name === "NotReadableError"
            ? "麦克风被其它程序占用或硬件无响应——关掉正在录音/通话的程序（会议软件、录音机等）后重试。"
            : name === "OverconstrainedError"
              ? "所选麦克风当前不可用（可能已拔出）——换成「系统默认设备」再试。"
              : `${name || "未知错误"} ${e?.message ?? e}`;
      onNotice(`麦克风测试失败：${friendly}`);
    }
  }, [micTesting, settings, onNotice]);

  // 首次读到设置后同步唤醒词草稿（之后以用户输入为准，不再覆盖）
  useEffect(() => {
    if (!settings?.wake?.phrase || wakePhraseSyncedRef.current) return;
    setWakePhraseDraft(settings.wake.phrase);
    wakePhraseSyncedRef.current = true;
  }, [settings?.wake?.phrase]);

  /** 录入快捷键：按住组合键 → 翻译成 Electron accelerator 字符串 */
  const captureHotkey = useCallback((kind: "call" | "dictation" = "call") => {
    setCapturing(kind);
    const cleanup = () => {
      setCapturing(null);
      window.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { cleanup(); return; }
      // 必须带修饰键（单键会吞掉正常输入，不收）
      const mods: string[] = [];
      if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (!mods.length) return;
      const keyRaw = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const letter = e.code?.match(/^Key([A-Z])$/)?.[1];
      const main = letter || (/^F\d{1,2}$/.test(keyRaw) ? keyRaw : /^[A-Z0-9]$/.test(keyRaw) ? keyRaw : "");
      if (!main) return;
      const accelerator = [...mods, main].join("+");
      cleanup();
      if (kind === "dictation") {
        apply({ dictationHotkey: { enabled: true, accelerator } });
      } else {
        apply({ hotkey: { enabled: true, accelerator } });
        void window.codex.voiceHotkeySet({ accelerator, enabled: true }).then((r: any) => {
          if (!r?.ok) onNotice(`快捷键注册失败：${r?.error ?? "可能被其它程序占用"}`);
        });
      }
    };
    window.addEventListener("keydown", onKey, true);
  }, [apply, onNotice]);

  const commitWakePhrase = useCallback(() => {
    if (!settings) return;
    const phrase = wakePhraseDraft.replace(/\s+/g, "").slice(0, 16);
    if (!phrase || phrase === settings.wake.phrase) return;
    apply({ wake: { enabled: settings.wake.enabled, phrase } });
  }, [settings, wakePhraseDraft, apply]);

  const voiceOptions = useMemo(() => {
    if (!meta) return [] as { value: number; label: string }[];
    return Object.entries(meta.ttsVoices)
      .map(([k, v]) => ({ value: Number(k), label: v }))
      .sort((a, b) => a.value - b.value);
  }, [meta]);

  if (!settings || !meta) {
    return (
      <section className="settings-section stack voice-settings">
        <div className="settings-section-title">语音通话</div>
        <div className="voice-settings-loading">读取中…</div>
      </section>
    );
  }

  return (
    <section className="settings-section stack voice-settings">
      <div className="settings-section-title">语音通话</div>
      <div className="settings-section-desc">
        本机离线识别与合成（<code>sherpa-onnx</code>）。点右下角悬浮球开始通话；改值后下次通话生效（试听即时）。
      </div>

      {/* 音色 + 试听 */}
      <div className="voice-card">
        <div className="voice-card-head"><Headphones size={15} /><span>音色</span></div>
        <div className="voice-card-body">
          <div className="voice-row">
            <select
              className="voice-input"
              value={settings.tts.sid}
              onChange={(e) => apply({ tts: { ...settings.tts, sid: Number(e.target.value) } })}
              disabled={saving}
            >
              {voiceOptions.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
            <button className="secondary-setting voice-audition" onClick={() => void audition()} disabled={auditioning || saving}>
              <Play size={13} />{auditioning ? "合成中…" : "试听"}
            </button>
          </div>
          <div className="voice-card-hint">点「试听」会用当前音色和语速念一句示例话，用来对比哪个声音合适。</div>
        </div>
      </div>

      {/* 语速 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>语速</span>
          <span className="voice-card-value">{settings.tts.speed.toFixed(2)}×</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={settings.tts.speed}
            onChange={(e) => apply({ tts: { ...settings.tts, speed: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">慢 0.5× ↔ 快 2.0×</div>
        </div>
      </div>

      {/* 音量 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>播报音量</span>
          <span className="voice-card-value">{Math.round(settings.tts.volume * 100)}%</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0}
            max={2.0}
            step={0.05}
            value={settings.tts.volume}
            onChange={(e) => apply({ tts: { ...settings.tts, volume: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">0%（静音）↔ 100%（原始音量）↔ 200%（放大）</div>
        </div>
      </div>

      {/* 麦克风 */}
      <div className="voice-card">
        <div className="voice-card-head"><Mic size={15} /><span>麦克风</span></div>
        <div className="voice-card-body">
          <select
            className="voice-input"
            value={settings.mic.deviceId}
            onChange={(e) => apply({ mic: { ...settings.mic, deviceId: e.target.value } })}
            disabled={saving}
          >
            <option value="">系统默认设备</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
            ))}
            {!mics.length && <option value="" disabled>（未检测到麦克风设备）</option>}
          </select>
          <div className="voice-row">
            <button className="secondary-setting" onClick={() => void toggleMicTest()}>
              {micTesting ? <Square size={13} /> : <Mic size={13} />}{micTesting ? "停止测试" : "测试麦克风"}
            </button>
            {micTesting && (
              <div className="voice-level" title="对着麦克风说话，条会动说明拾音正常">
                <span style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="voice-card-hint">
            {!mics.length
              ? "未检测到任何麦克风输入设备——本机的语音通话 / 语音输入用不了（不影响渠道语音消息转写，那不需要本机麦克风）。请检查设备是否接好、是否被禁用。"
              : micTesting ? "对着麦克风说话——上面的电平条会跳动，说明这个设备能正常拾音。" : "选不到想要的麦克风？先在别的程序里禁用/拔掉多余的，或点「测试麦克风」确认拾音。"}
          </div>
          <div className="voice-toggles">
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.mic.echoCancellation}
                onChange={(e) => apply({ mic: { ...settings.mic, echoCancellation: e.target.checked } })}
                disabled={saving}
              />
              <span>回声消除（外放时建议开）</span>
            </label>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.mic.noiseSuppression}
                onChange={(e) => apply({ mic: { ...settings.mic, noiseSuppression: e.target.checked } })}
                disabled={saving}
              />
              <span>噪声抑制（环境吵时开，可能压低人声）</span>
            </label>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.mic.autoGainControl}
                onChange={(e) => apply({ mic: { ...settings.mic, autoGainControl: e.target.checked } })}
                disabled={saving}
              />
              <span>自动增益（离麦远时开，会放大底噪）</span>
            </label>
          </div>
        </div>
      </div>

      {/* 断句灵敏度 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>断句等待</span>
          <span className="voice-card-value">{settings.asr.rule1.toFixed(1)} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.4}
            max={6.0}
            step={0.1}
            value={settings.asr.rule1}
            onChange={(e) => apply({ asr: { ...settings.asr, rule1: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">
            说完停多久算「这句说完了」。<strong>调小反应更快</strong>（0.4~1.2 秒），但容易被自己的停顿截断；调大更稳但等得久。
          </div>
        </div>
      </div>

      {/* 长句阈值 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>长句提前断句</span>
          <span className="voice-card-value">{settings.asr.rule2.toFixed(1)} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={0.2}
            max={4.0}
            step={0.1}
            value={settings.asr.rule2}
            onChange={(e) => apply({ asr: { ...settings.asr, rule2: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">已经说了一大段时，用更短的停顿就断句（避免长句子憋着不提交）。</div>
        </div>
      </div>

      {/* 单句上限 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>单句最长时长</span>
          <span className="voice-card-value">{settings.asr.rule3} 秒</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={3}
            max={60}
            step={1}
            value={settings.asr.rule3}
            onChange={(e) => apply({ asr: { ...settings.asr, rule3: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">到点强制成句提交，防止一直不停地说导致迟迟不出字。</div>
        </div>
      </div>

      {/* 识别线程数 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <span>识别线程数</span>
          <span className="voice-card-value">{settings.asr.numThreads} 线程</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={1}
            max={4}
            step={1}
            value={settings.asr.numThreads}
            onChange={(e) => apply({ asr: { ...settings.asr, numThreads: Number(e.target.value) } })}
            disabled={saving}
          />
          <div className="voice-card-hint">CPU 核心多可以调高（识别更跟手）；机器弱或要省电就调低。</div>
        </div>
      </div>

      {/* 打断灵敏度 */}
      <div className="voice-card">
        <div className="voice-card-head">
          <Mic size={15} /><span>打断灵敏度</span>
          <span className="voice-card-value">{settings.barge.gateDb} dB</span>
        </div>
        <div className="voice-card-body">
          <input
            className="voice-range"
            type="range"
            min={3}
            max={12}
            step={1}
            value={settings.barge.gateDb}
            onChange={(e) => apply({ barge: { gateDb: Number(e.target.value), mode: settings.barge.mode } })}
            disabled={saving}
          />
          <div className="voice-card-hint">安静环境 6~8 / 外放或嘈杂 10~12 减少误触发</div>
        </div>
      </div>

      {/* 打断方式 */}
      <div className="voice-card">
        <div className="voice-card-head"><span>打断方式</span></div>
        <div className="voice-card-body voice-card-body-row">
          <label className={`voice-radio ${settings.barge.mode === "auto" ? "active" : ""}`}>
            <input
              type="radio"
              name="bargeMode"
              value="auto"
              checked={settings.barge.mode === "auto"}
              onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "auto" } })}
              disabled={saving}
            />
            <div className="voice-radio-body">
              <strong>自动</strong>
              <span>耳机 / 安静环境推荐；播报时检测到真人插话即停 TTS + turn/interrupt。</span>
            </div>
          </label>
          <label className={`voice-radio ${settings.barge.mode === "manual" ? "active" : ""}`}>
            <input
              type="radio"
              name="bargeMode"
              value="manual"
              checked={settings.barge.mode === "manual"}
              onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "manual" } })}
              disabled={saving}
            />
            <div className="voice-radio-body">
              <strong>手动</strong>
              <span>外放推荐，避开回声误触；只有按「打断」按钮才停 TTS。</span>
            </div>
          </label>
        </div>
      </div>

      {/* 悬浮球（显示 / 随机气泡） */}
      <div className="voice-card">
        <div className="voice-card-head"><Sparkles size={15} /><span>悬浮球</span></div>
        <div className="voice-card-body">
          <div className="voice-toggles">
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.ball.visible}
                onChange={(e) => apply({ ball: { visible: e.target.checked, hints: settings.ball.hints } })}
                disabled={saving}
              />
              <span>显示悬浮球</span>
            </label>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.ball.hints}
                onChange={(e) => apply({ ball: { visible: settings.ball.visible, hints: e.target.checked } })}
                disabled={saving}
              />
              <span>冒随机的短提示气泡</span>
            </label>
          </div>
          <div className="voice-card-hint">
            关掉显示后，可以回到这里重新打开；悬浮球上<strong>右键</strong>也能直接隐藏或跳到本页。
          </div>
        </div>
      </div>

      {/* 按键启动（全局快捷键） */}
      <div className="voice-card">
        <div className="voice-card-head"><Keyboard size={15} /><span>按键启动</span></div>
        <div className="voice-card-body">
          <div className="voice-row">
            <button className="secondary-setting" onClick={() => captureHotkey("call")} disabled={Boolean(capturing)}>
              {capturing === "call" ? "请按下组合键…（Esc 取消）" : "录入快捷键"}
            </button>
            <code className="voice-kbd">{settings.hotkey.accelerator || "未设置"}</code>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.hotkey.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  apply({ hotkey: { enabled, accelerator: settings.hotkey.accelerator } });
                  void window.codex.voiceHotkeySet({ accelerator: settings.hotkey.accelerator, enabled });
                }}
                disabled={saving}
              />
              <span>启用（应用没聚焦也能唤起）</span>
            </label>
          </div>
          <div className="voice-card-hint">
            系统级快捷键，按一下开始、再按一下结束。需要至少带一个修饰键（Ctrl / Shift / Alt），避免吞掉正常输入。
          </div>
        </div>
      </div>

      {/* 长按语音输入快捷键（仅应用内：按住开始听写，松开结束） */}
      <div className="voice-card">
        <div className="voice-card-head"><Mic size={15} /><span>长按语音输入</span></div>
        <div className="voice-card-body">
          <div className="voice-row">
            <button className="secondary-setting" onClick={() => captureHotkey("dictation")} disabled={Boolean(capturing)}>
              {capturing === "dictation" ? "请按下组合键…（Esc 取消）" : "录入长按快捷键"}
            </button>
            <code className="voice-kbd">{settings.dictationHotkey.accelerator || "未设置"}</code>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.dictationHotkey.enabled}
                onChange={(e) => apply({ dictationHotkey: { enabled: e.target.checked, accelerator: settings.dictationHotkey.accelerator } })}
                disabled={saving}
              />
              <span>启用</span>
            </label>
          </div>
          <div className="voice-card-hint">
            在应用内<strong>按住</strong>快捷键开始语音输入，松开即结束；识别出的中文字幕会放进输入框，确认后再点发送。默认 Alt + Space。
          </div>
        </div>
      </div>

      {/* 语音唤醒 */}
      <div className="voice-card">
        <div className="voice-card-head"><Radio size={15} /><span>语音唤醒</span></div>
        <div className="voice-card-body">
          <label className="voice-toggle">
            <input
              type="checkbox"
              checked={settings.wake.enabled}
              onChange={(e) => apply({ wake: { enabled: e.target.checked, phrase: wakePhraseDraft || settings.wake.phrase } })}
              disabled={saving}
            />
            <span>持续聆听并等待唤醒词</span>
          </label>
          <input
            className="voice-input"
            value={wakePhraseDraft}
            placeholder="唤醒词，例如：小柯小柯"
            onChange={(e) => setWakePhraseDraft(e.target.value)}
            onBlur={commitWakePhrase}
            onKeyDown={(e) => { if (e.key === "Enter") commitWakePhrase(); }}
            disabled={saving}
          />
          <div className="voice-card-hint">
            说出唤醒词即可开始通话（识别文本归一化后再匹配，会忽略空格与标点）。
            <strong>注意：开启后会持续占用 CPU</strong>——这里复用的是已有的识别模型，不是专门的低功耗唤醒模型；不用时建议关掉。
          </div>
        </div>
      </div>

      {/* 镜像源 */}
      <div className="voice-card">
        <div className="voice-card-head"><Zap size={15} /><span>模型下载镜像源</span></div>
        <div className="voice-card-body">
          <select
            className="voice-input"
            value={settings.modelHost}
            onChange={(e) => apply({ modelHost: e.target.value as Settings["modelHost"] })}
            disabled={saving}
          >
            {Object.entries(meta.modelHosts).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="voice-card-hint">自动模式会先并发 HEAD 测速，按延迟排序选最快源；强制模式只走指定源。</div>
        </div>
      </div>

      <div className="voice-card voice-card-note">
        <ShieldAlert size={15} />
        <span>
          {settings.barge.mode === "manual"
            ? "手动模式下，播报时你说话不会自动停 TTS——需要点「打断」按钮才会停。"
            : "自动模式下，播报时检测到真人插话（高于回声地板）即自动停 TTS 并 turn/interrupt。"}
        </span>
      </div>
    </section>
  );
}