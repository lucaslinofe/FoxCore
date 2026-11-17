const {db,authenticated}=require('./auth/mercadolivre/_shared');
const VALID=/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/;
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  if(req.method==='GET'){
   const rows=await db('fox_affiliate_links','GET',null,'?select=id,provider,affiliate_url,verification_status,product_id,product_url,product_title,link_type,destination_status,tracking_tool_id,featured_product_status,featured_product_checked_at,featured_product_confirmation_source,created_at&order=created_at.desc&limit=50');
   return res.json({links:rows});
  }
  if(req.method==='POST'&&req.body?.action==='confirm_featured'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   if(req.body?.confirmed!==true)return res.status(400).json({ok:false,reason:'confirmation_required'});
   const rows=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=product_url,product_title,link_type');
   if(rows.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   if(rows[0].link_type!=='affiliate_profile'||!rows[0].product_title||!rows[0].product_url)return res.status(409).json({ok:false,reason:'associate_product_first'});
   await db('fox_affiliate_links','PATCH',{featured_product_status:'manual_confirmed',featured_product_confirmed_at:new Date().toISOString(),featured_product_confirmation_source:'admin_browser_confirmation'},'?id=eq.'+id);
   return res.json({ok:true,featured_product_status:'manual_confirmed',commission_verified:false});
  }
  if(req.method==='OPTIONS')return res.status(405).end();
  if(req.method==='POST'&&req.body?.action==='check_featured'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   const rows=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=product_url,link_type,destination_url');
   if(rows.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   const item=rows[0];
   const expected=(item.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1];
   if(!expected)return res.status(409).json({ok:false,reason:'product_id_missing'});
   if(item.link_type!=='affiliate_profile'||!item.destination_url)return res.status(409).json({ok:false,reason:'profile_not_identified'});
   const url=new URL(item.destination_url);
   if(url.protocol!=='https:'||url.hostname!=='www.mercadolivre.com.br'||!/^\/social\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)||url.port||url.username||url.password)return res.status(400).json({ok:false,reason:'invalid_profile_destination'});
   let status='inconclusive',reason='product_not_visible_in_html',responseStatus=null;
   try{
    const response=await fetch(url.toString(),{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0'}});
    responseStatus=response.status;
    if([401,403,429].includes(response.status))reason='provider_blocked';
    else if(response.ok){
     const html=(await response.text()).slice(0,1500000);
     if(new RegExp('MLB-?'+expected+'(?!\\d)','i').test(html)){status='html_match';reason='product_id_found_in_html'}
    }else reason='provider_http_error';
   }catch(_){reason='profile_fetch_failed'}
   const previous=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=featured_product_status');
   if(previous[0]?.featured_product_status==='manual_confirmed')status='manual_confirmed';
   await db('fox_affiliate_links','PATCH',{featured_product_status:status,featured_product_checked_at:new Date().toISOString()},'?id=eq.'+id);
   return res.json({ok:true,featured_product_status:status,reason,http_status:responseStatus,commission_verified:false});
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
