// 类型声明：voice-aec.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检的纯逻辑断言跑真实实现，漏改会立刻红）。

export declare function resampleLinear(
  src: Float32Array,
  srcRate: number,
  dstRate: number
): Float32Array;

export declare function rmsOf(samples: Float32Array): number;

export interface AecOptions {
  filterLength?: number;
  /** 回声路径延迟样本数（默认值；运行中可用 setDelay 校正） */
  delay?: number;
  /** 延迟线上限样本数（缓冲区按它预分配；默认 = delay） */
  maxDelay?: number;
  step?: number;
  epsilon?: number;
}

export interface Aec {
  /** 双讲期间冻结权重自适应（回声相减照常） */
  setFrozen(frozen: boolean): void;
  /** 按设备自报的输出延迟校正延迟线（样本数，自动夹到 [0, maxDelay]） */
  setDelay(samples: number): void;
  readonly delay: number;
  /** 送入麦克风块与对应参考，返回去回声后的麦克风（等长） */
  process(mic: Float32Array, ref: Float32Array): Float32Array;
}

export declare function createAec(options?: AecOptions): Aec;

export interface EchoGateOptions {
  echoGateDb?: number;
  floorDecay?: number;
}

export interface EchoGate {
  readonly floor: number;
  readonly peak: number;
  readonly doubleTalk: boolean;
  reset(): void;
  /** 返回本块是否判定为「用户在说话」（双讲） */
  update(rms: number, playing: boolean, weight?: number): boolean;
}

export declare function createEchoGate(options?: EchoGateOptions): EchoGate;

export interface SentenceChunkerOptions {
  maxChars?: number;
  /** 首句阈值（默认 min(10, maxChars)：首句尽早出声，后续仍按 maxChars 攒长句） */
  firstMaxChars?: number;
}

export interface SentenceChunker {
  push(delta: string): string[];
  flush(): string[];
  readonly pending: string;
}

export declare function createSentenceChunker(options?: SentenceChunkerOptions): SentenceChunker;
