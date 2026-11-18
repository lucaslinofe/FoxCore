const {db,authenticated,decrypt}=require('./auth/mercadolivre/_shared');
const VALID=/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/;
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!authenticated(req))return res.status(401).json({ok:false});
 try{
  const action=String(req.query?.action||req.body?.action||'');
  // Manus integration staging: authenticated operator endpoints, no external calls.
  if(action==='manus_jobs'&&req.method==='GET'){
   const rows=await db('fox_manus_jobs','GET',null,'?select=id,offer_id,storefront_url,status,product_id,product_url,product_title,evidence,affiliate_url,affiliate_verified,manus_task_id,manus_task_url,manus_error,created_at&order=created_at.desc&limit=100');
   return res.json({ok:true,jobs:rows,manus_connected:Boolean(process.env.MANUS_API_KEY),conversion_connected:false});
  }
  if(action==='manus_enqueue'&&req.method==='POST'){
   const offer_id=String(req.body?.offer_id||'').trim(),raw=String(req.body?.storefront_url||'').trim();
   let u;try{u=new URL(raw)}catch{return res.status(400).json({ok:false,reason:'invalid_storefront_url'})}
   if(!offer_id||offer_id.length>120||raw.length>2048||u.protocol!=='https:'||u.port||u.username||u.password||!['meli.la','www.meli.la','mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br'].includes(u.hostname.toLowerCase()))return res.status(400).json({ok:false,reason:'invalid_job'});
   const rows=await db('fox_manus_jobs','POST',{offer_id,storefront_url:u.href,status:'pending_manus'},'?on_conflict=offer_id,storefront_url');
   return res.status(201).json({ok:true,job:rows[0]});
  }
  if(action==='manus_retry'&&req.method==='POST'){
   const id=String(req.body?.job_id||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_job_id'});
   const rows=await db('fox_manus_jobs','GET',null,'?id=eq.'+id+'&select=id,status,manus_task_id,manus_error,product_url');
   if(rows.length!==1)return res.status(404).json({ok:false,reason:'job_not_found'});
   const job=rows[0];
   if(job.status!=='pending_manus'||!job.manus_task_id||!job.manus_error||job.product_url)return res.status(409).json({ok:false,reason:'retry_not_allowed'});
   const updated=await db('fox_manus_jobs','PATCH',{manus_task_id:null,manus_task_url:null,manus_error:null,updated_at:new Date().toISOString()},'?id=eq.'+id+'&status=eq.pending_manus&manus_task_id=eq.'+encodeURIComponent(job.manus_task_id));
   if(!updated.length)return res.status(409).json({ok:false,reason:'retry_conflict'});
   return res.json({ok:true,status:'ready_to_dispatch',credits_consumed:false});
  }
  if(action==='manus_dispatch'&&req.method==='POST'){
   const id=String(req.body?.job_id||'').trim();
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_job_id'});
   if(!process.env.MANUS_API_KEY)return res.status(503).json({ok:false,reason:'manus_key_missing'});
   const jobs=await db('fox_manus_jobs','GET',null,'?id=eq.'+id+'&select=id,storefront_url,status,manus_task_id');
   if(jobs.length!==1)return res.status(404).json({ok:false,reason:'job_not_found'});
   const job=jobs[0];
   if(job.status!=='pending_manus'||job.manus_task_id)return res.status(409).json({ok:false,reason:'job_already_dispatched_or_processed'});
   const prompt='Acesse a vitrine '+job.storefront_url+' e identifique o PRIMEIRO produto exibido no topo. Extraia o link real desse produto na vitrine, mesmo que seja uma pagina de catalogo /p/MLB..., sem inventar URLs. Informe separadamente catalog_id (codigo /p/MLB...), listing_id (identificador wid=MLB... somente se estiver no link observado), product_url (URL real do produto, sem parametros de rastreamento), product_title, evidence (explique a origem do link e se houve verificacao), blocked (true se nao for possivel identificar o produto). Se houver bloqueio de login ou CAPTCHA, nao contorne; relate o bloqueio e preserve somente evidencias efetivamente observadas. Retorne JSON estruturado.';
   let response,data;
   try{
    response=await fetch('https://api.manus.ai/v2/task.create',{method:'POST',headers:{'Content-Type':'application/json','x-manus-api-key':process.env.MANUS_API_KEY},body:JSON.stringify({message:{content:[{type:'text',text:prompt,visibility:'visible'}]},title:'FoxCore - Identificação de produto',agent_profile:'lite',interactive_mode:false,share_visibility:'private',clear_connectors:true,structured_output_schema:{type:'object',properties:{product_url:{type:'string'},product_title:{type:'string'},product_id:{type:'string'},catalog_id:{type:'string'},listing_id:{type:'string'},evidence:{type:'string'},blocked:{type:'boolean'}},required:['product_url','product_title','product_id','catalog_id','listing_id','evidence','blocked'],additionalProperties:false}}),signal:AbortSignal.timeout(20000)});
    data=await response.json();
   }catch(_){return res.status(502).json({ok:false,reason:'manus_connection_failed'})}
   if(!response.ok||!data?.ok||!data?.task_id)return res.status(502).json({ok:false,reason:'manus_task_rejected',http_status:response.status,provider_error_code:data?.error?.code||null});
   const rows=await db('fox_manus_jobs','PATCH',{manus_task_id:data.task_id,manus_task_url:data.task_url||null,updated_at:new Date().toISOString()},'?id=eq.'+id+'&status=eq.pending_manus&manus_task_id=is.null');
   return res.json({ok:true,job:rows[0]||null,manus_task_id:data.task_id,task_url:data.task_url||null});
  }
  if(action==='manus_poll'&&req.method==='POST'){
   const id=String(req.body?.job_id||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_job_id'});
   const jobs=await db('fox_manus_jobs','GET',null,'?id=eq.'+id+'&select=id,status,manus_task_id');
   if(jobs.length!==1||!jobs[0].manus_task_id)return res.status(404).json({ok:false,reason:'manus_task_not_found'});
   const taskId=jobs[0].manus_task_id;
   let response,result;
   try{response=await fetch('https://api.manus.ai/v2/task.listMessages?task_id='+encodeURIComponent(taskId)+'&order=desc&limit=100',{headers:{'x-manus-api-key':process.env.MANUS_API_KEY},signal:AbortSignal.timeout(15000)});result=await response.json()}catch{return res.status(502).json({ok:false,reason:'manus_poll_failed'})}
   if(!response.ok||!result?.ok)return res.status(502).json({ok:false,reason:'manus_poll_rejected',http_status:response.status});
   const events=result.messages||[];
   const state=events.find(x=>x.type==='status_update')?.status_update?.agent_status||'unknown';
   const output=events.find(x=>x.type==='structured_output_result')?.structured_output_result;
   if(output?.success&&jobs[0].status==='pending_manus'){
    const v=output.value||{},raw=String(v.product_url||'');
    let u;try{u=new URL(raw)}catch{}
    const allowed=u&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br'].includes(u.hostname.toLowerCase());
    const catalog=allowed?u.pathname.match(/\/p\/(MLB\d{7,15})(?:\/|$)/i):null;
    const item=allowed&&!catalog?u.pathname.match(/(?:\/|^)(MLB-?\d{7,15})(?:\/|$)/i):null;
    const wid=allowed?String(u.searchParams.get('wid')||new URLSearchParams(u.hash.slice(1)).get('wid')||'').match(/^MLB\d{7,15}$/i):null;
    const listingId=wid?wid[0].toUpperCase():item?'MLB'+item[1].replace(/\D/g,''):null;
    const catalogId=catalog?catalog[1].toUpperCase():null;
    const evidence=String(v.evidence||'').slice(0,1700);
    if(!v.blocked&&allowed&&(catalogId||listingId)&&evidence.length>=10){
     const note=evidence+' | Tipo: '+(catalogId?'catalogo':'anuncio')+(catalogId?' | catalog_id='+catalogId:'')+(listingId?' | listing_id_indicado='+listingId:'')+' | Link de afiliado nao verificado.';
     await db('fox_manus_jobs','PATCH',{status:'pending_review',product_id:listingId||catalogId,product_url:u.origin+u.pathname,product_title:String(v.product_title||'').slice(0,250),evidence:note.slice(0,2000),updated_at:new Date().toISOString()},'?id=eq.'+id+'&status=eq.pending_manus');
     return res.json({ok:true,status:'pending_review',identification_type:catalogId?'catalog':'listing',catalog_id:catalogId,listing_id:listingId,listing_verified:false,affiliate_verified:false,product_url:u.origin+u.pathname,product_title:String(v.product_title||'').slice(0,250)});
    }
    await db('fox_manus_jobs','PATCH',{manus_error:v.blocked?'provider_blocked':'product_not_verified',product_title:String(v.product_title||'').slice(0,250),evidence:evidence||null,updated_at:new Date().toISOString()},'?id=eq.'+id);
    return res.json({ok:true,status:'requires_manual_review',reason:v.blocked?'provider_blocked':'product_not_verified'});
   }
   return res.json({ok:true,status:state,task_id:taskId,has_structured_result:!!output});
  }
  if(action==='manus_result'&&req.method==='POST'){
   const id=String(req.body?.job_id||'').trim(),raw=String(req.body?.product_url||'').trim(),evidence=String(req.body?.evidence||'').trim(),title=String(req.body?.product_title||'').trim();
   if(!/^[0-9a-f-]{36}$/i.test(id)||evidence.length<10||evidence.length>2000||title.length>250)return res.status(400).json({ok:false,reason:'invalid_result'});
   let u;try{u=new URL(raw)}catch{return res.status(400).json({ok:false,reason:'invalid_product_url'})}
   const match=u.pathname.match(/MLB-?(\d{7,15})/i);
   if(!match||u.protocol!=='https:'||u.port||u.username||u.password||!['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br'].includes(u.hostname.toLowerCase()))return res.status(400).json({ok:false,reason:'invalid_product_url'});
   const rows=await db('fox_manus_jobs','PATCH',{status:'pending_review',product_id:'MLB'+match[1],product_url:u.origin+u.pathname,product_title:title,evidence,updated_at:new Date().toISOString()},'?id=eq.'+id+'&status=eq.pending_manus');
   if(!rows.length)return res.status(409).json({ok:false,reason:'job_not_pending'});
   return res.json({ok:true,job:rows[0]});
  }
  if(action==='manus_approve'&&req.method==='POST'){
   const id=String(req.body?.job_id||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_job_id'});
   const candidates=await db('fox_manus_jobs','GET',null,'?id=eq.'+id+'&status=eq.pending_review&select=product_url,product_id');
   if(!candidates.length)return res.status(409).json({ok:false,reason:'job_not_in_review'});
   if(/\/p\/MLB\d{7,15}/i.test(String(candidates[0].product_url||'')))return res.status(409).json({ok:false,reason:'catalog_requires_individual_listing_verification'});
   const rows=await db('fox_manus_jobs','PATCH',{status:'pending_conversion',updated_at:new Date().toISOString()},'?id=eq.'+id+'&status=eq.pending_review');
   if(!rows.length)return res.status(409).json({ok:false,reason:'job_not_in_review'});
   return res.json({ok:true,job:rows[0]});
  }
  if(action==='shopee_status'&&req.method==='GET'){
   try{
    const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.shopee&select=provider&limit=1');
    const configured=Boolean(process.env.SHOPEE_AFFILIATE_APP_ID&&process.env.SHOPEE_AFFILIATE_SECRET);
    const connected=configured||rows.length>0;
    return res.json({ok:true,connected,credential_source:configured?'Vercel':rows.length?'Supabase OAuth':null,queue_ready:false,api_verified:false});
   }catch{return res.status(503).json({ok:false,reason:'status_unavailable'});}
  }
  if(action==='mercadolivre_refresh_token'&&req.method==='POST'){
   const rows=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   if(!rows.length)return res.json({ok:true,status:'oauth_not_connected'});
   let old;try{old=decrypt(rows[0].encrypted_payload)}catch{return res.json({ok:true,status:'oauth_token_unreadable'})}
   if(!old.refresh_token)return res.json({ok:true,status:'refresh_token_missing'});
   if(!process.env.MELI_AFFILIATE_CLIENT_ID||!process.env.MELI_AFFILIATE_CLIENT_SECRET)return res.json({ok:true,status:'oauth_client_not_configured'});
   try{
    const response=await fetch('https://api.mercadolibre.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.MELI_AFFILIATE_CLIENT_ID,client_secret:process.env.MELI_AFFILIATE_CLIENT_SECRET,refresh_token:old.refresh_token}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)return res.json({ok:true,status:response.status===400||response.status===401?'reauthorization_required':'refresh_provider_error',http_status:response.status});
    const fresh=await response.json();
    if(!fresh.access_token||!fresh.refresh_token||!Number.isFinite(Number(fresh.expires_in))||Number(fresh.expires_in)<=0)return res.json({ok:true,status:'invalid_refresh_response'});
    const crypto=require('node:crypto');const key=Buffer.from(process.env.MELI_OAUTH_ENCRYPTION_KEY||'','base64');
    if(key.length!==32)return res.json({ok:true,status:'encryption_key_unavailable'});
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(fresh),'utf8'),cipher.final()]);
    const encrypted_payload=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
    const expires_at=new Date(Date.now()+Number(fresh.expires_in)*1000).toISOString();
    await db('fox_oauth_tokens','POST',{provider:'mercado_livre',encrypted_payload,expires_at,updated_at:new Date().toISOString()},'?on_conflict=provider');
    return res.json({ok:true,status:'oauth_refreshed',expires_at});
   }catch{return res.json({ok:true,status:'refresh_network_or_storage_error'})}
  }
  if(action==='meli_item_probe'&&req.method==='GET'){
   const code=String(req.query?.code||'');
   if(!/^MLB[0-9]{7,15}$/.test(code))return res.status(400).json({ok:false,reason:'invalid_product_code'});
   const tokens=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   let accessToken=null;
   if(tokens[0]&&Date.parse(tokens[0].expires_at)>Date.now()+60000){try{accessToken=decrypt(tokens[0].encrypted_payload).access_token||null}catch{}}
   try{
    const response=await fetch('https://api.mercadolibre.com/items/'+code,{headers:{Accept:'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},redirect:'manual',signal:AbortSignal.timeout(9000)});
    if(!response.ok)return res.json({ok:true,status:response.status===401?'item_unauthorized':response.status===403?'item_forbidden':response.status===404?'item_not_found':response.status===429?'rate_limited':'item_unavailable',http_status:response.status,product_code:code,oauth_used:!!accessToken,verified:false});
    const item=await response.json();
    if(item.id!==code)return res.json({ok:true,status:'item_id_mismatch',verified:false});
    return res.json({ok:true,status:'item_accessible',product_code:code,title:String(item.title||'').slice(0,200),price:typeof item.price==='number'?item.price:null,currency:item.currency_id||null,availability:item.status||null,product_url:typeof item.permalink==='string'&&item.permalink.startsWith('https://')?item.permalink:null,oauth_used:!!accessToken,verified:true,affiliate_link_generated:false,published:false});
   }catch{return res.json({ok:true,status:'item_network_error',product_code:code,verified:false})}
  }
  if(action==='meli_random10'&&req.method==='GET'){
   const terms=['fone bluetooth','cafeteira','parafusadeira','mochila','mouse sem fio','ventilador','panela','tenis esportivo','smartwatch','luminaria'];
   const tokens=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   if(!tokens.length)return res.json({ok:true,status:'oauth_not_connected',items:[]});
   if(!tokens[0].expires_at||Date.parse(tokens[0].expires_at)<=Date.now()+60000)return res.json({ok:true,status:'oauth_token_expired',items:[]});
   let accessToken;try{accessToken=decrypt(tokens[0].encrypted_payload).access_token}catch{return res.json({ok:true,status:'oauth_token_unreadable',items:[]})}
   if(!accessToken)return res.json({ok:true,status:'oauth_token_unavailable',items:[]});
   const shuffled=terms.map(x=>({x,r:Math.random()})).sort((a,b)=>a.r-b.r).map(x=>x.x);
   const items=[];const statuses=[];
   for(const term of shuffled){
    try{
     const url='https://api.mercadolibre.com/sites/MLB/search?'+new URLSearchParams({q:term,limit:'10'});
     const response=await fetch(url,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json','User-Agent':'FoxCore-Random10-Diagnostic/1.0'},redirect:'manual',signal:AbortSignal.timeout(6500)});
     if(!response.ok){statuses.push(response.status);if([401,403,429].includes(response.status))break;continue}
     const data=await response.json();
     const options=(Array.isArray(data.results)?data.results:[]).filter(x=>/^MLB[0-9]{7,15}$/.test(String(x.id||''))&&typeof x.price==='number'&&x.price>0);
     if(options.length){const x=options[Math.floor(Math.random()*options.length)];items.push({product_code:x.id,title:String(x.title||'').slice(0,180),price:x.price,currency:x.currency_id||'BRL',product_url:typeof x.permalink==='string'&&x.permalink.startsWith('https://')?x.permalink:null,search_term:term})}
    }catch{statuses.push('network_error')}
   }
   return res.json({ok:true,status:items.length?'products_found':statuses.includes(401)?'oauth_unauthorized':statuses.includes(403)?'oauth_forbidden':statuses.includes(429)?'rate_limited':'no_products_available',items,requested:10,found:items.length,prices_from_search_api:true,discounts_verified:false,affiliate_links_generated:0,published:false});
  }
  if(action==='meli_top10'&&req.method==='GET'){
   const cats={eletronicos:'MLB1000',celulares:'MLB1055',casa:'MLB1574',informatica:'MLB1648'};
   const category=String(req.query?.category||'celulares');
   if(!Object.hasOwn(cats,category))return res.status(400).json({ok:false,reason:'invalid_category'});
   const tokens=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   if(!tokens.length)return res.json({ok:true,status:'oauth_not_connected',category,items:[],verified:false});
   if(!tokens[0].expires_at||Date.parse(tokens[0].expires_at)<=Date.now()+60000)return res.json({ok:true,status:'oauth_token_expired',category,items:[],verified:false});
   let accessToken;
   try{accessToken=decrypt(tokens[0].encrypted_payload).access_token}catch{return res.json({ok:true,status:'oauth_token_unreadable',category,items:[],verified:false})}
   if(!accessToken)return res.json({ok:true,status:'oauth_token_unavailable',category,items:[],verified:false});
   try{
    const response=await fetch('https://api.mercadolibre.com/highlights/MLB/category/'+cats[category],{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json','User-Agent':'FoxCore-Top10-Diagnostic/1.0'},redirect:'manual',signal:AbortSignal.timeout(9000)});
    if(!response.ok)return res.json({ok:true,status:response.status===401?'oauth_unauthorized':response.status===403?'oauth_forbidden':response.status===429?'rate_limited':'provider_unavailable',http_status:response.status,category,items:[],verified:false,affiliate_links_generated:0});
    const payload=await response.json();
    const raw=Array.isArray(payload.content)?payload.content:Array.isArray(payload.results)?payload.results:[];
    const ids=[...new Set(raw.map(x=>String(x.id||x.item_id||'')).filter(x=>/^MLB[0-9]{7,15}$/.test(x)))].slice(0,10);
    return res.json({ok:true,status:ids.length?'ranking_ids_available':'ranking_empty_or_unrecognized',category,items:ids.map((id,index)=>({rank:index+1,product_code:id})),verified:false,prices_verified:false,affiliate_links_generated:0,source:'Mercado Livre highlights API'});
   }catch{return res.json({ok:true,status:'network_unavailable',category,items:[],verified:false,affiliate_links_generated:0});}
  }
  if(action==='mercadolivre_oauth_search_probe'&&req.method==='POST'){
   const tokens=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   if(!tokens.length)return res.json({ok:true,status:'oauth_not_connected',products:0});
   if(Date.parse(tokens[0].expires_at)<=Date.now()+60000)return res.json({ok:true,status:'oauth_token_expired',products:0});
   let accessToken;try{accessToken=decrypt(tokens[0].encrypted_payload).access_token}catch{return res.json({ok:true,status:'oauth_token_unreadable',products:0})}
   if(!accessToken)return res.json({ok:true,status:'oauth_token_unavailable',products:0});
   const title=String(req.body?.title||'').trim().slice(0,120);
   if(title.length<8)return res.status(400).json({ok:false,reason:'invalid_title'});
   try{
    const url='https://api.mercadolibre.com/sites/MLB/search?'+new URLSearchParams({q:title,limit:'5'});
    const response=await fetch(url,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(9000)});
    if(!response.ok)return res.json({ok:true,status:response.status===403?'oauth_search_forbidden':response.status===401?'oauth_search_unauthorized':response.status===429?'oauth_search_rate_limited':'oauth_search_unavailable',http_status:response.status,products:0});
    const data=await response.json();
    const results=(Array.isArray(data.results)?data.results:[]).slice(0,5).filter(x=>/^MLB\\d{7,15}$/.test(String(x.id||''))).map(x=>({product_code:x.id,title:String(x.title||'').slice(0,180)}));
    return res.json({ok:true,status:'oauth_search_available',products:results.length,results,verified_matches:0,affiliate_links_generated:0});
   }catch{return res.json({ok:true,status:'oauth_search_network_error',products:0})}
  }
  if(action==='inspect_product_candidate'&&req.method==='POST'){
   const short=String(req.body?.short_url||'');
   const code=String(req.body?.product_code||'');
   if(!VALID.test(short)||!/^MLB\d{7,15}$/.test(code))return res.status(400).json({ok:false,reason:'invalid_candidate'});
   const rows=await db('fox_pechinchou_queue','GET',null,'?select=short_url,title,candidate_matches,source_metadata&short_url=eq.'+encodeURIComponent(short)+'&limit=1');
   const offer=rows[0];
   if(!offer||!(offer.candidate_matches||[]).some(x=>x.product_code===code))return res.status(404).json({ok:false,reason:'candidate_not_registered'});
   const registered=offer.candidate_matches.find(x=>x.product_code===code);
   const catalog=registered.product_code_type==='catalog_product'||(!registered.product_code_type&&/^https:\/\/[^/]+\/p\/MLB\d{7,15}/i.test(registered.product_url||''));
   const apiPath=catalog?'products/':'items/';
   const tokens=await db('fox_oauth_tokens','GET',null,'?provider=eq.mercado_livre&select=encrypted_payload,expires_at&limit=1');
   let accessToken=null;
   if(tokens[0]&&Date.parse(tokens[0].expires_at)>Date.now()+60000){
    try{accessToken=decrypt(tokens[0].encrypted_payload).access_token||null}catch{}
   }
   try{
    const response=await fetch('https://api.mercadolibre.com/'+apiPath+encodeURIComponent(code),{headers:{Accept:'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return res.json({ok:true,status:response.status===403?'provider_forbidden':response.status===429?'provider_rate_limited':response.status===401?'provider_unauthorized':'provider_unavailable',http_status:response.status,product_verified:false,offer_identity_verified:false,price_verified:false});
    const item=await response.json();
    if(item.id!==code)return res.json({ok:true,status:'item_id_mismatch',product_verified:false,offer_identity_verified:false,price_verified:false});
    const price=!catalog&&typeof item.price==='number'&&item.price>0?item.price:null;
    const regular=!catalog&&typeof item.original_price==='number'&&item.original_price>0?item.original_price:null;
    const normalized=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[];
    const stop=new Set(['para','com','original','mercado','livre','produto','novo','uma','dos','das','por']);
    const sourceTerms=new Set(normalized(offer.title).filter(t=>t.length>2&&!stop.has(t)));
    const targetTerms=new Set(normalized(item.title).filter(t=>t.length>2&&!stop.has(t)));
    const shared=[...sourceTerms].filter(t=>targetTerms.has(t));
    const sourceModels=[...sourceTerms].filter(t=>/[a-z]/.test(t)&&/\d/.test(t));
    const targetModels=[...targetTerms].filter(t=>/[a-z]/.test(t)&&/\d/.test(t));
    const modelConflict=sourceModels.length>0&&targetModels.length>0&&!sourceModels.some(t=>targetModels.includes(t));
    const similarity=sourceTerms.size&&targetTerms.size?Math.round(100*2*shared.length/(sourceTerms.size+targetTerms.size)):0;
    const identityAssessment=modelConflict?'model_conflict':similarity>=75?'strong_title_similarity_unverified':similarity>=40?'partial_title_similarity':'insufficient_title_evidence';
    const sourcePrice=typeof offer.source_metadata?.price==='number'?offer.source_metadata.price:null;
    const priceDifferencePercent=price!==null&&sourcePrice!==null?Math.round(10000*(price-sourcePrice)/sourcePrice)/100:null;
    return res.json({ok:true,status:catalog?'catalog_api_accessible':'item_api_accessible',product_code_type:catalog?'catalog_product':'listing_item',product_verified:true,offer_identity_verified:false,product_code:code,title:String(item.title||'').slice(0,200),currency:item.currency_id||null,price,reference_price:regular,price_verified:price!==null,price_source:'mercado_livre_items_api',source_price:sourcePrice,price_difference_percent:priceDifferencePercent,title_similarity_percent:similarity,shared_title_terms:shared.slice(0,8),identity_assessment:identityAssessment,checked_at:new Date().toISOString(),pix_price:null,pix_price_verified:false,coupon_price:null,coupon_price_verified:false,affiliate_link_generated:false,published:false});
   }catch{return res.json({ok:true,status:'provider_network_error',product_verified:false,offer_identity_verified:false,price_verified:false})}
  }
  if(action==='record_manual_product_candidate'&&req.method==='POST'){
   const short=String(req.body?.short_url||'');
   const raw=String(req.body?.product_url||'');
   if(!VALID.test(short))return res.status(400).json({ok:false,reason:'invalid_offer_link'});
   let u;try{u=new URL(raw)}catch{return res.status(400).json({ok:false,reason:'invalid_product_url'})}
   if(u.protocol!=='https:'||!['www.mercadolivre.com.br','mercadolivre.com.br','produto.mercadolivre.com.br'].includes(u.hostname)||u.port||u.username||u.password)return res.status(400).json({ok:false,reason:'invalid_product_url'});
   const id=u.pathname.match(/MLB-?(\d{7,15})(?:\D|$)/i)?.[1];
   if(!id)return res.status(400).json({ok:false,reason:'product_code_not_in_path'});
   const rows=await db('fox_pechinchou_queue','GET',null,'?select=short_url&short_url=eq.'+encodeURIComponent(short)+'&limit=1');
   if(!rows.length)return res.status(404).json({ok:false,reason:'offer_not_found'});
   const codeType=/^\/p\/MLB\d{7,15}\/?$/i.test(u.pathname)?'catalog_product': 'listing_item';
   const candidate={product_code:'MLB'+id,product_code_type:codeType,product_url:u.origin+u.pathname,score:null,status:'manual_candidate_unverified',verified:false,evidence:['operator_supplied_product_url']};
   await db('fox_pechinchou_queue','PATCH',{candidate_matches:[candidate],last_match_status:'manual_candidate_unverified'},'?short_url=eq.'+encodeURIComponent(short));
   return res.json({ok:true,candidate,offer_verified:false,affiliate_link_generated:false,published:false});
  }
  if(action==='pechinchou_queue'&&req.method==='GET'){
   const offers=await db('fox_pechinchou_queue','GET',null,'?select=short_url,title,status,product_code,product_url,updated_at,candidate_matches,last_match_status,last_match_attempt_at,extracted_attributes,source_metadata&order=updated_at.desc&limit=100');
   return res.json({ok:true,offers,published:false,automatic_affiliate_generation:false});
  }
  if(action==='pechinchou_automatic_status'&&req.method==='GET'){
   const runs=await db('fox_runs','GET',null,'?select=status,finished_at,details&module=eq.PechinchouDiagnostic&order=finished_at.desc&limit=5');
   return res.json({ok:true,diagnostic_scheduled:true,interval_hours:8,latest:runs[0]||null,history:runs,product_identification_automated:false,affiliate_generation_automated:false,publishing_enabled:false});
  }
  if(action==='discovered_products'){
   if(req.method==='GET'){const products=await db('fox_discovered_products','GET',null,'?select=id,provider,product_code,source_url,product_url,title,status,discovered_at&order=discovered_at.desc&limit=100');return res.json({ok:true,products,automatic_collection:false,automatic_affiliate_generation:false})}
   if(req.method==='POST'){
    const b=req.body||{};if(b.provider!=='pechinchou')return res.status(400).json({ok:false,reason:'invalid_source'});
    let src,product;try{src=new URL(String(b.source_url||''));product=new URL(String(b.product_url||''))}catch{return res.status(400).json({ok:false,reason:'invalid_url'})}
    if(src.protocol!=='https:'||!['pechinchou.com.br','www.pechinchou.com.br'].includes(src.hostname)||src.port||src.username||src.password)return res.status(400).json({ok:false,reason:'invalid_source'});
    if(product.protocol!=='https:'||!['produto.mercadolivre.com.br','www.mercadolivre.com.br','mercadolivre.com.br'].includes(product.hostname)||product.port||product.username||product.password)return res.status(400).json({ok:false,reason:'invalid_product'});
    const id=product.pathname.match(/MLB-?(\d{7,15})/i)?.[1];if(!id)return res.status(400).json({ok:false,reason:'product_id_missing'});
    const products=await db('fox_discovered_products','POST',{provider:'pechinchou',product_code:'MLB'+id,source_url:src.origin+src.pathname,product_url:product.origin+product.pathname,title:String(b.title||'').slice(0,240)||null,status:'awaiting_own_affiliate_link'},'?on_conflict=provider,product_code');
    return res.json({ok:true,product:products[0],published:false,affiliate_link_generated:false})
   }
   return res.status(405).end();
  }
  if(action==='integration_readiness'&&req.method==='GET'){
   const [sources,links,drafts]=await Promise.all([db('fox_sources','GET',null,'?select=name,provider,enabled,authorized&provider=eq.pechinchou&limit=1'),db('fox_affiliate_links','GET',null,'?select=id&limit=200'),db('fox_offer_drafts','GET',null,'?select=affiliate_link_id&limit=200')]);const source=sources[0]||null;
   return res.json({ok:true,pechinchou:{registered:!!source,enabled:source?.enabled===true,authorized:source?.authorized===true,automatic_collection_active:false},mercado_livre:{automatic_link_generation_verified:false,registered_links:links.length},offers:{drafts:drafts.length}});
  }
  if(action==='inspect_affiliate_profile'&&req.method==='POST'){
   const raw=String(req.body?.profile_url||'');
   let u;try{u=new URL(raw)}catch{return res.status(400).json({ok:false,reason:'invalid_profile_url'})}
   if(u.protocol!=='https:'||u.hostname!=='www.mercadolivre.com.br'||!/^\/social\/[a-zA-Z0-9_-]{5,80}\/?$/.test(u.pathname)||u.port||u.username||u.password)return res.status(400).json({ok:false,reason:'invalid_profile_url'});
   try{
    const response=await fetch(u.origin+u.pathname,{redirect:'manual',headers:{Accept:'text/html','User-Agent':'FoxCore-Profile-Diagnostic/1.0'},signal:AbortSignal.timeout(6500)});
    const contentType=response.headers.get('content-type')||'';
    if(!response.ok||!contentType.includes('text/html'))return res.json({ok:true,http_status:response.status,content_type:contentType.split(';')[0],status:response.status===403?'profile_access_denied':response.status===429?'profile_rate_limited':response.status>=300&&response.status<400?'profile_redirected':'profile_unavailable',products:[],next_step:'browser_navigation_required',imported:0,affiliate_link_generated:false});
    const html=(await response.text()).slice(0,450000);
    const productLinks=[...html.matchAll(/(?:https?:\\\/\\\/|https?:\/\/|\/)(?:produto\.)?mercadolivre\.com\.br\/[^"'<>\\\s]{0,350}?MLB-?(\d{7,15})[^"'<>\\\s]*/gi)];
    const codes=[...new Set([...html.matchAll(/MLB-?(\d{7,15})/gi)].map(m=>'MLB'+m[1]))].slice(0,35);
    const products=codes.map(code=>({product_code:code,product_url:null,confirmed_from_offer:false}));
    return res.json({ok:true,http_status:response.status,status:codes.length?'profile_product_candidates_found':'profile_requires_browser_or_api',products,product_links_detected:productLinks.length,html_bytes:html.length,offer_match_verified:false,imported:0,affiliate_link_generated:false});
   }catch{return res.json({ok:true,status:'profile_fetch_failed',next_step:'browser_navigation_required',products:[],imported:0,affiliate_link_generated:false})}
  }
  if(action==='validate_short_links'&&req.method==='POST'){
   const links=req.body?.links;
   if(!Array.isArray(links)||links.length<1||links.length>5)return res.status(400).json({ok:false,reason:'invalid_batch'});
   const check=async(raw)=>{
    const item={short_url:raw,status:'unresolved',destination_url:null,destination_type:null,product_code:null,redirect_evidence:[],offer_verified:false,affiliate_for_user:false};
    if(typeof raw!=='string'||!/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/.test(raw))return {...item,status:'invalid_link'};
    let url=new URL(raw);
    const hosts=['meli.la','mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','lista.mercadolivre.com.br'];
    for(let hop=0;hop<4;hop++){
     const queryKeys=[...url.searchParams.keys()].slice(0,20);const queryCode=[...url.searchParams.values()].map(v=>String(v).match(/MLB-?(\d{7,15})/i)?.[1]).find(Boolean)||null;
     item.redirect_evidence.push({hop,host:url.hostname,path:url.pathname.slice(0,180),query_keys:queryKeys,product_code_hint:queryCode?'MLB'+queryCode:null});
     if(url.hostname!=='meli.la'){
      const code=url.pathname.match(/MLB-?(\d{7,15})/i)?.[1]||null;
      const kind=url.pathname.startsWith('/social/')?'affiliate_profile':code?'product':'other_marketplace_page';
      return {...item,status:kind==='product'?'product_destination_found':kind==='affiliate_profile'?'affiliate_profile_found':'marketplace_page_found',destination_url:url.origin+url.pathname,destination_type:kind,product_code:code?'MLB'+code:null,product_code_hint:queryCode?'MLB'+queryCode:null};
     }
     try{
      const response=await fetch(url.toString(),{redirect:'manual',headers:{Accept:'text/html','User-Agent':'FoxCore-Link-Diagnostic/1.1'},signal:AbortSignal.timeout(2500)});
      if([401,403,429].includes(response.status))return {...item,status:'provider_blocked',http_status:response.status};
      if(response.status<300||response.status>=400)return {...item,status:response.ok?'short_link_no_redirect':'provider_http_error',http_status:response.status};
      const location=response.headers.get('location');if(!location)return {...item,status:'missing_redirect_location'};
      const next=new URL(location,url);
      if(next.protocol!=='https:'||next.port||next.username||next.password||!hosts.includes(next.hostname.toLowerCase())||next.href.length>2048)return {...item,status:'redirect_to_unapproved_host',redirect_host:next.hostname.slice(0,100)};
      url=next;
     }catch{return {...item,status:'network_error'}}
    }
    return {...item,status:'redirect_hop_limit'};
   };
   const checks=await Promise.all(links.map(check));
   return res.json({ok:true,checks,checked:checks.length,diagnostic_only:true,imported:0,affiliate_link_generated:false});
  }
  if(action==='pechinchou_probe'&&req.method==='GET'){
   const source='https://pechinchou.com.br/lojas/mercadolivre.com.br';
   try{
    const response=await fetch(source,{headers:{Accept:'text/html','User-Agent':'FoxCore-Source-Readiness/1.1'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    const type=response.headers.get('content-type')||'';
    const accessible=response.ok&&type.includes('text/html');
    const html=accessible?(await response.text()).slice(0,400000):'';
    const codes=[...new Set([...html.matchAll(/MLB-?(\d{7,15})/gi)].map(m=>m[1]))];
    const productEvidence=codes.slice(0,15).map(code=>{
     const pattern=new RegExp('MLB-?'+code+'(?![0-9])','gi');
     const occurrences=[...html.matchAll(pattern)].slice(0,12);
     const locations=occurrences.map(m=>{const i=m.index||0;const before=html.slice(Math.max(0,i-250),i);const after=html.slice(i+ m[0].length,Math.min(html.length,i+250));const inScript=before.lastIndexOf('<script')>before.lastIndexOf('</script');const inAnchor=before.lastIndexOf('<a ')>before.lastIndexOf('</a>');const inLink=/mercadolivre\.com\.br|meli\.la/i.test(before+after);return {context:inScript?'script':inAnchor?'anchor':'html',near_marketplace_url:inLink}});
     return {code:'MLB'+code,occurrences:occurrences.length,contexts:[...new Set(locations.map(x=>x.context))],near_marketplace_url:locations.some(x=>x.near_marketplace_url),confirmed_offer:false};
    });
    const anchors=[...html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/g,'&'));
    const mlLinks=anchors.filter(h=>/mercadolivre\.com\.br|mercadolibre\.com|meli\.la/i.test(h));
    const redirectLinks=anchors.filter(h=>/\/(?:go|out|redirect|oferta|produto|promocao|link)\b|[?&](?:url|redirect|target|to)=/i.test(h));
    const scripts=[...html.matchAll(/<script\b[^>]*?src\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
    const scriptSources=scripts.slice(0,20).map(raw=>{try{const u=new URL(raw,source);return {host:u.hostname,path:u.pathname.slice(0,120)}}catch{return {host:'invalid',path:''}}});
    const framework={nextjs:html.includes('__NEXT_DATA__')||scripts.some(x=>x.includes('/_next/')),nuxt:html.includes('__NUXT__')||scripts.some(x=>x.includes('/_nuxt/')),react:html.includes('react-dom')||html.includes('data-reactroot'),json_ld:html.includes('application/ld+json')};
    const inlineScriptCount=(html.match(/<script\b(?![^>]*\bsrc\s*=)/gi)||[]).length;
    const dataSignals={graphql:html.includes('graphql'),api_routes:html.includes('/api/'),hydration:html.includes('__NEXT_DATA__')||html.includes('__NUXT__'),product_schema:html.includes('schema.org/Product')};
    const structured={next_data_present:false,next_data_parseable:false,next_data_page:null,json_ld_parseable:0,candidates:[],candidate_count:0,eligible_for_import:0,blocked_reason:'source_not_authorized'};
    const candidates=new Map();
    const normalizeUrl=(raw)=>{if(typeof raw!=='string'||!/^https:\/\//i.test(raw))return null;try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;if(!['pechinchou.com.br','www.pechinchou.com.br','meli.la','www.mercadolivre.com.br','produto.mercadolivre.com.br','mercadolivre.com.br'].includes(u.hostname))return null;return u.origin+u.pathname.slice(0,240)}catch{return null}};
    const classifyUrl=(raw)=>{const url=normalizeUrl(raw);if(!url)return null;const u=new URL(url);if(u.hostname==='meli.la')return {url,type:'mercado_livre_short_link'};if(/mercadolivre\.com\.br$/.test(u.hostname)){if(/\/social\//i.test(u.pathname))return {url,type:'affiliate_profile'};if(/MLB-?\d{7,15}/i.test(u.pathname))return {url,type:'direct_product'};if(u.pathname==='/'||u.pathname==='/home')return {url,type:'marketplace_home'};return {url,type:'marketplace_other'}}if(/pechinchou\.com\.br$/.test(u.hostname)){if(/^\/lojas\//i.test(u.pathname))return {url,type:'store_or_category'};return {url,type:'pechinchou_page'}}return {url,type:'other'}};
    const schemaEvidence={field_paths:[],url_candidates:[],product_code_fields:[],route_fields:[],destination_types:{}};
    const inspectObject=(obj,basePath,depth=0,out={urls:[],paths:[],ids:[],routes:[]})=>{
     if(depth>7||!obj||typeof obj!=='object')return out;
     if(Array.isArray(obj)){obj.slice(0,30).forEach((v,i)=>inspectObject(v,basePath+'['+i+']',depth+1,out));return out}
     for(const [key,val] of Object.entries(obj).slice(0,100)){
      const path=(basePath?basePath+'.':'')+key;
      if(/(?:url|link|href|permalink|redirect|target|outbound|affiliate|destination|slug|path|uri)/i.test(key)){out.paths.push(path.slice(0,180));if(typeof val==='string'&&/(?:slug|path|uri)/i.test(key))out.routes.push({field:path.slice(0,180),value:val.slice(0,120)});if(typeof val==='string'){const normalized=normalizeUrl(val);if(normalized&&!out.urls.some(x=>x.url===normalized))out.urls.push({field:path.slice(0,180),url:normalized});}}
      if(/(?:sku|product.?id|item.?id|mlb|mpn|gtin)/i.test(key)&&typeof val==='string')out.ids.push({field:path.slice(0,180),value:val.slice(0,60)});
      if(typeof val==='string'&&/^https:\/\//i.test(val)){
       const normalized=normalizeUrl(val);
       if(normalized&&!out.urls.some(x=>x.url===normalized))out.urls.push({field:path.slice(0,180),url:normalized});
      }else if(val&&typeof val==='object')inspectObject(val,path,depth+1,out);
     }
     return out;
    };
    const walk=(value,origin,depth=0)=>{
     if(depth>14||!value||typeof value!=='object')return;
     if(Array.isArray(value)){for(const item of value.slice(0,150))walk(item,origin,depth+1);return}
     const type=String(value['@type']||'');
     const title=typeof value.name==='string'?value.name:typeof value.title==='string'?value.title:null;
     const urlFields=['url','productUrl','product_url','link','permalink','href','externalUrl','destinationUrl','affiliateUrl'];const fieldEvidence=(title||type==='Product')?inspectObject(value,origin,0):{urls:[],paths:[],ids:[],routes:[]};schemaEvidence.field_paths.push(...fieldEvidence.paths);schemaEvidence.product_code_fields.push(...fieldEvidence.ids);schemaEvidence.route_fields.push(...fieldEvidence.routes);for(const item of fieldEvidence.urls)if(!schemaEvidence.url_candidates.some(x=>x.url===item.url))schemaEvidence.url_candidates.push(item);const rawUrl=urlFields.map(k=>value[k]).find(v=>typeof v==='string')||value.offers?.url||null;const nestedUrl=fieldEvidence.urls.map(x=>x.url).find(u=>/mercadolivre\.com\.br|meli\.la/i.test(u))||null;
     const urlEvidence=[...fieldEvidence.urls];const classifiedUrls=urlEvidence.map(x=>({field:x.field,...classifyUrl(x.url)})).filter(x=>x.url);for(const item of classifiedUrls)schemaEvidence.destination_types[item.type]=(schemaEvidence.destination_types[item.type]||0)+1;const directDestination=classifiedUrls.find(x=>x.type==='direct_product')?.url||null;const shortLink=classifiedUrls.find(x=>x.type==='mercado_livre_short_link')?.url||null;const profileUrl=classifiedUrls.find(x=>x.type==='affiliate_profile')?.url||null;const destination=directDestination;
     const offers=Array.isArray(value.offers)?value.offers[0]:value.offers;const rawPrice=value.price??value.salePrice??offers?.price??offers?.lowPrice??null;
     const price=typeof rawPrice==='number'||typeof rawPrice==='string'?String(rawPrice).slice(0,30):null;
     const rawCode=value.productId??value.itemId??value.mlb??value.sku??null;const code=destination?.match(/MLB-?(\d{7,15})/i)?.[1]||String(rawCode||'').match(/^MLB-?(\d{7,15})$/i)?.[1]||null;
     const keys=Object.keys(value);const categoryLike=type==='CollectionPage'||type==='ItemList'||type==='BreadcrumbList'||type==='Category'||keys.some(k=>/^(?:children|subcategories|categoryChildren|departments)$/i.test(k))&&!keys.some(k=>/^(?:price|salePrice|originalPrice|sku|productId|itemId)$/i.test(k));const productHints=keys.some(k=>/^(?:product|productId|itemId|sku|originalPrice|discount|salePrice|image|images|thumbnail|merchant|seller|offers|price|category)$/i.test(k));const generic=/^(?:mercado livre|pechinchou|ofertas|promoções|loja)$/i.test((title||'').trim());const isProduct=!generic&&!categoryLike&&(type==='Product'||(title&&title.length>12&&(price!==null||!!shortLink||!!code||!!destination)));
     if(isProduct&&title&&title.length>8&&candidates.size<80){
      const key=(code?'MLB'+code:destination||title.toLowerCase()).slice(0,260);
      if(!candidates.has(key))candidates.set(key,{title:title.slice(0,150),destination,price,product_code:code?'MLB'+code:null,origin,product_slug:typeof value.slug==='string'&&!/^(?:mercado-livre|mercadolivre\.com\.br)$/i.test(value.slug)?value.slug.slice(0,160):null,affiliate_profile_url:profileUrl,marketplace_short_url:shortLink,source_page_url:classifiedUrls.find(x=>x.type==='pechinchou_page')?.url||null,validation:code&&destination?'product_url_identified':destination?'needs_product_identity':shortLink?'short_link_requires_resolution':profileUrl?'affiliate_profile_is_not_product':'needs_product_destination',affiliate_link_generated:false,verified_offer:false});else {const existing=candidates.get(key);if(!existing.destination&&destination)existing.destination=destination;if(!existing.price&&price)existing.price=price;if(!existing.product_code&&code)existing.product_code='MLB'+code;}
     }
     for(const key of Object.keys(value).slice(0,100))walk(value[key],origin,depth+1);
    };
    const nextMatch=html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if(nextMatch){structured.next_data_present=true;try{const data=JSON.parse(nextMatch[1]);structured.next_data_parseable=true;structured.next_data_page=typeof data.page==='string'?data.page.slice(0,100):null;walk(data.props,'next_data')}catch{}}
    const ldBlocks=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0,12);
    for(const block of ldBlocks){try{const obj=JSON.parse(block[1]);structured.json_ld_parseable++;walk(obj,'json_ld')}catch{}}
    structured.candidate_count=candidates.size;
    structured.discovery_count=candidates.size;
    structured.enriched_count=[...candidates.values()].filter(p=>p.destination||p.price||p.product_code).length;
    structured.validated_count=0;
    structured.missing_destination_count=[...candidates.values()].filter(p=>!p.destination).length;
    structured.category_filter_applied=true;
    structured.candidates=[...candidates.values()].slice(0,15);
    structured.schema_field_paths=[...new Set(schemaEvidence.field_paths)].slice(0,60);
    structured.url_candidates=schemaEvidence.url_candidates.slice(0,30);
    structured.route_fields=schemaEvidence.route_fields.slice(0,30);
    structured.product_code_fields=schemaEvidence.product_code_fields.slice(0,30);
    structured.destination_types=schemaEvidence.destination_types;
    structured.product_samples=structured.candidates.slice(0,8);
    structured.short_links=[...new Set([...candidates.values()].map(p=>p.marketplace_short_url).filter(Boolean))].slice(0,30);

    if(String(req.query?.validate_links||'')==='1'){
     const items=[...candidates.values()].filter(p=>p.marketplace_short_url);
     const batchRaw=Number(req.query?.batch||0);
     const batch=Number.isInteger(batchRaw)?Math.min(9,Math.max(0,batchRaw)):0;
     const selection=items.slice(batch*5,batch*5+5);
     const safeTarget=(raw)=>{
      try{
       const url=new URL(raw);
       const hosts=['meli.la','mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','lista.mercadolivre.com.br'];
       return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&hosts.includes(url.hostname.toLowerCase())&&url.toString().length<2048?url:null;
      }catch{return null}
     };
     const verify=async(p)=>{
      const result={title:p.title,short_url:p.marketplace_short_url,status:'unresolved',destination_type:null,destination_url:null,product_code:null,affiliate_for_user:false,offer_verified:false};
      let url=safeTarget(p.marketplace_short_url);
      if(!url)return {...result,status:'invalid_short_url'};
      for(let hop=0;hop<4;hop++){
       if(url.hostname!=='meli.la'){
        const matched=url.pathname.match(/MLB-?(\d{7,15})/i);
        const kind=url.pathname.startsWith('/social/')?'affiliate_profile':matched?'product':'other_marketplace_page';
        return {...result,status:kind==='product'?'product_destination_found':kind==='affiliate_profile'?'affiliate_profile_found':'marketplace_page_found',destination_type:kind,destination_url:url.origin+url.pathname,product_code:matched?'MLB'+matched[1]:null};
       }
       try{
        const response=await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{'User-Agent':'FoxCore-Link-Diagnostic/1.0','Accept':'text/html'},signal:AbortSignal.timeout(3500)});
        if([401,403,429].includes(response.status))return {...result,status:'provider_blocked',http_status:response.status};
        if(response.status<300||response.status>=400)return {...result,status:response.ok?'short_link_no_redirect':'provider_http_error',http_status:response.status};
        const location=response.headers.get('location');
        if(!location)return {...result,status:'redirect_missing_location'};
        const next=safeTarget(new URL(location,url).toString());
        if(!next)return {...result,status:'redirect_to_unapproved_host'};
        url=next;
       }catch{return {...result,status:'network_error'}}
      }
      return {...result,status:'redirect_hop_limit'};
     };
     const checks=await Promise.all(selection.map(verify));
     structured.link_validation={diagnostic_only:true,checked:checks.length,total_short_links:items.length,batch,batch_size:5,next_batch:(batch+1)*5<items.length?batch+1:null,checks,imported:0,affiliate_link_generated:false};
    }
    const jsonLd=(html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/gi)||[]).length;
    return res.json({ok:true,source,http_status:response.status,html_accessible:accessible,html_bytes:html.length,anchor_count:anchors.length,mercado_livre_link_count:mlLinks.length,redirect_link_count:redirectLinks.length,script_count:scripts.length,script_sources:scriptSources,inline_script_count:inlineScriptCount,framework,data_signals:dataSignals,json_ld_blocks:jsonLd,structured_data:structured,distinct_product_codes:codes.length,product_codes:codes.slice(0,15).map(code=>'MLB'+code),product_evidence:productEvidence,collection_enabled:false,items_imported:0,diagnosis:codes.length?'direct_product_codes_found':mlLinks.length?'mercado_livre_links_without_product_codes':redirectLinks.length?'intermediate_links_require_review':scripts.length?'javascript_or_indirect_links_possible':'no_product_signals_in_static_html'});
   }catch(_){return res.json({ok:true,source,html_accessible:false,collection_enabled:false,items_imported:0,reason:'source_access_failed'})}
  }
  if(req.method==='GET'){
   const rows=await db('fox_affiliate_links','GET',null,'?select=id,provider,affiliate_url,verification_status,product_id,product_url,product_title,link_type,destination_status,tracking_tool_id,featured_product_status,featured_product_checked_at,featured_product_confirmation_source,created_at&order=created_at.desc&limit=50');
   return res.json({links:rows});
  }
  if(req.method==='POST'&&req.body?.action==='confirm_featured'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   if(req.body?.confirmed!==true)return res.status(400).json({ok:false,reason:'confirmation_required'});
   const rows=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=product_url,product_title,link_type');
   if(rows.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   if(rows[0].link_type!=='affiliate_profile'||!rows[0].product_title||!rows[0].product_url)return res.status(409).json({ok:false,reason:'associate_product_first'});
   await db('fox_affiliate_links','PATCH',{featured_product_status:'manual_confirmed',featured_product_confirmed_at:new Date().toISOString(),featured_product_confirmation_source:'admin_browser_confirmation'},'?id=eq.'+id);
   return res.json({ok:true,featured_product_status:'manual_confirmed',commission_verified:false});
  }
  if(req.method==='OPTIONS')return res.status(405).end();
  if(req.method==='POST'&&req.body?.action==='check_featured'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   const rows=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=product_url,link_type,destination_url');
   if(rows.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   const item=rows[0];
   const expected=(item.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1];
   if(!expected)return res.status(409).json({ok:false,reason:'product_id_missing'});
   if(item.link_type!=='affiliate_profile'||!item.destination_url)return res.status(409).json({ok:false,reason:'profile_not_identified'});
   const url=new URL(item.destination_url);
   if(url.protocol!=='https:'||url.hostname!=='www.mercadolivre.com.br'||!/^\/social\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)||url.port||url.username||url.password)return res.status(400).json({ok:false,reason:'invalid_profile_destination'});
   let status='inconclusive',reason='product_not_visible_in_html',responseStatus=null;
   try{
    const response=await fetch(url.toString(),{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0'}});
    responseStatus=response.status;
    if([401,403,429].includes(response.status))reason='provider_blocked';
    else if(response.ok){
     const html=(await response.text()).slice(0,1500000);
     if(new RegExp('MLB-?'+expected+'(?!\\d)','i').test(html)){status='html_match';reason='product_id_found_in_html'}
    }else reason='provider_http_error';
   }catch(_){reason='profile_fetch_failed'}
   const previous=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=featured_product_status');
   if(previous[0]?.featured_product_status==='manual_confirmed')status='manual_confirmed';
   await db('fox_affiliate_links','PATCH',{featured_product_status:status,featured_product_checked_at:new Date().toISOString()},'?id=eq.'+id);
   return res.json({ok:true,featured_product_status:status,reason,http_status:responseStatus,commission_verified:false});
  }
  if(req.method==='PUT'){
   const id=String(req.body?.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   const found=await db('fox_affiliate_links','GET',null,'?id=eq.'+id+'&select=affiliate_url,product_url');
   if(found.length!==1)return res.status(404).json({ok:false,reason:'not_found'});
   const link=found[0];
   let current=link.affiliate_url,reason='redirect_not_confirmed',httpStatus=null,matched=false,linkType='unknown',profilePath=null,trackingToolId=null;
   const allowed=new Set(['meli.la','mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','lista.mercadolivre.com.br']);
   const expected=(link.product_url||'').match(/MLB-?(\d{7,15})/i)?.[1]||null;
   try{
    for(let i=0;i<7;i++){
     const u=new URL(current);
     if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed.has(u.hostname.toLowerCase())){reason='unsupported_redirect_domain';break}
     if(u.pathname.startsWith('/social/')){
      linkType='affiliate_profile';profilePath=u.origin+u.pathname;
      trackingToolId=u.searchParams.get('matt_tool')||u.searchParams.get('matt_tool_id');
      reason='affiliate_profile_detected';break;
     }
     const productMatch=u.pathname.match(/MLB-?(\d{7,15})/i);
     if(productMatch){
      linkType='direct_product';
      matched=expected?productMatch[1]===expected:false;
      reason=expected?(matched?'destination_matches_product':'different_product'):'product_id_missing';
      break;
     }
     const response=await fetch(u.toString(),{method:'GET',redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Mozilla/5.0 (compatible; FoxCoreLinkCheck/1.0)'}});
     httpStatus=response.status;
     if([401,403,429].includes(response.status)){reason='provider_blocked';break}
     if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      if(!location){reason='redirect_without_location';break}
      current=new URL(location,current).toString();
      continue;
     }
     reason=response.ok?'destination_unconfirmed':'provider_http_error';
     break;
    }
   }catch(_){reason='redirect_check_failed'}
   if(linkType==='affiliate_profile'){
    await db('fox_affiliate_links','PATCH',{link_type:'affiliate_profile',destination_url:profilePath,tracking_tool_id:trackingToolId,destination_status:'profile_detected'},'?id=eq.'+id);
   }
   return res.json({ok:true,destination_matches:matched,reason,http_status:httpStatus,link_type:linkType,profile_detected:linkType==='affiliate_profile',featured_product_verified:false,commission_verified:false,verification_status:'pending'});
  }
  if(req.method==='PATCH'){
   const id=String(req.body?.id||'');
   const product_url=String(req.body?.product_url||'').trim();
   const product_title=String(req.body?.product_title||'').trim();
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({ok:false,reason:'invalid_id'});
   let parsed;try{parsed=new URL(product_url)}catch(_){return res.status(400).json({ok:false,reason:'invalid_product_url'})}
   const host=parsed.hostname.toLowerCase();
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br'].includes(host)||product_url.length>2048||product_title.length<3||product_title.length>250)return res.status(400).json({ok:false,reason:'invalid_product_details'});
   const rows=await db('fox_affiliate_links','PATCH',{product_url,product_title,linked_at:new Date().toISOString(),verification_status:'pending'},'?id=eq.'+id+'&provider=eq.mercado_livre');
   if(!rows.length)return res.status(404).json({ok:false,reason:'link_not_found'});
   return res.json({ok:true,verification_status:'pending'});
  }
  if(req.method==='POST'){
   const url=String(req.body?.affiliate_url||'').trim();
   if(!VALID.test(url))return res.status(400).json({ok:false,reason:'invalid_affiliate_url'});
   const rows=await db('fox_affiliate_links','POST',{provider:'mercado_livre',affiliate_url:url,source:'manual_affiliate_hub',verification_status:'pending'},'?on_conflict=affiliate_url');
   return res.status(201).json({ok:true,link:rows[0]});
  }
  return res.status(405).end();
 }catch(_){return res.status(502).json({ok:false,reason:'database_unavailable'});}
};
