import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import type { ExportPngOptions, Project } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';
import {
  buildSourcesManifest,
  precheckExport,
  renderMoodboardPng,
  slugifyFileName,
  triggerBlobDownload,
  type ExportPrecheck,
} from './exportPng';

interface ExportModalProps {
  open: boolean;
  project: Project;
  selectedIds: string[];
  dict: I18nDict;
  onClose: () => void;
  onExported: (message: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  project,
  selectedIds,
  dict,
  onClose,
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
      setError(err instanceof Error ? err.message : 'Lỗi khi xuất PNG.');
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
      width={460}
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
              2× (Sắc nét)
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

        {precheck && !isEmpty && (
          <div className="export-meta-bar">
            <span>{precheck.cards.length} card</span>
            <span className="mono">
              {precheck.widthPx.toLocaleString()} × {precheck.heightPx.toLocaleString()} px
            </span>
          </div>
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
