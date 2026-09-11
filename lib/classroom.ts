export type Student = { id: string; name: string; number: string };
export type Team = { id: string; name: string; members: Student[]; score: number };
export type ScoreEntry = { id: string; teamId: string; teamName: string; delta: number; note: string; time: string };
export type Classroom = { version: 1; title: string; students: Student[]; teams: Team[]; history: ScoreEntry[]; size: number; balanced: boolean; source: string };
export const STORAGE_KEY = 'classroom-teams-v1';
export const MAX_STUDENTS = 500;
export const emptyClassroom = (): Classroom => ({ version: 1, title: '我的课堂', students: [], teams: [], history: [], size: 3, balanced: true, source: '' });
export const demoNames = ['陈思远','林雨桐','王子涵','李嘉宁','张一诺','赵明轩','刘欣然','周知夏','吴宇航','徐沐阳','孙语晨','朱星河','胡可欣','郭书言','何以安','高予希','罗景行','郑乐然'];

// Rejection sampling avoids modulo bias in the Fisher–Yates shuffle.
export function randomIndex(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const values = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}

export function groupStudents(students: Student[], size: number, balanced: boolean, choose = randomIndex): Team[] {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('每队人数需为 1–100 的整数。');
  if (!students.length || students.length > MAX_STUDENTS) throw new Error('请导入 1–500 位同学。');
  if (new Set(students.map(s => s.id)).size !== students.length) throw new Error('名单存在重复记录，请重新导入。');
  const shuffled = [...students];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = choose(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('随机数生成失败。');
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const count = Math.ceil(students.length / size);
  const teams: Team[] = Array.from({ length: count }, (_, i) => ({ id: `team-${i+1}`, name: `第 ${i+1} 小队`, members: [], score: 0 }));
  shuffled.forEach((student, i) => teams[balanced ? i % count : Math.floor(i / size)].members.push(student));
  return teams;
}

export function teamSizes(count: number, size: number, balanced: boolean): number[] {
  if (!count || !Number.isInteger(size) || size < 1) return [];
  const teams = Math.ceil(count / size);
  return Array.from({ length: teams }, (_, i) => balanced ? Math.floor(count / teams) + (i < count % teams ? 1 : 0) : Math.min(size, count - i * size));
}

export function addScore(state: Classroom, teamId: string, delta: number, note = ''): Classroom {
  const team = state.teams.find(t => t.id === teamId);
  if (!team) throw new Error('队伍不存在。');
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10000) throw new Error('分数需为非零数值，且单次不超过 10000 分。');
  delta = Math.round(delta * 10) / 10;
  if (!delta) throw new Error('分数至少为 0.1 分。');
  const score = Math.round((team.score + delta) * 10) / 10;
  if (Math.abs(score) > 1000000) throw new Error('累计分数超出范围。');
  return { ...state, teams: state.teams.map(t => t.id === teamId ? { ...t, score } : t), history: [...state.history, { id: globalThis.crypto.randomUUID(), teamId, teamName: team.name, delta, note: note.trim().slice(0,200), time: new Date().toISOString() }].slice(-2000) };
}

export function undoScore(state: Classroom): Classroom {
  const last = state.history.at(-1);
  if (!last) return state;
  return { ...state, teams: state.teams.map(t => t.id === last.teamId ? { ...t, score: Math.round((t.score - last.delta) * 10) / 10 } : t), history: state.history.slice(0,-1) };
}

export function ranking(teams: Team[]) {
  const sorted = [...teams].sort((a,b) => b.score-a.score);
  return sorted.map((team,i) => ({ ...team, rank: sorted.findIndex(t => t.score === team.score) + 1, position: i }));
}

export function inferColumns(rows: string[][]) {
  const namePattern = /^(姓名|学生姓名|学生|名字|name|student\s*name)$/i;
  const idPattern = /^(学号|学生学号|编号|student\s*(id|number)|id|number)$/i;
  let headerRow = rows.findIndex((r,i) => i < 15 && r.some(v => namePattern.test(v.trim())));
  const hasHeader = headerRow >= 0;
  if (!hasHeader) headerRow = 0;
  const nameColumn = hasHeader ? rows[headerRow].findIndex(v => namePattern.test(v.trim())) : 0;
  const idColumn = hasHeader ? rows[headerRow].findIndex(v => idPattern.test(v.trim())) : -1;
  return { headerRow, hasHeader, nameColumn, idColumn };
}

export function rosterFromRows(rows: string[][], options: { headerRow: number; hasHeader: boolean; nameColumn: number; idColumn: number }) {
  if (!Number.isInteger(options.nameColumn) || options.nameColumn < 0) throw new Error('请选择姓名所在列。');
  if (options.nameColumn === options.idColumn) throw new Error('姓名列与学号列不能相同。');
  const start = options.headerRow + (options.hasHeader ? 1 : 0);
  const students: Student[] = [];
  const seenNumbers = new Set<string>();
  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const name = String(rows[i]?.[options.nameColumn] ?? '').trim();
    if (!name) { skipped++; continue; }
    if (name.length > 100) throw new Error(`第 ${i+1} 行姓名过长，请检查列选择。`);
    const number = options.idColumn < 0 ? '' : String(rows[i]?.[options.idColumn] ?? '').trim();
    if (number.length > 100) throw new Error(`第 ${i+1} 行学号过长。`);
    if (number && seenNumbers.has(number)) throw new Error(`学号 ${number} 重复（第 ${i+1} 行），请修正名单或不选择学号列。`);
    if (number) seenNumbers.add(number);
    students.push({ id: `student-${i+1}`, name, number });
  }
  if (!students.length) throw new Error('没有找到姓名，请检查工作表和姓名列。');
  if (students.length > MAX_STUDENTS) throw new Error('单次最多支持 500 位同学，请拆分班级名单。');
  const duplicateNames = students.length - new Set(students.map(s => s.name)).size;
  return { students, skipped, duplicateNames };
}

function validStudent(value: unknown): value is Student {
  const s = value as Student;
  return !!s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 100 && typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 100 && typeof s.number === 'string' && s.number.length <= 100;
}

export function validateClassroom(value: unknown): Classroom {
  const state = value as Classroom;
  if (!state || state.version !== 1 || typeof state.title !== 'string' || state.title.length > 80 || typeof state.source !== 'string' || state.source.length > 300 || !Number.isInteger(state.size) || state.size < 1 || state.size > 100 || typeof state.balanced !== 'boolean' || !Array.isArray(state.students) || state.students.length > MAX_STUDENTS || !state.students.every(validStudent) || new Set(state.students.map(s => s.id)).size !== state.students.length || !Array.isArray(state.teams) || state.teams.length > MAX_STUDENTS || !Array.isArray(state.history) || state.history.length > 2000) throw new Error('课堂数据格式无效。');
  const ids = new Set<string>();
  const roster = new Map(state.students.map(s => [s.id,s]));
  const teamIds = new Set<string>();
  for (const team of state.teams) {
    if (!team || typeof team.id !== 'string' || team.id.length > 100 || teamIds.has(team.id) || typeof team.name !== 'string' || team.name.length > 80 || !Number.isFinite(team.score) || Math.abs(team.score) > 1000000 || !Array.isArray(team.members) || !team.members.length || team.members.length > 100) throw new Error('队伍数据格式无效。');
    teamIds.add(team.id);
    for (const member of team.members) {
      const original = roster.get(member?.id);
      if (!validStudent(member) || ids.has(member.id) || !original || original.name !== member.name || original.number !== member.number) throw new Error('队伍成员数据不一致。');
      ids.add(member.id);
    }
  }
  if (state.teams.length && ids.size !== state.students.length) throw new Error('队伍名单不完整。');
  for (const entry of state.history) {
    if (!entry || typeof entry.id !== 'string' || !teamIds.has(entry.teamId) || typeof entry.teamName !== 'string' || entry.teamName.length > 80 || !Number.isFinite(entry.delta) || Math.abs(entry.delta) > 10000 || typeof entry.note !== 'string' || entry.note.length > 200 || typeof entry.time !== 'string' || !Number.isFinite(Date.parse(entry.time))) throw new Error('计分记录格式无效。');
  }
  // Rebuild using allowed fields only. Imported values stay plain text in React and XLSX.
  return { version: 1, title: state.title, source: state.source, size: state.size, balanced: state.balanced, students: state.students.map(s => ({id:s.id,name:s.name,number:s.number})), teams: state.teams.map(t => ({id:t.id,name:t.name,score:t.score,members:t.members.map(s => ({id:s.id,name:s.name,number:s.number}))})), history: state.history.map(h=>({id:h.id,teamId:h.teamId,teamName:h.teamName,delta:h.delta,note:h.note,time:h.time})) };
}

export function encodeSnapshot(state: Classroom): string {
  const snapshot = validateClassroom({ ...state, students: state.teams.flatMap(t=>t.members), history: [], source: '分享的课堂快照' });
  if (!snapshot.teams.length) throw new Error('请先生成队伍。');
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const encoded = btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  if (encoded.length > 60000) throw new Error('当前班级较大，请使用导出 Excel 分享结果。');
  return encoded;
}

export function decodeSnapshot(value: string): Classroom {
  if (!value || value.length > 60000 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('分享链接无效或过长。');
  try {
    const bytes = Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
    const state = validateClassroom(JSON.parse(new TextDecoder().decode(bytes)));
    if (!state.teams.length) throw new Error();
    return {...state,history:[]};
  } catch { throw new Error('分享链接不完整或已损坏，请让老师重新分享。'); }
}
