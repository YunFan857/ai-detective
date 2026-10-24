import type { CaseEvent } from '@/types/case';

/** 带播放间隔离场的演示事件：delayMs 表示距上一条事件播放的等待时长。 */
export type PlayableEvent = CaseEvent & { delayMs?: number };

/**
 * 按 delayMs 逐条回放演示事件，供前端脱离后端独立开发。
 * speed 越大播放越快（2 表示两倍速）。
 * 返回取消函数，可随时中止尚未播放的事件。
 */
export function playEvents(
  events: PlayableEvent[],
  onEvent: (event: CaseEvent) => void,
  speed = 1,
): () => void {
  const rate = speed > 0 ? speed : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let index = 0;

  const step = () => {
    if (cancelled || index >= events.length) return;

    const { delayMs = 0, ...event } = events[index];
    index += 1;

    timer = setTimeout(() => {
      if (cancelled) return;
      onEvent(event);
      step();
    }, Math.max(0, delayMs / rate));
  };

  step();

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
