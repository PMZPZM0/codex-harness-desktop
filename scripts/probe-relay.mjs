// relay 可达性探测（写文件执行避免 -e 引号坑）
(async () => {
  const hosts = ["localtunnel.me", "ngrok.com", "bore.pub", "pinggy.io", "zrok.io"];
  for (const host of hosts) {
    try {
      const res = await fetch("https://" + host + "/", { signal: AbortSignal.timeout(6000) });
      console.log(host, "->", res.status);
    } catch (e) {
      console.log(host, "-> FAIL", (e.cause && e.cause.code) || String(e.message).slice(0, 50));
    }
  }
  process.exit(0);
})();
