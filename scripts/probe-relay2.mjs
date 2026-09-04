(async () => {
  try {
    const res = await fetch("https://loca.lt/myTunnelInfo", { signal: AbortSignal.timeout(6000) });
    console.log("loca.lt ->", res.status);
  } catch (e) { console.log("loca.lt FAIL", (e.cause && e.cause.code) || String(e.message).slice(0, 40)); }
  try {
    const res = await fetch("https://ifconfig.me/ip", { signal: AbortSignal.timeout(6000) });
    console.log("public ip ->", (await res.text()).trim());
  } catch (e) { console.log("ip check FAIL", String(e.message).slice(0, 40)); }
  process.exit(0);
})();
