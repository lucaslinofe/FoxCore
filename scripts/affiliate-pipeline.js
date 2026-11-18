'use strict';
// FoxCore: pipeline preparation only. No external calls or automatic publication.
const crypto=require('node:crypto');
const ML_HOSTS=new Set(['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br']);
const VITRINE_HOSTS=new Set([...ML_HOSTS,'meli.la','www.meli.la']);
const ID=/MLB-?(\d{7,15})/i;
const STATES=Object.freeze({PENDING_MANUS:'pending_manus',PENDING_REVIEW:'pending_review',PENDING_CONVERSION:'pending_conversion',PENDING_ATTRIBUTION:'pending_attribution_verification',READY:'ready_for_approval',REJECTED:'rejected'});
function parse(raw,hosts){
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname.toLowerCase()))throw Error('untrusted_url');
 return u;
}
function product(raw){
 const u=parse(raw,ML_HOSTS);
 const id=u.pathname.match(ID);
 if(!id)throw Error('individual_product_required');
 return {id:'MLB'+id[1],url:u.origin+u.pathname};
}
function storefront(raw){return parse(raw,VITRINE_HOSTS).href;}
function job(vitrine,offerId){
 if(!offerId||typeof offerId!=='string')throw Error('offer_id_required');
 const url=storefront(vitrine);
 return {job_id:crypto.randomUUID(),offer_id:offerId,storefront_url:url,status:STATES.PENDING_MANUS,created_at:new Date().toISOString()};
}
function acceptManus(j,response){
 if(j.status!==STATES.PENDING_MANUS)throw Error('invalid_state');
 if(!response||response.job_id!==j.job_id)throw Error('job_mismatch');
 if(!response.evidence||typeof response.evidence!=='string'||response.evidence.trim().length<10)throw Error('evidence_required');
 const p=product(response.product_url);
 return {...j,status:STATES.PENDING_REVIEW,product_id:p.id,product_url:p.url,product_title:String(response.product_title||'').slice(0,250),evidence:response.evidence.slice(0,2000)};
}
function approveProduct(j){
 if(j.status!==STATES.PENDING_REVIEW)throw Error('invalid_state');
 return {...j,status:STATES.PENDING_CONVERSION};
}
function importAffiliate(j,affiliateUrl){
 if(j.status!==STATES.PENDING_CONVERSION)throw Error('invalid_state');
 // Affiliate URLs may be shortlinks. Do not infer ownership from URL shape.
 const u=new URL(affiliateUrl);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!VITRINE_HOSTS.has(u.hostname.toLowerCase()))throw Error('untrusted_affiliate_url');
 return {...j,status:STATES.PENDING_ATTRIBUTION,affiliate_url:u.href,affiliate_verified:false};
}
function verifyAttribution(j,verified){
 if(j.status!==STATES.PENDING_ATTRIBUTION||verified!==true)throw Error('attribution_not_verified');
 return {...j,status:STATES.READY,affiliate_verified:true};
}
function exportBatch(jobs){
 const pending=jobs.filter(j=>j.status===STATES.PENDING_CONVERSION);
 const ids=new Set();
 return pending.filter(j=>{if(ids.has(j.product_id))return false;ids.add(j.product_id);return true}).map(j=>({job_id:j.job_id,product_id:j.product_id,url:j.product_url}));
}
module.exports={STATES,job,product,storefront,acceptManus,approveProduct,importAffiliate,verifyAttribution,exportBatch};
