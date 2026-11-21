import { pipeline, env, RawImage } from '@huggingface/transformers';
import type { Category } from '../domain/types';

// Configure browser-safe local cache & disable local FS model lookup
env.allowLocalModels = false;
env.useBrowserCache = true;

export interface WorkerStartMessage {
  type: 'start';
  requestId: string;
  modelConfig: {
    modelId: string;
    dtype: 'q8' | 'fp32';
  };
  labelPrompts: Record<Category, string>;
}

export interface WorkerClassifyMessage {
  type: 'classify';
  requestId: string;
  cardId: string;
  assetId: string;
  imageBytes: ArrayBuffer;
  mime: string;
}

export interface WorkerDisposeMessage {
  type: 'dispose';
}

export type WorkerInboundMessage =
  | WorkerStartMessage
  | WorkerClassifyMessage
  | WorkerDisposeMessage;

export type WorkerOutboundMessage =
  | { type: 'ready'; requestId: string; fromCache: boolean }
  | { type: 'downloading'; requestId: string; detail: string; progress?: number }
  | {
      type: 'result';
      requestId: string;
      cardId: string;
      assetId: string;
      category: Category;
      relativeScore: number;
    }
  | { type: 'image-error'; requestId: string; cardId: string; reason: string }
  | { type: 'fatal'; requestId: string; reason: string };

type ZeroShotClassifier = ((
  image: RawImage,
  candidateLabels: string[]
) => Promise<Array<{ label: string; score: number }>>) & {
  dispose?: () => Promise<void>;
};

let classifier: ZeroShotClassifier | null = null;
let loadedModelId: string | null = null;
let activePrompts: Record<Category, string> | null = null;
let promptToCategory = new Map<string, Category>();
let candidateList: string[] = [];

self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'dispose') {
    try {
      if (classifier && typeof classifier.dispose === 'function') {
        await classifier.dispose();
      }
    } catch {
      // ignore
    } finally {
      classifier = null;
      loadedModelId = null;
      activePrompts = null;
      promptToCategory.clear();
      candidateList = [];
    }
    return;
  }

  if (msg.type === 'start') {
    const { requestId, modelConfig, labelPrompts } = msg;
    activePrompts = labelPrompts;
    promptToCategory = new Map<string, Category>();
    candidateList = [];
    for (const [cat, prompt] of Object.entries(labelPrompts) as Array<[Category, string]>) {
      promptToCategory.set(prompt, cat);
      candidateList.push(prompt);
    }

    try {
      let sawDownload = false;
      if (!classifier || loadedModelId !== modelConfig.modelId) {
        const pipe = await pipeline(
          'zero-shot-image-classification',
          modelConfig.modelId,
          {
            dtype: modelConfig.dtype,
            device: 'wasm',
            progress_callback: (info: {
              status?: string;
              file?: string;
              progress?: number;
            }) => {
              if (info.status === 'download' || info.status === 'progress') {
                sawDownload = true;
                const pct =
                  typeof info.progress === 'number' ? Math.round(info.progress) : undefined;
                const detail = info.file
                  ? `${info.file}${pct !== undefined ? ` (${pct}%)` : ''}`
                  : 'Đang tải tệp mô hình...';
                self.postMessage({
                  type: 'downloading',
                  requestId,
                  detail,
                  progress: pct,
                } satisfies WorkerOutboundMessage);
              }
            },
          }
        );
        classifier = pipe as unknown as ZeroShotClassifier;
        loadedModelId = modelConfig.modelId;
      }

      self.postMessage({
        type: 'ready',
        requestId,
        fromCache: !sawDownload,
      } satisfies WorkerOutboundMessage);
    } catch (err) {
      self.postMessage({
        type: 'fatal',
        requestId,
        reason: err instanceof Error ? err.message : 'Không thể tải mô hình AI CLIP.',
      } satisfies WorkerOutboundMessage);
    }
    return;
  }

  if (msg.type === 'classify') {
    const { requestId, cardId, assetId, imageBytes, mime } = msg;
    if (!classifier || !activePrompts || candidateList.length === 0) {
      self.postMessage({
        type: 'image-error',
        requestId,
        cardId,
        reason: 'Mô hình chưa sẵn sàng.',
      } satisfies WorkerOutboundMessage);
      return;
    }

    try {
      const blob = new Blob([imageBytes], { type: mime || 'image/jpeg' });
      const rawImage = await RawImage.fromBlob(blob);
      const outputs = await classifier(rawImage, candidateList);
      const best = Array.isArray(outputs) && outputs.length > 0 ? outputs[0] : null;
      if (!best) {
        throw new Error('Mô hình không trả về kết quả.');
      }
      const category = promptToCategory.get(best.label) ?? 'other';
      self.postMessage({
        type: 'result',
        requestId,
        cardId,
        assetId,
        category,
        relativeScore: Math.round(best.score * 1000) / 1000,
      } satisfies WorkerOutboundMessage);
    } catch (err) {
      self.postMessage({
        type: 'image-error',
        requestId,
        cardId,
        reason: err instanceof Error ? err.message : 'Không thể phân loại ảnh này.',
      } satisfies WorkerOutboundMessage);
    }
  }
};
