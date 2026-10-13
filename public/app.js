const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = ['PIB BC 2.0', 'PIB BC 1.6', 'PIB BC 2.8', 'PEB', 'LOKAL', 'TRUCKING'];
const DOC_CATS = ['Bill of Lading', 'Invoice', 'Packing List', 'SI / PO', 'PIB / PEB', 'DO', 'Faktur Pajak', 'Lainnya'];
const CHECK = [['agency', 'Agency/Adm'], ['do', 'DO'], ['storage', 'Storage'], ['pibpeb', 'PIB / PEB'], ['nopen', 'Nopen'], ['thc', 'THC'], ['lolo_on', 'Lift On'], ['lolo_off', 'Lift Off'], ['sj', 'Surat Jalan'], ['demurrage', 'Demurrage/Detention'], ['repair', 'Repair'], ['others', 'Others']];
const MENU = [['OPERASIONAL', [['Job Order & Doc', 'jo'], ['Handling Ops', 'ho'], ['Trucking'], ['Submission'], ['Settlement'], ['Job Complete']]],
  ['FAT', [['Invoice & Tax'], ['Penerimaan'], ['Overhead'], ['Liability'], ['Equity'], ['Asset'], ['Financial Statement'], ['COA']]],
  ['APPROVAL', [['Approval']]], ['HR (SDM)', [['Employees']]],
  ['DATA MASTER', [['Customer'], ['Shipper'], ['Vendor'], ['Trailer'], ['Rute'], ['Unit'], ['PIB / PEB']]]];
const blank = () => ({ q: '', status: '', type: '', customer_id: '', from: '', to: '', sort: 'created', dir: 'desc', page: 1 });
let token = localStorage.getItem('tk'), uname = localStorage.getItem('un'), look = { customers: [], shippers: [] }, st = blank();

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

function render() { token ? shell() : login(); }
const photoOf = p => `/uploads/${p}?t=${token}`;

function login() {
  $('#app').innerHTML = `<div class="login"><div class="about"><div class="logo"><img src="logo.png" alt="LST"><div><b class="wm"><i>me</i>LESAT</b><div>By Lima Sarana</div></div></div>
    <p>Selamat datang di Sistem Internal berbasis web PT Lima Sarana Trans — logistik, trucking, handling &amp; custom clearance.</p>
    <small>Kontak: IT Support · it@limasarana.example</small></div>
    <form id="lf"><h2 style="margin:0">Login</h2><div><label>Username</label><input name="username" autofocus required></div>
    <div><label>Password</label><input name="password" type="password" required></div>
    <div class="err" id="le"></div><button class="btn">Login</button><a href="#" onclick="alert('Hubungi admin untuk reset kata sandi.');return false">Lupa Kata Sandi?</a></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api('/login', 'POST', Object.fromEntries(new FormData(e.target)));
      token = d.token; uname = d.name; localStorage.setItem('tk', token); localStorage.setItem('un', uname); render();
    } catch (x) { $('#le').textContent = x.message; }
  };
}

function shell() {
  $('#app').innerHTML = `<div class="shell"><aside><div class="brand"><img src="logo.png" alt="LST"><div><b class="wm"><i>me</i>LESAT</b><small>By Lima Sarana</small></div></div>
    <div class="grp">HOME</div><a class="off">Jadwal Truck &amp; Tiket</a>
    ${MENU.map(([g, items]) => `<div class="grp">${g}</div>${items.map(([n, k]) => k ? `<a href="#${k}" data-r="${k}">${n}</a>` : `<a class="off">${n}</a>`).join('')}`).join('')}
    </aside><div class="nav-bg" onclick="toggleNav(false)"></div><main><div class="top"><button class="btn sec mbtn" aria-label="Menu" onclick="toggleNav()">☰</button><h2 id="ttl"></h2><div class="usr"><span class="av" aria-hidden="true">${esc((uname || '?').trim().charAt(0).toUpperCase())}</span><span>${esc(uname)}</span><button class="btn sec sm" onclick="logout()">Logout</button></div></div><div id="view"></div></main></div><div id="md"></div>`;
  api('/lookups').then(d => { look = d; route(); });
}
const toggleNav = on => document.body.classList.toggle('nav', on);
function route() {
  if (!token) return;
  toggleNav(false);
  const [r, ...rest] = (location.hash.slice(1) || 'jo').split('/');
  document.querySelectorAll('aside a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  $('#md').innerHTML = '';
  if (r === 'ho') return hoRoute(rest);
  $('#ttl').textContent = 'Job Order & Doc';
  $('#view').innerHTML = '<div id="sum"></div><div id="pg"></div>';
  joList();
  if (rest[0]) detail(+rest[0]);
}
window.onhashchange = route;

const qs = (extra = {}) => new URLSearchParams({ ...st, ...extra });
async function joList() {
  const [d, s] = await Promise.all([api('/job-orders?' + qs()), api('/job-orders/summary')]);
  $('#sum').innerHTML = `<div class="cards">${[['Total JO', s.total, '', 's-total'], ['Not Complete', s.open_jo, 'NOT_COMP', 's-open'], ['Complete', s.done, 'COMPLETE', 's-done'], ['ETA 7 hari ke depan', s.eta_week, '', 's-eta'], ['Lewat rencana delivery', s.late, 'late', 's-late']]
    .map(([l, v, f, c]) => `<div class="card stat ${c} ${f === 'late' && v ? 'warn' : ''}" ${c === 's-total' ? clickAttr('resetF()') : f && f !== 'late' ? clickAttr(`setF('status','${f}')`) : ''}><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
  const th = (k, n) => `<th style="cursor:pointer" onclick="sortBy('${k}')">${n}${st.sort === k ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const late = r => r.status === 'NOT_COMP' && r.delivery_plan && r.delivery_plan < today();
  $('#pg').innerHTML = `<div class="bar fbar"><input id="q" placeholder="Cari JO, customer, vessel, BL, No. Aju, Invoice" value="${esc(st.q)}">
    <select id="fs"><option value="">Semua status</option><option value="NOT_COMP">Not Complete</option><option value="COMPLETE">Complete</option></select>
    <select id="ft"><option value="">Semua type</option>${TYPES.map(t => `<option>${t}</option>`).join('')}</select>
    <select id="fc"><option value="">Semua customer</option>${look.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <label class="inl">ETA <input type="date" id="ff" value="${st.from}"> – <input type="date" id="fto" value="${st.to}"></label>
    <button class="btn sec" onclick="resetF()">Reset</button><span style="flex:1"></span>
    <button class="btn sec out" onclick="exportCsv()">Export CSV</button><button class="btn" onclick="joForm()">+ Job Order</button></div>
    <div class="card tw"><table><tr>${th('jo_no', 'No. JO')}<th>Type</th>${th('customer', 'Customer')}<th>Vessel</th><th>Party</th><th>Weight</th>${th('eta', 'ETA/ETD')}${th('delivery_plan', 'Rencana Delivery')}<th>Status</th></tr>
    ${d.rows.map(r => `<tr class="row" style="cursor:pointer" onclick="detail(${r.id})"><td><b>${esc(r.jo_no)}</b></td><td><span><span class="dot t-${esc(r.type)}"></span>${esc(r.type)}</span></td><td class="wrap">${esc(r.customer_name)}</td><td>${esc(r.vessel)}</td><td>${esc(r.party)}</td><td>${fmtN(r.weight)}</td><td>${fmtD(r.eta)}</td><td ${late(r) ? 'style="color:var(--bad);font-weight:600" title="Lewat rencana delivery"' : ''}>${fmtD(r.delivery_plan)}</td><td><span class="tag ${r.status}">${r.status === 'COMPLETE' ? 'Complete' : 'Not Comp'}</span></td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--mut)">Belum ada data</td></tr>'}</table>
    <div class="pg"><span>${d.total} data</span><button class="btn sec sm" ${st.page <= 1 ? 'disabled' : ''} onclick="go(-1)">‹</button><span>${st.page}/${d.pages || 1}</span><button class="btn sec sm" ${st.page >= d.pages ? 'disabled' : ''} onclick="go(1)">›</button></div></div>`;
  $('#fs').value = st.status; $('#ft').value = st.type; $('#fc').value = st.customer_id;
  let t; $('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; joList().then(() => { const q = $('#q'); q.focus(); q.setSelectionRange(1e4, 1e4); }); }, 300); };
  [['fs', 'status'], ['ft', 'type'], ['fc', 'customer_id'], ['ff', 'from'], ['fto', 'to']].forEach(([i, k]) => $('#' + i).onchange = e => setF(k, e.target.value));
}
// kartu KPI yang bisa diklik (mouse & keyboard)
const clickAttr = js => `role="button" tabindex="0" style="cursor:pointer" onclick="${js}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${js}}"`;
const setF = (k, v) => { st[k] = v; st.page = 1; joList(); };
const resetF = () => { st = blank(); joList(); };
const sortBy = k => { st.dir = st.sort === k && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = k; joList(); };
const go = n => { st.page += n; joList(); };
const closeMd = () => { $('#md').innerHTML = ''; if (location.hash.startsWith('#jo/')) history.replaceState(null, '', '#jo'); };
const exportCsv = run(async () => {
  const r = await raw('/job-orders/export?' + qs());
  if (!r.ok) throw new Error('Export gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `job-order-${today()}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
});

const joForm = run(async id => {
  const j = id ? await api('/job-orders/' + id) : { type: 'PIB BC 2.0', checklist: {} }, c = j.checklist || {};
  const opt = (arr, v, f) => arr.map(x => `<option value="${x.id}" ${x.id == v ? 'selected' : ''}>${esc(f(x))}</option>`).join('');
  $('#md').innerHTML = `<div class="modal"><form class="card" id="jf"><h3 style="margin-top:0">${id ? 'Edit ' + esc(j.jo_no) : 'Job Order Baru'}</h3><div class="g">
    <div><label>Type *</label><select name="type">${TYPES.map(t => `<option ${t === j.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label>Customer * ${id ? '(tidak bisa diubah)' : '<a href="#" onclick="quickAdd(\'customer\');return false">+ baru</a>'}</label><select name="customer_id" id="sc" required ${id ? 'disabled' : ''}><option value="">Pilih…</option>${opt(look.customers, j.customer_id, x => `${x.name} (${x.code})`)}</select></div>
    <div><label>Shipper / Ship To <a href="#" onclick="quickAdd('shipper');return false">+ baru</a></label><select name="shipper_id" id="ss"><option value="">-</option>${opt(look.shippers, j.shipper_id, x => x.name)}</select></div>
    <div><label>Jenis Muatan</label><input name="cargo_type" value="${esc(j.cargo_type)}"></div>
    <div><label>No. Invoice</label><input name="invoice_no" value="${esc(j.invoice_no)}"></div>
    <div><label>Party</label><input name="party" placeholder="mis. 230 CL / 12x40ft" value="${esc(j.party)}"></div>
    <div><label>No. MBL / HBL</label><input name="bl_no" value="${esc(j.bl_no)}"></div>
    <div><label>Weight (ton)</label><input name="weight" type="number" step="0.01" min="0" value="${j.weight ?? ''}"></div>
    <div><label>No. SI / PO</label><input name="si_po_no" value="${esc(j.si_po_no)}"></div>
    <div><label>Vessel</label><input name="vessel" value="${esc(j.vessel)}"></div>
    <div><label>No. Aju PIB/PEB</label><input name="aju_no" value="${esc(j.aju_no)}"></div>
    <div><label>ETA/ETD</label><input name="eta" type="date" value="${j.eta || ''}"></div>
    <div><label>Rencana Delivery</label><input name="delivery_plan" type="date" value="${j.delivery_plan || ''}"></div>
    <div class="full"><label>Remarks</label><textarea name="remarks" rows="3">${esc(j.remarks)}</textarea></div>
    <div class="full"><label>Checklist Kelengkapan (INV = invoice diterima, FP = faktur pajak)</label><div class="chk">${CHECK.map(([k, n]) => `<div><b>${n}</b><label><input type="checkbox" name="c_${k}_inv" ${c[k]?.inv ? 'checked' : ''}>INV</label><label><input type="checkbox" name="c_${k}_fp" ${c[k]?.fp ? 'checked' : ''}>FP</label></div>`).join('')}</div></div></div>
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn">Simpan</button></div></form><div id="qa"></div></div>`;
  $('#jf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), b = Object.fromEntries(fd);
    if (id) b.customer_id = j.customer_id;
    if (b.eta && b.delivery_plan && b.delivery_plan < b.eta && !confirm('Rencana delivery lebih awal dari ETA. Lanjut simpan?')) return;
    b.checklist = {}; CHECK.forEach(([k]) => b.checklist[k] = { inv: fd.has(`c_${k}_inv`) ? 1 : 0, fp: fd.has(`c_${k}_fp`) ? 1 : 0 });
    try {
      const r = id ? await api('/job-orders/' + id, 'PUT', b) : await api('/job-orders', 'POST', b);
      closeMd(); joList(); detail(id || r.id);
    } catch (x) { $('#fe').textContent = x.message; }
  };
});

function quickAdd(kind) {
  const cust = kind === 'customer';
  $('#qa').innerHTML = `<div class="modal" style="z-index:9"><form class="card" id="qf" style="max-width:420px"><h3 style="margin-top:0">${cust ? 'Customer' : 'Shipper'} Baru</h3>
    ${cust ? '<div><label>Kode (2-6 huruf, dipakai di nomor JO)</label><input name="code" maxlength="6" style="text-transform:uppercase" required></div>' : ''}
    <div style="margin-top:10px"><label>Nama</label><input name="name" required></div><div class="err" id="qe"></div>
    <div class="acts"><button type="button" class="btn sec" onclick="$('#qa').innerHTML=''">Batal</button><button class="btn">Simpan</button></div></form></div>`;
  $('#qf').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api(cust ? '/customers' : '/shippers', 'POST', Object.fromEntries(new FormData(e.target)));
      look = await api('/lookups');
      const sel = $(cust ? '#sc' : '#ss'), list = look[cust ? 'customers' : 'shippers'];
      sel.innerHTML = (cust ? '<option value="">Pilih…</option>' : '<option value="">-</option>') + list.map(x => `<option value="${x.id}">${esc(cust ? `${x.name} (${x.code})` : x.name)}</option>`).join('');
      sel.value = r.id; $('#qa').innerHTML = '';
    } catch (x) { $('#qe').textContent = x.message; }
  };
}

const detail = run(async id => {
  const j = await api('/job-orders/' + id), c = j.checklist || {}, done = j.status === 'COMPLETE';
  const kv = (k, v) => `<div><span>${k}:</span> <b>${esc(v || '-')}</b></div>`;
  $('#md').innerHTML = `<div class="modal"><div class="card"><div class="paper"><h3>${esc(j.jo_no)} — JOB ORDER <small style="float:right">${esc(j.type)} · ${done ? 'COMPLETE' : 'NOT COMP'}</small></h3>
    <div class="kv">${kv('Customer', j.customer_name)}${kv('Jenis Muatan', j.cargo_type)}${kv('Shipper/Ship To', j.shipper_name)}${kv('Party', j.party)}
    ${kv('No. Invoice', j.invoice_no)}${kv('Weight', fmtN(j.weight))}${kv('No. MBL / HBL', j.bl_no)}${kv('Vessel', j.vessel)}${kv('No. SI / PO', j.si_po_no)}${kv('ETA/ETD', fmtD(j.eta))}${kv('No. Aju PIB/PEB', j.aju_no)}${kv('Rencana Delivery', fmtD(j.delivery_plan))}</div>
    <p><b>Remarks</b><br>${esc(j.remarks || '-').replace(/\n/g, '<br>')}</p><b>Checklist Kelengkapan</b>
    <div class="chk">${CHECK.map(([k, n]) => `<div><b>${n}</b><span>${c[k]?.inv ? '☑' : '☐'} INV</span><span>${c[k]?.fp ? '☑' : '☐'} FP</span></div>`).join('')}</div>
    <div class="scr">Catatan operasional (tulis tangan)</div></div>
    <div class="noprint" style="margin-top:14px"><b>Dokumen</b>
      <div class="bar" style="margin:8px 0"><select id="dc" style="max-width:170px">${DOC_CATS.map(x => `<option>${x}</option>`).join('')}</select><input type="file" id="fu" multiple style="max-width:300px"></div>
      <ul id="dl">${j.documents.map(d => `<li>[${esc(d.category)}] <a href="/uploads/${d.path}?t=${token}" target="_blank">${esc(d.filename)}</a> <button class="btn bad sm" onclick="delDoc(${d.id},${id})">hapus</button></li>`).join('') || '<li style="color:var(--mut)">Belum ada dokumen</li>'}</ul>
      <details><summary><b>Riwayat</b> (${j.logs.length})</summary><ul>${j.logs.map(l => `<li><span style="color:var(--mut)">${fmtDT(l.created_at)}</span> ${esc(l.user_name)} — ${esc(l.action)}${l.note ? ': ' + esc(l.note) : ''}</li>`).join('')}</ul></details></div>
    <div class="acts"><button class="btn sec" onclick="closeMd()">Tutup</button><button class="btn sec" onclick="dupJo(${id})">Duplikat</button>
      ${done ? `<button class="btn sec" onclick="setSt(${id},'NOT_COMP')">Buka Kembali</button>` : `<button class="btn sec" onclick="joForm(${id})">Edit</button><button class="btn bad" onclick="delJo(${id})">Hapus</button><button class="btn" onclick="setSt(${id},'COMPLETE')">Tandai Complete</button>`}
      <button class="btn" onclick="window.print()">Print</button></div></div></div>`;
  $('#fu').onchange = run(async e => {
    for (const f of e.target.files) {
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); });
      await api(`/job-orders/${id}/documents`, 'POST', { filename: f.name, data, category: $('#dc').value });
    }
    detail(id);
  });
});
const setSt = run(async (id, status) => { await api(`/job-orders/${id}/status`, 'PATCH', { status }); joList(); detail(id); });
const delJo = run(async id => { if (confirm('Hapus Job Order ini beserta dokumennya?')) { await api('/job-orders/' + id, 'DELETE'); closeMd(); joList(); } });
const delDoc = run(async (d, id) => { if (confirm('Hapus dokumen?')) { await api('/documents/' + d, 'DELETE'); detail(id); } });
const dupJo = run(async id => { if (confirm('Buat JO baru dari data JO ini?')) { const r = await api(`/job-orders/${id}/duplicate`, 'POST'); joList(); detail(r.id); } });

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
