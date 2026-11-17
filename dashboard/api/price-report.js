const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(req.method!=='GET')return res.status(405).end();
 try{
  const [current,history]=await Promise.all([
   db('fox_product_price_checks','GET',null,'?select=product_code,price,currency,available_quantity,listing_status,checked_at,check_status,http_status&order=product_code.asc&limit=100'),
   db('fox_product_price_snapshots','GET',null,'?select=product_code,price,currency,checked_at,check_status&order=checked_at.desc&limit=500')
  ]);
  const items=current.map(c=>{
   const older=history.find(h=>h.product_code===c.product_code&&h.check_status==='verified'&&h.price!==null&&h.checked_at<c.checked_at);
   const verified=c.check_status==='verified'&&c.price!==null;
   const change=verified&&older&&older.price>0?Math.round((c.price-older.price)/older.price*10000)/100:null;
   return {...c,previous_price:older?older.price:null,change_percent:change,price_verified:verified};
  });
  return res.json({ok:true,items,history_count:history.length,price_source:'mercado_livre_items_api',publication_enabled:false});
 }catch(_){return res.status(502).json({ok:false,reason:'price_report_unavailable'})}
};