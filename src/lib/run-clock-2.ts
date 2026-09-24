/** RUN_CLOCK（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { createRunClock } from "./run-clock.mjs";

export const RUN_CLOCK = createRunClock();
