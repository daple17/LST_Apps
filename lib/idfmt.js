// Format & hitung tanggal ala Indonesia (zona Asia/Jakarta). Satu berkas untuk server dan browser (/shared/idfmt.js) — diuji di tests/idfmt.test.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.IdFmt = factory();
}(this, function () {
  const TZ = 'Asia/Jakarta';
  const toDate = v => (v instanceof Date ? v : new Date(typeof v === 'number' ? v : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v + 'T00:00:00+07:00' : String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')));
  const parts = (d, o) => Object.fromEntries(new Intl.DateTimeFormat('id-ID', { timeZone: TZ, ...o }).formatToParts(toDate(d)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));

  // "Senin, 10 Juni 2025" (header)
  const longDate = d => { const p = parts(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return `${p.weekday[0].toUpperCase()}${p.weekday.slice(1)}, ${p.day} ${p.month} ${p.year}`; };
  // "10 Jun 2025" (tabel)
  const shortDate = d => { if (!d) return '-'; const p = parts(d, { day: 'numeric', month: 'short', year: 'numeric' }); return `${p.day} ${p.month.replace('.', '')} ${p.year}`; };
  // 'YYYY-MM-DD' menurut WIB
  const jktDay = d => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(toDate(d)).filter(x => x.type !== 'literal').map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
  // Age: selisih hari antara hari ini (WIB) dan tanggal dokumen; +N, hari yang sama = 0
  const ageDays = (docDate, now = new Date()) => Math.round((Date.parse(jktDay(now) + 'T00:00:00Z') - Date.parse(jktDay(docDate) + 'T00:00:00Z')) / 86400000);
  const ageLabel = n => (n > 0 ? `+${n}` : String(n));
  const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
  // singkatan customer untuk ponsel: buang awalan badan usaha (PT/CV/UD), kata pertama saja bila masih panjang
  const shortCustomer = (name, max = 22) => { const s = String(name || '').replace(/^\s*(PT|CV|UD)\.?\s+/i, '').trim(); return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…'; };
  return { TZ, longDate, shortDate, jktDay, ageDays, ageLabel, firstName, shortCustomer };
}));
