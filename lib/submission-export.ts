import * as XLSX from 'xlsx';
import { type Submission } from './submissions.ts';
export function workbookFromSubmissions(items: Submission[]): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  // Strings remain string cells, including leading zeros and formula-like text.
  const sheet = XLSX.utils.aoa_to_sheet([
    ['姓名', '学号', '提交时间（北京时间）', '提交内容', '回执编号'],
    ...items.map(row => [row.name, row.studentNumber, new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }), row.content, row.receipt]),
  ]);
  sheet['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 26 }, { wch: 80 }, { wch: 40 }];
  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:E1' };
  XLSX.utils.book_append_sheet(book, sheet, '文本提交');
  return book;
}
export function downloadSubmissions(items: Submission[]) {
  XLSX.writeFile(workbookFromSubmissions(items), `几何深度学习_文本提交_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
