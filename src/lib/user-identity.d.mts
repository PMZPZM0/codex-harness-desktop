/** src/lib/user-identity.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016）。 */
export type UserAvatarSpec = { type: "image" | "emoji" | "none"; value: string };
export type UserIdentity = { name: string; avatar: UserAvatarSpec };

export function subscribeUserIdentity(listener: () => void): () => void;
export function getUserIdentity(): UserIdentity;
export function setUserIdentity(next: Partial<UserIdentity>): void;
