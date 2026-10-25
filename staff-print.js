// Pure HTML builders for the staff list and the work certificate (no DOM / chrome APIs).
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const fontCss = (f) => `
  @font-face{font-family:"Hacen Tunisia";font-weight:400;src:local("Hacen Tunisia"),local("HacenTunisia"),url("${f.reg}") format("truetype")}
  @font-face{font-family:"Hacen Tunisia";font-weight:700;src:local("Hacen Tunisia Bold"),local("HacenTunisia-Bold"),url("${f.bold}") format("truetype"),local("Hacen Tunisia"),url("${f.reg}") format("truetype")}`;

  const BASE = `*{box-sizing:border-box}body{margin:0;font-family:"Hacen Tunisia",Tahoma,"Segoe UI",Arial,sans-serif;direction:rtl;color:#000}`;

  // ---------------- Staff list (26 rows / page) ----------------
  const PER = 26;
  const LIST_CSS = `
  @page{size:A4 portrait;margin:8mm 9mm}
  .page{page-break-after:always;width:100%}.page:last-child{page-break-after:auto}
  .hd{text-align:center;font-weight:bold;font-size:11pt;line-height:1.55}
  .r1{font-weight:bold;font-size:10.5pt;margin-top:4mm}
  .r2{display:flex;justify-content:space-between;font-weight:bold;font-size:10.5pt;margin-top:1.5mm}
  table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:7mm}
  th,td{border:1px solid #000;text-align:center;padding:0 2px;overflow:hidden}
  th{background:#ffff00;font-size:10pt;height:7.5mm;border:1.5px solid #000}
  td{height:8.7mm;font-size:10pt}
  td.n{font-weight:bold}
  th.nb{border:none;background:none;height:8.5mm}
  th.ttl{font-size:12pt;height:8.5mm}
  .sig{font-size:9.5pt;font-weight:bold;margin:1.5mm 0 0 0;padding-right:62%;text-align:center}`;

  function listDoc(list, opt, fonts) {
    const pages = Math.max(1, Math.ceil(list.length / PER));
    let body = '';
    for (let p = 0; p < pages; p++) {
      let rows = '';
      // only real employees: the numbering stops at the last one, no blank rows
      for (let k = 0; k < PER; k++) {
        const idx = p * PER + k, s = list[idx];
        if (!s) break;
        rows += `<tr><td class="n">${idx + 1}</td><td>${esc(s.nom)}</td><td>${esc(s.prenom)}</td><td>${esc(s.dob)}</td><td>${esc(s.grade)}</td><td>${esc(s.subject)}</td><td>${esc(s.degree)}</td><td>${esc(s.effect)}</td></tr>`;
      }
      body += `<section class="page">
        <div class="hd">الجمهورية الجزائرية الديمقراطية الشعبية<br>وزارة التربية الوطنية</div>
        <div class="r1">${esc(opt.directorate)}</div>
        <div class="r2"><span>${esc(opt.school)}</span><span>الموسم الدراسي: ${esc(opt.season)}</span></div>
        <table>
          <colgroup><col style="width:5%"><col style="width:13%"><col style="width:14%"><col style="width:13%"><col style="width:26%"><col style="width:8%"><col style="width:7%"><col style="width:14%"></colgroup>
          <thead>
            <tr><th class="nb"></th><th class="ttl" colspan="6">قائمة الموظفين</th><th class="nb"></th></tr>
            <tr><th>الرقم</th><th>اللقب</th><th>الاسم</th><th>تاريخ الميلاد</th><th>الرتبة</th><th>المادة</th><th>الدرجة</th><th>تاريخ النفاذ</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="sig">إمضاء المدير(ة)</div>
      </section>`;
    }
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قائمة الموظفين</title><style>${fontCss(fonts)}${BASE}${LIST_CSS}</style></head><body>${body}</body></html>`;
  }

  // ---------------- Work certificate: 2 copies / A4 page ----------------
  const CERT_CSS = `
  @page{size:A4 portrait;margin:0}
  .pg{width:210mm;height:297mm;page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}
  .cert{height:148.5mm;padding:8mm 16mm 6mm;display:flex;flex-direction:column;font-size:13pt;line-height:1.95}
  .cert+.cert{border-top:1px dashed #888}
  .c-hd{text-align:center;font-weight:bold;font-size:11pt;line-height:1.5}
  .c-r{display:flex;justify-content:space-between;font-weight:bold;font-size:10.5pt;margin-top:2mm}
  .c-ttl{text-align:center;font-weight:bold;font-size:17pt;margin:3mm 0 2mm;text-decoration:underline}
  .cert p{margin:0 0 1.2mm}
  .c-ft{margin-top:auto;display:flex;justify-content:space-between;font-size:11pt}
  .c-ft .s{text-align:center;font-weight:bold;min-width:55mm}`;

  function certOne(s, o) {
    const b = (v) => `<b><bdi>${esc(v)}</bdi></b>`;
    const job = [];
    if (s.grade) job.push(`الرتبة: ${b(s.grade)}`);
    if (s.subject && s.subject !== '-') job.push(`المادة: ${b(s.subject)}`);
    if (s.degree) job.push(`الدرجة: ${b(s.degree)}`);
    return `<div class="cert">
      <div class="c-hd">الجمهورية الجزائرية الديمقراطية الشعبية<br>وزارة التربية الوطنية</div>
      <div class="c-r"><div>${esc(o.directorate)}</div><div>${esc(o.school)}</div></div>
      <div class="c-ttl">شهادة عمل</div>
      <p>يشهد مدير(ة) ${b(o.school)} أن السيد(ة): ${b((s.nom + ' ' + s.prenom).trim())}</p>
      <p>المولود(ة) بتاريخ: ${b(s.dob)}${s.pob ? ` بـ: ${b(s.pob)}` : ''}</p>
      ${job.length ? `<p>${job.join(' &nbsp;—&nbsp; ')}</p>` : ''}
      <p>يعمل(تعمل) بهذه المؤسسة${s.start ? ` منذ: ${b(s.start)}` : ''}، ولا يزال(تزال) يزاول(تزاول) مهامه(ها) إلى غاية تاريخ تحرير هذه الشهادة.</p>
      <p>سُلّمت هذه الشهادة للمعني(ة) بالأمر بطلب منه(ها) لاستعمالها فيما يسمح به القانون.</p>
      <div class="c-ft"><div>حُرّر بـ: ${esc(o.place)} &nbsp; في: ${esc(o.today)}</div><div class="s">مدير(ة) المؤسسة${o.director ? `<br>${esc(o.director)}` : ''}</div></div>
    </div>`;
  }

  function certDoc(list, opt, fonts) {
    const body = list.map((s) => `<div class="pg">${certOne(s, opt)}${certOne(s, opt)}</div>`).join('');
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>شهادات العمل</title><style>${fontCss(fonts)}${BASE}${CERT_CSS}</style></head><body>${body}</body></html>`;
  }

  // Turn a link taken from the "operations" column into a request {url, method, body}
  function resolveCert(link, base) {
    const abs = (u) => new URL(u, base).href;
    const h = (link.h || '').trim(), d = (link.d || '').trim(), o = (link.o || '').trim();
    if (h && !/^#|^javascript:/i.test(h)) return { url: abs(h), method: 'GET', body: {} };
    if (d) return { url: abs(d), method: 'GET', body: {} };
    const m = o.match(/['"]((?:https?:)?\/\/[^'"]+|\/[^'"\s]+)['"]/);
    if (m) return { url: abs(m[1]), method: 'GET', body: {} };
    const fn = link.fn || '';
    const um = fn.match(/url\s*:\s*((?:['"][^'"]*['"]\s*\+?\s*)+)/);
    if (!um) return null;
    const url = [...um[1].matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]).join('');
    const sig = fn.match(/function\s*[\w$]*\s*\(([^)]*)\)/);
    const params = sig ? sig[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    const am = o.match(/\(([\s\S]*)\)/);
    const args = am ? am[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
    const vars = {};
    params.forEach((p, i) => { vars[p] = args[i]; });
    const body = {};
    const dm = fn.match(/data\s*:\s*\{([^}]*)\}/);
    if (dm) {
      dm[1].split(',').forEach((pair) => {
        const kv = pair.split(':');
        if (kv.length < 2) return;
        const k = kv[0].trim().replace(/['"]/g, '');
        const v = kv.slice(1).join(':').trim();
        if (Object.prototype.hasOwnProperty.call(vars, v)) body[k] = vars[v];
        else if (/^['"][^'"]*['"]$/.test(v) || /^\d+$/.test(v)) body[k] = v.replace(/['"]/g, '');
      });
    }
    const mm = fn.match(/(?:type|method)\s*:\s*['"](POST|GET)['"]/i);
    return { url: abs(url), method: (mm ? mm[1] : Object.keys(body).length ? 'POST' : 'GET').toUpperCase(), body };
  }


  // ---------------- Generic table document (lists / statistics) ----------------
  const TABLE_CSS = (land) => `
  @page{size:A4 ${land ? 'landscape' : 'portrait'};margin:8mm 9mm}
  .hd{text-align:center;font-weight:bold;font-size:11pt;line-height:1.55}
  .r1{font-weight:bold;font-size:10.5pt;margin-top:4mm}
  .r2{display:flex;justify-content:space-between;font-weight:bold;font-size:10.5pt;margin-top:1.5mm}
  .doc{margin:5mm auto 4mm;width:60%;background:#ffff00;border:2px solid #000;text-align:center;font-weight:bold;font-size:12.5pt;padding:1.3mm 0}
  .tt{font-weight:bold;font-size:11pt;margin:5mm 0 1.5mm}
  table{width:100%;border-collapse:collapse}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  th,td{border:1px solid #000;text-align:center;padding:1.4mm 2px;font-size:10pt}
  th{background:#ffff00;border:1.5px solid #000}
  td.nm{font-weight:bold;width:9mm}
  table.wide th,table.wide td{font-size:9pt;padding:1.2mm 1px}
  tr.tot td{font-weight:bold;background:#f0f0f0}
  .cnt{font-weight:bold;font-size:10.5pt;margin-top:2mm}
  .sig{font-size:10pt;font-weight:bold;margin-top:6mm;text-align:left;padding-left:20mm}`;

  function tableDoc(tables, opt, fonts) {
    const blocks = tables.map((t) => {
      const n = t.headers.length;
      const head = t.groups
        ? `<tr><th rowspan="2">${esc(t.headers[0])}</th>${t.groups.map((g) => `<th colspan="${g.span}">${esc(g.label)}</th>`).join('')}</tr><tr>${t.headers.slice(1).map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`
        : '<tr>' + (t.numbered ? '<th class="nm">الرقم</th>' : '') + t.headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
      const body = t.rows.map((r, i) => `<tr${t.totalLast && i === t.rows.length - 1 ? ' class="tot"' : ''}>` + (t.numbered ? `<td class="nm">${i + 1}</td>` : '') +
        Array.from({ length: n }, (_, k) => `<td>${esc(r[k])}</td>`).join('') + '</tr>').join('');
      return `${t.title ? `<div class="tt">${esc(t.title)}</div>` : ''}<table${n > 12 ? ' class="wide"' : ''}><thead>${head}</thead><tbody>${body}</tbody></table>${t.footer ? `<div class="cnt">${esc(t.footer)}</div>` : ''}`;
    }).join('');
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(opt.docTitle)}</title><style>${fontCss(fonts)}${BASE}${TABLE_CSS(opt.landscape)}</style></head><body>
      <div class="hd">الجمهورية الجزائرية الديمقراطية الشعبية<br>وزارة التربية الوطنية</div>
      <div class="r1">${esc(opt.directorate)}</div>
      <div class="r2"><span>${esc(opt.school)}</span><span>الموسم الدراسي: ${esc(opt.season)}</span></div>
      <div class="doc">${esc(opt.docTitle)}</div>
      ${blocks}
      <div class="sig">إمضاء المدير(ة)</div></body></html>`;
  }

  root.AMQ3 = { listDoc, certDoc, resolveCert, tableDoc, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AMQ3;
})(typeof globalThis !== 'undefined' ? globalThis : this);
