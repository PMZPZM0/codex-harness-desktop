/**
 * pet 域的对外面（**唯一入口**）。
 *
 * 跨壳引用只许 `from "./features/pet"`（或 `../pet`）；⛔ 不许深链域内文件 ——
 * 见 docs/ARCHITECTURE-RULES.md §4.2。
 */
export { PetFloat } from "./PetFloat";
export type { PetFloatProps } from "./PetFloat";
export { PET_STATES, PET_DEFAULT_COLUMNS, PET_DEFAULT_ROWS, PET_DEFAULT_FRAME, petAssetUrl } from "./pet-format";
export type { PetStateId } from "./pet-format";
