import { emptyClassroom, STORAGE_KEY, validateClassroom, type Classroom } from './classroom.ts';

export const TEACHER_LOGIN = 'ly633';
export const DRAFT_BASE_KEY = 'classroom-teams-draft-base-v1';
export const MAX_PUBLIC_BYTES = 900000;
export const API_BASE = import.meta.env?.VITE_CLASSROOM_API_BASE || 'https://gdl-teacher-ly633.golden-whale-7483.chatgpt.site/api';
type Fetcher = typeof fetch;
export type Publication = { version: 1; publicationId: string | null; publishedAt: string | null; classroom: Classroom | null };
export type TeacherSession = { token: string; login: string; sha: string; published: Publication; expiresAt: string };
export const emptyPublication = (): Publication => ({ version: 1, publicationId: null, publishedAt: null, classroom: null });
export function publicClassroom(state: Classroom): Classroom {
  const valid = validateClassroom(state);
  return { ...valid, source: '', assignments: valid.assignments.map(a => ({ ...a, history: [] })) };
}
export class PublishingError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'PublishingError'; this.code = code; }
}
export function validatePublication(value: unknown): Publication {
  const item = value as Publication;
  if (!item || item.version !== 1) throw new PublishingError('invalid', '已发布课堂的数据格式无效。');
  if (item.classroom === null && item.publicationId === null && item.publishedAt === null) return emptyPublication();
  if (typeof item.publicationId !== 'string' || !item.publicationId || item.publicationId.length > 100 || typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt)) || !item.classroom) throw new PublishingError('invalid', '已发布课堂的数据格式无效。');
  return { version: 1, publicationId: item.publicationId, publishedAt: item.publishedAt, classroom: publicClassroom(item.classroom) };
}
export function createPublication(state: Classroom): Publication {
  const publication: Publication = { version: 1, publicationId: crypto.randomUUID(), publishedAt: new Date().toISOString(), classroom: publicClassroom(state) };
  if (new TextEncoder().encode(JSON.stringify(publication)).byteLength > MAX_PUBLIC_BYTES) throw new PublishingError('size', '发布数据过大，请拆分课堂或使用 Excel 导出。');
  return publication;
}
async function requestJSON(path: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(API_BASE + path, { ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
  catch { throw new PublishingError('network', '连接失败。若正在发布，请刷新课堂或重新登录核对发布结果。'); }
  const text = await response.text();
  if (text.length > 2000000) throw new PublishingError('size', '课堂文件过大。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new PublishingError('invalid', '服务返回了无效数据，请稍后重试。'); }
  if (!response.ok) {
    const error = value as { code?: string; message?: string };
    throw new PublishingError(typeof error.code === 'string' ? error.code : 'server', typeof error.message === 'string' && error.message.length <= 200 ? error.message : '服务暂时不可用，请稍后重试。');
  }
  return value;
}
function post(body: unknown, token?: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) };
}
function readSession(value: unknown): TeacherSession {
  const item = value as TeacherSession;
  if (!item || item.login !== TEACHER_LOGIN || !/^[A-Za-z0-9_-]{43}$/.test(item.token ?? '') || typeof item.sha !== 'string' || !item.sha || item.sha.length > 150 || !Number.isFinite(Date.parse(item.expiresAt))) throw new PublishingError('auth', '登录响应无效，请重试。');
  return { token: item.token, login: TEACHER_LOGIN, sha: item.sha, expiresAt: item.expiresAt, published: validatePublication(item.published) };
}
export async function fetchPublishedClassroom(fetcher: Fetcher = fetch): Promise<Publication> {
  return validatePublication(await requestJSON('/classroom?v=' + Date.now(), {}, fetcher));
}
export async function authenticateTeacher(password: string, fetcher: Fetcher = fetch): Promise<TeacherSession> {
  if (!password) throw new PublishingError('auth', '请输入教师密码。');
  return readSession(await requestJSON('/login', post({ password }), fetcher));
}
export async function setupTeacherPassword(password: string, setupToken: string, fetcher: Fetcher = fetch): Promise<TeacherSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(setupToken)) throw new PublishingError('setup', '密码设置链接无效。');
  return readSession(await requestJSON('/setup', post({ password }, setupToken), fetcher));
}
export async function changeTeacherPassword(session: TeacherSession, currentPassword: string, newPassword: string, fetcher: Fetcher = fetch): Promise<TeacherSession> {
  return readSession(await requestJSON('/password', post({ currentPassword, newPassword }, session.token), fetcher));
}
export async function endTeacherSession(session: TeacherSession, fetcher: Fetcher = fetch) {
  await requestJSON('/logout', post({}, session.token), fetcher);
}
export async function publishClassroom(session: TeacherSession, state: Classroom, fetcher: Fetcher = fetch): Promise<{ publication: Publication; sha: string }> {
  if (session.login !== TEACHER_LOGIN || !/^[A-Za-z0-9_-]{43}$/.test(session.token)) throw new PublishingError('auth', '请先完成教师登录。');
  const clean = createPublication(state);
  const result = await requestJSON('/publish', post({ classroom: clean.classroom, sha: session.sha }, session.token), fetcher) as { publication?: unknown; sha?: string };
  if (typeof result.sha !== 'string' || !result.sha || result.sha.length > 150) throw new PublishingError('uncertain', '发布结果暂无法确认，请重新登录核对。');
  return { publication: validatePublication(result.publication), sha: result.sha };
}

export type DraftChoice = { draft: Classroom; conflict: boolean; warning: string };
export function saveTeacherDraft(draft: Classroom, sha: string, storage: Pick<Storage, 'setItem'>) {
  // Pair every draft edit with that editing session's base version, including
  // when an older tab saves after a newer tab has published.
  storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  storage.setItem(DRAFT_BASE_KEY, sha);
}
export function chooseTeacherDraft(published: Publication, sha: string, storage: Pick<Storage, 'getItem'>): DraftChoice {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) {
      const draft = validateClassroom(JSON.parse(saved));
      const base = storage.getItem(DRAFT_BASE_KEY);
      return { draft, conflict: !!published.classroom && base !== sha, warning: '' };
    }
  } catch { return { draft: published.classroom ?? emptyClassroom(), conflict: false, warning: '无法读取本机草稿，已载入已发布版本。原记录未覆盖。' }; }
  return { draft: published.classroom ?? emptyClassroom(), conflict: false, warning: '' };
}
