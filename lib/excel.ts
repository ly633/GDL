import * as XLSX from 'xlsx';
import { activeAssignment, ranking, studentSummary, type Classroom } from './classroom.ts';

export function readWorkbook(data: ArrayBuffer, filename: string): XLSX.WorkBook {
  if (!/\.(xlsx|xls|csv)$/i.test(filename)) throw new Error('请选择 .xlsx、.xls 或 .csv 文件。');
  if (data.byteLength > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB，请仅保留当前班级名单。');
  let source: ArrayBuffer | string = data;
  if (/\.csv$/i.test(filename)) {
    source = new TextDecoder('utf-8').decode(data);
    if (source.includes('\uFFFD')) source = new TextDecoder('gb18030').decode(data);
  }
  const book = XLSX.read(source, { type: typeof source === 'string' ? 'string' : 'array', raw: true, sheetRows: 1000, cellFormula: false, cellHTML: false });
  if (!book.SheetNames.length) throw new Error('文件中没有工作表。');
  return book;
}

export function sheetRows(book: XLSX.WorkBook, name: string): string[][] {
  const sheet = book.Sheets[name];
  if (!sheet?.['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (range.e.r >= 1000 || range.e.c >= 100) throw new Error('工作表过大，请保留名单（1000 行、100 列以内）。');
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, raw: false, defval: '', blankrows: true }).map(row=>row.map(cell=>String(cell ?? '')));
}

export function workbookFromClassroom(state: Classroom): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const assignment = activeAssignment(state);
  const ranks = ranking(assignment.teams.filter(t => t.graded));
  type Cell = string | number | null;
  const personal: Cell[][] = [['学号 / 编号','姓名', ...state.assignments.map(a => a.name), '已评次数','平均分']];
  state.students.forEach(student => {
    const summary = studentSummary(state, student.id);
    personal.push([student.number || student.id.replace('student-', '#'), student.name, ...state.assignments.map(a => a.grades[student.id] ?? null), summary.count, summary.average]);
  });
  const summary: Cell[][] = [['排名','队伍','人数','作业成绩','成员'],...ranks.map(t=>[t.rank,t.name,t.members.length,t.score,t.members.map(s=>s.name).join('、')])];
  const details: Cell[][] = [['作业','队伍','姓名','学号 / 编号','个人成绩']];
  state.assignments.forEach(a => a.teams.forEach(t=>t.members.forEach(s=>details.push([a.name,t.name,s.name,s.number || s.id.replace('student-', '#'),a.grades[s.id] ?? null]))));
  const history: Cell[][] = [['作业','时间','队伍','分数变化','备注'],...state.assignments.flatMap(a => a.history.map(h=>[a.name,new Date(h.time).toLocaleString('zh-CN',{hour12:false}),h.teamName,h.delta,h.note]))];
  const sheets: [string, Cell[][], number[]][] = [['个人每周成绩',personal,[20,18,...state.assignments.map(() => 20),12,12]], ['当前作业队伍排行',summary,[10,18,10,14,60]], ['分组明细',details,[22,18,18,22,14]], ['计分记录',history,[22,25,18,14,45]]];
  for (const [name, rows, widths] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(r=>[...r]));
    sheet['!cols'] = widths.map(w=>({wch:w}));
    sheet['!autofilter'] = {ref: sheet['!ref'] || 'A1'};
    XLSX.utils.book_append_sheet(book,sheet,name);
  }
  return book;
}

export function downloadResults(state: Classroom) {
  if (!state.students.length) throw new Error('请先导入学生名单。');
  const title = state.title.replace(/[\\/:*?"<>|]/g,'_') || '课堂';
  XLSX.writeFile(workbookFromClassroom(state),`${title}_个人每周成绩_${new Date().toISOString().slice(0,10)}.xlsx`);
}

export function downloadTemplate() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['学号','姓名'],['001','陈思远'],['002','林雨桐'],['003','王子涵'],['004','李嘉宁'],['005','张一诺'],['006','赵明轩']]);
  sheet['!cols'] = [{wch:18},{wch:18}];
  XLSX.utils.book_append_sheet(book,sheet,'学生名单');
  XLSX.writeFile(book,'课堂名单模板.xlsx');
}

