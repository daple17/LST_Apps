// Code 128 set B. Satu berkas dipakai server (PDF surat jalan) dan browser (/shared/code128.js) agar barcode-nya identik.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Code128 = factory();
}(this, function () {
  // nilai 0..102 -> lebar bar/spasi bergantian (11 modul)
  const P = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131'.split(' ');
  const START_B = 104, START_B_PATTERN = '211214', STOP_PATTERN = '2331112';

  // teks -> { values, pattern } ; hanya ASCII 32..126
  function encode(text) {
    const s = String(text);
    for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error('Karakter tidak didukung Code 128 set B: ' + ch); }
    if (!s) throw new Error('Teks barcode kosong');
    const data = [...s].map(ch => ch.charCodeAt(0) - 32);
    const check = (START_B + data.reduce((a, v, i) => a + v * (i + 1), 0)) % 103;
    const values = [START_B, ...data, check];
    return { values, check, pattern: START_B_PATTERN + [...data, check].map(v => P[v]).join('') + STOP_PATTERN };
  }
  // daftar bar hitam: [{x, w}] dalam satuan modul (quiet zone 10 modul di kiri/kanan), total lebar modul
  function bars(text, quiet = 10) {
    const { pattern } = encode(text), out = []; let x = quiet;
    [...pattern].forEach((d, i) => { const w = +d; if (i % 2 === 0) out.push({ x, w }); x += w; });
    return { bars: out, modules: x + quiet };
  }
  // moduleWidth bulat + latar putih: lebar modul pecahan membuat bar tidak rata di layar 1x, dan zona tenang transparan jadi gelap di mode gelap (keduanya membuat pemindai gagal). viewBox harus berproporsi sama dengan width/height, kalau tidak browser mengecilkan gambar (dulu 1 px per modul)
  function svg(text, { height = 64, moduleWidth = 2 } = {}) {
    const b = bars(text), mw = Math.round(moduleWidth), vh = height / mw;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${b.modules} ${vh}" width="${b.modules * mw}" height="${height}" role="img" aria-label="Barcode ${String(text).replace(/[<>&"]/g, '')}" shape-rendering="crispEdges"><rect width="${b.modules}" height="${vh}" fill="#fff"/>${b.bars.map(r => `<rect x="${r.x}" y="0" width="${r.w}" height="${vh}" fill="#000"/>`).join('')}</svg>`;
  }
  return { P, encode, bars, svg };
}));
