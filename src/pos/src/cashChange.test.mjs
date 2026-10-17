import test from 'node:test';
import assert from 'node:assert/strict';
import { changeCombinations, changePage, VND_DENOMINATIONS } from './cashChange.ts';

test('enumerates both requested 123,000 VND examples exactly once', () => {
  const results = [...changeCombinations(123000, VND_DENOMINATIONS.filter(value => value >= 1000))];
  const key = notes => notes.map(note => `${note.quantity}x${note.denomination}`).join('+');
  const keys = results.map(key);
  assert(keys.includes('1x100000+1x20000+1x2000+1x1000'));
  assert(keys.includes('2x50000+2x10000+3x1000'));
  assert.equal(new Set(keys).size, keys.length);
  for (const notes of results) assert.equal(notes.reduce((sum, note) => sum + note.denomination * note.quantity, 0), 123000);
});

test('enumeration matches exhaustive count search with excluded denominations', () => {
  for (let amount = 0; amount <= 20000; amount += 100) {
    let expected = 0;
    for (let a = 0; a * 5000 <= amount; a++) for (let b = 0; a * 5000 + b * 2000 <= amount; b++) {
      if ((amount - a * 5000 - b * 2000) % 1000 === 0) expected++;
    }
    assert.equal([...changeCombinations(amount, [5000, 2000, 1000])].length, expected, String(amount));
  }
  assert.deepEqual([...changeCombinations(6000, [5000, 2000])], [[{ denomination: 2000, quantity: 3 }]]);
});

test('pages have no gaps or overlap; detects impossible and invalid amounts', () => {
  const all = [...changeCombinations(10000, [5000, 2000, 1000])];
  const paged = [];
  for (let page = 0; ; page++) {
    const result = changePage(10000, [5000, 2000, 1000], page, 3);
    paged.push(...result.items);
    if (!result.hasMore) break;
  }
  assert.deepEqual(paged, all);
  for (const amount of [-1, NaN, Infinity, 123.5]) assert.deepEqual([...changeCombinations(amount, VND_DENOMINATIONS)], []);
  assert.deepEqual([...changeCombinations(1234, VND_DENOMINATIONS)], []);
  assert.deepEqual([...changeCombinations(1000, [])], []);
  assert.deepEqual([...changeCombinations(1000, [1000, 1000, -1, 3])], [[{ denomination: 1000, quantity: 1 }]]);
  assert.equal(changePage(1000000000, VND_DENOMINATIONS, 0).items.length, 5);
});
