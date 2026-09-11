'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorkBook } from 'xlsx';
import { Shuffle, Upload, Users, Download, Plus, Minus, Check, LayoutGrid, Trophy, FileSpreadsheet, Undo2, RotateCcw, Share2, Expand, X, PencilLine, LoaderCircle, List, Trash2, History, CloudUpload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { activeAssignment, addAssignment, clearAssignmentScores, regroupClassroom, renameAssignment, selectAssignment, setTeamScore, studentSummary, addScore, demoNames, emptyClassroom, inferColumns, ranking, rosterFromRows, teamSizes, undoScore, type Classroom, type Student } from '@/lib/classroom';

type ImportData = { book: WorkBook; file: string; sheet: string; rows: string[][]; options: ReturnType<typeof inferColumns> };
type Confirm = { message: string; action: () => void };
function Choice({label,value,options,onChange}:{label:string;value:string;options:{label:string;value:string}[];onChange:(value:string)=>void}) {
  const id=useId();
  return <label className="choice-field" htmlFor={id}><span>{label}</span><Select value={value} onValueChange={v=>{if(v!==null)onChange(v)}}><SelectTrigger id={id} className="choice-trigger" aria-label={label}><SelectValue>{options.find(o=>o.value===value)?.label || '请选择'}</SelectValue></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
type HomeProps = {
  initialState: Classroom;
  readOnly: boolean;
  headerActions: ReactNode;
  status: ReactNode;
  onDraftChange?: (state: Classroom) => string;
  onPublish?: (state: Classroom) => void;
  publishing?: boolean;
};
export default function Home({initialState,readOnly,headerActions,status,onDraftChange,onPublish,publishing=false}: HomeProps) {
  const [state,setState] = useState<Classroom>(initialState);
  const current = useRef(state);
  const assignment = activeAssignment(state);
  const ready = true;
  const [notice,setNotice] = useState('');
  const [saveError,setSaveError] = useState('');
  const [tab,setTab] = useState('board');
  const [presenting,setPresenting] = useState(false);
  const [busy,setBusy] = useState(false);
  const [dragging,setDragging] = useState(false);
  const [confirm,setConfirm] = useState<Confirm|null>(null);
  const [importData,setImportData] = useState<ImportData|null>(null);
  const [dialog,setDialog] = useState<'manual'|'roster'|'score'|'history'|'share'|'assignment'|'rename-assignment'|null>(null);
  const [assignmentNameInput,setAssignmentNameInput] = useState('');
  const [manual,setManual] = useState('');
  const [scoreTeam,setScoreTeam] = useState('');
  const [points,setPoints] = useState('1');
  const [scoreNote,setScoreNote] = useState('');
  const [dialogError,setDialogError] = useState('');
  const [shareURL,setShareURL] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const commit = useCallback((next: Classroom) => {
    if(readOnly)return;
    current.current=next;setState(next);
    setSaveError(onDraftChange?.(next) ?? '');
  },[readOnly,onDraftChange]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return ()=>clearTimeout(timer)},[notice]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setPresenting(false)};
    document.addEventListener('keydown',onKey);return ()=>document.removeEventListener('keydown',onKey);
  },[]);
  // Optional imperative API; unsupported browsers keep the regular UI.
  useEffect(()=>{
    if(!ready)return;
    type Tool = {name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown};
    const context=(document as Document & {modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const definitions: Tool[]=[{name:'get_classroom_teams',description:'Read the current classroom teams and scores.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({title:current.current.title,teams:activeAssignment(current.current).teams})}];
    if(!readOnly)definitions.push({name:'randomize_classroom_teams',description:'Randomly group the loaded roster. Fails if existing teams would be replaced; use the visible confirmation flow in that case.',inputSchema:{type:'object',properties:{size:{type:'integer',minimum:1,maximum:100}},required:['size'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input)=>{
      const size=(input as {size?:number})?.size;
      if(!Number.isInteger(size)||Number(size)<1||Number(size)>100)throw new Error('Invalid team size');
      if(activeAssignment(current.current).teams.length)throw new Error('Use the visible regroup confirmation before replacing teams');
      const next=regroupClassroom({...current.current,size:Number(size)});
      commit(next);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {teams:activeAssignment(next).teams};
    }});
    definitions.forEach(tool=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}});
    return ()=>lifecycle.abort();
  },[ready,readOnly,commit]);

  const sizes=teamSizes(state.students.length,state.size,state.balanced);
  const ranks=useMemo(()=>ranking(assignment.teams.filter(t=>t.graded)),[assignment.teams]);
  const duplicateNames=useMemo(()=>new Set(state.students.filter((s,i,all)=>all.findIndex(n=>n.name===s.name)!==i).map(s=>s.name)),[state.students]);
  const preview=useMemo(()=>{
    if(!importData)return null;
    try{return {...rosterFromRows(importData.rows,importData.options),error:''}}catch(error){return {students:[],skipped:0,duplicateNames:0,error:errorMessage(error)}}
  },[importData]);
  function openDialog(value: typeof dialog){setDialogError('');setDialog(value)}
  function requestChange(action:()=>void,message:string,needed=activeAssignment(current.current).teams.length>0) {if(readOnly)return;if(needed)setConfirm({message,action});else action()}
  function replaceRoster(students:Student[],source:string) {
    requestChange(()=>{commit({...emptyClassroom(),title:current.current.title,size:current.current.size,balanced:current.current.balanced,students,source});setTab('board');setNotice('已导入 '+students.length+' 位同学。')},'替换名单将清除全部分组和每周成绩。仅新增一周请使用“添加作业”。',current.current.students.length>0);
  }
  function randomize() {
    requestChange(()=>{
      try{commit(regroupClassroom(current.current));setTab('board');setNotice('分队完成。')}
      catch(error){setNotice(errorMessage(error))}
    },'重新分队将重置当前作业的队伍分数和计分记录，保留个人成绩；再次评分会更新成员本次作业成绩。');
  }
  function changeScore(teamId:string,delta:number,note='',absolute=false) {
    if(readOnly)return false;
    try{if(absolute&&points.trim()==='')throw new Error('请输入分数。');commit(absolute?setTeamScore(current.current,teamId,delta,note):addScore(current.current,teamId,delta,note));return true}
    catch(error){setNotice(errorMessage(error));setDialogError(errorMessage(error));return false}
  }
  async function handleFile(file:File) {
    if(readOnly||busy)return;
    setBusy(true);setNotice('');
    try {
      const excel=await import('@/lib/excel');
      const book=excel.readWorkbook(await file.arrayBuffer(),file.name);
      const sheet=book.SheetNames[0];const rows=excel.sheetRows(book,sheet);
      setImportData({book,file:file.name,sheet,rows,options:inferColumns(rows)});setDialogError('');
    }catch(error){setNotice('导入失败：'+errorMessage(error))}
    finally{setBusy(false);if(fileInput.current)fileInput.current.value=''}
  }
  async function changeSheet(sheet:string) {
    if(!importData)return;
    try{const {sheetRows}=await import('@/lib/excel');const rows=sheetRows(importData.book,sheet);setImportData({...importData,sheet,rows,options:inferColumns(rows)});setDialogError('')}
    catch(error){setDialogError(errorMessage(error))}
  }
  async function excelAction(template=false) {
    try{const excel=await import('@/lib/excel');if(template)excel.downloadTemplate();else excel.downloadResults(current.current)}
    catch(error){setNotice(errorMessage(error))}
  }
  async function share() {
    try{
      const url=new URL(window.location.href);url.hash='';url.search='';
      setShareURL(url.toString());openDialog('share');
    }catch(error){setNotice(errorMessage(error))}
  }
  async function copyShare(){
    try{await navigator.clipboard.writeText(shareURL);setNotice('链接已复制。')}
    catch{setDialogError('请选中链接手动复制。')}
  }
  function displayNumber(student:Student) {return student.number || (duplicateNames.has(student.name)?'#'+student.id.replace('student-',''):'')}
  const scoreTarget=assignment.teams.find(t=>t.id===scoreTeam);

  return <div className={'app-shell'+(presenting?' presenting':'')}>
    <header className="site-header"><a className="brand" href="./"><span className="brand-mark"><Shuffle size={23}/></span><h1>几何深度学习</h1></a><div className="header-actions">{!readOnly&&<Button className="publish-button" disabled={publishing} onClick={()=>onPublish?.(current.current)}>{publishing?<LoaderCircle size={16} className="spin"/>:<CloudUpload size={16}/>} 发布</Button>}{headerActions}</div></header>
    <main className="workspace">
      {status}
      {saveError&&<div className="error-banner" role="alert">{saveError}</div>}
      <div className={'work-grid'+(readOnly?' readonly-grid':'')+(tab==='grades'?' gradebook-grid':'')}>
        {!readOnly&&<aside className="control-panel">
          <section className="control-section"><h2><span className="step-number">01</span> 学生名单 <FileSpreadsheet size={18}/></h2>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="sr-only" tabIndex={-1} aria-label="导入学生名单" onChange={e=>{const file=e.target.files?.[0];if(file)void handleFile(file)}}/>
            <button className={'dropzone'+(dragging?' dragging':'')} disabled={!ready||busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const file=e.dataTransfer.files[0];if(file)void handleFile(file)}}>
              <span className="upload-icon">{busy?<LoaderCircle size={25} className="spin"/>:<Upload size={25}/>}</span><strong>{busy?'正在读取名单…':'点击或拖入 Excel 文件'}</strong><span>.xlsx / .xls / .csv · ≤10 MB</span>
            </button><div className="under-upload"><button onClick={()=>void excelAction(true)}><Download size={13}/> 名单模板</button><button onClick={()=>{setManual('');openDialog('manual')}}><PencilLine size={13}/> 粘贴姓名</button></div>
            {!state.students.length&&<button className="demo-link" onClick={()=>replaceRoster(demoNames.map((name,i)=>({id:'student-'+(i+1),name,number:String(i+1).padStart(3,'0')})),'示例名单（18 人）')}>使用示例名单</button>}
            <button className="roster-summary" disabled={!state.students.length} onClick={()=>openDialog('roster')}><Users size={18}/><span>已导入 <strong>{state.students.length}</strong> 位同学</span>{!!state.students.length&&<List size={17}/>}</button>
            {!!state.students.length&&<div className="name-preview">{state.students.slice(0,6).map(s=><span key={s.id}>{s.name}</span>)}<small title={state.source}>{state.source}</small></div>}
          </section>
          <section className="control-section"><h2><span className="step-number">02</span> 分队设置</h2>
            <label className="field-label" htmlFor="class-title">课堂名称</label><Input id="class-title" className="class-title" value={state.title} maxLength={80} onChange={e=>commit({...current.current,title:e.target.value})} placeholder="课堂名称"/>
            <label className="field-label" htmlFor="team-size">每队最多人数</label><div className="stepper"><button aria-label="减少每队人数" disabled={state.size<=1} onClick={()=>commit({...current.current,size:state.size-1})}><Minus size={16}/></button><input id="team-size" type="number" min="1" max="100" step="1" value={state.size} onChange={e=>{const size=Number(e.target.value);if(Number.isInteger(size)&&size>=1&&size<=100)commit({...current.current,size})}}/><span>人 / 队</span><button aria-label="增加每队人数" disabled={state.size>=100} onClick={()=>commit({...current.current,size:state.size+1})}><Plus size={16}/></button></div>
            <Choice label="人数不能整除时" value={state.balanced?'balanced':'remainder'} options={[{value:'balanced',label:'均衡分配（最多相差 1 人）'},{value:'remainder',label:'余下单独成队'}]} onChange={value=>commit({...current.current,balanced:value==='balanced'})}/>
            <div className="estimate"><span>预计组成</span><strong>{sizes.length} <small>支队伍</small></strong></div>
            {!!sizes.length&&<p className="size-explanation">{[...new Set(sizes)].sort((a,b)=>b-a).map(size=>sizes.filter(s=>s===size).length+' 队 × '+size+' 人').join('，')}</p>}
            <Button className="primary-button" disabled={!ready||!state.students.length||busy} onClick={randomize}><Shuffle size={18}/>{assignment.teams.length?'重新随机分队':'随机分队'}</Button>
            {!!assignment.teams.length&&<p className="small-help">下次分队生效。</p>}
          </section>
        </aside>}
        <section className="results-panel"><Tabs value={tab} onValueChange={value=>setTab(String(value))} className="board-tabs">
          <div className="results-toolbar"><TabsList variant="line" className="real-tabs"><TabsTrigger value="board"><LayoutGrid size={17}/> 分队看板</TabsTrigger><TabsTrigger value="grades"><FileSpreadsheet size={17}/> 个人成绩表</TabsTrigger><TabsTrigger value="ranking"><Trophy size={17}/> 本周排行</TabsTrigger></TabsList><div className="toolbar-actions"><Button variant="ghost" className="icon-button" aria-label={presenting?'退出投屏模式':'进入投屏模式'} title={presenting?'退出投屏':'投屏模式'} onClick={()=>setPresenting(!presenting)}>{presenting?<X size={18}/>:<Expand size={18}/>}</Button><Button variant="outline" className="export-button" disabled={!state.students.length} onClick={()=>void excelAction()}><Download size={15}/> 导出</Button></div></div>
          <div className="assignment-bar"><Choice label={readOnly?'查看作业':'当前评分作业'} value={state.activeAssignmentId} options={state.assignments.map(a=>({value:a.id,label:a.name}))} onChange={id=>{const next=selectAssignment(current.current,id);if(readOnly){current.current=next;setState(next)}else commit(next)}}/><div className="assignment-actions">{!readOnly&&<><Button variant="outline" onClick={()=>{setAssignmentNameInput('第'+(state.assignments.length+1)+'周作业');openDialog('assignment')}}><Plus size={15}/> 添加作业</Button><Button variant="ghost" aria-label="修改作业名称" title="修改作业名称" onClick={()=>{setAssignmentNameInput(assignment.name);openDialog('rename-assignment')}}><PencilLine size={16}/></Button></>}</div></div>
          {!!assignment.teams.length&&<div className="board-subtoolbar"><span><b>{state.title||'我的课堂'}</b><span className="board-meta">{assignment.teams.length} 支队伍 · {state.students.length} 位同学</span></span><div>{!readOnly&&<><button onClick={()=>{commit(undoScore(current.current));setNotice('已撤销上一次计分。')}} disabled={!assignment.history.length} title="撤销上一次计分"><Undo2 size={14}/> 撤销</button><button onClick={()=>requestChange(()=>commit(clearAssignmentScores(current.current)),'清除本次作业的全部成绩和计分记录？其他周保留。')} title="清除本次作业成绩"><RotateCcw size={14}/> 清零</button></>}<button onClick={()=>void share()}><Share2 size={14}/> 分享</button></div></div>}
          <TabsContent value="board">
            {assignment.teams.length?<div className="teams-grid">{assignment.teams.map((team,i)=><article className={'team-card tone-'+i%6} key={team.id}>
              <div className="team-heading"><span className="team-number">{String(i+1).padStart(2,'0')}</span><h3>{team.name}</h3><span>{team.members.length} 人</span></div>
              <div className="team-members">{team.members.map(student=><div key={student.id}><span className="avatar">{student.name.slice(-1)}</span><span>{student.name}{displayNumber(student)&&<small>{displayNumber(student)}</small>}</span></div>)}</div>
              <div className="team-score"><span>作业成绩</span><strong aria-live="polite" aria-label={team.name+(team.graded?'成绩 '+team.score:'未评分')}>{team.graded?team.score:'—'}<small>{team.graded?' 分':' 未评分'}</small></strong>{!readOnly&&<div className="score-buttons"><button className="minus-score" aria-label={team.name+'减 1 分'} onClick={()=>changeScore(team.id,-1)}><Minus size={15}/></button><button className="plus-score" aria-label={team.name+'加 1 分'} onClick={()=>changeScore(team.id,1)}><Plus size={15}/></button><button className="custom-score" aria-label={team.name+'填写作业总分'} onClick={()=>{setScoreTeam(team.id);setPoints(team.graded?String(team.score):'');setScoreNote('');openDialog('score')}}><PencilLine size={15}/></button></div>}</div>
            </article>)}</div>:<div className="empty-board"><div className="empty-symbol"><Users size={38}/><span><Plus size={16}/></span></div><h2>{readOnly?'暂无已发布分组':state.students.length?'点击“随机分队”生成队伍':'请导入学生名单'}</h2></div>}
          </TabsContent>
          <TabsContent value="grades">
            <section className="gradebook">
              <div className="gradebook-heading"><span>{state.students.length} 位同学 · {state.assignments.length} 次作业</span></div>
              {state.students.length?<><div className="gradebook-table"><Table><TableHeader><TableRow><TableHead className="student-column">姓名</TableHead><TableHead>学号 / 编号</TableHead>{state.assignments.map(a=><TableHead key={a.id} className={a.id===state.activeAssignmentId?'selected-assignment':''}>{a.name}{a.id===state.activeAssignmentId&&<small>当前评分</small>}</TableHead>)}<TableHead>已评次数</TableHead><TableHead>平均分</TableHead></TableRow></TableHeader><TableBody>{state.students.map(student=>{const summary=studentSummary(state,student.id);return <TableRow key={student.id}><TableCell className="student-column">{student.name}</TableCell><TableCell>{student.number||student.id.replace('student-','#')}</TableCell>{state.assignments.map(a=><TableCell key={a.id} className={'grade-cell'+(a.id===state.activeAssignmentId?' selected-assignment':'')}>{Object.hasOwn(a.grades,student.id)?<strong>{a.grades[student.id]}</strong>:<span className="ungraded" aria-label="未评分">—</span>}</TableCell>)}<TableCell>{summary.count}</TableCell><TableCell className="average-cell">{summary.average??'—'}</TableCell></TableRow>})}</TableBody></Table></div><div className="gradebook-legend"><span>— 未评分；平均分仅计已评分作业。</span></div></>:<div className="empty-board gradebook-empty"><FileSpreadsheet size={40} className="muted-icon"/><h2>暂无学生名单</h2>{!readOnly&&<Button variant="outline" onClick={()=>setTab('board')}>导入名单</Button>}</div>}
            </section>
          </TabsContent>
          <TabsContent value="ranking">{ranks.length?<div className="ranking-view">{ranks.map(team=><div className={'rank-row'+(team.rank===1?' first-place':'')} key={team.id}><span className="rank-number">{team.rank===1?<Trophy size={21}/>:String(team.rank).padStart(2,'0')}</span><div><strong>{team.name}</strong><p>{team.members.map(s=>s.name+(duplicateNames.has(s.name)?'（'+displayNumber(s)+'）':'')).join('、')}</p></div><span className="rank-score">{team.score}<small> 分</small></span></div>)}</div>:<div className="empty-board"><Trophy size={42} className="muted-icon"/><h2>暂无评分</h2></div>}</TabsContent>
        </Tabs>
        <div className="board-footer"><span><Check size={14}/>{'已评分 '+Object.keys(assignment.grades).length+'/'+state.students.length+' 人'}</span>{assignment.history.length?<button onClick={()=>openDialog('history')}><History size={14}/> 计分记录 ({assignment.history.length})</button>:null}</div>
        </section>
      </div>
    </main>
    {presenting&&<Button className="exit-presentation" variant="outline" onClick={()=>setPresenting(false)}><X size={16}/> 退出投屏 · Esc</Button>}
    {notice&&<output className="status-notice"><Check size={17}/><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></output>}
    <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null)}}><AlertDialogContent><AlertDialogTitle>确认修改当前课堂？</AlertDialogTitle><AlertDialogDescription>{confirm?.message}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={()=>{const action=confirm?.action;setConfirm(null);action?.()}}>确认继续</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!importData} onOpenChange={open=>{if(!open)setImportData(null)}}><DialogContent className="wide-dialog"><DialogTitle>确认导入名单</DialogTitle><DialogDescription className="file-description">{importData?.file}</DialogDescription>
      {importData&&<><Choice label="工作表" value={importData.sheet} options={importData.book.SheetNames.map(name=>({value:name,label:name}))} onChange={value=>void changeSheet(value)}/>
        <div className="import-row"><label className="choice-field" htmlFor="import-start-row"><span>起始行（Excel 行号）</span><Input id="import-start-row" type="number" min="1" max="1000" value={importData.options.headerRow+1} onChange={e=>{const row=Number(e.target.value);if(Number.isInteger(row)&&row>=1&&row<=1000)setImportData({...importData,options:{...importData.options,headerRow:row-1}})}}/></label><label className="check-field" htmlFor="import-header"><Checkbox id="import-header" checked={importData.options.hasHeader} onCheckedChange={checked=>setImportData({...importData,options:{...importData.options,hasHeader:!!checked}})}/> 起始行是表头</label></div>
        <div className="import-row">{(['nameColumn','idColumn'] as const).map(key=><Choice key={key} label={key==='nameColumn'?'姓名列（必选）':'学号列（可选）'} value={String(importData.options[key])} options={[...(key==='idColumn'?[{value:'-1',label:'不使用学号'}]:[]),...Array.from({length:Math.min(100,Math.max(1,...importData.rows.map(r=>r.length)))},(_,i)=>({value:String(i),label:'第 '+(i+1)+' 列'+(importData.options.hasHeader?' · '+(importData.rows[importData.options.headerRow]?.[i]||'未命名'):'')}))]} onChange={value=>setImportData({...importData,options:{...importData.options,[key]:Number(value)}})}/>)}</div>
        {preview&&!preview.error&&<><div className="import-preview"><Table><TableHeader><TableRow><TableHead>姓名</TableHead><TableHead>学号</TableHead></TableRow></TableHeader><TableBody>{preview.students.slice(0,6).map(s=><TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell>{s.number||'—'}</TableCell></TableRow>)}</TableBody></Table></div><p className="small-help">预览前 6 人，共 {preview.students.length} 人。{preview.skipped>0?'已跳过 '+preview.skipped+' 行空姓名。':''}{preview.duplicateNames>0?'有同名学生，请确认。':''}</p></>}
        {(preview?.error||dialogError)&&<p role="alert" className="inline-error">{dialogError||preview?.error}</p>}
        <Button className="primary-button" disabled={!preview?.students.length||!!preview?.error||!!dialogError} onClick={()=>{if(preview?.students.length){const data=preview.students;const source=importData.file;setImportData(null);replaceRoster(data,source)}}}>导入 {preview?.students.length||0} 位同学</Button></>}
    </DialogContent></Dialog>
    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent className={dialog==='roster'||dialog==='history'?'wide-dialog':'standard-dialog'}>
      {(dialog==='assignment'||dialog==='rename-assignment')&&<><DialogTitle>{dialog==='assignment'?'添加每周作业':'修改作业名称'}</DialogTitle><DialogDescription>{dialog==='assignment'?'沿用当前分组，新作业成绩为空。':'仅修改名称。'}</DialogDescription><label className="choice-field" htmlFor="assignment-name"><span>作业名称</span><Input id="assignment-name" maxLength={80} value={assignmentNameInput} onChange={e=>setAssignmentNameInput(e.target.value)} placeholder="例如：第2周作业"/></label><Button className="primary-button" onClick={()=>{try{commit(dialog==='assignment'?addAssignment(current.current,assignmentNameInput):renameAssignment(current.current,assignmentNameInput));setDialog(null);setNotice(dialog==='assignment'?'已添加作业。':'作业名称已更新。')}catch(error){setDialogError(errorMessage(error))}}}>{dialog==='assignment'?'添加并开始评分':'保存名称'}</Button></>}
      {dialog==='manual'&&<><DialogTitle>粘贴学生姓名</DialogTitle><DialogDescription>每行一个姓名，也可用逗号分隔。</DialogDescription><Textarea rows={8} value={manual} onChange={e=>setManual(e.target.value)} placeholder={'陈思远\n林雨桐\n王子涵'} maxLength={60000}/><Button className="primary-button" onClick={()=>{try{const rows=manual.split(/[\n\r,，、;；]+/).map(n=>[n.trim()]);const result=rosterFromRows(rows,{headerRow:0,hasHeader:false,nameColumn:0,idColumn:-1});setDialog(null);replaceRoster(result.students,'手动粘贴名单')}catch(error){setDialogError(errorMessage(error))}}}>使用这份名单</Button></>}
      {dialog==='roster'&&<><DialogTitle>班级名单 · {state.students.length} 人</DialogTitle><DialogDescription>{state.source}</DialogDescription><div className="roster-list"><Table><TableHeader><TableRow><TableHead>序号</TableHead><TableHead>姓名</TableHead><TableHead>学号 / 记录编号</TableHead></TableRow></TableHeader><TableBody>{state.students.map((s,i)=><TableRow key={s.id}><TableCell>{i+1}</TableCell><TableCell>{s.name}</TableCell><TableCell>{displayNumber(s)||'—'}</TableCell></TableRow>)}</TableBody></Table></div><Button variant="outline" onClick={()=>{setDialog(null);requestChange(()=>commit(emptyClassroom()),'清空名单、分组和全部每周成绩？',true)}}><Trash2 size={16}/> 清空当前课堂</Button></>}
      {dialog==='score'&&<><DialogTitle>{scoreTarget?.name} · 作业评分</DialogTitle><DialogDescription>{assignment.name}：总分同步到每位成员，覆盖本次作业成绩。</DialogDescription><label className="choice-field" htmlFor="score-delta"><span>本次作业总分</span><Input id="score-delta" type="number" step="0.1" min="-1000000" max="1000000" value={points} onChange={e=>setPoints(e.target.value)} placeholder="支持一位小数"/></label><label className="choice-field" htmlFor="score-note"><span>计分备注（可选）</span><Input id="score-note" maxLength={200} value={scoreNote} onChange={e=>setScoreNote(e.target.value)} placeholder="备注"/></label><Button className="primary-button" onClick={()=>{if(changeScore(scoreTeam,Number(points),scoreNote,true))setDialog(null)}}>保存并同步成员成绩</Button></>}
      {dialog==='history'&&<><DialogTitle>计分记录</DialogTitle><DialogDescription>{assignment.name} · 最近 2000 条</DialogDescription><div className="history-list">{[...assignment.history].reverse().map(h=><div className="history-entry" key={h.id}><span><b>{h.teamName}</b><small>{h.note||'课堂计分'} · {new Date(h.time).toLocaleTimeString('zh-CN',{hour12:false})}</small></span><strong className={h.delta>=0?'positive':'negative'}>{h.delta>0?'+':''}{h.delta}</strong></div>)}</div></>}
      {dialog==='share'&&<><DialogTitle>分享课堂</DialogTitle><DialogDescription>此网址显示已发布的分组和每周成绩，更新后刷新查看。</DialogDescription><Textarea aria-label="课堂分享链接" className="share-url" readOnly value={shareURL} onFocus={e=>e.target.select()} rows={3}/><Button className="primary-button" onClick={()=>void copyShare()}><Share2 size={16}/> 复制网址</Button></>}
      {dialogError&&<p className="inline-error" role="alert">{dialogError}</p>}
    </DialogContent></Dialog>
  </div>;
}
