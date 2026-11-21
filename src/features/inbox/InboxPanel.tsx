import React, { useEffect, useState } from 'react';
import {
  ArrowUpLeft,
  ChevronDown,
  Download,
  FileCode2,
  Inbox,
  Link2,
  Puzzle,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { Card } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import { resolveAssetUrl } from '../../storage/workspaceRepository';

interface InboxPanelProps {
  open: boolean;
  inboxCards: Card[];
  clipperBridgeReady?: boolean;
  dict: I18nDict;
  onToggle: () => void;
  onMoveToBoard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onDropExternalToInbox: (dt: DataTransfer) => void;
}

const InboxThumb: React.FC<{ card: Card }> = ({ card }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (card.kind === 'image' && card.assetId) {
      resolveAssetUrl(card.assetId, 'thumb').then((u) => {
        if (alive) setUrl(u || card.source?.imageUrl || null);
      });
    } else if (card.kind === 'image' && card.source?.imageUrl) {
      setUrl(card.source.imageUrl);
    }
    return () => {
      alive = false;
    };
  }, [card.kind, card.assetId, card.source?.imageUrl]);

  if (card.kind === 'image' && url) {
    return (
      <img
        src={url}
        alt={card.title}
        referrerPolicy="no-referrer"
        className="inbox-thumb-img"
      />
    );
  }
  if (card.kind === 'color') {
    return <div className="inbox-thumb-color" style={{ backgroundColor: card.color || '#8D9A7C' }} />;
  }
  if (card.kind === 'file') {
    return (
      <div className="inbox-thumb-icon">
        <FileCode2 size={16} />
      </div>
    );
  }
  if (card.kind === 'link') {
    return (
      <div className="inbox-thumb-icon">
        <Link2 size={16} />
      </div>
    );
  }
  return (
    <div className="inbox-thumb-icon">
      <StickyNote size={16} />
    </div>
  );
};

export const InboxPanel: React.FC<InboxPanelProps> = ({
  open,
  inboxCards,
  clipperBridgeReady,
  dict,
  onToggle,
  onMoveToBoard,
  onDeleteCard,
  onDropExternalToInbox,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [clipperGuideOpen, setClipperGuideOpen] = useState(false);

  return (
    <div className="inbox-anchor">
      <button
        type="button"
        className={`inbox-toggle-btn ${open ? 'is-open' : ''}`}
        aria-label={`${dict.unsorted} (${inboxCards.length})`}
        aria-expanded={open}
        aria-controls={open ? 'inbox-panel' : undefined}
        onClick={onToggle}
      >
        <Inbox size={15} />
        <span className="inbox-toggle-label">{dict.unsorted}</span>
        <span className="inbox-count-badge">{inboxCards.length}</span>
        <ChevronDown size={14} className={`inbox-chevron ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <aside
          id="inbox-panel"
          className={`floating-panel inbox-panel ${dragOver ? 'is-drag-over' : ''}`}
          aria-label={dict.unsorted}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            if (e.dataTransfer.getData('application/x-0y03-inbox-card')) return;
            onDropExternalToInbox(e.dataTransfer);
          }}
        >
          <div className="inbox-dropzone">
            <Inbox size={19} aria-hidden="true" />
            <span>{dict.inboxDropHint}</span>
          </div>

          {inboxCards.length === 0 ? (
            <p className="inbox-empty">{dict.inboxEmpty}</p>
          ) : (
            <div className="inbox-list">
              {inboxCards.map((card) => (
                <div
                  key={card.id}
                  className="inbox-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-0y03-inbox-card', card.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <InboxThumb card={card} />
                  <div className="inbox-item-meta">
                    <div className="inbox-item-title truncate">{card.title || card.kind}</div>
                    {card.text && <div className="inbox-item-sub truncate">{card.text}</div>}
                  </div>
                  <div className="inbox-item-actions">
                    <button
                      type="button"
                      className="btn-xs btn-subtle"
                      title={dict.moveToBoard}
                      onClick={() => onMoveToBoard(card.id)}
                    >
                      <ArrowUpLeft size={12} />
                      <span className="hide-xs">{dict.moveToBoard}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn-sm icon-btn--danger"
                      title={dict.deleteToTrash}
                      onClick={() => onDeleteCard(card.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="inbox-clipper-footer">
            <button
              type="button"
              className="inbox-clipper-toggle"
              aria-expanded={clipperGuideOpen}
              onClick={() => setClipperGuideOpen((v) => !v)}
            >
              <span className={`clipper-status-dot ${clipperBridgeReady ? 'is-ok' : ''}`} />
              <Puzzle size={13} />
              <span className="truncate">
                {clipperBridgeReady ? dict.clipperBadgeConnected : dict.clipperBadgeTitle}
              </span>
              <ChevronDown
                size={13}
                className={`disclosure-chevron ${clipperGuideOpen ? 'is-open' : ''}`}
              />
            </button>
            {clipperGuideOpen && (
              <div className="inbox-clipper-guide">
                <strong>{dict.clipperGuideTitle}</strong>
                <p>{dict.clipperGuideSteps}</p>
                <a
                  href="./downloads/mosa-clipper.zip"
                  download="mosa-clipper.zip"
                  className="btn-xs btn-primary inbox-clipper-download"
                >
                  <Download size={12} />
                  <span>{dict.clipperDownloadBtn}</span>
                </a>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
