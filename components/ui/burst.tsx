'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { clsx } from 'clsx';

export type BurstTone = 'brand' | 'orange' | 'red' | 'blue' | 'gray';
export type BurstSize = 'sm' | 'md' | 'lg';

const TONE_CLASSES: Record<BurstTone, string> = {
  brand: 'fill-brand',
  orange: 'fill-orange',
  red: 'fill-red',
  blue: 'fill-blue',
  gray: 'fill-gray',
};

const SIZE_CLASSES: Record<BurstSize, { box: string; text: string }> = {
  sm: { box: 'h-28 w-28', text: 'text-base' },
  md: { box: 'h-40 w-40', text: 'text-xl' },
  lg: { box: 'h-56 w-56', text: 'text-3xl' },
};

const POINTS = (() => {
  const teeth = 11;
  return Array.from({ length: teeth * 2 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / (teeth * 2) - Math.PI / 2;
    const radius = index % 2 === 0 ? 50 : 37;
    return `${(50 + Math.cos(angle) * radius).toFixed(2)},${(50 + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
})();

type BurstProps = {
  label: string;
  tone?: BurstTone;
  size?: BurstSize;
  className?: string;
};

/** 爆炸形印章：锯齿描边 + 花字，入场时像盖章一样压下来。 */
export function Burst({ label, tone = 'orange', size = 'md', className }: BurstProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={clsx('relative inline-grid place-items-center', SIZE_CLASSES[size].box, className)}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.5, rotate: -14 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 320, damping: 18 }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon
          points={POINTS}
          className={TONE_CLASSES[tone]}
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={clsx(
          'huazi huazi-ink relative max-w-[76%] -rotate-6 text-center',
          SIZE_CLASSES[size].text,
        )}
      >
        {label}
      </span>
    </motion.div>
  );
}
