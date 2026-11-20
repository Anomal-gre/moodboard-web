import React from 'react';
import type { I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';

interface ShortcutsModalProps {
  open: boolean;
  dict: I18nDict;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Space + Kéo / Chuột giữa', desc: 'Di chuyển bảng (Pan)' },
  { keys: 'Ctrl / Cmd + Cuộn', desc: 'Phóng to / thu nhỏ tại con trỏ' },
  { keys: 'Nhấp đúp vùng trống', desc: 'Tạo ghi chú mới tại con trỏ' },
  { keys: 'Shift + Click / Kéo vùng trống', desc: 'Chọn nhiều card / Lasso' },
  { keys: 'Mũi tên / Shift + Mũi tên', desc: 'Dịch chuyển 1 px / 10 px' },
  { keys: 'Ctrl / Cmd + D', desc: 'Nhân bản card đang chọn' },
  { keys: 'Ctrl / Cmd + C / V', desc: 'Sao chép / dán card, ảnh hoặc URL' },
  { keys: 'Ctrl / Cmd + Z / Shift + Z', desc: 'Hoàn tác / Làm lại (tối đa 40 bước)' },
  { keys: 'Delete / Backspace', desc: 'Chuyển card vào thùng rác' },
  { keys: 'Esc', desc: 'Đóng hộp thoại, thoát Trình bày hoặc bỏ chọn' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, dict, onClose }) => {
  return (
    <DialogShell
      open={open}
      title={dict.shortcuts}
      width={460}
      closeLabel={dict.close}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-subtle" onClick={onClose}>
          {dict.close}
        </button>
      }
    >
      <div className="shortcuts-list">
        {SHORTCUTS.map((row) => (
          <div key={row.keys} className="shortcut-row">
            <kbd className="kbd-pill">{row.keys}</kbd>
            <span>{row.desc}</span>
          </div>
        ))}
      </div>
    </DialogShell>
  );
};
