/**
 * 控件皮肤域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 * 机制（store / loader / SkinHost）在基座：src/lib/ui-skin/ + src/components/SkinHost.tsx。
 */
export { UiSkinWorkshop } from "./SkinPicker";
export { SKIN_SLOTS, SKIN_LIB_LABELS, type SkinSlotId } from "./skin-slots";
export { UI_SKIN_CATALOG, UI_SKIN_CATS, type UiSkinCatalogEntry } from "./catalog.gen";
export type { UiSkinPack } from "../../lib/ui-skin/packs.gen";
export { UI_SKIN_PACKS } from "../../lib/ui-skin/packs.gen";
