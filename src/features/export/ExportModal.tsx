import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Globe,
  ImagePlus,
  Loader2,
  Printer,
  Trash2,
} from 'lucide-react';
import type { ExportPngOptions, Project, StudioProfile } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';
import { AppleSelect } from '../../components/AppleSelect';
import {
  buildSourcesManifest,
  exportFfeScheduleCsv,
  precheckExport,
  renderMoodboardPng,
  slugifyFileName,
  triggerBlobDownload,
  type ExportPrecheck,
} from './exportPng';
import { exportFfePdf } from './exportPdf';
import { computeFfeBudget, formatCurrency } from './ffeBudget';
import { exportClientInteractiveHtml } from './exportClientHtml';

interface ExportModalProps {
  open: boolean;
  project: Project;
  selectedIds: string[];
  studioProfile?: StudioProfile;
  dict: I18nDict;
  onClose: () => void;
  onChangeStudioProfile: (next: StudioProfile) => void;
  onExported: (message: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  project,
  selectedIds,
  studioProfile,
  dict,
  onClose,
  onChangeStudioProfile,
  onExported,
}) => {
  const [options, setOptions] = useState<ExportPngOptions>({
    scope: 'all',
    scale: 2,
    includeBackground: true,
    includeSourcesJson: true,
  });
  const [precheck, setPrecheck] = useState<ExportPrecheck | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [missingPrompt, setMissingPrompt] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);

  const profile: StudioProfile = studioProfile ?? {};

  useEffect(() => {
    if (!open) {
      setError('');
      setMissingPrompt(false);
      return;
    }
    let alive = true;
    precheckExport(project, selectedIds, options).then((res) => {
      if (alive) setPrecheck(res);
    });
    return () => {
      alive = false;
    };
  }, [open, options, project, selectedIds]);

  const budgetSummary = useMemo(() => {
    if (!precheck) return null;
    return computeFfeBudget(precheck.cards, profile);
  }, [precheck, profile]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo tối đa 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChangeStudioProfile({ ...profile, studioLogoDataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const executeExport = async (allowPlaceholders: boolean) => {
    if (!precheck || precheck.cards.length === 0 || precheck.tooLarge) return;
    if (precheck.missingImageCards.length > 0 && !allowPlaceholders) {
      setMissingPrompt(true);
      return;
    }
    setExporting(true);
    setError('');
    try {
      const slug = slugifyFileName(project.name);
      const pngBlob = await renderMoodboardPng(project, precheck.cards, options);
      triggerBlobDownload(pngBlob, `${slug}.png`);

      if (options.includeSourcesJson) {
        const manifest = buildSourcesManifest(project, precheck.cards);
        const jsonBlob = new Blob([JSON.stringify(manifest, null, 2)], {
          type: 'application/json',
        });
        triggerBlobDownload(jsonBlob, `${slug}-sources.json`);
      }

      onExported(dict.exportSuccess);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.exportError);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!precheck || precheck.cards.length === 0) return;
    setExporting(true);
    setError('');
    try {
      await exportFfePdf(project, precheck.cards, dict, profile);
      onExported(dict.exportPdfSuccess);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.exportError);
    } finally {
      setExporting(false);
    }
  };

  const handleExportClientHtml = async () => {
    if (!precheck || precheck.cards.length === 0) return;
    setExporting(true);
    setError('');
    try {
      await exportClientInteractiveHtml(project, precheck.cards, dict, profile);
      onExported(dict.exportClientHtmlSuccess);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.exportError);
    } finally {
      setExporting(false);
    }
  };

  const isEmpty = !precheck || precheck.cards.length === 0;
  const disabled = exporting || isEmpty || Boolean(precheck?.tooLarge);

  return (
    <DialogShell
      open={open}
      title={dict.exportTitle}
      width={484}
      closeLabel={dict.close}
      onClose={onClose}
      footer={
        missingPrompt ? (
          <>
            <button
              type="button"
              className="btn btn-subtle"
              onClick={() => {
                setMissingPrompt(false);
                onClose();
              }}
            >
              {dict.exportBackToFix}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={exporting}
              onClick={() => void executeExport(true)}
            >
              {dict.exportWithPlaceholder}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-subtle" onClick={onClose}>
              {dict.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => void executeExport(false)}
            >
              {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              <span>{dict.exportPng}</span>
            </button>
          </>
        )
      }
    >
      <div className="form-stack">
        <div className="field">
          <div className="seg-control">
            <button
              type="button"
              className={`seg-btn ${options.scope === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                setMissingPrompt(false);
                setOptions((o) => ({ ...o, scope: 'all' }));
              }}
            >
              {dict.exportScopeAll}
            </button>
            <button
              type="button"
              className={`seg-btn ${options.scope === 'selection' ? 'is-active' : ''}`}
              disabled={selectedIds.length === 0}
              onClick={() => {
                setMissingPrompt(false);
                setOptions((o) => ({ ...o, scope: 'selection' }));
              }}
            >
              {dict.exportScopeSelection} ({selectedIds.length})
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">{dict.exportScale}</span>
          <div className="seg-control">
            <button
              type="button"
              className={`seg-btn ${options.scale === 1 ? 'is-active' : ''}`}
              onClick={() => setOptions((o) => ({ ...o, scale: 1 }))}
            >
              1×
            </button>
            <button
              type="button"
              className={`seg-btn ${options.scale === 2 ? 'is-active' : ''}`}
              onClick={() => setOptions((o) => ({ ...o, scale: 2 }))}
            >
              {dict.exportScale2x}
            </button>
          </div>
        </div>

        <label className="toggle-row">
          <span>{dict.exportKeepBg}</span>
          <input
            type="checkbox"
            checked={options.includeBackground}
            onChange={(e) => setOptions((o) => ({ ...o, includeBackground: e.target.checked }))}
          />
        </label>

        <label className="toggle-row">
          <span>{dict.exportIncludeSources}</span>
          <input
            type="checkbox"
            checked={options.includeSourcesJson}
            onChange={(e) => setOptions((o) => ({ ...o, includeSourcesJson: e.target.checked }))}
          />
        </label>

        {/* Collapsible White-Label Studio Branding */}
        <div className="inspector-disclosure">
          <button
            type="button"
            className="inspector-disclosure-btn"
            aria-expanded={brandOpen}
            onClick={() => setBrandOpen((v) => !v)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Building2 size={14} />
              <span>{dict.studioBrandSection}</span>
            </span>
            <ChevronDown
              size={14}
              className={`disclosure-chevron ${brandOpen ? 'is-open' : ''}`}
            />
          </button>

          {brandOpen && (
            <div className="inspector-disclosure-body">
              <div className="studio-logo-row">
                {profile.studioLogoDataUrl ? (
                  <>
                    <img src={profile.studioLogoDataUrl} alt="" className="studio-logo-preview" />
                    <button
                      type="button"
                      className="btn-xs btn-subtle"
                      onClick={() =>
                        onChangeStudioProfile({ ...profile, studioLogoDataUrl: undefined })
                      }
                    >
                      <Trash2 size={12} />
                      <span>{dict.studioLogoRemove}</span>
                    </button>
                  </>
                ) : (
                  <label className="btn-xs btn-subtle file-label-btn">
                    <ImagePlus size={13} />
                    <span>{dict.studioLogoUpload}</span>
                    <input
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      hidden
                      onChange={handleLogoUpload}
                    />
                  </label>
                )}
              </div>

              <div className="ffe-price-qty-row">
                <label className="field flex-1">
                  <span className="field-label">{dict.studioNameLabel}</span>
                  <input
                    className="input-sm"
                    placeholder={dict.studioNamePlaceholder}
                    value={profile.studioName ?? ''}
                    onChange={(e) =>
                      onChangeStudioProfile({ ...profile, studioName: e.target.value })
                    }
                  />
                </label>
                <div className="field" style={{ width: 108, flexShrink: 0 }}>
                  <span className="field-label">{dict.studioCurrencyLabel}</span>
                  <AppleSelect<'VND' | 'USD'>
                    ariaLabel={dict.studioCurrencyLabel}
                    value={profile.currency ?? 'VND'}
                    options={[
                      { value: 'VND', label: 'VND (₫)' },
                      { value: 'USD', label: 'USD ($)' },
                    ]}
                    onChange={(currency) => onChangeStudioProfile({ ...profile, currency })}
                  />
                </div>
              </div>

              <label className="field">
                <span className="field-label">{dict.studioContactLabel}</span>
                <input
                  className="input-sm"
                  placeholder={dict.studioContactPlaceholder}
                  value={profile.studioContact ?? ''}
                  onChange={(e) =>
                    onChangeStudioProfile({ ...profile, studioContact: e.target.value })
                  }
                />
              </label>
            </div>
          )}
        </div>

        {precheck && !isEmpty && (
          <>
            <div className="export-meta-bar">
              <span>{dict.exportCardCount(precheck.cards.length)}</span>
              {budgetSummary && budgetSummary.pricedCount > 0 ? (
                <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  {formatCurrency(budgetSummary.grandTotal, budgetSummary.currency)}
                </span>
              ) : (
                <span className="mono">
                  {precheck.widthPx.toLocaleString()} × {precheck.heightPx.toLocaleString()} px
                </span>
              )}
            </div>

            <div className="inspector-btn-row">
              <button
                type="button"
                className="btn-xs btn-subtle flex-1"
                disabled={exporting}
                onClick={() => {
                  exportFfeScheduleCsv(project, precheck.cards, dict, profile);
                  onExported(dict.exportFfeSuccess);
                }}
              >
                <FileSpreadsheet size={13} />
                <span>{dict.exportFfeCsv}</span>
              </button>
              <button
                type="button"
                className="btn-xs btn-subtle flex-1"
                disabled={exporting}
                onClick={() => void handleExportPdf()}
              >
                {exporting ? <Loader2 size={13} className="spin" /> : <Printer size={13} />}
                <span>{dict.exportFfePrint}</span>
              </button>
            </div>

            <button
              type="button"
              className="btn btn-subtle full-width"
              disabled={exporting}
              title={dict.exportClientHtmlHint}
              onClick={() => void handleExportClientHtml()}
            >
              <Globe size={15} />
              <span>{dict.exportClientHtmlBtn}</span>
            </button>
          </>
        )}

        {isEmpty && <div className="alert-box">{dict.exportEmptyReason}</div>}

        {precheck?.tooLarge && (
          <div className="alert-box alert-box--danger">
            <AlertTriangle size={16} />
            <span>{dict.exportTooLarge}</span>
          </div>
        )}

        {missingPrompt && precheck && precheck.missingImageCards.length > 0 && (
          <div className="alert-box alert-box--warn">
            <AlertTriangle size={16} />
            <div>
              <strong>{dict.exportMissingTitle}</strong>
              <ul className="compact-list">
                {precheck.missingImageCards.map((c) => (
                  <li key={c.id}>{c.title || c.id}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {error && <div className="alert-box alert-box--danger">{error}</div>}
      </div>
    </DialogShell>
  );
};
