// 类型声明：session-scope.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检【4a-2】的纯逻辑断言会跑真实实现，漏改会立刻红）。

/** 会话作用域取值（模型/档位/权限那几项会话级配置）。 */
export interface SessionScopeInput {
  threadId?: string;
  model?: string;
  provider?: string;
  effort?: string;
  sandbox?: string;
  approval?: string;
  workspace?: string;
}

export declare const SESSION_SCOPE_HEADING: string;

/** 归一化后的取值集合（缺项回落空串）。 */
export declare function sessionScopeValues(input?: SessionScopeInput): Required<SessionScopeInput>;

/** 变更签名：模型/供应商/档位/权限任一变化即需重新下发（工作区变动不触发）。 */
export declare function sessionScopeSignature(input?: SessionScopeInput): string;

/** 生成对模型可见的「会话作用域」说明块（声明会话级权威、并否定全局顶层是当前配置）。 */
export declare function sessionScopeBlock(input?: SessionScopeInput): string;

/** 剥离历史注入块（幂等；连组合分隔符一并剥掉）。 */
export declare function stripScopeBlock(text: string): string;

/** 组合最终下发的 developer instructions：基线在前、作用域块在后（缺一则退化为另一份）。 */
export declare function composeScopeInstructions(base: string, block: string): string;
