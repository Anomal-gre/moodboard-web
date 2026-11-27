import type { Card, Project, StudioProfile } from '../../domain/types';
import { computeCardsBounds, computeConnectorCurve } from '../../domain/geometry';
import { getAssetBlob } from '../../storage/workspaceRepository';
import type { I18nDict } from '../../i18n';
import { getCategoryLabel } from '../../i18n';
import { computeFfeBudget, formatCurrency } from './ffeBudget';
import { slugifyFileName, triggerBlobDownload } from './exportPng';
import { MOSA_BRAND_LOGO_DATA_URL } from './pdfWriter';

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
 * Generates a single self-contained, zero-dependency interactive Read-Only Client Review Snapshot (.html).
 * Clients open it in any desktop browser (Chrome/Edge/Safari) to pan/zoom, inspect Lightbox & FF&E budget,
 * mark Approved / Request changes per item (auto-saved locally), copy a Zalo-ready summary in 1 click,
 * or directly download a studio-grade A4 PDF Feedback Report (0 new tabs, 0 print dialog, Smart Hybrid PDF).
 */
export async function exportClientInteractiveHtml(
  project: Project,
  cards: Card[],
  dict: I18nDict,
  studioProfile?: StudioProfile
): Promise<void> {
  const isVi = dict.cancel === 'Hủy';
  const boardCards = cards.filter((c) => !c.inbox);
  const nonFrameCards = boardCards.filter((c) => c.kind !== 'frame');
  const budget = computeFfeBudget(nonFrameCards, studioProfile);

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
  const studioLogo = studioProfile?.studioLogoDataUrl || MOSA_BRAND_LOGO_DATA_URL;
  const faviconMime = studioLogo.startsWith('data:image/svg+xml')
    ? 'image/svg+xml'
    : studioLogo.startsWith('data:image/png')
      ? 'image/png'
      : 'image/jpeg';
  const slug = slugifyFileName(project.name);

  const ui = isVi
    ? {
        lang: 'vi',
        subtitleFallback: 'Bản trình bày & chấm duyệt cho khách hàng',
        tabBoard: 'Bảng Moodboard',
        tabSpec: `Bảng FF&E (${budget.rows.length})`,
        btnCopy: 'Copy tóm tắt Zalo',
        btnCopied: '✓ Đã sao chép!',
        btnPdf: 'Tải PDF kết quả duyệt',
        btnPdfBusy: 'Đang tạo PDF…',
        fitBtn: 'Vừa khung',
        approved: '✓ Đã duyệt',
        changes: '✎ Cần sửa',
        pending: 'Chưa duyệt',
        btnApprove: '✓ Duyệt phương án',
        btnChanges: '✎ Yêu cầu chỉnh sửa',
        reviewHeading: 'Đánh giá của khách hàng',
        notePlaceholder: 'Nhập góp ý hoặc yêu cầu chỉnh sửa cho hạng mục này…',
        openSource: 'Mở liên kết nguồn ↗',
        colItem: 'Hạng mục',
        colCode: 'Mã / Hãng',
        colQty: 'SL',
        colPrice: 'Đơn giá',
        colSubtotal: 'Thành tiền',
        colReview: 'Đánh giá',
        colCategory: 'Phân loại',
        colQtyPrice: 'SL × Đơn giá',
        totalBudget: 'Tổng ngân sách dự toán',
        reportTitle: 'BÁO CÁO KẾT QUẢ DUYỆT THIẾT KẾ',
        summaryApproved: 'Đã duyệt',
        summaryChanges: 'Cần sửa',
        summaryPending: 'Chưa duyệt',
        summaryBudget: 'Dự toán',
        zaloHeader: 'KẾT QUẢ DUYỆT THIẾT KẾ',
        noNote: '(Không có ghi chú thêm)',
        pdfFilename: `ket-qua-duyet-${slug}.pdf`,
        clickHint: 'Bấm vào từng thẻ trên bảng hoặc dòng trong bảng FF&E để chấm duyệt & ghi chú.',
      }
    : {
        lang: 'en',
        subtitleFallback: 'Interactive Client Presentation & Review',
        tabBoard: 'Moodboard',
        tabSpec: `FF&E (${budget.rows.length})`,
        btnCopy: 'Copy Summary',
        btnCopied: '✓ Copied!',
        btnPdf: 'Download Review PDF',
        btnPdfBusy: 'Building PDF…',
        fitBtn: 'Fit',
        approved: '✓ Approved',
        changes: '✎ Changes',
        pending: 'Pending',
        btnApprove: '✓ Approve',
        btnChanges: '✎ Request changes',
        reviewHeading: 'Client Review',
        notePlaceholder: 'Add your feedback or revision request for this item…',
        openSource: 'Open source link ↗',
        colItem: 'Item',
        colCode: 'Code / SKU',
        colQty: 'Qty',
        colPrice: 'Unit Price',
        colSubtotal: 'Subtotal',
        colReview: 'Review',
        colCategory: 'Category',
        colQtyPrice: 'Qty × Unit Price',
        totalBudget: 'Estimated Total Budget',
        reportTitle: 'CLIENT DESIGN REVIEW REPORT',
        summaryApproved: 'Approved',
        summaryChanges: 'Changes',
        summaryPending: 'Pending',
        summaryBudget: 'Est. Budget',
        zaloHeader: 'DESIGN REVIEW SUMMARY',
        noNote: '(No additional note)',
        pdfFilename: `client-review-report-${slug}.pdf`,
        clickHint: 'Click any card on the board or row in FF&E to approve or leave feedback.',
      };

  const payload = {
    projectId: project.id,
    projectName: project.name,
    clientName: project.clientName || '',
    projectCode: project.projectCode || '',
    studioName,
    studioContact,
    studioLogo,
    bg: project.appearance.background || '#F1F0EB',
    dots: project.appearance.dots,
    bounds,
    connectors,
    currency: budget.currency,
    grandTotalLabel:
      budget.pricedCount > 0 ? formatCurrency(budget.grandTotal, budget.currency) : '—',
    ui,
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
<html lang="${ui.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<link rel="icon" type="${faviconMime}" href="${escapeHtml(studioLogo)}" />
<link rel="shortcut icon" type="${faviconMime}" href="${escapeHtml(studioLogo)}" />
<title>${escapeHtml(studioName)} · ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif; color: #1c1c1e; background: ${escapeHtml(payload.bg)}; overflow: hidden; }
  .bar { position: fixed; top: 14px; left: 16px; right: 16px; z-index: 40; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-radius: 16px; background: rgba(255,255,255,0.88); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(15,23,42,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
  .brand-wrap { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .studio-logo { height: 28px; width: auto; max-width: 110px; object-fit: contain; border-radius: 6px; }
  .proj-title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proj-meta { font-size: 11.5px; color: #636366; }
  .tabs { display: inline-flex; padding: 3px; border-radius: 11px; background: rgba(118,118,128,0.12); gap: 3px; flex-shrink: 0; }
  .tab { border: none; background: transparent; padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: #48484a; }
  .tab.is-active { background: #fff; color: #1c1c1e; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .rev-pill { font-size: 11.5px; font-weight: 700; padding: 5px 10px; border-radius: 999px; background: #f2f2f7; color: #3a3a3c; white-space: nowrap; }
  .btn { border: 1px solid rgba(60,60,67,0.16); background: #fff; color: #1c1c1e; border-radius: 10px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn:hover { background: #f7f7fa; }
  .btn:disabled { opacity: 0.6; cursor: wait; }
  .btn-primary { background: #0059c7; border-color: #0059c7; color: #fff; }
  .btn-primary:hover { background: #0047a0; }
  .hint-bar { position: fixed; left: 18px; bottom: 18px; z-index: 38; padding: 8px 13px; border-radius: 11px; background: rgba(255,255,255,0.88); backdrop-filter: blur(16px); border: 1px solid rgba(15,23,42,0.08); font-size: 12px; color: #48484a; box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
  .viewport { position: fixed; inset: 0; overflow: hidden; cursor: grab; touch-action: none; }
  .viewport.dragging { cursor: grabbing; }
  .dots { background-image: radial-gradient(rgba(28,28,30,0.14) 1px, transparent 1px); background-size: 24px 24px; }
  .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .card { position: absolute; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.08); border: 1px solid rgba(15,23,42,0.08); cursor: pointer; transition: box-shadow 140ms; }
  .card:hover { box-shadow: 0 12px 28px rgba(0,89,199,0.2); }
  .card.is-framed { padding: 10px; background: #fff; }
  .card.is-cutout { background: transparent; border: none; box-shadow: none; overflow: visible; }
  .card.is-cutout img { filter: drop-shadow(0 12px 18px rgba(0,0,0,0.18)); object-fit: contain; }
  .card img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 8px; }
  .card-note { padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .card-note h4 { margin: 0; font-size: 13.5px; }
  .card-note p { margin: 0; font-size: 12px; color: #48484a; white-space: pre-wrap; line-height: 1.45; overflow: hidden; }
  .card-swatch { display: flex; align-items: flex-end; padding: 10px; }
  .swatch-pill { background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 8px; font-size: 11px; font-weight: 600; color: #1c1c1e; }
  .card-file { padding: 12px; display: flex; align-items: center; gap: 10px; }
  .ext-badge { padding: 6px 8px; border-radius: 8px; background: #eef4ff; color: #0059c7; font-weight: 700; font-size: 11px; }
  .card-frame { background: rgba(255,255,255,0.22); border: 1.5px dashed rgba(28,28,30,0.22); box-shadow: none; pointer-events: none; padding: 8px 12px; font-size: 12px; font-weight: 700; color: #636366; }
  .badge-rev { position: absolute; top: 8px; right: 8px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: #16a34a; color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
  .badge-rev.changes { background: #ea580c; }
  .zoom-hud { position: fixed; right: 18px; bottom: 18px; z-index: 40; display: flex; gap: 6px; padding: 6px; border-radius: 12px; background: rgba(255,255,255,0.88); backdrop-filter: blur(18px); border: 1px solid rgba(15,23,42,0.1); }
  .schedule { position: fixed; inset: 78px 18px 18px 18px; z-index: 35; background: rgba(255,255,255,0.95); backdrop-filter: blur(22px); border-radius: 18px; border: 1px solid rgba(15,23,42,0.1); overflow: auto; padding: 20px; display: none; }
  .schedule.is-open { display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 8px; border-bottom: 1.5px solid #1c1c1e; font-size: 11px; text-transform: uppercase; color: #636366; }
  td { padding: 10px 8px; border-bottom: 1px solid rgba(60,60,67,0.1); vertical-align: middle; }
  .total-bar { margin-top: 16px; padding: 14px 16px; border-radius: 12px; background: #f5f3ee; border: 1px solid #dfddd4; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; }
  .total-bar .amount { color: #0059c7; }
  .modal-bg { position: fixed; inset: 0; z-index: 60; background: rgba(15,23,42,0.48); backdrop-filter: blur(6px); display: none; align-items: center; justify-content: center; padding: 20px; }
  .modal-bg.is-open { display: flex; }
  .modal { width: min(760px, 100%); max-height: 90vh; overflow: auto; background: #fff; border-radius: 20px; padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.22); display: grid; gap: 14px; }
  .modal-img { width: 100%; max-height: 400px; object-fit: contain; border-radius: 12px; background: #f2f2f7; }
  .modal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 12px; border-radius: 12px; background: #f7f7fa; font-size: 12.5px; }
  .modal-grid span { display: block; font-size: 11px; color: #636366; margin-bottom: 2px; }
  textarea { width: 100%; border-radius: 10px; border: 1px solid rgba(60,60,67,0.2); padding: 9px 11px; font-family: inherit; font-size: 13px; resize: vertical; }
  .rev-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .rev-btn { border: 1px solid rgba(60,60,67,0.18); background: #fff; border-radius: 9px; padding: 8px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .rev-btn.ok { background: #16a34a; color: #fff; border-color: #16a34a; }
  .rev-btn.warn { background: #ea580c; color: #fff; border-color: #ea580c; }
  @media (max-width: 820px) { .proj-meta, .rev-pill, .hint-bar { display: none; } }
</style>
</head>
<body>
<header class="bar">
  <div class="brand-wrap">
    ${studioLogo ? `<img src="${studioLogo}" class="studio-logo" alt="" />` : ''}
    <div>
      <div class="proj-title">${escapeHtml(studioName)} · ${escapeHtml(project.name)}</div>
      <div class="proj-meta">${escapeHtml([project.clientName, project.projectCode, studioContact].filter(Boolean).join(' · ') || ui.subtitleFallback)}</div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab is-active" id="tabBoard">${escapeHtml(ui.tabBoard)}</button>
    <button class="tab" id="tabSpec">${escapeHtml(ui.tabSpec)}</button>
  </div>
  <div class="actions">
    <span class="rev-pill" id="revCounter"></span>
    <button class="btn" id="btnCopyFb">${escapeHtml(ui.btnCopy)}</button>
    <button class="btn btn-primary" id="btnExportPdf">${escapeHtml(ui.btnPdf)}</button>
  </div>
</header>

<div class="viewport ${payload.dots ? 'dots' : ''}" id="vp">
  <div class="world" id="world"></div>
</div>

<div class="hint-bar">${escapeHtml(ui.clickHint)}</div>

<div class="zoom-hud" id="zoomHud">
  <button class="btn" id="zOut">−</button>
  <button class="btn" id="zFit">${escapeHtml(ui.fitBtn)}</button>
  <button class="btn" id="zIn">+</button>
</div>

<section class="schedule" id="schedule"></section>

<div class="modal-bg" id="modalBg">
  <div class="modal" id="modalBody"></div>
</div>

<script>
const DATA = ${safeJsonForScript(payload)};
const UI = DATA.ui;
const STORAGE_KEY = 'mosa_client_review_' + (DATA.projectId || DATA.projectName);
const reviews = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
})();

const vp = document.getElementById('vp');
const world = document.getElementById('world');
const schedule = document.getElementById('schedule');
const modalBg = document.getElementById('modalBg');
const modalBody = document.getElementById('modalBody');
const revCounter = document.getElementById('revCounter');

let view = { x: 0, y: 0, z: 1 };
let drag = null;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function persistReviews() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews)); } catch {}
  updateCounter();
}

function getReviewStats() {
  const nonFrames = DATA.cards.filter(c => c.kind !== 'frame');
  let approved = 0, changes = 0;
  nonFrames.forEach(c => {
    const st = reviews[c.id]?.status;
    if (st === 'approved') approved++;
    else if (st === 'changes') changes++;
  });
  return { total: nonFrames.length, approved, changes, pending: nonFrames.length - approved - changes };
}

function updateCounter() {
  const s = getReviewStats();
  revCounter.textContent = '✓ ' + s.approved + ' · ✎ ' + s.changes + ' / ' + s.total;
}

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
    p.setAttribute('stroke', '#0059c7');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-opacity', '0.82');
    svg.appendChild(p);
    const tri = document.createElementNS(svgNS, 'polygon');
    tri.setAttribute('points', '-9,-4.5 0,0 -9,4.5');
    tri.setAttribute('fill', '#0059c7');
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
      el.innerHTML = '<div class="swatch-pill">' + esc(c.title || c.color) + ' · ' + esc(c.color) + '</div>';
    } else if (c.kind === 'note') {
      el.classList.add('card-note');
      if (c.color) el.style.background = c.color;
      el.innerHTML = '<h4>' + esc(c.title) + '</h4><p>' + esc(c.text) + '</p>';
    } else {
      el.classList.add('card-file');
      el.innerHTML = '<span class="ext-badge">' + esc((c.ext || c.kind).toUpperCase()) + '</span><div style="min-width:0;overflow:hidden;"><div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.title) + '</div><div style="font-size:11px;color:#636366;">' + esc(c.code || c.price) + '</div></div>';
    }
    const rv = reviews[c.id];
    if (rv && rv.status) {
      const bdg = document.createElement('span');
      bdg.className = 'badge-rev' + (rv.status === 'changes' ? ' changes' : '');
      bdg.textContent = rv.status === 'approved' ? UI.approved : UI.changes;
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
    const thumb = c.img ? '<img src="' + esc(c.img) + '" style="width:48px;height:36px;object-fit:cover;border-radius:6px;" />' : (c.kind === 'color' ? '<div style="width:48px;height:36px;border-radius:6px;background:' + esc(c.color) + ';border:1px solid rgba(0,0,0,0.12);"></div>' : '');
    const st = rv.status === 'approved'
      ? '<span style="color:#15803d;font-weight:700;">' + esc(UI.approved) + '</span>'
      : (rv.status === 'changes'
        ? '<span style="color:#c2410c;font-weight:700;">' + esc(UI.changes) + '</span>'
        : '<span style="color:#8e8e93;">' + esc(UI.pending) + '</span>');
    const notePreview = rv.note ? '<div style="font-size:11px;color:#3a3a3c;margin-top:2px;">' + esc(rv.note) + '</div>' : '';
    return '<tr style="cursor:pointer" data-cid="' + esc(c.id) + '"><td>' + (idx + 1) + '</td><td>' + thumb + '</td><td><strong>' + esc(c.title || '—') + '</strong><div style="font-size:11px;color:#636366;">' + esc(c.categoryLabel) + '</div></td><td>' + esc(c.code || '—') + '</td><td>' + c.qty + '</td><td>' + esc(c.price || '—') + '</td><td><strong>' + esc(c.lineTotal) + '</strong></td><td>' + st + notePreview + '</td></tr>';
  }).join('');
  schedule.innerHTML = '<table><thead><tr><th>#</th><th></th><th>' + esc(UI.colItem) + '</th><th>' + esc(UI.colCode) + '</th><th>' + esc(UI.colQty) + '</th><th>' + esc(UI.colPrice) + '</th><th>' + esc(UI.colSubtotal) + '</th><th>' + esc(UI.colReview) + '</th></tr></thead><tbody>' + rows + '</tbody></table><div class="total-bar"><span>' + esc(UI.totalBudget) + '</span><span class="amount">' + esc(DATA.grandTotalLabel) + '</span></div>';
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
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><h3 style="margin:0;font-size:17px;">' + esc(c.title || c.categoryLabel) + '</h3><button class="btn" id="mClose">✕</button></div>' +
    (c.img ? '<img src="' + esc(c.img) + '" class="modal-img" />' : '') +
    (c.text ? '<div style="font-size:13.5px;line-height:1.5;color:#3a3a3c;white-space:pre-wrap;">' + esc(c.text) + '</div>' : '') +
    '<div class="modal-grid"><div><span>' + esc(UI.colCategory) + '</span><strong>' + esc(c.categoryLabel) + '</strong></div><div><span>' + esc(UI.colCode) + '</span><strong>' + esc(c.code || '—') + '</strong></div><div><span>' + esc(UI.colQtyPrice) + '</span><strong>' + c.qty + ' × ' + esc(c.price || '—') + '</strong></div><div><span>' + esc(UI.colSubtotal) + '</span><strong>' + esc(c.lineTotal) + '</strong></div></div>' +
    (c.sourceUrl ? '<a href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener" style="font-size:12.5px;color:#0059c7;">' + esc(UI.openSource) + '</a>' : '') +
    '<div style="display:grid;gap:8px;border-top:1px solid rgba(60,60,67,0.1);padding-top:12px;"><strong style="font-size:13px;">' + esc(UI.reviewHeading) + '</strong><div class="rev-row"><button class="rev-btn ' + (rv.status === 'approved' ? 'ok' : '') + '" id="rOk">' + esc(UI.btnApprove) + '</button><button class="rev-btn ' + (rv.status === 'changes' ? 'warn' : '') + '" id="rChg">' + esc(UI.btnChanges) + '</button></div><textarea id="rNote" rows="2" placeholder="' + esc(UI.notePlaceholder) + '">' + esc(rv.note || '') + '</textarea></div>';
  modalBg.classList.add('is-open');
  document.getElementById('mClose').onclick = () => modalBg.classList.remove('is-open');
  const saveRev = (status) => {
    reviews[c.id] = { title: c.title, status: status !== undefined ? status : (reviews[c.id]?.status || ''), note: document.getElementById('rNote').value };
    persistReviews();
    renderBoard();
    renderSchedule();
  };
  document.getElementById('rOk').onclick = () => { saveRev('approved'); openModal(c); };
  document.getElementById('rChg').onclick = () => { saveRev('changes'); openModal(c); };
  document.getElementById('rNote').oninput = () => saveRev();
}

function buildZaloSummaryText() {
  const nonFrames = DATA.cards.filter(c => c.kind !== 'frame');
  const approvedList = [];
  const changesList = [];
  const pendingList = [];
  nonFrames.forEach((c, idx) => {
    const rv = reviews[c.id] || {};
    const label = (c.title || c.categoryLabel || ('#' + (idx + 1))) + (c.code ? ' [' + c.code + ']' : '');
    if (rv.status === 'approved') approvedList.push(rv.note ? label + ' — ' + rv.note : label);
    else if (rv.status === 'changes') changesList.push(label + ': ' + (rv.note || UI.noNote));
    else pendingList.push(label);
  });
  const lines = [
    '📋 ' + UI.zaloHeader + ': ' + DATA.projectName,
    DATA.clientName ? '👤 ' + DATA.clientName : '',
    '📅 ' + new Date().toLocaleDateString(UI.lang === 'vi' ? 'vi-VN' : 'en-US'),
    '',
    '✅ ' + UI.summaryApproved + ' (' + approvedList.length + '):' + (approvedList.length ? '' : ' —'),
    ...approvedList.map(x => '• ' + x),
    '',
    '✏️ ' + UI.summaryChanges + ' (' + changesList.length + '):' + (changesList.length ? '' : ' —'),
    ...changesList.map(x => '• ' + x),
  ];
  if (pendingList.length > 0) {
    lines.push('', '⏳ ' + UI.summaryPending + ' (' + pendingList.length + '): ' + pendingList.join(', '));
  }
  if (DATA.grandTotalLabel && DATA.grandTotalLabel !== '—') {
    lines.push('', '💰 ' + UI.totalBudget + ': ' + DATA.grandTotalLabel);
  }
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\\n');
}

// ============================================================
// Minimal Zero-Dependency Binary PDF 1.4 Writer (Smart Hybrid PDF)
// ============================================================
function buildPdfFromJpegs(pages, commentMeta) {
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const push = (u8) => { chunks.push(u8); offset += u8.length; };
  const pushS = (s) => push(enc.encode(s));
  push(new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x25,0xe2,0xe3,0xcf,0xd3,0x0a]));
  const N = pages.length;
  const infoId = 3 + N * 3;
  const offsets = new Array(infoId + 1).fill(0);
  offsets[1] = offset;
  pushS('1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n');
  offsets[2] = offset;
  pushS('2 0 obj\\n<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] /Count ' + N + ' >>\\nendobj\\n');
  for (let i = 0; i < N; i++) {
    const p = pages[i], pId = 3 + i * 3, imId = 4 + i * 3, cId = 5 + i * 3;
    offsets[pId] = offset;
    pushS(pId + ' 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.wPt + ' ' + p.hPt + '] /Resources << /XObject << /Im0 ' + imId + ' 0 R >> >> /Contents ' + cId + ' 0 R >>\\nendobj\\n');
    offsets[imId] = offset;
    pushS(imId + ' 0 obj\\n<< /Type /XObject /Subtype /Image /Width ' + p.wPx + ' /Height ' + p.hPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.bytes.length + ' >>\\nstream\\n');
    push(p.bytes);
    pushS('\\nendstream\\nendobj\\n');
    const st = enc.encode('q\\n' + p.wPt + ' 0 0 ' + p.hPt + ' 0 0 cm\\n/Im0 Do\\nQ\\n');
    offsets[cId] = offset;
    pushS(cId + ' 0 obj\\n<< /Length ' + st.length + ' >>\\nstream\\n');
    push(st);
    pushS('endstream\\nendobj\\n');
  }
  offsets[infoId] = offset;
  const safePdfTitle = String((DATA.studioName || 'Mosa') + ' - ' + (DATA.projectName || 'Review')).normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\\x20-\\x7E]/g, ' ').replace(/[\\\\()]/g, '').trim() || 'Mosa Client Review Report';
  pushS(infoId + ' 0 obj\\n<< /Title (' + safePdfTitle + ') /Producer (Mosa Studio Smart PDF) >>\\nendobj\\n');
  const xrefOff = offset;
  pushS('xref\\n0 ' + (infoId + 1) + '\\n0000000000 65535 f \\n');
  for (let id = 1; id <= infoId; id++) pushS(String(offsets[id]).padStart(10, '0') + ' 00000 n \\n');
  pushS('trailer\\n<< /Size ' + (infoId + 1) + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\\nstartxref\\n' + xrefOff + '\\n');
  if (commentMeta) pushS('%' + commentMeta + '\\n');
  pushS('%%EOF\\n');
  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return new Blob([out.buffer], { type: 'application/pdf' });
}

function loadImgAsync(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.referrerPolicy = 'no-referrer';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function trunc(ctx, s, maxW) {
  s = String(s || '');
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return s.slice(0, Math.max(0, lo)) + '…';
}

function wrapLines(ctx, s, maxW, maxLines) {
  const words = String(s || '').replace(/\\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(next).width <= maxW) cur = next;
    else {
      if (lines.length + 1 === maxLines) { lines.push(trunc(ctx, cur ? cur + ' ' + words.slice(i).join(' ') : words.slice(i).join(' '), maxW)); return lines; }
      lines.push(cur || trunc(ctx, words[i], maxW));
      cur = cur ? words[i] : '';
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function exportReviewPdf() {
  const btn = document.getElementById('btnExportPdf');
  btn.disabled = true;
  btn.textContent = UI.btnPdfBusy;
  try {
    const W = 1654, H = 2339, MX = 96, MY = 86;
    const FONT = 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
    const nonFrames = DATA.cards.filter(c => c.kind !== 'frame');
    // Sort: Changes first, then Approved, then Pending so Designer immediately sees action items!
    const rank = (c) => { const st = reviews[c.id]?.status; return st === 'changes' ? 0 : st === 'approved' ? 1 : 2; };
    const ordered = [...nonFrames].sort((a, b) => rank(a) - rank(b));

    const logoImg = await loadImgAsync(DATA.studioLogo);
    const imgCache = {};
    await Promise.all(ordered.map(async c => { if (c.img) imgCache[c.id] = await loadImgAsync(c.img); }));

    const stats = getReviewStats();
    const rowH = 128;
    const firstPageStart = MY + 236;
    const nextPageStart = MY + 120;
    const footerLimit = H - MY - 64;
    const perFirst = Math.max(4, Math.floor((footerLimit - firstPageStart) / rowH));
    const perNext = Math.max(6, Math.floor((footerLimit - nextPageStart) / rowH));

    const chunks = [];
    if (ordered.length <= perFirst) chunks.push(ordered);
    else {
      chunks.push(ordered.slice(0, perFirst));
      for (let i = perFirst; i < ordered.length; i += perNext) chunks.push(ordered.slice(i, i + perNext));
    }
    if (!chunks.length) chunks.push([]);

    const pdfPages = [];
    const dateStr = new Date().toLocaleDateString(UI.lang === 'vi' ? 'vi-VN' : 'en-US');

    for (let pi = 0; pi < chunks.length; pi++) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      // Header
      let lx = MX;
      if (logoImg && logoImg.naturalWidth > 0) {
        const lh = 40, lw = Math.min(160, Math.round((logoImg.naturalWidth / logoImg.naturalHeight) * lh));
        ctx.save(); rrect(ctx, lx, MY + 4, lw, lh, 7); ctx.clip(); ctx.drawImage(logoImg, lx, MY + 4, lw, lh); ctx.restore();
        lx += lw + 16;
      }
      ctx.fillStyle = '#0059C7'; ctx.font = '700 18px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(UI.reportTitle, lx, MY);
      ctx.fillStyle = '#1F221D'; ctx.font = '700 30px ' + FONT;
      ctx.fillText(trunc(ctx, DATA.studioName + ' · ' + DATA.projectName, W - MX - lx - 240), lx, MY + 24);
      ctx.fillStyle = '#565950'; ctx.font = '500 20px ' + FONT; ctx.textAlign = 'right';
      ctx.fillText([DATA.clientName, dateStr].filter(Boolean).join(' · '), W - MX, MY + 30);

      ctx.strokeStyle = '#1F221D'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(MX, MY + 74); ctx.lineTo(W - MX, MY + 74); ctx.stroke();

      let y = MY + 98;
      if (pi === 0) {
        // Summary 4 KPI cards
        const cw = (W - MX * 2 - 48) / 4;
        const boxes = [
          { label: UI.summaryApproved, val: String(stats.approved), bg: '#ECFDF3', fg: '#15803D', bd: '#BBF7D0' },
          { label: UI.summaryChanges, val: String(stats.changes), bg: '#FFF7ED', fg: '#C2410C', bd: '#FED7AA' },
          { label: UI.summaryPending, val: String(stats.pending), bg: '#F3F4F6', fg: '#4B5563', bd: '#E5E7EB' },
          { label: UI.summaryBudget, val: DATA.grandTotalLabel, bg: '#EFF6FF', fg: '#0059C7', bd: '#BFDBFE' },
        ];
        boxes.forEach((bx, bi) => {
          const x = MX + bi * (cw + 16);
          ctx.fillStyle = bx.bg; rrect(ctx, x, y, cw, 92, 12); ctx.fill();
          ctx.strokeStyle = bx.bd; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#4B5563'; ctx.font = '600 18px ' + FONT; ctx.textAlign = 'left';
          ctx.fillText(bx.label, x + 20, y + 18);
          ctx.fillStyle = bx.fg; ctx.font = '700 28px ' + FONT;
          ctx.fillText(trunc(ctx, bx.val, cw - 36), x + 20, y + 48);
        });
        y += 120;
      }

      // Rows
      for (const c of chunks[pi]) {
        const rv = reviews[c.id] || {};
        const bgRow = rv.status === 'changes' ? '#FFFBF7' : rv.status === 'approved' ? '#F8FEF9' : '#FFFFFF';
        ctx.fillStyle = bgRow; rrect(ctx, MX, y, W - MX * 2, rowH - 14, 12); ctx.fill();
        ctx.strokeStyle = rv.status === 'changes' ? '#FDBA74' : rv.status === 'approved' ? '#86EFAC' : '#E5E7EB';
        ctx.lineWidth = 1.5; ctx.stroke();

        // Thumbnail
        const ts = 84, tx = MX + 16, ty = y + 15;
        const im = imgCache[c.id];
        if (im && im.naturalWidth > 0) {
          const sc = Math.max(ts / im.naturalWidth, ts / im.naturalHeight);
          const sw = im.naturalWidth * sc, sh = im.naturalHeight * sc;
          ctx.save(); rrect(ctx, tx, ty, ts, ts, 9); ctx.clip(); ctx.drawImage(im, tx + (ts - sw) / 2, ty + (ts - sh) / 2, sw, sh); ctx.restore();
        } else if (c.color) {
          ctx.fillStyle = c.color; rrect(ctx, tx, ty, ts, ts, 9); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.stroke();
        } else {
          ctx.fillStyle = '#F3F4F6'; rrect(ctx, tx, ty, ts, ts, 9); ctx.fill();
          ctx.fillStyle = '#6B7280'; ctx.font = '700 16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText((c.kind || 'ITEM').toUpperCase().slice(0, 5), tx + ts / 2, ty + ts / 2);
        }

        // Item Title + Meta
        const ix = tx + ts + 20;
        const badgeW = 195;
        const textMaxW = W - MX - badgeW - ix - 24;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#111827'; ctx.font = '700 22px ' + FONT;
        ctx.fillText(trunc(ctx, c.title || c.categoryLabel, textMaxW), ix, y + 16);

        ctx.fillStyle = '#6B7280'; ctx.font = '500 17px ' + FONT;
        const meta = [c.categoryLabel, c.code, c.lineTotal !== '—' ? c.lineTotal : ''].filter(Boolean).join(' · ');
        ctx.fillText(trunc(ctx, meta, textMaxW), ix, y + 44);

        if (rv.note) {
          ctx.fillStyle = '#1F2937'; ctx.font = '500 18px ' + FONT;
          const nLines = wrapLines(ctx, '💬 ' + rv.note, textMaxW + 170, 2);
          nLines.forEach((ln, li) => ctx.fillText(ln, ix, y + 70 + li * 21));
        }

        // Status Pill
        const px = W - MX - badgeW - 14, py = y + 16;
        const pBg = rv.status === 'approved' ? '#16A34A' : rv.status === 'changes' ? '#EA580C' : '#E5E7EB';
        const pFg = rv.status ? '#FFFFFF' : '#4B5563';
        const pTxt = rv.status === 'approved' ? UI.approved : rv.status === 'changes' ? UI.changes : UI.pending;
        ctx.fillStyle = pBg; rrect(ctx, px, py, badgeW, 38, 19); ctx.fill();
        ctx.fillStyle = pFg; ctx.font = '700 18px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(pTxt, px + badgeW / 2, py + 19);

        y += rowH;
      }

      // Footer
      ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(MX, H - MY - 34); ctx.lineTo(W - MX, H - MY - 34); ctx.stroke();
      ctx.fillStyle = '#6B7280'; ctx.font = '500 18px ' + FONT; ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillText(DATA.studioContact || DATA.studioName, MX, H - MY - 12);
      ctx.textAlign = 'right'; ctx.fillText((pi + 1) + ' / ' + chunks.length, W - MX, H - MY - 12);

      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pdfPages.push({ bytes, wPx: W, hPx: H, wPt: '595.28', hPt: '841.89' });
    }

    // Embed Smart Hybrid Review JSON safely as base64 comment inside PDF
    const metaJson = JSON.stringify({ project: DATA.projectName, client: DATA.clientName, exportedAt: new Date().toISOString(), reviews });
    const metaB64 = btoa(unescape(encodeURIComponent(metaJson)));
    const pdfBlob = buildPdfFromJpegs(pdfPages, 'MOSA_REVIEW_V1:' + metaB64);

    const a = document.createElement('a');
    a.href = URL.createObjectURL(pdfBlob);
    a.download = UI.pdfFilename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = UI.btnPdf;
  }
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

document.getElementById('btnCopyFb').onclick = async () => {
  const txt = buildZaloSummaryText();
  try { await navigator.clipboard.writeText(txt); } catch {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const btn = document.getElementById('btnCopyFb');
  btn.textContent = UI.btnCopied;
  setTimeout(() => { btn.textContent = UI.btnCopy; }, 1800);
};
document.getElementById('btnExportPdf').onclick = () => void exportReviewPdf();

updateCounter();
renderBoard();
fitBoard();
window.onresize = fitBoard;
</script>
</body>
</html>`;

  const fileName = isVi ? `duyet-thiet-ke-${slug}.html` : `client-review-${slug}.html`;
  triggerBlobDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName);
}
