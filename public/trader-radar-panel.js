(function (global) {
  'use strict';
  function mountTraderRadarPanel(root, apiBase, options = {}) {
    if (!root) throw new Error('Container do Trader Radar não encontrado');
    const base = String(apiBase || '').replace(/\/$/, '');
    const refreshMs = Math.max(5000, Number(options.refreshMs) || 10000);
    let stopped = false, timer = null, chartInterval = '4h', chartRenderSeq = 0, lastChartEvents = [], lastDisplayTraders = [], lastValidated = false;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => Number(n).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
    const compactMoney = n => { const value = Number(n); if (!Number.isFinite(value)) return '—'; const abs = Math.abs(value); if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B'; if (abs >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M'; if (abs >= 1e4) return '$' + (value / 1e3).toFixed(1) + 'K'; return money(value); };
    const toMs = value => { if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) < 1e12 ? value * 1000 : value; if (typeof value === 'string' && value.trim() !== '') { const numeric = Number(value); if (Number.isFinite(numeric)) return Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : NaN; } return NaN; };
    const date = n => { const ms = toMs(n); if (!Number.isFinite(ms)) return 'horário indisponível'; const d = new Date(ms); return Number.isNaN(d.getTime()) ? 'horário indisponível' : d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}); };
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
          .tr-long{color:#4ade80}.tr-short{color:#fb7185}.tr-close-long{color:#f59e0b}.tr-close-short{color:#38bdf8}.tr-pnl-positive{color:#4ade80;opacity:1}.tr-pnl-negative{color:#fb7185;opacity:1}.tr-pnl-neutral{opacity:.76}.tr-meta{font-size:.8rem;opacity:.76;overflow-wrap:anywhere}
          .tr-empty,.tr-error{padding:20px;text-align:center;opacity:.8;border:1px dashed #384354;border-radius:12px}
          .tr-foot{font-size:.72rem;opacity:.6;margin-top:12px;line-height:1.45}.tr-rankings{margin:16px 0;display:grid;gap:8px}.tr-rank{border:1px solid #293241;border-radius:10px;padding:10px;display:grid;gap:5px} .tr-rank-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.tr-score{font-weight:800}.tr-flow-summary{border:1px solid #344256;border-radius:12px;padding:12px;margin:8px 0 14px;background:#0b1725}.tr-flow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.tr-flow-cell{min-width:0}.tr-flow-cell strong{display:block;font-size:.96rem;overflow-wrap:anywhere}.tr-flow-cell span{font-size:.72rem;opacity:.75}.tr-flow-bar{height:8px;display:flex;overflow:hidden;border-radius:99px;background:#293241;margin:10px 0}.tr-flow-long{background:#4ade80}.tr-flow-short{background:#fb7185}.tr-flow-bias{font-weight:800;margin-top:4px}.tr-flow-note{font-size:.74rem;opacity:.72;line-height:1.45;margin-top:8px}.tr-flow-bias{font-weight:800;margin-top:4px}.tr-flow-summary{border:1px solid #344256;border-radius:12px;padding:12px;margin:12px 0;background:#0b1725}.tr-flow-bar{height:9px;display:flex;overflow:hidden;border-radius:99px;background:#293241;margin:9px 0}.tr-flow-long{background:#35d49a}.tr-flow-short{background:#fb7185}.tr-flow-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tr-flow-stats strong{display:block;font-size:1rem}.tr-flow-stats span{font-size:.72rem;opacity:.72}.tr-chart-wrap{border:1px solid #293241;border-radius:12px;padding:10px;margin:14px 0}.tr-chart-svg{display:block;width:100%;height:auto;overflow:visible}.tr-chart-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.76rem;opacity:.82;margin-top:8px}.tr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.tr-chart-empty{padding:18px;text-align:center;opacity:.75;border:1px dashed #384354;border-radius:10px}.tr-chart-wrap{background:linear-gradient(155deg,#0d1b2b,#10151e);box-shadow:inset 0 1px rgba(255,255,255,.03)}.tr-radar-pulse{transform-box:fill-box;transform-origin:center;animation:trRadarPulse 1.25s ease-out infinite;filter:drop-shadow(0 0 5px currentColor)}@keyframes trRadarPulse{0%{r:5;opacity:1}70%{r:12;opacity:.45}100%{r:16;opacity:0}}.tr-radar-core{stroke:#10151e;stroke-width:1.5}.tr-metrics{font-size:.78rem;opacity:.85;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.tr-chart-wrap{margin:8px 0;padding:8px;background:#081321;border-color:#24465c}.tr-chart-svg{width:100%;height:auto;display:block}.tr-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34d399;margin-right:5px;box-shadow:0 0 0 0 rgba(52,211,153,.7);animation:trLive 1.5s infinite}@keyframes trLive{70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}.tr-mini-event{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #253247}.tr-mini-event:last-child{border-bottom:0}.tr-mini-event strong{font-size:.82rem}.tr-mini-event small{display:block;opacity:.7;font-size:.72rem}.tr-chart-intervals{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.tr-chart-intervals button{border:1px solid #344256;border-radius:8px;background:#111b29;color:#dbeafe;padding:7px 11px;font:inherit;font-size:.78rem;cursor:pointer}.tr-chart-intervals button.active{background:#174e3b;border-color:#34d399;color:#d1fae5}.trader-radar h3{font-size:.96rem;margin:12px 0 6px}
          @media(max-width:420px){.trader-radar{padding:12px}.tr-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.tr-stat{padding:8px}.tr-stat strong{font-size:1rem}}
        </style>
        <div class="tr-head"><div><div class="tr-title">₿ Trader Radar · BTC</div><div class="tr-sub">Execuções ao vivo de traders monitorados na Hyperliquid</div></div><span class="tr-pill" data-status>Conectando…</span></div><div class="tr-sub" data-freshness>Verificando conexão e atualização dos dados…</div>
<h3>As 5 maiores posições BTC abertas agora</h3><div class="tr-sub">Atualização automática a cada 10 segundos. A lista e o gráfico mostram somente as cinco maiores posições abertas por notional entre as carteiras monitoradas.</div><div data-open-positions class="tr-rankings"><div class="tr-empty">Consultando posições abertas na Hyperliquid…</div></div><div data-flow-summary class="tr-flow-summary"><div class="tr-meta">Calculando a concentração LONG x SHORT das cinco maiores posições…</div></div><h3>Gráfico BTC · operações atuais dos 5 maiores</h3><div class="tr-sub">Cada bolinha representa uma posição que está aberta agora: verde = LONG, vermelho = SHORT. Os marcadores ficam junto ao preço atual; toque neles para consultar trader, preço de entrada, notional, PnL e alavancagem. Não são pontos históricos de entrada.</div><div class="tr-chart-intervals" role="group" aria-label="Período dos candles"><button type="button" data-tr-interval="1h">1 hora</button><button type="button" data-tr-interval="4h" class="active">4 horas</button><button type="button" data-tr-interval="1d">Diário</button></div><div class="tr-chart-wrap" data-trader-chart><div class="tr-chart-empty">Carregando gráfico de posições…</div></div>
        <div class="tr-foot">Dados públicos da Hyperliquid. Os pontos refletem execuções observadas e podem ter atraso; não são recomendações.</div>
      </section>`;
    const statusEl = root.querySelector('[data-status]'), freshnessEl = root.querySelector('[data-freshness]'), chartEl = root.querySelector('[data-trader-chart]'), openPositionsEl = root.querySelector('[data-open-positions]'), flowSummaryEl = root.querySelector('[data-flow-summary]');
    async function renderTraderChart(positions) {
      if (!chartEl) return;
      const renderSeq = ++chartRenderSeq, intervalAtStart = chartInterval;
      try {
        const res = await fetch(base+'/api/trader-radar/candles?interval='+encodeURIComponent(intervalAtStart)+'&limit=500',{cache:'no-store'});
        if (!res.ok) throw new Error('Candles BTC indisponíveis');
        const payload = await res.json(), rows = Array.isArray(payload) ? payload : payload.candles;
        if (!Array.isArray(rows) || rows.length < 20) throw new Error('Histórico de candles insuficiente');
        const candles = rows.map(r=>({t:Number(r.t??r[0]),o:Number(r.o??r[1]),h:Number(r.h??r[2]),l:Number(r.l??r[3]),c:Number(r.c??r[4])})).filter(c=>c.t>0&&c.o>0&&c.h>0&&c.l>0&&c.c>0).sort((a,b)=>a.t-b.t);
        const W=760,H=320,L=66,R=16,T=18,B=30,plotW=W-L-R,plotH=H-T-B,first=candles[0].t,last=candles[candles.length-1].t;
        const priceValues=candles.flatMap(c=>[c.h,c.l]),lo=Math.min(...priceValues)*.999,hi=Math.max(...priceValues)*1.001,span=hi-lo||1;
        const x=i=>L+i/(candles.length-1)*plotW,y=p=>T+(hi-p)/span*plotH;
        const grid=[0,1,2,3,4].map(i=>{const p=hi-span*i/4,yy=y(p);return '<line x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'" stroke="#243247"/><text x="'+(L-8)+'" y="'+(yy+4).toFixed(1)+'" fill="#9db0c7" font-size="10" text-anchor="end">'+Math.round(p).toLocaleString('en-US')+'</text>';}).join('');
        const cw=Math.max(2,Math.min(5,plotW/candles.length*.62));
        const candleSvg=candles.map((c,i)=>{const cx=x(i),up=c.c>=c.o,col=up?'#35d49a':'#fb6477',top=y(Math.max(c.o,c.c)),bottom=y(Math.min(c.o,c.c));return '<g><line x1="'+cx.toFixed(1)+'" y1="'+y(c.h).toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+y(c.l).toFixed(1)+'" stroke="'+col+'" stroke-width="1.2"/><rect x="'+(cx-cw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+Math.max(1.5,bottom-top).toFixed(1)+'" rx=".5" fill="'+col+'"/></g>';}).join('');
        const topFive=(Array.isArray(positions)?positions:[]).filter(p=>['LONG','SHORT'].includes(String(p.direction||'').toUpperCase())).sort((a,b)=>(Number(b.notionalUsd)||0)-(Number(a.notionalUsd)||0)).slice(0,5);
        let closeEvents=[];
        try {
          const eventRes=await fetch(base+'/api/trader-radar/events?limit=100',{cache:'no-store'});
          if(eventRes.ok){
            const eventPayload=await eventRes.json();
            closeEvents=(Array.isArray(eventPayload.events)?eventPayload.events:[])
              .filter(e=>e&&e.type==='BTC_POSITION_EXIT'&&e.isFullClose===true&&['CLOSE_LONG','CLOSE_SHORT'].includes(String(e.direction||'').toUpperCase()))
              .filter(e=>{const t=toMs(e.timestamp??e.executedAt??e.time);return Number.isFinite(t)&&t>=first&&t<=last+({'1h':3600000,'4h':14400000,'1d':86400000}[intervalAtStart]||0)&&Number(e.price)>0;})
              .sort((a,b)=>toMs(b.timestamp??b.executedAt??b.time)-toMs(a.timestamp??a.executedAt??a.time))
              .slice(0,5);
          }
        } catch(_) {}
        const current=candles[candles.length-1],currentX=x(candles.length-1),currentY=y(current.c);
        const dots=topFive.map((pos,i)=>{const long=String(pos.direction).toUpperCase()==='LONG',col=long?'#4ade80':'#fb7185',px=Math.max(L+8,currentX-10-(topFive.length-1-i)*12),py=Math.max(T+8,Math.min(T+plotH-8,currentY+((i%2===0)?-8:8))),pnl=pos.unrealizedPnl===null||pos.unrealizedPnl===undefined||!Number.isFinite(Number(pos.unrealizedPnl))?'indisponível':money(Number(pos.unrealizedPnl)),label=(pos.trader||pos.wallet||'Trader')+' · '+(long?'LONG aberta':'SHORT aberta')+' · preço atual '+money(current.c)+' · entrada '+(Number(pos.entryPrice)>0?money(pos.entryPrice):'indisponível')+' · notional '+money(Number(pos.notionalUsd)||0)+' · PnL não realizado '+pnl+' · alavancagem '+(pos.leverage??'indisponível')+'x';return '<g class="tr-position-marker" data-pos-index="'+i+'" tabindex="0" role="button" aria-label="Ver detalhes da posição '+(i+1)+'"><circle class="tr-radar-pulse" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="9" fill="'+col+'" opacity=".5"/><circle class="tr-radar-core" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="7" fill="'+col+'"><title>'+esc(label)+'</title></circle><text x="'+px.toFixed(1)+'" y="'+(py-12).toFixed(1)+'" text-anchor="middle" fill="'+col+'" font-size="10" font-weight="800">#'+(i+1)+'</text></g>';}).join('');
        const exitsSvg=closeEvents.map(ev=>{
          const time=toMs(ev.timestamp??ev.executedAt??ev.time);
          let idx=0,best=Infinity;
          candles.forEach((c,i)=>{const d=Math.abs(c.t-time);if(d<best){best=d;idx=i;}});
          const px=x(idx),price=Number(ev.price),py=Math.max(T+7,Math.min(T+plotH-7,y(price)));
          const isLong=String(ev.direction).toUpperCase()==='CLOSE_LONG',col=isLong?'#f59e0b':'#38bdf8';
          const pnl=ev.closedPnl===null||ev.closedPnl===undefined?'indisponível':money(Number(ev.closedPnl));
          const label=(ev.trader||ev.wallet||'Trader')+' · '+(isLong?'LONG encerrada':'SHORT encerrada')+' · '+date(time)+' · preço '+money(price)+' · PnL realizado '+pnl;
          return '<g><path d="M '+px.toFixed(1)+' '+(py-7).toFixed(1)+' L '+(px+7).toFixed(1)+' '+py.toFixed(1)+' L '+px.toFixed(1)+' '+(py+7).toFixed(1)+' L '+(px-7).toFixed(1)+' '+py.toFixed(1)+' Z" fill="'+col+'" stroke="#081321" stroke-width="1.5"><title>'+esc(label)+'</title></path><text x="'+px.toFixed(1)+'" y="'+(py-10).toFixed(1)+'" fill="'+col+'" font-size="10" font-weight="800" text-anchor="middle">X</text></g>';
        }).join('');
        if(renderSeq!==chartRenderSeq||intervalAtStart!==chartInterval||stopped)return;
        chartEl.querySelectorAll('[data-pos-index]').forEach(marker=>{
          const showPosition=()=>{
            const pos=topFive[Number(marker.getAttribute('data-pos-index'))];
            const detail=chartEl.querySelector('[data-position-detail]');
            if(!pos||!detail)return;
            const long=String(pos.direction).toUpperCase()==='LONG';
            const pnl=pos.unrealizedPnl===null||pos.unrealizedPnl===undefined||!Number.isFinite(Number(pos.unrealizedPnl))?'indisponível':money(Number(pos.unrealizedPnl));
            detail.innerHTML='<strong>'+(long?'LONG aberta':'SHORT aberta')+' · '+esc(pos.trader||pos.wallet||'Trader')+'</strong><br>Entrada: '+esc(Number(pos.entryPrice)>0?money(pos.entryPrice):'indisponível')+' · Notional: '+esc(money(Number(pos.notionalUsd)||0))+' · PnL não realizado: '+esc(pnl)+' · Alavancagem: '+esc(pos.leverage??'indisponível')+'×';
          };
          marker.addEventListener('click',showPosition);
          marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showPosition();}});
        });
        chartEl.innerHTML='<div class="tr-metrics"><span><i class="tr-live-dot"></i> BTC · CANDLES '+intervalAtStart.toUpperCase()+'</span><strong>'+money(current.c)+'</strong><span>Atualizado '+new Date().toLocaleTimeString('pt-BR')+'</span></div><svg class="tr-chart-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Gráfico BTC com as cinco maiores posições abertas e saídas totais observadas">'+grid+candleSvg+exitsSvg+dots+'<text x="'+L+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10">'+new Date(first).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+'</text><text x="'+(W-R)+'" y="'+(H-7)+'" fill="#9db0c7" font-size="10" text-anchor="end">AGORA</text></svg><div data-position-detail class="tr-meta" aria-live="polite">Toque em uma bolinha numerada para ver os detalhes da posição.</div><div class="tr-chart-legend"><span><i class="tr-dot" style="background:#4ade80"></i>LONG aberta</span><span><i class="tr-dot" style="background:#fb7185"></i>SHORT aberta</span><span><i class="tr-dot" style="background:#f59e0b"></i>◆ LONG encerrada</span><span><i class="tr-dot" style="background:#38bdf8"></i>◆ SHORT encerrada</span></div><div class="tr-meta">'+topFive.length+' posição(ões) aberta(s) encontrada(s) entre as carteiras monitoradas (limite de 5). '+closeEvents.length+' encerramento(s) completo(s) confirmado(s) de carteiras monitoradas no período visível. Bolinhas mostram posições abertas agora; losangos com X mostram fechamentos completos observados, mesmo que a carteira já não esteja entre as cinco maiores atuais. Reduções parciais não são tratadas como encerramento. Dados públicos podem ter atraso.</div>';
      } catch(err){if(renderSeq===chartRenderSeq&&!stopped)chartEl.innerHTML='<div class="tr-chart-empty">'+esc(err.message||'Não foi possível carregar candles BTC')+'</div>';}
    }
    async function refresh() {
      if(stopped)return;
      try {
        const [sRes,pRes]=await Promise.all([fetch(base+'/api/trader-radar/status',{cache:'no-store'}),fetch(base+'/api/trader-radar/open-positions',{cache:'no-store'})]);
        if(!sRes.ok||!pRes.ok)throw new Error('API indisponível (HTTP '+(!sRes.ok?sRes.status:pRes.status)+')');
        const s=await sRes.json(),p=await pRes.json();
        statusEl.textContent=!s.running?'Monitor parado':s.lastError?'Atenção: fonte indisponível':Number(s.connectedWallets)>0?'Monitor ativo':'Aguardando conexões';
        statusEl.className='tr-pill'+(s.running&&!s.lastError&&Number(s.connectedWallets)>0?' ok':'');
        const updatedAt=Number(p.updatedAt)||0,ageSec=updatedAt?Math.max(0,Math.round((Date.now()-updatedAt)/1000)):null;
        const connectionText=Number(s.connectedWallets||0)+'/'+Number(s.watchedWallets||0)+' carteiras conectadas';
        const freshness=ageSec===null?'horário da consulta indisponível':ageSec<90?'posições consultadas há '+ageSec+' s':'ATENÇÃO: consulta há '+Math.floor(ageSec/60)+' min';
        if(freshnessEl)freshnessEl.textContent=connectionText+' · '+freshness+(p.partial?' · consulta parcial: '+Number(p.failedWallets||0)+' carteira(s) falharam':'')+(s.lastError?' · erro: '+String(s.lastError):'')+'. Atualização automática aproximada a cada 10 s.';
        if(!pRes.ok||p.ok!==true)throw new Error(p.message||p.error||'Posições indisponíveis');
        const positions=(Array.isArray(p.positions)?p.positions:[]).filter(pos=>['LONG','SHORT'].includes(String(pos.direction||'').toUpperCase())).sort((a,b)=>(Number(b.notionalUsd)||0)-(Number(a.notionalUsd)||0)).slice(0,5);
        if(openPositionsEl)openPositionsEl.innerHTML=positions.length?positions.map((pos,i)=>{const long=String(pos.direction).toUpperCase()==='LONG',dir=long?'▲ LONG':'▼ SHORT',pnl=pos.unrealizedPnl===null||pos.unrealizedPnl===undefined||!Number.isFinite(Number(pos.unrealizedPnl))?null:Number(pos.unrealizedPnl);return '<article class="tr-rank"><div class="tr-rank-head"><strong>#'+(i+1)+' '+esc(pos.trader||pos.wallet||'Trader')+'</strong><span class="tr-direction '+(long?'tr-long':'tr-short')+'">'+dir+'</span></div><div class="tr-meta">Entrada: '+esc(Number(pos.entryPrice)>0?money(pos.entryPrice):'indisponível')+' · Notional: '+esc(money(Number(pos.notionalUsd)||0))+'</div><div class="tr-meta">'+esc(pos.size)+' BTC · PnL não realizado: '+(pnl===null?'indisponível':esc(money(pnl)))+' · Alavancagem: '+(pos.leverage!==null&&pos.leverage!==undefined&&Number.isFinite(Number(pos.leverage))?esc(pos.leverage)+'×':'indisponível')+'</div></article>';}).join(''):'<div class="tr-empty">Nenhuma posição BTC aberta encontrada nas carteiras monitoradas.</div>';
        const longPositions=positions.filter(pos=>String(pos.direction).toUpperCase()==='LONG'),shortPositions=positions.filter(pos=>String(pos.direction).toUpperCase()==='SHORT');
        const longUsd=longPositions.reduce((sum,pos)=>sum+Math.max(0,Number(pos.notionalUsd)||0),0),shortUsd=shortPositions.reduce((sum,pos)=>sum+Math.max(0,Number(pos.notionalUsd)||0),0),totalUsd=longUsd+shortUsd;
        const longPct=totalUsd?longUsd/totalUsd*100:0,shortPct=totalUsd?shortUsd/totalUsd*100:0,netPct=totalUsd?(longUsd-shortUsd)/totalUsd*100:0;
        const bias=totalUsd===0?'Sem dados suficientes':Math.abs(netPct)<15?'Fluxo equilibrado':netPct>0?'Maior exposição em LONG':'Maior exposição em SHORT';
        const largest=positions.length?Math.max(...positions.map(pos=>Math.max(0,Number(pos.notionalUsd)||0))):0,concentration=totalUsd?largest/totalUsd*100:0;
        if(flowSummaryEl)flowSummaryEl.innerHTML='<div class="tr-meta">CONFLUÊNCIA DOS 5 MAIORES · EXPOSIÇÃO ABERTA</div><div class="tr-flow-bias">'+bias+' · saldo '+(netPct>0?'+':'')+netPct.toFixed(1)+'%</div><div class="tr-flow-bar"><span class="tr-flow-long" style="width:'+longPct.toFixed(2)+'%"></span><span class="tr-flow-short" style="width:'+shortPct.toFixed(2)+'%"></span></div><div class="tr-flow-stats"><div><strong style="color:#35d49a">'+money(longUsd)+'</strong><span>LONG · '+longPositions.length+' posição(ões) · '+longPct.toFixed(1)+'%</span></div><div><strong style="color:#fb7185">'+money(shortUsd)+'</strong><span>SHORT · '+shortPositions.length+' posição(ões) · '+shortPct.toFixed(1)+'%</span></div></div><div class="tr-flow-note">Notional combinado: '+money(totalUsd)+'. Maior posição representa '+concentration.toFixed(1)+'% do total. Leitura de posicionamento, não previsão: posições grandes podem estar protegidas, alavancadas ou em hedge.</div>';
        await renderTraderChart(positions);
      } catch(err){statusEl.textContent='Falha ao atualizar';statusEl.className='tr-pill';if(openPositionsEl)openPositionsEl.innerHTML='<div class="tr-error">'+esc(err.message)+'<br><span class="tr-meta">Confira a disponibilidade do backend e tente novamente.</span></div>';}
      finally{if(!stopped)timer=setTimeout(refresh,refreshMs);}
    }
    root.querySelectorAll('[data-tr-interval]').forEach(button=>button.addEventListener('click',()=>{chartInterval=button.getAttribute('data-tr-interval')||'4h';root.querySelectorAll('[data-tr-interval]').forEach(b=>b.classList.toggle('active',b===button));refresh();}));
    refresh();
    return { refresh, destroy(){stopped=true;clearTimeout(timer);root.innerHTML='';} };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { mountTraderRadarPanel };
  global.mountTraderRadarPanel = mountTraderRadarPanel;
})(typeof window !== 'undefined' ? window : globalThis);
