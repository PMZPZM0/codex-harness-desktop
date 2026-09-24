/**
 * 内置连接器模板清单（纯数据）
 *
 * 09-21 架构改造：从 electron/main.ts 搬出，**内容逐字未改**（仅加 export）。
 * main.ts 通过 import 同名符号衔接 ⇒ 全文调用点一行未动。
 */

export const BUILTIN_CONNECTOR_TEMPLATES: ConnectorTemplate[] = [
  {
    id: "feishu", name: "飞书", vendor: "官方 Larksuite MCP", transport: "stdio",
    summary: "即时通讯、日历、云文档、多维表格、知识库、审批、OKR 等全产品能力",
    helpUrl: "https://open.feishu.cn/app",
    command: "npx",
    args: ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "{app_id}", "-s", "{app_secret}", "--token-mode", "tenant_access_token"],
    env: {},
    fields: [
      { key: "app_id", label: "App ID", placeholder: "cli_xxxxxxxx", hint: "飞书开发者后台创建自建应用后，在「凭证与基础信息」页获取" },
      { key: "app_secret", label: "App Secret", placeholder: "应用密钥", secret: true, hint: "同页获取；仅保存在本机，加密后写入引擎配置" },
    ],
    oauth: { kind: "lark-login", port: 3000, credentialKeys: ["app_id", "app_secret"], scopes: "offline_access" },
    oauthNote: "授权前请在飞书开发者后台为应用配置重定向 URL：http://localhost:3000/callback，并开启「刷新 user_access_token」开关；授权后 MCP 将以你的用户身份（user_access_token）调用接口，token 过期自动刷新。",
  },
  {
    id: "dingtalk", name: "钉钉", vendor: "官方 DingTalk MCP", transport: "stdio",
    summary: "通讯录、群聊与机器人、日历、待办、OA 审批、AI 表格、DING 消息等",
    helpUrl: "https://open.dingtalk.com",
    command: "npx",
    args: ["-y", "dingtalk-mcp@latest"],
    env: { ACTIVE_PROFILES: "ALL" },
    fields: [
      { key: "client_id", label: "Client ID (AppKey)", placeholder: "钉钉应用 AppKey", envVar: "DINGTALK_Client_ID", hint: "钉钉开放平台创建企业内部应用后，在「凭证与基础信息」获取" },
      { key: "client_secret", label: "Client Secret (AppSecret)", placeholder: "应用密钥", secret: true, envVar: "DINGTALK_Client_Secret", hint: "同页获取；加密保存" },
      { key: "agent_id", label: "AgentId", placeholder: "可选", optional: true, envVar: "DINGTALK_AgentId", hint: "如需发送工作通知才需要；留空则跳过" },
    ],
    oauth: {
      kind: "http-code", port: 8765, credentialKeys: ["client_id", "client_secret"],
      authorizeUrl: "https://login.dingtalk.com/oauth2/auth?redirect_uri={redirect_uri}&response_type=code&client_id={client_id}&scope=openid&state={state}&prompt=consent",
      tokenUrl: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
      tokenMethod: "POST",
      tokenParams: { grantType: "authorization_code" },
      tokenResult: { accessToken: "accessToken", refreshToken: "refreshToken" },
      note: "请在钉钉开放平台应用「安全设置」配置回调域名 http://localhost:8765；授权后以你的钉钉账号身份获取用户令牌（官方 MCP 目前以应用身份调用，用户令牌先加密保存备用）。",
    },
    oauthNote: "点「授权连接」会打开钉钉扫码授权页，扫码同意后自动换取并保存用户令牌。",
  },
  {
    id: "tencent-docs", name: "腾讯文档", vendor: "官方腾讯文档 MCP", transport: "streamable_http",
    summary: "创建/编辑在线文档、表格、幻灯片，查询与整理内容",
    helpUrl: "https://docs.qq.com/open/auth/mcp.html",
    url: "https://docs.qq.com/openapi/mcp",
    env: {},
    envHttpHeaders: { Authorization: "TENCENT_DOCS_TOKEN" },
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "应用审核通过后分配", hint: "登录腾讯文档开放合作平台创建第三方应用，审核通过后获得" },
      { key: "client_secret", label: "Client Secret", placeholder: "应用密钥", secret: true, hint: "同页获取；加密保存" },
      { key: "redirect_uri", label: "回调地址", placeholder: "http://127.0.0.1:8766/callback", optional: true, hint: "默认本机 8766；腾讯文档要求 HTTPS 回调，被拦截时用内网穿透转发到本机 8766 并在此填公网地址" },
      { key: "token", label: "个人访问 Token", placeholder: "docs.qq.com 开放平台签发", optional: true, secret: true, tokenFor: "TENCENT_DOCS_TOKEN", hint: "访问 https://docs.qq.com/open/auth/mcp.html 领取，供官方 MCP 端点使用" },
    ],
    oauth: {
      kind: "http-code", port: 8766, credentialKeys: ["client_id", "client_secret"],
      authorizeUrl: "https://docs.qq.com/oauth/v2/authorize?client_id={client_id}&redirect_uri={redirect_uri}&new_login=1&response_type=code&scope=all&state={state}",
      tokenUrl: "https://docs.qq.com/oauth/v2/token",
      tokenMethod: "GET",
      tokenParams: { grant_type: "authorization_code" },
      tokenResult: { accessToken: "access_token", refreshToken: "refresh_token", userId: "user_id" },
      note: "腾讯文档要求 HTTPS 回调地址；本地 127.0.0.1 可能被拦截，需用内网穿透把公网 HTTPS 转发到本机 8766 端口并填入上方回调地址。OAuth 令牌用于 OpenAPI（Client ID + Open ID + Token 三元组），官方 MCP 端点仍用个人 Token。",
    },
    oauthNote: "点「授权连接」会跳转腾讯文档授权页，登录同意后自动换取令牌并加密保存。",
  },
  {
    id: "tdx", name: "通达信选股", vendor: "MCP 行情 · 需自备数据地址", transport: "streamable_http",
    summary: "股票行情、条件选股、研究报告、公告与宏观信息（依赖可达的 MCP 端点）",
    helpUrl: "https://github.com/adambbhe/TDX-finance-mcp-plugin-v3",
    url: "https://{endpoint}",
    env: {},
    envHttpHeaders: { Authorization: "TDX_API_TOKEN" },
    fields: [
      { key: "endpoint", label: "MCP 服务地址", placeholder: "https://tdxhub.example.com", hint: "通达信无官方 MCP，请填可达的 MCP 端点；本地方案可改用「添加 MCP」手动配置" },
      { key: "token", label: "API Token", placeholder: "可选", optional: true, secret: true, tokenFor: "TDX_API_TOKEN", hint: "服务商签发的令牌；无鉴权可留空" },
    ],
  },
];

// ── 09-21 同域补充搬迁（内容逐字未改）──
export type ConnectorTemplate = {
  id: string;
  name: string;
  vendor: string;
  summary: string;
  helpUrl: string;
  transport: "stdio" | "streamable_http";
  command?: string;
  args?: string[]; // 支持 {field} 占位符
  url?: string; // 支持 {field} 占位符
  envHttpHeaders?: Record<string, string>; // header 名 -> 环境变量名（密钥经 connectorEnv 注入）
  env: Record<string, string>; // 明文字段里的默认 env
  fields: ConnectorTemplateField[];
  oauth?: ConnectorOAuthSpec; // OAuth 授权流程（跳转官方授权页，授权完成即连接）
  oauthNote?: string; // 授权注意事项（展示在弹窗）
};

// ── 同域类型（09-21 一并搬出）──
export type ConnectorTemplateField = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
  envVar?: string; // stdio 模板：字段经此环境变量传给 MCP server（secret 字段走加密注入）
  tokenFor?: string; // HTTP 模板：该字段的值作为指定 envHttpHeaders 的 secret
  optional?: boolean;
};
export type ConnectorOAuthSpec = {
  kind: ConnectorOAuthKind;
  port: number; // 本地回调/授权监听端口（与开发后台配置的 redirect_uri 对应）
  credentialKeys: string[]; // 表单字段里作为客户端凭据的 key
  redirectUri?: string; // 固定回调地址；缺省用 http://127.0.0.1:{port}/callback
  authorizeUrl?: string; // http-code：授权页 URL 模板（{client_id}/{redirect_uri}/{state} 占位）
  tokenUrl?: string; // http-code：code 换 token 接口
  tokenMethod?: "GET" | "POST";
  tokenParams?: Record<string, string>; // 附加请求参数（grant_type 等）
  tokenResult?: { accessToken: string; refreshToken?: string; userId?: string }; // 响应字段映射
  scopes?: string; // lark-login 的 scope
  note?: string; // 该服务商授权注意事项（提示用户）
};

export type ConnectorOAuthKind = "lark-login" | "http-code";
