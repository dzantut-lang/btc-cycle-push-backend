# BTC Cycle Desk — Push Backend

Backend do BTC Cycle Desk / BTC Cycle Intelligence. O serviço oferece endpoints de saúde, inscrições Web Push e o Trader Radar informativo da Hyperliquid.

## Estado e segurança
- O monitor de mercado do servidor usa uma heurística legada com candles diários (EMA20/EMA50, RSI e volume). **Ela não é o motor oficial do dashboard e não deve ser usada como fonte dos sinais exibidos no app.**
- Alertas automáticos de compra/venda do monitor legado estão intencionalmente suprimidos para evitar divergência com o painel.
- A inscrição Web Push é recusada com HTTP 503 quando o envio VAPID não está configurado; endpoint e chaves da inscrição são validados e inscrições repetidas do mesmo endpoint são substituídas.
- O Trader Radar acompanha eventos observados na API pública da Hyperliquid. Isso não constitui recomendação de investimento nem representa o histórico completo de uma conta.
- O backend não executa ordens e não utiliza chaves de trading.

## Requisitos para ativar Web Push
1. Configure um par VAPID válido no Render (`VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`) gerado localmente com `npx web-push generate-vapid-keys`.
2. Defina `VAPID_SUBJECT` com um endereço de contato real, por exemplo `mailto:contato@seudominio.com`.
3. Configure armazenamento persistente para `DATA_DIR`. O serviço atualmente usa arquivos locais; em ambiente sem disco persistente, inscrições e estado podem ser perdidos em reinicializações ou deploys.
4. Teste `/health` e `/api/push/public-key`; em seguida configure a URL HTTPS do backend e a chave pública no dashboard e teste em um dispositivo real.
5. Só reative notificações de sinais do mercado quando o dashboard e o backend consumirem o mesmo contrato de sinal oficial, com autenticação, deduplicação e testes de integração.

**Não coloque `VAPID_PRIVATE_KEY`, `ADMIN_SECRET` ou arquivos `.env` no GitHub nem no HTML do dashboard.** Não altere o plano do Render nem crie recursos pagos sem verificar os custos no painel.

## Variáveis de ambiente
- `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`: par VAPID.
- `VAPID_SUBJECT`: endereço `mailto:` real ou subject válido suportado por Web Push.
- `ADMIN_SECRET`: segredo longo para endpoints administrativos.
- `ALLOWED_ORIGIN`: origem do dashboard publicado.
- `DATA_DIR`: diretório usado para arquivos de estado e inscrições; precisa estar em armazenamento persistente para sobreviver a reinicializações.
- `POLL_MINUTES`: intervalo de monitoramento (mínimo 5 minutos).
- `PORT`: porta fornecida pelo host.

## Endpoints
- `GET /health`
- `GET /api/push/public-key`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `GET /api/market/signal` (heurística legada; não sincronizada com o motor oficial do app)
- `POST /api/admin/notify` (requer `Authorization: Bearer <ADMIN_SECRET>`)
- `POST /api/admin/check-now` (requer `Authorization: Bearer <ADMIN_SECRET>`)

## iPhone
Web Push exige versão compatível de iOS/iPadOS e normalmente que o site seja adicionado à Tela de Início e aberto como web app. O usuário precisa conceder permissão. Teste a entrega real no dispositivo antes de considerar o recurso operacional.
