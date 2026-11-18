import assert from 'node:assert/strict';
import test from 'node:test';
import { expertEquipment, equipmentState } from '../src/lib/expert-equipment.ts';

test('team and individual declarations select the concrete tool IDs without duplicate installations', () => {
  const team = {tools:['bundled-tool', 'lark-cli'], skills:['review']};
  assert.deepEqual(expertEquipment(team, {tools:['git','markitdown'], skills:['review','convert']}), {tools:['python','node','git','feishu-cli','markitdown'], skills:['review','convert']});
  assert.ok(!expertEquipment(team, {}).tools.includes('markitdown'));
});
test('offer installation only for detected, supported, missing runtime entries', () => {
  const get = rows => equipmentState('git', rows).state;
  assert.equal(get(null), 'unknown'); assert.equal(get([]), 'unavailable');
  assert.equal(get([{id:'git',kind:'guide'}]), 'manual');
  assert.equal(get([{id:'git',installing:true}]), 'installing');
  assert.equal(get([{id:'git',installed:false}]), 'missing');
  assert.equal(get([{id:'git',installed:true}]), 'ready');
  assert.equal(equipmentState('engine', null).state, 'ready');
});
