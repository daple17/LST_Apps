// Indeks untuk kartu Home (query ringkas): rencana kapal (JO Not Complete per ETA) dan tiket yang masih berjalan.
exports.up = async m => {
  if (!(await m.hasIndex('job_orders', 'idx_jo_status_eta'))) await m.q('ALTER TABLE job_orders ADD INDEX idx_jo_status_eta (status, eta_etd)');
  if (!(await m.hasIndex('handling_tickets', 'idx_ht_done_created'))) await m.q('ALTER TABLE handling_tickets ADD INDEX idx_ht_done_created (done_at, created_at)');
};
