/**
 * FoxCore — teste de recuperação de destino público em vitrine Mercado Livre.
 * Não contorna verificações de acesso nem gera links de afiliado.
 * Uso: node scripts/extrair-produto.js https://www.mercadolivre.com.br/social/pp20250311151339
 */
const { chromium } = require('playwright');
const KEYS=['go','url','redirect','redirect_url','target','destination','dest'];
const HOST=/(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|mercadolibre\.com\.br)$/i;
const PRODUCT=/\/(?:p\/MLB\d{7,15}|MLB-?\d{7,15}(?:[-/?]|$)|[^/?]+-MLB-?\d{7,15}(?:[-/?]|$))/i;
function safeUrl(value,base) {
  const u=new URL(value,base);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('URL insegura');
  const h=u.hostname.toLowerCase();
  if(h==='localhost'||h.endsWith('.local')||h.endsWith('.localhost')||h==='[::1]'||
     /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(h)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(h))
    throw Error('Host privado');
  return u;
}
function extrairDestino(raw,base){
  let url=safeUrl(raw,base);
  for(let i=0;i<6;i++){
    const next=KEYS.map(k=>url.searchParams.get(k)).find(Boolean);
    if(!next)break;
    let parsed;try{parsed=safeUrl(next,url)}catch{break}
    if(parsed.href===url.href)break;
    url=parsed;
  }
  return url.href;
}
function produto(url){
  try{const u=safeUrl(url);return HOST.test(u.hostname)&&PRODUCT.test(u.pathname)}catch{return false}
}
function desafio(pageText){
  return /verifique que voc[eê] [eé] humano|captcha|verifica[cç][aã]o de seguran[cç]a|access denied/i.test(pageText);
}
async function extrairProduto(vitrine){
  const source=safeUrl(vitrine);
  if(!HOST.test(source.hostname)||!/^\/social\//.test(source.pathname))throw Error('A origem deve ser uma vitrine social do Mercado Livre');
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'pt-BR',viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const vistos=new Map();
  const observar=(raw,base,origem)=>{
    try{const url=extrairDestino(raw,base);if(produto(url))vistos.set(url,{url,origem})}catch{}
  };
  context.on('page',p=>{p.on('framenavigated',f=>{if(f===p.mainFrame())observar(f.url(),source.href,'navegacao_nova_aba')})});
  page.on('framenavigated',f=>{if(f===page.mainFrame())observar(f.url(),source.href,'navegacao')});
  try{
    const response=await page.goto(source.href,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    const body=(await page.locator('body').innerText({timeout:6000}).catch(()=>'' )).slice(0,4000);
    if(desafio(body))return {status:'acesso_bloqueado',http_status:response?.status()||null,acessoConfirmado:false};
    const anchors=await page.locator('a[href]').evaluateAll(els=>els.slice(0,300).map(e=>({href:e.getAttribute('href'),text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,160)})));
    for(const a of anchors)observar(a.href,page.url(),'href');
    // Só aciona automaticamente um único controle inequivocamente identificado.
    const controls=page.getByRole('link',{name:/^(ir para produto|ver produto|comprar produto)$/i});
    const buttons=page.getByRole('button',{name:/^(ir para produto|ver produto|comprar produto)$/i});
    const total=await controls.count()+await buttons.count();
    if(!vistos.size&&total===1){
      const target=await controls.count()?controls.first():buttons.first();
      await target.click({timeout:8000}).catch(()=>{});
      await page.waitForTimeout(1800);
      observar(page.url(),source.href,'clique');
      for(const p of context.pages())observar(p.url(),source.href,'nova_aba');
      for(const p of context.pages()){
        const links=await p.locator('a[href]').evaluateAll(els=>els.slice(0,100).map(e=>e.getAttribute('href'))).catch(()=>[]);
        for(const href of links)observar(href,p.url(),'apos_clique');
      }
    }
    const candidatos=[...vistos.values()];
    if(candidatos.length===1)return {status:'link_recuperado',...candidatos[0],acessoConfirmado:false,produtoValidado:false,afiliadoGerado:false};
    if(candidatos.length>1)return {status:'ambiguo',candidatos:candidatos.slice(0,20),produtoValidado:false};
    return {status:total>1?'ambiguo':'nao_encontrado',motivo:total>1?'Múltiplos controles: seleção manual necessária':'Nenhum destino de anúncio individual encontrado',http_status:response?.status()||null,produtoValidado:false};
  }finally{await browser.close()}
}
if(require.main===module){
  const url=process.argv[2];
  if(!url){console.error('Uso: node scripts/extrair-produto.js <URL-vitrine>');process.exit(1)}
  extrairProduto(url).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(JSON.stringify({status:'erro',motivo:e.message}));process.exitCode=1});
}
module.exports={extrairDestino,extrairProduto,produto};
