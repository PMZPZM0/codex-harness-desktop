/**
 * 画布上的两块**小件**（域内私有）：内嵌形态的缩放胶囊、空画布引导。
 *
 * 为什么单开一个文件：`DramaCanvas.tsx` 已经 1000+ 行（守卫【265】只许缩不许长），
 * 而这两块都是**纯展示、零状态**的 JSX —— 搬出来既降行数，也让那两处的意图更清楚。
 * ⛔ 不要往这里塞需要 board / story 的东西（那属于画布本体）。
 */
import { Clapperboard, ZoomIn, ZoomOut } from "lucide-react";

/** 内嵌形态（右栏）的缩放胶囊：− / 当前比例（点它=适配全部）/ +。
 *  ⛔ 11-26 用户：「放大缩小也看不见」—— 缩放原来只在左侧竖条工具栏里，
 *    而内嵌形态把整条工具栏收掉了（用户要「纯画布」）⇒ 单独给一颗常驻胶囊，
 *    既能看见当前比例，也能用鼠标缩放。⛔ 别顺手把整条工具栏加回来。 */
export function DramaZoomDock({ zoomText, onZoomIn, onZoomOut, onFit }: {
  zoomText: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="drama-canvas-zoomdock nodrag">
      <button type="button" title="缩小" aria-label="缩小" onClick={onZoomOut}><ZoomOut size={15} /></button>
      <button type="button" className="drama-canvas-zoomdock-pct" title="点一下：适配全部节点" onClick={onFit}>{zoomText}</button>
      <button type="button" title="放大" aria-label="放大" onClick={onZoomIn}><ZoomIn size={15} /></button>
    </div>
  );
}

/** 空画布引导（09-28 用户：「新建了然后呢，有什么用，完全看不懂」）。
 *  ⛔ 只在**浮层形态 + 真的空**时渲染（有节点就挡视野了）；纯提示，不拦点击。 */
export function DramaBlankGuide() {
  return (
    <div className="drama-canvas-blank-guide" aria-hidden>
      <Clapperboard size={26} />
      <b>这块画布还是空的</b>
      <ul>
        <li><strong>新建短剧工作流</strong> —— 剧本 → 角色/场景 → 分镜表 → 出片，整条链路一次摆好</li>
        <li><strong>新建生图工作流</strong> —— 写提示词 → 出图 → 备注，专门出图</li>
        <li><strong>新建电商出图工作流</strong> —— 商品参考图 → 白底母版 → 主图 / SKU / 详情 / 场景 / 买家秀 → 素材包清单</li>
        <li><strong>画布</strong> = 一个方案一张板（左上角可切换/新建）；<strong>分镜表</strong> = 镜头的唯一真源，交给 Agent 生成时读的就是它</li>
      </ul>
      <small>从上面两个按钮挑一个开始；也可以在左侧「+ 添加节点」自己摆卡。</small>
    </div>
  );
}
