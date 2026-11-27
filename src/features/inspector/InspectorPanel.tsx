import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Crop,
  ExternalLink,
  FlipHorizontal2,
  FolderOpen,
  Inbox,
  Loader2,
  Lock,
  Palette,
  Pipette,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Ungroup,
  Unlock,
  X,
} from 'lucide-react';
import { CATEGORY_ORDER, type Card, type Category } from '../../domain/types';
import { getRecognizedColorName, isAutoColorTitle, recognizeColor } from '../../domain/colorNaming';
import { isValidHttpUrl, normalizeHex } from '../../domain/validate';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { AppleSelect, CATEGORY_DOT_COLORS } from '../../components/AppleSelect';

interface InspectorPanelProps {
  card: Card;
  dict: I18nDict;
  isCropping: boolean;
  isCuttingOut: boolean;
  onClose: () => void;
  onChangeCard: (cardId: string, patch: Partial<Card>, recordUndo?: boolean) => void;
  onToggleCrop: (cardId: string) => void;
  onRunAiCutout: (card: Card) => void;
  onRestoreOriginalBg: (card: Card) => void;
  onCopyImageForApps: (card: Card) => void;
  onPickEyedropperColor: (targetCardId?: string) => void;
  onOpenLightbox: (card: Card) => void;
  onOpenFileCard: (card: Card) => void;
  onTriggerReplaceImage: (card: Card) => void;
  onTriggerReplaceFile: (card: Card) => void;
  onExtractPalette: (card: Card) => void;
  onDuplicate: (cardId: string) => void;
  onMoveToInbox: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onUngroupFrame: (frameId: string) => void;
}

// Curated 10-color Studio Block Palette (harmonized from FigJam, Apple Freeform & Notion)
const BLOCK_COLOR_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: '#FFFFFF', name: 'Trắng tinh' },
  { hex: '#E5E7EB', name: 'Xám đá' },
  { hex: '#FFE8A3', name: 'Vàng bơ' },
  { hex: '#FFD6B5', name: 'Cam đào' },
  { hex: '#FBC5C5', name: 'Hồng san hô' },
  { hex: '#D9C8FF', name: 'Tím oải hương' },
  { hex: '#BDE0FE', name: 'Xanh trời' },
  { hex: '#BFEAD0', name: 'Xanh bạc hà' },
  { hex: '#D8C3A5', name: 'Cát gỗ sồi' },
  { hex: '#26292E', name: 'Than chì' },
];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  card,
  dict,
  isCropping,
  isCuttingOut,
  onClose,
  onChangeCard,
  onToggleCrop,
  onRunAiCutout,
  onRestoreOriginalBg,
  onCopyImageForApps,
  onPickEyedropperColor,
  onOpenFileCard,
  onTriggerReplaceImage,
  onTriggerReplaceFile,
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
  const [metaExpanded, setMetaExpanded] = useState(false);

  useEffect(() => {
    setPageUrlInput(card.source?.pageUrl ?? '');
    setUrlError('');
    setHexInput(card.color ?? '#8D9A7C');
    setHexError('');
    setMetaExpanded(Boolean(card.spec?.code || card.spec?.price || card.source?.pageUrl));
  }, [card.id, card.source?.pageUrl, card.color, card.spec?.code, card.spec?.price]);

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

  const lang: 'vi' | 'en' = dict.cancel === 'Hủy' ? 'vi' : 'en';
  const recognizedColor =
    card.kind === 'color' ? recognizeColor(normalizeHex(hexInput) ?? card.color ?? '#8D9A7C') : null;
  const recognizedColorName = recognizedColor
    ? lang === 'vi'
      ? recognizedColor.vi
      : recognizedColor.en
    : '';
  const recognizedTempLabel = recognizedColor
    ? recognizedColor.temperature === 'warm'
      ? dict.colorTempWarm
      : recognizedColor.temperature === 'cool'
        ? dict.colorTempCool
        : dict.colorTempNeutral
    : '';

  const commitHex = (raw: string) => {
    setHexInput(raw);
    const norm = normalizeHex(raw);
    if (!norm) {
      setHexError(dict.invalidHex);
      return;
    }
    setHexError('');
    const patch: Partial<Card> = { color: norm };
    if (card.kind === 'color' && isAutoColorTitle(card.title, card.color)) {
      patch.title = getRecognizedColorName(norm, lang);
    }
    onChangeCard(card.id, patch, true);
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
        {/* Title & Category */}
        <label className="field">
          <span className="field-label">{dict.titleLabel}</span>
          <input
            className="input-sm"
            value={card.title}
            onChange={(e) => onChangeCard(card.id, { title: e.target.value }, false)}
            onBlur={() => onChangeCard(card.id, { title: card.title }, true)}
          />
        </label>

        {card.kind !== 'frame' && (
          <div className="field">
            <span className="field-label">{dict.categoryLabel}</span>
            <AppleSelect<Category>
              ariaLabel={dict.categoryLabel}
              value={card.category}
              options={CATEGORY_ORDER.map((cat) => ({
                value: cat,
                label: getCategoryLabel(dict, cat),
                dotColor: CATEGORY_DOT_COLORS[cat],
              }))}
              onChange={(category) => onChangeCard(card.id, { category }, true)}
            />
          </div>
        )}

        {/* Color-specific HEX field */}
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
                title={dict.eyedropperBtn}
                onClick={() => onPickEyedropperColor(card.id)}
              >
                <Pipette size={14} />
              </button>
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
            {!hexError && recognizedColor && (
              <div
                className="field-row-between"
                style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-secondary)' }}
              >
                <span className="truncate">
                  {dict.colorDetectedLabel}: <strong>{recognizedColorName}</strong> · {recognizedTempLabel}
                </span>
                {card.title.trim().toLowerCase() !== recognizedColorName.toLowerCase() && (
                  <button
                    type="button"
                    className="btn-link-xs"
                    style={{ flexShrink: 0, marginLeft: 6 }}
                    onClick={() => onChangeCard(card.id, { title: recognizedColorName }, true)}
                  >
                    {dict.colorApplyNameBtn}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Block fill color control (10 fixed presets) */}
        {card.kind !== 'image' && (
          <div className="field">
            <div className="field-row-between">
              <span className="field-label">{dict.blockColorLabel}</span>
              {card.kind !== 'color' && card.color && (
                <button
                  type="button"
                  className="btn-link-xs"
                  onClick={() => onChangeCard(card.id, { color: undefined, textColor: undefined }, true)}
                >
                  {dict.resetDefault}
                </button>
              )}
            </div>
            <div className="swatch-grid-5">
              {BLOCK_COLOR_PRESETS.map((item, idx) => {
                const label = dict.blockColorNames[idx] ?? item.name;
                return (
                  <button
                    key={item.hex}
                    type="button"
                    title={`${label} (${item.hex})`}
                    aria-label={label}
                    className={`swatch-dot ${(card.color || '').toUpperCase() === item.hex ? 'is-active' : ''}`}
                    style={{ backgroundColor: item.hex }}
                    onClick={() => {
                      const patch: Partial<Card> = { color: item.hex, textColor: undefined };
                      if (card.kind === 'color' && isAutoColorTitle(card.title, card.color)) {
                        patch.title = getRecognizedColorName(item.hex, lang);
                      }
                      onChangeCard(card.id, patch, true);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Symmetrical 2x2 Image Tools Grid (Clean, Balanced, Zero Clutter) */}
        {card.kind === 'image' && card.assetId && (
          <div className="inspector-tools-block">
            <div className="inspector-grid-2x2">
              <button
                type="button"
                className={`btn-xs ${isCropping ? 'btn-primary' : 'btn-subtle'}`}
                onClick={() => onToggleCrop(card.id)}
              >
                <Crop size={13} />
                <span className="truncate">{isCropping ? dict.cropDone : dict.cropImage}</span>
              </button>

              {card.cutout && card.originalAssetId ? (
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  onClick={() => onRestoreOriginalBg(card)}
                >
                  <RotateCcw size={13} />
                  <span className="truncate">{dict.aiCutoutRestore}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  disabled={isCuttingOut}
                  onClick={() => onRunAiCutout(card)}
                >
                  {isCuttingOut ? <Loader2 size={13} className="spin" /> : <Scissors size={13} />}
                  <span className="truncate">
                    {isCuttingOut ? dict.aiCutoutRunning : dict.aiCutoutBtn}
                  </span>
                </button>
              )}

              <button
                type="button"
                className="btn-xs btn-subtle"
                onClick={() => onExtractPalette(card)}
              >
                <Palette size={13} />
                <span className="truncate">{dict.extractPaletteShort}</span>
              </button>

              <button
                type="button"
                className="btn-xs btn-subtle"
                onClick={() => onTriggerReplaceImage(card)}
              >
                <RefreshCw size={13} />
                <span className="truncate">{dict.replaceImage}</span>
              </button>
            </div>

            {/* Contextual sub-bar shown only when cropping or transformed */}
            {(isCropping || card.crop || card.flipH) && (
              <div className="inspector-sub-bar">
                <button
                  type="button"
                  className={`btn-xs ${card.flipH ? 'btn-primary' : 'btn-subtle'} flex-1`}
                  onClick={() => onChangeCard(card.id, { flipH: !card.flipH }, true)}
                >
                  <FlipHorizontal2 size={12} />
                  <span>{dict.flipHorizontal}</span>
                </button>
                {card.crop && (
                  <button
                    type="button"
                    className="btn-xs btn-subtle flex-1"
                    onClick={() => onChangeCard(card.id, { crop: undefined }, true)}
                  >
                    <RotateCcw size={12} />
                    <span>{dict.cropReset}</span>
                  </button>
                )}
              </div>
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
            <div className="inspector-btn-row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn-xs btn-primary flex-1"
                onClick={() => onOpenFileCard(card)}
              >
                <FolderOpen size={13} />
                <span>{dict.openFile}</span>
              </button>
              <button
                type="button"
                className="btn-xs btn-subtle flex-1"
                onClick={() => onTriggerReplaceFile(card)}
              >
                <RefreshCw size={13} />
                <span>{dict.relinkFile}</span>
              </button>
            </div>
          </div>
        )}

        {/* Caption / Notes (compact 2 rows) */}
        {card.kind !== 'frame' && (
          <label className="field">
            <span className="field-label">{dict.captionLabel}</span>
            <textarea
              className="textarea-sm"
              rows={2}
              value={card.text}
              onChange={(e) => onChangeCard(card.id, { text: e.target.value }, false)}
            />
          </label>
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

        {/* Collapsible Secondary Drawer: FF&E Spec & Reference Source */}
        {card.kind !== 'frame' && (
          <div className="inspector-disclosure">
            <button
              type="button"
              className="inspector-disclosure-btn"
              aria-expanded={metaExpanded}
              onClick={() => setMetaExpanded((v) => !v)}
            >
              <span>{dict.metaDisclosure}</span>
              <ChevronDown
                size={14}
                className={`disclosure-chevron ${metaExpanded ? 'is-open' : ''}`}
              />
            </button>

            {metaExpanded && (
              <div className="inspector-disclosure-body">
                {(card.kind === 'image' || card.kind === 'color' || card.kind === 'file') && (
                  <>
                    <label className="field">
                      <span className="field-label">{dict.ffeCodeLabel}</span>
                      <input
                        className="input-sm"
                        placeholder={dict.ffeCodePlaceholder}
                        value={card.spec?.code ?? ''}
                        onChange={(e) =>
                          onChangeCard(
                            card.id,
                            { spec: { ...card.spec, code: e.target.value } },
                            false
                          )
                        }
                        onBlur={() =>
                          onChangeCard(
                            card.id,
                            { spec: { ...card.spec, code: card.spec?.code } },
                            true
                          )
                        }
                      />
                    </label>
                    <div className="ffe-price-qty-row">
                      <label className="field flex-1">
                        <span className="field-label">{dict.ffePriceLabel}</span>
                        <input
                          className="input-sm"
                          placeholder={dict.ffePricePlaceholder}
                          value={card.spec?.price ?? ''}
                          onChange={(e) =>
                            onChangeCard(
                              card.id,
                              { spec: { ...card.spec, price: e.target.value } },
                              false
                            )
                          }
                          onBlur={() =>
                            onChangeCard(
                              card.id,
                              { spec: { ...card.spec, price: card.spec?.price } },
                              true
                            )
                          }
                        />
                      </label>
                      <label className="field" style={{ width: 60, flexShrink: 0 }}>
                        <span className="field-label">{dict.ffeQtyLabel}</span>
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          className="input-sm mono"
                          value={card.spec?.qty ?? 1}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(9999, parseInt(e.target.value, 10) || 1));
                            onChangeCard(
                              card.id,
                              { spec: { ...card.spec, qty: val } },
                              true
                            );
                          }}
                        />
                      </label>
                    </div>
                  </>
                )}

                {card.kind !== 'color' && (
                  <>
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

                    {(hasWebSource || hasDirectImageUrl) && (
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
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer card actions */}
        <div className="inspector-section inspector-footer-actions">
          <button
            type="button"
            className="btn-xs btn-subtle flex-1"
            style={{ minWidth: 0 }}
            onClick={() => onChangeCard(card.id, { locked: !card.locked }, true)}
          >
            {card.locked ? <Unlock size={13} /> : <Lock size={13} />}
            <span className="truncate">{card.locked ? dict.unlockCard : dict.lockCard}</span>
          </button>
          <button
            type="button"
            className="btn-xs btn-subtle"
            title={card.kind === 'image' && card.assetId ? dict.copyForDesignApps : dict.duplicate}
            onClick={() =>
              card.kind === 'image' && card.assetId
                ? onCopyImageForApps(card)
                : onDuplicate(card.id)
            }
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
            title={`${dict.deleteToTrash} (Del)`}
            onClick={() => onDelete(card.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
};
