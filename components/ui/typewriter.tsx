'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { clsx } from 'clsx';

type TypewriterProps = {
  text: string;
  /** 每个字的间隔，毫秒。 */
  speed?: number;
  startDelay?: number;
  showCaret?: boolean;
  className?: string;
};

/** 逐字打出文本；减少动态偏好下直接显示全文。 */
export function Typewriter({
  text,
  speed = 48,
  startDelay = 0,
  showCaret = true,
  className,
}: TypewriterProps) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduced) return;

    let interval = 0;
    const delay = window.setTimeout(() => {
      setCount(0);
      interval = window.setInterval(() => {
        setCount((current) => {
          if (current >= text.length) {
            window.clearInterval(interval);
            return current;
          }
          return current + 1;
        });
      }, speed);
    }, startDelay);

    return () => {
      window.clearTimeout(delay);
      window.clearInterval(interval);
    };
  }, [text, speed, startDelay, reduced]);

  const visible = reduced ? text : text.slice(0, count);
  const done = reduced || count >= text.length;

  return (
    <span className={clsx('inline', className)} aria-label={text}>
      <span aria-hidden>{visible}</span>
      {showCaret && !done ? (
        <span className="typewriter-caret ml-0.5 inline-block translate-y-[1px] text-brand" aria-hidden>
          |
        </span>
      ) : null}
    </span>
  );
}
