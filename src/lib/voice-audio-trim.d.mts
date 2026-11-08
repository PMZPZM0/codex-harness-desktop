/** TTS 播放前的尾部裁剪（纯函数，真值表见 tests/voice-audio-trim.test.mjs）。 */
export declare const TTS_TRIM_ABS_FLOOR: number;
export declare const TTS_TRIM_REL_FLOOR: number;
export declare const TTS_TRIM_WINDOW_MS: number;
export declare const TTS_TRIM_PAD_HEAD_MS: number;
export declare const TTS_TRIM_PAD_TAIL_MS: number;
export declare const TTS_TRIM_FADE_MS: number;
export declare function trimTtsSamples(
  samples: Float32Array | null | undefined,
  sampleRate?: number,
): Float32Array;
