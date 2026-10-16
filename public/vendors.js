/* Data Master › Vendor (#vendor). Kode dibuat otomatis oleh server dan tidak bisa diubah (tampil di surat jalan). API: /api/vendors. Kolom aksi: lihat docs/ui-aksi.md. */
let vnSt = { q: '', status: '', page: 1 }, vnRows = [], vnCountries = null;
const vnStatus = c => !c.is_active ? '<span class="schip off"><i></i>Nonaktif</span>' : '<span class="schip ok"><i></i>Aktif</span>';

function vendorRoute() {
  $('#ttl').textContent = 'Vendor'; $('#sub').textContent = 'Data master vendor (trucking dan mitra). Kode dibuat otomatis dan tampil di surat jalan.';
  $('#view').innerHTML = '<div id="vn-sum"></div><div id="vn-list"></div>'; vnList();
}
async function vnList() {
  const d = await api('/vendors?' + new URLSearchParams(vnSt)), s = d.summary; vnRows = d.rows;
  const on = f => (f ? vnSt.status === f : !vnSt.status);       // kartu terpilih = biru
  $('#vn-sum').innerHTML = `<div class="cards">${[['Total vendor', s.total, '', 's-total'], ['Aktif', s.active, 'active', 's-done'], ['Nonaktif', s.inactive, 'inactive', 's-eta'], ['Kode perlu ditinjau', s.review, 'review', 's-open']]
    .map(([l, v, f, c]) => `<div class="card stat ${c}${on(f) ? ' on' : ''}" aria-pressed="${on(f)}" ${f ? clickAttr(`vnSet('status','${vnSt.status === f ? '' : f}')`) : clickAttr('vnReset()')}><b>${fmtN(v)}</b><span>${l}</span></div>`).join('')}</div>`;
  $('#vn-list').innerHTML = `<div class="bar fbar"><input id="vnq" type="search" aria-label="Cari vendor" placeholder="Cari kode, nama, kota, negara, PIC, NPWP" value="${esc(vnSt.q)}">
    <select id="vns" aria-label="Filter status">${[['', 'Semua status'], ['active', 'Aktif'], ['inactive', 'Nonaktif'], ['review', 'Kode perlu ditinjau']].map(([v, l]) => `<option value="${v}" ${vnSt.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn sec" onclick="vnReset()">Reset</button><span style="flex:1"></span><button class="btn sec out" onclick="vnExport()">Download Excel</button><button class="btn" onclick="vnForm()">+ Tambah Vendor</button></div>
    <div class="card tw"><table><tr><th>Kode</th><th>Nama</th><th>Kota</th><th>Negara</th><th>PIC</th><th>NPWP</th><th class="num">Kota Tarif</th><th class="num">Surat Jalan</th><th>Status</th><th>Aksi</th></tr>
    ${d.rows.map(c => `<tr class="${c.is_active ? '' : 'dim'}"><td><b class="cnum">${esc(c.code)}</b>${c.needs_code_review ? ' <span class="lgc inc" title="Kode dibuat otomatis saat migrasi (kode lama kosong, ganda, atau tidak bermakna)">Tinjau</span>' : ''}</td><td class="wrap">${esc(c.name)}</td><td>${esc(c.city || '—')}</td><td>${esc(c.country_name || '—')}</td><td>${esc(c.pic || '—')}</td><td>${esc(c.npwp || '—')}</td>
      <td class="num">${fmtN(c.rate_count)}</td><td class="num">${fmtN(c.sj_count)}</td><td>${vnStatus(c)}</td><td>${rowMenu(c.code + ' ' + c.name, [{ t: 'Edit', js: `vnForm(${c.id})` }, { t: c.is_active ? 'Nonaktifkan' : 'Aktifkan', js: `vnToggle(${c.id},${!c.is_active})`, danger: c.is_active },
        { t: 'Hapus', js: `vnDelete(${c.id},'${c.name.replace(/['"]/g, '')}')`, danger: true, disabled: c.sj_count > 0, title: c.sj_count > 0 ? `Dipakai ${c.sj_count} surat jalan: nonaktifkan saja` : '' }])}</td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--mut)">Tidak ada vendor yang cocok.</td></tr>'}</table>
    ${pagerNum(d.page, d.pages, d.total, 'vnGoto')}</div>`;
  const q = $('#vnq'); let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { vnSt.q = q.value.trim(); vnSt.page = 1; vnList().then(() => { const n = $('#vnq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); };
  $('#vns').onchange = e => vnSet('status', e.target.value);
}
const vnSet = (k, v) => { vnSt[k] = v; vnSt.page = 1; vnList(); };
const vnReset = () => { vnSt = { q: '', status: '', page: 1 }; vnList(); };
const vnGoto = n => { vnSt.page = n; vnList(); };
const vnToggle = run(async (id, on) => { await api(`/vendors/${id}/${on ? 'activate' : 'deactivate'}`, 'POST'); toast(on ? 'Vendor diaktifkan' : 'Vendor dinonaktifkan'); vnList(); });
const vnExport = run(async () => {
  const r = await raw('/vendors/export?' + new URLSearchParams({ q: vnSt.q, status: vnSt.status })); if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `vendor-${today()}.xlsx` }); document.body.appendChild(a); a.click(); a.remove();
});

async function vnForm(id) {
  vnCountries ||= await api('/vendors/countries');
  const c = id ? await api('/vendors/' + id) : { code: '', name: '', city: '', pic: '', npwp: '', country_id: vnCountries.find(x => x.name === 'Indonesia')?.id || '', is_active: true, needs_code_review: false, sj_count: 0, rates: [], price_ton: '', price_trip: '' };
  const f = (k, label, extra = '') => `<div><label for="vf-${k}">${label}</label><input id="vf-${k}" name="${k}" value="${esc(c[k] || '')}" ${extra}><div class="ferr" id="fe-${k}" role="alert"></div></div>`;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="vnform" novalidate style="width:min(680px,100%)"><h3 style="margin-top:0">${id ? 'Edit Vendor' : 'Tambah Vendor'}</h3>
    <div class="g"><div><label for="vf-code">Kode vendor ${id ? '(terkunci, tampil di surat jalan)' : '(otomatis)'}</label><input id="vf-code" value="${esc(c.code)}" disabled placeholder="Dibuat saat disimpan"><div class="muted2" id="vf-hint" style="margin:3px 0 0">${id ? '' : 'Usulan kode muncul setelah nama diisi.'}</div></div>
      <div><label for="vf-active">Status</label><select id="vf-active" name="is_active" ${id ? '' : 'disabled'}><option value="1" ${c.is_active ? 'selected' : ''}>Aktif</option><option value="0" ${c.is_active ? '' : 'selected'}>Nonaktif</option></select></div>
      <div class="full">${f('name', 'Nama vendor', 'required maxlength="150" autocomplete="off"')}</div>${f('city', 'Kota', 'maxlength="100"')}
      <div><label for="vf-country">Negara</label><select id="vf-country" name="country_id"><option value="">—</option>${vnCountries.map(x => `<option value="${x.id}" ${+c.country_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><div class="ferr" id="fe-country_id" role="alert"></div></div>
      ${f('pic', 'PIC', 'maxlength="80"')}${f('npwp', 'NPWP', 'maxlength="30"')}</div>
    <h4 style="margin:14px 0 4px">Tarif</h4><p class="muted2" style="margin:0 0 6px">Biaya di PO dihitung: tarif kota + tarif tonase + tarif ritase. Di sini hanya input tarif; isi 0 bila tidak ada.</p>
    <div class="g">${f('price_ton', 'Tarif tonase (Rp per ton)', 'inputmode="decimal"').replace('value="0"', 'value=""')}${f('price_trip', 'Tarif ritase (Rp per ritase)', 'inputmode="decimal"').replace('value="0"', 'value=""')}</div>
    <h4 style="margin:10px 0 4px">Tarif kota</h4>
    <div class="tw"><table id="vr-tbl"><tr><th>Kota</th><th class="num">Tarif kota (Rp)</th><th></th></tr></table></div>
    <div class="ferr" id="fe-rates" role="alert"></div><button type="button" class="btn sec" id="vr-add" style="margin-top:6px">+ Tambah kota</button>
    ${c.needs_code_review ? '<label class="chk" style="margin-top:8px"><input type="checkbox" name="reviewed"> Kode ini dibuat otomatis saat migrasi dan sudah saya tinjau</label>' : ''}
    ${id && c.sj_count ? `<p class="muted2">Dipakai di ${c.sj_count} surat jalan: vendor ini hanya bisa dinonaktifkan, tidak dihapus.</p>` : ''}
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="vnsave">${id ? 'Simpan' : 'Tambah Vendor'}</button></div></form></div>`;
  const rrow = (r = {}) => { const tr = document.createElement('tr'), n = (k, ph) => `<td><input data-k="${k}" ${k === 'city' ? 'maxlength="100" aria-label="Kota"' : `inputmode="decimal" class="num" aria-label="${ph}"`} value="${esc(r[k] ?? '')}"></td>`;
    tr.innerHTML = n('city') + n('price_city', 'Tarif kota') + '<td><button type="button" class="btn sec" aria-label="Hapus baris">×</button></td>'; tr.querySelector('button').onclick = () => tr.remove(); $('#vr-tbl').appendChild(tr); return tr; };
  (c.rates || []).forEach(rrow); $('#vr-add').onclick = () => rrow().querySelector('input').focus();
  const num = v => { v = v.trim(); return /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v) || v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v; };
  $('#vf-name').focus();
  if (!id) { let tm; $('#vf-name').oninput = e => { clearTimeout(tm); tm = setTimeout(async () => { const n = e.target.value.trim(); if (n.length < 2) { $('#vf-code').value = ''; return; } try { const r = await api('/vendors/suggest-code?name=' + encodeURIComponent(n)); $('#vf-code').value = r.code; $('#vf-hint').textContent = 'Usulan; kode final ditetapkan saat disimpan.'; } catch { /* usulan opsional */ } }, 300); }; }
  $('#vnform').onsubmit = async e => {
    e.preventDefault(); const fm = e.target;
    const b = { name: fm.name.value, city: fm.city.value, country_id: fm.country_id.value || null, price_ton: num(fm.price_ton.value), price_trip: num(fm.price_trip.value), pic: fm.pic.value, npwp: fm.npwp.value };
    b.rates = [...$('#vr-tbl').querySelectorAll('tr')].slice(1).map(tr => Object.fromEntries([...tr.querySelectorAll('input')].map(i => [i.dataset.k, i.dataset.k === 'city' ? i.value : num(i.value)])));
    if (id) { b.is_active = fm.is_active.value === '1'; if (fm.reviewed?.checked) b.needs_code_review = false; }
    $('#vnsave').disabled = true;
    try { const r = await api(id ? '/vendors/' + id : '/vendors', id ? 'PUT' : 'POST', b); closeMd(); toast(id ? 'Vendor disimpan' : `Vendor ditambahkan, kode ${r.code}`); vnList(); }
    catch (er) { $('#vnsave').disabled = false; const rf = Object.entries(er.fields || {}).filter(([k]) => k.startsWith('rates')); coaFieldErrors(rf.length ? { ...er, fields: Object.fromEntries(Object.entries(er.fields).filter(([k]) => !k.startsWith('rates'))), message: '' } : er, fm); $('#fe-rates').textContent = rf.map(([k, m]) => { const i = /rates\.(\d+)\./.exec(k); return (i ? `Baris ${+i[1] + 1}: ` : '') + m; }).join(' · '); }
  };
}
const vnDelete = run(async (id, name) => { if (!confirm(`Hapus vendor ${name}? Tindakan ini tidak bisa dibatalkan.`)) return; await api('/vendors/' + id, 'DELETE'); toast('Vendor dihapus'); vnList(); });

