/* Home: ringkasan pekerjaan hari ini (spesifikasi: docs/spec-home.md).
   Tahap 2 = kerangka (header, sapaan, tanggal, tata letak, bingkai kartu). Isi kartu diisi di tahap berikutnya. */
const HOME_COLS = [
  [{ id: 'upcoming', title: 'Upcoming Plan', more: '#plan' }, { id: 'ho', title: 'Handling Ops', more: '#ho' }],
  [{ id: 'settlement', title: 'Settlement', more: null }, { id: 'trailer', title: "Trailer's Schedule", more: null }],
];
const HOME_FULL = { id: 'faktur', title: 'Faktur Pajak Reimburse', more: null };

const homeCard = c => `<section class="card hcard" id="c-${c.id}" aria-labelledby="t-${c.id}">
  <header class="hc-h"><h3 id="t-${c.id}">${esc(c.title)} <span class="hc-n" id="n-${c.id}" hidden></span></h3>
    ${c.more ? `<a class="hc-more" href="${c.more}">More info..</a>` : '<span class="hc-more off" aria-disabled="true" title="Menu belum aktif">More info..</span>'}</header>
  <div class="hc-b" id="b-${c.id}" aria-live="polite"><div class="skel" aria-hidden="true"></div><div class="skel s2" aria-hidden="true"></div><div class="skel s3" aria-hidden="true"></div></div></section>`;

/* ---------- format & komponen kecil ---------- */
const ton2 = n => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const custCell = name => `<span class="cf">${esc(name)}</span><span class="cs" aria-hidden="true">${esc(IdFmt.shortCustomer(name))}</span>`; // lengkap di layar lebar, singkat di ponsel
// baris yang bisa diklik DAN bisa dicapai keyboard
const rowLink = href => `class="row" tabindex="0" role="link" onclick="location.hash='${href}'" onkeydown="if(event.key==='Enter'){location.hash='${href}'}"`;
const hpClass = v => (v >= 100 ? 'hp-blue' : v >= 50 ? 'hp-or' : 'hp-red'); // di bawah 50% merah, 50-99% oranye, 100% biru
const hpBar = (label, v) => `<span class="hp ${hpClass(v)}" title="${label === 'RM' ? 'Report Material' : 'Trucking Delivery'} ${ton2(v)}%"><abbr>${label}</abbr><i class="pb"><u style="width:${Math.min(100, v)}%"></u></i><b>${Math.round(v)}%</b></span>`;

function planRows(rows) {
  return rows.map(r => `<tr ${rowLink('#jo/' + r.jo_id)}><td><a href="#jo/${r.jo_id}">${esc(r.vessel || '-')}</a>${r.jo_count > 1 ? ` <span class="more" title="${r.jo_count} Job Order digabung">${r.jo_count} JO</span>` : ''}</td>
    <td class="cust">${custCell(r.customer)}</td><td>${esc(r.party || '-')}</td><td class="num">${ton2(r.weight)}</td><td>${IdFmt.shortDate(r.eta_etd)}</td></tr>`).join('');
}
const PLAN_HEAD = '<tr><th>Vessel</th><th>Customer</th><th>Party</th><th class="num">Weight</th><th>ETA/ETD</th></tr>';

/* ---------- kartu ---------- */
const HOME_LOADERS = {
  upcoming: {
    url: '/home/upcoming', empty: 'Belum ada rencana kapal yang akan datang atau berangkat.',
    render: d => `<div class="hc-t"><table>${PLAN_HEAD}${planRows(d.rows)}</table></div>`,
  },
  ho: {
    url: '/home/tickets', empty: 'Tidak ada tiket yang sedang berjalan.',
    render: d => `<div class="hc-t"><table><tr><th>No. Ticket</th><th>PIC</th><th>Customer</th><th>Vessel</th><th>Party</th><th class="num">Weight</th><th>Progress</th></tr>
      ${d.rows.map(t => `<tr ${rowLink('#ho/' + t.id + '/material')}><td><a href="#ho/${t.id}/material"><b>${esc(t.ticket_no)}</b></a></td><td>${esc(t.pic)}</td>
        <td class="cust">${t.customers.length ? custCell(t.customers[0]) + (t.customers.length > 1 ? ` <span class="more" title="${esc(t.customers.join('\n'))}">+${t.customers.length - 1}</span>` : '') : '-'}</td>
        <td class="wrapc">${multi(t.vessels)}</td><td>${multi(t.parties)}</td><td class="num">${ton2(t.weight)}</td><td class="hpw">${hpBar('RM', t.mat_pct)}${hpBar('TD', t.del_pct)}</td></tr>`).join('')}</table></div>`,
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
    body.innerHTML = d.rows.length ? L.render(d) : `<p class="hc-empty">${L.empty}</p>`;
  } catch (e) {
    if ($('#b-' + id)) body.innerHTML = `<div class="hc-err" role="alert"><span>Gagal memuat data.</span><button class="btn sec sm" type="button" onclick="homeLoad('${id}')">Coba lagi</button></div>`;
  }
}

function homeRoute() {
  $('#ttl').textContent = `Hi, ${IdFmt.firstName(uname) || 'User'}`;
  $('#view').innerHTML = `<div class="hhead"><p class="hdate"><time datetime="${IdFmt.jktDay(new Date())}">${IdFmt.longDate(new Date())}</time></p>
    <div class="hlinks"><button class="btn sec sm" type="button" disabled title="Menu belum aktif">Data &amp; Profil <span class="soon">segera</span></button><button class="btn sm" type="button" disabled title="Menu belum aktif">Check In <span class="soon">segera</span></button></div></div>
    <div class="home">${HOME_COLS.map(col => `<div class="hcol">${col.map(homeCard).join('')}</div>`).join('')}<div class="hfull">${homeCard(HOME_FULL)}</div></div>`;
  Object.keys(HOME_LOADERS).forEach(homeLoad);
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
  $('#plv').innerHTML = `<div class="tabs"><a class="btn sec sm" href="#home">‹ Home</a></div>
    <div class="bar fbar"><label class="inl">ETA/ETD <input type="date" id="pf" value="${planSt.from}"> – <input type="date" id="pt" value="${planSt.to}"></label><button class="btn sec" onclick="planReset()">Reset</button><span style="flex:1"></span><span class="tag" style="color:var(--ink)">${fmtN(d.total)} rencana</span></div>
    <div class="card tw"><table>${PLAN_HEAD}${d.rows.length ? planRows(d.rows) : '<tr><td colspan="5" style="text-align:center;color:var(--mut)">Tidak ada rencana pada rentang tanggal ini.</td></tr>'}</table>${pagerNum(d.page, d.pages, d.total, 'planGoto')}</div>`;
  $('#pf').onchange = e => { planSt.from = e.target.value || IdFmt.jktDay(new Date()); planSt.page = 1; planLoad(); };
  $('#pt').onchange = e => { planSt.to = e.target.value; planSt.page = 1; planLoad(); };
});
const planReset = () => { planSt = { from: IdFmt.jktDay(new Date()), to: '', page: 1 }; planLoad(); };
const planGoto = n => { planSt.page = n; planLoad(); };
