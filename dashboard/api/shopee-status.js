const {db,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.shopee&select=provider,expires_at&limit=1');
  const envConfigured=Boolean(process.env.SHOPEE_AFFILIATE_APP_ID&&process.env.SHOPEE_AFFILIATE_SECRET);
  const oauthRegistered=rows.length>0;
  return res.json({ok:true,connected:envConfigured||oauthRegistered,credential_source:envConfigured?'Vercel (SHOPEE_AFFILIATE_APP_ID / SHOPEE_AFFILIATE_SECRET)':oauthRegistered?'Supabase OAuth':null,queue_ready:false,credentials_configured:envConfigured||oauthRegistered,api_verified:false,reason:envConfigured||oauthRegistered?'credentials_present_but_api_not_verified':'credentials_not_found_in_dashboard_runtime'});
 }catch(e){return res.status(503).json({ok:false,reason:'shopee_status_unavailable'});}
};