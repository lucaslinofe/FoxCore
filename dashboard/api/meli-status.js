const {ready,db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(!ready())return res.status(503).json({ok:false,reason:'not_configured'});
 try{
  const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=provider,expires_at,updated_at');
  if(!rows.length)return res.json({connected:false});
  return res.json({connected:true,expires_at:rows[0].expires_at,updated_at:rows[0].updated_at,expired:new Date(rows[0].expires_at).getTime()<=Date.now()});
 }catch(_){return res.status(502).json({ok:false,reason:'status_unavailable'});}
};
