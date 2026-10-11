/**
 * 外观设置里的「开机动画」行：档位三选一（简易 / 完整 / 关闭）+ 配色四选一 + 预览。
 *
 * 持久化走 localStorage（键见 src/lib/boot-intro.mjs），与「消息字号」同款 ——
 * 启动首帧要在 React 之前同步读到它，走主进程 IPC 会来不及（index.html 的内联脚本读同一个键）。
 * ⛔ 本行自包含（本地 state，不进 bag），与组件库页同款；设置页注册表零改动。
 */
import { useState } from "react";
import { Clapperboard } from "lucide-react";
import {
  BOOT_INTRO_MODES,
  BOOT_INTRO_SCHEMES,
  bootIntroModeLabel,
  bootIntroSchemeLabel,
  normalizeBootIntroMode,
  normalizeBootIntroScheme,
  readBootIntroMode,
  readBootIntroScheme,
  shouldPlayBootIntro,
  writeBootIntroMode,
  writeBootIntroScheme,
} from "../../../lib/boot-intro.mjs";
import { BootIntro550c } from "./BootIntro550c";

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

export function BootIntroSettingsRow({ onNotice }: { onNotice?: (text: string) => void }) {
  const [mode, setMode] = useState(() => normalizeBootIntroMode(readBootIntroMode(storage())));
  const [scheme, setScheme] = useState(() => normalizeBootIntroScheme(readBootIntroScheme(storage())));
  const [preview, setPreview] = useState<"simple" | "full" | null>(null);

  const chooseMode = (next: string) => {
    const normalized = normalizeBootIntroMode(next);
    writeBootIntroMode(storage(), normalized);
    setMode(normalized);
    onNotice?.(`开机动画：${bootIntroModeLabel(normalized)}`);
  };

  const chooseScheme = (next: string) => {
    const normalized = normalizeBootIntroScheme(next);
    writeBootIntroScheme(storage(), normalized);
    setScheme(normalized);
    onNotice?.(`开机动画配色：${bootIntroSchemeLabel(normalized)}`);
  };

  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canPreview = shouldPlayBootIntro(mode, { reducedMotion, petWindow: false });

  return (
    <>
      <div className="settings-subhead">
        <Clapperboard size={13} />开机动画
        <span className="settings-subhead-hint">启动时播放 550C 片头；播放中点画面或按 Esc 可跳过</span>
      </div>
      <div className="theme-switch three" role="group" aria-label="开机动画">
        {BOOT_INTRO_MODES.map((m) => (
          <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => chooseMode(m)}>
            {bootIntroModeLabel(m)}
          </button>
        ))}
      </div>
      <div className="theme-switch four" role="group" aria-label="开机动画配色">
        {BOOT_INTRO_SCHEMES.map((s) => (
          <button key={s} type="button" className={scheme === s ? "active" : ""} onClick={() => chooseScheme(s)}>
            {bootIntroSchemeLabel(s)}
          </button>
        ))}
      </div>
      <div className="boot550c-actions">
        <button
          type="button"
          className="secondary-setting"
          disabled={!canPreview}
          onClick={() => setPreview(mode === "simple" ? "simple" : "full")}
        >
          预览
        </button>
        {!canPreview && <span className="settings-subhead-hint">当前设为关闭（或系统减弱动效），不会播放</span>}
      </div>
      {preview ? <BootIntro550c mode={preview} scheme={scheme} onDone={() => setPreview(null)} /> : null}
    </>
  );
}
