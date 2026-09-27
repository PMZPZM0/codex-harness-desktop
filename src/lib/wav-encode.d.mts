/** Float32 PCM → WAV(16bit) 纯编码（实现见 ./wav-encode.mjs） */
export function wavHeader(dataBytes: number, sampleRate: number, channels?: number, bitsPerSample?: number): Uint8Array;
export function wavBase64FromFloat32Pcm(base64: string, sampleRate: number, channels?: number): string;
export function wavDurationSeconds(wavBase64: string): number;
