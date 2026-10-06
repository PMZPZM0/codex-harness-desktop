/**
 * 控制台的「内置技能独立开关」（10-06 用户需求：把技能封装成可独立切换的开关，
 * 控制台新增开关项；默认开启；状态持久化，重启后保持用户上次设置）。
 *
 * ⛔ 三个设计取舍（都是本仓库踩过的坑，别改回去）：
 *  1. **状态自取，不进 bag**：与 `settings-skills/SkillPoolSection` 同一先例 —— 自包含轻组件，
 *     避开【92】的 part 调用顺序契约与 `bag-types.ts` 再生成（那两处一改就是全链回归风险）。
 *  2. **不新增第二份状态**：真相源仍是 `electron/skill-pool.ts` 的**全局停用集**
 *     （`codex-home/skill-global-disabled.json`）。本组件只是它的另一个入口 ——
 *     另一个入口是技能页的「共享技能池」。两处各存一份就会各说各话。
 *  3. **复用共享 `ToggleSwitch`**（守卫【234】⑧：新开关不许写散装实现），
 *     布局复用现成的 `settings-toggle-row` 语义类（⛔ 不新增 CSS 类，省掉样式覆盖那一串）。
 */
import { useCallback, useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

type SwitchState = { name: string; enabled: boolean; available: boolean; error?: string };

/** 当前工作区（技能池投影需要一个 cwd；没有也不影响全局集生效）。与 SkillPoolSection 同源读法。 */
function readWorkspace(): string {
  try { return localStorage.getItem("workspace") ?? ""; } catch { return ""; }
}

export function BuiltinSkillSwitch({ skill, title, desc, onNotice }: {
  /** 技能目录名（= SKILL.md frontmatter 的 name），如 `i-have-adhd` */
  skill: string;
  title: string;
  desc: string;
  onNotice?: (message: string) => void;
}) {
  const [state, setState] = useState<SwitchState | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => {
    window.codex.getBuiltinSkillSwitch({ name: skill })
      .then((r) => setState(r))
      .catch(() => setState({ name: skill, enabled: false, available: false, error: "读取失败" }));
  }, [skill]);

  useEffect(() => { read(); }, [read]);

  const toggle = (next: boolean) => {
    setBusy(true);
    window.codex.setBuiltinSkillSwitch({ name: skill, enabled: next, cwd: readWorkspace() })
      .then((r) => {
        setState(r);
        if (r.error) onNotice?.(`「${title}」切换失败：${r.error}`);
      })
      .catch((error) => onNotice?.(`「${title}」切换失败：${String(error?.message ?? error)}`))
      .finally(() => setBusy(false));
  };

  const missing = state !== null && !state.available;
  const enabled = state?.enabled === true;
  return (
    <div className="settings-toggle-row">
      <span className="settings-toggle-icon"><MessageSquareText size={16} /></span>
      <span className="settings-toggle-text">
        <strong>{title}</strong>
        <small>{missing ? "当前安装里没有这个内置技能（目录不存在）" : desc}</small>
      </span>
      <ToggleSwitch
        checked={enabled}
        disabled={busy || state === null || missing}
        label={title}
        title={missing ? "技能目录不存在，无法切换"
          : enabled ? "关闭后模型不再加载这份写作风格说明（只影响写法，不影响能力）"
          : "开启后模型会加载这份写作风格说明"}
        onChange={toggle}
      />
    </div>
  );
}
