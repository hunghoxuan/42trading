import test from 'node:test';
import assert from 'node:assert/strict';
import { StablePhotoTrigger } from './cameraCapture.ts';

function frame(offset = 0) {
  return Uint8ClampedArray.from(Array.from({length:16},(_,i)=>i%4===3?255:40+Math.floor(i/4)*45+offset));
}

test('a clear stationary product captures after about one second', () => {
  const trigger = new StablePhotoTrigger(0);
  for (const now of [0,200,400,600,800]) assert.equal(trigger.update(frame(),now).capture,false);
  assert.equal(trigger.update(frame(),1000).capture,true);
});

test('motion resets the hold and poor lighting prevents auto capture', () => {
  const trigger = new StablePhotoTrigger(0);
  for (const now of [0,200,400,600,800]) trigger.update(frame(),now);
  assert.equal(trigger.update(frame(20),1000).capture,false);
  for (const now of [1200,1400,1600]) assert.equal(trigger.update(frame(20),now).capture,false);
  assert.equal(trigger.update(frame(20),1800).capture,true);
  const dark = new StablePhotoTrigger(0);
  for (const now of [0,1000,2000,5000]) assert.equal(dark.update(new Uint8ClampedArray(16),now).capture,false);
  trigger.reset(2000);
  assert.equal(trigger.update(frame(),2000).capture,false);
  assert.equal(trigger.update(frame(),2400).capture,false);
});

test('cash can retain the longer settling time', () => {
  const trigger = new StablePhotoTrigger(0,1400,1100);
  for(const now of [0,400,800,1200,1600,2000,2400]) assert.equal(trigger.update(frame(),now).capture,false);
  assert.equal(trigger.update(frame(),2600).capture,true);
});
