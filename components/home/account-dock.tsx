'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Gift, Settings, Wallet, X } from 'lucide-react';

/** 演示账号：没有登录与积分后台，签到和余额只在本地面板里变化。 */
const INITIAL_POINTS = 120;
const CHECKIN_POINTS = 10;

export function AccountDock() {
  const [open, setOpen] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [points, setPoints] = useState(INITIAL_POINTS);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function handleCheckIn() {
    if (checkedIn) return;
    setCheckedIn(true);
    setPoints((value) => value + CHECKIN_POINTS);
  }

  return (
    <div ref={rootRef} className="fixed bottom-5 left-5 z-50">
      {open ? (
        <div
          role="dialog"
          aria-label="演示账号"
          className="mb-3 max-h-[calc(100dvh-7rem)] w-[300px] max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl border-[3px] border-ink bg-card p-4 shadow-ink-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft">
                <img src="/images/detective-logo.png" alt="" className="h-9 w-9 object-contain" />
              </span>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-black">
                  演示账号
                  <span className="rounded border border-ink bg-tangerine px-1 py-px text-[9px] font-black text-white">
                    DEMO
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted">未登录 · 体验版</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭账号面板"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-card text-ink transition-transform hover:-translate-y-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 rounded-xl border-2 border-ink bg-beige px-3 py-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-muted">积分余额</p>
                <p className="text-2xl leading-tight font-black">
                  {points}
                  <span className="ml-1 text-xs font-bold text-muted">积分</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotice('积分充值功能开发中，敬请期待')}
                className="flex items-center gap-1 rounded-full border-2 border-ink bg-brand px-3 py-1 text-xs font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5"
              >
                <Wallet className="h-3.5 w-3.5" />
                积分充值
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-card px-3 py-2.5">
            <p className="text-xs font-bold">每日签到领取 10 积分</p>
            <button
              type="button"
              disabled={checkedIn}
              onClick={handleCheckIn}
              className={`shrink-0 rounded-full border-2 border-ink px-3 py-1 text-xs font-black shadow-ink-sm transition-transform ${
                checkedIn
                  ? 'cursor-default bg-gray-soft text-muted shadow-none'
                  : 'bg-coral text-white hover:-translate-y-0.5'
              }`}
            >
              {checkedIn ? '已签到 ✓' : '签到'}
            </button>
          </div>

          <ul className="mt-2.5 divide-y divide-ink/10 rounded-xl border-2 border-ink px-3">
            <li>
              <button
                type="button"
                onClick={() => setNotice('设置功能开发中，敬请期待')}
                className="flex w-full items-center gap-2 py-2.5 text-left text-xs font-bold hover:text-brand-deep"
              >
                <Settings className="h-4 w-4 text-muted" />
                设置
                <ChevronRight className="ml-auto h-4 w-4 text-muted" />
              </button>
            </li>
            <li>
              <div className="flex items-center gap-2 py-2.5 text-xs font-bold text-muted">
                <Gift className="h-4 w-4" />
                邀请好友得积分
                <span className="ml-auto rounded border border-ink bg-gray-soft px-1.5 py-px text-[10px] font-black text-muted">
                  功能开发中
                </span>
              </div>
            </li>
          </ul>

          {notice ? (
            <p role="status" className="mt-2.5 text-[11px] font-bold text-coral">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setNotice(null);
        }}
        aria-expanded={open}
        aria-label={open ? '收起账号面板' : '打开账号面板'}
        className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-ink bg-brand-soft shadow-ink transition-transform hover:-translate-y-0.5 active:translate-y-0 sm:h-14 sm:w-14"
      >
        <img
          src="/images/detective-logo.png"
          alt=""
          className="h-9 w-9 object-contain sm:h-11 sm:w-11"
        />
      </button>
    </div>
  );
}
