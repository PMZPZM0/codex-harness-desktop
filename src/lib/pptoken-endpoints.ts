/**
 * PPTokenEndpoints（从 src/App.tsx 原样搬来，实现未改）。
 * 搬到 lib：本域与 App 其它地方都要用，不能一边一份。
 */


export const PPTokenEndpoints = [
  { id: "pptoken", name: "PPtoken", label: "API 端点默认", url: "https://api.pptoken.cc/v1" },
  { id: "pptoken-cn", name: "PPtoken 大陆线路", label: "OpenAI 模型 · 大陆优化线路", url: "https://cn.pptoken.cc/v1" },
  { id: "pptoken-us", name: "PPtoken 北美线路", label: "北美线路 · 需要代理", url: "https://us.pptoken.cc/v1" },
  { id: "pptoken-claude", name: "PPtoken Claude", label: "Claude 模型 · 专用地址", url: "https://api.pptoken.cc" },
];

