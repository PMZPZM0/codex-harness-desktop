import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTION_MENU_DEFAULT_ORDER, FUNCTION_MENU_ORDER_VERSION, restoreFunctionMenu, visibleFunctionMenuItems } from '../src/features/function-menu/menu-model.mjs';

const core = ['schedule', 'frontend', 'team', 'devtools', 'favorites', 'identity', 'login', 'newbie'];
test('restore both shipped default orders including profiles from before the tool list', () => {
  for (const order of [['media', 'extensions', ...core], [...core, 'media', 'extensions'], core]) {
    assert.deepEqual(restoreFunctionMenu({order}).order, FUNCTION_MENU_DEFAULT_ORDER);
  }
});
test('existing custom menu promotes the visible list once and keeps groups', () => {
  const custom = {location: 'bottom', order: ['ext_writing', 'frontend', 'tool-list', 'devtools'], overflow: ['devtools']};
  const migrated = restoreFunctionMenu(custom);
  assert.deepEqual(visibleFunctionMenuItems(migrated).slice(0, 3), ['tool-list', 'ext_writing', 'frontend']);
  assert.deepEqual(migrated.overflow, custom.overflow);
  assert.equal(migrated.location, 'bottom');
  assert.equal(restoreFunctionMenu({...custom, orderVersion: FUNCTION_MENU_ORDER_VERSION}).order[0], 'ext_writing');
  assert.ok(!visibleFunctionMenuItems(restoreFunctionMenu({...custom, overflow:['tool-list']})).includes('tool-list'));
});
