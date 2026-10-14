// Penomoran atomik: tabel `counters` dikunci per baris di dalam transaksi pemanggil, jadi
// dua simpan bersamaan tidak mendapat nomor sama dan nomor tidak turun/terpakai ulang walau data dihapus.
const { NUMBERING } = require('./rules');
const { pad } = require('./calc');
const TZ = 'Asia/Jakarta';

// tanggal/bulan menurut WIB, bukan zona server
function jktParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day };
}

async function next(conn, name, period = '') {
  await conn.query('INSERT INTO counters (name, period, last) VALUES (?,?,1) ON DUPLICATE KEY UPDATE last = last + 1', [name, period]);
  const [[r]] = await conn.query('SELECT last FROM counters WHERE name=? AND period=? FOR UPDATE', [name, period]);
  return r.last;
}

// format murni (diuji)
const formatJo = (seq, customerCode) => `${pad(seq, NUMBERING.jo.width)}${String(customerCode).toUpperCase()}`;
const formatTicket = (date, seq, initials) => { const t = jktParts(date); return `${t.y}${t.m}${t.d}${pad(seq, NUMBERING.ticket.width)}${String(initials || 'XX').toUpperCase()}`; };
const formatSj = (date, seq) => { const t = jktParts(date); return `${t.y}${t.m}${pad(seq, NUMBERING.sj.width)}`; };

// pembuat nomor (panggil di dalam transaksi yang sama dengan INSERT dokumennya)
const joNumber = async (conn, customerCode) => formatJo(await next(conn, 'JO', ''), customerCode);
const ticketNumber = async (conn, initials, date = new Date()) => { const t = jktParts(date); return formatTicket(date, await next(conn, 'TICKET', t.y + t.m), initials); };
const sjNumber = async (conn, date = new Date()) => { const t = jktParts(date); return formatSj(date, await next(conn, 'SJ', t.y + t.m)); };

module.exports = { TZ, jktParts, next, formatJo, formatTicket, formatSj, joNumber, ticketNumber, sjNumber };
