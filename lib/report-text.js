// Teks "Copy Report" untuk ditempel di WhatsApp. Format belum ditetapkan requirement: dibuat sederhana — ubah di sini saja.
const fmt = require('./format');
const pct = v => `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`; // 57% / 34,5% / 23,08%

function ticketReportText(t) {
  const lines = [
    `*HANDLING OPS ${t.ticket_no}*`,
    `PIC: ${t.pic_name}`,
    `Customer: ${t.customer || '-'}`,
    `Vessel: ${t.vessel || '-'}`,
    `Party: ${t.party || '-'} | Weight: ${fmt.fmtNum(t.weight)} ton`,
    '',
    `Report Material: ${pct(t.mat_pct)} (OK ${t.ok || 0} | Damage ${t.dm || 0} | Belum dicek ${t.nc || 0})`,
    `Trucking Delivery: ${pct(t.del_pct)} (${t.trips.length} rit)`,
  ];
  if (t.trips.length) {
    lines.push('', 'Truk:');
    t.trips.forEach((s, i) => lines.push(`${i + 1}. ${s.nopol} - ${s.driver}${s.vendor_code ? ` (${s.vendor_code})` : ''} - ${fmt.fmtNum(s.qty, 0)} ${s.unit || ''} - ${s.destination || '-'}`));
  }
  return lines.join('\n');
}
module.exports = { ticketReportText, pct };
