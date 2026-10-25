(() => {
  if (document.getElementById('amq-fab')) return;

  const ORIGIN = location.origin + '/';
  const ROWS_PER_PAGE = 35;   // normal page
  const ROWS_DENSE = 40;      // a group with more than 35 students: up to 40 per page (tighter rows)
  const LEVEL_ORDER = ['تحضيري', 'أولى', 'ثانية', 'ثالثة', 'رابعة', 'خامسة'];
  const parentCache = {};
  let students = null;
  let studentsYear = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const text = (html) => new DOMParser().parseFromString(String(html ?? ''), 'text/html').body.textContent.trim();
  const pad2 = (n) => String(n).padStart(2, '0');
  const cleanName = (s) => text(s).replace(/^[.\s]+|[.\s]+$/g, '');
  const fmtDate = (d) => {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
  };

  function currentYear() {
    const now = new Date();
    // outside the students page there is no #annee_act: derive the school year (starts in August)
    const act = ($('#annee_act') || {}).value || String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
    const sel = ($('#annee_school') || {}).value;
    return { act, year: sel || act };
  }

  function pageDefaults() {
    let directorate = '', school = '';
    const t = document.querySelector('.ui.fixed.main.menu .title.item:nth-of-type(2)');
    const el = [...document.querySelectorAll('.title.item')].find((e) => /مديرية/.test(e.textContent));
    if (el || t) {
      const parts = (el || t).innerHTML.split(/<br\s*\/?>/i).map(text).filter(Boolean);
      directorate = parts[0] || '';
      school = (parts[1] || '').replace(/\(.*?\)/g, '').replace(/^مدرسة\s*/, '').trim();
    }
    return { directorate, school };
  }

  async function post(url, params) {
    const r = await fetch(ORIGIN + url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(params)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function loadStudents() {
    const { act, year } = currentYear();
    if (students && studentsYear === year) return students;
    const params = year !== act ? { annee: year } : {};
    const j = await post('scolarite/dossier_eleves/eleves/list_eleves', params);
    const rows = Array.isArray(j) ? j : j.data || [];
    students = rows.map((a) => ({
      mat: text(a[1]),
      nom: cleanName(a[2]),
      prenom: cleanName(a[3]),
      sexe: text(a[4]),
      dob: fmtDate(text(a[5])),
      dobRaw: text(a[5]),
      reg: text(a[8]),
      level: text(a[6]),
      group: text(a[7])
    }));
    studentsYear = year;
    return students;
  }

  async function getParent(mat, annee) {
    if (parentCache[mat]) return parentCache[mat];
    try {
      const d = await post('scolarite/dossier_eleves/eleves/info_civil', { mat, annee });
      parentCache[mat] = { pere: (d.nom_pere || '').trim(), tel: (d.tel || '').trim() };
    } catch (e) {
      parentCache[mat] = { pere: '', tel: '' };
    }
    return parentCache[mat];
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < items.length) { const k = i++; await fn(items[k]); }
    }));
  }

  const arKey = (s) => s.replace(/[^\u0621-\u064A\s]/g, '');
  const sortStudents = (a, b) => arKey(a.nom).localeCompare(arKey(b.nom), 'ar') || arKey(a.prenom).localeCompare(arKey(b.prenom), 'ar');

  function buildGroups(list) {
    const map = {};
    list.forEach((s) => {
      const k = s.level + '|' + s.group;
      (map[k] = map[k] || { level: s.level, group: s.group, items: [] }).items.push(s);
    });
    return Object.values(map).sort((a, b) => {
      const la = LEVEL_ORDER.indexOf(a.level), lb = LEVEL_ORDER.indexOf(b.level);
      return (la - lb) || (Number(a.group) - Number(b.group));
    });
  }

  // ---------- Print document ----------
  const FONT_REG = chrome.runtime.getURL('fonts/HacenTunisia.ttf');
  const FONT_BOLD = chrome.runtime.getURL('fonts/HacenTunisia-Bold.ttf');
  const PRINT_CSS = `
  @font-face{font-family:"Hacen Tunisia";font-weight:400;src:local("Hacen Tunisia"),local("HacenTunisia"),url("${FONT_REG}") format("truetype")}
  @font-face{font-family:"Hacen Tunisia";font-weight:700;src:local("Hacen Tunisia Bold"),local("HacenTunisia-Bold"),url("${FONT_BOLD}") format("truetype"),local("Hacen Tunisia"),url("${FONT_REG}") format("truetype")}
  @page{size:A4 portrait;margin:8mm 9mm}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Hacen Tunisia",Tahoma,"Segoe UI",Arial,sans-serif;direction:rtl;color:#000;font-size:11pt}
  .page{page-break-after:always;width:100%}
  .page:last-child{page-break-after:auto}
  .hd{text-align:center;font-weight:bold;font-size:11pt;line-height:1.55}
  .r1{display:flex;justify-content:space-between;font-weight:bold;font-size:10.5pt;margin-top:2mm}
  .r1 div{white-space:nowrap}
  .teacher{font-weight:bold;font-size:10.5pt;margin:1mm 0 2mm}
  .ttl{margin-right:4%;width:96%;background:#ffff00;border:2px solid #000;text-align:center;font-weight:bold;font-size:10.5pt;padding:1.3mm 0}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{background:#ffff00;border:2px solid #000;font-size:10.5pt;height:9mm;padding:0 2px}
  .dense th{height:7.5mm}
  .dense td{height:4.9mm;font-size:9.5pt}
  .dense .hd{line-height:1.35}.dense .teacher{margin:0 0 1mm}
  td{border:1px solid #000;height:5.65mm;font-size:10pt;text-align:center;padding:0 2px;overflow:hidden;white-space:nowrap}
  td.n{font-weight:bold;border-left:2px solid #000}
  td.l{text-align:center}
  .ft{display:flex;justify-content:space-between;align-items:flex-start;margin-top:0}
  .sig{font-size:9pt;font-weight:bold;margin:1mm 30mm 0 0}
  .cnt{border:2px solid #000;width:57mm;font-weight:bold;font-size:10pt;margin-left:auto}
  .cnt div{display:flex;justify-content:space-between;padding:.6mm 3mm}
  .cnt div+div{border-top:1px solid #000}
  .ft{flex-direction:row}
  `;

  function pageHtml(g, chunk, pageIdx, pages, opt, season, per, dense) {
    const startNo = pageIdx * per;
    let rows = '';
    for (let i = 0; i < chunk.length; i++) {
      const s = chunk[i];
      rows += `<tr><td class="n">${startNo + i + 1}</td>` +
        (s ? `<td>${esc(s.nom)}</td><td>${esc(s.prenom)}</td><td>${esc(s.sexe)}</td><td>${esc(s.dob)}</td><td>${esc(s.wali)}</td><td>${esc(s.tel)}</td><td>${esc(s.reg && s.reg !== '0' ? s.reg : '')}</td>`
           : '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>') + '</tr>';
    }
    const last = pageIdx === pages - 1;
    const males = g.items.filter((s) => s.sexe === 'ذكر').length;
    const females = g.items.filter((s) => s.sexe === 'أنثى').length;
    const footer = `<div class="ft">
        <div class="cnt">${last ? `<div><span>عدد الذكور</span><span>${males}</span></div><div><span>عدد الإناث</span><span>${females}</span></div>` : '<div><span>عدد الذكور</span><span></span></div><div><span>عدد الإناث</span><span></span></div>'}</div>
        <div class="sig">إمضاء المدير(ة)</div><div style="width:57mm"></div></div>`;
    return `<section class="page${dense ? ' dense' : ''}">
      <div class="hd">الجمهورية الجزائرية الديمقراطية الشعبية<br>وزارة التربية الوطنية</div>
      <div class="r1"><div>${esc(opt.directorate)}</div></div>
      <div class="r1"><div>ابتدائية: ${esc(opt.school)}</div><div>الموسم الدراسي: ${esc(season)}</div></div>
      <div class="teacher">الأستاذ(ة): ${esc(opt.teacher)}</div>
      <div class="ttl">قائمة التلاميذ لسنة ${esc(g.level)} ابتدائي ${esc(pad2(g.group))} للسنة الدراسية: ${esc(season.replace('-', ' - '))}</div>
      <table>
        <colgroup><col style="width:4%"><col style="width:15%"><col style="width:17%"><col style="width:7%"><col style="width:12%"><col style="width:18%"><col style="width:15%"><col style="width:12%"></colgroup>
        <thead><tr><th></th><th>اللقب</th><th>الاسم</th><th>الجنس</th><th>تاريخ الميلاد</th><th>الولي</th><th>رقم هاتف الولي</th><th>رقم التسجيل</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${footer}
    </section>`;
  }

  function printGroups(groups, opt, season) {
    let body = '';
    groups.forEach((g) => {
      const sorted = g.items.slice().sort(sortStudents);
      // more than 35 students -> pages of up to 40; otherwise 35
      const dense = sorted.length > ROWS_PER_PAGE;
      const per = dense ? ROWS_DENSE : ROWS_PER_PAGE;
      const pages = Math.max(1, Math.ceil(sorted.length / per));
      for (let p = 0; p < pages; p++) {
        body += pageHtml({ ...g, items: sorted }, sorted.slice(p * per, (p + 1) * per), p, pages, opt, season, per, dense);
      }
    });
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قوائم التلاميذ</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
    const old = document.getElementById('amq-frame');
    if (old) old.remove();
    const fr = document.createElement('iframe');
    fr.id = 'amq-frame';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.contentDocument.open();
    fr.contentDocument.write(html);
    fr.contentDocument.close();
    const go = () => { fr.contentWindow.focus(); fr.contentWindow.print(); };
    setTimeout(() => {
      const f = fr.contentDocument.fonts;
      if (f && f.ready) Promise.race([f.ready, new Promise((r) => setTimeout(r, 1500))]).then(go); else go();
    }, 300);
  }

  // ---------- UI ----------
  const fab = document.createElement('button');
  fab.id = 'amq-fab';
  fab.textContent = '🖨 طباعة قوائم الأفواج';
  document.body.appendChild(fab);

  const overlay = document.createElement('div');
  overlay.id = 'amq-overlay';
  overlay.innerHTML = `
    <div id="amq-panel">
      <h3>طباعة قوائم التلاميذ حسب الفوج</h3>
      <label class="f">المديرية (ترويسة القائمة)</label><input type="text" id="amq-dir">
      <label class="f">اسم المدرسة</label><input type="text" id="amq-school">
      <label class="f">الأستاذ(ة) (اختياري — يُطبع على كل القوائم المحددة، ويمكن تركه فارغاً)</label><input type="text" id="amq-teacher">
      <label class="f">الأفواج المراد طباعتها</label>
      <div id="amq-groups">جاري تحميل الأفواج...</div>
      <div class="amq-row">
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="amq-par" checked> جلب اسم الولي ورقم هاتفه (أبطأ قليلاً)</label>
        <button class="amq-btn amq-sec" id="amq-all" style="margin-right:auto">تحديد/إلغاء الكل</button>
      </div>
      <div class="amq-row">
        <button class="amq-btn amq-go" id="amq-print">طباعة</button>
        <button class="amq-btn amq-sec" id="amq-close">إغلاق</button>
      </div>
      <div id="amq-status"></div>
    </div>`;
  document.body.appendChild(overlay);

  const status = (m, err = true) => { const s = $('#amq-status'); s.style.color = err ? '#a33' : '#2a7'; s.textContent = m; };
  let groups = [];

  async function openPanel() {
    overlay.classList.add('open');
    status('');
    const saved = await new Promise((r) => chrome.storage.local.get(['dir', 'school', 'teacher'], r));
    const d = pageDefaults();
    $('#amq-dir').value = saved.dir || d.directorate;
    $('#amq-school').value = saved.school || d.school;
    $('#amq-teacher').value = saved.teacher || '';
    const box = $('#amq-groups');
    box.textContent = 'جاري تحميل الأفواج...';
    try {
      const list = await loadStudents();
      groups = buildGroups(list);
      if (!groups.length) { box.textContent = 'لا يوجد تلاميذ.'; return; }
      box.innerHTML = groups.map((g, i) =>
        `<label><input type="checkbox" data-i="${i}" checked> ${esc(g.level)} ابتدائي — فوج ${esc(pad2(g.group))} <small>${g.items.length} تلميذ</small></label>`).join('');
    } catch (e) {
      box.textContent = 'تعذّر تحميل القائمة. تأكد من أنك مسجّل الدخول ثم أعد المحاولة.';
    }
  }

  fab.addEventListener('click', openPanel);
  $('#amq-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  $('#amq-all').addEventListener('click', () => {
    const boxes = [...document.querySelectorAll('#amq-groups input')];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !all));
  });

  $('#amq-print').addEventListener('click', async () => {
    const btn = $('#amq-print');
    const chosen = [...document.querySelectorAll('#amq-groups input:checked')].map((b) => groups[+b.dataset.i]);
    if (!chosen.length) return status('اختر فوجاً واحداً على الأقل.');
    const opt = { directorate: $('#amq-dir').value.trim(), school: $('#amq-school').value.trim(), teacher: $('#amq-teacher').value.trim() };
    chrome.storage.local.set({ dir: opt.directorate, school: opt.school, teacher: opt.teacher });
    btn.disabled = true;
    try {
      const { act, year } = currentYear();
      const work = chosen.map((g) => ({ ...g, items: g.items.map((s) => ({ ...s })) }));
      if ($('#amq-par').checked) {
        const all = work.flatMap((g) => g.items);
        let done = 0;
        await pool(all, 6, async (s) => {
          const p = await getParent(s.mat, year);
          s.wali = p.pere.replace(/\s+(ابن|بن)(\s.*)?$/, '').trim();
          s.tel = p.tel;
          status(`جلب بيانات الأولياء ${++done} / ${all.length}`, false);
        });
      }
      status('');
      const season = `${year}-${Number(year) + 1}`;
      printGroups(work, opt, season);
    } catch (e) {
      status('حدث خطأ أثناء التحضير للطباعة: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- School certificates: A5 x2 on A4 landscape ----------
  const cfab = document.createElement('button');
  cfab.id = 'amq-fab2';
  cfab.textContent = '📄 شهادة مدرسية ×2';
  document.body.appendChild(cfab);

  const coverlay = document.createElement('div');
  coverlay.id = 'amq-overlay2';
  coverlay.innerHTML = `
    <div id="amq-panel2">
      <h3>طباعة الشهادة المدرسية — A5 مرتين في ورقة A4</h3>
      <input type="text" id="amq-c-q" placeholder="🔍 ابحث بالاسم أو اللقب أو رقم التعريف أو تاريخ الميلاد...">
      <div class="amq-row">
        <select id="amq-c-lvl" class="amq-sel"><option value="">كل المستويات</option></select>
        <select id="amq-c-grp" class="amq-sel"><option value="">كل الأفواج</option></select>
      </div>
      <div class="amq-row amq-sub">
        <label><input type="checkbox" id="amq-c-all"> تحديد الكل (النتائج الظاهرة)</label>
        <span id="amq-c-count" style="margin-right:auto"></span>
      </div>
      <div id="amq-c-list">جاري التحميل...</div>
      <div id="amq-c-note">تُطبع نسخة A5 واحدة لكل تلميذ مكررة مرتين في ورقة A4 بالعرض، وتظهر نافذة الطباعة مباشرة.</div>
      <div class="amq-row">
        <button class="amq-btn amq-go" id="amq-c-print">طباعة</button>
        <button class="amq-btn amq-sec" id="amq-c-close">إغلاق</button>
      </div>
      <div id="amq-status2"></div>
    </div>`;
  document.body.appendChild(coverlay);

  const cstatus = (m, err = true) => { const s = $('#amq-status2'); s.style.color = err ? '#a33' : '#2a7'; s.textContent = m; };
  const levelRank = (l) => { const i = LEVEL_ORDER.indexOf(l); return i < 0 ? 99 : i; };
  const cmp = (a, b) => levelRank(a.level) - levelRank(b.level) || Number(a.group) - Number(b.group) || sortStudents(a, b);

  function applyFilters(list, f) {
    const terms = f.q.split(/\s+/).filter(Boolean);
    return list.filter((s) => {
      if (f.lvl && s.level !== f.lvl) return false;
      if (f.grp && s.group !== f.grp) return false;
      const hay = [s.mat, s.nom, s.prenom, s.sexe, s.dobRaw, s.dob, s.level, s.group].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  let cData = [];
  const chk = new Set();
  const cFiltered = () => applyFilters(cData, {
    q: $('#amq-c-q').value.trim().toLowerCase(),
    lvl: $('#amq-c-lvl').value,
    grp: $('#amq-c-grp').value
  });

  function renderList() {
    const f = cFiltered();
    $('#amq-c-list').innerHTML = f.length
      ? f.map((s) => `<label><input type="checkbox" data-m="${esc(s.mat)}" ${chk.has(s.mat) ? 'checked' : ''}> <span>${esc(s.nom + ' ' + s.prenom)}</span><small>${esc(s.level)} — فوج ${esc(pad2(s.group))}</small></label>`).join('')
      : '<div style="padding:8px;color:#777">لا توجد نتائج</div>';
    updateCount(f);
  }
  function updateCount(f = cFiltered()) {
    const n = f.filter((s) => chk.has(s.mat)).length;
    $('#amq-c-count').textContent = `المحدد للطباعة: ${n} من ${f.length}`;
    $('#amq-c-all').checked = f.length > 0 && n === f.length;
  }

  async function openCertPanel() {
    coverlay.classList.add('open');
    cstatus('');
    $('#amq-c-list').textContent = 'جاري التحميل...';
    try {
      cData = (await loadStudents()).slice().sort(cmp);
      const lv = [...new Set(cData.map((s) => s.level))].sort((a, b) => levelRank(a) - levelRank(b));
      const gr = [...new Set(cData.map((s) => s.group))].sort((a, b) => Number(a) - Number(b));
      $('#amq-c-lvl').innerHTML = '<option value="">كل المستويات</option>' + lv.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
      $('#amq-c-grp').innerHTML = '<option value="">كل الأفواج</option>' + gr.map((x) => `<option value="${esc(x)}">${esc(pad2(x))}</option>`).join('');
      // prefill from the site's own filters / selected row
      const siteQ = (($('#eleves_filter input') || {}).value || '').trim();
      const siteL = ($('#select6') || {}).value || '';
      const siteG = ($('#select8') || {}).value || '';
      $('#amq-c-q').value = siteQ;
      if (lv.includes(siteL)) $('#amq-c-lvl').value = siteL;
      if (gr.includes(siteG)) $('#amq-c-grp').value = siteG;
      chk.clear();
      const f = cFiltered();
      const td = $('#eleves tbody tr.selected td:nth-child(2)');
      const selMat = td ? td.textContent.trim() : '';
      if (siteQ || siteL || siteG) f.forEach((s) => chk.add(s.mat));
      else if (selMat) chk.add(selMat);
      renderList();
    } catch (e) {
      $('#amq-c-list').textContent = 'تعذّر تحميل القائمة. تأكد من تسجيل الدخول ثم أعد المحاولة.';
    }
  }

  cfab.addEventListener('click', openCertPanel);
  $('#amq-c-close').addEventListener('click', () => coverlay.classList.remove('open'));
  coverlay.addEventListener('mousedown', (e) => { if (e.target === coverlay) coverlay.classList.remove('open'); });
  ['#amq-c-q'].forEach((s) => $(s).addEventListener('input', renderList));
  ['#amq-c-lvl', '#amq-c-grp'].forEach((s) => $(s).addEventListener('change', renderList));
  $('#amq-c-list').addEventListener('change', (e) => {
    const m = e.target.dataset && e.target.dataset.m;
    if (!m) return;
    e.target.checked ? chk.add(m) : chk.delete(m);
    updateCount();
  });
  $('#amq-c-all').addEventListener('change', (e) => {
    cFiltered().forEach((s) => (e.target.checked ? chk.add(s.mat) : chk.delete(s.mat)));
    renderList();
  });

  async function fetchCert(mat, year) {
    const r = await fetch(`${ORIGIN}scolarite/dossier_eleves/etats_imp/attestation/${mat}/${year}`, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const u8 = new Uint8Array(await r.arrayBuffer());
    if (String.fromCharCode(...u8.slice(0, 5)) === '%PDF-') return { pdf: u8 };
    const t = new TextDecoder().decode(u8).trim();
    if (/^JVBER/.test(t)) {
      const bin = atob(t.replace(/\s/g, ''));
      return { pdf: Uint8Array.from(bin, (ch) => ch.charCodeAt(0)) };
    }
    return { html: t };
  }

  // A4 landscape, two A5-portrait cells side by side
  async function composePdf(items) {
    const { PDFDocument, rgb } = PDFLib;
    const out = await PDFDocument.create();
    const W = 841.89, H = 595.28;
    for (const it of items) {
      const src = await PDFDocument.load(it.pdf, { ignoreEncryption: true });
      const [emb] = await out.embedPdf(src, [0]);
      const page = out.addPage([W, H]);
      const sc = Math.min((W / 2) / emb.width, H / emb.height);
      const dw = emb.width * sc, dh = emb.height * sc;
      [W * 0.25, W * 0.75].forEach((cx) => page.drawPage(emb, { x: cx - dw / 2, y: (H - dh) / 2, width: dw, height: dh }));
      page.drawLine({ start: { x: W / 2, y: 0 }, end: { x: W / 2, y: H }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6), dashArray: [4, 3] });
    }
    return new Blob([await out.save()], { type: 'application/pdf' });
  }

  function composeHtml(items) {
    const attr = (h) => esc(`<base href="${ORIGIN}">` + h);
    const pages = items.map((it) => `<div class="pg"><iframe srcdoc="${attr(it.html)}"></iframe><iframe srcdoc="${attr(it.html)}"></iframe></div>`).join('');
    const doc = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>الشهادات المدرسية</title><style>@page{size:A4 landscape;margin:0}body{margin:0}.pg{width:297mm;height:210mm;page-break-after:always;overflow:hidden;display:flex;direction:ltr}iframe{display:block;width:148.5mm;height:210mm;border:0}iframe+iframe{border-left:1px dashed #888}</style></head><body>${pages}</body></html>`;
    return new Blob([doc], { type: 'text/html' });
  }

  function printBlob(blob, delay) {
    const old = document.getElementById('amq-cframe');
    if (old) old.remove();
    const url = URL.createObjectURL(blob);
    const fr = document.createElement('iframe');
    fr.id = 'amq-cframe';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    fr.onload = () => setTimeout(() => {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* fallback link below */ }
    }, delay);
    fr.src = url;
    document.body.appendChild(fr);
    return url;
  }

  $('#amq-c-print').addEventListener('click', async () => {
    const btn = $('#amq-c-print');
    const chosen = cFiltered().filter((s) => chk.has(s.mat));
    if (!chosen.length) return cstatus('حدّد تلميذاً واحداً على الأقل.');
    if (chosen.length > 60 && !confirm(`سيتم تحضير ${chosen.length} شهادة. هل تريد المتابعة؟`)) return;
    btn.disabled = true;
    try {
      const { year } = currentYear();
      const items = new Array(chosen.length);
      let done = 0;
      await pool(chosen.map((s, i) => i), 4, async (i) => {
        items[i] = { s: chosen[i], ...(await fetchCert(chosen[i].mat, year)) };
        cstatus(`جلب الشهادات ${++done} / ${chosen.length}`, false);
      });
      const allPdf = items.every((x) => x.pdf), allHtml = items.every((x) => x.html);
      if (!allPdf && !allHtml) throw new Error('تنسيق الشهادة غير متوقع');
      const blob = allPdf ? await composePdf(items) : composeHtml(items);
      const url = printBlob(blob, allPdf ? 800 : 1500);
      $('#amq-status2').style.color = '#2a7';
      $('#amq-status2').innerHTML = `تم التحضير (${chosen.length} شهادة). إن لم تظهر نافذة الطباعة <a href="${url}" target="_blank">افتح الملف في تبويب جديد</a>.`;
    } catch (e) {
      cstatus('حدث خطأ: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
})();
