import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ComicButtonVariant = 'brand' | 'orange' | 'red' | 'white' | 'ink';
export type ComicButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ComicButtonVariant, string> = {
  brand: 'bg-brand text-white shadow-ink',
  orange: 'bg-orange text-white shadow-ink',
  red: 'bg-red text-white shadow-ink',
  white: 'bg-card text-ink shadow-ink',
  ink: 'bg-ink text-white shadow-brand',
};

const SIZE_CLASSES: Record<ComicButtonSize, string> = {
  sm: 'px-3.5 py-1.5 text-sm gap-1.5',
  md: 'px-5 py-2 text-base gap-2',
  lg: 'px-7 py-3 text-lg gap-2.5',
};

type ComicButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ComicButtonVariant;
  size?: ComicButtonSize;
  children: ReactNode;
};

/** 漫画风按钮：3px 黑描边 + 硬投影，按下时整体位移 3px。 */
export function ComicButton({
  variant = 'brand',
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: ComicButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded-full border-[3px] border-ink font-black tracking-wide',
        'transition-[transform,box-shadow] duration-150',
        'hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        'disabled:hover:translate-y-0 disabled:active:translate-x-0 disabled:active:translate-y-0',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-dark',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
