#!/usr/bin/env node
/**
 * FoxCore — resolve uma oferta pública do Pechinchou até o anúncio individual
 * destacado na vitrine do Mercado Livre.
 *
 * Fluxo:
 *  1) Lê offers.url do JSON-LD da página Pechinchou.
 *  2) Segue o link meli.la até a vitrine social do Mercado Livre.
 *  3) Extrai o href do link "Ir para produto" (ou do primeiro anúncio MLB
 *     individual, se o CTA não tiver href acessível).
 *  4) Desembrulha redirecionamentos go= e remove parâmetros de rastreamento.
 *
 * Não tenta contornar CAPTCHA, Cloudflare, login ou bloqueios. Não cria links
 * de afiliado e não publica ofertas.
 *
 * Requisitos:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Uso:
 *   node scripts/pechinchou-para-mercadolivre.js \
 *     "https://pechinchou.com.br/oferta/espelho-organico-70cm-..."
 */
'use strict';

const { chromium } = require('playwright');

const PECHINCHOU_HOSTS = new Set(['pechinchou.com.br', 'www.pechinchou.com.br']);
const SHORTLINK_HOSTS = new Set(['meli.la', 'www.meli.la']);
const MERCADO_LIVRE_HOSTS = new Set([
  'mercadolivre.com.br', 'www.mercadolivre.com.br', 'produto.mercadolivre.com.br',
  'mercadolivre.com', 'www.mercadolivre.com', 'mercadolibre.com.br',
  'www.mercadolibre.com.br', 'mercadolibre.com', 'www.mercadolibre.com',
]);
const PRODUCT_ID = /MLB-?(\d{7,15})/i;
const REDIRECT_KEYS = ['go', 'url', 'redirect', 'redirect_url', 'target', 'destination', 'dest'];
const TRACKING_KEYS = /^(matt_|reco_|tracking_id$|source$|sid$|c_id$|c_uid$|tid$)/i;
const BLOCK_PAGE = /captcha|verify you are human|verifique que voc[eê] [eé] humano|verifica[cç][aã]o de seguran[cç]a|access denied|acesso negado/i;

function hostAllowed(host, set) {
  return set.has(String(host || '').toLowerCase());
}

function parseHttpsUrl(value, base) {
  const u = new URL(value, base);
  if (!['https:'].includes(u.protocol) || u.username || u.password) {
    throw new Error('URL inválida: somente HTTPS sem credenciais é aceito.');
  }
  return u;
}

function normalizePechinchouUrl(value) {
  const u = parseHttpsUrl(String(value).trim());
  try {
    // Alguns copiar/colar acrescentam caracteres invisíveis percent-encoded
    // (por exemplo U+2060) ao fim do slug, fazendo a oferta não ser encontrada.
    u.pathname = decodeURIComponent(u.pathname).replace(/\p{Cf}/gu, '');
  } catch {
    throw new Error('O caminho da URL da oferta tem codificação inválida.');
  }
  return u;
}

function unwrapRedirects(value, base) {
  let current = parseHttpsUrl(value, base);
  for (let i = 0; i < 6; i++) {
    const next = REDIRECT_KEYS.map((key) => current.searchParams.get(key)).find(Boolean);
    if (!next) break;
    let target;
    try {
      target = parseHttpsUrl(next, current);
    } catch {
      break;
    }
    if (target.href === current.href) break;
    current = target;
  }
  return current;
}

function isIndividualProductUrl(input) {
  try {
    const u = input instanceof URL ? input : new URL(input);
    if (!hostAllowed(u.hostname, MERCADO_LIVRE_HOSTS)) return false;
    const all = `${u.pathname}?${u.searchParams.toString()}#${u.hash}`;
    return PRODUCT_ID.test(all) || /\/up\/MLBU\d+/i.test(u.pathname);
  } catch {
    return false;
  }
}

function cleanProductUrl(input, base) {
  const u = unwrapRedirects(input, base);
  if (!hostAllowed(u.hostname, MERCADO_LIVRE_HOSTS) || !isIndividualProductUrl(u)) {
    throw new Error('O destino encontrado não parece ser um anúncio individual válido do Mercado Livre.');
  }

  // Preserva parâmetros potencialmente necessários para manter o anúncio ou a
  // variação selecionada; descarta IDs de afiliado, recomendação e tracking.
  const keep = new URLSearchParams();
  for (const [key, value] of u.searchParams.entries()) {
    if (TRACKING_KEYS.test(key)) continue;
    if (['pdp_filters', 'searchVariation', 'wid'].includes(key)) keep.append(key, value);
  }
  u.search = keep.toString();
  u.hash = '';
  return u.href;
}

function walkJson(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, found);
    return found;
  }
  if (value['@type'] === 'Offer' && typeof value.url === 'string') found.push(value.url);
  if (value.offers) walkJson(value.offers, found);
  if (value['@graph']) walkJson(value['@graph'], found);
  return found;
}

async function pageBodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function failOnChallenge(page, response, stage) {
  const text = await pageBodyText(page);
  const httpStatus = response?.status() ?? null;
  const challengeDetected = BLOCK_PAGE.test(text);
  if (challengeDetected || httpStatus === 403 || httpStatus === 429) {
    const error = new Error(`Acesso bloqueado durante ${stage}; nenhuma tentativa de contorno foi feita.`);
    error.code = 'access_blocked';
    error.stage = stage;
    error.httpStatus = httpStatus;
    error.blockReason = httpStatus === 403 || httpStatus === 429
      ? `http_${httpStatus}`
      : 'challenge_page';
    throw error;
  }
}

async function findPechinchouOfferUrl(page) {
  const urls = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => {
    const found = [];
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(walk);
      if (value['@type'] === 'Offer' && typeof value.url === 'string') found.push(value.url);
      if (value.offers) walk(value.offers);
      if (value['@graph']) walk(value['@graph']);
    };
    for (const script of scripts) {
      try { walk(JSON.parse(script.textContent || '')); } catch { /* ignora JSON-LD inválido */ }
    }
    return found;
  });

  for (const raw of urls) {
    try {
      const url = parseHttpsUrl(raw, page.url());
      if (hostAllowed(url.hostname, SHORTLINK_HOSTS) ||
          (hostAllowed(url.hostname, MERCADO_LIVRE_HOSTS) && isIndividualProductUrl(url))) {
        return url.href;
      }
    } catch { /* ignora URLs inválidas ou não autorizadas */ }
  }
  throw new Error('A página não expôs um destino Mercado Livre em offers.url do JSON-LD.');
}

async function firstProductAnchor(page) {
  return page.locator('a[href]').evaluateAll((anchors) => {
    for (const anchor of anchors) {
      const href = anchor.href || '';
      if (!/mercadolivre|mercadolibre/i.test(href)) continue;
      if (!/MLB-?\d{7,15}|\/up\/MLBU\d+/i.test(href)) continue;
      return { href, title: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 240) };
    }
    return null;
  });
}

async function extractProduct(pechinChouUrl, options = {}) {
  const source = normalizePechinchouUrl(pechinChouUrl);
  if (!hostAllowed(source.hostname, PECHINCHOU_HOSTS) || !source.pathname.startsWith('/oferta/')) {
    throw new Error('Informe uma URL HTTPS de oferta em pechinchou.com.br/oferta/.');
  }

  const browser = await chromium.launch({ headless: options.headless !== false });
  try {
    const context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 } });
    const offerPage = await context.newPage();
    const offerResponse = await offerPage.goto(source.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await offerPage.waitForTimeout(700);
    await failOnChallenge(offerPage, offerResponse, 'pechinchou_offer');

    const offerTitle = await offerPage.locator('h1').first().innerText({ timeout: 5000 }).catch(() => '');
    const publishedDestination = await findPechinchouOfferUrl(offerPage);
    const publishedUrl = parseHttpsUrl(publishedDestination, offerPage.url());

    // Se o JSON-LD já contiver um anúncio individual, não é preciso resolver
    // link curto ou inferir o primeiro item de uma vitrine.
    if (hostAllowed(publishedUrl.hostname, MERCADO_LIVRE_HOSTS) && isIndividualProductUrl(publishedUrl)) {
      return {
        status: 'product_link_found',
        offer_url: source.href,
        offer_title: offerTitle.trim() || null,
        published_destination: publishedUrl.href,
        product_url: cleanProductUrl(publishedUrl.href),
        product_title: offerTitle.trim() || null,
        product_id: publishedUrl.href.match(PRODUCT_ID)?.[0]?.replace('-', '').toUpperCase() || null,
      };
    }

    if (!hostAllowed(publishedUrl.hostname, SHORTLINK_HOSTS)) {
      throw new Error('O destino da oferta não é o link curto meli.la esperado.');
    }

    const meliPage = await context.newPage();
    const redirectResponse = await meliPage.goto(publishedUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await meliPage.waitForTimeout(1200);
    await failOnChallenge(meliPage, redirectResponse, 'meli_la_redirect_to_storefront');

    const landed = parseHttpsUrl(meliPage.url());
    if (!hostAllowed(landed.hostname, MERCADO_LIVRE_HOSTS)) {
      throw new Error(`O link curto terminou fora do domínio autorizado do Mercado Livre (${landed.hostname}).`);
    }

    // Uma oferta do Pechinchou pode encaminhar para um perfil social/vitrine.
    // Nela, o CTA explícito é preferível ao primeiro resultado recomendado.
    let target = null;
    const featuredAnchor = await firstProductAnchor(meliPage);
    const featuredTitle = featuredAnchor?.title && !/^ir para produto$/i.test(featuredAnchor.title)
      ? featuredAnchor.title
      : null;
    const cta = meliPage.getByRole('link', { name: /^ir para produto$/i });
    if (await cta.count()) {
      const href = await cta.first().getAttribute('href');
      if (href) {
        const resolved = parseHttpsUrl(href, meliPage.url());
        if (isIndividualProductUrl(resolved)) {
          target = { href: resolved.href, title: featuredTitle };
        }
      }
    }

    if (!target) target = featuredAnchor;
    if (!target) {
      await failOnChallenge(meliPage, redirectResponse, 'mercadolivre_featured_product');
      throw new Error('Não encontrei um link de anúncio individual na vitrine do Mercado Livre.');
    }

    const productUrl = cleanProductUrl(target.href, meliPage.url());
    const productId = productUrl.match(PRODUCT_ID)?.[0]?.replace('-', '').toUpperCase() || null;
    return {
      status: 'product_link_found',
      offer_url: source.href,
      offer_title: offerTitle.trim() || null,
      published_destination: publishedUrl.href,
      storefront_url: landed.href,
      product_title: target.title || offerTitle.trim() || null,
      product_id: productId,
      product_url: productUrl,
    };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Uso: node scripts/pechinchou-para-mercadolivre.js <URL-da-oferta>');
    process.exit(2);
  }
  extractProduct(input)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      const result = {
        status: error.code || 'error',
        stage: error.stage ?? null,
        http_status: error.httpStatus ?? null,
        block_reason: error.blockReason ?? null,
        message: error.message,
      };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { extractProduct, cleanProductUrl, isIndividualProductUrl };
