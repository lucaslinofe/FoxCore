const crypto=require('node:crypto');
const {REDIRECT,ready,db,encrypt}=require('./_shared');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
 const reply=(status,message)=>res.status(status).end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>FoxCore</title><body><h1>FoxCore</h1><p>'+message+'</p><p>Você pode fechar esta janela.</p></body></html>');
 if(req.method!=='GET')return reply(405,'Método não permitido.');
 if(!ready())return reply(503,'Integração ainda não configurada.');
 const {state,code,error}=req.query||{};
 if(error||typeof state!=='string'||typeof code!=='string'||state.length<32||state.length>512||code.length>2048)return reply(400,'Autorização cancelada ou inválida.');
 const digest=crypto.createHash('sha256').update(state).digest('hex');
 try{
  const rows=await db('fox_oauth_states','GET',null,'?state_hash=eq.'+digest+'&provider=eq.mercado_livre&select=state_hash,expires_at,consumed_at');
  if(rows.length!==1||rows[0].consumed_at||Date.parse(rows[0].expires_at)<=Date.now())return reply(400,'Autorização expirada ou já utilizada.');
  // Consumo atômico: apenas a primeira solicitação consegue marcar o estado.
  const claimed=await db('fox_oauth_states','PATCH',{consumed_at:new Date().toISOString()},'?state_hash=eq.'+digest+'&consumed_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
  if(claimed.length!==1)return reply(400,'Autorização já utilizada.');
  const response=await fetch('https://api.mercadolibre.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:process.env.MELI_AFFILIATE_CLIENT_ID,client_secret:process.env.MELI_AFFILIATE_CLIENT_SECRET,code,redirect_uri:REDIRECT}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){let kind='unknown';try{const body=await response.json();const allowed=new Set(['invalid_client','invalid_grant','invalid_request','unauthorized_client','unauthorized_application','invalid_scope','forbidden','unsupported_grant_type']);if(typeof body.error==='string'&&allowed.has(body.error))kind=body.error;}catch(_){}return reply(502,'O Mercado Livre recusou a troca do código (HTTP '+response.status+', tipo '+kind+'). Confira as configurações do aplicativo.');}
  const token=await response.json();
  if(!token.access_token||!token.refresh_token||!Number.isFinite(Number(token.expires_in)))return reply(502,'Resposta incompleta do Mercado Livre.');
  const expires_at=new Date(Date.now()+Number(token.expires_in)*1000).toISOString();
  await db('fox_oauth_tokens','POST',{provider:'mercado_livre',encrypted_payload:encrypt(token),expires_at,updated_at:new Date().toISOString()},'?on_conflict=provider');
  return reply(200,'Mercado Livre autorizado. Os tokens foram armazenados de forma criptografada.');
 }catch(e){return reply(502,'Não foi possível concluir a autorização.');}
};
