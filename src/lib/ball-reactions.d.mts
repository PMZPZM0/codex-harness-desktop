export function gazeOffsets(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  range?: { x: number; y: number },
): { x: number; y: number };

export function pupilScale(speed: number): number;

export function isTypingTarget(tagName: string | null | undefined, isContentEditable?: boolean): boolean;

export function isTypingKey(
  key: string,
  mods?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean;
