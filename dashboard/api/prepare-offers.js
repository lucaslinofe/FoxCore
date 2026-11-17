const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 const cron=req.method==='GET'&&process.env.CRON_SECRET&&req.headers.authorization==='Bearer '+process.env.CRON_SECRET;
 if(!cron&&!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET'&&req.method!=='POST')return res.status(405).end();
 try{
  const links=await db('fox_affiliate_links','GET',null,'?select=id,affiliate_url,product_title,product_url,featured_product_status&provider=eq.mercado_livre&order=created_at.desc&limit=200');
  const ready=[],blocked=[];
  for(const l of links){
   const product=(l.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1];
   if(!product||!l.product_title||!/^https:\/\/meli\.la\/[a-z0-9_-]{3,80}\/?$/i.test(l.affiliate_url)){blocked.push({id:l.id,reason:'missing_product_or_link'});continue}
   if(!['manual_confirmed','html_match'].includes(l.featured_product_status)){blocked.push({id:l.id,reason:'featured_product_unconfirmed'});continue}
   ready.push({affiliate_link_id:l.id,product_code:'MLB'+product,title:l.product_title,affiliate_url:l.affiliate_url,message:'🦊 Oferta FoxCore\n'+l.product_title+'\n\n🔗 '+l.affiliate_url+'\n\nConfira preço e disponibilidade no Mercado Livre.',status:'draft',updated_at:new Date().toISOString()});
  }
  if(ready.length)await db('fox_offer_drafts','POST',ready,'?on_conflict=affiliate_link_id');
  return res.json({ok:true,prepared:ready.length,blocked:blocked.length,publication_enabled:false,automatic_link_generation:false});
 }catch(_){return res.status(502).json({ok:false,reason:'draft_preparation_failed'})}
};