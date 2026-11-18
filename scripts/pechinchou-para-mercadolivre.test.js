'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {url,code,product,clean,extractProduct}=require('./pechinchou-para-mercadolivre');
test('extrai o código MLB de anúncio individual',()=>{
 const u=url('https://produto.mercadolivre.com.br/MLB-3203273995-capacete-_JM?matt_tool=123');
 assert.equal(code(u),'MLB3203273995');assert.equal(product(u),true);
 assert.equal(clean(u),'https://produto.mercadolivre.com.br/MLB-3203273995-capacete-_JM');
});
test('rejeita HTTP, credenciais e domínios semelhantes',()=>{
 assert.throws(()=>url('http://pechinchou.com.br/oferta/teste'));
 assert.throws(()=>url('https://usuario:senha@pechinchou.com.br/oferta/teste'));
 assert.equal(product(url('https://produto.mercadolivre.com.br.evil.example/MLB-3203273995')),false);
});
test('não interpreta página de vitrine como produto',()=>{
 assert.equal(product(url('https://www.mercadolivre.com.br/social/abcde')),false);
});
test('falha antes de abrir navegador com fonte inválida',async()=>{
 await assert.rejects(extractProduct('https://evil.example/oferta/teste'),/invalid_offer_url/);
});
