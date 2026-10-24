import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDuckingSettings, NEW_PROJECT_SETTINGS } from '../shared/ducking-settings.js';

test('existing mixes migrate to adaptive while retaining musical choices',()=>{
  const old={reductionDb:9,baseMusicDb:-17,musicStartSeconds:2,musicEndSeconds:5,holdMs:350};
  const result=migrateDuckingSettings(old);
  assert.equal(result.duckingMode,'adaptive');
  for(const key of Object.keys(old))assert.equal(result[key],old[key]);
  assert.equal(result.adaptiveTargetGapDb,10);
  assert.equal(result.adaptiveMaxReductionDb,18);
  assert.equal(migrateDuckingSettings({...old,duckingMode:'fixed'}).duckingMode,'fixed');
  assert.equal(NEW_PROJECT_SETTINGS.duckingMode,'adaptive');
});
