const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1080,
    height: 1040,
    show: false,
    backgroundColor: "#05060b",
    webPreferences: { offscreen: true },
  });
  const file = path.join(__dirname, "index.html");
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1500));

  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 400));
  const res = await dbg.sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 },
  });
  const out = path.join(__dirname, "poster-real.png");
  fs.writeFileSync(out, Buffer.from(res.data, "base64"));
  const b = fs.readFileSync(out);
  console.log("SAVED", out, b.length, "dims:", b.readUInt32BE(16) + "x" + b.readUInt32BE(20));
  app.quit();
});
