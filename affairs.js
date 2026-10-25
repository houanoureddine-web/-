(() => {
  if (document.getElementById('amq4-fab')) return;

  const ORIGIN = location.origin + '/';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const text = (h) => new DOMParser().parseFromString(String(h == null ? '' : h), 'text/html').body.textContent.trim();
  const store = { get: (k) => new Promise((r) => chrome.storage.local.get(k, r)), set: (o) => chrome.storage.local.set(o) };
  const FONTS = { reg: chrome.runtime.getURL('fonts/HacenTunisia.ttf'), bold: chrome.runtime.getURL('fonts/HacenTunisia-Bold.ttf') };
  const LEVELS = ['تحضيري', 'أولى', 'ثانية', 'ثالثة', 'رابعة', 'خامسة'];

  const PATHS = {
    in: 'scolarite/transferts/transfertDemande',
    out: 'scolarite/transferts/transfertDemande/listOut',
    stats: 'scolarite/en_chiffre/general_stat'
  };
  const TITLES = { redo: 'قائمة التلاميذ المعيدين', in: 'قائمة التلاميذ الوافدين', out: 'قائمة التلاميذ المغادرين', stats: 'إحصائيات عدد التلاميذ', tcert: 'شهادة تغيير المؤسسة' };
  // repeaters = rows whose "الإعادة" column is «نعم»
  const HINTS = { redo: { col: /إعادة|اعادة|معيد/, val: /^\s*(نعم|معيد|معيدة|1)\s*$/ } };

  let mode = 'redo';
  const cache = {};
  let tables = [];
  let ti = 0;
  let colSel = new Set();
  let fc = -1;

  // ---------- helpers ----------
  function pageDefaults() {
    const el = [...document.querySelectorAll('.title.item')].find((e) => /مديرية/.test(e.textContent));
    let directorate = '', school = '';
    if (el) {
      const parts = el.innerHTML.split(/<br\s*\/?>/i).map(text).filter(Boolean);
      directorate = parts[0] || '';
      school = (parts[1] || '').replace(/^مدرسة\s*/, 'ابتدائية ');
    }
    return { directorate, school };
  }
  function season() {
    const d = new Date(), y = d.getFullYear(), s = d.getMonth() >= 7 ? y : y - 1;
    return `${s}-${s + 1}`;
  }

  function request(win, type, extra, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = Date.now() + '-' + Math.random();
      const cleanup = () => { clearTimeout(t); window.removeEventListener('message', onMsg); };
      const t = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة تحميل بيانات الصفحة. تأكد من تسجيل الدخول ثم أعد المحاولة.')); }, timeoutMs);
      function onMsg(e) {
        const d = e.data;
        if (e.origin !== location.origin || !d || d.amq !== type.replace('-request', '') || d.id !== id) return;
        cleanup();
        resolve(d);
      }
      window.addEventListener('message', onMsg);
      win.postMessage({ amq: type, id, ...extra }, location.origin);
    });
  }

  // read every table of the page: directly when we are on it, otherwise through a hidden iframe
  async function loadTables(path, wait) {
    const here = location.pathname.replace(/^\/|\/$/g, '');
    if (here === path) return (await request(window, 'dumpall-request', { wait }, wait + 15000)).tables || [];
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:800px;border:0;opacity:0;pointer-events:none';
    fr.src = ORIGIN + path;
    document.body.appendChild(fr);
    try {
      await new Promise((res, rej) => { fr.onload = res; fr.onerror = () => rej(new Error('تعذّر فتح الصفحة')); });
      return (await request(fr.contentWindow, 'dumpall-request', { wait }, wait + 15000)).tables || [];
    } finally { fr.remove(); }
  }

  function schoolYear() {
    const now = new Date();
    return ($('#annee_act') || {}).value || String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
  }
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // level name (تحضيري ... خامسة) found in a text such as «القسم: رابعة 1»
  const levelOf = (str) => {
    const m = [[/تحضير/, 'تحضيري'], [/أول|اول/, 'أولى'], [/ثاني/, 'ثانية'], [/ثالث/, 'ثالثة'], [/رابع/, 'رابعة'], [/خامس/, 'خامسة']].find(([re]) => re.test(String(str || '')));
    return m ? m[1] : '';
  };

  function parseHtmlTables(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('table')].map((t) => {
      // t.rows only contains this table's own rows (not nested tables)
      const trs = [...t.rows].map((tr) => [...tr.cells].map((c) => clean(c.textContent)));
      let h = trs.findIndex((cells) => cells.length > 1 && cells.some((c) => /^(اللقب|الاسم|الإسم|الإعادة|الاعادة)$/.test(c)));
      if (h < 0) h = trs.findIndex((cells) => cells.length > 1);
      if (h < 0) return null;
      const headers = trs[h];
      const rows = trs.slice(h + 1).filter((cells) => cells.length > 1 && cells.some((c) => c) && cells.join('|') !== headers.join('|'));
      let title = '';
      const cap = t.querySelector('caption');
      if (cap) title = clean(cap.textContent);
      for (let el = t, k = 0; k < 3 && el && !title; k++, el = el.parentElement) {
        for (let p = el.previousElementSibling; p && !title; p = p.previousElementSibling) {
          const x = clean(p.textContent);
          if (x && x.length < 150 && !p.querySelector('table')) title = x;
        }
      }
      // text found just before the table (group / level heading), used to detect the level
      let ctx = '';
      for (let el = t, k = 0; k < 4 && el; k++, el = el.parentElement) {
        for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
          const x = clean(p.textContent);
          if (x && x.length < 200 && !p.querySelector('table')) ctx += ' ' + x;
        }
      }
      return { title, ctx, headers, rows };
    }).filter((t) => t && t.rows.length);
  }

  // repeaters: the "طباعة القوائم" button of the groups page opens .../passage_eleves/dossier_eleve/impression (GET)
  async function loadRepeaters() {
    const sources = [
      { url: 'scolarite/passage_eleves/dossier_eleve/impression', method: 'GET' },
      { url: 'scolarite/dossier_eleves/eleves/impression', method: 'POST', body: { annee_html: schoolYear() } }
    ];
    let withCol = [], firstHeaders = '', problems = [];
    for (const src of sources) {
      try {
        const opt = { credentials: 'include' };
        if (src.method === 'POST') {
          opt.method = 'POST';
          opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
          opt.body = new URLSearchParams(src.body);
        }
        const r = await fetch(ORIGIN + src.url, opt);
        if (!r.ok) { problems.push(`${src.url}: HTTP ${r.status}`); continue; }
        const tabs = parseHtmlTables(await r.text());
        if (!firstHeaders && tabs[0]) firstHeaders = tabs[0].headers.join(' | ');
        withCol = tabs.filter((t) => t.headers.some((h) => /إعادة|اعادة|معيد/.test(h)));
        if (withCol.length) break;
        problems.push(`${src.url}: لا يوجد عمود «الإعادة»`);
      } catch (e) { problems.push(`${src.url}: ${e.message}`); }
    }
    if (!withCol.length) {
      throw new Error('تعذّر استخراج المعيدين من قائمة «طباعة القوائم». ' + problems.join(' — ') + (firstHeaders ? '. الأعمدة الموجودة: ' + firstHeaders : ''));
    }
    const base = withCol[0].headers;
    // add a «المستوى» column (taken from the list each repeater comes from) unless the list already has one
    const hasLevel = base.some((h) => /^\s*المستوى\s*$/.test(h));
    const headers = hasLevel ? base.slice() : ['المستوى', ...base];
    const rows = [];
    withCol.forEach((t) => {
      const lvl = levelOf(t.title) || levelOf(t.ctx);
      t.rows.forEach((r2) => {
        const aligned = base.map((h) => { const i = t.headers.indexOf(h); return i >= 0 ? r2[i] || '' : ''; });
        rows.push(hasLevel ? aligned : [lvl, ...aligned]);
      });
    });
    return { title: '', headers, rows };
  }

  // arrivals: «حالة الطلب» takes the values of the column that follows it (to its left in the RTL table,
  // e.g. «مقبول ومفوج»), and that following column is then dropped to avoid duplicates
  function fixArrivalStatus(t) {
    const i = t.headers.findIndex((h) => /حالة\s*(ال)?طلب/.test(h));
    if (i < 0 || i + 1 >= t.headers.length) return t;
    const rows = t.rows.map((r) => {
      const c = r.slice();
      if (clean(c[i + 1])) c[i] = c[i + 1];
      c.splice(i + 1, 1);
      return c;
    });
    const headers = t.headers.slice();
    headers.splice(i + 1, 1);
    return { ...t, headers, rows };
  }

  // transfers: JSON endpoint if the URL answers with data, otherwise read the page table
  // describe the <a> elements found in an HTML fragment (operations column of a JSON row)
  function anchorsOf(html) {
    if (!/<(a|button)\b/i.test(String(html))) return [];
    const d = new DOMParser().parseFromString(String(html), 'text/html');
    return [...d.querySelectorAll('a,button')].map((a) => ({
      t: clean(a.textContent), h: a.getAttribute('href') || '', d: a.getAttribute('data-url') || a.getAttribute('data-href') || '',
      o: (a.getAttribute('onclick') || '').slice(0, 400), ti: a.getAttribute('title') || a.getAttribute('data-content') || '',
      ic: (a.querySelector('i') || {}).className || ''
    }));
  }

  // departures: POST .../transfertDemande/getListOut is the data source of the «طلبات الخروج» table
  async function loadOutRows() {
    const j = await post('scolarite/transferts/transfertDemande/getListOut', {});
    const arr = Array.isArray(j) ? j : j.data || [];
    if (!arr.length) return [];
    const cell = (c) => clean(text(c));
    let rows, links;
    if (Array.isArray(arr[0])) {
      rows = arr.map((r) => r.map(cell));
      links = arr.map((r) => [].concat(...r.map(anchorsOf)));
    } else {
      const keys = Object.keys(arr[0]);
      rows = arr.map((o) => keys.map((k) => cell(o[k])));
      links = arr.map((o) => [].concat(...keys.map((k) => anchorsOf(o[k]))));
    }
    const names = ['رقم التعريف', 'اللقب', 'الاسم', 'تاريخ الميلاد', 'المستوى', 'المؤسسة المرغوب فيها', 'تاريخ الطلب / قبول الطلب', 'حالة الطلب', ''];
    const headers = rows[0].length === names.length ? names : rows[0].map((_, i) => 'عمود ' + (i + 1));
    return [{ title: '', headers, rows, links }];
  }
  async function loadOutSafe() {
    try { const t = await loadOutRows(); if (t.length) return t; } catch (e) { /* use the page itself */ }
    return loadMoves(PATHS.out);
  }

  async function loadMoves(path) {
    try {
      const r = await fetch(ORIGIN + path, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const body = await r.text();
      if (/^\s*[\[{]/.test(body)) {
        const j = JSON.parse(body);
        const arr = Array.isArray(j) ? j : j.data || j.rows || j.list || [];
        if (Array.isArray(arr) && arr.length) {
          let headers, rows, links;
          if (Array.isArray(arr[0])) {
            headers = arr[0].map((_, i) => 'عمود ' + (i + 1));
            rows = arr.map((x) => x.map((c) => clean(text(c))));
            links = arr.map((x) => [].concat(...x.map(anchorsOf)));
          } else {
            headers = Object.keys(arr[0]);
            rows = arr.map((o) => headers.map((k) => clean(text(o[k]))));
            links = arr.map((o) => [].concat(...headers.map((k) => anchorsOf(o[k]))));
          }
          return [{ title: '', headers, rows, links }];
        }
      }
    } catch (e) { /* fall back to the page itself */ }
    return loadTables(path, 15000);
  }

  async function post(url, params) {
    const r = await fetch(ORIGIN + url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(params)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // school year used by the statistics (on the stats page: the year selected there)
  function statYear() {
    const sel = location.pathname.indexOf('en_chiffre/general_stat') >= 0 ? ($('#annee_school') || {}).value : '';
    return sel || schoolYear();
  }
  const STAT_GROUPS = ['عدد التلاميذ', 'داخلي', 'نصف داخلي', 'خارجي', 'المنتقلون', 'المعيدون'];

  // POST scolarite/en_chiffre/general_stat/stat/ {annee} : the request behind the page table and its «تحميل» menu
  async function loadGeneralStat(year) {
    const j = await post('scolarite/en_chiffre/general_stat/stat/', { annee: year });
    const arr = Array.isArray(j) ? j : j.data || [];
    const rows = arr.map((r) => (Array.isArray(r) ? r : Object.values(r)).map((c) => clean(text(c))));
    if (!rows.length) return null;
    const n = Math.max(...rows.map((r) => r.length));
    const sub = ['الكل', 'ذكور', 'إناث'];
    let headers, groups = null;
    if (n === 19) {
      headers = ['الفوج التربوي'].concat(...STAT_GROUPS.map(() => sub));
      groups = STAT_GROUPS.map((label) => ({ label, span: 3 }));
    } else headers = Array.from({ length: n }, (_, i) => (i === 0 ? 'الفوج التربوي' : 'عمود ' + (i + 1)));
    const body = rows.map((r) => Array.from({ length: n }, (_, i) => r[i] || ''));
    // totals row when every figure is numeric
    const num = (v) => /^-?\d+$/.test(v);
    if (body.every((r) => r.slice(1).every(num))) {
      body.push(['المجموع', ...Array.from({ length: n - 1 }, (_, i) => String(body.reduce((a, r) => a + Number(r[i + 1]), 0)))]);
    }
    return { title: `إحصائيات عامة — السنة الدراسية ${year} - ${Number(year) + 1}`, headers, groups, rows: body, totalLast: body.length > rows.length };
  }

  // statistics computed from the students list (fallback when the page has no tables)
  async function computedStats() {
    const j = await post('scolarite/dossier_eleves/eleves/list_eleves', {});
    const rows = (Array.isArray(j) ? j : j.data || []).map((a) => ({ sexe: text(a[4]), level: text(a[6]), group: text(a[7]) }));
    const by = {};
    rows.forEach((s) => { ((by[s.level] = by[s.level] || {})[s.group] = (by[s.level][s.group] || [])).push(s); });
    const out = [];
    let tm = 0, tf = 0;
    Object.keys(by).sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b)).forEach((lv) => {
      let lm = 0, lf = 0;
      Object.keys(by[lv]).sort((a, b) => a - b).forEach((g) => {
        const m = by[lv][g].filter((s) => s.sexe === 'ذكر').length, f = by[lv][g].filter((s) => s.sexe === 'أنثى').length;
        lm += m; lf += f;
        out.push([lv, String(g).padStart(2, '0'), m, f, m + f]);
      });
      out.push(['مجموع ' + lv, '', lm, lf, lm + lf]);
      tm += lm; tf += lf;
    });
    out.push(['المجموع العام', '', tm, tf, tm + tf]);
    return { title: 'عدد التلاميذ حسب المستوى والفوج (محسوب من قائمة التلاميذ)', headers: ['المستوى', 'الفوج', 'الذكور', 'الإناث', 'المجموع'], rows: out };
  }

  // ---------- UI ----------
  const existing = ['amq-fab', 'amq-fab2', 'amq3-fab'].filter((id) => document.getElementById(id)).length;
  const fab = document.createElement('button');
  fab.id = 'amq4-fab';
  fab.textContent = '🎓 شؤون التلاميذ ▾';
  fab.style.bottom = 70 + 50 * existing + 'px';
  const menu = document.createElement('div');
  menu.id = 'amq4-menu';
  menu.style.bottom = 120 + 50 * existing + 'px';
  menu.innerHTML = `<button data-m="redo">🔁 قائمة التلاميذ المعيدين</button><button data-m="in">📥 قائمة التلاميذ الوافدين</button><button data-m="out">📤 قائمة التلاميذ المغادرين</button><button data-m="tcert">📄 شهادة تغيير المؤسسة</button><button data-m="stats">📊 إحصائيات عدد التلاميذ</button>`;
  document.body.append(fab, menu);

  const overlay = document.createElement('div');
  overlay.id = 'amq4-overlay';
  overlay.innerHTML = `
    <div id="amq4-panel">
      <h3 id="amq4-title"></h3>
      <div class="amq4-grid amq4-top">
        <div><label>المديرية</label><input type="text" id="amq4-dir"></div>
        <div><label>المؤسسة</label><input type="text" id="amq4-school"></div>
      </div>
      <div class="c-only">
        <input type="text" id="amq4-cq" placeholder="🔍 ابحث عن تلميذ بالاسم أو اللقب...">
        <div class="amq4-sub">
          <label class="amq4-chk"><input type="checkbox" id="amq4-call"> تحديد الكل (النتائج الظاهرة)</label>
          <span id="amq4-ccount"></span>
          <button type="button" id="amq4-reload3" class="amq4-link">↻ تحديث البيانات</button>
        </div>
        <div id="amq4-clist">جاري التحميل...</div>
        <details class="amq4-det"><summary>بيانات اختيارية تُكتب في الشهادة (نفس حقول نافذة «شهادة تغيير المؤسسة»)</summary>
          <div class="amq4-grid">
            <div><label>السلوك</label><input type="text" id="amq4-tc-comp"></div>
            <div><label>النتائج المدرسية</label><input type="text" id="amq4-tc-res"></div>
            <div><label>آخر قرار مجلس القسم</label><input type="text" id="amq4-tc-cons"></div>
            <div><label>ملاحظات المصالح الاقتصادية</label><input type="text" id="amq4-tc-int"></div>
          </div>
        </details>
        <div class="amq4-note">تُستخرج شهادة كل تلميذ (PDF) من زر «شهادة» في صفحة طلبات الخروج، وتُطبع بحجم A5 غير مكررة: شهادتا تلميذين في كل ورقة A4 بالعرض.</div>
      </div>
      <div class="t-only">
        <label>عنوان القائمة</label><input type="text" id="amq4-dtitle">
        <div id="amq4-tsel-wrap"><label>الجدول المستخرج من الصفحة</label><select id="amq4-tsel"></select></div>
        <div class="amq4-grid">
          <div><label>تصفية حسب العمود</label><select id="amq4-fcol"></select></div>
          <div><label>القيمة</label><select id="amq4-fval"></select></div>
        </div>
        <input type="text" id="amq4-q" placeholder="🔍 بحث داخل القائمة...">
        <div class="amq4-sub"><span id="amq4-count"></span><button type="button" id="amq4-reload" class="amq4-link">↻ تحديث البيانات</button></div>
        <details><summary>الأعمدة المطبوعة</summary><div id="amq4-cols"></div></details>
      </div>
      <div class="s-only">
        <div><label>السنة الدراسية</label><select id="amq4-year"></select></div>
        <div id="amq4-src" class="amq4-radios"></div>
        <div id="amq4-stlist"></div>
        <div class="amq4-sub"><button type="button" id="amq4-reload2" class="amq4-link">↻ تحديث البيانات</button></div>
      </div>
      <div class="amq4-row">
        <button class="amq4-btn amq4-go" id="amq4-print">طباعة</button>
        <button class="amq4-btn amq4-sec" id="amq4-close">إغلاق</button>
      </div>
      <div id="amq4-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  const status = (m, err = true) => { const s = $('#amq4-status'); s.style.color = err ? '#a33' : '#2a7'; s.textContent = m; };

  // ----- table modes -----
  const T = () => tables[ti];
  const unique = (idx) => [...new Set(T().rows.map((r) => r[idx]).filter((v) => v !== '' && v != null))];

  function setupTable() {
    const t = T();
    colSel = new Set();
    t.headers.forEach((h, i) => {
      if (!h || /عملي|إجراء|صورة|خيار/.test(h) || /^\s*(الرقم|رقم|ر\.?\s?ت)\s*$/.test(h)) return;
      if (t.rows.some((r) => (r[i] || '').trim())) colSel.add(i);
    });
    $('#amq4-cols').innerHTML = t.headers.map((h, i) => `<label><input type="checkbox" data-c="${i}" ${colSel.has(i) ? 'checked' : ''}> ${esc(h) || 'عمود ' + (i + 1)}</label>`).join('');
    $('#amq4-fcol').innerHTML = '<option value="-1">— بدون تصفية —</option>' + t.headers.map((h, i) => `<option value="${i}">${esc(h) || 'عمود ' + (i + 1)}</option>`).join('');
    // auto filter column / value
    const hint = HINTS[mode];
    fc = -1;
    let defVal = '';
    if (hint) {
      const cand = t.headers.map((h, i) => i).filter((i) => hint.col.test(t.headers[i]));
      if (hint.val) {
        const hit = cand.find((i) => unique(i).some((v) => hint.val.test(v)));
        if (hit != null) { fc = hit; defVal = unique(hit).find((v) => hint.val.test(v)); }
        else {
          const any = t.headers.findIndex((_, i) => unique(i).some((v) => hint.val.test(v)));
          if (any >= 0) { fc = any; defVal = unique(any).find((v) => hint.val.test(v)); }
        }
      } else if (cand.length) fc = cand[0];
    }
    $('#amq4-fcol').value = String(fc);
    fillValues(defVal);
    if (mode === 'redo' && !defVal) status('لا يوجد في عمود «الإعادة» أي تلميذ بقيمة «نعم» (أو لم يُتعرَّف على العمود). يمكنك اختيار العمود والقيمة يدوياً.');
    renderCount();
  }
  function fillValues(sel) {
    const vals = fc >= 0 ? unique(fc) : [];
    $('#amq4-fval').innerHTML = '<option value="">الكل</option>' + vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('#amq4-fval').value = sel || '';
  }
  function visibleRows() {
    const terms = $('#amq4-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fv = $('#amq4-fval').value;
    return T().rows.filter((r) => (fc < 0 || fv === '' || r[fc] === fv) && terms.every((q) => r.join(' ').toLowerCase().includes(q)));
  }
  function renderCount() { $('#amq4-count').textContent = `عدد الأسطر: ${visibleRows().length} من ${T().rows.length}`; }

  // ----- stats mode -----
  let statTables = [], statSrc = 'page';
  function renderStats() {
    const hasPage = statTables.some((t) => t.page);
    $('#amq4-src').innerHTML = `
      <label><input type="radio" name="amq4-s" value="page" ${statSrc === 'page' ? 'checked' : ''} ${hasPage ? '' : 'disabled'}> من صفحة «إحصائيات عامة» (الفوج / الكل / ذكور / إناث لكل صنف) ${hasPage ? '' : '(لا توجد بيانات)'}</label>
      <label><input type="radio" name="amq4-s" value="calc" ${statSrc === 'calc' ? 'checked' : ''}> حساب من قائمة التلاميذ (المستوى/الفوج/ذكور/إناث)</label>`;
    const list = statTables.filter((t) => (statSrc === 'page') === !!t.page);
    $('#amq4-stlist').innerHTML = list.length ? list.map((t, i) =>
      `<label class="amq4-chk"><input type="checkbox" data-s="${statTables.indexOf(t)}" checked> ${esc(t.title || 'جدول ' + (i + 1))} <small>${t.rows.length} سطر × ${t.headers.length} عمود</small></label>`).join('') : '<div style="padding:8px;color:#777">لا توجد بيانات</div>';
  }

  async function refresh() {
    status('');
    try {
      if (mode === 'stats') {
        $('#amq4-stlist').textContent = 'جاري تحميل الإحصائيات...';
        let pg = [];
        try { const gt = await loadGeneralStat($('#amq4-year').value || statYear()); if (gt) pg = [{ ...gt, page: true }]; } catch (e) { /* fall back below */ }
        statTables = pg;
        try { statTables = statTables.concat([{ ...(await computedStats()), page: false }]); } catch (e) { /* optional */ }
        statSrc = pg.length ? 'page' : 'calc';
        if (!pg.length) status('لم تُرجِع صفحة الإحصائيات العامة بيانات لهذه السنة، تم الاعتماد على الحساب من قائمة التلاميذ.', false);
        renderStats();
      } else if (mode === 'tcert') {
        $('#amq4-clist').textContent = 'جاري تحميل قائمة التلاميذ من صفحة المغادرين...';
        const all = (await loadOutSafe()).filter((t) => t.rows.length > 0 && t.headers.length > 1);
        if (!all.length) throw new Error('لم يُعثر على جدول التلاميذ في صفحة المغادرين. افتحها واعرض الجدول ثم اضغط الأيقونة من هناك.');
        buildTc(all.reduce((b, t) => (t.rows.length > b.rows.length ? t : b), all[0]));
        tcChk.clear();
        renderTc();
      } else {
        $('#amq4-count').textContent = 'جاري تحميل البيانات من الصفحة...';
        let raw;
        if (mode === 'redo') raw = [await loadRepeaters()];
        else if (mode === 'stats') raw = [];
        else if (mode === 'out') raw = await loadOutSafe();
        else raw = await loadMoves(PATHS[mode]);
        let all = raw.filter((t) => t.rows.length > 0 && t.headers.length > 1);
        if (mode === 'in') all = all.map(fixArrivalStatus);
        if (!all.length) throw new Error('لم يُعثر على جدول بيانات في الصفحة. افتح الصفحة المعنية في الموقع واعرض الجدول ثم اضغط الأيقونة من هناك.');
        tables = all;
        ti = all.reduce((b, t, i) => (t.rows.length > all[b].rows.length ? i : b), 0);
        cache[mode] = { tables, ti };
        $('#amq4-tsel').innerHTML = tables.map((t, i) => `<option value="${i}">${esc(t.title || 'جدول ' + (i + 1))} — ${t.rows.length} سطر</option>`).join('');
        $('#amq4-tsel').value = String(ti);
        $('#amq4-tsel-wrap').style.display = tables.length > 1 ? '' : 'none';
        setupTable();
      }
    } catch (e) {
      $('#amq4-count').textContent = '';
      status(e.message);
    }
  }

  async function openPanel(m) {
    mode = m;
    overlay.dataset.mode = m;
    overlay.classList.add('open');
    menu.classList.remove('open');
    $('#amq4-title').textContent = TITLES[m];
    const d = pageDefaults();
    const s = await store.get(['sdir', 'sschool']);
    $('#amq4-dir').value = s.sdir || d.directorate;
    $('#amq4-school').value = s.sschool || d.school;
    $('#amq4-dtitle').value = TITLES[m];
    $('#amq4-q').value = '';
    status('');
    if (m === 'stats' && !$('#amq4-year').options.length) {
      const cur = Number(schoolYear());
      $('#amq4-year').innerHTML = Array.from({ length: 11 }, (_, i) => cur - i).map((y) => `<option value="${y}">${y} - ${y + 1}</option>`).join('');
      $('#amq4-year').value = String(statYear());
    }
    if (m === 'tcert') { $('#amq4-cq').value = ''; tcChk.clear(); if (tc) renderTc(); else await refresh(); return; }
    if (m !== 'stats' && cache[m]) { tables = cache[m].tables; ti = cache[m].ti; setupTable(); }
    else if (m === 'stats' && statTables.length) renderStats();
    else await refresh();
  }

  // ----- «شهادة تغيير المؤسسة»: students of the departures page + their «شهادة» PDF -----
  let tc = null;            // { entries: [{i,label,hay,links}] }
  const tcChk = new Set();
  const keyOf = (l) => [l.t, l.ti, l.ic].join(' ');
  function certLinkOf(links) {
    return links.find((l) => /شهادة.*(تغيير|مؤسسة|انتقال|تحويل|مغادر)/.test(keyOf(l)))
      || links.find((l) => /شهادة/.test(keyOf(l)))
      || links.find((l) => /certif|file|pdf|print/i.test(keyOf(l)))
      || (links.length === 1 ? links[0] : null);
  }
  function buildTc(t) {
    const h = t.headers;
    const nomI = h.findIndex((x) => /لقب/.test(x));
    const preI = h.findIndex((x) => /^\s*(ال)?[إا]سم\s*$/.test(x));
    const lvlI = h.findIndex((x) => /^\s*المستوى\s*$|القسم|الفوج/.test(x));
    const dstI = h.findIndex((x) => /المؤسسة/.test(x));
    let entries = t.rows.map((r, i) => {
      let label = [nomI >= 0 ? r[nomI] : '', preI >= 0 ? r[preI] : ''].join(' ').trim();
      if (!label) label = r.filter((c) => c && !/^[\d\-\/:. ]+$/.test(c)).slice(0, 2).join(' ');
      const sub = [lvlI >= 0 ? r[lvlI] : '', dstI >= 0 ? r[dstI].replace(/\s*-\s*مديرية.*$/, '') : ''].filter(Boolean).join(' — ');
      return { i, label: label || 'تلميذ ' + (i + 1), sub, hay: r.join(' ').toLowerCase(), links: (t.links && t.links[i]) || [] };
    });
    // rejected requests have no «شهادة» button: list only the ones that do (if any row has one)
    const withCert = entries.filter((e) => certLinkOf(e.links));
    if (withCert.length) entries = withCert;
    tc = { entries };
  }
  const tcFiltered = () => {
    const terms = $('#amq4-cq').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tc ? tc.entries.filter((e) => terms.every((q) => e.hay.includes(q))) : [];
  };
  function tcCount(f = tcFiltered()) {
    const n = f.filter((e) => tcChk.has(e.i)).length;
    $('#amq4-ccount').textContent = `المحدد للطباعة: ${n} من ${f.length}`;
    $('#amq4-call').checked = f.length > 0 && n === f.length;
  }
  function renderTc() {
    const f = tcFiltered();
    $('#amq4-clist').innerHTML = f.length
      ? f.map((e) => `<label class="amq4-chk"><input type="checkbox" data-i="${e.i}" ${tcChk.has(e.i) ? 'checked' : ''}> <span>${esc(e.label)}</span><small>${esc(e.sub)}</small></label>`).join('')
      : '<div style="padding:8px;color:#777">لا توجد نتائج</div>';
    tcCount(f);
  }

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
  // A4 landscape = two A5 (portrait) cells: two DIFFERENT students per sheet, no duplication
  // (first student on the right half, second on the left half, as the page is read right-to-left)
  async function composePdf(items) {
    const { PDFDocument, rgb } = PDFLib;
    const out = await PDFDocument.create();
    const W = 841.89, H = 595.28;
    const embedded = [];
    for (const it of items) {
      const src = await PDFDocument.load(it.pdf, { ignoreEncryption: true });
      embedded.push(...(await out.embedPdf(src, src.getPageIndices())));
    }
    for (let i = 0; i < embedded.length; i += 2) {
      const page = out.addPage([W, H]);
      [embedded[i], embedded[i + 1]].forEach((emb, k) => {
        if (!emb) return;
        const sc = Math.min((W / 2) / emb.width, H / emb.height);
        const dw = emb.width * sc, dh = emb.height * sc;
        const cx = k === 0 ? W * 0.75 : W * 0.25;
        page.drawPage(emb, { x: cx - dw / 2, y: (H - dh) / 2, width: dw, height: dh });
      });
      page.drawLine({ start: { x: W / 2, y: 0 }, end: { x: W / 2, y: H }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6), dashArray: [4, 3] });
    }
    return new Blob([await out.save()], { type: 'application/pdf' });
  }
  function composeHtml(items) {
    const attr = (h) => esc(`<base href="${ORIGIN}">` + h);
    const sheets = [];
    for (let i = 0; i < items.length; i += 2) {
      const cell = (it) => (it ? `<iframe srcdoc="${attr(it.html)}"></iframe>` : '<iframe></iframe>');
      sheets.push(`<div class="pg">${cell(items[i])}${cell(items[i + 1])}</div>`);
    }
    return new Blob([`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>شهادات تغيير المؤسسة</title><style>@page{size:A4 landscape;margin:0}body{margin:0}.pg{width:297mm;height:210mm;page-break-after:always;overflow:hidden;display:flex;flex-direction:row-reverse}iframe{display:block;width:148.5mm;height:210mm;border:0}iframe+iframe{border-right:1px dashed #888}</style></head><body>${sheets.join('')}</body></html>`], { type: 'text/html' });
  }
  function printBlob(blob, delay) {
    const old = document.getElementById('amq4-cframe');
    if (old) old.remove();
    const url = URL.createObjectURL(blob);
    const fr = document.createElement('iframe');
    fr.id = 'amq4-cframe';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    fr.onload = () => setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* link fallback */ } }, delay);
    fr.src = url;
    document.body.appendChild(fr);
    return url;
  }

  // the «شهادة» button calls impression(matricule, nom, annee) which submits a form to certificat_transfert
  function tcRequest(e) {
    const l = certLinkOf(e.links);
    if (!l) return { link: null, req: null };
    const m = (l.o || '').match(/impression\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*\)/);
    if (m) {
      return {
        link: l,
        req: {
          url: ORIGIN + 'scolarite/transferts/transfertDemande/certificat_transfert', method: 'POST',
          body: {
            annee: m[6], matricule: m[2], comp: $('#amq4-tc-comp').value.trim(), resultat: $('#amq4-tc-res').value.trim(),
            obs_cons: $('#amq4-tc-cons').value.trim(), obs_int: $('#amq4-tc-int').value.trim()
          }
        }
      };
    }
    return { link: l, req: AMQ3.resolveCert(l, ORIGIN + PATHS.out) };
  }

  async function printTcerts() {
    const chosen = tcFiltered().filter((e) => tcChk.has(e.i));
    if (!chosen.length) return status('حدّد تلميذاً واحداً على الأقل.');
    if (chosen.length > 60 && !confirm(`سيتم تحضير ${chosen.length} شهادة. هل تريد المتابعة؟`)) return;
    const reqs = chosen.map((e) => ({ e, ...tcRequest(e) }));
    const bad = reqs.filter((x) => !x.req);
    if (bad.length) {
      const f = bad[0];
      const avail = f.e.links.map((l) => l.t || l.ti || l.ic || '(بدون نص)').join(' | ') || 'لا توجد روابط في عمود العمليات';
      const oc = f.link && f.link.o ? ` — onclick: ${f.link.o.slice(0, 120)}` : '';
      return status(`تعذّر تحديد رابط أيقونة «شهادة» للتلميذ ${f.e.label}. الروابط المتاحة: ${avail}${oc}`);
    }
    const btn = $('#amq4-print');
    btn.disabled = true;
    try {
      const items = new Array(reqs.length);
      let done = 0, next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < reqs.length) { const k = next++; items[k] = await fetchCert(reqs[k].req); status(`جلب الشهادات ${++done} / ${reqs.length}`, false); }
      }));
      const allPdf = items.every((x) => x.pdf), allHtml = items.every((x) => x.html);
      if (!allPdf && !allHtml) throw new Error('تنسيق الشهادة غير متوقع');
      const url = printBlob(allPdf ? await composePdf(items) : composeHtml(items), allPdf ? 800 : 1500);
      $('#amq4-status').style.color = '#2a7';
      $('#amq4-status').innerHTML = `تم التحضير (${reqs.length} شهادة). إن لم تظهر نافذة الطباعة <a href="${url}" target="_blank">افتح الملف في تبويب جديد</a>.`;
    } catch (e) { status('حدث خطأ: ' + e.message); } finally { btn.disabled = false; }
  }

  // open the menu above the top-most icon so no icon can cover it
  function placeMenu(m) {
    const tops = [...document.querySelectorAll('#amq-fab,#amq-fab2,#amq3-fab,#amq4-fab')].map((e) => e.getBoundingClientRect().top).filter((t) => t > 0);
    if (tops.length) m.style.bottom = (window.innerHeight - Math.min(...tops) + 6) + 'px';
  }
  fab.addEventListener('click', (e) => { e.stopPropagation(); placeMenu(menu); menu.classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('open'); });
  menu.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openPanel(b.dataset.m); });
  $('#amq4-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  ['#amq4-reload', '#amq4-reload2'].forEach((s) => $(s).addEventListener('click', () => { delete cache[mode]; if (mode === 'stats') statTables = []; refresh(); }));
  $('#amq4-tsel').addEventListener('change', (e) => { ti = +e.target.value; setupTable(); });
  $('#amq4-fcol').addEventListener('change', (e) => { fc = +e.target.value; fillValues(''); renderCount(); });
  $('#amq4-fval').addEventListener('change', renderCount);
  $('#amq4-q').addEventListener('input', renderCount);
  $('#amq4-cols').addEventListener('change', (e) => {
    const c = e.target.dataset && e.target.dataset.c;
    if (c == null) return;
    e.target.checked ? colSel.add(+c) : colSel.delete(+c);
  });
  $('#amq4-year').addEventListener('change', () => { statTables = []; refresh(); });
  $('#amq4-src').addEventListener('change', (e) => { statSrc = e.target.value; renderStats(); });

  // opts.fit: shrink the whole document (CSS zoom) until it fits on a single A4 page
  function printHtml(html, opts = {}) {
    const old = document.getElementById('amq4-frame');
    if (old) old.remove();
    const fr = document.createElement('iframe');
    fr.id = 'amq4-frame';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.contentDocument.open();
    fr.contentDocument.write(html);
    fr.contentDocument.close();
    const go = () => {
      if (opts.fit) {
        // lay the document out at the printable page width, then zoom out if it is taller than one page
        const land = !!opts.landscape;
        fr.style.cssText = `position:fixed;left:-9999px;top:0;border:0;visibility:hidden;width:${land ? 1054 : 726}px;height:1200px`;
        const d = fr.contentDocument;
        d.body.style.zoom = '1';
        const h = d.body.getBoundingClientRect().height;
        const avail = (land ? 733 : 1062) * 0.96;
        if (h > avail) d.body.style.zoom = String(Math.max(0.3, avail / h));
      }
      fr.contentWindow.focus();
      fr.contentWindow.print();
    };
    setTimeout(() => {
      const f = fr.contentDocument.fonts;
      if (f && f.ready) Promise.race([f.ready, new Promise((r) => setTimeout(r, 1500))]).then(go); else go();
    }, 300);
  }

  $('#amq4-cq').addEventListener('input', renderTc);
  $('#amq4-clist').addEventListener('change', (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i == null) return;
    e.target.checked ? tcChk.add(+i) : tcChk.delete(+i);
    tcCount();
  });
  $('#amq4-call').addEventListener('change', (e) => { tcFiltered().forEach((x) => (e.target.checked ? tcChk.add(x.i) : tcChk.delete(x.i))); renderTc(); });
  $('#amq4-reload3').addEventListener('click', () => { tc = null; refresh(); });

  $('#amq4-print').addEventListener('click', async () => {
    if (mode === 'tcert') return printTcerts();
    const opt = { directorate: $('#amq4-dir').value.trim(), school: $('#amq4-school').value.trim(), season: season() };
    await store.set({ sdir: opt.directorate, sschool: opt.school });
    status('');
    if (mode === 'stats') {
      const picked = [...document.querySelectorAll('#amq4-stlist input:checked')].map((b) => statTables[+b.dataset.s]).filter(Boolean);
      if (!picked.length) return status('حدّد جدولاً واحداً على الأقل.');
      opt.docTitle = TITLES.stats;
      opt.landscape = picked.some((t) => t.headers.length > 7);
      return printHtml(AMQ3.tableDoc(picked.map((t) => ({ title: t.title, headers: t.headers, rows: t.rows, groups: t.groups, totalLast: t.totalLast })), opt, FONTS), { fit: true, landscape: opt.landscape });
    }
    if (!tables.length) return status('لا توجد بيانات للطباعة.');
    const idx = [...colSel].sort((a, b) => a - b);
    if (!idx.length) return status('حدّد عموداً واحداً على الأقل من «الأعمدة المطبوعة».');
    const rows = visibleRows();
    if (!rows.length) return status('لا توجد أسطر مطابقة للتصفية.');
    opt.docTitle = $('#amq4-dtitle').value.trim() || TITLES[mode];
    opt.landscape = idx.length > 7;
    printHtml(AMQ3.tableDoc([{
      headers: idx.map((i) => T().headers[i] || ''),
      rows: rows.map((r) => idx.map((i) => r[i] || '')),
      numbered: true,
      footer: `العدد: ${rows.length}`
    }], opt, FONTS));
  });
})();
