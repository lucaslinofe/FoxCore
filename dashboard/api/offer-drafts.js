const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET')return res.status(405).end();
 try{
  const [drafts,links]=await Promise.all([
   db('fox_offer_drafts','GET',null,'?select=affiliate_link_id,product_code,title,affiliate_url,message,status,updated_at&order=updated_at.desc&limit=100'),
   db('fox_affiliate_links','GET',null,'?select=id,product_title,product_url,affiliate_url,featured_product_status&provider=eq.mercado_livre&order=created_at.desc&limit=200')
  ]);
  const ready=new Set(drafts.map(x=>x.affiliate_link_id));
  const blocked=links.filter(x=>!ready.has(x.id)).map(x=>({id:x.id,title:x.product_title||'Produto não associado',reason:!x.product_url||!x.product_title?'product_missing':!['manual_confirmed','html_match'].includes(x.featured_product_status)?'featured_product_unconfirmed':'awaiting_preparation'}));
  return res.json({ok:true,offers:drafts.map(x=>({id:x.affiliate_link_id,product_id:x.product_code,product_title:x.title,affiliate_url:x.affiliate_url,message:x.message,updated_at:x.updated_at,publication_status:x.status,price_verified:false,commission_verified:false})),blocked,automatic_affiliate_generation:false,automatic_publishing:false});
 }catch(_){return res.status(502).json({ok:false,reason:'database_unavailable'})}
};