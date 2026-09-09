import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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

const source = await fs.readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
const imageFunction = source.slice(source.indexOf('async function generateImageWith('), source.indexOf('async function describeImageWith('));
let payload;
const generate = vm.runInNewContext(ts.transpile(imageFunction) + '\ngenerateImageWith', {
  AbortSignal, fetch: async () => new Response(JSON.stringify(payload)), describeNetworkError: error => error,
});
const input = { baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'gpt-image-2', prompt: 'test' };
payload = { data: [{ url: '', b64_json: png.split(',')[1] }] };
assert.equal((await generate(input)).url, png);
payload = { data: [{ url: 'https://example.com/image.png' }] };
assert.equal((await generate(input)).url, payload.data[0].url);
payload = { data: [] };
await assert.rejects(generate(input), /未返回图片/);

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
  assert.equal(JSON.parse(stdout).url, png);
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.ok(pkg.build.extraResources.some(entry => entry.from === 'resources/tools/harness-media.mjs' && entry.to === 'tools/harness-media.mjs'));
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.unlink(path.join(temporary, 'builtin-plugins.json'));
  await fs.rmdir(temporary);
}
console.log('PASS: image rendering, unsafe URLs blocked, image response handling, configured CLI, package resource');
