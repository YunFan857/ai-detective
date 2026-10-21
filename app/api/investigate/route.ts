import { NextResponse } from 'next/server';

/**
 * 立案接口。
 * TODO(PRD 步骤 1)：接收用户消息，创建案件并启动调查流水线。
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
}
