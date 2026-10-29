(function (global) {
  'use strict';
  function mountTraderRadarPanel(root, apiBase, options = {}) {
    if (!root) throw new Error('Container do Trader Radar não encontrado');
    const base = String(apiBase || '').replace(/\/$/, '');
    const refreshMs = Math.max(5000, Number(options.refreshMs) || 10000);
    let stopped = false, timer = null;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
    const date = n => new Date(Number(n)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    root.innerHTML = `
      <section class="trader-radar" aria-label="BTC Trader Radar">
        <style>
          .trader-radar{font-family:system-ui,-apple-system,sans-serif;color:var(--text,#f5f7fa);background:var(--panel,#10151e);border:1px solid #293241;border-radius:16px;padding:16px}
          .trader-radar *{box-sizing:border-box}.tr-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
          .tr-title{font-size:1.15rem;font-weight:750}.tr-sub{font-size:.82rem;opacity:.72;margin-top:4px}
          .tr-pill{font-size:.75rem;padding:5px 9px;border-radius:999px;background:#293241}.tr-pill.ok{background:#123d2c;color:#8ef0bb}
          .tr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}
          .tr-stat{padding:10px;border:1px solid #293241;border-radius:10px;min-width:0}.tr-stat strong{display:block;font-size:1.2rem}
          .tr-stat span{font-size:.75rem;opacity:.72}.tr-events{display:grid;gap:8px}.tr-event{border:1px solid #293241;border-radius:12px;padding:12px;display:grid;gap:7px}
          .tr-event-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.tr-direction{font-weight:800;font-size:.78rem;letter-spacing:.03em}
          .tr-long{color:#4ade80}.tr-short{color:#fb7185}.tr-meta{font-size:.8rem;opacity:.76;overflow-wrap:anywhere}
          .tr-empty,.tr-error{padding:20px;text-align:center;opacity:.8;border:1px dashed #384354;border-radius:12px}
          .tr-foot{font-size:.72rem;opacity:.6;margin-top:12px;line-height:1.45}.tr-rankings{margin:16px 0;display:grid;gap:8px}.tr-rank{border:1px solid #293241;border-radius:10px;padding:10px;display:grid;gap:5px}.tr-rank-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.tr-score{font-weight:800}.tr-chart-wrap{border:1px solid #293241;border-radius:12px;padding:10px;margin:14px 0}.tr-chart-svg{display:block;width:100%;height:auto;overflow:visible}.tr-chart-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.76rem;opacity:.82;margin-top:8px}.tr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.tr-chart-empty{padding:18px;text-align:center;opacity:.75;border:1px dashed #384354;border-radius:10px}.tr-chart-wrap{background:linear-gradient(155deg,#0d1b2b,#10151e);box-shadow:inset 0 1px rgba(255,255,255,.03)}.tr-radar-pulse{transform-box:fill-box;transform-origin:center;animation:trRadarPulse 1.25s ease-out infinite;filter:drop-shadow(0 0 5px currentColor)}@keyframes trRadarPulse{0%{r:5;opacity:1}70%{r:12;opacity:.45}100%{r:16;opacity:0}}.tr-radar-core{stroke:#10151e;stroke-width:1.5}.tr-metrics{font-size:.78rem;opacity:.78;display:flex;gap:10px;flex-wrap:wrap}
          @media(max-width:420px){.trader-radar{padding:12px}.tr-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.tr-stat{padding:8px}.tr-stat strong{font-size:1rem}}
        </style>
        <div class="tr-head"><div><div class="tr-title">₿ BTC Trader Radar</div><div class="tr-sub">Entradas, reduções e saídas públicas na Hyperliquid</div></div><span class="tr-pill" data-status>Conectando…</span></div>
        <div class="tr-stats"><div class="tr-stat"><strong data-wallets>—</strong><span>Carteiras monitoradas</span></div><div class="tr-stat"><strong data-connected>—</strong><span>Conectadas</span></div><div class="tr-stat"><strong data-count>—</strong><span>Eventos recentes</span></div></div>
        <h3>Traders com histórico observado</h3><div class="tr-sub">Ranking provisório: exige ao menos 20 operações BTC encerradas e PnL realizado positivo. Não é garantia de acerto futuro.</div><div class="tr-rankings" data-rankings><div class="tr-empty">Calculando histórico…</div></div><h3>Gráfico BTC · entradas e saídas dos 5 melhores validados</h3><div class="tr-sub">Gráfico independente do motor principal. Pontos só aparecem para traders que passaram os critérios de validação e dentro do período exibido.</div><div class="tr-chart-wrap"><div data-trader-chart><div class="tr-chart-empty">Carregando candles e operações validadas…</div></div><div class="tr-chart-legend"><span><i class="tr-dot" style="background:#4ade80"></i>Entrada LONG</span><span><i class="tr-dot" style="background:#fb7185"></i>Entrada SHORT</span><span><i class="tr-dot" style="background:#60a5fa"></i>Saída / redução</span><span><i class="tr-dot" style="background:#fbbf24"></i>Preço BTC</span></div></div><h3>Entradas e saídas recentes em BTC</h3><div class="tr-sub">Entradas mostram o preço executado de abertura; saídas e reduções mostram a execução real e o PnL realizado por fill quando disponível. Reduções parciais não são tratadas como ciclo encerrado.</div><div class="tr-events" data-events><div class="tr-empty">Carregando eventos…</div></div>
        <div class="tr-foot">Dados públicos da Hyperliquid. *Pontuação provisória, não probabilidade de acerto. Taxa observada considera apenas ciclos fechados capturados pelo radar; histórico anterior à inclusão pode estar incompleto. LONG/SHORT descreve a nova posição observada, não uma recomendação.</div>
      </section>`;
    const statusEl = root.querySelector('[data-status]'), walletsEl = root.querySelector('[data-wallets]'), connectedEl = root.querySelector('[data-connected]'), countEl = root.querySelector('[data-count]'), eventsEl = root.querySelector('[data-events]'), rankingsEl = root.querySelector('[data-rankings]'), chartEl = root.querySelector('[data-trader-chart]');
    async function renderTraderChart(el, events, eligible) {
      if (!el) return;
      try {
        const res = await fetch('https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120', { cache: 'no-store' });
        if (!res.ok) throw new Error('Candles BTC indisponíveis');
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length < 20) throw new Error('Histórico de candles insuficiente');
        const candles = rows.map(r => ({ t:Number(r[0]), o:Number(r[1]), h:Number(r[2]), l:Number(r[3]), c:Number(r[4]) })).filter(c => c.t > 0 && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0);
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
        const dots=marks.map(ev=>{const entry=ev.type==='NEW_BTC_ENTRY',green=entry?ev.direction==='LONG':ev.direction==='CLOSE_SHORT',col=green?'#4ade80':'#fb7185',cx=x(idx(Number(ev.timestamp))),cy=y(Number(ev.price)),kind=entry?(green?'COMPRA · LONG':'VENDA · SHORT'):(ev.isFullClose?'SAÍDA ':'REDUÇÃO ')+(ev.direction==='CLOSE_LONG'?'LONG':'SHORT'),label=(ev.trader||ev.wallet||'Trader')+' · '+kind+' · '+new Date(Number(ev.timestamp)).toLocaleString('pt-BR')+' · '+money(ev.price);return '<g><circle class="tr-radar-pulse" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="5" fill="'+col+'"/><circle class="tr-radar-core" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="4.5" fill="'+col+'"><title>'+esc(label)+'</title></circle></g>';}).join('');
        let livePrice=candles[candles.length-1].c;
        try { const tr=await fetch('https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT',{cache:'no-store'}); if(tr.ok){const q=await tr.json();if(Number(q.price)>0)livePrice=Number(q.price);} } catch (_) {}
        const note=eligible.length?'Mostrando '+Math.min(5,eligible.length)+' trader(s) validados · '+marks.length+' operação(ões) no período':'Candles BTC ao vivo · aguardando histórico suficiente para validar traders';
        el.innerHTML='<div class="tr-metrics"><span><i class="tr-live-dot"></i> BTC · CANDLES 1 MIN</span><strong>'+money(livePrice)+'</strong><span>Atualizado '+new Date().toLocaleTimeString('pt-BR')+'</span></div><svg class="tr-chart-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Candles de Bitcoin com operações dos cinco traders mais bem classificados">'+grid+candleSvg+dots+'<text x="'+L+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10">'+new Date(first).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</text><text x="'+(W-R)+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10" text-anchor="end">AGORA</text></svg><div class="tr-chart-legend"><span><i class="tr-dot" style="background:#4ade80"></i>Compra / saída SHORT</span><span><i class="tr-dot" style="background:#fb7185"></i>Venda / saída LONG</span></div><div class="tr-meta">'+note+'. A marcação depende da chegada da execução pública da Hyperliquid.</div>';
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
        walletsEl.textContent = s.watchedWallets ?? 0; connectedEl.textContent = s.connectedWallets ?? 0; countEl.textContent = e.events?.length ?? 0;
        const allTraders = r.traders||r.rankings||[];
        const eligible = allTraders.filter(t=>t.eligibleForRanking).slice(0,5);
        const candidates = allTraders.filter(t=>String(t.source||'').toLowerCase().includes('leaderboard')).sort((a,b)=>Number(b.monthPnl||0)-Number(a.monthPnl||0)).slice(0,10);
        const candidateHtml = candidates.length ? '<h4 style="margin:12px 0 4px">Candidatos do leaderboard público</h4><div class="tr-sub">Filtrados por patrimônio e PnL semanal, mensal e histórico positivos. Isso não comprova taxa de acerto.</div>'+candidates.map((t,i)=>'<article class="tr-rank"><div class="tr-rank-head"><strong> Candidato '+(i+1)+' · '+esc(t.displayName||t.address.slice(0,6)+'…'+t.address.slice(-4))+'</strong><span class="tr-pill">Não validado</span></div><div class="tr-metrics"><span>PnL 7d: '+esc(money(t.weekPnl))+'</span><span>PnL 30d: '+esc(money(t.monthPnl))+'</span><span>PnL histórico: '+esc(money(t.allTimePnl))+'</span><span>Patrimônio: '+esc(money(t.accountValue))+'</span></div><div class="tr-meta">'+esc(t.address)+'</div></article>').join('') : '';
        rankingsEl.innerHTML = (eligible.length ? '<h4 style="margin:4px 0">Traders validados pelo histórico observado</h4>'+eligible.map((t,i)=>'<article class="tr-rank"><div class="tr-rank-head"><strong>#'+(i+1)+' '+esc(t.displayName||t.address.slice(0,6)+'…'+t.address.slice(-4))+'</strong><span class="tr-score">'+esc(t.score)+'/100*</span></div><div class="tr-metrics"><span>Acerto observado: '+esc(((t.performance.winRate||0)*100).toFixed(1))+'%</span><span>Operações fechadas: '+esc(t.performance.closedTrades)+'</span><span>PnL realizado: '+esc(money(t.performance.realizedPnl))+'</span><span>Profit factor: '+esc(t.performance.profitFactorCapped?'≥'+Number(t.performance.profitFactor).toFixed(2):t.performance.profitFactor==null?'—':Number(t.performance.profitFactor).toFixed(2))+'</span></div><div class="tr-meta">'+esc(t.address)+'</div></article>').join('') : '<div class="tr-empty">Ainda não há histórico observado suficiente para declarar traders validados.</div>')+candidateHtml;
        renderTraderChart(chartEl, e.events||[], eligible);
        if (!e.events?.length) eventsEl.innerHTML = '<div class="tr-empty">Nenhuma entrada ou saída de BTC registrada ainda. O painel atualiza automaticamente.</div>';
        else eventsEl.innerHTML = e.events.map(ev => {
          const isEntry = ev.type === 'NEW_BTC_ENTRY';
          const isLong = ev.direction === 'LONG' || ev.direction === 'CLOSE_LONG';
          const label = isEntry ? (isLong ? '▲ NOVA ENTRADA LONG' : '▼ NOVA ENTRADA SHORT') : ((ev.isFullClose ? '■ SAÍDA TOTAL ' : '↘ REDUÇÃO ') + (isLong ? 'LONG' : 'SHORT'));
          const pnl = ev.closedPnl === null || ev.closedPnl === undefined ? '' : '<div class="tr-meta">PnL realizado nesta execução: '+esc(money(ev.closedPnl))+'</div>';
          return '<article class="tr-event"><div class="tr-event-top"><span class="tr-direction '+(isLong?'tr-long':'tr-short')+'">'+label+'</span><span class="tr-meta">'+esc(date(ev.timestamp))+'</span></div><strong>'+esc(ev.trader||ev.wallet||'Carteira')+'</strong><div>'+esc(money(ev.notionalUsd))+' <span class="tr-meta">notional estimado · '+esc(ev.size)+' BTC</span></div><div class="tr-meta">Preço executado: '+esc(money(ev.price))+'</div>'+pnl+'<div class="tr-meta">Carteira: '+esc(ev.wallet||'')+'</div></article>';
        }).join('');
      } catch (err) {
        statusEl.textContent = 'Falha ao atualizar'; statusEl.className = 'tr-pill';
        eventsEl.innerHTML = '<div class="tr-error">'+esc(err.message)+'<br><span class="tr-meta">Confira a disponibilidade do backend e tente novamente.</span></div>';
      } finally { if (!stopped) timer = setTimeout(refresh,refreshMs); }
    }
    refresh();
    return { refresh, destroy(){stopped=true;clearTimeout(timer);root.innerHTML='';} };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { mountTraderRadarPanel };
  global.mountTraderRadarPanel = mountTraderRadarPanel;
})(typeof window !== 'undefined' ? window : globalThis);
