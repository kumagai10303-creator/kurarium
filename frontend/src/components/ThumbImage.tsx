import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { thumbUrl } from '../api';

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  itemId: number;
  retry?: boolean;
  onDimensions?: (ratio: number) => void;
}

export function ThumbImage({
  itemId,
  retry = true,
  className = '',
  onDimensions,
  onLoad,
  onError,
  ...rest
}: ThumbImageProps) {
  const [attempt, setAttempt] = useState(0);
  // 読み込み済みの itemId を保持する。boolean の loaded を effect で
  // リセットすると、キャッシュ済み画像の onLoad が effect より先に
  // 発火した場合に白いままになるため、itemId から導出する。
  const [loadedItemId, setLoadedItemId] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);
  const loaded = loadedItemId === itemId;
  const previousItemId = useRef(itemId);

  useEffect(() => {
    if (previousItemId.current === itemId) return;
    previousItemId.current = itemId;
    setAttempt(0);
    setErrored(false);
  }, [itemId]);

  useEffect(() => {
    if (!retry || !errored || loaded || attempt >= 30) return;
    const timer = window.setTimeout(() => {
      setErrored(false);
      setAttempt((n) => n + 1);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [attempt, errored, loaded, retry]);

  const src = `${thumbUrl(itemId)}${attempt > 0 ? `&r=${attempt}` : ''}`;

  return (
    <img
      {...rest}
      src={src}
      className={className}
      style={{ ...rest.style, opacity: loaded ? rest.style?.opacity : 0 }}
      onLoad={(event) => {
        setLoadedItemId(itemId);
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
          onDimensions?.(naturalWidth / naturalHeight);
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        setErrored(true);
        onError?.(event);
      }}
    />
  );
}
