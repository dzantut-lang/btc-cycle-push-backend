(function (global) {
  'use strict';
  function mountTraderRadarPanel(root, apiBase, options = {}) {
    if (!root) throw new Error('Container do Trader Radar não encontrado');
    const base = String(apiBase || '').replace(/\/$/, '');
    const refreshMs = Math.max(5000, Number(options.refreshMs) || 10000);
    let stopped = false, timer = null, chartInterval = '4h', lastChartEvents = [], lastDisplayTraders = [], lastValidated = false;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
    const date = n => new Date(Number(n)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    root.innerHTML = `
      <section class="trader-radar" aria-label="BTC Trader Radar">
        <style>
          .trader-radar{font-family:system-ui,-apple-system,sans-serif;color:var(--text,#f5f7fa);background:var(--panel,#10151e);border:1px solid #293241;border-radius:16px;padding:14px;max-width:100%;overflow:hidden}
          .trader-radar *{box-sizing:border-box}.tr-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
          .tr-title{font-size:1.15rem;font-weight:750}.tr-sub{font-size:.82rem;opacity:.72;margin-top:4px}
          .tr-pill{font-size:.75rem;padding:5px 9px;border-radius:999px;background:#293241}.tr-pill.ok{background:#123d2c;color:#8ef0bb}
          .tr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}
          .tr-stat{padding:10px;border:1px solid #293241;border-radius:10px;min-width:0}.tr-stat strong{display:block;font-size:1.2rem}
          .tr-stat span{font-size:.75rem;opacity:.72}.tr-events{display:grid;gap:8px}.tr-event{border:1px solid #293241;border-radius:12px;padding:12px;display:grid;gap:7px}
          .tr-event-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.tr-direction{font-weight:800;font-size:.78rem;letter-spacing:.03em}
          .tr-long{color:#4ade80}.tr-short{color:#fb7185}.tr-meta{font-size:.8rem;opacity:.76;overflow-wrap:anywhere}
          .tr-empty,.tr-error{padding:20px;text-align:center;opacity:.8;border:1px dashed #384354;border-radius:12px}
          .tr-foot{font-size:.72rem;opacity:.6;margin-top:12px;line-height:1.45}.tr-rankings{margin:16px 0;display:grid;gap:8px}.tr-rank{border:1px solid #293241;border-radius:10px;padding:10px;display:grid;gap:5px}.tr-rank-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.tr-score{font-weight:800}.tr-chart-wrap{border:1px solid #293241;border-radius:12px;padding:10px;margin:14px 0}.tr-chart-svg{display:block;width:100%;height:auto;overflow:visible}.tr-chart-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.76rem;opacity:.82;margin-top:8px}.tr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.tr-chart-empty{padding:18px;text-align:center;opacity:.75;border:1px dashed #384354;border-radius:10px}.tr-chart-wrap{background:linear-gradient(155deg,#0d1b2b,#10151e);box-shadow:inset 0 1px rgba(255,255,255,.03)}.tr-radar-pulse{transform-box:fill-box;transform-origin:center;animation:trRadarPulse 1.25s ease-out infinite;filter:drop-shadow(0 0 5px currentColor)}@keyframes trRadarPulse{0%{r:5;opacity:1}70%{r:12;opacity:.45}100%{r:16;opacity:0}}.tr-radar-core{stroke:#10151e;stroke-width:1.5}.tr-metrics{font-size:.78rem;opacity:.85;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.tr-chart-wrap{margin:8px 0;padding:8px;background:#081321;border-color:#24465c}.tr-chart-svg{width:100%;height:auto;display:block}.tr-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34d399;margin-right:5px;box-shadow:0 0 0 0 rgba(52,211,153,.7);animation:trLive 1.5s infinite}@keyframes trLive{70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}.tr-mini-event{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #253247}.tr-mini-event:last-child{border-bottom:0}.tr-mini-event strong{font-size:.82rem}.tr-mini-event small{display:block;opacity:.7;font-size:.72rem}.tr-chart-intervals{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.tr-chart-intervals button{border:1px solid #344256;border-radius:8px;background:#111b29;color:#dbeafe;padding:7px 11px;font:inherit;font-size:.78rem;cursor:pointer}.tr-chart-intervals button.active{background:#174e3b;border-color:#34d399;color:#d1fae5}.trader-radar h3{font-size:.96rem;margin:12px 0 6px}
          @media(max-width:420px){.trader-radar{padding:12px}.tr-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.tr-stat{padding:8px}.tr-stat strong{font-size:1rem}}
        </style>
        <div class="tr-head"><div><div class="tr-title">₿ Trader Radar · BTC</div><div class="tr-sub">Execuções ao vivo de traders monitorados na Hyperliquid</div></div><span class="tr-pill" data-status>Conectando…</span></div>
<h3>Traders monitorados</h3><div class="tr-sub">Os primeiros pontos aparecem enquanto o histórico é construído. O selo “validado” exige pelo menos 20 ciclos fechados, PnL positivo e profit factor ≥ 1,2. O ranking novo desconta taxas de execução; funding ainda não incluído.</div><div class="tr-rankings" data-rankings><div class="tr-empty">Calculando histórico…</div></div><h3>As 5 maiores posições BTC abertas agora</h3><div class="tr-sub">As bolinhas aparecem no gráfico principal, com os mesmos períodos de 4h, diário, 3D, semanal e mensal. Verde = compra/LONG; vermelho = venda/SHORT. A lista abaixo mostra as posições abertas de maior notional entre as carteiras monitoradas.</div><div data-open-positions class="tr-rankings"><div class="tr-empty">Consultando posições abertas na Hyperliquid…</div></div><h3>Gráfico detalhado de trades BTC</h3><div class="tr-sub">Histórico de candles com entradas LONG/SHORT, saídas totais e reduções parciais dos traders classificados. O gráfico principal continua mostrando as cinco maiores posições abertas ao vivo.</div><div class="tr-chart-intervals" role="group" aria-label="Período dos candles"><button type="button" data-tr-interval="1h">1 hora</button><button type="button" data-tr-interval="4h" class="active">4 horas</button><button type="button" data-tr-interval="1d">Diário</button></div><div class="tr-chart-wrap" data-trader-chart><div class="tr-chart-empty">Carregando gráfico de trades…</div></div><h3>Entradas e saídas recentes em BTC</h3><div class="tr-sub">Entradas mostram o preço executado de abertura; saídas e reduções mostram a execução real e o PnL realizado por fill quando disponível. Reduções parciais não são tratadas como ciclo encerrado.</div><div class="tr-events" data-events><div class="tr-empty">Carregando eventos…</div></div>
        <div class="tr-foot">Dados públicos da Hyperliquid. Os pontos refletem execuções observadas e podem ter atraso; não são recomendações.</div>
      </section>`;
    const statusEl = root.querySelector('[data-status]'), walletsEl = root.querySelector('[data-wallets]'), connectedEl = root.querySelector('[data-connected]'), countEl = root.querySelector('[data-count]'), eventsEl = root.querySelector('[data-events]'), rankingsEl = root.querySelector('[data-rankings]'), chartEl = root.querySelector('[data-trader-chart]'), openPositionsEl = root.querySelector('[data-open-positions]');
    async function renderTraderChart(el, events, eligible, validated = false) {
      if (!el) return;
      try {
        const res = await fetch(base+'/api/trader-radar/candles?interval='+encodeURIComponent(chartInterval)+'&limit=120', { cache: 'no-store' });
        if (!res.ok) throw new Error('Candles BTC indisponíveis na Hyperliquid');
        const payload = await res.json();
        const rows = Array.isArray(payload) ? payload : payload.candles;
        if (!Array.isArray(rows) || rows.length < 20) throw new Error('Histórico de candles insuficiente');
        const candles = rows.map(r => ({ t:Number(r.t ?? r[0]), o:Number(r.o ?? r[1]), h:Number(r.h ?? r[2]), l:Number(r.l ?? r[3]), c:Number(r.c ?? r[4]) })).filter(c => c.t > 0 && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0);
        const allowed = new Set(eligible.slice(0, 5).map(t => String(t.address).toLowerCase()));
        const first = candles[0].t, last = candles[candles.length - 1].t, now = Date.now();
        const marks = events.filter(ev => allowed.has(String(ev.wallet || '').toLowerCase()) && Number(ev.timestamp) >= first && Number(ev.timestamp) <= now + 60000 && Number(ev.price) > 0).sort((a,b) => Number(a.timestamp)-Number(b.timestamp));
        const W=760,H=320,L=66,R=16,T=18,B=30,plotW=W-L-R,plotH=H-T-B;
        const prices=candles.flatMap(c=>[c.h,c.l]).concat(marks.map(e=>Number(e.price)));
        const lo=Math.min(...prices)*0.999,hi=Math.max(...prices)*1.001,span=hi-lo||1;
        const x=i=>L+i/(candles.length-1)*plotW, y=p=>T+(hi-p)/span*plotH;
        const idx=t=>Math.max(0,Math.min(candles.length-1,Math.round((t-first)/(last-first||1)*(candles.length-1))));
        const grid=[0,1,2,3,4].map(i=>{const p=hi-span*i/4,yy=y(p);return '<line x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'" stroke="#243247"/><text x="'+(L-8)+'" y="'+(yy+4).toFixed(1)+'" fill="#9db0c7" font-size="10" text-anchor="end">'+Math.round(p).toLocaleString('en-US')+'</text>';}).join('');
        const cw=Math.max(2,Math.min(5,plotW/candles.length*.62));
        const candleSvg=candles.map((c,i)=>{const cx=x(i),up=c.c>=c.o,col=up?'#35d49a':'#fb6477',top=y(Math.max(c.o,c.c)),bottom=y(Math.min(c.o,c.c));return '<g><line x1="'+cx.toFixed(1)+'" y1="'+y(c.h).toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+y(c.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1.2"/><rect x="'+(cx-cw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+Math.max(1.5,bottom-top).toFixed(1)+'" rx=".5" fill="'+col+'"/></g>';}).join('');
        const dots=marks.map(ev=>{const entry=ev.type==='NEW_BTC_ENTRY',green=entry?ev.direction==='LONG':ev.direction==='CLOSE_SHORT',col=green?'#4ade80':'#fb7185',cx=x(idx(Number(ev.timestamp))),cy=y(Number(ev.price)),kind=entry?(green?'COMPRA · LONG':'VENDA · SHORT'):(ev.isFullClose?'SAÍDA ':'REDUÇÃO ')+(ev.direction==='CLOSE_LONG'?'LONG':'SHORT'),label=(ev.trader||ev.wallet||'Trader')+' · '+kind+' · '+new Date(Number(ev.timestamp)).toLocaleString("pt-BR")+' · '+money(ev.price);return '<g><circle class="tr-radar-pulse" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="5" fill="'+col+'"/><circle class="tr-radar-core" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="4.5" fill="'+col+'"><title>'+esc(label)+'</title></circle></g>';}).join('');
        const livePrice=candles[candles.length-1].c;
        const note=validated?'Operações dos '+Math.min(5,eligible.length)+' traders validados · '+marks.length+' evento(s) no período.':'Sem traders validados; exibindo candidatos em observação ('+marks.length+' evento(s)).';
        el.innerHTML='<div class="tr-metrics"><span><i class="tr-live-dot"></i> BTC · CANDLES '+chartInterval.toUpperCase()</span><strong>'+money(livePrice)+'</strong><span>Atualizado '+new Date().toLocaleTimeString("pt-BR")+'</span></div><svg class="tr-chart-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Candles de Bitcoin com operações dos cinco traders mais bem classificados">'+grid+candleSvg+dots+'<text x="'+L+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10">'+new Date(first).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+'</text><text x="'+(W-R)+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10" text-anchor="end">AGORA</text></svg><div class="tr-chart-legend"><span><i class="tr-dot" style="background:#4ade80"></i>Compra / saída SHORT</span><span><i class="tr-dot" style="background:#fb7185"></i>Venda / saída LONG</span></div><div class="tr-meta">'+note+'. A marcação depende da chegada da execução pública da Hyperliquid.</div>';
      } catch (err) { el.innerHTML='<div class="tr-chart-empty">'+esc(err.message || 'Não foi possível carregar candles BTC')+'</div>'; }
    }
    async function refresh() {
      if (stopped) return;
      try {
        const [sRes,eRes,rRes] = await Promise.all([fetch(base+'/api/trader-radar/status',{cache:'no-store'}),fetch(base+'/api/trader-radar/events?limit=50',{cache:'no-store'}),fetch(base+'/api/trader-radar/rankings',{cache:'no-store'})]);
        if (!sRes.ok || !eRes.ok || !rRes.ok) throw new Error('API indisponível (HTTP '+(!sRes.ok?sRes.status:!eRes.ok?eRes.status:rRes.status)+')');
        const s = await sRes.json(), e = await eRes.json(), r = await rRes.json();
        statusEl.textContent = !s.running ? 'Monitor parado' : s.lastError ? 'Atenção: fonte indisponível' : Number(s.connectedWallets)>0 ? 'Monitor ativo' : 'Aguardando conexões';
        statusEl.className = 'tr-pill'+(s.running&&!s.lastError&&Number(s.connectedWallets)>0?' ok':'');
        if (walletsEl) walletsEl.textContent = s.watchedWallets ?? 0;
        if (connectedEl) connectedEl.textContent = s.connectedWallets ?? 0;
        if (countEl) countEl.textContent = e.events?.length ?? 0;
        const allTraders = r.traders||r.rankings||[];
        const eligible = allTraders.filter(t=>t.eligibleForRanking).slice(0,5);
        const provisional = allTraders.filter(t=>String(t.source||'').toLowerCase().includes('public leaderboard')).slice(0,5);
        const displayTraders = eligible.length ? eligible : provisional;
        const validated = eligible.length > 0;
        lastChartEvents = e.events||[]; lastDisplayTraders = displayTraders; lastValidated = validated;

        rankingsEl.innerHTML = displayTraders.length ? displayTraders.map((t,i)=>'<article class="tr-rank"><div class="tr-rank-head"><strong>#'+(i+1)+' '+esc(t.displayName||t.address.slice(0,6)+'…'+t.address.slice(-4))+'</strong><span class="tr-score">'+(t.eligibleForRanking?'VALIDADO':'EM OBSERVAÇÃO')+'</span></div><div class="tr-meta">'+esc(t.performance.closedTrades||0)+' ciclos fechados observados · '+esc(money(t.performance.realizedPnl||0))+' PnL observado</div></article>').join('') : '<div class="tr-empty">Aguardando candidatos públicos da Hyperliquid. O gráfico de BTC continua ao vivo.</div>';
        if (openPositionsEl) {
          try {
            const pRes = await fetch(base+'/api/trader-radar/open-positions',{cache:'no-store'});
            const p = await pRes.json();
            if (!pRes.ok || !p || p.ok !== true) throw new Error(p && (p.message || p.error) || 'Posições indisponíveis');
            const positions = Array.isArray(p.positions) ? p.positions.slice(0,5) : [];
            openPositionsEl.innerHTML = positions.length ? positions.map((pos,i) => {
              const long = String(pos.direction).toUpperCase() === 'LONG';
              const dir = long ? '▲ COMPRA · LONG' : '▼ VENDA · SHORT';
              const entry = money(pos.entryPrice), notional = money(pos.notionalUsd);
              const pnl = pos.unrealizedPnl === null || pos.unrealizedPnl === undefined || pos.unrealizedPnl === '' ? null : Number(pos.unrealizedPnl);
              return '<article class="tr-rank"><div class="tr-rank-head"><strong>#'+(i+1)+' '+esc(pos.trader||pos.wallet||'Trader')+'</strong><span class="tr-direction '+(long?'tr-long':'tr-short')+'">'+dir+'</span></div><div class="tr-meta">Entrada: '+esc(entry)+' · Notional aberto: '+esc(notional)+'</div><div class="tr-meta">'+esc(pos.size)+' BTC'+(pnl !== null && Number.isFinite(pnl)?' · PnL não realizado: '+esc(money(pnl)):'')+(pos.leverage !== null && pos.leverage !== undefined && Number.isFinite(Number(pos.leverage))?' · alavancagem: '+esc(pos.leverage)+'×':'')+'</div></article>';
            }).join('') : '<div class="tr-empty">Nenhuma posição BTC aberta foi encontrada nas carteiras monitoradas agora.</div>';
          } catch (positionError) {
            openPositionsEl.innerHTML = '<div class="tr-empty">Não foi possível consultar as posições abertas: '+esc(positionError.message||'fonte indisponível')+'</div>';
          }
        }
        const matchingEvents = (e.events||[]).filter(ev=>displayTraders.some(t=>String(t.address).toLowerCase()===String(ev.wallet||'').toLowerCase())).slice(0,5);
        if (!matchingEvents.length) eventsEl.innerHTML = '<div class="tr-empty">Nenhuma execução recente dos traders '+(validated?'validados':'em observação')+'. As novas entradas e saídas aparecerão quando forem recebidas da Hyperliquid.</div>';
        else eventsEl.innerHTML = matchingEvents.map(ev => {
          const isEntry = ev.type === 'NEW_BTC_ENTRY';
          const isLong = ev.direction === 'LONG' || ev.direction === 'CLOSE_LONG';
          const label = isEntry ? (isLong ? '▲ NOVA ENTRADA LONG' : '▼ NOVA ENTRADA SHORT') : ((ev.isFullClose ? '■ SAÍDA TOTAL ' : '↘ REDUÇÃO ') + (isLong ? 'LONG' : 'SHORT'));
          const pnl = ev.closedPnl === null || ev.closedPnl === undefined ? '' : '<div class="tr-meta">PnL realizado nesta execução: '+esc(money(ev.closedPnl))+'</div>';
          return '<article class="tr-event"><div class="tr-event-top"><span class="tr-direction '+(isLong?'tr-long':'tr-short')+'">'+label+'</span><span class="tr-meta">'+esc(date(ev.timestamp))+'</span></div><strong>'+esc(ev.trader||ev.wallet||'Carteira')+'</strong><div>'+esc(money(ev.notionalUsd))+' <span class="tr-meta">notional estimado · '+esc(ev.size)+' BTC</span></div><div class="tr-meta">Preço executado: '+esc(money(ev.price))+'</div>'+pnl+'<div class="tr-meta">Carteira: '+esc(ev.wallet||'')+'</div></article>';
        }).join('');
        await renderTraderChart(chartEl, e.events||[], displayTraders, validated);
      } catch (err) {
        statusEl.textContent = 'Falha ao atualizar'; statusEl.className = 'tr-pill';
        eventsEl.innerHTML = '<div class="tr-error">'+esc(err.message)+'<br><span class="tr-meta">Confira a disponibilidade do backend e tente novamente.</span></div>';
      } finally { if (!stopped) timer = setTimeout(refresh,refreshMs); }
    }
    root.querySelectorAll('[data-tr-interval]').forEach(button=>button.addEventListener('click',()=>{chartInterval=button.getAttribute('data-tr-interval')||'4h';root.querySelectorAll('[data-tr-interval]').forEach(b=>b.classList.toggle('active',b===button));renderTraderChart(chartEl,lastChartEvents,lastDisplayTraders,lastValidated);}));
    refresh();
    return { refresh, destroy(){stopped=true;clearTimeout(timer);root.innerHTML='';} };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { mountTraderRadarPanel };
  global.mountTraderRadarPanel = mountTraderRadarPanel;
})(typeof window !== 'undefined' ? window : globalThis);
