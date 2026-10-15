// Home: kartu ringkasan (query ringkas, maksimal 8 baris per kartu).
const express = require('express');
const calc = require('../lib/calc'), fmt = require('../lib/format'), IdFmt = require('../lib/idfmt');
const { wrap } = require('../lib/http');

const CARD_ROWS = 8, PLAN_PAGE = 20;

module.exports = (pool, { ticketSummaries }) => {
  const r = express.Router();

  // Rencana kapal: JO Not Complete dengan ETA (Import) / ETD (Export) mulai `from`, semua tipe JO.
  // Baris dengan vessel + customer + tanggal yang sama digabung: party dan berat dijumlahkan.
  async function plan({ from, to, limit, offset }) {
    const w = ["j.status='NOT_COMP'", 'j.eta_etd >= ?'], p = [from];
    if (to) { w.push('j.eta_etd <= ?'); p.push(to); }
    const cond = w.join(' AND ');
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM (SELECT 1 FROM job_orders j WHERE ${cond} GROUP BY j.vessel, j.customer_id, j.eta_etd) g`, p);
    const [groups] = await pool.query(`SELECT j.vessel, j.customer_id, c.name customer, j.eta_etd, MIN(j.id) jo_id, COUNT(*) jo_count, COALESCE(SUM(j.weight_kg),0) weight_kg
      FROM job_orders j JOIN customers c ON c.id=j.customer_id WHERE ${cond} GROUP BY j.vessel, j.customer_id, c.name, j.eta_etd ORDER BY j.eta_etd, j.vessel, c.name LIMIT ? OFFSET ?`, [...p, limit, offset]);
    let parts = [];
    if (groups.length) { // satuan party per grup (hanya untuk grup yang tampil)
      const keys = groups.map(() => '(j.vessel <=> ? AND j.customer_id=? AND j.eta_etd=?)').join(' OR ');
      [parts] = await pool.query(`SELECT j.vessel, j.customer_id, j.eta_etd, j.qty, j.unit, j.party_text FROM job_orders j WHERE ${cond} AND (${keys})`, [...p, ...groups.flatMap(g => [g.vessel, g.customer_id, g.eta_etd])]);
    }
    const rows = groups.map(g => ({
      vessel: g.vessel, customer: g.customer, eta_etd: g.eta_etd, jo_id: g.jo_id, jo_count: g.jo_count, weight: calc.kgToTon(g.weight_kg),
      party: fmt.mergeParty(parts.filter(x => x.vessel === g.vessel && x.customer_id === g.customer_id && x.eta_etd === g.eta_etd)),
    }));
    return { total: n, rows };
  }

  r.get('/upcoming', wrap(async (req, res) => res.json(await plan({ from: IdFmt.jktDay(new Date()), limit: CARD_ROWS, offset: 0 }))));

  // halaman penuh "Rencana delivery" dengan filter tanggal (default mulai hari ini)
  r.get('/plan', wrap(async (req, res) => {
    const page = Math.max(1, +req.query.page || 1), from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : IdFmt.jktDay(new Date()), to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const d = await plan({ from, to, limit: PLAN_PAGE, offset: (page - 1) * PLAN_PAGE });
    res.json({ ...d, page, pages: Math.ceil(d.total / PLAN_PAGE), from, to });
  }));

  // Tiket yang sedang dikerjakan: progres belum 100% (done_at kosong), terbaru di atas
  r.get('/tickets', wrap(async (req, res) => {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM handling_tickets WHERE done_at IS NULL AND is_placeholder=0');
    const [ids] = await pool.query('SELECT id FROM handling_tickets WHERE done_at IS NULL AND is_placeholder=0 ORDER BY created_at DESC, id DESC LIMIT ?', [CARD_ROWS]);
    const rows = await ticketSummaries(ids.map(x => x.id));
    res.json({ total: n, rows: rows.map(t => ({ id: t.id, ticket_no: t.ticket_no, pic: IdFmt.firstName(t.pic_name), customers: t.customers, vessels: t.vessels, parties: t.parties, weight: t.weight, mat_pct: t.mat_pct, del_pct: t.del_pct })) });
  }));
  return r;
};
