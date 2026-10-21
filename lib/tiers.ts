/**
 * 来源分级与同源合并。
 * TODO(PRD 步骤 4)：来源可信度分级、同源转载识别与合并。
 */
export type SourceTier = 1 | 2 | 3 | 4 | 5;

export function gradeSourceTier(url: string): SourceTier {
  throw new Error(`TODO(PRD 步骤 4)：lib/tiers.ts 尚未实现（${url}）`);
}
