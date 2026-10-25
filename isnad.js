// «مساعد الإسناد»: assigns teachers to the divisions / subjects of the page /el_isnad
// Endpoints used (same as the page itself):
//   POST division_isnad {annee}            -> <option> list of divisions
//   POST combo_prof {annee}                -> <option> list of teachers
//   POST info_prof {matricule, annee}      -> {NomArF, PrenomArF}
//   POST list_isnad {annee, division}      -> table rows of the division's subjects
//   POST update_isnad {aff_all, matricule, div_mat, annee, nom}  -> assignment
(() => {
  if (window.__amqIsnad) return;
  window.__amqIsnad = true;

  const ORIGIN = location.origin + '/';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  async function req(url, params) {
    const r = await fetch(ORIGIN + url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(params)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  const reqJson = async (url, params) => JSON.parse(await req(url, params));

  function parseOptions(html) {
    const d = new DOMParser().parseFromString('<select>' + html + '</select>', 'text/html');
    return [...d.querySelectorAll('option')].map((o) => ({ v: o.value, t: clean(o.textContent) })).filter((o) => o.v && o.v !== '0');
  }
  const divLabel = (t) => clean(t.replace(/ابتدائي/, ''));

  function defaultPeriods() {
    const now = new Date(), y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    const m = now.getMonth();
    const t = m >= 7 ? 1 : m <= 2 ? 2 : 3; // Aug–Dec: 1st term, Jan–Mar: 2nd, Apr–Jul: 3rd
    const names = ['الأول', 'الثاني', 'الثالث'];
    const list = [];
    [y, y - 1].forEach((yy) => [1, 2, 3].forEach((k) => list.push({ v: `${yy}${k}`, t: `الفصل ${names[k - 1]} ${yy}-${yy + 1}` })));
    const sel = list.find((p) => p.v === `${y}${t}`) || list[0];
    return { list, def: sel.v };
  }

  // exact subject identity = its name (diacritics/tatweel/spacing normalised); the numeric code is NOT used
  // because the same code can mean different subjects in different levels
  const norm = (str) => clean(String(str == null ? '' : str).replace(/[\u064B-\u0652\u0640]/g, ''));

  // ---------- state ----------
  let divisions = [], teachers = [];
  const rowsCache = {};
  let busy = false, cardSeq = 0;

  // ---------- UI ----------
  const overlay = document.createElement('div');
  overlay.id = 'amq5-overlay';
  overlay.innerHTML = `
    <div id="amq5-panel">
      <h3>🧩 مساعد الإسناد</h3>
      <div class="amq5-top">
        <div><label>الفترة (الفصل الدراسي)</label><select id="amq5-period"></select></div>
        <button type="button" id="amq5-load" class="amq5-btn amq5-sec">↻ تحميل الأفواج والأساتذة</button>
      </div>
      <div id="amq5-info" class="amq5-note"></div>
      <div id="amq5-cards"></div>
      <button type="button" id="amq5-add" class="amq5-btn amq5-sec">＋ إضافة أستاذ</button>
      <div class="amq5-note">لكل أستاذ أفواجه ومواده الخاصة. المطابقة بين المواد تتم باسم المادة بدقة وليس برمزها.<br>
        <b>إلغاء الإسناد:</b> يُلغي إسناد مواد الأفواج المحددة في كل بطاقة. إن اخترت أستاذاً في البطاقة أُلغيت مواده هو فقط، وإن تركته فارغاً أُلغي إسناد كل أساتذة تلك الأفواج. «مواد محددة فقط» تحصر الإلغاء في المواد المختارة.</div>
      <div class="amq5-row">
        <button class="amq5-btn amq5-go" id="amq5-run">تنفيذ الإسناد</button>
        <button class="amq5-btn amq5-danger" id="amq5-cancel" title="يلغي إسناد المواد في الأفواج المحددة">إلغاء الإسناد</button>
        <button class="amq5-btn amq5-sec" id="amq5-close">إغلاق</button>
      </div>
      <div id="amq5-log"></div>
    </div>`;
  document.body.appendChild(overlay);

  const log = (m, cls = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = m;
    $('#amq5-log').appendChild(d);
    $('#amq5-log').scrollTop = 1e9;
  };
  const info = (m, err) => { const e = $('#amq5-info'); e.textContent = m; e.style.color = err ? '#a33' : '#555'; };
  const period = () => $('#amq5-period').value;

  function cardHtml() {
    const n = ++cardSeq;
    return `<div class="amq5-card" data-n="${n}">
      <div class="amq5-head">
        <select class="amq5-t"><option value="">— اختر الأستاذ —</option>${teachers.map((t) => `<option value="${esc(t.v)}">${esc(t.t)}</option>`).join('')}</select>
        <button type="button" class="amq5-x" title="حذف">✕</button>
      </div>
      <div class="amq5-divs">${divisions.map((d) => `<label><input type="checkbox" data-d="${esc(d.v)}"> ${esc(divLabel(d.t))}</label>`).join('')}</div>
      <button type="button" class="amq5-link amq5-sel">تحديد/إلغاء كل الأفواج</button>
      <div class="amq5-mode">
        <label class="amq5-opt"><input type="radio" name="amq5-m-${n}" value="all" checked> كل مواد الفوج</label>
        <label class="amq5-opt"><input type="radio" name="amq5-m-${n}" value="some"> مواد محددة فقط</label>
        <div class="amq5-subj" style="display:none">
          <button type="button" class="amq5-link amq5-sload">↻ تحميل مواد أفواج هذا الأستاذ</button>
          <button type="button" class="amq5-link amq5-sall">تحديد/إلغاء كل المواد</button>
          <div class="amq5-sublist"></div>
        </div>
      </div>
    </div>`;
  }
  function addCard() { $('#amq5-cards').insertAdjacentHTML('beforeend', cardHtml()); }

  async function loadAll() {
    info('جاري تحميل الأفواج والأساتذة...');
    $('#amq5-cards').innerHTML = '';
    Object.keys(rowsCache).forEach((k) => delete rowsCache[k]);
    try {
      const p = period();
      divisions = parseOptions(await req('division_isnad', { annee: p }));
      teachers = parseOptions(await req('combo_prof', { annee: p }));
      if (!divisions.length) { info('لا توجد أفواج لهذه الفترة. جرّب فترة أخرى.', true); return; }
      info(`${divisions.length} فوجاً و${teachers.length} أستاذاً.`);
      addCard();
    } catch (e) { info('تعذّر التحميل: ' + e.message + ' — تأكد من تسجيل الدخول.', true); }
  }

  async function open(ev) {
    const preset = ev && ev.detail;
    overlay.classList.add('open');
    if (!$('#amq5-period').options.length) {
      const { list, def } = defaultPeriods();
      // on the assignment page itself use the periods really offered there
      const real = [...document.querySelectorAll('#annee_school option')].filter((o) => o.value).map((o) => ({ v: o.value, t: clean(o.textContent) }));
      const use = real.length ? real : list;
      $('#amq5-period').innerHTML = use.map((p) => `<option value="${esc(p.v)}">${esc(p.t)}</option>`).join('');
      $('#amq5-period').value = real.length ? real[0].v : def;
    }
    if (preset && preset.period && [...$('#amq5-period').options].some((o) => o.value === preset.period)) {
      if ($('#amq5-period').value !== preset.period) { $('#amq5-period').value = preset.period; divisions = []; }
    }
    if (!divisions.length) await loadAll();
    if (preset && preset.division) {
      const b = document.querySelector(`.amq5-card input[data-d="${preset.division}"]`);
      if (b) b.checked = true;
    }
  }
  document.addEventListener('amq-open-isnad', open);

  // on the assignment page: a direct button next to «إضافة إستخلاف» for the division chosen there
  const anchorBtn = $('#addRemplacement');
  if (anchorBtn) {
    const field = anchorBtn.closest('.field');
    const holder = document.createElement('div');
    holder.className = 'field';
    holder.innerHTML = '<label>&nbsp;&nbsp;&nbsp;</label><a id="amq5-quick" class="ui small inverted blue icon button biarabi" style="cursor:pointer"><i class="ui tasks icon"></i>إسناد أستاذ لكل مواد الفوج</a>';
    (field || anchorBtn).insertAdjacentElement('afterend', holder);
    $('#amq5-quick').addEventListener('click', () => {
      const per = ($('#annee_school') || {}).value || '';
      const div = ($('#division') || {}).value || '';
      document.dispatchEvent(new CustomEvent('amq-open-isnad', { detail: { period: per, division: div } }));
    });
  }

  $('#amq5-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  $('#amq5-load').addEventListener('click', loadAll);
  $('#amq5-period').addEventListener('change', () => { divisions = []; loadAll(); });
  $('#amq5-add').addEventListener('click', () => { if (divisions.length) addCard(); });

  // ---------- data of a division ----------
  async function divisionRows(div, fresh) {
    const key = period() + '|' + div;
    if (!fresh && rowsCache[key]) return rowsCache[key];
    const j = JSON.parse(await req('list_isnad', { annee: period(), division: div }));
    const arr = Array.isArray(j) ? j : j.data || [];
    const rows = arr.map((r) => {
      const d = new DOMParser().parseFromString(String(r[4] || ''), 'text/html');
      const b = [...d.querySelectorAll('button')].find((x) => /update\(/.test(x.getAttribute('onclick') || ''));
      const id = b ? b.id : '';
      const subject = clean(new DOMParser().parseFromString(String(r[0] || ''), 'text/html').body.textContent);
      return { subject, key: norm(subject), teacherCode: clean(r[1]), id };
    }).filter((r) => r.id);
    rowsCache[key] = rows;
    return rows;
  }

  const cardDivs = (card) => [...card.querySelectorAll('input[data-d]:checked')].map((b) => b.dataset.d);
  const cardMode = (card) => (card.querySelector('input[type=radio]:checked') || {}).value;
  const cardKeys = (card) => [...card.querySelectorAll('.amq5-sublist input:checked')].map((b) => b.dataset.k);

  async function loadCardSubjects(card) {
    const divs = cardDivs(card);
    if (!divs.length) return info('اختر أفواج هذا الأستاذ أولاً ثم حمّل المواد.', true);
    info('جاري تحميل المواد...');
    const map = new Map(); // key -> {name, count}
    try {
      for (const d of divs) {
        const seen = new Set();
        for (const r of await divisionRows(d, true)) {
          if (seen.has(r.key)) continue;
          seen.add(r.key);
          const e = map.get(r.key) || { name: r.subject, count: 0 };
          e.count++;
          map.set(r.key, e);
        }
      }
    } catch (e) { return info('تعذّر تحميل المواد: ' + e.message, true); }
    card.querySelector('.amq5-sublist').innerHTML = [...map].map(([k, v]) =>
      `<label><input type="checkbox" data-k="${esc(k)}"> ${esc(v.name)}${divs.length > 1 ? ` <small>(${v.count}/${divs.length} أفواج)</small>` : ''}</label>`).join('');
    info(`${map.size} مادة. حدّد المواد المطلوبة.`);
  }

  $('#amq5-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.amq5-card');
    if (!card) return;
    const c = e.target.classList;
    if (c.contains('amq5-x')) card.remove();
    if (c.contains('amq5-sel')) {
      const boxes = [...card.querySelectorAll('input[data-d]')];
      const all = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !all));
    }
    if (c.contains('amq5-sload')) loadCardSubjects(card);
    if (c.contains('amq5-sall')) {
      const boxes = [...card.querySelectorAll('.amq5-sublist input')];
      const all = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !all));
    }
  });
  $('#amq5-cards').addEventListener('change', (e) => {
    const card = e.target.closest('.amq5-card');
    if (card && e.target.type === 'radio') card.querySelector('.amq5-subj').style.display = e.target.value === 'some' ? 'block' : 'none';
  });

  // ---------- run ----------
  function readCards() {
    return [...document.querySelectorAll('.amq5-card')].map((el) => {
      const sel = el.querySelector('.amq5-t');
      return {
        el, mat: sel.value, label: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
        divs: cardDivs(el), mode: cardMode(el), keys: cardKeys(el),
        names: [...el.querySelectorAll('.amq5-sublist input:checked')].map((b) => b.parentElement.textContent.replace(/\(.*?\)/, '').trim())
      };
    }).filter((x) => x.mat && x.divs.length);
  }

  async function run() {
    if (busy) return;
    const cards = readCards();
    if (!cards.length) return info('اختر أستاذاً وفوجاً واحداً على الأقل.', true);
    const noSubj = cards.find((c) => c.mode === 'some' && !c.keys.length);
    if (noSubj) return info(`حدّد مواد الأستاذ «${noSubj.label}» (زر «تحميل مواد أفواج هذا الأستاذ») أو اختر «كل مواد الفوج».`, true);

    const dupAll = {};
    cards.forEach((c) => c.divs.forEach((d) => { dupAll[d] = (dupAll[d] || 0) + 1; }));
    const dups = Object.keys(dupAll).filter((d) => dupAll[d] > 1 && cards.filter((c) => c.divs.includes(d) && c.mode === 'all').length);
    const lines = cards.map((c) => `• ${c.label}: ${c.divs.length} فوج — ${c.mode === 'all' ? 'كل المواد' : c.names.join('، ')}`);
    const msg = `الفترة: ${$('#amq5-period').selectedOptions[0].textContent}\n\n${lines.join('\n')}` +
      (dups.length ? `\n\nتنبيه: ${dups.length} فوجاً مشترك بين أكثر من أستاذ وقد تتداخل موادهم، وسيبقى آخر إسناد منفَّذ.` : '') + '\n\nهل تريد المتابعة؟';
    if (!confirm(msg)) return;

    busy = true;
    $('#amq5-run').disabled = true; $('#amq5-cancel').disabled = true;
    $('#amq5-log').innerHTML = '';
    const p = period();
    let ok = 0, bad = 0;
    try {
      for (const c of cards) {
        let nom = '';
        try { const i = await reqJson('info_prof', { matricule: c.mat, annee: p }); nom = clean(`${i.NomArF || ''} ${i.PrenomArF || ''}`); } catch (e) { /* below */ }
        if (!nom) nom = clean(c.label.split(' - ')[0]);
        log(`● ${c.label}`, 'h');
        const wanted = new Set(c.keys);
        for (const d of c.divs) {
          const dlabel = divLabel((divisions.find((x) => x.v === d) || { t: d }).t);
          try {
            const before = await divisionRows(d, true);
            if (!before.length) { log(`  ✗ ${dlabel}: لا توجد مواد مسندة للفوج`, 'e'); bad++; continue; }
            const target = c.mode === 'all' ? before : before.filter((r) => wanted.has(r.key));
            const missing = c.mode === 'all' ? [] : [...wanted].filter((k) => !before.some((r) => r.key === k));
            if (missing.length) log(`  ℹ ${dlabel}: مواد غير موجودة في هذا الفوج وتم تجاهلها (${missing.length})`);
            if (!target.length) { log(`  ✗ ${dlabel}: لا توجد مادة مطابقة للاختيار`, 'e'); bad++; continue; }
            const beforeCode = new Map(before.map((r) => [r.id, r.teacherCode]));
            const targetIds = new Set(target.map((r) => r.id));
            // exactly one request per selected subject row (same call as the page's «تعديل» button)
            for (const r of target.filter((x) => x.teacherCode !== c.mat)) {
              await req('update_isnad', { aff_all: 0, matricule: c.mat, div_mat: r.id, annee: p, nom });
            }
            const after = await divisionRows(d, true);
            const got = after.filter((r) => targetIds.has(r.id) && r.teacherCode === c.mat).length;
            const stray = after.filter((r) => !targetIds.has(r.id) && r.teacherCode === c.mat && beforeCode.get(r.id) !== c.mat).length;
            if (got === target.length && !stray) { log(`  ✓ ${dlabel}: ${got}/${target.length} مادة`, 'o'); ok++; }
            else { log(`  ⚠ ${dlabel}: ظهر ${got} من ${target.length} مادة${stray ? ` وتغيّر ${stray} خارج الاختيار` : ''} — راجع صفحة الإسناد`, 'e'); bad++; }
          } catch (e) { log(`  ✗ ${dlabel}: ${e.message}`, 'e'); bad++; }
        }
      }
      log(`انتهى: ${ok} فوج ناجح، ${bad} بحاجة إلى مراجعة.`, bad ? 'e' : 'o');
    } finally { busy = false; $('#amq5-run').disabled = false; $('#amq5-cancel').disabled = false; }
  }
  $('#amq5-run').addEventListener('click', run);

  // ---------- cancel assignments ----------
  const isAssigned = (code) => !!code && !/^0+$/.test(code);

  async function cancelAssign() {
    if (busy) return;
    const cards = [...document.querySelectorAll('.amq5-card')].map((el) => {
      const sel = el.querySelector('.amq5-t');
      return { el, mat: sel.value, label: sel.selectedOptions[0] && sel.value ? sel.selectedOptions[0].textContent : 'كل الأساتذة', divs: cardDivs(el), mode: cardMode(el), keys: cardKeys(el) };
    }).filter((c) => c.divs.length);
    if (!cards.length) return info('اختر فوجاً واحداً على الأقل داخل بطاقة.', true);
    const noSubj = cards.find((c) => c.mode === 'some' && !c.keys.length);
    if (noSubj) return info('حدّد المواد المطلوب إلغاء إسنادها (زر «تحميل مواد أفواج هذا الأستاذ») أو اختر «كل مواد الفوج».', true);

    busy = true;
    $('#amq5-run').disabled = true; $('#amq5-cancel').disabled = true;
    $('#amq5-log').innerHTML = '';
    const p = period();
    try {
      // 1) what exactly would be cancelled
      info('جاري فحص الأفواج...');
      const plan = [];
      for (const c of cards) {
        const wanted = new Set(c.keys);
        for (const d of c.divs) {
          const rows = await divisionRows(d, true);
          const target = rows.filter((r) => isAssigned(r.teacherCode) && (!c.mat || r.teacherCode === c.mat) && (c.mode === 'all' || wanted.has(r.key)));
          plan.push({ c, d, rows, target, dlabel: divLabel((divisions.find((x) => x.v === d) || { t: d }).t) });
        }
      }
      const total = plan.reduce((a, x) => a + x.target.length, 0);
      if (!total) { info('لا توجد مواد مسندة مطابقة للاختيار، لا شيء يُلغى.', true); return; }
      const lines = plan.filter((x) => x.target.length).slice(0, 14).map((x) => `• ${x.dlabel} (${x.c.label}): ${x.target.length} مادة`);
      const msg = `الفترة: ${$('#amq5-period').selectedOptions[0].textContent}\n\nسيتم إلغاء إسناد ${total} مادة:\n${lines.join('\n')}${plan.filter((x) => x.target.length).length > 14 ? '\n…' : ''}\n\nهل تريد المتابعة؟`;
      if (!confirm(msg)) { info('تم التراجع، لم يُلغَ شيء.'); return; }

      // 2) cancel row by row (same request as the «إلغاء» button of each subject in the page)
      let ok = 0, bad = 0;
      for (const x of plan) {
        if (!x.target.length) continue;
        log(`● ${x.dlabel} — ${x.c.label}`, 'h');
        try {
          for (const r of x.target) {
            const res = clean(await req('delete_isnad', { matricule: '', division: r.id.substring(0, 7), mat: r.id.substring(7), annee: p }));
            if (res !== '1') throw new Error('رفض الخادم إلغاء «' + r.subject + '»');
          }
          // 3) verify: targeted rows are free now, the others untouched
          const after = await divisionRows(x.d, true);
          const ids = new Set(x.target.map((r) => r.id));
          const freed = after.filter((r) => ids.has(r.id) && !isAssigned(r.teacherCode)).length;
          const beforeCode = new Map(x.rows.map((r) => [r.id, r.teacherCode]));
          const changed = after.filter((r) => !ids.has(r.id) && r.teacherCode !== beforeCode.get(r.id)).length;
          if (freed === x.target.length && !changed) { log(`  ✓ أُلغي إسناد ${freed}/${x.target.length} مادة`, 'o'); ok++; }
          else { log(`  ⚠ أُلغي ${freed} من ${x.target.length}${changed ? ` وتغيّر ${changed} خارج الاختيار` : ''} — راجع صفحة الإسناد`, 'e'); bad++; }
        } catch (e) { log(`  ✗ ${e.message}`, 'e'); bad++; }
      }
      log(`انتهى: ${ok} فوج ناجح، ${bad} بحاجة إلى مراجعة.`, bad ? 'e' : 'o');
      info('');
    } catch (e) { info('حدث خطأ: ' + e.message, true); }
    finally { busy = false; $('#amq5-run').disabled = false; $('#amq5-cancel').disabled = false; }
  }
  $('#amq5-cancel').addEventListener('click', cancelAssign);
})();
