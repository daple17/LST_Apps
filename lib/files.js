// Penyimpanan berkas: satu tabel `files` dengan pemilik polimorfik (owner_type + owner_id).
const fs = require('fs'), path = require('path');
const cfg = require('../config');
const { LIMITS, FILE_TYPES } = require('./rules');
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const mimeOf = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
function validate(filename, size, { imagesOnly = false } = {}) {
  const ext = path.extname(filename || '').toLowerCase();
  const allowed = imagesOnly ? ['.jpg', '.jpeg', '.png', '.webp', '.gif'] : Object.values(FILE_TYPES).flat();
  if (!allowed.includes(ext)) return imagesOnly ? 'File harus gambar (jpg/png/webp)' : 'File harus PDF, JPG atau PNG';
  if (size > (imagesOnly ? 8 : LIMITS.FILE_MAX_MB) * 1024 * 1024) return `Ukuran file maks ${imagesOnly ? 8 : LIMITS.FILE_MAX_MB} MB`;
  return null;
}

// buffer -> disk + baris files; return id
async function create(db, { ownerType, ownerId, kind = null, filename, buffer, user, imagesOnly = false }) {
  const err = validate(filename, buffer.length, { imagesOnly });
  if (err) throw Object.assign(new Error(err), { status: 400 });
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${path.basename(filename).replace(/[^\w.-]/g, '_')}`;
  fs.writeFileSync(path.join(cfg.uploadDir, stored), buffer);
  const [r] = await db.query('INSERT INTO files (owner_type, owner_id, kind, filename, path, size, mime, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
    [ownerType, ownerId, kind, filename, stored, buffer.length, mimeOf(filename), user?.id ?? null]);
  return r.insertId;
}
const fromBase64 = data => Buffer.from(String(data || ''), 'base64');
const diskPath = stored => path.join(cfg.uploadDir, stored);
const rmDisk = stored => stored && fs.rmSync(diskPath(stored), { force: true });

// hapus berkas (baris + disk) milik pemilik tertentu
async function removeByOwner(db, ownerType, ownerIds) {
  ownerIds = [].concat(ownerIds).filter(x => x != null);
  if (!ownerIds.length) return;
  const [rows] = await db.query('SELECT id, path FROM files WHERE owner_type=? AND owner_id IN (?)', [ownerType, ownerIds]);
  if (rows.length) await db.query('DELETE FROM files WHERE id IN (?)', [rows.map(r => r.id)]);
  rows.forEach(r => rmDisk(r.path));
}
async function removeById(db, id) {
  const [[f]] = await db.query('SELECT path FROM files WHERE id=?', [id]);
  if (!f) return false;
  await db.query('DELETE FROM files WHERE id=?', [id]); rmDisk(f.path); return true;
}
module.exports = { mimeOf, validate, create, fromBase64, diskPath, rmDisk, removeByOwner, removeById };
