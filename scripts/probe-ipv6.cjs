// IPv6 入站自测
const http = require("http");
const os = require("os");
const server = http.createServer((req, res) => { res.writeHead(200); res.end("IPv6-OK"); });
server.listen(0, "::", () => {
  const port = server.address().port;
  const ip = Object.values(os.networkInterfaces()).flat().find((e) => e.family === "IPv6" && e.address.startsWith("2408")).address;
  const url = "http://[" + ip + "]:" + port + "/";
  console.log("testing", url);
  fetch(url, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.text())
    .then((t) => { console.log("result:", t, t === "IPv6-OK" ? "== 公网 IPv6 入站可达 YES" : "MISMATCH"); server.close(); process.exit(0); })
    .catch((e) => { console.log("IPv6 inbound FAIL:", (e.cause && e.cause.code) || e.message, "== 路由器/运营商拦入站"); server.close(); process.exit(0); });
});
