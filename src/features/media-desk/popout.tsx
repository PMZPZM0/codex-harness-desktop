/**
 * 自媒体工作台独立窗口的根组件（11-11 用户令：「在工作伙伴下面加一个选项，做主界面一样的弹窗大小」）。
 *
 * ⛔ 这个窗口只渲染工作台（`?mediaDesk=1`），不渲染侧栏 / 时间线 / 设置页。
 * ⛔ 主应用真关闭时由主进程带走本窗口；窗口尺寸由主进程按主窗口当前尺寸给。
 */
import { useEffect } from "react";
import { Megaphone } from "lucide-react";
import { MediaDeskPage } from "./index";

/** 独立窗根：标题栏（可拖拽）+ 工作台 iframe。 */
export function MediaDeskPopoutRoot() {
  useEffect(() => {
    document.title = "自媒体工作台";
    document.body.classList.add("is-media-desk-popout");
    return () => document.body.classList.remove("is-media-desk-popout");
  }, []);
  return (
    <div className="media-desk-popout">
      <header className="media-desk-popout-head">
        <Megaphone size={15} className="ic-amber" />
        <strong>自媒体工作台</strong>
      </header>
      <MediaDeskPage />
    </div>
  );
}
