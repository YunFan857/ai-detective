/**
 * GET /api/report/[id]?format=md
 * 读取卷宗（cache/ → .cache/cases/）并导出 Markdown 报告。
 */
import { NextResponse } from 'next/server';
import { loadCaseFile } from '../../../../lib/case-store';
import { caseFileToMarkdown, reportFilename } from '../../../../lib/export-md';

// Cache Components 下不允许 runtime / dynamic 段配置：默认即为 Node.js 运行时、按请求执行。

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get('format') ?? 'md';

  if (format !== 'md') {
    return NextResponse.json(
      { error: 'unsupported_format', format, supported: ['md'] },
      { status: 400 },
    );
  }

  const caseFile = await loadCaseFile(id);
  if (!caseFile) {
    return NextResponse.json({ error: 'not_found', caseId: id }, { status: 404 });
  }

  const markdown = caseFileToMarkdown(caseFile);
  const filename = reportFilename(caseFile);

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // 中文文件名走 RFC 5987，ASCII 兜底避免非 ByteString 报错。
      'Content-Disposition': `attachment; filename="report-${caseFile.id}.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
