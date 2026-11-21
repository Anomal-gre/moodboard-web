import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HardDrive,
  Home,
  Layers,
  LayoutGrid,
  Palette,
  Sparkles,
  X,
} from 'lucide-react';
import type { UserDiscipline } from '../../domain/types';
import type { ProjectTemplateId } from '../../domain/templates';
import type { I18nDict } from '../../i18n';
import { getStorageHealth } from '../../storage/storageHealth';
import './landing.css';

export interface OnboardingResult {
  discipline: UserDiscipline;
  templateId: ProjectTemplateId;
  theme: 'light' | 'dark';
  projectName: string;
}

interface OnboardingModalProps {
  open: boolean;
  dict: I18nDict;
  language: 'vi' | 'en';
  onSkip: () => void;
  onComplete: (result: OnboardingResult) => void;
}

const BASE = import.meta.env.BASE_URL || './';

const DISCIPLINE_TO_TEMPLATE: Record<UserDiscipline, ProjectTemplateId> = {
  interior: 'wabi-sabi',
  ffe: 'ffe-materials',
  branding: 'brand-bento',
  freeform: 'blank',
};

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  open,
  dict,
  language,
  onSkip,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [discipline, setDiscipline] = useState<UserDiscipline>('interior');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [projectName, setProjectName] = useState('');
  const [freeGb, setFreeGb] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    let alive = true;
    getStorageHealth()
      .then((report) => {
        if (!alive) return;
        if (report.browserQuotaBytes && report.browserQuotaBytes > 0) {
          const freeBytes = Math.max(0, report.browserQuotaBytes - (report.browserUsageBytes ?? 0));
          const gb = freeBytes / (1024 * 1024 * 1024);
          setFreeGb(gb >= 10 ? gb.toFixed(0) : gb.toFixed(1));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const defaultNameForDiscipline = (d: UserDiscipline): string => {
    const isVi = language === 'vi';
    switch (d) {
      case 'interior':
        return isVi ? 'Không gian sống · 01' : 'Living Space · 01';
      case 'ffe':
        return isVi ? 'Bảng Vật liệu & FF&E · 01' : 'Materials & FF&E · 01';
      case 'branding':
        return isVi ? 'Concept Thương hiệu · 01' : 'Brand Direction · 01';
      case 'freeform':
      default:
        return isVi ? 'Moodboard mới · 01' : 'Untitled Board · 01';
    }
  };

  useEffect(() => {
    setProjectName(defaultNameForDiscipline(discipline));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discipline, language]);

  if (!open) return null;

  const roles: Array<{
    id: UserDiscipline;
    title: string;
    desc: string;
    icon: React.FC<{ size?: number }>;
    accent: string;
    thumb?: string;
  }> = [
    {
      id: 'interior',
      title: dict.onboardRoleInteriorTitle,
      desc: dict.onboardRoleInteriorDesc,
      icon: Home,
      accent: '#007AFF',
      thumb: `${BASE}samples/living-room.jpg`,
    },
    {
      id: 'ffe',
      title: dict.onboardRoleFfeTitle,
      desc: dict.onboardRoleFfeDesc,
      icon: Layers,
      accent: '#8D9A7C',
      thumb: `${BASE}samples/material-texture.jpg`,
    },
    {
      id: 'branding',
      title: dict.onboardRoleBrandingTitle,
      desc: dict.onboardRoleBrandingDesc,
      icon: Palette,
      accent: '#C5A47E',
      thumb: `${BASE}samples/armchair.jpg`,
    },
    {
      id: 'freeform',
      title: dict.onboardRoleFreeformTitle,
      desc: dict.onboardRoleFreeformDesc,
      icon: LayoutGrid,
      accent: '#5856D6',
    },
  ];

  const handleSubmit = () => {
    onComplete({
      discipline,
      templateId: DISCIPLINE_TO_TEMPLATE[discipline],
      theme,
      projectName: projectName.trim() || defaultNameForDiscipline(discipline),
    });
  };

  return (
    <div className="ob-backdrop" role="dialog" aria-modal="true" aria-label={dict.onboardStep1Title}>
      <div className="ob-modal">
        <div className="ob-header">
          <div className="ob-brand-row">
            <img src={`${BASE}brand/logo.svg`} alt="Mosa" width={22} height={22} />
            <span className="ob-brand-word">Mosa</span>
            <span className="ob-step-pill">{dict.onboardStepBadge(step, 2)}</span>
          </div>
          <button type="button" className="ob-skip-btn" onClick={onSkip}>
            <span>{dict.onboardSkip}</span>
            <X size={15} />
          </button>
        </div>

        <div className="ob-progress-track">
          <div className="ob-progress-bar" style={{ width: step === 1 ? '50%' : '100%' }} />
        </div>

        {step === 1 ? (
          <div className="ob-body">
            <h2>{dict.onboardStep1Title}</h2>
            <p className="ob-subtitle">{dict.onboardStep1Desc}</p>

            <div className="ob-role-grid">
              {roles.map((r) => {
                const Icon = r.icon;
                const selected = discipline === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`ob-role-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => setDiscipline(r.id)}
                  >
                    <div className="ob-role-visual">
                      {r.thumb ? (
                        <img src={r.thumb} alt="" />
                      ) : (
                        <div className="ob-role-blank-preview">
                          <LayoutGrid size={22} />
                        </div>
                      )}
                      {selected && (
                        <span className="ob-role-check" aria-hidden="true">
                          <Check size={13} />
                        </span>
                      )}
                    </div>
                    <div className="ob-role-meta">
                      <div className="ob-role-title-row">
                        <span className="ob-role-icon" style={{ color: r.accent }}>
                          <Icon size={15} />
                        </span>
                        <strong>{r.title}</strong>
                      </div>
                      <p>{r.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="ob-body">
            <h2>{dict.onboardStep2Title}</h2>
            <p className="ob-subtitle">{dict.onboardStep2Desc}</p>

            <div className="ob-field">
              <label htmlFor="ob-project-name">{dict.onboardProjectNameLabel}</label>
              <input
                id="ob-project-name"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            </div>

            <div className="ob-field">
              <label>{dict.onboardThemeLabel}</label>
              <div className="ob-theme-grid">
                <button
                  type="button"
                  className={`ob-theme-card ${theme === 'light' ? 'is-selected' : ''}`}
                  onClick={() => setTheme('light')}
                >
                  <div className="ob-theme-swatch ob-theme-swatch--light">
                    <span />
                    <span />
                  </div>
                  <div className="ob-theme-copy">
                    <strong>{dict.onboardThemeLight}</strong>
                    <small>{dict.onboardThemeLightDesc}</small>
                  </div>
                </button>
                <button
                  type="button"
                  className={`ob-theme-card ${theme === 'dark' ? 'is-selected' : ''}`}
                  onClick={() => setTheme('dark')}
                >
                  <div className="ob-theme-swatch ob-theme-swatch--dark">
                    <span />
                    <span />
                  </div>
                  <div className="ob-theme-copy">
                    <strong>{dict.onboardThemeDark}</strong>
                    <small>{dict.onboardThemeDarkDesc}</small>
                  </div>
                </button>
              </div>
            </div>

            <div className="ob-storage-pill">
              <div className="ob-storage-icon">
                <HardDrive size={16} />
              </div>
              <div className="ob-storage-copy">
                <strong>{dict.onboardStorageReadyTitle}</strong>
                <span>
                  {freeGb ? dict.onboardStorageReadyDesc(freeGb) : dict.landingStorageFallback}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="ob-footer">
          {step === 2 ? (
            <button type="button" className="ld-btn ld-btn--ghost" onClick={() => setStep(1)}>
              <ArrowLeft size={15} />
              <span>{dict.onboardBack}</span>
            </button>
          ) : (
            <span className="ob-footer-hint">
              <Sparkles size={13} />
              <span>{dict.landingTrustLine.split('·')[0]}</span>
            </span>
          )}

          {step === 1 ? (
            <button
              type="button"
              className="ld-btn ld-btn--primary"
              onClick={() => setStep(2)}
            >
              <span>{dict.onboardNext}</span>
              <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className="ld-btn ld-btn--primary" onClick={handleSubmit}>
              <span>{dict.onboardLaunch}</span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
