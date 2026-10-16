/* Data Master › Customer (#customer). Kode dibuat otomatis oleh server dan tidak bisa diubah (dipakai di nomor JO). API: /api/customers. */
let cuSt = { q: '', status: '', page: 1 }, cuRows = [];
const cuStatus = c => !c.is_active ? '<span class="schip off"><i></i>Nonaktif</span>' : '<span class="schip ok"><i></i>Aktif</span>';

function customerRoute() {
  $('#ttl').textContent = 'Customer'; $('#sub').textContent = 'Data master customer. Kode dibuat otomatis dan dipakai di nomor Job Order.';
  $('#view').innerHTML = '<div id="cu-sum"></div><div id="cu-list"></div>'; cuList();
}
async function cuList() {
  const d = await api('/customers?' + new URLSearchParams(cuSt)), s = d.summary; cuRows = d.rows;
  $('#cu-sum').innerHTML = `<div class="cards">${[['Total customer', s.total, '', 's-total'], ['Aktif', s.active, 'active', 's-done'], ['Nonaktif', s.inactive, 'inactive', 's-eta'], ['Kode perlu ditinjau', s.review, 'review', 's-open']]
    .map(([l, v, f, c]) => `<div class="card stat ${c}" ${f ? clickAttr(`cuSet('status','${f}')`) : clickAttr('cuReset()')}><b>${fmtN(v)}</b><span>${l}</span></div>`).join('')}</div>`;
  $('#cu-list').innerHTML = `<div class="bar fbar"><input id="cuq" type="search" aria-label="Cari customer" placeholder="Cari kode, nama, kota, email, telepon, NPWP" value="${esc(cuSt.q)}">
    <select id="cus" aria-label="Filter status">${[['', 'Semua status'], ['active', 'Aktif'], ['inactive', 'Nonaktif'], ['review', 'Kode perlu ditinjau']].map(([v, l]) => `<option value="${v}" ${cuSt.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn sec" onclick="cuReset()">Reset</button><span style="flex:1"></span><button class="btn sec out" onclick="cuExport()">Download Excel</button><button class="btn" onclick="cuForm()">+ Tambah Customer</button></div>
    <div class="card tw"><table><tr><th>Kode</th><th>Nama</th><th>Kota</th><th>Telepon</th><th>Email</th><th>NPWP</th><th class="num">Job Order</th><th>Status</th><th>Aksi</th></tr>
    ${d.rows.map(c => `<tr class="${c.is_active ? '' : 'dim'}"><td><b class="cnum">${esc(c.code)}</b>${c.needs_code_review ? ' <span class="lgc inc" title="Kode berasal dari data lama dan belum ditinjau">Tinjau</span>' : ''}</td><td class="wrap">${esc(c.name)}</td><td>${esc(c.city || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td><td>${esc(c.tax_no || '—')}</td>
      <td class="num">${c.jo_count ? `<a href="#" onclick="cuJos(${c.id});return false" title="Lihat Job Order customer ini">${fmtN(c.jo_count)}</a>` : '0'}</td><td>${cuStatus(c)}</td><td>${rowMenu(c.code + ' ' + c.name, [{ t: 'Edit', js: `cuForm(${c.id})` }, { t: c.is_active ? 'Nonaktifkan' : 'Aktifkan', js: `cuToggle(${c.id},${!c.is_active})`, danger: c.is_active },
        { t: 'Hapus', js: `cuDelete(${c.id},'${c.name.replace(/['"]/g, '')}')`, danger: true, disabled: c.jo_count > 0, title: c.jo_count > 0 ? `Dipakai ${c.jo_count} Job Order: nonaktifkan saja` : '' }])}</td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--mut)">Tidak ada customer yang cocok.</td></tr>'}</table>
    ${pagerNum(d.page, d.pages, d.total, 'cuGoto')}</div>`;
  const q = $('#cuq'); let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { cuSt.q = q.value.trim(); cuSt.page = 1; cuList().then(() => { const n = $('#cuq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); };
  $('#cus').onchange = e => cuSet('status', e.target.value);
}
const cuSet = (k, v) => { cuSt[k] = v; cuSt.page = 1; cuList(); };
const cuReset = () => { cuSt = { q: '', status: '', page: 1 }; cuList(); };
const cuGoto = n => { cuSt.page = n; cuList(); };
const cuJos = id => { joSt = joBlank(); joSt.customer_id = String(id); joSt.from = ''; joSt.to = ''; location.hash = '#jo'; if (location.hash === '#jo') route(); };
const cuExport = run(async () => {
  const r = await raw('/customers/export?' + new URLSearchParams({ q: cuSt.q, status: cuSt.status })); if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `customer-${today()}.xlsx` }); document.body.appendChild(a); a.click(); a.remove();
});

function cuForm(id) {
  const c = id ? cuRows.find(x => x.id === id) : { code: '', name: '', city: '', phone: '', email: '', tax_no: '', address: '', is_active: true, needs_code_review: false, jo_count: 0 };
  const f = (k, label, extra = '') => `<div><label for="cf-${k}">${label}</label><input id="cf-${k}" name="${k}" value="${esc(c[k] || '')}" ${extra}><div class="ferr" id="fe-${k}" role="alert"></div></div>`;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="cuform" novalidate style="width:min(680px,100%)"><h3 style="margin-top:0">${id ? 'Edit Customer' : 'Tambah Customer'}</h3>
    <div class="g"><div><label for="cf-code">Kode customer ${id ? '(terkunci, dipakai di nomor JO)' : '(otomatis)'}</label><input id="cf-code" value="${esc(c.code)}" disabled placeholder="Dibuat saat disimpan"><div class="muted2" id="cf-hint" style="margin:3px 0 0">${id ? '' : 'Usulan kode muncul setelah nama diisi.'}</div></div>
      <div><label for="cf-active">Status</label><select id="cf-active" name="is_active" ${id ? '' : 'disabled'}><option value="1" ${c.is_active ? 'selected' : ''}>Aktif</option><option value="0" ${c.is_active ? '' : 'selected'}>Nonaktif</option></select></div>
      <div class="full">${f('name', 'Nama customer', 'required maxlength="150" autocomplete="off"')}</div>${f('city', 'Kota', 'maxlength="100"')}${f('phone', 'Telepon', 'maxlength="50" inputmode="tel"')}${f('email', 'Email', 'type="email" maxlength="150"')}${f('tax_no', 'NPWP', 'maxlength="30"')}
      <div class="full">${f('address', 'Alamat', 'maxlength="255"')}</div></div>
    ${c.needs_code_review ? '<label class="chk" style="margin-top:8px"><input type="checkbox" name="reviewed"> Kode ini berasal dari data lama (bukan 3 huruf) dan sudah saya tinjau</label>' : ''}
    ${id && c.jo_count ? `<p class="muted2">Dipakai di ${c.jo_count} Job Order: customer ini hanya bisa dinonaktifkan, tidak dihapus.</p>` : ''}
    <div class="err" role="alert"></div><div class="acts">${id && can('customer.delete') && !c.jo_count ? `<button type="button" class="btn bad" style="margin-right:auto" onclick="cuDelete(${id},'${esc(c.name).replace(/'/g, '')}')">Hapus</button>` : ''}<button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="cusave">${id ? 'Simpan' : 'Tambah Customer'}</button></div></form></div>`;
  $('#cf-name').focus();
  if (!id) { let tm; $('#cf-name').oninput = e => { clearTimeout(tm); tm = setTimeout(async () => { const n = e.target.value.trim(); if (n.length < 2) { $('#cf-code').value = ''; return; } try { const r = await api('/customers/suggest-code?name=' + encodeURIComponent(n)); $('#cf-code').value = r.code; $('#cf-hint').textContent = 'Usulan; kode final ditetapkan saat disimpan.'; } catch { /* usulan opsional */ } }, 300); }; }
  $('#cuform').onsubmit = async e => {
    e.preventDefault(); const fm = e.target;
    const b = { name: fm.name.value, city: fm.city.value, phone: fm.phone.value, email: fm.email.value, tax_no: fm.tax_no.value, address: fm.address.value };
    if (id) { b.is_active = fm.is_active.value === '1'; if (fm.reviewed?.checked) b.needs_code_review = false; }
    $('#cusave').disabled = true;
    try { const r = await api(id ? '/customers/' + id : '/customers', id ? 'PUT' : 'POST', b); closeMd(); toast(id ? 'Customer disimpan' : `Customer ditambahkan, kode ${r.code}`); cuList(); }
    catch (er) { $('#cusave').disabled = false; coaFieldErrors(er, fm); }
  };
}
const cuToggle = run(async (id, on) => { await api(`/customers/${id}/${on ? 'activate' : 'deactivate'}`, 'POST'); toast(on ? 'Customer diaktifkan' : 'Customer dinonaktifkan'); cuList(); });
const cuDelete = run(async (id, name) => { if (!confirm(`Hapus customer ${name}? Tindakan ini tidak bisa dibatalkan.`)) return; await api('/customers/' + id, 'DELETE'); closeMd(); toast('Customer dihapus'); cuList(); });
