/* Handling Ops: Overview (tickets), Report Material, Trucking Delivery (Surat Jalan) */
let hoSt = { q: '', progress: '', page: 1, ...monthRange() }, hoMq = { q: '', status: '', page: 1 }, hoSq = { q: '', page: 1 }, hoT = null;
const pct = v => `${Number(v).toFixed(2).replace('.', ',')}%`;
const pcls = v => (v >= 100 ? 'p-ok' : v >= 50 ? 'p-warn' : 'p-bad');
const dwell = m => `${Math.floor(m / 1440)} D : ${String(Math.floor(m / 60) % 24).padStart(2, '0')} H : ${String(m % 60).padStart(2, '0')} M`;
const fmtT = d => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleTimeString('id-ID', { hour12: false }).replace(/\./g, ':') + ' WIB' : '-';
const loadT = m => m == null ? '-' : `${Math.floor(m / 60)} H ${m % 60} M`;
const markOf = s => s === 'OK' ? '<b class="p-ok">Good</b>' : s === 'DAMAGE' ? '<b class="p-bad">Damage</b>' : '-';
const ICON = {
  copy: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></svg>',
  material: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="m9 14 2 2 4-4"/></svg>',
  truck: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
};
// tombol progress: ikon + persen + bar, seluruhnya link ke halaman terkait
const pbtn = (href, icon, v, title) => `<a class="pbtn" href="${href}" title="${title}" aria-label="${title} ${pct(v)}"><span class="pi">${ICON[icon]}</span><span class="pv"><b class="${pcls(v)}">${pct(v)}</b><i class="pb ${pcls(v)}"><u style="width:${Math.min(100, +v)}%"></u></i></span><span class="chev">›</span></a>`;
const dtLocal = d => d ? d.replace(' ', 'T').slice(0, 16) : '';

async function download(path, name) {
  const r = await raw(path);
  if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}
const hoQs = o => new URLSearchParams(o);
const pager = (page, pages, total, fn) => `<div class="pg"><span>${total} data</span><button class="btn sec sm" ${page <= 1 ? 'disabled' : ''} onclick="${fn}(-1)">‹</button><span>${page}/${pages || 1}</span><button class="btn sec sm" ${page >= pages ? 'disabled' : ''} onclick="${fn}(1)">›</button></div>`;
const searchBind = (sel, st, fn) => { let t; $(sel).oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; fn().then(() => { const q = $(sel); q.focus(); q.setSelectionRange(1e4, 1e4); }); }, 300); }; };

/* ---- foto: kamera / galeri, di-resize di browser ---- */
function resizeImg(file, max = 1280) {
  return new Promise((ok, no) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      const url = c.toDataURL('image/jpeg', 0.8);
      ok({ url, data: url.split(',')[1], filename: file.name.replace(/\.\w+$/, '') + '.jpg' });
    };
    img.onerror = () => no(new Error('File bukan gambar'));
    img.src = u;
  });
}
// existing: [{id,path}], delUrl: endpoint hapus foto; return {staged}
function photoBox(sel, max, existing, delUrl) {
  const box = { staged: [], existing: [...existing] };
  const draw = () => {
    const n = box.existing.length + box.staged.length;
    $(sel).innerHTML = `<div class="bar" style="margin:0"><label class="btn sec sm" style="margin:0">Camera<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn sec sm" style="margin:0">Galery<input type="file" accept="image/*" multiple hidden></label><span style="color:var(--mut)">${n}/${max}</span></div>
      <div class="ph">${box.existing.map(p => `<div><img src="${photoOf(p.path)}" onclick="window.open(this.src)"><button type="button" data-e="${p.id}">×</button></div>`).join('')}
      ${box.staged.map((p, i) => `<div><img src="${p.url}"><button type="button" data-s="${i}">×</button></div>`).join('')}
      ${n ? '' : '<div>Belum ada foto</div>'}</div>`;
    $(sel).querySelectorAll('input[type=file]').forEach(inp => inp.onchange = async e => {
      for (const f of e.target.files) {
        if (box.existing.length + box.staged.length >= max) { alert(`Maksimal ${max} foto`); break; }
        try { box.staged.push(await resizeImg(f)); } catch (x) { alert(x.message); }
      }
      draw();
    });
    $(sel).querySelectorAll('button[data-s]').forEach(b => b.onclick = () => { box.staged.splice(+b.dataset.s, 1); draw(); });
    $(sel).querySelectorAll('button[data-e]').forEach(b => b.onclick = run(async () => {
      if (!confirm('Hapus foto ini?')) return;
      await api(delUrl + b.dataset.e, 'DELETE'); box.existing = box.existing.filter(p => p.id != b.dataset.e); draw();
    }));
  };
  draw();
  box.upload = async url => { for (const p of box.staged) await api(url, 'POST', { filename: p.filename, data: p.data }); box.staged = []; };
  return box;
}

/* ---- router ---- */
const hoRoute = ([id, sub]) => !id ? hoOverview() : sub === 'trucking' ? hoTrucking(id) : hoMaterial(id);

/* ================= OVERVIEW ================= */
const hoOverview = run(async () => {
  $('#ttl').textContent = 'Handling Operasional';
  const d = await api('/ho/tickets?' + hoQs(hoSt)), c = d.counts;
  const tab = (k, n, v) => `<button class="btn ${hoSt.progress === k ? '' : 'sec'} sm" onclick="hoSetP('${k}')">${n} (${v})</button>`;
  $('#view').innerHTML = `<p style="margin:-8px 0 14px;color:var(--mut)">Report Material &amp; Trucking Delivery</p>
    <div class="bar fbar"><input id="hq" placeholder="Cari ticket, PIC, customer, vessel" value="${esc(hoSt.q)}">
    <label class="inl">Tanggal <input type="date" id="hf" value="${hoSt.from}"> – <input type="date" id="ht" value="${hoSt.to}"></label>
    <button class="btn sec" onclick="hoResetF()">Reset</button><span style="flex:1"></span>
    <button class="btn sec out" onclick="hoExport()">Download Excel</button><button class="btn" onclick="hoTicketForm()">+ Tambah Data</button></div>
    <div class="tabs">${tab('', 'All', c.all)}${tab('done', '100%', c.done)}${tab('mid', '50% - 99%', c.mid)}${tab('low', '< 50%', c.low)}</div>
    <div class="card tw"><table><tr><th>No. Ticket</th><th>PIC</th><th>Customer</th><th>Vessel</th><th>Party</th><th class="num">Weight</th><th>Dwelling time</th><th>Report Material</th><th>Trucking Delivery</th><th>Report</th></tr>
    ${d.rows.map(r => `<tr class="row"><td><a href="#ho/${r.id}/material"><b>${esc(r.ticket_no)}</b></a></td><td>${esc(r.pic_name)}</td><td class="wrap">${esc(r.customer)}</td><td>${esc(r.vessel)}</td><td>${esc(r.party)}</td><td class="num">${fmtN(r.weight)} ton</td><td>${dwell(r.dwell_min)}</td>
      <td>${pbtn(`#ho/${r.id}/material`, 'material', r.mat_pct, 'Buka Report Material')}</td>
      <td>${pbtn(`#ho/${r.id}/trucking`, 'truck', r.del_pct, 'Buka Trucking Delivery')}</td>
      <td style="white-space:nowrap"><button class="ib" title="Copy report" aria-label="Copy report" onclick="hoCopy(${r.id})">${ICON.copy}</button> <button class="ib" title="Download Excel" aria-label="Download Excel" onclick="hoDl(${r.id},'${esc(r.ticket_no)}')">${ICON.down}</button></td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--mut)">Belum ada ticket</td></tr>'}</table>
    ${pager(hoSt.page, d.pages, d.total, 'hoGo')}</div>`;
  searchBind('#hq', hoSt, hoOverview);
  [['hf', 'from'], ['ht', 'to']].forEach(([i, k]) => $('#' + i).onchange = e => { hoSt[k] = e.target.value; hoSt.page = 1; hoOverview(); });
});
const hoSetP = k => { hoSt.progress = k; hoSt.page = 1; hoOverview(); };
const hoResetF = () => { hoSt = { q: '', progress: '', page: 1, ...monthRange() }; hoOverview(); };
const hoGo = n => { hoSt.page += n; hoOverview(); };
const hoExport = run(() => download('/ho/tickets/export?' + hoQs(hoSt), `handling-ops-${today()}.csv`));
const hoDl = run((id, no) => download(`/ho/tickets/${id}/export`, `report-${no}.csv`));
const hoCopy = run(async id => {
  const { text } = await api(`/ho/tickets/${id}/report-text`);
  await navigator.clipboard.writeText(text);
  alert('Report disalin ke clipboard');
});

/* ---- Ticket: pilih JO ---- */
let hoSel = [], hoEditId = null;
const hoTicketForm = run(async id => {
  hoEditId = id || null; hoSel = id ? (await api('/ho/tickets/' + id)).jos : [];
  const now = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'medium' });
  $('#md').innerHTML = `<div class="modal"><div class="card"><h3 style="margin-top:0">Ticketing · Handling Operasional ${id ? '<small style="color:var(--mut)">(edit JO)</small>' : ''}</h3>
    <div class="kv"><div><span>PIC:</span> <b>${esc(look.me?.name || uname)}</b></div><div><span>Total:</span> <b id="tt">-</b></div>
    <div><span>No. ID:</span> <b>${esc(look.me?.employee_no || '-')}</b></div><div><span>Date &amp; Time:</span> <b>${now}</b></div></div>
    <div class="bar" style="margin-top:14px"><input id="jn" placeholder="Input Nomor JO" style="max-width:200px"><button type="button" class="btn" onclick="hoAddJo()">ADD DATA</button><button type="button" class="btn sec" onclick="hoBrowse()">BROWSE DATA</button></div>
    <div class="card tw"><table><tr><th>No.</th><th>Job Order</th><th>Aju</th><th>Customer</th><th>Party</th><th class="num">Weight</th><th>No. BL</th><th>Vessel</th><th></th></tr><tbody id="tk"></tbody></table></div>
    <div class="err" id="fe"></div><div class="acts"><button class="btn sec" onclick="closeMd()">Cancel</button><button class="btn" onclick="hoSaveTicket()">${id ? 'Simpan' : 'Create Ticket'}</button></div><div id="qa"></div></div></div>`;
  $('#jn').onkeydown = e => { if (e.key === 'Enter') hoAddJo(); };
  hoDrawSel();
});
function hoDrawSel() {
  $('#tk').innerHTML = hoSel.map((j, i) => `<tr><td>${i + 1}</td><td><b>${esc(j.no_jo)}</b></td><td>${esc(j.aju_no)}</td><td>${esc(j.customer_name)}</td><td>${esc(j.party)}</td><td class="num">${fmtN(j.weight)}</td><td>${esc(j.bl_no)}</td><td>${esc(j.vessel)}</td>
    <td><button class="btn bad sm" onclick="hoRmJo(${i})">×</button></td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--mut)">Belum ada JO. Input nomor JO atau gunakan Browse Data.</td></tr>';
  const w = hoSel.reduce((a, j) => a + (+j.weight || 0), 0), bl = new Set(hoSel.flatMap(j => String(j.bl_no || '').split(/[,;]\s*/).filter(Boolean))).size;
  $('#tt').textContent = `${hoSel.length} JO · ${fmtN(w)} Ton · ${bl} BL`;
}
const hoRmJo = i => { hoSel.splice(i, 1); hoDrawSel(); };
const hoAddJo = run(async () => {
  const v = $('#jn').value.trim();
  if (!v) return;
  const rows = await api(`/ho/browse-jo?ticket=${hoEditId || 0}&q=${encodeURIComponent(v)}`), j = rows.find(r => r.no_jo.toLowerCase() === v.toLowerCase());
  if (!j) return alert('JO tidak ditemukan, sudah Complete, atau sudah dipakai ticket lain');
  if (hoSel.some(x => x.id === j.id)) return alert('JO sudah ada di daftar');
  hoSel.push(j); $('#jn').value = ''; hoDrawSel();
});
const hoBrowse = run(async () => {
  $('#qa').innerHTML = `<div class="modal" style="z-index:9"><div class="card"><h3 style="margin-top:0">Browse Job Order</h3><div class="bar"><input id="bq" placeholder="Input cust, Vessel, BL..."></div>
    <div class="card tw" style="max-height:340px;overflow:auto"><table><tr><th></th><th>No. JO</th><th>Customer</th><th>Party</th><th class="num">Weight</th><th>Bill of Lading</th><th>Invoice</th><th>Vessel</th></tr><tbody id="bl"></tbody></table></div>
    <div class="acts"><button class="btn sec" onclick="$('#qa').innerHTML=''">Back</button><button class="btn" onclick="hoPick()">Tambahkan</button></div></div></div>`;
  let list = [];
  const load = async () => {
    list = await api(`/ho/browse-jo?ticket=${hoEditId || 0}&q=${encodeURIComponent($('#bq').value)}`);
    $('#bl').innerHTML = list.map((j, i) => `<tr><td><input type="checkbox" data-i="${i}" ${hoSel.some(x => x.id === j.id) ? 'checked disabled' : ''} style="width:auto"></td><td><b>${esc(j.no_jo)}</b></td><td>${esc(j.customer_name)}</td><td>${esc(j.party)}</td><td class="num">${fmtN(j.weight)}</td><td>${esc(j.bl_no)}</td><td>${esc(j.invoice_no)}</td><td>${esc(j.vessel)}</td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--mut)">Tidak ada JO tersedia</td></tr>';
  };
  let t; $('#bq').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  window.hoPick = () => { document.querySelectorAll('#bl input:checked:not(:disabled)').forEach(c => hoSel.push(list[+c.dataset.i])); $('#qa').innerHTML = ''; hoDrawSel(); };
  await load();
});
const hoSaveTicket = run(async () => {
  try {
    const body = { jo_ids: hoSel.map(j => j.id) };
    if (hoEditId) { await api(`/ho/tickets/${hoEditId}/jos`, 'PUT', body); closeMd(); route(); }
    else { const r = await api('/ho/tickets', 'POST', body); closeMd(); location.hash = `#ho/${r.id}/material`; }
  } catch (x) { $('#fe').textContent = x.message; }
});

/* ================= HEADER BERSAMA ================= */
function hoHead(t, tab) {
  const jos = t.jos, join = f => esc([...new Set(jos.map(j => j[f]).filter(Boolean))].join(', ') || '-');
  const stJo = jos.length && jos.every(j => j.status === 'COMPLETE') ? 'Complete' : 'Not Complete';
  return `<div class="tabs"><a class="btn sec sm" href="#ho">‹ Back</a><a class="btn ${tab === 'material' ? '' : 'sec'} sm" href="#ho/${t.id}/material">Report Material</a><a class="btn ${tab === 'trucking' ? '' : 'sec'} sm" href="#ho/${t.id}/trucking">Trucking Delivery</a>
    <span style="flex:1"></span><button class="btn sec sm" onclick="hoTicketForm(${t.id})">Edit JO</button>${t.sj_count ? '' : `<button class="btn bad sm" onclick="hoDelTicket(${t.id})">Hapus Ticket</button>`}</div>
    <div class="card hd"><div class="kv"><div><span>Ticket:</span> <b>${esc(t.ticket_no)}</b></div><div><span>PIC:</span> <b>${esc(t.pic_name)}</b></div>
    <div><span>Job Order:</span> <b>${jos.map(x => `<a href="#jo/${x.id}" title="Buka Job Order">${esc(x.no_jo)}</a>`).join(', ') || '-'}</b></div><div><span>Party:</span> <b>${join('party')}</b></div>
    <div><span>Customer:</span> <b>${join('customer_name')}</b></div><div><span>Weight:</span> <b>${fmtN(t.weight)} Ton</b></div>
    <div><span>Vessel:</span> <b>${join('vessel')}</b></div><div><span>No. Aju:</span> <b>${join('aju_no')}</b></div>
    <div><span>No. BL:</span> <b>${join('bl_no')}</b></div><div><span>Status JO:</span> <b>${stJo}</b></div></div></div>
    <div class="cards"><div class="card stat s-mat"><b class="${pcls(t.mat_pct)}">${pct(t.mat_pct)}</b><span>Report Material (${t.mat_checked}/${t.mat_total} dicek)</span></div>
    <div class="card stat s-del"><b class="${pcls(t.del_pct)}">${pct(t.del_pct)}</b><span>Trucking Delivery (${fmtN(t.qty_sent)}/${fmtN(t.qty_total)} qty)</span></div>
    <div class="card stat s-dw"><b>${dwell(t.dwell_min)}</b><span>Dwelling time${t.done_at ? ' (selesai)' : ''}</span></div></div>`;
}
const hoDelTicket = run(async id => { if (confirm('Hapus ticket beserta seluruh material dan fotonya?')) { await api('/ho/tickets/' + id, 'DELETE'); location.hash = '#ho'; } });
const hoLoadT = async id => { hoT = await api('/ho/tickets/' + id); return hoT; };

/* ================= REPORT MATERIAL ================= */
const hoMaterial = run(async id => {
  const t = await hoLoadT(id);
  $('#ttl').textContent = 'Report Material';
  $('#view').innerHTML = hoHead(t, 'material') + '<div id="hl"></div>';
  hoMatList();
});
const hoMatList = run(async () => {
  const t = hoT, d = await api(`/ho/tickets/${t.id}/materials?${hoQs(hoMq)}`), s = d.totals;
  const sel = t.jos.length > 0;
  $('#hl').innerHTML = `<div class="bar fbar"><input id="mq" placeholder="Search by name, Destination, … / Scan Barcode" value="${esc(hoMq.q)}" style="max-width:320px">
    <select id="ms"><option value="">Semua status</option><option value="NOT_CHECKED">Not Checked</option><option value="OK">OK</option><option value="DAMAGE">Damage</option></select>
    <span class="tag" style="color:var(--ink)">Net ${fmtN(s.net)}</span><span class="tag" style="color:var(--ink)">Gross ${fmtN(s.gross)}</span><span class="tag" style="color:var(--ink)">Qty ${fmtN(s.qty)}</span><span style="flex:1"></span>
    <button class="btn sec" onclick="hoDl(${t.id},'${esc(t.ticket_no)}')">Download Excel</button>
    <button class="btn sec" ${sel ? '' : 'disabled'} onclick="hoImport()">Import</button><button class="btn" ${sel ? '' : 'disabled'} onclick="hoMatForm()">+ Material</button></div>
    <div class="card tw"><table><tr><th>No.</th><th>Product/Container No.</th><th>Description</th><th>Spec</th><th class="num">Thickness</th><th class="num">Width</th><th class="num">Net Weight</th><th class="num">Gross Weight</th><th class="num">Qty</th><th>Satuan</th><th>Dari</th><th>Tujuan</th><th>Status</th></tr>
    ${d.rows.map((m, i) => `<tr class="row" style="cursor:pointer" onclick="hoMatReport(${m.id})"><td>${(hoMq.page - 1) * 20 + i + 1}</td><td><a href="#" onclick="return false"><b>${esc(m.product_no)}</b></a></td><td>${esc(m.description)}</td><td>${esc(m.spec)}</td><td class="num">${fmtN(m.thickness)}</td><td class="num">${fmtN(m.width)}</td><td class="num">${fmtN(m.net_weight)}</td><td class="num">${fmtN(m.gross_weight)}</td><td class="num">${m.qty}</td><td>${esc(m.unit)}</td><td>${esc(m.origin)}</td><td>${esc(m.destination)}</td>
      <td><span class="tag ${m.check_status}">${{ NOT_CHECKED: '-', OK: 'OK', DAMAGE: 'DM' }[m.check_status]}</span></td></tr>`).join('') || `<tr><td colspan="13" style="text-align:center;color:var(--mut)">${sel ? 'Belum ada material. Gunakan + Material atau Import.' : 'Ticket belum memiliki JO'}</td></tr>`}</table>
    ${pager(hoMq.page, d.pages, d.total, 'hoMGo')}</div>`;
  $('#ms').value = hoMq.status;
  searchBind('#mq', hoMq, hoMatList);
  $('#mq').onkeydown = run(async e => { // scan barcode = ketik lalu Enter
    if (e.key !== 'Enter') return;
    const r = await api(`/ho/tickets/${t.id}/materials?q=${encodeURIComponent(e.target.value.trim())}`), m = r.rows.find(x => x.product_no.toLowerCase() === e.target.value.trim().toLowerCase()) || (r.rows.length === 1 && r.rows[0]);
    if (m) hoMatReport(m.id); else alert('Material tidak ditemukan');
  });
  $('#ms').onchange = e => { hoMq.status = e.target.value; hoMq.page = 1; hoMatList(); };
});
const hoMGo = n => { hoMq.page += n; hoMatList(); };

const hoMatReport = run(async id => {
  const m = await api(`/ho/tickets/${hoT.id}/materials/${id}`), t = hoT;
  const kv = (k, v) => `<div><span>${k}:</span> <b>${esc(v ?? '-') || '-'}</b></div>`;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="rf" style="max-width:720px"><h3 style="margin-top:0">Report Material</h3>
    <div class="kv">${kv('Product/Container No.', m.product_no)}<div><span>No. Job Order:</span> <b><a href="#jo/${m.jo_id}" onclick="closeMd()">${esc(m.jo_no)}</a></b></div>${kv('Description', m.description)}${kv('No. BL', m.bl_no)}${kv('Spec', m.spec)}${kv('No. Aju PIB/PEB', m.aju_no)}
    ${kv('Quantity', `${m.qty} ${m.unit}`)}${kv('Gross Weight', fmtN(m.gross_weight))}${kv('Satuan', m.unit)}${kv('Destination', m.destination)}${m.sj_nos ? kv('Surat Jalan', m.sj_nos) : ''}</div>
    <div class="g" style="margin-top:14px"><div class="full"><label>Report</label><select name="check_status"><option value="NOT_CHECKED">Not Checked</option><option value="OK">Oke</option><option value="DAMAGE">Damage</option></select></div>
    <div class="full"><label>Remarks (wajib jika Damage)</label><textarea name="remarks" rows="3">${esc(m.remarks)}</textarea></div>
    <div class="full"><label>Add Photos (maks 8)</label><div id="pb"></div></div></div>
    ${m.checked_at ? `<p style="color:var(--mut);font-size:12px">Terakhir dicek ${fmtDT(m.checked_at)} oleh ${esc(m.checked_by)}</p>` : ''}
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Cancel</button>
    ${m.sent_qty ? '' : `<button type="button" class="btn bad" onclick="hoDelMat(${m.id})">Hapus</button>`}<button type="button" class="btn sec" onclick="hoMatForm(${m.id})">Edit Data</button><button class="btn">Save</button></div></form></div>`;
  $('#rf').check_status.value = m.check_status;
  const box = photoBox('#pb', R().LIMITS.MATERIAL_PHOTOS, m.photos, '/ho/files/');
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/ho/tickets/${hoT.id}/materials/${id}/report`, 'PATCH', { check_status: f.check_status.value, remarks: f.remarks.value });
      await box.upload(`/ho/tickets/${hoT.id}/materials/${id}/photos`);
      closeMd(); route();
    } catch (x) { $('#fe').textContent = x.message; }
  };
});
const hoDelMat = run(async id => { if (confirm('Hapus material ini?')) { await api('/ho/materials/' + id, 'DELETE'); closeMd(); route(); } });

const MAT_F = [['product_no', 'Product/Container No. *', 'text'], ['description', 'Description', 'text'], ['spec', 'Spec', 'text'], ['bl_no', 'No. BL', 'text'], ['thickness', 'Thickness', 'number'], ['width', 'Width', 'number'],
  ['net_weight', 'Net Weight (total baris)', 'number'], ['gross_weight', 'Gross Weight (total baris)', 'number'], ['qty', 'Qty *', 'number'], ['unit', 'Satuan', 'text'], ['origin', 'Dari', 'text'], ['destination', 'Tujuan', 'text']];
const hoMatForm = run(async id => {
  const m = id ? await api(`/ho/tickets/${hoT.id}/materials/${id}`) : { unit: 'COIL', qty: 1, jo_id: hoT.jos[0]?.id, origin: 'PRIOK' };
  $('#md').innerHTML = `<div class="modal"><form class="card" id="mf"><h3 style="margin-top:0">${id ? 'Edit Material' : 'Tambah Material'}</h3><div class="g">
    <div class="full"><label>Job Order *</label><select name="jo_id">${hoT.jos.map(j => `<option value="${j.id}" ${j.id === m.jo_id ? 'selected' : ''}>${esc(j.no_jo)} · ${esc(j.customer_name)}</option>`).join('')}</select></div>
    ${MAT_F.map(([k, n, ty]) => `<div><label>${n}</label><input name="${k}" type="${ty}" ${k === 'qty' ? 'min="1" step="1"' : ty === 'number' ? 'step="0.01" min="0"' : ''} value="${esc(m[k] ?? '')}"></div>`).join('')}</div>
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="${id ? `hoMatReport(${id})` : 'closeMd()'}">Batal</button><button class="btn">Simpan</button></div></form></div>`;
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try { id ? await api('/ho/materials/' + id, 'PUT', b) : await api(`/ho/tickets/${hoT.id}/materials`, 'POST', b); closeMd(); route(); }
    catch (x) { $('#fe').textContent = x.message; }
  };
});

const IMP_COLS = ['product_no', 'description', 'spec', 'thickness', 'width', 'bl_no', 'net_weight', 'gross_weight', 'qty', 'unit', 'origin', 'destination'];
const hoImport = () => {
  $('#md').innerHTML = `<div class="modal"><form class="card" id="imf"><h3 style="margin-top:0">Import Material</h3>
    <div><label>Job Order untuk semua baris</label><select name="jo_id">${hoT.jos.map(j => `<option value="${j.id}">${esc(j.no_jo)} · ${esc(j.customer_name)}</option>`).join('')}</select></div>
    <div style="margin-top:10px"><label>Tempel dari Excel (tab) atau CSV (koma), tanpa header. Urutan kolom: ${IMP_COLS.join(', ')}. Angka pakai titik desimal tanpa pemisah ribuan.</label>
    <textarea name="rows" rows="10" placeholder="CQH4162B&#9;GALVANIZED COIL&#9;JAC270C&#9;0.7&#9;1245&#9;ASANKWJK12&#9;8120&#9;8187&#9;1&#9;COIL&#9;PRIOK&#9;CIBITUNG" required></textarea></div>
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn">Import</button></div></form></div>`;
  $('#imf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, rows = f.rows.value.split(/\r?\n/).filter(l => l.trim()).map(l => {
      const c = l.split(l.includes('\t') ? '\t' : ',').map(x => x.trim()), o = { jo_id: f.jo_id.value };
      IMP_COLS.forEach((k, i) => o[k] = c[i] ?? '');
      if (o.qty === '') o.qty = 1;
      return o;
    });
    try { const r = await api(`/ho/tickets/${hoT.id}/materials`, 'POST', { rows }); alert(`${r.count} material diimport`); closeMd(); route(); }
    catch (x) { $('#fe').textContent = x.message; }
  };
};

/* ================= TRUCKING DELIVERY ================= */
const hoTrucking = run(async id => {
  const t = await hoLoadT(id);
  $('#ttl').textContent = 'Trucking Delivery';
  $('#view').innerHTML = hoHead(t, 'trucking') + '<div id="hl"></div>';
  hoSjList();
});
const hoSjList = run(async () => {
  const t = hoT, d = await api(`/ho/tickets/${t.id}/sj?${hoQs(hoSq)}`), s = d.totals;
  $('#hl').innerHTML = `<div class="bar fbar"><input id="sq" placeholder="Search by nopol, driver, no. surat jalan" value="${esc(hoSq.q)}" style="max-width:320px">
    <span class="tag" style="color:var(--ink)">Net ${fmtN(s.net)}</span><span class="tag" style="color:var(--ink)">Gross ${fmtN(s.gross)}</span><span class="tag" style="color:var(--ink)">Qty ${fmtN(s.qty)}</span><span class="tag" style="color:var(--ink)">${s.trips} RIT</span><span style="flex:1"></span>
    <button class="btn sec" onclick="hoCopy(${t.id})">Copy Report</button><button class="btn" ${t.mat_total ? '' : 'disabled'} onclick="hoSjForm()">Buat Surat Jalan</button></div>
    <div class="card tw"><table><tr><th>No.</th><th>Nomor Polisi</th><th>Driver</th><th>Vendor</th><th>No. Surat Jalan</th><th>Start Loading</th><th>Load Time</th><th class="num">Net Weight</th><th class="num">Gross Weight</th><th class="num">Qty</th><th>Satuan</th><th>Dari</th><th>Tujuan</th><th>Detail</th></tr>
    ${d.rows.map((r, i) => `<tr class="row"><td>${(hoSq.page - 1) * 20 + i + 1}</td><td><b>${esc(r.nopol)}</b></td><td>${esc(r.driver)}</td><td>${esc(r.vendor_code)}</td><td>${esc(r.sj_no)}</td><td>${fmtT(r.start_at)}</td><td>${loadT(r.load_min)}</td><td class="num">${fmtN(r.net_weight)}</td><td class="num">${fmtN(r.gross_weight)}</td><td class="num">${r.qty}</td><td>${esc(r.unit)}</td><td>${esc(r.origin)}</td><td>${esc(r.destination)}</td>
      <td><button class="btn sm" onclick="hoSjView(${r.id})">&gt;&gt;</button></td></tr>`).join('') || `<tr><td colspan="14" style="text-align:center;color:var(--mut)">${t.mat_total ? 'Belum ada Surat Jalan' : 'Tambahkan material di Report Material terlebih dahulu'}</td></tr>`}</table>
    ${pager(hoSq.page, d.pages, d.total, 'hoSGo')}</div>`;
  searchBind('#sq', hoSq, hoSjList);
});
const hoSGo = n => { hoSq.page += n; hoSjList(); };

let hoItems = [], hoSjId = null, hoSjBox = null, hoSjStart = null;
const hoSjForm = run(async id => {
  hoSjId = id || null; hoSjStart = new Date().toISOString();
  const s = id ? await api('/ho/sj/' + id) : { items: [], photos: [] };
  hoItems = s.items.map(i => ({ material_id: i.material_id, product_no: i.product_no, description: i.description, spec: i.spec, bl_no: i.bl_no, unit: i.unit, mat_qty: +i.mat_qty, max: +i.mat_qty, unit_net: i.qty ? +i.weight / i.qty : 0, qty: +i.qty, weight: +i.weight, destination: i.destination, check_status: i.check_status }));
  const t = hoT;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="sf" style="width:min(980px,100%)"><h3 style="margin-top:0">Surat Jalan ${id ? esc(s.sj_no) : 'Baru'}</h3>
    <div class="kv"><div><span>Customer:</span> <b>${esc([...new Set(t.jos.map(j => j.customer_name))].join(', '))}</b></div><div><span>PIC Ops:</span> <b>${esc(id ? s.pic_name : look.me?.name || uname)}</b></div><div><span>No. ID:</span> <b>${esc(id ? s.employee_no : look.me?.employee_no || '-')}</b></div></div>
    <div class="g" style="margin-top:14px"><div><label>Nopol *</label><input name="nopol" placeholder="Input Nomor Polisi" value="${esc(s.nopol)}" required></div><div><label>No Hp</label><input name="phone" placeholder="Input Nomor Handphone" value="${esc(s.phone)}"></div>
    <div><label>Driver *</label><input name="driver" placeholder="Input Nama Driver" value="${esc(s.driver)}" required></div>
    <div><label>Vendor <a href="#" onclick="hoVendorAdd();return false">+ baru</a></label><select name="vendor_id" id="sv"><option value="">Pilih Vendor</option>${look.vendors.map(v => `<option value="${v.id}" ${v.id == s.vendor_id ? 'selected' : ''}>${esc(v.code)} · ${esc(v.name)}</option>`).join('')}</select></div>
    <div><label>Masuk pabrik (opsional)</label><input name="entry_at" type="datetime-local" value="${dtLocal(s.entry_at)}"></div><div><label>Keluar pabrik (opsional)</label><input name="exit_at" type="datetime-local" value="${dtLocal(s.exit_at)}"></div></div>
    <h4 style="margin:16px 0 6px">Material</h4><div class="bar" style="margin-bottom:0"><input id="mi" placeholder="Search Nomor Product/Container (Enter / scan barcode)" style="max-width:380px"><button type="button" class="btn" onclick="hoFindMat()">ADD</button><span style="flex:1"></span><b id="stot"></b></div>
    <div class="pick" id="mpick" hidden></div>
    <div class="card tw" style="margin-top:8px"><table><tr><th></th><th>No.</th><th>Product No.</th><th>Desc</th><th>Spec</th><th>No. BL</th><th>Qty</th><th>Weight</th><th>Tujuan</th><th>Marks</th></tr><tbody id="sit"></tbody></table></div>
    <div style="margin-top:12px"><label>Add Photos (maks 3)</label><div id="pb"></div></div>
    <div class="err" id="fe"></div><div class="acts"><button type="button" class="btn sec" onclick="${id ? `hoSjView(${id})` : 'closeMd()'}">Cancel</button><button class="btn">Save</button></div><div id="qa"></div></form></div>`;
  hoSjBox = photoBox('#pb', R().LIMITS.SJ_PHOTOS, s.photos, '/ho/files/');
  $('#mi').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); hoFindMat(true); } };
  hoDrawItems();
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, b = { nopol: f.nopol.value, phone: f.phone.value, driver: f.driver.value, vendor_id: f.vendor_id.value, entry_at: f.entry_at.value || null, exit_at: f.exit_at.value || null, start_at: hoSjStart,
      items: hoItems.map(i => ({ material_id: i.material_id, qty: i.qty, weight: i.weight })) };
    try {
      let sid = id;
      if (id) await api('/ho/sj/' + id, 'PUT', b); else sid = (await api(`/ho/tickets/${t.id}/sj`, 'POST', b)).id;
      await hoSjBox.upload(`/ho/sj/${sid}/photos`);
      closeMd(); route(); hoSjView(sid);
    } catch (x) { $('#fe').textContent = x.message; }
  };
});
function hoDrawItems() {
  $('#sit').innerHTML = hoItems.map((i, k) => `<tr><td><button type="button" class="btn bad sm" onclick="hoRmItem(${k})">×</button></td><td>${k + 1}</td><td><b>${esc(i.product_no)}</b></td><td>${esc(i.description)}</td><td>${esc(i.spec)}</td><td>${esc(i.bl_no)}</td>
    <td>${i.mat_qty > 1 ? `<input type="number" min="1" max="${i.max}" value="${i.qty}" style="width:80px" onchange="hoItemQty(${k},this.value)"> ${esc(i.unit)}` : `1 ${esc(i.unit)}`}</td>
    <td><input type="number" step="0.01" min="0" value="${i.weight}" style="width:110px" onchange="hoItems[${k}].weight=+this.value;hoSjTotal()"></td><td>${esc(i.destination)}</td><td>${markOf(i.check_status)}</td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--mut)">Belum ada material</td></tr>';
  hoSjTotal();
}
const hoSjTotal = () => { $('#stot').textContent = `TOTAL: ${hoItems.reduce((a, i) => a + i.qty, 0)} ${hoItems[0]?.unit || ''} · ${fmtN(hoItems.reduce((a, i) => a + i.weight, 0))} · ${new Set(hoItems.map(i => i.bl_no).filter(Boolean)).size} BL`; };
const hoRmItem = k => { hoItems.splice(k, 1); hoDrawItems(); };
const hoItemQty = (k, v) => {
  const i = hoItems[k], q = Math.max(1, Math.min(i.max, Math.floor(+v) || 1));
  i.qty = q; i.weight = Math.round(i.unit_net * q * 100) / 100; hoDrawItems();
};
const hoAddItem = m => {
  if (hoItems.some(i => i.material_id === m.id)) return alert('Material sudah ada di Surat Jalan ini');
  hoItems.push({ material_id: m.id, product_no: m.product_no, description: m.description, spec: m.spec, bl_no: m.bl_no, unit: m.unit, mat_qty: +m.qty, max: +m.remain, qty: +m.remain, unit_net: m.net_weight / m.qty, weight: Math.round(m.net_weight / m.qty * m.remain * 100) / 100, destination: m.destination, check_status: m.check_status });
  $('#mpick').hidden = true; $('#mi').value = ''; hoDrawItems(); $('#mi').focus();
};
const hoFindMat = run(async enter => {
  const v = $('#mi').value.trim(), rows = await api(`/ho/tickets/${hoT.id}/available?ex=${hoSjId || 0}&q=${encodeURIComponent(v)}`);
  hoPickRows = rows.filter(r => !hoItems.some(i => i.material_id === r.id));
  const exact = hoPickRows.find(r => r.product_no.toLowerCase() === v.toLowerCase());
  if (exact || (enter && hoPickRows.length === 1)) return hoAddItem(exact || hoPickRows[0]);
  $('#mpick').hidden = false;
  $('#mpick').innerHTML = `<table>${hoPickRows.map((r, i) => `<tr class="row" style="cursor:pointer" onclick="hoAddItem(hoPickRows[${i}])"><td><b>${esc(r.product_no)}</b></td><td>${esc(r.description)}</td><td>${esc(r.spec)}</td><td>${r.remain} ${esc(r.unit)}</td><td>${esc(r.destination)}</td><td>${markOf(r.check_status)}</td></tr>`).join('') || '<tr><td style="color:var(--mut)">Tidak ada material tersedia (semua sudah terkirim?)</td></tr>'}</table>`;
});
let hoPickRows = [];
const hoVendorAdd = () => {
  $('#qa').innerHTML = `<div class="modal" style="z-index:9"><div class="card" id="vf" style="max-width:420px"><h3 style="margin-top:0">Vendor Baru</h3>
    <div><label>Kode (2-10 huruf/angka)</label><input id="vc" maxlength="10" style="text-transform:uppercase"></div><div style="margin-top:10px"><label>Nama</label><input id="vn"></div><div class="err" id="qe"></div>
    <div class="acts"><button type="button" class="btn sec" onclick="$('#qa').innerHTML=''">Batal</button><button type="button" class="btn" onclick="hoVendorSave()">Simpan</button></div></div></div>`;
};
const hoVendorSave = async () => {
  try {
    const r = await api('/vendors', 'POST', { code: $('#vc').value, name: $('#vn').value });
    look.vendors = await api('/vendors');
    $('#sv').innerHTML = '<option value="">Pilih Vendor</option>' + look.vendors.map(v => `<option value="${v.id}">${esc(v.code)} · ${esc(v.name)}</option>`).join('');
    $('#sv').value = r.id; $('#qa').innerHTML = '';
  } catch (x) { $('#qe').textContent = x.message; }
};

/* ---- detail + cetak Surat Jalan ---- */
const hoSjView = run(async id => {
  const s = await api('/ho/sj/' + id), jos = s.jos, j = f => esc([...new Set(jos.map(x => x[f]).filter(Boolean))].join(', ') || '-');
  const tq = s.items.reduce((a, i) => a + i.qty, 0), tw = s.items.reduce((a, i) => a + +i.weight, 0);
  $('#md').innerHTML = `<div class="modal"><div class="card" style="width:min(640px,100%)"><div class="sjp">
    <div class="co"><div><b>PT LIMA SARANA TRANS</b><br>Jakarta Garden City Rukan Avenue<br>Block C8 No.53, Cakung Timur, Cakung<br>Jakarta Timur, DKI Jakarta</div></div>
    <div style="text-align:center"><b>No. ${esc(s.sj_no)}</b></div><h2>SURAT JALAN</h2>
    <div class="kv" style="grid-template-columns:1fr"><div><span>Customer:</span> <b>${j('customer_name')}</b></div><div><span>Address Destination:</span> <b>${esc(s.destination || '-')}</b></div><div><span>From:</span> <b>${esc(s.origin || '-')}</b></div></div>
    <div class="kv" style="margin-top:8px"><div><span>Job Order:</span> <b>${j('jo_no')}</b></div><div><span>Party:</span> <b>${j('party')}</b></div><div><span>Invoice:</span> <b>${j('invoice_no')}</b></div><div><span>Weight:</span> <b>${fmtN(tw)}</b></div>
    <div><span>B/L:</span> <b>${j('bl_no')}</b></div><div><span>Nopen:</span> <b>-</b></div><div><span>Vessel:</span> <b>${j('vessel')}</b></div><div><span>No. Aju:</span> <b>${j('aju_no')}</b></div></div>
    <table style="margin-top:10px"><tr><th>No.</th><th>Product/Cont</th><th>Desc &amp; Spec</th><th class="num">Qty</th><th class="num">Weight</th><th>Marks</th></tr>
    ${s.items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.product_no)}</td><td>${esc(i.description)} ${esc(i.spec)}</td><td class="num">${i.qty}</td><td class="num">${fmtN(i.weight)}</td><td>${markOf(i.check_status)}</td></tr>`).join('')}</table>
    <p style="text-align:center"><b>Total: ${tq} ${esc(s.unit || '')} &nbsp; ${fmtN(tw / 1000)} MT</b></p>
    <div class="g" style="gap:10px"><div class="kv" style="grid-template-columns:1fr"><div><span>Nopol:</span> <b>${esc(s.nopol)}</b></div><div><span>Driver:</span> <b>${esc(s.driver)}</b></div><div><span>No. Hp:</span> <b>${esc(s.phone || '-')}</b></div><div><span>PIC OPS:</span> <b>${esc(s.pic_name)}</b></div></div>
    <div><div class="box"><u>Tanggal dan Waktu Masuk Pabrik</u>${s.entry_at ? esc(s.entry_at.slice(0, 16)) : ''}</div><div class="box" style="margin-top:6px"><u>Tanggal dan Waktu Keluar Pabrik</u>${s.exit_at ? esc(s.exit_at.slice(0, 16)) : ''}</div></div></div>
    <div style="text-align:center;margin-top:12px">${barcode(s.sj_no)}<div style="font-size:12px">Barcode nomor Surat Jalan</div></div></div>
    <div class="noprint" style="margin-top:14px"><div class="kv"><div><span>Vendor:</span> <b>${esc(s.vendor_code ? s.vendor_code + ' · ' + s.vendor_name : '-')}</b></div><div><span>Start Loading:</span> <b>${fmtT(s.start_at)}</b></div><div><span>Finish Loading:</span> <b>${fmtT(s.finish_at)}</b></div><div><span>Load Time:</span> <b>${loadT(s.load_min)}</b></div></div>
    <b>Foto</b><div class="ph">${s.photos.map(p => `<div><img src="${photoOf(p.path)}" onclick="window.open(this.src)"></div>`).join('') || '<div>Belum ada foto</div>'}</div></div>
    <div class="acts"><button class="btn sec" onclick="closeMd()">Tutup</button><button class="btn bad" onclick="hoDelSj(${id})">Hapus</button><button class="btn sec" onclick="hoSjForm(${id})">Edit</button><button class="btn" onclick="window.print()">Print</button></div></div></div>`;
});
const hoDelSj = run(async id => { if (confirm('Hapus Surat Jalan ini? Material akan kembali tersedia.')) { await api('/ho/sj/' + id, 'DELETE'); closeMd(); route(); } });

/* ---- Code 128 (set B) ---- */
const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131'.split(' ');
function barcode(txt) {
  const v = [104, ...[...txt].map(ch => ch.charCodeAt(0) - 32)];
  v.push(v.reduce((a, x, i) => a + (i ? x * i : x), 0) % 103);
  const pat = v.map(x => C128[x]).join('') + '2331112';
  let x = 10, bars = '';
  [...pat].forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${+w}" height="50" fill="#000"/>`; x += +w; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 50" width="${Math.min(300, x * 1.4)}" height="50" preserveAspectRatio="none">${bars}</svg>`;
}
