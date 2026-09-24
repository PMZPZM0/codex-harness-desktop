/** readPendingImportStore（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { PENDING_IMPORT_STORE_KEY } from "./pending-import-store-key";

export function readPendingImportStore(): Record<string, PendingImportPayload> {
  try { return JSON.parse(localStorage.getItem(PENDING_IMPORT_STORE_KEY) || "{}") as Record<string, PendingImportPayload>; }
  catch { return {}; }
}
