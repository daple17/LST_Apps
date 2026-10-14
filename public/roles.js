/* Role Management (#roles): tab role, level akses per modul (Tanpa/Lihat/Kelola/Penuh), detail aksi. API: /api/roles. */
let roleSel = null, roleList = [], roleCur = null, roleDraft = null, roleOpen = null, roleQ = '', rolePop = false, rolePopQ = '';
const LOCK = '<svg class="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const MAXTABS = 6;

// aksi yang masuk tiap level untuk sebuah modul (sama dengan lib/permissions.js)
const lvActions = (m, l) => l === 'none' ? [] : l === 'view' ? m.actions.filter(a => a === 'view') : l === 'manage' ? m.actions.filter(a => ['view', 'create', 'update', 'export'].includes(a)) : [...m.actions];
const lvOptions = m => { const seen = new Set(); return ['none', 'view', 'manage', 'full'].filter(l => { const k = lvActions(m, l).join(); if (seen.has(k)) return false; seen.add(k); return true; }); };
const modPerms = (m, set) => m.actions.filter(a => set.has(`${m.key}.${a}`));
const canEditRole = () => can('role.update') && roleCur && !roleCur.is_system;

async function rolesRoute() {
  $('#ttl').textContent = 'Role Management'; $('#sub').textContent = 'Atur menu yang terlihat dan aksi yang boleh dilakukan setiap role.';
  $('#view').innerHTML = '<div id="rv"><div class="skel" aria-hidden="true"></div><div class="skel s2" aria-hidden="true"></div></div>';
  roleList = await api('/roles');
  const want = roleSel && roleList.find(r => r.id === roleSel) ? roleSel : roleList[0]?.id;
  roleSel = null; roleOpen = null; roleQ = ''; rolePop = false;
  await roleLoad(want, true);
}
const roleDirty = () => roleDraft && roleCur && (roleDraft.name !== roleCur.name || roleDraft.description !== roleCur.description || [...roleDraft.perms].sort().join() !== [...roleCur.permissions].sort().join());
async function roleLoad(id, force = false) {
  if (!force && roleDirty() && !confirm('Ada perubahan yang belum disimpan. Tinggalkan tanpa menyimpan?')) return;
  roleCur = await api('/roles/' + id); roleSel = id; roleDraft = { name: roleCur.name, description: roleCur.description, perms: new Set(roleCur.permissions) }; roleOpen = null; rolePop = false;
  roleRender();
}
function roleTabs() {
  let vis = roleList.slice(0, MAXTABS);
  if (!vis.some(r => r.id === roleSel)) { const s = roleList.find(r => r.id === roleSel); if (s) vis = [...vis.slice(0, MAXTABS - 1), s]; }
  const rest = roleList.filter(r => !vis.includes(r));
  const tab = r => `<button type="button" class="btn ${r.id === roleSel ? '' : 'sec'} sm rtab" ${r.id === roleSel ? 'aria-current="true"' : ''} onclick="roleLoad(${r.id})">${r.is_system ? LOCK : ''}${esc(r.name)} <span class="rn">· ${r.users}</span></button>`;
  const pq = rolePopQ.toLowerCase(), hits = rest.filter(r => r.name.toLowerCase().includes(pq));
  return `<div class="rtabs">${vis.map(tab).join('')}${rest.length ? `<span class="rmore"><button type="button" class="btn sec sm" aria-haspopup="true" aria-expanded="${rolePop}" onclick="rolePopToggle(event)">+ ${rest.length} lainnya ▾</button>
      ${rolePop ? `<div class="rpop" onclick="event.stopPropagation()"><input id="rpq" type="search" aria-label="Cari role" placeholder="Cari role" value="${esc(rolePopQ)}" oninput="rolePopSearch(this.value)">
        <div>${hits.map(r => `<button type="button" onclick="roleLoad(${r.id})">${esc(r.name)} <span>${r.users} user</span></button>`).join('') || '<p class="muted2">Tidak ada.</p>'}</div></div>` : ''}</span>` : ''}</div>`;
}
const rolePopToggle = e => { e.stopPropagation(); rolePop = !rolePop; rolePopQ = ''; $('#rtabs').innerHTML = roleTabs(); if (rolePop) $('#rpq')?.focus(); };
const rolePopSearch = v => { rolePopQ = v; $('#rtabs').innerHTML = roleTabs(); const i = $('#rpq'); i.focus(); i.setSelectionRange(v.length, v.length); };
document.addEventListener('click', () => { if (rolePop) { rolePop = false; const t = $('#rtabs'); if (t) t.innerHTML = roleTabs(); } });

function roleRender() {
  if (!roleCur) return;
  const ro = !canEditRole(), P = look.permissions, activeN = new Set([...roleDraft.perms].map(p => p.split('.')[0])).size;
  $('#rv').innerHTML = `<div class="rtop"><div id="rtabs" style="flex:1;min-width:0">${roleTabs()}</div>${can('role.create') ? '<button class="btn" onclick="roleNew()">+ Role baru</button>' : ''}</div>
    <section class="card rpanel" aria-label="Role ${esc(roleCur.name)}"><div class="rhead"><div class="rhl">
      <label class="sr" for="rname">Nama role</label><input id="rname" class="rname" value="${esc(roleDraft.name)}" maxlength="60" ${ro ? 'disabled' : ''} oninput="roleDraft.name=this.value;roleBar()">
      <label class="sr" for="rdesc">Deskripsi</label><input id="rdesc" class="rdesc" value="${esc(roleDraft.description)}" maxlength="255" placeholder="Deskripsi singkat role" ${ro ? 'disabled' : ''} oninput="roleDraft.description=this.value;roleBar()"><div class="ferr" id="rerr" role="alert"></div></div>
      <div class="rhr"><div class="rchips"><span class="rc">${roleCur.users} user</span><span class="rc b"><i></i><span id="ractive">${activeN}</span> modul aktif</span></div>
        <label class="sr" for="rscope">Cakupan data</label><select id="rscope" disabled><option>Semua data</option></select><small class="muted2">Cakupan data belum berpengaruh; saat ini semua data.</small>
        <div class="racts">${can('role.create') ? '<button type="button" class="btn sec sm" onclick="roleDup()">Duplikat</button>' : ''}${can('role.delete') && !roleCur.is_system ? `<button type="button" class="btn sec sm" ${roleCur.users ? `disabled title="Dipakai ${roleCur.users} user"` : ''} onclick="roleDel()">Hapus</button>` : ''}</div></div></div>
      ${roleCur.is_system ? '<p class="muted2 rsys">' + LOCK + ' Role sistem: memegang semua izin dan tidak bisa diubah.</p>' : ''}
      <div class="rsearch"><label class="sr" for="rq">Cari modul</label><input id="rq" type="search" placeholder="Cari modul" value="${esc(roleQ)}" oninput="roleQ=this.value;roleMods()">
        <p class="legend"><b>Tanpa</b> tidak muncul · <b>Lihat</b> baca saja · <b>Kelola</b> lihat, tambah, ubah, ekspor · <b>Penuh</b> semua aksi</p></div>
      <div id="rmods">${roleModsHtml()}</div>
      <div class="rbar" id="rbar"></div></section>`;
  roleBar();
}
function roleModsHtml() {
  const P = look.permissions, ro = !canEditRole(), q = roleQ.trim().toLowerCase(), set = roleDraft.perms;
  return P.GROUPS.map(g => {
    const mods = P.MODULES.filter(m => m.group === g), shown = mods.filter(m => !q || m.label.toLowerCase().includes(q));
    if (!shown.length) return '';
    const on = mods.filter(m => modPerms(m, set).length).length;
    return `<div class="rgrp"><div class="rgh"><h4>${esc(g)}</h4><span>${on} dari ${mods.length} aktif</span></div>${shown.map(m => {
      const have = modPerms(m, set), lv = levelOfPerms(m.key, set), open = roleOpen === m.key;
      return `<div class="rmod ${have.length ? '' : 'off'}"><div class="rrow2"><div class="rml"><b>${esc(m.label)}</b>${m.available ? '' : ' <span class="soon">segera</span>'}${lv === 'custom' ? ' <span class="kst">kustom</span>' : ''}
        <small>${have.length ? have.map(a => P.ACTION_LABEL[a]).join(' · ') : 'Tidak punya akses'}</small></div>
        <div class="rctl"><div class="lvl" role="radiogroup" aria-label="Level akses ${esc(m.label)}">${lvOptions(m).map(l => `<button type="button" role="radio" aria-checked="${lv === l}" class="${lv === l ? 'on' : ''}" ${ro ? 'disabled' : ''} onclick="roleLevel('${m.key}','${l}')">${{ none: 'Tanpa', view: 'Lihat', manage: 'Kelola', full: 'Penuh' }[l]}</button>`).join('')}</div>
          <button type="button" class="ib" aria-expanded="${open}" aria-label="Atur aksi ${esc(m.label)}" onclick="roleToggleOpen('${m.key}')">${open ? '▴' : '▾'}</button></div></div>
        ${open ? `<div class="rdet"><span>Atur aksi</span>${m.actions.map(a => `<button type="button" class="pillb ${set.has(m.key + '.' + a) ? 'on' : ''}" aria-pressed="${set.has(m.key + '.' + a)}" ${ro ? 'disabled' : ''} onclick="roleAction('${m.key}','${a}')">${set.has(m.key + '.' + a) ? '✓ ' : ''}${P.ACTION_LABEL[a]}</button>`).join('')}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }).join('') || '<p class="muted2" style="padding:12px 0">Tidak ada modul yang cocok.</p>';
}
const roleMods = () => { $('#rmods').innerHTML = roleModsHtml(); };
function roleChanged() {
  const P = look.permissions, saved = new Set(roleCur.permissions); let n = 0;
  for (const m of P.MODULES) if (modPerms(m, roleDraft.perms).join() !== modPerms(m, saved).join()) n++;
  return n;
}
function roleBar() {
  const bar = $('#rbar'); if (!bar) return;
  const n = roleChanged(), meta = roleDraft.name !== roleCur.name || roleDraft.description !== roleCur.description, dirty = roleDirty(), ro = !canEditRole();
  $('#ractive').textContent = new Set([...roleDraft.perms].map(p => p.split('.')[0])).size;
  bar.innerHTML = `<span class="rdot ${dirty ? 'dirty' : 'clean'}"></span><b>${dirty ? [n ? `${n} modul diubah` : '', meta ? 'nama/deskripsi diubah' : ''].filter(Boolean).join(', ') + ', belum disimpan' : 'Tidak ada perubahan'}</b>
    <span class="rnote">Berlaku di permintaan berikutnya. Tercatat di log audit.</span>${ro ? '' : `<button type="button" class="btn sec" ${dirty ? '' : 'disabled'} onclick="roleReset()">Batalkan</button><button type="button" class="btn" ${dirty ? '' : 'disabled'} onclick="roleSave()">Simpan</button>`}`;
}
function roleSetMod(key, actions) {
  const m = look.permissions.MODULES.find(x => x.key === key);
  m.actions.forEach(a => roleDraft.perms.delete(`${key}.${a}`)); actions.forEach(a => roleDraft.perms.add(`${key}.${a}`));
  roleMods(); roleBar();
}
const roleLevel = (key, l) => roleSetMod(key, lvActions(look.permissions.MODULES.find(x => x.key === key), l));
function roleAction(key, a) {
  const m = look.permissions.MODULES.find(x => x.key === key), have = new Set(modPerms(m, roleDraft.perms)), code = `${key}.${a}`;
  if (have.has(a)) { have.delete(a); if (a === 'view') have.clear(); }
  else { have.add(a); if (m.actions.includes('view')) have.add('view'); }   // aksi selain Lihat otomatis menyertakan Lihat
  roleSetMod(key, [...have]);
}
const roleToggleOpen = key => { roleOpen = roleOpen === key ? null : key; roleMods(); };
const roleReset = () => { roleDraft = { name: roleCur.name, description: roleCur.description, perms: new Set(roleCur.permissions) }; roleRender(); };
const roleSave = run(async () => {
  $('#rerr').textContent = '';
  try {
    await api('/roles/' + roleCur.id, 'PUT', { name: roleDraft.name, description: roleDraft.description, permissions: [...roleDraft.perms] });
  } catch (e) { if (e.fields?.name) { $('#rerr').textContent = e.fields.name; $('#rname').setAttribute('aria-invalid', 'true'); return; } throw e; }
  roleList = await api('/roles'); await roleLoad(roleCur.id, true); toast('Role disimpan');
});
function roleNew() {
  $('#md').innerHTML = `<div class="modal"><form class="card" id="rnf" novalidate style="max-width:460px"><h3 style="margin-top:0">Role baru</h3>
    <div><label for="rn1">Nama role</label><input id="rn1" required maxlength="60" autocomplete="off"></div><div style="margin-top:10px"><label for="rn2">Deskripsi (opsional)</label><input id="rn2" maxlength="255"></div>
    <p class="muted2">Role baru dimulai tanpa akses. Atur modulnya setelah dibuat.</p><div class="err" id="rne" role="alert"></div>
    <div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn">Buat role</button></div></form></div>`;
  $('#rn1').focus();
  $('#rnf').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('/roles', 'POST', { name: $('#rn1').value, description: $('#rn2').value, permissions: [] }); closeMd(); roleList = await api('/roles'); await roleLoad(r.id, true); toast('Role dibuat'); }
    catch (er) { $('#rne').textContent = er.message; }
  };
}
const roleDup = run(async () => { if (roleDirty() && !confirm('Perubahan yang belum disimpan tidak ikut terduplikasi. Lanjutkan?')) return; const r = await api(`/roles/${roleCur.id}/duplicate`, 'POST'); roleList = await api('/roles'); await roleLoad(r.id, true); toast('Role diduplikasi'); });
const roleDel = run(async () => {
  if (!confirm(`Hapus role ${roleCur.name}? Tindakan ini tidak bisa dibatalkan.`)) return;
  await api('/roles/' + roleCur.id, 'DELETE'); roleList = await api('/roles'); await roleLoad(roleList[0].id, true); toast('Role dihapus');
});
