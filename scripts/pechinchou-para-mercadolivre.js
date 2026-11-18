#!/usr/bin/env node
'use strict';
// FoxCore: diagnóstico manual e somente leitura. Requer Playwright instalado no executor.
// Não contorna CAPTCHA, não gera afiliados e não publica.

const SOURCE=new Set(['pechinchou.com.br','www.pechinchou.com.br']);
const SHORT=new Set(['meli.la','www.meli.la']);
const MARKET=new Set(['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br']);
const BLOCK=/captcha|verify you are human|verifique que voc[eê] [eé] humano|access denied|acesso negado/i;
function url(value,base){const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('invalid_url');return u}
function allowed(u,set){return set.has(u.hostname.toLowerCase())}
function code(u){const m=u.pathname.match(/MLB-?(\d{7,15})(?:\D|$)/i);return m?'MLB'+m[1]:null}
function product(u){return allowed(u,MARKET)&&!!code(u)}
function clean(u){const v=url(u.href);v.search='';v.hash='';return v.href}
async function checked(page,destination,hosts,stage){const u=url(destination);if(!allowed(u,hosts))throw Error('unauthorized_destination_'+stage);const r=await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:30000});const text=await page.locator('body').innerText({timeout:4000}).catch(()=>'');if(r?.status()===403||r?.status()===429||BLOCK.test(text))throw Error('access_blocked_'+stage);if(!allowed(url(page.url()),hosts))throw Error('unexpected_redirect_'+stage);return r}
async function extractProduct(input){
 const source=url(String(input).trim().replace(/[\u200B-\u200D\u2060\uFEFF]/g,''));source.pathname=decodeURIComponent(source.pathname).replace(/[\u200B-\u200D\u2060\uFEFF]/g,'');if(!allowed(source,SOURCE)||!source.pathname.startsWith('/oferta/'))throw Error('invalid_offer_url');
 const {chromium}=require('playwright');
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({locale:'pt-BR'});
  // Bloqueia navegação e requisições a destinos fora dos domínios aprovados.
  const hosts=new Set([...SOURCE,...SHORT,...MARKET]);
  await context.route('**/*',route=>{let u;try{u=url(route.request().url())}catch{return route.abort()};return allowed(u,hosts)?route.continue():route.abort()});
  const page=await context.newPage();await checked(page,source.href,SOURCE,'source');
  const title=(await page.locator('h1').first().innerText({timeout:3000}).catch(()=>'' )).trim();
  const links=await page.locator('script[type="application/ld+json"]').evaluateAll(nodes=>{
   const out=[];const walk=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x))return x.forEach(walk);if(x['@type']==='Offer'&&typeof x.url==='string')out.push(x.url);if(x.offers)walk(x.offers);if(x['@graph'])walk(x['@graph'])};
   for(const n of nodes){try{walk(JSON.parse(n.textContent||''))}catch{}}return out
  });
  const metadata=await page.locator('a[href]').evaluateAll(nodes=>nodes.filter(n=>/ir para (a )?(loja|oferta|produto)|ver (a )?oferta|comprar/i.test((n.innerText||'').trim())).map(n=>n.href));
  const candidates=[...new Set([...links,...metadata].map(x=>{try{const u=url(x,page.url());return (allowed(u,SHORT)||product(u))?u.href:null}catch{return null}}).filter(Boolean))].map(x=>url(x));
  if(candidates.length!==1)return {status:'ambiguous_or_missing_source',count:candidates.length,offer_url:source.href};
  const target=candidates[0];
  if(product(target))return {status:'product_identified',offer_url:source.href,offer_title:title,product_id:code(target),product_url:clean(target),evidence:'json_ld_offer_url'};
  if(!allowed(target,SHORT))return {status:'invalid_source_destination'};
  // O destino do link curto deve ser validado também durante cada salto.
  const shortPage=await context.newPage();
  const response=await shortPage.goto(target.href,{waitUntil:'domcontentloaded',timeout:30000});
  const body=await shortPage.locator('body').innerText({timeout:4000}).catch(()=>'');
  if(response?.status()===403||response?.status()===429||BLOCK.test(body))return {status:'access_blocked'};
  const landed=url(shortPage.url());if(!allowed(landed,MARKET))return {status:'unauthorized_destination'};
  if(product(landed))return {status:'product_identified',offer_url:source.href,offer_title:title,product_id:code(landed),product_url:clean(landed),evidence:'shortlink_direct'};
  const anchors=await shortPage.getByRole('link',{name:/^ir para produto$/i}).evaluateAll(nodes=>nodes.map(n=>n.href).filter(Boolean));
  const products=[...new Set(anchors.map(x=>{try{const u=url(x,landed.href);return product(u)?clean(u):null}catch{return null}}).filter(Boolean))];
  if(products.length!==1)return {status:products.length?'ambiguous_product':'product_not_identified',offer_url:source.href,cta_candidates:products.length};
  const identified=url(products[0]);return {status:'product_identified',offer_url:source.href,offer_title:title,product_id:code(identified),product_url:identified.href,evidence:'unique_explicit_cta'};
 }finally{await browser.close()}
}
if(require.main===module){extractProduct(process.argv[2]||'').then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(JSON.stringify({status:'error',reason:e.message}));process.exitCode=1})}
module.exports={extractProduct,url,allowed,code,product,clean};
