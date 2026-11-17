const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET')return res.status(405).end();
 try{
  const links=await db('fox_affiliate_links','GET',null,'?select=id,affiliate_url,product_title,product_url,link_type,featured_product_status,created_at&provider=eq.mercado_livre&order=created_at.desc&limit=100');
  const offers=[],blocked=[];
  for(const l of links){
   const id=(l.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1];
   if(!id||!l.product_title||!/^https:\/\/meli\.la\/[a-z0-9_-]{3,80}\/?$/i.test(l.affiliate_url)){blocked.push({id:l.id,reason:'product_or_affiliate_link_missing'});continue}
   if(!['manual_confirmed','html_match'].includes(l.featured_product_status)){blocked.push({id:l.id,reason:'featured_product_unconfirmed'});continue}
   offers.push({id:l.id,product_id:'MLB'+id,product_title:l.product_title,affiliate_url:l.affiliate_url,message:'🦊 Oferta FoxCore\n'+l.product_title+'\n\n🔗 '+l.affiliate_url+'\n\nConfira preço e disponibilidade no Mercado Livre.',price_verified:false,commission_verified:false,publication_status:'draft_only'});
  }
  return res.json({ok:true,offers,blocked,automatic_affiliate_generation:false,automatic_publishing:false});
 }catch(_){return res.status(502).json({ok:false,reason:'database_unavailable'})}
};