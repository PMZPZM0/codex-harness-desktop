/** 当前生效模型 · 渲染层单一真相源（见 active-model.mjs） */

export interface ActiveModel {
  /** modelId（可能是 custom:<provider>:<model> 复合串） */
  id: string;
  /** 裸模型名，可直接下发给 turn/start.model */
  name: string;
}

export function setActiveModel(id: string, name: string): void;
export function getActiveModel(): ActiveModel;
export function subscribeActiveModel(fn: () => void): () => void;
