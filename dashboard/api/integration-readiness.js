const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET')return res.status(405).end();
 try{
  const [sources,links,drafts]=await Promise.all([
   db('fox_sources','GET',null,'?select=name,provider,enabled,authorized&provider=eq.pechinchou&limit=1'),
   db('fox_affiliate_links','GET',null,'?select=id,product_url,featured_product_status&provider=eq.mercado_livre&limit=200'),
   db('fox_offer_drafts','GET',null,'?select=affiliate_link_id&limit=200')
  ]);
  const source=sources[0]||null;
  return res.json({ok:true,pechinchou:{registered:!!source,enabled:source?.enabled===true,authorized:source?.authorized===true,automatic_collection_active:false},mercado_livre:{oauth_is_link_generation:false,official_linkbuilder:'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub',automatic_link_generation_verified:false,registered_links:links.length},offers:{drafts:drafts.length},next_step:'Confirmar método autorizado de coleta e geração de links antes de habilitar automação.'});
 }catch(_){return res.status(502).json({ok:false,reason:'integration_status_unavailable'})}
};