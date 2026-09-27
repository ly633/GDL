import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { submitText, fetchSubmissions } from '../lib/submissions.ts';
import { workbookFromSubmissions } from '../lib/submission-export.ts';
const row = { receipt: 'fd3c4f29-7f6f-4cdf-8127-07511c8e6725', createdAt: '2026-09-27T08:00:00.000Z', name: '测试同学', studentNumber: '000126', content: '=HYPERLINK("https://example.com")\n\n<script>test</script>\n原文' };
test('student success requires a valid server receipt and sends no teacher credential', async () => {
  const input = { requestId: crypto.randomUUID(), name: row.name, studentNumber: row.studentNumber, content: row.content };
  const result = await submitText(input, async (url, init) => {
    assert.match(url, /\/submissions$/); assert.equal(init.credentials, 'omit'); assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), input);
    return Response.json({ receipt: row.receipt, createdAt: row.createdAt }, { status: 201 });
  });
  assert.equal(result.receipt, row.receipt);
  await assert.rejects(submitText(input, async () => Response.json({ ok: true })), /回执/);
  await assert.rejects(submitText(input, async () => { throw new Error('offline'); }), /暂时无法确认/);
});
test('teacher reads require bearer authentication and carry a snapshot cursor', async () => {
  const result = await fetchSubmissions({ token: 'test-token' }, { snapshot: 123, before: 55 }, async (url, init) => {
    assert.match(url, /snapshot=123&before=55/); assert.equal(init.headers.Authorization, 'Bearer test-token');
    return Response.json({ items: [row], total: 1, snapshot: 123, nextBefore: null });
  });
  assert.equal(result.items[0].content, row.content);
  await assert.rejects(fetchSubmissions({ token: 'expired' }, undefined, async () => Response.json({ code: 'auth', message: '请重新登录' }, { status: 401 })), /重新登录/);
});
test('Excel exports preserve leading-zero student numbers, multiline text, and formula-like strings as text', () => {
  const book = workbookFromSubmissions([row]);
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(bytes, { type: 'buffer' }).Sheets['文本提交'];
  assert.equal(parsed.B2.v, '000126'); assert.equal(parsed.B2.t, 's');
  assert.equal(parsed.D2.v, row.content); assert.equal(parsed.D2.t, 's'); assert.equal(parsed.D2.f, undefined);
});
