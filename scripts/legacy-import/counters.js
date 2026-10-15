// Penghitung nomor: JO dinaikkan minimal ke nomor JO lama terbesar; SJ per bulan ke urutan surat jalan lama terbesar. TICKET tidak disentuh (format nomor tiket lama berbeda).
exports.counters = async ctx => {
  const s = ctx.st('counters');
  const jo = await ctx.q1("SELECT MAX(CAST(legacy_no AS UNSIGNED)) n FROM job_orders WHERE origin='LEGACY'");
  if (jo.n) { await ctx.q("INSERT INTO counters (name, period, last) VALUES ('JO', '', ?) ON DUPLICATE KEY UPDATE last = GREATEST(last, VALUES(last))", [jo.n]); s.updated++; ctx.detail('counters', `JO>=${jo.n}`); }
  const sj = await ctx.q("SELECT SUBSTRING(no_sj,1,6) p, MAX(CAST(SUBSTRING(no_sj,7) AS UNSIGNED)) n FROM delivery_notes WHERE origin='LEGACY' AND no_sj REGEXP '^[0-9]{10}$' GROUP BY 1");
  for (const r of sj) { await ctx.q("INSERT INTO counters (name, period, last) VALUES ('SJ', ?, ?) ON DUPLICATE KEY UPDATE last = GREATEST(last, VALUES(last))", [r.p, r.n]); s.updated++; }
  if (sj.length) ctx.detail('counters', `SJ_periode=${sj.length}`);
  s.source = s.updated;
};
