// 内联图片占位符纯函数单测（node:test，零新依赖）。
// 用法: npm run verify:prompt-images
// 流程: 读 src/lib/prompt-images.ts（纯 TS 无依赖），替换 export 后用 tsc 编译成 CJS 再断言。
// 覆盖: token 编解码（中文/空格路径）、split 段落、promptImagePaths 去重、strip 清理、
//       insertImageToken 光标插入（含前导空格）、往返一致性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".test-tmp");
const srcFile = join(tmpDir, "prompt-images.src.ts");
// tsc 以输入文件名命名产物
const outFile = join(tmpDir, "prompt-images.src.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscBin)) {
  console.error("FATAL: typescript not installed");
  process.exit(1);
}
mkdirSync(tmpDir, { recursive: true });
rmSync(outFile, { force: true });
// 源文件是纯 TS（无 import），直接拷贝编译
const source = readFileSync(join(root, "src", "lib", "prompt-images.ts"), "utf8");
writeFileSync(srcFile, source, "utf8");

execFileSync(process.execPath, [tscBin, srcFile, "--module", "commonjs", "--target", "es2020", "--outDir", tmpDir, "--skipLibCheck"], { stdio: "pipe" });

const require_ = createRequire(import.meta.url);
const { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, insertImageToken, removeImageToken } = require_(outFile);

test("imageToken 编码中文/空格路径", () => {
  const t = imageToken("C:\\Users\\我 的图\\a.png");
  assert.ok(!t.includes(" "), "token 内不应有空格");
  assert.match(t, /^\[图片:.+\]$/);
});

test("splitPromptSegments: 纯文本", () => {
  const segs = splitPromptSegments("你好世界");
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "text");
  assert.equal(segs[0].text, "你好世界");
});

test("splitPromptSegments: 文本+图片+文本，位置保持", () => {
  const path = "C:\\imgs\\b.png";
  const segs = splitPromptSegments(`看这张${imageToken(path)}对吗`);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, "text");
  assert.equal(segs[0].text, "看这张");
  assert.equal(segs[1].kind, "image");
  assert.equal(segs[1].path, path);
  assert.equal(segs[2].text, "对吗");
});

test("splitPromptSegments: 非占位符的方括号不受影响", () => {
  const segs = splitPromptSegments("数组写法 [i] 和一般 [文字] 混合");
  assert.equal(segs.filter((s) => s.kind === "image").length, 0);
});

test("promptImagePaths: 按出现顺序去重", () => {
  const a = imageToken("/x/a.png"), b = imageToken("/x/b.png");
  const paths = promptImagePaths(`${a} 文字 ${b} 再提 ${a}`);
  assert.deepEqual(paths, ["/x/a.png", "/x/b.png"]);
});

test("stripImageTokens: 剥离占位符并清理空行", () => {
  const a = imageToken("/x/a.png");
  const out = stripImageTokens(`第一行${a}\n${a}\n\n\n第三行`);
  assert.ok(!out.includes("图片"));
  assert.ok(out.includes("第一行"));
  assert.ok(out.includes("第三行"));
  assert.ok(!/\n{3,}/.test(out));
});

test("insertImageToken: 文字中间插入带前导空格", () => {
  const { text, caret } = insertImageToken("前后", 1, 1, "/x/p.png");
  const token = imageToken("/x/p.png");
  assert.equal(text, `前 ${token}后`);
  assert.equal(caret, 2 + token.length);
});

test("insertImageToken: 行首插入不带前导空格", () => {
  const { text } = insertImageToken("", 0, 0, "/x/p.png");
  assert.equal(text, imageToken("/x/p.png"));
});

test("往返: insert 后 split 回原路径", () => {
  const { text } = insertImageToken("看", 1, 1, "C:\\我 的\\图.png");
  const paths = promptImagePaths(text);
  assert.deepEqual(paths, ["C:\\我 的\\图.png"]);
});

test("removeImageToken: 中文/空格路径精确删除（回归 X 按钮匹配 bug）", () => {
  const path = "C:\\Users\\我 的图\\a.png";
  const text = `开头 ${imageToken(path)} 结尾`;
  const out = removeImageToken(text, path);
  assert.equal(out, "开头 结尾");
});

test("removeImageToken: 删除全部同名占位符且不影响其他图片", () => {
  const a = "/x/a.png", b = "/x/b.png";
  const text = `${imageToken(a)} 中 ${imageToken(b)} 再 ${imageToken(a)}`;
  const out = removeImageToken(text, a);
  assert.ok(!out.includes("a.png"));
  assert.ok(out.includes(imageToken(b)));
});
