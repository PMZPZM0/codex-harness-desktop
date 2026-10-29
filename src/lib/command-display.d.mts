/** command-display.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

/** 剥掉 shell 启动器外壳（`"…\pwsh.exe" -Command "…"` 等）；认不出来原样返回 */
export function stripShellLauncher(command: string): string;

/** 取命令里的文件目标（路径归一为正斜杠、超长保尾截断）；取不到返回空串 */
export function commandTarget(command: string, max?: number): string;

/** 路径展示形态：正斜杠 + 超长从左截（保文件名） */
export function shortenPath(value: string, max?: number): string;

/** 明细行用的单行命令：剥壳 + 压空白 + 超长保头截断 */
export function displayCommand(command: string, max?: number): string;

/** 命令的二级意图档位："modify" | "search" | "read" | "command"（词法判定，认不出归 command） */
export function commandIntentOf(command: string): string;

/** 命令的用途标签（从脚本里的输出标签/字面量提炼；提炼不出返回空串，调用方自行兜底） */
export function commandPurpose(command: string, max?: number): string;

/** 意图 → 中文动词（read 查看 / search 定位 / modify 编辑 / command 运行） */
export const INTENT_VERB: Record<string, string>;

/** 命令的动作短语（「跑守卫 11z」「构建并跑全量检查」）；**认不出返回空串**，调用方退回原 hint */
export function commandAction(command: string, max?: number): string;

/** 写文件类命令的行数统计（added 可数；deleted 为 null = 数不出来，例如覆盖写） */
export function commandWriteStats(command: string): { added: number; deleted: number | null } | null;

/** 命令自己 `cd` 到的绝对目录；推不出来（无 cd / 相对 cd）返回空串 */
export function commandWorkdir(command: string): string;
/** 命令里的相对目标按**命令自己的 cd 目录**补全（不是会话目录）；绝对路径 / 推不出时原样返回 */
export function resolveCommandTarget(command: string, target: string): string;
