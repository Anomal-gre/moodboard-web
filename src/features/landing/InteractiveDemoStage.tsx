import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  Inbox,
  LayoutGrid,
  Pause,
  Play,
  Puzzle,
  Sparkles,
} from 'lucide-react';
import type { I18nDict } from '../../i18n';

interface InteractiveDemoStageProps {
  dict: I18nDict;
  language: 'vi' | 'en';
  onTryNow: () => void;
}

const TOTAL_SECONDS = 30;
const STEP_COUNT = 4;
const STEP_DURATION = TOTAL_SECONDS / STEP_COUNT; // 7.5s per chapter
const BASE = import.meta.env.BASE_URL || './';

interface DemoCardSpec {
  id: string;
  src: string;
  titleVi: string;
  titleEn: string;
  tagVi: string;
  tagEn: string;
  confidenceNum: number;
  tagColor: string;
  clipAppearAt: number; // seconds within chapter 0
  scanCrossAt: number;  // seconds within chapter 1 when scan laser hits card
  scatter: [number, number, number, number];
  bento: [number, number, number, number];
}

const DEMO_CARDS: DemoCardSpec[] = [
  {
    id: 'hero',
    src: `${BASE}samples/living-room.jpg`,
    titleVi: 'Phòng khách Wabi-Sabi',
    titleEn: 'Wabi-Sabi Living Room',
    tagVi: 'Không gian',
    tagEn: 'Space',
    confidenceNum: 96,
    tagColor: '#007AFF',
    clipAppearAt: 1.5,
    scanCrossAt: 1.7,
    scatter: [13, 16, 35, 45],
    bento: [5, 11, 44, 54],
  },
  {
    id: 'chair',
    src: `${BASE}samples/armchair.jpg`,
    titleVi: 'Ghế thư giãn gỗ sồi',
    titleEn: 'Oak Lounge Armchair',
    tagVi: 'Hình khối',
    tagEn: 'Form',
    confidenceNum: 94,
    tagColor: '#C5A47E',
    clipAppearAt: 2.35,
    scanCrossAt: 3.1,
    scatter: [54, 11, 22, 37],
    bento: [52, 11, 21, 34],
  },
  {
    id: 'material',
    src: `${BASE}samples/material-texture.jpg`,
    titleVi: 'Gỗ sồi · Vải lanh · Đá vôi',
    titleEn: 'Oak · Linen · Travertine',
    tagVi: 'Kết cấu',
    tagEn: 'Texture',
    confidenceNum: 97,
    tagColor: '#8D9A7C',
    clipAppearAt: 3.15,
    scanCrossAt: 1.35,
    scatter: [6, 55, 22, 32],
    bento: [75, 11, 20, 34],
  },
  {
    id: 'plan',
    src: `${BASE}samples/floor-plan.jpg`,
    titleVi: 'Mặt bằng bố trí 1:50',
    titleEn: '1:50 Floor Plan',
    tagVi: 'Đường nét',
    tagEn: 'Line',
    confidenceNum: 92,
    tagColor: '#5856D6',
    clipAppearAt: 3.95,
    scanCrossAt: 2.85,
    scatter: [44, 54, 24, 34],
    bento: [52, 48, 22, 32],
  },
  {
    id: 'palette',
    src: `${BASE}samples/paint-swatches.jpg`,
    titleVi: 'Bảng màu trung tính ấm',
    titleEn: 'Warm Neutral Swatches',
    tagVi: 'Màu sắc',
    tagEn: 'Color',
    confidenceNum: 98,
    tagColor: '#FF9500',
    clipAppearAt: 4.75,
    scanCrossAt: 4.05,
    scatter: [73, 47, 21, 34],
    bento: [76, 48, 19, 32],
  },
];

const SWATCHES: Array<{ hex: string; light?: boolean }> = [
  { hex: '#DED5C5', light: true },
  { hex: '#C5A47E', light: true },
  { hex: '#8D9A7C' },
  { hex: '#5E594E' },
  { hex: '#2B2A27' },
];

interface CursorKeyframe {
  x: number; // % of stage width
  y: number; // % of stage height
  clicking: boolean;
  visible: boolean;
}

function lerp(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  // Smooth cubic ease-in-out
  const eased = clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
  return a + (b - a) * eased;
}

function computeCursorState(step: number, t: number): CursorKeyframe {
  if (step === 0) {
    // Glide directly onto the Pinterest popover's blue "Mosa" button (x: 80%, y: 19%)
    if (t < 1.15) return { x: lerp(60, 80, t / 1.15), y: lerp(42, 19, t / 1.15), clicking: false, visible: true };
    if (t < 1.55) return { x: 80, y: 19, clicking: true, visible: true };
    if (t < 2.2) return { x: lerp(80, 82, (t - 1.55) / 0.65), y: lerp(19, 25, (t - 1.55) / 0.65), clicking: false, visible: true };
    return { x: lerp(82, 68, (t - 2.2) / 3), y: lerp(25, 10, (t - 2.2) / 3), clicking: false, visible: t < 5.6 };
  }
  if (step === 1) {
    // Glide directly onto the "AI Classify" pill in the top stage bar (x: 56%, y: 5.5%)
    if (t < 0.6) return { x: lerp(66, 56, t / 0.6), y: lerp(26, 5.5, t / 0.6), clicking: false, visible: true };
    if (t < 1.0) return { x: 56, y: 5.5, clicking: true, visible: true };
    return { x: lerp(56, 72, (t - 1.0) / 1.4), y: lerp(5.5, 22, (t - 1.0) / 1.4), clicking: false, visible: t < 2.5 };
  }
  if (step === 2) {
    // Glide directly onto the "Arrange Bento" pill in the top stage bar (x: 44%, y: 5.5%)
    if (t < 0.65) return { x: lerp(64, 44, t / 0.65), y: lerp(24, 5.5, t / 0.65), clicking: false, visible: true };
    if (t < 1.05) return { x: 44, y: 5.5, clicking: true, visible: true };
    return { x: lerp(44, 30, (t - 1.05) / 1.5), y: lerp(5.5, 76, (t - 1.05) / 1.5), clicking: false, visible: t < 2.6 };
  }
  // Chapter 3: Glide directly onto the Client Approve badge inside the bottom-right Handoff card (x: 86%, y: 63%)
  if (t < 3.5) return { x: lerp(62, 86, Math.max(0, (t - 2.5) / 1.0)), y: lerp(38, 63, Math.max(0, (t - 2.5) / 1.0)), clicking: false, visible: t > 2.5 };
  if (t < 4.55) return { x: 86, y: 63, clicking: false, visible: true };
  if (t < 5.0) return { x: 86, y: 63, clicking: true, visible: true };
  return { x: lerp(86, 92, (t - 5.0) / 1.4), y: lerp(63, 74, (t - 5.0) / 1.4), clicking: false, visible: t < 6.4 };
}

export const InteractiveDemoStage: React.FC<InteractiveDemoStageProps> = ({
  dict,
  language,
  onTryNow,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const rawDt = (now - last) / 1000;
      const dt = Number.isFinite(rawDt) ? Math.max(0, Math.min(0.25, rawDt)) : 0;
      last = now;
      setElapsed((prev) => {
        const next = prev + dt;
        return ((next % TOTAL_SECONDS) + TOTAL_SECONDS) % TOTAL_SECONDS;
      });
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing]);

  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const activeStep = Math.max(0, Math.min(STEP_COUNT - 1, Math.floor(safeElapsed / STEP_DURATION)));
  const stepTime = safeElapsed - activeStep * STEP_DURATION; // 0 .. 7.5s
  const stepProgress = (stepTime / STEP_DURATION) * 100;

  const steps = useMemo(
    () => [
      {
        label: dict.landingDemoStep1Label,
        title: dict.landingDemoStep1Title,
        desc: dict.landingDemoStep1Desc,
        icon: Puzzle,
      },
      {
        label: dict.landingDemoStep2Label,
        title: dict.landingDemoStep2Title,
        desc: dict.landingDemoStep2Desc,
        icon: Cpu,
      },
      {
        label: dict.landingDemoStep3Label,
        title: dict.landingDemoStep3Title,
        desc: dict.landingDemoStep3Desc,
        icon: LayoutGrid,
      },
      {
        label: dict.landingDemoStep4Label,
        title: dict.landingDemoStep4Title,
        desc: dict.landingDemoStep4Desc,
        icon: FileSpreadsheet,
      },
    ],
    [dict]
  );

  const isVi = language === 'vi';
  const cursor = computeCursorState(activeStep, stepTime);

  // Beat-by-beat animation flags across all 4 chapters
  const clippedCount =
    activeStep === 0
      ? DEMO_CARDS.filter((c) => stepTime >= c.clipAppearAt).length
      : DEMO_CARDS.length;

  // Chapter 1: Scan laser sweeps across canvas from 0.9s to 4.8s
  const scanProgress = activeStep === 1 ? Math.max(0, Math.min(1, (stepTime - 0.9) / 3.9)) : 0;
  const isScanning = activeStep === 1 && stepTime >= 0.85 && stepTime <= 5.0;
  const scannedCount =
    activeStep === 1
      ? DEMO_CARDS.filter((c) => stepTime >= c.scanCrossAt).length
      : activeStep > 1
        ? DEMO_CARDS.length
        : 0;

  // Chapter 2: Snap into Editorial Bento after cursor clicks at 0.85s
  const isArranged = activeStep > 2 || (activeStep === 2 && stepTime >= 0.85);
  const connectorsDrawn = activeStep > 2 || (activeStep === 2 && stepTime >= 2.2);
  const paletteRevealed = activeStep === 2 && stepTime >= 3.8;

  // Chapter 3: Handoff deck reveal, live FF&E counter, and Client Approve click at 4.7s
  const handoffOpen = activeStep === 3 && stepTime >= 0.7;
  const ffeRow1Shown = activeStep === 3 && stepTime >= 1.5;
  const ffeRow2Shown = activeStep === 3 && stepTime >= 2.3;
  const ffeRow3Shown = activeStep === 3 && stepTime >= 3.0;
  const clientApproved = activeStep === 3 && stepTime >= 4.7;

  // Smooth animated FF&E total counter in Chapter 4 (1.5s -> 3.8s)
  const budgetProgress = activeStep === 3 ? Math.max(0, Math.min(1, (stepTime - 1.4) / 2.4)) : 0;
  const animatedVnd = Math.round(42600000 * budgetProgress);
  const animatedUsd = Math.round(1680 * budgetProgress);
  const formattedBudget = isVi
    ? `${animatedVnd.toLocaleString('vi-VN')} ₫`
    : `$${animatedUsd.toLocaleString('en-US')}`;

  const formatTimer = (sec: number) => {
    const whole = Math.min(TOTAL_SECONDS, Math.floor(sec));
    return `0:${String(whole).padStart(2, '0')}`;
  };

  const jumpToStep = (idx: number) => {
    setElapsed(idx * STEP_DURATION + 0.05);
  };

  return (
    <div className="ld-demo-shell">
      {/* Studio Browser Window Chrome */}
      <div className="ld-demo-window">
        <div className="ld-demo-topbar">
          <div className="ld-demo-traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="ld-demo-window-title">
            <img src={`${BASE}brand/logo.svg`} alt="" width={14} height={14} />
            <span>Mosa — {isVi ? 'Không gian sống · 01' : 'Living Space · 01'}</span>
          </div>
          <div className="ld-demo-topbar-right">
            <span className={`ld-demo-pill-badge ${activeStep === 0 && clippedCount > 0 ? 'is-pulsing' : ''}`}>
              <Inbox size={11} />
              <span>{clippedCount}</span>
            </span>
            <span className="ld-demo-pill-badge ld-demo-pill-badge--mode">
              {activeStep === 0 && 'Mosa Clipper'}
              {activeStep === 1 && (isVi ? `Nhận diện · ${scannedCount}/5` : `Organizing · ${scannedCount}/5`)}
              {activeStep === 2 && (isVi ? 'Bento Tạp chí' : 'Editorial Bento')}
              {activeStep === 3 && (isVi ? 'Bản trình bày' : 'Studio Deck')}
            </span>
          </div>
        </div>

        {/* Live 60fps Choreographed 16:9 Canvas Stage */}
        <div className={`ld-demo-stage is-step-${activeStep} ${handoffOpen ? 'is-handoff-shift' : ''}`}>
          <div className="ld-demo-dots" aria-hidden="true" />

          {/* Floating In-Stage Mini Toolbar (gives cursor real targets to click!) */}
          <div className="ld-demo-stage-bar" aria-hidden="true">
            <span className={`ld-stage-chip ${activeStep === 2 && stepTime >= 0.7 ? 'is-active' : ''}`}>
              <LayoutGrid size={11} />
              <span>{isVi ? 'Sắp Editorial Bento' : 'Arrange Bento'}</span>
            </span>
            <span className={`ld-stage-chip ${activeStep === 1 && stepTime >= 0.65 ? 'is-active' : ''}`}>
              <Sparkles size={11} />
              <span>{isVi ? 'Phân loại AI' : 'AI Classify'}</span>
            </span>
          </div>

          {/* Chapter 0 Mini Pinterest Clipper Source Popover */}
          <div
            className={`ld-demo-pinterest-card ${
              activeStep === 0 && stepTime >= 0.2 && stepTime <= 5.4 ? 'is-visible' : ''
            }`}
            aria-hidden="true"
          >
            <div className="ld-pin-head">
              <span className="ld-pin-dot" />
              <span>pinterest.com/pin/wabi-sabi</span>
            </div>
            <div className="ld-pin-img-wrap">
              <img src={`${BASE}samples/living-room.jpg`} alt="" />
              <span className={`ld-pin-mosa-btn ${stepTime >= 1.35 ? 'is-saved' : ''}`}>
                {stepTime >= 1.35 ? (isVi ? '✓ Đã lưu' : '✓ Saved') : 'Mosa'}
              </span>
            </div>
          </div>

          {/* Animated Canvas Layer (shifts gracefully during Chapter 4 Handoff) */}
          <div className={`ld-demo-canvas-layer ${handoffOpen ? 'is-shifted' : ''}`}>
            {/* Curved SVG Connector Arrows with live stroke-dashoffset drawing! */}
            <svg
              className={`ld-demo-connectors ${connectorsDrawn ? 'is-drawn' : ''}`}
              viewBox="0 0 1000 562"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="mosaDemoArrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5.5"
                  markerHeight="5.5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#007AFF" />
                </marker>
              </defs>
              <path
                className="ld-conn-path ld-conn-path--1"
                pathLength={1}
                d="M 490 190 C 505 190, 505 160, 520 160"
                fill="none"
                stroke="#007AFF"
                strokeWidth="2.5"
                markerEnd="url(#mosaDemoArrow)"
              />
              <path
                className="ld-conn-path ld-conn-path--2"
                pathLength={1}
                d="M 490 295 C 505 295, 505 340, 520 340"
                fill="none"
                stroke="#007AFF"
                strokeWidth="2.5"
                markerEnd="url(#mosaDemoArrow)"
              />
              <path
                className="ld-conn-path ld-conn-path--3"
                pathLength={1}
                d="M 730 160 C 740 160, 740 160, 750 160"
                fill="none"
                stroke="#007AFF"
                strokeWidth="2.3"
                markerEnd="url(#mosaDemoArrow)"
              />
            </svg>

            {/* 5 Animated Interior Photo Cards */}
            {DEMO_CARDS.map((card, index) => {
              const [left, top, width, height] = isArranged ? card.bento : card.scatter;
              const isVisible = activeStep > 0 || stepTime >= card.clipAppearAt;
              const justClipped =
                activeStep === 0 &&
                stepTime >= card.clipAppearAt &&
                stepTime < card.clipAppearAt + 0.95;
              const isCardScanned =
                activeStep > 1 || (activeStep === 1 && stepTime >= card.scanCrossAt);
              const justScanned =
                activeStep === 1 &&
                stepTime >= card.scanCrossAt &&
                stepTime < card.scanCrossAt + 0.8;

              // Animate confidence number rapidly when laser crosses the card
              const confRamp =
                activeStep === 1 && isCardScanned
                  ? Math.min(1, (stepTime - card.scanCrossAt) / 0.55)
                  : 1;
              const shownConf = Math.round(62 + (card.confidenceNum - 62) * confRamp);

              return (
                <div
                  key={card.id}
                  className={[
                    'ld-demo-card',
                    isVisible ? 'is-entered' : 'is-pre-enter',
                    justClipped ? 'is-clipping-in' : '',
                    justScanned ? 'is-scan-hit' : '',
                    isCardScanned && activeStep === 1 ? 'is-ai-scanned' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    transitionDelay: activeStep === 2 ? `${index * 65}ms` : '0ms',
                  }}
                >
                  <img src={card.src} alt={isVi ? card.titleVi : card.titleEn} loading="lazy" />
                  <div className="ld-demo-card-caption">
                    <span className="truncate">{isVi ? card.titleVi : card.titleEn}</span>
                  </div>

                  {/* AI CLIP Confidence Chip */}
                  <div
                    className={`ld-demo-ai-chip ${
                      (activeStep === 1 && isCardScanned) || activeStep === 2 ? 'is-shown' : ''
                    }`}
                    style={{ '--chip-color': card.tagColor } as React.CSSProperties}
                  >
                    <span className="ld-demo-ai-dot" />
                    <span>{isVi ? card.tagVi : card.tagEn}</span>
                    {activeStep === 1 && <strong>{shownConf}%</strong>}
                  </div>
                </div>
              );
            })}

            {/* Chapter 3 Extracted Palette Strip (swatches cascade 1-by-1) */}
            <div className={`ld-demo-palette-strip ${paletteRevealed ? 'is-shown' : ''}`}>
              <span className="ld-demo-palette-label">
                {isVi ? 'Bảng màu tự trích' : 'Auto Palette'}
              </span>
              <div className="ld-demo-palette-chips">
                {SWATCHES.map((sw, idx) => (
                  <span
                    key={sw.hex}
                    className={`ld-demo-swatch ${sw.light ? 'is-light' : ''} ${
                      paletteRevealed ? 'is-popped' : ''
                    }`}
                    style={{
                      background: sw.hex,
                      transitionDelay: `${idx * 110}ms`,
                    }}
                  >
                    <em>{sw.hex}</em>
                  </span>
                ))}
              </div>
            </div>

            {/* Subtle editorial sheen over finished Bento board */}
            <div
              className={`ld-demo-bento-sheen ${
                activeStep === 2 && stepTime >= 5.2 && stepTime <= 6.8 ? 'is-running' : ''
              }`}
              aria-hidden="true"
            />
          </div>

          {/* Chapter 1 Floating Clipper Toast */}
          <div
            className={`ld-demo-hud ld-demo-hud--clipper ${
              activeStep === 0 && clippedCount > 0 ? 'is-shown' : ''
            }`}
          >
            <div className="ld-hud-icon-badge">
              <Puzzle size={15} />
            </div>
            <div className="ld-hud-copy">
              <strong>
                {isVi
                  ? `Đã lưu ${clippedCount}/5 hình ảnh · pinterest.com`
                  : `Saved ${clippedCount}/5 visuals · pinterest.com`}
              </strong>
              <span>
                {isVi
                  ? 'Giữ nguyên độ phân giải sắc nét & đường dẫn nguồn'
                  : 'Full image quality & original source link preserved'}
              </span>
            </div>
            <span className="ld-hud-ok">✓</span>
          </div>

          {/* Chapter 2 Optical Scan Laser (driven smoothly by scanProgress!) */}
          <div
            className={`ld-demo-scan-laser ${isScanning ? 'is-active' : ''}`}
            style={{ left: `${scanProgress * 100}%` }}
            aria-hidden="true"
          />
          <div
            className={`ld-demo-hud ld-demo-hud--ai ${
              activeStep === 1 && stepTime >= 0.9 ? 'is-shown' : ''
            }`}
          >
            <div className="ld-hud-icon-badge ld-hud-icon-badge--dark">
              <Sparkles size={15} />
            </div>
            <div className="ld-hud-copy">
              <strong>
                {isVi
                  ? `Nhận diện 6 yếu tố thiết kế · ${scannedCount}/5`
                  : `6 visual design elements · ${scannedCount}/5`}
              </strong>
              <span>
                {isVi
                  ? 'Xử lý hoàn toàn riêng tư ngay trên máy của bạn'
                  : 'Processed privately right on your device'}
              </span>
            </div>
          </div>

          {/* Chapter 4 White-Label Studio Deck & Live Counting FF&E Handoff Card */}
          <div className={`ld-demo-handoff-card ${handoffOpen ? 'is-shown' : ''}`}>
            <div className="ld-handoff-head">
              <div>
                <span className="ld-handoff-eyebrow">
                  {isVi ? 'BẢN TRÌNH BÀY KHÁCH HÀNG' : 'CLIENT PRESENTATION'}
                </span>
                <h4>Mosa Interior Studio · MS-2026-01</h4>
              </div>
              <span className={`ld-handoff-approved ${clientApproved ? 'is-stamped' : ''}`}>
                <CheckCircle2 size={14} />
                {clientApproved
                  ? isVi
                    ? 'Khách đã duyệt ✓'
                    : 'Client Approved ✓'
                  : isVi
                    ? 'Chờ duyệt…'
                    : 'Pending…'}
              </span>
            </div>
            <div className="ld-handoff-rows">
              <div className={`ld-handoff-row ${ffeRow1Shown ? 'is-visible' : ''}`}>
                <span>SF-01 · {isVi ? 'Sofa vải lanh 3 chỗ' : '3-Seat Linen Sofa'} ×1</span>
                <strong>{isVi ? '28.500.000 ₫' : '$1,120'}</strong>
              </div>
              <div className={`ld-handoff-row ${ffeRow2Shown ? 'is-visible' : ''}`}>
                <span>CH-02 · {isVi ? 'Ghế thư giãn gỗ sồi' : 'Oak Lounge Chair'} ×2</span>
                <strong>{isVi ? '10.400.000 ₫' : '$410'}</strong>
              </div>
              <div className={`ld-handoff-row ${ffeRow3Shown ? 'is-visible' : ''}`}>
                <span>MT-03 · {isVi ? 'Bộ mẫu đá vôi & sồi' : 'Travertine & Oak Set'} ×1</span>
                <strong>{isVi ? '3.700.000 ₫' : '$150'}</strong>
              </div>
            </div>
            <div className="ld-handoff-total">
              <span>{isVi ? 'Tổng dự toán FF&E' : 'Estimated FF&E Total'}</span>
              <strong className="mono">{formattedBudget}</strong>
            </div>
          </div>

          {/* Choreographed Animated macOS Pointer Cursor + Click Ripple */}
          <div
            className={`ld-demo-cursor ${cursor.visible ? 'is-visible' : ''} ${
              cursor.clicking ? 'is-clicking' : ''
            }`}
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
            aria-hidden="true"
          >
            <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
              <path
                d="M3 2L17 11.5L10.2 12.6L7.2 19L3 2Z"
                fill="#1D1D1F"
                stroke="#FFFFFF"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
            <span className="ld-cursor-ripple" />
          </div>
        </div>
      </div>

      {/* Chapter Scrubber & Controls */}
      <div className="ld-demo-controls">
        <div className="ld-demo-controls-bar">
          <button
            type="button"
            className="ld-demo-play-btn"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? dict.landingDemoPause : dict.landingDemoPlay}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            <span>{playing ? dict.landingDemoPause : dict.landingDemoPlay}</span>
          </button>

          <span className="ld-demo-timer mono">
            {formatTimer(safeElapsed)} / 0:{TOTAL_SECONDS}
          </span>

          <div key={activeStep} className="ld-demo-active-summary">
            <strong>{steps[activeStep].title}</strong>
            <span>{steps[activeStep].desc}</span>
          </div>

          <button type="button" className="ld-btn ld-btn--primary ld-btn--sm" onClick={onTryNow}>
            <span>{dict.landingDemoTryBoard}</span>
            <ArrowRight size={14} />
          </button>
        </div>

        <div className="ld-demo-chapters" role="tablist" aria-label="Demo chapters">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isActive = idx === activeStep;
            const isPast = idx < activeStep;
            const fillPct = isPast ? 100 : isActive ? Math.min(100, Math.max(0, stepProgress)) : 0;
            return (
              <button
                key={step.label}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`ld-chapter-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => jumpToStep(idx)}
              >
                <div className="ld-chapter-head">
                  <Icon size={14} />
                  <span>{step.label}</span>
                </div>
                <div className="ld-chapter-track">
                  <div className="ld-chapter-fill" style={{ width: `${fillPct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
