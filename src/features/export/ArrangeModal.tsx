import React, { useEffect, useState } from 'react';
import { Eye, Grid, Layers, LayoutDashboard, PanelsTopLeft } from 'lucide-react';
import type { ArrangeMode, ArrangeOptions } from '../../domain/types';
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
    mode: 'bento',
    groupByCategory: true,
    overlap: 55,
    galleryFrame: true,
  });
  const [previewActive, setPreviewActive] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreviewActive(false);
    }
  }, [open]);

  const updateOptions = (patch: Partial<ArrangeOptions>, autoPreview = false) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (previewActive || autoPreview) {
      setPreviewActive(true);
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

  const archetypes: Array<{
    mode: ArrangeMode;
    title: string;
    desc: string;
    icon: React.ReactNode;
  }> = [
    {
      mode: 'bento',
      title: dict.arrangeBento,
      desc: dict.arrangeBentoDesc,
      icon: <PanelsTopLeft size={16} />,
    },
    {
      mode: 'freeform',
      title: dict.arrangeFreeform,
      desc: dict.arrangeFreeformDesc,
      icon: <Layers size={16} />,
    },
    {
      mode: 'zones',
      title: dict.arrangeZones,
      desc: dict.arrangeZonesDesc,
      icon: <LayoutDashboard size={16} />,
    },
    {
      mode: 'grid',
      title: dict.arrangeGrid,
      desc: dict.arrangeGridDesc,
      icon: <Grid size={16} />,
    },
  ];

  const overlapHint =
    options.overlap < 25
      ? dict.arrangeOverlapHintLow
      : options.overlap < 70
        ? dict.arrangeOverlapHintMid
        : dict.arrangeOverlapHintHigh;

  return (
    <DialogShell
      open={open}
      title={dict.arrangeTitle}
      width={460}
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

        <div className="archetype-grid">
          {archetypes.map((a) => {
            const active = options.mode === a.mode;
            return (
              <button
                key={a.mode}
                type="button"
                className={`archetype-card ${active ? 'is-active' : ''}`}
                onClick={() => updateOptions({ mode: a.mode })}
              >
                <div className="archetype-card-head">
                  {a.icon}
                  <span>{a.title}</span>
                </div>
                <p className="archetype-card-desc">{a.desc}</p>
              </button>
            );
          })}
        </div>

        <label className="toggle-row">
          <span>{dict.arrangeGroupByCat}</span>
          <input
            type="checkbox"
            checked={options.groupByCategory}
            onChange={(e) => updateOptions({ groupByCategory: e.target.checked })}
          />
        </label>

        {options.mode !== 'grid' && (
          <>
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
              <span className="field-hint">{overlapHint}</span>
            </div>

            <label className="toggle-row">
              <span>{dict.arrangeGalleryFrame}</span>
              <input
                type="checkbox"
                checked={options.galleryFrame ?? true}
                onChange={(e) => updateOptions({ galleryFrame: e.target.checked })}
              />
            </label>
          </>
        )}

        {previewActive && (
          <div className="alert-box alert-box--accent">{dict.previewingHint}</div>
        )}
      </div>
    </DialogShell>
  );
};
