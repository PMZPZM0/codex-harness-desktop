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
import { TriangleAlert, Volume2 } from "lucide-react";
import { useState } from "react";
import { AppSelect } from "../AppSelect";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<Settings>) => void;
  saving: boolean;
  settings: Settings;
  /** 当前引擎是否真的能合成（模型装了且可运行）—— 播报开关的准入判据 */
  ttsReady: boolean;
  /** 缺模型时直达「必需 · 基础语音模型」 */
  onGoModels: () => void;
};

export function VoiceSettingsSectionAnnounce({ apply, saving, settings, ttsReady, onGoModels }: Props) {
  /* ⛔ 没有可用引擎时不许把开关打开（打开=承诺会出声）。点了给一句能照做的说明 + 直达下载。 */
  const [blocked, setBlocked] = useState(false);
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
            {/* ⛔ 显示态 = 设置值 **且** 引擎就绪：没装引擎时一律显示为关（否则就是"开关开着但没声音"
                的假象）。⛔ 不改存储值 —— 装好模型后按用户原来的偏好自动生效。 */}
            <input
              type="checkbox"
              checked={enabled && ttsReady}
              onChange={(e) => {
                /* ⛔ 10-26：打开播报 = 承诺"会出声"。没有合成引擎时不许打开 ——
                   但也不能装死：把原因与去处写在下面那一行里（10-20 教训：灰按钮点了没反应最差）。 */
                if (e.target.checked && !ttsReady) { setBlocked(true); return; }
                setBlocked(false);
                apply({ announce: { enabled: e.target.checked } });
              }}
              disabled={saving}
            />
            <span>播报 Codex 写的内容</span>
          </label>
        </div>
        {!ttsReady && (
          <div className="voice-gate-hint">
            <TriangleAlert size={13} />
            <span>
              {blocked ? "还不能打开：本机没有可用的合成引擎，打开了也不会有声音。"
                : "本机还没有可用的合成引擎，播报不会有声音。"}
              先装「必需 · 基础语音模型」（约 270MB，轻量播报随它一起装）。
              {enabled ? "装好之后会自动按你原来的设置开启。" : ""}
            </span>
            <button type="button" className="secondary-setting" onClick={onGoModels}>去装模型</button>
          </div>
        )}
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
