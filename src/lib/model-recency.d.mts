// 类型声明：model-recency.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言会跑真实实现，漏改会立刻红）。

export declare const DEFAULT_MODEL_AT_KEY: string;
export declare function threadModelAtKey(id: string): string;

export interface EffectiveModelInput {
  /** 会话自己的模型记录（空串 = 没有记录） */
  stored?: string;
  /** 该会话记录被用户显式选中的时刻（毫秒；0 = 从未显式选过） */
  storedAt?: number;
  /** 全局默认模型（空串 = 没有） */
  global?: string;
  /** 全局默认被用户显式选中的时刻（毫秒；0 = 从未显式选过） */
  globalAt?: number;
}

/** 打开会话时的模型判定：全局与会话记录，谁被用户更晚显式选中就用谁。 */
export declare function resolveEffectiveModel(input: EffectiveModelInput): string;
