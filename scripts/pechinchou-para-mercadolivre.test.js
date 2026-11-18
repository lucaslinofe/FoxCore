'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanProductUrl,isIndividualProductUrl,extractProduct}=require('./pechinchou-para-mercadolivre');
test('identifica anúncio MLB e remove rastreamento',()=>{
 const input='https://produto.mercadolivre.com.br/MLB-3203273995-capacete-_JM?matt_tool=123';
 assert.equal(isIndividualProductUrl(input),true);
 assert.equal(cleanProductUrl(input),'https://produto.mercadolivre.com.br/MLB-3203273995-capacete-_JM');
});
test('rejeita HTTP, credenciais e domínios semelhantes',()=>{
 assert.throws(()=>cleanProductUrl('http://produto.mercadolivre.com.br/MLB-3203273995'));
 assert.throws(()=>cleanProductUrl('https://user:pass@produto.mercadolivre.com.br/MLB-3203273995'));
 assert.equal(isIndividualProductUrl('https://produto.mercadolivre.com.br.evil.example/MLB-3203273995'),false);
});
test('não interpreta vitrine como anúncio individual',()=>{
 assert.equal(isIndividualProductUrl('https://www.mercadolivre.com.br/social/abcde'),false);
});
test('rejeita oferta de domínio não autorizado antes de abrir navegador',async()=>{
 await assert.rejects(extractProduct('https://evil.example/oferta/teste'),/Informe uma URL HTTPS/);
});
