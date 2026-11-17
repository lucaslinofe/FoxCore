const {db,authenticated}=require('./auth/mercadolivre/_shared');
const VALID=/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/;
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  if(req.method==='GET'){
   const rows=await db('fox_affiliate_links','GET',null,'?select=id,provider,affiliate_url,verification_status,product_id,product_url,product_title,created_at&order=created_at.desc&limit=50');
   return res.json({links:rows});
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
