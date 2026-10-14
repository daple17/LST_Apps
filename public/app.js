const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// konstanta (tipe JO, satuan, item checklist, jenis dokumen, batas) datang dari server: look.rules (lib/rules.js)
const R = () => look.rules;
const typeLabel = c => R().JO_TYPES.find(t => t.code === c)?.label || c || '';
const docLabel = c => R().DOC_TYPES.find(t => t.code === c)?.label || c || '';
const MENU = [['OPERASIONAL', [['Job Order & Doc', 'jo'], ['Handling Ops', 'ho'], ['Trucking'], ['Submission'], ['Settlement'], ['Job Complete']]],
  ['FAT', [['Invoice & Tax'], ['Penerimaan'], ['Overhead'], ['Liability'], ['Equity'], ['Asset'], ['Financial Statement'], ['COA']]],
  ['APPROVAL', [['Approval']]], ['HR (SDM)', [['Employees']]],
  ['DATA MASTER', [['Customer'], ['Shipper'], ['Vendor'], ['Trailer'], ['Rute'], ['Unit'], ['PIB / PEB']]]];
let token = localStorage.getItem('tk'), uname = localStorage.getItem('un'), look = { customers: [], shippers: [] };

async function raw(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
  if (r.status === 401 && token) { logout(); throw new Error('Sesi berakhir'); }
  return r;
}
async function api(url, method, body) {
  const r = await raw(url, method, body), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
  return d;
}
const run = f => async (...a) => { try { await f(...a); } catch (e) { alert(e.message); } };
function logout() { localStorage.clear(); token = null; render(); }
const fmtD = d => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtDT = d => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fmtN = n => n == null ? '-' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
// rentang bulan berjalan (default filter periode)
const monthRange = () => {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = x => new Date(Date.UTC(y, m, x)).toISOString().slice(0, 10);
  return { from: iso(1), to: iso(new Date(y, m + 1, 0).getDate()) };
};
// pesan singkat non-blokir
function toast(msg, warn = false) { document.querySelector('.toast')?.remove(); const t = Object.assign(document.createElement('div'), { className: 'toast' + (warn ? ' warn' : ''), textContent: msg, role: 'status' }); document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }
// kartu/baris yang bisa diklik (mouse & keyboard)
const clickAttr = js => `role="button" tabindex="0" style="cursor:pointer" onclick="${js}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${js}}"`;
const closeMd = () => { $('#md').innerHTML = ''; };
// paginasi bernomor: |< < 1 2 3 4 5 .. N > >|  (fn = nama fungsi global yang menerima nomor halaman)
function pagerNum(page, pages, total, fn) {
  pages = Math.max(1, pages);
  const start = Math.max(1, Math.min(page - 2, pages - 4)), end = Math.min(pages, start + 4), nums = [];
  for (let i = start; i <= end; i++) nums.push(`<button class="btn sm ${i === page ? '' : 'sec'}" ${i === page ? 'aria-current="page"' : ''} onclick="${fn}(${i})">${i}</button>`);
  const b = (label, to, dis, aria) => `<button class="btn sec sm" aria-label="${aria}" ${dis ? 'disabled' : ''} onclick="${fn}(${to})">${label}</button>`;
  return `<div class="pg"><span>${total} data</span>${b('|‹', 1, page <= 1, 'Halaman pertama')}${b('‹', page - 1, page <= 1, 'Sebelumnya')}${nums.join('')}${end < pages ? `<span>…</span><button class="btn sec sm" onclick="${fn}(${pages})">${pages}</button>` : ''}${b('›', page + 1, page >= pages, 'Berikutnya')}${b('›|', pages, page >= pages, 'Halaman terakhir')}</div>`;
}
// nilai ganda: yang pertama + lencana "+n" (tooltip berisi semua)
const multi = (list, cls = '') => !list.length ? '-' : `${esc(list[0])}${list.length > 1 ? `<span class="more ${cls}" title="${esc(list.join('\n'))}">+${list.length - 1}</span>` : ''}`;
// menu aksi "⋯": daftar menu dipindah ke <body> saat dibuka (kartu kaca memakai backdrop-filter, yang membuat posisi fixed relatif ke kartu)
const menuClose = () => { document.querySelectorAll('body > .menu-list').forEach(x => x.remove()); document.querySelectorAll('.menu.open').forEach(x => x.classList.remove('open')); };
function menuToggle(btn) {
  const m = btn.parentElement, wasOpen = m.classList.contains('open');
  menuClose();
  if (wasOpen) return;
  const list = m.querySelector('.menu-list').cloneNode(true), r = btn.getBoundingClientRect();
  list.classList.add('floating'); list.addEventListener('click', () => setTimeout(menuClose));
  document.body.appendChild(list); m.classList.add('open'); menuAt = Date.now();
  list.style.top = Math.min(r.bottom + 4, innerHeight - list.offsetHeight - 8) + 'px'; list.style.left = Math.max(8, r.right - list.offsetWidth) + 'px';
}
document.addEventListener('click', e => { if (!e.target.closest('.menu')) menuClose(); });
let menuAt = 0; // scroll yang terjadi tepat setelah menu dibuka (mis. scroll-ke-tampilan oleh klik) diabaikan
window.addEventListener('scroll', () => { if (Date.now() - menuAt > 500) menuClose(); }, true); window.addEventListener('resize', menuClose);

function render() { document.body.classList.toggle('is-login', !token); token ? shell() : login(); }
const photoOf = p => `/uploads/${p}?t=${token}`;

function login() {
  $('#app').innerHTML = `<main class="login">
    <div class="login__watermark" aria-hidden="true">LESAT</div>
    <section class="login__hero">
      <div class="login__photo" aria-hidden="true"><picture><source srcset="assets/login/ship-portrait.webp" type="image/webp"><img src="assets/login/ship-portrait.jpg" alt="" fetchpriority="high"></picture></div>
      <div class="login__hero-content">
        <div class="login__brand"><img class="login__brand-icon" src="assets/login/lst-icon.png" alt="Logo LST"><div><span class="login__brand-name">LESAT</span><span class="login__brand-by">By Lima Sarana</span></div></div>
        <div class="login__hero-copy"><span class="login__eyebrow">LOGISTIC AND TRANSPORTATION SOLUTION</span><p class="login__quote">"We are your one-stop solutions for building big brands."</p></div>
      </div>
    </section>
    <section class="login__panel">
      <form class="login__card" id="lf" novalidate>
        <div><div class="login__bar"></div><h1 class="login__title">Login</h1><p class="login__lead">Masuk dengan akun internal untuk mengelola operasional harian.</p></div>
        <p class="login__alert" id="form-alert" role="alert" hidden></p>
        <div class="login__field" id="field-username"><label for="username">Username</label>
          <div class="login__control"><input id="username" name="username" type="text" autocomplete="username" placeholder="Masukkan username" required aria-describedby="err-username" autofocus></div>
          <p class="login__field-error" id="err-username" hidden>Username wajib diisi.</p></div>
        <div class="login__field" id="field-password"><label for="password">Password</label>
          <div class="login__control login__control--password"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Masukkan password" required aria-describedby="err-password">
            <button class="login__toggle" type="button" id="toggle-password" aria-label="Tampilkan password" aria-pressed="false">
              <svg id="eye-on" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg id="eye-off" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
            </button></div>
          <p class="login__field-error" id="err-password" hidden>Password wajib diisi.</p></div>
        <button class="login__btn" type="submit" id="submit-btn">Login</button>
        <div class="login__foot"><a class="login__link" href="#" id="forgot">Lupa Kata Sandi?</a></div>
      </form></section></main>`;
  const pw = $('#password'), tg = $('#toggle-password'), alertBox = $('#form-alert'), btn = $('#submit-btn');
  tg.onclick = () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; tg.setAttribute('aria-pressed', String(show)); tg.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password'); $('#eye-on').hidden = show; $('#eye-off').hidden = !show; };
  $('#forgot').onclick = e => { e.preventDefault(); alert('Hubungi admin untuk reset kata sandi.'); };
  const fieldError = (name, on) => { $('#field-' + name).classList.toggle('login__field--error', on); $('#err-' + name).hidden = !on; $('#' + name).setAttribute('aria-invalid', String(on)); };
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    alertBox.hidden = true;
    const u = $('#username').value.trim(), p = pw.value;
    fieldError('username', !u); fieldError('password', !p);
    if (!u || !p) { (!u ? $('#username') : pw).focus(); return; }
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    try {
      const d = await api('/login', 'POST', { username: u, password: p });   // alur autentikasi yang sama seperti sebelumnya; password tidak disimpan di mana pun
      token = d.token; uname = d.name; localStorage.setItem('tk', token); localStorage.setItem('un', uname); render();
    } catch (x) {
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      alertBox.textContent = /salah/i.test(x.message) ? 'Username atau password salah. Silakan coba lagi.' : x.message;
      alertBox.hidden = false;
    }
  };
}

function shell() {
  $('#app').innerHTML = `<div class="shell"><aside><div class="brand"><img src="logo.png" alt="LST"><div><b class="wm">LESAT</b><small>By Lima Sarana</small></div></div>
    <div class="grp">HOME</div><a class="off">Jadwal Truck &amp; Tiket</a>
    ${MENU.map(([g, items]) => `<div class="grp">${g}</div>${items.map(([n, k]) => k ? `<a href="#${k}" data-r="${k}">${n}</a>` : `<a class="off">${n}</a>`).join('')}`).join('')}
    </aside><div class="nav-bg" onclick="toggleNav(false)"></div><main><div class="top"><button class="btn sec mbtn" aria-label="Menu" onclick="toggleNav()">☰</button><h2 id="ttl"></h2><div class="usr"><span class="av" aria-hidden="true">${esc((uname || '?').trim().charAt(0).toUpperCase())}</span><span>${esc(uname)}</span><button class="btn sec sm" onclick="logout()">Logout</button></div></div><div id="view"></div></main></div><div id="md"></div>`;
  api('/lookups').then(d => { look = d; route(); }).catch(() => { /* sesi berakhir: api() sudah mengembalikan ke halaman login */ });
}
const toggleNav = on => document.body.classList.toggle('nav', on);
function route() {
  if (!token) return;
  toggleNav(false);
  const [r, ...rest] = (location.hash.slice(1) || 'jo').split('/');
  document.querySelectorAll('aside a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  $('#md').innerHTML = '';
  if (r === 'ho') return hoRoute(rest);
  joRoute(rest);
}
window.onhashchange = route;

// tabel -> kartu di layar kecil: beri label kolom pada tiap sel (CSS yang menyembunyikan header)
function labelTables() {
  document.querySelectorAll('.tw table').forEach(t => {
    const h = t.querySelector('tr th')?.parentElement;
    if (!h) return;
    const names = [...h.children].map(c => c.textContent.trim());
    t.classList.add('rt'); h.classList.add('th-row');
    t.querySelectorAll('tr:not(.th-row):not([data-d])').forEach(r => { r.dataset.d = 1; [...r.children].forEach((c, i) => { if (c.tagName === 'TD' && !c.colSpan || c.colSpan === 1) c.dataset.label = names[i] || ''; }); });
  });
}
new MutationObserver(() => requestAnimationFrame(labelTables)).observe(document.body, { childList: true, subtree: true });
