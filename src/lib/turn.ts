/** Turn（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "./thread-item";

export type Turn = { id: string; status: string; items: ThreadItem[]; error?: { message?: string } | null; durationMs?: number | null; startedAt?: number | null; completedAt?: number | null; usage?: any };
