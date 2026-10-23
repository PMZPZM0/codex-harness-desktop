export type FunctionMenuLocation = "sidebar" | "composer";
export type FunctionMenuItemId = "schedule" | "frontend" | "extensions" | "team" | "identity" | "login" | "newbie";
export type FunctionMenuConfig = { location: FunctionMenuLocation; order: FunctionMenuItemId[]; overflow: FunctionMenuItemId[] };

export declare const FUNCTION_MENU_IDS: FunctionMenuItemId[];
export declare const FUNCTION_MENU_DEFAULT_ORDER: FunctionMenuItemId[];
export declare const FUNCTION_MENU_DEFAULT: Readonly<FunctionMenuConfig>;

export declare function isFunctionMenuId(id: unknown): id is FunctionMenuItemId;
export declare function normalizeFunctionMenu(input?: unknown): FunctionMenuConfig;
export declare function visibleFunctionMenuItems(config?: unknown): FunctionMenuItemId[];
export declare function overflowFunctionMenuItems(config?: unknown): FunctionMenuItemId[];
export declare function moveFunctionMenuItem(config: unknown, id: unknown, targetList: "visible" | "overflow", beforeId?: unknown): FunctionMenuConfig;
export declare function setFunctionMenuItemOverflow(config: unknown, id: unknown, inOverflow: boolean): FunctionMenuConfig;
export declare function nudgeFunctionMenuItem(config: unknown, id: unknown, delta: number): FunctionMenuConfig;
export declare function setFunctionMenuLocation(config: unknown, location: FunctionMenuLocation): FunctionMenuConfig;
export declare function resetFunctionMenuLayout(config: unknown): FunctionMenuConfig;
