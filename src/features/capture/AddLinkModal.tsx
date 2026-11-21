import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { isValidHttpUrl } from '../../domain/validate';
import type { I18nDict } from '../../i18n';
import { DialogShell } from '../common/DialogShell';

interface AddLinkModalProps {
  open: boolean;
  dict: I18nDict;
  onClose: () => void;
  onSubmit: (url: string, title: string, tryAsImage: boolean) => Promise<void>;
}

export const AddLinkModal: React.FC<AddLinkModalProps> = ({
  open,
  dict,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tryAsImage, setTryAsImage] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetAndClose = () => {
    setUrl('');
    setTitle('');
    setTryAsImage(false);
    setError('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidHttpUrl(url)) {
      setError(dict.invalidUrl);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(url.trim(), title.trim(), tryAsImage);
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.addLinkError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title={dict.addLinkTitle}
      width={440}
      closeLabel={dict.close}
      onClose={resetAndClose}
    >
      <form className="form-stack" onSubmit={(e) => void handleSubmit(e)}>
        <label className="field">
          <span className="field-label">{dict.linkUrlLabel}</span>
          <input
            className="input-sm"
            type="url"
            placeholder="https://pinterest.com/pin/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">{dict.linkTitleLabel}</span>
          <input
            className="input-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="toggle-row">
          <span>{dict.linkAsImageOption}</span>
          <input
            type="checkbox"
            checked={tryAsImage}
            onChange={(e) => setTryAsImage(e.target.checked)}
          />
        </label>

        {error && <div className="field-error">{error}</div>}

        <div className="inline-dialog-footer">
          <button type="button" className="btn btn-subtle" onClick={resetAndClose}>
            {dict.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || !url.trim()}>
            <Link2 size={15} />
            <span>{dict.addAction}</span>
          </button>
        </div>
      </form>
    </DialogShell>
  );
};
