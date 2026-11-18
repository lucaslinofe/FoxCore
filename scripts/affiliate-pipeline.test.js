'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const p=require('./affiliate-pipeline');
test('pipeline requires evidence, review and verified attribution',()=>{
 let j=p.job('https://meli.la/abcde','offer-1');
 assert.throws(()=>p.acceptManus(j,{job_id:j.job_id,product_url:'https://produto.mercadolivre.com.br/MLB-3203273995-item'}),/evidence_required/);
 j=p.acceptManus(j,{job_id:j.job_id,product_url:'https://produto.mercadolivre.com.br/MLB-3203273995-item?tracking=1',evidence:'CTA Ir para produto da vitrine',product_title:'Produto'});
 assert.equal(j.product_id,'MLB3203273995');
 assert.equal(j.product_url,'https://produto.mercadolivre.com.br/MLB-3203273995-item');
 assert.equal(j.status,p.STATES.PENDING_REVIEW);
 assert.throws(()=>p.importAffiliate(j,'https://meli.la/abcde'),/invalid_state/);
 j=p.approveProduct(j);
 assert.equal(p.exportBatch([j]).length,1);
 j=p.importAffiliate(j,'https://meli.la/affiliate123');
 assert.equal(j.affiliate_verified,false);
 assert.throws(()=>p.verifyAttribution(j,false),/attribution_not_verified/);
 j=p.verifyAttribution(j,true);assert.equal(j.status,p.STATES.READY);
});
test('rejects forged domains and non-product pages',()=>{
 assert.throws(()=>p.job('https://meli.la.evil.test/abc','offer-2'),/untrusted_url/);
 assert.throws(()=>p.product('https://www.mercadolivre.com.br/social/vitrine'),/individual_product_required/);
 assert.throws(()=>p.product('http://produto.mercadolivre.com.br/MLB-3203273995'),/untrusted_url/);
});
