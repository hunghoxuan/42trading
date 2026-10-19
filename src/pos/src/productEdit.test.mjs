import test from 'node:test';
import assert from 'node:assert/strict';
import { productToForm, recognitionToForm, recognitionMetadata } from './productEdit.ts';

const product = {sid:'existing',name:'Catalog name',sku:'SKU-1',barcodes:['OLD'],category:'Body care',supplier:'Existing supplier',unit:'chai',status:'ACTIVE',price_minor:0,cost_minor:15000,min_stock:2,vat_rate_bps:500,image:'old-image',description:'Existing description',search_keywords:['existing'],label_texts:['old text']};
const observed = {product_name:'Detected name',object_name:'Bottle',brand:'Detected brand',barcode:'NEW',texts:['new text'],visible_price:{text:'60.000 VND',amount:60000,currency:'VND'}};

test('existing item keeps catalog identity, prices and attributes; merges barcode and captured image',()=>{
  const form = recognitionToForm(product,observed,'new-image',{category:'Filter',supplier:'Filter'},'GENERATED');
  assert.equal(form.name,'Catalog name');assert.equal(form.sku,'SKU-1');
  assert.equal(form.price,'0');assert.equal(form.cost,'15000');assert.equal(form.vat,'5');
  assert.equal(form.category,'Body care');assert.equal(form.supplier,'Existing supplier');
  assert.equal(form.barcodes,'OLD, NEW');assert.equal(form.image,'new-image');
  assert.equal(form.minStock,'2');assert.equal(form.sid,'existing');
  assert.deepEqual(productToForm(product),{...form,barcodes:'OLD',image:'old-image'});
});

test('new product gets observed fields and VND label price for review',()=>{
  const form = recognitionToForm(null,observed,'capture',{category:'Selected category',supplier:''},'GENERATED');
  assert.equal(form.sid,'');assert.equal(form.name,'Detected name');assert.equal(form.sku,'NEW');
  assert.equal(form.barcodes,'NEW');assert.equal(form.price,'60000');assert.equal(form.supplier,'Detected brand');
  assert.equal(form.category,'Selected category');assert.equal(form.image,'capture');
  assert.equal(recognitionToForm(null,null,'',{category:'',supplier:''},'GENERATED').sku,'GENERATED');
});

test('unusable or non-VND label amounts do not become retail prices',()=>{
  for(const visible_price of [{currency:'USD',amount:20},{currency:'VND',amount:-1},{currency:'VND',amount:1.5},{currency:'VND',amount:null}]){
    assert.equal(recognitionToForm(null,{...observed,visible_price},'',{category:'',supplier:''},'NEW').price,'');
  }
});

test('recognition metadata adds evidence and retains existing data without duplicate entries',()=>{
  const metadata=recognitionMetadata(product,observed,['existing','new keyword'],['blue']);
  assert.equal(metadata.description,'Existing description');
  assert.deepEqual(metadata.label_texts,['old text','new text']);
  assert.deepEqual(metadata.search_keywords,['existing','Detected name','Detected brand','new keyword','blue']);
});
