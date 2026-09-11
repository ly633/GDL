export type Student = { id: string; name: string; number: string };
export type Team = { id: string; name: string; members: Student[]; score: number; graded: boolean };
export type ScoreEntry = { id: string; teamId: string; teamName: string; delta: number; note: string; time: string; previousScore: number; previousGraded: boolean; previousGrades: Record<string, number | null> };
export type Assignment = { id: string; name: string; teams: Team[]; history: ScoreEntry[]; grades: Record<string, number> };
export type Classroom = { version: 2; title: string; students: Student[]; assignments: Assignment[]; activeAssignmentId: string; size: number; balanced: boolean; source: string };
// Keep the storage key so existing classrooms migrate in place without losing data.
export const STORAGE_KEY = 'classroom-teams-v1';
export const MAX_STUDENTS = 500;
export const MAX_ASSIGNMENTS = 100;
export const emptyClassroom = (): Classroom => ({ version: 2, title: '我的课堂', students: [], assignments: [{ id: 'assignment-1', name: '第1周作业', teams: [], history: [], grades: {} }], activeAssignmentId: 'assignment-1', size: 3, balanced: true, source: '' });
export function activeAssignment(state: Classroom): Assignment {
  const assignment = state.assignments.find(a => a.id === state.activeAssignmentId);
  if (!assignment) throw new Error('当前作业不存在。');
  return assignment;
}
function updateAssignment(state: Classroom, next: Assignment): Classroom {
  return { ...state, assignments: state.assignments.map(a => a.id === next.id ? next : a) };
}
export function selectAssignment(state: Classroom, id: string): Classroom {
  if (!state.assignments.some(a => a.id === id)) throw new Error('作业不存在。');
  return { ...state, activeAssignmentId: id };
}
function assignmentName(state: Classroom, name: string, exceptId = '') {
  name = name.trim();
  if (!name || name.length > 80) throw new Error('请输入 1–80 字的作业名称。');
  if (state.assignments.some(a => a.id !== exceptId && a.name === name)) throw new Error('已有同名作业，请使用不同的名称。');
  return name;
}
export function addAssignment(state: Classroom, name: string): Classroom {
  if (state.assignments.length >= MAX_ASSIGNMENTS) throw new Error('最多支持 100 次作业，请导出后新建课堂。');
  const assignment: Assignment = { id: globalThis.crypto.randomUUID(), name: assignmentName(state, name), teams: activeAssignment(state).teams.map(t => ({ ...t, score: 0, graded: false })), history: [], grades: {} };
  return { ...state, assignments: [...state.assignments, assignment], activeAssignmentId: assignment.id };
}
export function renameAssignment(state: Classroom, name: string): Classroom {
  const assignment = activeAssignment(state);
  return updateAssignment(state, { ...assignment, name: assignmentName(state, name, assignment.id) });
}
export function regroupClassroom(state: Classroom): Classroom {
  const assignment = activeAssignment(state);
  return updateAssignment(state, { ...assignment, teams: groupStudents(state.students, state.size, state.balanced), history: [] });
}
export function clearAssignmentScores(state: Classroom): Classroom {
  const assignment = activeAssignment(state);
  return updateAssignment(state, { ...assignment, teams: assignment.teams.map(t => ({ ...t, score: 0, graded: false })), grades: {}, history: [] });
}
export function studentSummary(state: Classroom, studentId: string) {
  const values = state.assignments.flatMap(a => Object.hasOwn(a.grades, studentId) ? [a.grades[studentId]] : []);
  const total = Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10;
  return { count: values.length, total, average: values.length ? Math.round(total / values.length * 10) / 10 : null };
}
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
  const teams: Team[] = Array.from({ length: count }, (_, i) => ({ id: `team-${i+1}`, name: `第 ${i+1} 小队`, members: [], score: 0, graded: false }));
  shuffled.forEach((student, i) => teams[balanced ? i % count : Math.floor(i / size)].members.push(student));
  return teams;
}

export function teamSizes(count: number, size: number, balanced: boolean): number[] {
  if (!count || !Number.isInteger(size) || size < 1) return [];
  const teams = Math.ceil(count / size);
  return Array.from({ length: teams }, (_, i) => balanced ? Math.floor(count / teams) + (i < count % teams ? 1 : 0) : Math.min(size, count - i * size));
}

export function addScore(state: Classroom, teamId: string, delta: number, note = ''): Classroom {
  const team = activeAssignment(state).teams.find(t => t.id === teamId);
  if (!team) throw new Error('队伍不存在。');
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10000) throw new Error('分数需为非零数值，且单次不超过 10000 分。');
  delta = Math.round(delta * 10) / 10;
  if (!delta) throw new Error('分数至少为 0.1 分。');
  return setTeamScore(state, teamId, Math.round((team.score + delta) * 10) / 10, note);
}

export function setTeamScore(state: Classroom, teamId: string, value: number, note = ''): Classroom {
  const assignment = activeAssignment(state);
  const team = assignment.teams.find(t => t.id === teamId);
  if (!team) throw new Error('队伍不存在。');
  if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('请输入有效分数，绝对值不能超过 1000000。');
  const score = Math.round(value * 10) / 10;
  const previousGrades = Object.fromEntries(team.members.map(s => [s.id, assignment.grades[s.id] ?? null]));
  const grades = { ...assignment.grades, ...Object.fromEntries(team.members.map(s => [s.id, score])) };
  const entry: ScoreEntry = { id: globalThis.crypto.randomUUID(), teamId, teamName: team.name, delta: Math.round((score - team.score) * 10) / 10, note: note.trim().slice(0,200), time: new Date().toISOString(), previousScore: team.score, previousGraded: team.graded, previousGrades };
  return updateAssignment(state, { ...assignment, teams: assignment.teams.map(t => t.id === teamId ? { ...t, score, graded: true } : t), grades, history: [...assignment.history, entry].slice(-2000) });
}

export function undoScore(state: Classroom): Classroom {
  const assignment = activeAssignment(state);
  const last = assignment.history.at(-1);
  if (!last) return state;
  const grades = { ...assignment.grades };
  for (const [id, value] of Object.entries(last.previousGrades)) {
    if (value === null) delete grades[id];
    else grades[id] = value;
  }
  return updateAssignment(state, { ...assignment, teams: assignment.teams.map(t => t.id === last.teamId ? { ...t, score: last.previousScore, graded: last.previousGraded } : t), grades, history: assignment.history.slice(0,-1) });
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

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
}
function migrateLegacy(candidate: Record<string, unknown>): unknown {
  if (!Array.isArray(candidate.teams) || !Array.isArray(candidate.history)) throw new Error('旧版课堂数据格式无效。');
  const oldTeams = candidate.teams as Team[];
  const oldHistory = candidate.history as ScoreEntry[];
  const teams = oldTeams.map(team => {
    if (!team || !Array.isArray(team.members) || !validScore(team.score)) throw new Error('旧版队伍数据无效。');
    return { ...team, graded: team.score !== 0 || oldHistory.some(h => h?.teamId === team.id) };
  });
  const scores = new Map(teams.map(t => [t.id, t.score]));
  const history: ScoreEntry[] = [];
  for (let i = oldHistory.length - 1; i >= 0; i--) {
    const entry = oldHistory[i];
    const team = teams.find(t => t.id === entry?.teamId);
    if (!entry || !team || !Number.isFinite(entry.delta) || Math.abs(entry.delta) > 10000) throw new Error('旧版计分记录无效。');
    const previousScore = Math.round((scores.get(team.id)! - entry.delta) * 10) / 10;
    const previousGraded = previousScore !== 0 || oldHistory.slice(0,i).some(h => h?.teamId === team.id);
    history.unshift({ ...entry, previousScore, previousGraded, previousGrades: Object.fromEntries(team.members.map(s => [s.id, previousGraded ? previousScore : null])) });
    scores.set(team.id, previousScore);
  }
  const grades = Object.fromEntries(teams.filter(t => t.graded).flatMap(t => t.members.map(s => [s.id, t.score])));
  return { ...candidate, version: 2, assignments: [{ id: 'assignment-1', name: '第1周作业', teams, history, grades }], activeAssignmentId: 'assignment-1' };
}

export function validateClassroom(value: unknown): Classroom {
  const candidate = value as Record<string, unknown>;
  const state = (candidate?.version === 1 ? migrateLegacy(candidate) : value) as Classroom;
  if (!state || state.version !== 2 || typeof state.title !== 'string' || state.title.length > 80 || typeof state.source !== 'string' || state.source.length > 300 || !Number.isInteger(state.size) || state.size < 1 || state.size > 100 || typeof state.balanced !== 'boolean' || !Array.isArray(state.students) || state.students.length > MAX_STUDENTS || !state.students.every(validStudent) || new Set(state.students.map(s => s.id)).size !== state.students.length || !Array.isArray(state.assignments) || !state.assignments.length || state.assignments.length > MAX_ASSIGNMENTS || typeof state.activeAssignmentId !== 'string') throw new Error('课堂数据格式无效。');
  const roster = new Map(state.students.map(s => [s.id, s]));
  const assignmentIds = new Set<string>();
  const assignmentNames = new Set<string>();
  const assignments = state.assignments.map(assignment => {
    if (!assignment || typeof assignment.id !== 'string' || !assignment.id || assignment.id.length > 100 || assignmentIds.has(assignment.id) || typeof assignment.name !== 'string' || !assignment.name.trim() || assignment.name.length > 80 || assignmentNames.has(assignment.name) || !Array.isArray(assignment.teams) || assignment.teams.length > MAX_STUDENTS || !Array.isArray(assignment.history) || assignment.history.length > 2000 || !assignment.grades || typeof assignment.grades !== 'object' || Array.isArray(assignment.grades)) throw new Error('每周作业数据格式无效。');
    assignmentIds.add(assignment.id);
    assignmentNames.add(assignment.name);
    const memberIds = new Set<string>();
    const teamIds = new Set<string>();
    const teams = assignment.teams.map(team => {
      if (!team || typeof team.id !== 'string' || !team.id || team.id.length > 100 || teamIds.has(team.id) || typeof team.name !== 'string' || team.name.length > 80 || !validScore(team.score) || typeof team.graded !== 'boolean' || !Array.isArray(team.members) || !team.members.length || team.members.length > 100) throw new Error('队伍数据格式无效。');
      teamIds.add(team.id);
      const members = team.members.map(member => {
        const original = roster.get(member?.id);
        if (!validStudent(member) || memberIds.has(member.id) || !original || original.name !== member.name || original.number !== member.number) throw new Error('队伍成员数据不一致。');
        memberIds.add(member.id);
        return { id: member.id, name: member.name, number: member.number };
      });
      return { id: team.id, name: team.name, members, score: team.score, graded: team.graded };
    });
    if (teams.length && memberIds.size !== state.students.length) throw new Error('队伍名单不完整。');
    const grades = Object.fromEntries(Object.entries(assignment.grades).map(([id, score]) => {
      if (!roster.has(id) || !validScore(score)) throw new Error('个人成绩格式无效。');
      return [id, score];
    }));
    for (const team of teams) if (team.graded && team.members.some(s => grades[s.id] !== team.score)) throw new Error('小队分数与个人成绩不一致。');
    const history = assignment.history.map(entry => {
      const team = teams.find(t => t.id === entry?.teamId);
      if (!entry || typeof entry.id !== 'string' || !team || typeof entry.teamName !== 'string' || entry.teamName.length > 80 || !Number.isFinite(entry.delta) || Math.abs(entry.delta) > 2000000 || typeof entry.note !== 'string' || entry.note.length > 200 || typeof entry.time !== 'string' || !Number.isFinite(Date.parse(entry.time)) || !validScore(entry.previousScore) || typeof entry.previousGraded !== 'boolean' || !entry.previousGrades || typeof entry.previousGrades !== 'object' || Array.isArray(entry.previousGrades)) throw new Error('计分记录格式无效。');
      const keys = Object.keys(entry.previousGrades);
      if (keys.length !== team.members.length || team.members.some(s => !Object.hasOwn(entry.previousGrades, s.id))) throw new Error('计分回退记录不完整。');
      const previousGrades = Object.fromEntries(Object.entries(entry.previousGrades).map(([id, score]) => {
        if (!roster.has(id) || (score !== null && !validScore(score))) throw new Error('计分回退记录无效。');
        return [id, score];
      }));
      return { id: entry.id, teamId: entry.teamId, teamName: entry.teamName, delta: entry.delta, note: entry.note, time: entry.time, previousScore: entry.previousScore, previousGraded: entry.previousGraded, previousGrades };
    });
    return { id: assignment.id, name: assignment.name, teams, grades, history };
  });
  if (!assignmentIds.has(state.activeAssignmentId)) throw new Error('当前作业不存在。');
  return { version: 2, title: state.title, source: state.source, size: state.size, balanced: state.balanced, students: state.students.map(s => ({id:s.id,name:s.name,number:s.number})), assignments, activeAssignmentId: state.activeAssignmentId };
}

export function encodeSnapshot(state: Classroom): string {
  // Share only the selected assignment, not the rest of the gradebook.
  const assignment = activeAssignment(state);
  const snapshot = validateClassroom({ ...state, assignments: [{ ...assignment, history: [] }], source: '分享的课堂快照' });
  if (!assignment.teams.length && !Object.keys(assignment.grades).length) throw new Error('请先生成队伍或记录成绩。');
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
    const assignment = activeAssignment(state);
    if (!assignment.teams.length && !Object.keys(assignment.grades).length) throw new Error();
    return { ...state, assignments: [{ ...assignment, history: [] }] };
  } catch { throw new Error('分享链接不完整或已损坏，请让老师重新分享。'); }
}

