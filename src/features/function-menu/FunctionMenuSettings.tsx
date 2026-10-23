import { ArrowDownToLine, ArrowUpToLine, Check, Pencil } from "lucide-react";
import { overflowFunctionMenuItems, visibleFunctionMenuItems } from "./menu-model.mjs";
import { FUNCTION_MENU_META } from "./FunctionMenu";
import { openFunctionMenuEditor, setFunctionMenuLocation, useFunctionMenuConfig } from "./store";

/** 外观设置里的「功能入口」：选展示位置 + 打开编辑菜单。两种位置共用同一份排序/更多分组。 */
export function FunctionMenuSettings({ onNotice }: { onNotice?: (text: string) => void }) {
  const config = useFunctionMenuConfig();
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);
  const choose = (location: "top" | "bottom") => {
    if (config.location === location) return;
    setFunctionMenuLocation(location);
    onNotice?.(location === "top" ? "功能入口已移到「新建任务 / 搜索任务」下面" : "功能入口已移回侧栏底部");
  };
  return (
    <section className="settings-section stack function-menu-settings">
      <div className="settings-copy">
        <h2>功能入口</h2>
        <p>选择入口显示在「新建任务 / 搜索任务」下面（老版位置），还是侧栏底部。两种位置共用同一套顺序与「更多」分组，改动即时生效。</p>
      </div>
      <div className="fm-location-grid" role="group" aria-label="功能入口显示位置">
        <button type="button" className={`fm-location-card ${config.location === "top" ? "on" : ""}`} aria-pressed={config.location === "top"} onClick={() => choose("top")}>
          <ArrowUpToLine size={16} /><span><b>侧栏顶部</b><small>「新建任务 / 搜索任务」下面（老版位置）</small></span>{config.location === "top" && <Check size={14} />}
        </button>
        <button type="button" className={`fm-location-card ${config.location === "bottom" ? "on" : ""}`} aria-pressed={config.location === "bottom"} onClick={() => choose("bottom")}>
          <ArrowDownToLine size={16} /><span><b>侧栏底部</b><small>用户名上方，可折叠</small></span>{config.location === "bottom" && <Check size={14} />}
        </button>
      </div>
      <div className="fm-settings-preview" aria-label="当前功能入口顺序">
        {visible.map((id) => {
          const meta = FUNCTION_MENU_META[id];
          const Icon = meta.Icon;
          return <span className="fm-settings-chip" key={id}><Icon size={12} className={meta.tone} />{meta.label}</span>;
        })}
        {overflow.length > 0 && <span className="fm-settings-chip fm-settings-more">更多 <em>{overflow.length}</em></span>}
      </div>
      <div className="fm-settings-actions">
        <button type="button" className="secondary-setting" onClick={openFunctionMenuEditor}><Pencil size={13} />编辑菜单（拖动排序 / 收进更多）</button>
        <small>{config.location === "top" ? "入口就在「新建任务 / 搜索任务」下面；更多菜单里也能切换位置或打开编辑菜单。" : "更多菜单里也能随时切换位置或打开编辑菜单。"}</small>
      </div>
    </section>
  );
}
