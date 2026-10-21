// 任务清单展示口径（.mjs）的类型声明 —— 与 `task-steps.mjs` 一一对应
export type TaskStepRow = { id: string; text: string; state: string; createdAt: number };

/** 同一句话只保留一条（冲突取 done>doing>todo 最靠后），顺序按首次创建时间。 */
export declare function mergeTaskSteps(
  taskList: Array<{ id?: unknown; text?: unknown; status?: unknown; createdAt?: unknown }> | null | undefined,
): TaskStepRow[];
