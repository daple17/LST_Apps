/* Home: ringkasan pekerjaan hari ini (spesifikasi: docs/spec-home.md).
   Tahap 2 = kerangka (header, sapaan, tanggal, tata letak, bingkai kartu). Isi kartu diisi di tahap berikutnya. */
const HOME_COLS = [
  [{ id: 'upcoming', title: 'Upcoming Plan', more: '#plan' }, { id: 'ho', title: 'Handling Ops', more: '#ho' }],
  [{ id: 'settlement', title: 'Settlement', more: null }, { id: 'trailer', title: "Trailer's Schedule", more: null }],
];
const HOME_FULL = { id: 'faktur', title: 'Faktur Pajak Reimburse', more: null };

const homeCard = c => `<section class="card hcard" id="c-${c.id}" aria-labelledby="t-${c.id}">
  <header class="hc-h"><h3 id="t-${c.id}">${esc(c.title)} <span class="hc-n" id="n-${c.id}" hidden></span></h3>
    ${c.more ? `<a class="hc-more" href="${c.more}">More info..</a>` : '<span class="hc-more off" aria-disabled="true" title="Menu belum aktif">More info..</span>'}</header>
  <div class="hc-b" id="b-${c.id}" aria-live="polite"><div class="skel" aria-hidden="true"></div><div class="skel s2" aria-hidden="true"></div><div class="skel s3" aria-hidden="true"></div></div></section>`;

function homeRoute() {
  $('#ttl').textContent = `Hi, ${IdFmt.firstName(uname) || 'User'}`;
  $('#view').innerHTML = `<div class="hhead"><p class="hdate"><time datetime="${IdFmt.jktDay(new Date())}">${IdFmt.longDate(new Date())}</time></p>
    <div class="hlinks"><button class="btn sec sm" type="button" disabled title="Menu belum aktif">Data &amp; Profil <span class="soon">segera</span></button><button class="btn sm" type="button" disabled title="Menu belum aktif">Check In <span class="soon">segera</span></button></div></div>
    <div class="home">${HOME_COLS.map(col => `<div class="hcol">${col.map(homeCard).join('')}</div>`).join('')}<div class="hfull">${homeCard(HOME_FULL)}</div></div>`;
}
