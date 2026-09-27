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

export interface DramaActions {
  board: DramaBoardApi;
  story: DramaStoryApi;
  /** 打开右侧检查器看这张卡的完整字段 */
  openInspector: (id: string) => void;
  /** 把这张卡的任务交给 Agent：写进输入框，由用户按发送（不替用户发消息） */
  askAgent: (id: string) => void;
  /** 这一场挂出去的镜头（按连线算，**不读负载里的抄本**——抄本不跟着改删走） */
  linkedShots: (nodeId: string) => Array<Record<string, any>>;
  /** 这张画布上的分镜表节点 id（没有就 null）；展开时要用它当连线起点 */
  boardNodeId: string | null;
}

const DramaActionsContext = createContext<DramaActions | null>(null);

export const DramaActionsProvider = DramaActionsContext.Provider;

export function useDramaActions(): DramaActions {
  const value = useContext(DramaActionsContext);
  if (!value) throw new Error("useDramaActions 必须在 DramaActionsProvider 内使用");
  return value;
}
