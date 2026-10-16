// Link rahasia surat jalan digital (tanpa login): /s/<id>/<tanda tangan>. Tanda tangan = HMAC id dengan JWT_SECRET, jadi tidak bisa ditebak dan tidak perlu kolom baru.
// Mengganti JWT_SECRET mencabut semua link lama. Halaman hanya-baca (PDF surat jalan terkini).
const crypto = require('crypto'), cfg = require('../config');
const sign = id => crypto.createHmac('sha256', cfg.secret).update('sj:' + Number(id)).digest('hex').slice(0, 24);
const verify = (id, sig) => { const a = Buffer.from(sign(id)), b = Buffer.from(String(sig || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const url = (req, id) => `${baseUrl(req)}/s/${Number(id)}/${sign(id)}`;
module.exports = { sign, verify, url };
