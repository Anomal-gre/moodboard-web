import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Card } from '../../domain/types';
import { isFullCrop } from '../../domain/cropGeometry';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { decodeImageElement } from '../../storage/assets';
import { getAssetBlob, resolveAssetUrl } from '../../storage/workspaceRepository';
import { DialogShell } from '../common/DialogShell';

interface LightboxModalProps {
  card: Card | null;
  dict: I18nDict;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({ card, dict, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [bakedCrop, setBakedCrop] = useState(false);

  useEffect(() => {
    let alive = true;
    let tempObjectUrl: string | null = null;
    setBakedCrop(false);

    if (!card) {
      setUrl(null);
      return;
    }

    const crop = card.crop && !isFullCrop(card.crop) ? card.crop : null;

    const load = async () => {
      if (crop && card.assetId) {
        try {
          const blob = await getAssetBlob(card.assetId, false);
          if (blob && alive) {
            const img = await decodeImageElement(blob);
            const sx = Math.round(crop.x * img.naturalWidth);
            const sy = Math.round(crop.y * img.naturalHeight);
            const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
            const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
              const outBlob = await new Promise<Blob | null>((res) =>
                canvas.toBlob((b) => res(b), 'image/png')
              );
              canvas.width = 0;
              canvas.height = 0;
              if (outBlob && alive) {
                tempObjectUrl = URL.createObjectURL(outBlob);
                setBakedCrop(true);
                setUrl(tempObjectUrl);
                return;
              }
            }
          }
        } catch {
          // Fall back to full asset URL below
        }
      }

      if (!card.assetId) {
        if (alive) setUrl(card.source?.imageUrl || null);
        return;
      }
      const u = await resolveAssetUrl(card.assetId, 'full');
      if (alive) setUrl(u || card.source?.imageUrl || null);
    };

    void load();

    return () => {
      alive = false;
      if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
    };
  }, [card]);

  const fallbackCrop = !bakedCrop && card?.crop && !isFullCrop(card.crop) ? card.crop : null;

  return (
    <DialogShell
      open={Boolean(card)}
      title={card?.title || dict.viewLarge}
      subtitle={card ? getCategoryLabel(dict, card.category) : undefined}
      width={860}
      closeLabel={dict.close}
      onClose={onClose}
      footer={
        <>
          {card?.source?.pageUrl && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.open(card.source!.pageUrl!, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={15} />
              <span>{dict.openSource}</span>
            </button>
          )}
          <button type="button" className="btn btn-subtle" onClick={onClose}>
            {dict.close}
          </button>
        </>
      }
    >
      <div className="lightbox-stage">
        {url ? (
          fallbackCrop && card ? (
            <div
              className="lightbox-img"
              style={{
                position: 'relative',
                overflow: 'hidden',
                aspectRatio: `${Math.max(1, card.w)} / ${Math.max(1, card.h)}`,
                width: card.w >= card.h ? 'min(100%, 720px)' : 'auto',
                height: card.w < card.h ? 'min(64vh, 560px)' : 'auto',
                maxHeight: '64vh',
                maxWidth: '100%',
                transform: card.flipH ? 'scaleX(-1)' : undefined,
              }}
            >
              <img
                src={url}
                alt={card.title || ''}
                referrerPolicy="no-referrer"
                style={{
                  position: 'absolute',
                  left: `${(-fallbackCrop.x / fallbackCrop.w) * 100}%`,
                  top: `${(-fallbackCrop.y / fallbackCrop.h) * 100}%`,
                  width: `${(1 / fallbackCrop.w) * 100}%`,
                  height: `${(1 / fallbackCrop.h) * 100}%`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  objectFit: 'fill',
                }}
              />
            </div>
          ) : (
            <img
              src={url}
              alt={card?.title || ''}
              className="lightbox-img"
              referrerPolicy="no-referrer"
              style={card?.flipH ? { transform: 'scaleX(-1)' } : undefined}
            />
          )
        ) : (
          <div className="field-hint">{dict.imageMissingBadge}</div>
        )}
        {card?.text && <p className="lightbox-caption">{card.text}</p>}
      </div>
    </DialogShell>
  );
};
