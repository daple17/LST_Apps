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
    { header: 'No. SI/DO', key: 'si_do', width: 18 }, { header: 'No. SI/PO', key: 'si_po', width: 18 }, { header: 'Nopen', key: 'nopen', width: 16 },
    { header: 'Jenis Muatan', key: 'muatan', width: 12 }, { header: 'Vessel', key: 'vessel', width: 20 }, { header: 'Party', key: 'party', width: 12 },
    { header: 'Weight (ton)', key: 'weight', width: 13, numFmt: '#,##0.00' }, { header: 'ETA/ETD', key: 'eta', width: 13, numFmt: 'dd-mmm-yyyy' },
    { header: 'Rencana Delivery', key: 'plan', width: 16, numFmt: 'dd-mmm-yyyy' }, { header: 'Status', key: 'status', width: 14 }, { header: 'Remarks', key: 'remarks', width: 30 },
  ];
  const data = rows.map(j => {
    const refs = refsByJo.get(j.id) || [];
    return { no_jo: j.no_jo, type: typeLabel[j.type] || j.type, type_bc: j.type_bc, customer: j.customer_name, shipper: j.shipper_name,
      aju: joinRefs(refs, 'AJU'), invoice: joinRefs(refs, 'INVOICE'), bl: joinRefs(refs, 'BL'), si_do: joinRefs(refs, 'SI_DO'), si_po: joinRefs(refs, 'SI_PO'), nopen: joinRefs(refs, 'NOPEN'),
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

// template Upload List: kolom persis seperti form Add data + satu baris contoh + petunjuk
function materialTemplateSheets() {
  const { COLUMNS } = require('./material-validate');
  const example = { product_no: 'CQH4162B', kondisi: 'Intact', spec: 'JAC270C', description: 'GALVANIZED COIL', thickness: 0.7, width: 1245, shape: 'C', net_weight: 8120, gross_weight: 8187, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG' };
  return [
    { name: 'Material', columns: COLUMNS.map(c => ({ header: c.header + (c.req ? '*' : ''), key: c.key, width: c.width })), rows: [example] },
    { name: 'Petunjuk', columns: [{ header: 'Kolom', key: 'k', width: 26 }, { header: 'Wajib', key: 'r', width: 8 }, { header: 'Keterangan', key: 'n', width: 50 }],
      rows: COLUMNS.map(c => ({ k: c.header, r: c.req ? 'Ya' : 'Tidak', n: c.note || '' })).concat([{ k: '', r: '', n: 'Baris 2 adalah contoh — hapus atau timpa. Nomor produk tidak boleh ganda dalam satu JO.' }]) },
  ];
}

const calc = require('./calc');
const STATUS = { NOT_CHECKED: 'Not Checked', OK: 'OK', DAMAGE: 'Damage' };
// daftar tiket Handling Ops (semua kolom tabel)
function ticketSheets(rows) {
  return [{ name: 'Handling Ops', columns: [
    { header: 'No. Ticket', key: 'no', width: 16 }, { header: 'PIC', key: 'pic', width: 22 }, { header: 'Customer', key: 'customer', width: 36 }, { header: 'Vessel', key: 'vessel', width: 22 }, { header: 'Party', key: 'party', width: 16 },
    { header: 'Weight (ton)', key: 'weight', width: 13, numFmt: '#,##0.00' }, { header: 'Dwelling time', key: 'dwell', width: 18 },
    { header: 'Report Material (%)', key: 'mat', width: 18, numFmt: '0.00' }, { header: 'Trucking Delivery (%)', key: 'del', width: 20, numFmt: '0.00' }, { header: 'Dibuat', key: 'created', width: 18, numFmt: 'dd-mmm-yyyy hh:mm' },
  ], rows: rows.map(t => ({ no: t.ticket_no, pic: t.pic_name, customer: t.customers.join(', '), vessel: t.vessels.join(', '), party: t.parties.join(', '), weight: t.weight, dwell: calc.formatDwell(t.dwell_min), mat: t.mat_pct, del: t.del_pct, created: new Date(calc.toMs(t.created_at)) })) }];
}
// Report Material satu tiket: semua material + status dan remarks
function reportMaterialSheets(materials) {
  return [{ name: 'Report Material', columns: [
    { header: 'No', key: 'n', width: 6 }, { header: 'No. JO', key: 'jo', width: 12 }, { header: 'Product/Container No', key: 'product_no', width: 22 }, { header: 'Description', key: 'description', width: 26 }, { header: 'Spec', key: 'spec', width: 14 },
    { header: 'Thickness', key: 'thickness', width: 11, numFmt: '0.00' }, { header: 'Width', key: 'width', width: 10, numFmt: '#,##0.00' }, { header: 'Shape', key: 'shape', width: 8 },
    { header: 'Net Weight (kg)', key: 'net', width: 15, numFmt: '#,##0.00' }, { header: 'Gross Weight (kg)', key: 'gross', width: 17, numFmt: '#,##0.00' }, { header: 'Qty', key: 'qty', width: 8 }, { header: 'Satuan', key: 'unit', width: 10 },
    { header: 'Dari', key: 'origin', width: 16 }, { header: 'Tujuan', key: 'destination', width: 22 }, { header: 'Status', key: 'status', width: 13 }, { header: 'Remarks', key: 'remarks', width: 34 },
    { header: 'Diperiksa oleh', key: 'by', width: 20 }, { header: 'Waktu periksa', key: 'at', width: 18, numFmt: 'dd-mmm-yyyy hh:mm' }, { header: 'Surat Jalan', key: 'sj', width: 22 },
  ], rows: materials.map((m, i) => ({ n: i + 1, jo: m.jo_no, product_no: m.product_no, description: m.description, spec: m.spec, thickness: m.thickness == null ? null : +m.thickness, width: m.width == null ? null : +m.width, shape: m.shape,
    net: +m.net_weight, gross: +m.gross_weight, qty: m.qty, unit: m.unit, origin: m.origin, destination: m.destination, status: STATUS[m.check_status] || m.check_status, remarks: m.remarks, by: m.checked_by, at: m.checked_at ? new Date(calc.toMs(m.checked_at)) : null, sj: m.sj_nos })) }];
}
module.exports = { joSheets, materialTemplateSheets, ticketSheets, reportMaterialSheets };
