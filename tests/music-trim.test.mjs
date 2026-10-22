import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMusicTrim, musicOffsetAt } from '../shared/music.js';
test('old projects default to the full song',()=>{
 assert.deepEqual(resolveMusicTrim({},30),{start:0,end:30,length:30});
});
test('trim bounds stay within source and cannot collapse',()=>{
 assert.deepEqual(resolveMusicTrim({musicStartSeconds:5,musicEndSeconds:8},10),{start:5,end:8,length:3});
 const range=resolveMusicTrim({musicStartSeconds:30,musicEndSeconds:2},10);
 assert.ok(range.start>=0 && range.end<=10 && range.length>=.049);
});
test('seeking loops inside the selected section at original speed',()=>{
 const trim=resolveMusicTrim({musicStartSeconds:5,musicEndSeconds:8},10);
 assert.equal(musicOffsetAt(0,trim),5);
 assert.equal(musicOffsetAt(2,trim),7);
 assert.equal(musicOffsetAt(3,trim),5);
 assert.equal(musicOffsetAt(7,trim),6);
});
