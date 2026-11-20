import React, { useEffect, useState } from 'react';
import { Eye, LayoutGrid, Layers } from 'lucide-react';
import type { ArrangeOptions } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';

interface ArrangeModalProps {
  open: boolean;
  selectedCount: number;
  dict: I18nDict;
  onPreview: (opts: ArrangeOptions) => void;
  onClearPreview: () => void;
  onApply: (opts: ArrangeOptions) => void;
  onClose: () => void;
}

export const ArrangeModal: React.FC<ArrangeModalProps> = ({
  open,
  selectedCount,
  dict,
  onPreview,
  onClearPreview,
  onApply,
  onClose,
}) => {
  const [options, setOptions] = useState<ArrangeOptions>({
    mode: 'freeform',
    groupByCategory: true,
    overlap: 35,
  });
  const [previewActive, setPreviewActive] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreviewActive(false);
    }
  }, [open]);

  const updateOptions = (patch: Partial<ArrangeOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (previewActive) {
      onPreview(next);
    }
  };

  const handleCancel = () => {
    onClearPreview();
    setPreviewActive(false);
    onClose();
  };

  const handlePreviewClick = () => {
    setPreviewActive(true);
    onPreview(options);
  };

  const handleApplyClick = () => {
    onApply(options);
    setPreviewActive(false);
    onClose();
  };

  return (
    <DialogShell
      open={open}
      title={dict.arrangeTitle}
      width={400}
      closeLabel={dict.close}
      onClose={handleCancel}
      nonBlocking={previewActive}
      footer={
        <>
          <button type="button" className="btn btn-subtle" onClick={handleCancel}>
            {dict.cancel}
          </button>
          <button type="button" className="btn btn-subtle" onClick={handlePreviewClick}>
            <Eye size={15} />
            <span>{dict.preview}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApplyClick}>
            {dict.apply}
          </button>
        </>
      }
    >
      <div className="arrange-form">
        <p className="field-hint">
          {selectedCount > 0 ? dict.arrangeScopeSelection(selectedCount) : dict.arrangeScopeAll}
        </p>

        <div className="seg-control">
          <button
            type="button"
            className={`seg-btn ${options.mode === 'freeform' ? 'is-active' : ''}`}
            onClick={() => updateOptions({ mode: 'freeform' })}
          >
            <Layers size={14} />
            <span>{dict.arrangeFreeform}</span>
          </button>
          <button
            type="button"
            className={`seg-btn ${options.mode === 'grid' ? 'is-active' : ''}`}
            onClick={() => updateOptions({ mode: 'grid' })}
          >
            <LayoutGrid size={14} />
            <span>{dict.arrangeGrid}</span>
          </button>
        </div>

        <label className="toggle-row">
          <span>{dict.arrangeGroupByCat}</span>
          <input
            type="checkbox"
            checked={options.groupByCategory}
            onChange={(e) => updateOptions({ groupByCategory: e.target.checked })}
          />
        </label>

        {options.mode === 'freeform' && (
          <div className="field">
            <div className="field-row-between">
              <span className="field-label">{dict.arrangeOverlap}</span>
              <span className="mono">{options.overlap}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={options.overlap}
              onChange={(e) => updateOptions({ overlap: Number(e.target.value) })}
            />
          </div>
        )}

        {previewActive && (
          <div className="alert-box alert-box--accent">{dict.previewingHint}</div>
        )}
      </div>
    </DialogShell>
  );
};
