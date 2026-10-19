import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSearch, recognitionSearchTerms, searchProducts } from './productSearch.ts';

const product = (sid, name) => ({sid, name, sku: sid, barcodes: [], category: '', supplier: ''});

test('recognition searches the brand alone, excluding label noise and generic product types', () => {
  const terms = recognitionSearchTerms({brand:'  Lifebuoy  ', product_name:'Lifebuoy Hand Sanitizer', texts:['NEW', '99.9%', 'Hand Sanitizer', 'red bottle']});
  assert.deepEqual(terms, ['Lifebuoy']);
  assert.deepEqual(searchProducts([product('LIFE', 'Nước rửa tay Lifebuoy'), product('OTHER', 'Other Hand Sanitizer')], terms.join(' ')).map(item => item.sid), ['LIFE']);
});

test('without a brand, only a few distinctive name words remain, never generic OCR noise', () => {
  assert.deepEqual(recognitionSearchTerms({brand:'', product_name:'Hand Sanitizer 350ml NEW 99.9% red bottle'}), []);
  assert.deepEqual(recognitionSearchTerms({brand:'unknown', product_name:'Nước rửa tay Lifebuoy bảo vệ chai mới 350ml'}), ['lifebuoy']);
  assert.equal(recognitionSearchTerms({brand:'', product_name:'Alpha Beta Gamma Delta Shampoo'}).length, 3);
});

test('English and Vietnamese product types search in both directions', () => {
  for (const [english, vietnamese] of [['Hand Sanitizer', 'Nước sát khuẩn tay'], ['Handwash', 'Nước rửa tay'], ['Body wash', 'Sữa tắm'], ['Shampoo', 'Dầu gội'], ['Toothpaste', 'Kem đánh răng']]) {
    assert.equal(canonicalSearch(english), canonicalSearch(vietnamese));
    assert.equal(searchProducts([product('VI', vietnamese)], english)[0]?.sid, 'VI');
    assert.equal(searchProducts([product('EN', english)], vietnamese)[0]?.sid, 'EN');
  }
});

test('exact codes and existing accent-insensitive OR search remain available', () => {
  const products = [product('HANDWASH', 'Xà phòng'), product('OTHER', 'Cà phê')];
  assert.equal(searchProducts(products, 'HANDWASH')[0].sid, 'HANDWASH');
  assert.equal(searchProducts(products, 'CA PHE')[0].sid, 'OTHER');
  assert.equal(searchProducts(products, 'missing OR cà')[0].sid, 'OTHER');
  assert.deepEqual(searchProducts(products, 'unavailable'), []);
});
