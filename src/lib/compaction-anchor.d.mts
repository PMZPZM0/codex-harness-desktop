// 类型声明：compaction-anchor.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。

/** 压缩线插入位置（visible 的下标）；-1 = 不插。
 *  boundaryTurnId 为空 = 边界未知（只有 toast）⇒ 最后一回合；
 *  边界已知但不在可见窗口 ⇒ 0（顶部）；否则 = 该回合(含)之前最近一条含 userMessage 的回合。 */
export declare function resolveCompactionAnchor(visible: unknown, boundaryTurnId: unknown): number;
