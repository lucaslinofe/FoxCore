# FoxCore — estrutura Manus → link de afiliado (preparação)
Status: **somente estrutura de código**. Não há integração Manus configurada, nem API oficial de conversão validada. Não executar conversões, coleta ou publicações automaticamente.

## Estados
pending_manus → pending_review → pending_conversion → pending_attribution_verification → ready_for_approval.

## Contrato de retorno Manus
O FoxCore deve enviar `job_id`, `offer_id` e `storefront_url` ao agente por integração autorizada. O agente devolve:
```json
{"job_id":"<id recebido>","product_url":"https://produto.mercadolivre.com.br/MLB-3203273995-exemplo","product_title":"Título do anúncio","evidence":"Descrição verificável do CTA e do anúncio"}
```
O código valida domínio, HTTPS, ID MLB e vínculo do job. Uma evidência textual **não comprova** que o anúncio está correto: exige revisão.

## Conversão
`exportBatch` produz lista ordenada com `job_id` e URL individual para o gerador de produtos recomendados. A etiqueta escolhida no gerador é `raposacacadora`. A associação dos links retornados **não deve ser feita somente pela posição na lista**: verificar correspondência de anúncio e atribuição antes de avançar. `importAffiliate` apenas registra um candidato, não certifica comissão.

## Próximas integrações (não implementadas)
1. Fila persistente com RLS/controle de acesso, idempotência e auditoria.
2. Envio assíncrono ao Manus e callback autenticado por assinatura, proteção contra replay e retries limitados.
3. Conversor por método autorizado pelo Mercado Livre; não simular API oficial inexistente.
4. Validação da atribuição da conta, associação produto↔link e aprovação humana antes da publicação.
5. Testes ponta a ponta com produtos reais e confirmação de comissão no painel.

Não salvar cookies, tokens, credenciais ou links sensíveis em logs. Respeitar CAPTCHA, 403 e políticas de terceiros. Manter `dry_run=true`, `mining_enabled=false` e `publishing_enabled=false` até autorização expressa.
