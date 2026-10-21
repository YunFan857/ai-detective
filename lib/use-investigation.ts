'use client';

/**
 * 调查事件流订阅 Hook。
 * TODO(PRD 步骤 1-7)：订阅 /api/investigate 的事件流并暴露卷宗状态。
 */
export type InvestigationState = {
  status: 'idle' | 'running' | 'done' | 'error';
};

export function useInvestigation(): InvestigationState {
  return { status: 'idle' };
}
