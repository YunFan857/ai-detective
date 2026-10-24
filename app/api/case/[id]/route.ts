/**
 * 卷宗读取接口：依次在 cache/、.cache/cases/ 中查找并返回结案卷宗。
 */
import { NextResponse } from 'next/server';
import { loadCaseFile } from '../../../../lib/case-store';

// Cache Components 下不允许 runtime / dynamic 段配置：默认即为 Node.js 运行时、按请求执行。

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const caseFile = await loadCaseFile(id);

  if (!caseFile) {
    return NextResponse.json({ error: 'not_found', caseId: id }, { status: 404 });
  }

  return NextResponse.json(caseFile);
}
