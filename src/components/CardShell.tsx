import { CircleCheck, X } from "lucide-react";
import { useCallback, useState } from "react";

/** 卡片状态：pending=等待批准，running=执行中，done=成功，error=失败，interrupted=被中断 */
export type ActionStatus = "pending" | "running" | "done" | "error" | "interrupted";

/** 加载中转圈（全局复用；原先定义在 App.tsx，迁到这里供卡片壳与页面共用） */
export function Spinner() {
  return <span className="spinner" aria-label="加载中" />;
}

/**
 * 卡片展开状态机 —— 命令卡 / 编辑卡 / 工具卡统一使用（对齐 WorkBuddy 折叠语义）。
 *
 * 三条约定：
 * 1. **autoOpen 必须是「运行中 且 有内容」**，不能只判断「运行中」。
 *    只判断运行中会在内容尚未下发时展开一大块空框——命令卡（刚创建还没输出）和
 *    编辑卡（刚开始编辑还没 diff）都踩过这个坑。是否「有内容」由调用方判断后传入。
 * 2. **manualOpen 优先级最高**：用户点过之后就不再跟随 autoOpen，
 *    所以手动展开的输出不会因为命令执行结束而自己收起。
 * 3. **无内容时不传 children**，调用方直接不渲染折叠体，从根上消除空框。
 */
export function useCardOpen(autoOpen: boolean) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? autoOpen;
  const toggle = useCallback(() => {
    setManualOpen(!open);
  }, [open]);
  // manualOpen 一并导出：思考卡需要区分「用户显式收起」(=== false) 与「从未点过」(=== null)，
  // 并在运行→完成瞬间用函数式更新把 null 落成 false（自动收起但不动用户的选择）。
  return { open, toggle, manualOpen, setManualOpen };
}

/** 状态图标：统一 running/pending→转圈、done→对勾、error/interrupted→叉 */
export function CardStatusIcon({ status }: { status: ActionStatus }) {
  if (status === "running" || status === "pending") return <Spinner />;
  if (status === "error" || status === "interrupted") return <X size={12} className="card-status-icon" />;
  if (status === "done") return <CircleCheck size={12} className="card-status-icon" />;
  return null;
}
