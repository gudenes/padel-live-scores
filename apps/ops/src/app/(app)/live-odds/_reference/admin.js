/* ============================================================
   Padel Admin — interactions + live motion
   ============================================================ */
(function(){
  'use strict';
  var app = document.getElementById('app');
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ---------- THEME ---------- */
  var themeBtn = document.getElementById('themeBtn');
  var themeIcon = document.getElementById('themeIcon');
  function applyTheme(t){
    root.setAttribute('data-theme', t);
    themeIcon.querySelector('use').setAttribute('href', t==='light' ? '#i-moon' : '#i-sun');
    try{ localStorage.setItem('padel.theme', t); }catch(e){}
  }
  var storedTheme = null; try{ storedTheme = localStorage.getItem('padel.theme'); }catch(e){}
  applyTheme(storedTheme || 'light');
  themeBtn.addEventListener('click', function(){
    applyTheme(root.getAttribute('data-theme')==='light' ? 'dark' : 'light');
  });

  /* ---------- BRAND SWITCHER ---------- */
  var brandBtn = document.getElementById('brandBtn');
  var brandMenu = document.getElementById('brandMenu');
  var BRANDS = {
    nachos: { wm:'PADEL<span class="n">NACHOS</span>', host:'padelnachos.com',
              mark:'<img src="padel-nachos-paddle.png" alt="">', cls:'' },
    labs:   { wm:'PADEL<span class="n" style="color:var(--lime-text)">LABS</span>', host:'padellabs.tech',
              mark:'L', cls:'labs' }
  };
  function setBrand(b){
    var d = BRANDS[b]; if(!d) return;
    root.setAttribute('data-brand', b);
    document.getElementById('brandWm').innerHTML = d.wm;
    document.getElementById('brandHost').textContent = d.host;
    var mark = document.getElementById('brandMark');
    mark.className = 'mark ' + d.cls;
    mark.innerHTML = d.mark;
    document.querySelectorAll('#brandMenu .bm-i').forEach(function(i){
      i.classList.toggle('on', i.getAttribute('data-brand')===b);
    });
    try{ localStorage.setItem('padel.brand', b); }catch(e){}
  }
  try{ var sb = localStorage.getItem('padel.brand'); if(sb) setBrand(sb); }catch(e){}
  brandBtn.addEventListener('click', function(e){ e.stopPropagation(); brandMenu.classList.toggle('open'); });
  document.querySelectorAll('#brandMenu .bm-i').forEach(function(i){
    i.addEventListener('click', function(){ setBrand(i.getAttribute('data-brand')); brandMenu.classList.remove('open'); });
  });
  document.addEventListener('click', function(){ brandMenu.classList.remove('open'); });

  /* ---------- SIDEBAR ---------- */
  document.getElementById('collapseBtn').addEventListener('click', function(){ app.classList.toggle('collapsed'); });
  document.querySelectorAll('.navgroup .gl').forEach(function(gl){
    gl.addEventListener('click', function(){
      if(app.classList.contains('collapsed')) return;
      gl.parentElement.classList.toggle('closed');
    });
  });
  document.querySelectorAll('.rail .nav').forEach(function(n){
    n.addEventListener('click', function(){
      document.querySelectorAll('.rail .nav').forEach(function(x){ x.classList.remove('active'); });
      n.classList.add('active');
    });
  });

  /* ---------- FILTER TOGGLES ---------- */
  var swingTog = document.getElementById('swingTog');
  if(swingTog) swingTog.addEventListener('click', function(){ swingTog.classList.toggle('on'); });
  document.querySelectorAll('.seg span').forEach(function(s){
    s.addEventListener('click', function(){
      s.parentElement.querySelectorAll('span').forEach(function(x){ x.classList.remove('on'); });
      s.classList.add('on');
    });
  });
  document.querySelectorAll('.seg2 span').forEach(function(s){
    s.addEventListener('click', function(){
      s.parentElement.querySelectorAll('span').forEach(function(x){ x.classList.remove('on'); });
      s.classList.add('on');
    });
  });

  /* ---------- WIN-PROB HISTORY (per match) ---------- */
  var rows = Array.prototype.slice.call(document.querySelectorAll('#tbody tr'));
  function seedHistory(target){
    var hist = [], n = 26, p = Math.min(92, Math.max(8, target - (Math.random()*26+8)));
    for(var i=0;i<n;i++){
      var pull = (target - p) * 0.10;
      p += pull + (Math.random()-0.5)*7;
      p = Math.min(95, Math.max(5, p));
      hist.push(p);
    }
    hist[hist.length-1] = target;
    return hist;
  }
  rows.forEach(function(tr){ tr._hist = seedHistory(+tr.dataset.pa); });

  /* ---------- DETAIL CHART ---------- */
  var dArea = document.getElementById('dArea');
  var dLine = document.getElementById('dLine');
  var dDot  = document.getElementById('dDot');
  var CW = 348, CH = 120;
  function drawChart(hist){
    if(!hist || !hist.length) return;
    var n = hist.length, pts = [];
    for(var i=0;i<n;i++){
      var x = (i/(n-1))*CW;
      var y = CH - (hist[i]/100)*CH;
      pts.push([x, y]);
    }
    var line = 'M' + pts.map(function(p){ return p[0].toFixed(1)+','+p[1].toFixed(1); }).join(' L');
    dLine.setAttribute('d', line);
    dArea.setAttribute('d', line + ' L'+CW+','+CH+' L0,'+CH+' Z');
    var last = pts[n-1];
    dDot.setAttribute('cx', last[0].toFixed(1));
    dDot.setAttribute('cy', last[1].toFixed(1));
  }

  /* ---------- SELECTION ---------- */
  var selected = null;
  function select(tr){
    rows.forEach(function(x){ x.classList.remove('sel'); });
    tr.classList.add('sel');
    selected = tr;
    var d = tr.dataset, lead = (+d.pa >= +d.pb) ? 'a' : 'b';
    document.getElementById('dTtl').textContent = d.p1 + ' vs ' + d.p2;
    document.getElementById('dMeta').textContent = d.tour + ' · ' + d.meta + (d.status ? (' · ' + d.status) : '');
    document.querySelector('#dN1 .nm').textContent = d.p1;
    document.querySelector('#dN2 .nm').textContent = d.p2;
    document.getElementById('dL1').textContent = d.p1;
    document.getElementById('dL2').textContent = d.p2;
    var A = document.getElementById('dA'), B = document.getElementById('dB');
    A.textContent = d.pa + '%'; B.textContent = d.pb + '%';
    A.className = 'big disp ' + (lead==='a' ? 'lead' : 'trail');
    B.className = 'big disp ' + (lead==='b' ? 'lead' : 'trail');
    document.getElementById('dOA').textContent = d.oa;
    document.getElementById('dOB').textContent = d.ob;
    document.getElementById('dN1').classList.toggle('serving', d.serve==='a');
    document.getElementById('dN2').classList.toggle('serving', d.serve==='b');
    drawChart(tr._hist);
  }
  rows.forEach(function(tr){ tr.addEventListener('click', function(){ select(tr); }); });
  select(rows[0]);

  /* ---------- CLOCK ---------- */
  var clockEl = document.getElementById('clock');
  var t = new Date(); t.setHours(9,42,18,0);
  function tick(){
    t = new Date(t.getTime() + 1000);
    var hh = String(t.getHours()).padStart(2,'0');
    var mm = String(t.getMinutes()).padStart(2,'0');
    var ss = String(t.getSeconds()).padStart(2,'0');
    clockEl.textContent = hh + ':' + mm + ':' + ss;
  }
  setInterval(tick, 1000);

  /* ---------- LIVE MOTION ENGINE ---------- */
  var autoToggle = document.getElementById('autoToggle');
  var auto = true;
  autoToggle.addEventListener('click', function(){
    auto = !auto;
    autoToggle.classList.toggle('on', auto);
  });

  function fmtOdds(p){
    if(p < 1) p = 1; if(p > 99) p = 99;
    return (100 / p).toFixed(2);
  }
  function updRow(tr){
    var d = tr.dataset;
    if(d.status !== 'Live') return;
    // jitter win prob
    var pa = +d.pa + Math.round((Math.random()-0.5)*9);
    pa = Math.min(96, Math.max(4, pa));
    var prev = +d.pa, delta = pa - prev;
    var pb = 100 - pa;
    d.pa = pa; d.pb = pb;
    d.oa = fmtOdds(pa); d.ob = fmtOdds(pb);
    tr._hist.push(pa); if(tr._hist.length > 30) tr._hist.shift();

    // odds bar
    var bar = tr.querySelector('.obar');
    bar.querySelector('.a').style.width = pa + '%';
    bar.querySelector('.a').textContent = pa + '%';
    bar.querySelector('.b').textContent = pb + '%';
    var subs = tr.querySelectorAll('.osub .fo');
    subs[0].textContent = d.oa; subs[1].textContent = d.ob;

    // 15m movement (accumulate-ish)
    var mv = tr.querySelector('.mv');
    if(Math.abs(delta) >= 1){
      var cum = (mv._cum || 0) + delta;
      mv._cum = cum;
      mv.className = 'mv mono ' + (cum>0 ? 'up' : cum<0 ? 'dn' : 'flat');
      mv.innerHTML = cum===0 ? '— 0' : '<span class="ar">'+(cum>0?'▲':'▼')+'</span>'+(cum>0?'+':'')+cum;
    }

    // update seconds-since
    var upd = tr.querySelector('.upd');
    upd.textContent = (Math.floor(Math.random()*6)+3) + 's';

    // score flash sweep
    var sf = tr.querySelector('.scoreflash');
    if(sf && !reduce){
      sf.classList.remove('flash'); void sf.offsetWidth; sf.classList.add('flash');
    }

    // if selected, refresh detail
    if(tr === selected) select(tr);
  }

  function pump(){
    if(auto && root.getAttribute('data-conn')==='live'){
      var live = rows.filter(function(r){ return r.dataset.status === 'Live'; });
      var k = 1 + Math.floor(Math.random()*2);
      for(var i=0;i<k;i++){
        var r = live[Math.floor(Math.random()*live.length)];
        if(r) updRow(r);
      }
      var lu = document.getElementById('lastUpd');
      if(lu) lu.textContent = '· upd ' + (Math.floor(Math.random()*3)+1) + 's';
    }
    setTimeout(pump, 2200 + Math.random()*1600);
  }
  if(!reduce) setTimeout(pump, 1400);

  /* ---------- CONNECTION STATE (Padelgod feed) ---------- */
  var connInfo = {
    loading:      { foot:['connecting\u2026','handshake\u2026'],   pill:'Connecting', upd:'\u00b7 connecting' },
    live:         { foot:['online','WebSocket \u00b7 42ms'],        pill:'Model live', upd:'\u00b7 upd 2s' },
    reconnecting: { foot:['reconnecting\u2026','attempt 2 \u00b7 5s'], pill:'Model stale', upd:'\u00b7 stale',
                    banner:['Reconnecting to Padelgod feed','last update 14s ago'] },
    offline:      { foot:['offline','retrying every 5s'],          pill:'Model frozen', upd:'\u00b7 frozen',
                    banner:['Padelgod feed disconnected \u2014 odds frozen','frozen at 09:42:18 \u00b7 auto-retry 5s'] }
  };
  function setConn(s){
    var info = connInfo[s]; if(!info) return;
    root.setAttribute('data-conn', s);
    var stx = document.querySelector('.railfoot .stx');
    if(stx) stx.innerHTML = '<b>Padelgod</b> ' + info.foot[0] + '<small>' + info.foot[1] + '</small>';
    var mpTx = document.getElementById('mpTx'); if(mpTx) mpTx.textContent = info.pill;
    var lu = document.getElementById('lastUpd'); if(lu) lu.textContent = info.upd;
    if(info.banner){
      var t = document.getElementById('cbTx'), m = document.getElementById('cbMeta');
      if(t) t.textContent = info.banner[0];
      if(m) m.textContent = info.banner[1];
    }
  }
  var connCycle = ['live','reconnecting','offline'];
  var railFoot = document.getElementById('railFoot');
  if(railFoot) railFoot.addEventListener('click', function(){
    var i = connCycle.indexOf(root.getAttribute('data-conn'));
    setConn(connCycle[(i+1) % connCycle.length] || 'live');
  });
  var cbRetry = document.getElementById('cbRetry');
  if(cbRetry) cbRetry.addEventListener('click', function(e){ e.stopPropagation(); setConn('live'); });
  // boot: brief loading skeleton, then go live
  setConn('loading');
  setTimeout(function(){ setConn('live'); }, 1150);
})();
