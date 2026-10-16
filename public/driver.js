/* Halaman driver LESAT (tanpa login). Alur: verifikasi 4 angka nopol -> langkah berikutnya -> bukti terima (foto). Sesi di sessionStorage. */
(() => {
  'use strict';
  const token = location.pathname.split('/')[2] || '', API = `/api/pub/d/${token}`, SK = 'lesat-driver-' + token.slice(-12), app = document.getElementById('app');
  const LABEL = { STARTED: 'Berangkat ke lokasi muat', ARRIVED_PICKUP: 'Tiba di lokasi muat', LOADED: 'Selesai muat', IN_TRANSIT: 'Dalam perjalanan', ARRIVED_DEST: 'Tiba di tujuan', DELIVERED: 'Diterima', READY: 'Siap berangkat' };
  const BTN = { STARTED: 'Saya berangkat ke lokasi muat', ARRIVED_PICKUP: 'Saya tiba di lokasi muat', LOADED: 'Muat selesai', IN_TRANSIT: 'Saya berangkat ke tujuan', ARRIVED_DEST: 'Saya sudah tiba di tujuan', DELIVERED: 'Barang sudah diterima' };
  const STEPS = ['STARTED', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED'];
  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = iso => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
  const CHECK = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5L5 9.5L10 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const sess = { get: () => { try { return sessionStorage.getItem(SK); } catch { return null; } }, set: v => { try { v ? sessionStorage.setItem(SK, v) : sessionStorage.removeItem(SK); } catch { /* sessionStorage diblokir: sesi hanya di memori */ } } };
  let memSess = null;

  async function call(method, path, body) {
    const s = sess.get() || memSess, headers = { 'Content-Type': 'application/json' }; if (s) headers.Authorization = 'Bearer ' + s;
    let r; try { r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer' }); } catch { throw Object.assign(new Error('Tidak ada sinyal. Periksa koneksi lalu coba lagi.'), { offline: true }); }
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'Terjadi kesalahan'), { status: r.status, data: d }); return d;
  }
  const shell = (inner, no) => { app.innerHTML = `<div class="top"><span class="brand">LESAT</span>${no ? `<span class="no">${e(no)}</span>` : ''}</div>${inner}`; app.scrollIntoView?.(); };
  const notice = (title, text, no) => shell(`<h1>${e(title)}</h1><p class="muted">${e(text)}</p>`, no);
  const lockedText = { belum_siap: ['Belum siap', 'Surat jalan ini belum ditandai siap oleh operasional. Hubungi operasional.'], terkunci: ['Tautan terkunci', 'Terlalu banyak salah memasukkan nomor polisi. Hubungi operasional untuk membuka kunci.'], dicabut: ['Tautan tidak berlaku', 'Tautan ini sudah dicabut. Minta tautan baru dari operasional.'], selesai: ['Pengiriman selesai', 'Terima kasih. Pengiriman ini sudah ditutup oleh operasional.'] };

  async function start() {
    try {
      const info = await call('GET', '');
      if (info.state !== 'aktif') { const [t, x] = lockedText[info.state] || lockedText.dicabut; return notice(t, x, info.no_sj); }
      if (sess.get() || memSess) { try { return await home(info); } catch (er) { if (er.status !== 401) throw er; sess.set(null); memSess = null; } }
      if (!info.verify) { const r = await call('POST', '/verify', {}); memSess = r.session; sess.set(r.session); return await home(info); }     // verifikasi nopol dimatikan: langsung masuk
      verifyScreen(info);
    } catch (er) { er.status === 404 ? notice('Tautan tidak valid', 'Periksa kembali tautan yang Anda terima dari operasional.') : retryScreen(er); }
  }
  const retryScreen = er => { shell(`<h1>${er.offline ? 'Tidak ada sinyal' : 'Terjadi kesalahan'}</h1><p class="muted">${e(er.message)}</p><div class="spacer"></div><button class="btn" id="retry">Coba lagi</button>`); document.getElementById('retry').onclick = start; };

  /* ---------- 1. verifikasi ---------- */
  function verifyScreen(info) {
    shell(`<h1>Halo, driver</h1><p class="muted">Surat jalan <span class="mono" style="color:var(--ink)">${e(info.no_sj)}</span> menunggu Anda. Masukkan 4 angka terakhir nomor polisi truk untuk melanjutkan.</p>
      <div class="card"><div class="k">Rute</div><div class="v">${e(info.from || '-')} &rarr; ${e(info.to || '-')}</div></div>
      <label class="f" id="pl" for="d0">4 angka nomor polisi</label><div class="pin" id="pin" role="group" aria-labelledby="pl">${[0, 1, 2, 3].map(i => `<input id="d${i}" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-label="Angka ${i + 1}">`).join('')}</div>
      <div class="msg err" id="vm" role="alert"></div><p class="muted small">Contoh: untuk B 9123 ABC, masukkan 9123. Salah 5 kali, tautan terkunci dan operasional akan dihubungi.</p>
      <div class="spacer"></div><button class="btn" id="go" disabled>Lanjutkan</button><p class="muted small" style="text-align:center;margin:16px 0 0">Tidak perlu login. Tautan ini hanya untuk satu surat jalan.</p>`, info.no_sj);
    const ins = [...document.querySelectorAll('#pin input')], go = document.getElementById('go'), val = () => ins.map(i => i.value).join('');
    const sync = () => { go.disabled = !val(); document.getElementById('pin').classList.remove('err'); };
    ins.forEach((el, i) => {
      el.oninput = () => { el.value = el.value.replace(/\D/g, '').slice(-1); if (el.value && ins[i + 1]) ins[i + 1].focus(); sync(); };
      el.onkeydown = ev => { if (ev.key === 'Backspace' && !el.value && ins[i - 1]) { ins[i - 1].focus(); ins[i - 1].value = ''; sync(); } if (ev.key === 'Enter' && !go.disabled) go.click(); };
      el.onpaste = ev => { const t = (ev.clipboardData.getData('text') || '').replace(/\D/g, ''); if (!t) return; ev.preventDefault(); [...t.slice(-4)].forEach((c, k) => { ins[k].value = c; }); ins[Math.min(3, t.length - 1)].focus(); sync(); };
    });
    ins[0].focus();
    go.onclick = async () => {
      go.disabled = true; const m = document.getElementById('vm'); m.textContent = '';
      try { const r = await call('POST', '/verify', { digits: val() }); memSess = r.session; sess.set(r.session); await home(info); }
      catch (er) {
        go.disabled = false; document.getElementById('pin').classList.add('err');
        if (er.data?.state && er.data.state !== 'aktif') { const [t, x] = lockedText[er.data.state]; return notice(t, x, info.no_sj); }
        m.textContent = er.status === 401 ? `Angka tidak cocok. Sisa percobaan: ${er.data?.left ?? '-'}.` : er.status === 429 ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' : er.message;
        ins.forEach(i => { i.value = ''; }); ins[0].focus(); go.disabled = true;
      }
    };
  }

  /* ---------- 2. langkah berikutnya ---------- */
  async function home(info) {
    const d = await call('GET', '/sj');
    if (d.status === 'DELIVERED' || d.status === 'COMPLETED') return doneScreen(d);
    const real = d.timeline.filter(t => STEPS.includes(t.status)), doneN = real.filter(t => !t.skipped).length, skippedN = real.filter(t => t.skipped).length, since = d.timeline.at(-1);
    const next = d.next[0], opt = d.next[1];
    const cur = d.status === 'READY' ? 'Siap berangkat' : LABEL[d.status];
    const rows = real.filter(t => !t.skipped).slice(-2).map(t => `<div class="step"><span class="dot">${CHECK}</span><span class="t">${e(LABEL[t.status])}</span><span class="at">${clock(t.at)}</span></div>`).join('');
    shell(`<div class="card"><div class="route"><div><div class="k">Muat di</div><div class="v">${e(d.from || '-')}</div></div><span class="ar" aria-hidden="true">&rarr;</span><div><div class="k">Tujuan</div><div class="v">${e(d.to || '-')}</div></div></div>
      <div class="sum">${d.items} item · ${d.qty} qty · ${String(d.ton).replace('.', ',')} ton · ${e(d.nopol)}</div></div>
      <div class="seg" role="img" aria-label="Langkah ${doneN + skippedN} dari ${STEPS.length}">${STEPS.map(s => { const t = real.find(x => x.status === s); return `<b class="${t ? (t.skipped ? 'sk' : 'on') : ''}"></b>`; }).join('')}</div>
      <p class="muted small" style="margin-bottom:24px">Langkah ${doneN + skippedN} dari ${STEPS.length} selesai</p>
      <div class="muted small">Status sekarang</div><div class="cur">${e(cur)}</div><p class="muted" style="margin-bottom:24px">${since ? `Sejak ${clock(since.at)}. ` : ''}${next ? 'Jika sudah, tekan tombol di bawah.' : ''}</p>
      ${rows}<div class="spacer"></div><div class="msg err" id="sm" role="alert"></div>
      ${next ? `<label class="chk"><input type="checkbox" id="loc"> Sertakan lokasi saat ini (boleh dilewati)</label><button class="btn big" id="nx">${e(BTN[next.status])}</button>${opt && !next.deliver ? `<button class="btn ghost" id="sk">Lewati langkah ini (langsung: ${e(BTN[opt.status])})</button>` : ''}` : '<p class="muted">Tidak ada langkah yang tersedia. Hubungi operasional.</p>'}
      <p class="muted small" style="text-align:center;margin:12px 0 0">Salah tekan? Hubungi operasional untuk koreksi.</p>`, d.no_sj);
    const act = async target => {
      const btns = [...app.querySelectorAll('button')]; btns.forEach(b => { b.disabled = true; }); const m = document.getElementById('sm'); m.textContent = '';
      try {
        if (target.deliver) return deliverScreen(d);
        const loc = document.getElementById('loc').checked ? await place() : {};
        await call('POST', '/step', { status: target.status, ...loc }); await home(info);
      } catch (er) {
        if (er.status === 401) { sess.set(null); memSess = null; return start(); }
        if (er.status === 409 && er.data?.state && er.data.state !== 'aktif') return start();
        m.textContent = er.status === 409 ? 'Langkah ini sudah berubah. Halaman dimuat ulang.' : er.message; btns.forEach(b => { b.disabled = false; }); if (er.status === 409) setTimeout(() => home(info).catch(retryScreen), 1200);
      }
    };
    if (next) document.getElementById('nx').onclick = () => act(next);
    document.getElementById('sk')?.addEventListener('click', () => act(opt));
  }
  // lokasi hanya bila dicentang; gagal/ditolak -> lanjut tanpa lokasi
  const place = () => new Promise(ok => { if (!navigator.geolocation) return ok({}); navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok({}), { timeout: 8000, maximumAge: 60000 }); });

  /* ---------- 3. bukti terima ---------- */
  function deliverScreen(d) {
    let blob = null;
    shell(`<h1>Barang sudah diterima</h1><p class="muted">Foto surat jalan yang sudah ditandatangani penerima. Foto ini wajib sebagai bukti.</p>
      <button type="button" class="pick" id="pk" aria-label="Ambil foto surat jalan"><svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" fill="none" stroke="#5B6577" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="#5B6577" stroke-width="1.6"/></svg><span>Ketuk untuk mengambil foto</span><span class="h">Pastikan tanda tangan dan stempel terbaca</span></button>
      <input type="file" id="fi" accept="image/*" capture="environment" hidden>
      <label class="f" for="rn">Nama penerima (boleh dikosongkan)</label><input class="txt" id="rn" maxlength="100" placeholder="Contoh: Pak Dedi" autocomplete="off">
      <label class="chk"><input type="checkbox" id="loc"> Sertakan lokasi saat ini (boleh dilewati)</label>
      <div class="msg ok">Setelah dikirim, operasional akan memeriksa foto lalu menutup pengiriman ini.</div><div class="msg err" id="dm" role="alert"></div>
      <div class="spacer"></div><button class="btn big" id="sd" disabled>Kirim bukti terima</button><p class="muted small" style="text-align:center;margin:12px 0 0" id="hint">Tombol aktif setelah foto diambil.</p><button class="btn ghost" id="bk">Kembali</button>`, d.no_sj);
    const fi = document.getElementById('fi'), sd = document.getElementById('sd'), dm = document.getElementById('dm');
    document.getElementById('pk').onclick = () => fi.click();
    document.getElementById('bk').onclick = () => home().catch(retryScreen);
    fi.onchange = async () => {
      const f = fi.files[0]; if (!f) return; dm.textContent = '';
      try { blob = await compress(f); const pk = document.getElementById('pk'); pk.innerHTML = `<img alt="Pratinjau foto surat jalan" src="${URL.createObjectURL(blob)}">`; sd.disabled = false; document.getElementById('hint').textContent = 'Ketuk foto untuk mengganti.'; }
      catch { blob = null; sd.disabled = true; dm.textContent = 'Foto tidak bisa dibaca. Coba ambil ulang.'; }
    };
    sd.onclick = async () => {
      sd.disabled = true; dm.textContent = '';
      try {
        const loc = document.getElementById('loc').checked ? await place() : {};
        await call('POST', '/deliver', { filename: 'bukti-terima.jpg', data: await b64(blob), receiver_name: document.getElementById('rn').value, ...loc });
        const x = await call('GET', '/sj').catch(() => d); doneScreen(x);
      } catch (er) {
        if (er.status === 401) { sess.set(null); memSess = null; return start(); }
        dm.textContent = er.message; sd.disabled = false;        // coba lagi aman: server tidak membuat event ganda
      }
    };
  }
  function doneScreen(d) {
    shell(`<div class="done"><div class="ic">${CHECK.replace(/width="11" height="11"/, 'width="30" height="30"')}</div><h1>Terima kasih</h1><p class="muted">${d.status === 'COMPLETED' ? 'Pengiriman ini sudah ditutup oleh operasional.' : 'Bukti terima sudah dikirim. Menunggu penutupan oleh operasional.'}</p></div>`, d.no_sj);
  }

  /* ---------- foto: kompres di klien (maks 1600 px, JPEG) ---------- */
  async function compress(file) {
    const MAX = 1600, bmp = await (window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file)) : Promise.reject(new Error('x')));
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('x'))), 'image/jpeg', 0.82));
  }
  const b64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });

  start();
})();
