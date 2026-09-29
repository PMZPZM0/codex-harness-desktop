/**
 * 画布节点的**动作上下文**（域内私有）。
 *
 * 为什么不把回调塞进节点的 `data`：React Flow 的节点 data 一旦含函数，每次渲染都是新引用，
 * 会触发整图重算（它按 data 引用判断要不要重渲节点）。回调走 context 一层，
 * 节点组件只读 context —— data 里永远只有可序列化的 kind/payload。
 */
import { createContext, useContext } from "react";
import type { DramaBoardApi } from "./use-drama-board";
import type { DramaStoryApi } from "./use-drama-story";

/** 产物查看器的目标（09-29）：卡片缩略图与「生成结果」面板共用同一个查看器。
 *  ⛔ 类型定义放这里而不是查看器组件里 —— 组件要 import 本文件的 useDramaActions，
 *    类型放在组件里就成环（type-only import 虽然编译后消失，但依赖方向会误导人）。 */
export interface ViewerTarget {
  path: string;
  kind: "image" | "video" | "audio";
  /** 展示用标题（如「出图 A · 首帧」） */
  title?: string;
  /** 来自哪张卡 —— 给了才有「替换 / 重新生成 / 清除」这些**按卡**动作 */
  nodeId?: string;
  /** 这张卡的哪些字段记录着它（清除时精确清这几个，不碰这张卡上的其它产物）。
   *  用数组：["path","url"] 是同一张图的两个别名，只清一个会留半截状态。 */
  fields?: string[];
  /** 「重新生成」走哪条通道 */
  channel?: "image" | "video" | "audio";
}

export interface DramaActions {
  board: DramaBoardApi;
  story: DramaStoryApi;
  /** 打开右侧检查器看这张卡的完整字段 */
  openInspector: (id: string) => void;
  /** 打开产物查看器（大图/播放 + 打开文件夹/复制路径/替换/重生成/清除） */
  openMedia: (target: ViewerTarget) => void;
  /** 把这张卡的任务交给 Agent：写进输入框，由用户按发送（不替用户发消息） */
  askAgent: (id: string) => void;
  /** 这一场挂出去的镜头（按连线算，**不读负载里的抄本**——抄本不跟着改删走） */
  linkedShots: (nodeId: string) => Array<Record<string, any>>;
  /** 本场镜头的「节点 id + payload」—— linkedShots 只回 payload，而选中/批量出图都要 id。 */
  linkedShotRefs: (nodeId: string) => Array<{ id: string; payload: Record<string, any> }>;
  /** 这张画布上的分镜表节点 id（没有就 null）；展开时要用它当连线起点 */
  boardNodeId: string | null;
  /** 跳到「设置 → 插件」去配生图/视频模型（09-28）。
   *  未配置时卡片按钮直接用这个 —— 原来点了才 notice 报错，用户不知道要先去配。 */
  openGenSettings: (kind: "image" | "video") => void;
  /** 打开「生成结果」面板（相册：这张画布上所有已生成的图/视频） */
  openResults: () => void;
}

const DramaActionsContext = createContext<DramaActions | null>(null);

export const DramaActionsProvider = DramaActionsContext.Provider;

export function useDramaActions(): DramaActions {
  const value = useContext(DramaActionsContext);
  if (!value) throw new Error("useDramaActions 必须在 DramaActionsProvider 内使用");
  return value;
}
