import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Card } from '../../domain/types';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { resolveAssetUrl } from '../../storage/workspaceRepository';
import { DialogShell } from '../common/DialogShell';

interface LightboxModalProps {
  card: Card | null;
  dict: I18nDict;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({ card, dict, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!card) {
      setUrl(null);
      return;
    }
    if (!card.assetId) {
      setUrl(card.source?.imageUrl || null);
      return;
    }
    resolveAssetUrl(card.assetId, 'full').then((u) => {
      if (alive) setUrl(u || card.source?.imageUrl || null);
    });
    return () => {
      alive = false;
    };
  }, [card]);

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
          <img
            src={url}
            alt={card?.title || ''}
            className="lightbox-img"
            referrerPolicy="no-referrer"
            style={card?.flipH ? { transform: 'scaleX(-1)' } : undefined}
          />
        ) : (
          <div className="field-hint">{dict.imageMissingBadge}</div>
        )}
        {card?.text && <p className="lightbox-caption">{card.text}</p>}
      </div>
    </DialogShell>
  );
};
