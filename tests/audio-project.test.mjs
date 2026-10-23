import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../server/storage.mjs?audio-unit';

test('project summaries derive kind for older video and audio projects', () => {
  assert.equal(storage.projectSummary({ source: { video: {} } }).kind, 'video');
  assert.equal(storage.projectSummary({ source: { video: null } }).kind, 'audio');
});
test('absent video media produces no URL', () => {
  assert.equal(storage.mediaUrl('project123', null), null);
});
test('creation validates every upload id before resolving paths', () => {
  assert.equal(typeof storage.validateProjectUploads, 'function');
  assert.deepEqual(storage.validateProjectUploads({musicUploadId:'music1234',voiceUploadId:'voice1234'}), {videoUploadId:null,musicUploadId:'music1234',voiceUploadId:'voice1234'});
  assert.throws(() => storage.validateProjectUploads({musicUploadId:'music1234'}), /voice/i);
  assert.throws(() => storage.validateProjectUploads({videoUploadId:'video1234',musicUploadId:'music1234',voiceUploadId:'../../private'}), /upload/i);
});
