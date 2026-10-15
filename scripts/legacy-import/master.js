// Impor master: countries, ports, tps_warehouses, customers, vendors, shippers.
const crypto = require('crypto');
const M = require('../../lib/legacy-map');
const { num, trunc } = require('./common');

exports.countries = async ctx => {
  const s = ctx.st('countries'), rows = await ctx.L('SELECT id, name, Code FROM country ORDER BY id'); s.source = rows.length;
  const had = await ctx.legacyMap('countries');
  await ctx.upsert('countries', ['legacy_id', 'name', 'code'], rows.map(r => ({ legacy_id: r.id, name: trunc(M.squash(r.name), 100), code: num(r.Code) })));
  s.inserted = rows.filter(r => !had.has(r.id)).length; s.updated = rows.length - s.inserted;
};

exports.ports = async ctx => {
  const s = ctx.st('ports'), rows = await ctx.L('SELECT id, name, code, location_city, id_country, jenis FROM pelabuhan ORDER BY id'); s.source = rows.length;
  const cm = await ctx.legacyMap('countries'), had = await ctx.legacyMap('ports');
  await ctx.upsert('ports', ['legacy_id', 'name', 'code', 'city', 'country_id', 'is_foreign'], rows.map(r => ({ legacy_id: r.id, name: trunc(M.squash(r.name), 100), code: trunc(M.cleanText(r.code), 10), city: trunc(M.cleanText(r.location_city), 100),
    country_id: cm.get(Number(r.id_country)) ?? null, is_foreign: Number(r.jenis) === 1 ? 1 : 0 })));
  s.inserted = rows.filter(r => !had.has(r.id)).length; s.updated = rows.length - s.inserted;
  ctx.addNote('ports', '`port_international` tidak diimpor (tidak dirujuk satu pun JO secara unik; ID-nya bentrok dengan `pelabuhan`).');
};

exports.tps = async ctx => {
  const s = ctx.st('tps_warehouses'), rows = await ctx.L('SELECT id, code, name, location FROM warehouse ORDER BY id'); s.source = rows.length;
  const had = await ctx.legacyMap('tps_warehouses');
  await ctx.upsert('tps_warehouses', ['legacy_id', 'code', 'name', 'location'], rows.map(r => ({ legacy_id: r.id, code: trunc(M.cleanText(r.code), 10), name: trunc(M.cleanText(r.name), 100), location: trunc(M.cleanText(r.location), 100) })));
  s.inserted = rows.filter(r => !had.has(r.id)).length; s.updated = rows.length - s.inserted;
};

exports.customers = async ctx => {
  const s = ctx.st('customers'), rows = await ctx.L('SELECT * FROM customer ORDER BY id'); s.source = rows.length;
  const had = await ctx.legacyMap('customers'), existing = new Map((await ctx.q('SELECT code, legacy_id FROM customers')).map(r => [r.code.toUpperCase(), r.legacy_id == null ? null : Number(r.legacy_id)]));
  const seen = new Map(), out = [];
  for (const r of rows) {
    const { code, needsReview } = M.customerCode(r.nickname);
    if (!code || code.length > 10) { ctx.quar('customers', r.id, `nickname "${r.nickname ?? ''}" kosong/terlalu panjang untuk kode customer`, { id: r.id, name: r.name }); continue; }
    if (seen.has(code)) { ctx.quar('customers', r.id, `nickname ${code} ganda dengan customer lama #${seen.get(code)}`, { id: r.id, name: r.name }); continue; }
    if (existing.has(code) && existing.get(code) !== Number(r.id)) { ctx.quar('customers', r.id, `kode ${code} sudah dipakai customer di LESAT yang bukan hasil impor`, { id: r.id, name: r.name }); continue; }
    seen.set(code, r.id);
    if (needsReview) ctx.detail('customers', 'perlu_tinjau_kode');
    out.push({ legacy_id: r.id, code, name: trunc(M.squash(r.name), 150), email: trunc(M.cleanText(r.email), 150), phone: trunc(M.cleanText(r.phone), 50), address: trunc(M.cleanText(r.address), 255), city: trunc(M.cleanText(r.kota), 100),
      tax_no: trunc(M.cleanText(r.taxno), 30), legacy_code: trunc(M.cleanText(r.code), 100), needs_code_review: needsReview ? 1 : 0 });
  }
  await ctx.upsert('customers', ['legacy_id', 'code', 'name', 'email', 'phone', 'address', 'city', 'tax_no', 'legacy_code', 'needs_code_review'], out);
  s.inserted = out.filter(r => !had.has(Number(r.legacy_id))).length; s.updated = out.length - s.inserted;
  ctx.addNote('customers', 'Kode LESAT = `customer.nickname` lama (keputusan 5). Perlu dikonfirmasi client bahwa nickname = kode yang mereka pakai di nomor JO.');
  ctx.addNote('customers', `Customer dengan nickname bukan 3 huruf (needs_code_review=1): ${out.filter(o => o.needs_code_review).map(o => o.code).join(', ') || '-'}`);
};

exports.vendors = async ctx => {
  const s = ctx.st('vendors'), rows = await ctx.L('SELECT * FROM vendor ORDER BY id'); s.source = rows.length;
  const had = await ctx.legacyMap('vendors'), cm = await ctx.legacyMap('countries');
  const taken = new Set((await ctx.q('SELECT code FROM vendors WHERE legacy_id IS NULL')).map(r => r.code.toUpperCase())), out = [], derived = [];
  for (const r of rows) {
    const { code, needsReview } = M.vendorCode(r.code, r.name, taken);
    if (needsReview) derived.push(`#${r.id} "${M.squash(r.name)}" (kode lama "${M.squash(r.code)}") → ${code}`);
    out.push({ legacy_id: r.id, code, name: trunc(M.squash(r.name), 150), city: trunc(M.cleanText(r.location_city), 100), npwp: trunc(M.cleanText(r.npwp), 30), pic: trunc(M.cleanText(r.pic), 80), country_id: cm.get(Number(r.id_country)) ?? null, needs_code_review: needsReview ? 1 : 0 });
  }
  await ctx.upsert('vendors', ['legacy_id', 'code', 'name', 'city', 'npwp', 'pic', 'country_id', 'needs_code_review'], out);
  s.inserted = out.filter(r => !had.has(Number(r.legacy_id))).length; s.updated = out.length - s.inserted; s.details.kode_diganti = derived.length;
  ctx.addNote('vendors', `Kode vendor kosong/placeholder/ganda diganti kode turunan dari nama (needs_code_review=1): ${derived.length}`); derived.forEach(d => ctx.addNote('vendors', '  - ' + d));
};

exports.shippers = async ctx => {
  const s = ctx.st('shippers'), rows = await ctx.L('SELECT id, name, location_city, id_country FROM shipper ORDER BY id'); s.source = rows.length;
  const had = await ctx.legacyMap('shippers'), cm = await ctx.legacyMap('countries');
  await ctx.upsert('shippers', ['legacy_id', 'name', 'city', 'country_id'], rows.map(r => ({ legacy_id: r.id, name: trunc(M.squash(r.name), 150), city: trunc(M.cleanText(r.location_city), 100), country_id: cm.get(Number(r.id_country)) ?? null })));
  s.inserted = rows.filter(r => !had.has(Number(r.id))).length; s.updated = rows.length - s.inserted;
};

// pengguna: cocokkan username LESAT (tak peka huruf besar/kecil); sisanya dibuat NONAKTIF dengan peran tanpa izin. Hak akses lama tidak dimigrasi.
exports.users = async ctx => {
  const s = ctx.st('users'), rows = await ctx.L('SELECT id, name, email, uname, code FROM users ORDER BY id'); s.source = rows.length;
  const roleName = 'Pengguna Lama (tanpa akses)';
  let role = await ctx.q1('SELECT id FROM roles WHERE name=?', [roleName]);
  if (!role) { const r = await ctx.q('INSERT INTO roles (name, description, is_system) VALUES (?,?,0)', [roleName, 'Pengguna dari sistem lama; tanpa izin sampai PO mengatur peran.']); role = { id: r.insertId }; }
  const byName = new Map((await ctx.q('SELECT id, username, legacy_id FROM users')).map(u => [u.username.toLowerCase(), u])), usedEmail = new Set((await ctx.q("SELECT email FROM users WHERE email IS NOT NULL")).map(u => u.email.toLowerCase()));
  const dupPic = new Map();
  for (const r of rows) {
    const uname = M.username(r.uname); if (!uname) { ctx.quar('users', r.id, 'username kosong', { id: r.id, name: r.name }); continue; }
    const ex = byName.get(uname);
    if (ex) {
      if (ex.legacy_id != null && Number(ex.legacy_id) !== Number(r.id)) { ctx.quar('users', r.id, `username ${uname} sudah ditautkan ke pengguna lama lain`, { id: r.id }); continue; }
      await ctx.q('UPDATE users SET legacy_id=? WHERE id=?', [r.id, ex.id]); ex.legacy_id = r.id; s.updated++; ctx.detail('users', 'tertaut_ke_pengguna_LESAT'); continue;
    }
    let email = M.validEmail(r.email); if (email && usedEmail.has(email)) { email = null; ctx.detail('users', 'email_ganda_dikosongkan'); } if (email) usedEmail.add(email);
    const pic = M.squash(r.code).toUpperCase(); const picOk = /^[A-Z]{2,4}$/.test(pic) ? pic : null; if (!picOk && pic) ctx.detail('users', 'kode_pic_tidak_valid_dikosongkan');
    if (picOk) dupPic.set(picOk, (dupPic.get(picOk) || 0) + 1);
    const pw = require('bcryptjs').hashSync(crypto.randomBytes(18).toString('hex'), 4);                // password acak tak terpakai
    await ctx.q('INSERT INTO users (username, password, name, pic_code, email, role_id, is_active, must_change_password, legacy_id) VALUES (?,?,?,?,?,?,0,1,?)', [uname, pw, trunc(M.squash(r.name), 100), picOk, email, role.id, r.id]);
    byName.set(uname, { id: 0, username: uname, legacy_id: r.id }); s.inserted++;
  }
  // pengguna nonaktif untuk PIC tiket penampung (tahap 4)
  if (!byName.has('migrasi-sistem-lama')) {
    const pw = require('bcryptjs').hashSync(crypto.randomBytes(18).toString('hex'), 4);
    await ctx.q("INSERT INTO users (username, password, name, role_id, is_active, must_change_password) VALUES ('migrasi-sistem-lama', ?, 'Migrasi Sistem Lama', ?, 0, 1)", [pw, role.id]); s.inserted++; ctx.detail('users', 'pengguna_migrasi_sistem_lama_dibuat');
  }
  const dupes = [...dupPic].filter(([, n]) => n > 1).map(([c, n]) => `${c}×${n}`);
  if (dupes.length) ctx.addNote('users', `Kode PIC ganda antar pengguna lama (tidak dipaksa unik): ${dupes.join(', ')}`);
  ctx.addNote('users', 'Hak akses lama (`otorisasi`) tidak dimigrasi. Pengguna baru nonaktif, wajib ganti password, berperan "Pengguna Lama (tanpa akses)".');
};
