import { emptyClassroom, STORAGE_KEY, validateClassroom, type Classroom } from './classroom.ts';

export const REPOSITORY = 'ly633/GDL';
export const TEACHER_LOGIN = 'ly633';
export const PUBLIC_FILE = 'public/classroom.json';
export const DRAFT_BASE_KEY = 'classroom-teams-draft-base-v1';
export const MAX_PUBLIC_BYTES = 900000;
const API = 'https://api.github.com';
type Fetcher = typeof fetch;

export type Publication = { version: 1; publicationId: string | null; publishedAt: string | null; classroom: Classroom | null };
export type TeacherSession = { token: string; login: string; sha: string; published: Publication };
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

function toBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
}
function fromBase64(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, '')), char => char.charCodeAt(0)));
}
async function requestJSON(url: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: init.signal ?? AbortSignal.timeout(20000) }); }
  catch { throw new PublishingError('network', '连接失败。若刚才正在发布，请先确认发布状态再重试。'); }
  if (!response.ok) {
    if (response.status === 401) throw new PublishingError('auth', '令牌无效或已过期，请重新登录。');
    if (response.status === 403) throw new PublishingError('permission', 'GitHub 拒绝访问，请确认令牌仅授权 GDL 仓库且 Contents 为读写权限。');
    if (response.status === 409 || response.status === 422) throw new PublishingError('conflict', '线上内容已变化或提交被拒绝，请重新登录核对版本后发布。');
    if (response.status === 404) throw new PublishingError('missing', '未找到课堂文件或无权读取仓库。');
    throw new PublishingError('server', `读取或发布失败（${response.status}），请稍后重试。`);
  }
  const text = await response.text();
  if (text.length > 2000000) throw new PublishingError('size', '课堂文件过大。');
  try { return JSON.parse(text); } catch { throw new PublishingError('invalid', '服务器返回了无效数据。'); }
}
function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
}

export async function fetchPublishedClassroom(fetcher: Fetcher = fetch): Promise<Publication> {
  // Public readers never authenticate or consult localStorage.
  const value = await requestJSON(`./classroom.json?v=${Date.now()}`, { cache: 'no-store' }, fetcher);
  return validatePublication(value);
}

export async function authenticateTeacher(value: string, fetcher: Fetcher = fetch): Promise<TeacherSession> {
  const token = value.trim();
  if (!token || token.length > 5000) throw new PublishingError('auth', '请输入 GitHub 访问令牌。');
  const user = await requestJSON(`${API}/user`, { headers: headers(token), cache: 'no-store' }, fetcher) as { login?: string };
  if (user.login?.toLowerCase() !== TEACHER_LOGIN) throw new PublishingError('owner', '仅 ly633 账号可进入教师管理。');
  const repo = await requestJSON(`${API}/repos/${REPOSITORY}`, { headers: headers(token), cache: 'no-store' }, fetcher) as { permissions?: { push?: boolean } };
  if (!repo.permissions?.push) throw new PublishingError('permission', '该账号没有 GDL 仓库写入权限。');
  const file = await requestJSON(`${API}/repos/${REPOSITORY}/contents/${PUBLIC_FILE}?ref=main`, { headers: headers(token), cache: 'no-store' }, fetcher) as { sha?: string; content?: string; encoding?: string };
  if (typeof file.sha !== 'string' || !/^[a-f0-9]{40}$/.test(file.sha) || typeof file.content !== 'string' || file.encoding !== 'base64') throw new PublishingError('invalid', '无法读取课堂版本。');
  let published: Publication;
  try { published = validatePublication(JSON.parse(fromBase64(file.content))); }
  catch { throw new PublishingError('invalid', '仓库中的课堂文件无效。'); }
  return { token, login: TEACHER_LOGIN, sha: file.sha, published };
}

export async function publishClassroom(session: TeacherSession, state: Classroom, fetcher: Fetcher = fetch): Promise<{ publication: Publication; sha: string; commit: string }> {
  if (session.login !== TEACHER_LOGIN || !session.token || !/^[a-f0-9]{40}$/.test(session.sha)) throw new PublishingError('auth', '请先完成教师登录。');
  const publication = createPublication(state);
  // GitHub enforces write permissions. The saved SHA prevents stale drafts from
  // overwriting a newer publication from another device; never auto-retry a 409.
  const response = await requestJSON(`${API}/repos/${REPOSITORY}/contents/${PUBLIC_FILE}`, {
    method: 'PUT', headers: headers(session.token),
    body: JSON.stringify({ message: 'Publish classroom groups and weekly grades', branch: 'main', sha: session.sha, content: toBase64(JSON.stringify(publication)) }),
  }, fetcher) as { content?: { sha?: string }; commit?: { sha?: string } };
  if (!/^[a-f0-9]{40}$/.test(response.content?.sha ?? '') || !/^[a-f0-9]{40}$/.test(response.commit?.sha ?? '')) throw new PublishingError('uncertain', '提交结果暂无法确认，请查看部署状态后重新登录。');
  return { publication, sha: response.content!.sha!, commit: response.commit!.sha! };
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
