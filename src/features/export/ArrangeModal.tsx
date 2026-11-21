import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Palette,
  RefreshCw,
  Shuffle,
  Sparkles,
  Square,
} from 'lucide-react';
import {
  CATEGORY_ORDER,
  CATEGORY_PROMPTS,
  type ArrangeMode,
  type ArrangeOptions,
  type AspectPreset,
  type Card,
  type Category,
  type ClassifySuggestion,
} from '../../domain/types';
import { createId } from '../../domain/validate';
import { getCategoryLabel, type I18nDict } from '../../i18n';
import { prepareInferenceImageBlob } from '../../storage/assets';
import { getAssetBlob, resolveAssetUrl } from '../../storage/workspaceRepository';
import type { WorkerOutboundMessage } from '../../workers/classify.worker';
import { DialogShell } from '../common/DialogShell';

interface ArrangeModalProps {
  open: boolean;
  projectId: string;
  cards: Card[];
  selectedIds: string[];
  dict: I18nDict;
  onPreview: (opts: ArrangeOptions) => void;
  onClearPreview: () => void;
  onApply: (
    opts: ArrangeOptions,
    pendingAiUpdates?: Array<{
      cardId: string;
      assetId: string;
      originalCategory: Category;
      newCategory: Category;
    }>
  ) => void;
  onApplyLabels: (
    targetProjectId: string,
    updates: Array<{
      cardId: string;
      assetId: string;
      originalCategory: Category;
      newCategory: Category;
    }>
  ) => { applied: number; skippedChanged: number };
  onGenerateBoardPalette: () => void;
  onClose: () => void;
}

type AiPhase = 'idle' | 'loading' | 'running' | 'review' | 'error';

const MiniThumb: React.FC<{ assetId: string; alt: string }> = ({ assetId, alt }) => {
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
    <img src={url} alt={alt} className="arrange-ai-thumb" />
  ) : (
    <div className="arrange-ai-thumb" />
  );
};

export const ArrangeModal: React.FC<ArrangeModalProps> = ({
  open,
  projectId,
  cards,
  selectedIds,
  dict,
  onPreview,
  onClearPreview,
  onApply,
  onApplyLabels,
  onGenerateBoardPalette,
  onClose,
}) => {
  const [options, setOptions] = useState<ArrangeOptions>({
    mode: 'bento',
    groupByCategory: true,
    overlap: 55,
    galleryFrame: true,
    aspectPreset: 'free',
    seed: 0,
  });

  // Embedded local CLIP AI classification state
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiDetail, setAiDetail] = useState('');
  const [aiPct, setAiPct] = useState<number | undefined>(undefined);
  const [aiDone, setAiDone] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [aiError, setAiError] = useState('');
  const [suggestions, setSuggestions] = useState<ClassifySuggestion[]>([]);
  const [jobProjectId, setJobProjectId] = useState(projectId);

  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  const eligibleImages = useMemo(() => {
    const selSet = new Set(selectedIds);
    const boardImages = cards.filter((c) => !c.inbox && c.kind === 'image');
    const selectedImages = selSet.size > 0 ? boardImages.filter((c) => selSet.has(c.id)) : [];
    const pool = selectedImages.length > 0 ? selectedImages : boardImages;
    return pool.filter(
      (c) => Boolean(c.assetId) && c.imageStatus !== 'missing' && c.imageStatus !== 'remote-only'
    );
  }, [cards, selectedIds]);

  const unclassifiedImages = useMemo(
    () => eligibleImages.filter((c) => c.aiClassifiedAssetId !== c.assetId),
    [eligibleImages]
  );

  const allClassified = eligibleImages.length > 0 && unclassifiedImages.length === 0;

  const terminateWorker = useCallback(() => {
    activeRequestIdRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  // Always live-preview whenever the docked panel opens, options change, or cards update (e.g. after AI labels)
  useEffect(() => {
    if (!open) {
      terminateWorker();
      setAiPhase('idle');
      setAiDetail('');
      setAiPct(undefined);
      setAiDone(0);
      setAiTotal(0);
      setAiError('');
      setSuggestions([]);
      return;
    }
    onPreviewRef.current(options);
  }, [open, options, cards, terminateWorker]);

  useEffect(() => () => terminateWorker(), [terminateWorker]);

  const updateOptions = (patch: Partial<ArrangeOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  };

  const handleCancel = () => {
    terminateWorker();
    onClearPreview();
    onClose();
  };

  const handleApplyClick = () => {
    terminateWorker();
    const pendingUpdates =
      aiPhase === 'review' && jobProjectId === projectId
        ? suggestions
            .filter((s) => s.selected && !s.error)
            .map((s) => ({
              cardId: s.cardId,
              assetId: s.assetId,
              originalCategory: s.currentCategory,
              newCategory: s.editedCategory,
            }))
        : undefined;
    onApply(options, pendingUpdates);
    onClose();
  };

  const startAiClassify = async (forceRescanAll = false) => {
    const targetImages = forceRescanAll || unclassifiedImages.length === 0
      ? eligibleImages
      : unclassifiedImages;
    if (targetImages.length === 0) return;
    terminateWorker();
    const requestId = createId('ai');
    activeRequestIdRef.current = requestId;
    const pinnedProjectId = projectId;
    setJobProjectId(pinnedProjectId);

    const queue = targetImages.map((c) => ({
      cardId: c.id,
      assetId: c.assetId!,
      title: c.title || c.source?.fileName || dict.defaultImageTitle,
      currentCategory: c.category,
    }));

    setAiPhase('loading');
    setAiDetail('');
    setAiPct(undefined);
    setAiDone(0);
    setAiTotal(queue.length);
    setAiError('');
    setSuggestions([]);

    const worker = new Worker(
      new URL('../../workers/classify.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    const sendNext = async (idx: number) => {
      if (activeRequestIdRef.current !== requestId) return;
      if (idx >= queue.length) {
        setAiPhase('review');
        terminateWorker();
        return;
      }
      const item = queue[idx];
      try {
        const rawBlob = await getAssetBlob(item.assetId, true);
        if (!rawBlob) throw new Error(dict.aiMissingLocalImage);
        const resized = await prepareInferenceImageBlob(rawBlob);
        const buf = await resized.arrayBuffer();
        if (activeRequestIdRef.current !== requestId) return;
        worker.postMessage(
          {
            type: 'classify',
            requestId,
            cardId: item.cardId,
            assetId: item.assetId,
            imageBytes: buf,
            mime: resized.type || 'image/jpeg',
          },
          [buf]
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
            error: err instanceof Error ? err.message : dict.aiReadImageError,
          },
        ]);
        setAiDone(idx + 1);
        void sendNext(idx + 1);
      }
    };

    let currentIdx = 0;

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.requestId !== activeRequestIdRef.current) return;

      if (msg.type === 'downloading') {
        setAiDetail(msg.detail);
        if (typeof msg.progress === 'number') setAiPct(msg.progress);
        return;
      }
      if (msg.type === 'ready') {
        setAiPhase('running');
        currentIdx = 0;
        void sendNext(0);
        return;
      }
      if (msg.type === 'result') {
        const item = queue[currentIdx];
        setSuggestions((prev) => [
          ...prev,
          {
            cardId: msg.cardId,
            assetId: msg.assetId,
            cardTitle: item?.title || dict.defaultImageTitle,
            currentCategory: item?.currentCategory || 'other',
            suggestedCategory: msg.category,
            editedCategory: msg.category,
            relativeScore: msg.relativeScore,
            selected: true,
          },
        ]);
        currentIdx += 1;
        setAiDone(currentIdx);
        void sendNext(currentIdx);
        return;
      }
      if (msg.type === 'image-error') {
        const item = queue[currentIdx];
        setSuggestions((prev) => [
          ...prev,
          {
            cardId: msg.cardId,
            assetId: item?.assetId || '',
            cardTitle: item?.title || dict.defaultImageTitle,
            currentCategory: item?.currentCategory || 'other',
            suggestedCategory: item?.currentCategory || 'other',
            editedCategory: item?.currentCategory || 'other',
            relativeScore: 0,
            selected: false,
            error: msg.reason,
          },
        ]);
        currentIdx += 1;
        setAiDone(currentIdx);
        void sendNext(currentIdx);
        return;
      }
      if (msg.type === 'fatal') {
        setAiError(msg.reason);
        setAiPhase('error');
        terminateWorker();
      }
    };

    worker.onerror = (ev) => {
      if (activeRequestIdRef.current !== requestId) return;
      setAiError(ev.message || dict.aiWorkerError);
      setAiPhase('error');
      terminateWorker();
    };

    worker.postMessage({
      type: 'start',
      requestId,
      modelConfig: { modelId: 'Xenova/clip-vit-base-patch32', dtype: 'q8' },
      labelPrompts: CATEGORY_PROMPTS,
    });
  };

  const selectedAiItems = suggestions.filter((s) => s.selected && !s.error);

  const handleApplyAi = () => {
    if (selectedAiItems.length === 0) return;
    onApplyLabels(
      jobProjectId,
      selectedAiItems.map((s) => ({
        cardId: s.cardId,
        assetId: s.assetId,
        originalCategory: s.currentCategory,
        newCategory: s.editedCategory,
      }))
    );
    setAiPhase('idle');
    setSuggestions([]);
    // Immediately refresh live preview using the freshly updated categories
    onPreviewRef.current(options);
  };

  const archetypes: Array<{
    mode: ArrangeMode;
    title: string;
    desc: string;
  }> = [
    { mode: 'bento', title: dict.arrangeBento, desc: dict.arrangeBentoDesc },
    { mode: 'freeform', title: dict.arrangeFreeform, desc: dict.arrangeFreeformDesc },
    { mode: 'zones', title: dict.arrangeZones, desc: dict.arrangeZonesDesc },
    { mode: 'grid', title: dict.arrangeGrid, desc: dict.arrangeGridDesc },
  ];

  const scopeLabel =
    selectedIds.length > 0 ? dict.arrangeScopeSelection(selectedIds.length) : dict.arrangeScopeAll;

  return (
    <DialogShell
      open={open}
      title={dict.arrangeTitle}
      subtitle={scopeLabel}
      width={360}
      closeLabel={dict.close}
      onClose={handleCancel}
      nonBlocking
      footer={
        <>
          <button type="button" className="btn btn-subtle" onClick={handleCancel}>
            {dict.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApplyClick}>
            {dict.apply}
          </button>
        </>
      }
    >
      <div className="arrange-form">
        {/* Compact integrated AI Classification block */}
        <div className="arrange-ai-box">
          <div className="arrange-ai-head">
            <div className="arrange-ai-title">
              <Sparkles size={14} />
              <span>{dict.aiClassify}</span>
              {allClassified ? (
                <span className="arrange-ai-count is-done">
                  <CheckCircle2 size={11} />
                  <span>{dict.aiDoneBadge(eligibleImages.length)}</span>
                </span>
              ) : (
                <span className="arrange-ai-count">
                  {unclassifiedImages.length < eligibleImages.length
                    ? dict.aiNewCount(unclassifiedImages.length)
                    : dict.aiImageCount(unclassifiedImages.length)}
                </span>
              )}
            </div>

            {aiPhase === 'idle' && (
              <button
                type="button"
                className="btn-xs btn-subtle"
                disabled={eligibleImages.length === 0}
                onClick={() => void startAiClassify(allClassified)}
              >
                {allClassified ? <RefreshCw size={12} /> : <Sparkles size={12} />}
                <span>{allClassified ? dict.aiRescanBtn : dict.aiRunBtn}</span>
              </button>
            )}

            {(aiPhase === 'loading' || aiPhase === 'running') && (
              <button
                type="button"
                className="btn-xs btn-subtle"
                onClick={() => {
                  terminateWorker();
                  setAiPhase(suggestions.length > 0 ? 'review' : 'idle');
                }}
              >
                <Square size={11} />
                <span>{dict.aiStop}</span>
              </button>
            )}

            {aiPhase === 'error' && (
              <button
                type="button"
                className="btn-xs btn-subtle"
                onClick={() => void startAiClassify()}
              >
                <RefreshCw size={12} />
                <span>{dict.retry}</span>
              </button>
            )}

            {aiPhase === 'review' && (
              <button
                type="button"
                className="btn-xs btn-primary"
                disabled={selectedAiItems.length === 0}
                onClick={handleApplyAi}
              >
                <CheckCircle2 size={12} />
                <span>{dict.aiApplyCount(selectedAiItems.length)}</span>
              </button>
            )}
          </div>

          {(aiPhase === 'loading' || aiPhase === 'running') && (
            <div className="arrange-ai-progress">
              <div className="arrange-ai-status">
                <Loader2 size={13} className="spin" />
                <span className="truncate">
                  {aiPhase === 'loading'
                    ? aiDetail || dict.aiLoadingModel
                    : dict.aiProgressCount(aiDone, aiTotal)}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width:
                      aiPhase === 'loading'
                        ? `${Math.max(10, aiPct ?? 20)}%`
                        : `${Math.round((aiDone / Math.max(1, aiTotal)) * 100)}%`,
                  }}
                />
              </div>
              {aiPhase === 'loading' && (
                <div className="field-hint" style={{ marginTop: 4 }}>
                  {dict.aiFirstRunHint}
                </div>
              )}
            </div>
          )}

          {aiPhase === 'error' && <div className="field-error">{aiError}</div>}

          {aiPhase === 'review' && (
            <div className="arrange-ai-list">
              {suggestions.map((item) => (
                <div key={item.cardId} className="arrange-ai-row">
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
                  <MiniThumb assetId={item.assetId} alt={item.cardTitle} />
                  <span className="arrange-ai-name truncate" title={item.cardTitle}>
                    {item.cardTitle}
                  </span>
                  {item.error ? (
                    <span className="field-error">{item.error}</span>
                  ) : (
                    <select
                      className="input-sm arrange-ai-select"
                      value={item.editedCategory}
                      onChange={(e) => {
                        const nextCat = e.target.value as Category;
                        setSuggestions((prev) =>
                          prev.map((s) =>
                            s.cardId === item.cardId
                              ? { ...s, editedCategory: nextCat, selected: true }
                              : s
                          )
                        );
                      }}
                    >
                      {CATEGORY_ORDER.map((cat) => (
                        <option key={cat} value={cat}>
                          {getCategoryLabel(dict, cat)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compact Layout Style Dropdown + Instant Art-Direction Shuffle */}
        <div className="field">
          <span className="field-label">{dict.arrangeModeLabel}</span>
          <div className="arrange-mode-row">
            <select
              className="input-sm flex-1"
              value={options.mode}
              onChange={(e) => updateOptions({ mode: e.target.value as ArrangeMode })}
            >
              {archetypes.map((a) => (
                <option key={a.mode} value={a.mode}>
                  {a.title} — {a.desc}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn-sm arrange-shuffle-btn"
              title={dict.arrangeShuffle}
              aria-label={dict.arrangeShuffle}
              onClick={() => updateOptions({ seed: ((options.seed ?? 0) + 1) % 100 })}
            >
              <Shuffle size={14} />
            </button>
          </div>
        </div>

        <label className="toggle-row">
          <span>{dict.arrangeGroupByCat}</span>
          <input
            type="checkbox"
            checked={options.groupByCategory}
            onChange={(e) => updateOptions({ groupByCategory: e.target.checked })}
          />
        </label>

        {options.mode !== 'grid' && (
          <>
            <div className="field">
              <div className="field-row-between">
                <span className="field-label">{dict.arrangeOverlap}</span>
                <span className="mono">{options.overlap}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={options.overlap}
                onChange={(e) => updateOptions({ overlap: Number(e.target.value) })}
              />
            </div>

            <label className="toggle-row">
              <span>{dict.arrangeGalleryFrame}</span>
              <input
                type="checkbox"
                checked={options.galleryFrame ?? true}
                onChange={(e) => updateOptions({ galleryFrame: e.target.checked })}
              />
            </label>
          </>
        )}

        <label className="field">
          <span className="field-label">{dict.aspectPresetLabel}</span>
          <select
            className="input-sm"
            value={options.aspectPreset ?? 'free'}
            onChange={(e) => updateOptions({ aspectPreset: e.target.value as AspectPreset })}
          >
            <option value="free">{dict.aspectFree}</option>
            <option value="16:9">{dict.aspect16x9}</option>
            <option value="a4">{dict.aspectA4}</option>
            <option value="1:1">{dict.aspect1x1}</option>
          </select>
        </label>

        {eligibleImages.length > 0 && (
          <button
            type="button"
            className="btn-xs btn-subtle full-width"
            onClick={onGenerateBoardPalette}
          >
            <Palette size={13} />
            <span>{dict.boardPaletteBtn}</span>
          </button>
        )}
      </div>
    </DialogShell>
  );
};
