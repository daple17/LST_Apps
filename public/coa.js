/* COA (FAT > COA): tab Account Code (#coa) dan Master General Ledger (#coa/gl). API: /api/coa. Akun tidak dihapus, hanya dinonaktifkan. */
let coaRows = [], coaSt = { q: '', jenis: '', job_type: '', status: '', page: 1 }, coaHeaders = [];
const COA_JENIS = [['ASET', 'Aset', 's-done'], ['LIABILITAS', 'Liabilitas', 's-open'], ['EKUITAS', 'Ekuitas', 's-eta'], ['REVENUE', 'Revenue', 's-mat'], ['BEBAN', 'Beban', 's-del']];
const coaHasGroup = j => j === 'REVENUE' || j === 'BEBAN';
const coaJt = a => (a.job_types.length ? a.job_types.map(c => `<span class="jtc">${esc(R().JO_TYPES.find(t => t.code === c)?.label || c)}</span>`).join('') : '<span class="muted2" style="margin:0">Semua type</span>');
const coaStatus = on => on ? '<span class="schip ok"><i></i>Aktif</span>' : '<span class="schip off"><i></i>Nonaktif</span>';

function coaRoute(rest) {
  const gl = rest[0] === 'gl';
  $('#ttl').textContent = 'COA'; $('#sub').textContent = 'Daftar akun dan pengelompokannya (Master General Ledger).';
  $('#view').innerHTML = `<div class="tabs"><a class="btn ${gl ? 'sec' : ''} sm" href="#coa" ${gl ? '' : 'aria-current="page"'}>Account Code</a><a class="btn ${gl ? '' : 'sec'} sm" href="#coa/gl" ${gl ? 'aria-current="page"' : ''}>Master General Ledger</a></div>
    <div id="coa-body"></div>`;
  return gl ? coaGl() : coaList();
}

/* ---------- tab Account Code ---------- */
async function coaList() {
  const d = await api('/coa?' + new URLSearchParams(coaSt)), s = d.summary; coaRows = d.rows;
  $('#coa-body').innerHTML = `<div class="cards"><div class="card stat s-total" ${clickAttr("coaSet('jenis','')")}><b>${fmtN(s.total)}</b><span>Total akun</span></div>
    ${COA_JENIS.map(([c, l, k]) => `<div class="card stat ${k}" ${clickAttr(`coaSet('jenis','${c}')`)}><b>${fmtN(s.per_jenis[c])}</b><span>${l}</span></div>`).join('')}</div>
    <div class="bar fbar"><input id="cq" type="search" aria-label="Cari akun" placeholder="Cari kode atau nama akun" value="${esc(coaSt.q)}">
      <select id="cj" aria-label="Filter jenis"><option value="">Semua jenis</option>${COA_JENIS.map(([c, l]) => `<option value="${c}" ${coaSt.jenis === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="cjt" aria-label="Filter type Job Order"><option value="">Semua type JO</option>${R().JO_TYPES.map(t => `<option value="${t.code}" ${coaSt.job_type === t.code ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      <select id="cs" aria-label="Filter status">${[['', 'Semua status'], ['active', 'Aktif'], ['inactive', 'Nonaktif']].map(([v, l]) => `<option value="${v}" ${coaSt.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sec" onclick="coaReset()">Reset</button><span style="flex:1"></span>
      <button class="btn sec out" onclick="coaExport()">Download Excel</button><button class="btn" onclick="coaForm()">+ Tambah COA</button></div>
    <div class="card tw"><table><tr><th>Code</th><th>Account Name</th><th>Jenis</th><th>Sub Header</th><th>Group Account</th><th>Type JO</th><th>Status</th><th>Aksi</th></tr>
    ${d.rows.map(a => `<tr class="${a.is_active ? '' : 'dim'}"><td><b class="cnum">${a.code}</b></td><td class="wrap">${esc(a.name)}</td><td>${esc(a.jenis_label)}</td><td>${esc(a.sub_header)}</td><td>${esc(a.group_account || '—')}</td><td class="jtcell">${coaJt(a)}</td><td>${coaStatus(a.is_active)}</td>
      <td><button class="btn sec sm" onclick="coaForm(${a.id})">Edit</button></td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--mut)">Tidak ada akun yang cocok.</td></tr>'}</table>
    ${pagerNum(d.page, d.pages, d.total, 'coaGoto')}</div>`;
  const q = $('#cq'); let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { coaSt.q = q.value.trim(); coaSt.page = 1; coaList().then(() => { const n = $('#cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); };
  $('#cj').onchange = e => coaSet('jenis', e.target.value); $('#cjt').onchange = e => coaSet('job_type', e.target.value); $('#cs').onchange = e => coaSet('status', e.target.value);
}
const coaSet = (k, v) => { coaSt[k] = v; coaSt.page = 1; coaList(); };
const coaReset = () => { coaSt = { q: '', jenis: '', job_type: '', status: '', page: 1 }; coaList(); };
const coaGoto = n => { coaSt.page = n; coaList(); };
const coaExport = run(async () => {
  const r = await raw('/coa/export?' + new URLSearchParams({ ...coaSt, page: '' }));
  if (!r.ok) throw new Error('Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `coa-${today()}.xlsx` });
  document.body.appendChild(a); a.click(); a.remove();
});

// satu pilihan "Kelompok": optgroup per jenis, opsi "Sub Header › Group Account"; kelompok nonaktif hanya muncul bila sedang dipakai akun ini
const coaGroupOptions = (selected) => COA_JENIS.map(([c, l]) => {
  const hs = coaHeaders.filter(h => h.jenis === c && (h.is_active || h.id === selected));
  return hs.length ? `<optgroup label="${l}">${hs.map(h => `<option value="${h.id}" ${h.id === selected ? 'selected' : ''}>${esc(h.label)}${h.is_active ? '' : ' (nonaktif)'}</option>`).join('')}</optgroup>` : '';
}).join('');
function coaFieldErrors(er, form) {
  form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid')); form.querySelectorAll('.ferr').forEach(x => (x.textContent = ''));
  const fe = er.fields || {};
  Object.entries(fe).forEach(([k, m]) => { const t = form.querySelector('#fe-' + k); if (t) t.textContent = m; form.querySelector(`[name="${k}"]`)?.setAttribute('aria-invalid', 'true'); });
  form.querySelector('.err').textContent = Object.keys(fe).length ? '' : er.message;
  form.querySelector('[aria-invalid]')?.focus();
}
async function coaForm(id) {
  coaHeaders = await api('/coa/headers');
  const a = id ? coaRows.find(x => x.id === id) : { code: '', name: '', header_id: 0, is_active: true, job_types: [] };
  $('#md').innerHTML = `<div class="modal"><form class="card" id="cform" novalidate style="width:min(620px,100%)"><h3 style="margin-top:0">${id ? 'Edit COA' : 'Tambah COA'}</h3>
    <div class="g"><div><label for="cf-code">Code ${id ? '(terkunci, dipakai transaksi)' : '(5 angka)'}</label><input id="cf-code" name="code" value="${esc(a.code)}" inputmode="numeric" maxlength="5" autocomplete="off" ${id ? 'disabled' : 'required'}><div class="ferr" id="fe-code" role="alert"></div></div>
      <div><label for="cf-active">Status</label><select id="cf-active" name="is_active" ${id ? '' : 'disabled'}><option value="1" ${a.is_active ? 'selected' : ''}>Aktif</option><option value="0" ${a.is_active ? '' : 'selected'}>Nonaktif</option></select><div class="ferr" id="fe-is_active" role="alert"></div></div>
      <div class="full"><label for="cf-name">Account Name</label><input id="cf-name" name="name" value="${esc(a.name)}" maxlength="150" required autocomplete="off"><div class="ferr" id="fe-name" role="alert"></div></div>
      <div class="full"><label for="cf-header">Kelompok (Sub Header › Group Account)</label><select id="cf-header" name="header_id" required><option value="">Pilih kelompok…</option>${coaGroupOptions(a.header_id)}</select><div class="ferr" id="fe-header_id" role="alert"></div></div>
      <fieldset class="full cijt"><legend>Type Job Order (opsional)</legend>${R().JO_TYPES.map(t => `<label class="chk"><input type="checkbox" name="jt" value="${t.code}" ${(a.job_types || []).includes(t.code) ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}
        <p class="muted2" style="margin:4px 0 0;flex-basis:100%">Pilih type JO tempat akun ini dipakai (boleh lebih dari satu). Kosongkan = berlaku untuk semua type, mis. akun neraca.</p><div class="ferr" id="fe-job_types" role="alert"></div></fieldset></div>
    <p class="muted2">Akun tidak dihapus, hanya dinonaktifkan. Kelompok dikelola di tab Master General Ledger.</p>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="csave">${id ? 'Simpan' : 'Tambah COA'}</button></div></form></div>`;
  $(id ? '#cf-name' : '#cf-code').focus();
  $('#cform').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = { name: f.name.value, header_id: +f.header_id.value || null, job_types: [...f.querySelectorAll('input[name=jt]:checked')].map(x => x.value) };
    if (id) b.is_active = f.is_active.value === '1'; else b.code = f.code.value.trim();
    $('#csave').disabled = true;
    try { await api(id ? '/coa/' + id : '/coa', id ? 'PUT' : 'POST', b); closeMd(); toast(id ? 'Akun disimpan' : 'Akun ditambahkan'); coaRoute(['']); }
    catch (er) { $('#csave').disabled = false; coaFieldErrors(er, f); }
  };
}
/* ---------- tab Master General Ledger ---------- */
async function coaGl() {
  coaHeaders = await api('/coa/headers');
  $('#coa-body').innerHTML = `<div class="bar fbar"><span class="muted2" style="margin:0">Pengelompokan akun. Aset, Liabilitas, dan Ekuitas hanya sampai Sub Header.</span><span style="flex:1"></span><button class="btn" onclick="coaGroupForm()">+ Tambah Kelompok</button></div>
    ${COA_JENIS.map(([c, l]) => {
      const hs = coaHeaders.filter(h => h.jenis === c), g = coaHasGroup(c);
      return `<section class="card tw glcard" aria-label="${l}"><h3 class="glh">${l} <span class="hc-n">${hs.length}</span></h3><table><tr><th>Sub Header</th>${g ? '<th>Group Account</th>' : ''}<th class="num">Akun aktif / total</th><th>Status</th><th>Aksi</th></tr>
        ${hs.map(h => `<tr class="${h.is_active ? '' : 'dim'}"><td>${esc(h.sub_header)}</td>${g ? `<td>${esc(h.group_account)}</td>` : ''}<td class="num">${h.active_accounts} / ${h.accounts}</td><td>${coaStatus(h.is_active)}</td><td><button class="btn sec sm" onclick="coaGroupForm(${h.id})">Edit</button></td></tr>`).join('')
          || `<tr><td colspan="${g ? 5 : 4}" style="text-align:center;color:var(--mut)">Belum ada kelompok.</td></tr>`}</table></section>`;
    }).join('')}`;
}
function coaGroupForm(id) {
  const h = id ? coaHeaders.find(x => x.id === id) : { jenis: 'REVENUE', sub_header: '', group_account: '', is_active: true };
  $('#md').innerHTML = `<div class="modal"><form class="card" id="gform" novalidate style="width:min(560px,100%)"><h3 style="margin-top:0">${id ? 'Edit Kelompok' : 'Tambah Kelompok'}</h3>
    <div class="g"><div><label for="gf-jenis">Jenis Account ${id ? '(terkunci)' : ''}</label><select id="gf-jenis" name="jenis" onchange="coaGroupJenis()" ${id ? 'disabled' : ''}>${COA_JENIS.map(([c, l]) => `<option value="${c}" ${h.jenis === c ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="ferr" id="fe-jenis" role="alert"></div></div>
      <div><label for="gf-active">Status</label><select id="gf-active" name="is_active" ${id ? '' : 'disabled'}><option value="1" ${h.is_active ? 'selected' : ''}>Aktif</option><option value="0" ${h.is_active ? '' : 'selected'}>Nonaktif</option></select><div class="ferr" id="fe-is_active" role="alert"></div></div>
      <div class="full"><label for="gf-sub">Sub Header</label><input id="gf-sub" name="sub_header" value="${esc(h.sub_header)}" maxlength="80" required autocomplete="off"><div class="ferr" id="fe-sub_header" role="alert"></div></div>
      <div class="full" id="gf-grp-wrap"><label for="gf-grp">Group Account</label><input id="gf-grp" name="group_account" value="${esc(h.group_account)}" maxlength="80" autocomplete="off"><div class="ferr" id="fe-group_account" role="alert"></div></div></div>
    <p class="muted2">${id ? `Berisi ${h.accounts} akun (${h.active_accounts} aktif). Kelompok tidak bisa dinonaktifkan selama masih berisi akun aktif.` : 'Kelompok baru bisa dipilih saat menambah atau mengedit akun.'}</p>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="gsave">Simpan</button></div></form></div>`;
  coaGroupJenis(); $('#gf-sub').focus();
  $('#gform').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = { sub_header: f.sub_header.value, group_account: f.group_account.value };
    if (id) b.is_active = f.is_active.value === '1'; else b.jenis = f.jenis.value;
    $('#gsave').disabled = true;
    try { await api(id ? '/coa/headers/' + id : '/coa/headers', id ? 'PUT' : 'POST', b); closeMd(); toast('Kelompok disimpan'); coaGl(); }
    catch (er) { $('#gsave').disabled = false; coaFieldErrors(er, f); }
  };
}
// Group Account hanya untuk Revenue dan Beban
const coaGroupJenis = () => { $('#gf-grp-wrap').hidden = !coaHasGroup($('#gf-jenis').value); };
