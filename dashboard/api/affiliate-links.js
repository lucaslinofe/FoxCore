const {db,authenticated}=require('./auth/mercadolivre/_shared');
const VALID=/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/;
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  if(req.method==='GET'){
   const rows=await db('fox_affiliate_links','GET',null,'?select=id,provider,affiliate_url,verification_status,product_id,product_url,product_title,link_type,destination_status,tracking_tool_id,created_at&order=created_at.desc&limit=50');
   return res.json({links:rows});
  }
  if(req.method==='PUT'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   const found=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=affiliate_url,product_url');
   if(found.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   const link=found[0];
   let current=link.affiliate_url,reason='redirect_not_confirmed',httpStatus=null,matched=false,linkType='unknown',profilePath=null,trackingToolId=null;
   const allowed=new Set(['meli.la','mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','lista.mercadolivre.com.br']);
   const expected=(link.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1]||null;
   try{
    for(let i=0;i<7;i++){
     const u=new URL(current);
     if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed.has(u.hostname.toLowerCase())){reason='unsupported_redirect_domain';break}
     if(u.pathname.startsWith('/social/')){
      linkType='affiliate_profile';profilePath=u.origin+u.pathname;
      trackingToolId=u.searchParams.get('matt_tool')||u.searchParams.get('matt_tool_id');
      reason='affiliate_profile_detected';break;
     }
     const productMatch=u.pathname.match(/MLB-?(\d{7,15})/i);
     if(productMatch){
      linkType='direct_product';
      matched=expected?productMatch[1]===expected:false;
      reason=expected?(matched?'destination_matches_product':'different_product'):'product_id_missing';
      break;
     }
     const response=await fetch(u.toString(),{method:'GET',redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0 (compatible; FoxCoreLinkCheck/1.0)'}});
     httpStatus=response.status;
     if([401,403,429].includes(response.status)){reason='provider_blocked';break}
     if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location){reason='redirect_without_location';break}
      current=new URL(location,current).toString();
      continue;
     }
     reason=response.ok?'destination_unconfirmed':'provider_http_error';
     break;
    }
   }catch(_){reason='redirect_check_failed'}
   if(linkType==='affiliate_profile'){
    await db('fox_affiliate_links','PATCH',{link_type:'affiliate_profile',destination_url:profilePath,tracking_tool_id:trackingToolId,destination_status:'profile_detected'},'?id=eq.'+id);
   }
   return res.json({ok:true,destination_matches:matched,reason,http_status:httpStatus,link_type:linkType,profile_detected:linkType==='affiliate_profile',featured_product_verified:false,commission_verified:false,verification_status:'pending'});
  }
  if(req.method==='PATCH'){
   const id=String(req.body?.id||'');
   const product_url=String(req.body?.product_url||'').trim();
   const product_title=String(req.body?.product_title||'').trim();
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   let parsed;try{parsed=new URL(product_url)}catch(_){return res.status(400).json({ok:false,reason:'invalid_product_url'})}
   const host=parsed.hostname.toLowerCase();
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br'].includes(host)||product_url.length>2048||product_title.length<3||product_title.length>250)return res.status(400).json({ok:false,reason:'invalid_product_details'});
   const rows=await db('fox_affiliate_links','PATCH',{product_url,product_title,linked_at:new Date().toISOString(),verification_status:'pending'},'?id=eq.'+id+'&provider=eq.mercado_livre');
   if(!rows.length)return res.status(404).json({ok:false,reason:'link_not_found'});
   return res.json({ok:true,verification_status:'pending'});
  }
  if(req.method==='POST'){
   const url=String(req.body?.affiliate_url||'').trim();
   if(!VALID.test(url))return res.status(400).json({ok:false,reason:'invalid_affiliate_url'});
   const rows=await db('fox_affiliate_links','POST',{provider:'mercado_livre',affiliate_url:url,source:'manual_affiliate_hub',verification_status:'pending'},'?on_conflict=affiliate_url');
   return res.status(201).json({ok:true,link:rows[0]});
  }
  return res.status(405).end();
 }catch(_){return res.status(502).json({ok:false,reason:'database_unavailable'});}
};
