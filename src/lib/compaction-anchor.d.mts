// 类型声明：compaction-anchor.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。

/** 压缩线插入位置（visible 的下标）；-1 = 不插；visible.length = 末尾（最后一回合之后）。
 *  压缩所在回合在窗口 ⇒ 它的下标；不在窗口但有压缩时间 ⇒ 落在最后一个「先于压缩」的回合之后；
 *  更早于窗口 ⇒ 0（顶部）；完全没有回合信息 ⇒ 最后一回合。 */
export declare function resolveCompactionAnchor(
  visible: unknown,
  boundaryTurnId: unknown,
  options?: { compactionAt?: number },
): number;
