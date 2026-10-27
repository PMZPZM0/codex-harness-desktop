import { ArrowDownToLine, ArrowUpToLine, Check, Pencil } from "lucide-react";
import { overflowFunctionMenuItems, visibleFunctionMenuItems } from "./menu-model.mjs";
import { FUNCTION_MENU_META } from "./FunctionMenu";
import { openFunctionMenuEditor, setFunctionMenuLocation, useFunctionMenuConfig } from "./store";

/** 外观设置里的「拓展功能」（10-25 前叫「功能入口」）：选展示位置 + 打开编辑菜单。两处位置共用同一份排序/更多分组，均可展开折叠。 */
export function FunctionMenuSettings({ onNotice }: { onNotice?: (text: string) => void }) {
  const config = useFunctionMenuConfig();
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);
  const choose = (location: "top" | "bottom") => {
    if (config.location === location) return;
    setFunctionMenuLocation(location);
    onNotice?.(location === "top"
      ? "拓展功能已移到「新会话 / 指挥中枢 / 搜索任务」下面"
      : "拓展功能已移回侧栏底部");
  };
  return (
    /* 10-27 用户令：「把中间这个简洁化一下，跟上面一样，下面卡片线条太多了」
       ⇒ 两张带图标+副标题的选项大卡 → 收成「标签 + 胶囊」一行（思考板块 / 运行过程同款）；
          功能入口 chips 去掉虚线框、和「编辑菜单」并成一条淡行，整块只剩一行主控 + 一行说明性内容。 */
    <section className="function-menu-settings fm-compact">
      <div className="settings-pill-row">
        <span className="settings-pill-row-label"><ArrowUpToLine size={13} />拓展功能</span>
        <div className="segmented-tabs row-pills" role="group" aria-label="拓展功能显示位置">
          <button type="button" className={config.location === "top" ? "active" : ""} aria-pressed={config.location === "top"} title="入口显示在「新会话 / 搜索任务」下面（可折叠）" onClick={() => choose("top")}>侧栏顶部</button>
          <button type="button" className={config.location === "bottom" ? "active" : ""} aria-pressed={config.location === "bottom"} title="入口显示在用户名上方（可折叠）" onClick={() => choose("bottom")}>侧栏底部</button>
        </div>
      </div>
      <div className="fm-compact-meta">
        <div className="fm-settings-chips" aria-label="当前拓展功能顺序">
          {visible.map((id) => {
            const meta = FUNCTION_MENU_META[id];
            const Icon = meta.Icon;
            return <span className="fm-settings-chip" key={id}><Icon size={12} className={meta.tone} />{meta.label}</span>;
          })}
          {overflow.length > 0 && <span className="fm-settings-chip fm-settings-more">更多 <em>{overflow.length}</em></span>}
        </div>
        <button type="button" className="secondary-setting fm-compact-edit" onClick={openFunctionMenuEditor} title="拖动排序 / 收进更多"><Pencil size={12} />编辑菜单</button>
      </div>
    </section>
  );
}
