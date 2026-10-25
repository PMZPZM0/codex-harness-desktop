export type BubuSticker = { id: string; file: string; label: string; states: string[] };
export type BubuUserPersona = { id: string; label: string; occupation: string; userContext: string; tools: string[] };
export declare const BUBU_STICKERS: BubuSticker[];
export declare const BUBU_STICKER_IDS: string[];
export declare function stickerAsset(file: string): string;
export declare function resolveStickerSrc(src: unknown): string;
export declare function bubuStickerGuide(): string;
export declare const BUBU_PERSONA: string;
export declare const BUBU_PACK: {
  id: string;
  label: string;
  personaSlug: string;
  userAvatar: string;
  codexAvatar: string;
  assistantName: string;
  voice: { sid: number; tone: string; options: { id: string; label: string; sid: number }[] };
};
export declare const USER_PERSONAS: BubuUserPersona[];
export declare function userPersonaFields(personaId: string): { occupation: string; userContext: string } | null;
