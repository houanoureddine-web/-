// Runs in the PAGE world on amatti pages: reads live tables (DataTables or plain HTML)
// and returns headers + all rows (+ links of the operations column) via postMessage.
(() => {
  if (window.__amqBridge) return;
  window.__amqBridge = true;

  const strip = (h) => {
    const d = document.createElement('div');
    d.innerHTML = String(h == null ? '' : h);
    return d.textContent.replace(/\s+/g, ' ').trim();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const inModal = (n) => n.closest && n.closest('.modal');

  function linkInfo(a) {
    const o = a.getAttribute('onclick') || '';
    const info = {
      t: strip(a.textContent), h: a.getAttribute('href') || '', d: a.getAttribute('data-url') || a.getAttribute('data-href') || '', o: o.slice(0, 400),
      ti: a.getAttribute('title') || a.getAttribute('data-content') || '', ic: (a.querySelector('i') || {}).className || ''
    };
    const m = o.match(/^\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (m && /عمل|شهاد/.test(info.t + ' ' + info.ti)) {
      try { if (typeof window[m[1]] === 'function') info.fn = window[m[1]].toString().slice(0, 5000); } catch (e) { /* ignore */ }
    }
    return info;
  }

  function titleFor(node) {
    const cap = node.querySelector && node.querySelector('caption');
    if (cap && strip(cap.textContent)) return strip(cap.textContent);
    let el = (node.closest && node.closest('.dataTables_wrapper')) || node;
    for (let k = 0; k < 4 && el; k++) {
      let p = el.previousElementSibling;
      while (p) {
        if (/^H[1-6]$/.test(p.tagName) || p.classList.contains('header')) {
          const t = strip(p.textContent);
          if (t) return t;
        }
        p = p.previousElementSibling;
      }
      el = el.parentElement;
    }
    return '';
  }

  function dtList() {
    const $ = window.jQuery || window.$;
    if (!$ || !$.fn || !$.fn.dataTable) return { $: null, list: [] };
    let nodes = [];
    try { nodes = $.fn.dataTable.tables(); } catch (e) { /* ignore */ }
    return { $, list: nodes.filter((n) => !inModal(n)) };
  }

  async function readDT($, node, api) {
    const st = api.settings()[0];
    let restoreLen = null;
    if (st.oFeatures.bServerSide && st.fnRecordsTotal() > api.rows().count()) {
      restoreLen = api.page.len();
      await new Promise((res) => { $(node).one('draw.dt', () => res()); api.page.len(-1).draw(); });
    }
    const headers = api.columns().header().toArray().map((th) => strip(th.textContent));
    const idxs = api.rows({ search: 'none', order: 'current' }).indexes().toArray();
    const links = idxs.map(() => []);
    const rows = idxs.map((i, ri) => headers.map((_, j) => {
      let v;
      try { v = api.cell(i, j).render('display'); } catch (e) { v = api.cell(i, j).data(); }
      if (/<(a|button)\b/i.test(String(v))) {
        const d = document.createElement('div');
        d.innerHTML = String(v);
        d.querySelectorAll('a,button').forEach((a) => links[ri].push(linkInfo(a)));
      }
      return strip(v);
    }));
    idxs.forEach((i, ri) => {
      if (links[ri].length) return;
      const nd = api.row(i).node();
      if (nd) nd.querySelectorAll('a,button').forEach((a) => links[ri].push(linkInfo(a)));
    });
    if (restoreLen !== null) { try { api.page.len(restoreLen).draw(false); } catch (e) { /* ignore */ } }
    return { headers, rows, links };
  }

  async function fromDataTable() {
    const { $, list } = dtList();
    if (!$) return null;
    let best = null, bestN = 0;
    for (const n of list) {
      const api = $(n).DataTable();
      const cnt = api.rows().count();
      if (cnt > bestN) { best = { node: n, api }; bestN = cnt; }
    }
    if (!best) return null;
    const res = await readDT($, best.node, best.api);
    return res.rows.length ? res : null;
  }

  function readDom(t) {
    const hr = [...t.querySelectorAll('thead tr')];
    let headers = [];
    if (hr.length) {
      const last = hr.reduce((a, b) => (b.children.length >= a.children.length ? b : a));
      headers = [...last.children].map((c) => strip(c.textContent));
    }
    let trs = [...t.querySelectorAll('tbody tr')];
    if (!hr.length && trs.length) { headers = [...trs[0].children].map((c) => strip(c.textContent)); trs = trs.slice(1); }
    trs = trs.filter((tr) => tr.children.length > 1);
    const rows = trs.map((tr) => [...tr.children].map((td) => strip(td.textContent)));
    const links = trs.map((tr) => [...tr.querySelectorAll('a,button')].map(linkInfo));
    return { headers, rows, links };
  }

  function fromDom() {
    let best = null, bn = 0;
    document.querySelectorAll('table').forEach((t) => {
      if (inModal(t)) return;
      const n = t.querySelectorAll('tbody tr').length;
      if (n > bn) { best = t; bn = n; }
    });
    if (!best) return null;
    const res = readDom(best);
    return res.rows.length ? res : null;
  }

  async function allTables() {
    const out = [];
    const seen = new Set();
    const { $, list } = dtList();
    for (const n of list) {
      seen.add(n);
      const api = $(n).DataTable();
      if (!api.rows().count()) continue;
      const r = await readDT($, n, api);
      if (r.rows.length) out.push({ title: titleFor(n), ...r });
    }
    document.querySelectorAll('table').forEach((t) => {
      if (seen.has(t) || inModal(t) || t.closest('.dataTables_wrapper')) return;
      const r = readDom(t);
      if (r.rows.length) out.push({ title: titleFor(t), ...r });
    });
    const stats = [...document.querySelectorAll('.statistic')].map((s) => ({
      v: strip((s.querySelector('.value') || {}).textContent), l: strip((s.querySelector('.label') || {}).textContent)
    })).filter((x) => x.v || x.l);
    if (stats.length) out.push({ title: 'مؤشرات', headers: ['البيان', 'القيمة'], rows: stats.map((x) => [x.l, x.v]), links: [] });
    return out;
  }

  async function waitDump() {
    for (let k = 0; k < 100; k++) {
      let res = null;
      try { res = await fromDataTable(); } catch (e) { res = null; }
      if (!res && k > 16) res = fromDom();
      if (res && res.rows.length) return res;
      await sleep(250);
    }
    throw new Error('لم يتم العثور على جدول الموظفين في الصفحة');
  }

  async function waitAll(ms) {
    const loops = Math.max(1, Math.round(ms / 250));
    let tables = [];
    for (let k = 0; k < loops; k++) {
      try { tables = await allTables(); } catch (e) { tables = []; }
      if (tables.some((t) => t.rows.length)) {
        await sleep(700);
        try { tables = await allTables(); } catch (e) { /* keep previous */ }
        break;
      }
      await sleep(250);
    }
    return tables;
  }

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || e.origin !== location.origin) return;
    if (d.amq === 'dump-request') {
      let res;
      try { res = await waitDump(); } catch (err) { res = { error: String(err.message || err) }; }
      (e.source || window).postMessage({ amq: 'dump', id: d.id, ...res }, location.origin);
    } else if (d.amq === 'dumpall-request') {
      const tables = await waitAll(d.wait || 12000);
      (e.source || window).postMessage({ amq: 'dumpall', id: d.id, tables }, location.origin);
    }
  });
})();
