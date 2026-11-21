import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { I18nDict } from '../../i18n';

interface ShortcutsModalProps {
  open: boolean;
  dict: I18nDict;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, dict, onClose }) => {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('.shortcuts-corner-btn')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      className="floating-panel shortcuts-popover"
      role="dialog"
      aria-label={dict.shortcuts}
    >
      <div className="panel-header">
        <span className="panel-title">{dict.shortcuts}</span>
        <button type="button" className="icon-btn-sm" title={dict.close} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="panel-body">
        <div className="shortcuts-list">
          {dict.shortcutRows.map((row) => (
            <div key={row.keys} className="shortcut-row">
              <kbd className="kbd-pill">{row.keys}</kbd>
              <span>{row.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
