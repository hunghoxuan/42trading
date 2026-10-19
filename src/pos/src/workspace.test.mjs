import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, parseWorkspace, readWorkspace, writeWorkspace, workspaceKey } from './workspace.ts';

class MemoryStorage extends Map {
  getItem(key) { return this.get(key) ?? null; }
  setItem(key, value) { this.set(key, value); }
  removeItem(key) { this.delete(key); }
}

test('recovers a complete draft after a new storage read, including the checkout retry key', () => {
  const storage = new MemoryStorage();
  const key = workspaceKey('cashier-A', 'register-1');
  const state = { ...emptyWorkspace(), tab: 'inventory', query: '893NEW', cash: '50000',
    cart: [{ product_sid: 'soap', quantity: 2 }], checkoutKey: 'attempt-1', catalogPage: 3,
    detailOpen: true, selectedSid: 'soap', inventoryCategoryFilter: 'Body care' };
  Object.assign(state.form, { sid: 'soap', name: 'Unsaved name', image: 'data:image/png;base64,photo' });
  writeWorkspace(storage, key, state);
  assert.deepEqual(readWorkspace(storage, key), state);
  assert(!storage.getItem(key).includes('base64,photo'), 'large image stays out of frequently written JSON');
  assert.deepEqual(readWorkspace(storage, workspaceKey('cashier-B', 'register-1')), emptyWorkspace());
  assert.deepEqual(readWorkspace(storage, workspaceKey('cashier-A', 'register-2')), emptyWorkspace());
  writeWorkspace(storage, key, { ...state, cart: [], cash: '', checkoutKey: null });
  assert.deepEqual(readWorkspace(storage, key).cart, []);
  assert.equal(readWorkspace(storage, key).checkoutKey, null);
});

test('malformed, unsupported and invalid cart entries never become a live draft', () => {
  for (const raw of [null, '{broken', JSON.stringify({version:2,state:{cash:'900'}})]) {
    assert.deepEqual(parseWorkspace(raw), emptyWorkspace());
  }
  const restored = parseWorkspace(JSON.stringify({version:1,state:{tab:'invalid',catalogPage:-1,catalogPageSize:999,
    cart:[null,{product_sid:'ok',quantity:2},{product_sid:'bad',quantity:-1},{product_sid:123,quantity:1}],
    form:{name:123,sku:'KEEP'},checkoutKey:42}}));
  assert.equal(restored.tab, 'sale');
  assert.equal(restored.catalogPage, 1);
  assert.equal(restored.catalogPageSize, 25);
  assert.equal(restored.form.name, '');
  assert.equal(restored.form.sku, 'KEEP');
  assert.deepEqual(restored.cart, [{product_sid:'ok',quantity:2}]);
  assert.equal(restored.checkoutKey, null);
});

test('storage errors propagate so the UI can warn instead of claiming the draft was saved', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => writeWorkspace(storage, 'draft', emptyWorkspace()), /Quota exceeded/);
});
