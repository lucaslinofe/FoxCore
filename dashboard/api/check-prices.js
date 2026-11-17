const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 const cron=req.method==='GET'&&process.env.CRON_SECRET&&req.headers.authorization==='Bearer '+process.env.CRON_SECRET;
 if(!cron&&!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET'&&req.method!=='POST')return res.status(405).end();
 try{
  const links=await db('fox_affiliate_links','GET',null,'?select=product_url&provider=eq.mercado_livre&limit=100');
  const ids=[...new Set(links.map(x=>(x.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1]).filter(Boolean))].slice(0,30);
  const checks=[];
  for(const id of ids){
   let row={product_code:'MLB'+id,price:null,currency:null,available_quantity:null,listing_status:null,checked_at:new Date().toISOString(),http_status:null,check_status:'unavailable'};
   try{
    const response=await fetch('https://api.mercadolibre.com/items/MLB'+id,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});
    row.http_status=response.status;
    if(response.ok){
     const item=await response.json();
     if(item.id==='MLB'+id&&typeof item.price==='number'&&Number.isFinite(item.price)&&item.price>=0){
      row.price=item.price;row.currency=typeof item.currency_id==='string'?item.currency_id:null;row.available_quantity=Number.isInteger(item.available_quantity)?item.available_quantity:null;row.listing_status=typeof item.status==='string'?item.status:null;row.check_status='verified';
     }else row.check_status='invalid_provider_data';
    }else row.check_status='provider_http_error';
   }catch(_){row.check_status='network_error'}
   checks.push(row);
  }
  if(checks.length){await db('fox_product_price_checks','POST',checks,'?on_conflict=product_code');await db('fox_product_price_snapshots','POST',checks.map(({product_code,price,currency,available_quantity,listing_status,checked_at,check_status})=>({product_code,price,currency,available_quantity,listing_status,checked_at,check_status})));}
  return res.json({ok:true,checked:checks.length,verified:checks.filter(x=>x.check_status==='verified').length,failed:checks.filter(x=>x.check_status!=='verified').length,publishing:false});
 }catch(_){return res.status(502).json({ok:false,reason:'price_monitor_failed'})}
};