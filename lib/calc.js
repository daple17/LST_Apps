// Rumus murni (tanpa DB) — diuji di tests/calc.test.js. Semua angka yang tampil di tabel/Excel/PDF/Copy Report berasal dari sini.
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const pad = (n, l = 2) => String(n).padStart(l, '0');

// 'YYYY-MM-DD HH:MM:SS' (UTC, dari MySQL) | Date | ms | ISO -> ms
function toMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : t;
}
const minutesBetween = (a, b) => {
  const x = toMs(a), y = toMs(b);
  return x == null || y == null ? null : Math.max(0, Math.floor((y - x) / 60000));
};

// Dwelling time: (sekarang | waktu tiket selesai) - waktu tiket dibuat
const dwellMinutes = (createdAt, doneAt, now = Date.now()) => minutesBetween(createdAt, doneAt || now);
const formatDwell = m => (m == null ? '-' : `${Math.floor(m / 1440)} D : ${pad(Math.floor(m / 60) % 24)} H : ${pad(m % 60)} M`);
// Load time: finish loading - start loading
const loadMinutes = (start, finish) => (start && finish ? minutesBetween(start, finish) : null);
const formatLoad = m => (m == null ? '-' : `${Math.floor(m / 60)} H ${m % 60} M`);

// Report Material %: material berstatus OK atau Damage / semua material di tiket
const reportPct = (checked, total) => (total > 0 ? round2((100 * checked) / total) : 0);
// Trucking Delivery %: qty di surat jalan / total qty di tiket (tidak lebih dari 100)
const deliveryPct = (sentQty, totalQty) => (totalQty > 0 ? round2((100 * Math.min(sentQty, totalQty)) / totalQty) : 0);
// Progres tiket untuk tab: nilai terendah dari dua persen (aturan di rules.PROGRESS_RULE)
const ticketProgress = (matPct, delPct, rule = 'min') => (rule === 'avg' ? round2((matPct + delPct) / 2) : Math.min(matPct, delPct));
const progressBucket = p => (p >= 100 ? 'done' : p >= 50 ? 'mid' : 'low');

const kgToTon = kg => round2(Number(kg || 0) / 1000);
const tonToKg = t => round2(Number(t || 0) * 1000);
const sum = a => a.reduce((s, x) => s + Number(x || 0), 0);
// Total berat JO (ton) = jumlah net weight material (kg) / 1000
const joTotalTon = netKgs => kgToTon(sum(netKgs));
// Total di surat jalan (MT) = jumlah berat material di surat jalan (kg) / 1000
const sjTotalMT = weightsKg => kgToTon(sum(weightsKg));
// berat deklarasi vs total material berbeda lebih dari pct%?
const weightMismatch = (declaredKg, materialsKg, pct = 0.5) =>
  declaredKg > 0 && materialsKg > 0 && (Math.abs(declaredKg - materialsKg) / declaredKg) * 100 > pct;

module.exports = { round2, pad, toMs, minutesBetween, dwellMinutes, formatDwell, loadMinutes, formatLoad, reportPct, deliveryPct, ticketProgress, progressBucket, kgToTon, tonToKg, sum, joTotalTon, sjTotalMT, weightMismatch };
