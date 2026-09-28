/** video-providers（实现见 ./video-providers.mjs）：视频生成接口的纯适配层。 */
export interface VideoProviderMeta {
  id: string;
  name: string;
  region: "cn" | "global";
  modes: string[];
  imageInput: "base64" | "url" | "both";
  fields: string[];
  /** 官方默认地址（自定义地址的替换基底；UI 用它做 placeholder） */
  baseUrl?: string;
  models: string[];
  defaultModel: string;
}
export interface VideoProviderConfig { [key: string]: string }
export interface VideoSubmitInput { mode: "t2v" | "i2v"; prompt: string; image?: string; model?: string; duration?: number }
export interface HttpRequest { url: string; headers: Record<string, string>; body?: unknown }
export interface VideoPollResult { status: "queued" | "running" | "succeeded" | "failed"; url?: string; fileId?: string; error?: string }
export const VIDEO_PROVIDERS: VideoProviderMeta[];
export function klingToken(cfg: VideoProviderConfig, nowMs: number): string;
export function videoAssertImageOk(providerId: string, mode: "t2v" | "i2v", image?: string): VideoProviderMeta;
export function videoBuildSubmit(providerId: string, cfg: VideoProviderConfig, input: VideoSubmitInput, nowMs: number): HttpRequest;
export function videoParseSubmit(providerId: string, respJson: any): string;
export function videoBuildPoll(providerId: string, cfg: VideoProviderConfig, jobId: string, nowMs: number): HttpRequest;
export function videoParsePoll(providerId: string, respJson: any): VideoPollResult;
export function videoBuildFileRetrieve(cfg: VideoProviderConfig, fileId: string): HttpRequest;
export function videoParseFileRetrieve(respJson: any): string;
/** 所有厂商通用的可选覆盖字段（baseUrl / model）—— 与必填 fields 分开 */
export const VIDEO_OPTIONAL_FIELDS: string[];
/** 把请求地址换到用户自定义的 API 地址（只换 origin+前缀，路径保持官方协议） */
export function videoApplyBaseUrl(request: HttpRequest, providerId: string, cfg: VideoProviderConfig | undefined): HttpRequest;
