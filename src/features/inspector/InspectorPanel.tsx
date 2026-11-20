import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Inbox,
  Lock,
  Maximize2,
  Palette,
  RefreshCw,
  Trash2,
  Ungroup,
  Unlock,
  X,
} from 'lucide-react';
import { CATEGORY_ORDER, type Card, type Category } from '../../domain/types';
import { isValidHttpUrl, normalizeHex } from '../../domain/validate';
import { getCategoryLabel, type I18nDict } from '../../i18n';

interface InspectorPanelProps {
  card: Card;
  dict: I18nDict;
  onClose: () => void;
  onChangeCard: (cardId: string, patch: Partial<Card>, recordUndo?: boolean) => void;
  onOpenLightbox: (card: Card) => void;
  onTriggerReplaceImage: (card: Card) => void;
  onExtractPalette: (card: Card) => void;
  onDuplicate: (cardId: string) => void;
  onMoveToInbox: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onUngroupFrame: (frameId: string) => void;
}

const NOTE_SWATCHES = ['#FAF7EE', '#F3F6EF', '#F6EFEA', '#EFF3F6', '#2B312C'];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  card,
  dict,
  onClose,
  onChangeCard,
  onOpenLightbox,
  onTriggerReplaceImage,
  onExtractPalette,
  onDuplicate,
  onMoveToInbox,
  onDelete,
  onUngroupFrame,
}) => {
  const [pageUrlInput, setPageUrlInput] = useState(card.source?.pageUrl ?? '');
  const [urlError, setUrlError] = useState('');
  const [hexInput, setHexInput] = useState(card.color ?? '#8D9A7C');
  const [hexError, setHexError] = useState('');
  const [copiedHex, setCopiedHex] = useState(false);

  useEffect(() => {
    setPageUrlInput(card.source?.pageUrl ?? '');
    setUrlError('');
    setHexInput(card.color ?? '#8D9A7C');
    setHexError('');
  }, [card.id, card.source?.pageUrl, card.color]);

  const commitPageUrl = () => {
    const trimmed = pageUrlInput.trim();
    if (!trimmed) {
      setUrlError('');
      onChangeCard(
        card.id,
        {
          source: {
            ...(card.source ?? { method: 'manual', capturedAt: new Date().toISOString() }),
            pageUrl: undefined,
          },
        },
        true
      );
      return;
    }
    if (!isValidHttpUrl(trimmed)) {
      setUrlError(dict.invalidUrl);
      return;
    }
    setUrlError('');
    onChangeCard(
      card.id,
      {
        source: {
          ...(card.source ?? { method: 'manual', capturedAt: new Date().toISOString() }),
          pageUrl: trimmed,
        },
      },
      true
    );
  };

  const commitHex = (raw: string) => {
    setHexInput(raw);
    const norm = normalizeHex(raw);
    if (!norm) {
      setHexError(dict.invalidHex);
      return;
    }
    setHexError('');
    onChangeCard(card.id, { color: norm }, true);
  };

  const handleCopyHex = () => {
    const hex = (card.color || '#8D9A7C').toUpperCase();
    navigator.clipboard?.writeText(hex).catch(() => undefined);
    setCopiedHex(true);
    setTimeout(() => setCopiedHex(false), 1400);
  };

  const hasWebSource = Boolean(card.source?.pageUrl);
  const hasDirectImageUrl = Boolean(card.source?.imageUrl);

  return (
    <aside className="floating-panel inspector-panel" aria-label={dict.properties}>
      <div className="panel-header">
        <span className="panel-title">{dict.properties}</span>
        <button type="button" className="icon-btn-sm" title={dict.close} onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="panel-body">
        {/* Common: Title */}
        <label className="field">
          <span className="field-label">{dict.titleLabel}</span>
          <input
            className="input-sm"
            value={card.title}
            onChange={(e) => onChangeCard(card.id, { title: e.target.value }, false)}
            onBlur={() => onChangeCard(card.id, { title: card.title }, true)}
          />
        </label>

        {/* Common: Category (not needed on frame) */}
        {card.kind !== 'frame' && (
          <label className="field">
            <span className="field-label">{dict.categoryLabel}</span>
            <select
              className="input-sm"
              value={card.category}
              onChange={(e) =>
                onChangeCard(card.id, { category: e.target.value as Category }, true)
              }
            >
              {CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {getCategoryLabel(dict, cat)}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Color-specific fields */}
        {card.kind === 'color' && (
          <div className="field">
            <span className="field-label">{dict.hexLabel}</span>
            <div className="hex-input-row">
              <input
                type="color"
                className="color-picker-native"
                value={normalizeHex(hexInput) ?? '#8D9A7C'}
                onChange={(e) => commitHex(e.target.value)}
              />
              <input
                className="input-sm mono"
                value={hexInput}
                onChange={(e) => commitHex(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn-sm"
                title={dict.copyHex}
                onClick={handleCopyHex}
              >
                {copiedHex ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            {hexError && <span className="field-error">{hexError}</span>}
          </div>
        )}

        {/* Note background */}
        {card.kind === 'note' && (
          <div className="field">
            <span className="field-label">{dict.noteBgLabel}</span>
            <div className="swatch-row">
              {NOTE_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`swatch-dot ${(card.color || '#FAF7EE').toUpperCase() === hex ? 'is-active' : ''}`}
                  style={{ backgroundColor: hex }}
                  onClick={() => onChangeCard(card.id, { color: hex }, true)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Caption / Notes */}
        {card.kind !== 'frame' && (
          <label className="field">
            <span className="field-label">{dict.captionLabel}</span>
            <textarea
              className="textarea-sm"
              rows={3}
              value={card.text}
              onChange={(e) => onChangeCard(card.id, { text: e.target.value }, false)}
            />
          </label>
        )}

        {/* Image quick actions */}
        {card.kind === 'image' && (
          <div className="inspector-action-stack">
            <div className="inspector-btn-row">
              <button
                type="button"
                className="btn-xs btn-subtle flex-1"
                onClick={() => onOpenLightbox(card)}
                disabled={!card.assetId}
              >
                <Maximize2 size={13} />
                <span>{dict.viewLarge}</span>
              </button>
              <button
                type="button"
                className="btn-xs btn-subtle flex-1"
                onClick={() => onTriggerReplaceImage(card)}
              >
                <RefreshCw size={13} />
                <span>{dict.replaceImage}</span>
              </button>
            </div>
            {card.assetId && (
              <button
                type="button"
                className="btn-xs btn-subtle full-width"
                onClick={() => onExtractPalette(card)}
              >
                <Palette size={13} />
                <span>{dict.extractPalette}</span>
              </button>
            )}
          </div>
        )}

        {/* Design File metadata */}
        {card.kind === 'file' && (
          <div className="inspector-info-box">
            <div className="info-row">
              <span>{dict.fileFormatLabel}</span>
              <strong>.{(card.designFile?.extension || 'file').toUpperCase()}</strong>
            </div>
            {card.designFile?.size ? (
              <div className="info-row">
                <span>{dict.fileSizeLabel}</span>
                <strong>{(card.designFile.size / (1024 * 1024)).toFixed(2)} MB</strong>
              </div>
            ) : null}
            <p className="field-hint">{dict.desktopHintFile}</p>
          </div>
        )}

        {/* Frame ungroup */}
        {card.kind === 'frame' && (
          <button
            type="button"
            className="btn-xs btn-subtle full-width"
            onClick={() => onUngroupFrame(card.id)}
          >
            <Ungroup size={13} />
            <span>{dict.ungroupCards}</span>
          </button>
        )}

        {/* Source panel (Section 5: separate pageUrl & imageUrl!) */}
        {card.kind !== 'frame' && card.kind !== 'color' && (
          <div className="inspector-section">
            <div className="inspector-section-head">
              <span>{dict.sourceSection}</span>
              {!hasWebSource && hasDirectImageUrl && (
                <span className="warn-badge">{dict.noWebSource}</span>
              )}
            </div>

            {card.source?.fileName && (
              <div className="source-meta-line">
                <span className="field-label">{dict.fileNameLabel}:</span>
                <span className="truncate mono">{card.source.fileName}</span>
              </div>
            )}

            <label className="field">
              <span className="field-label">{dict.pageUrlLabel}</span>
              <input
                className="input-sm"
                type="url"
                placeholder={dict.pageUrlPlaceholder}
                value={pageUrlInput}
                onChange={(e) => {
                  setPageUrlInput(e.target.value);
                  if (urlError) setUrlError('');
                }}
                onBlur={commitPageUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPageUrl();
                  }
                }}
              />
              {urlError && <span className="field-error">{urlError}</span>}
            </label>

            {hasDirectImageUrl && (
              <div className="source-meta-line">
                <span className="field-label">{dict.imageUrlLabel}:</span>
                <span className="truncate mono" title={card.source?.imageUrl}>
                  {card.source?.imageUrl}
                </span>
              </div>
            )}

            <div className="inspector-btn-row">
              {hasWebSource && (
                <button
                  type="button"
                  className="btn-xs btn-primary flex-1"
                  onClick={() =>
                    window.open(card.source!.pageUrl!, '_blank', 'noopener,noreferrer')
                  }
                >
                  <ExternalLink size={12} />
                  <span>{dict.openSource}</span>
                </button>
              )}
              {hasDirectImageUrl && (
                <button
                  type="button"
                  className="btn-xs btn-subtle flex-1"
                  onClick={() =>
                    window.open(card.source!.imageUrl!, '_blank', 'noopener,noreferrer')
                  }
                >
                  <ExternalLink size={12} />
                  <span>{dict.openImageUrl}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer card actions */}
        <div className="inspector-section inspector-footer-actions">
          <button
            type="button"
            className="btn-xs btn-subtle flex-1"
            onClick={() => onChangeCard(card.id, { locked: !card.locked }, true)}
          >
            {card.locked ? <Unlock size={13} /> : <Lock size={13} />}
            <span>{card.locked ? dict.unlockCard : dict.lockCard}</span>
          </button>
          <button
            type="button"
            className="btn-xs btn-subtle"
            title={dict.duplicate}
            onClick={() => onDuplicate(card.id)}
          >
            <Copy size={13} />
          </button>
          {card.kind !== 'frame' && (
            <button
              type="button"
              className="btn-xs btn-subtle"
              title={dict.moveToInbox}
              onClick={() => onMoveToInbox(card.id)}
            >
              <Inbox size={13} />
            </button>
          )}
          <button
            type="button"
            className="btn-xs btn-danger-subtle"
            title={dict.deleteToTrash}
            onClick={() => onDelete(card.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
};
