const crypto=require('node:crypto');
const {REDIRECT,ready,db,authenticated,encrypt}=require('./_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).end();
 if(!ready())return res.status(503).json({erro:'Configuração OAuth pendente'});
 if(!authenticated(req))return res.status(401).json({erro:'Acesso negado'});
 try{
  const state=crypto.randomBytes(32).toString('base64url');
  const verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const state_hash=crypto.createHash('sha256').update(state).digest('hex');
  await db('fox_oauth_states','POST',{state_hash,provider:'mercado_livre',expires_at:new Date(Date.now()+600000).toISOString(),encrypted_verifier:encrypt({verifier})});
  const q=new URLSearchParams({response_type:'code',client_id:process.env.MELI_AFFILIATE_CLIENT_ID,redirect_uri:REDIRECT,state,code_challenge:challenge,code_challenge_method:'S256'});
  return res.json({authorization_url:'https://auth.mercadolivre.com.br/authorization?'+q});
 }catch(e){return res.status(502).json({erro:'Não foi possível iniciar autorização'});}
};
