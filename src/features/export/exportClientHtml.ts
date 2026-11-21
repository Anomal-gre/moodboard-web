import type { Card, Project, StudioProfile } from '../../domain/types';
import { computeCardsBounds, computeConnectorCurve } from '../../domain/geometry';
import { getAssetBlob } from '../../storage/workspaceRepository';
import type { I18nDict } from '../../i18n';
import { getCategoryLabel } from '../../i18n';
import { computeFfeBudget, formatCurrency } from './ffeBudget';
import { slugifyFileName, triggerBlobDownload } from './exportPng';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(new Error('FileReader error'));
    r.readAsDataURL(blob);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * Generates a single self-contained, zero-dependency interactive Read-Only Client Snapshot (.html).
 * Clients can open it offline on any laptop or phone to pan/zoom the moodboard, inspect Lightbox & FF&E
 * budget details, mark Approve/Changes per item, and export their review notes back as JSON.
 */
export async function exportClientInteractiveHtml(
  project: Project,
  cards: Card[],
  dict: I18nDict,
  studioProfile?: StudioProfile
): Promise<void> {
  const boardCards = cards.filter((c) => !c.inbox);
  const nonFrameCards = boardCards.filter((c) => c.kind !== 'frame');
  const budget = computeFfeBudget(nonFrameCards, studioProfile);

  // Pack compressed thumbnails (or remote fallback URLs) for crisp portable offline viewing
  const thumbMap: Record<string, string> = {};
  for (const c of nonFrameCards) {
    if (c.kind === 'image' && c.assetId) {
      const blob = await getAssetBlob(c.assetId, true);
      if (blob) {
        thumbMap[c.id] = await blobToDataUrl(blob);
        continue;
      }
    }
    if (c.source?.imageUrl) {
      thumbMap[c.id] = c.source.imageUrl;
    }
  }

  const bounds = computeCardsBounds(boardCards) ?? { x: 0, y: 0, w: 1200, h: 800 };
  const byId = new Map(boardCards.map((c) => [c.id, c]));
  const connectors: { id: string; d: string; tipX: number; tipY: number; angle: number }[] = [];
  for (const src of boardCards) {
    if (!src.linksTo || src.linksTo.length === 0) continue;
    for (const tid of src.linksTo) {
      const dst = byId.get(tid);
      if (!dst) continue;
      const curve = computeConnectorCurve(src, dst);
      connectors.push({
        id: `${src.id}__${dst.id}`,
        d: curve.svgPath,
        tipX: Math.round(curve.ex),
        tipY: Math.round(curve.ey),
        angle: Math.round(((curve.endAngle * 180) / Math.PI) * 10) / 10,
      });
    }
  }

  const studioName = studioProfile?.studioName?.trim() || 'Mosa';
  const studioContact = studioProfile?.studioContact?.trim() || '';
  const studioLogo = studioProfile?.studioLogoDataUrl || '';

  const payload = {
    projectName: project.name,
    clientName: project.clientName || '',
    projectCode: project.projectCode || '',
    bg: project.appearance.background || '#F1F0EB',
    dots: project.appearance.dots,
    bounds,
    connectors,
    currency: budget.currency,
    grandTotalLabel:
      budget.pricedCount > 0 ? formatCurrency(budget.grandTotal, budget.currency) : '—',
    cards: boardCards.map((c) => {
      const row = budget.rows.find((r) => r.card.id === c.id);
      return {
        id: c.id,
        kind: c.kind,
        title: c.title || '',
        text: c.text || '',
        categoryLabel: getCategoryLabel(dict, c.category),
        color: c.color || '',
        x: Math.round(c.x),
        y: Math.round(c.y),
        w: Math.round(c.w),
        h: Math.round(c.h),
        z: c.z,
        framed: Boolean(c.framed),
        cutout: Boolean(c.cutout),
        flipH: Boolean(c.flipH),
        img: thumbMap[c.id] || '',
        code: c.spec?.code || '',
        price: c.spec?.price || '',
        qty: row?.qty ?? 1,
        lineTotal:
          row && row.lineTotal !== null ? formatCurrency(row.lineTotal, budget.currency) : '—',
        sourceUrl: c.source?.pageUrl || '',
        ext: c.designFile?.extension || '',
      };
    }),
  };

  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<title>${escapeHtml(studioName)} · ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1c1c1e; background: ${escapeHtml(payload.bg)}; overflow: hidden; }
  .bar { position: fixed; top: 14px; left: 16px; right: 16px; z-index: 40; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-radius: 16px; background: rgba(255,255,255,0.82); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(15,23,42,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
  .brand-wrap { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .studio-logo { height: 28px; width: auto; max-width: 110px; object-fit: contain; border-radius: 6px; }
  .proj-title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proj-meta { font-size: 11.5px; color: #636366; }
  .tabs { display: inline-flex; padding: 3px; border-radius: 11px; background: rgba(118,118,128,0.12); gap: 3px; }
  .tab { border: none; background: transparent; padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: #48484a; }
  .tab.is-active { background: #fff; color: #1c1c1e; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .actions { display: flex; align-items: center; gap: 8px; }
  .btn { border: 1px solid rgba(60,60,67,0.14); background: #fff; color: #1c1c1e; border-radius: 10px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .btn-primary { background: #007aff; border-color: #007aff; color: #fff; }
  .viewport { position: fixed; inset: 0; overflow: hidden; cursor: grab; touch-action: none; }
  .viewport.dragging { cursor: grabbing; }
  .dots { background-image: radial-gradient(rgba(28,28,30,0.14) 1px, transparent 1px); background-size: 24px 24px; }
  .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .card { position: absolute; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.08); border: 1px solid rgba(15,23,42,0.08); cursor: pointer; transition: box-shadow 140ms; }
  .card:hover { box-shadow: 0 12px 28px rgba(0,122,255,0.18); }
  .card.is-framed { padding: 10px; background: #fff; }
  .card.is-cutout { background: transparent; border: none; box-shadow: none; overflow: visible; }
  .card.is-cutout img { filter: drop-shadow(0 12px 18px rgba(0,0,0,0.18)); object-fit: contain; }
  .card img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 8px; }
  .card-note { padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .card-note h4 { margin: 0; font-size: 13.5px; }
  .card-note p { margin: 0; font-size: 12px; color: #48484a; white-space: pre-wrap; line-height: 1.45; overflow: hidden; }
  .card-swatch { display: flex; align-items: flex-end; padding: 10px; }
  .swatch-pill { background: rgba(255,255,255,0.88); padding: 4px 8px; border-radius: 8px; font-size: 11px; font-weight: 600; }
  .card-file { padding: 12px; display: flex; align-items: center; gap: 10px; }
  .ext-badge { padding: 6px 8px; border-radius: 8px; background: #eef4ff; color: #007aff; font-weight: 700; font-size: 11px; }
  .card-frame { background: rgba(255,255,255,0.22); border: 1.5px dashed rgba(28,28,30,0.22); box-shadow: none; pointer-events: none; padding: 8px 12px; font-size: 12px; font-weight: 700; color: #636366; }
  .badge-rev { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: #34c759; color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
  .badge-rev.changes { background: #ff9500; }
  .zoom-hud { position: fixed; right: 18px; bottom: 18px; z-index: 40; display: flex; gap: 6px; padding: 6px; border-radius: 12px; background: rgba(255,255,255,0.86); backdrop-filter: blur(18px); border: 1px solid rgba(15,23,42,0.1); }
  .schedule { position: fixed; inset: 78px 18px 18px 18px; z-index: 35; background: rgba(255,255,255,0.92); backdrop-filter: blur(22px); border-radius: 18px; border: 1px solid rgba(15,23,42,0.1); overflow: auto; padding: 20px; display: none; }
  .schedule.is-open { display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 8px; border-bottom: 1.5px solid #1c1c1e; font-size: 11px; text-transform: uppercase; color: #636366; }
  td { padding: 10px 8px; border-bottom: 1px solid rgba(60,60,67,0.1); vertical-align: middle; }
  .total-bar { margin-top: 16px; padding: 14px 16px; border-radius: 12px; background: #f2f2f7; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; }
  .modal-bg { position: fixed; inset: 0; z-index: 60; background: rgba(15,23,42,0.48); backdrop-filter: blur(6px); display: none; align-items: center; justify-content: center; padding: 20px; }
  .modal-bg.is-open { display: flex; }
  .modal { width: min(760px, 100%); max-height: 90vh; overflow: auto; background: #fff; border-radius: 20px; padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.22); display: grid; gap: 14px; }
  .modal-img { width: 100%; max-height: 420px; object-fit: contain; border-radius: 12px; background: #f2f2f7; }
  .modal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 12px; border-radius: 12px; background: #f7f7fa; font-size: 12.5px; }
  .modal-grid span { display: block; font-size: 11px; color: #636366; margin-bottom: 2px; }
  textarea { width: 100%; border-radius: 10px; border: 1px solid rgba(60,60,67,0.2); padding: 9px 11px; font-family: inherit; font-size: 13px; resize: vertical; }
  .rev-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .rev-btn { border: 1px solid rgba(60,60,67,0.18); background: #fff; border-radius: 9px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .rev-btn.ok { background: #34c759; color: #fff; border-color: #34c759; }
  .rev-btn.warn { background: #ff9500; color: #fff; border-color: #ff9500; }
  @media (max-width: 680px) { .proj-meta, .studio-contact { display: none; } }
</style>
</head>
<body>
<header class="bar">
  <div class="brand-wrap">
    ${studioLogo ? `<img src="${studioLogo}" class="studio-logo" alt="" />` : ''}
    <div>
      <div class="proj-title">${escapeHtml(studioName)} · ${escapeHtml(project.name)}</div>
      <div class="proj-meta">${escapeHtml([project.clientName, project.projectCode, studioContact].filter(Boolean).join(' · ') || 'Read-Only Client Presentation')}</div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab is-active" id="tabBoard">Board</button>
    <button class="tab" id="tabSpec">FF&amp;E (${budget.rows.length})</button>
  </div>
  <div class="actions">
    <button class="btn btn-primary" id="btnExportFb">Export Feedback</button>
  </div>
</header>

<div class="viewport ${payload.dots ? 'dots' : ''}" id="vp">
  <div class="world" id="world"></div>
</div>

<div class="zoom-hud" id="zoomHud">
  <button class="btn" id="zOut">−</button>
  <button class="btn" id="zFit">Fit</button>
  <button class="btn" id="zIn">+</button>
</div>

<section class="schedule" id="schedule"></section>

<div class="modal-bg" id="modalBg">
  <div class="modal" id="modalBody"></div>
</div>

<script>
const DATA = ${safeJsonForScript(payload)};
const reviews = {};
const vp = document.getElementById('vp');
const world = document.getElementById('world');
const schedule = document.getElementById('schedule');
const modalBg = document.getElementById('modalBg');
const modalBody = document.getElementById('modalBody');

let view = { x: 0, y: 0, z: 1 };
let drag = null;

function applyView() {
  world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
}

function fitBoard() {
  const b = DATA.bounds;
  const pad = 90;
  const vw = window.innerWidth, vh = window.innerHeight - 64;
  const z = Math.max(0.15, Math.min(1.15, Math.min((vw - pad * 2) / Math.max(1, b.w), (vh - pad * 2) / Math.max(1, b.h))));
  view.z = z;
  view.x = Math.round((vw - b.w * z) / 2 - b.x * z);
  view.y = Math.round((vh - b.h * z) / 2 - b.y * z + 42);
  applyView();
}

function renderBoard() {
  world.innerHTML = '';
  const b = DATA.bounds;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.style.cssText = 'position:absolute;left:' + (b.x - 400) + 'px;top:' + (b.y - 400) + 'px;width:' + (b.w + 800) + 'px;height:' + (b.h + 800) + 'px;pointer-events:none;z-index:999;overflow:visible;';
  svg.setAttribute('viewBox', (b.x - 400) + ' ' + (b.y - 400) + ' ' + (b.w + 800) + ' ' + (b.h + 800));
  DATA.connectors.forEach(c => {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', c.d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#007aff');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-opacity', '0.78');
    svg.appendChild(p);
    const tri = document.createElementNS(svgNS, 'polygon');
    tri.setAttribute('points', '-9,-4.5 0,0 -9,4.5');
    tri.setAttribute('fill', '#007aff');
    tri.setAttribute('transform', 'translate(' + c.tipX + ',' + c.tipY + ') rotate(' + c.angle + ')');
    svg.appendChild(tri);
  });
  world.appendChild(svg);

  DATA.cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card' + (c.framed ? ' is-framed' : '') + (c.cutout ? ' is-cutout' : '') + (c.kind === 'frame' ? ' card-frame' : '');
    el.style.cssText = 'left:' + c.x + 'px;top:' + c.y + 'px;width:' + c.w + 'px;height:' + c.h + 'px;z-index:' + c.z + ';';
    if (c.kind === 'frame') {
      el.textContent = c.title;
    } else if (c.kind === 'image' && c.img) {
      const img = document.createElement('img');
      img.src = c.img;
      img.referrerPolicy = 'no-referrer';
      if (c.flipH) img.style.transform = 'scaleX(-1)';
      el.appendChild(img);
    } else if (c.kind === 'color') {
      el.classList.add('card-swatch');
      el.style.background = c.color || '#ccc';
      el.innerHTML = '<div class="swatch-pill">' + (c.title || c.color) + ' · ' + c.color + '</div>';
    } else if (c.kind === 'note') {
      el.classList.add('card-note');
      if (c.color) el.style.background = c.color;
      el.innerHTML = '<h4>' + (c.title || '') + '</h4><p>' + (c.text || '') + '</p>';
    } else {
      el.classList.add('card-file');
      el.innerHTML = '<span class="ext-badge">' + ((c.ext || c.kind).toUpperCase()) + '</span><div style="min-width:0;overflow:hidden;"><div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (c.title || '') + '</div><div style="font-size:11px;color:#636366;">' + (c.code || c.price || '') + '</div></div>';
    }
    const rv = reviews[c.id];
    if (rv && rv.status) {
      const bdg = document.createElement('span');
      bdg.className = 'badge-rev' + (rv.status === 'changes' ? ' changes' : '');
      bdg.textContent = rv.status === 'approved' ? '✓ Approved' : '✎ Feedback';
      el.appendChild(bdg);
    }
    if (c.kind !== 'frame') el.onclick = (e) => { e.stopPropagation(); openModal(c); };
    world.appendChild(el);
  });
}

function renderSchedule() {
  const nonFrames = DATA.cards.filter(c => c.kind !== 'frame');
  const rows = nonFrames.map((c, idx) => {
    const rv = reviews[c.id] || {};
    const thumb = c.img ? '<img src="' + c.img + '" style="width:48px;height:36px;object-fit:cover;border-radius:6px;" />' : (c.kind === 'color' ? '<div style="width:48px;height:36px;border-radius:6px;background:' + c.color + ';"></div>' : '');
    const st = rv.status === 'approved' ? '<span style="color:#15803d;font-weight:700;">✓ Approved</span>' : (rv.status === 'changes' ? '<span style="color:#c2410c;font-weight:700;">✎ Changes</span>' : '<span style="color:#8e8e93;">—</span>');
    return '<tr style="cursor:pointer" data-cid="' + c.id + '"><td>' + (idx + 1) + '</td><td>' + thumb + '</td><td><strong>' + (c.title || '—') + '</strong><div style="font-size:11px;color:#636366;">' + c.categoryLabel + '</div></td><td>' + (c.code || '—') + '</td><td>' + c.qty + '</td><td>' + (c.price || '—') + '</td><td><strong>' + c.lineTotal + '</strong></td><td>' + st + '</td></tr>';
  }).join('');
  schedule.innerHTML = '<table><thead><tr><th>#</th><th></th><th>Item</th><th>Code</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th><th>Review</th></tr></thead><tbody>' + rows + '</tbody></table><div class="total-bar"><span>Estimated Total Budget</span><span>' + DATA.grandTotalLabel + '</span></div>';
  schedule.querySelectorAll('tr[data-cid]').forEach(tr => {
    tr.onclick = () => {
      const card = DATA.cards.find(x => x.id === tr.getAttribute('data-cid'));
      if (card) openModal(card);
    };
  });
}

function openModal(c) {
  const rv = reviews[c.id] || { status: '', note: '' };
  modalBody.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><h3 style="margin:0;font-size:17px;">' + (c.title || c.categoryLabel) + '</h3><button class="btn" id="mClose">✕</button></div>' +
    (c.img ? '<img src="' + c.img + '" class="modal-img" />' : '') +
    (c.text ? '<div style="font-size:13.5px;line-height:1.5;color:#3a3a3c;white-space:pre-wrap;">' + c.text + '</div>' : '') +
    '<div class="modal-grid"><div><span>Category</span><strong>' + c.categoryLabel + '</strong></div><div><span>Code / SKU</span><strong>' + (c.code || '—') + '</strong></div><div><span>Qty × Unit Price</span><strong>' + c.qty + ' × ' + (c.price || '—') + '</strong></div><div><span>Subtotal</span><strong>' + c.lineTotal + '</strong></div></div>' +
    (c.sourceUrl ? '<a href="' + c.sourceUrl + '" target="_blank" rel="noopener" style="font-size:12.5px;color:#007aff;">Open source link ↗</a>' : '') +
    '<div style="display:grid;gap:8px;border-top:1px solid rgba(60,60,67,0.1);padding-top:12px;"><strong style="font-size:13px;">Client Review</strong><div class="rev-row"><button class="rev-btn ' + (rv.status === 'approved' ? 'ok' : '') + '" id="rOk">✓ Approve</button><button class="rev-btn ' + (rv.status === 'changes' ? 'warn' : '') + '" id="rChg">✎ Request changes</button></div><textarea id="rNote" rows="2" placeholder="Add your feedback or note on this item...">' + (rv.note || '') + '</textarea></div>';
  modalBg.classList.add('is-open');
  document.getElementById('mClose').onclick = () => modalBg.classList.remove('is-open');
  const saveRev = (status) => {
    reviews[c.id] = { title: c.title, status: status !== undefined ? status : (reviews[c.id]?.status || ''), note: document.getElementById('rNote').value };
    renderBoard(); renderSchedule();
  };
  document.getElementById('rOk').onclick = () => { saveRev('approved'); openModal(c); };
  document.getElementById('rChg').onclick = () => { saveRev('changes'); openModal(c); };
  document.getElementById('rNote').oninput = () => saveRev();
}

modalBg.onclick = (e) => { if (e.target === modalBg) modalBg.classList.remove('is-open'); };
vp.onpointerdown = (e) => { if (e.target.closest('.card')) return; drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; vp.classList.add('dragging'); };
window.onpointermove = (e) => { if (!drag) return; view.x = drag.vx + (e.clientX - drag.sx); view.y = drag.vy + (e.clientY - drag.sy); applyView(); };
window.onpointerup = () => { drag = null; vp.classList.remove('dragging'); };
vp.onwheel = (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9; const nz = Math.max(0.15, Math.min(3, view.z * f)); view.x = e.clientX - (e.clientX - view.x) * (nz / view.z); view.y = e.clientY - (e.clientY - view.y) * (nz / view.z); view.z = nz; applyView(); };
document.getElementById('zIn').onclick = () => { view.z = Math.min(3, view.z * 1.2); applyView(); };
document.getElementById('zOut').onclick = () => { view.z = Math.max(0.15, view.z * 0.82); applyView(); };
document.getElementById('zFit').onclick = fitBoard;

document.getElementById('tabBoard').onclick = () => { schedule.classList.remove('is-open'); document.getElementById('tabBoard').classList.add('is-active'); document.getElementById('tabSpec').classList.remove('is-active'); };
document.getElementById('tabSpec').onclick = () => { renderSchedule(); schedule.classList.add('is-open'); document.getElementById('tabSpec').classList.add('is-active'); document.getElementById('tabBoard').classList.remove('is-active'); };
document.getElementById('btnExportFb').onclick = () => {
  const blob = new Blob([JSON.stringify({ project: DATA.projectName, client: DATA.clientName, exportedAt: new Date().toISOString(), reviews }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'client-feedback.json'; a.click();
};

renderBoard();
fitBoard();
window.onresize = fitBoard;
</script>
</body>
</html>`;

  const slug = slugifyFileName(project.name);
  triggerBlobDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slug}-client-review.html`);
}
