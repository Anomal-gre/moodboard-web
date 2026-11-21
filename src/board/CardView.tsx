import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  GripHorizontal,
  ImageOff,
  Link2,
  Lock,
  Maximize2,
  RefreshCw,
} from 'lucide-react';
import type { Card } from '../domain/types';
import { extractHostname, getContrastTextColor } from '../domain/validate';
import { getCategoryLabel, type I18nDict } from '../i18n';
import { resolveAssetUrl } from '../storage/workspaceRepository';

interface CardViewProps {
  card: Card;
  displayX: number;
  displayY: number;
  displayW: number;
  displayH: number;
  selected: boolean;
  singleSelected: boolean;
  isEditing: boolean;
  isCropping: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
  isMoving: boolean;
  isArranging: boolean;
  presentMode: boolean;
  dict: I18nDict;
  onPointerDown: (e: React.PointerEvent, card: Card) => void;
  onDoubleClick: (e: React.MouseEvent, card: Card) => void;
  onContextMenu: (e: React.MouseEvent, card: Card) => void;
  onResizePointerDown: (e: React.PointerEvent, card: Card) => void;
  onUpdateCardText: (cardId: string, text: string) => void;
  onChangeCrop: (cardId: string, crop: { x: number; y: number; w: number; h: number }) => void;
  onFinishCrop: () => void;
  onFinishEdit: () => void;
  onOpenLightbox: (card: Card) => void;
  onOpenFileCard: (card: Card) => void;
  onTriggerReplaceImage: (card: Card) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CardView: React.FC<CardViewProps> = React.memo(
  ({
    card,
    displayX,
    displayY,
    displayW,
    displayH,
    selected,
    singleSelected,
    isEditing,
    isCropping,
    isHighlighted,
    isDimmed,
    isMoving,
    isArranging,
    presentMode,
    dict,
    onPointerDown,
    onDoubleClick,
    onContextMenu,
    onResizePointerDown,
    onUpdateCardText,
    onChangeCrop,
    onFinishCrop,
    onFinishEdit,
    onOpenLightbox,
    onOpenFileCard,
    onTriggerReplaceImage,
  }) => {
    const [imgUrl, setImgUrl] = useState<string | null>(null);
    const [fullAssetUrl, setFullAssetUrl] = useState<string | null>(null);
    const [imgLoading, setImgLoading] = useState<boolean>(
      Boolean(card.kind === 'image' && card.assetId)
    );
    const [imgFailed, setImgFailed] = useState(false);
    const [copiedHex, setCopiedHex] = useState(false);

    useEffect(() => {
      let alive = true;
      setImgFailed(false);
      if (card.kind !== 'image') {
        setImgUrl(null);
        setFullAssetUrl(null);
        setImgLoading(false);
        return;
      }
      if (card.assetId) {
        setImgLoading(true);
        Promise.all([
          resolveAssetUrl(card.assetId, 'thumb'),
          resolveAssetUrl(card.assetId, 'full'),
        ]).then(([tUrl, fUrl]) => {
          if (!alive) return;
          const fallbackRemote = card.source?.imageUrl || null;
          setImgUrl(tUrl || fallbackRemote);
          setFullAssetUrl(fUrl || tUrl || fallbackRemote);
          setImgLoading(false);
          if (!tUrl && !fallbackRemote) setImgFailed(true);
        });
      } else if (card.source?.imageUrl) {
        setImgUrl(card.source.imageUrl);
        setFullAssetUrl(card.source.imageUrl);
        setImgLoading(false);
      } else {
        setImgUrl(null);
        setFullAssetUrl(null);
        setImgLoading(false);
      }
      return () => {
        alive = false;
      };
    }, [card.kind, card.assetId, card.source?.imageUrl]);

    const handleDragOutStart = (e: React.DragEvent) => {
      e.stopPropagation();
      const exportUrl = fullAssetUrl || imgUrl || card.source?.imageUrl || card.source?.pageUrl;
      if (!exportUrl) return;
      const baseTitle = (card.title || card.source?.fileName || 'Mosa-Asset')
        .replace(/[:/\\?*"<>|]+/g, '-')
        .trim();
      const ext = card.cutout ? 'png' : card.source?.fileName?.split('.').pop() || 'png';
      const fileName = baseTitle.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? baseTitle
        : `${baseTitle}.${ext}`;
      const mime = card.cutout || ext.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';

      e.dataTransfer.effectAllowed = 'copy';
      try {
        e.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${exportUrl}`);
        e.dataTransfer.setData('text/uri-list', exportUrl);
        e.dataTransfer.setData('text/plain', exportUrl);
        e.dataTransfer.setData(
          'text/html',
          `<img src="${exportUrl}" alt="${fileName.replace(/"/g, '')}" />`
        );
      } catch {
        // Ignore restricted MIME types in some browsers
      }
    };

    const style: React.CSSProperties = {
      transform: `translate3d(${displayX}px, ${displayY}px, 0)`,
      width: displayW,
      height: displayH,
      zIndex: isMoving || isCropping ? card.z + 500 : card.z,
    };

    const classNames = [
      'board-card',
      `board-card--${card.kind}`,
      selected && !presentMode ? 'is-selected' : '',
      isMoving ? 'is-moving' : '',
      isArranging ? 'is-arranging' : '',
      card.locked ? 'is-locked' : '',
      card.framed && !card.cutout ? 'is-framed' : '',
      card.cutout ? 'is-cutout' : '',
      isHighlighted ? 'is-highlighted' : '',
      isDimmed ? 'is-dimmed' : '',
      presentMode ? 'is-present' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const openUrlSafe = (e: React.MouseEvent, url?: string) => {
      e.stopPropagation();
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleCopyHex = (e: React.MouseEvent) => {
      e.stopPropagation();
      const hex = (card.color || '#8D9A7C').toUpperCase();
      navigator.clipboard?.writeText(hex).catch(() => undefined);
      setCopiedHex(true);
      setTimeout(() => setCopiedHex(false), 1400);
    };

    const rawExt = (card.designFile?.extension || 'FILE').toUpperCase();
    const displayExt = rawExt.length > 6 ? rawExt.slice(0, 6) : rawExt;

    if (card.kind === 'frame') {
      const frameStyle: React.CSSProperties = {
        ...style,
        ...(card.color
          ? {
              background: `color-mix(in srgb, ${card.color} 22%, transparent)`,
              borderColor: `color-mix(in srgb, ${card.color} 68%, transparent)`,
            }
          : {}),
      };
      return (
        <div
          className={classNames}
          style={frameStyle}
          data-card-id={card.id}
          onPointerDown={(e) => onPointerDown(e, card)}
          onContextMenu={(e) => onContextMenu(e, card)}
        >
          <div className="frame-header" style={card.textColor ? { color: card.textColor } : undefined}>
            <span className="frame-title">{card.title || dict.addGroup}</span>
            {card.locked && !presentMode && (
              <span className="card-lock-pill" title={dict.lockCard}>
                <Lock size={11} />
              </span>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        className={classNames}
        style={style}
        data-card-id={card.id}
        onPointerDown={(e) => onPointerDown(e, card)}
        onDoubleClick={(e) => onDoubleClick(e, card)}
        onContextMenu={(e) => onContextMenu(e, card)}
      >
        {card.kind === 'image' && (
          <div className="image-card-inner">
            {imgUrl && !imgFailed ? (
              <div
                className="image-crop-viewport"
                style={card.flipH ? { transform: 'scaleX(-1)' } : undefined}
              >
                <img
                  src={imgUrl}
                  alt={card.title || 'Moodboard image'}
                  className="image-card-img"
                  draggable={false}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  style={
                    !isCropping && card.crop
                      ? {
                          width: `${(1 / card.crop.w) * 100}%`,
                          height: `${(1 / card.crop.h) * 100}%`,
                          maxWidth: 'none',
                          transform: `translate(${-card.crop.x * 100}%, ${-card.crop.y * 100}%)`,
                        }
                      : undefined
                  }
                />
              </div>
            ) : imgLoading ? (
              <div className="image-card-skeleton" aria-hidden="true" />
            ) : (
              <div className="image-card-placeholder">
                <ImageOff size={22} />
                <div className="image-placeholder-title">{card.title || dict.imageMissingBadge}</div>
                <div className="image-placeholder-sub">
                  {card.imageStatus === 'remote-only' || card.source?.imageUrl
                    ? dict.imageRemoteBadge
                    : dict.imageMissingBadge}
                </div>
                {!presentMode && (
                  <button
                    type="button"
                    className="btn-xs btn-ghost-light"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTriggerReplaceImage(card);
                    }}
                  >
                    <RefreshCw size={12} />
                    <span>{dict.replaceImage}</span>
                  </button>
                )}
              </div>
            )}

            {!presentMode && (
              <>
                <div className="image-card-overlay-top">
                  <span className="card-cat-chip">{getCategoryLabel(dict, card.category)}</span>
                  <div className="image-card-quick-actions">
                    {imgUrl && !imgFailed && (
                      <>
                        <span
                          className="icon-chip-btn drag-out-chip"
                          draggable
                          title={dict.dragOutHint}
                          aria-label={dict.dragOutHint}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDragStart={handleDragOutStart}
                        >
                          <GripHorizontal size={13} />
                        </span>
                        <button
                          type="button"
                          className="icon-chip-btn"
                          title={dict.viewLarge}
                          aria-label={dict.viewLarge}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLightbox(card);
                          }}
                        >
                          <Maximize2 size={13} />
                        </button>
                      </>
                    )}
                    {card.source?.pageUrl && (
                      <button
                        type="button"
                        className="icon-chip-btn"
                        title={dict.openSource}
                        aria-label={dict.openSource}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => openUrlSafe(e, card.source?.pageUrl)}
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {card.title && !isCropping && (
                  <div className="image-card-caption-bar">
                    <span className="truncate">{card.title}</span>
                  </div>
                )}

                {isCropping && (
                  <div
                    className="crop-overlay"
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onFinishCrop();
                    }}
                  >
                    {(() => {
                      const c = card.crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
                      const startCropDrag = (
                        ev: React.PointerEvent,
                        mode: 'box' | 'nw' | 'se'
                      ) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        const startX = ev.clientX;
                        const startY = ev.clientY;
                        const init = { ...c };
                        const onMove = (me: PointerEvent) => {
                          const dx = (me.clientX - startX) / Math.max(40, displayW);
                          const dy = (me.clientY - startY) / Math.max(40, displayH);
                          if (mode === 'box') {
                            const nx = Math.max(0, Math.min(1 - init.w, init.x + dx));
                            const ny = Math.max(0, Math.min(1 - init.h, init.y + dy));
                            onChangeCrop(card.id, { x: nx, y: ny, w: init.w, h: init.h });
                          } else if (mode === 'nw') {
                            const nx = Math.max(0, Math.min(init.x + init.w - 0.15, init.x + dx));
                            const ny = Math.max(0, Math.min(init.y + init.h - 0.15, init.y + dy));
                            onChangeCrop(card.id, {
                              x: nx,
                              y: ny,
                              w: init.w - (nx - init.x),
                              h: init.h - (ny - init.y),
                            });
                          } else {
                            const nw = Math.max(0.15, Math.min(1 - init.x, init.w + dx));
                            const nh = Math.max(0.15, Math.min(1 - init.y, init.h + dy));
                            onChangeCrop(card.id, { x: init.x, y: init.y, w: nw, h: nh });
                          }
                        };
                        const onUp = () => {
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                      };

                      return (
                        <div
                          className="crop-frame-box"
                          style={{
                            left: `${c.x * 100}%`,
                            top: `${c.y * 100}%`,
                            width: `${c.w * 100}%`,
                            height: `${c.h * 100}%`,
                          }}
                          onPointerDown={(e) => startCropDrag(e, 'box')}
                        >
                          <span
                            className="crop-handle crop-handle--nw"
                            onPointerDown={(e) => startCropDrag(e, 'nw')}
                          />
                          <span
                            className="crop-handle crop-handle--se"
                            onPointerDown={(e) => startCropDrag(e, 'se')}
                          />
                          <button
                            type="button"
                            className="crop-done-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFinishCrop();
                            }}
                          >
                            <Check size={12} />
                            <span>{dict.cropDone}</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {card.kind === 'note' && (
          <div
            className="note-card-inner"
            style={{
              backgroundColor: card.color || '#FAF7EE',
              color: card.textColor || getContrastTextColor(card.color || '#FAF7EE'),
            }}
          >
            {card.title && <div className="note-card-title">{card.title}</div>}
            {isEditing ? (
              <textarea
                className="note-card-editor"
                value={card.text}
                autoFocus
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => onUpdateCardText(card.id, e.target.value)}
                onBlur={onFinishEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    onFinishEdit();
                  }
                }}
              />
            ) : (
              <div className="note-card-body">
                {card.text || (presentMode ? '' : dict.notePlaceholder)}
              </div>
            )}
          </div>
        )}

        {card.kind === 'color' && (
          <div
            className="color-card-inner"
            style={{
              backgroundColor: card.color || '#8D9A7C',
              color: card.textColor || getContrastTextColor(card.color || '#8D9A7C'),
            }}
          >
            {!presentMode && (
              <button
                type="button"
                className="swatch-copy-btn"
                title={dict.copyHex}
                aria-label={dict.copyHex}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleCopyHex}
              >
                {copiedHex ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
            <div className="color-card-meta">
              <div className="color-card-name truncate">{card.title || 'Swatch'}</div>
              <div className="color-card-hex">{(card.color || '#8D9A7C').toUpperCase()}</div>
            </div>
          </div>
        )}

        {card.kind === 'link' && (
          <div
            className={`link-card-inner ${card.color || card.textColor ? 'has-custom-color' : ''}`}
            style={
              card.color || card.textColor
                ? {
                    background: card.color || undefined,
                    color:
                      card.textColor ||
                      (card.color ? getContrastTextColor(card.color) : undefined),
                  }
                : undefined
            }
          >
            <div className="link-card-top">
              <span className="meta-pill">
                <Link2 size={12} />
                <span>LINK</span>
              </span>
              {card.source?.pageUrl && !presentMode && (
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => openUrlSafe(e, card.source?.pageUrl)}
                >
                  <span>{dict.openSource}</span>
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
            <div className="link-card-title truncate">
              {card.title || extractHostname(card.source?.pageUrl || '')}
            </div>
            <div className="link-card-host truncate">
              {card.source?.pageUrl ? extractHostname(card.source.pageUrl) : dict.noWebSource}
            </div>
            {card.text && <div className="link-card-desc">{card.text}</div>}
          </div>
        )}

        {card.kind === 'file' && (
          <div
            className={`file-card-inner ${card.color || card.textColor ? 'has-custom-color' : ''}`}
            title={dict.doubleClickOpenHint}
            style={
              card.color || card.textColor
                ? {
                    background: card.color || undefined,
                    color:
                      card.textColor ||
                      (card.color ? getContrastTextColor(card.color) : undefined),
                  }
                : undefined
            }
          >
            <div className="file-card-badge" data-ext={displayExt.toLowerCase()}>
              <FileText size={16} strokeWidth={2} />
              <span>{displayExt}</span>
            </div>
            <div className="file-card-content">
              <div className="file-card-title truncate">{card.title}</div>
              <div className="file-card-sub truncate">
                {[
                  formatBytes(card.designFile?.size),
                  card.text || dict.doubleClickOpenHint,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {!presentMode && (
              <button
                type="button"
                className="icon-btn-sm file-open-btn"
                title={dict.openFile}
                aria-label={dict.openFile}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFileCard(card);
                }}
              >
                <FolderOpen size={15} />
              </button>
            )}
          </div>
        )}

        {card.locked && !presentMode && (
          <div className="card-lock-corner" title={dict.lockCard}>
            <Lock size={11} />
          </div>
        )}

        {singleSelected && !card.locked && !presentMode && !isEditing && !isMoving && (
          <div
            className="card-resize-handle"
            role="presentation"
            title="Resize"
            onPointerDown={(e) => onResizePointerDown(e, card)}
          />
        )}
      </div>
    );
  }
);

CardView.displayName = 'CardView';
