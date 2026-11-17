const {ready,db,decrypt,encrypt,authenticated}=require('./auth/mercadolivre/_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'&&req.method!=='POST')return res.status(405).end();
 const expected=process.env.CRON_SECRET;
 const isCron=req.method==='GET'&&expected&&req.headers.authorization==='Bearer '+expected;
 const isAdmin=req.method==='POST'&&authenticated(req);
 if(!isCron&&!isAdmin)return res.status(401).json({ok:false});
 if(!ready())return res.status(503).json({ok:false,reason:'not_configured'});
 try{
  const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at');
  if(rows.length!==1)return res.status(200).json({ok:false,reason:'not_authorized'});
  const token=decrypt(rows[0].encrypted_payload);
  if(!token.refresh_token)throw Error('Refresh token ausente');
  const response=await fetch('https://api.mercadolibre.com/oauth/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.MELI_AFFILIATE_CLIENT_ID,client_secret:process.env.MELI_AFFILIATE_CLIENT_SECRET,refresh_token:token.refresh_token}),
   signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)return res.status(502).json({ok:false,reason:'provider_rejected',http_status:response.status});
  const next=await response.json();
  if(!next.access_token||!next.refresh_token||!Number.isFinite(Number(next.expires_in))||Number(next.expires_in)<=0)throw Error('Resposta OAuth inválida');
  const expires_at=new Date(Date.now()+Number(next.expires_in)*1000).toISOString();
  await db('fox_oauth_tokens','POST',{provider:'mercado_livre',encrypted_payload:encrypt(next),expires_at,updated_at:new Date().toISOString()},'?on_conflict=provider');
  return res.status(200).json({ok:true,expires_at});
 }catch(_){return res.status(502).json({ok:false,reason:'refresh_failed'});}
};
