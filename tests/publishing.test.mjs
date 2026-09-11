import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyClassroom, regroupClassroom, activeAssignment, setTeamScore, addAssignment, STORAGE_KEY } from '../lib/classroom.ts';
import { API_BASE, authenticateTeacher, changeTeacherPassword, chooseTeacherDraft, createPublication, DRAFT_BASE_KEY, emptyPublication, endTeacherSession, fetchPublishedClassroom, publishClassroom, saveTeacherDraft, setupTeacherPassword, validatePublication } from '../lib/publishing.ts';

const token = 'a'.repeat(43);
const setupToken = 'b'.repeat(43);
const password = 'Geometry!teacher-course';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const memory = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const session = () => ({ token, login: 'ly633', sha: 'initial-empty', published: emptyPublication(), expiresAt: '2030-01-01T00:00:00.000Z' });
function classroom() {
  let state = regroupClassroom({ ...emptyClassroom(), title: '几何深度学习', source: '本机名单.xlsx', students: ['张三', '李四', '王五'].map((name, i) => ({ id: 'student-' + i, name, number: '00' + i })) });
  state = setTeamScore(state, activeAssignment(state).teams[0].id, 85, '教师备注');
  return addAssignment(state, '第2周作业');
}

test('public requests use the shared API without credentials, caching, or browser drafts', async () => {
  const publication = createPublication(classroom());
  const result = await fetchPublishedClassroom(async (url, init) => {
    assert.ok(url.startsWith(API_BASE + '/classroom?v='));
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    return json(publication);
  });
  assert.deepEqual(result, publication);
  await assert.rejects(fetchPublishedClassroom(async () => json({})), error => error.code === 'invalid');
  await assert.rejects(fetchPublishedClassroom(async () => json({ code: 'server', message: '服务暂时不可用。' }, 503)));
});

test('password login sends the password only in the HTTPS request body and validates the returned session', async () => {
  const result = await authenticateTeacher(password, async (url, init) => {
    assert.equal(url, API_BASE + '/login');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { password });
    assert.equal(url.includes(password), false);
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    return json(session());
  });
  assert.deepEqual(result, session());
  await assert.rejects(authenticateTeacher('', async () => { throw new Error('must not fetch'); }));
  await assert.rejects(authenticateTeacher(password, async () => json({ ...session(), token: 'invalid' })));
  await assert.rejects(authenticateTeacher(password, async () => json({ code: 'auth', message: '密码不正确，请重新输入。' }, 401)), error => error.code === 'auth');
});

test('setup uses the private one-time capability in a header and does not put it in published data', async () => {
  await setupTeacherPassword(password, setupToken, async (url, init) => {
    assert.equal(url, API_BASE + '/setup');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + setupToken);
    assert.deepEqual(JSON.parse(init.body), { password });
    return json(session());
  });
  await assert.rejects(setupTeacherPassword(password, 'bad', async () => { throw new Error('must not fetch'); }));
});

test('publishing carries the expected revision and only public classroom fields', async () => {
  const state = classroom();
  const before = structuredClone(state);
  const publication = createPublication(state);
  const result = await publishClassroom(session(), state, async (url, init) => {
    assert.equal(url, API_BASE + '/publish');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token);
    const body = JSON.parse(init.body);
    assert.equal(body.sha, 'initial-empty');
    assert.equal(body.classroom.assignments.length, 2);
    assert.equal(body.classroom.source, '');
    assert.deepEqual(body.classroom.assignments[0].history, []);
    assert.deepEqual(body.classroom.assignments[0].grades, state.assignments[0].grades);
    assert.equal(init.body.includes(token), false);
    assert.equal(init.body.includes(password), false);
    return json({ publication, sha: 'new-revision' });
  });
  assert.deepEqual(result, { publication, sha: 'new-revision' });
  assert.deepEqual(state, before);
  assert.deepEqual(validatePublication(publication), publication);
});

test('conflicts, expiry, network failures, and uncertain submit responses are not silently retried', async () => {
  for (const [status, code] of [[409, 'conflict'], [401, 'auth'], [429, 'rate']]) {
    let attempts = 0;
    await assert.rejects(publishClassroom(session(), classroom(), async () => { attempts++; return json({ code, message: '请重新核对。' }, status); }), error => error.code === code);
    assert.equal(attempts, 1);
  }
  await assert.rejects(publishClassroom(session(), classroom(), async () => { throw new Error('offline'); }), error => error.code === 'network');
  await assert.rejects(publishClassroom(session(), classroom(), async () => json({})), error => error.code === 'uncertain');
  await assert.rejects(publishClassroom({ ...session(), token: '' }, classroom(), async () => { throw new Error('must not fetch'); }));
});

test('password change requires current credentials; logout sends only the current session token', async () => {
  await changeTeacherPassword(session(), password, 'New!geometry-password', async (url, init) => {
    assert.equal(url, API_BASE + '/password');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token);
    assert.deepEqual(JSON.parse(init.body), { currentPassword: password, newPassword: 'New!geometry-password' });
    return json({ ...session(), token: 'c'.repeat(43) });
  });
  await endTeacherSession(session(), async (url, init) => {
    assert.equal(url, API_BASE + '/logout');
    assert.deepEqual(JSON.parse(init.body), {});
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token);
    return json({ ok: true });
  });
});

test('existing local grades are recovered and different online versions require an explicit draft choice', () => {
  const state = classroom();
  const publication = createPublication(state);
  const storage = memory();
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  assert.deepEqual(chooseTeacherDraft(emptyPublication(), 'initial-empty', storage).draft, state);
  assert.equal(chooseTeacherDraft(publication, 'new-version', storage).conflict, true);
  saveTeacherDraft(state, 'new-version', storage);
  assert.equal(chooseTeacherDraft(publication, 'new-version', storage).conflict, false);
  saveTeacherDraft({ ...state, title: '旧标签页' }, 'old-version', storage);
  assert.equal(chooseTeacherDraft(publication, 'new-version', storage).conflict, true);
  assert.equal(storage.getItem(DRAFT_BASE_KEY), 'old-version');
  assert.deepEqual([...storage.values.keys()].sort((a, b) => a.localeCompare(b)), [STORAGE_KEY, DRAFT_BASE_KEY].sort((a, b) => a.localeCompare(b)));
  assert.equal([...storage.values.values()].join('').includes(password), false);
  assert.equal([...storage.values.values()].join('').includes(token), false);
});

test('corrupted drafts are preserved, while invalid classroom data is blocked before publication', async () => {
  const state = classroom();
  const storage = memory();
  storage.setItem(STORAGE_KEY, 'original unreadable data');
  const choice = chooseTeacherDraft(createPublication(state), 'revision', storage);
  assert.ok(choice.warning);
  assert.equal(storage.getItem(STORAGE_KEY), 'original unreadable data');
  const invalid = structuredClone(state); invalid.students.push(invalid.students[0]);
  await assert.rejects(publishClassroom(session(), invalid, async () => { throw new Error('must not fetch'); }));
});
