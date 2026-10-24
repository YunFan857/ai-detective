'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * 首页背景：顶部放射线 + 绿色网点，缓慢漂移。
 * 只动 transform / opacity；系统开启减弱动效时保持静止。
 */
export function HomeBackground() {
  const reduced = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="paper-rays absolute inset-0"
        style={{ transformOrigin: '50% 0%' }}
        animate={reduced ? undefined : { scale: [1, 1.035, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 16, ease: 'easeInOut', repeat: Infinity }}
      />
      <motion.div
        className="paper-dots absolute inset-x-0 -top-6 -bottom-6"
        animate={reduced ? undefined : { y: [0, 14] }}
        transition={{ duration: 7, ease: 'linear', repeat: Infinity }}
      />
    </div>
  );
}
