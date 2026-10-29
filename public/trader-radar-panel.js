(function (global) {
  'use strict';
  function mountTraderRadarPanel(root, apiBase, options = {}) {
    if (!root) throw new Error('Container do Trader Radar não encontrado');
    const base = String(apiBase || '').replace(/\/$/, '');
    const refreshMs = Math.max(5000, Number(options.refreshMs) || 15000);
    let stopped = false, timer = null;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
    const date = n => new Date(Number(n)).toLocaleString();
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
          .tr-foot{font-size:.72rem;opacity:.6;margin-top:12px;line-height:1.45}.tr-rankings{margin:16px 0;display:grid;gap:8px}.tr-rank{border:1px solid #293241;border-radius:10px;padding:10px;display:grid;gap:5px}.tr-rank-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.tr-score{font-weight:800}.tr-metrics{font-size:.78rem;opacity:.78;display:flex;gap:10px;flex-wrap:wrap}
          @media(max-width:420px){.trader-radar{padding:12px}.tr-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.tr-stat{padding:8px}.tr-stat strong{font-size:1rem}}
        </style>
        <div class="tr-head"><div><div class="tr-title">₿ BTC Trader Radar</div><div class="tr-sub">Novas entradas públicas na Hyperliquid</div></div><span class="tr-pill" data-status>Conectando…</span></div>
        <div class="tr-stats"><div class="tr-stat"><strong data-wallets>—</strong><span>Carteiras monitoradas</span></div><div class="tr-stat"><strong data-connected>—</strong><span>Conectadas</span></div><div class="tr-stat"><strong data-count>—</strong><span>Eventos recentes</span></div></div>
        <h3>Traders com histórico observado</h3><div class="tr-sub">Ranking provisório: exige ao menos 20 operações BTC encerradas e PnL realizado positivo. Não é garantia de acerto futuro.</div><div class="tr-rankings" data-rankings><div class="tr-empty">Calculando histórico…</div></div><h3>Entradas recentes em BTC</h3><div class="tr-events" data-events><div class="tr-empty">Carregando eventos…</div></div>
        <div class="tr-foot">Dados públicos da Hyperliquid. *Pontuação provisória, não probabilidade de acerto. Taxa observada considera apenas ciclos fechados capturados pelo radar; histórico anterior à inclusão pode estar incompleto. LONG/SHORT descreve a nova posição observada, não uma recomendação.</div>
      </section>`;
    const statusEl = root.querySelector('[data-status]'), walletsEl = root.querySelector('[data-wallets]'), connectedEl = root.querySelector('[data-connected]'), countEl = root.querySelector('[data-count]'), eventsEl = root.querySelector('[data-events]'), rankingsEl = root.querySelector('[data-rankings]');
    async function refresh() {
      if (stopped) return;
      try {
        const [sRes,eRes,rRes] = await Promise.all([fetch(base+'/api/trader-radar/status',{cache:'no-store'}),fetch(base+'/api/trader-radar/events?limit=50',{cache:'no-store'}),fetch(base+'/api/trader-radar/rankings',{cache:'no-store'})]);
        if (!sRes.ok || !eRes.ok || !rRes.ok) throw new Error('API indisponível (HTTP '+(!sRes.ok?sRes.status:!eRes.ok?eRes.status:rRes.status)+')');
        const s = await sRes.json(), e = await eRes.json(), r = await rRes.json();
        statusEl.textContent = !s.running ? 'Monitor parado' : s.lastError ? 'Atenção: fonte indisponível' : Number(s.connectedWallets)>0 ? 'Monitor ativo' : 'Aguardando conexões';
        statusEl.className = 'tr-pill'+(s.running&&!s.lastError&&Number(s.connectedWallets)>0?' ok':'');
        walletsEl.textContent = s.watchedWallets ?? 0; connectedEl.textContent = s.connectedWallets ?? 0; countEl.textContent = e.events?.length ?? 0;
        const eligible = (r.rankings||[]).filter(t=>t.eligibleForRanking).slice(0,10);
        rankingsEl.innerHTML = eligible.length ? eligible.map((t,i)=>'<article class="tr-rank"><div class="tr-rank-head"><strong>#'+(i+1)+' '+esc(t.displayName||t.address.slice(0,6)+'…'+t.address.slice(-4))+'</strong><span class="tr-score">'+esc(t.score)+'/100*</span></div><div class="tr-metrics"><span>Acerto observado: '+esc(((t.performance.winRate||0)*100).toFixed(1))+'%</span><span>Operações fechadas: '+esc(t.performance.closedTrades)+'</span><span>PnL realizado: '+esc(money(t.performance.realizedPnl))+'</span><span>Profit factor: '+esc(t.performance.profitFactorCapped?'≥'+Number(t.performance.profitFactor).toFixed(2):t.performance.profitFactor==null?'—':Number(t.performance.profitFactor).toFixed(2))+'</span></div><div class="tr-meta">'+esc(t.address)+'</div></article>').join('') : '<div class="tr-empty">Ainda não há carteiras com histórico suficiente para classificação. O ranking só aparece quando os fechamentos observados atenderem aos critérios.</div>';\n        if (!e.events?.length) eventsEl.innerHTML = '<div class="tr-empty">Nenhuma nova entrada de BTC registrada ainda. O painel atualiza automaticamente.</div>';
        else eventsEl.innerHTML = e.events.map(ev => {
          const isLong = ev.direction === 'LONG';
          return '<article class="tr-event"><div class="tr-event-top"><span class="tr-direction '+(isLong?'tr-long':'tr-short')+'">'+(isLong?'▲ NOVA ENTRADA LONG':'▼ NOVA ENTRADA SHORT')+'</span><span class="tr-meta">'+esc(date(ev.timestamp))+'</span></div><strong>'+esc(ev.trader||ev.wallet||'Carteira')+'</strong><div>'+esc(money(ev.notionalUsd))+' <span class="tr-meta">notional estimado · '+esc(ev.size)+' BTC</span></div><div class="tr-meta">Preço executado: '+esc(money(ev.price))+'</div><div class="tr-meta">Carteira: '+esc(ev.wallet||'')+'</div></article>';
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
