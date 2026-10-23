/**
 * 搜索词生成回归脚本。
 * 用桩函数覆盖正常输出、字段错误后修复、修复仍失败兜底三类路径，不发起真实模型或搜索请求。
 * 运行：pnpm exec tsx scripts/test-search-queries.ts
 */
import type { ChatJsonOptions } from '../lib/llm';
import { planClaimQueries, type SearchDeps } from '../lib/pipeline/search';
import type { CaseEvent, Claim } from '../types/case';

const CLAIM: Claim = {
  id: 'c1',
  text: '秦始皇陵至今没有被挖掘，是因为里面有大量水银',
  kind: 'causal',
};

const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
  if (!ok) {
    failures.push(name);
  }
}

type ChatStub = SearchDeps & {
  calls: ChatJsonOptions<unknown>[];
};

/** 按调用顺序返回预设输出；输出为 Error 时模拟模型调用失败。 */
function createDeps(outputs: unknown[]): ChatStub {
  const calls: ChatJsonOptions<unknown>[] = [];
  return {
    calls,
    chat: async (options) => {
      calls.push(options);
      const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      if (output instanceof Error) {
        throw output;
      }
      return output;
    },
  };
}

function fallbackCon(text: string): string[] {
  return [`${text} 辟谣`, `${text} 真相 原文 出处`];
}

async function main(): Promise<void> {
  // 1. 正常 {pro, con} 输出
  {
    const deps = createDeps([
      {
        pro: ['秦始皇陵 水银 证据', '秦始皇陵 未发掘 原因'],
        con: ['秦始皇陵 水银 辟谣', '秦始皇陵 真相 原文 出处'],
      },
    ]);
    const events: CaseEvent[] = [];
    const plan = await planClaimQueries(CLAIM, (event) => events.push(event), deps, true);

    check('正常输出只调用一次模型', deps.calls.length === 1);
    check(
      '演示模式取 1 条 pro + 2 条 con',
      plan.pro.length === 1 &&
        plan.con.length === 2 &&
        plan.pro[0] === '秦始皇陵 水银 证据' &&
        plan.con[0] === '秦始皇陵 水银 辟谣' &&
        plan.con[1] === '秦始皇陵 真相 原文 出处',
    );
    check('正常输出不触发修复或兜底', !plan.repaired && !plan.fallback);
    check('正常输出不产生错误事件', !events.some((event) => event.type === 'error'));
  }

  // 1b. 非演示模式取 2 条 pro + 2 条 con
  {
    const deps = createDeps([
      {
        pro: ['秦始皇陵 水银 证据', '秦始皇陵 未发掘 原因'],
        con: ['秦始皇陵 水银 辟谣', '秦始皇陵 真相 原文 出处'],
      },
    ]);
    const plan = await planClaimQueries(CLAIM, () => {}, deps, false);
    check('非演示模式取 2 条 pro + 2 条 con', plan.pro.length === 2 && plan.con.length === 2);
  }

  // 2. 模型返回 {queries: [...]}，先走一次修复
  {
    const deps = createDeps([
      { queries: ['秦始皇陵 水银'] },
      { pro: ['修复后 pro'], con: ['修复后 辟谣', '修复后 真相 原文 出处'] },
    ]);
    const events: CaseEvent[] = [];
    const plan = await planClaimQueries(CLAIM, (event) => events.push(event), deps, true);

    check('{queries} 先触发一次修复请求', deps.calls.length === 2);
    check(
      '修复请求携带上一次输出与校验错误',
      (deps.calls[1]?.user ?? '').includes('queries') &&
        (deps.calls[1]?.user ?? '').includes('校验错误'),
    );
    check('修复成功后不兜底', plan.repaired && !plan.fallback);
    check(
      '修复结果按 1 pro + 2 con 取用',
      plan.pro.length === 1 && plan.con.length === 2 && plan.pro[0] === '修复后 pro',
    );
    check(
      '校验失败日志包含脱敏后的原始键名',
      events.some((event) => event.type === 'error' && event.message.includes('"queries"')),
      events.find((event) => event.type === 'error')?.message ?? '',
    );
  }

  // 3. 修复仍失败，使用确定性兜底
  {
    const deps = createDeps([{ queries: ['秦始皇陵 水银'] }, { keywords: ['秦始皇陵'] }]);
    const events: CaseEvent[] = [];
    const plan = await planClaimQueries(CLAIM, (event) => events.push(event), deps, true);

    check('修复仍失败时不再调用模型', deps.calls.length === 2);
    check('修复仍失败时使用确定性兜底', plan.fallback && !plan.repaired);
    check(
      '兜底固定 1 条 pro + 2 条 con',
      plan.pro.length === 1 &&
        plan.con.length === 2 &&
        plan.pro[0] === CLAIM.text &&
        plan.con[0] === fallbackCon(CLAIM.text)[0] &&
        plan.con[1] === fallbackCon(CLAIM.text)[1],
    );
    check(
      '兜底 emit 可见阶段消息',
      events.some(
        (event) =>
          event.type === 'stage' && event.message.includes('搜索词生成异常，已使用保守兜底检索词'),
      ),
    );
  }

  // 4. 各种错误结构都不得让疑点得到 0 条查询
  const malformed: { label: string; output: unknown }[] = [
    { label: 'null', output: null },
    { label: '空数组', output: [] },
    { label: '空对象', output: {} },
    { label: '空 pro/con', output: { pro: [], con: [] } },
    { label: '非数组字段', output: { pro: '搜索词', con: '搜索词' } },
    { label: 'support/refute', output: { support: ['甲'], refute: ['乙'] } },
    { label: 'keywords', output: { keywords: ['甲'] } },
    { label: 'queries', output: { queries: ['甲'] } },
    { label: '含空字符串', output: { pro: ['甲', ''], con: ['乙 辟谣'] } },
    { label: '多余字段', output: { pro: ['甲'], con: ['乙 辟谣'], reason: '解释' } },
  ];

  for (const item of malformed) {
    const deps = createDeps([item.output, item.output]);
    const plan = await planClaimQueries(CLAIM, () => {}, deps, true);
    check(
      `${item.label} 仍产生 1 pro + 2 con`,
      plan.fallback && plan.pro.length === 1 && plan.con.length === 2,
      `pro ${plan.pro.length} / con ${plan.con.length}`,
    );
  }

  // 5. 演示模式 3 个疑点合计不超过 9 次搜索
  {
    const claims: Claim[] = [
      CLAIM,
      { id: 'c2', text: '秦始皇陵地宫存在大量水银', kind: 'other' },
      { id: 'c3', text: '水银是秦始皇陵至今未发掘的原因', kind: 'causal' },
    ];
    let total = 0;
    for (const claim of claims) {
      const deps = createDeps([{ pro: ['证据一', '证据二'], con: ['辟谣一', '真相一', '多余'] }]);
      const plan = await planClaimQueries(claim, () => {}, deps, true);
      total += plan.pro.length + plan.con.length;
    }
    check('演示模式 3 个疑点合计 9 条检索词（≤10 预算）', total === 9, `${total} 条`);
  }

  if (failures.length > 0) {
    console.error(`\n失败 ${failures.length} 项：${failures.join('；')}`);
    process.exitCode = 1;
    return;
  }
  console.log('\n全部检查通过');
}

main().catch((error: unknown) => {
  console.error('脚本执行失败:', error);
  process.exitCode = 1;
});
