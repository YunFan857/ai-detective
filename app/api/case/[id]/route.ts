import { NextResponse } from 'next/server';

/**
 * 卷宗读取接口。
 * TODO(PRD 步骤 7)：按案件 id 返回结案卷宗与事件记录。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  return NextResponse.json({ error: 'not_implemented', caseId: id }, { status: 501 });
}
