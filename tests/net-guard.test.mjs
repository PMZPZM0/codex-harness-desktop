import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const compiled = join(process.cwd(), 'dist-electron/net-guard.js');
test('主进程出站同源串行且保留调用方取消信号', { skip: !existsSync(compiled) }, async () => {
  const require = createRequire(import.meta.url);
  const { guardedFetch, __resetGuardedFetchState } = require(compiled);
  const calls = [];
  let active = 0;
  let peak = 0;
  const transport = async (url, init) => {
    calls.push({ url, init });
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return new Response('ok');
  };
  __resetGuardedFetchState();
  const signal = AbortSignal.timeout(1000);
  await Promise.all([
    guardedFetch('https://example.invalid/one', { signal }, { transport }),
    guardedFetch('https://example.invalid/two', { signal }, { transport }),
  ]);
  assert.equal(peak, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.init.signal.aborted === false));
  __resetGuardedFetchState();
});
