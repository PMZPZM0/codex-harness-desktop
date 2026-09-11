/**
 * 语音通话设置：音色 / 语速 / 打断灵敏度 / 打断方式 / 模型镜像源。
 *
 * 状态由主进程持有（userData/voice-settings.json），通过 IPC 读写；
 * 改值后立即同步到主进程，**下一次**开始通话时生效。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Mic, ShieldAlert, Zap } from "lucide-react";

type Settings = {
  tts: { sid: number; speed: number };
  barge: { gateDb: number; mode: "auto" | "manual" };
  modelHost: "auto" | "huggingface" | "hf-mirror";
};
type Meta = {
  ttsVoices: Record<number, string>;
  modelHosts: Record<string, string>;
};

export default function VoiceSettingsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    window.codex.voiceSettingsGet()
      .then((res) => {
        if (!alive) return;
        setSettings(res.settings as Settings);
        setMeta({ ttsVoices: res.ttsVoices, modelHosts: res.modelHosts });
      })
      .catch((e: any) => onNotice(`读取语音设置失败：${e?.message ?? e}`));
    return () => { alive = false; };
  }, [onNotice]);

  const apply = useCallback((patch: Partial<Settings>) => {
    if (!settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const next: Settings = { ...settings, ...patch, tts: { ...settings.tts, ...(patch.tts ?? {}) }, barge: { ...settings.barge, ...(patch.barge ?? {}) } };
    setSettings(next);
    window.codex.voiceSettingsSet(patch)
      .then((saved) => setSettings(saved as Settings))
      .catch((e: any) => onNotice(`保存语音设置失败：${e?.message ?? e}`))
      .finally(() => { savingRef.current = false; setSaving(false); });
  }, [settings, onNotice]);

  const voiceOptions = useMemo(() => {
    if (!meta) return [] as { value: number; label: string }[];
    return Object.entries(meta.ttsVoices)
      .map(([k, v]) => ({ value: Number(k), label: v }))
      .sort((a, b) => a.value - b.value);
  }, [meta]);

  if (!settings || !meta) {
    return <section className="settings-section stack voice-settings"><div className="settings-section-title">语音通话</div><div style={{ opacity: 0.6 }}>读取中…</div></section>;
  }

  return (
    <section className="settings-section stack voice-settings">
      <div className="settings-section-title">语音通话</div>
      <div className="settings-section-desc">
        本机离线识别与合成（<code>sherpa-onnx</code>）。点右下角悬浮球开始通话；改值后下次通话生效。
      </div>

      <div className="settings-row">
        <label>
          <span className="settings-label-main"><Headphones size={14} />音色</span>
          <select
            value={settings.tts.sid}
            onChange={(e) => apply({ tts: { sid: Number(e.target.value), speed: settings.tts.speed } })}
            disabled={saving}
          >
            {voiceOptions.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-row">
        <label>
          <span className="settings-label-main">语速 <small style={{ opacity: 0.6 }}>{settings.tts.speed.toFixed(2)}x</small></span>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={settings.tts.speed}
            onChange={(e) => apply({ tts: { sid: settings.tts.sid, speed: Number(e.target.value) } })}
            disabled={saving}
          />
        </label>
      </div>

      <div className="settings-row">
        <label>
          <span className="settings-label-main"><Mic size={14} />打断灵敏度 <small style={{ opacity: 0.6 }}>{settings.barge.gateDb} dB</small></span>
          <input
            type="range"
            min={3}
            max={12}
            step={1}
            value={settings.barge.gateDb}
            onChange={(e) => apply({ barge: { gateDb: Number(e.target.value), mode: settings.barge.mode } })}
            disabled={saving}
          />
          <small className="settings-hint">安静环境 6~8；外放/嘈杂调到 10~12 减少误触发</small>
        </label>
      </div>

      <div className="settings-row">
        <label>
          <span className="settings-label-main">打断方式</span>
          <div className="voice-mode-row">
            <label className="voice-mode-opt">
              <input
                type="radio"
                name="bargeMode"
                value="auto"
                checked={settings.barge.mode === "auto"}
                onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "auto" } })}
                disabled={saving}
              />
              <span>自动（耳机/安静环境推荐）</span>
            </label>
            <label className="voice-mode-opt">
              <input
                type="radio"
                name="bargeMode"
                value="manual"
                checked={settings.barge.mode === "manual"}
                onChange={() => apply({ barge: { gateDb: settings.barge.gateDb, mode: "manual" } })}
                disabled={saving}
              />
              <span>手动（外放推荐，避开回声误触）</span>
            </label>
          </div>
        </label>
      </div>

      <div className="settings-row">
        <label>
          <span className="settings-label-main"><Zap size={14} />模型下载镜像源</span>
          <select
            value={settings.modelHost}
            onChange={(e) => apply({ modelHost: e.target.value as Settings["modelHost"] })}
            disabled={saving}
          >
            {Object.entries(meta.modelHosts).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <small className="settings-hint">自动模式会先测速选最快的；强制模式只走指定源</small>
        </label>
      </div>

      <div className="settings-row voice-settings-note">
        <ShieldAlert size={14} />
        <span>
          {settings.barge.mode === "manual"
            ? "手动模式：播报时你说话不会自动停 TTS，点「打断」按钮或按住快捷键才停。"
            : "自动模式：播报时检测到真人插话（高于回声地板）即停 TTS + turn/interrupt。"}
        </span>
      </div>
    </section>
  );
}
