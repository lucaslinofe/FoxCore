const {db,authenticated}=require('./auth/mercadolivre/_shared');
const productCode=url=>{try{const u=new URL(url);if(u.protocol!=='https:'||!['produto.mercadolivre.com.br','www.mercadolivre.com.br','mercadolivre.com.br'].includes(u.hostname))return null;const m=(u.pathname+u.search).match(/MLB-?(\d{7,15})/i);return m?'MLB'+m[1]:null}catch{return null}};
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method==='GET'){
  try{const rows=await db('fox_discovered_products','GET',null,'?select=id,provider,product_code,source_url,product_url,title,status,discovered_at&order=discovered_at.desc&limit=100');return res.json({ok:true,products:rows,automatic_collection:false,automatic_affiliate_generation:false})}catch{return res.status(502).json({ok:false,reason:'database_unavailable'})}
 }
 if(req.method!=='POST')return res.status(405).end();
 const body=req.body||{};
 if(body.provider!=='pechinchou')return res.status(400).json({ok:false,reason:'invalid_source'});
 let source;
 try{source=new URL(String(body.source_url||''))}catch{return res.status(400).json({ok:false,reason:'invalid_source_url'})}
 if(source.protocol!=='https:'||!['pechinchou.com.br','www.pechinchou.com.br'].includes(source.hostname)||source.username||source.password||source.port)return res.status(400).json({ok:false,reason:'invalid_source_url'});
 const code=productCode(String(body.product_url||''));
 if(!code)return res.status(400).json({ok:false,reason:'mercado_livre_product_url_required'});
 const title=String(body.title||'').trim().slice(0,240)||null;
 try{const rows=await db('fox_discovered_products','POST',{provider:'pechinchou',product_code:code,source_url:source.origin+source.pathname,product_url:String(body.product_url),title,status:'awaiting_own_affiliate_link'},'?on_conflict=provider,product_code');return res.json({ok:true,product:rows[0],published:false,affiliate_link_generated:false})}catch{return res.status(502).json({ok:false,reason:'database_unavailable'})}
};