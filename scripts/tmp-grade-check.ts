import fs from 'node:fs';
import dotenv from 'dotenv';
import { ClaimSchema, SourceSchema } from '../types/case';
import { gradeSources } from '../lib/pipeline/grade';
import type { CaseEvent } from '../types/case';

dotenv.config({ path: '.env.local' });

async function main(): Promise<void> {
  const demo = JSON.parse(fs.readFileSync('mock/case-demo.json', 'utf8')) as {
    claims: unknown;
    sources: unknown;
  };
  const claims = ClaimSchema.array().parse(demo.claims);
  const sources = SourceSchema.array().parse(demo.sources);
  const events: CaseEvent[] = [];
  const updated = await gradeSources(claims, sources, (event) => events.push(event));

  for (const source of updated) {
    const before = sources.find((item) => item.id === source.id);
    console.log(
      `${source.id}  ${String(before?.stance).padEnd(10)} -> ${String(source.stance).padEnd(10)} tier=${source.tier}`,
    );
  }
  console.log(
    `事件: ${events.length} 条，其中 source_update ${events.filter((e) => e.type === 'source_update').length} 条`,
  );
  console.log(`error 事件: ${events.filter((e) => e.type === 'error').length} 条`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
