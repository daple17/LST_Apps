// Link rahasia surat jalan digital (tanpa login), dibuka dengan scan barcode: <alamat>/s/<id><12 angka tanda tangan>.
// Hanya angka supaya barcode Code 128 bisa memadatkannya (set C) dan tetap sempit. Tanda tangan = HMAC id dengan JWT_SECRET (40 bit), jadi tidak bisa ditebak dan tidak perlu kolom baru.
// Mengganti JWT_SECRET mencabut semua link lama. Halaman hanya-baca (PDF surat jalan terkini).
const crypto = require('crypto'), cfg = require('../config');
const sign = id => (crypto.createHmac('sha256', cfg.secret).update('sj:' + Number(id)).digest().readUIntBE(0, 6) % 10 ** 12).toString().padStart(12, '0');
const code = id => `${Number(id)}${sign(id)}`;
function parse(c) { const m = /^(\d{1,9})(\d{12})$/.exec(String(c || '')); return m && { id: +m[1], sig: m[2] }; }
function verify(c) { const p = parse(c); if (!p || !p.id) return null; const a = Buffer.from(sign(p.id)), b = Buffer.from(p.sig); return crypto.timingSafeEqual(a, b) ? p.id : null; }
// PUBLIC_URL (mis. domain pendek milik perusahaan) membuat barcode lebih sempit; tanpa itu dipakai alamat yang sedang dibuka
const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const url = (req, id) => `${baseUrl(req)}/s/${code(id)}`;
module.exports = { sign, code, verify, url };
