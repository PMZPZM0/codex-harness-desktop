// 桌面宠物活动投影纯函数（.mjs）的类型声明
export type PetActivityStatus = "waiting" | "running" | "failed" | "interrupted" | "completed";
export type PetActivityLike = {
  threadId: string;
  turnId: string;
  title: string;
  detail: string;
  status: PetActivityStatus;
  updatedAt: number;
};
export declare const PET_ACTIVITY_PRIORITY: Readonly<Record<PetActivityStatus, number>>;
export declare function normalizePetItemType(type: unknown): string;
export declare function petItemText(item: unknown): string;
export declare function petTitleFromText(text: unknown, fallback?: string): string;
export declare function petDetailFromText(text: unknown, max?: number): string;
export declare function petToolDetail(item: unknown): string;
export declare function petPhaseOfActivities(activities: unknown): "waiting" | "running" | "failed" | "review" | "idle";
export declare function petAttentionOfActivities(activities: unknown): "" | "pending" | "error";
export declare function sortPetActivities<T extends { status?: string; updatedAt?: number }>(activities: T[]): T[];
export declare function petActivitySignature(activities: unknown): string;
