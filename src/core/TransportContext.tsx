import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Transport } from './audio';
import { useStudio } from './store';

interface TransportCtx {
  transport: Transport;
}

const Ctx = createContext<TransportCtx | null>(null);

/** 全局唯一 Transport，随当前工程切换自动加载音频 */
export function TransportProvider({ children }: { children: ReactNode }) {
  const transportRef = useRef<Transport>();
  if (!transportRef.current) transportRef.current = new Transport();
  // 无音频分支会重建实例，用 state 触发消费方拿到新引用
  const [, bump] = useState(0);
  const currentId = useStudio((s) => s.current?.id);
  const audioBlobId = useStudio((s) => s.current?.audio?.blobId);

  useEffect(() => {
    let cancelled = false;
    const t = transportRef.current!;
    t.setLoop(null);
    t.seek(0);
    if (audioBlobId) {
      void t.loadFromStorage(audioBlobId).then((ok) => {
        if (!ok && !cancelled) console.warn('音频 Blob 丢失，将以静音模式播放');
      });
    } else {
      // 无音频：保留同一实例，仅清空缓冲（避免 ref 悬空）
      t.clearBuffer();
    }
    bump((n) => n + 1);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, audioBlobId]);

  useEffect(() => () => transportRef.current?.dispose(), []);

  const value = useMemo(() => ({ transport: transportRef.current! }), [transportRef.current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTransport(): Transport {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTransport 必须在 TransportProvider 内使用');
  return v.transport;
}
