// Diagnóstico isolado: npm install playwright && npx playwright install chromium
// Uso: node engine/pechinchou-browser-probe.mjs offers.json
// offers.json: [{"title":"...","short_url":"https://meli.la/..."}, ...]
// Apenas leitura: não gera links, não importa e não publica.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const input=JSON.parse(await readFile(process.argv[2]||'offers.json','utf8'));
if(!Array.isArray(input)||input.length>30)throw Error('Expected up to 30 offers');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const offer of input){
  const short=String(offer.short_url||'');
  if(!/^https:\/\/meli\.la\/[A-Za-z0-9_-]{3,80}\/?$/.test(short)){results.push({short_url:short,status:'invalid_url'});continue}
  const page=await browser.newPage({acceptDownloads:false});
  try{
   await page.goto(short,{waitUntil:'domcontentloaded',timeout:18000});
   await page.waitForTimeout(1200);
   const finalUrl=page.url();
   const host=new URL(finalUrl).hostname;
   if(!['www.mercadolivre.com.br','mercadolivre.com.br','produto.mercadolivre.com.br'].includes(host)){results.push({short_url:short,status:'unapproved_destination',host});continue}
   const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(a=>({label:(a.innerText||a.getAttribute('aria-label')||'').trim().slice(0,120),href:a.href})).filter(x=>/MLB-?\d{7,15}/i.test(x.href)).slice(0,80));
   const products=[...new Map(links.map(l=>{const code=l.href.match(/MLB-?(\d{7,15})/i)?.[1];return [code,{product_code:'MLB'+code,product_url:new URL(l.href).origin+new URL(l.href).pathname,link_label:l.label}]})).values()];
   results.push({short_url:short,title:offer.title||null,status:products.length?'product_candidates_found':'no_product_links_in_dom',profile_url:new URL(finalUrl).origin+new URL(finalUrl).pathname,products,matched:false,reason:'Offer title and product identity must be independently validated'});
  }catch(e){results.push({short_url:short,status:'browser_navigation_failed',reason:String(e.message).slice(0,160)})}
  finally{await page.close()}
 }
}finally{await browser.close()}
process.stdout.write(JSON.stringify({checked:results.length,diagnostic_only:true,automatic_affiliate_generation:false,imported:0,results},null,2)+'\n');
