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
 *  4. **每次拨动都必须有回执**（10-06 用户报障「我开关就没反馈通知」）：先给一条「正在…」
 *     （这段要重启引擎，按秒计），完成后再给「已开启/已关闭」或失败原因。
 *     ⛔ 别只留失败回执 —— 成功静默 = 用户以为开关坏了（同类：技能页「共享技能池」的 patch 原来连
 *     失败都被 `.catch(() => undefined)` 吞掉，本轮一并修）。
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
    /* ⛔ 先给一条"正在…"回执（10-06 用户报障：「我开关就没反馈通知」）：
       风格开关的落地要**重写 config.toml + 重启引擎**（见 electron/output-styles.ts），
       这段耗时按秒计，而开关自身只有"变灰"这一种状态 —— 不给回执就是"点了没反应"。
       ⛔ 不能只等最终回执：那要好几秒才出现，用户会以为开关坏了。 */
    onNotice?.(next ? `正在开启「${title}」并重启引擎…` : `正在关闭「${title}」并重启引擎…`);
    window.codex.setBuiltinSkillSwitch({ name: skill, enabled: next, cwd: readWorkspace() })
      .then((r) => {
        setState(r);
        // 成功/失败都要有回执：这是"开关到底生效没有"的唯一可见口径（技能页/磁盘都看不见结果）
        if (r.error) onNotice?.(`「${title}」切换失败：${r.error}`);
        else onNotice?.(next ? `「${title}」已开启：之后每一轮回复都按这套风格写` : `「${title}」已关闭：已恢复默认写法`);
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
          : enabled ? "开启中：每一轮回复都按这份风格写（只影响写法，不影响能力）。关闭后恢复默认写法"
          : "开启后每一轮回复都按这份风格写，不需要点名（只影响写法，不影响能力）"}
        onChange={toggle}
      />
    </div>
  );
}
