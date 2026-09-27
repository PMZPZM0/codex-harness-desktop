/** 「交给 Agent」的提示词构造（实现见 ./drama-agent-prompts.mjs） */
export interface DramaPromptContext {
  kind: string;
  payload: Record<string, any>;
  storyboardPath?: string;
  boardName?: string;
}
export function dramaAgentPrompt(ctx: DramaPromptContext): string;
export function dramaBoardRelativePath(name: string): string;
