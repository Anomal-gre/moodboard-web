import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles, Square } from 'lucide-react';
import {
  CATEGORY_ORDER,
  CATEGORY_PROMPTS,
  type Card,
  type Category,
  type ClassifySuggestion,
} from '../../domain/types';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { createId } from '../../domain/validate';
import { prepareInferenceImageBlob } from '../../storage/assets';
import { getAssetBlob, resolveAssetUrl } from '../../storage/workspaceRepository';
import type { WorkerOutboundMessage } from '../../workers/classify.worker';
import { DialogShell } from '../common/DialogShell';
import { AppleSelect, CATEGORY_DOT_COLORS } from '../../components/AppleSelect';

interface ClassifyModalProps {
  open: boolean;
  projectId: string;
  cards: Card[];
  selectedIds: string[];
  dict: I18nDict;
  onClose: () => void;
  onApplyLabels: (
    targetProjectId: string,
    updates: Array<{
      cardId: string;
      assetId: string;
      originalCategory: Category;
      newCategory: Category;
    }>
  ) => { applied: number; skippedChanged: number };
}

type JobPhase = 'idle' | 'loading-model' | 'running' | 'review' | 'error';

const SuggestionThumb: React.FC<{ assetId: string; alt: string }> = ({ assetId, alt }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveAssetUrl(assetId, 'thumb').then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);

  return url ? (
    <img src={url} alt={alt} className="classify-thumb" />
  ) : (
    <div className="classify-thumb classify-thumb--empty" />
  );
};

export const ClassifyModal: React.FC<ClassifyModalProps> = ({
  open,
  projectId,
  cards,
  selectedIds,
  dict,
  onClose,
  onApplyLabels,
}) => {
  const [phase, setPhase] = useState<JobPhase>('idle');
  const [downloadDetail, setDownloadDetail] = useState('');
  const [downloadPct, setDownloadPct] = useState<number | undefined>(undefined);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [suggestions, setSuggestions] = useState<ClassifySuggestion[]>([]);
  const [fatalError, setFatalError] = useState('');
  const [timingInfo, setTimingInfo] = useState<{ ms: number; cached: boolean } | null>(null);
  const [jobProjectId, setJobProjectId] = useState(projectId);

  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  // Eligible board images: selected image cards, or all board image cards if no selection
  const { eligibleCards, skippedCount } = useMemo(() => {
    const selSet = new Set(selectedIds);
    const boardImages = cards.filter((c) => !c.inbox && c.kind === 'image');
    const selectedImages = selSet.size > 0 ? boardImages.filter((c) => selSet.has(c.id)) : [];
    const pool = selectedImages.length > 0 ? selectedImages : boardImages;

    const eligible: Card[] = [];
    let skipped = 0;
    for (const c of pool) {
      if (c.assetId && c.imageStatus !== 'missing' && c.imageStatus !== 'remote-only') {
        eligible.push(c);
      } else {
        skipped++;
      }
    }
    return { eligibleCards: eligible, skippedCount: skipped };
  }, [cards, selectedIds]);

  const terminateWorker = useCallback(() => {
    activeRequestIdRef.current = null;
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ type: 'dispose' });
      } catch {
        // ignore
      }
      const w = workerRef.current;
      workerRef.current = null;
      window.setTimeout(() => w.terminate(), 25);
    }
  }, []);

  // Reset state & ensure worker terminates when modal closes (Section 8 RAM guarantee)
  useEffect(() => {
    if (!open) {
      terminateWorker();
      setPhase('idle');
      setDownloadDetail('');
      setDownloadPct(undefined);
      setProcessedCount(0);
      setTotalCount(0);
      setSuggestions([]);
      setFatalError('');
      setTimingInfo(null);
    }
  }, [open, terminateWorker]);

  useEffect(() => () => terminateWorker(), [terminateWorker]);

  const handleStop = () => {
    terminateWorker();
    setPhase(suggestions.length > 0 ? 'review' : 'idle');
  };

  const startClassification = async () => {
    if (eligibleCards.length === 0) return;

    terminateWorker();
    const requestId = createId('ai');
    activeRequestIdRef.current = requestId;
    const pinnedProjectId = projectId;
    setJobProjectId(pinnedProjectId);

    const queue = eligibleCards.map((c) => ({
      cardId: c.id,
      assetId: c.assetId!,
      title: c.title || c.source?.fileName || 'Ảnh',
      currentCategory: c.category,
    }));

    setPhase('loading-model');
    setDownloadDetail(dict.aiDownloading);
    setDownloadPct(undefined);
    setProcessedCount(0);
    setTotalCount(queue.length);
    setSuggestions([]);
    setFatalError('');
    setTimingInfo(null);

    const startedAt = performance.now();
    let wasFromCache = false;

    const worker = new Worker(
      new URL('../../workers/classify.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    const sendNextImage = async (index: number) => {
      if (activeRequestIdRef.current !== requestId) return;
      if (index >= queue.length) {
        const elapsed = Math.round(performance.now() - startedAt);
        setTimingInfo({ ms: elapsed, cached: wasFromCache });
        setPhase('review');
        terminateWorker(); // Free worker RAM immediately after job completes (W23)
        return;
      }

      const item = queue[index];
      try {
        const rawBlob = await getAssetBlob(item.assetId, true);
        if (!rawBlob) throw new Error('Không tìm thấy dữ liệu ảnh trong kho local.');
        const resizedBlob = await prepareInferenceImageBlob(rawBlob);
        const arrayBuf = await resizedBlob.arrayBuffer();
        if (activeRequestIdRef.current !== requestId) return;

        worker.postMessage(
          {
            type: 'classify',
            requestId,
            cardId: item.cardId,
            assetId: item.assetId,
            imageBytes: arrayBuf,
            mime: resizedBlob.type || 'image/jpeg',
          },
          [arrayBuf]
        );
      } catch (err) {
        if (activeRequestIdRef.current !== requestId) return;
        setSuggestions((prev) => [
          ...prev,
          {
            cardId: item.cardId,
            assetId: item.assetId,
            cardTitle: item.title,
            currentCategory: item.currentCategory,
            suggestedCategory: item.currentCategory,
            editedCategory: item.currentCategory,
            relativeScore: 0,
            selected: false,
            error: err instanceof Error ? err.message : 'Lỗi đọc ảnh.',
          },
        ]);
        setProcessedCount(index + 1);
        void sendNextImage(index + 1);
      }
    };

    let currentIndex = 0;

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.requestId !== activeRequestIdRef.current) return;

      if (msg.type === 'downloading') {
        setDownloadDetail(msg.detail);
        if (typeof msg.progress === 'number') setDownloadPct(msg.progress);
        return;
      }

      if (msg.type === 'ready') {
        wasFromCache = msg.fromCache;
        setPhase('running');
        currentIndex = 0;
        void sendNextImage(0);
        return;
      }

      if (msg.type === 'result') {
        const item = queue[currentIndex];
        setSuggestions((prev) => [
          ...prev,
          {
            cardId: msg.cardId,
            assetId: msg.assetId,
            cardTitle: item?.title || 'Ảnh',
            currentCategory: item?.currentCategory || 'other',
            suggestedCategory: msg.category,
            editedCategory: msg.category,
            relativeScore: msg.relativeScore,
            selected: true,
          },
        ]);
        currentIndex += 1;
        setProcessedCount(currentIndex);
        void sendNextImage(currentIndex);
        return;
      }

      if (msg.type === 'image-error') {
        const item = queue[currentIndex];
        setSuggestions((prev) => [
          ...prev,
          {
            cardId: msg.cardId,
            assetId: item?.assetId || '',
            cardTitle: item?.title || 'Ảnh',
            currentCategory: item?.currentCategory || 'other',
            suggestedCategory: item?.currentCategory || 'other',
            editedCategory: item?.currentCategory || 'other',
            relativeScore: 0,
            selected: false,
            error: msg.reason,
          },
        ]);
        currentIndex += 1;
        setProcessedCount(currentIndex);
        void sendNextImage(currentIndex);
        return;
      }

      if (msg.type === 'fatal') {
        setFatalError(msg.reason);
        setPhase('error');
        terminateWorker();
      }
    };

    worker.onerror = (ev) => {
      if (activeRequestIdRef.current !== requestId) return;
      setFatalError(ev.message || 'Web Worker gặp lỗi bất ngờ.');
      setPhase('error');
      terminateWorker();
    };

    worker.postMessage({
      type: 'start',
      requestId,
      modelConfig: {
        modelId: 'Xenova/clip-vit-base-patch32',
        dtype: 'q8',
      },
      labelPrompts: CATEGORY_PROMPTS,
    });
  };

  const selectedSuggestions = suggestions.filter((s) => s.selected && !s.error);

  const handleApply = () => {
    if (selectedSuggestions.length === 0) return;
    onApplyLabels(
      jobProjectId,
      selectedSuggestions.map((s) => ({
        cardId: s.cardId,
        assetId: s.assetId,
        originalCategory: s.currentCategory,
        newCategory: s.editedCategory,
      }))
    );
    onClose();
  };

  return (
    <DialogShell
      open={open}
      title={dict.aiTitle}
      subtitle={dict.aiSubtitle}
      width={680}
      closeLabel={dict.close}
      onClose={onClose}
      footer={
        <>
          {(phase === 'loading-model' || phase === 'running') && (
            <button type="button" className="btn btn-subtle" onClick={handleStop}>
              <Square size={14} />
              <span>{dict.aiStop}</span>
            </button>
          )}
          {phase === 'idle' && (
            <>
              <button type="button" className="btn btn-subtle" onClick={onClose}>
                {dict.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={eligibleCards.length === 0}
                onClick={startClassification}
              >
                <Sparkles size={15} />
                <span>{dict.aiStart}</span>
              </button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button type="button" className="btn btn-subtle" onClick={onClose}>
                {dict.close}
              </button>
              <button type="button" className="btn btn-primary" onClick={startClassification}>
                <RefreshCw size={14} />
                <span>{dict.retry}</span>
              </button>
            </>
          )}
          {phase === 'review' && (
            <>
              <button type="button" className="btn btn-subtle" onClick={onClose}>
                {dict.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={selectedSuggestions.length === 0}
                onClick={handleApply}
              >
                <CheckCircle2 size={15} />
                <span>{dict.aiApplySelected(selectedSuggestions.length)}</span>
              </button>
            </>
          )}
        </>
      }
    >
      {phase === 'idle' && (
        <div className="ai-idle-box">
          {eligibleCards.length === 0 ? (
            <p className="field-hint">{dict.aiNoImages}</p>
          ) : (
            <>
              <p className="ai-summary-line">{dict.aiReadyHint(eligibleCards.length, skippedCount)}</p>
              <div className="ai-model-chip-row">
                <span className="meta-pill">Xenova/clip-vit-base-patch32</span>
                <span className="meta-pill">dtype: q8 · WASM</span>
                <span className="meta-pill">Local Web Worker</span>
              </div>
              <p className="field-hint">{dict.aiReviewNote}</p>
            </>
          )}
        </div>
      )}

      {(phase === 'loading-model' || phase === 'running') && (
        <div className="ai-progress-box">
          <div className="ai-progress-head">
            <Loader2 size={17} className="spin" />
            <span>
              {phase === 'loading-model'
                ? dict.aiDownloading
                : dict.aiProcessing(processedCount, totalCount)}
            </span>
          </div>
          {phase === 'loading-model' && downloadDetail && (
            <div className="field-hint mono truncate">{downloadDetail}</div>
          )}
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width:
                  phase === 'loading-model'
                    ? `${Math.max(8, downloadPct ?? 18)}%`
                    : `${Math.round((processedCount / Math.max(1, totalCount)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="alert-box alert-box--danger">
          <AlertCircle size={16} />
          <div>
            <strong>Không thể hoàn tất phân loại AI</strong>
            <p>{fatalError}</p>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <div className="classify-review">
          {timingInfo && (
            <div className="ai-timing-banner">
              <span>{dict.aiColdWarmInfo(timingInfo.ms, timingInfo.cached)}</span>
              <span className="meta-pill">{dict.aiRamFreedBadge}</span>
            </div>
          )}
          <p className="field-hint">{dict.aiReviewNote}</p>
          <div className="classify-list">
            {suggestions.map((item) => (
              <div
                key={item.cardId}
                className={`classify-row ${item.error ? 'is-error' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={Boolean(item.error)}
                  onChange={(e) =>
                    setSuggestions((prev) =>
                      prev.map((s) =>
                        s.cardId === item.cardId ? { ...s, selected: e.target.checked } : s
                      )
                    )
                  }
                />
                <SuggestionThumb assetId={item.assetId} alt={item.cardTitle} />
                <div className="classify-row-info">
                  <div className="classify-row-title truncate">{item.cardTitle}</div>
                  {item.error ? (
                    <div className="field-error">{item.error}</div>
                  ) : (
                    <div className="classify-row-meta">
                      <span>{getCategoryLabel(dict, item.currentCategory)}</span>
                      <span>→</span>
                      <span className="classify-score">
                        {dict.aiRelativeScore}: {Math.round(item.relativeScore * 100)}%
                      </span>
                    </div>
                  )}
                </div>
                {!item.error && (
                  <AppleSelect<Category>
                    size="sm"
                    className="classify-select"
                    ariaLabel={dict.categoryLabel}
                    value={item.editedCategory}
                    options={CATEGORY_ORDER.map((cat) => ({
                      value: cat,
                      label: getCategoryLabel(dict, cat),
                      dotColor: CATEGORY_DOT_COLORS[cat],
                    }))}
                    onChange={(nextCat) => {
                      setSuggestions((prev) =>
                        prev.map((s) =>
                          s.cardId === item.cardId
                            ? { ...s, editedCategory: nextCat, selected: true }
                            : s
                        )
                      );
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </DialogShell>
  );
};
