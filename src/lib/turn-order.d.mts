export declare function orderTurnsByTime<T>(turns: T[] | null | undefined): T[];
export declare function mergeTurnListsById<T>(primary: T[] | null | undefined, secondary: T[] | null | undefined): T[];
export declare function visibleTurnWindow<T>(turns: T[] | null | undefined, windowSize: unknown): { ordered: T[]; visible: T[] };
