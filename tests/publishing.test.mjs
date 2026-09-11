import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyClassroom, regroupClassroom, activeAssignment, addAssignment, setTeamScore, STORAGE_KEY } from '../lib/classroom.ts';
import { authenticateTeacher, chooseTeacherDraft, createPublication, DRAFT_BASE_KEY, emptyPublication, fetchPublishedClassroom, MAX_PUBLIC_BYTES, publicClassroom, publishClassroom, saveTeacherDraft, validatePublication } from '../lib/publishing.ts';

const sha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const commit = 'c'.repeat(40);
const fakeToken = 'test-only-not-a-real-token';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const memory = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
function classroom() {
  let state = regroupClassroom({ ...emptyClassroom(), title: '几何深度学习 🧑‍🏫', source: '私人原始名单.xlsx', students: ['张三', '李四', '王五', '赵六'].map((name, i) => ({ id: `student-${i + 1}`, name, number: `00${i + 1}` })) });
  state = setTeamScore(state, activeAssignment(state).teams[0].id, 85, '教师私人备注');
  state = addAssignment(state, '第2周作业');
  return setTeamScore(state, activeAssignment(state).teams[0].id, 0, '第二周备注');
}
function fileResponse(publication = emptyPublication()) {
  return { sha, encoding: 'base64', content: Buffer.from(JSON.stringify(publication)).toString('base64') };
}
const teacher = (published = emptyPublication()) => ({ token: fakeToken, login: 'ly633', sha, published });

test('publication includes all weeks and individual grades while excluding history, filenames and unknown fields', () => {
  const draft = classroom();
  const before = structuredClone(draft);
  const publication = createPublication({ ...draft, token: fakeToken, secret: 'ignore' });
  assert.deepEqual(draft, before);
  assert.ok(publication.publicationId);
  assert.ok(Number.isFinite(Date.parse(publication.publishedAt)));
  assert.equal(publication.classroom.assignments.length, 2);
  assert.ok(Object.keys(publication.classroom.assignments[0].grades).length > 0);
  for (let i = 0; i < draft.assignments.length; i++) {
    assert.deepEqual(publication.classroom.assignments[i].grades, draft.assignments[i].grades);
    assert.deepEqual(publication.classroom.assignments[i].teams, draft.assignments[i].teams);
    assert.deepEqual(publication.classroom.assignments[i].history, []);
  }
  assert.equal(publication.classroom.source, '');
  assert.equal(JSON.stringify(publication).includes(fakeToken), false);
  assert.equal(JSON.stringify(publication).includes('教师私人备注'), false);
  assert.deepEqual(validatePublication(JSON.parse(JSON.stringify(publication))), publication);
  assert.deepEqual(publicClassroom(draft), publication.classroom);
});

test('public load is unauthenticated, bypasses cache, and ignores the browser local draft', async () => {
  const publication = createPublication(classroom());
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Public view must never read local drafts'); } });
  try {
    const result = await fetchPublishedClassroom(async (url, init) => {
      assert.match(url, /^\.\/classroom\.json\?v=\d+$/);
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(new Headers(init.headers).has('Authorization'), false);
      return json(publication);
    });
    assert.deepEqual(result, publication);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
  }
  assert.deepEqual(await fetchPublishedClassroom(async () => json(emptyPublication())), emptyPublication());
});

test('invalid or failed public reads fail closed, never falling back to editable local content', async () => {
  for (const body of [{}, { ...emptyPublication(), classroom: {} }, { ...createPublication(classroom()), publicationId: '' }]) {
    await assert.rejects(fetchPublishedClassroom(async () => json(body)));
  }
  await assert.rejects(fetchPublishedClassroom(async () => json({}, 404)), error => error.code === 'missing');
  await assert.rejects(fetchPublishedClassroom(async () => new Response('<html>not JSON</html>')), error => error.code === 'invalid');
});

test('teacher login verifies GitHub identity, repository permission and the current file version', async () => {
  const publication = createPublication(classroom());
  const urls = [];
  const session = await authenticateTeacher(` ${fakeToken} `, async (url, init) => {
    urls.push(url);
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${fakeToken}`);
    assert.equal(init.redirect, 'error');
    assert.equal(new URL(url).origin, 'https://api.github.com');
    if (url.endsWith('/user')) return json({ login: 'ly633' });
    if (url.endsWith('/GDL')) return json({ permissions: { push: true } });
    return json(fileResponse(publication));
  });
  assert.deepEqual(urls, ['https://api.github.com/user', 'https://api.github.com/repos/ly633/GDL', 'https://api.github.com/repos/ly633/GDL/contents/public/classroom.json?ref=main']);
  assert.deepEqual(session, { token: fakeToken, login: 'ly633', sha, published: publication });
});

test('anonymous, invalid, wrong-owner and non-writer sessions cannot enter teacher mode', async () => {
  await assert.rejects(authenticateTeacher('', async () => { throw new Error('must not fetch'); }), error => error.code === 'auth');
  await assert.rejects(authenticateTeacher(fakeToken, async () => json({}, 401)), error => error.code === 'auth');
  let calls = 0;
  await assert.rejects(authenticateTeacher(fakeToken, async () => { calls++; return json({ login: 'student' }); }), error => error.code === 'owner');
  assert.equal(calls, 1);
  await assert.rejects(authenticateTeacher(fakeToken, async url => url.endsWith('/user') ? json({ login: 'ly633' }) : json({ permissions: { push: false } })), error => error.code === 'permission');
  await assert.rejects(publishClassroom({ ...teacher(), token: '' }, classroom(), async () => { throw new Error('must not fetch'); }), error => error.code === 'auth');
});

test('publish sends UTF-8 data only to the fixed repository file, with expected SHA and no credential in its body', async () => {
  const draft = classroom();
  let decoded;
  const result = await publishClassroom(teacher(), draft, async (url, init) => {
    assert.equal(url, 'https://api.github.com/repos/ly633/GDL/contents/public/classroom.json');
    assert.equal(init.method, 'PUT');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${fakeToken}`);
    const body = JSON.parse(init.body);
    assert.equal(body.sha, sha);
    assert.equal(body.branch, 'main');
    const content = Buffer.from(body.content, 'base64').toString('utf8');
    assert.equal(content.includes(fakeToken), false);
    assert.ok(Buffer.byteLength(content) <= MAX_PUBLIC_BYTES);
    decoded = validatePublication(JSON.parse(content));
    return json({ content: { sha: nextSha }, commit: { sha: commit } });
  });
  assert.deepEqual(result, { publication: decoded, sha: nextSha, commit });
  assert.equal(decoded.classroom.title, draft.title);
  assert.deepEqual(decoded.classroom.students, draft.students);
});

test('stale version and insufficient token scope are rejected without retry or changing the old session', async () => {
  for (const [status, code] of [[409, 'conflict'], [422, 'conflict'], [403, 'permission'], [401, 'auth']]) {
    const session = teacher();
    const before = structuredClone(session);
    let attempts = 0;
    await assert.rejects(publishClassroom(session, classroom(), async () => { attempts++; return json({ message: fakeToken }, status); }), error => error.code === code && !error.message.includes(fakeToken));
    assert.equal(attempts, 1);
    assert.deepEqual(session, before);
  }
});

test('ambiguous submit responses and network failures never claim publication succeeded', async () => {
  await assert.rejects(publishClassroom(teacher(), classroom(), async () => json({})), error => error.code === 'uncertain');
  let attempts = 0;
  await assert.rejects(publishClassroom(teacher(), classroom(), async () => { attempts++; throw new Error(fakeToken); }), error => error.code === 'network' && !error.message.includes(fakeToken));
  assert.equal(attempts, 1);
});

test('teacher recovers old local grades; current drafts survive login and newer online versions require a choice', () => {
  const draft = classroom();
  const publication = createPublication(draft);
  const storage = memory();
  storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  assert.deepEqual(chooseTeacherDraft(emptyPublication(), sha, storage), { draft, conflict: false, warning: '' });
  assert.equal(chooseTeacherDraft(publication, sha, storage).conflict, true);
  saveTeacherDraft(draft, sha, storage);
  assert.deepEqual(chooseTeacherDraft(publication, sha, storage), { draft, conflict: false, warning: '' });
  assert.equal(chooseTeacherDraft(publication, nextSha, storage).conflict, true);
  assert.equal(chooseTeacherDraft(publication, nextSha, memory()).draft.title, draft.title);
});

test('an older tab saving after a newer publication keeps its own base SHA for conflict detection', () => {
  const storage = memory();
  const draft = classroom();
  const publication = createPublication(draft);
  saveTeacherDraft(draft, nextSha, storage);
  saveTeacherDraft({ ...draft, title: '旧标签页的修改' }, sha, storage);
  assert.equal(chooseTeacherDraft(publication, nextSha, storage).conflict, true);
  assert.equal(storage.getItem(DRAFT_BASE_KEY), sha);
  assert.deepEqual([...storage.values.keys()].sort((a, b) => a.localeCompare(b)), [STORAGE_KEY, DRAFT_BASE_KEY].sort((a, b) => a.localeCompare(b)));
  assert.equal([...storage.values.values()].join('').includes(fakeToken), false);
});

test('unreadable local drafts are retained and produce a warning, with published data available', () => {
  const publication = createPublication(classroom());
  const storage = memory();
  storage.setItem(STORAGE_KEY, 'damaged old record');
  const result = chooseTeacherDraft(publication, sha, storage);
  assert.deepEqual(result.draft, publication.classroom);
  assert.ok(result.warning);
  assert.equal(storage.getItem(STORAGE_KEY), 'damaged old record');
  const blocked = chooseTeacherDraft(publication, sha, { getItem() { throw new Error('storage disabled'); } });
  assert.ok(blocked.warning);
});

test('publishing rejects invalid rosters and content beyond the GitHub file size limit before making a request', async () => {
  const invalid = classroom();
  invalid.students.push(invalid.students[0]);
  await assert.rejects(publishClassroom(teacher(), invalid, async () => { throw new Error('must not fetch'); }));
  let large = regroupClassroom({ ...emptyClassroom(), students: Array.from({ length: 500 }, (_, i) => ({ id: `student-${i + 1}`, name: '长姓名测试', number: String(i + 1) })) });
  for (let i = 2; i <= 35; i++) large = addAssignment(large, `第${i}周作业`);
  assert.throws(() => createPublication(large), error => error.code === 'size');
});
