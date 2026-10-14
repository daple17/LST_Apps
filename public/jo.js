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
    <button class="btn sec out" onclick="joExport()">Download Excel</button><button class="btn" onclick="joNew()">+ Job Order</button></div>
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

/* ---- Job Order baru: pilih tipe, lalu form dengan isian wajib sesuai tipe ---- */
const TYPE_DESC = { IMPORT: 'Barang masuk (kepabeanan PIB). Isian wajib ketat.', EXPORT: 'Barang keluar (PEB). SI/PO wajib.', TRUCKING: 'Pengiriman darat. Isian longgar.', PROJECT: 'Pekerjaan proyek. Isian longgar.' };
const joNew = () => {
  $('#md').innerHTML = `<div class="modal"><div class="card" style="max-width:620px"><h3 style="margin-top:0">Job Order Baru</h3><p style="margin:0 0 12px;color:var(--mut)">Pilih tipe Job Order.</p>
    <div class="tcards">${R().JO_TYPES.map(t => `<button class="tcard" onclick="joForm(null,'${t.code}')"><span><span class="dot t-${t.code}"></span><b>JO ${t.label}</b></span><small>${TYPE_DESC[t.code] || ''}</small></button>`).join('')}</div>
    <div class="acts"><button class="btn sec" onclick="closeMd()">Batal</button></div></div></div>`;
};

const REF_ORDER = ['AJU', 'INVOICE', 'BL', 'SI_DO', 'SI_PO'];
const REF_WITH_FILE = ['INVOICE', 'BL', 'SI_DO', 'SI_PO'];
let jf = null; // state form: {id, type, rows:{kind:[{id,number,ref_date,file,newFile,delFile,warn}]}, custId, locked, initial}
const jfReq = f => R().FIELD_RULES[f]?.[jf.type] === 'R';
const jfStar = f => (jfReq(f) ? ' <b style="color:var(--bad)">*</b>' : '');
const refLabel = k => R().REF_KINDS.find(x => x.code === k)?.label || k;
const custLabel = c => `${c.name} (${c.code})`;
const emptyRow = () => ({ number: '', ref_date: '', file: null, newFile: null, delFile: false, warn: '' });

const joForm = run(async (id, newType) => {
  const j = id ? await api('/job-orders/' + id) : { type: newType || 'IMPORT', references: [], refs: {} };
  jf = { id, type: j.type, custId: j.customer_id || '', locked: { type: (j.material_count || 0) > 0 }, no_jo: j.no_jo || null, vals: {}, rows: {} };
  for (const k of REF_ORDER) jf.rows[k] = (j.references || []).filter(r => r.kind === k).map(r => ({ id: r.id, number: r.number, ref_date: r.ref_date || '', file: r.file_id ? { id: r.file_id } : null, newFile: null, delFile: false, warn: '' }));
  Object.assign(jf.vals, { nickname: j.nickname, jenis_muatan: j.jenis_muatan, shipper_id: j.shipper_id, type_bc: j.type_bc, vessel: j.vessel, eta_etd: j.eta_etd, delivery_plan: j.delivery_plan,
    container_count: j.container_count, container_type: j.container_type, weight: j.weight, qty: j.qty, unit: j.unit, cbm: j.cbm, remarks: j.remarks, party: j.qty == null && j.party ? j.party : '' });
  if (id && j.references?.length) { // nama file untuk chip
    const docs = Object.fromEntries((j.documents || []).map(d => [d.file_id, d.filename]));
    for (const k of REF_ORDER) jf.rows[k].forEach(r => { if (r.file) r.file.filename = docs[r.file.id] || 'berkas'; });
  }
  joFormDraw();
  jf.initial = JSON.stringify(joFormState());
});

function joFormCapture() { // simpan isi form saat ini ke jf.vals sebelum digambar ulang
  const f = $('#jf'); if (!f) return;
  for (const k of Object.keys(jf.vals)) if (f.elements[k]) jf.vals[k] = f.elements[k].value;
  jf.type = f.elements.type.value;
  const ct = f.elements.customer_text; if (ct) jf.custText = ct.value;
}
function joFormDraw() {
  const v = jf.vals, id = jf.id, tl = typeLabel(jf.type);
  const opt = (arr, cur, val = x => x.code, lab = x => x.label) => arr.map(x => `<option value="${esc(val(x))}" ${String(val(x)) === String(cur ?? '') ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
  const cust = look.customers.find(c => c.id == jf.custId);
  const visibleKinds = REF_ORDER.filter(k => R().FIELD_RULES[k]?.[jf.type] !== 'X' || jf.rows[k].length);
  for (const k of visibleKinds) if (!jf.rows[k].length) jf.rows[k].push(emptyRow()); // selalu ada satu baris kosong untuk diisi
  $('#md').innerHTML = `<div class="modal"><form class="card" id="jf" novalidate style="width:min(980px,100%)"><h3 style="margin-top:0">${id ? 'Edit ' + esc(jf.no_jo) : 'Job Order Baru'} <span class="tag" style="font-style:normal;font-family:var(--f-ui)"><span class="dot t-${jf.type}" style="margin:0"></span>${esc(tl)}</span></h3>
    <div class="fsec">Umum</div><div class="g3">
      <div><label>Nomor JO</label><input value="${id ? esc(jf.no_jo) : 'Otomatis saat disimpan'}" disabled></div>
      <div><label>Tipe ${jf.locked.type ? '(terkunci: JO sudah punya material)' : ''}</label><select name="type" onchange="joTypeChange()" ${jf.locked.type ? 'disabled' : ''}>${opt(R().JO_TYPES, jf.type)}</select></div>
      <div><label>Nickname</label><input name="nickname" value="${esc(v.nickname)}" placeholder="opsional"></div>
      <div><label>Jenis muatan${jfStar('jenis_muatan')}</label><select name="jenis_muatan" onchange="joLcl()"><option value="">Pilih…</option>${opt(R().JENIS_MUATAN, v.jenis_muatan)}</select></div>
      <div><label>Nama customer${jfStar('customer')} ${id ? '(tidak bisa diubah)' : `<a href="#" onclick="quickAdd('customer');return false">+ baru</a>`}</label>
        <input name="customer_text" list="dl-cust" autocomplete="off" placeholder="Cari nama atau kode customer…" value="${esc(jf.custText ?? (cust ? custLabel(cust) : ''))}" oninput="joCust(this)" ${id ? 'disabled' : ''}>
        <datalist id="dl-cust">${look.customers.map(c => `<option value="${esc(custLabel(c))}"></option>`).join('')}</datalist></div>
      <div><label>Shipper / Ship To <a href="#" onclick="quickAdd('shipper');return false">+ baru</a></label><select name="shipper_id" id="ss"><option value="">-</option>${opt(look.shippers, v.shipper_id, x => x.id, x => x.name)}</select></div>
      <div><label>Type BC${jfStar('type_bc')}</label><select name="type_bc"><option value="">-</option>${opt(R().TYPE_BC, v.type_bc, x => x, x => x)}</select></div>
    </div>
    <div class="fsec">Kapal &amp; jadwal</div><div class="g3">
      <div><label>Vessel${jfStar('vessel')}</label><input name="vessel" value="${esc(v.vessel)}"></div>
      <div><label>ETA/ETD${jfStar('eta_etd')}</label><input name="eta_etd" type="date" value="${esc(v.eta_etd || '')}"></div>
      <div><label>Delivery plan${jfStar('delivery_plan')}</label><input name="delivery_plan" type="date" value="${esc(v.delivery_plan || '')}"></div>
    </div>
    <div class="fsec">Referensi &amp; dokumen <small style="font-weight:400;color:var(--mut)">(PDF/JPG/PNG maks ${R().LIMITS.FILE_MAX_MB} MB; file otomatis masuk tab Dokumen)</small></div>
    ${visibleKinds.map(k => `<div class="rg" id="rg-${k}"></div>`).join('')}
    <div class="fsec">Muatan</div><div class="g3">
      <div><label>Jumlah kontainer${jfStar('containers')}</label><input name="container_count" type="number" min="0" step="1" value="${esc(v.container_count ?? '')}"></div>
      <div><label>Jenis kontainer${jfStar('containers')}</label><select name="container_type"><option value="">-</option>${opt(R().UNITS.filter(u => u.container), v.container_type, x => x.code, x => x.name)}</select></div>
      <div><label>Weight (ton)${jfStar('weight')}</label><input name="weight" type="number" step="0.01" min="0" value="${esc(v.weight ?? '')}"></div>
      <div><label>Quantity${jfStar('qty')}</label><input name="qty" type="number" min="0" step="1" value="${esc(v.qty ?? '')}"></div>
      <div><label>Satuan${jfStar('qty')}</label><select name="unit"><option value="">-</option>${opt(R().UNITS, v.unit, x => x.code, x => x.name)}</select></div>
      <div id="cbmw" ${v.jenis_muatan === 'LCL_BB' ? '' : 'hidden'}><label>CBM</label><input name="cbm" type="number" min="0" step="0.01" value="${esc(v.cbm ?? '')}"></div>
    </div>
    ${v.party ? `<input type="hidden" name="party" value="${esc(v.party)}">` : ''}
    <div style="margin-top:12px"><label>Remarks</label><textarea name="remarks" rows="3">${esc(v.remarks)}</textarea></div>
    <div class="err" id="fe" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="joCancel()">Cancel</button><button class="btn">${id ? 'Simpan' : 'Create'}</button></div></form><div id="qa"></div></div>`;
  for (const k of visibleKinds) joRefDraw(k);
  const f = $('#jf'); f.onsubmit = joSubmit;
  f.querySelectorAll('[name]').forEach(el => el.addEventListener('input', () => el.removeAttribute('aria-invalid')));
}
function joRefDraw(k) {
  const rows = jf.rows[k], withFile = REF_WITH_FILE.includes(k), host = $('#rg-' + k);
  if (!host) return;
  host.innerHTML = `<div class="rgh"><b>${refLabel(k)}${jfStar(k)}</b><button type="button" class="btn sec sm" onclick="joRefAdd('${k}')">+ Tambah</button></div>` +
    rows.map((r, i) => `<div class="rrow ${withFile ? '' : 'nofile'}"><div><input data-k="${k}" data-i="${i}" data-f="number" placeholder="Nomor ${esc(refLabel(k).toLowerCase())}" value="${esc(r.number)}" aria-label="${esc(refLabel(k))} ${i + 1}" onchange="joRefChange(this)" oninput="joRefChange(this)"></div>
      ${withFile ? `<div><input type="date" data-k="${k}" data-i="${i}" data-f="ref_date" value="${esc(r.ref_date || '')}" aria-label="Tanggal" onchange="joRefChange(this)"></div>
      <div class="rfile">${r.newFile || (r.file && !r.delFile) ? `<span class="fchip" title="${esc(r.newFile?.name || r.file?.filename || '')}">${esc(r.newFile?.name || r.file?.filename || 'berkas')}</span><button type="button" class="ib" aria-label="Hapus file" onclick="joRefFile('${k}',${i},null)">×</button>`
        : `<label class="btn sec sm" style="margin:0">Pilih file<input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onchange="joRefFile('${k}',${i},this.files[0])"></label>`}</div>` : ''}
      <button type="button" class="ib" aria-label="Hapus baris" onclick="joRefDel('${k}',${i})">×</button>
      <div class="warn-note" id="w-${k}-${i}">${esc(r.warn)}</div></div>`).join('') || '<div class="warn-note" style="color:var(--mut)">Belum ada nomor.</div>';
}
function joRefChange(el) { // simpan ke state tanpa gambar ulang; nomor dicek duplikat setelah selesai mengetik
  const k = el.dataset.k, i = +el.dataset.i, row = jf.rows[k][i];
  row[el.dataset.f] = el.value;
  if (el.dataset.f === 'number') { clearTimeout(row._t); row._t = setTimeout(() => joRefCheck(k, i), 500); }
}
const joRefCheck = async (k, i) => {
  const row = jf.rows[k]?.[i]; if (!row) return;
  const n = row.number.trim(); row.warn = '';
  if (n) { try { const d = await api(`/job-orders/check-refs?kind=${k}&number=${encodeURIComponent(n)}&exclude=${jf.id || 0}`); if (d.length) row.warn = `⚠ Nomor ini sudah dipakai JO ${d.map(x => x.no_jo).join(', ')}`; } catch { /* peringatan saja */ } }
  const w = $(`#w-${k}-${i}`); if (w) w.textContent = row.warn;
};
const joRefAdd = k => { jf.rows[k].push(emptyRow()); joRefDraw(k); };
const joRefDel = (k, i) => { jf.rows[k].splice(i, 1); joRefDraw(k); };
function joRefFile(k, i, file) {
  const row = jf.rows[k][i];
  if (!file) { row.newFile = null; if (row.file) row.delFile = true; return joRefDraw(k); }
  const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!ok) return alert('File harus PDF, JPG atau PNG');
  if (file.size > R().LIMITS.FILE_MAX_MB * 1048576) return alert(`Ukuran file maks ${R().LIMITS.FILE_MAX_MB} MB`);
  row.newFile = file; row.delFile = false; joRefDraw(k);
}
function joTypeChange() { joFormCapture(); joFormDraw(); }
function joLcl() { const f = $('#jf'); $('#cbmw').hidden = f.elements.jenis_muatan.value !== 'LCL_BB'; }
function joCust(inp) { const c = look.customers.find(x => custLabel(x) === inp.value.trim()); jf.custId = c ? c.id : ''; jf.custText = inp.value; }

function joFormState() {
  const f = $('#jf'), s = { id: jf.id, custId: jf.custId };
  for (const el of f.elements) if (el.name) s[el.name] = el.value;
  s.rows = REF_ORDER.map(k => (jf.rows[k] || []).map(r => [r.number, r.ref_date, r.newFile?.name || null, r.delFile]));
  return s;
}
const joCancel = () => { if (jf.initial === JSON.stringify(joFormState()) || confirm('Ada isian yang belum disimpan. Tutup tanpa menyimpan?')) closeMd(); };

function joBody() {
  const f = $('#jf'), el = n => f.elements[n]?.value, b = { type: el('type') };
  for (const n of ['nickname', 'jenis_muatan', 'shipper_id', 'type_bc', 'vessel', 'eta_etd', 'delivery_plan', 'container_count', 'container_type', 'weight', 'qty', 'unit', 'cbm', 'remarks', 'party']) if (f.elements[n]) b[n] = el(n);
  b.customer_id = jf.id ? undefined : jf.custId;
  b.references = []; const rowsFlat = [];
  for (const k of REF_ORDER) for (const r of jf.rows[k] || []) if (r.number.trim()) { b.references.push({ id: r.id, kind: k, number: r.number.trim(), ref_date: r.ref_date || null }); rowsFlat.push(r); }
  return { b, rowsFlat };
}
function joClientErrors(b) { // cermin lib/jo-validate.js agar pesan muncul tanpa bolak-balik ke server
  const has = v => v !== undefined && v !== null && String(v).trim() !== '', errs = [], t = jf.type, req = f => R().FIELD_RULES[f]?.[t] === 'R';
  const need = (f, ok, label, sel) => { if (req(f) && !ok) errs.push({ label: `${label} wajib diisi`, sel }); };
  need('customer', has(b.customer_id) || jf.id, 'Customer', '[name=customer_text]'); need('jenis_muatan', has(b.jenis_muatan), 'Jenis muatan', '[name=jenis_muatan]'); need('type_bc', has(b.type_bc), 'Type BC', '[name=type_bc]');
  need('vessel', has(b.vessel), 'Vessel', '[name=vessel]'); need('eta_etd', has(b.eta_etd), 'ETA/ETD', '[name=eta_etd]'); need('delivery_plan', has(b.delivery_plan), 'Delivery plan', '[name=delivery_plan]');
  need('containers', Number(b.container_count) > 0 && has(b.container_type), 'Jumlah dan jenis kontainer', '[name=container_count]'); need('weight', has(b.weight), 'Weight', '[name=weight]');
  need('qty', (has(b.qty) && has(b.unit)) || has(b.party), 'Quantity dan satuan', '[name=qty]');
  for (const k of REF_ORDER) need(k, b.references.some(r => r.kind === k), refLabel(k), `#rg-${k} input`);
  if (!jf.id && has($('#jf').elements.customer_text.value) && !has(b.customer_id)) errs.push({ label: 'Pilih customer dari daftar', sel: '[name=customer_text]' });
  return errs;
}
async function joSubmit(e) {
  e.preventDefault();
  const f = $('#jf'), { b, rowsFlat } = joBody(), err = $('#fe'); err.textContent = '';
  f.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
  const errs = joClientErrors(b);
  if (errs.length) { err.textContent = errs.map(x => x.label).join('; '); errs.forEach(x => f.querySelector(x.sel)?.setAttribute('aria-invalid', 'true')); f.querySelector(errs[0].sel)?.focus(); return; }
  if (b.eta_etd && b.delivery_plan && b.delivery_plan < b.eta_etd && !confirm('Rencana delivery lebih awal dari ETA. Lanjut simpan?')) return;
  const btn = f.querySelector('button:not([type])'); btn.disabled = true;
  try {
    const r = jf.id ? await api('/job-orders/' + jf.id, 'PUT', b) : await api('/job-orders', 'POST', b), joId = jf.id || r.id, failed = [];
    for (const [i, row] of rowsFlat.entries()) { // unggah/hapus file sesudah baris referensi punya id
      const refId = r.reference_ids?.[i]; if (!refId) continue;
      try {
        if (row.delFile && row.file && !row.newFile) await api(`/job-orders/${joId}/references/${refId}/file`, 'DELETE');
        if (row.newFile) {
          const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.onerror = no; fr.readAsDataURL(row.newFile); });
          await api(`/job-orders/${joId}/references/${refId}/file`, 'POST', { filename: row.newFile.name, data });
        }
      } catch (x) { failed.push(`${row.newFile?.name || 'file'}: ${x.message}`); }
    }
    closeMd(); joList(); detail(joId);
    if (failed.length) alert('JO tersimpan, tetapi ada file yang gagal diunggah:\n' + failed.join('\n'));
  } catch (x) { err.textContent = x.message; (x.fields || []).forEach(n => f.querySelector(`[name=${n}]`)?.setAttribute('aria-invalid', 'true')); btn.disabled = false; }
}

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
      const keep = $('#jf') ? { custText: jf.custText } : {};
      look = { ...(await api('/lookups')) }; void keep;
      if (cust) { const c = look.customers.find(x => x.id === r.id); jf.custId = c.id; jf.custText = custLabel(c); $('#dl-cust').innerHTML = look.customers.map(x => `<option value="${esc(custLabel(x))}"></option>`).join(''); $('#jf').elements.customer_text.value = jf.custText; }
      else { $('#ss').innerHTML = '<option value="">-</option>' + look.shippers.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); $('#ss').value = r.id; jf.vals.shipper_id = r.id; }
      $('#qa').innerHTML = '';
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

