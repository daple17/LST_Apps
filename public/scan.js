/* Scan Barcode lewat kamera. Memakai BarcodeDetector bila tersedia (Chrome/Android), jika tidak ZXing yang di-host sendiri
   (public/vendor/zxing-library.min.js, Apache-2.0) — iOS Safari belum punya BarcodeDetector. Selalu ada input manual (ketik / scanner USB). */
let zxingP;
const loadZxing = () => zxingP ||= new Promise((ok, no) => {
  if (window.ZXing) return ok(window.ZXing);
  const s = Object.assign(document.createElement('script'), { src: 'vendor/zxing-library.min.js', onload: () => ok(window.ZXing), onerror: () => no(new Error('Gagal memuat pemindai')) });
  document.head.appendChild(s);
});
const SCAN_FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'codabar', 'qr_code'];

// -> Promise<string|null> (null = dibatalkan)
function scanBarcode(title = 'Scan Barcode') {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal'; box.style.zIndex = 70;
    box.innerHTML = `<div class="card" style="width:min(520px,100%)"><h3 style="margin-top:0">${esc(title)}</h3>
      <div class="scanv"><video id="scv" playsinline muted></video><div class="scanl"></div></div>
      <div id="scs" class="warn-note" style="color:var(--mut);margin:8px 0">Arahkan kamera ke barcode pada label…</div>
      <form id="scf" class="bar" style="margin:0"><input id="sci" placeholder="Atau ketik / scan nomor lalu Enter" autocomplete="off"><button class="btn">OK</button></form>
      <div class="acts"><button type="button" class="btn sec" id="scx">Batal</button></div></div>`;
    document.body.appendChild(box);
    let stop = () => {}, done = false;
    const finish = v => { if (done) return; done = true; try { stop(); } catch { /* sudah berhenti */ } box.remove(); resolve(v); };
    const status = t => { const s = box.querySelector('#scs'); if (s) s.textContent = t; };
    box.querySelector('#scx').onclick = () => finish(null);
    box.querySelector('#scf').onsubmit = e => { e.preventDefault(); const v = box.querySelector('#sci').value.trim(); if (v) finish(v); };
    box.querySelector('#sci').focus();

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return status('Kamera tidak tersedia di browser ini (butuh HTTPS). Ketik nomornya di bawah.');
      const video = box.querySelector('#scv');
      try {
        if ('BarcodeDetector' in window) {
          const supported = await BarcodeDetector.getSupportedFormats?.().catch(() => SCAN_FORMATS) || SCAN_FORMATS;
          const det = new BarcodeDetector({ formats: SCAN_FORMATS.filter(f => supported.includes(f)) });
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
          video.srcObject = stream; await video.play();
          let live = true; stop = () => { live = false; stream.getTracks().forEach(t => t.stop()); };
          (async function loop() { while (live) { try { const r = await det.detect(video); if (r[0]?.rawValue) return finish(r[0].rawValue); } catch { /* frame belum siap */ } await new Promise(r => setTimeout(r, 150)); } })();
        } else {
          const Z = await loadZxing(), reader = new Z.BrowserMultiFormatReader();
          stop = () => reader.reset();
          await reader.decodeFromVideoDevice(undefined, video, r => { if (r) finish(r.getText()); });
        }
      } catch (e) { status(e.name === 'NotAllowedError' ? 'Izin kamera ditolak. Ketik nomornya di bawah.' : 'Kamera tidak bisa dibuka. Ketik nomornya di bawah.'); }
    })();
  });
}
