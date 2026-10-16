/* User Management (#users) + akun saya (ganti password). API: /api/users, /api/me. Aturan dijaga di server; di sini hanya tampilan. */
let usrSt = { q: '', role_id: '', status: '', page: 1 }, usrRoles = [];
const isSuper = () => me?.role?.is_system && me.role.name === 'Super Admin';
const AVC2 = ['#06203b', '#1b6aa5', '#3a86b8', '#fb940c', '#157a3f', '#7c5cc4'];
const uAv = n => `<span class="uav" style="background:${AVC2[[...(n || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC2.length]}" aria-hidden="true">${esc((n || '?').trim().charAt(0).toUpperCase())}</span>`;
const LVL_LABEL = { none: 'Tanpa akses', view: 'Lihat', manage: 'Kelola', full: 'Penuh', custom: 'Kustom' };

// "Hari ini 15:10" / "Kemarin 16:20" / "30 Sep 2026" (WIB)
function lastLogin(s) {
  if (!s) return 'Belum pernah';
  const d = new Date(s.replace(' ', 'T') + 'Z'), day = IdFmt.jktDay(d), t = IdFmt.jktDay(new Date()), y = IdFmt.jktDay(new Date(Date.now() - 864e5));
  const hm = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  return day === t ? `Hari ini ${hm}` : day === y ? `Kemarin ${hm}` : IdFmt.shortDate(day);
}
const roleChip = u => `<span class="rchip ${u.role_system ? 'sys' : ''}">${u.role_system ? '<i></i>' : ''}${esc(u.role_name || 'Tanpa role')}</span>`;
const statusChip = u => !u.is_active ? '<span class="schip off"><i></i>Nonaktif</span>' : u.last_login_at ? '<span class="schip ok"><i></i>Aktif</span>' : '<span class="schip wait"><i></i>Menunggu login</span>';

// ringkasan akses sebuah role: chip per modul yang punya akses
function accessChips(permissions, limit = 8) {
  const set = new Set(permissions), P = look.permissions;
  const items = P.MODULES.map(m => ({ m, lv: levelOfPerms(m.key, set) })).filter(x => x.lv !== 'none');
  const chip = ({ m, lv }) => `<span class="achip ${lv === 'view' ? 'v' : lv === 'custom' ? 'c' : 'm'}"><i></i>${esc(m.label)} · ${LVL_LABEL[lv]}</span>`;
  const none = P.MODULES.length - items.length;
  return items.slice(0, limit).map(chip).join('') + (items.length > limit ? `<span class="achip n">+${items.length - limit} lainnya</span>` : '') + (none ? `<span class="achip n"><i></i>${none} modul · Tanpa akses</span>` : '') || '<span class="achip n"><i></i>Tidak punya akses</span>';
}
// padanan lib/permissions.js (levelOf) di browser
function levelOfPerms(mod, set) {
  const m = look.permissions.MODULES.find(x => x.key === mod), have = m.actions.filter(a => set.has(`${mod}.${a}`));
  const want = { none: [], view: m.actions.filter(a => a === 'view'), manage: m.actions.filter(a => ['view', 'create', 'update', 'export'].includes(a)), full: m.actions };
  for (const l of ['none', 'view', 'manage', 'full']) if (want[l].length === have.length && want[l].every(a => have.includes(a))) return l;
  return 'custom';
}

function usersRoute() {
  $('#ttl').textContent = 'User Management'; $('#sub').textContent = 'Kelola akun, email login, dan role pengguna.';
  $('#view').innerHTML = '<div id="usum"></div><div id="ulist"></div>';
  api('/users/roles').then(r => { usrRoles = r; usersList(); });
}
async function usersList() {
  const d = await api('/users?' + new URLSearchParams(usrSt)), s = d.summary, canU = can('user.update'), canC = can('user.create');
  $('#usum').innerHTML = `<div class="cards">${[['Total user', s.total, '', 's-total'], ['Aktif', s.active, 'active', 's-done'], ['Nonaktif', s.inactive, 'inactive', 's-eta'], ['Belum pernah login', s.never, 'pending', 's-open']]
    .map(([l, v, f, c]) => `<div class="card stat ${c}${(f ? usrSt.status === f : !usrSt.status) ? ' on' : ''}" aria-pressed="${f ? usrSt.status === f : !usrSt.status}" ${f ? clickAttr(`usrSet('status','${usrSt.status === f ? '' : f}')`) : clickAttr('usrReset()')}><b>${fmtN(v)}</b><span>${l}</span></div>`).join('')}</div>`;
  $('#ulist').innerHTML = `<div class="bar fbar"><input id="uq" type="search" aria-label="Cari user" placeholder="Cari nama, email, atau kode PIC" value="${esc(usrSt.q)}">
    <select id="ur" aria-label="Filter role"><option value="">Semua role</option>${usrRoles.map(r => `<option value="${r.id}" ${+usrSt.role_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <select id="us" aria-label="Filter status">${[['', 'Semua status'], ['active', 'Aktif'], ['inactive', 'Nonaktif'], ['pending', 'Menunggu login']].map(([v, l]) => `<option value="${v}" ${usrSt.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn sec" onclick="usrReset()">Reset</button><span style="flex:1"></span>${canC ? '<button class="btn" onclick="userForm()">+ Tambah User</button>' : ''}</div>
    <div class="card tw"><table><tr><th>Nama</th><th>No. ID</th><th>Email login</th><th>PIC</th><th>Role</th><th>Login terakhir</th><th>Status</th><th>Aksi</th></tr>
    ${d.rows.map(u => {
      const lock = u.locked && !isSuper(), self = u.id === me.id;
      return `<tr class="${u.is_active ? '' : 'dim'}"><td><span class="uname">${uAv(u.name)}${canU && !lock ? `<a href="#" onclick="userForm(${u.id});return false">${esc(u.name)}</a>` : `<b>${esc(u.name)}</b>`}${self ? ' <span class="more">Anda</span>' : ''}</span></td>
        <td>${esc(u.employee_no || '-')}</td><td>${esc(u.email || '—')}</td><td><b>${esc(u.pic_code || '-')}</b></td><td>${roleChip(u)}</td><td>${lastLogin(u.last_login_at)}</td><td>${statusChip(u)}</td>
        <td class="uact">${lock ? '<span class="soon">Dikunci</span>' : !canU ? '' : rowMenu(u.name, [{ t: 'Edit', js: `userForm(${u.id})` }, !(self || u.locked) && { t: u.is_active ? 'Nonaktifkan' : 'Aktifkan', js: `userToggle(${u.id},${!u.is_active},'${u.name.replace(/['"]/g, '')}')`, danger: u.is_active }])}</td></tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--mut)">Tidak ada user yang cocok.</td></tr>'}</table>
    <p class="tnote">Hapus permanen hanya untuk user tanpa transaksi; selebihnya dinonaktifkan.</p>${pagerNum(d.page, d.pages, d.total, 'usrGoto')}</div>`;
  const q = $('#uq'); let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { usrSt.q = q.value.trim(); usrSt.page = 1; usersList().then(() => { const n = $('#uq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); };
  $('#ur').onchange = e => { usrSt.role_id = e.target.value; usrSt.page = 1; usersList(); };
  $('#us').onchange = e => { usrSt.status = e.target.value; usrSt.page = 1; usersList(); };
}
const usrSet = (k, v) => { usrSt[k] = v; usrSt.page = 1; usersList(); };
const usrReset = () => { usrSt = { q: '', role_id: '', status: '', page: 1 }; usersList(); };
const usrGoto = n => { usrSt.page = n; usersList(); };
const userToggle = run(async (id, on, name) => {
  if (!on && !confirm(`Nonaktifkan ${name}? User tidak bisa login sampai diaktifkan lagi.`)) return;
  await api(`/users/${id}/${on ? 'activate' : 'deactivate'}`, 'POST'); toast(on ? 'User diaktifkan' : 'User dinonaktifkan'); usersList();
});

/* ---------- form user ---------- */
const genPw = () => { const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = crypto.getRandomValues(new Uint8Array(10)); return [...a].map(b => abc[b % abc.length]).join(''); };
async function userForm(id) {
  if (!usrRoles.length) usrRoles = await api('/users/roles');
  const u = id ? await api('/users/' + id) : { name: '', employee_no: '', email: '', username: '', pic_code: '', role_id: usrRoles.find(r => r.name === 'PIC Operasional')?.id || '', is_active: true, must_change_password: true, pic_used: 0 };
  const sa = isSuper(), self = !!u.is_self, picLocked = u.pic_used > 0;
  const f = (k, label, extra = '', hint = '') => `<div><label for="uf-${k}">${label}</label><input id="uf-${k}" name="${k}" value="${esc(u[k])}" ${extra}><div class="ferr" id="fe-${k}" role="alert"></div>${hint}</div>`;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="uform" novalidate style="width:min(780px,100%)"><h3 style="margin-top:0">${id ? 'Edit User' : 'Tambah User'}</h3>
    <p class="muted2">Login memakai username + password. Email dipakai untuk verifikasi OTP pada tahap berikutnya, jadi wajib dan tidak boleh sama dengan user lain.</p>
    <div class="fsec">Identitas</div><div class="g">${f('name', 'Nama lengkap', 'required autocomplete="off"')}${f('employee_no', 'No. ID karyawan', 'maxlength="20" autocomplete="off"')}
      <div class="full">${f('email', 'Email login (OTP)', 'type="email" required autocomplete="off"')}</div>
      ${f('username', 'Username', 'required autocomplete="off" autocapitalize="off"')}
      ${f('pic_code', 'Kode PIC (2 huruf)', `maxlength="2" required style="text-transform:uppercase" ${picLocked ? 'disabled' : ''}`)}
      <div><label for="uf-active">Status</label><select id="uf-active" name="is_active" ${self ? 'disabled' : ''}><option value="1" ${u.is_active ? 'selected' : ''}>Aktif</option><option value="0" ${u.is_active ? '' : 'selected'}>Nonaktif</option></select></div></div>
    <p class="muted2">${picLocked ? `Kode PIC terkunci karena sudah dipakai di ${u.pic_used} nomor tiket. ` : 'Kode PIC dipakai di nomor tiket dan terkunci setelah dipakai. '}Email wajib dan unik; mengubahnya memindahkan tujuan OTP.</p>
    <div class="fsec">Role &amp; akses</div><div class="g"><div><label for="uf-role">Role</label><select id="uf-role" name="role_id" onchange="userRoleChange()" ${self ? 'disabled' : ''}><option value="">Pilih role…</option>
      ${usrRoles.map(r => `<option value="${r.id}" ${+u.role_id === r.id ? 'selected' : ''} ${r.is_system && !sa && +u.role_id !== r.id ? 'disabled' : ''}>${esc(r.name)}${r.is_system ? ' (sistem)' : ''}</option>`).join('')}</select><div class="ferr" id="fe-role_id" role="alert"></div></div>
      <div><label for="uf-scope">Cakupan data</label><select id="uf-scope" disabled><option>Semua data</option></select></div></div>
    ${self ? '<p class="muted2">Role dan status akun sendiri tidak bisa diubah di sini.</p>' : ''}
    <div class="aclist"><span class="muted2">Akses dari role ini:</span><span id="uacc"></span></div><a href="#" id="udet" class="lnk" onclick="userRoleDetail();return false">Lihat detail role</a>
    <div class="fsec">Keamanan</div><div class="g"><div><label for="uf-password">${id ? 'Password baru (kosongkan jika tidak diubah)' : 'Password sementara'}</label>
      <div class="pwrow"><input id="uf-password" name="password" autocomplete="new-password" placeholder="${id ? 'Minimal 8 karakter' : 'Kosongkan = dibuat otomatis'}"><button type="button" class="btn sec sm" onclick="$('#uf-password').value=genPw()">Buat acak</button></div><div class="ferr" id="fe-password" role="alert"></div></div>
      <label class="chk"><input type="checkbox" name="must_change_password" ${u.must_change_password ? 'checked' : ''}> Wajib ganti password saat login berikutnya</label></div>
    <p class="muted2"><span class="achip n"><i></i>OTP email · belum aktif</span> Verifikasi OTP akan ditambahkan setelah layanan pengirim email ditentukan.</p>
    ${id ? `<div class="danger"><div><b>Zona hati-hati</b> <span>${u.deletable ? 'Hapus permanen tidak bisa dibatalkan.' : esc(u.delete_block || '')}</span></div><div class="acts" style="margin:0">
      ${self || u.locked ? '' : `<button type="button" class="btn sec" onclick="userModalToggle(${id},${u.is_active ? 'false' : 'true'})">${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}
      ${can('user.delete') ? `<button type="button" class="btn bad" ${u.deletable ? '' : 'disabled'} onclick="userDelete(${id},'${esc(u.name).replace(/'/g, '')}')">Hapus permanen</button>` : ''}</div></div>` : ''}
    <div class="err" id="uerr" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="usave">${id ? 'Simpan' : 'Tambah User'}</button></div></form></div>`;
  userRoleChange();
  $('#uform').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), b = Object.fromEntries(fd);
    for (const el of e.target.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    document.querySelectorAll('.ferr').forEach(x => (x.textContent = ''));
    b.must_change_password = fd.has('must_change_password'); b.is_active = $('#uf-active').value === '1';
    if (picLocked) delete b.pic_code; if (self) { delete b.role_id; delete b.is_active; }
    if (!id && !b.password) delete b.password; if (id && !b.password) delete b.password;
    $('#usave').disabled = true;
    try {
      const r = await api(id ? '/users/' + id : '/users', id ? 'PUT' : 'POST', b);
      if (r.temp_password) { userTempDialog(b.username, r.temp_password); usersList(); return; }
      closeMd(); toast(id ? 'User disimpan' : 'User ditambahkan'); usersList();
    } catch (er) {
      $('#usave').disabled = false;
      const fe = er.fields || {}; Object.entries(fe).forEach(([k, m]) => { const t = $('#fe-' + k); if (t) t.textContent = m; document.querySelector(`[name="${k}"]`)?.setAttribute('aria-invalid', 'true'); });
      $('#uerr').textContent = Object.keys(fe).length ? '' : er.message;
      document.querySelector('[aria-invalid]')?.focus();
    }
  };
}
function userRoleChange() {
  const r = usrRoles.find(x => x.id === +$('#uf-role').value);
  $('#uacc').innerHTML = r ? accessChips(r.permissions) : '<span class="muted2">Pilih role untuk melihat aksesnya.</span>';
  $('#udet').hidden = !r || !can('role.view');
}
const userRoleDetail = () => { roleSel = +$('#uf-role').value; closeMd(); location.hash = '#roles'; };
const userModalToggle = run(async (id, on) => { if (!on && !confirm('Nonaktifkan user ini?')) return; await api(`/users/${id}/${on ? 'activate' : 'deactivate'}`, 'POST'); closeMd(); toast(on ? 'User diaktifkan' : 'User dinonaktifkan'); usersList(); });
const userDelete = run(async (id, name) => { if (!confirm(`Hapus permanen ${name}? Tindakan ini tidak bisa dibatalkan.`)) return; await api('/users/' + id, 'DELETE'); closeMd(); toast('User dihapus'); usersList(); });
function userTempDialog(username, pw) {
  $('#md').innerHTML = `<div class="modal"><div class="card" style="max-width:460px"><h3 style="margin-top:0">User ditambahkan</h3>
    <p>Password sementara untuk <b>${esc(username)}</b>. Catat sekarang: password ini tidak disimpan dan tidak akan ditampilkan lagi. User wajib menggantinya saat login pertama.</p>
    <div class="pwrow"><input id="tpw" readonly value="${esc(pw)}" aria-label="Password sementara" onfocus="this.select()"><button class="btn sec" onclick="navigator.clipboard.writeText($('#tpw').value).then(()=>toast('Password disalin'))">Salin</button></div>
    <div class="acts"><button class="btn" onclick="closeMd()">Selesai</button></div></div></div>`;
}

/* ---------- akun saya: ganti password (juga dipaksa saat must_change_password) ---------- */
function accountModal(force = false) {
  $('#md').innerHTML = `<div class="modal"><form class="card" id="pwf" novalidate style="max-width:460px"><h3 style="margin-top:0">${force ? 'Ganti password' : 'Akun saya'}</h3>
    ${force ? '<p class="muted2">Demi keamanan, ganti password sementara Anda sebelum melanjutkan.</p>' : `<div class="acc"><b>${esc(me.name)}</b><span>${esc(me.role?.name || 'Tanpa role')} · ${esc(me.email || me.username)}</span></div><div class="fsec">Ganti password</div>`}
    <div><label for="pw0">Password lama</label><input id="pw0" type="password" autocomplete="current-password" required></div>
    <div style="margin-top:10px"><label for="pw1">Password baru (minimal 8 karakter)</label><input id="pw1" type="password" autocomplete="new-password" required></div>
    <div style="margin-top:10px"><label for="pw2">Ulangi password baru</label><input id="pw2" type="password" autocomplete="new-password" required></div>
    <div class="err" id="pwe" role="alert"></div><div class="acts">${force ? '<button type="button" class="btn sec" onclick="logout()">Logout</button>' : '<button type="button" class="btn sec" onclick="closeMd()">Tutup</button>'}<button class="btn">Simpan password</button></div></form></div>`;
  $('#pwf').onsubmit = async e => {
    e.preventDefault(); const p1 = $('#pw1').value;
    if (p1 !== $('#pw2').value) { $('#pwe').textContent = 'Ulangi password baru dengan sama persis'; return; }
    try { await api('/me/password', 'POST', { current: $('#pw0').value, password: p1 }); toast('Password diganti'); closeMd(); me = await api('/me'); route(); }
    catch (er) { $('#pwe').textContent = er.message; }
  };
}
