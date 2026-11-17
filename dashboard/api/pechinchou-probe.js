const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET')return res.status(405).end();
 const source='https://pechinchou.com.br/lojas/mercadolivre.com.br';
 try{
  const r=await fetch(source,{headers:{Accept:'text/html','User-Agent':'FoxCore-Source-Readiness/1.0'},redirect:'manual',signal:AbortSignal.timeout(8000)});
  const type=r.headers.get('content-type')||'';
  const html=r.ok&&type.includes('text/html')?(await r.text()).slice(0,250000):'';
  const direct=[...html.matchAll(/https?:\/\/(?:produto\.)?mercadolivre\.com\.br\/[^\s"'<>]+/gi)].map(x=>x[0].replace(/&amp;/g,'&'));
  const ids=[...new Set(direct.map(x=>x.match(/MLB-?(\d{7,15})/i)?.[1]).filter(Boolean))];
  return res.json({ok:true,source,http_status:r.status,html_accessible:r.ok&&type.includes('text/html'),direct_product_urls_found:direct.length,distinct_product_codes:ids.length,collection_enabled:false,items_imported:0,reason:ids.length?'source_review_required_before_automatic_import':'no_reliable_product_links_detected'});
 }catch(_){return res.json({ok:true,source,html_accessible:false,collection_enabled:false,items_imported:0,reason:'source_access_failed'})}
};