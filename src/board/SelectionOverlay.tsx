import React from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Group,
  Inbox,
  Lock,
  Move,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { Card } from '../domain/types';
import type { AlignMode } from '../domain/geometry';
import type { I18nDict } from '../i18n';

interface SelectionOverlayProps {
  selectedCards: Card[];
  dict: I18nDict;
  onStartStickyMove: (e: React.MouseEvent) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onAlign: (mode: AlignMode) => void;
  onDuplicate: () => void;
  onMoveToInbox: () => void;
  onDelete: () => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selectedCards,
  dict,
  onStartStickyMove,
  onGroup,
  onUngroup,
  onToggleLock,
  onBringForward,
  onSendBackward,
  onAlign,
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
    <div
      className="multi-action-bar"
      role="toolbar"
      aria-label={dict.selectedCount(selectedCards.length)}
    >
      <span className="multi-action-count">{dict.selectedCount(selectedCards.length)}</span>
      <span className="toolbar-sep" />

      <button
        type="button"
        className="btn-xs btn-subtle"
        disabled={allLocked}
        title={dict.moveSelected}
        onClick={(e) => onStartStickyMove(e)}
      >
        <Move size={13} />
        <span>{dict.moveSelected}</span>
      </button>

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

      {/* Horizontal Alignment: Left, Center, Right */}
      <button
        type="button"
        className="icon-btn"
        title={dict.alignLeft}
        onClick={() => onAlign('left')}
      >
        <AlignStartVertical size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={dict.alignCenterH}
        onClick={() => onAlign('center-h')}
      >
        <AlignCenterVertical size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={dict.alignRight}
        onClick={() => onAlign('right')}
      >
        <AlignEndVertical size={16} />
      </button>

      {/* Vertical Alignment: Top, Middle, Bottom */}
      <button
        type="button"
        className="icon-btn"
        title={dict.alignTop}
        onClick={() => onAlign('top')}
      >
        <AlignStartHorizontal size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={dict.alignCenterV}
        onClick={() => onAlign('center-v')}
      >
        <AlignCenterHorizontal size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={dict.alignBottom}
        onClick={() => onAlign('bottom')}
      >
        <AlignEndHorizontal size={16} />
      </button>

      {/* Distribute Spacing: Horizontal & Vertical */}
      <button
        type="button"
        className="icon-btn"
        disabled={!canDistribute}
        title={dict.distributeH}
        onClick={() => onAlign('distribute-h')}
      >
        <AlignHorizontalSpaceAround size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        disabled={!canDistribute}
        title={dict.distributeV}
        onClick={() => onAlign('distribute-v')}
      >
        <AlignVerticalSpaceAround size={16} />
      </button>

      <span className="toolbar-sep" />

      <button type="button" className="icon-btn" title={dict.duplicate} onClick={onDuplicate}>
        <Copy size={16} />
      </button>
      <button type="button" className="icon-btn" title={dict.moveToInbox} onClick={onMoveToInbox}>
        <Inbox size={16} />
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger"
        title={`${dict.deleteToTrash} (Del)`}
        onClick={onDelete}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
};
