# BTC Cycle Desk — Push Backend

Backend de notificações Web Push e monitoramento informativo de sinais BTC para o **BTC Cycle Desk — by Daniel Meneghelli**.

## Incluído
- API de inscrição e cancelamento de inscrição Web Push.
- Monitoramento de mercado em intervalos configuráveis (padrão: 15 minutos).
- Notificação quando o sinal heurístico do servidor muda entre `COMPRA POTENCIAL`, `AGUARDAR` e `VENDA POTENCIAL`.
- Endpoint de saúde `/health` e endpoints administrativos protegidos por segredo.
- Blueprint `render.yaml` para iniciar a implantação no Render e `Dockerfile` para outros hosts compatíveis.

**Importante:** o monitor do servidor usa uma heurística própria (EMA20/EMA50, RSI e volume), que pode divergir do score detalhado do dashboard. Alertas são informativos, não são recomendações personalizadas nem garantem resultados. O serviço não executa ordens e não usa chaves de trading.

## Implantar no Render
1. Descompacte este projeto e envie a pasta `btc-cycle-push-backend` para um repositório privado no GitHub.
2. No Render, crie um Blueprint a partir desse repositório e confirme o serviço `btc-cycle-desk-push`.
3. Gere um par de chaves VAPID localmente com `npx web-push generate-vapid-keys` (requer Node.js e npm). Não envie a chave privada para o GitHub.
4. No painel do Render, preencha `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` com o par gerado. Troque `VAPID_SUBJECT` por um `mailto:` real de contato.
5. Aguarde a implantação e teste `https://SEU-SERVICO.onrender.com/health`. Verifique `ok: true` e `pushReady: true`.
6. Copie a URL HTTPS pública do serviço para a configuração `PUSH_API_BASE` do dashboard e use a chave pública VAPID em `PUSH_VAPID_PUBLIC_KEY`.
7. Teste primeiro em um dispositivo de teste: abra o dashboard, clique em **Ativar alertas**, conceda permissão e confirme o número de inscritos em `/health`.

O blueprint usa plano pago com disco persistente porque as inscrições de dispositivos e o último sinal precisam sobreviver a reinicializações e novas implantações. Confira preços e disponibilidade no painel do Render antes de confirmar.

## Variáveis de ambiente
- `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`: par VAPID gerado por `npx web-push generate-vapid-keys`.
- `VAPID_SUBJECT`: endereço de contato `mailto:` real.
- `ADMIN_SECRET`: segredo longo; o Blueprint gera um valor automaticamente.
- `ALLOWED_ORIGIN`: origem exata do dashboard publicado.
- `DATA_DIR`: diretório no disco persistente.
- `POLL_MINUTES`: intervalo de monitoramento; mínimo 5 minutos.
- `PORT`: fornecido pelo host.

Nunca publique `.env`, `VAPID_PRIVATE_KEY` ou `ADMIN_SECRET`, nem os coloque no HTML do dashboard.

## Rodar localmente
```bash
npm install
cp .env.example .env
npx web-push generate-vapid-keys
# Configure as chaves no .env antes de iniciar
npm start
```
Teste `http://localhost:8080/health`.

## Endpoints
- `GET /health`
- `GET /api/push/public-key`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `GET /api/market/signal`
- `POST /api/admin/notify` (requer `Authorization: Bearer <ADMIN_SECRET>`)
- `POST /api/admin/check-now` (requer `Authorization: Bearer <ADMIN_SECRET>`)

## Integração com o dashboard
Após a hospedagem, configurar `PUSH_API_BASE` com a URL HTTPS do backend (sem barra final) e `PUSH_VAPID_PUBLIC_KEY` com a chave pública VAPID. O HTML atual já contém os pontos de integração, mas mantém esses valores vazios até a URL e as chaves reais existirem.

Em iPhone, Web Push exige iOS/iPadOS compatível e normalmente que o site seja adicionado à Tela de Início e aberto como web app. O usuário precisa conceder permissão. O comportamento deve ser testado no dispositivo real.
