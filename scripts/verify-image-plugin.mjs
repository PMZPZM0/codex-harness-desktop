import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { markdownUrlTransform } from '../src/lib/markdown-url.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLsAAAAASUVORK5CYII=';
const html = renderToStaticMarkup(React.createElement(Markdown, { urlTransform: markdownUrlTransform }, `![test](${png})`));
assert.ok(html.includes(`src="${png}"`));
for (const url of ['javascript:alert(1)', 'data:text/html;base64,YQ==', 'data:image/svg+xml;base64,YQ==']) {
  assert.equal(markdownUrlTransform(url, 'src', { tagName: 'img' }), '');
}
assert.equal(markdownUrlTransform(png, 'href', { tagName: 'a' }), '');
assert.equal(markdownUrlTransform('https://example.com/image.png', 'src', { tagName: 'img' }), 'https://example.com/image.png');

// —— 主进程 generateImageWith：**绝不允许把内联 base64 回给渲染层** ——
// 09-21 取证：生图网关多只回 b64_json，我们曾把它拼成 data URL 回传，渲染层再拼进工具返回文本，
// 于是单条工具输出 = 3.03 MB base64 文本进对话历史、且每轮重发。
// persistGeneratedImage 就是为此存在的：落盘到 <userData>/images/，只回路径。
// ⛔ 用并集口径（main.ts + electron/features/**）：生图/落盘/识图这几个函数已随 tools 域拆到
//    electron/features/builtin-skills-ipc.ts；只读 main.ts 会抠不到区间（09-21 实测预检直接崩）。
const { createRequire } = await import("node:module");
const { readMainSource } = createRequire(import.meta.url)("./main-source.cjs");
const source = readMainSource();
/* ⛔ 用 **TS 解析器**按函数节点抠取（不再用「两个标记之间的区间」，也不再手写括号配对）：
   ① 区间法：09-22 这两个函数被拆进 electron/features/builtin-skills-ipc/01-builtin-images.ts，
      聚合器只扫一层时区间抠成空串 ⇒ 断言以「功能退化」的样子崩掉（实际是代码搬走了）。
   ② 手写括号配对：参数类型里就有 `{`（如 `input: { baseUrl: string; … }`）⇒ 会切在参数类型上、
      拿到没有函数体的片段 ⇒ vm 里 ReferenceError: generateImageWith is not defined。实测踩过。
   另外**必须剥掉 `export ` 前缀**：带 export 时 ts.transpile 编成 CJS（exports.xxx = …），
   而下面 vm 里那句 `\ngenerateImageWith` 就取不到。 */
const agg = ts.createSourceFile("agg.ts", source, ts.ScriptTarget.Latest, true);
const extractFn = (name) => {
  let out = "";
  const visit = (n) => {
    if (out) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === name) {
      const text = source.slice(n.getStart(agg), n.getEnd());
      out = text.replace(/^\s*export\s+default\s+/, "").replace(/^\s*export\s+/, "");
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(agg);
  return out;
};
const persistFn = extractFn('persistGeneratedImage');
const generateFn = extractFn('generateImageWith');
assert.ok(
  persistFn.includes('persistGeneratedImage') && generateFn.includes('generateImageWith'),
  'sanity: 必须同时抠到「落盘」与「生图」两个函数（各自独立抠取，不依赖两者落在同一区间）'
);
const imageFunctions = persistFn + "\n" + generateFn;
let payload;
const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-'));
const generate = vm.runInNewContext(ts.transpile(imageFunctions) + '\ngenerateImageWith', {
  AbortSignal,
  Buffer,
  path,
  fs,
  existsSync,
  app: { getPath: () => imageDir },
  console: { warn: () => {} },
  fetch: async () => new Response(JSON.stringify(payload)),
  describeNetworkError: error => error,
});
const input = { baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'gpt-image-2', prompt: 'test' };

// ① 网关只回 b64_json：必须落盘 + 只回路径，url 必须为空（这是本次修复的核心断言）
payload = { data: [{ url: '', b64_json: png.split(',')[1] }] };
const fromB64 = await generate(input);
assert.equal(fromB64.url, '', 'inline base64 must never be handed back to the renderer');
assert.ok(fromB64.path && path.isAbsolute(fromB64.path), 'b64_json must be persisted and returned as an absolute path');
assert.ok((await fs.readFile(fromB64.path)).equals(Buffer.from(png.split(',')[1], 'base64')), 'persisted file must equal the image bytes from the gateway');

// ② 网关给了托管地址：地址原样带出（短、可用），同时也要落盘（托管地址会失效）
payload = { data: [{ url: 'https://example.com/image.png' }] };
const fromUrl = await generate(input);
assert.equal(fromUrl.url, 'https://example.com/image.png');
assert.ok(fromUrl.path && path.isAbsolute(fromUrl.path), 'hosted url must still be persisted locally');

// ③ 网关什么都没回：必须报错，不能静默返回空
payload = { data: [] };
await assert.rejects(generate(input), /未返回图片/);

await fs.rm(imageDir, { recursive: true, force: true });

// —— 本地路径必须被读成 data URL ——
// 理由：引擎消息里的图片就是本地文件路径，模型照用法原样传给 describe_image 时上游会
// 400「invalid image」。命令行那条路径（harness-media.mjs 的 vision 分支）早就这么做对了，
// 这里锁住主进程侧同口径 —— 否则同一件事两条路径行为不一致。
const toImageSourceFn = source.slice(source.indexOf('async function toImageSource('), source.indexOf('async function describeImageWith('));
assert.ok(toImageSourceFn.includes('toImageSource'), 'sanity: toImageSource 区间必须被抠出来');
const toImageSource = vm.runInNewContext(ts.transpile(toImageSourceFn) + '\ntoImageSource', {
  Buffer,
  path,
  fs,
  existsSync,
  console: { warn: () => {} },
});
const localDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-src-'));
const localPng = path.join(localDir, 'local.png');
await fs.writeFile(localPng, Buffer.from(png.split(',')[1], 'base64'));
assert.equal(await toImageSource('https://example.com/a.png'), 'https://example.com/a.png', 'http(s) url must pass through');
assert.equal(await toImageSource(png), png, 'data url must pass through');
const converted = await toImageSource(localPng);
assert.ok(converted.startsWith('data:image/png;base64,') && converted.endsWith(png.split(',')[1]), 'local path must be read into a data url');
await assert.rejects(toImageSource(path.join(localDir, 'nope.png')), /不存在/, 'missing local file must fail loudly');
await fs.rm(localDir, { recursive: true, force: true });

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'image-plugin-'));
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  assert.equal(request.url, '/v1/images/generations');
  assert.equal(JSON.parse(body).model, 'gpt-image-2');
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ data: [{ b64_json: png.split(',')[1] }] }));
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(temporary, 'builtin-plugins.json'), JSON.stringify({ image: { ...input, baseUrl: `http://127.0.0.1:${server.address().port}/v1` } }));
  const { stdout } = await promisify(execFile)(process.execPath, ['resources/tools/harness-media.mjs', 'image', 'test'], { env: { ...process.env, CODEX_HARNESS_USERDATA: temporary }, timeout: 10000 });
  // 命令行那条路径（harness-media.mjs）也必须落盘 + 不回内联 base64 —— 它比主进程更早做对，
  // 这里锁住同一口径，避免两边漂移。
  const cliOut = JSON.parse(stdout);
  assert.ok(cliOut.path, 'CLI image generation must persist and return a path');
  assert.equal(cliOut.url, undefined, 'CLI must not return an inline data URL');
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.ok(pkg.build.extraResources.some(entry => entry.from === 'resources/tools/harness-media.mjs' && entry.to === 'tools/harness-media.mjs'));
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.unlink(path.join(temporary, 'builtin-plugins.json'));
  await fs.rm(path.join(temporary, 'images'), { recursive: true, force: true });
  await fs.rmdir(temporary);
}
console.log('PASS: image rendering, unsafe URLs blocked, no inline base64 in tool output (b64_json persisted), hosted url kept, CLI parity, package resource');
