import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FolderSync,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import type { BackupFileV1, Project } from '../../domain/types';
import type { I18nDict } from '../../i18n';
import {
  commitImportedBackup,
  parseAndValidateBackupFile,
} from '../../storage/backup';
import {
  checkDirectoryPermission,
  clearSavedSyncDirectory,
  getSavedSyncDirectory,
  isFolderSyncSupported,
  pickSyncDirectory,
  saveProjectAsMosaFile,
  syncAllProjectsToDirectory,
  type FsDirectoryHandle,
} from '../../storage/localFolderSync';
import {
  formatBytesMb,
  getStorageHealth,
  purgeOrphanAssets,
  type StorageHealthReport,
} from '../../storage/storageHealth';
import { DialogShell } from '../common/DialogShell';

interface BackupModalProps {
  open: boolean;
  project: Project;
  allProjects: Project[];
  autoFolderSync: boolean;
  dict: I18nDict;
  onClose: () => void;
  onImportedProject: (newProject: Project) => void;
  onChangeAutoFolderSync: (enabled: boolean) => void;
  onSyncFolderChanged: (handle: FsDirectoryHandle | null) => void;
  onToast: (message: string) => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  open,
  project,
  allProjects,
  autoFolderSync,
  dict,
  onClose,
  onImportedProject,
  onChangeAutoFolderSync,
  onSyncFolderChanged,
  onToast,
}) => {
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState('');
  const [pendingBackup, setPendingBackup] = useState<BackupFileV1 | null>(null);
  const [folderHandle, setFolderHandle] = useState<FsDirectoryHandle | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [health, setHealth] = useState<StorageHealthReport | null>(null);
  const supported = isFolderSyncSupported();

  const refreshState = async () => {
    const [savedDir, healthRep] = await Promise.all([
      supported ? getSavedSyncDirectory() : Promise.resolve(null),
      getStorageHealth(),
    ]);
    setFolderHandle(savedDir);
    setHealth(healthRep);
    if (savedDir) {
      const ok = await checkDirectoryPermission(savedDir, false);
      setHasPermission(ok);
    } else {
      setHasPermission(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refreshState();
  }, [open]);

  const handleClose = () => {
    setError('');
    setPendingBackup(null);
    setProgressText('');
    onClose();
  };

  const handlePickFolder = async () => {
    setError('');
    try {
      const dir = await pickSyncDirectory();
      if (!dir) return;
      setFolderHandle(dir);
      setHasPermission(true);
      onSyncFolderChanged(dir);
      onChangeAutoFolderSync(true);
      setBusy(true);
      const count = await syncAllProjectsToDirectory(dir, allProjects, (d, t) => {
        setProgressText(dict.backupPackingProgress(d, t));
      });
      const msg = dict.folderSyncSuccessToast(count, dir.name);
      setProgressText(msg);
      onToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.backupExportError);
    } finally {
      setBusy(false);
    }
  };

  const handleRegrantPermission = async () => {
    if (!folderHandle) return;
    const ok = await checkDirectoryPermission(folderHandle, true);
    setHasPermission(ok);
    if (ok) {
      onSyncFolderChanged(folderHandle);
    }
  };

  const handleSyncAllNow = async () => {
    if (!folderHandle) return;
    setBusy(true);
    setError('');
    try {
      const ok = await checkDirectoryPermission(folderHandle, true);
      setHasPermission(ok);
      if (!ok) {
        setError(dict.folderSyncNeedPermission);
        return;
      }
      const count = await syncAllProjectsToDirectory(folderHandle, allProjects, (d, t) => {
        setProgressText(dict.backupPackingProgress(d, t));
      });
      const msg = dict.folderSyncSuccessToast(count, folderHandle.name);
      setProgressText(msg);
      onToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.backupExportError);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectFolder = async () => {
    await clearSavedSyncDirectory();
    setFolderHandle(null);
    setHasPermission(false);
    onChangeAutoFolderSync(false);
    onSyncFolderChanged(null);
  };

  const handleExportMosa = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await saveProjectAsMosaFile(project, (done, total) => {
        setProgressText(dict.backupPackingProgress(done, total));
      });
      if (saved) {
        setProgressText(dict.backupExportSuccess);
        onToast(dict.backupExportSuccess);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.backupExportError);
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
        setProgressText(dict.backupRestoringProgress(done, total));
      });
      onImportedProject(created);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.backupImportError);
    } finally {
      setBusy(false);
    }
  };

  const handleCleanOrphans = async () => {
    setBusy(true);
    setError('');
    try {
      const { removedCount, reclaimedBytes } = await purgeOrphanAssets();
      if (removedCount === 0) {
        setProgressText(dict.storageHealthCleanZero);
      } else {
        const msg = dict.storageHealthCleanDone(formatBytesMb(reclaimedBytes));
        setProgressText(msg);
        onToast(msg);
      }
      await refreshState();
    } finally {
      setBusy(false);
    }
  };

  const quotaPct =
    health?.browserQuotaBytes && health.browserQuotaBytes > 0
      ? Math.min(100, Math.max(2, ((health.browserUsageBytes ?? health.usedAssetBytes) / health.browserQuotaBytes) * 100))
      : Math.min(100, Math.max(4, (health?.usedAssetBytes ?? 0) / (500 * 1024 * 1024) * 100));

  return (
    <DialogShell
      open={open}
      title={dict.storageHubTitle}
      width={540}
      closeLabel={dict.close}
      onClose={handleClose}
      footer={
        <button type="button" className="btn btn-subtle" onClick={handleClose}>
          {dict.close}
        </button>
      }
    >
      <div className="form-stack">
        {/* Section 1: Real Hard-Drive Folder Sync (.mosa) */}
        <div className="backup-card">
          <div className="backup-card-head">
            <FolderSync size={16} />
            <strong>{dict.folderSyncTitle}</strong>
          </div>
          <p className="field-hint">{dict.folderSyncDesc}</p>

          {!supported ? (
            <div className="alert-box">{dict.folderSyncUnsupported}</div>
          ) : folderHandle ? (
            <div className="sync-status-stack">
              <div className="sync-folder-pill">
                <CheckCircle2
                  size={15}
                  className={hasPermission ? 'sync-ok-icon' : 'muted-icon'}
                />
                <span className="truncate">{dict.folderSyncConnected(folderHandle.name)}</span>
              </div>

              {!hasPermission && (
                <div className="alert-box alert-box--warn">
                  <span>{dict.folderSyncNeedPermission}</span>
                  <button
                    type="button"
                    className="btn-xs btn-primary"
                    onClick={() => void handleRegrantPermission()}
                  >
                    {dict.folderSyncGrantBtn}
                  </button>
                </div>
              )}

              <label className="toggle-row">
                <span>{dict.folderSyncAutoToggle}</span>
                <input
                  type="checkbox"
                  checked={autoFolderSync}
                  onChange={(e) => onChangeAutoFolderSync(e.target.checked)}
                />
              </label>

              <div className="inspector-btn-row">
                <button
                  type="button"
                  className="btn-xs btn-primary flex-1"
                  disabled={busy}
                  onClick={() => void handleSyncAllNow()}
                >
                  {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                  <span>{dict.folderSyncNowBtn}</span>
                </button>
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  disabled={busy}
                  onClick={() => void handlePickFolder()}
                >
                  {dict.folderSyncChangeBtn}
                </button>
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  title={dict.folderSyncDisconnectBtn}
                  disabled={busy}
                  onClick={() => void handleDisconnectFolder()}
                >
                  <Unlink size={13} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void handlePickFolder()}
            >
              <FolderSync size={15} />
              <span>{dict.folderSyncPickBtn}</span>
            </button>
          )}
        </div>

        {/* Section 2: Direct .mosa File Save / Import */}
        <div className="backup-card">
          <div className="inspector-btn-row">
            <button
              type="button"
              className="btn btn-subtle flex-1"
              disabled={busy}
              onClick={() => void handleExportMosa()}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              <span>{dict.mosaFileSaveBtn}</span>
            </button>
            <label className="btn btn-subtle file-label-btn flex-1">
              <Upload size={15} />
              <span>{dict.mosaFileOpenBtn}</span>
              <input
                type="file"
                accept=".mosa,.json,.moodboard.json,application/json"
                hidden
                disabled={busy}
                onChange={(e) => void handleChooseFile(e)}
              />
            </label>
          </div>

          {pendingBackup && (
            <div className="backup-preview-box">
              <div>
                <strong>{pendingBackup.project.name}</strong>
                <div className="field-hint">
                  {dict.backupPreviewSummary(
                    pendingBackup.project.cards.length,
                    pendingBackup.assets.length
                  )}
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

        {/* Section 3: Storage Health & Safe Orphan Cleaner */}
        {health && (
          <div className="backup-card">
            <div className="backup-card-head">
              <HardDrive size={15} />
              <strong>{dict.storageHealthTitle}</strong>
            </div>
            <div className="storage-meter">
              <div className="storage-meter-bar" style={{ width: `${quotaPct}%` }} />
            </div>
            <div className="field-row-between">
              <span className="field-hint">
                {dict.storageHealthUsed(formatBytesMb(health.usedAssetBytes), health.assetCount)}
              </span>
              {health.orphanAssetIds.length > 0 ? (
                <button
                  type="button"
                  className="btn-xs btn-subtle"
                  disabled={busy}
                  onClick={() => void handleCleanOrphans()}
                >
                  <Trash2 size={13} />
                  <span>
                    {dict.storageHealthCleanBtn} ({formatBytesMb(health.orphanBytes)} MB)
                  </span>
                </button>
              ) : (
                <span className="storage-clean-pill">
                  <ShieldCheck size={13} />
                  <span>{dict.storageHealthCleanZero}</span>
                </span>
              )}
            </div>
            {health.orphanAssetIds.length > 0 && (
              <div className="field-hint">
                {dict.storageHealthOrphans(
                  formatBytesMb(health.orphanBytes),
                  health.orphanAssetIds.length
                )}
              </div>
            )}
          </div>
        )}

        {progressText && <div className="field-hint">{progressText}</div>}
        {error && <div className="alert-box alert-box--danger">{error}</div>}
      </div>
    </DialogShell>
  );
};
