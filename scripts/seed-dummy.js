// Data dummy JO + Handling Ops (mirip requirement). Lokal: npm run seed (aman diulang: hanya mengganti data dummy sebelumnya).
// Di server (Railway dev): set SEED_DUMMY=1 -> dibuat sekali saat start jika belum ada data dummy (SEED_DUMMY=force untuk membuat ulang).
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
const cfg = require('../config');
const rules = require('../lib/rules'), numbering = require('../lib/numbering'), files = require('../lib/files');

let seed = 42; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)], between = (a, b) => a + Math.floor(rnd() * (b - a + 1)), pad = (n, l) => String(n).padStart(l, '0');
const isoDay = d => d.toISOString().slice(0, 10);

const PICS = [['Arjun Tri Haryanto', 'arjun', 'AT', '2022010002'], ['Tejo Purnomo', 'tejo', 'TP', '2022010003'], ['Faad Tri Fidiansyah', 'faad', 'FA', '2022010004'], ['Teguh Prasetyo', 'teguh', 'TG', '2022010005'], ['Fajar Sentosa', 'fajar', 'FS', '2022010006']];
const CUSTOMERS = [['CAT', 'CT ADVANCE TECHNOLOGY'], ['KUI', 'KOMATSU UNDERCARRIAGE INDONESIA'], ['SSE', 'SELAMAT SEMPURNA TBK']];
const VESSELS = ['SHINLINE 12', 'OCEAN GOLD', 'MELIA 5', 'KMTC SURABAYA', 'GRACE ZEPHYR', 'OOCL NINGBAO', 'MSC BEIRA', 'NYK DANIELLA'];
const PRODUCTS = [['GALVANIZED COIL', 'JAC270C', 0.7, 1245], ['HOT ROLLED COIL', 'JSH270C', 2.6, 1219], ['HOT ROLLED COIL', 'JSH440W', 1.6, 1219], ['COLD ROLLED COIL', 'SPCC', 1.0, 1000], ['GALVANIZED COIL', 'SGCC', 0.5, 1250]];
const DEST = ['CIBITUNG', 'KARAWANG TIMUR', 'CIKARANG', 'CILEGON', 'MARUNDA', 'CAKUNG'];
const NOPOL = [['B 9854 TEJ', 'YANTO', 'LST'], ['B 9855 TEJ', 'IWAN', 'LST'], ['B 9701 MM', 'SUPRAPTO', 'LST'], ['B 9102 TEK', 'EJE', 'LST'], ['B 9103 TEK', 'WARNADI', 'LST'], ['B 9157 TEK', 'UWAN', 'MJL'], ['B 9195 TEK', 'WAWAN', 'DMS'], ['B 9198 TEK', 'KOMAR', 'HAJ W'], ['B 9076 TEK', 'SUPRIADI', 'HAJ S'], ['B 9077 TEK', 'MAMAN', 'LST']];
const DMG = ['Penyok pada sisi luar coil', 'Karat di bagian tepi', 'Packing sobek', 'Strapping putus, coil longgar'];
const TYPES = ['IMPORT', 'IMPORT', 'IMPORT', 'EXPORT', 'TRUCKING', 'PROJECT'];

async function seedDummy(pool) {
  const q = (s, p) => pool.query(s, p).then(r => r[0]);

  // idempotent: hanya menghapus data dummy sebelumnya (remarks 'DUMMY%'), data asli tidak disentuh
  const dj = (await q("SELECT id FROM job_orders WHERE remarks LIKE 'DUMMY%'")).map(x => x.id);
  if (dj.length) {
    const tids = (await q('SELECT DISTINCT ticket_id FROM ticket_job_orders WHERE jo_id IN (?)', [dj])).map(x => x.ticket_id);
    if (tids.length) {
      const dns = (await q('SELECT id FROM delivery_notes WHERE ticket_id IN (?)', [tids])).map(x => x.id);
      await files.removeByOwner(pool, 'delivery_note', dns);
      await files.removeByOwner(pool, 'material_report', (await q('SELECT id FROM material_reports WHERE ticket_id IN (?)', [tids])).map(x => x.id));
      await q('DELETE FROM delivery_notes WHERE ticket_id IN (?)', [tids]);
      await q('DELETE FROM handling_tickets WHERE id IN (?)', [tids]);
      await q("DELETE FROM audit_log WHERE entity_type='ticket' AND entity_id IN (?)", [tids]);
    }
    await files.removeByOwner(pool, 'jo_reference', (await q('SELECT id FROM jo_references WHERE jo_id IN (?)', [dj])).map(x => x.id));
    await files.removeByOwner(pool, 'jo_document', (await q('SELECT id FROM jo_documents WHERE jo_id IN (?)', [dj])).map(x => x.id));
    await q('DELETE FROM jo_materials WHERE jo_id IN (?)', [dj]);
    await q('DELETE FROM job_orders WHERE id IN (?)', [dj]);
    await q("DELETE FROM audit_log WHERE entity_type='job_order' AND entity_id IN (?)", [dj]);
  }

  for (const [name, user, code, emp] of PICS) await q('INSERT IGNORE INTO users (username,password,name,pic_code,employee_no) VALUES (?,?,?,?,?)', [user, bcrypt.hashSync('demo1234', 10), name, code, emp]);
  for (const [code, name] of CUSTOMERS) await q('INSERT IGNORE INTO customers (code,name) VALUES (?,?)', [code, name]);
  const users = await q("SELECT id,name,pic_code FROM users WHERE pic_code IS NOT NULL AND pic_code<>'AD'"), customers = await q('SELECT id,code,name FROM customers'), shippers = await q('SELECT id FROM shippers');
  const vendors = Object.fromEntries((await q('SELECT id,code FROM vendors')).map(v => [v.code, v.id]));
  const admin = (await q("SELECT id,name FROM users WHERE username='admin'"))[0];

  const now = Date.now(), tiers = ['done', 'done', 'done', 'done', 'done', 'mid', 'mid', 'mid', 'mid', 'low', 'low', 'low', 'done', 'mid', 'low', 'done', 'mid', 'low'];
  const stats = { tickets: 0, jos: 0, materials: 0, sj: 0 };

  async function createJo({ type, customer, created, vessel, prod, count, complete, refsOverride, remarks = 'DUMMY - data contoh Handling Ops' }) {
    const no_jo = await numbering.joNumber(pool, customer.code), bl = `ASANKWJK${between(100, 999)}`;
    const eta = new Date(created.getTime() - 86400000), plan = new Date(created.getTime() + 3 * 86400000);
    const [jr] = await pool.query(`INSERT INTO job_orders (no_jo, type, type_bc, customer_id, shipper_id, jenis_muatan, cargo_desc, vessel, eta_etd, delivery_plan, container_count, container_type, weight_kg, qty, unit, status, remarks, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [no_jo, type, ['IMPORT', 'EXPORT'].includes(type) ? pick(['BC 2.0', 'BC 2.0', 'BC 1.6']) : null, customer.id, pick(shippers).id, pick(['FCL', 'FCL', 'LCL_BB']), prod[0], vessel,
      isoDay(eta), isoDay(plan), type === 'TRUCKING' ? null : between(2, 12), type === 'TRUCKING' ? null : pick(['20FT', '40FT']), 0, count, 'COIL', complete ? 'COMPLETE' : 'NOT_COMP', remarks, admin.id, created]);
    const id = jr.insertId;
    const refs = refsOverride || [['AJU', `0003${between(10, 99)}`], ['INVOICE', `52556${between(10, 99)}`], ['BL', bl], [type === 'EXPORT' ? 'SI_PO' : 'SI_DO', `PO-${between(1000, 9999)}`]];
    let sort = 0;
    for (const [kind, number] of refs) await q('INSERT INTO jo_references (jo_id, kind, number, ref_date, sort, created_by) VALUES (?,?,?,?,?,?)', [id, kind, number, isoDay(eta), sort++, admin.id]);
    for (const it of rules.CHECKLIST_ITEMS) await q('INSERT INTO jo_checklist (jo_id, item, inv, fp) VALUES (?,?,?,?)', [id, it.code, it.code === 'agency_do' || complete ? 1 : 0, complete ? 1 : 0]);
    await q("INSERT INTO audit_log (entity_type, entity_id, action, note, user_id, user_name, created_at) VALUES ('job_order',?,?,?,?,?,?)", [id, 'Dibuat', 'Data dummy', admin.id, admin.name, created]);
    stats.jos++;
    return { id, no_jo, bl };
  }
  async function createMaterials(jo, prod, count, dest) {
    const out = []; let total = 0;
    for (let m = 0; m < count; m++) {
      const net = between(5000, 9000), gross = net + between(40, 90), no = `C${pick(['QH', 'WH', 'UH', 'UJ'])}${between(1000, 9999)}${String.fromCharCode(65 + (m % 26))}${m >= 26 ? m : ''}`;
      const [x] = await pool.query(`INSERT INTO jo_materials (jo_id, product_no, description, spec, thickness, width, shape, kondisi, bl_no, net_weight, gross_weight, qty, unit, origin, destination, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [jo.id, no, prod[0], prod[1], prod[2], prod[3], 'C', rnd() < 0.9 ? 'INTACT' : 'PARTIAL', jo.bl, net, gross, 1, 'COIL', 'PRIOK', dest, admin.id]);
      out.push({ id: x.insertId, net }); total += net; stats.materials++;
    }
    await q('UPDATE job_orders SET weight_kg=? WHERE id=?', [total, jo.id]);
    return out;
  }

  for (const [ti, tier] of tiers.entries()) {
    const created = new Date(now - (tiers.length - ti) * 0.65 * 86400000 - between(0, 6) * 3600000), pic = users[ti % users.length];
    const cust = customers[ti % customers.length], vessel = VESSELS[ti % VESSELS.length], prod = pick(PRODUCTS), dest = pick(DEST);
    const [tr] = await pool.query('INSERT INTO handling_tickets (ticket_no, pic_id, created_at, created_by) VALUES (?,?,?,?)', [await numbering.ticketNumber(pool, pic.pic_code, created), pic.id, created, pic.id]);
    const tid = tr.insertId, mats = [];

    for (let k = 0; k < between(1, 2); k++) {
      const count = between(6, 14), jo = await createJo({ type: pick(TYPES), customer: cust, created, vessel, prod, count, complete: tier === 'done' });
      await q('INSERT INTO ticket_job_orders (ticket_id, jo_id) VALUES (?,?)', [tid, jo.id]);
      mats.push(...await createMaterials(jo, prod, count, dest));
    }

    // report material
    const r = { done: 1, mid: 0.55 + rnd() * 0.4, low: rnd() * 0.4 }[tier], s = { done: 1, mid: 0.4 + rnd() * 0.5, low: rnd() * 0.3 }[tier];
    const nCheck = Math.round(mats.length * r), nSend = Math.round(mats.length * s), st = [];
    for (const [i, m] of mats.entries()) {
      const dmg = i < nCheck && rnd() < 0.1, status = i >= nCheck ? 'NOT_CHECKED' : dmg ? 'DAMAGE' : 'OK'; st.push(status);
      if (status !== 'NOT_CHECKED') await q('INSERT INTO material_reports (material_id, ticket_id, status, remarks, checked_by, checked_by_name, checked_at) VALUES (?,?,?,?,?,?,?)',
        [m.id, tid, status, dmg ? pick(DMG) : null, admin.id, admin.name, new Date(created.getTime() + between(30, 600) * 60000)]);
    }

    // trucking delivery: bagi material yang terkirim ke beberapa truk
    let off = 0, trip = 0, lastFinish = created;
    while (off < nSend) {
      const take = Math.min(between(3, 7), nSend - off), t = NOPOL[(ti + trip) % NOPOL.length], sel = mats.slice(off, off + take);
      const start = new Date(created.getTime() + (60 + trip * 75 + between(0, 30)) * 60000), finish = new Date(start.getTime() + between(40, 240) * 60000); lastFinish = finish;
      const [sr] = await pool.query('INSERT INTO delivery_notes (no_sj, ticket_id, nopol, driver, phone, vendor_id, start_loading, finish_loading, entry_at, exit_at, created_by_name, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [await numbering.sjNumber(pool, created), tid, t[0], t[1], `08${between(11, 99)}${between(1000000, 9999999)}`, vendors[t[2]], start, finish, start.toISOString().slice(0, 16).replace('T', ' '), finish.toISOString().slice(0, 16).replace('T', ' '), admin.name, admin.id, start]);
      await q('INSERT INTO delivery_note_items (dn_id, material_id, qty, weight, mark) VALUES ?', [sel.map((m, i) => [sr.insertId, m.id, 1, m.net, st[off + i] === 'DAMAGE' ? 'DAMAGE' : st[off + i] === 'OK' ? 'GOOD' : null])]);
      off += take; trip++; stats.sj++;
    }
    if (r === 1 && s === 1) await q('UPDATE handling_tickets SET done_at=? WHERE id=?', [new Date(Math.max(lastFinish.getTime(), created.getTime()) + 3600000), tid]);
    stats.tickets++;
  }

  // contoh requirement (Sheet2): satu JO dengan 5 nomor aju dan 3 supplier (invoice + BL + SI/DO ganda), belum masuk tiket
  const multi = await createJo({ type: 'IMPORT', customer: customers[0], created: new Date(now - 86400000), vessel: 'SHINLINE 12', prod: PRODUCTS[0], count: 6, complete: false,
    refsOverride: [...['000386', '000385', '000384', '000383', '000382'].map(n => ['AJU', n]), ...['INV-A-2201', 'INV-B-2202', 'INV-C-2203'].map(n => ['INVOICE', n]), ...['ASANKWJK012', 'ASANKWJK013', 'ASANKWJK014'].map(n => ['BL', n]), ...['DO-A-01', 'DO-B-02', 'DO-C-03'].map(n => ['SI_DO', n])],
    remarks: 'DUMMY - contoh banyak referensi (5 aju, 3 supplier)' });
  await createMaterials(multi, PRODUCTS[0], 6, 'CIBITUNG');

  console.log('Selesai:', stats, '\nPIC demo: arjun / tejo / faad / teguh / fajar (password demo1234)');
}
module.exports = seedDummy;

if (require.main === module) {
  if (cfg.isProd && process.env.ALLOW_SEED !== '1') { console.error('Seed dinonaktifkan di production (set ALLOW_SEED=1 jika ini environment development)'); process.exit(1); }
  const pool = mysql.createPool(cfg.db);
  seedDummy(pool).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
