const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// konstanta (tipe JO, satuan, item checklist, jenis dokumen, batas) datang dari server: look.rules (lib/rules.js)
const R = () => look.rules;
const typeLabel = c => R().JO_TYPES.find(t => t.code === c)?.label || c || '';
const docLabel = c => R().DOC_TYPES.find(t => t.code === c)?.label || c || '';
const ico = d => `<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const GICON = { HOME: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', OPERASIONAL: 'M3 7h11v9H3z M14 10h4l3 3v3h-7z M5.5 17.5h3 M15.5 17.5h3',
  FAT: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7', APPROVAL: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  'HR (SDM)': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 11a2.5 2.5 0 1 0 0-5 M21 19c0-2.5-1.5-4.5-4-5',
  ADMINISTRATOR: 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', 'DATA MASTER': 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' };
// grup sidebar sesuai Tab Menu; item tanpa kode rute tampil nonaktif "segera"
const MENU = [['HOME', [['Dashboard', 'home', 'home']]],
  ['OPERASIONAL', [['Job Order & Doc', 'jo', 'jo'], ['Handling Ops', 'ho', 'ho'], ['Trucking', null, 'trucking'], ['Submission', null, 'submission'], ['Settlement', null, 'settlement'], ['Job Complete', null, 'job_complete']]],
  ['FAT', [['Invoice & Tax'], ['Penerimaan'], ['Overhead'], ['Liability'], ['Equity'], ['Asset'], ['Financial Statement'], ['COA', 'coa', 'coa']]],
  ['APPROVAL', [['Submission', null, 'approval'], ['Expenses', null, 'approval'], ['Job Complete', null, 'approval'], ['Payment', null, 'approval']]],
  ['HR (SDM)', [['Employees'], ['Partner'], ['Check In & Report', 'checkin', 'checkin'], ['Loans']]],
  ['DATA MASTER', [['Trailer'], ['Rute'], ['Customer', 'customer', 'customer'], ['Vendor', 'vendor', 'vendor'], ['Shipper', null, 'shipper'], ['PIB / PEB'], ['Unit', null, 'unit']]],
  ['ADMINISTRATOR', [['User Management', 'users', 'user'], ['Role Management', 'roles', 'role']]]];
let me = null; // pengguna login: role + izin (GET /api/me)
const can = code => !!me?.permissions?.includes(code);
// item sidebar terlihat bila tidak dipetakan ke modul, atau user punya izin lihat modul itu
const menuVisible = ([, , m]) => !m || can(m + '.view') || (m === 'checkin' && can('checkin_rekap.view'));
// halaman -> modul izin; halaman tanpa izin lihat tidak dibuka
const ROUTE_MOD = { home: 'home', plan: 'home', jo: 'jo', ho: 'ho', users: 'user', roles: 'role', coa: 'coa', checkin: 'checkin', customer: 'customer', vendor: 'vendor' };
let token = localStorage.getItem('tk'), uname = localStorage.getItem('un'), look = { customers: [], shippers: [] };

async function raw(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
  if (r.status === 401 && token) { logout(); throw new Error('Sesi berakhir'); }
  return r;
}
async function api(url, method, body) {
  const r = await raw(url, method, body), d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Error ' + r.status), { fields: d.fields, status: r.status, data: d });
  return d;
}
const run = f => async (...a) => { try { await f(...a); } catch (e) { alert(e.message); } };
function logout() { localStorage.clear(); token = null; me = null; render(); }
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
// Kolom "Aksi" seragam di semua menu: tombol ⋯ + daftar item. items: [{ t: 'Edit', js: 'userForm(1)', danger, disabled, title }] (item falsy dilewati).
// Penyembunyian per izin lewat PERM_BTN (mengecek isi onclick); bila semua item tersembunyi, tombol ⋯ ikut disembunyikan.
function rowMenu(label, items, glyph = '⋯') {
  const its = items.filter(Boolean);
  if (!its.length) return '';
  return `<div class="menu"><button class="ib" type="button" aria-label="Aksi ${esc(label)}" aria-haspopup="menu" aria-expanded="false" onclick="menuToggle(this)">${glyph}</button><div class="menu-list" role="menu">${its.map(i =>
    `<button role="menuitem" type="button" class="${i.danger ? 'danger' : ''}" ${i.disabled ? 'disabled' : ''} ${i.title ? `title="${esc(i.title)}"` : ''} onclick="${esc(i.js)}">${esc(i.t)}</button>`).join('')}</div></div>`;
}
// menu aksi "⋯": daftar menu dipindah ke <body> saat dibuka (kartu kaca memakai backdrop-filter, yang membuat posisi fixed relatif ke kartu)
let menuBtnOpen = null;
const menuClose = (focusBack = false) => {
  document.querySelectorAll('body > .menu-list').forEach(x => x.remove());
  document.querySelectorAll('.menu.open').forEach(x => { x.classList.remove('open'); x.querySelector('.ib')?.setAttribute('aria-expanded', 'false'); });
  if (focusBack === true && menuBtnOpen?.isConnected) menuBtnOpen.focus();
  menuBtnOpen = null;
};
// keyboard: panah atas/bawah, Home/End berpindah item; Esc menutup dan mengembalikan fokus; Tab menutup
function menuKey(e) {
  const items = [...e.currentTarget.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); menuClose(true); }
  else if (e.key === 'Tab') menuClose();
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && items.length) { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
}
function menuToggle(btn) {
  const m = btn.parentElement, wasOpen = m.classList.contains('open');
  menuClose();
  if (wasOpen) return;
  const list = m.querySelector('.menu-list').cloneNode(true), r = btn.getBoundingClientRect();
  list.classList.add('floating'); list.addEventListener('click', () => setTimeout(menuClose)); list.addEventListener('keydown', menuKey);
  document.body.appendChild(list); m.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); menuAt = Date.now(); menuBtnOpen = btn;
  list.style.top = Math.min(r.bottom + 4, innerHeight - list.offsetHeight - 8) + 'px'; list.style.left = Math.max(8, r.right - list.offsetWidth) + 'px';
  list.querySelector('button:not(:disabled)')?.focus();
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
  try { document.body.classList.toggle('collapsed', !!localStorage.getItem('collapsed')); } catch { /* abaikan */ }
  const chev = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  $('#app').innerHTML = `<div class="shell"><aside aria-label="Menu utama"><div class="brand"><img src="logo.png" alt="Logo LST"><div><b class="wm">LESAT</b><small>By Lima Sarana</small></div></div>
    <nav></nav>
    <button class="aside-collapse" type="button" onclick="toggleCollapse()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5 M18 17l-5-5 5-5"/></svg><span class="lb">Collapse</span></button></aside>
    <div class="nav-bg" onclick="toggleNav(false)"></div>
    <main><div class="top"><button class="btn sec mbtn" aria-label="Menu" onclick="menuBtn()">☰</button><div class="tt"><h2 id="ttl"></h2><p id="sub"></p></div>
      <div class="topr"><div id="topx"></div><div class="usr"><button class="av" type="button" title="${esc(uname)}" aria-label="Akun saya: ${esc(uname)}" onclick="accountModal()">${esc((uname || '?').trim().charAt(0).toUpperCase())}</button><button class="lo" type="button" aria-label="Logout" onclick="logout()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9"/></svg></button></div></div></div><div id="view"></div></main></div><div id="md"></div>`;
  Promise.all([api('/lookups'), api('/me')]).then(([d, m]) => { look = d; me = m; shell2(); }).catch(() => { /* sesi berakhir: api() sudah mengembalikan ke halaman login */ });
}
// menu dibangun ulang setelah izin diketahui, lalu halaman dibuka
function shell2() {
  const nav = document.querySelector('aside nav');
  const chev = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  nav.innerHTML = MENU.map(([g, items]) => [g, items.filter(menuVisible)]).filter(([, items]) => items.length).map(([g, items]) => `<details class="gw"${g === 'HOME' || g === 'OPERASIONAL' ? ' open' : ''}><summary title="${g}" onclick="railOpen()">${ico(GICON[g])}<span class="lb">${g}</span>${chev}</summary><div class="gi">${items.map(([n, k]) => k ? `<a href="#${k}" data-r="${k}">${n}</a>` : `<a class="off" aria-disabled="true">${n}</a>`).join('')}</div></details>`).join('');
  route();
}
const toggleNav = on => document.body.classList.toggle('nav', on);
// Collapse sidebar (desktop): disimpan per browser; di ponsel menu tetap berupa laci geser
const setCollapsed = on => { document.body.classList.toggle('collapsed', on); try { localStorage.setItem('collapsed', on ? '1' : ''); } catch { /* penyimpanan tidak tersedia */ } };
const toggleCollapse = () => setCollapsed(!document.body.classList.contains('collapsed'));
// ikon grup di sidebar yang diciutkan: klik membuka sidebar lagi
const railOpen = () => { if (document.body.classList.contains('collapsed') && innerWidth > 800) setCollapsed(false); };
const menuBtn = () => (innerWidth <= 800 ? toggleNav() : toggleCollapse());
function route() {
  if (!token) return;
  toggleNav(false);
  const [r, ...rest] = (location.hash.slice(1) || 'home').split('/');
  document.querySelectorAll('aside a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === (r === 'plan' ? 'home' : r)));
  $('#md').innerHTML = ''; $('#topx').innerHTML = ''; $('#sub').textContent = ''; $('#view').innerHTML = '';
  const on = document.querySelector('aside a.on'); if (on) on.closest('details').open = true; // grup berisi halaman aktif selalu terbuka
  if (me?.must_change_password) { $('#ttl').textContent = ''; return accountModal(true); }
  const mod = ROUTE_MOD[r] || 'jo';
  if (!can(mod + '.view') && !(r === 'checkin' && can('checkin_rekap.view'))) return noAccess(location.hash.slice(1) ? '' : firstAllowed());
  if (r === 'coa') return coaRoute(rest);
  if (r === 'customer') return customerRoute();
  if (r === 'vendor') return vendorRoute();
  if (r === 'checkin') return checkinRoute(rest);
  if (r === 'users') return usersRoute();
  if (r === 'roles') return rolesRoute();
  if (r === 'home') return homeRoute(rest);
  if (r === 'plan') return planRoute();
  if (r === 'ho') return hoRoute(rest);
  joRoute(rest);
}
// halaman pertama yang boleh dibuka user (bila beranda tidak diizinkan)
const firstAllowed = () => ['home', 'jo', 'ho', 'coa', 'checkin', 'customer', 'vendor', 'users', 'roles'].find(r => can(ROUTE_MOD[r] + '.view') || (r === 'checkin' && can('checkin_rekap.view')));
function noAccess(goto) {
  if (goto) { location.hash = '#' + goto; return; }
  $('#ttl').textContent = 'Tidak punya akses';
  $('#view').innerHTML = '<div class="card noacc" role="alert"><h3>Tidak punya akses</h3><p>Role Anda belum diberi izin untuk membuka halaman ini. Hubungi administrator bila Anda memerlukannya.</p><a class="btn sec" href="#">Kembali</a></div>';
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
// tombol aksi yang tidak diizinkan disembunyikan (server tetap menolak walau tombolnya dipaksa muncul)
const PERM_BTN = [[/^joNew\(|^joForm\(null|^joDup\(/, 'jo.create'], [/^joForm\(/, 'jo.update'], [/^joSetStatus\(/, 'jo.update'], [/^joDelete\(|^joMatDelete\(|^joDocDelete\(/, 'jo.delete'],
  [/^joExport\(|^joTemplate\(/, 'jo.export'], [/^joImport\(/, 'jo.create'], [/^joMatForm\(\)/, 'jo.create'], [/^joMatForm\(/, 'jo.update'],
  [/^hoExport\(|^hoDl\(/, 'ho.export'], [/^hoTicketForm\(\)/, 'ho.create'], [/^hoTicketForm\(/, 'ho.update'], [/^hoDelTicket\(|^hoDelMat\(|^hoDelSj\(/, 'ho.delete'],
  [/^coaForm\(\)|^coaGroupForm\(\)/, 'coa.create'], [/^coaForm\(|^coaGroupForm\(/, 'coa.update'], [/^coaExport\(/, 'coa.export'], [/^coaToggle\(|^coaGroupToggle\(/, 'coa.update'], [/^coaGroupDelete\(/, 'coa.delete'], [/^cuToggle\(/, 'customer.update'], [/^userToggle\(/, 'user.update'], [/^joDocDelete\(/, 'jo.delete'], [/^joDocPick\(/, 'jo.update'], [/^vnForm\(\)/, 'vendor.create'], [/^vnForm\(/, 'vendor.update'], [/^vnToggle\(/, 'vendor.update'], [/^vnExport\(/, 'vendor.export'], [/^vnDelete\(/, 'vendor.delete'], [/^cuForm\(\)/, 'customer.create'], [/^cuForm\(/, 'customer.update'], [/^cuExport\(/, 'customer.export'], [/^cuDelete\(/, 'customer.delete'],
  [/^goCheckin\(/, 'checkin.view'], [/^ciReportForm\(\)/, 'checkin.create'], [/^ciReportForm\(/, 'checkin.update'], [/^rekapExport\(/, 'checkin_rekap.export'], [/^rekapOverride\(|^rekapReportEdit\(/, 'checkin_rekap.update'],
  [/^hoSjForm\(\)/, 'ho.create'], [/^hoSjForm\(/, 'ho.update'], [/^hoSjFinish\(/, 'ho.update'], [/^hoMatForm\(/, 'ho.update'], [/^hoRelink\(/, 'ho.update'],
  [/^hoTrk(Ready|Complete|Revoke|Regen|Unlock|Share|Copy|Qr|Manual|Undo|Reopen)\(/, 'ho.update']];
function applyPerms() {
  if (!me) return;
  document.querySelectorAll('#view [onclick], #md [onclick], #topx [onclick]').forEach(el => {
    if (el.dataset.pm) return; el.dataset.pm = 1;
    const oc = el.getAttribute('onclick'), hit = PERM_BTN.find(([re]) => re.test(oc));
    if (hit && !can(hit[1])) el.hidden = true;
  });
  document.querySelectorAll('.menu:not([hidden])').forEach(m => { if (!m.querySelector('.menu-list button:not([hidden])')) m.hidden = true; });
}
new MutationObserver(() => requestAnimationFrame(() => { labelTables(); applyPerms(); })).observe(document.body, { childList: true, subtree: true });
