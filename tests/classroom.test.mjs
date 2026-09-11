import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { activeAssignment, addAssignment, clearAssignmentScores, regroupClassroom, renameAssignment, selectAssignment, setTeamScore, studentSummary, groupStudents, teamSizes, addScore, undoScore, ranking, inferColumns, rosterFromRows, validateClassroom, emptyClassroom, encodeSnapshot, decodeSnapshot, randomIndex } from '../lib/classroom.ts';
import { readWorkbook, sheetRows, workbookFromClassroom } from '../lib/excel.ts';

const roster = count => Array.from({length:count},(_,i)=>({id:`student-${i+1}`,name:`同学${i+1}`,number:String(i+1).padStart(3,'0')}));
const classroom = () => {const students=roster(10);return regroupClassroom({...emptyClassroom(),students});};

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
  let state=classroom();const first=activeAssignment(state).teams[0].id;const second=activeAssignment(state).teams[1].id;
  state=addScore(state,first,0.1,'课堂发言');state=addScore(state,first,0.2);assert.equal(activeAssignment(state).teams[0].score,0.3);
  state=addScore(state,second,0.3);assert.deepEqual(ranking(activeAssignment(state).teams).map(t=>t.rank),[1,1,3,3]);
  state=addScore(state,first,-1);assert.equal(activeAssignment(state).teams[0].score,-0.7);
  state=undoScore(state);assert.equal(activeAssignment(state).teams[0].score,0.3);assert.equal(activeAssignment(state).history.length,3);
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
  let state=classroom();state.title='高一 · 第三节 🧑‍🏫';state=addScore(state,activeAssignment(state).teams[0].id,5);
  const decoded=decodeSnapshot(encodeSnapshot(state));assert.deepEqual(activeAssignment(decoded).teams,activeAssignment(state).teams);assert.equal(decoded.title,state.title);assert.deepEqual(activeAssignment(decoded).history,[]);
  assert.throws(()=>decodeSnapshot('invalid'));assert.throws(()=>decodeSnapshot('x'.repeat(60001)));
  const invalid=structuredClone(state);activeAssignment(invalid).teams[0].members.push(activeAssignment(invalid).teams[1].members[0]);assert.throws(()=>validateClassroom(invalid));
  const missing=structuredClone(state);activeAssignment(missing).teams[0].members.pop();assert.throws(()=>validateClassroom(missing));
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
  let state=classroom();state.students[0].name='=1+1';state=regroupClassroom(state);state=addScore(state,activeAssignment(state).teams[0].id,2.5,'测试记录');
  const book=workbookFromClassroom(state);const exported=XLSX.write(book,{type:'array',bookType:'xlsx'});const loaded=XLSX.read(exported,{type:'array'});
  assert.deepEqual(loaded.SheetNames,['个人每周成绩','当前作业队伍排行','分组明细','计分记录']);assert.equal(loaded.Sheets['当前作业队伍排行'].D2.v,2.5);assert.equal(loaded.Sheets['当前作业队伍排行'].D2.t,'n');
  const detail=XLSX.utils.sheet_to_json(loaded.Sheets['分组明细']);assert.equal(detail.length,10);assert.equal(detail.find(row=>row['姓名']==='=1+1')['学号 / 编号'],'001');
  for(const [address,cell] of Object.entries(loaded.Sheets['分组明细']))if(!address.startsWith('!'))assert.equal(cell.f,undefined);
});
test('oversize or unsupported imports fail clearly',()=>{
  assert.throws(()=>readWorkbook(new ArrayBuffer(10*1024*1024+1),'big.xlsx'),/10 MB/);
  assert.throws(()=>readWorkbook(new ArrayBuffer(1),'bad.txt'));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,{'!ref':'A1:A1001'},'big');assert.throws(()=>sheetRows(book,'big'),/过大/);
});

test('a team total is copied in full to each member and later edits replace rather than accumulate',()=>{
  let state=classroom();const team=activeAssignment(state).teams[0];
  state=setTeamScore(state,team.id,85);
  for(const member of team.members)assert.equal(activeAssignment(state).grades[member.id],85);
  assert.equal(Object.keys(activeAssignment(state).grades).length,team.members.length);
  state=setTeamScore(state,team.id,90);state=setTeamScore(state,team.id,90);
  for(const member of team.members)assert.equal(activeAssignment(state).grades[member.id],90);
  state=addScore(state,team.id,1);
  for(const member of team.members)assert.equal(activeAssignment(state).grades[member.id],91);
  assert.deepEqual(validateClassroom(JSON.parse(JSON.stringify(state))),state);
});

test('weekly switching restores independent groups, scores and undo histories',()=>{
  let state=classroom();const firstId=state.activeAssignmentId;const team=activeAssignment(state).teams[0];
  state=setTeamScore(state,team.id,80,'第1周');const first=structuredClone(activeAssignment(state));
  state=addAssignment(state,'第2周作业');const secondId=state.activeAssignmentId;
  assert.deepEqual(activeAssignment(state).grades,{});assert.ok(activeAssignment(state).teams.every(t=>!t.graded));
  state=regroupClassroom(state);const secondTeam=activeAssignment(state).teams[0];state=setTeamScore(state,secondTeam.id,70,'第2周');
  const second=structuredClone(activeAssignment(state));
  state=selectAssignment(state,firstId);assert.deepEqual(activeAssignment(state),first);
  state=setTeamScore(state,team.id,90);state=selectAssignment(state,secondId);assert.deepEqual(activeAssignment(state),second);
  state=undoScore(state);assert.deepEqual(activeAssignment(state).grades,{});
  state=selectAssignment(state,firstId);for(const member of team.members)assert.equal(activeAssignment(state).grades[member.id],90);
  assert.deepEqual(validateClassroom(JSON.parse(JSON.stringify(state))),state);
});

test('zero is a graded mark, blank is ungraded, and averages only include actual marks',()=>{
  let state=classroom();const team=activeAssignment(state).teams[0];const student=team.members[0];
  assert.deepEqual(studentSummary(state,student.id),{count:0,total:0,average:null});
  state=setTeamScore(state,team.id,0);assert.equal(activeAssignment(state).grades[student.id],0);assert.equal(activeAssignment(state).teams[0].graded,true);
  assert.deepEqual(studentSummary(state,student.id),{count:1,total:0,average:0});
  state=undoScore(state);assert.equal(Object.hasOwn(activeAssignment(state).grades,student.id),false);assert.equal(activeAssignment(state).teams[0].graded,false);
  state=setTeamScore(state,team.id,0);state=addAssignment(state,'第2周作业');state=setTeamScore(state,team.id,80);
  state=addAssignment(state,'第3周作业');assert.deepEqual(studentSummary(state,student.id),{count:2,total:80,average:40});
});

test('regrouping preserves the gradebook and undo restores mixed prior individual marks exactly',()=>{
  let state=regroupClassroom({...emptyClassroom(),students:roster(6)});
  activeAssignment(state).teams=groupStudents(state.students,3,true,max=>max-1);
  state=setTeamScore(state,'team-1',80);state=setTeamScore(state,'team-2',60);
  const savedGrades={...activeAssignment(state).grades};
  state=regroupClassroom({...state,size:2});assert.deepEqual(activeAssignment(state).grades,savedGrades);
  activeAssignment(state).teams=groupStudents(state.students,2,true,max=>max-1);
  state=setTeamScore(state,'team-1',95);state=undoScore(state);
  assert.deepEqual(activeAssignment(state).grades,savedGrades);assert.equal(activeAssignment(state).teams[0].graded,false);
  assert.deepEqual(validateClassroom(state),state);
});

test('clearing the selected assignment and renaming it never change previous weeks',()=>{
  let state=classroom();state=setTeamScore(state,activeAssignment(state).teams[0].id,88);const first=structuredClone(activeAssignment(state));
  state=addAssignment(state,'第2周作业');state=setTeamScore(state,activeAssignment(state).teams[0].id,95);
  state=renameAssignment(state,'第2周 · 第三章');assert.equal(activeAssignment(state).name,'第2周 · 第三章');
  state=clearAssignmentScores(state);assert.deepEqual(activeAssignment(state).grades,{});assert.deepEqual(state.assignments[0],first);
  assert.throws(()=>addAssignment(state,'第1周作业'));assert.throws(()=>renameAssignment(state,' '));assert.throws(()=>selectAssignment(state,'missing'));
});

test('legacy storage and existing shared URLs migrate scores into the first assignment without loss',()=>{
  let state=classroom();state=setTeamScore(state,'team-1',70);state=addScore(state,'team-1',5);
  const assignment=activeAssignment(state);
  const legacy={version:1,title:state.title,students:state.students,size:state.size,balanced:state.balanced,source:state.source,teams:assignment.teams.map(t=>({id:t.id,name:t.name,members:t.members,score:t.score})),history:assignment.history.map(h=>({id:h.id,teamId:h.teamId,teamName:h.teamName,delta:h.delta,note:h.note,time:h.time}))};
  const migrated=validateClassroom(legacy);assert.equal(migrated.version,2);assert.equal(migrated.assignments.length,1);assert.equal(activeAssignment(migrated).name,'第1周作业');
  assert.deepEqual(activeAssignment(migrated).grades,assignment.grades);
  const undone=undoScore(migrated);for(const member of assignment.teams[0].members)assert.equal(activeAssignment(undone).grades[member.id],70);
  const encoded=Buffer.from(JSON.stringify({...legacy,history:[]})).toString('base64url');
  assert.equal(activeAssignment(decodeSnapshot(encoded)).grades[assignment.teams[0].members[0].id],75);
});

test('shares include only the current week and reject inconsistent personal scores',()=>{
  let state=classroom();state=setTeamScore(state,'team-1',80);state=addAssignment(state,'第2周作业');state=setTeamScore(state,'team-1',90);
  const decoded=decodeSnapshot(encodeSnapshot(state));assert.equal(decoded.assignments.length,1);assert.equal(activeAssignment(decoded).name,'第2周作业');assert.equal(activeAssignment(decoded).history.length,0);
  const invalid=structuredClone(state);const team=activeAssignment(invalid).teams[0];activeAssignment(invalid).grades[team.members[0].id]=12;assert.throws(()=>validateClassroom(invalid),/不一致/);
  const unknown=structuredClone(state);activeAssignment(unknown).grades.unknown=1;assert.throws(()=>validateClassroom(unknown));
  assert.throws(()=>setTeamScore(state,'team-1',NaN));assert.throws(()=>setTeamScore(state,'team-1',1000001));
});

test('weekly XLSX has one column per assignment and preserves zero, blank, decimals and identifiers',()=>{
  let state=classroom();state=setTeamScore(state,'team-1',0);const student=activeAssignment(state).teams[0].members[0];
  state=addAssignment(state,'第2周作业');state=setTeamScore(state,'team-1',85.5);state=addAssignment(state,'第3周作业');
  const saved=XLSX.write(workbookFromClassroom(state),{type:'array',bookType:'xlsx'});const loaded=XLSX.read(saved,{type:'array'});
  const rows=XLSX.utils.sheet_to_json(loaded.Sheets['个人每周成绩'],{defval:null});const row=rows.find(r=>r['学号 / 编号']===student.number);
  assert.equal(rows.length,10);assert.equal(row['第1周作业'],0);assert.equal(row['第2周作业'],85.5);assert.equal(row['第3周作业'],null);assert.equal(row['已评次数'],2);assert.equal(row['平均分'],42.8);
});
