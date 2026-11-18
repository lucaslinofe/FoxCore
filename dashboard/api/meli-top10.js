const {authenticated}=require('./auth/mercadolivre/_shared');
const CATEGORIES={eletronicos:'MLB1000',celulares:'MLB1055',casa:'MLB1574',informatica:'MLB1648'};
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false,reason:'unauthorized'});
 if(req.method!=='GET')return res.status(405).json({ok:false,reason:'method_not_allowed'});
 const category=String(req.query?.category||'celulares');
 if(!Object.hasOwn(CATEGORIES,category))return res.status(400).json({ok:false,reason:'invalid_category'});
 try{
  const r=await fetch('https://api.mercadolibre.com/highlights/MLB/category/'+CATEGORIES[category],{headers:{Accept:'application/json','User-Agent':'FoxCore-Top10-Diagnostic/1.0'},redirect:'manual',signal:AbortSignal.timeout(9000)});
  if(!r.ok)return res.json({ok:true,status:r.status===403?'access_forbidden':r.status===429?'rate_limited':'provider_unavailable',http_status:r.status,category,items:[],verified:false,affiliate_links_generated:0});
  const payload=await r.json();
  const raw=Array.isArray(payload.content)?payload.content:Array.isArray(payload.results)?payload.results:[];
  const ids=[...new Set(raw.map(x=>String(x.id||x.item_id||'')).filter(x=>/^MLB\\d{7,15}$/.test(x)))].slice(0,10);
  return res.json({ok:true,status:ids.length?'ranking_ids_available':'ranking_empty_or_unrecognized',category,items:ids.map((id,index)=>({rank:index+1,product_code:id})),verified:false,prices_verified:false,affiliate_links_generated:0,source:'Mercado Livre highlights API',note:'Ranking da categoria; preços e disponibilidade exigem validação adicional.'});
 }catch{return res.json({ok:true,status:'network_unavailable',category,items:[],verified:false,affiliate_links_generated:0});}
};