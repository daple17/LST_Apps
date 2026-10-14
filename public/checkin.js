/* Check In & Daily Report (HR/SDM): #checkin (CHECK IN), #checkin/report (DAILY REPORT), #checkin/rekap (REKAP HR).
   Jam dan tanggal selalu dari server: jam di layar = jam perangkat + selisih terhadap jam server (diambil dari API). */
const CI_STATUS = { WFO: ['Work From Office', 'ok'], WFH: ['Work From Home', 'blue'], ALF: ['Alfa', 'bad'], SCK: ['Sakit', 'wait'], OTH: ['Lainnya', 'off'] };
const ciChip = (st, virtual) => `<span class="schip ${CI_STATUS[st]?.[1] || 'off'}"><i></i>${st}${virtual ? ' · otomatis' : ''}</span>`;
let ciToday = null, ciOffset = 0, ciTimer = null, ciLoc = null, ciRk = null, ciShotData = null;
const ciPhotoSrc = u => `${u}?t=${token}`;           // <img> tidak bisa mengirim header Authorization: token di query (sama seperti PDF/ZIP)
const ciThumb = (u, cls = 'rkph') => u ? `<img class="${cls}" src="${ciPhotoSrc(u)}" alt="Foto bukti absensi" loading="lazy" tabindex="0" role="button" onclick="ciPhotoView('${u}')" onkeydown="if(event.key==='Enter')ciPhotoView('${u}')">` : '';

const ciWibClock = ms => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
const ciTabs = tab => {
  const tabs = [['', 'Check In', can('checkin.view')], ['report', 'Daily Report', can('checkin.view')], ['rekap', 'Rekap', can('checkin_rekap.view')]].filter(t => t[2]);
  return `<div class="tabs">${tabs.map(([k, l]) => `<a class="btn ${tab === k ? '' : 'sec'} sm" href="#checkin${k ? '/' + k : ''}" ${tab === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</div>`;
};
const ciMaps = a => a.maps_url ? `<a href="${a.maps_url}" target="_blank" rel="noopener">Google maps</a>` : '<span class="muted2" style="margin:0">Lokasi tidak dibagikan</span>';

function checkinRoute(rest) {
  clearInterval(ciTimer);
  const tab = rest[0] || '';
  if (!can('checkin.view') && !tab) return location.replace('#checkin/rekap');                   // HR tanpa izin absen sendiri: langsung ke rekap
  if ((tab === 'rekap' && !can('checkin_rekap.view')) || (tab !== 'rekap' && !can('checkin.view'))) return noAccess('');
  $('#ttl').textContent = 'Check In & Report'; $('#sub').textContent = tab === 'rekap' ? 'Rekap kehadiran semua pegawai.' : 'Absensi harian dan laporan kegiatan.';
  $('#view').innerHTML = ciTabs(tab) + '<div id="ci-body"></div>';
  if (tab === 'report') return ciReport();
  if (tab === 'rekap') return ciRekap();
  return ciCheckin();
}

async function ciLoadToday() {
  ciToday = await api('/checkin/today'); ciOffset = ciToday.server_ms - Date.now();
  return ciToday;
}
function ciTick() {
  const el = $('#ci-clock'); if (!el) return clearInterval(ciTimer);
  const ms = Date.now() + ciOffset; el.textContent = ciWibClock(ms) + ' WIB';
  if (ciToday && IdFmt.jktDay(new Date(ms)) !== ciToday.date) { clearInterval(ciTimer); ciCheckin(); }       // tanggal berganti saat halaman terbuka
}

/* ---------- tab CHECK IN ---------- */
async function ciCheckin() {
  const t = await ciLoadToday(), a = t.attendance, canC = can('checkin.create');
  ciLoc = null; ciShotData = null;
  $('#ci-body').innerHTML = `<section class="card cibox" aria-label="Absensi pegawai"><p class="cieyebrow">ABSENSI PEGAWAI</p>
    <p class="cidate"><time datetime="${t.date}">${IdFmt.longDate(new Date(t.date + 'T12:00:00+07:00'))}</time></p><p class="ciclock" id="ci-clock" role="timer" aria-live="off">--:--:-- WIB</p>
    <div class="ciwho"><b>${esc(t.user.name)}</b><span>No. ID ${esc(t.user.employee_no || '-')}</span></div>
    ${a ? ciDone(a) : canC ? `<fieldset class="cistat"><legend>Status kerja hari ini</legend>
      <label class="cirad"><input type="radio" name="cist" value="WFO" onchange="ciPick()"><span><b>WFO</b><small>Work From Office</small></span></label>
      <label class="cirad"><input type="radio" name="cist" value="WFH" onchange="ciPick()"><span><b>WFH</b><small>Work From Home</small></span></label></fieldset>
      <div class="ciphoto" id="ci-photo"><button type="button" class="btn sec cibtn" id="ci-shot" onclick="$('#ci-file').click()">Ambil Foto</button><input type="file" id="ci-file" accept="image/*" capture="user" hidden onchange="ciPhoto(this)"><div class="ciprev" id="ci-prev"><span class="muted2" style="margin:0">${t.photo_required ? 'Foto bukti wajib diambil.' : 'Foto bukti (opsional).'}</span></div></div>
      <div class="ciloc" id="ci-loc"><button type="button" class="btn sec cibtn" onclick="ciShare()">Share Location</button><span class="muted2" id="ci-locmsg">Lokasi opsional. Jika tidak dibagikan, check in tetap bisa.</span></div>
      <button type="button" class="btn cibtn cigo" id="ci-go" disabled onclick="ciGo()">Check In</button><div class="err" id="ci-err" role="alert"></div>` : '<p class="muted2">Anda tidak punya izin untuk check in.</p>'}
    <p class="muted2 cinote">Jam dan tanggal diambil dari server (WIB), bukan dari perangkat. Satu kali check in per hari. Jam masuk ${esc(t.work_start)} WIB.</p></section>`;
  ciTick(); ciTimer = setInterval(ciTick, 1000);
}
const ciDone = a => `<div class="cidone" role="status"><div class="cit">${a.time ? esc(a.time) : '—'}<small>WIB</small></div><div class="cich">${ciChip(a.status)}${a.late ? '<span class="schip wait"><i></i>Terlambat</span>' : ''}${a.source === 'HR' ? '<span class="schip off"><i></i>Diinput HR</span>' : ''}</div>
  ${a.photo_url ? `<div class="ciprev">${ciThumb(a.photo_url, 'cithumb')}</div>` : ''}<p class="ciloc2">${a.time ? ciMaps(a) : ''}${a.note ? `<span class="muted2" style="margin:0 0 0 12px">${esc(a.note)}</span>` : ''}</p><p class="muted2">Anda sudah check in hari ini. Check in tidak bisa dibatalkan atau diulang.</p></div>`;
const ciPick = () => { $('#ci-go').disabled = !document.querySelector('input[name=cist]:checked') || (ciToday.photo_required && !ciShotData); };
async function ciPhoto(inp) {
  const f = inp.files[0]; if (!f) return;
  try {
    ciShotData = await resizeImg(f, 1024);
    $('#ci-prev').innerHTML = `<img class="cithumb" src="${ciShotData.url}" alt="Foto bukti yang diambil"><span class="muted2" style="margin:0">Foto siap dikirim.</span>`; $('#ci-shot').textContent = 'Ulangi foto';
  } catch (e) { ciShotData = null; $('#ci-prev').innerHTML = `<span class="err" role="alert">${esc(e.message)}</span>`; }
  inp.value = ''; ciPick();
}
function ciShare() {
  const m = $('#ci-locmsg'), btn = document.querySelector('#ci-loc .btn');
  if (!navigator.geolocation) { ciLoc = null; m.textContent = 'Perangkat tidak mendukung lokasi. Check in tetap bisa tanpa lokasi.'; return; }
  btn.disabled = true; m.textContent = 'Mengambil lokasi…';
  navigator.geolocation.getCurrentPosition(p => {
    ciLoc = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    btn.disabled = false; btn.textContent = 'Perbarui lokasi'; m.innerHTML = `Lokasi dibagikan (±${Math.round(p.coords.accuracy)} m) · <a href="https://www.google.com/maps?q=${ciLoc.lat},${ciLoc.lng}" target="_blank" rel="noopener">Google maps</a>`;
  }, e => { ciLoc = null; btn.disabled = false; m.textContent = e.code === 1 ? 'Lokasi tidak dibagikan (izin ditolak). Check in tetap bisa.' : 'Lokasi tidak tersedia. Check in tetap bisa.'; }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}
async function ciGo() {
  const st = document.querySelector('input[name=cist]:checked')?.value; if (!st) return;
  $('#ci-go').disabled = true; $('#ci-err').textContent = '';
  try { const r = await api('/checkin', 'POST', { status: st, ...(ciLoc || {}), ...(ciShotData ? { photo: { filename: ciShotData.filename, data: ciShotData.data } } : {}) }); toast(r.late ? `Check in ${r.attendance.time} WIB (terlambat)` : `Check in berhasil ${r.attendance.time} WIB`, r.late); ciCheckin(); }
  catch (e) { $('#ci-err').textContent = e.message; if (e.status === 409) ciCheckin(); else $('#ci-go').disabled = false; }
}

/* ---------- tab DAILY REPORT ---------- */
const ciItemRows = (items, editable) => items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.start_time)}</td><td>${i.end_time ? esc(i.end_time) : '-'}</td><td class="wrap">${esc(i.activity)}</td>${editable ? `<td><button class="btn sec sm" onclick="ciReportForm(${i.id})">edit</button></td>` : ''}</tr>`).join('');
async function ciReport() {
  const t = await ciLoadToday(); ciRepItems = t.report;
  $('#ci-body').innerHTML = `<section class="card tw" aria-label="Laporan harian"><div class="cirh"><div><p class="cieyebrow" style="margin:0">LAPORAN HARIAN</p><b class="cirn">${esc(t.user.name)}</b><span class="muted2" style="margin:0 0 0 10px">No. ID ${esc(t.user.employee_no || '-')}</span><span class="muted2" style="margin:0 0 0 10px">${IdFmt.longDate(new Date(t.date + 'T12:00:00+07:00'))}</span></div>
      ${can('checkin.create') ? '<button class="btn" onclick="ciReportForm()">ADD ACTIVITY ++</button>' : ''}</div>
    <table><tr><th>No</th><th>Start</th><th>Finish</th><th>Activity</th>${can('checkin.update') ? '<th>Act</th>' : ''}</tr>${ciItemRows(t.report, can('checkin.update')) || `<tr><td colspan="5" style="text-align:center;color:var(--mut)">Belum ada kegiatan hari ini. Tambahkan lewat ADD ACTIVITY.</td></tr>`}</table></section>
    <section class="card tw" aria-label="Riwayat" style="margin-top:16px"><div class="cirh"><b class="cirn">Riwayat</b><label class="inl" style="margin:0">Tanggal <input type="date" id="ci-hd" max="${t.date}" value="${C_prevDay(t.date)}" onchange="ciHist()"></label></div><div id="ci-hist"></div></section>`;
  ciHist();
}
const C_prevDay = d => new Date(Date.parse(d + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
let ciRepItems = [];
async function ciHist() {
  const d = $('#ci-hd').value; if (!d) return;
  const h = await api(`/checkin/history?from=${d}&to=${d}`), day = h.days[0];
  $('#ci-hist').innerHTML = `<p class="muted2" style="margin:0 20px 8px">${IdFmt.longDate(new Date(d + 'T12:00:00+07:00'))} · ${day.attendance ? `${ciChip(day.attendance.status)} ${day.attendance.time ? 'check in ' + day.attendance.time + ' WIB' : ''}${day.attendance.late ? ' · terlambat' : ''} ${ciThumb(day.attendance.photo_url)}` : 'tidak ada absensi'}${d === h.today ? ' · hari ini' : ' · hanya baca'}</p>
    <table><tr><th>No</th><th>Start</th><th>Finish</th><th>Activity</th></tr>${ciItemRows(day.report, false) || '<tr><td colspan="4" style="text-align:center;color:var(--mut)">Tidak ada kegiatan tercatat.</td></tr>'}</table>`;
}
function ciReportForm(id) {
  const it = id ? ciRepItems.find(x => x.id === id) : { start_time: '', end_time: '', activity: '' };
  $('#md').innerHTML = `<div class="modal"><form class="card" id="irf" novalidate style="max-width:520px"><h3 style="margin-top:0">${id ? 'Edit Kegiatan' : 'Tambah Kegiatan'}</h3>
    <div class="g"><div><label for="ir-s">Start</label><input id="ir-s" name="start_time" type="time" value="${esc(it.start_time)}" required><div class="ferr" id="fe-start_time" role="alert"></div></div>
      <div><label for="ir-e">Finish (kosong = masih berjalan)</label><input id="ir-e" name="end_time" type="time" value="${esc(it.end_time || '')}"><div class="ferr" id="fe-end_time" role="alert"></div></div>
      <div class="full"><label for="ir-a">Activity</label><input id="ir-a" name="activity" maxlength="255" value="${esc(it.activity)}" required autocomplete="off"><div class="ferr" id="fe-activity" role="alert"></div></div></div>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="irsave">Simpan</button></div></form></div>`;
  $('#ir-a').focus();
  $('#irf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = { start_time: f.start_time.value, end_time: f.end_time.value || null, activity: f.activity.value };
    $('#irsave').disabled = true;
    try { await api(id ? '/checkin/report/' + id : '/checkin/report', id ? 'PUT' : 'POST', b); closeMd(); toast('Kegiatan disimpan'); ciReport(); }
    catch (er) { $('#irsave').disabled = false; coaFieldErrors(er, f); }
  };
}

/* ---------- tab REKAP (HR) ---------- */
function ciRk0() { const d = ciToday?.date || IdFmt.jktDay(new Date()); return { mode: 'day', date: d, from: C_prevDay(d), to: d, q: '', status: '' }; }
async function ciRekap() {
  if (!ciRk) ciRk = ciRk0();
  const s = ciRk, qs = s.mode === 'day' ? { date: s.date, q: s.q, status: s.status } : { from: s.from, to: s.to, q: s.q, status: s.status };
  const d = await api('/checkin-rekap?' + new URLSearchParams(qs)), day = d.mode === 'day', tot = d.totals;
  $('#ci-body').innerHTML = `<div class="bar fbar"><div class="lvl" role="group" aria-label="Mode rekap"><button type="button" class="${day ? 'on' : ''}" onclick="ciRkSet('mode','day')">Harian</button><button type="button" class="${day ? '' : 'on'}" onclick="ciRkSet('mode','period')">Periode</button></div>
    ${day ? `<input type="date" id="rk-d" aria-label="Tanggal" value="${s.date}" style="max-width:170px">` : `<label class="inl" style="margin:0"><input type="date" id="rk-f" aria-label="Dari" value="${s.from}"> – <input type="date" id="rk-t" aria-label="Sampai" value="${s.to}"></label>`}
    <input id="rk-q" type="search" aria-label="Cari" placeholder="Cari nama atau ID" value="${esc(s.q)}" style="max-width:220px">
    <select id="rk-s" aria-label="Filter status"><option value="">Semua status</option>${Object.entries(CI_STATUS).map(([c, [l]]) => `<option value="${c}" ${s.status === c ? 'selected' : ''}>${c} · ${l}</option>`).join('')}</select>
    <span style="flex:1"></span><button class="btn sec out" onclick="rekapExport()">Download Excel</button></div>
    <div class="ci-tot" role="group" aria-label="Total status">${Object.entries(tot).map(([c, n]) => `<span class="schip ${CI_STATUS[c][1]}"><i></i>Total ${c}: <b>${n}</b></span>`).join('')}<span class="muted2" style="margin:0">${d.rows.length} pegawai · ${d.days} hari</span></div>
    <div class="card tw"><table><tr><th>No.</th><th>Nomor ID</th><th>Nama</th><th class="num">Attendance</th><th class="num">Permit</th><th class="num">Alfa</th><th class="num">Past</th>${day ? '<th>Foto</th><th>Location</th><th>Check In</th><th>Status</th><th>Report</th>' : ''}<th>Aksi</th></tr>
    ${d.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.employee_no || '-')}</td><td><a href="#" onclick="rekapDetail(${x.id});return false"><b>${esc(x.name)}</b></a>${x.is_active ? '' : ' <span class="more">nonaktif</span>'}</td>
      <td class="num">${x.attendance}</td><td class="num">${x.permit}</td><td class="num">${x.alfa}</td><td class="num">${x.late}</td>
      ${day ? `<td>${x.day?.photo_url ? ciThumb(x.day.photo_url) : '—'}</td><td>${x.day?.time ? ciMaps(x.day) : '—'}</td><td>${x.day?.time ? esc(x.day.time) + (x.day.late ? ' <span class="more" title="Terlambat">Past</span>' : '') : '—'}</td><td>${x.day ? ciChip(x.day.status, x.day.virtual) : '—'}</td><td class="wrap" title="${esc(x.report)}">${esc(x.report || '—')}</td>` : ''}
      <td><button class="btn sec sm" onclick="rekapOverride(${x.id},'${esc(x.name).replace(/'/g, '')}','${day ? d.from : d.to}')">Koreksi</button></td></tr>`).join('') || `<tr><td colspan="${day ? 13 : 8}" style="text-align:center;color:var(--mut)">Tidak ada data pada ${day ? 'tanggal' : 'periode'} ini.</td></tr>`}</table></div>
    <p class="muted2">Hari kerja (Senin–Jumat) yang sudah lewat tanpa absensi dihitung Alfa otomatis untuk pegawai aktif. Kalender libur nasional belum ada.</p>`;
  const on = (id, f) => { const e = $(id); if (e) e.onchange = f; };
  on('#rk-d', e => { ciRk.date = e.target.value || ciRk.date; ciRekap(); }); on('#rk-f', e => { ciRk.from = e.target.value || ciRk.from; ciRekap(); }); on('#rk-t', e => { ciRk.to = e.target.value || ciRk.to; ciRekap(); });
  on('#rk-s', e => { ciRk.status = e.target.value; ciRekap(); });
  const q = $('#rk-q'); let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { ciRk.q = q.value.trim(); ciRekap().then(() => { const n = $('#rk-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); };
}
const ciRkSet = (k, v) => { if (k === 'mode') { ciRk.mode = v; if (v === 'period' && ciRk.to > ciRk.date) ciRk.to = ciRk.date; } ciRekap(); };
const rekapExport = run(async () => {
  const s = ciRk, qs = s.mode === 'day' ? { date: s.date, q: s.q, status: s.status } : { from: s.from, to: s.to, q: s.q, status: s.status };
  const r = await raw('/checkin-rekap/export?' + new URLSearchParams(qs)); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Download gagal');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `absensi-${s.mode === 'day' ? s.date : s.from + '_' + s.to}.xlsx` });
  document.body.appendChild(a); a.click(); a.remove();
});

// detail per pegawai (rentang tanggal), dengan koreksi status dan koreksi report
let ciDetail = null;
async function rekapDetail(id, from, to) {
  const s = ciRk || ciRk0(), t = to || (s.mode === 'day' ? s.date : s.to), f = from || C_addDays(t, -13);
  const d = await api(`/checkin-rekap/user/${id}?from=${f}&to=${t}`); ciDetail = d;
  const canU = can('checkin_rekap.update'), sum = d.summary;
  $('#md').innerHTML = `<div class="modal"><div class="card" style="width:min(900px,100%)"><h3 style="margin-top:0">${esc(d.user.name)} <span class="muted2" style="margin:0 0 0 8px;font-family:var(--f-ui);font-style:normal">No. ID ${esc(d.user.employee_no || '-')}</span></h3>
    <div class="ci-tot">${['WFO', 'WFH', 'ALF', 'SCK', 'OTH'].map(c => `<span class="schip ${CI_STATUS[c][1]}"><i></i>${c}: <b>${sum[c]}</b></span>`).join('')}<span class="schip wait"><i></i>Past: <b>${sum.late}</b></span><span class="muted2" style="margin:0">${IdFmt.shortDate(d.from)} – ${IdFmt.shortDate(d.to)}</span></div>
    <div class="tw"><table><tr><th>Tanggal</th><th>Status</th><th>Check In</th><th>Foto</th><th>Lokasi</th><th>Report</th>${canU ? '<th>Aksi</th>' : ''}</tr>
    ${d.days.map(x => `<tr class="${x.weekday ? '' : 'dim'}"><td>${IdFmt.shortDate(x.date)}${x.weekday ? '' : ' <span class="more">libur</span>'}</td><td>${x.status ? ciChip(x.status, x.virtual) : '—'}</td><td>${x.attendance?.time ? esc(x.attendance.time) + (x.attendance.late ? ' <span class="more">Past</span>' : '') : '—'}</td>
      <td>${x.attendance?.photo_url ? ciThumb(x.attendance.photo_url) : '—'}</td><td>${x.attendance?.time ? ciMaps(x.attendance) : '—'}</td><td class="wrap">${x.report.map(i => `${esc(i.start_time)}–${esc(i.end_time || '-')} ${esc(i.activity)}${canU ? ` <button class="btn sec sm" onclick="rekapReportEdit(${i.id})">edit</button>` : ''}`).join('<br>') || '—'}${x.attendance?.note ? `<br><span class="muted2" style="margin:0">${esc(x.attendance.note)}</span>` : ''}</td>
      ${canU ? `<td><button class="btn sec sm" onclick="rekapOverride(${d.user.id},'${esc(d.user.name).replace(/'/g, '')}','${x.date}')">Koreksi</button></td>` : ''}</tr>`).join('')}</table></div>
    <div class="acts"><button class="btn sec" onclick="closeMd()">Tutup</button></div></div></div>`;
}
const C_addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// input / koreksi status oleh HR
function rekapOverride(uid, name, date) {
  $('#md').innerHTML = `<div class="modal"><form class="card" id="rof" novalidate style="max-width:480px"><h3 style="margin-top:0">Input / koreksi status</h3><p class="muted2" style="margin-top:0"><b>${esc(name)}</b></p>
    <div class="g"><div><label for="ro-d">Tanggal</label><input id="ro-d" name="work_date" type="date" value="${date}" max="${ciToday?.date || IdFmt.jktDay(new Date())}" required><div class="ferr" id="fe-work_date" role="alert"></div></div>
      <div><label for="ro-s">Status</label><select id="ro-s" name="status" onchange="rekapNoteHint()">${Object.entries(CI_STATUS).map(([c, [l]]) => `<option value="${c}">${c} · ${l}</option>`).join('')}</select><div class="ferr" id="fe-status" role="alert"></div></div>
      <div class="full"><label for="ro-n">Keterangan <span id="ro-hint" class="muted2" style="margin:0"></span></label><input id="ro-n" name="note" maxlength="255" autocomplete="off"><div class="ferr" id="fe-note" role="alert"></div></div></div>
    <p class="muted2">Status SCK dan OTH wajib berketerangan. Perubahan tercatat di log audit. Tanggal masa depan tidak bisa diinput.</p>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="closeMd()">Batal</button><button class="btn" id="rosave">Simpan</button></div></form></div>`;
  rekapNoteHint(); $('#ro-s').focus();
  $('#rof').onsubmit = async e => {
    e.preventDefault(); const f = e.target; $('#rosave').disabled = true;
    try { await api('/checkin-rekap/override', 'PUT', { user_id: uid, work_date: f.work_date.value, status: f.status.value, note: f.note.value }); closeMd(); toast('Status disimpan'); ciRekap(); }
    catch (er) { $('#rosave').disabled = false; coaFieldErrors(er, f); }
  };
}
const rekapNoteHint = () => { $('#ro-hint').textContent = ['SCK', 'OTH'].includes($('#ro-s').value) ? '(wajib)' : '(opsional)'; };
function rekapReportEdit(id) {
  const it = ciDetail.days.flatMap(x => x.report).find(x => x.id === id), uid = ciDetail.user.id;
  $('#md').innerHTML = `<div class="modal"><form class="card" id="irf" novalidate style="max-width:520px"><h3 style="margin-top:0">Koreksi kegiatan</h3>
    <div class="g"><div><label for="ir-s">Start</label><input id="ir-s" name="start_time" type="time" value="${esc(it.start_time)}" required><div class="ferr" id="fe-start_time" role="alert"></div></div>
      <div><label for="ir-e">Finish</label><input id="ir-e" name="end_time" type="time" value="${esc(it.end_time || '')}"><div class="ferr" id="fe-end_time" role="alert"></div></div>
      <div class="full"><label for="ir-a">Activity</label><input id="ir-a" name="activity" maxlength="255" value="${esc(it.activity)}" required><div class="ferr" id="fe-activity" role="alert"></div></div></div>
    <div class="err" role="alert"></div><div class="acts"><button type="button" class="btn sec" onclick="rekapDetail(${uid})">Batal</button><button class="btn" id="irsave">Simpan</button></div></form></div>`;
  $('#irf').onsubmit = async e => {
    e.preventDefault(); const f = e.target; $('#irsave').disabled = true;
    try { await api('/checkin-rekap/report/' + id, 'PUT', { start_time: f.start_time.value, end_time: f.end_time.value || null, activity: f.activity.value }); toast('Kegiatan dikoreksi'); rekapDetail(uid, ciDetail.from, ciDetail.to); ciRekap(); }
    catch (er) { $('#irsave').disabled = false; coaFieldErrors(er, f); }
  };
}

/* ---------- tombol Check In di Dashboard ---------- */
const goCheckin = () => { location.hash = '#checkin'; };
async function ciHomeBtn() {
  const b = $('#ci-home'); if (!b || !can('checkin.view')) return;
  try {
    const t = await api('/checkin/today'); if (!$('#ci-home')) return; const a = t.attendance;
    if (a && a.time) { b.classList.add('done'); b.querySelector('.ci-t').innerHTML = `<b>Check In ${esc(a.time)}</b><small>${esc(a.status)}${a.late ? ' · terlambat' : ''}</small>`; }
    else if (a) { b.classList.add('done'); b.querySelector('.ci-t').innerHTML = `<b>Check In</b><small>${esc(a.status)} (HR)</small>`; }
    else b.querySelector('.ci-t').innerHTML = '<b>Check In</b><small>Belum check in</small>';
  } catch { /* tombol tetap bisa dipakai */ }
}

// foto ukuran penuh (lapisan di atas modal lain)
function ciPhotoView(u) {
  document.getElementById('ci-ph')?.remove();
  const d = document.createElement('div'); d.id = 'ci-ph'; d.className = 'modal'; d.style.zIndex = 70; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Foto bukti absensi');
  d.innerHTML = `<div class="card" style="width:min(560px,100%);text-align:center"><img class="ciphfull" src="${ciPhotoSrc(u)}" alt="Foto bukti absensi"><div class="acts" style="justify-content:center"><button type="button" class="btn sec" id="ci-phx">Tutup</button></div></div>`;
  document.body.appendChild(d); const x = d.querySelector('#ci-phx'); x.onclick = () => d.remove(); d.onclick = e => { if (e.target === d) d.remove(); }; x.focus();
}
