/* Dashboard (rute #home): ringkasan pekerjaan hari ini (docs/dashboard/DASHBOARD_SPEC.md, docs/spec-home.md).
   Kartu ringkasan (KPI) + lima widget. Hanya Handling Ops dan Upcoming Plan yang punya sumber data; sisanya "No Data Found"
   sampai menunya dikembangkan (tidak ada data contoh). */
const HOME_ROWS = 5;
const HOME_REFRESH_MS = 5 * 60 * 1000;
let homeTimer;
const IC = {
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9', cal: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z M3 7l12-3v3 M17 13h2', ship: 'M3 17l2 4h14l2-4z M6 17V9h12v8 M12 9V4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  up: 'M7 17L17 7 M8 7h9v9', right: 'M5 12h14 M13 6l6 6-6 6',
};
// widget (urutan = urutan di grid 12 kolom) dan kartu ringkasan; kartu tanpa menu sumber -> pending
const HOME_CARDS = [
  { id: 'ho', title: 'Handling Ops', hint: 'Terbaru dibuat di atas', more: '#ho', span: 8 },
  { id: 'upcoming', title: 'Upcoming Plan', more: '#plan', span: 4 },
  { id: 'settlement', title: 'Settlement', span: 4 }, { id: 'trailer', title: "Trailer's Schedule", span: 4 }, { id: 'faktur', title: 'Faktur Pajak', span: 4 },
];
const HOME_KPI = [
  { id: 'ho', label: 'HANDLING OPS', icon: IC.box, href: '#ho', hero: true, sub: 'tiket berjalan' },
  { id: 'upcoming', label: 'UPCOMING PLAN', icon: IC.cal, href: '#plan', sub: 'rencana ke depan' },
  { id: 'settlement', label: 'SETTLEMENT BELUM SUBMIT', icon: IC.wallet }, { id: 'trailer', label: "TRAILER'S SCHEDULE", icon: GICON.OPERASIONAL },
  { id: 'faktur', label: 'FAKTUR PAJAK REIMBURSE', icon: GICON.FAT },
];
const HOME_PENDING = ['settlement', 'trailer', 'faktur'];

const kpiCard = k => {
  const inner = `<div class="k-top"><span class="k-ic">${ico(k.icon)}</span>${k.href ? ico(IC.up) : ''}</div>
    <div class="k-mid"><span class="k-n" id="kn-${k.id}">${k.href ? '–' : '0'}</span><span class="k-s" id="ks-${k.id}">${k.href ? k.sub : 'Menu belum aktif'}</span></div><span class="k-l">${k.label}</span>`;
  return k.href ? `<a class="kpi${k.hero ? ' hero' : ''}" href="${k.href}">${inner}</a>` : `<div class="kpi off" role="group" aria-label="${k.label}, menu belum aktif">${inner}</div>`;
};
const homeCard = c => `<section class="card bc" style="grid-column:span ${c.span}" id="c-${c.id}" aria-labelledby="t-${c.id}">
  <header class="hc-h"><div class="hc-t1"><h3 id="t-${c.id}">${esc(c.title)}</h3><span class="hc-n" id="n-${c.id}">${HOME_PENDING.includes(c.id) ? '0' : ''}</span>${c.hint ? `<span class="hc-hint">${c.hint}</span>` : ''}</div>
    ${c.more ? `<a class="hc-more" href="${c.more}">More info${c.id === 'ho' ? ico(IC.right) : '..'}</a>` : '<span class="hc-more off" aria-disabled="true" title="Menu belum aktif">More info..</span>'}</header>
  <div class="hc-b" id="b-${c.id}" aria-live="polite">${HOME_PENDING.includes(c.id) ? '<p class="hc-empty">No Data Found</p>' : '<div class="skel" aria-hidden="true"></div><div class="skel s2" aria-hidden="true"></div><div class="skel s3" aria-hidden="true"></div>'}</div></section>`;

/* ---------- format & komponen kecil ---------- */
const ton2 = n => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = s => { const t = IdFmt.shortDate(s); return t.endsWith(IdFmt.jktDay(new Date()).slice(0, 4)) ? t.slice(0, -5) : t; }; // tahun hanya bila bukan tahun ini
const custCell = name => `<span class="cf">${esc(name)}</span><span class="cs" aria-hidden="true">${esc(IdFmt.shortCustomer(name))}</span>`; // lengkap di layar lebar, singkat di ponsel
// baris yang bisa diklik DAN bisa dicapai keyboard
const rowLink = href => `class="row" tabindex="0" role="link" onclick="location.hash='${href}'" onkeydown="if(event.key==='Enter'){location.hash='${href}'}"`;
const hpBar = (label, v) => `<span class="hp ${pcls(v)}" title="${label === 'RM' ? 'Report Material' : 'Trucking Delivery'} ${ton2(v)}%"><abbr>${label}</abbr><i class="pb"><u style="width:${Math.min(100, v)}%"></u></i><b>${Math.round(v)}%</b></span>`;
const AVC = ['#fb940c', '#1b6aa5', '#3a86b8', '#7c5cc4', '#157a3f'];
const picAv = n => `<span class="pav" style="background:${AVC[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length]}" aria-hidden="true">${esc((n || '?').charAt(0).toUpperCase())}</span>`;

function planRows(rows, full) {
  return rows.map(r => `<tr ${rowLink('#jo/' + r.jo_id)}><td><a href="#jo/${r.jo_id}"><b>${esc(r.vessel || '-')}</b></a>${r.jo_count > 1 ? ` <span class="more" title="${r.jo_count} Job Order digabung">${r.jo_count} JO</span>` : ''}<span class="cust sub">${custCell(r.customer)}</span></td>
    <td>${esc(r.party || '-')}</td><td class="num">${ton2(r.weight)}<small> ton</small></td><td class="eta">${full ? IdFmt.shortDate(r.eta_etd) : dmy(r.eta_etd)}</td></tr>`).join('');
}
const PLAN_HEAD = '<tr><th>Vessel</th><th>Party</th><th class="num">Weight</th><th>ETA/ETD</th></tr>';

/* ---------- kartu ---------- */
const HOME_LOADERS = {
  upcoming: {
    url: '/home/upcoming', empty: 'Belum ada rencana kapal yang akan datang atau berangkat.',
    kpi: d => [d.total, d.rows[0] ? 'ETA terdekat ' + dmy(d.rows[0].eta_etd) : 'rencana ke depan'],
    render: d => `<div class="hc-t"><table>${PLAN_HEAD}${planRows(d.rows.slice(0, HOME_ROWS))}</table></div>`,
  },
  ho: {
    url: '/home/tickets', empty: 'Tidak ada tiket yang sedang berjalan.',
    kpi: d => [d.total, 'tiket berjalan'],
    render: d => `<div class="hc-t"><table><tr><th>No. Ticket</th><th>Customer / Vessel</th><th>Party</th><th class="num">Weight</th><th>Progress</th><th><span class="sr">Aksi</span></th></tr>
      ${d.rows.slice(0, HOME_ROWS).map(t => `<tr ${rowLink('#ho/' + t.id + '/material')}><td><a href="#ho/${t.id}/material"><b>${esc(t.ticket_no)}</b></a><span class="pic sub">${picAv(t.pic)}${esc(t.pic)}</span></td>
        <td class="cust">${t.customers.length ? custCell(t.customers[0]) + (t.customers.length > 1 ? ` <span class="more" title="${esc(t.customers.join('\n'))}">+${t.customers.length - 1}</span>` : '') : '-'}<span class="sub ves">${ico(IC.ship)}${multi(t.vessels)}</span></td>
        <td>${multi(t.parties)}</td><td class="num">${ton2(t.weight)}<small> ton</small></td><td class="hpw">${hpBar('RM', t.mat_pct)}${hpBar('TD', t.del_pct)}</td>
        <td class="act" onclick="event.stopPropagation()">${rowMenu(t.ticket_no, [{ t: 'Go to..', js: `location.hash='#ho/${t.id}/material'` }, { t: 'Copy Report', js: `hoCopy(${t.id})` }])}</td></tr>`).join('')}</table></div>`,
  },
};

// tiap kartu dimuat sendiri: gagal di satu kartu tidak mengganggu kartu lain
async function homeLoad(id) {
  const L = HOME_LOADERS[id], body = $('#b-' + id);
  if (!L || !body) return;
  try {
    const d = await api(L.url);
    if (!$('#b-' + id)) return; // sudah pindah halaman
    const n = $('#n-' + id); n.textContent = fmtN(d.total); n.hidden = false;
    const [kn, ks] = L.kpi(d); $('#kn-' + id).textContent = fmtN(kn); $('#ks-' + id).textContent = ks;
    body.innerHTML = d.rows.length ? L.render(d) : `<p class="hc-empty">No Data Found</p>`;
  } catch (e) {
    if ($('#b-' + id) && !body.querySelector('table')) body.innerHTML = `<div class="hc-err" role="alert"><span>Gagal memuat data.</span><button class="btn sec sm" type="button" onclick="homeLoad('${id}')">Coba lagi</button></div>`;
  }
}

// pencarian cepat: membuka daftar Job Order dengan kata kunci (mencakup vessel dan semua referensi), tanpa batas periode
function homeSearch(e) {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return false;
  joSt = joBlank(); joSt.q = q; joSt.from = ''; joSt.to = '';
  location.hash === '#jo' ? route() : (location.hash = '#jo');
  return false;
}

function homeRoute() {
  $('#ttl').textContent = `Hi, ${IdFmt.firstName(uname) || 'User'}`;
  $('#sub').innerHTML = `${ico(IC.cal)}<time datetime="${IdFmt.jktDay(new Date())}">${IdFmt.longDate(new Date())}</time>`;
  $('#topx').innerHTML = `<form class="srch" role="search" onsubmit="return homeSearch(event)">${ico(IC.search)}<label class="sr" for="q">Cari</label><input id="q" type="search" placeholder="Cari JO, vessel, referensi…" autocomplete="off"></form>
    <button class="pill" type="button" disabled title="Menu belum aktif">Data &amp; Profil <span class="soon">segera</span></button>
    <button class="checkin" id="ci-home" type="button" onclick="goCheckin()" aria-label="Check In"><span class="ci-ic">${ico(IC.clock)}</span><span class="ci-t"><b>Check In</b><small>…</small></span></button>`;
  $('#view').innerHTML = `<div class="dash"><section class="kpis" aria-label="Ringkasan">${HOME_KPI.map(kpiCard).join('')}</section>
    <section class="bento" aria-label="Widget">${HOME_CARDS.map(homeCard).join('')}</section></div>`;
  Object.keys(HOME_LOADERS).forEach(homeLoad); ciHomeBtn();
  clearInterval(homeTimer); // penyegaran 5 menit, hanya selama Dashboard terbuka dan tab terlihat
  homeTimer = setInterval(() => {
    if (!$('#c-upcoming')) return clearInterval(homeTimer);
    if (!document.hidden) Object.keys(HOME_LOADERS).forEach(homeLoad);
  }, HOME_REFRESH_MS);
}

/* ---------- halaman penuh: Rencana delivery ---------- */
let planSt = { from: '', to: '', page: 1 };
function planRoute() {
  if (!planSt.from) planSt.from = IdFmt.jktDay(new Date());
  $('#ttl').textContent = 'Rencana Delivery';
  $('#view').innerHTML = '<div id="plv"></div>';
  planLoad();
}
const planLoad = run(async () => {
  const d = await api('/home/plan?' + new URLSearchParams(planSt));
  $('#plv').innerHTML = `<div class="tabs"><a class="btn sec sm" href="#home">‹ Dashboard</a></div>
    <div class="bar fbar"><label class="inl">ETA/ETD <input type="date" id="pf" value="${planSt.from}"> – <input type="date" id="pt" value="${planSt.to}"></label><button class="btn sec" onclick="planReset()">Reset</button><span style="flex:1"></span><span class="tag" style="color:var(--ink)">${fmtN(d.total)} rencana</span></div>
    <div class="card tw"><table>${PLAN_HEAD}${d.rows.length ? planRows(d.rows) : '<tr><td colspan="4" style="text-align:center;color:var(--mut)">Tidak ada rencana pada rentang tanggal ini.</td></tr>'}</table>${pagerNum(d.page, d.pages, d.total, 'planGoto')}</div>`;
  $('#pf').onchange = e => { planSt.from = e.target.value || IdFmt.jktDay(new Date()); planSt.page = 1; planLoad(); };
  $('#pt').onchange = e => { planSt.to = e.target.value; planSt.page = 1; planLoad(); };
});
const planReset = () => { planSt = { from: IdFmt.jktDay(new Date()), to: '', page: 1 }; planLoad(); };
const planGoto = n => { planSt.page = n; planLoad(); };
