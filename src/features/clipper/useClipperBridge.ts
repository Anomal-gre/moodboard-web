import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../domain/types';
import type { ClipReceipt } from '../../storage/projectWrites';
import { createClipReceiver } from './receiveWebClip';
import { isClipId, type ClipDestination } from './clipProtocol';

const LOCAL_APP_HEADERS = { 'Content-Type': 'application/json', 'X-Mosa-App': '1' };

function onLoopback(): boolean {
  return location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

export async function requestLocalClipperCode(): Promise<string> {
  const response = await fetch('/__mosa_clip/pair', { method: 'POST', headers: LOCAL_APP_HEADERS });
  if (!response.ok) throw new Error('Local Mosa bridge unavailable');
  const result = await response.json() as { token?: string };
  if (!result.token) throw new Error('Local Mosa bridge unavailable');
  return result.token;
}

interface BridgeOptions {
  enabled: boolean;
  language: 'vi' | 'en';
  destination?: ClipDestination;
  canReceive: (projectId: string) => boolean;
  onCommit: (card: Card, projectId: string, clipId: string) => Promise<boolean>;
}

export function useClipperBridge({ enabled, language, destination, canReceive, onCommit }: BridgeOptions) {
  const [direct, setDirect] = useState(false);
  const [pairedLocal, setPairedLocal] = useState(false);
  const local = onLoopback();
  const options = useRef({ language, destination, canReceive, onCommit });
  options.current = { language, destination, canReceive, onCommit };
  const receiver = useRef<ReturnType<typeof createClipReceiver> | null>(null);
  if (!receiver.current) {
    receiver.current = createClipReceiver(
      (card, id, clipId) => options.current.onCommit(card, id, clipId),
      (id) => options.current.canReceive(id),
    );
  }

  useEffect(() => {
    if (!enabled || window.top !== window) return;
    const receive = receiver.current!;
    const announce = () => window.postMessage({ type: 'MOSA_APP_READY', version: 2 }, location.origin);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.version !== 2) return;
      const message = event.data;
      if (message.type === 'MOSA_EXT_HELLO') {
        setDirect(true);
        return;
      }
      if (message.type !== 'MOSA_EXT_CLIP_PUSH' || !isClipId(message.requestId)) return;
      setDirect(true);
      const reply = (receipt?: ClipReceipt) => {
        window.postMessage({
          type: 'MOSA_APP_CLIP_ACK',
          version: 2,
          requestId: message.requestId,
          receipt,
        }, location.origin);
      };
      void receive(message.clip, message.projectId).then(reply, () => reply());
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('mosa-clipper-retry', announce);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('mosa-clipper-retry', announce);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || window.top !== window) return;
    const { dataset } = document.documentElement;
    dataset.mosaApp = '1';
    dataset.mosaLang = language;
    dataset.mosaProjectId = destination?.projectId || '';
    dataset.mosaProjectName = destination?.projectName || '';
    window.postMessage({ type: 'MOSA_APP_READY', version: 2 }, location.origin);
    return () => {
      delete dataset.mosaApp;
      delete dataset.mosaLang;
      delete dataset.mosaProjectId;
      delete dataset.mosaProjectName;
    };
  }, [enabled, language, destination?.projectId, destination?.projectName]);

  useEffect(() => {
    if (!enabled || !local || window.top !== window) return;
    const controller = new AbortController();
    const receive = receiver.current!;
    let busy = false;
    let activity = Date.now();
    let previousProjectId: string | undefined;
    let interval: number | undefined;
    const pulse = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const { destination, language } = options.current;
        if (previousProjectId !== destination?.projectId) {
          previousProjectId = destination?.projectId;
          activity = Date.now();
        }
        const response = await fetch('/__mosa_clip/app', {
          method: 'POST',
          headers: LOCAL_APP_HEADERS,
          signal: controller.signal,
          body: JSON.stringify({ language, destination, activity }),
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          window.clearInterval(interval);
          return;
        }
        const data = await response.json() as {
          paired?: boolean;
          items?: Array<{ clip: unknown; projectId: unknown }>;
        };
        setPairedLocal(data.paired === true);
        for (const item of data.items ?? []) {
          if (controller.signal.aborted) break;
          const clipId = (item.clip as { id?: unknown } | null)?.id;
          if (!isClipId(clipId)) continue;
          try {
            const receipt = await receive(item.clip, item.projectId);
            if (receipt) {
              await fetch('/__mosa_clip/ack', {
                method: 'POST',
                headers: LOCAL_APP_HEADERS,
                signal: controller.signal,
                body: JSON.stringify({ clipId, receipt }),
              });
            }
          } catch {
            // The extension retains the clip until the database confirms it.
          }
        }
      } catch {
        // The local bridge may be restarting.
      } finally {
        busy = false;
      }
    };
    const focus = () => {
      activity = Date.now();
      void pulse();
    };
    interval = window.setInterval(() => void pulse(), 1800);
    window.addEventListener('focus', focus);
    void pulse();
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
    };
  }, [enabled, local]);

  return { bridgeAvailable: direct || pairedLocal, localPairingAvailable: local };
}
