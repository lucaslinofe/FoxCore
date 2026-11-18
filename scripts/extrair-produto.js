/**
 * FoxCore — recuperação de URLs públicas de produtos em vitrines.
 * Instalação: npm install playwright && npx playwright install chromium
 * Uso: node scripts/extrair-produto.js https://exemplo.com/vitrine
 */
const { chromium } = require("playwright");

const REDIRECT_KEYS = ["go", "url", "redirect", "redirect_url", "target"];
const PRODUCT_HOSTS = /(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|mercadolibre\.com\.br)$/i;

function publicHttpUrl(raw, base) {
  const u = new URL(raw, base);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Protocolo inválido");
  if (u.username || u.password) throw new Error("Credenciais na URL");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$)/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)) throw new Error("Host privado não permitido");
  return u;
}

function extrairDestino(raw, base) {
  let url = publicHttpUrl(raw, base);
  for (let i = 0; i < 5; i++) {
    const value = REDIRECT_KEYS.map(k => url.searchParams.get(k)).find(Boolean);
    if (!value) break;
    try {
      const next = publicHttpUrl(value, url);
      if (next.href === url.href) break;
      url = next;
    } catch { break; }
  }
  return url.toString();
}

async function extrairProduto(urlDaVitrine) {
  publicHttpUrl(urlDaVitrine);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: "pt-BR" });
    await page.goto(urlDaVitrine, { waitUntil: "domcontentloaded", timeout: 60000 });
    const links = page.getByRole("link", { name: /ir para produto|ver produto|comprar produto/i });
    const count = await links.count();
    if (!count) return { status: "nao_encontrado", motivo: "Botão de produto ausente" };

    const candidatos = [];
    for (let i = 0; i < Math.min(count, 20); i++) {
      const link = links.nth(i);
      const href = await link.getAttribute("href");
      if (!href) continue;
      try {
        const url = extrairDestino(href, page.url());
        if (!PRODUCT_HOSTS.test(new URL(url).hostname)) continue;
        const titulo = (await link.getAttribute("aria-label")) ||
          (await link.locator("xpath=ancestor::*[self::article or self::li][1]").textContent().catch(() => null)) ||
          (await link.innerText());
        candidatos.push({ url, titulo: titulo?.trim().slice(0, 250) || null });
      } catch { /* Ignora URLs malformadas */ }
    }

    if (!candidatos.length) return { status: "nao_encontrado", motivo: "Nenhum destino de produto validado" };
    if (candidatos.length > 1) return { status: "ambiguo", candidatos, motivo: "Selecione o card principal explicitamente" };
    return { status: "link_recuperado", ...candidatos[0], acessoConfirmado: false };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.error("Uso: node scripts/extrair-produto.js <URL-da-vitrine>"); process.exit(1); }
  extrairProduto(url).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(JSON.stringify({ status: "erro", motivo: e.message })); process.exitCode = 1; });
}

module.exports = { extrairDestino, extrairProduto };
