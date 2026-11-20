import React, { useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import type { BackupFileV1, Project } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import {
  commitImportedBackup,
  exportProjectBackup,
  parseAndValidateBackupFile,
} from '../../storage/backup';
import { DialogShell } from '../common/DialogShell';
import { slugifyFileName, triggerBlobDownload } from './exportPng';

interface BackupModalProps {
  open: boolean;
  project: Project;
  dict: I18nDict;
  onClose: () => void;
  onImportedProject: (newProject: Project) => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  open,
  project,
  dict,
  onClose,
  onImportedProject,
}) => {
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState('');
  const [pendingBackup, setPendingBackup] = useState<BackupFileV1 | null>(null);

  const handleClose = () => {
    setError('');
    setPendingBackup(null);
    setProgressText('');
    onClose();
  };

  const handleExport = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await exportProjectBackup(project, (done, total) => {
        setProgressText(`Đang đóng gói ảnh ${done}/${total}…`);
      });
      triggerBlobDownload(blob, `${slugifyFileName(project.name)}.moodboard.json`);
      setProgressText('Đã tải tệp sao lưu thành công.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xuất sao lưu.');
    } finally {
      setBusy(false);
    }
  };

  const handleChooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setPendingBackup(null);
    const res = await parseAndValidateBackupFile(file);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setPendingBackup(res.data);
  };

  const handleConfirmImport = async () => {
    if (!pendingBackup) return;
    setBusy(true);
    setError('');
    try {
      const created = await commitImportedBackup(pendingBackup, (done, total) => {
        setProgressText(`Đang khôi phục ảnh ${done}/${total}…`);
      });
      onImportedProject(created);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể nhập bản sao.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title={dict.backupTitle}
      width={490}
      closeLabel={dict.close}
      onClose={handleClose}
      footer={
        <button type="button" className="btn btn-subtle" onClick={handleClose}>
          {dict.close}
        </button>
      }
    >
      <div className="form-stack">
        <div className="backup-card">
          <p className="field-hint">{dict.backupExportDesc}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleExport()}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            <span>{dict.backupExportBtn}</span>
          </button>
        </div>

        <div className="backup-card">
          <p className="field-hint">{dict.backupImportDesc}</p>
          <label className="btn btn-subtle file-label-btn">
            <Upload size={15} />
            <span>{dict.backupChooseFile}</span>
            <input
              type="file"
              accept=".json,.moodboard.json,application/json"
              hidden
              disabled={busy}
              onChange={(e) => void handleChooseFile(e)}
            />
          </label>

          {pendingBackup && (
            <div className="backup-preview-box">
              <div>
                <strong>{pendingBackup.project.name}</strong>
                <div className="field-hint">
                  {pendingBackup.project.cards.length} card · {pendingBackup.assets.length} ảnh
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void handleConfirmImport()}
              >
                {dict.backupConfirmImport}
              </button>
            </div>
          )}
        </div>

        {progressText && <div className="field-hint">{progressText}</div>}
        {error && <div className="alert-box alert-box--danger">{error}</div>}
      </div>
    </DialogShell>
  );
};
