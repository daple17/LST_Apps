// Jejak "siapa & kapan" untuk semua perubahan di dua menu (keputusan 10).
async function log(db, { entity, id, action, note = null, user }) {
  await db.query('INSERT INTO audit_log (entity_type, entity_id, action, note, user_id, user_name) VALUES (?,?,?,?,?,?)',
    [entity, id, action, note, user?.id ?? null, user?.name ?? null]);
}
module.exports = { log };
