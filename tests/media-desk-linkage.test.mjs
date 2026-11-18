import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the compiled entry point without opening a window or creating real reminders.
function compiled(file, dependencies) {
  const exports = {};
  runInNewContext(readFileSync(new URL(`../dist-electron/features/media-desk/${file}.js`, import.meta.url), 'utf8'), {
    exports, require(id) { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; },
  });
  return exports;
}

test('media schedule creates one reminder, updates by stable id, deletes and restores on undo', async () => {
  const tasks = new Map(), history = [];
  let items = [];
  const scheduler = { list: async () => [...tasks.values()], save: async task => { tasks.set(task.id, task); return task; }, remove: async id => tasks.delete(id) };
  const mediaDeskRequest = async (route, body) => {
    if (route === 'undo') items = history.pop();
    if (route !== 'ops') return { state: { items } };
    history.push(structuredClone(items));
    const [op] = body.ops;
    if (op.op === 'add_item') items.push({ id: 'sample-content', ...op });
    else if (op.op === 'schedule_item') items[0].scheduledAt = op.scheduledAt;
    else if (op.op === 'delete_item') items = [];
    return { receipts: [{ target: 'sample-content' }] };
  };
  const { runMediaDeskTool: run } = compiled('tool', { './embed': { mediaDeskRequest }, '../../main': { scheduler }, electron: { app: { getPath: () => '.' } } });
  const schedule = { action: 'schedule', when: '2030-01-02T09:00:00Z' };
  assert.equal((await run({ ...schedule, title: 'draft' })).ok, true);
  const [id] = tasks.keys();
  assert.ok(id);
  items[0].title = 'edited';
  assert.equal((await run({ ...schedule, postId: 'sample-content', when: '2030-01-03T09:00:00Z' })).ok, true);
  assert.equal(tasks.size, 1);
  assert.match(tasks.get(id).name, /edited/);
  assert.equal((await run({ action: 'delete', id: 'sample-content' })).ok, true);
  assert.equal(tasks.size, 0);
  assert.equal((await run({ action: 'undo' })).ok, true);
  assert.equal(tasks.get(id).scheduledAt, '2030-01-03T09:00:00Z');
  assert.equal((await run({ action: 'undo' })).ok, true);
  assert.equal(tasks.get(id).scheduledAt, schedule.when);
  assert.equal((await run({ action: 'undo' })).ok, true);
  assert.equal(tasks.size, 0);
});

test('handoff uses newest finished production and its edited text, not newest idea', async () => {
  const handlers = new Map(); let message;
  const items = [{ id: 'idea', createdAt: 90 }, { id: 'right', createdAt: 10, body: 'raw', production: { status: 'done', finishedAt: 80, title: 'edited', article: 'final article' } }, { id: 'older', createdAt: 50, production: { status: 'done', finishedAt: 60 } }];
  const { mediaDeskFeature } = compiled('ipc', { '../../context': { defineFeature: x => x }, './embed': { setMediaDeskSecure() {}, mediaDeskRequest: async () => ({ state: { items } }) }, '../window-bus': { sendToWindow: (_name, value) => { message = value.text; } }, './vendor': {}, '../window-factory': {} });
  mediaDeskFeature.setup({ get: k => k === 'ipc' ? { handle: (key, fn) => handlers.set(key, fn) } : {}, effect() {} });
  const handoff = handlers.get('media-desk:handoff');
  assert.equal((await handoff(null, { kind: 'group' })).itemId, 'right');
  assert.match(message, /edited/); assert.match(message, /final article/); assert.doesNotMatch(message, /raw/);
  items.splice(1); items.push({ id: 'oldIdea', createdAt: 20 });
  assert.equal((await handoff(null, { kind: 'video' })).itemId, 'idea');
});
