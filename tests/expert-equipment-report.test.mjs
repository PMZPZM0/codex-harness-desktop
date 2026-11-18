import test from 'node:test';
import assert from 'node:assert/strict';
import report from '../dist-electron/expert-equipment-report.js';
import prediction from '../dist-electron/content-prediction.js';
import path from 'node:path';
const { skillReport, toolReport, provideRuntimeInventory, readRuntimeInventory } = report;
const bundle = prediction.contentPredictionRow(path.resolve('resources/expert-skills'));
const inventory = (skills, errors = []) => ({data: [{skills, errors}]});

test('skill reports distinguish visibility, disabled intent, and incomplete discovery', () => {
  for (const value of [null, {}, {data: []}, inventory([], ['incomplete'])]) assert.equal(skillReport('demo', value).status, '未能检测');
  assert.match(skillReport('demo', inventory([])).instructions, /技能市场.*demo/);
  assert.equal(skillReport('demo', inventory([{name:'demo', enabled:false}])).status, '已停用');
  assert.equal(skillReport('demo', inventory([{name:'demo', enabled:true}])).status, '已启用');
});
test('bundled prediction is usable directly and repair uses its exact target', () => {
  assert.equal(bundle.installed, true);
  assert.equal(skillReport(bundle.id, null, bundle).status, '可读取随包技能');
  const missing = prediction.contentPredictionRow(path.resolve('resources/expert-skills/absent-fixture'));
  assert.equal(missing.installed, false);
  assert.ok(toolReport(missing.id, [missing]).instructions.includes(missing.installTarget));
  assert.equal(skillReport(missing.id, null, missing).status, '随包文件缺失');
});
test('runtime provider follows feature lifetime and avoids duplicate installation', () => {
  const dispose = provideRuntimeInventory(() => [bundle]);
  try { assert.equal(toolReport(bundle.id, readRuntimeInventory()).status, '已就绪'); }
  finally { dispose(); }
  assert.equal(toolReport(bundle.id, readRuntimeInventory()).status, '未能检测');
  assert.equal(toolReport('absent', []).status, '当前平台无检测项');
  const pending = {...bundle, installed:false, installing:true};
  assert.equal(toolReport(bundle.id, [pending]).instructions, undefined);
});
