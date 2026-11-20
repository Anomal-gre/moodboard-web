import React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { TrashItem } from '../../domain/types';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';

interface TrashModalProps {
  open: boolean;
  items: TrashItem[];
  dict: I18nDict;
  onClose: () => void;
  onRestore: (cardId: string) => void;
  onEmptyTrash: () => void;
}

export const TrashModal: React.FC<TrashModalProps> = ({
  open,
  items,
  dict,
  onClose,
  onRestore,
  onEmptyTrash,
}) => {
  return (
    <DialogShell
      open={open}
      title={`${dict.trashTitle} (${items.length})`}
      width={480}
      closeLabel={dict.close}
      onClose={onClose}
      footer={
        <>
          {items.length > 0 && (
            <button type="button" className="btn btn-danger-subtle" onClick={onEmptyTrash}>
              <Trash2 size={14} />
              <span>{dict.emptyTrash}</span>
            </button>
          )}
          <button type="button" className="btn btn-subtle" onClick={onClose}>
            {dict.close}
          </button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="field-hint">{dict.trashEmpty}</p>
      ) : (
        <div className="trash-list">
          {items.map((item) => (
            <div key={item.card.id} className="trash-row">
              <div className="trash-row-meta">
                <div className="truncate">
                  <strong>{item.card.title || item.card.text.slice(0, 36) || item.card.kind}</strong>
                </div>
                <div className="field-hint">
                  {item.card.kind} · {getCategoryLabel(dict, item.card.category)}
                </div>
              </div>
              <button
                type="button"
                className="btn-xs btn-subtle"
                onClick={() => onRestore(item.card.id)}
              >
                <RotateCcw size={13} />
                <span>{dict.restore}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </DialogShell>
  );
};
