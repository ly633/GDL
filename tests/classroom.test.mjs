import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { groupStudents, teamSizes, addScore, undoScore, ranking, inferColumns, rosterFromRows, validateClassroom, emptyClassroom, encodeSnapshot, decodeSnapshot, randomIndex } from '../lib/classroom.ts';
import { readWorkbook, sheetRows, workbookFromClassroom } from '../lib/excel.ts';

const roster = count => Array.from({length:count},(_,i)=>({id:`student-${i+1}`,name:`同学${i+1}`,number:String(i+1).padStart(3,'0')}));
const classroom = () => {const students=roster(10);return {...emptyClassroom(),students,teams:groupStudents(students,3,true)};};

test('all supported class sizes: no missing or duplicate students, correct group count and size',()=>{
  for(let count=1;count<=500;count++)for(const size of [1,2,3,4,7,20,100])for(const balanced of [true,false]){
    const students=roster(count);const before=JSON.stringify(students);const teams=groupStudents(students,size,balanced,max=>max-1);
    assert.equal(teams.length,Math.ceil(count/size));
    assert.deepEqual(teams.map(t=>t.members.length),teamSizes(count,size,balanced));
    assert.deepEqual(teams.flatMap(t=>t.members).map(s=>s.id).sort(),students.map(s=>s.id).sort());
    assert.equal(JSON.stringify(students),before);
    if(balanced)assert.ok(Math.max(...teams.map(t=>t.members.length))-Math.min(...teams.map(t=>t.members.length))<=1);
  }
});
test('random grouping uses valid random indices and rejects invalid parameters',()=>{
  for(const max of [1,3,9,100,500])for(let i=0;i<100;i++)assert.ok(randomIndex(max)>=0&&randomIndex(max)<max);
  for(const size of [0,-1,1.5,101,NaN])assert.throws(()=>groupStudents(roster(10),size,true));
  assert.throws(()=>groupStudents([],3,true));assert.throws(()=>groupStudents(roster(501),3,true));
  assert.throws(()=>groupStudents([roster(1)[0],roster(1)[0]],3,true));
});
test('score changes, decimal precision, ties, undo and reloading are consistent',()=>{
  let state=classroom();const first=state.teams[0].id;const second=state.teams[1].id;
  state=addScore(state,first,0.1,'课堂发言');state=addScore(state,first,0.2);assert.equal(state.teams[0].score,0.3);
  state=addScore(state,second,0.3);assert.deepEqual(ranking(state.teams).map(t=>t.rank),[1,1,3,3]);
  state=addScore(state,first,-1);assert.equal(state.teams[0].score,-0.7);
  state=undoScore(state);assert.equal(state.teams[0].score,0.3);assert.equal(state.history.length,3);
  assert.deepEqual(validateClassroom(JSON.parse(JSON.stringify(state))),state);
  assert.throws(()=>addScore(state,first,NaN));assert.throws(()=>addScore(state,first,10001));assert.throws(()=>addScore(state,first,0));assert.throws(()=>addScore(state,'missing',1));
});
test('column inference handles title rows, headerless data, empty names and duplicate names',()=>{
  const rows=[['班级名单'],[],['学号','姓名'],['001','张三'],['002','李四'],['003','张三'],['004','']];
  const options=inferColumns(rows);assert.equal(options.headerRow,2);assert.equal(options.nameColumn,1);
  const result=rosterFromRows(rows,options);assert.equal(result.students.length,3);assert.equal(result.duplicateNames,1);assert.equal(result.skipped,1);assert.equal(result.students[0].number,'001');
  assert.equal(rosterFromRows([['甲'],['乙']],inferColumns([['甲'],['乙']])).students.length,2);
  assert.throws(()=>rosterFromRows([['姓名','学号'],['甲','001'],['乙','001']],{headerRow:0,hasHeader:true,nameColumn:0,idColumn:1}),/重复/);
});
test('share snapshots roundtrip Unicode and scores without retaining history',()=>{
  let state=classroom();state.title='高一 · 第三节 🧑‍🏫';state=addScore(state,state.teams[0].id,5);
  const decoded=decodeSnapshot(encodeSnapshot(state));assert.deepEqual(decoded.teams,state.teams);assert.equal(decoded.title,state.title);assert.deepEqual(decoded.history,[]);
  assert.throws(()=>decodeSnapshot('invalid'));assert.throws(()=>decodeSnapshot('x'.repeat(60001)));
  const invalid=structuredClone(state);invalid.teams[0].members.push(invalid.teams[1].members[0]);assert.throws(()=>validateClassroom(invalid));
  const missing=structuredClone(state);missing.teams[0].members.pop();assert.throws(()=>validateClassroom(missing));
});
test('real XLSX and XLS buffers import the selected sheet with formatted leading-zero IDs',()=>{
  for(const bookType of ['xlsx','biff8']){
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['说明'],['示例数据']]),'说明');
    const sheet=XLSX.utils.aoa_to_sheet([[],[],['学号','姓名'],[1,'张三'],['002','李四']]);sheet.A4.z='000';XLSX.utils.book_append_sheet(book,sheet,'名单');
    const buffer=XLSX.write(book,{type:'array',bookType});const imported=readWorkbook(buffer,bookType==='xlsx'?'名单.xlsx':'名单.xls');
    const rows=sheetRows(imported,'名单');const options=inferColumns(rows);assert.equal(options.headerRow,2);
    const result=rosterFromRows(rows,options);assert.equal(result.students.length,2);assert.equal(result.students[0].number,'001');
  }
});
test('CSV preserves text IDs and handles quoted names, blank rows and BOM',()=>{
  const bytes=new TextEncoder().encode('\uFEFF学号,姓名\r\n001,"张,三"\r\n002,李四\r\n,\r\n');
  const book=readWorkbook(bytes.buffer,'test.csv');const rows=sheetRows(book,book.SheetNames[0]);const result=rosterFromRows(rows,inferColumns(rows));
  assert.equal(result.students[0].number,'001');assert.equal(result.students[0].name,'张,三');assert.equal(result.students.length,2);
});
test('exported workbook contains actual scores, typed numbers and safe text cells',()=>{
  let state=classroom();state.students[0].name='=1+1';state.teams=groupStudents(state.students,3,true);state=addScore(state,state.teams[0].id,2.5,'测试记录');
  const book=workbookFromClassroom(state);const exported=XLSX.write(book,{type:'array',bookType:'xlsx'});const loaded=XLSX.read(exported,{type:'array'});
  assert.deepEqual(loaded.SheetNames,['积分排行','分组明细','计分记录']);assert.equal(loaded.Sheets['积分排行'].D2.v,2.5);assert.equal(loaded.Sheets['积分排行'].D2.t,'n');
  const detail=XLSX.utils.sheet_to_json(loaded.Sheets['分组明细']);assert.equal(detail.length,10);assert.equal(detail.find(row=>row['姓名']==='=1+1')['学号'],'001');
  for(const [address,cell] of Object.entries(loaded.Sheets['分组明细']))if(!address.startsWith('!'))assert.equal(cell.f,undefined);
});
test('oversize or unsupported imports fail clearly',()=>{
  assert.throws(()=>readWorkbook(new ArrayBuffer(10*1024*1024+1),'big.xlsx'),/10 MB/);
  assert.throws(()=>readWorkbook(new ArrayBuffer(1),'bad.txt'));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,{'!ref':'A1:A1001'},'big');assert.throws(()=>sheetRows(book,'big'),/过大/);
});
