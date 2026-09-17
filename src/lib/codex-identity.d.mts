/** src/lib/codex-identity.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016）。 */
export type CodexAvatarSpec = { type: "default" | "image"; value: string };
export type CodexIdentity = { name: string; avatar: CodexAvatarSpec };

export const CODEX_DEFAULT_NAME: string;
export const CODEX_AVATAR_KEY: string;

export function subscribeCodexIdentity(listener: () => void): () => void;
export function getCodexIdentity(): CodexIdentity;
export function setCodexIdentity(next: Partial<CodexIdentity>): void;
export function readStoredCodexAvatar(): CodexAvatarSpec;
export function storeCodexAvatar(spec: CodexAvatarSpec): void;
