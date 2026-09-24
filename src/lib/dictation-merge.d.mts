/** dictation-merge.mjs 的类型声明 */

/** 听写回填的合并结果（见 .mjs 里的策略说明） */
export type DictationMerge = {
  /** 要写回输入框的完整内容 */
  text: string;
  /** 更新后的基准（下次调用传回来） */
  base: string;
  /** 本次写下的字幕（下次调用传回来） */
  written: string;
  /** 期间用户是否动过输入框（动了就把他的内容并入基准，不再覆盖） */
  userEdited: boolean;
};

export function mergeDictation(input: {
  base?: string | undefined;
  written?: string | undefined;
  current?: string | undefined;
  dictation?: string | undefined;
}): DictationMerge;

export function dictationStartBase(current?: string | undefined): string;
