import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 仅在 development + SSH_MOCK 存在时注入 mock，让 React 应用能脱离 Electron 渲染 SSH 设置页
const mockCodex = `
<script>
(function() {
  if (window.codex) return;
  const noop = () => Promise.resolve();
  const noopArr = () => Promise.resolve([]);
  const sshServers = [
    { id: 'demo-1', name: '生产-主库-1', host: '10.0.0.1', port: 22, username: 'root',
      authType: 'password', password: '', privateKey: '', keyPath: '', passphrase: '',
      enabled: true, favorite: true, group: '生产', tags: ['MySQL', '主库'],
      createdAt: new Date().toISOString(), lastTestAt: new Date().toISOString(), lastTestOk: true, lastTestLatencyMs: 23,
      lastFingerprint: 'SHA256:abc123def456789', lastServerInfo: { os: 'Ubuntu 22.04', uname: '5.15.0', hostname: 'prod-db-1', uptime: '12 days' },
      jumpHost: null, remotePath: '/data', notes: '主库 readonly' },
    { id: 'demo-2', name: '测试服务器-2', host: '10.0.1.50', port: 2222, username: 'ubuntu',
      authType: 'key', password: '', privateKey: '', keyPath: 'C:\\\\Users\\\\you\\\\.ssh\\\\id_ed25519', passphrase: '',
      enabled: false, favorite: false, group: '测试', tags: ['GPU'],
      createdAt: new Date().toISOString(),
      jumpHost: null, remotePath: '', notes: '' }
  ];
  window.codex = new Proxy({}, {
    get(_, key) {
      if (key === 'readAppSettings') return () => Promise.resolve({ webSearch: true, desktopAutomation: true, browserAutomation: true, engineWatchdog: true });
      if (key === 'saveAppSettings') return () => Promise.resolve({ webSearch: true, desktopAutomation: true, browserAutomation: true, engineWatchdog: true });
      if (key === 'listSshServers') return () => Promise.resolve(sshServers);
      if (key === 'saveSshServer') return (s) => { const i = sshServers.findIndex(x => x.id === s.id); if (i >= 0) sshServers[i] = s; else { s.id = 'demo-' + (sshServers.length + 1); sshServers.push(s); } return Promise.resolve(sshServers); };
      if (key === 'deleteSshServer') return (id) => { const i = sshServers.findIndex(x => x.id === id); if (i >= 0) sshServers.splice(i, 1); return Promise.resolve(sshServers); };
      if (key === 'setSshServerEnabled') return (id, en) => { const s = sshServers.find(x => x.id === id); if (s) s.enabled = en; return Promise.resolve(sshServers); };
      if (key === 'testSshServer') return () => Promise.resolve({ ok: true, latencyMs: 23, fingerprint: 'SHA256:abc123def456789', serverInfo: { os: 'Ubuntu 22.04', hostname: 'demo', uptime: '12 days' } });
      if (key === 'execSshCommand') return () => Promise.resolve({ ok: true, stdout: 'demo output', code: 0, latencyMs: 12 });
      if (key === 'sshSessionOpen') return () => Promise.resolve({ sessionId: 'mock-sess-1' });
      if (key === 'sshSessionWrite' || key === 'sshSessionResize' || key === 'sshSessionClose') return () => Promise.resolve();
      if (key === 'exportSshServers') return () => Promise.resolve('{}');
      if (key === 'importSshServers') return () => Promise.resolve(null);
      if (key === 'chooseSshKey') return () => Promise.resolve(null);
      if (key === 'chooseDirectoryAt') return () => Promise.resolve('C:\\\\Users\\\\you\\\\projects');
      if (key === 'writeFile') return () => Promise.resolve();
      if (key === 'respond') return () => Promise.resolve();
      // JSON-RPC 风格：window.codex.request(method, params) —— mock 时返回常见 fallback
      if (key === 'request') return () => Promise.resolve({ data: [], marketplaces: [] });
      if (key === 'listMemory') return () => Promise.resolve([]);
      if (key === 'listScheduledTasks') return () => Promise.resolve([]);
      if (key === 'readMcpServerOverrides') return () => Promise.resolve({});
      if (key === 'readMcpToolPermissions') return () => Promise.resolve({});
      if (key === 'listPlugins') return () => Promise.resolve({ marketplaces: [] });
      if (key === 'listApps') return () => Promise.resolve({ data: [] });
      if (key === 'listTools') return () => Promise.resolve({ tools: [] });
      if (key === 'listSkills') return () => Promise.resolve({ data: [] });
      if (key === 'listThreads') return () => Promise.resolve({ threads: [] });
      if (key === 'listProviders') return () => Promise.resolve({ providers: [] });
      if (key === 'listLocalSkills') return () => Promise.resolve([]);
      if (key === 'listSubAgents') return () => Promise.resolve([]);
      if (key === 'listRemote') return () => Promise.resolve({});
      if (key === 'getUsername') return () => Promise.resolve('Codex 用户');
      if (key === 'readPersonalization') return () => Promise.resolve({});
      if (key === 'listConnectors') return () => Promise.resolve([]);
      if (key === 'listConnectorTemplates') return () => Promise.resolve([]);
      if (key === 'listEnvironments') return () => Promise.resolve([]);
      if (key === 'listSchedules') return () => Promise.resolve([]);
      if (key === 'listChannels') return () => Promise.resolve([]);
      if (key === 'listBots') return () => Promise.resolve([]);
      if (key === 'listHooks') return () => Promise.resolve([]);
      if (key === 'listSettings') return () => Promise.resolve({});
      // 所有 on* 订阅接口：返回空订阅器（unsubscribe 函数）
      if (typeof key === 'string' && key.startsWith('on')) {
        return () => () => {};
      }
      // 其余 IPC 全部返回空
      return () => Promise.resolve();
    }
  });
})();
</script>
`;

export default defineConfig({
  base: "./",
  /* 构建指纹（09-23 用户点名的第一个改进项）：
     把「这次构建是什么时候、跑的是哪份产物」在**构建期**写进包体。
     ⛔ 必须构建期注入而不是运行时去读 dist/：运行时读文件只能说明"磁盘上有什么"，
        而我们要回答的是"**正在执行的**是哪一份"—— 09-23 那次事故（用户看的实例没加载新构建、
        我无法自证）正是这个区别。显示值 = 这份代码自己，改不掉、也不会滞后。 */
  define: {
    __BUILD_STAMP__: JSON.stringify((() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    })()),
  },
  plugins: [
    react(),
    {
      name: "mock-codex-for-dev",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          if (process.env.SSH_MOCK !== "1") return html;
          return html.replace("<head>", "<head>" + mockCodex);
        },
      },
    },
  ],
  server: { port: 5174, strictPort: true },
  /* ⛔ 不许清空 dist（09-23 崩溃修复）：vite 默认 emptyOutDir=true，每次 build 清掉全部旧 chunk
     ⇒ 正在运行、加载 dist 的实例点开 lazy 页面就 Failed to fetch dynamically imported module。
     保留旧产物 + main.tsx 的 vite:preloadError 自愈 = 运行中实例不会被打断腿。
     （代价：dist 会累积，可手动清或定期删 dist/assets 里的旧文件。） */
  build: { outDir: "dist", emptyOutDir: false },
});
