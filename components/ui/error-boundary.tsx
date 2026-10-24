'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clsx } from 'clsx';

export type ErrorBoundaryProps = {
  children: ReactNode;
  /** 区域名，用于控制台定位和 aria-label。 */
  label: string;
  /** 损毁占位额外尺寸类，保证出错时原布局不塌。 */
  className?: string;
};

type ErrorBoundaryState = {
  failed: boolean;
};

/**
 * 区域级错误边界：任一子组件抛错时只替换该区域，
 * 页面其他部分继续正常渲染。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[证物损毁] ${this.props.label}`, error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        aria-label={`${this.props.label}：此处证物损毁`}
        className={clsx(
          'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink/30 bg-card/80 px-3 py-2 text-center',
          this.props.className,
        )}
      >
        <p className="text-xs font-black text-muted">此处证物损毁</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="rounded-full border-2 border-ink bg-card px-2.5 py-0.5 text-[10px] font-black text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5"
        >
          重试
        </button>
      </div>
    );
  }
}
