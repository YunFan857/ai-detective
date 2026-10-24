/**
 * 卷宗 / 预览的磁盘读取。
 * 演示卷宗在 cache/（需提交），运行期产物在 .cache/（不提交）；
 * 读取顺序固定为 演示 → 运行期，避免演示现场被本地缓存干扰。
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CaseFileSchema,
  ClaimsPreviewSchema,
  type CaseFile,
  type ClaimsPreview,
} from '../types/case';

const DEMO_DIR = path.join(process.cwd(), 'cache');
const CASE_DIR = path.join(process.cwd(), '.cache', 'cases');
const PREVIEW_DIR = path.join(process.cwd(), '.cache', 'previews');

/** 只接受安全文件名，防止路径穿越。 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

/** 读 JSON；文件不存在或内容损坏都返回 undefined。 */
async function readJson(file: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** 依次在 cache/、.cache/cases/ 中查找卷宗；找不到或校验失败返回 undefined。 */
export async function loadCaseFile(id: string): Promise<CaseFile | undefined> {
  if (!isSafeId(id)) {
    return undefined;
  }

  for (const dir of [DEMO_DIR, CASE_DIR]) {
    const raw = await readJson(path.join(dir, `${id}.json`));
    if (raw === undefined) {
      continue;
    }
    const parsed = CaseFileSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return undefined;
}

/** 只读演示目录 cache/<demoId>.json。 */
export async function loadDemoCase(demoId: string): Promise<CaseFile | undefined> {
  if (!isSafeId(demoId)) {
    return undefined;
  }
  const raw = await readJson(path.join(DEMO_DIR, `${demoId}.json`));
  if (raw === undefined) {
    return undefined;
  }
  const parsed = CaseFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 从 .cache/previews 读回拆疑点预览。 */
export async function loadPreview(previewId: string): Promise<ClaimsPreview | undefined> {
  if (!isSafeId(previewId)) {
    return undefined;
  }
  const raw = await readJson(path.join(PREVIEW_DIR, `${previewId}.json`));
  if (raw === undefined) {
    return undefined;
  }
  const parsed = ClaimsPreviewSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 列出 cache/ 下所有合法演示卷宗。 */
export async function listDemoCases(): Promise<CaseFile[]> {
  let names: string[];
  try {
    names = await readdir(DEMO_DIR);
  } catch {
    return [];
  }

  const cases: CaseFile[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const raw = await readJson(path.join(DEMO_DIR, name));
    const parsed = CaseFileSchema.safeParse(raw);
    if (parsed.success) {
      cases.push(parsed.data);
    }
  }
  return cases;
}

/** 找到 input 与用户输入完全一致的演示卷宗。 */
export async function findDemoCaseByInput(input: string): Promise<CaseFile | undefined> {
  const normalized = input.trim();
  if (!normalized) {
    return undefined;
  }
  const cases = await listDemoCases();
  return cases.find((caseFile) => caseFile.input.trim() === normalized);
}
