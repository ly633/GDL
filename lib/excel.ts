import * as XLSX from 'xlsx';
import { ranking, type Classroom } from './classroom.ts';

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
  const ranks = ranking(state.teams);
  const summary = [['排名','队伍','人数','课堂积分','成员'],...ranks.map(t=>[t.rank,t.name,t.members.length,t.score,t.members.map(s=>s.name).join('、')])];
  const details: (string | number)[][] = [['队伍','姓名','学号','小队积分']];
  state.teams.forEach(t=>t.members.forEach(s=>details.push([t.name,s.name,s.number,t.score])));
  const history: (string | number)[][] = [['时间','队伍','分数变化','备注'],...state.history.map(h=>[new Date(h.time).toLocaleString('zh-CN',{hour12:false}),h.teamName,h.delta,h.note])];
  for (const [name, rows, widths] of [ ['积分排行',summary,[10,18,10,14,60]], ['分组明细',details,[18,18,22,14]], ['计分记录',history,[25,18,14,45]]] as const) {
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(r=>[...r]));
    sheet['!cols'] = widths.map(w=>({wch:w}));
    sheet['!autofilter'] = {ref: sheet['!ref'] || 'A1'};
    XLSX.utils.book_append_sheet(book,sheet,name);
  }
  return book;
}

export function downloadResults(state: Classroom) {
  if (!state.teams.length) throw new Error('请先生成队伍。');
  const title = state.title.replace(/[\\/:*?"<>|]/g,'_') || '课堂';
  XLSX.writeFile(workbookFromClassroom(state),`${title}_分队与评分_${new Date().toISOString().slice(0,10)}.xlsx`);
}

export function downloadTemplate() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['学号','姓名'],['001','陈思远'],['002','林雨桐'],['003','王子涵'],['004','李嘉宁'],['005','张一诺'],['006','赵明轩']]);
  sheet['!cols'] = [{wch:18},{wch:18}];
  XLSX.utils.book_append_sheet(book,sheet,'学生名单');
  XLSX.writeFile(book,'课堂名单模板.xlsx');
}

