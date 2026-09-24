/** extensibility-catalog.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export interface ExtensibilityEntry {
  /** 稳定 id（复制/去重用） */
  id: string;
  /** 分组（必须是 EXTENSIBILITY_GROUPS 之一） */
  group: string;
  name: string;
  /** 这个拓展点是干什么的 */
  purpose: string;
  /** 可拓展位置（真实存在的路径） */
  where: string[];
  /** 拓展方式（可照做的编号步骤） */
  steps: string[];
  /** 如何生效 */
  effect: string;
  /** 配套守卫 / 断言 */
  guards: string;
  /** 容易踩的坑 */
  pitfalls: string[];
}

export const EXTENSIBILITY_GROUPS: string[];
export const EXTENSIBILITY_ENTRIES: ExtensibilityEntry[];
/** IPC 通道数（守卫【2】保证与 manifest 一致） */
export const IPC_CHANNEL_COUNT: number;
