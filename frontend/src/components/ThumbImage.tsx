import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { thumbUrl } from '../api';

interface ThumbImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  itemId: number;
  retry?: boolean;
}

export function ThumbImage({
  itemId,
  retry = true,
  className = '',
  onLoad,
  onError,
  ...rest
}: ThumbImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setLoaded(false);
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
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setErrored(true);
        onError?.(event);
      }}
    />
  );
}
