// Data dummy Handling Ops. Lokal: npm run seed (aman diulang: hanya mengganti data dummy sebelumnya).
// Di server (Railway dev): set SEED_DUMMY=1, data dibuat sekali saat start jika belum ada data dummy (SEED_DUMMY=force untuk membuat ulang).
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
const cfg = require('../config');
let seed = 42; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)], between = (a, b) => a + Math.floor(rnd() * (b - a + 1)), pad = (n, l) => String(n).padStart(l, '0');
const ymd = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;

const PICS = [['Arjun Tri Haryanto', 'arjun', 'AT', '2022010002'], ['Tejo Purnomo', 'tejo', 'TP', '2022010003'], ['Faad Tri Fidiansyah', 'faad', 'FA', '2022010004'], ['Teguh Prasetyo', 'teguh', 'TG', '2022010005'], ['Fajar Sentosa', 'fajar', 'FS', '2022010006']];
const CUSTOMERS = [['CAT', 'CT ADVANCE TECHNOLOGY'], ['KUI', 'KOMATSU UNDERCARRIAGE INDONESIA'], ['SSE', 'SELAMAT SEMPURNA TBK']];
const VESSELS = ['SHINLINE 12', 'OCEAN GOLD', 'MELIA 5', 'KMTC SURABAYA', 'GRACE ZEPHYR', 'OOCL NINGBAO', 'MSC BEIRA', 'NYK DANIELLA'];
const PRODUCTS = [['GALVANIZED COIL', 'JAC270C', 0.7, 1245], ['HOT ROLLED COIL', 'JSH270C', 2.6, 1219], ['HOT ROLLED COIL', 'JSH440W', 1.6, 1219], ['COLD ROLLED COIL', 'SPCC', 1.0, 1000], ['GALVANIZED COIL', 'SGCC', 0.5, 1250]];
const DEST = ['CIBITUNG', 'KARAWANG TIMUR', 'CIKARANG', 'CILEGON', 'MARUNDA', 'CAKUNG'];
const NOPOL = [['B 9854 TEJ', 'YANTO', 'LST'], ['B 9855 TEJ', 'IWAN', 'LST'], ['B 9701 MM', 'SUPRAPTO', 'LST'], ['B 9102 TEK', 'EJE', 'LST'], ['B 9103 TEK', 'WARNADI', 'LST'], ['B 9157 TEK', 'UWAN', 'MJL'], ['B 9195 TEK', 'WAWAN', 'DMS'], ['B 9198 TEK', 'KOMAR', 'HAJ W'], ['B 9076 TEK', 'SUPRIADI', 'HAJ S'], ['B 9077 TEK', 'MAMAN', 'LST']];
const DMG = ['Penyok pada sisi luar coil', 'Karat di bagian tepi', 'Packing sobek', 'Strapping putus, coil longgar'];

async function seedDummy(pool) {
  const q = (s, p) => pool.query(s, p).then(r => r[0]);
  // idempotent: hanya menghapus data dummy sebelumnya (remarks 'DUMMY%'), data asli tidak disentuh
  const old = await q("SELECT DISTINCT tj.ticket_id FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id WHERE j.remarks LIKE 'DUMMY%'");
  if (old.length) {
    const ids = old.map(o => o.ticket_id);
    await pool.query('DELETE FROM surat_jalan WHERE ticket_id IN (?)', [ids]);
    await pool.query('DELETE FROM materials WHERE ticket_id IN (?)', [ids]);
    await pool.query('DELETE FROM ho_tickets WHERE id IN (?)', [ids]);
  }
  await pool.query("DELETE FROM job_orders WHERE remarks LIKE 'DUMMY%'");

  for (const [name, user, code, emp] of PICS) await pool.query('INSERT IGNORE INTO users (username,password,name,pic_code,employee_no) VALUES (?,?,?,?,?)', [user, bcrypt.hashSync('demo1234', 10), name, code, emp]);
  for (const [code, name] of CUSTOMERS) await pool.query('INSERT IGNORE INTO customers (code,name) VALUES (?,?)', [code, name]);
  const users = await q("SELECT id,pic_code FROM users WHERE pic_code IS NOT NULL AND pic_code<>'AD'"), customers = await q('SELECT id,code,name FROM customers'), shippers = await q('SELECT id FROM shippers');
  const vendors = Object.fromEntries((await q('SELECT id,code FROM vendors')).map(v => [v.code, v.id]));

  const now = Date.now(), tiers = ['done', 'done', 'done', 'done', 'done', 'mid', 'mid', 'mid', 'mid', 'low', 'low', 'low', 'done', 'mid', 'low', 'done', 'mid', 'low'];
  let tid0; const dayCnt = {}; let joSeq = (await q("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(jo_no,'-',1) AS UNSIGNED)),0) m FROM job_orders"))[0].m, sjSeq = {}, stats = { tickets: 0, jos: 0, materials: 0, sj: 0 };

  for (const [ti, tier] of tiers.entries()) {
    const created = new Date(now - (tiers.length - ti) * 0.65 * 86400000 - between(0, 6) * 3600000);
    const pic = users[ti % users.length], day = ymd(created);
    if (dayCnt[day] === undefined) dayCnt[day] = (await q('SELECT COUNT(*) n FROM ho_tickets WHERE ticket_no LIKE ? AND id<>?', [day + '%', tid0 = 0]))[0].n;
    dayCnt[day]++;
    const ticketNo = `${day}${pad(dayCnt[day], 2)}${pic.pic_code}`;
    const cust = customers[ti % customers.length], vessel = VESSELS[ti % VESSELS.length], prod = pick(PRODUCTS);
    const [tr] = await pool.query('INSERT INTO ho_tickets (ticket_no,pic_id,created_at) VALUES (?,?,?)', [ticketNo, pic.id, created]);
    const tid = tr.insertId, joIds = [], mats = [];

    for (let k = 0; k < between(1, 2); k++) {
      const count = between(6, 14), party = `${count * between(1, 3) * 10} CL`, bl = `ASANKWJK${between(100, 999)}`;
      const jo_no = `${pad(++joSeq, 4)}-${cust.code}`;
      const [jr] = await pool.query(`INSERT INTO job_orders (jo_no,type,customer_id,shipper_id,invoice_no,bl_no,si_po_no,aju_no,cargo_type,party,weight,vessel,eta,delivery_plan,remarks,checklist,status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, [jo_no, pick(['PIB BC 2.0', 'PIB BC 2.0', 'PIB BC 1.6', 'LOKAL']), cust.id, pick(shippers).id, `52556${between(10, 99)}`, bl, `PO-${between(1000, 9999)}`, `0003${between(10, 99)}`, prod[0], party, 0, vessel,
        new Date(created.getTime() - 86400000).toISOString().slice(0, 10), new Date(created.getTime() + 3 * 86400000).toISOString().slice(0, 10), 'DUMMY - data contoh Handling Ops',
        JSON.stringify({ agency: { inv: 1, fp: 0 }, do: { inv: 1, fp: 1 } }), tier === 'done' ? 'COMPLETE' : 'NOT_COMP', created]);
      await pool.query('INSERT INTO ho_ticket_jos (ticket_id,jo_id) VALUES (?,?)', [tid, jr.insertId]);
      await pool.query('INSERT INTO jo_logs (jo_id,user_name,action,note) VALUES (?,?,?,?)', [jr.insertId, 'Administrator', 'Dibuat', 'Data dummy']);
      joIds.push(jr.insertId); stats.jos++;
      const dest = pick(DEST); let total = 0;
      for (let m = 0; m < count; m++) {
        const net = between(5000, 9000), gross = net + between(40, 90);
        mats.push([tid, jr.insertId, `C${pick(['QH', 'WH', 'UH', 'UJ'])}${between(1000, 9999)}${String.fromCharCode(65 + m)}`, prod[0], prod[1], prod[2], prod[3], bl, net, gross, 1, 'COIL', 'PRIOK', dest]);
        total += net;
      }
      await pool.query('UPDATE job_orders SET weight=? WHERE id=?', [Math.round(total) / 1000, jr.insertId]);
    }

    // report material
    const r = { done: 1, mid: 0.55 + rnd() * 0.4, low: rnd() * 0.4 }[tier], s = { done: 1, mid: 0.4 + rnd() * 0.5, low: rnd() * 0.3 }[tier];
    const nCheck = Math.round(mats.length * r), nSend = Math.round(mats.length * s), ids = [];
    for (const [i, m] of mats.entries()) {
      const dmg = i < nCheck && rnd() < 0.1, st = i >= nCheck ? 'NOT_CHECKED' : dmg ? 'DAMAGE' : 'OK', at = new Date(created.getTime() + between(30, 600) * 60000);
      const [x] = await pool.query('INSERT INTO materials (ticket_id,jo_id,product_no,description,spec,thickness,width,bl_no,net_weight,gross_weight,qty,unit,origin,destination,check_status,remarks,checked_at,checked_by) VALUES (?)',
        [[...m, st, dmg ? pick(DMG) : null, st === 'NOT_CHECKED' ? null : at, st === 'NOT_CHECKED' ? null : 'Administrator']]);
      ids.push(x.insertId); stats.materials++;
    }

    // trucking delivery: bagi material yang terkirim ke beberapa truk
    let off = 0, trip = 0, lastFinish = created;
    while (off < nSend) {
      const take = Math.min(between(3, 7), nSend - off), t = NOPOL[(ti + trip) % NOPOL.length], sel = mats.slice(off, off + take), sid = ids.slice(off, off + take);
      const start = new Date(created.getTime() + (60 + trip * 75 + between(0, 30)) * 60000), finish = new Date(start.getTime() + between(40, 240) * 60000); lastFinish = finish;
      const ym = day.slice(0, 6); if (sjSeq[ym] === undefined) sjSeq[ym] = (await q('SELECT COUNT(*) n FROM surat_jalan WHERE sj_no LIKE ?', [ym + '%']))[0].n; sjSeq[ym]++;
      const [sr] = await pool.query('INSERT INTO surat_jalan (sj_no,ticket_id,nopol,driver,phone,vendor_id,start_at,finish_at,entry_at,exit_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [`${ym}${pad(sjSeq[ym], 4)}`, tid, t[0], t[1], `08${between(11, 99)}${between(1000000, 9999999)}`, vendors[t[2]], start, finish, start.toISOString().slice(0, 16).replace('T', ' '), finish.toISOString().slice(0, 16).replace('T', ' '), 'Administrator', start]);
      await pool.query('INSERT INTO surat_jalan_items (sj_id,material_id,qty,weight) VALUES ?', [sel.map((m, i) => [sr.insertId, sid[i], 1, m[8]])]);
      off += take; trip++; stats.sj++;
    }
    const done = r === 1 && s === 1;
    if (done) await pool.query('UPDATE ho_tickets SET done_at=? WHERE id=?', [new Date(Math.max(lastFinish.getTime(), created.getTime()) + 3600000), tid]);
    stats.tickets++;
  }
  console.log('Selesai:', stats, '\nPIC demo: arjun / tejo / faad / teguh / fajar (password demo1234)');
}
module.exports = seedDummy;

if (require.main === module) {
  if (cfg.isProd && process.env.ALLOW_SEED !== '1') { console.error('Seed dinonaktifkan di production (set ALLOW_SEED=1 jika ini environment development)'); process.exit(1); }
  const pool = mysql.createPool(cfg.db);
  seedDummy(pool).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
