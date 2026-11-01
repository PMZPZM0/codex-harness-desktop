export type MediaPlaybackEntry = {
  threadId: string;
  turnId: string;
  source: string;
  title: string;
  kind: string;
  at: number;
};

export function subscribeMediaPlayback(listener: () => void): () => void;
export function recordMediaPlayback(entry: {
  threadId: string;
  turnId?: string;
  source: string;
  title?: string;
  kind?: string;
}): void;
export function getTurnMedia(threadId: string, turnId: string): MediaPlaybackEntry[];
export function clearThreadMedia(threadId: string): void;