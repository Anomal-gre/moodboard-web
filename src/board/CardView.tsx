import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FileCode2,
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
  isHighlighted: boolean;
  presentMode: boolean;
  dict: I18nDict;
  onPointerDown: (e: React.PointerEvent, card: Card) => void;
  onDoubleClick: (e: React.MouseEvent, card: Card) => void;
  onResizePointerDown: (e: React.PointerEvent, card: Card) => void;
  onUpdateCardText: (cardId: string, text: string) => void;
  onFinishEdit: () => void;
  onOpenLightbox: (card: Card) => void;
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
    isHighlighted,
    presentMode,
    dict,
    onPointerDown,
    onDoubleClick,
    onResizePointerDown,
    onUpdateCardText,
    onFinishEdit,
    onOpenLightbox,
    onTriggerReplaceImage,
  }) => {
    const [imgUrl, setImgUrl] = useState<string | null>(null);
    const [imgLoading, setImgLoading] = useState<boolean>(Boolean(card.kind === 'image' && card.assetId));
    const [imgFailed, setImgFailed] = useState(false);
    const [copiedHex, setCopiedHex] = useState(false);

    useEffect(() => {
      let alive = true;
      setImgFailed(false);
      if (card.kind !== 'image') {
        setImgUrl(null);
        setImgLoading(false);
        return;
      }
      if (card.assetId) {
        setImgLoading(true);
        resolveAssetUrl(card.assetId, 'thumb').then((url) => {
          if (!alive) return;
          setImgUrl(url);
          setImgLoading(false);
          if (!url) setImgFailed(true);
        });
      } else {
        setImgUrl(null);
        setImgLoading(false);
      }
      return () => {
        alive = false;
      };
    }, [card.kind, card.assetId]);

    const style: React.CSSProperties = {
      transform: `translate3d(${displayX}px, ${displayY}px, 0)`,
      width: displayW,
      height: displayH,
      zIndex: card.z,
    };

    const classNames = [
      'board-card',
      `board-card--${card.kind}`,
      selected && !presentMode ? 'is-selected' : '',
      card.locked ? 'is-locked' : '',
      isHighlighted ? 'is-highlighted' : '',
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

    if (card.kind === 'frame') {
      return (
        <div
          className={classNames}
          style={style}
          data-card-id={card.id}
          onPointerDown={(e) => onPointerDown(e, card)}
        >
          <div className="frame-header">
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
      >
        {card.kind === 'image' && (
          <div className="image-card-inner">
            {imgUrl && !imgFailed ? (
              <img
                src={imgUrl}
                alt={card.title || 'Moodboard image'}
                className="image-card-img"
                draggable={false}
                decoding="async"
                onError={() => setImgFailed(true)}
              />
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
                {card.title && (
                  <div className="image-card-caption-bar">
                    <span className="truncate">{card.title}</span>
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
              color: getContrastTextColor(card.color || '#FAF7EE'),
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
                {card.text || (presentMode ? '' : 'Nhấp đúp để viết ghi chú…')}
              </div>
            )}
          </div>
        )}

        {card.kind === 'color' && (
          <div
            className="color-card-inner"
            style={{
              backgroundColor: card.color || '#8D9A7C',
              color: getContrastTextColor(card.color || '#8D9A7C'),
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
          <div className="link-card-inner">
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
            <div className="link-card-title truncate">{card.title || extractHostname(card.source?.pageUrl || '')}</div>
            <div className="link-card-host truncate">
              {card.source?.pageUrl ? extractHostname(card.source.pageUrl) : dict.noWebSource}
            </div>
            {card.text && <div className="link-card-desc">{card.text}</div>}
          </div>
        )}

        {card.kind === 'file' && (
          <div className="file-card-inner">
            <div className="file-card-badge">
              <FileCode2 size={16} />
              <span>{(card.designFile?.extension || 'FILE').toUpperCase()}</span>
            </div>
            <div className="file-card-content">
              <div className="file-card-title truncate">{card.title}</div>
              <div className="file-card-sub truncate">
                {[formatBytes(card.designFile?.size), card.text].filter(Boolean).join(' · ') ||
                  card.source?.fileName}
              </div>
            </div>
            {card.source?.pageUrl && !presentMode && (
              <button
                type="button"
                className="icon-btn-sm"
                title={dict.openSource}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => openUrlSafe(e, card.source?.pageUrl)}
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        )}

        {card.locked && !presentMode && (
          <div className="card-lock-corner" title={dict.lockCard}>
            <Lock size={11} />
          </div>
        )}

        {singleSelected && !card.locked && !presentMode && !isEditing && (
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
