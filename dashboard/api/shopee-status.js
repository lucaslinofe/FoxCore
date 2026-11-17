const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.shopee&select=provider,expires_at&limit=1');
  const settings=await db('fox_settings','GET',null,'?select=key&key=like.shopee_*');
  const connected=rows.length>0;
  return res.json({ok:true,connected,credential_source:connected?'Shopee OAuth token store':null,queue_ready:false,credentials_configured:settings.length>0,reason:connected?null:'shopee_credentials_not_found_in_active_token_store'});
 }catch(e){return res.status(503).json({ok:false,reason:'shopee_status_unavailable'});}
};