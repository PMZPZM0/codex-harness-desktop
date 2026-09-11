// 类型声明：model-scope.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言会跑真实实现，漏改会立刻红）。

export interface OpenModelInput {
  /** 会话自己的模型记录（空串 / 缺省 = 该会话还没有记录） */
  stored?: string;
  /** 全局默认模型（空串 / 缺省 = 没有） */
  global?: string;
}

/**
 * 打开会话时用哪个模型：**会话自己的记录优先**；没有记录才用全局默认。
 * 作用域规则与两次返工的由来见 model-scope.mjs 头部注释。
 */
export declare function resolveModelForOpen(input: OpenModelInput): string;

/**
 * 改「全局默认模型」时是否要把当前打开的会话一并改过去。
 * 返回 true 时调用方只能改 `openThreadId` 这一个会话，其它会话必须不动。
 */
export declare function shouldSyncOpenThread(openThreadId: string | null | undefined): boolean;
