/* Job Order & Doc: daftar, form, detail */
const joBlank = () => ({ q: '', status: '', type: '', customer_id: '', ...monthRange(), sort: 'created', dir: 'desc', page: 1 });
let joSt = joBlank();
const joQs = (extra = {}) => new URLSearchParams({ ...joSt, ...extra });

function joRoute(rest) {
  $('#ttl').textContent = 'Job Order & Doc';
  $('#view').innerHTML = '<div id="sum"></div><div id="pg"></div>';
  joList();
  if (rest[0]) detail(+rest[0], rest[1]);
}

async function joList() {
  const [d, s] = await Promise.all([api('/job-orders?' + joQs()), api('/job-orders/summary')]);
  $('#sum').innerHTML = `<div class="cards">${[['Total JO', s.total, '', 's-total'], ['Not Complete', s.open_jo, 'NOT_COMP', 's-open'], ['Complete', s.done, 'COMPLETE', 's-done'], ['ETA 7 hari ke depan', s.eta_week, '', 's-eta'], ['Lewat rencana delivery', s.late, 'late', 's-late']]
    .map(([l, v, f, c]) => `<div class="card stat ${c} ${f === 'late' && v ? 'warn' : ''}" ${c === 's-total' ? clickAttr('joReset()') : f && f !== 'late' ? clickAttr(`joSetF('status','${f}')`) : ''}><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
  const th = (k, n) => `<th style="cursor:pointer" onclick="joSort('${k}')">${n}${joSt.sort === k ? (joSt.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const late = r => r.status === 'NOT_COMP' && r.delivery_plan && r.delivery_plan < today();
  const tabs = [{ code: '', label: 'All', n: d.counts.ALL }, ...R().JO_TYPES.map(t => ({ code: t.code, label: t.label, n: d.counts[t.code] }))];
  $('#pg').innerHTML = `<div class="tabs">${tabs.map(t => `<button class="btn ${joSt.type === t.code ? '' : 'sec'} sm" onclick="joSetF('type','${t.code}')">${t.label} (${t.n})</button>`).join('')}</div>
    <div class="bar fbar"><input id="q" placeholder="Cari JO, customer, vessel, BL, No. Aju, Invoice" value="${esc(joSt.q)}">
    <select id="fs"><option value="">Semua status</option><option value="NOT_COMP">Not Complete</option><option value="COMPLETE">Complete</option></select>
    <select id="fc"><option value="">Semua customer</option>${look.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <label class="inl">ETA/ETD <input type="date" id="ff" value="${joSt.from}"> – <input type="date" id="fto" value="${joSt.to}"></label>
    <button class="btn sec" onclick="joReset()">Reset</button><span style="flex:1"></span>
    <button class="btn sec out" onclick="joExport()">Download Excel</button><button class="btn" onclick="joForm()">+ Job Order</button></div>
    <div class="card tw"><table><tr>${th('no_jo', 'No. JO')}<th>Type</th>${th('customer', 'Customer')}<th>Aju Ceisa</th><th>No. BL</th><th>No. Invoice</th><th>No. SI/PO</th><th>Vessel</th><th>Party</th><th>Weight</th>${th('eta', 'ETA/ETD')}${th('delivery_plan', 'Rencana Delivery')}<th>Status</th><th>Aksi</th></tr>
    ${d.rows.map(r => `<tr class="row" style="cursor:pointer" onclick="detail(${r.id})"><td><b>${esc(r.no_jo)}</b></td><td><span><span class="dot t-${esc(r.type)}"></span>${esc(typeLabel(r.type))}</span></td><td class="wrap">${esc(r.customer_name)}</td>
      <td>${multi(r.refs.AJU)}</td><td>${multi(r.refs.BL)}</td><td>${multi(r.refs.INVOICE)}</td><td>${multi([...r.refs.SI_PO, ...r.refs.SI_DO])}</td>
      <td>${esc(r.vessel)}</td><td>${esc(r.party)}</td><td class="num">${fmtN(r.weight)}</td><td>${fmtD(r.eta_etd)}</td><td ${late(r) ? 'style="color:var(--bad);font-weight:600" title="Lewat rencana delivery"' : ''}>${fmtD(r.delivery_plan)}</td>
      <td><span class="tag ${r.status}">${r.status === 'COMPLETE' ? 'Complete' : 'Not Comp'}</span></td>
      <td onclick="event.stopPropagation()"><div class="menu"><button class="ib" aria-label="Aksi ${esc(r.no_jo)}" aria-haspopup="true" onclick="menuToggle(this)">⋯</button><div class="menu-list" role="menu">
        <button role="menuitem" onclick="detail(${r.id})">Detail</button><button role="menuitem" onclick="detail(${r.id},'dokumen')">Dokumen</button><button role="menuitem" onclick="detail(${r.id},'preview')">Preview</button>
        <button role="menuitem" ${r.status === 'COMPLETE' ? 'disabled title="JO Complete tidak bisa diedit"' : ''} onclick="joForm(${r.id})">Edit</button></div></div></td></tr>`).join('') || '<tr><td colspan="14" style="text-align:center;color:var(--mut)">Belum ada data</td></tr>'}</table>
    ${pagerNum(joSt.page, d.pages, d.total, 'joGoto')}</div>`;
  $('#fs').value = joSt.status; $('#fc').value = joSt.customer_id;
  let t; $('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { joSt.q = e.target.value; joSt.page = 1; joList().then(() => { const q = $('#q'); q.focus(); q.setSelectionRange(1e4, 1e4); }); }, 300); };
  [['fs', 'status'], ['fc', 'customer_id'], ['ff', 'from'], ['fto', 'to']].forEach(([i, k]) => $('#' + i).onchange = e => joSetF(k, e.target.value));
}
const joSetF = (k, v) => { joSt[k] = v; joSt.page = 1; joList(); };
const joReset = () => { joSt = joBlank(); joList(); };
const joSort = k => { joSt.dir = joSt.sort === k && joSt.dir === 'asc' ? 'desc' : 'asc'; joSt.sort = k; joList(); };
const joGoto = n => { joSt.page = n; joList(); };
const joExport = run(async () => {
  const r = await raw('/job-orders/export?' + joQs());
  if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `job-order-${today()}.xlsx` });
  a.click(); URL.revokeObjectURL(a.href);
});

const joForm = run(async id => {
  const j = id ? await api('/job-orders/' + id) : { type: 'IMPORT', refs: {}, references: [], checklist: [] }, c = Object.fromEntries((j.checklist || []).map(x => [x.item, x]));
  const opt = (arr, v, f) => arr.map(x => `<option value="${x.id}" ${x.id == v ? 'selected' : ''}>${esc(f(x))}</option>`).join('');
  $('#md').innerHTML = `<div class="modal"><form class="card" id="jf"><h3 style="margin-top:0">${id ? 'Edit ' + esc(j.no_jo) : 'Job Order Baru'}</h3><div class="g">
    <div><label>Type *</label><select name="type">${R().JO_TYPES.map(t => `<option value="${t.code}" ${t.code === j.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
    <div><label>Type BC</label><select name="type_bc"><option value="">-</option>${R().TYPE_BC.map(t => `<option ${t === j.type_bc ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label>Customer * ${id ? '(tidak bisa diubah)' : '<a href="#" onclick="quickAdd(\'customer\');return false">+ baru</a>'}</label><select name="customer_id" id="sc" required ${id ? 'disabled' : ''}><option value="">Pilih…</option>${opt(look.customers, j.customer_id, x => `${x.name} (${x.code})`)}</select></div>
    <div><label>Shipper / Ship To <a href="#" onclick="quickAdd('shipper');return false">+ baru</a></label><select name="shipper_id" id="ss"><option value="">-</option>${opt(look.shippers, j.shipper_id, x => x.name)}</select></div>
    <div><label>Jenis Muatan</label><select name="jenis_muatan"><option value="">-</option>${R().JENIS_MUATAN.map(t => `<option value="${t.code}" ${t.code === j.jenis_muatan ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
    <div><label>Deskripsi muatan</label><input name="cargo_desc" value="${esc(j.cargo_desc)}"></div>
    ${REF_FIELDS.map(([k, n]) => `<div><label>${n} (pisahkan dengan koma)</label><input name="ref_${k}" value="${esc((j.refs?.[k] || []).join(', '))}"></div>`).join('')}
    <div><label>Party</label><input name="party" placeholder="mis. 230 CL / 12x40ft" value="${esc(j.party)}"></div>
    <div><label>Weight (ton)</label><input name="weight" type="number" step="0.01" min="0" value="${j.weight ?? ''}"></div>
    <div><label>Vessel</label><input name="vessel" value="${esc(j.vessel)}"></div>
    <div><label>ETA/ETD</label><input name="eta_etd" type="date" value="${j.eta_etd || ''}"></div>
    <div><label>Rencana Delivery</label><input name="delivery_plan" type="date" value="${j.delivery_plan || ''}"></div>
    <div class="full"><label>Remarks</label><textarea name="remarks" rows="3">${esc(j.remarks)}</textarea></div>
    <div class="full"><label>Checklist Kelengkapan (INV = invoice diterima, FP = faktur pajak)</label><div class="chk">${R().CHECKLIST_ITEMS.map(it => `<div><b>${it.label}</b><label><input type="checkbox" name="c_${it.code}_inv" ${c[it.code]?.inv ? 'checked' : ''}>INV</label><label><input type="checkbox" name="c_${it.code}_fp" ${c[it.code]?.fp ? 'checked' : ''}>FP</label></div>`).join('')}</div></div></div>
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn">Simpan</button></div></form><div id="qa"></div></div>`;
  $('#jf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), b = Object.fromEntries(fd);
    if (id) b.customer_id = j.customer_id;
    if (b.eta_etd && b.delivery_plan && b.delivery_plan < b.eta_etd && !confirm('Rencana delivery lebih awal dari ETA. Lanjut simpan?')) return;
    b.references = REF_FIELDS.flatMap(([k]) => [...new Set(String(b['ref_' + k] || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean))]
      .map(number => { const old = (j.references || []).find(x => x.kind === k && x.number === number); return { id: old?.id, kind: k, number, ref_date: old?.ref_date || null }; }));
    b.checklist = {}; R().CHECKLIST_ITEMS.forEach(it => b.checklist[it.code] = { inv: fd.has(`c_${it.code}_inv`) ? 1 : 0, fp: fd.has(`c_${it.code}_fp`) ? 1 : 0 });
    try {
      const r = id ? await api('/job-orders/' + id, 'PUT', b) : await api('/job-orders', 'POST', b);
      closeMd(); joList(); detail(id || r.id);
    } catch (x) { $('#fe').textContent = x.message; }
  };
});

function quickAdd(kind) {
  const cust = kind === 'customer';
  $('#qa').innerHTML = `<div class="modal" style="z-index:9"><form class="card" id="qf" style="max-width:420px"><h3 style="margin-top:0">${cust ? 'Customer' : 'Shipper'} Baru</h3>
    ${cust ? '<div><label>Kode (3 huruf, dipakai di nomor JO)</label><input name="code" maxlength="3" pattern="[A-Za-z]{3}" style="text-transform:uppercase" required></div>' : ''}
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
  const j = await api('/job-orders/' + id), done = j.status === 'COMPLETE', ck = Object.fromEntries(j.checklist.map(x => [x.item, x]));
  const kv = (k, v) => `<div><span>${k}:</span> <b>${esc(v || '-')}</b></div>`, refs = k => (j.refs[k] || []).join(', ');
  $('#md').innerHTML = `<div class="modal"><div class="card"><div class="paper"><h3>${esc(j.no_jo)} — JOB ORDER <small style="float:right">${esc(typeLabel(j.type))}${j.type_bc ? ' · ' + esc(j.type_bc) : ''} · ${done ? 'COMPLETE' : 'NOT COMP'}</small></h3>
    <div class="kv">${kv('Customer', j.customer_name)}${kv('Jenis Muatan', [R().JENIS_MUATAN.find(x => x.code === j.jenis_muatan)?.label, j.cargo_desc].filter(Boolean).join(' · '))}${kv('Shipper/Ship To', j.shipper_name)}${kv('Party', j.party)}
    ${kv('No. Invoice', refs('INVOICE'))}${kv('Weight (ton)', fmtN(j.weight))}${kv('No. MBL / HBL', refs('BL'))}${kv('Vessel', j.vessel)}${kv('No. SI / DO', refs('SI_DO'))}${kv('No. SI / PO', refs('SI_PO'))}${kv('ETA/ETD', fmtD(j.eta_etd))}${kv('No. Aju PIB/PEB', refs('AJU'))}${kv('Rencana Delivery', fmtD(j.delivery_plan))}</div>
    <p><b>Remarks</b><br>${esc(j.remarks || '-').replace(/\n/g, '<br>')}</p><b>Checklist Kelengkapan</b>
    <div class="chk">${R().CHECKLIST_ITEMS.map(it => `<div><b>${it.label}</b><span>${ck[it.code]?.inv ? '☑' : '☐'} INV</span><span>${ck[it.code]?.fp ? '☑' : '☐'} FP</span></div>`).join('')}</div>
    <div class="scr">Catatan operasional (tulis tangan)</div></div>
    <div class="noprint" style="margin-top:14px"><b>Dokumen</b>
      <div class="bar" style="margin:8px 0"><select id="dc" style="max-width:170px">${R().DOC_TYPES.map(x => `<option value="${x.code}">${x.label}</option>`).join('')}</select><input type="file" id="fu" multiple accept=".pdf,.jpg,.jpeg,.png" style="max-width:300px"></div>
      <ul id="dl">${j.documents.map(d => `<li>[${esc(docLabel(d.doc_type))}] <a href="/uploads/${d.path}?t=${token}" target="_blank">${esc(d.filename)}</a> <button class="btn bad sm" onclick="delDoc(${d.id},${id})">hapus</button></li>`).join('') || '<li style="color:var(--mut)">Belum ada dokumen</li>'}</ul>
      <details><summary><b>Riwayat</b> (${j.logs.length})</summary><ul>${j.logs.map(l => `<li><span style="color:var(--mut)">${fmtDT(l.created_at)}</span> ${esc(l.user_name)} — ${esc(l.action)}${l.note ? ': ' + esc(l.note) : ''}</li>`).join('')}</ul></details></div>
    <div class="acts"><button class="btn sec" onclick="closeMd()">Tutup</button><button class="btn sec" onclick="dupJo(${id})">Duplikat</button>
      ${done ? `<button class="btn sec" onclick="setSt(${id},'NOT_COMP')">Buka Kembali</button>` : `<button class="btn sec" onclick="joForm(${id})">Edit</button><button class="btn bad" onclick="delJo(${id})">Hapus</button><button class="btn" onclick="setSt(${id},'COMPLETE')">Tandai Complete</button>`}
      <button class="btn" onclick="window.print()">Print</button></div></div></div>`;
  $('#fu').onchange = run(async e => {
    for (const f of e.target.files) {
      if (f.size > R().LIMITS.FILE_MAX_MB * 1048576) { alert(`${f.name}: maksimal ${R().LIMITS.FILE_MAX_MB} MB`); continue; }
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); });
      await api(`/job-orders/${id}/documents`, 'POST', { filename: f.name, data, doc_type: $('#dc').value });
    }
    detail(id);
  });
});
const setSt = run(async (id, status) => { await api(`/job-orders/${id}/status`, 'PATCH', { status }); joList(); detail(id); });
const delJo = run(async id => { if (confirm('Hapus Job Order ini beserta dokumennya?')) { await api('/job-orders/' + id, 'DELETE'); closeMd(); joList(); } });
const delDoc = run(async (d, id) => { if (confirm('Hapus dokumen?')) { await api('/documents/' + d, 'DELETE'); detail(id); } });
const dupJo = run(async id => { if (confirm('Buat JO baru dari data JO ini?')) { const r = await api(`/job-orders/${id}/duplicate`, 'POST'); joList(); detail(r.id); } });

