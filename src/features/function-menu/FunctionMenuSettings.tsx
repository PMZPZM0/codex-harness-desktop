import { ArrowDownToLine, ArrowUpToLine, Check, Pencil, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { overflowFunctionMenuItems, visibleFunctionMenuItems } from "./menu-model.mjs";
import { FUNCTION_MENU_META } from "./FunctionMenu";
import { openFunctionMenuEditor, setFunctionMenuLocation, useCustomMenuRevision, useFunctionMenuConfig } from "./store";

/** 外观设置里的「拓展功能」（10-25 前叫「功能入口」）：选展示位置 + 打开编辑菜单。两处位置共用同一份排序/更多分组，均可展开折叠。 */
export function FunctionMenuSettings({ onNotice }: { onNotice?: (text: string) => void }) {
  const config = useFunctionMenuConfig();
  const visible = visibleFunctionMenuItems(config);
  const overflow = overflowFunctionMenuItems(config);
  /* 自定义入口不在 functionMenuConfig 里（它们是 extensions.json 的扩展项）——
     ⛔ 同一份摘要必须把两边都显示出来，否则菜单里加了、设置里看不到 = 两套真相。 */
  const customRevision = useCustomMenuRevision();
  const [extMenu, setExtMenu] = useState<MenuEntrySpec[]>([]);
  useEffect(() => { void window.codex.extensionsCatalog?.().then((catalog) => setExtMenu(catalog?.menu ?? [])).catch(() => undefined); }, [customRevision]);
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
          {extMenu.map((entry) => <span className="fm-settings-chip fm-settings-custom" key={entry.id} title="自定义入口（在「编辑菜单」里增删）"><Puzzle size={12} className="ic-cyan" />{entry.label}</span>)}
        </div>
        <button type="button" className="secondary-setting fm-compact-edit" onClick={openFunctionMenuEditor} title="拖动排序 / 收进更多 / 添加或移除自定义入口"><Pencil size={12} />编辑菜单</button>
      </div>
    </section>
  );
}
