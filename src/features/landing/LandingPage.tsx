import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Cpu,
  Download,
  FileArchive,
  FileSpreadsheet,
  FolderSync,
  HardDrive,
  LayoutGrid,
  Link2,
  Lock,
  Minus,
  Play,
  Puzzle,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import type { I18nDict } from '../../i18n';
import { formatBytesMb, getStorageHealth, type StorageHealthReport } from '../../storage/storageHealth';
import { InteractiveDemoStage } from './InteractiveDemoStage';
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

type CellState = 'yes' | 'no' | 'partial' | string;

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

  // Apple-style scroll progress hairline & IntersectionObserver scroll-reveal choreography
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
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
      {/* Apple-style Sticky Frosted Global Nav */}
      <header className="ld-nav">
        <div className="ld-nav-inner">
          <button
            type="button"
            className="ld-nav-brand"
            onClick={() => scrollRootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <img src={`${BASE}brand/logo.svg`} alt="Mosa" width={24} height={24} />
            <span className="ld-nav-wordmark">Mosa</span>
          </button>

          <nav className="ld-nav-links" aria-label="Landing navigation">
            <button type="button" onClick={() => scrollToSection('demo')}>
              {dict.landingNavDemo}
            </button>
            <button type="button" onClick={() => scrollToSection('features')}>
              {dict.landingNavFeatures}
            </button>
            <button type="button" onClick={() => scrollToSection('compare')}>
              {dict.landingNavCompare}
            </button>
            <button type="button" onClick={() => scrollToSection('privacy')}>
              {dict.landingNavPrivacy}
            </button>
          </nav>

          <div className="ld-nav-actions">
            <div className="ld-lang-switch" role="group" aria-label="Language">
              <button
                type="button"
                className={language === 'vi' ? 'is-active' : ''}
                onClick={() => onChangeLanguage('vi')}
              >
                VI
              </button>
              <button
                type="button"
                className={language === 'en' ? 'is-active' : ''}
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

      {/* Hero Section */}
      <section className="ld-hero">
        <div className="ld-hero-aura ld-hero-aura--left" aria-hidden="true" />
        <div className="ld-hero-aura ld-hero-aura--right" aria-hidden="true" />
        <div className="ld-container ld-hero-inner">
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
              <button
                type="button"
                className="ld-inline-link"
                onClick={onStartOnboarding}
              >
                {dict.landingCtaStartWizard}
              </button>
            ) : (
              <button
                type="button"
                className="ld-inline-link"
                onClick={onEnterCanvasDirectly}
              >
                {dict.landingCtaDirectCanvas}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 30-Second Interactive Demo Showcase */}
      <section id="demo" className="ld-section ld-section--tinted">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingDemoEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingDemoTitle}</h2>
            <p className="ld-section-desc">{dict.landingDemoSubtitle}</p>
          </div>

          <div className="ld-reveal" data-reveal="demo" style={{ '--rd': '80ms' } as React.CSSProperties}>
            <InteractiveDemoStage
              dict={dict}
              language={language}
              onTryNow={handlePrimaryCta}
            />
          </div>
        </div>
      </section>

      {/* Apple-Style Bento Features Grid */}
      <section id="features" className="ld-section">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingFeaturesEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingFeaturesTitle}</h2>
          </div>

          <div className="ld-bento-grid">
            {/* Tile 1: Wide Dark Obsidian AI CLIP Hero Card */}
            <article
              className="ld-bento-card ld-bento-card--wide ld-bento-card--obsidian ld-reveal"
              data-reveal="card"
              style={{ '--rd': '0ms' } as React.CSSProperties}
            >
              <div className="ld-bento-top">
                <span className="ld-bento-tag ld-bento-tag--dark">
                  <span className="ld-live-dot ld-live-dot--cyan" aria-hidden="true" />
                  <Cpu size={13} />
                  <span>{dict.landingBentoAiBadge}</span>
                </span>
                <h3>{dict.landingBentoAiTitle}</h3>
                <p>{dict.landingBentoAiDesc}</p>
              </div>
              <div className="ld-bento-ai-metrics">
                <div className="ld-ai-metric">
                  <strong>{dict.landingBentoAiStat1Val}</strong>
                  <span>{dict.landingBentoAiStat1Label}</span>
                </div>
                <div className="ld-ai-metric">
                  <strong>{dict.landingBentoAiStat2Val}</strong>
                  <span>{dict.landingBentoAiStat2Label}</span>
                </div>
                <div className="ld-ai-metric">
                  <strong>q8 WASM</strong>
                  <span>clip-vit-base-patch32</span>
                </div>
              </div>
            </article>

            {/* Tile 2: 4 Smart Layout Modes */}
            <article
              className="ld-bento-card ld-reveal"
              data-reveal="card"
              style={{ '--rd': '90ms' } as React.CSSProperties}
            >
              <div className="ld-bento-icon-wrap">
                <LayoutGrid size={20} />
              </div>
              <h3>{dict.landingBentoArrangeTitle}</h3>
              <p>{dict.landingBentoArrangeDesc}</p>
              <div className="ld-mini-bento-art" aria-hidden="true">
                <span className="mba-hero" />
                <span className="mba-a" />
                <span className="mba-b" />
                <span className="mba-bar" />
              </div>
            </article>

            {/* Tile 3: Mosa Web Clipper + Direct Download */}
            <article
              className="ld-bento-card ld-bento-card--blue-tint ld-reveal"
              data-reveal="card"
              style={{ '--rd': '60ms' } as React.CSSProperties}
            >
              <div className="ld-bento-icon-wrap ld-bento-icon-wrap--blue">
                <Puzzle size={20} />
              </div>
              <h3>{dict.landingBentoClipperTitle}</h3>
              <p>{dict.landingBentoClipperDesc}</p>
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

            {/* Tile 4: Wide White-Label Studio PDF & FF&E Card */}
            <article
              className="ld-bento-card ld-bento-card--wide ld-bento-card--warm ld-reveal"
              data-reveal="card"
              style={{ '--rd': '140ms' } as React.CSSProperties}
            >
              <div className="ld-bento-split">
                <div>
                  <div className="ld-bento-icon-wrap">
                    <FileSpreadsheet size={20} />
                  </div>
                  <h3>{dict.landingBentoExportTitle}</h3>
                  <p>{dict.landingBentoExportDesc}</p>
                </div>
                <div className="ld-export-preview-stack" aria-hidden="true">
                  <div className="ld-export-chip">
                    <span className="ld-export-ext">PDF</span>
                    <span>White-label Studio Deck</span>
                  </div>
                  <div className="ld-export-chip">
                    <span className="ld-export-ext ld-export-ext--green">CSV</span>
                    <span>FF&amp;E Qty × Unit Price</span>
                  </div>
                  <div className="ld-export-chip">
                    <span className="ld-export-ext ld-export-ext--blue">HTML</span>
                    <span>Read-Only Client Approval</span>
                  </div>
                </div>
              </div>
            </article>

            {/* Tile 5: Real .mosa Files & Local Folder Sync */}
            <article
              className="ld-bento-card ld-bento-card--half ld-reveal"
              data-reveal="card"
              style={{ '--rd': '60ms' } as React.CSSProperties}
            >
              <div className="ld-bento-icon-wrap">
                <FolderSync size={20} />
              </div>
              <h3>{dict.landingBentoSyncTitle}</h3>
              <p>{dict.landingBentoSyncDesc}</p>
            </article>

            {/* Tile 6: Source Provenance */}
            <article
              className="ld-bento-card ld-bento-card--half ld-reveal"
              data-reveal="card"
              style={{ '--rd': '140ms' } as React.CSSProperties}
            >
              <div className="ld-bento-icon-wrap">
                <Link2 size={20} />
              </div>
              <h3>{dict.landingBentoSourceTitle}</h3>
              <p>{dict.landingBentoSourceDesc}</p>
            </article>
          </div>
        </div>
      </section>

      {/* Competitor Comparison Table */}
      <section id="compare" className="ld-section ld-section--tinted">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingCompareEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingCompareTitle}</h2>
          </div>

          <div className="ld-compare-wrap ld-reveal" data-reveal="table" style={{ '--rd': '80ms' } as React.CSSProperties}>
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

      {/* Local-First Privacy & Live Storage Health Section */}
      <section id="privacy" className="ld-section">
        <div className="ld-container">
          <div className="ld-section-head ld-reveal" data-reveal="section">
            <span className="ld-section-eyebrow">{dict.landingTrustEyebrow}</span>
            <h2 className="ld-section-title">{dict.landingTrustTitle}</h2>
            <p className="ld-section-desc">{dict.landingTrustSubtitle}</p>
          </div>

          {/* Live Browser Storage Meter */}
          <div className="ld-storage-banner ld-reveal" data-reveal="storage">
            <div className="ld-storage-banner-head">
              <div className="ld-storage-title-wrap">
                <span className="ld-storage-icon-badge">
                  <HardDrive size={18} />
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
          </div>

          <div className="ld-trust-grid">
            <div className="ld-trust-card ld-reveal" data-reveal="card" style={{ '--rd': '0ms' } as React.CSSProperties}>
              <Lock size={20} />
              <h3>{dict.landingTrustCard1Title}</h3>
              <p>{dict.landingTrustCard1Desc}</p>
            </div>
            <div className="ld-trust-card ld-reveal" data-reveal="card" style={{ '--rd': '90ms' } as React.CSSProperties}>
              <WifiOff size={20} />
              <h3>{dict.landingTrustCard2Title}</h3>
              <p>{dict.landingTrustCard2Desc}</p>
            </div>
            <div className="ld-trust-card ld-reveal" data-reveal="card" style={{ '--rd': '180ms' } as React.CSSProperties}>
              <FileArchive size={20} />
              <h3>{dict.landingTrustCard3Title}</h3>
              <p>{dict.landingTrustCard3Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA Band */}
      <section className="ld-closing">
        <div className="ld-container ld-closing-inner ld-reveal" data-reveal="section">
          <h2>{dict.landingClosingTitle}</h2>
          <p>{dict.landingClosingSubtitle}</p>
          <div className="ld-hero-ctas">
            <button type="button" className="ld-btn ld-btn--primary ld-btn--lg" onClick={handlePrimaryCta}>
              <span>{primaryCtaLabel}</span>
              <ArrowRight size={17} />
            </button>
            <a
              href={`${BASE}downloads/mosa-clipper.zip`}
              download="mosa-clipper.zip"
              className="ld-btn ld-btn--glass ld-btn--lg"
            >
              <Download size={16} />
              <span>{dict.clipperDownloadBtn}</span>
            </a>
          </div>
        </div>
      </section>

      <footer className="ld-footer">
        <div className="ld-container ld-footer-inner">
          <div className="ld-footer-brand">
            <img src={`${BASE}brand/logo.svg`} alt="Mosa" width={18} height={18} />
            <span>{dict.landingFooterNote}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
