/** 模型下拉可选模型（主对话 / 群聊共用口径）。 */
export declare function collectModelChoices(
  providers: Array<{
    provider?: string; name?: string; model?: string; enabled?: boolean; source?: string;
    models?: Array<{ id?: string; enabled?: boolean; credits?: string; inputTypes?: string[]; contextWindow?: number; maxOutputTokens?: number }>;
  }>,
  current: string | null | undefined,
): Array<{
  modelId: string; provider: string; providerName: string; isActive: boolean;
  credits?: string; inputTypes?: string[]; contextWindow?: number; maxOutputTokens?: number;
}>;
