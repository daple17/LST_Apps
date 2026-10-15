// Impor Job Order (job_order -> job_orders + jo_references + jo_containers + jo_checklist). Validasi LESAT TIDAK dijalankan saat impor; yang gagal validasi hanya dihitung.
const M = require('../../lib/legacy-map');
const rules = require('../../lib/rules');
const { validateJo } = require('../../lib/jo-validate');
const { dt, dtt, trunc } = require('./common');

const COLS = ['legacy_id', 'no_jo', 'legacy_no', 'type', 'type_bc', 'jenis_muatan', 'customer_id', 'shipper_id', 'vessel', 'remarks', 'jo_date', 'created_at', 'created_by', 'origin', 'eta_etd', 'etd', 'delivery_plan',
  'port_loading_id', 'port_dest_id', 'tps_id', 'status', 'legacy_status', 'completed_at', 'weight_kg', 'cbm', 'qty', 'unit', 'party_text', 'container_count', 'container_type'];
const NO_UPDATE = new Set(['legacy_id', 'delivery_plan', 'created_by']);   // delivery_plan tidak ada di sistem lama: jangan menimpa isian pengguna saat impor diulang
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

exports.job_orders = async ctx => {
  const s = ctx.st('job_orders'), rows = await ctx.L('SELECT * FROM job_order ORDER BY id'); s.source = rows.length;
  const custs = new Map((await ctx.q('SELECT id, code, legacy_id FROM customers WHERE legacy_id IS NOT NULL')).map(c => [Number(c.legacy_id), c]));
  const [shippers, users, ports, tps, had] = await Promise.all([ctx.legacyMap('shippers'), ctx.legacyMap('users'), ctx.legacyMap('ports'), ctx.legacyMap('tps_warehouses'), ctx.legacyMap('job_orders')]);
  const noUsed = new Map((await ctx.q('SELECT no_jo, legacy_id FROM job_orders')).map(r => [r.no_jo, r.legacy_id == null ? null : Number(r.legacy_id)]));
  const out = [], refsBy = new Map(), contBy = new Map(), unmapped = new Map(), vfail = { total: 0, fields: {}, byType: {}, noPlan: 0, noPlanFields: {} }, d = (k, n = 1) => ctx.detail('job_orders', k, n);

  for (const r of rows) {
    const cust = custs.get(Number(r.IdCustomer)), type = M.jobType(r.JobOrderType);
    if (!cust) { ctx.quar('job_orders', r.id, 'customer tidak ada atau customernya tidak diimpor (nickname kosong/ganda)', { id: r.id, NoJobOrder: r.NoJobOrder, IdCustomer: r.IdCustomer }); continue; }
    if (!type) { ctx.quar('job_orders', r.id, `JobOrderType ${r.JobOrderType} tidak dikenal`, { id: r.id, NoJobOrder: r.NoJobOrder }); continue; }
    const num = M.joNumber(r.NoJobOrder, cust.code);
    if (!num.no_jo) { ctx.quar('job_orders', r.id, 'NoJobOrder kosong/tidak valid', { id: r.id }); continue; }
    if (noUsed.has(num.no_jo) && noUsed.get(num.no_jo) !== Number(r.id)) { ctx.quar('job_orders', r.id, `no_jo ${num.no_jo} sudah dipakai JO lain di LESAT (bukan hasil impor ini)`, { id: r.id, NoJobOrder: r.NoJobOrder }); continue; }
    noUsed.set(num.no_jo, Number(r.id));

    const status = M.statusJo(r.StatusJo), doneDate = dt(r.JobCompleteDate);
    if (status === 'NOT_COMP' && doneDate) d('anomali_status0_tapi_ada_tanggal_selesai');          // tidak diisi ke completed_at
    const etd = dt(r.DateEtd), eta = dt(r.DateEta);
    const etaEtd = type === 'IMPORT' ? eta : type === 'EXPORT' ? (etd || eta) : (eta || etd);       // Trucking/Project: keputusan sendiri, tanggal yang ada
    const cont = M.containers(r), unit = M.unitMap(r.lcl_satuan_qty);
    if (unit.party_text) unmapped.set(unit.party_text.toUpperCase(), (unmapped.get(unit.party_text.toUpperCase()) || 0) + 1);
    let qty = r.lcl_qty == null ? null : Number(r.lcl_qty); if (qty != null && !Number.isFinite(qty)) qty = null;
    if (qty != null && qty > 0 && !Number.isInteger(qty)) { d('qty_pecahan_dibulatkan'); qty = Math.round(qty); }
    if (!qty) qty = null;
    const weightKg = r.lcl_ton > 0 ? M.tonToKg(r.lcl_ton) : null, cbm = r.lcl_m3 > 0 ? Number(r.lcl_m3) : null;
    const jo = { legacy_id: r.id, no_jo: num.no_jo, legacy_no: num.legacy_no, type, type_bc: M.typeBc(r.ImportType), jenis_muatan: M.jenisMuatan(r.jenis_party), customer_id: cust.id,
      shipper_id: Number(r.id_shipper) > 0 ? (shippers.get(Number(r.id_shipper)) ?? null) : null, vessel: trunc(M.cleanText(r.Vessel), 100), remarks: M.cleanText(r.Remark),
      jo_date: dt(r.Tanggal), created_at: dtt(r.DateCreated) || (dt(r.Tanggal) ? dt(r.Tanggal) + ' 00:00:00' : null), created_by: users.get(Number(r.User_id)) ?? null, origin: 'LEGACY',
      eta_etd: etaEtd, etd, delivery_plan: null, port_loading_id: Number(r.PortofLoading_id) > 0 ? (ports.get(Number(r.PortofLoading_id)) ?? null) : null,
      port_dest_id: Number(r.PortofDestination_id) > 0 ? (ports.get(Number(r.PortofDestination_id)) ?? null) : null, tps_id: Number(r.WareHouseTps_id) > 0 ? (tps.get(Number(r.WareHouseTps_id)) ?? null) : null,
      status, legacy_status: r.StatusJo == null ? null : Number(r.StatusJo), completed_at: status === 'COMPLETE' ? doneDate : null, weight_kg: weightKg, cbm, qty, unit: unit.unit, party_text: unit.party_text,
      container_count: cont.container_count, container_type: cont.container_type };
    if (Number(r.id_shipper) > 0 && jo.shipper_id == null) d('shipper_tidak_ditemukan');
    if (Number(r.PortofLoading_id) > 0 && jo.port_loading_id == null) d('pelabuhan_muat_tidak_ditemukan');
    if (Number(r.PortofDestination_id) > 0 && jo.port_dest_id == null) d('pelabuhan_tujuan_tidak_ditemukan');
    if (Number(r.WareHouseTps_id) > 0 && jo.tps_id == null) d('tps_tidak_ditemukan');
    out.push(jo);

    // referensi (satu nomor per baris)
    const refs = [], seen = new Set(), add = (kind, text, date) => M.splitRefsLegacy(text).forEach((n, i) => { const number = trunc(n, 80), k = `${kind}|${number}`; if (seen.has(k)) return; seen.add(k); if (n.length > 80) d('referensi_dipotong'); refs.push({ kind, number, ref_date: date, sort: i }); });
    add('INVOICE', r.Invoice, null); add('BL', r.NoBL, dt(r.NoBLDate)); add('HBL', r.NoHbl, dt(r.HblDate)); add('AJU', r.NoAju, null); add(M.siKind(type), r.NoSiDo, dt(r.NoSiDoDate));
    refsBy.set(Number(r.id), refs); contBy.set(Number(r.id), cont.list);
    if (!r.NoSiDo || M.splitRefsLegacy(r.NoSiDo).length === 0) { /* tidak ada SI/DO: normal */ }
    for (const f of ['NoBc2', 'NoPib', 'Spk', 'Consignee']) if (M.cleanText(r[f])) d(`kolom_${f}_terisi_tidak_dimigrasi`);

    // JO yang akan gagal validasi LESAT (hanya dihitung)
    const errs = validateJo({ type, customer_id: cust.id, jenis_muatan: jo.jenis_muatan, type_bc: jo.type_bc, vessel: jo.vessel, eta_etd: jo.eta_etd, delivery_plan: null, container_count: jo.container_count, container_type: jo.container_type,
      weight_kg: jo.weight_kg, qty: jo.qty, unit: jo.unit, party: jo.party_text, references: refs });
    const errs2 = errs.filter(e => e.field !== 'delivery_plan'); if (errs2.length) { vfail.noPlan++; errs2.forEach(e => (vfail.noPlanFields[e.field] = (vfail.noPlanFields[e.field] || 0) + 1)); }
    if (errs.length) { vfail.total++; vfail.byType[type] = (vfail.byType[type] || 0) + 1; errs.forEach(e => (vfail.fields[e.field] = (vfail.fields[e.field] || 0) + 1)); }
  }

  await ctx.upsert('job_orders', COLS, out, COLS.filter(c => !NO_UPDATE.has(c)));
  s.inserted = out.filter(j => !had.has(Number(j.legacy_id))).length; s.updated = out.length - s.inserted;
  const idMap = await ctx.legacyMap('job_orders'), ids = out.map(j => idMap.get(Number(j.legacy_id)));

  // referensi: selaraskan (yang punya berkas tidak dihapus)
  const existing = new Map(); for (const part of chunks(ids, 2000)) for (const e of await ctx.q('SELECT id, jo_id, kind, number, ref_date, file_id FROM jo_references WHERE jo_id IN (?)', [part])) existing.set(`${e.jo_id}|${e.kind}|${e.number}`, e);
  const want = new Set(), ins = [], upd = [];
  for (const j of out) { const jid = idMap.get(Number(j.legacy_id)); for (const rf of refsBy.get(Number(j.legacy_id))) { const k = `${jid}|${rf.kind}|${rf.number}`; want.add(k); const e = existing.get(k); if (!e) ins.push([jid, rf.kind, rf.number, rf.ref_date, rf.sort]); else if ((e.ref_date || null) !== (rf.ref_date || null)) upd.push([e.id, rf.ref_date]); } }
  const del = [...existing.entries()].filter(([k, e]) => !want.has(k) && e.file_id == null).map(([, e]) => e.id);
  for (const part of chunks(del, 2000)) await ctx.q('DELETE FROM jo_references WHERE id IN (?)', [part]);
  for (const [id, date] of upd) await ctx.q('UPDATE jo_references SET ref_date=? WHERE id=?', [date, id]);
  for (const part of chunks(ins, 500)) await ctx.q('INSERT INTO jo_references (jo_id, kind, number, ref_date, sort) VALUES ?', [part]);
  const refCount = {}; for (const a of ins) refCount[a[1]] = (refCount[a[1]] || 0) + 1;
  ctx.st('jo_references').source = [...refsBy.values()].reduce((a, l) => a + l.length, 0); ctx.st('jo_references').inserted = ins.length; ctx.st('jo_references').updated = upd.length; ctx.st('jo_references').skipped = ctx.st('jo_references').source - ins.length - upd.length;
  ctx.st('jo_references').details = refCount;

  // peti kemas per jenis ukuran (diganti penuh) dan checklist 9 item (hanya yang belum ada)
  for (const part of chunks(ids, 2000)) await ctx.q('DELETE FROM jo_containers WHERE jo_id IN (?)', [part]);
  const cins = []; for (const j of out) for (const c of contBy.get(Number(j.legacy_id)) || []) cins.push([idMap.get(Number(j.legacy_id)), c.size, c.qty]);
  for (const part of chunks(cins, 1000)) await ctx.q('INSERT INTO jo_containers (jo_id, size, qty) VALUES ?', [part]);
  ctx.st('jo_containers').source = cins.length; ctx.st('jo_containers').updated = cins.length; ctx.st('jo_containers').details.catatan = 'diganti penuh tiap run';
  const ck = []; for (const id of ids) for (const it of rules.CHECKLIST_ITEMS) ck.push([id, it.code]);
  let ckNew = 0; for (const part of chunks(ck, 2000)) ckNew += (await ctx.q('INSERT IGNORE INTO jo_checklist (jo_id, item) VALUES ?', [part])).affectedRows;
  ctx.st('jo_checklist').source = ck.length; ctx.st('jo_checklist').inserted = ckNew; ctx.st('jo_checklist').skipped = ck.length - ckNew;

  // laporan tambahan
  s.details.gagal_validasi_lesat = vfail.total; s.details.gagal_validasi_selain_delivery_plan = vfail.noPlan;
  ctx.addNote('job_orders', `JO yang akan gagal validasi LESAT saat diedit penuh: ${vfail.total} dari ${out.length} (per tipe: ${Object.entries(vfail.byType).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}). Per kolom: ${Object.entries(vfail.fields).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  ctx.addNote('job_orders', `Tanpa menghitung delivery_plan (tidak ada di sistem lama, selalu kosong): ${vfail.noPlan} JO gagal validasi. Per kolom: ${Object.entries(vfail.noPlanFields).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  ctx.addNote('job_orders', `Satuan JO tak terpetakan (teks asli disimpan di party_text): ${[...unmapped].sort((a, b) => b[1] - a[1]).map(([k, v]) => `"${k}"×${v}`).join(', ') || '-'}`);
  ctx.addNote('job_orders', 'Keputusan: `eta_etd` Trucking/Project = DateEta lalu DateEtd; `delivery_plan` dikosongkan; `StatusJo` 0→NOT_COMP, 1 dan 2→COMPLETE.');
  ctx.addNote('job_orders', `Pemeriksaan silang: SUM(lcl_ton)x1000 sumber = ${Math.round((await ctx.L('SELECT SUM(lcl_ton) t FROM job_order'))[0].t * 1000)} kg; SUM(weight_kg) hasil = ${Math.round((await ctx.q1("SELECT SUM(weight_kg) w FROM job_orders WHERE origin='LEGACY'")).w || 0)} kg (selisih = JO yang dikarantina).`);
};
