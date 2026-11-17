const {ready,db,authenticated,decrypt}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 if(!authenticated(req))return res.status(401).json({ok:false});
 if(!ready())return res.status(503).json({ok:false,reason:'not_configured'});
 try{
  const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at');
  if(rows.length!==1)return res.status(409).json({ok:false,reason:'not_connected'});
  if(new Date(rows[0].expires_at).getTime()<=Date.now()+60000)return res.status(409).json({ok:false,reason:'token_expired'});
  const token=decrypt(rows[0].encrypted_payload);
  if(typeof token.access_token!=='string'||!token.access_token)return res.status(502).json({ok:false,reason:'invalid_token'});
  const r=await fetch('https://api.mercadolibre.com/users/me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
  if(!r.ok)return res.status(502).json({ok:false,reason:'provider_rejected',http_status:r.status});
  const user=await r.json();
  return res.status(200).json({ok:true,account_verified:!!user.id,site_id:typeof user.site_id==='string'?user.site_id:null,affiliate_links:'not_verified'});
 }catch(_){return res.status(502).json({ok:false,reason:'verification_failed'});}
};
