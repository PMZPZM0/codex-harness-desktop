export declare const MOTION_FORCE: "force";
export declare function isMotionForced(flag: string | null | undefined): boolean;
export declare function shouldReduceMotion(flag: string | null | undefined, systemReduced: boolean): boolean;
export declare function readMotionReduced(doc?: Document | null): boolean;
