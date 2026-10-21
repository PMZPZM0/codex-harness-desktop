/** `step-note.mjs` 的类型声明（TS 侧 import 必须有，否则 tsc 报 TS7016/TS2305）。 */

/** 参数名（注入 schema / 剥离 / 读卡片三处共用） */
export const STEP_PARAM: "step";
/** 写进 inputSchema 的参数说明 */
export const STEP_PARAM_DESCRIPTION: string;

/** 给工具面注入可选的 `step` 参数（幂等） */
export function withStepParam<T>(tools: T): T;
/** 转发给真正的工具前剥掉 `step` */
export function stripStepParam<T>(args: T): T;
/** 读出这一步的说明；读不到 / 空串 / 超长 ⇒ 空串 */
export function stepOf(args: unknown, max?: number): string;
