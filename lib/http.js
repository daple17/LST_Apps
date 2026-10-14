const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(e => {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error(e); res.status(500).json({ error: e.message });
});
const bad = (res, m) => res.status(400).json({ error: m });
// lempar dari dalam handler/transaksi -> jadi respons 4xx
const httpError = (status, message) => Object.assign(new Error(message), { status });
async function tx(pool, fn) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
module.exports = { wrap, bad, httpError, tx };
