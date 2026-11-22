import React, { useEffect, useRef, useState } from 'react';
import { FolderSync, Settings } from 'lucide-react';
import type { NavigationMode, ProjectAppearance } from '../../domain/types';
import { DEFAULT_DARK_BG, DEFAULT_LIGHT_BG } from '../../domain/project';
import { normalizeHex } from '../../domain/validate';
import type { I18nDict, Language } from '../../i18n';

interface SettingsPopoverProps {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  appearance: ProjectAppearance;
  language: Language;
  navigationMode: NavigationMode;
  syncFolderName?: string | null;
  dict: I18nDict;
  onChangeAppearance: (next: ProjectAppearance) => void;
  onChangeLanguage: (lang: Language) => void;
  onChangeNavigationMode: (mode: NavigationMode) => void;
  onOpenStorageHub: () => void;
}

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  open,
  onOpenChange,
  appearance,
  language,
  navigationMode,
  syncFolderName,
  dict,
  onChangeAppearance,
  onChangeLanguage,
  onChangeNavigationMode,
  onOpenStorageHub,
}) => {
  const [hexValue, setHexValue] = useState(appearance.background);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHexValue(appearance.background);
  }, [appearance.background]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const applyHex = (raw: string) => {
    setHexValue(raw);
    const norm = normalizeHex(raw);
    if (norm) {
      onChangeAppearance({ ...appearance, background: norm });
    }
  };

  return (
    <div ref={ref} className="popover-anchor">
      <button
        type="button"
        className={`icon-btn ${open ? 'is-active' : ''}`}
        title={dict.settings}
        aria-label={dict.settings}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Settings size={17} />
      </button>

      {open && (
        <div className="popover-panel popover-panel--right settings-popover">
          <div className="popover-section-label">{dict.appearanceTitle}</div>

          <div className="preset-grid">
            <button
              type="button"
              className={`preset-btn ${appearance.background.toUpperCase() === DEFAULT_LIGHT_BG ? 'is-active' : ''}`}
              onClick={() => onChangeAppearance({ ...appearance, background: DEFAULT_LIGHT_BG })}
            >
              <span className="preset-swatch" style={{ background: DEFAULT_LIGHT_BG }} />
              <span>{dict.bgPresetLight}</span>
            </button>
            <button
              type="button"
              className={`preset-btn ${appearance.background.toUpperCase() === DEFAULT_DARK_BG ? 'is-active' : ''}`}
              onClick={() => onChangeAppearance({ ...appearance, background: DEFAULT_DARK_BG })}
            >
              <span className="preset-swatch" style={{ background: DEFAULT_DARK_BG }} />
              <span>{dict.bgPresetDark}</span>
            </button>
          </div>

          <label className="field">
            <span className="field-label">{dict.bgCustomHex}</span>
            <div className="hex-input-row">
              <input
                type="color"
                className="color-picker-native"
                value={normalizeHex(hexValue) ?? DEFAULT_LIGHT_BG}
                onChange={(e) => applyHex(e.target.value)}
              />
              <input
                className="input-sm mono"
                value={hexValue}
                onChange={(e) => applyHex(e.target.value)}
              />
            </div>
          </label>

          <label className="toggle-row">
            <span>{dict.dotGrid}</span>
            <input
              type="checkbox"
              checked={appearance.dots}
              onChange={(e) => onChangeAppearance({ ...appearance, dots: e.target.checked })}
            />
          </label>

          <label className="toggle-row">
            <span>{dict.grayscaleMode}</span>
            <input
              type="checkbox"
              checked={Boolean(appearance.grayscale)}
              onChange={(e) => onChangeAppearance({ ...appearance, grayscale: e.target.checked })}
            />
          </label>

          <div className="popover-divider" />

          <div className="field">
            <span className="field-label">{dict.navModeLabel}</span>
            <div className="seg-control">
              <button
                type="button"
                className={`seg-btn ${navigationMode === 'auto' ? 'is-active' : ''}`}
                onClick={() => onChangeNavigationMode('auto')}
              >
                {dict.navModeAuto}
              </button>
              <button
                type="button"
                className={`seg-btn ${navigationMode === 'trackpad' ? 'is-active' : ''}`}
                onClick={() => onChangeNavigationMode('trackpad')}
              >
                {dict.navModeTrackpad}
              </button>
              <button
                type="button"
                className={`seg-btn ${navigationMode === 'mouse' ? 'is-active' : ''}`}
                onClick={() => onChangeNavigationMode('mouse')}
              >
                {dict.navModeMouse}
              </button>
            </div>
            <span className="muted-caption">{dict.navModeHint}</span>
          </div>

          <div className="popover-divider" />

          <div className="field">
            <span className="field-label">{dict.languageLabel}</span>
            <div className="seg-control">
              <button
                type="button"
                className={`seg-btn ${language === 'vi' ? 'is-active' : ''}`}
                onClick={() => onChangeLanguage('vi')}
              >
                Tiếng Việt
              </button>
              <button
                type="button"
                className={`seg-btn ${language === 'en' ? 'is-active' : ''}`}
                onClick={() => onChangeLanguage('en')}
              >
                English
              </button>
            </div>
          </div>

          <div className="popover-divider" />

          <button
            type="button"
            className="popover-action-btn"
            onClick={() => {
              onOpenChange(false);
              onOpenStorageHub();
            }}
          >
            <FolderSync size={15} />
            <span className="truncate">
              {syncFolderName
                ? dict.folderSyncConnected(syncFolderName)
                : dict.storageHubTitle}
            </span>
          </button>

          <p className="field-hint">{dict.storageNote}</p>
        </div>
      )}
    </div>
  );
};
