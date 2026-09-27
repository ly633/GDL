import { API_BASE, PublishingError, type TeacherSession } from './publishing.ts';
export type SubmissionInput = { requestId: string; name: string; studentNumber: string; content: string };
export type Receipt = { receipt: string; createdAt: string };
export type Submission = Receipt & { name: string; studentNumber: string; content: string };
export type SubmissionPage = { items: Submission[]; total: number; snapshot: number; nextBefore: number | null };
async function request(path: string, init: RequestInit, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher(API_BASE + path, { ...init, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) }); }
  catch { throw new PublishingError('network', '连接中断，暂时无法确认结果。请保留当前页面并重试，相同内容重试不会重复保存。'); }
  let result;
  try { result = await response.json(); } catch { throw new PublishingError('server', '无法确认服务器返回的结果，请保留内容后重试。'); }
  if (!response.ok) {
    const error = result as { code?: unknown; message?: unknown } | null;
    throw new PublishingError(typeof error?.code === 'string' ? error.code : 'server', typeof error?.message === 'string' ? error.message : '服务暂时不可用，请稍后重试。');
  }
  return result;
}
function validReceipt(value: unknown): value is Receipt { const item = value as Receipt | null; return typeof item?.receipt === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.receipt) && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)); }
export async function submitText(input: SubmissionInput, fetcher: typeof fetch = fetch): Promise<Receipt> {
  const result = await request('/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, fetcher);
  if (!validReceipt(result)) throw new PublishingError('uncertain', '未收到有效回执，请保留当前页面后重试。');
  return { receipt: result.receipt, createdAt: result.createdAt };
}
export async function fetchSubmissions(session: TeacherSession, cursor?: { snapshot: number; before: number }, fetcher: typeof fetch = fetch): Promise<SubmissionPage> {
  const query = cursor ? `?snapshot=${cursor.snapshot}&before=${cursor.before}` : '';
  const result = await request('/submissions' + query, { headers: { Authorization: 'Bearer ' + session.token } }, fetcher) as SubmissionPage | null;
  if (!result || !Array.isArray(result.items) || result.items.length > 50 || !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.snapshot) || result.snapshot < 0 || !(result.nextBefore === null || Number.isSafeInteger(result.nextBefore) && result.nextBefore > 0) || result.items.some((item: Submission) => !validReceipt(item) || typeof item.name !== 'string' || typeof item.studentNumber !== 'string' || typeof item.content !== 'string')) throw new PublishingError('invalid', '提交记录格式无效，请刷新重试。');
  return result;
}
