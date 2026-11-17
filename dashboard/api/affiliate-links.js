const {db,authenticated}=require('./auth/mercadolivre/_shared');
const VALID=/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/;
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  const action=String(req.query?.action||req.body?.action||'');
  if(action==='discovered_products'){
   if(req.method==='GET'){const products=await db('fox_discovered_products','GET',null,'?select=id,provider,product_code,source_url,product_url,title,status,discovered_at&order=discovered_at.desc&limit=100');return res.json({ok:true,products,automatic_collection:false,automatic_affiliate_generation:false})}
   if(req.method==='POST'){
    const b=req.body||{};if(b.provider!=='pechinchou')return res.status(400).json({ok:false,reason:'invalid_source'});
    let src,product;try{src=new URL(String(b.source_url||''));product=new URL(String(b.product_url||''))}catch{return res.status(400).json({ok:false,reason:'invalid_url'})}
    if(src.protocol!=='https:'||!['pechinchou.com.br','www.pechinchou.com.br'].includes(src.hostname)||src.port||src.username||src.password)return res.status(400).json({ok:false,reason:'invalid_source'});
    if(product.protocol!=='https:'||!['produto.mercadolivre.com.br','www.mercadolivre.com.br','mercadolivre.com.br'].includes(product.hostname)||product.port||product.username||product.password)return res.status(400).json({ok:false,reason:'invalid_product'});
    const id=product.pathname.match(/MLB-?(\d{7,15})/i)?.[1];if(!id)return res.status(400).json({ok:false,reason:'product_id_missing'});
    const products=await db('fox_discovered_products','POST',{provider:'pechinchou',product_code:'MLB'+id,source_url:src.origin+src.pathname,product_url:product.origin+product.pathname,title:String(b.title||'').slice(0,240)||null,status:'awaiting_own_affiliate_link'},'?on_conflict=provider,product_code');
    return res.json({ok:true,product:products[0],published:false,affiliate_link_generated:false})
   }
   return res.status(405).end();
  }
  if(action==='integration_readiness'&&req.method==='GET'){
   const [sources,links,drafts]=await Promise.all([db('fox_sources','GET',null,'?select=name,provider,enabled,authorized&provider=eq.pechinchou&limit=1'),db('fox_affiliate_links','GET',null,'?select=id&limit=200'),db('fox_offer_drafts','GET',null,'?select=affiliate_link_id&limit=200')]);const source=sources[0]||null;
   return res.json({ok:true,pechinchou:{registered:!!source,enabled:source?.enabled===true,authorized:source?.authorized===true,automatic_collection_active:false},mercado_livre:{automatic_link_generation_verified:false,registered_links:links.length},offers:{drafts:drafts.length}});
  }
  if(action==='pechinchou_probe'&&req.method==='GET'){
   const source='https://pechinchou.com.br/lojas/mercadolivre.com.br';
   try{
    const response=await fetch(source,{headers:{Accept:'text/html','User-Agent':'FoxCore-Source-Readiness/1.1'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    const type=response.headers.get('content-type')||'';
    const accessible=response.ok&&type.includes('text/html');
    const html=accessible?(await response.text()).slice(0,400000):'';
    const codes=[...new Set([...html.matchAll(/MLB-?(\d{7,15})/gi)].map(m=>m[1]))];
    const productEvidence=codes.slice(0,15).map(code=>{
     const pattern=new RegExp('MLB-?'+code+'(?![0-9])','gi');
     const occurrences=[...html.matchAll(pattern)].slice(0,12);
     const locations=occurrences.map(m=>{const i=m.index||0;const before=html.slice(Math.max(0,i-250),i);const after=html.slice(i+ m[0].length,Math.min(html.length,i+250));const inScript=before.lastIndexOf('<script')>before.lastIndexOf('</script');const inAnchor=before.lastIndexOf('<a ')>before.lastIndexOf('</a>');const inLink=/mercadolivre\.com\.br|meli\.la/i.test(before+after);return {context:inScript?'script':inAnchor?'anchor':'html',near_marketplace_url:inLink}});
     return {code:'MLB'+code,occurrences:occurrences.length,contexts:[...new Set(locations.map(x=>x.context))],near_marketplace_url:locations.some(x=>x.near_marketplace_url),confirmed_offer:false};
    });
    const anchors=[...html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/g,'&'));
    const mlLinks=anchors.filter(h=>/mercadolivre\.com\.br|mercadolibre\.com|meli\.la/i.test(h));
    const redirectLinks=anchors.filter(h=>/\/(?:go|out|redirect|oferta|produto|promocao|link)\b|[?&](?:url|redirect|target|to)=/i.test(h));
    const scripts=[...html.matchAll(/<script\b[^>]*?src\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
    const scriptSources=scripts.slice(0,20).map(raw=>{try{const u=new URL(raw,source);return {host:u.hostname,path:u.pathname.slice(0,120)}}catch{return {host:'invalid',path:''}}});
    const framework={nextjs:html.includes('__NEXT_DATA__')||scripts.some(x=>x.includes('/_next/')),nuxt:html.includes('__NUXT__')||scripts.some(x=>x.includes('/_nuxt/')),react:html.includes('react-dom')||html.includes('data-reactroot'),json_ld:html.includes('application/ld+json')};
    const inlineScriptCount=(html.match(/<script\b(?![^>]*\bsrc\s*=)/gi)||[]).length;
    const dataSignals={graphql:html.includes('graphql'),api_routes:html.includes('/api/'),hydration:html.includes('__NEXT_DATA__')||html.includes('__NUXT__'),product_schema:html.includes('schema.org/Product')};
    const structured={next_data_present:false,next_data_parseable:false,next_data_page:null,json_ld_parseable:0,candidates:[],candidate_count:0,eligible_for_import:0,blocked_reason:'source_not_authorized'};
    const candidates=new Map();
    const normalizeUrl=(raw)=>{if(typeof raw!=='string')return null;try{const u=new URL(raw,source);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;if(!['pechinchou.com.br','www.pechinchou.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','mercadolivre.com.br'].includes(u.hostname))return null;return u.origin+u.pathname.slice(0,240)}catch{return null}};
    const walk=(value,origin,depth=0)=>{
     if(depth>14||!value||typeof value!=='object')return;
     if(Array.isArray(value)){for(const item of value.slice(0,150))walk(item,origin,depth+1);return}
     const type=String(value['@type']||'');
     const title=typeof value.name==='string'?value.name:typeof value.title==='string'?value.title:null;
     const urlFields=['url','productUrl','product_url','link','permalink','href','externalUrl','destinationUrl','affiliateUrl'];const rawUrl=urlFields.map(k=>value[k]).find(v=>typeof v==='string')||value.offers?.url||null;
     const destination=normalizeUrl(rawUrl);
     const offers=Array.isArray(value.offers)?value.offers[0]:value.offers;const rawPrice=value.price??value.salePrice??offers?.price??offers?.lowPrice??null;
     const price=typeof rawPrice==='number'||typeof rawPrice==='string'?String(rawPrice).slice(0,30):null;
     const rawCode=value.productId??value.itemId??value.mlb??value.sku??null;const code=destination?.match(/MLB-?(\d{7,15})/i)?.[1]||String(rawCode||'').match(/^MLB-?(\d{7,15})$/i)?.[1]||null;
     const keys=Object.keys(value);const categoryLike=type==='CollectionPage'||type==='ItemList'||type==='BreadcrumbList'||type==='Category'||keys.some(k=>/^(?:children|subcategories|categoryChildren|departments)$/i.test(k))&&!keys.some(k=>/^(?:price|salePrice|originalPrice|sku|productId|itemId)$/i.test(k));const productHints=keys.some(k=>/^(?:product|productId|itemId|sku|originalPrice|discount|salePrice|image|images|thumbnail|merchant|seller|offers|price|category)$/i.test(k));const generic=/^(?:mercado livre|pechinchou|ofertas|promoções|loja)$/i.test((title||'').trim());const isProduct=!generic&&!categoryLike&&(type==='Product'||(title&&title.length>12&&(price!==null||!!code||!!destination||productHints&&keys.some(k=>/^(?:sku|productId|itemId|image|images|thumbnail|seller|merchant)$/i.test(k)))));
     if(isProduct&&title&&title.length>8&&candidates.size<80){
      const key=(code?'MLB'+code:destination||title.toLowerCase()).slice(0,260);
      if(!candidates.has(key))candidates.set(key,{title:title.slice(0,150),destination,price,product_code:code?'MLB'+code:null,origin,validation:code&&destination?'product_url_identified':destination?'needs_product_identity':code?'needs_destination_verification':'discovered_unverified',affiliate_link_generated:false,verified_offer:false});else {const existing=candidates.get(key);if(!existing.destination&&destination)existing.destination=destination;if(!existing.price&&price)existing.price=price;if(!existing.product_code&&code)existing.product_code='MLB'+code;}
     }
     for(const key of Object.keys(value).slice(0,100))walk(value[key],origin,depth+1);
    };
    const nextMatch=html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if(nextMatch){structured.next_data_present=true;try{const data=JSON.parse(nextMatch[1]);structured.next_data_parseable=true;structured.next_data_page=typeof data.page==='string'?data.page.slice(0,100):null;walk(data.props,'next_data')}catch{}}
    const ldBlocks=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0,12);
    for(const block of ldBlocks){try{const obj=JSON.parse(block[1]);structured.json_ld_parseable++;walk(obj,'json_ld')}catch{}}
    structured.candidate_count=candidates.size;
    structured.discovery_count=candidates.size;
    structured.enriched_count=[...candidates.values()].filter(p=>p.destination||p.price||p.product_code).length;
    structured.validated_count=0;
    structured.missing_destination_count=[...candidates.values()].filter(p=>!p.destination).length;
    structured.category_filter_applied=true;
    structured.candidates=[...candidates.values()].slice(0,15);
    structured.product_samples=structured.candidates.slice(0,8);
    const jsonLd=(html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/gi)||[]).length;
    return res.json({ok:true,source,http_status:response.status,html_accessible:accessible,html_bytes:html.length,anchor_count:anchors.length,mercado_livre_link_count:mlLinks.length,redirect_link_count:redirectLinks.length,script_count:scripts.length,script_sources:scriptSources,inline_script_count:inlineScriptCount,framework,data_signals:dataSignals,json_ld_blocks:jsonLd,structured_data:structured,distinct_product_codes:codes.length,product_codes:codes.slice(0,15).map(code=>'MLB'+code),product_evidence:productEvidence,collection_enabled:false,items_imported:0,diagnosis:codes.length?'direct_product_codes_found':mlLinks.length?'mercado_livre_links_without_product_codes':redirectLinks.length?'intermediate_links_require_review':scripts.length?'javascript_or_indirect_links_possible':'no_product_signals_in_static_html'});
   }catch(_){return res.json({ok:true,source,html_accessible:false,collection_enabled:false,items_imported:0,reason:'source_access_failed'})}
  }
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
