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
          .tr-foot{font-size:.72rem;opacity:.6;margin-top:12px;line-height:1.45}.tr-rankings{margin:16px 0;display:grid;gap:8px}.tr-rank{border:1px solid #293241;border-radius:10px;padding:10px;display:grid;gap:5px}.tr-rank-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.tr-score{font-weight:800}.tr-chart-wrap{border:1px solid #293241;border-radius:12px;padding:10px;margin:14px 0}.tr-chart-svg{display:block;width:100%;height:auto;overflow:visible}.tr-chart-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.76rem;opacity:.82;margin-top:8px}.tr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.tr-chart-empty{padding:18px;text-align:center;opacity:.75;border:1px dashed #384354;border-radius:10px}.tr-metrics{font-size:.78rem;opacity:.78;display:flex;gap:10px;flex-wrap:wrap}
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
        const res = await fetch('https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90', { cache: 'no-store' });
        if (!res.ok) throw new Error('Candles BTC indisponíveis');
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length < 10) throw new Error('Histórico de candles insuficiente');
        const candles = rows.map(r => ({ t: Number(r[0]), c: Number(r[4]) })).filter(r => r.t > 0 && r.c > 0);
        const allowed = new Set(eligible.map(t => String(t.address).toLowerCase()));
        const marks = events.filter(ev => allowed.has(String(ev.wallet || '').toLowerCase()) && Number(ev.timestamp) > 0 && Number(ev.price) > 0 && Number(ev.timestamp) >= candles[0].t && Number(ev.timestamp) <= candles[candles.length - 1].t + 86400000);
        const W = 760, H = 300, L = 58, R = 14, T = 16, B = 30, innerW = W - L - R;
        const prices = candles.map(c => c.c).concat(marks.map(e => Number(e.price)));
        const min = Math.min(...prices) * 0.995, max = Math.max(...prices) * 1.005, range = max - min || 1;
        const x = t => L + ((t - candles[0].t) / (candles[candles.length - 1].t - candles[0].t || 1)) * innerW;
        const y = p => T + (max - p) / range * (H - T - B);
        const path = candles.map((c, i) => (i ? 'L' : 'M') + x(c.t).toFixed(1) + ',' + y(c.c).toFixed(1)).join(' ');
        const grid = [0, 1, 2, 3].map(i => {
          const p = max - range * i / 3, yy = y(p);
          return '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="#293241"/><text x="' + (L - 7) + '" y="' + (yy + 4) + '" fill="#aab4c4" font-size="10" text-anchor="end">' + Math.round(p).toLocaleString('en-US') + '</text>';
        }).join('');
        const dots = marks.map(ev => {
          const entry = ev.type === 'NEW_BTC_ENTRY';
          const long = ev.direction === 'LONG' || ev.direction === 'CLOSE_LONG';
          const color = entry ? (long ? '#4ade80' : '#fb7185') : '#60a5fa';
          const cx = x(Number(ev.timestamp)), cy = y(Number(ev.price));
          const kind = entry ? (long ? 'ENTRADA LONG' : 'ENTRADA SHORT') : ((ev.isFullClose ? 'SAÍDA ' : 'REDUÇÃO ') + ev.direction);
          const label = (ev.trader || ev.wallet || 'Trader') + ' · ' + kind + ' · ' + new Date(Number(ev.timestamp)).toLocaleString('pt-BR') + ' · $' + Number(ev.price).toLocaleString('en-US');
          return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="' + color + '" stroke="#10151e" stroke-width="1.5"><title>' + esc(label) + '</title></circle>';
        }).join('');
        const note = eligible.length + ' trader(s) validados · ' + marks.length + ' evento(s) no período' + (eligible.length < 5 ? ' · ainda não há cinco traders validados; candidatos não comprovados ficam fora do gráfico' : '');
        el.innerHTML = '<svg class="tr-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Preço do Bitcoin com entradas e saídas observadas dos cinco traders validados">' + grid + '<path d="' + path + '" fill="none" stroke="#fbbf24" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' + dots + '<text x="' + L + '" y="' + (H - 8) + '" fill="#aab4c4" font-size="10">' + new Date(candles[0].t).toLocaleDateString('pt-BR') + '</text><text x="' + (W - R) + '" y="' + (H - 8) + '" fill="#aab4c4" font-size="10" text-anchor="end">' + new Date(candles[candles.length - 1].t).toLocaleDateString('pt-BR') + '</text></svg><div class="tr-meta">' + note + '</div>';
      } catch (err) {
        el.innerHTML = '<div class="tr-chart-empty">' + esc(err.message || 'Não foi possível carregar o gráfico BTC') + '</div>';
      }
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
