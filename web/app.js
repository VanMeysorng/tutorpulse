/* TutorPulse web app. Talks only to the API Gateway (same origin: /api). */
(() => {
'use strict';
const API = '/api';
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
let token = store.get('tp_token'), me = null;
try { me = JSON.parse(store.get('tp_user') || 'null'); } catch (e) {}
const S = { draft: null, tab: 'sets', qi: 0, sel: '', fb: null, sets: [], timer: null, pr: null, radarSet: '' };

/* ---------- helpers ---------- */
const go = h => { if (location.hash === h) route(); else location.hash = h; };
const parts = () => location.hash.replace(/^#\/?/, '').split('/');
const show = html => { $('#app').innerHTML = html; };
function toast(m, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }
function tokenExpired(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 < Date.now(); } catch (e) { return true; } }
async function api(method, path, body, raw) {
  const r = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw && r.ok) return r;
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout('Your session expired. Please log in again.'); throw new Error('expired'); }
  if (!r.ok) { const e = new Error(j.details ? j.details.map(d => `${d.field}: ${d.message}`).join('; ') : j.error || 'Request failed (' + r.status + ')'); e.status = r.status; throw e; }
  return j;
}
function setSession(t, u) { token = t; me = u; store.set('tp_token', t); store.set('tp_user', JSON.stringify(u)); updateNav(); }
function logout(msg) { token = null; me = null; store.del('tp_token'); store.del('tp_user'); stopTimer(); updateNav(); if (msg) toast(msg, true); go('#/login'); }
function updateNav() {
  const who = $('#who'), b = $('#nbtn'), loginLk = $('#loginlk');
  if (me) {
    if (who) who.innerHTML = `${esc(me.name)}<span class="badge">${esc(me.role)}</span>`;
    if (loginLk) { loginLk.textContent = 'Dashboard'; loginLk.setAttribute('href', '#/dash'); }
    if (b) { b.textContent = 'Log out'; b.setAttribute('href', '#/'); b.onclick = e => { e.preventDefault(); logout(); }; b.className = 'btn sec'; }
  } else {
    if (who) who.innerHTML = '';
    if (loginLk) { loginLk.textContent = 'Log in'; loginLk.setAttribute('href', '#/login'); loginLk.onclick = null; }
    if (b) { b.textContent = 'Get Started Free'; b.setAttribute('href', '#/register'); b.onclick = null; b.className = 'btn'; }
  }
}
const stopTimer = () => { if (S.timer) { clearInterval(S.timer); S.timer = null; } };
const cid = () => parts()[1];
const roleName = r => ({ teacher: 'Teacher', student: 'Student', admin: 'Administrator' }[r] || r);
const bar = (v, c) => `<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
const tag = s => `<span class="tag ${s === 'flagged' ? 'r' : s === 'watch' ? 'y' : 'g'}">${s === 'flagged' ? 'Flagged' : s === 'watch' ? 'Watch' : 'OK'}</span>`;

/* ---------- router ---------- */
/* ---------- router ---------- */
function showLanding() {
  $('#landing').style.display = ''; $('#appwrap').style.display = 'none';
  scrollTo(0, 0);
  if (typeof obs === 'function') obs();
  if (typeof window.initLad === 'function') window.initLad();
}
async function route() {
  stopTimer();
  const [p, a] = parts();
  $$('#nav .lk a').forEach(x => x.classList.toggle('on', x.dataset.k === (!p ? 'home' : p)));
  if (!p) return showLanding();
  $('#landing').style.display = 'none'; $('#appwrap').style.display = 'block'; scrollTo(0, 0);
  if (p === 'features') return show(featuresPage());
  if (p === 'pricing') return show(pricingPage());
  if (p === 'about') return show(aboutPage());
  if (p === 'login' || p === 'register') return me ? go('#/dash') : show(authPage(p));
  if (!me || !token || tokenExpired(token)) { if (me) logout('Your session expired. Please log in again.'); else go('#/login'); return; }
  show('<div class="card">Loading…</div>');
  try {
    if (p === 'dash') show(me.role === 'teacher' ? await tDash() : me.role === 'student' ? await sDash() : await aDash());
    else if (p === 'class') show(me.role === 'student' ? await sClass(a) : await tClass(a));
    else if (p === 'set' && me.role === 'teacher') show(await tSet(a));
    else if (p === 'practice' && me.role === 'student') { S.qi = null; show(await practice(a)); }
    else if (p === 'history') show(await history());
    else go('#/dash');
    if (p === 'class' && S.tab === 'radar' && me.role !== 'student') S.timer = setInterval(refreshRadar, 6000);
  } catch (e) { if (e.message !== 'expired') show(`<div class="card"><h2>Something went wrong</h2><p class="mut">${esc(e.message)}</p><a class="btn" href="#/dash">Back to dashboard</a></div>`); }
}

/* ---------- public pages ---------- */
const icons = {
  bolt: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--pri)" stroke-width="2" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  file: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--cy)" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--pink)" stroke-width="2" fill="none"><path d="M9 18h6m-5 3h4m-2-19a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/></svg>`,
  key: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--warn)" stroke-width="2" fill="none"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M21 2l-9.6 9.6m3.6-1.6l2 2m-2-2l2-2"/></svg>`,
  radar: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--cy)" stroke-width="2" fill="none"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/><path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--pri)" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--bad)" stroke-width="2" fill="none"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  cpu: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="var(--pri)" stroke-width="2" fill="none"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3m6-3v3m-6 16v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3"/></svg>`,
  teacher: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8m-8 4h6"/></svg>`,
  student: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 20V10m-6 10V4M6 20v-6"/></svg>`
};

/* Interactive Feature Page Helpers */
window.setFeatStep = function(step) {
  const colors = {
    1: { bg: 'var(--pri)', shadow: '#b6ff3c55', color: '#10101a' },
    2: { bg: 'var(--cy)', shadow: '#38e1ff55', color: '#10101a' },
    3: { bg: 'var(--warn)', shadow: '#ffc43d55', color: '#10101a' },
    4: { bg: 'var(--pink)', shadow: '#ff4fd855', color: '#ffffff' }
  };
  [1, 2, 3, 4].forEach(s => {
    const el = document.getElementById('fstep-' + s);
    const btn = document.getElementById('fstep-btn-' + s);
    if (el) el.style.display = (s === step) ? 'block' : 'none';
    if (btn) {
      if (s === step) {
        btn.className = 'btn';
        btn.style.background = colors[s].bg;
        btn.style.color = colors[s].color;
        btn.style.boxShadow = `0 6px 28px ${colors[s].shadow}`;
        btn.style.borderColor = 'transparent';
      } else {
        btn.className = 'btn sec';
        btn.style.background = '';
        btn.style.color = '';
        btn.style.boxShadow = '';
        btn.style.borderColor = '';
      }
    }
  });
  const line = document.getElementById('feat-progress-line');
  if (line) {
    line.style.background = `linear-gradient(90deg, ${colors[step].bg} ${step * 25}%, #ffffff1a 0%)`;
  }
};

window.simParseFile = function() {
  const btn = document.getElementById('p-sim-btn');
  const out = document.getElementById('p-sim-out');
  if (!btn || !out) return;
  btn.disabled = true;
  btn.innerHTML = `<i class="pulse-dot g"></i> Parsing PDF Slides...`;
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = `${icons.file} Parse Sample Document`;
    out.style.display = 'block';
  }, 400);
};

window.simTeacherAI = function() {
  const btn = document.getElementById('t-sim-btn');
  const out = document.getElementById('t-sim-out');
  if (!btn || !out) return;
  btn.disabled = true;
  btn.innerHTML = `<i class="pulse-dot g"></i> Generating Set with Groq AI...`;
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = `${icons.bolt} Generate AI Question Set`;
    out.style.display = 'block';
  }, 500);
};

window.simStudentClue = function(tier) {
  const box = document.getElementById('s-clue-box');
  if (!box) return;
  if (tier === 1) {
    box.innerHTML = `<div style="text-align:left;width:100%"><b style="color:var(--warn)">Rule Recall:</b> ∫ xⁿ dx = (xⁿ⁺¹)/(n+1) + C.</div>`;
  } else if (tier === 2) {
    box.innerHTML = `<div style="text-align:left;width:100%"><b style="color:var(--cy)">Strategy:</b> Pull out 6: 6 * ∫ x² dx.</div>`;
  } else if (tier === 3) {
    box.innerHTML = `<div style="text-align:left;width:100%"><b style="color:var(--pri)">Step Setup:</b> 6 * (x³ / 3) + C = 2x³ + C.</div>`;
  }
};

window.setImpactMode = function(mode) {
  const tpBtn = document.getElementById('imp-tp');
  const tradBtn = document.getElementById('imp-trad');
  const content = document.getElementById('imp-content');
  if (!content) return;
  if (mode === 'tp') {
    if (tpBtn) tpBtn.className = 'btn';
    if (tradBtn) tradBtn.className = 'btn sec';
    content.innerHTML = `<div class="tiles" style="grid-template-columns:1fr;gap:12px">
      <div class="tile"><b style="font-size:24px;color:var(--cy)">94% Retention</b><span>Completion Rate</span></div>
      <div class="tile"><b style="font-size:24px;color:var(--pink)">Sub-Second</b><span>Telemetry Speed</span></div>
    </div>`;
  } else {
    if (tpBtn) tpBtn.className = 'btn sec';
    if (tradBtn) tradBtn.className = 'btn';
    content.innerHTML = `<div class="tiles" style="grid-template-columns:1fr;gap:12px">
      <div class="tile"><b style="font-size:24px;color:var(--warn)">45% Drop-off</b><span>Student Give-Up</span></div>
      <div class="tile"><b style="font-size:24px;color:var(--bad)">3 Days Later</b><span>Delayed Feedback</span></div>
    </div>`;
  }
};

function featuresPage() {
  return `<div class="card-hero" style="min-height:calc(100vh - 140px);display:flex;flex-direction:column;justify-content:space-between">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <div>
        <span class="pulse-badge"><i class="pulse-dot g"></i> Symmetric Walkthrough</span>
        <h1 style="font-size:36px;letter-spacing:-1.5px;margin:6px 0 2px">How TutorPulse Operates</h1>
      </div>
      <a href="#/register" class="btn">Get Started Free</a>
    </div>

    <!-- Step Navigation Buttons -->
    <div class="steps" style="justify-content:center;margin-bottom:14px">
      <button id="fstep-btn-1" class="btn" onclick="setFeatStep(1)">1. Drop Notes</button>
      <button id="fstep-btn-2" class="btn sec" onclick="setFeatStep(2)">2. AI Generator</button>
      <button id="fstep-btn-3" class="btn sec" onclick="setFeatStep(3)">3. Student Hints</button>
      <button id="fstep-btn-4" class="btn sec" onclick="setFeatStep(4)">4. Live Outcome</button>
    </div>

    <!-- Animated Progress Bar -->
    <div id="feat-progress-line" style="height:4px;width:100%;background:linear-gradient(90deg, var(--pri) 25%, #ffffff1a 0%);border-radius:99px;margin-bottom:16px;transition:background .4s ease"></div>

    <!-- STEP 1: DROP NOTES -->
    <div id="fstep-1" style="display:block;animation:in .3s">
      <div class="ladder sym">
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag g">Capability Overview</span>
              <span class="mut" style="font-size:12px">Step 01</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px;color:var(--pri)">Raw Document Import</h2>
            <div style="display:flex;flex-direction:column;gap:8px">
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--pri)">PDF & DOCX</b><span>Text & slide coordinate extraction</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--cy)">&lt; 0.3 Seconds</b><span>Sub-second local browser parsing</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--pink)">100% In-Browser</b><span>Privacy & zero upload server lag</span></div>
            </div>
          </div>
        </div>
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag g">Interactive Simulator</span>
              <span class="mut" style="font-size:12px">Live Test</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px">Test Document Parser</h2>
            <button class="btn full" onclick="simParseFile()" id="p-sim-btn">${icons.file} Parse Sample Document</button>
            <div id="p-sim-out" style="margin-top:14px;display:none">
              <div class="cheat">
                <div style="font-weight:700;color:var(--pri)">Extracted Output:</div>
                <div style="font-size:13px;color:var(--ink);margin-top:4px">Calc 3: d/dx(x^n) = n*x^(n-1). 3 clues generated.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 2: AI GENERATOR -->
    <div id="fstep-2" style="display:none;animation:in .3s">
      <div class="ladder sym">
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag g">Capability Overview</span>
              <span class="mut" style="font-size:12px">Step 02</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px;color:var(--pri)">AI Question Engine</h2>
            <div style="display:flex;flex-direction:column;gap:8px">
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--pri)">Groq Llama 3.3</b><span>High-throughput LPU generation</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--cy)">5 Qs + 3 Hints</b><span>Auto-scaffolded practice sets</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--pink)">&lt; 2 Seconds</b><span>Ultra-fast generation time</span></div>
            </div>
          </div>
        </div>
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag g">Interactive Simulator</span>
              <span class="mut" style="font-size:12px">Live Test</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px">Test AI Generator</h2>
            <button class="btn full" onclick="simTeacherAI()" id="t-sim-btn">${icons.bolt} Generate AI Question Set</button>
            <div id="t-sim-out" style="margin-top:14px;display:none">
              <div class="cheat">
                <div style="font-weight:700;color:var(--pri)">f(x) = 5x³ - 4x² + 7x</div>
                <ul style="margin:6px 0 0 16px;padding:0;font-size:12px;color:var(--ink)">
                  <li>Clue 1: Power Rule: d/dx(xⁿ) = n·xⁿ⁻¹</li>
                  <li>Clue 2: Term-by-term differentiation</li>
                  <li>Clue 3: f'(x) = 15x² - 8x + 7</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 3: STUDENT HINTS -->
    <div id="fstep-3" style="display:none;animation:in .3s">
      <div class="ladder sym">
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag y">Capability Overview</span>
              <span class="mut" style="font-size:12px">Step 03</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px;color:var(--cy)">Adaptive Guided Nudges</h2>
            <div style="display:flex;flex-direction:column;gap:8px">
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--cy)">6-Letter Code</b><span>Zero login password friction</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--warn)">3 Clue Tiers</b><span>Rule ➔ Strategy ➔ Setup</span></div>
              <div class="tile" style="padding:12px 14px"><b style="font-size:18px;color:var(--pri)">Instant Feedback</b><span>Immediate step validation</span></div>
            </div>
          </div>
        </div>
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag y">Interactive Simulator</span>
              <span class="mut" style="font-size:12px">Live Test</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px">Test Student Hints</h2>
            <p style="font-weight:700;margin:0 0 10px">Solve ∫ 6x² dx</p>
            <div class="row" style="margin-bottom:10px">
              <button class="btn sec" style="padding:6px 12px;font-size:12px" onclick="simStudentClue(1)">Clue 1</button>
              <button class="btn sec" style="padding:6px 12px;font-size:12px" onclick="simStudentClue(2)">Clue 2</button>
              <button class="btn sec" style="padding:6px 12px;font-size:12px" onclick="simStudentClue(3)">Clue 3</button>
            </div>
            <div id="s-clue-box" style="min-height:60px;background:#ffffff09;border:1px dashed var(--warn);border-radius:12px;padding:10px;font-size:12px;display:flex;align-items:center;justify-content:center">
              Click a clue button to test nudges...
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 4: LIVE OUTCOME -->
    <div id="fstep-4" style="display:none;animation:in .3s">
      <div class="ladder sym">
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag r">Capability Overview</span>
              <span class="mut" style="font-size:12px">Step 04</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px;color:var(--pink)">Classroom Impact</h2>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div class="tile" style="padding:14px"><b style="font-size:18px;color:var(--cy)">3x Retention</b><span>Self-correcting hint nudges</span></div>
              <div class="tile" style="padding:14px"><b style="font-size:18px;color:var(--pink)">Zero Blindspots</b><span>Real-time class gap radar</span></div>
            </div>
          </div>
        </div>
        <div class="demo" style="display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <span class="tag r">Interactive Comparison</span>
              <span class="mut" style="font-size:12px">Live Test</span>
            </div>
            <h2 style="font-size:20px;margin-bottom:14px">Compare Metrics</h2>
            <div class="steps" style="margin-bottom:12px">
              <button id="imp-tp" class="btn" onclick="setImpactMode('tp')">With TutorPulse</button>
              <button id="imp-trad" class="btn sec" onclick="setImpactMode('trad')">Traditional STEM</button>
            </div>
            <div id="imp-content">
              <div class="tiles" style="grid-template-columns:1fr;gap:12px">
                <div class="tile"><b style="font-size:24px;color:var(--cy)">94% Retention</b><span>Completion Rate</span></div>
                <div class="tile"><b style="font-size:24px;color:var(--pink)">Sub-Second</b><span>Telemetry Speed</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom CTA Card -->
    <div class="card" style="background:#121026;padding:16px;text-align:center;margin:16px 0 0">
      <h3 style="margin-bottom:4px">Ready to transform your classroom?</h3>
      <a href="#/register" class="btn" style="margin-top:6px">Get Started Free</a>
    </div>
  </div>`;
}

function pricingPage() {
  return `<div class="card-hero" style="min-height:calc(100vh - 140px);display:flex;flex-direction:column;justify-content:space-between">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <span class="pulse-badge"><i class="pulse-dot g"></i> Simple Pricing</span>
        <h1 style="font-size:42px;letter-spacing:-1.5px;margin:10px 0 4px">Plans & Pricing</h1>
        <p class="mut" style="font-size:16px;margin:0">Free for individual teachers. Scale to your entire school.</p>
      </div>
    </div>

    <div class="live-line" style="margin-bottom:28px"></div>

    <div class="cards3" style="margin:0">
      <div class="tilt">
        <span class="tag">Starter</span>
        <h2 style="font-size:40px;margin:16px 0 4px;color:var(--pri)">$0</h2>
        <p class="mut" style="margin-bottom:20px">Free forever for teachers</p>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:28px">
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Unlimited Practice Sets</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} PDF & Word Parsing</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Groq AI Generation</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Up to 150 Students</div>
        </div>
        <a href="#/register" class="btn sec" style="width:100%;text-align:center">Start Free</a>
      </div>

      <div class="tilt" style="border-color:var(--pri);box-shadow:0 0 30px #b6ff3c1f">
        <span class="tag g">Pro Launch</span>
        <h2 style="font-size:40px;margin:16px 0 4px;color:var(--pri)">$0</h2>
        <p class="mut" style="margin-bottom:20px">Free during launch ($12/mo regular)</p>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:28px">
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Everything in Starter</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Live Gap Radar</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Heatmap Performance Grid</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Flagged Concept Alerts</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} CSV Gradebook Export</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Unlimited Students</div>
        </div>
        <a href="#/register" class="btn" style="width:100%;text-align:center">Claim Pro Free</a>
      </div>

      <div class="tilt">
        <span class="tag y">District</span>
        <h2 style="font-size:40px;margin:16px 0 4px;color:var(--cy)">Custom</h2>
        <p class="mut" style="margin-bottom:20px">For schools and districts</p>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:28px">
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Canvas / Schoology LMS</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Google / SAML SSO</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} District Analytics</div>
          <div style="display:flex;align-items:center;gap:8px">${icons.check} Dedicated Support</div>
        </div>
        <a href="#/register" class="btn sec" style="width:100%;text-align:center">Contact Sales</a>
      </div>
    </div>
  </div>`;
}

function aboutPage() {
  return `<div class="card-hero" style="min-height:calc(100vh - 140px);display:flex;flex-direction:column;justify-content:space-between">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <span class="pulse-badge"><i class="pulse-dot g"></i> System Engineering</span>
        <h1 style="font-size:42px;letter-spacing:-1.5px;margin:10px 0 4px">Platform Architecture</h1>
        <p class="mut" style="font-size:16px;margin:0">Decoupled microservice backend running on Groq AI LPUs.</p>
      </div>
    </div>

    <div class="live-line" style="margin-bottom:28px"></div>

    <div class="tiles" style="margin-bottom:28px">
      <div class="tile"><b style="color:var(--pri)">7</b><span>Microservices</span></div>
      <div class="tile"><b style="color:var(--cy)">Groq AI</b><span>Llama 3.3 70B</span></div>
      <div class="tile"><b style="color:var(--pink)">Dual</b><span>Gateway Balancers</span></div>
      <div class="tile"><b style="color:var(--warn)">100%</b><span>Containerized</span></div>
    </div>

    <div class="cards3" style="margin-bottom:24px">
      <div class="tilt">
        <div class="icon-box">${icons.cpu}</div>
        <h3>7 Microservices</h3>
        <p class="mut">Decoupled services for Auth, Classes, Content, Practice, Analytics, and Gateways.</p>
      </div>
      <div class="tilt">
        <div class="icon-box">${icons.bolt}</div>
        <h3>Groq Llama 3.3 70B</h3>
        <p class="mut">High-throughput LPUs generate math problems in under 2 seconds.</p>
      </div>
      <div class="tilt">
        <div class="icon-box">${icons.radar}</div>
        <h3>Nginx Load Balancer</h3>
        <p class="mut">Dual Gateway replicas with automatic round-robin traffic routing.</p>
      </div>
    </div>

    <div class="card" style="background:#121026;padding:24px;text-align:center;margin:0">
      <h3 style="margin-bottom:6px">Ready to transform your classroom?</h3>
      <p class="mut" style="margin-bottom:16px">Experience real-time misconception tracking today.</p>
      <a href="#/register" class="btn">Get Started Free</a>
    </div>
  </div>`;
}

/* ---------- auth ---------- */
function authPage(m) {
  const reg = m === 'register';
  return `<div class="card narrow"><h2>${reg ? 'Create your account' : 'Welcome back'}</h2><p class="mut">${reg ? 'Pick a role. Admin accounts are created by the system.' : 'Log in to your TutorPulse dashboard.'}</p>
${reg ? '<input id="f-name" placeholder="Full name" autocomplete="name">' : ''}<input id="f-email" type="email" placeholder="Email" autocomplete="email"><input id="f-pass" type="password" placeholder="Password" autocomplete="${reg ? 'new-password' : 'current-password'}">
${reg ? '<select id="f-role" style="width:100%"><option value="student">I am a student</option><option value="teacher">I am a teacher</option></select><p class="mut">At least 8 characters, with a letter and a number.</p>' : ''}
<button class="btn full" data-a="${m}" data-enter>${reg ? 'Create account' : 'Log in'}</button><div class="err" id="aerr"></div>
<p class="mut" style="margin-top:14px">${reg ? 'Already have an account? <a href="#/login" style="color:var(--cy)">Log in</a>' : 'New here? <a href="#/register" style="color:var(--cy)">Create an account</a>'}</p></div>`;
}
async function doLogin(email, password) {
  const r = await api('POST', '/auth/login', { email, password });
  setSession(r.token, r.user); go('#/dash');
}

/* ---------- teacher ---------- */
async function tDash() {
  const cs = await api('GET', '/classes');
  return `<h2 style="margin-bottom:14px">Your classes</h2><div class="card"><div class="row"><input id="c-name" placeholder="New class name, e.g. Grade 10 Algebra" style="flex:1;min-width:200px" data-enter-for="newClass"><button class="btn" data-a="newClass">Create class</button></div></div>
<div class="card">${cs.length ? cs.map(c => `<div class="item"><div><b>${esc(c.name)}</b><div class="mut">Code ${esc(c.code)} · ${c.studentIds.length} student(s)</div></div><a class="btn sec" href="#/class/${c.id}">Open</a></div>`).join('') : '<p class="mut">No classes yet. Create your first class above.</p>'}</div>${footer()}`;
}
const footer = () => `<p class="mut" style="margin-top:20px"><a href="#/history" style="color:var(--cy)">Login history</a></p>`;
async function tClass(id) {
  const c = await api('GET', '/classes/' + id);
  const admin = me.role === 'admin'; if (admin) { S.tab = 'radar'; S.radarSet = ''; S.sets = []; }
  let body = '';
  if (S.tab === 'sets') {
    S.sets = await api('GET', `/content/classes/${id}/sets`);
    body = `<div class="card"><h2>New practice set</h2><p class="mut">Paste lesson notes or load a .pdf, .docx, .doc, .txt, or .md file. AI drafts a cheat sheet and 5 questions you can edit.</p>
<input id="s-title" placeholder="Title, e.g. Quadratics" style="margin:10px 0"><input type="file" id="s-file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.rtf" style="margin-bottom:10px"><textarea id="s-notes" placeholder="Lesson notes…"></textarea>
<label class="chk"><input type="checkbox" id="s-gen" checked> Generate questions with AI</label><button class="btn" data-a="createSet" style="margin-top:12px">Create practice set</button></div>
<div class="card"><h2>Practice sets</h2>${S.sets.length ? S.sets.map(s => `<div class="item"><div><b>${esc(s.title)}</b><div class="mut">${s.questions.length} question(s) · ${s.published ? 'Published' : 'Draft'}</div></div><a class="btn sec" href="#/set/${s.id}">Edit</a></div>`).join('') : '<p class="mut">None yet.</p>'}</div>`;
  } else if (S.tab === 'share') {
    const st = await api('GET', `/classes/${id}/students`);
    body = `<div class="card"><h2>Class code</h2><div class="code">${esc(c.code)}</div><p class="mut">Students enter this code to join. Regenerate it if it was shared too widely.</p>
<div class="row" style="margin-top:12px"><button class="btn sec" data-a="regenCode">Regenerate code</button></div></div>
<div class="card"><h2>Rename</h2><div class="row"><input id="r-name" value="${esc(c.name)}" style="flex:1;min-width:200px"><button class="btn sec" data-a="renameClass">Save</button></div></div>
<div class="card"><h2>Students (${st.count})</h2>${st.students.length ? st.students.map(s => `<div class="item"><span>${esc(s.name)}</span></div>`).join('') : '<p class="mut">Nobody has joined yet.</p>'}</div>
<div class="card"><button class="btn dng" data-a="delClass">Delete class</button></div>`;
  } else {
    if (!admin) { S.sets = await api('GET', `/content/classes/${id}/sets`); if (!S.radarSet || !S.sets.find(s => s.id === S.radarSet)) S.radarSet = (S.sets[0] || {}).id || ''; }
    const sel = admin ? '' : `<div class="row" style="margin-bottom:14px"><span class="mut">Practice set</span><select id="radar-set">${S.sets.map(s => `<option value="${s.id}" ${s.id === S.radarSet ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select><button class="btn sec" data-a="csv">Export CSV</button></div>`;
    body = sel + `<div id="radarBox">${await radarHtml(id)}</div>`;
  }
  const tabs = admin ? '' : '<div class="steps">' + [['sets', 'Practice sets'], ['share', 'Class code and students'], ['radar', 'Gap Radar']].map(t => `<button data-a="tab" data-v="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('') + '</div>';
  return `<div class="row" style="margin-bottom:12px"><a class="btn sec" href="#/dash">All classes</a><h2 style="margin:0">${esc(c.name)}</h2></div>${tabs}${body}`;
}
async function radarHtml(id) {
  const q = S.radarSet ? '?setId=' + S.radarSet : '';
  const [radar, studs, concepts, matrix] = await Promise.all(['radar', 'students', 'concepts', 'matrix'].map(x => api('GET', `/analytics/classes/${id}/${x}${q}`)));
  const att = studs.reduce((a, s) => a + s.attempts, 0), ok = studs.reduce((a, s) => a + s.correct, 0), cl = studs.reduce((a, s) => a + s.clues, 0);
  const tiles = [[studs.length, 'Students'], [att, 'Attempts'], [att ? Math.round(ok / att * 100) + '%' : '-', 'Accuracy'], [studs.length ? (cl / studs.length).toFixed(1) : '-', 'Clues per student']];
  const set = S.sets.find(s => s.id === S.radarSet); const nq = set ? set.questions.length : Math.max(0, ...radar.map(r => r.qIndex + 1));
  const cell = (sid, qi) => { const m = matrix.find(x => x.studentId === sid && x.qIndex === qi); if (!m) return ''; return m.solved ? (m.wrong || m.clues ? 'a' : 'g') : m.wrong ? 'r' : 'a'; };
  const fl = concepts.filter(c => c.status !== 'ok');
  return `<div class="tiles">${tiles.map(t => `<div class="tile"><b>${t[0]}</b><span>${t[1]}</span></div>`).join('')}</div>
${studs.length ? `<div class="card"><h2>Heatmap</h2><p class="mut">Rows are students, columns are questions. Green solved cleanly, amber solved with help, red still stuck.</p><div class="tbl"><table class="hm"><tr><th></th>${Array.from({ length: nq }, (_, i) => `<th>Q${i + 1}</th>`).join('')}</tr>${studs.map(s => `<tr><td>${esc(s.name)}</td>${Array.from({ length: nq }, (_, i) => `<td><i class="cell ${cell(s.studentId, i)}"></i></td>`).join('')}</tr>`).join('')}</table></div></div>` : ''}
<div class="card"><h2>Gap Radar <span class="tag g">live</span></h2><p class="mut">Refreshes every few seconds while you watch.</p><div class="tbl"><table><tr><th>Question</th><th>Attempts</th><th>Wrong rate</th><th>Avg clues</th><th>Status</th></tr>${radar.length ? radar.map(r => `<tr><td>Q${r.qIndex + 1} · ${esc(r.concept || '')}</td><td>${r.attempts}</td><td>${bar(r.wrongRate)}</td><td>${r.avgClues}</td><td>${tag(r.status)}</td></tr>`).join('') : '<tr><td colspan="5" class="mut">Waiting for students to practice.</td></tr>'}</table></div></div>
<div class="card"><h2>Per student</h2><div class="tbl"><table><tr><th>Student</th><th>Attempts</th><th>Correct</th><th>Clues</th><th>Solved</th></tr>${studs.length ? studs.map(s => `<tr><td>${esc(s.name)}</td><td>${s.attempts}</td><td>${s.correct}</td><td>${s.clues}</td><td>${s.solvedQuestions}/${nq}</td></tr>`).join('') : '<tr><td colspan="5" class="mut">No activity yet.</td></tr>'}</table></div></div>
<div class="card"><h2>Flagged concepts</h2>${fl.length ? fl.map(c => `<p>${tag(c.status)} <b>${esc(c.concept || 'Unknown')}</b>: ${Math.round(c.wrongRate * 100)}% wrong, ${c.avgClues} clues per student</p>`).join('') + '<p class="mut">Consider a quick recap on these before moving on.</p>' : '<p class="mut">No concept needs attention yet.</p>'}</div>`;
}
async function refreshRadar() {
  const box = $('#radarBox'); if (!box || S.tab !== 'radar') return stopTimer();
  try { box.innerHTML = await radarHtml(cid()); } catch (e) { stopTimer(); }
}

/* ---------- teacher: set editor ---------- */
const blankQ = () => ({ type: 'mcq', q: '', options: ['', '', '', ''], answer: '', concept: '', clues: ['', '', ''] });
async function tSet(id) {
  const s = await api('GET', '/content/sets/' + id); S.draft = JSON.parse(JSON.stringify(s));
  return setEditor();
}
function setEditor() {
  const d = S.draft;
  return `<div class="row" style="margin-bottom:12px"><a class="btn sec" href="#/class/${d.classId}">Back to class</a><h2 style="margin:0">${esc(d.title)} <span class="tag ${d.published ? 'g' : 'y'}">${d.published ? 'Published' : 'Draft'}</span></h2></div>
<div class="card"><h2>Details</h2><input data-f="title" value="${esc(d.title)}" placeholder="Title"><p class="mut" style="margin-top:12px">Lesson notes</p><textarea data-f="notes">${esc(d.notes)}</textarea>
<div class="row" style="margin-top:10px"><button class="btn sec" data-a="regenSet">Regenerate with AI from notes</button></div></div>
<div class="card"><h2>Cheat sheet</h2><p class="mut">One item per line. Pinned for students while they practice.</p><textarea data-f="cheat" style="min-height:100px">${esc(d.cheat.join('\n'))}</textarea></div>
<div class="card"><h2>Questions (${d.questions.length}/5)</h2>${d.questions.map((q, i) => `<div class="q"><div class="row" style="justify-content:space-between"><h3>Q${i + 1}</h3><div class="row"><select data-f="type" data-i="${i}"><option value="mcq" ${q.type === 'mcq' ? 'selected' : ''}>Multiple choice</option><option value="num" ${q.type === 'num' ? 'selected' : ''}>Numeric</option></select><button class="btn dng" data-a="delQ" data-v="${i}">Remove</button></div></div>
<input data-f="q" data-i="${i}" value="${esc(q.q)}" placeholder="Question">${q.type === 'mcq' ? `<div class="grid2" style="margin-top:8px">${(q.options || ['', '', '', '']).map((o, j) => `<input data-f="opt" data-i="${i}" data-j="${j}" value="${esc(o)}" placeholder="Option ${j + 1}">`).join('')}</div>` : ''}
<div class="grid2" style="margin-top:8px"><input data-f="answer" data-i="${i}" value="${esc(q.answer)}" placeholder="${q.type === 'mcq' ? 'Correct answer (must match an option)' : 'Correct number'}"><input data-f="concept" data-i="${i}" value="${esc(q.concept)}" placeholder="Concept, e.g. Factoring"></div>
${['Rule recall', 'Strategy focus', 'First-step setup'].map((n, j) => `<input style="margin-top:6px" data-f="clue" data-i="${i}" data-j="${j}" value="${esc(q.clues[j] || '')}" placeholder="Clue ${j + 1}: ${n}">`).join('')}</div>`).join('')}
<div class="row" style="margin-top:16px"><button class="btn sec" data-a="addQ" ${d.questions.length >= 5 ? 'disabled' : ''}>Add question</button><button class="btn" data-a="saveSet">Save changes</button><button class="btn sec" data-a="pubSet">${d.published ? 'Unpublish' : 'Publish to class'}</button><button class="btn dng" data-a="delSet">Delete set</button></div><div class="err" id="serr"></div></div>`;
}
function cleanSet() {
  const d = S.draft;
  return { title: d.title, notes: d.notes, cheat: d.cheat.map(x => x.trim()).filter(Boolean), questions: d.questions.map(q => ({ type: q.type, q: q.q.trim(), ...(q.type === 'mcq' ? { options: q.options.map(o => o.trim()) } : {}), answer: String(q.answer).trim(), concept: q.concept.trim(), clues: q.clues.map(c => c.trim()) })) };
}

/* ---------- student ---------- */
async function sDash() {
  const cs = await api('GET', '/classes');
  return `<h2 style="margin-bottom:14px">Your classes</h2><div class="card"><h2>Join a class</h2><div class="row" style="margin-top:12px"><input id="j-code" placeholder="6-letter code" maxlength="6" style="flex:1;min-width:160px;text-transform:uppercase" data-enter-for="joinClass"><button class="btn" data-a="joinClass">Join</button></div></div>
<div class="card">${cs.length ? cs.map(c => `<div class="item"><b>${esc(c.name)}</b><a class="btn sec" href="#/class/${c.id}">Open</a></div>`).join('') : '<p class="mut">You have not joined a class yet. Ask your teacher for the code.</p>'}</div>${footer()}`;
}
async function sClass(id) {
  const [c, sets] = await Promise.all([api('GET', '/classes/' + id), api('GET', `/content/classes/${id}/sets`)]);
  return `<div class="row" style="margin-bottom:12px"><a class="btn sec" href="#/dash">All classes</a><h2 style="margin:0">${esc(c.name)}</h2></div><div class="card"><h2>Practice sets</h2>${sets.length ? sets.map(s => `<div class="item"><div><b>${esc(s.title)}</b><div class="mut">${s.questions.length} question(s)</div></div><a class="btn" href="#/practice/${s.id}">Practice</a></div>`).join('') : '<p class="mut">Your teacher has not published anything yet.</p>'}</div>`;
}
async function practice(id) {
  const [set, prog] = await Promise.all([api('GET', '/practice/sets/' + id), api('GET', `/practice/sets/${id}/progress`)]);
  S.pr = { id, set, prog };
  if (S.qi === null) { const u = prog.questions.findIndex(x => !x.solved); S.qi = u < 0 ? 0 : u; }
  S.sel = ''; S.fb = null; return practiceView();
}
function practiceView() {
  const { id, set, prog } = S.pr, i = S.qi, q = set.questions[i], p = prog.questions[i];
  const done = prog.solved === prog.total;
  return `<div class="row" style="margin-bottom:12px"><a class="btn sec" href="#/dash">Back</a><h2 style="margin:0">${esc(set.title)}</h2></div>
${set.cheat.length ? `<div class="cheat pin"><b>Cheat sheet</b><ul style="margin:6px 0 0;padding-left:18px">${set.cheat.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
<div class="card"><div class="prog"><div class="ring" style="--p:${Math.round(prog.solved / prog.total * 100)}"><b>${prog.solved}/${prog.total}</b></div><div><div class="mut">Your progress</div><b style="font-size:18px">${done ? 'Set complete' : 'Keep going'}</b></div></div>
<div class="dots">${prog.questions.map((x, k) => `<button data-a="goQ" data-v="${k}" class="${k === i ? 'on' : ''} ${x.solved ? 'dn' : ''}">${k + 1}</button>`).join('')}</div>
<div class="mut">${esc(q.concept)}</div><h2 style="margin:6px 0 10px">${esc(q.q)}</h2>
${q.type === 'mcq' ? q.options.map(o => `<button class="opt ${S.sel === o ? 'sel' : ''}" data-a="pick" data-v="${esc(o)}" ${p.solved ? 'disabled' : ''}>${esc(o)}</button>`).join('') : `<input id="p-num" inputmode="decimal" placeholder="Your answer" value="${esc(S.sel)}" ${p.solved ? 'disabled' : ''} data-enter-for="attempt">`}
<div class="row" style="margin-top:12px"><button class="btn" data-a="attempt" ${p.solved ? 'disabled' : ''}>Submit</button><button class="btn sec" data-a="clue" ${p.solved || p.cluesUsed >= 3 ? 'disabled' : ''}>Need a nudge? (${p.cluesUsed}/3)</button></div>
${p.clues.map((t, j) => `<div class="clue"><b>Clue ${j + 1}:</b> ${esc(t)}</div>`).join('')}
${p.solved ? '<div class="fb" style="color:var(--pri)">Solved. Locked in.</div>' : S.fb === 'bad' ? '<div class="fb bad">Not quite. Run it back or grab a clue.</div>' : ''}
${p.solved && i < prog.total - 1 ? `<div style="margin-top:12px"><button class="btn" data-a="goQ" data-v="${i + 1}">Next question</button></div>` : ''}
${done ? '<div class="fb" style="color:var(--pri)">All done. Your teacher can see your results.</div>' : ''}</div>`;
}
async function refreshPractice() { S.pr.prog = await api('GET', `/practice/sets/${S.pr.id}/progress`); show(practiceView()); }

/* ---------- admin + history ---------- */
let aTab = 'users', aPage = 1, aRole = '';
async function aDash() {
  let body;
  if (aTab === 'users') {
    const u = await api('GET', `/admin/users?page=${aPage}&limit=15${aRole ? '&role=' + aRole : ''}`);
    body = `<div class="card"><div class="row" style="margin-bottom:12px"><span class="mut">Filter</span><select id="a-role"><option value="">All roles</option>${['admin', 'teacher', 'student'].map(r => `<option value="${r}" ${aRole === r ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select><span class="mut">${u.total} user(s)</span></div>
<div class="tbl"><table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>${u.items.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><select data-uid="${x.id}">${['admin', 'teacher', 'student'].map(r => `<option value="${r}" ${x.role === r ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select></td><td>${x.id === me.id ? '' : `<button class="btn dng" data-a="delUser" data-v="${x.id}">Delete</button>`}</td></tr>`).join('')}</table></div>
<div class="row" style="margin-top:12px"><button class="btn sec" data-a="aPrev" ${aPage <= 1 ? 'disabled' : ''}>Previous</button><span class="mut">Page ${u.page}</span><button class="btn sec" data-a="aNext" ${u.page * u.limit >= u.total ? 'disabled' : ''}>Next</button></div></div>`;
  } else {
    const cs = await api('GET', '/classes');
    body = `<div class="card">${cs.length ? cs.map(c => `<div class="item"><div><b>${esc(c.name)}</b><div class="mut">Code ${esc(c.code)} · ${c.studentIds.length} student(s)</div></div><a class="btn sec" href="#/class/${c.id}">View radar</a></div>`).join('') : '<p class="mut">No classes yet.</p>'}</div>`;
  }
  return `<h2 style="margin-bottom:14px">Administration</h2><div class="steps">${[['users', 'Users'], ['classes', 'All classes']].map(t => `<button data-a="aTab" data-v="${t[0]}" class="${aTab === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>${body}${footer()}`;
}
async function history() {
  const h = await api('GET', '/auth/history');
  return `<div class="row" style="margin-bottom:12px"><a class="btn sec" href="#/dash">Back</a><h2 style="margin:0">Login history</h2></div><div class="card"><div class="tbl"><table><tr><th>When</th><th>Result</th><th>IP address</th></tr>${h.map(x => `<tr><td>${new Date(x.createdAt).toLocaleString()}</td><td>${x.success ? '<span class="tag g">Success</span>' : '<span class="tag r">Failed</span>'}</td><td>${esc(x.ip || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">No history.</td></tr>'}</table></div></div>`;
}

/* ---------- actions ---------- */
const val = id => ($('#' + id) || {}).value || '';
const A = {
  async login() { try { await doLogin(val('f-email').trim(), val('f-pass')); } catch (e) { if (e.message !== 'expired') $('#aerr').textContent = e.message; } },
  async register() {
    try { await api('POST', '/auth/register', { name: val('f-name'), email: val('f-email').trim(), password: val('f-pass'), role: val('f-role') }); await doLogin(val('f-email').trim(), val('f-pass')); toast('Account created. Welcome!'); }
    catch (e) { if (e.message !== 'expired') $('#aerr').textContent = e.message; }
  },
  async newClass() { const n = val('c-name').trim(); if (n.length < 2) return toast('Give the class a name.', true); const c = await api('POST', '/classes', { name: n }); go('#/class/' + c.id); },
  async joinClass() { const r = await api('POST', '/classes/join', { code: val('j-code').trim().toUpperCase() }); toast('Joined ' + r.name); route(); },
  async createSet() {
    if (notesTypingTimer) clearTimeout(notesTypingTimer);
    const title = val('s-title').trim();
    const notesText = val('s-notes').trim();
    if (!title && !notesText) return toast('Add a title or paste notes.', true);
    await autoCreateSetFromNotes(notesText);
  },
  async saveSet() { try { S.draft = await api('PUT', '/content/sets/' + S.draft.id, cleanSet()); toast('Saved.'); show(setEditor()); } catch (e) { $('#serr').textContent = e.message; throw e; } },
  async pubSet() { try { const body = cleanSet(); await api('PUT', '/content/sets/' + S.draft.id, body); S.draft = await api('POST', `/content/sets/${S.draft.id}/publish`, { published: !S.draft.published }); toast(S.draft.published ? 'Published to your class.' : 'Unpublished.'); show(setEditor()); } catch (e) { $('#serr').textContent = e.message; throw e; } },
  async regenSet() { if (!confirm('Replace the cheat sheet and questions with a new AI draft?')) return; await api('PUT', '/content/sets/' + S.draft.id, { notes: S.draft.notes }); S.draft = await api('POST', `/content/sets/${S.draft.id}/regenerate`, {}); toast('New draft ready.'); show(setEditor()); },
  async delSet() { if (!confirm('Delete this practice set?')) return; const c = S.draft.classId; await api('DELETE', '/content/sets/' + S.draft.id); go('#/class/' + c); },
  addQ() { S.draft.questions.push(blankQ()); show(setEditor()); },
  delQ(b, v) { S.draft.questions.splice(+v, 1); show(setEditor()); },
  async renameClass() { await api('PUT', '/classes/' + cid(), { name: val('r-name') }); toast('Renamed.'); route(); },
  async regenCode() { if (!confirm('Old code will stop working for new students. Continue?')) return; await api('POST', `/classes/${cid()}/regenerate-code`, {}); toast('New code generated.'); route(); },
  async delClass() { if (!confirm('Delete this class?')) return; await api('DELETE', '/classes/' + cid()); go('#/dash'); },
  async csv() {
    const r = await api('GET', `/analytics/classes/${cid()}/export.csv${S.radarSet ? '?setId=' + S.radarSet : ''}`, null, true);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'tutorpulse-class.csv'; a.click(); URL.revokeObjectURL(a.href);
  },
  pick(b, v) { S.sel = v; show(practiceView()); },
  goQ(b, v) { S.qi = +v; S.sel = ''; S.fb = null; show(practiceView()); },
  async attempt() {
    const q = S.pr.set.questions[S.qi], ans = q.type === 'num' ? val('p-num').trim() : S.sel;
    if (!ans) return toast('Choose or type an answer first.', true);
    const r = await api('POST', `/practice/sets/${S.pr.id}/questions/${S.qi}/attempt`, { answer: ans });
    S.fb = r.correct ? 'ok' : 'bad'; S.sel = r.correct ? '' : S.sel; await refreshPractice();
  },
  async clue() { await api('POST', `/practice/sets/${S.pr.id}/questions/${S.qi}/clue`, {}); await refreshPractice(); },
  aTab(b, v) { aTab = v; return route(); }, aPrev() { aPage--; return route(); }, aNext() { aPage++; return route(); },
  async delUser(b, v) { if (!confirm('Delete this user?')) return; await api('DELETE', '/admin/users/' + v); toast('User deleted.'); route(); },
};
document.addEventListener('click', e => {
  const btnGo = e.target.closest('[data-go]');
  if (btnGo) {
    e.preventDefault();
    go(me ? '#/dash' : '#/register');
    return;
  }
  const aLk = e.target.closest('a[href^="#/"]');
  if (aLk) {
    const href = aLk.getAttribute('href');
    if (href) {
      e.preventDefault();
      go(href);
      return;
    }
  }
  const ladBtn = e.target.closest('#lad button, [data-i]');
  if (ladBtn) {
    e.preventDefault();
    const i = +ladBtn.dataset.i;
    const LC = [
      'Rule: D = b² − 4ac. Know it cold.',
      'Strategy: read off a, b and c with their signs before touching anything.',
      'Setup: a = 2, b = 3, c = −2, so compute 3² − 4(2)(−2).'
    ];
    document.querySelectorAll('#lad button').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    const ldt = document.getElementById('ldt');
    if (ldt) ldt.textContent = LC[i] || '';
    return;
  }
  const d = e.target.closest('[data-d]');
  if (d && !d.dataset.a) {
    e.preventDefault();
    const k = d.dataset.d;
    if (k === 'how') go('#/features');
    else if (k === 'home') go('#/');
    else go('#/dash');
    return;
  }
  const fStepBtn = e.target.closest('#fstep-btn-1, #fstep-btn-2, #fstep-btn-3, #fstep-btn-4');
  if (fStepBtn) {
    e.preventDefault();
    const step = +fStepBtn.id.replace('fstep-btn-', '');
    if (typeof window.setFeatStep === 'function') window.setFeatStep(step);
    return;
  }
  if (e.target.closest('#p-sim-btn')) {
    e.preventDefault();
    if (typeof window.simParseFile === 'function') window.simParseFile();
    return;
  }
  if (e.target.closest('#t-sim-btn')) {
    e.preventDefault();
    if (typeof window.simTeacherAI === 'function') window.simTeacherAI();
    return;
  }
  const sClueBtn = e.target.closest('#fstep-3 button');
  if (sClueBtn && sClueBtn.getAttribute('onclick')) {
    e.preventDefault();
    const match = sClueBtn.getAttribute('onclick').match(/simStudentClue\((\d+)\)/);
    if (match && typeof window.simStudentClue === 'function') {
      window.simStudentClue(+match[1]);
    }
    return;
  }
  const impBtn = e.target.closest('#imp-tp, #imp-trad');
  if (impBtn) {
    e.preventDefault();
    const mode = impBtn.id === 'imp-tp' ? 'tp' : 'trad';
    if (typeof window.setImpactMode === 'function') window.setImpactMode(mode);
    return;
  }
  if (e.target.closest('#nbtn') && me) {
    e.preventDefault();
    logout();
    return;
  }
  if (e.target.id === 'top') {
    scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const b = e.target.closest('[data-a]');
  if (!b || !A[b.dataset.a]) return;
  e.preventDefault();
  b.disabled = true;
  Promise.resolve(A[b.dataset.a](b, b.dataset.v))
    .catch(err => { if (err.message !== 'expired') toast(err.message, true); })
    .finally(() => { b.disabled = false; });
});
document.addEventListener('mousemove', e => {
  const c = e.target.closest('.tilt');
  if (c) {
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    c.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-4px)`;
  }
});
document.addEventListener('mouseout', e => {
  const c = e.target.closest('.tilt');
  if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  const f = e.target.dataset && e.target.dataset.enterFor; const root = $('#app');
  const btn = f ? root.querySelector(`[data-a="${f}"]`) : root.querySelector('[data-enter]'); if (btn && root.contains(e.target)) btn.click();
});
let isGeneratingSet = false;
let notesTypingTimer = null;

async function autoCreateSetFromNotes(overrideNotes, sourceFileName) {
  if (isGeneratingSet) return;
  const currentCid = cid();
  if (!currentCid) return;

  const notesInput = $('#s-notes');
  const titleInput = $('#s-title');

  const notesText = (overrideNotes !== undefined ? overrideNotes : (notesInput ? notesInput.value : '')).trim();
  if (!notesText || notesText.length < 2) return;

  let title = (titleInput ? titleInput.value : '').trim();
  if (!title) {
    if (sourceFileName) {
      title = sourceFileName.replace(/\.[^.]+$/, '');
    } else {
      const firstLine = notesText.split('\n')[0].replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
      title = firstLine.length >= 3 ? firstLine.slice(0, 35) : 'Lesson Practice Set';
    }
    if (titleInput) titleInput.value = title;
  }

  isGeneratingSet = true;
  toast('Auto-generating AI cheat sheet & practice questions...');
  try {
    const s = await api('POST', `/content/classes/${currentCid}/sets`, {
      title,
      notes: notesText,
      generate: true
    });
    toast(s.source === 'ai' ? 'AI draft ready! Cheat sheet & 5 questions generated.' : 'Practice set created.');
    go('#/set/' + s.id);
  } catch (err) {
    toast('AI generation failed: ' + err.message, true);
  } finally {
    isGeneratingSet = false;
  }
}

document.addEventListener('input', e => {
  if (e.target.id === 'p-num') S.sel = e.target.value;
  else if (e.target.id === 's-notes') {
    if (notesTypingTimer) clearTimeout(notesTypingTimer);
    const txt = e.target.value.trim();
    if (txt.length >= 10) {
      notesTypingTimer = setTimeout(() => {
        autoCreateSetFromNotes(txt);
      }, 1800);
    }
  }
});

document.addEventListener('paste', e => {
  if (e.target && e.target.id === 's-notes') {
    setTimeout(() => {
      const val = e.target.value.trim();
      if (val.length >= 2) {
        autoCreateSetFromNotes(val);
      }
    }, 100);
  } else if (e.target && e.target.dataset && e.target.dataset.f === 'notes' && location.hash.startsWith('#/set/')) {
    setTimeout(async () => {
      if (S.draft && S.draft.notes.trim().length >= 2) {
        toast('Auto-regenerating cheat sheet & 5 questions with AI...');
        try {
          await api('PUT', '/content/sets/' + S.draft.id, { notes: S.draft.notes });
          S.draft = await api('POST', `/content/sets/${S.draft.id}/regenerate`, {});
          toast('AI draft updated!');
          show(setEditor());
        } catch (err) {
          toast('Regeneration failed: ' + err.message, true);
        }
      }
    }, 100);
  }
});

document.addEventListener('focusout', e => {
  if (e.target && e.target.id === 's-notes') {
    const txt = e.target.value.trim();
    if (txt.length >= 3) {
      autoCreateSetFromNotes(txt);
    }
  }
});

async function ensureTesseract() {
  if (window.Tesseract && typeof Tesseract.recognize === 'function') return true;
  toast('Initializing OCR Engine...');
  return new Promise(resolve => {
    const urls = [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
    ];
    let idx = 0;
    function tryNext() {
      if (idx >= urls.length) return resolve(false);
      const s = document.createElement('script');
      s.src = urls[idx++];
      s.onload = () => resolve(typeof window.Tesseract !== 'undefined');
      s.onerror = tryNext;
      document.head.appendChild(s);
    }
    tryNext();
  });
}

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'radar-set') { S.radarSet = t.value; const box = $('#radarBox'); if (box) box.innerHTML = await radarHtml(cid()); }
  else if (t.id === 'a-role') { aRole = t.value; aPage = 1; route(); }
  else if (t.dataset.uid) { try { await api('PATCH', `/admin/users/${t.dataset.uid}/role`, { role: t.value }); toast('Role updated.'); } catch (err) { toast(err.message, true); route(); } }
  else if (t.id === 's-file') {
    const f = t.files[0];
    if (f) {
      const name = f.name;
      const ext = name.split('.').pop().toLowerCase();
      if (!val('s-title')) $('#s-title').value = name.replace(/\.[^.]+$/, '');
      if (ext === 'pdf') {
        const r = new FileReader();
        r.onload = async () => {
          let text = '';
          toast('Reading PDF file...');
          await ensureTesseract();

          if (window.pdfjsLib) {
            try {
              if (pdfjsLib.GlobalWorkerOptions) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
              }
              const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(r.result), disableFontFace: false });
              const pdf = await loadingTask.promise;
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                let pageText = '', lastY;
                for (const item of content.items) {
                  if (!item.str) continue;
                  if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > 5) {
                    pageText += '\n';
                  } else if (pageText.length > 0 && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
                    pageText += ' ';
                  }
                  pageText += item.str;
                  lastY = item.transform[5];
                }

                if (!pageText.trim()) {
                  toast(`OCR Scanning Page ${i}/${pdf.numPages}...`);
                  try {
                    const viewport = page.getViewport({ scale: 2.0 });
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                    // High-contrast grayscale pre-processing for Tesseract OCR
                    const ocrCanvas = document.createElement('canvas');
                    ocrCanvas.width = canvas.width;
                    ocrCanvas.height = canvas.height;
                    const ocrCtx = ocrCanvas.getContext('2d');
                    ocrCtx.filter = 'contrast(160%) grayscale(100%)';
                    ocrCtx.drawImage(canvas, 0, 0);

                    if (window.Tesseract && typeof Tesseract.recognize === 'function') {
                      const imgData = ocrCanvas.toDataURL('image/png');
                      const res = await Tesseract.recognize(imgData, 'eng');
                      if (res && res.data && res.data.text && res.data.text.trim()) {
                        pageText = res.data.text.trim();
                      }
                    }
                  } catch (ocrErr) { console.error('OCR error on page', i, ocrErr); }
                }

                if (pageText.trim()) text += pageText.trim() + '\n\n';
              }
            } catch (err) { console.error('PDF.js error:', err); }
          }
          if (!text.trim()) {
            try {
              const rawStr = new TextDecoder('latin1').decode(new Uint8Array(r.result));
              const matches = [];
              const re = /\(([^()\r\n]{2,})\)\s*T[jJ]/g;
              let m;
              while ((m = re.exec(rawStr)) !== null) {
                matches.push(m[1]);
              }
              if (matches.length > 0) text = matches.join(' ');
            } catch (e) {}
          }
          const cleanTitle = name.replace(/\.[^.]+$/, '');
          const notesInput = $('#s-notes');
          if (text.trim()) {
            const extracted = text.trim().slice(0, 20000);
            if (notesInput) notesInput.value = extracted;
            toast(`Successfully extracted text from ${name}! Auto-generating practice set...`);
            await autoCreateSetFromNotes(extracted, name);
          } else {
            if (notesInput) notesInput.value = cleanTitle;
            toast(`Loaded PDF "${cleanTitle}". Auto-generating practice set...`);
            await autoCreateSetFromNotes(cleanTitle, name);
          }
        };
        r.readAsArrayBuffer(f);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
        toast(`Scanning image "${name}" with OCR...`);
        await ensureTesseract();
        if (window.Tesseract) {
          try {
            const res = await Tesseract.recognize(f, 'eng');
            if (res && res.data && res.data.text && res.data.text.trim()) {
              const imgText = res.data.text.trim().slice(0, 20000);
              if ($('#s-notes')) $('#s-notes').value = imgText;
              toast(`Scanned text from image ${name}. Auto-generating practice set...`);
              await autoCreateSetFromNotes(imgText, name);
              return;
            }
          } catch (ocrErr) { console.error('Image OCR error:', ocrErr); }
        }
        const imgTitle = name.replace(/\.[^.]+$/, '');
        if ($('#s-notes')) $('#s-notes').value = imgTitle;
        toast(`Image uploaded: ${name}. Auto-generating practice set...`);
        await autoCreateSetFromNotes(imgTitle, name);
      } else if (ext === 'docx' || ext === 'doc') {
        if (window.mammoth) {
          const r = new FileReader();
          r.onload = async () => {
            try {
              const result = await mammoth.extractRawText({ arrayBuffer: r.result });
              const docxText = result.value.trim().slice(0, 20000);
              if ($('#s-notes')) $('#s-notes').value = docxText;
              toast('Extracted text from Word document. Auto-generating practice set...');
              await autoCreateSetFromNotes(docxText, f.name);
            } catch (err) { toast('Failed to parse Word document: ' + err.message, true); }
          };
          r.readAsArrayBuffer(f);
        } else { toast('Word document parser library not ready.', true); }
      } else {
        const r = new FileReader();
        r.onload = async () => {
          const txtNotes = String(r.result).slice(0, 20000);
          if ($('#s-notes')) $('#s-notes').value = txtNotes;
          toast('Loaded text file. Auto-generating practice set...');
          await autoCreateSetFromNotes(txtNotes, f.name);
        };
        r.readAsText(f);
      }
    }
  }
  else if (t.dataset.f && S.draft && location.hash.startsWith('#/set/')) {
    const f = t.dataset.f, d = S.draft, i = +t.dataset.i, j = +t.dataset.j, q = d.questions[i];
    if (f === 'title' || f === 'notes') d[f] = t.value;
    else if (f === 'cheat') d.cheat = t.value.split('\n');
    else if (f === 'type') { q.type = t.value; if (q.type === 'mcq' && !q.options) q.options = ['', '', '', '']; show(setEditor()); }
    else if (f === 'opt') { if (q.answer === q.options[j]) q.answer = t.value; q.options[j] = t.value; }
    else if (f === 'clue') q.clues[j] = t.value;
    else q[f] = t.value;
  }
});
addEventListener('hashchange', route);
if (token && tokenExpired(token)) { token = null; me = null; store.del('tp_token'); store.del('tp_user'); }
updateNav(); route();
})();
