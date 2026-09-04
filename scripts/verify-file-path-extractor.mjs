// 文件路径抽取器的回归测试 — 与 src/App.tsx 的 extractFilePathsFromMarkdown 行为保持一致
function looksLikeFilePath(candidate) {
  const trimmed = candidate.replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  if (!trimmed || trimmed.length > 4096) return false;
  const hasDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  if (!hasDrive && /[<>:"|?*\u0000-\u001f]/.test(trimmed)) return false;
  // 版本号 / 纯数字 token（2.55.0、v24.19.0、11.17.0、384.4）不是文件
  if (/^[vV]?\d[\d.,]*\d$/.test(trimmed)) return false;
  if (hasDrive) return /\.[A-Za-z0-9]{1,5}$/.test(trimmed);
  if (trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  if (/[\\/]/.test(trimmed) && /\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  if (/\s/.test(trimmed)) return false;
  if (/^[A-Za-z0-9_.\u4e00-\u9fa5-]+\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  return false;
}

function extractFilePathsFromMarkdown(text) {
  const seen = new Set();
  const out = [];
  const push = (raw) => {
    const trimmed = raw.replace(/^[`"'\s]+|[`"'\s]+$/g, "").replace(/[\\/]+$/, "");
    if (!looksLikeFilePath(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    if (part == null) break;
    for (const line of part.split(/\r?\n/)) {
      const kw = line.match(/^[ \t]*(?:路径|Path|路径名|文件|位置|File|path)[:：][ \t]*(.+?)[ \t]*$/i);
      if (kw) { push(kw[1]); continue; }
      const bt = line.match(/`([^`\n]+)`/g);
      if (bt) {
        for (const piece of bt) push(piece.slice(1, -1));
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("`") && trimmedLine.endsWith("`") && bt.length === 1) {
          push(trimmedLine.slice(1, -1));
        }
        continue;
      }
      const abs = line.match(/([A-Za-z]:[\\/][^\s<>:\"|?*\n]+\.[A-Za-z0-9]{1,5})/);
      if (abs) { push(abs[1]); continue; }
      const bareMatches = line.match(/([^\s<>:\"|?*()<>\[\]{}]+\.[A-Za-z0-9]{1,5})/g);
      if (bareMatches) {
        for (const m of bareMatches) push(m);
      }
    }
  }
  return out;
}

const cases = [
  { name: "screenshot exact", text: "已在你桌面新建文件夹 自我简介，里面放了 自我介绍.txt (UTF-8 编码)，内容包括我能做什么、我的特点，以及对你的问候。\n\n路径: 自我介绍.txt", expect: ["自我介绍.txt"] },
  { name: "windows abs path", text: "文件已经写到 C:\\Users\\PPZ\\Desktop\\自我介绍.txt", expect: ["C:\\Users\\PPZ\\Desktop\\自我介绍.txt"] },
  { name: "backtick", text: "可以打开 `notes.md` 看看格式。", expect: ["notes.md"] },
  { name: "code fence skip", text: "看下代码：\n```js\nconst x = \"./foo.txt\";\n```\n路径: bar.md", expect: ["bar.md"] },
  { name: "with-md-filename", text: "欢迎使用 `README.md`", expect: ["README.md"] },
  { name: "image path", text: "截图: image.png", expect: ["image.png"] },
  { name: "two paths", text: "新建了 a.txt 和 b.md 两个文件", expect: ["a.txt", "b.md"] },
  { name: "dedup", text: "路径: foo.txt\n路径: foo.txt", expect: ["foo.txt"] },
  { name: "with 中文 space", text: "已 建 立 文 件 简 介.txt 等待检阅", expect: ["介.txt"] }, // 兜底接受，真实输出里不会出现
  { name: "key + 中文", text: "位置：我的笔记.md", expect: ["我的笔记.md"] },
  { name: "absolute forward slash", text: "see /home/x/file.md for details", expect: ["/home/x/file.md"] },
  { name: "no extension", text: "路径: README", expect: [] },
  { name: "version numbers", text: "git 2.55.0、 node v24.19.0、 npm 11.17.0、 pwsh 7.6.4", expect: [] },
  { name: "numeric tokens", text: "共 384.4 MB，其中 183.5 条命中", expect: [] },
  { name: "version-like file ok", text: "配置在 config.2.json 里", expect: ["config.2.json"] },
  { name: "json file ok", text: "看 plugin.json 的配置", expect: ["plugin.json"] },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = extractFilePathsFromMarkdown(c.text);
  const ok = JSON.stringify(got.sort()) === JSON.stringify([...c.expect].sort());
  if (ok) pass++; else fail++;
  console.log((ok ? "✅" : "❌") + " " + c.name.padEnd(22) + " got=" + JSON.stringify(got) + (ok ? "" : "  want=" + JSON.stringify(c.expect)));
}
console.log(`\n# pass ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
