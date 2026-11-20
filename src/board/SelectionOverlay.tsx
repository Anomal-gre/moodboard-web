import React from 'react';
import {
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Group,
  Inbox,
  Lock,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { Card } from '../domain/types';
import type { I18nDict } from '../i18n';

interface SelectionOverlayProps {
  selectedCards: Card[];
  dict: I18nDict;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onAlignLeft: () => void;
  onAlignTop: () => void;
  onDistributeH: () => void;
  onDuplicate: () => void;
  onMoveToInbox: () => void;
  onDelete: () => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selectedCards,
  dict,
  onGroup,
  onUngroup,
  onToggleLock,
  onBringForward,
  onSendBackward,
  onAlignLeft,
  onAlignTop,
  onDistributeH,
  onDuplicate,
  onMoveToInbox,
  onDelete,
}) => {
  if (selectedCards.length < 2) return null;

  const hasFrame = selectedCards.some((c) => c.kind === 'frame' || Boolean(c.groupId));
  const allLocked = selectedCards.every((c) => c.locked);
  const unlockedNonFrame = selectedCards.filter((c) => !c.locked && c.kind !== 'frame');
  const canGroup = unlockedNonFrame.length >= 2;
  const canDistribute = selectedCards.filter((c) => !c.locked).length >= 3;

  return (
    <div className="multi-action-bar" role="toolbar" aria-label={dict.selectedCount(selectedCards.length)}>
      <span className="multi-action-count">{dict.selectedCount(selectedCards.length)}</span>
      <span className="toolbar-sep" />

      <button
        type="button"
        className="icon-btn"
        disabled={!canGroup}
        title={dict.groupCards}
        onClick={onGroup}
      >
        <Group size={16} />
      </button>
      {hasFrame && (
        <button
          type="button"
          className="icon-btn"
          title={dict.ungroupCards}
          onClick={onUngroup}
        >
          <Ungroup size={16} />
        </button>
      )}

      <button
        type="button"
        className="icon-btn"
        title={allLocked ? dict.unlockCard : dict.lockCard}
        onClick={onToggleLock}
      >
        {allLocked ? <Unlock size={16} /> : <Lock size={16} />}
      </button>

      <span className="toolbar-sep" />

      <button type="button" className="icon-btn" title={dict.bringForward} onClick={onBringForward}>
        <ArrowUpToLine size={16} />
      </button>
      <button type="button" className="icon-btn" title={dict.sendBackward} onClick={onSendBackward}>
        <ArrowDownToLine size={16} />
      </button>

      <span className="toolbar-sep" />

      <button type="button" className="icon-btn" title={dict.alignLeft} onClick={onAlignLeft}>
        <AlignStartVertical size={16} />
      </button>
      <button type="button" className="icon-btn" title={dict.alignTop} onClick={onAlignTop}>
        <AlignStartHorizontal size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        disabled={!canDistribute}
        title={dict.distributeH}
        onClick={onDistributeH}
      >
        <AlignHorizontalSpaceAround size={16} />
      </button>

      <span className="toolbar-sep" />

      <button type="button" className="icon-btn" title={dict.duplicate} onClick={onDuplicate}>
        <Copy size={16} />
      </button>
      <button type="button" className="icon-btn" title={dict.moveToInbox} onClick={onMoveToInbox}>
        <Inbox size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn--danger" title={dict.deleteToTrash} onClick={onDelete}>
        <Trash2 size={16} />
      </button>
    </div>
  );
};
