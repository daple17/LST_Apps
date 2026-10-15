// Impor bagian 2: material (kontainer), tiket (worksheet), report kerusakan, surat jalan + isinya, status tiket (done_at).
const M = require('../../lib/legacy-map');
const { dt, dtt, trunc } = require('./common');

const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const monthOf = d => String(d).slice(0, 7).replace('-', '');
const nowIso = () => new Date().toISOString().slice(0, 10);
// nama unik: yang kedua dan seterusnya diberi akhiran #2, #3 (juga bila bentrok dengan data LESAT non-impor)
function uniqueNames(rows, key, taken, max = 20) {
  const seen = new Map(), out = [];
  for (const r of rows) {
    let base = r[key], n = (seen.get(base.toUpperCase()) || 0) + 1; seen.set(base.toUpperCase(), n);
    let name = n === 1 && !taken.has(base.toUpperCase()) ? base : null;
    for (let k = Math.max(n, 2); !name; k++) { const cand = base.slice(0, max - String(k).length - 1) + '#' + k; if (!seen.has(cand.toUpperCase()) && !taken.has(cand.toUpperCase())) { name = cand; seen.set(cand.toUpperCase(), 1); } }
    out.push({ ...r, [key]: name, renamed: name !== base });
  }
  return out;
}

/* ---------- material ---------- */
const MAT_COLS = ['legacy_id', 'jo_id', 'product_no', 'description', 'spec', 'thickness', 'net_weight', 'gross_weight', 'qty', 'unit', 'origin', 'destination', 'kondisi', 'container_no', 'container_size', 'data_origin'];
async function materials(ctx) {
  const s = ctx.st('jo_materials'), rows = await ctx.L('SELECT * FROM kontainer ORDER BY id'); s.source = rows.length;
  const jo = await ctx.legacyMap('job_orders'), had = await ctx.legacyMap('jo_materials'), d = (k, n = 1) => ctx.detail('jo_materials', k, n);
  const ok = [];
  for (const r of rows) {
    const joId = jo.get(Number(r.id_job_order));
    if (!joId) { ctx.quar('jo_materials', r.id, 'JO tidak ada di sumber atau tidak diimpor', { id: r.id, id_job_order: r.id_job_order, nomor: r.nomor }); continue; }
    if (M.isTestRow(r)) { ctx.quar('jo_materials', r.id, 'data uji ("Material bagus"/Test/Coba/Tes)', { id: r.id, nomor: r.nomor, descr_barang: r.descr_barang }); continue; }
    ok.push({ r, jo_id: joId, product_no: M.productNo(r.nomor, r.id) });
  }
  const dd = M.dedupeProductNos(ok.map(x => ({ id: Number(x.r.id), jo_id: x.jo_id, product_no: x.product_no })));
  const renamed = new Map(dd.changes.map(c => [c.id, c.to])); d('nomor_ganda_diberi_akhiran', dd.changes.length);
  const out = ok.map(({ r, jo_id, product_no }) => {
    const net = M.weightKg(r.nett_weight, r.nett_weight_unit), gross = M.weightKg(r.weight, r.weight_unit);
    d('aturan_berat_netto_' + net.rule); d('aturan_berat_bruto_' + gross.rule);
    const unit = M.materialUnit(r.satuan, r.size); if (!unit) d('satuan_kosong_diisi_UNIT');
    if (M.productNo(r.nomor, r.id).startsWith('TANPA-NOMOR')) d('nomor_kosong_diganti');
    const spec = M.cleanText(r.spec); const th = M.thicknessNum(r.thickness);
    return { legacy_id: r.id, jo_id, product_no: renamed.get(Number(r.id)) || product_no, description: trunc(M.cleanText(r.descr_barang), 150), spec: spec === '1' ? null : trunc(spec, 60), thickness: th != null && th < 1e7 ? th : null,
      net_weight: net.kg ?? 0, gross_weight: gross.kg ?? 0, qty: Number(r.qty) || 0, unit: unit || 'UNIT', origin: trunc(M.cleanText(r.dari), 80), destination: trunc(M.cleanText(r.tujuan), 120), kondisi: 'INTACT',
      container_no: M.isIsoContainer(r.nomor) ? M.squash(r.nomor).toUpperCase() : null, container_size: trunc(M.containerSize(r.size), 5), data_origin: 'LEGACY' };
  });
  await ctx.upsert('jo_materials', MAT_COLS, out);
  s.inserted = out.filter(m => !had.has(Number(m.legacy_id))).length; s.updated = out.length - s.inserted;
  d('qty_nol', out.filter(m => m.qty === 0).length); d('container_iso', out.filter(m => m.container_no).length);
  ctx.addNote('jo_materials', 'Satuan material kosong diisi `UNIT` (keputusan sendiri: `jo_materials.unit` wajib, bukan menebak COIL). Baris dengan qty 0 diimpor apa adanya.');
}

/* ---------- tiket ---------- */
async function tickets(ctx) {
  const s = ctx.st('handling_tickets'), rows = await ctx.L('SELECT * FROM worksheet ORDER BY id'); s.source = rows.length;
  const users = await ctx.legacyMap('users'), had = await ctx.legacyMap('handling_tickets'), d = (k, n = 1) => ctx.detail('handling_tickets', k, n);
  const sys = await ctx.q1("SELECT id FROM users WHERE username='migrasi-sistem-lama'"); if (!sys) throw new Error('Pengguna migrasi-sistem-lama belum ada: jalankan langkah users dulu');
  const taken = new Set((await ctx.q('SELECT ticket_no FROM handling_tickets WHERE legacy_id IS NULL')).map(r => r.ticket_no.toUpperCase()));
  const named = uniqueNames(rows.map(r => ({ ...r, ticket_no: M.squash(r.nomor).slice(0, 20) })), 'ticket_no', taken); d('nomor_ganda_diberi_akhiran', named.filter(x => x.renamed).length);
  const out = named.map(r => ({ legacy_id: r.id, ticket_no: r.ticket_no, pic_id: users.get(Number(r.created_by)) ?? sys.id, created_at: (dt(r.tanggal) || '2000-01-01') + ' 00:00:00', created_by: users.get(Number(r.created_by)) ?? sys.id, origin: 'LEGACY', is_placeholder: 0 }));
  if (out.some(o => o.pic_id === sys.id)) d('pic_tidak_ditemukan_diganti_pengguna_migrasi', out.filter(o => o.pic_id === sys.id).length);
  await ctx.upsert('handling_tickets', ['legacy_id', 'ticket_no', 'pic_id', 'created_at', 'created_by', 'origin', 'is_placeholder'], out, ['ticket_no', 'pic_id', 'created_at', 'origin']);   // done_at tidak ditimpa di sini
  s.inserted = out.filter(o => !had.has(Number(o.legacy_id))).length; s.updated = out.length - s.inserted;
  // tiket <-> JO: pasangan unik (id_worksheet, id_job_order) dari material yang diimpor
  const tmap = await ctx.legacyMap('handling_tickets'), jo = await ctx.legacyMap('job_orders'), mat = await ctx.legacyMap('jo_materials');
  const pairs = await ctx.L('SELECT DISTINCT id_worksheet w, id_job_order j FROM kontainer WHERE id_worksheet > 0 AND id_job_order > 0 AND id IN (?)', [[...mat.keys()].length ? [...mat.keys()] : [0]]);
  const ins = new Map(); for (const p of pairs) { const t = tmap.get(Number(p.w)), j = jo.get(Number(p.j)); if (t && j) ins.set(`${t}|${j}`, [t, j]); }
  const tids = [...tmap.values()];
  for (const part of chunks(tids, 2000)) await ctx.q('DELETE FROM ticket_job_orders WHERE ticket_id IN (?) AND ticket_id IN (SELECT id FROM handling_tickets WHERE is_placeholder=0)', [part]);
  for (const part of chunks([...ins.values()], 1000)) await ctx.q('INSERT IGNORE INTO ticket_job_orders (ticket_id, jo_id) VALUES ?', [part]);
  const st = ctx.st('ticket_job_orders'); st.source = pairs.length; st.inserted = ins.size;
  const multi = await ctx.q('SELECT jo_id, COUNT(*) n FROM ticket_job_orders GROUP BY jo_id HAVING n > 1'); if (multi.length) ctx.addNote('handling_tickets', `JO yang muncul di lebih dari satu tiket: ${multi.length} (diperbolehkan; batas unik sudah dilepas).`);
}

/* ---------- report kerusakan (material_reports) ---------- */
async function materialReports(ctx) {
  const s = ctx.st('material_reports'), rows = await ctx.L('SELECT id, id_worksheet, damage_status, damage_descr, updated_time FROM kontainer WHERE id_worksheet > 0 ORDER BY id');
  const mat = await ctx.legacyMap('jo_materials'), tk = await ctx.legacyMap('handling_tickets'), out = [], d = (k, n = 1) => ctx.detail('material_reports', k, n);
  for (const r of rows) {
    const m = mat.get(Number(r.id)), t = tk.get(Number(r.id_worksheet)); if (!m || !t) continue;
    const status = M.damageStatus(r.damage_status), remarks = M.cleanText(r.damage_descr); s.source++;
    if (status === 'NOT_CHECKED' && !remarks) continue;                                  // tidak ada informasi: tidak dibuat
    d('status_' + status);
    out.push([m, t, status, remarks, status !== 'NOT_CHECKED' ? 'Data lama' : null, status !== 'NOT_CHECKED' ? dtt(r.updated_time) : null]);
  }
  for (const part of chunks([...mat.values()], 2000)) await ctx.q('DELETE FROM material_reports WHERE material_id IN (?)', [part]);
  for (const part of chunks(out, 500)) await ctx.q('INSERT INTO material_reports (material_id, ticket_id, status, remarks, checked_by_name, checked_at) VALUES ?', [part]);
  s.inserted = out.length; s.skipped = s.source - out.length;
}

/* ---------- surat jalan + isi ---------- */
async function deliveryNotes(ctx) {
  const s = ctx.st('delivery_notes'), rows = await ctx.L('SELECT * FROM surat_jalan ORDER BY id'); s.source = rows.length;
  const det = await ctx.L('SELECT d.id_surat_jalan sj, d.id_kontainer k, k.id_worksheet w, k.id_job_order j FROM surat_jalan_detil d LEFT JOIN kontainer k ON k.id = d.id_kontainer');
  const [users, vendors, tk, jo, had, matMap] = await Promise.all([ctx.legacyMap('users'), ctx.legacyMap('vendors'), ctx.legacyMap('handling_tickets'), ctx.legacyMap('job_orders'), ctx.legacyMap('delivery_notes'), ctx.legacyMap('jo_materials')]);
  const uname = new Map((await ctx.L('SELECT id, name FROM users')).map(u => [Number(u.id), u.name])), sys = await ctx.q1("SELECT id FROM users WHERE username='migrasi-sistem-lama'");
  const d = (k, n = 1) => ctx.detail('delivery_notes', k, n);
  const bySj = new Map(); for (const x of det) (bySj.get(Number(x.sj)) || bySj.set(Number(x.sj), []).get(Number(x.sj))).push(x);
  const taken = new Set((await ctx.q('SELECT no_sj FROM delivery_notes WHERE legacy_id IS NULL')).map(r => r.no_sj.toUpperCase()));
  const named = uniqueNames(rows.map(r => ({ ...r, no_sj: M.squash(r.nomor).slice(0, 20) })), 'no_sj', taken); d('nomor_ganda_diberi_akhiran', named.filter(x => x.renamed).length);
  const placeholders = new Map(), out = [], links = []; // links: [placeholder ticket no, jo legacy ids]
  for (const r of named) {
    const items = bySj.get(Number(r.id)) || [], ws = new Set(items.map(i => Number(i.w)).filter(w => w > 0 && tk.has(w)));
    let ticketId = null, ticketNo = null;
    if (ws.size > 1) { ctx.quar('delivery_notes', r.id, `isi surat jalan menunjuk ${ws.size} tiket berbeda`, { id: r.id, nomor: r.nomor }); continue; }
    if (ws.size === 1) ticketId = tk.get([...ws][0]);
    else {
      ticketNo = 'MIG-' + monthOf(dt(r.tanggal) || '2000-01-01'); const p = placeholders.get(ticketNo) || placeholders.set(ticketNo, { jos: new Set(), last: '', n: 0 }).get(ticketNo);
      p.n++; p.last = [p.last, dt(r.tanggal) || ''].sort().pop(); items.forEach(i => { if (matMap.has(Number(i.k)) && Number(i.j) > 0 && jo.has(Number(i.j))) p.jos.add(jo.get(Number(i.j))); });   // hanya dari material yang diimpor
      d(items.length ? 'masuk_penampung_berisi' : 'masuk_penampung_kosong');
    }
    out.push({ r, ticketId, ticketNo });
  }
  // tiket penampung bulanan: selesai, PIC = pengguna migrasi
  for (const [no, p] of placeholders) {
    await ctx.q("INSERT INTO handling_tickets (ticket_no, pic_id, created_at, done_at, created_by, origin, is_placeholder) VALUES (?,?,?,?,?, 'LEGACY', 1) ON DUPLICATE KEY UPDATE done_at=VALUES(done_at), is_placeholder=1, origin='LEGACY'",
      [no, sys.id, no.slice(4, 8) + '-' + no.slice(8) + '-01 00:00:00', (p.last || no.slice(4, 8) + '-' + no.slice(8) + '-01') + ' 23:59:59', sys.id]);
  }
  const pid = new Map((await ctx.q("SELECT id, ticket_no FROM handling_tickets WHERE is_placeholder=1")).map(t => [t.ticket_no, t.id]));
  for (const [no, p] of placeholders) { const id = pid.get(no); await ctx.q('DELETE FROM ticket_job_orders WHERE ticket_id=?', [id]); if (p.jos.size) await ctx.q('INSERT IGNORE INTO ticket_job_orders (ticket_id, jo_id) VALUES ?', [[...p.jos].map(j => [id, j])]); }
  const rowsOut = out.map(({ r, ticketId, ticketNo }) => ({ legacy_id: r.id, no_sj: r.no_sj, ticket_id: ticketId || pid.get(ticketNo), nopol: trunc(M.squash(r.no_pol) || '-', 20), driver: trunc(M.squash(r.nm_sopir) || '-', 80), phone: trunc(M.cleanText(r.no_telp_sopir), 30),
    vendor_id: vendors.get(Number(r.id_vendor)) ?? null, destination: trunc(M.cleanText(r.tujuan), 100), origin_address: trunc(M.cleanText(r.alamat_pengirim), 100), finish_loading: dtt(r.date_finish), created_at: dtt(r.date_created) || (dt(r.tanggal) + ' 00:00:00'),
    created_by_name: trunc(uname.get(Number(r.id_user)) || null, 100), created_by: users.get(Number(r.id_user)) ?? null, legacy_status: r.status_kirim == null ? null : Number(r.status_kirim), origin: 'LEGACY' }));
  await ctx.upsert('delivery_notes', ['legacy_id', 'no_sj', 'ticket_id', 'nopol', 'driver', 'phone', 'vendor_id', 'destination', 'origin_address', 'finish_loading', 'created_at', 'created_by_name', 'created_by', 'legacy_status', 'origin'], rowsOut);
  s.inserted = rowsOut.filter(o => !had.has(Number(o.legacy_id))).length; s.updated = rowsOut.length - s.inserted;
  d('vendor_tidak_ditemukan', rowsOut.filter(o => o.vendor_id == null).length); d('tanpa_isi_barang', rowsOut.filter(o => !(bySj.get(Number(o.legacy_id)) || []).length).length);
  ctx.addNote('delivery_notes', `Surat jalan yang tidak bisa dikaitkan ke tiket aslinya masuk tiket penampung bulanan MIG-YYYYMM (${placeholders.size} tiket penampung, is_placeholder=1, sudah selesai, PIC = pengguna migrasi-sistem-lama). start_loading dikosongkan (tidak ada di sistem lama); finish_loading = date_finish bila ada.`);

  // isi surat jalan
  const sj = await ctx.legacyMap('delivery_notes'), mat = await ctx.legacyMap('jo_materials'), si = ctx.st('delivery_note_items');
  const items = await ctx.L('SELECT id, id_surat_jalan, id_kontainer, qty, flag_surat_jalan FROM surat_jalan_detil ORDER BY id'); si.source = items.length;
  const mrows = new Map((await ctx.q("SELECT m.id, m.legacy_id, m.net_weight, m.qty, (SELECT status FROM material_reports r WHERE r.material_id=m.id LIMIT 1) st FROM jo_materials m WHERE m.data_origin='LEGACY'")).map(m => [Number(m.legacy_id), m]));
  const ihad = await ctx.legacyMap('delivery_note_items'), iout = [];
  for (const i of items) {
    const dn = sj.get(Number(i.id_surat_jalan)), mid = mat.get(Number(i.id_kontainer)), m = mrows.get(Number(i.id_kontainer));
    if (!dn) { ctx.quar('delivery_note_items', i.id, 'surat jalan tidak diimpor/dikarantina', { id: i.id, id_surat_jalan: i.id_surat_jalan }); continue; }
    if (!mid) { const exists = await ctx.L('SELECT 1 x FROM kontainer WHERE id=?', [i.id_kontainer]); ctx.quar('delivery_note_items', i.id, exists.length ? 'kontainer dikarantina (data uji/JO tidak ada)' : 'kontainer tidak ada di sumber', { id: i.id, id_kontainer: i.id_kontainer }); continue; }
    const qty = Number(i.qty) || 0, weight = Number(m.qty) > 0 ? Math.round(Number(m.net_weight) * qty / Number(m.qty) * 100) / 100 : 0;
    iout.push({ legacy_id: i.id, dn_id: dn, material_id: mid, qty, weight, mark: m.st === 'DAMAGE' ? 'DAMAGE' : m.st === 'OK' ? 'GOOD' : null, legacy_flag: i.flag_surat_jalan == null ? null : Number(i.flag_surat_jalan) });
  }
  await ctx.upsert('delivery_note_items', ['legacy_id', 'dn_id', 'material_id', 'qty', 'weight', 'mark', 'legacy_flag'], iout);
  si.inserted = iout.filter(o => !ihad.has(Number(o.legacy_id))).length; si.updated = iout.length - si.inserted;
  const over = await ctx.q("SELECT COUNT(*) n FROM (SELECT m.id FROM jo_materials m JOIN delivery_note_items i ON i.material_id=m.id WHERE m.data_origin='LEGACY' GROUP BY m.id, m.qty HAVING SUM(i.qty) > m.qty) x");
  ctx.detail('delivery_note_items', 'material_terkirim_melebihi_qty', over[0].n);
  const multiSj = await ctx.q("SELECT COUNT(*) n FROM (SELECT material_id FROM delivery_note_items WHERE legacy_id IS NOT NULL GROUP BY material_id HAVING COUNT(*) > 1) x"); ctx.detail('delivery_note_items', 'material_di_lebih_dari_satu_surat_jalan', multiSj[0].n);
}

/* ---------- status tiket: selesai bila seluruh qty material sudah tercakup surat jalan ---------- */
async function ticketStatus(ctx) {
  const s = ctx.st('ticket_status'), days = ctx.opts.activeWindowDays, d = (k, n = 1) => ctx.detail('ticket_status', k, n);
  const tk = await ctx.legacyMap('handling_tickets');
  const rows = await ctx.L('SELECT w.id, w.tanggal, (SELECT COALESCE(SUM(k.qty),0) FROM kontainer k WHERE k.id_worksheet=w.id) mq, (SELECT COALESCE(SUM(d.qty),0) FROM surat_jalan_detil d JOIN kontainer k ON k.id=d.id_kontainer WHERE k.id_worksheet=w.id) dq, '
    + '(SELECT MAX(COALESCE(sj.date_created, sj.tanggal)) FROM surat_jalan sj JOIN surat_jalan_detil d ON d.id_surat_jalan=sj.id JOIN kontainer k ON k.id=d.id_kontainer WHERE k.id_worksheet=w.id) last_sj FROM worksheet w ORDER BY w.id');
  s.source = rows.length; const today = Date.parse(nowIso() + 'T00:00:00Z'), upd = [];
  for (const r of rows) {
    const id = tk.get(Number(r.id)); if (!id) continue;
    const created = dt(r.tanggal) || '2000-01-01'; let done = null, how;
    if (Number(r.mq) <= 0 || Number(r.dq) >= Number(r.mq)) { done = (r.last_sj ? dtt(r.last_sj) : created + ' 00:00:00'); how = 'selesai'; }
    else if ((today - Date.parse(created + 'T00:00:00Z')) / 86400000 > days) { done = created + ' 00:00:00'; how = 'ditutup_migrasi'; }
    else how = 'aktif';
    d(how); upd.push([id, done, how === 'ditutup_migrasi']);
  }
  for (const [id, done] of upd) await ctx.q('UPDATE handling_tickets SET done_at=? WHERE id=?', [done, id]);
  const closed = upd.filter(u => u[2]).map(u => u[0]);
  for (const part of chunks(closed, 500)) { await ctx.q("DELETE FROM audit_log WHERE entity_type='ticket' AND action='Ditutup oleh migrasi' AND entity_id IN (?)", [part]); await ctx.q("INSERT INTO audit_log (entity_type, entity_id, action, note, user_name) VALUES ?", [part.map(id => ['ticket', id, 'Ditutup oleh migrasi', `belum tuntas dan lebih lama dari ${days} hari`, 'migrasi'])]); }
  ctx.addNote('ticket_status', `Tiket selesai bila SUM(qty surat jalan) >= SUM(qty material) (tiket tanpa material atau qty 0 dianggap selesai); yang belum tuntas dan lebih lama dari ${days} hari ditutup migrasi (catatan audit "Ditutup oleh migrasi"); sisanya dibiarkan aktif. Jendela diatur dengan --active-window-days.`);
}

exports.STEPS = [['materials', materials], ['tickets', tickets], ['material_reports', materialReports], ['delivery_notes', deliveryNotes], ['ticket_status', ticketStatus]];
