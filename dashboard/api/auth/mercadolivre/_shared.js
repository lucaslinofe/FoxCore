const crypto=require('node:crypto');
const BASE='https://bzfhxoxquggkijwreivu.supabase.co';
const REDIRECT='https://foxcore-br.vercel.app/api/auth/mercadolivre/callback';
function ready(){return ['FOX_ADMIN_KEY','MELI_AFFILIATE_CLIENT_ID','MELI_AFFILIATE_CLIENT_SECRET','MELI_OAUTH_ENCRYPTION_KEY','SUPABASE_SERVICE_ROLE_KEY'].every(k=>Boolean(process.env[k]));}
function headers(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;return {'apikey':key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'};}
async function db(table,method,body,filter=''){const r=await fetch(BASE+'/rest/v1/'+table+filter,{method,headers:{...headers(),Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Banco indisponível');return r.json();}
function authenticated(req){const a=process.env.FOX_ADMIN_KEY||'';const h=x=>crypto.createHash('sha256').update(x).digest();return a&&crypto.timingSafeEqual(h(req.headers.authorization||''),h('Bearer '+a));}
function encrypt(data){const key=Buffer.from(process.env.MELI_OAUTH_ENCRYPTION_KEY||'','base64');if(key.length!==32)throw Error('Chave de criptografia inválida');const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64');}
module.exports={BASE,REDIRECT,ready,db,authenticated,encrypt};
