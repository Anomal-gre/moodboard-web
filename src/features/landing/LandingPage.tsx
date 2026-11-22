import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Download,
  FolderSync,
  Globe,
  HardDrive,
  LayoutGrid,
  Mail,
  Minus,
  MonitorDown,
  Play,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { I18nDict } from '../../i18n';
import { formatBytesMb, getStorageHealth, type StorageHealthReport } from '../../storage/storageHealth';
import { InteractiveDemoStage } from './InteractiveDemoStage';
import { usePwaInstall } from './usePwaInstall';
import './landing.css';

interface LandingPageProps {
  dict: I18nDict;
  language: 'vi' | 'en';
  hasExistingWorkspace: boolean;
  onChangeLanguage: (lang: 'vi' | 'en') => void;
  onStartOnboarding: () => void;
  onEnterCanvasDirectly: () => void;
}

const BASE = import.meta.env.BASE_URL || './';

const MOODBOARD_PALETTE = [
  { hex: '#DED5C5', name: 'Limestone', light: true },
  { hex: '#C5A47E', name: 'Warm Oak', light: true },
  { hex: '#8D9A7C', name: 'Muted Sage' },
  { hex: '#5E594E', name: 'Umber' },
  { hex: '#2B2A27', name: 'Charcoal' },
];

type CellState = 'yes' | 'no' | 'partial' | string;
type ShowcasePresetId = 'interior' | 'materials' | 'editorial';

export const LandingPage: React.FC<LandingPageProps> = ({
  dict,
  language,
  hasExistingWorkspace,
  onChangeLanguage,
  onStartOnboarding,
  onEnterCanvasDirectly,
}) => {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const [storageReport, setStorageReport] = useState<StorageHealthReport | null>(null);
  const [scrollPct, setScrollPct] = useState(0);
  const [storageInView, setStorageInView] = useState(false);
  const [showcaseTab, setShowcaseTab] = useState<ShowcasePresetId>('interior');
  const pwa = usePwaInstall();
  const isVi = language === 'vi';

  useEffect(() => {
    let alive = true;
    getStorageHealth()
      .then((rep) => {
        if (alive) setStorageReport(rep);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Scroll progress hairline & IntersectionObserver scroll-reveal choreography
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
        setScrollPct(Math.max(0, Math.min(100, (root.scrollTop / maxScroll) * 100)));
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in-view'));
      setStorageInView(true);
      return () => {
        root.removeEventListener('scroll', onScroll);
        if (rafId) window.cancelAnimationFrame(rafId);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.classList.add('is-in-view');
            if (el.dataset.reveal === 'storage') {
              setStorageInView(true);
            }
            observer.unobserve(el);
          }
        }
      },
      { root, threshold: 0.1, rootMargin: '0px 0px -36px 0px' }
    );

    targets.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const scrollToSection = (id: string) => {
    const el = scrollRootRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ block: 'start' });
  };

  const primaryCtaLabel = hasExistingWorkspace ? dict.landingCtaResume : dict.landingCtaTryNow;
  const handlePrimaryCta = hasExistingWorkspace ? onEnterCanvasDirectly : onStartOnboarding;

  const usedMb = storageReport
    ? formatBytesMb(storageReport.browserUsageBytes ?? storageReport.usedAssetBytes)
    : '0.0';
  const quotaGb =
    storageReport?.browserQuotaBytes && storageReport.browserQuotaBytes > 0
      ? (storageReport.browserQuotaBytes / (1024 * 1024 * 1024)).toFixed(
          storageReport.browserQuotaBytes >= 10 * 1024 * 1024 * 1024 ? 0 : 1
        )
      : null;
  const usedRatioPct =
    storageReport?.browserQuotaBytes && storageReport.browserQuotaBytes > 0
      ? Math.max(
          2,
          Math.min(
            100,
            ((storageReport.browserUsageBytes ?? storageReport.usedAssetBytes) /
              storageReport.browserQuotaBytes) *
              100
          )
        )
      : 4;

  const designElementChips = [
    { label: isVi ? 'Không gian' : 'Space', color: '#007AFF' },
    { label: isVi ? 'Hình khối' : 'Form', color: '#C5A47E' },
    { label: isVi ? 'Kết cấu' : 'Texture', color: '#8D9A7C' },
    { label: isVi ? 'Màu sắc' : 'Color', color: '#FF9500' },
    { label: isVi ? 'Đường nét' : 'Line', color: '#5856D6' },
    { label: isVi ? 'Chữ & Type' : 'Typography', color: '#AF52DE' },
  ];

  const comparisonRows: Array<{
    feature: string;
    mosa: CellState;
    milanote: CellState;
    pureref: CellState;
    pinterest: CellState;
  }> = [
    {
      feature: dict.landingCompareRow1,
      mosa: 'yes',
      milanote: 'no',
      pureref: 'yes',
      pinterest: 'no',
    },
    {
      feature: dict.landingCompareRow2,
      mosa: 'yes',
      milanote: 'no',
      pureref: 'no',
      pinterest: 'no',
    },
    {
      feature: dict.landingCompareRow3,
      mosa: 'yes',
      milanote: 'partial',
      pureref: 'partial',
      pinterest: 'no',
    },
    {
      feature: dict.landingCompareRow4,
      mosa: 'yes',
      milanote: 'partial',
      pureref: 'no',
      pinterest: 'no',
    },
    {
      feature: dict.landingCompareRow5,
      mosa: 'yes',
      milanote: 'yes',
      pureref: 'no',
      pinterest: 'partial',
    },
    {
      feature: dict.landingCompareRow6,
      mosa: dict.landingComparePriceMosa,
      milanote: dict.landingComparePriceMilanote,
      pureref: dict.landingComparePricePureref,
      pinterest: dict.landingComparePricePinterest,
    },
  ];

  const renderCell = (val: CellState, isMosa = false) => {
    if (val === 'yes') {
      return (
        <span className={`ld-cmp-mark ld-cmp-mark--yes ${isMosa ? 'is-mosa' : ''}`} aria-label="Yes">
          <Check size={14} />
        </span>
      );
    }
    if (val === 'no') {
      return (
        <span className="ld-cmp-mark ld-cmp-mark--no" aria-label="No">
          <X size={14} />
        </span>
      );
    }
    if (val === 'partial') {
      return (
        <span className="ld-cmp-partial">
          <Minus size={12} />
          <span>{dict.landingComparePartial}</span>
        </span>
      );
    }
    return <span className={`ld-cmp-text ${isMosa ? 'is-mosa' : ''}`}>{val}</span>;
  };

  return (
    <div ref={scrollRootRef} className="ld-root">
      {/* Sticky Frosted Navigation */}
      <header className="ld-nav">
        <div className="ld-nav-inner">
          <button
            type="button"
            className="ld-nav-brand"
            onClick={() => scrollRootRef.current?.scrollTo({ top: 0 })}
          >
            <img src={`${BASE}brand/logo.svg`} alt="Mosa" width={24} height={24} />
            <span className="ld-nav-wordmark">Mosa</span>
          </button>

          <nav className="ld-nav-links" aria-label="Landing navigation">
            <button type="button" onClick={() => scrollToSection('demo')}>
              {dict.landingNavDemo}
            </button>
            <button type="button" onClick={() => scrollToSection('showcase')}>
              {dict.landingNavShowcase}
            </button>
            <button type="button" onClick={() => scrollToSection('features')}>
              {dict.landingNavFeatures}
            </button>
            <button type="button" onClick={() => scrollToSection('compare')}>
              {dict.landingNavCompare}
            </button>
            <button type="button" onClick={() => scrollToSection('install')}>
              {dict.landingNavInstall}
            </button>
          </nav>

          <div className="ld-nav-actions">
            <div className="ld-lang-switch" role="group" aria-label="Language">
              <button
                type="button"
                className={language === 'vi' ? 'is-active' : ''}
                aria-pressed={language === 'vi'}
                onClick={() => onChangeLanguage('vi')}
              >
                VI
              </button>
              <button
                type="button"
                className={language === 'en' ? 'is-active' : ''}
                aria-pressed={language === 'en'}
                onClick={() => onChangeLanguage('en')}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              className="ld-btn ld-btn--primary ld-btn--sm"
              onClick={handlePrimaryCta}
            >
              <span>{primaryCtaLabel}</span>
            </button>
          </div>
        </div>
        <div className="ld-scroll-progress" aria-hidden="true">
          <div className="ld-scroll-progress-bar" style={{ width: `${scrollPct}%` }} />
        </div>
      </header>

      {/* Hero with a preview assembled from Mosa's sample library */}
      <section className="ld-hero">
        <div className="ld-container ld-hero-inner">
          <div className="ld-hero-copy">
            <span className="ld-eyebrow-pill ld-hero-enter" style={{ '--d': '0ms' } as React.CSSProperties}>
              <span className="ld-live-dot" aria-hidden="true" />
              <span>{dict.landingHeroEyebrow}</span>
            </span>
            <h1 className="ld-hero-title">
              <span className="ld-hero-enter" style={{ '--d': '85ms' } as React.CSSProperties}>
                {dict.landingHeroTitleLine1}
              </span>
              <span
                className="ld-hero-title-accent ld-hero-enter"
                style={{ '--d': '175ms' } as React.CSSProperties}
              >
                {dict.landingHeroTitleLine2}
              </span>
            </h1>
            <p className="ld-hero-subtitle ld-hero-enter" style={{ '--d': '265ms' } as React.CSSProperties}>
              {dict.landingHeroSubtitle}
            </p>

            <div className="ld-hero-ctas ld-hero-enter" style={{ '--d': '350ms' } as React.CSSProperties}>
              <button type="button" className="ld-btn ld-btn--primary ld-btn--lg" onClick={handlePrimaryCta}>
                <span>{primaryCtaLabel}</span>
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                className="ld-btn ld-btn--glass ld-btn--lg"
                onClick={() => scrollToSection('demo')}
              >
                <Play size={15} />
                <span>{dict.landingCtaWatchDemo}</span>
              </button>
            </div>

            <div className="ld-hero-sub-row ld-hero-enter" style={{ '--d': '430ms' } as React.CSSProperties}>
              <span className="ld-trust-caption">{dict.landingTrustLine}</span>
              {hasExistingWorkspace ? (
                <button type="button" className="ld-inline-link" onClick={onStartOnboarding}>
                  {dict.landingCtaStartWizard}
                </button>
              ) : (
                <button type="button" className="ld-inline-link" onClick={onEnterCanvasDirectly}>
                  {dict.landingCtaDirectCanvas}
                </button>
              )}
            </div>
          </div>

          <div className="ld-hero-board ld-hero-enter" aria-hidden="true">
            <img className="ld-hero-board-room" src={`${BASE}samples/living-room.jpg`} alt="" fetchPriority="high" />
            <img src={`${BASE}samples/armchair.jpg`} alt="" />
            <img src={`${BASE}samples/material-texture.jpg`} alt="" />
            <div className="ld-hero-palette">
              {MOODBOARD_PALETTE.map(({ hex }) => (
                <span key={hex} style={{ backgroundColor: hex }} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 30-Second Choreographed Film Showcase */}
      <section id="demo" className="ld-section ld-section--tinted">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingDemoEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingDemoTitle}</h2>
            <p className="ld-section-desc">{dict.landingDemoSubtitle}</p>
          </div>

          <div className="ld-reveal" data-reveal="demo" style={{ '--rd': '80ms' } as React.CSSProperties}>
            <InteractiveDemoStage dict={dict} language={language} onTryNow={handlePrimaryCta} />
          </div>
        </div>
      </section>

      {/* Interactive 3-Style Visual Moodboard Gallery Showcase */}
      <section id="showcase" className="ld-section">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingShowcaseEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingShowcaseTitle}</h2>
            <p className="ld-section-desc">{dict.landingShowcaseSubtitle}</p>
          </div>

          <div className="ld-showcase-tabs ld-reveal" data-reveal="section" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={showcaseTab === 'interior'}
              className={`ld-showcase-tab ${showcaseTab === 'interior' ? 'is-active' : ''}`}
              onClick={() => setShowcaseTab('interior')}
            >
              {dict.landingShowcaseTab1}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showcaseTab === 'materials'}
              className={`ld-showcase-tab ${showcaseTab === 'materials' ? 'is-active' : ''}`}
              onClick={() => setShowcaseTab('materials')}
            >
              {dict.landingShowcaseTab2}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showcaseTab === 'editorial'}
              className={`ld-showcase-tab ${showcaseTab === 'editorial' ? 'is-active' : ''}`}
              onClick={() => setShowcaseTab('editorial')}
            >
              {dict.landingShowcaseTab3}
            </button>
          </div>

          <div
            className={`ld-gallery-stage is-mode-${showcaseTab} ld-reveal`}
            data-reveal="card"
            style={{ '--rd': '80ms' } as React.CSSProperties}
          >
            {showcaseTab === 'interior' && (
              <div key="interior" className="ld-gal-board ld-gal-board--interior">
                <figure className="ld-gal-photo ld-gal-hero">
                  <img src={`${BASE}samples/living-room.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Không gian chính · Wabi-Sabi' : 'Hero Space · Wabi-Sabi'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-chair">
                  <img src={`${BASE}samples/armchair.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Hình khối · Ghế sồi' : 'Form · Oak Armchair'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-plan">
                  <img src={`${BASE}samples/floor-plan.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Đường nét · Mặt bằng 1:50' : 'Line · 1:50 Plan'}</figcaption>
                </figure>
                <div className="ld-gal-note">
                  <span>{isVi ? 'GHI CHÚ Ý TƯỞNG' : 'CONCEPT NOTE'}</span>
                  <strong>{isVi ? 'Ánh sáng tự nhiên & bề mặt thô mộc' : 'Soft daylight & tactile warmth'}</strong>
                  <p>
                    {isVi
                      ? 'Ưu tiên gỗ sồi dầu mờ, vải lanh tự nhiên và đường cong mềm cho khu vực tiếp khách.'
                      : 'Matte oiled oak, natural linen weave, and gentle curved silhouettes.'}
                  </p>
                </div>
                <div className="ld-gal-palette-bar">
                  {MOODBOARD_PALETTE.map((sw) => (
                    <div
                      key={sw.hex}
                      className={`ld-gal-swatch ${sw.light ? 'is-light' : ''}`}
                      style={{ background: sw.hex }}
                    >
                      <strong>{sw.name}</strong>
                      <span>{sw.hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showcaseTab === 'materials' && (
              <div key="materials" className="ld-gal-board ld-gal-board--materials">
                <figure className="ld-gal-photo ld-gal-mat-hero">
                  <img src={`${BASE}samples/material-texture.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Kết cấu · Gỗ · Đá · Vải lanh' : 'Texture · Wood · Stone · Linen'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-mat-swatches">
                  <img src={`${BASE}samples/paint-swatches.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Màu sắc · Bảng sơn mờ' : 'Color · Matte Paint Chips'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-mat-chair">
                  <img src={`${BASE}samples/armchair.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Vật thể · Hoàn thiện sồi tự nhiên' : 'Object · Natural Oak Finish'}</figcaption>
                </figure>
                <div className="ld-gal-spec-card">
                  <div className="ld-gal-spec-head">
                    <span>{isVi ? 'BẢNG VẬT LIỆU & DỰ TOÁN' : 'MATERIAL & BUDGET SPEC'}</span>
                    <span className="ld-gal-spec-pill">{isVi ? 'Đã chốt mẫu' : 'Approved'}</span>
                  </div>
                  <div className="ld-gal-spec-row">
                    <span>MT-01 · {isVi ? 'Gỗ sồi lau dầu mờ' : 'Oiled White Oak'}</span>
                    <strong>12 m²</strong>
                  </div>
                  <div className="ld-gal-spec-row">
                    <span>MT-02 · {isVi ? 'Đá vôi Travertine thô' : 'Honed Travertine'}</span>
                    <strong>8 m²</strong>
                  </div>
                  <div className="ld-gal-spec-row">
                    <span>TX-03 · {isVi ? 'Vải lanh Bỉ dệt thô' : 'Belgian Raw Linen'}</span>
                    <strong>6 m</strong>
                  </div>
                </div>
              </div>
            )}

            {showcaseTab === 'editorial' && (
              <div key="editorial" className="ld-gal-board ld-gal-board--editorial">
                <div className="ld-gal-type-poster">
                  <span className="ld-gal-type-kicker">ATELIER · ISSUE 04</span>
                  <h3>
                    Quiet
                    <br />
                    Forms.
                  </h3>
                  <p>Bricolage Grotesque · Inter · Editorial Grid 0°</p>
                </div>
                <figure className="ld-gal-photo ld-gal-ed-chair">
                  <img src={`${BASE}samples/armchair.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Hình khối · Điểm nhấn' : 'Form · Sculpture'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-ed-room">
                  <img src={`${BASE}samples/living-room.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Bối cảnh · Nhịp ánh sáng' : 'Mood · Daylight Rhythm'}</figcaption>
                </figure>
                <figure className="ld-gal-photo ld-gal-ed-tex">
                  <img src={`${BASE}samples/material-texture.jpg`} alt="" loading="lazy" />
                  <figcaption>{isVi ? 'Bề mặt · Giấy & Vải' : 'Surface · Paper & Weave'}</figcaption>
                </figure>
              </div>
            )}

            <div className="ld-gallery-footer">
              <span>
                {showcaseTab === 'interior' && dict.landingShowcaseTab1Caption}
                {showcaseTab === 'materials' && dict.landingShowcaseTab2Caption}
                {showcaseTab === 'editorial' && dict.landingShowcaseTab3Caption}
              </span>
              <button type="button" className="ld-inline-link" onClick={handlePrimaryCta}>
                {dict.landingDemoTryBoard} →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Visual-First 4-Tile Bento Highlights (No tech walls!) */}
      <section id="features" className="ld-section ld-section--tinted">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingFeaturesEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingFeaturesTitle}</h2>
          </div>

          <div className="ld-bento-grid">
            {/* Tile 1 (Wide 4 cols): Visual Art-Directed Layout Preview */}
            <article
              className="ld-bento-card ld-bento-card--wide ld-bento-card--visual ld-reveal"
              data-reveal="card"
              style={{ '--rd': '0ms' } as React.CSSProperties}
            >
              <div className="ld-bento-visual-copy">
                <div className="ld-bento-icon-wrap">
                  <LayoutGrid size={20} />
                </div>
                <h3>{dict.landingBentoArrangeTitle}</h3>
                <p>{dict.landingBentoArrangeDesc}</p>
              </div>
              <div className="ld-bento-collage-art" aria-hidden="true">
                <img className="bca-main" src={`${BASE}samples/living-room.jpg`} alt="" loading="lazy" />
                <img className="bca-top" src={`${BASE}samples/armchair.jpg`} alt="" loading="lazy" />
                <img className="bca-bot" src={`${BASE}samples/material-texture.jpg`} alt="" loading="lazy" />
              </div>
            </article>

            {/* Tile 2 (2 cols): Visual Clipper Card */}
            <article
              className="ld-bento-card ld-bento-card--blue-tint ld-reveal"
              data-reveal="card"
              style={{ '--rd': '90ms' } as React.CSSProperties}
            >
              <div>
                <div className="ld-clip-mini-preview" aria-hidden="true">
                  <img src={`${BASE}samples/armchair.jpg`} alt="" loading="lazy" />
                  <span className="ld-clip-mini-pill">Mosa</span>
                </div>
                <h3>{dict.landingBentoClipperTitle}</h3>
                <p>{dict.landingBentoClipperDesc}</p>
              </div>
              <div className="ld-bento-actions">
                <a
                  href={`${BASE}downloads/mosa-clipper.zip`}
                  download="mosa-clipper.zip"
                  className="ld-btn ld-btn--primary ld-btn--sm"
                >
                  <Download size={14} />
                  <span>{dict.clipperDownloadBtn}</span>
                </a>
              </div>
            </article>

            {/* Tile 3 (2 cols): 6 Universal Design Elements Visual Card */}
            <article
              className="ld-bento-card ld-bento-card--warm ld-reveal"
              data-reveal="card"
              style={{ '--rd': '60ms' } as React.CSSProperties}
            >
              <div>
                <span className="ld-bento-tag ld-bento-tag--light">
                  <Sparkles size={12} />
                  <span>{dict.landingBentoAiBadge}</span>
                </span>
                <h3>{dict.landingBentoAiTitle}</h3>
                <p>{dict.landingBentoAiDesc}</p>
              </div>
              <div className="ld-elements-cloud" aria-hidden="true">
                {designElementChips.map((el) => (
                  <span key={el.label} className="ld-element-pill">
                    <span className="ld-element-dot" style={{ background: el.color }} />
                    <span>{el.label}</span>
                  </span>
                ))}
              </div>
            </article>

            {/* Tile 4 (Wide 4 cols): Studio Presentation & Client Sign-Off Preview */}
            <article
              className="ld-bento-card ld-bento-card--wide ld-bento-card--deck ld-reveal"
              data-reveal="card"
              style={{ '--rd': '140ms' } as React.CSSProperties}
            >
              <div className="ld-bento-split">
                <div>
                  <span className="ld-bento-tag ld-bento-tag--green">
                    <CheckCircle2 size={12} />
                    <span>{isVi ? 'Trình bày & Duyệt phương án' : 'Present & Sign-off'}</span>
                  </span>
                  <h3>{dict.landingBentoExportTitle}</h3>
                  <p>{dict.landingBentoExportDesc}</p>
                </div>
                <div className="ld-export-preview-stack" aria-hidden="true">
                  <div className="ld-export-chip">
                    <span className="ld-export-ext">PDF</span>
                    <span>{isVi ? 'Bản trình bày mang logo riêng' : 'Branded Studio Deck'}</span>
                  </div>
                  <div className="ld-export-chip">
                    <span className="ld-export-ext ld-export-ext--green">FF&amp;E</span>
                    <span>{isVi ? 'Bảng dự toán tự cộng tổng' : 'Auto-Summed Budget'}</span>
                  </div>
                  <div className="ld-export-chip">
                    <span className="ld-export-ext ld-export-ext--blue">HTML</span>
                    <span>{isVi ? 'Tệp tương tác khách duyệt ngay' : 'Interactive Client Review'}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Clean, Jargon-Free Comparison */}
      <section id="compare" className="ld-section">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingCompareEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingCompareTitle}</h2>
          </div>

          <div
            className="ld-compare-wrap ld-reveal"
            data-reveal="table"
            role="region"
            aria-label={dict.landingCompareTitle}
            tabIndex={0}
            style={{ '--rd': '80ms' } as React.CSSProperties}
          >
            <table className="ld-compare-table">
              <thead>
                <tr>
                  <th>{dict.landingCompareColFeature}</th>
                  <th className="is-mosa-col">
                    <span className="ld-cmp-mosa-head">
                      <img src={`${BASE}brand/logo.svg`} alt="" width={16} height={16} />
                      <span>Mosa</span>
                    </span>
                  </th>
                  <th>Milanote</th>
                  <th>PureRef</th>
                  <th>Pinterest</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <td className="ld-cmp-feature">{row.feature}</td>
                    <td className="is-mosa-col">{renderCell(row.mosa, true)}</td>
                    <td>{renderCell(row.milanote)}</td>
                    <td>{renderCell(row.pureref)}</td>
                    <td>{renderCell(row.pinterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Flexible Hybrid Setup & Quiet Privacy Bar */}
      <section id="install" className="ld-section ld-section--tinted">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingInstallEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingInstallTitle}</h2>
            <p className="ld-section-desc">{dict.landingInstallSubtitle}</p>
          </div>

          <div className="ld-install-grid">
            <article
              className="ld-install-card ld-reveal"
              data-reveal="card"
              style={{ '--rd': '0ms' } as React.CSSProperties}
            >
              <div>
                <div className="ld-install-top">
                  <span className="ld-bento-icon-wrap">
                    <Globe size={20} />
                  </span>
                  <span className="ld-install-badge">{dict.landingInstallCard1Badge}</span>
                </div>
                <h3>{dict.landingInstallCard1Title}</h3>
                <p>{dict.landingInstallCard1Desc}</p>
              </div>
              <div className="ld-install-action">
                <button
                  type="button"
                  className="ld-btn ld-btn--glass ld-btn--sm ld-btn--block"
                  onClick={handlePrimaryCta}
                >
                  <span>{primaryCtaLabel}</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </article>

            <article
              className="ld-install-card ld-install-card--featured ld-reveal"
              data-reveal="card"
              style={{ '--rd': '90ms' } as React.CSSProperties}
            >
              <div>
                <div className="ld-install-top">
                  <span className="ld-bento-icon-wrap ld-bento-icon-wrap--blue">
                    <MonitorDown size={20} />
                  </span>
                  <span className="ld-install-badge ld-install-badge--accent">
                    <RefreshCw size={11} />
                    <span>{dict.landingInstallCard2Badge}</span>
                  </span>
                </div>
                <h3>{dict.landingInstallCard2Title}</h3>
                <p>{dict.landingInstallCard2Desc}</p>
              </div>
              <div className="ld-install-action">
                <button
                  type="button"
                  className={`ld-btn ld-btn--sm ld-btn--block ${
                    pwa.status === 'installed' ? 'ld-btn--installed' : 'ld-btn--primary'
                  }`}
                  onClick={() => void pwa.triggerInstall()}
                  disabled={pwa.status === 'installed'}
                >
                  <MonitorDown size={14} />
                  <span>
                    {pwa.status === 'installed'
                      ? dict.landingInstallPwaInstalled
                      : dict.landingInstallPwaBtn}
                  </span>
                </button>
                {pwa.status === 'manual-hint' && (
                  <p className="ld-install-hint" role="status">{dict.landingInstallPwaManualHint}</p>
                )}
              </div>
            </article>

            <article
              className="ld-install-card ld-reveal"
              data-reveal="card"
              style={{ '--rd': '180ms' } as React.CSSProperties}
            >
              <div>
                <div className="ld-install-top">
                  <span className="ld-bento-icon-wrap">
                    <Puzzle size={20} />
                  </span>
                  <span className="ld-install-badge">{dict.landingInstallCard3Badge}</span>
                </div>
                <h3>{dict.landingInstallCard3Title}</h3>
                <p>{dict.landingInstallCard3Desc}</p>
              </div>
              <div className="ld-install-action">
                <a
                  href={`${BASE}downloads/mosa-clipper.zip`}
                  download="mosa-clipper.zip"
                  className="ld-btn ld-btn--glass ld-btn--sm ld-btn--block"
                >
                  <Download size={14} />
                  <span>{dict.clipperDownloadBtn}</span>
                </a>
              </div>
            </article>
          </div>

          {/* Quiet Live Local Storage & Privacy Strip */}
          <div id="privacy" className="ld-storage-banner ld-storage-banner--compact ld-reveal" data-reveal="storage">
            <div className="ld-storage-banner-head">
              <div className="ld-storage-title-wrap">
                <span className="ld-storage-icon-badge">
                  <HardDrive size={17} />
                </span>
                <div>
                  <span className="ld-storage-kicker">{dict.landingStorageLiveLabel}</span>
                  <strong>
                    {quotaGb
                      ? dict.landingStorageUsedLine(usedMb, quotaGb)
                      : dict.landingStorageFallback}
                  </strong>
                </div>
              </div>
              <span className="ld-zero-cloud-pill">
                <ShieldCheck size={14} />
                <span>{dict.landingStorageZeroCloud}</span>
              </span>
            </div>
            <div className="ld-storage-bar-track" aria-hidden="true">
              <div
                className="ld-storage-bar-fill"
                style={{ width: `${storageInView ? usedRatioPct : 0}%` }}
              />
            </div>
            <div className="ld-sync-inline-note">
              <FolderSync size={14} />
              <span>{dict.landingInstallSyncNote}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Closing Editorial CTA */}
      <section className="ld-closing">
        <div className="ld-container ld-closing-inner ld-reveal" data-reveal="section">
          <h2>{dict.landingClosingTitle}</h2>
          <p>{dict.landingClosingSubtitle}</p>
          <div className="ld-hero-ctas">
            <button type="button" className="ld-btn ld-btn--primary ld-btn--lg" onClick={handlePrimaryCta}>
              <span>{primaryCtaLabel}</span>
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="ld-btn ld-btn--glass ld-btn--lg"
              onClick={() => scrollToSection('install')}
            >
              <MonitorDown size={16} />
              <span>
                {pwa.status === 'installed'
                  ? dict.landingInstallPwaInstalled
                  : dict.landingInstallPwaBtn}
              </span>
            </button>
          </div>
        </div>
      </section>

      <footer className="ld-footer">
        <div className="ld-container">
          <div className="ld-footer-grid">
            {/* Column 1: Brand & Creator Identity */}
            <div className="ld-footer-col ld-footer-col--brand">
              <div className="ld-footer-logo-row">
                <img src={`${BASE}brand/logo.svg`} alt="Mosa" width={22} height={22} />
                <span className="ld-nav-wordmark">Mosa</span>
              </div>
              <p className="ld-footer-bio">{dict.landingFooterCreatorBio}</p>
              <a
                href="https://anomal.ohwow.win"
                target="_blank"
                rel="noopener noreferrer"
                className="ld-footer-site-pill"
              >
                <span>anomal.ohwow.win</span>
                <ArrowUpRight size={13} />
              </a>
            </div>

            {/* Column 2: Product */}
            <div className="ld-footer-col">
              <h4>{dict.landingFooterColProduct}</h4>
              <ul>
                <li>
                  <button type="button" onClick={() => scrollToSection('demo')}>
                    {dict.landingNavDemo}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollToSection('showcase')}>
                    {dict.landingNavShowcase}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollToSection('install')}>
                    {dict.landingNavInstall}
                  </button>
                </li>
                <li>
                  <a
                    href="https://github.com/Anomal-gre/moodboard-web"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{dict.landingFooterRepoLink}</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Creator Links (from anomal.ohwow.win) */}
            <div className="ld-footer-col">
              <h4>{dict.landingFooterColCreator}</h4>
              <ul>
                <li>
                  <a
                    href="https://anomal.ohwow.win"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Anomal · Website</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a
                    href="https://drive.google.com/drive/folders/1VGFzM5YZ_y-cfqixUHnG_vazjcJgUScA?usp=sharing"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Portfolio</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/Anomal-gre"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>GitHub (@Anomal-gre)</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.linkedin.com/in/anomal/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>LinkedIn</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.facebook.com/anomalgreatad/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Facebook</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 4: Other Projects & Contact */}
            <div className="ld-footer-col">
              <h4>{dict.landingFooterColMore}</h4>
              <ul>
                <li>
                  <a href="https://ohwow.win" target="_blank" rel="noopener noreferrer">
                    <span>Ohwow.win</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a href="https://chonvachot.com" target="_blank" rel="noopener noreferrer">
                    <span>Chọn &amp; Chốt</span>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a href="mailto:contact.anomal@gmail.com">
                    <Mail size={12} />
                    <span>contact.anomal@gmail.com</span>
                  </a>
                </li>
                <li>
                  <a href="mailto:bao.anomal@gmail.com">
                    <Mail size={12} />
                    <span>bao.anomal@gmail.com</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="ld-footer-bottom">
            <span>{dict.landingFooterNote}</span>
            <span>Say AI Ambassador 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
