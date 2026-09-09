// 定位应用根结构
const { readFileSync } = require("fs");
const t = readFileSync("src/App.tsx", "utf8").split(/\r?\n/);
t.forEach((l, i) => { if (l.includes("app-shell")) console.log((i + 1) + ": " + l.trim().slice(0, 120)); });
const start = t.findIndex((l) => l.trim() === "return (");
console.log("--- return block start ---");
for (let i = start; i < start + 14; i++) console.log((i + 1) + ": " + t[i].slice(0, 130));
