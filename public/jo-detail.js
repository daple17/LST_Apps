/* Job Order: halaman detail (kepala ringkasan + tab) dan tab List Detail Material */
let joCur = null, joMq = { q: '', page: 1 };
const JO_TABS = [['material', 'List Detail Material'], ['dokumen', 'Dokumen'], ['checklist', 'Checklist'], ['remarks', 'Remarks']];

const joOpen = (id, tab) => { const h = `#jo/${id}${tab && tab !== 'material' ? '/' + tab : ''}`; if (location.hash === h) route(); else location.hash = h; };
const detail = (id, tab) => joOpen(id, tab);

const joDetail = run(async (id, tab = 'material') => {
  if (!joCur || joCur.id !== id) joMq = { q: '', page: 1 };
  const j = joCur = await api('/job-orders/' + id), done = j.status === 'COMPLETE', refs = k => (j.refs[k] || []).join(', ') || '-';
  if (tab === 'preview') return joPreview(id);
  const miss = j.checklist.filter(c => !c.inv || !c.fp).length;
  $('#ttl').textContent = 'Job Order & Doc';
  $('#view').innerHTML = `<div class="tabs"><a class="btn sec sm" href="#jo">‹ Daftar JO</a><span style="flex:1"></span>
      ${done ? `<button class="btn sec sm" onclick="joSetStatus(${id},'NOT_COMP')">Buka Kembali</button>` : `<button class="btn sec sm" onclick="joForm(${id})">Edit</button><a class="btn sec sm" href="#jo/${id}/preview">Preview</a><button class="btn sec sm" onclick="joDup(${id})">Duplikat</button><button class="btn bad sm" onclick="joDelete(${id})">Hapus</button><button class="btn sm" onclick="joSetStatus(${id},'COMPLETE')">Tandai Complete</button>`}
      ${done ? `<a class="btn sec sm" href="#jo/${id}/preview">Preview</a>` : ''}</div>
    <div class="card hd"><div class="kv">
      <div><span>Job Order:</span> <b>${esc(j.no_jo)}</b> <span class="tag" style="margin-left:6px"><span class="dot t-${esc(j.type)}" style="margin:0"></span>${esc(typeLabel(j.type))}${j.type_bc ? ' · ' + esc(j.type_bc) : ''}</span></div>
      <div><span>Status JO:</span> <span class="tag ${j.status}">${done ? 'Complete' : 'Not Comp'}</span></div>
      <div><span>Customer:</span> <b>${esc(j.customer_name)}</b></div><div><span>Vessel:</span> <b>${esc(j.vessel || '-')}</b></div>
      <div><span>No. BL:</span> <b>${esc(refs('BL'))}</b></div><div><span>No. Aju:</span> <b>${esc(refs('AJU'))}</b></div>
      <div><span>Party:</span> <b>${esc(j.party || '-')}</b></div>
      <div><span>Weight:</span> <b>${j.weight == null ? '-' : fmtN(j.weight) + ' ton'}</b>${j.weight_mismatch ? ` <span class="more" style="cursor:help" title="Total net weight material ${fmtN(j.material_net_kg / 1000)} ton berbeda dari berat deklarasi">⚠ material ${fmtN(j.material_net_kg / 1000)} ton</span>` : ''}</div>
      ${j.nickname ? `<div><span>Nickname:</span> <b>${esc(j.nickname)}</b></div>` : ''}</div></div>
    <div class="tabs">${JO_TABS.map(([k, n]) => `<a class="btn ${tab === k ? '' : 'sec'} sm" href="#jo/${id}${k === 'material' ? '' : '/' + k}">${n}${k === 'checklist' && miss ? ` <span class="more" style="margin-left:6px">${miss}</span>` : ''}</a>`).join('')}</div>
    <div id="jt"></div>`;
  ({ material: joMatTab, dokumen: joDocTab, checklist: joCheckTab, remarks: joRemarkTab }[tab] || joMatTab)();
});

const joSetStatus = run(async (id, status) => {
  if (status === 'COMPLETE') {
    const miss = joCur.checklist.filter(c => !c.inv || !c.fp).length;
    if (miss && !confirm(`Checklist kelengkapan belum penuh (${miss} dari ${joCur.checklist.length} item). Tetap tandai Complete?`)) return;
  }
  await api(`/job-orders/${id}/status`, 'PATCH', { status }); joOpen(id, location.hash.split('/')[2]);
});
const joDelete = run(async id => { if (confirm('Hapus Job Order ini beserta dokumennya?')) { await api('/job-orders/' + id, 'DELETE'); joCur = null; location.hash = '#jo'; } });
const joDup = run(async id => { if (confirm('Buat JO baru dari data JO ini?')) { const r = await api(`/job-orders/${id}/duplicate`, 'POST'); joOpen(r.id); } });

/* ---------------- tab: List Detail Material ---------------- */
const joMatTab = run(async () => {
  const id = joCur.id, done = joCur.status === 'COMPLETE', d = await api(`/job-orders/${id}/materials?${new URLSearchParams(joMq)}`), t = d.totals;
  const dim = m => [m.thickness != null && fmtN(m.thickness), m.width != null && fmtN(m.width), m.shape].filter(Boolean).join(' · ') || '-';
  $('#jt').innerHTML = `<div class="bar fbar"><input id="mq" placeholder="Cari nomor produk, deskripsi, tujuan" value="${esc(joMq.q)}" style="max-width:320px">
      <span class="tag" style="color:var(--ink)">Net ${fmtN(t.net)} kg</span><span class="tag" style="color:var(--ink)">Gross ${fmtN(t.gross)} kg</span><span class="tag" style="color:var(--ink)">Qty ${fmtN(t.qty)}</span><span style="flex:1"></span>
      <button class="btn sec" onclick="joScan()">Scan Barcode</button><button class="btn sec out" onclick="joTemplate()">Download Template</button>
      <button class="btn sec" ${done ? 'disabled' : ''} onclick="joImport()">Upload List</button><button class="btn" ${done ? 'disabled' : ''} onclick="joMatForm()">+ Add data</button></div>
    <div class="card tw"><table><tr><th>No</th><th>Product/Container No</th><th>Description</th><th>Spec</th><th title="tebal · lebar · bentuk">Thickness</th><th class="num">Net Weight</th><th class="num">Gross Weight</th><th class="num">Qty</th><th>Satuan</th><th>Dari</th><th>Tujuan</th><th>Edit</th></tr>
    ${d.rows.map((m, i) => `<tr class="row"><td>${d.offset + i + 1}</td><td><b>${esc(m.product_no)}</b>${m.kondisi === 'PARTIAL' ? ' <span class="more" title="Partial">P</span>' : ''}</td><td>${esc(m.description)}</td><td>${esc(m.spec)}</td><td>${esc(dim(m))}</td><td class="num">${fmtN(m.net_weight)}</td><td class="num">${fmtN(m.gross_weight)}</td><td class="num">${m.qty}</td><td>${esc(m.unit)}</td><td>${esc(m.origin)}</td><td>${esc(m.destination)}</td>
      <td><button class="ib" aria-label="Edit ${esc(m.product_no)}" ${done ? 'disabled' : ''} onclick="joMatForm(${m.id})">✎</button></td></tr>`).join('') || `<tr><td colspan="12" style="text-align:center;color:var(--mut)">${joMq.q ? 'Tidak ada material yang cocok' : 'Belum ada material. Gunakan Add data atau Upload List.'}</td></tr>`}</table>
    ${pagerNum(joMq.page, d.pages, d.total, 'joMatGoto')}</div>`;
  let tm; $('#mq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { joMq.q = e.target.value; joMq.page = 1; joMatTab().then(() => { const q = $('#mq'); q.focus(); q.setSelectionRange(1e4, 1e4); }); }, 300); };
});
const joMatGoto = n => { joMq.page = n; joMatTab(); };
const joTemplate = run(async () => {
  const r = await raw(`/job-orders/${joCur.id}/materials/template`);
  if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'template-material.xlsx' }); a.click(); URL.revokeObjectURL(a.href);
});

const MAT_FIELDS = [['product_no', 'Product/Container No', 'text', true], ['kondisi', 'Intact / Partial', 'select'], ['spec', 'Spec', 'text'], ['description', 'Description', 'text', true], ['thickness', 'Thickness (tebal)', 'number'],
  ['width', 'Width (lebar)', 'number'], ['shape', 'Shape (bentuk, mis. C)', 'text'], ['net_weight', 'Net Weight (kg)', 'number', true], ['gross_weight', 'Gross Weight (kg)', 'number', true], ['qty', 'Quantity', 'number', true],
  ['unit', 'Unit', 'text', true], ['origin', 'From (pick up material)', 'text', true], ['destination', 'Destination (unloading site)', 'text', true]];
const joMatForm = run(async (mid, preset = {}) => {
  let m = { kondisi: 'INTACT', qty: 1, unit: R().UNITS[0].code, origin: 'PRIOK', ...preset };
  if (mid) m = await api(`/job-orders/${joCur.id}/materials/${mid}`);
  $('#md').innerHTML = `<div class="modal"><form class="card" id="mf" novalidate><h3 style="margin-top:0">${mid ? 'Edit material' : 'Add data'} <small style="font-family:var(--f-ui);font-style:normal;color:var(--mut)">${esc(joCur.no_jo)}</small></h3><div class="g">
    ${MAT_FIELDS.map(([k, n, ty, rq]) => `<div><label>${n}${rq ? ' <b style="color:var(--bad)">*</b>' : ''}</label>${ty === 'select' ? `<select name="${k}"><option value="INTACT" ${m[k] === 'INTACT' ? 'selected' : ''}>Intact</option><option value="PARTIAL" ${m[k] === 'PARTIAL' ? 'selected' : ''}>Partial</option></select>`
      : `<input name="${k}" type="${ty}" ${ty === 'number' ? (k === 'qty' ? 'min="1" step="1"' : 'min="0" step="0.01"') : ''} ${k === 'unit' ? 'list="dl-unit"' : ''} value="${esc(m[k] ?? '')}">`}</div>`).join('')}</div>
    <datalist id="dl-unit">${R().UNITS.map(u => `<option value="${u.code}">`).join('')}</datalist>
    <div class="err" id="fe" role="alert"></div><div class="acts">${mid ? `<button type="button" class="btn bad" onclick="joMatDelete(${mid})">Hapus</button>` : ''}<span style="flex:1"></span><button type="button" class="btn sec" onclick="closeMd()">Cancel</button><button class="btn">Save</button></div></form></div>`;
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      const r = mid ? await api(`/job-orders/${joCur.id}/materials/${mid}`, 'PUT', b) : await api(`/job-orders/${joCur.id}/materials`, 'POST', b);
      closeMd(); joMatTab(); toast(r.warnings?.length ? r.warnings.join('; ') : 'Material tersimpan', !!r.warnings?.length);
    } catch (x) { $('#fe').textContent = x.message; }
  };
});
const joMatDelete = run(async mid => { if (confirm('Hapus material ini?')) { await api(`/job-orders/${joCur.id}/materials/${mid}`, 'DELETE'); closeMd(); joMatTab(); } });

// Upload List: pilih file -> pratinjau (baris bermasalah ditandai) -> simpan
function joImport() {
  $('#md').innerHTML = `<div class="modal"><div class="card" style="width:min(1100px,100%)"><h3 style="margin-top:0">Upload List material <small style="font-family:var(--f-ui);font-style:normal;color:var(--mut)">${esc(joCur.no_jo)}</small></h3>
    <p style="margin:0 0 10px;color:var(--mut)">Gunakan file dari <a href="#" onclick="joTemplate();return false">Download Template</a> (.xlsx). Anda bisa memeriksa dulu sebelum disimpan.</p>
    <input type="file" id="uf" accept=".xlsx"><div id="up" style="margin-top:12px"></div><div class="err" id="fe" role="alert"></div>
    <div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Cancel</button><button class="btn" id="usave" disabled>Simpan</button></div></div></div>`;
  let items = [];
  $('#uf').onchange = run(async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > R().LIMITS.FILE_MAX_MB * 1048576) { $('#fe').textContent = `Ukuran file maks ${R().LIMITS.FILE_MAX_MB} MB`; return; }
    $('#fe').textContent = ''; $('#up').innerHTML = '<span style="color:var(--mut)">Membaca file…</span>';
    const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.onerror = no; fr.readAsDataURL(f); });
    let d; try { d = await api(`/job-orders/${joCur.id}/materials/import/preview`, 'POST', { data }); } catch (x) { $('#up').innerHTML = ''; $('#fe').textContent = x.message; $('#usave').disabled = true; return; }
    items = d.items;
    $('#up').innerHTML = `<div class="bar" style="margin-bottom:8px"><span class="tag OK">${d.summary.ok} baris valid</span>${d.summary.error ? `<span class="tag DAMAGE">${d.summary.error} baris bermasalah</span>` : ''}<span style="color:var(--mut)">${d.summary.total} baris dibaca</span></div>
      <div class="card tw" style="max-height:340px;overflow:auto"><table><tr><th>Baris</th><th>Status</th><th>Product/Container No</th><th>Description</th><th>Spec</th><th class="num">Net</th><th class="num">Gross</th><th class="num">Qty</th><th>Unit</th><th>From</th><th>Destination</th><th>Keterangan</th></tr>
      ${items.map(i => `<tr style="${i.errors.length ? 'background:var(--c-r-bg)' : ''}"><td>${i.n}</td><td><span class="tag ${i.errors.length ? 'DAMAGE' : i.warnings.length ? 'NOT_COMP' : 'OK'}">${i.errors.length ? 'Error' : i.warnings.length ? 'Cek' : 'OK'}</span></td><td><b>${esc(i.data.product_no)}</b></td><td>${esc(i.data.description)}</td><td>${esc(i.data.spec)}</td><td class="num">${fmtN(i.data.net_weight)}</td><td class="num">${fmtN(i.data.gross_weight)}</td><td class="num">${i.data.qty ?? ''}</td><td>${esc(i.data.unit)}</td><td>${esc(i.data.origin)}</td><td>${esc(i.data.destination)}</td><td style="white-space:normal;min-width:200px;color:${i.errors.length ? 'var(--bad)' : 'var(--warn)'}">${esc([...i.errors, ...i.warnings].join('; '))}</td></tr>`).join('')}</table></div>`;
    const sv = $('#usave'); sv.disabled = d.summary.ok === 0;
    sv.textContent = d.summary.error ? `Simpan ${d.summary.ok} baris valid saja` : `Simpan ${d.summary.ok} baris`;
    sv.onclick = run(async () => {
      sv.disabled = true;
      try {
        const r = await api(`/job-orders/${joCur.id}/materials/import`, 'POST', { rows: items.map(i => ({ ...i.data, _n: i.n })), skip_invalid: d.summary.error > 0 });
        closeMd(); joMq = { q: '', page: 1 }; joMatTab(); toast(`${r.imported} material disimpan${r.skipped ? `, ${r.skipped} baris dilewati` : ''}`);
      } catch (x) { $('#fe').textContent = x.message; sv.disabled = false; }
    });
  });
}

// Scan Barcode: buka material yang ada, atau isi Add data bila belum ada
const joScan = run(async () => {
  const code = await scanBarcode('Scan nomor produk');
  if (!code) return;
  const d = await api(`/job-orders/${joCur.id}/materials?q=${encodeURIComponent(code)}`), hit = d.rows.find(m => m.product_no.toLowerCase() === code.toLowerCase());
  if (hit) return joMatForm(hit.id);
  if (joCur.status === 'COMPLETE') return toast(`${code} tidak ada di JO ini`, true);
  joMatForm(null, { product_no: code });
  toast(`${code} belum ada — lengkapi Add data`);
});

/* ---------------- tab: Dokumen ---------------- */
const fmtSize = b => b == null ? '-' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1).replace('.', ',')} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
const readB64 = f => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.onerror = no; fr.readAsDataURL(f); });
const fileErr = f => !/\.(pdf|jpe?g|png)$/i.test(f.name) ? `${f.name}: file harus PDF, JPG atau PNG` : f.size > R().LIMITS.FILE_MAX_MB * 1048576 ? `${f.name}: ukuran maks ${R().LIMITS.FILE_MAX_MB} MB` : '';

function joDocTab() {
  const j = joCur;
  $('#jt').innerHTML = `<form class="card" id="df" style="padding:16px;margin-bottom:14px"><div class="fsec" style="margin-top:0">Tambah dokumen</div><div class="g3">
      <div><label>Jenis dokumen <b style="color:var(--bad)">*</b></label><select name="doc_type" required>${R().DOC_TYPES.map(x => `<option value="${x.code}">${x.label}</option>`).join('')}</select></div>
      <div><label>No. dokumen</label><input name="doc_no" maxlength="80" placeholder="opsional"></div>
      <div><label>File (PDF/JPG/PNG, maks ${R().LIMITS.FILE_MAX_MB} MB) <b style="color:var(--bad)">*</b></label><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required></div></div>
      <div class="err" id="fe" role="alert"></div><div class="acts" style="margin-top:8px"><button class="btn">Upload</button></div></form>
    <div class="card tw"><table><tr><th>No</th><th>Jenis</th><th>No. Dokumen</th><th>Nama File</th><th class="num">Ukuran</th><th>Diunggah</th><th>Download</th><th>Upload</th><th>Delete</th></tr>
    ${j.documents.map((d, i) => `<tr class="row"><td>${i + 1}</td><td>${esc(docLabel(d.doc_type))}</td><td>${esc(d.doc_no || '-')}</td><td style="white-space:normal;word-break:break-all;max-width:260px">${esc(d.filename)}</td><td class="num">${fmtSize(d.size)}</td><td>${fmtDT(d.created_at)}${d.uploaded_by ? ' · ' + esc(d.uploaded_by) : ''}</td>
      <td><a class="btn sec sm" href="/uploads/${d.path}?t=${token}" download="${esc(d.filename)}" target="_blank" rel="noopener">Download</a></td>
      <td><label class="btn sec sm" style="margin:0">Upload<input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onchange="joDocReplace(${d.id},this)"></label></td>
      <td><button class="btn bad sm" onclick="joDocDelete(${d.id},'${esc(d.filename).replace(/'/g, '')}')">Delete</button></td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--mut)">Belum ada dokumen</td></tr>'}</table></div>`;
  $('#df').onsubmit = run(async e => {
    e.preventDefault();
    const f = e.target, file = f.file.files[0], err = file ? fileErr(file) : 'File wajib dipilih';
    if (err) { $('#fe').textContent = err; return; }
    try { await api(`/job-orders/${j.id}/documents`, 'POST', { filename: file.name, data: await readB64(file), doc_type: f.doc_type.value, doc_no: f.doc_no.value }); toast('Dokumen diunggah'); joOpen(j.id, 'dokumen'); }
    catch (x) { $('#fe').textContent = x.message; }
  });
}
const joDocReplace = run(async (id, input) => {
  const file = input.files[0]; if (!file) return;
  const err = fileErr(file); if (err) return alert(err);
  if (!confirm(`Ganti file dokumen dengan "${file.name}"?`)) { input.value = ''; return; }
  await api(`/documents/${id}/file`, 'PUT', { filename: file.name, data: await readB64(file) }); toast('File diganti'); joOpen(joCur.id, 'dokumen');
});
const joDocDelete = run(async (id, name) => { if (confirm(`Hapus dokumen "${name}"?`)) { await api('/documents/' + id, 'DELETE'); toast('Dokumen dihapus'); joOpen(joCur.id, 'dokumen'); } });

/* ---------------- tab: Checklist kelengkapan ---------------- */
function joCheckTab() {
  const list = joCur.checklist, full = list.filter(c => c.inv && c.fp).length;
  const who = (by, at) => by ? `<small style="display:block;color:var(--mut)">${esc(by)} · ${fmtDT(at)}</small>` : '';
  $('#jt').innerHTML = `<div class="card tw"><table><tr><th>Item kelengkapan</th><th>INV</th><th>FP</th></tr>
    ${list.map(c => `<tr><td><b>${esc(c.label)}</b></td>
      <td><label class="inl" style="margin:0"><input type="checkbox" aria-label="${esc(c.label)} INV" ${c.inv ? 'checked' : ''} onchange="joCheck('${c.item}','inv',this)"> INV</label>${who(c.inv_by, c.inv_at)}</td>
      <td><label class="inl" style="margin:0"><input type="checkbox" aria-label="${esc(c.label)} FP" ${c.fp ? 'checked' : ''} onchange="joCheck('${c.item}','fp',this)"> FP</label>${who(c.fp_by, c.fp_at)}</td></tr>`).join('')}</table>
    <div class="pg" style="justify-content:space-between"><span>${full} dari ${list.length} item lengkap (INV dan FP)</span><span style="color:var(--mut)">INV = invoice diterima · FP = faktur pajak</span></div></div>`;
}
const joCheck = async (item, field, el) => {
  el.disabled = true;
  try { const r = await api(`/job-orders/${joCur.id}/checklist`, 'PUT', { item, [field]: el.checked }); joCur.checklist = r.checklist; joDetail(joCur.id, 'checklist'); }
  catch (x) { alert(x.message); el.checked = !el.checked; el.disabled = false; }
};

/* ---------------- tab: Remarks ---------------- */
function joRemarkTab() {
  $('#jt').innerHTML = `<form class="card" id="rf2" style="padding:16px"><label>Remarks (catatan saat pembuatan JO, bisa diedit)</label><textarea name="remarks" rows="8" maxlength="5000">${esc(joCur.remarks)}</textarea>
    <div class="acts"><span style="flex:1;color:var(--mut)">${joCur.updated_at ? 'Terakhir diubah ' + fmtDT(joCur.updated_at) : ''}</span><button class="btn">Simpan</button></div></form>`;
  $('#rf2').onsubmit = run(async e => { e.preventDefault(); await api(`/job-orders/${joCur.id}/remarks`, 'PATCH', { remarks: e.target.remarks.value }); toast('Remarks tersimpan'); joOpen(joCur.id, 'remarks'); });
}

/* ---------------- Preview: lembar Job Order A4 (cetak / simpan PDF dari browser) ---------------- */
function joPreview(id) {
  const j = joCur, refs = k => (j.refs[k] || []).join(', '), ck = Object.fromEntries(j.checklist.map(x => [x.item, x]));
  const kv = (k, v) => `<div class="a4kv"><span>${k}</span><b>${esc(v || '-')}</b></div>`;
  $('#ttl').textContent = 'Preview Job Order';
  $('#view').innerHTML = `<div class="tabs noprint"><a class="btn sec sm" href="#jo/${j.id}">‹ Kembali ke detail</a><span style="flex:1"></span><button class="btn sm" onclick="window.print()">Print / Simpan PDF</button></div>
    <div class="a4wrap"><article class="a4" aria-label="Lembar Job Order ${esc(j.no_jo)}">
      <header class="a4h"><div><b>PT LIMA SARANA TRANS</b><small>Jakarta Garden City Rukan Avenue Block C8 No. 53, Cakung Timur, Cakung, Jakarta Timur, DKI Jakarta</small></div><div class="a4no">${esc(j.no_jo)}<small>JOB ORDER · ${esc(typeLabel(j.type))}${j.type_bc ? ' · ' + esc(j.type_bc) : ''}</small></div></header>
      <section class="a4g">${kv('Customer', j.customer_name)}${kv('Shipper / Ship To', j.shipper_name)}${kv('No. Invoice', refs('INVOICE'))}${kv('No. MBL / HBL', refs('BL'))}${kv('No. SI / PO', refs('SI_PO'))}${kv('No. Aju PIB/PEB', refs('AJU'))}
        ${kv('Type', typeLabel(j.type) + (j.type_bc ? ' · ' + j.type_bc : ''))}${kv('Jenis Muatan', R().JENIS_MUATAN.find(x => x.code === j.jenis_muatan)?.label)}${kv('Party', j.party)}${kv('Weight', j.weight == null ? '' : fmtN(j.weight) + ' ton')}
        ${kv('Vessel', j.vessel)}${kv('ETA/ETD', fmtD(j.eta_etd))}${kv('Rencana Delivery', fmtD(j.delivery_plan))}</section>
      <section><h4>Remarks</h4><div class="a4box mid" style="min-height:38mm">${esc(j.remarks || '').replace(/\n/g, '<br>')}</div></section>
      <section><h4>Checklist Kelengkapan</h4><div class="a4chk">${R().CHECKLIST_ITEMS.map(it => `<div><b>${esc(it.label)}</b><span>${ck[it.code]?.inv ? '☑' : '☐'} INV</span><span>${ck[it.code]?.fp ? '☑' : '☐'} FP</span></div>`).join('')}</div></section>
      <section><h4>Catatan operasional (tulis tangan dengan pulpen)</h4><div class="a4box big" style="min-height:70mm"></div></section>
    </article></div>`;
}
