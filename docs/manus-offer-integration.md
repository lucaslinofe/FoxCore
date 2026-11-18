# FOX ↔ Manus — contrato de integração de ofertas

## Objetivo
Processar ofertas previamente obtidas de uma fonte autorizada, identificar o produto real no Mercado Livre e retornar dados verificáveis ao FOX. Não executar coleta automática do Pechinchou sem autorização.

## Entrada `offer.resolve.request`
```json
{
  "request_id": "uuid",
  "source": "pechinchou",
  "source_offer_id": "identificador-estavel",
  "title": "Cuba Gourmet Para Cozinha",
  "price_brl": 88.00,
  "slug": "cuba-gourmet-para-cozinha-com-acessorios-aco-inox-201-60x42cm-carajas-pingoocasa-prata",
  "short_url": "https://meli.la/2x5LgDV",
  "source_url": null,
  "observed_at": "2026-11-18T12:00:00-03:00"
}
```

## Saída `offer.resolve.result`
```json
{
  "request_id": "uuid",
  "status": "resolved",
  "product_url": "https://www.mercadolivre.com.br/p/MLBEXEMPLO",
  "catalog_id": "MLBEXEMPLO",
  "listing_id": null,
  "evidence": [
    {"type": "observed_product_page", "url": "https://www.mercadolivre.com.br/p/MLBEXEMPLO"}
  ],
  "confidence": "verified"
}
```
Os valores EXEMPLO acima são apenas placeholders de contrato; não são produtos identificados.

## Regras obrigatórias
- Status permitidos: `resolved`, `needs_review`, `not_found`, `error`.
- `resolved` exige `product_url` observado, URL de produto e evidência verificável.
- `catalog_id` é extraído apenas de /p/MLB... observado; `listing_id` somente quando houver identificador de anúncio efetivamente observado, como wid=MLB....
- Nunca inventar URLs ou inferir que um código MLB isolado pertence à oferta.
- URLs /social/ de perfil de afiliado não são destinos de produto.
- Não seguir cegamente redirects, links internos ou URLs arbitrárias; permitir somente hosts autorizados e bloquear endereços privados/internos (SSRF).
- Deduplicar por `source + source_offer_id`, ou hash canônico de `source_url + title` quando ID ausente.
- Registrar `request_id`, timestamps, tentativas, status, evidências e erros sem credenciais.
- Repetir erros transitórios com backoff exponencial e limite de tentativas; enviar casos ambíguos para revisão humana.
- O Link Builder só recebe produtos com status `resolved`. A geração de links de afiliado exige integração permitida e autenticação apropriada.
- Tokens do Manus e demais credenciais permanecem exclusivamente no servidor; verificar autenticação e assinatura de callbacks antes de aceitar resultados.

## Estado atual
O diagnóstico fornecido indica 20 ofertas enriquecidas, 19 links meli.la e 0 destinos de produto confirmados. Os 19 redirecionamentos observados terminaram em perfil de afiliado, não em páginas de produto.

## Próximos passos
1. Localizar o código real do coletor FOX e identificar sua stack e banco de dados.
2. Implementar tabela/fila idempotente e adaptador de envio ao Manus conforme API oficial efetivamente disponível.
3. Criar endpoint de retorno autenticado, validação de URL e painel de revisão.
4. Testar com amostras autorizadas e mocks, sem ativar scraping do Pechinchou.
