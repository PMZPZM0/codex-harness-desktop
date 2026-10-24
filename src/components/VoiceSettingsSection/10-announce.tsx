/**
 * VoiceSettingsSectionAnnounce —— 设置页「语音播报」卡片（10-08 立，10-09 第二轮收成一个总开关）。
 *
 * 用户需求演进：
 *   · 10-08：「新增两个播报功能：一是运行过程中的正文实时播报，二是运行结束后对最终消息进行汇总播报」
 *            + 「在设置界面中为这两个播报功能分别添加对应的开关选项」；
 *   · 10-09 第一轮：「播报内容改由 Codex 自己写」（回复末尾的 `voice` 播报稿）；
 *   · 10-09 第二轮：「运行的正文和汇总正文不用播报了，只播报 Codex 写的内容」
 *            ⇒ 两个开关**收成一个**（`announce.enabled`）：正文逐句播报与本机压缩汇总整条删除。
 *
 * ⛔ 语速**不在这里另开一份**：与通话共用 `tts.speed`（单一真相源）—— 两个语速迟早对不上。
 * ⛔ `voice_announce` 工具插播**不受这个开关管**（显式调用 = 用户就要听这一句）。
 */
import { Volume2 } from "lucide-react";
import { AppSelect } from "../AppSelect";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<Settings>) => void;
  saving: boolean;
  settings: Settings;
};

export function VoiceSettingsSectionAnnounce({ apply, saving, settings }: Props) {
  /* ⛔ 兜底（与 VoiceDevToolsSection 的 `enabled !== false` 同一约定）：设置是**显式字段映射**
     过的对象，老主进程（未重启 / 渲染层被单独 reload）回包可能还是旧形状 `{live, summary}` ——
     直接读 `settings.announce.enabled` 会让开关显示成"关着"（甚至整页白屏）。
     旧形状的判据与主进程迁移同源：**任一为真即视为开着**。 */
  const announce: any = settings.announce ?? { enabled: true };
  const enabled = typeof announce.enabled === "boolean"
    ? announce.enabled
    : (announce.live !== false || announce.summary === true);
  /* 音质档（合成步数）：老主进程/未重启的回包可能还没有这个字段 ⇒ 回落 4（与主进程缺省一致）。 */
  const numSteps = Number.isFinite(Number(settings.tts?.numSteps)) ? Number(settings.tts?.numSteps) : 4;
  return (
    <div className="voice-card" data-voice-announce="1">
      <div className="voice-card-head"><Volume2 size={15} /><span>语音播报</span></div>
      <div className="voice-card-body">
        <div className="voice-toggles">
          <label className="voice-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => apply({ announce: { enabled: e.target.checked } })}
              disabled={saving}
            />
            <span>播报 Codex 写的内容</span>
          </label>
        </div>
        {/* 10-24 用户报「播报声音太沙哑，听不清」：播报端原先写死 2 步（换延迟）⇒ 音质明显掉。
            改成三档可选，默认「标准（4 步）= 模型默认音质」。⛔ 与通话/试听共用 tts.numSteps。 */}
        <div className="voice-toggle" style={{ marginTop: 8, alignItems: "center", gap: 10 }}>
          <span style={{ minWidth: 64 }}>播报音质</span>
          <AppSelect
            className="voice-input"
            value={String(numSteps)}
            onChange={(v) => apply({ tts: { ...settings.tts, numSteps: Number(v) } })}
            disabled={saving}
            ariaLabel="播报音质"
            options={[
              { value: "2", label: "极速 · 2 步（最跟手，略沙哑）" },
              { value: "4", label: "标准 · 4 步（默认，推荐）" },
              { value: "8", label: "清晰 · 8 步（更清晰，合成约慢一倍）" },
            ]}
          />
        </div>
        <div className="voice-card-hint">
          开启后，应用会念 <strong>Codex 自己写的播报稿</strong> —— 它在回复末尾写一个小块
          （屏幕上不显示），念什么、什么语气都由它按上下文自己定；<strong>写不写、写什么，由它决定</strong>，
          没写就不念。此外它可以随时<strong>主动插一句话</strong>（那条不受本开关管）。
          <br />
          <strong>不再自动念正文、也不再念总结</strong>：跑的过程中不会逐句念回复，跑完也不会复述一遍要点 ——
          省下的时间留给它挑的那一句重点。
          <br />
          通话中与非通话时都生效；<strong>非通话时只听不说话</strong>（不开麦克风），所以播报期间
          输入框上方会出现一条「语音播报中」的状态条（显示当前句与待播句数），<strong>点「停止」随时掐断</strong>，
          也可以右键悬浮球选择停止播报。语速见下方「语速」卡片（播报与通话共用同一档）；
          <strong>觉得声音沙哑就调上面「播报音质」</strong>（步数越多越清晰、合成越慢），
          觉得赶不上就选「极速」。
        </div>
      </div>
    </div>
  );
}
