// Menyusun isi unduhan Excel (murni, tanpa DB — diuji di tests/exports.test.js)
const { toDate } = require('./excel');
const rules = require('./rules');

const kindLabel = Object.fromEntries(rules.REF_KINDS.map(k => [k.code, k.label]));
const typeLabel = Object.fromEntries(rules.JO_TYPES.map(t => [t.code, t.label]));
const muatanLabel = Object.fromEntries(rules.JENIS_MUATAN.map(t => [t.code, t.label]));
const joinRefs = (refs, kind) => refs.filter(r => r.kind === kind).map(r => r.number).join(', ');

// rows: baris JO (hasil shape()), refsByJo: Map(jo_id -> [{kind, number, ref_date}])
function joSheets(rows, refsByJo) {
  const columns = [
    { header: 'No. JO', key: 'no_jo', width: 14 }, { header: 'Type', key: 'type', width: 11 }, { header: 'Type BC', key: 'type_bc', width: 10 },
    { header: 'Customer', key: 'customer', width: 36 }, { header: 'Shipper', key: 'shipper', width: 26 },
    { header: 'Aju Ceisa', key: 'aju', width: 22 }, { header: 'No. Invoice', key: 'invoice', width: 22 }, { header: 'No. BL', key: 'bl', width: 22 },
    { header: 'No. SI/DO', key: 'si_do', width: 18 }, { header: 'No. SI/PO', key: 'si_po', width: 18 },
    { header: 'Jenis Muatan', key: 'muatan', width: 12 }, { header: 'Vessel', key: 'vessel', width: 20 }, { header: 'Party', key: 'party', width: 12 },
    { header: 'Weight (ton)', key: 'weight', width: 13, numFmt: '#,##0.00' }, { header: 'ETA/ETD', key: 'eta', width: 13, numFmt: 'dd-mmm-yyyy' },
    { header: 'Rencana Delivery', key: 'plan', width: 16, numFmt: 'dd-mmm-yyyy' }, { header: 'Status', key: 'status', width: 14 }, { header: 'Remarks', key: 'remarks', width: 30 },
  ];
  const data = rows.map(j => {
    const refs = refsByJo.get(j.id) || [];
    return { no_jo: j.no_jo, type: typeLabel[j.type] || j.type, type_bc: j.type_bc, customer: j.customer_name, shipper: j.shipper_name,
      aju: joinRefs(refs, 'AJU'), invoice: joinRefs(refs, 'INVOICE'), bl: joinRefs(refs, 'BL'), si_do: joinRefs(refs, 'SI_DO'), si_po: joinRefs(refs, 'SI_PO'),
      muatan: muatanLabel[j.jenis_muatan] || j.jenis_muatan, vessel: j.vessel, party: j.party, weight: j.weight, eta: toDate(j.eta_etd), plan: toDate(j.delivery_plan),
      status: j.status === 'COMPLETE' ? 'Complete' : 'Not Complete', remarks: j.remarks };
  });
  // sheet kedua: satu baris per nomor referensi (semua nomor, termasuk tanggalnya)
  const refRows = rows.flatMap(j => (refsByJo.get(j.id) || []).map(r => ({ no_jo: j.no_jo, customer: j.customer_name, kind: kindLabel[r.kind] || r.kind, number: r.number, date: toDate(r.ref_date) })));
  return [
    { name: 'Job Order', columns, rows: data },
    { name: 'Referensi', columns: [{ header: 'No. JO', key: 'no_jo', width: 14 }, { header: 'Customer', key: 'customer', width: 36 }, { header: 'Jenis', key: 'kind', width: 14 }, { header: 'Nomor', key: 'number', width: 24 }, { header: 'Tanggal', key: 'date', width: 13, numFmt: 'dd-mmm-yyyy' }], rows: refRows },
  ];
}
module.exports = { joSheets };
