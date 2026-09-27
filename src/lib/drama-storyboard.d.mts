/** 短剧分镜表的纯数据层（实现见 ./drama-storyboard.mjs） */

export interface StoryboardCharacter {
  id: string;
  name: string;
  look: string;
  ref: string;
  voice: string;
}

export interface StoryboardShot {
  id: string;
  cast: string[];
  shot_size: string;
  prompt: string;
  motion: string;
  line: string;
  speaker: string;
  first_frame: string;
  last_frame: string;
  video: string;
  audio: string;
  duration?: number;
  note: string;
}

export interface StoryboardScene {
  id: string;
  place: string;
  time: string;
  shots: StoryboardShot[];
}

export interface StoryboardOutput {
  video: string;
  cover: string;
  subtitle: string;
  duration?: number;
}

export interface Storyboard {
  version: number;
  title: string;
  logline: string;
  aspect: string;
  fps: number;
  style: string;
  characters: StoryboardCharacter[];
  scenes: StoryboardScene[];
  output: StoryboardOutput;
}

export const STORYBOARD_VERSION: number;
export const STORYBOARD_ASPECTS: string[];
export const STORYBOARD_SHOT_SIZES: string[];

export function storyboardPathFor(name: string): string;
export function storyboardDefault(title?: string): Storyboard;
export function storyboardNormalize(raw: unknown): { data: Storyboard; problems: string[]; ok: boolean };
export function storyboardCharacterIndex(storyboard: Storyboard): Map<string, StoryboardCharacter>;
export function storyboardBoardPlan(
  storyboard: Storyboard,
  boardName: string,
  options?: { x?: number; y?: number; colGap?: number; rowGap?: number; boardNodeId?: string },
): {
  nodes: Array<{ id: string; kind: string; payload: Record<string, any>; position: { x: number; y: number }; size: { width: number; height: number } }>;
  edges: Array<{ source: { id: string }; target: { id: string }; relation: string }>;
  stats: { characters: number; usedCharacters: number; scenes: number; shots: number; missing: string[] };
};
export function storyboardShotPatch(
  nodePayload: Record<string, any>,
  storyboard: Storyboard,
): { ok: boolean; reason: string; patch: { shotId: string; changes: Record<string, any> } | null; skipped?: string[]; board?: string };
export function storyboardApplyPatches(
  storyboard: Storyboard,
  patches: Array<{ shotId: string; changes: Record<string, any> }>,
): { data: Storyboard; applied: number };
export function storyboardCharacterPatch(
  nodePayload: Record<string, any>,
  storyboard: Storyboard,
): { ok: boolean; reason: string; patch: { characterId: string; changes: Record<string, any> } | null; id?: string };
export function storyboardApplyCharacterPatch(
  storyboard: Storyboard,
  patch: { characterId: string; changes: Record<string, any> } | null,
): { data: Storyboard; applied: number };
export function storyboardDuration(storyboard: Storyboard): number;
