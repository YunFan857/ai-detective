import type { Tier } from '@/types/case';

/**
 * 卷宗页的四个办案步骤。
 * 颜色只在这里定义，组件通过 stepById / STEPS 取值，不再各自写一份。
 */
export const STEPS = [
  { id: 1, name: '起点', color: '#1F2329', soft: '#EEF0F2' },
  { id: 2, name: '官方', color: '#00B259', soft: '#E6F7EE' },
  { id: 3, name: '媒体', color: '#366EF4', soft: '#EAF0FE' },
  { id: 4, name: '自媒体', color: '#E37318', soft: '#FDF0E5' },
] as const satisfies readonly { id: number; name: string; color: string; soft: string }[];

export type StepId = (typeof STEPS)[number]['id'];
export type Step = (typeof STEPS)[number];

/**
 * 来源等级 → 办案步骤。
 * 官方/学术落在「官方」，权威媒体落在「媒体」，其余都归入「自媒体」。
 */
export function stepOfTier(tier: Tier): StepId {
  switch (tier) {
    case 'official':
      return 2;
    case 'media':
      return 3;
    case 'self':
    case 'marketing':
    case 'unknown':
      return 4;
  }
}

/** 按步骤 id 取步骤定义，供步骤条、图例和顶部胶囊共用。 */
export function stepById(id: StepId): Step {
  return STEPS[id - 1];
}
