(() => {
  if (document.getElementById('amq3-fab')) return;

  const ORIGIN = location.origin + '/';
  const onPersonnel = location.pathname.indexOf('/pers/personnel') === 0;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const text = (h) => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.trim();
  const store = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
    set: (o) => chrome.storage.local.set(o)
  };
  const FONTS = { reg: chrome.runtime.getURL('fonts/HacenTunisia.ttf'), bold: chrome.runtime.getURL('fonts/HacenTunisia-Bold.ttf') };

  // fields we need from the personnel table
  const FIELDS = [
    ['nom', 'اللقب', /لقب/],
    ['prenom', 'الاسم', null],
    ['dob', 'تاريخ الميلاد', /تاريخ.*(ميلاد|ازدياد)/],
    ['grade', 'الرتبة', /رتبة/],
    ['subject', 'المادة', /مادة|تخصص/],
    ['degree', 'الدرجة', /درجة/],
    ['effect', 'تاريخ النفاذ (= تاريخ السريان)', [/سريان/, /نفاذ/]]
  ];

  let mode = 'cert';
  let dump = null;
  let map = {};
  let staff = [];
  const chk = new Set();
  const arKey = (s) => String(s).replace(/[^\u0621-\u064A\s]/g, '');

  // ---------- page defaults ----------
  function pageDefaults() {
    const el = [...document.querySelectorAll('.title.item')].find((e) => /مديرية/.test(e.textContent));
    let directorate = '', school = '';
    if (el) {
      const parts = el.innerHTML.split(/<br\s*\/?>/i).map(text).filter(Boolean);
      directorate = parts[0] || '';
      school = (parts[1] || '').replace(/^مدرسة\s*/, 'ابتدائية ');
    }
    const m = school.match(/\(([^)]+)\)/);
    return { directorate, school, place: m ? m[1].trim() : '' };
  }
  function season() {
    const d = new Date(), y = d.getFullYear(), s = d.getMonth() >= 7 ? y : y - 1;
    return `${s}-${s + 1}`;
  }
  function today() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // ---------- load data from /pers/personnel ----------
  function requestDump(win, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = Date.now() + '-' + Math.random();
      const cleanup = () => { clearTimeout(t); window.removeEventListener('message', onMsg); };
      const t = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة تحميل بيانات الموظفين. تأكد من تسجيل الدخول وافتح صفحة الموظفين مرة ثم أعد المحاولة.')); }, timeoutMs);
      function onMsg(e) {
        const d = e.data;
        if (e.origin !== location.origin || !d || d.amq !== 'dump' || d.id !== id) return;
        cleanup();
        d.error ? reject(new Error(d.error)) : resolve(d);
      }
      window.addEventListener('message', onMsg);
      win.postMessage({ amq: 'dump-request', id }, location.origin);
    });
  }
  async function loadDump() {
    if (onPersonnel) return requestDump(window, 30000);
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:800px;border:0;opacity:0;pointer-events:none';
    fr.src = ORIGIN + 'pers/personnel';
    document.body.appendChild(fr);
    try {
      await new Promise((res, rej) => { fr.onload = res; fr.onerror = () => rej(new Error('تعذّر فتح صفحة الموظفين')); });
      return await requestDump(fr.contentWindow, 30000);
    } finally { fr.remove(); }
  }

  // ---------- column mapping ----------
  function autoMap(headers) {
    const used = new Set(), m = {};
    for (const [key, , re] of FIELDS) {
      let idx;
      if (key === 'prenom') {
        idx = headers.findIndex((h, i) => !used.has(i) && /^\s*(ال)?[إا]سم\s*$/.test(h));
        if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && /[إا]سم/.test(h) && !/لقب|أب|اب|أم|ام|مؤسسة|مستخدم/.test(h));
      } else {
        for (const r of [].concat(re)) {
          idx = headers.findIndex((h, i) => !used.has(i) && r.test(h));
          if (idx >= 0) break;
        }
      }
      if (idx >= 0) { m[key] = idx; used.add(idx); }
    }
    return m;
  }
  async function applyMap() {
    map = autoMap(dump.headers);
    const saved = (await store.get('staffMap')).staffMap || {};
    Object.keys(saved).forEach((k) => {
      if (saved[k] === '') delete map[k];
      else { const i = dump.headers.indexOf(saved[k]); if (i >= 0) map[k] = i; }
    });
    buildStaff();
  }
  function buildStaff() {
    const g = (r, k) => (map[k] == null ? '' : r[map[k]] || '');
    staff = dump.rows.map((r, i) => ({ r, i })).filter((x) => x.r.length > 1).map(({ r, i }) => ({
      i, nom: g(r, 'nom'), prenom: g(r, 'prenom'), dob: g(r, 'dob'), grade: g(r, 'grade'),
      subject: g(r, 'subject'), degree: g(r, 'degree'), effect: g(r, 'effect'),
      links: (dump.links && dump.links[i]) || [],
      hay: r.join(' ').toLowerCase()
    })).filter((s) => s.nom || s.prenom);
  }
  function renderMap() {
    $('#amq3-map').innerHTML = FIELDS.map(([key, title]) => `
      <label>${esc(title)}
        <select data-k="${key}"><option value="">— غير موجود —</option>${dump.headers.map((h, i) =>
          `<option value="${i}" ${map[key] === i ? 'selected' : ''}>${esc(h) || 'عمود ' + (i + 1)}</option>`).join('')}</select>
      </label>`).join('');
  }

  // ---------- UI ----------
  const fab = document.createElement('button');
  fab.id = 'amq3-fab';
  fab.textContent = '👥 شؤون الموظفين ▾';
  // stack above the icons of content.js that are already on the page
  fab.style.bottom = 70 + 50 * ['amq-fab', 'amq-fab2'].filter((id) => document.getElementById(id)).length + 'px';
  const menu = document.createElement('div');
  menu.id = 'amq3-menu';
  menu.innerHTML = `<button data-m="cert">📄 شهادة العمل (نسختان في الصفحة)</button><button data-m="list">📋 طباعة قائمة الموظفين</button><button data-m="isnad">🧩 مساعد الإسناد</button>`;
  document.body.append(fab, menu);

  const overlay = document.createElement('div');
  overlay.id = 'amq3-overlay';
  overlay.innerHTML = `
    <div id="amq3-panel">
      <h3 id="amq3-title"></h3>
      <div class="amq3-grid">
        <div data-for="list"><label>المديرية</label><input type="text" id="amq3-dir"></div>
        <div data-for="list"><label>المؤسسة</label><input type="text" id="amq3-school"></div>
        <div data-for="list"><label>ترتيب القائمة</label>
          <select id="amq3-order"><option value="site">حسب ترتيب الجدول في الموقع</option><option value="alpha">أبجدي (اللقب ثم الاسم)</option></select></div>
      </div>
      <input type="text" id="amq3-q" placeholder="🔍 ابحث عن موظف بالاسم أو اللقب أو الرتبة...">
      <div class="amq3-sub">
        <label><input type="checkbox" id="amq3-all"> تحديد الكل (النتائج الظاهرة)</label>
        <span id="amq3-count"></span>
        <button type="button" id="amq3-reload" class="amq3-link">↻ تحديث البيانات</button>
      </div>
      <div id="amq3-list">جاري التحميل...</div>
      <details id="amq3-det"><summary>ربط الأعمدة (افتحها إن كانت بيانات ناقصة أو في غير مكانها)</summary><div id="amq3-map"></div></details>
      <div class="amq3-row">
        <button class="amq3-btn amq3-go" id="amq3-print">طباعة</button>
        <button class="amq3-btn amq3-sec" id="amq3-close">إغلاق</button>
      </div>
      <div id="amq3-status"></div>
    </div>`;
  document.body.appendChild(overlay);

  const status = (m, err = true) => { const s = $('#amq3-status'); s.style.color = err ? '#a33' : '#2a7'; s.textContent = m; };

  function filtered() {
    const terms = $('#amq3-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return staff.filter((s) => terms.every((t) => s.hay.includes(t)));
  }
  function updateCount(f = filtered()) {
    const n = f.filter((s) => chk.has(s.i)).length;
    $('#amq3-count').textContent = `المحدد للطباعة: ${n} من ${f.length}`;
    $('#amq3-all').checked = f.length > 0 && n === f.length;
  }
  function renderList() {
    const f = filtered();
    $('#amq3-list').innerHTML = f.length
      ? f.map((s) => `<label><input type="checkbox" data-i="${s.i}" ${chk.has(s.i) ? 'checked' : ''}> <span>${esc((s.nom + ' ' + s.prenom).trim())}</span><small>${esc(s.grade)}</small></label>`).join('')
      : '<div style="padding:8px;color:#777">لا توجد نتائج</div>';
    updateCount(f);
  }
  function resetSelection() {
    chk.clear();
    if (mode === 'list') staff.forEach((s) => chk.add(s.i));
  }

  async function refresh() {
    $('#amq3-list').textContent = 'جاري تحميل بيانات الموظفين من صفحة الموظفين...';
    status('');
    try {
      dump = await loadDump();
      await applyMap();
      renderMap();
      if (!map.nom && !map.prenom) {
        $('#amq3-det').open = true;
        status('لم يتم التعرف على عمودي اللقب والاسم، حدّدهما من «ربط الأعمدة».');
      }
      resetSelection();
      renderList();
    } catch (e) {
      dump = null;
      $('#amq3-list').textContent = '';
      status(e.message);
    }
  }

  async function openPanel(m) {
    mode = m;
    overlay.dataset.mode = m;
    overlay.classList.add('open');
    menu.classList.remove('open');
    $('#amq3-title').textContent = m === 'cert' ? 'شهادة العمل — A5 مرتين في ورقة A4' : 'طباعة قائمة الموظفين';
    const d = pageDefaults();
    const s = await store.get(['sdir', 'sschool']);
    $('#amq3-dir').value = s.sdir || d.directorate;
    $('#amq3-school').value = s.sschool || d.school;
    $('#amq3-q').value = '';
    if (dump) { resetSelection(); renderList(); status(''); } else await refresh();
  }

  // open the menu above the top-most icon so no icon can cover it
  function placeMenu(m) {
    const tops = [...document.querySelectorAll('#amq-fab,#amq-fab2,#amq3-fab,#amq4-fab')].map((e) => e.getBoundingClientRect().top).filter((t) => t > 0);
    if (tops.length) m.style.bottom = (window.innerHeight - Math.min(...tops) + 6) + 'px';
  }
  fab.addEventListener('click', (e) => { e.stopPropagation(); placeMenu(menu); menu.classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('open'); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.m === 'isnad') { menu.classList.remove('open'); document.dispatchEvent(new CustomEvent('amq-open-isnad')); return; }
    openPanel(b.dataset.m);
  });
  $('#amq3-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  $('#amq3-reload').addEventListener('click', refresh);
  $('#amq3-q').addEventListener('input', renderList);
  $('#amq3-list').addEventListener('change', (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i == null) return;
    e.target.checked ? chk.add(+i) : chk.delete(+i);
    updateCount();
  });
  $('#amq3-all').addEventListener('change', (e) => {
    filtered().forEach((s) => (e.target.checked ? chk.add(s.i) : chk.delete(s.i)));
    renderList();
  });
  $('#amq3-map').addEventListener('change', async (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (!k) return;
    if (e.target.value === '') delete map[k]; else map[k] = +e.target.value;
    const names = {};
    FIELDS.forEach(([key]) => { names[key] = map[key] == null ? '' : dump.headers[map[key]]; });
    await store.set({ staffMap: names });
    buildStaff();
    renderList();
  });

  function printHtml(html) {
    const old = document.getElementById('amq3-frame');
    if (old) old.remove();
    const fr = document.createElement('iframe');
    fr.id = 'amq3-frame';
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

  // ---------- work certificate from the operations column ----------
  const pickLink = (st) => st.links.find((l) => /شهادة.*عمل/.test(l.t)) || st.links.find((l) => /عمل/.test(l.t));

  async function fetchCert(req) {
    const opt = { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    let url = req.url;
    const qs = new URLSearchParams(req.body || {}).toString();
    if (req.method === 'POST') {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      opt.body = qs;
    } else if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    const r = await fetch(url, opt);
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

  // A4 landscape = two A5 (portrait) cells side by side
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
    return new Blob([`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>شهادات العمل</title><style>@page{size:A4 landscape;margin:0}body{margin:0}.pg{width:297mm;height:210mm;page-break-after:always;overflow:hidden;display:flex;direction:ltr}iframe{display:block;width:148.5mm;height:210mm;border:0}iframe+iframe{border-left:1px dashed #888}</style></head><body>${pages}</body></html>`], { type: 'text/html' });
  }
  function printBlob(blob, delay) {
    const old = document.getElementById('amq3-cframe');
    if (old) old.remove();
    const url = URL.createObjectURL(blob);
    const fr = document.createElement('iframe');
    fr.id = 'amq3-cframe';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    fr.onload = () => setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* link fallback */ } }, delay);
    fr.src = url;
    document.body.appendChild(fr);
    return url;
  }

  async function printCerts(chosen) {
    const base = ORIGIN + 'pers/personnel';
    const reqs = chosen.map((st) => {
      const link = pickLink(st);
      return { st, link, req: link ? AMQ3.resolveCert(link, base) : null };
    });
    const bad = reqs.filter((x) => !x.req);
    if (bad.length) {
      const first = bad[0];
      const avail = first.st.links.map((l) => l.t || '(بدون نص)').join(' | ') || 'لا توجد روابط في عمود العمليات';
      const oc = first.link && first.link.o ? ` — onclick: ${first.link.o.slice(0, 120)}` : '';
      throw new Error(`تعذّر تحديد رابط «شهادة العمل» للموظف ${(first.st.nom + ' ' + first.st.prenom).trim()}. الروابط المتاحة في عمود العمليات: ${avail}${oc}`);
    }
    const items = new Array(reqs.length);
    let done = 0, next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < reqs.length) {
        const k = next++;
        items[k] = await fetchCert(reqs[k].req);
        status(`جلب الشهادات ${++done} / ${reqs.length}`, false);
      }
    }));
    const allPdf = items.every((x) => x.pdf), allHtml = items.every((x) => x.html);
    if (!allPdf && !allHtml) throw new Error('تنسيق الشهادة غير متوقع');
    const url = printBlob(allPdf ? await composePdf(items) : composeHtml(items), allPdf ? 800 : 1500);
    $('#amq3-status').style.color = '#2a7';
    $('#amq3-status').innerHTML = `تم التحضير (${reqs.length} شهادة). إن لم تظهر نافذة الطباعة <a href="${url}" target="_blank">افتح الملف في تبويب جديد</a>.`;
  }

  function printHtml(html) {
    const old = document.getElementById('amq3-frame');
    if (old) old.remove();
    const fr = document.createElement('iframe');
    fr.id = 'amq3-frame';
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

  $('#amq3-print').addEventListener('click', async () => {
    let chosen = filtered().filter((s) => chk.has(s.i));
    if (!chosen.length) return status('حدّد موظفاً واحداً على الأقل.');
    const btn = $('#amq3-print');
    status('');
    if (mode === 'cert') {
      if (chosen.length > 60 && !confirm(`سيتم تحضير ${chosen.length} شهادة. هل تريد المتابعة؟`)) return;
      btn.disabled = true;
      try { await printCerts(chosen); } catch (e) { status('حدث خطأ: ' + e.message); } finally { btn.disabled = false; }
      return;
    }
    const opt = { directorate: $('#amq3-dir').value.trim(), school: $('#amq3-school').value.trim(), season: season() };
    await store.set({ sdir: opt.directorate, sschool: opt.school });
    if ($('#amq3-order').value === 'alpha') {
      chosen = chosen.slice().sort((a, b) => arKey(a.nom).localeCompare(arKey(b.nom), 'ar') || arKey(a.prenom).localeCompare(arKey(b.prenom), 'ar'));
    }
    printHtml(AMQ3.listDoc(chosen, opt, FONTS));
  });
})();
