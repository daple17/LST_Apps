// --reset-legacy: hapus semua baris hasil impor (origin='LEGACY' / legacy_id terisi) di database tujuan SAJA, lalu hitung ulang penghitung nomor. Untuk mengulang uji.
exports.resetLegacy = async ctx => {
  const s = ctx.st('reset'), d = (k, n) => { if (n) s.details[k] = (s.details[k] || 0) + n; }, run = async (sql, p) => (await ctx.q(sql, p)).affectedRows || 0;
  d('audit_log_tiket', await run("DELETE FROM audit_log WHERE entity_type='ticket' AND entity_id IN (SELECT id FROM handling_tickets WHERE origin='LEGACY')"));
  d('delivery_note_items', await run("DELETE i FROM delivery_note_items i JOIN delivery_notes n ON n.id=i.dn_id WHERE n.origin='LEGACY'"));
  d('delivery_notes', await run("DELETE FROM delivery_notes WHERE origin='LEGACY'"));
  d('material_reports', await run("DELETE r FROM material_reports r JOIN jo_materials m ON m.id=r.material_id WHERE m.data_origin='LEGACY'"));
  d('ticket_job_orders', await run("DELETE t FROM ticket_job_orders t LEFT JOIN handling_tickets h ON h.id=t.ticket_id LEFT JOIN job_orders j ON j.id=t.jo_id WHERE h.origin='LEGACY' OR j.origin='LEGACY'"));
  d('handling_tickets', await run("DELETE FROM handling_tickets WHERE origin='LEGACY'"));
  d('jo_materials', await run("DELETE FROM jo_materials WHERE data_origin='LEGACY'"));
  d('job_orders', await run("DELETE FROM job_orders WHERE origin='LEGACY'"));               // jo_references, jo_checklist, jo_containers ikut terhapus (CASCADE)
  const skipped = {};
  for (const [t, ref] of [['customers', 'job_orders.customer_id'], ['vendors', 'delivery_notes.vendor_id'], ['shippers', 'job_orders.shipper_id'], ['ports', null], ['tps_warehouses', null], ['countries', null]]) {
    let where = 'legacy_id IS NOT NULL';
    if (ref) { const [rt, rc] = ref.split('.'); where += ` AND id NOT IN (SELECT ${rc} FROM ${rt} WHERE ${rc} IS NOT NULL)`; }
    if (t === 'countries') where += ' AND id NOT IN (SELECT country_id FROM ports WHERE country_id IS NOT NULL) AND id NOT IN (SELECT country_id FROM vendors WHERE country_id IS NOT NULL) AND id NOT IN (SELECT country_id FROM shippers WHERE country_id IS NOT NULL)';
    d(t, await run(`DELETE FROM \`${t}\` WHERE ${where}`));
    const left = await ctx.count(t, 'legacy_id IS NOT NULL'); if (left) skipped[t] = left;
  }
  // pengguna: yang dibuat impor dihapus; yang sekadar tertaut ke pengguna LESAT hanya dilepas tautannya
  const role = await ctx.q1("SELECT id FROM roles WHERE name='Pengguna Lama (tanpa akses)'");
  if (role) d('users', await run("DELETE FROM users WHERE role_id=? AND is_active=0 AND last_login_at IS NULL AND (legacy_id IS NOT NULL OR username='migrasi-sistem-lama') AND id NOT IN (SELECT pic_id FROM handling_tickets)", [role.id]));
  d('users_tautan_dilepas', await run('UPDATE users SET legacy_id=NULL WHERE legacy_id IS NOT NULL'));
  if (role && !(await ctx.count('users', 'role_id=' + role.id))) d('roles', await run('DELETE FROM roles WHERE id=?', [role.id]));
  d('legacy_quarantine', await run('DELETE FROM legacy_quarantine'));
  // penghitung: hitung ulang dari data yang tersisa (TICKET tidak disentuh)
  // JO: nilai sebelum impor pertama (dicatat di import_runs); bila tidak ada, hitung dari data yang tersisa
  const first = (await ctx.q("SELECT summary FROM import_runs WHERE mode='commit' ORDER BY id LIMIT 1"))[0];
  let before; try { before = first && (typeof first.summary === 'string' ? JSON.parse(first.summary) : first.summary)?.counters_before; } catch { before = null; }
  const jo = await ctx.q1('SELECT MAX(CAST(no_jo AS UNSIGNED)) n FROM job_orders'), want = before && before.JO != null ? Math.max(before.JO, jo.n || 0) : (jo.n || 0);
  if (want || (before && before.JO != null)) await ctx.q("INSERT INTO counters (name, period, last) VALUES ('JO','',?) ON DUPLICATE KEY UPDATE last=VALUES(last)", [want]); else await ctx.q("DELETE FROM counters WHERE name='JO'");
  d('import_runs', await run('DELETE FROM import_runs'));                                  // riwayat impor menggambarkan keadaan yang sudah dihapus
  await ctx.q("DELETE FROM counters WHERE name='SJ'");
  for (const r of await ctx.q("SELECT SUBSTRING(no_sj,1,6) p, MAX(CAST(SUBSTRING(no_sj,7) AS UNSIGNED)) n FROM delivery_notes WHERE no_sj REGEXP '^[0-9]{10}$' GROUP BY 1")) await ctx.q("INSERT INTO counters (name, period, last) VALUES ('SJ',?,?)", [r.p, r.n]);
  if (Object.keys(skipped).length) ctx.addNote('reset', `Tidak terhapus karena masih dirujuk data lain (legacy_id tetap): ${JSON.stringify(skipped)}`);
};
