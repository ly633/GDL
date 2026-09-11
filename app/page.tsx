'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WorkBook } from 'xlsx';
import { Shuffle, Upload, Users, Download, ArrowUpRight, Plus, Minus, GraduationCap, Check, LayoutGrid, Trophy, Monitor, FileSpreadsheet, Undo2, RotateCcw, Share2, Expand, X, PencilLine, LoaderCircle, List, LockKeyhole, Trash2, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { addScore, decodeSnapshot, demoNames, emptyClassroom, encodeSnapshot, groupStudents, inferColumns, ranking, rosterFromRows, STORAGE_KEY, teamSizes, undoScore, validateClassroom, type Classroom, type Student } from '@/lib/classroom';

type ImportData = { book: WorkBook; file: string; sheet: string; rows: string[][]; options: ReturnType<typeof inferColumns> };
type Confirm = { message: string; action: () => void };
function Choice({label,value,options,onChange}:{label:string;value:string;options:{label:string;value:string}[];onChange:(value:string)=>void}) {
  const id=useId();
  return <label className="choice-field" htmlFor={id}><span>{label}</span><Select value={value} onValueChange={v=>{if(v!==null)onChange(v)}}><SelectTrigger id={id} className="choice-trigger" aria-label={label}><SelectValue>{options.find(o=>o.value===value)?.label || '请选择'}</SelectValue></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></label>;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
function readInitial() {
  const initial={state:emptyClassroom(),readOnly:false,notice:'',saveError:''};
  if(window.location.hash.startsWith('#result=')) {
    try {initial.state=decodeSnapshot(window.location.hash.slice(8));initial.readOnly=true;return initial;}
    catch(error){initial.notice=errorMessage(error);}
  }
  try {const saved=localStorage.getItem(STORAGE_KEY);if(saved)initial.state=validateClassroom(JSON.parse(saved));}
  catch {initial.saveError='未能读取本地记录。你仍可使用网页，完成后请导出结果。';}
  return initial;
}

export default function Home() {
  const [initial] = useState(readInitial);
  const [state,setState] = useState<Classroom>(initial.state);
  const current = useRef(state);
  const ready = true;
  const readOnly = initial.readOnly;
  const [notice,setNotice] = useState(initial.notice);
  const [saveError,setSaveError] = useState(initial.saveError);
  const [tab,setTab] = useState('board');
  const [presenting,setPresenting] = useState(false);
  const [busy,setBusy] = useState(false);
  const [dragging,setDragging] = useState(false);
  const [confirm,setConfirm] = useState<Confirm|null>(null);
  const [importData,setImportData] = useState<ImportData|null>(null);
  const [dialog,setDialog] = useState<'manual'|'roster'|'score'|'history'|'share'|null>(null);
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
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setSaveError('');}
    catch {setSaveError('浏览器无法保存记录，请在离开前导出 Excel。');}
  },[readOnly]);
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
    const definitions: Tool[]=[{name:'get_classroom_teams',description:'Read the current classroom teams and scores.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({title:current.current.title,teams:current.current.teams})}];
    if(!readOnly)definitions.push({name:'randomize_classroom_teams',description:'Randomly group the loaded roster. Fails if existing teams would be replaced; use the visible confirmation flow in that case.',inputSchema:{type:'object',properties:{size:{type:'integer',minimum:1,maximum:100}},required:['size'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input)=>{
      const size=(input as {size?:number})?.size;
      if(!Number.isInteger(size)||Number(size)<1||Number(size)>100)throw new Error('Invalid team size');
      if(current.current.teams.length)throw new Error('Use the visible regroup confirmation before replacing teams');
      const next={...current.current,size:Number(size),teams:groupStudents(current.current.students,Number(size),current.current.balanced),history:[]};
      commit(next);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return {teams:next.teams};
    }});
    definitions.forEach(tool=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}});
    return ()=>lifecycle.abort();
  },[ready,readOnly,commit]);

  const sizes=teamSizes(state.students.length,state.size,state.balanced);
  const ranks=useMemo(()=>ranking(state.teams),[state.teams]);
  const duplicateNames=useMemo(()=>new Set(state.students.filter((s,i,all)=>all.findIndex(n=>n.name===s.name)!==i).map(s=>s.name)),[state.students]);
  const preview=useMemo(()=>{
    if(!importData)return null;
    try{return {...rosterFromRows(importData.rows,importData.options),error:''}}catch(error){return {students:[],skipped:0,duplicateNames:0,error:errorMessage(error)}}
  },[importData]);
  function openDialog(value: typeof dialog){setDialogError('');setDialog(value)}
  function requestChange(action:()=>void,message:string,needed=current.current.teams.length>0) {if(readOnly)return;if(needed)setConfirm({message,action});else action()}
  function replaceRoster(students:Student[],source:string) {
    requestChange(()=>{commit({...current.current,students,source,teams:[],history:[]});setTab('board');setNotice('已导入 '+students.length+' 位同学。')},'替换名单会清除当前分组和积分。需要保留时，请先导出 Excel。');
  }
  function randomize() {
    requestChange(()=>{
      try{commit({...current.current,teams:groupStudents(current.current.students,current.current.size,current.current.balanced),history:[]});setTab('board');setNotice('分队完成，每位同学都已安排。')}
      catch(error){setNotice(errorMessage(error))}
    },'重新分队将生成新的队伍，并清除本轮积分和计分记录。');
  }
  function changeScore(teamId:string,delta:number,note='') {
    if(readOnly)return false;
    try{commit(addScore(current.current,teamId,delta,note));return true}
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
      const encoded=encodeSnapshot(current.current);
      const url=new URL(window.location.href);url.hash='result='+encoded;
      setShareURL(url.toString());openDialog('share');
    }catch(error){setNotice(errorMessage(error))}
  }
  async function copyShare(){
    try{await navigator.clipboard.writeText(shareURL);setNotice('链接已复制，可以发给同学。')}
    catch{setDialogError('未能自动复制，请选中下方链接手动复制。')}
  }
  function displayNumber(student:Student) {return student.number || (duplicateNames.has(student.name)?'#'+student.id.replace('student-',''):'')}
  const scoreTarget=state.teams.find(t=>t.id===scoreTeam);

  return <div className={'app-shell'+(presenting?' presenting':'')}>
    <header className="site-header"><a className="brand" href="./"><span className="brand-mark"><Shuffle size={23}/></span><span>一起组队<span className="brand-en">CLASSROOM TEAMS</span></span></a><span className="header-note"><GraduationCap size={18}/> 让每一次课堂，都有新的碰撞</span><span className="local-badge"><span/>{readOnly?'只读结果':'本地运行'}</span></header>
    <main className="workspace">
      {readOnly&&<div className="share-banner"><LockKeyhole size={17}/><span>这是老师分享的结果快照，后续变化需要新的分享链接。</span><a href={typeof window!=='undefined'?window.location.pathname:'./'}>创建自己的课堂 <ArrowUpRight size={14}/></a></div>}
      {saveError&&<div className="error-banner" role="alert">{saveError}</div>}
      <section className="page-heading"><div><div className="eyebrow">{readOnly?'课堂结果快照':'课堂协作工具'}</div><h1>{readOnly?state.title:'好课堂，从组队开始'}<span className="blue-dot">.</span></h1><p>{readOnly?'查看本轮分组与积分，也可以导出结果。':'导入名单，随机组队，记录每一份课堂表现。'}</p></div>{!readOnly&&<Button variant="outline" className="outline-button" disabled={!ready} onClick={()=>replaceRoster(demoNames.map((name,i)=>({id:'student-'+(i+1),name,number:String(i+1).padStart(3,'0')})),'示例名单（18 人）')}>体验示例名单 <ArrowUpRight size={16}/></Button>}</section>
      <div className={'work-grid'+(readOnly?' readonly-grid':'')}>
        {!readOnly&&<aside className="control-panel">
          <section className="control-section"><h2><span className="step-number">01</span> 学生名单 <FileSpreadsheet size={18}/></h2>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="sr-only" tabIndex={-1} aria-label="导入学生名单" onChange={e=>{const file=e.target.files?.[0];if(file)void handleFile(file)}}/>
            <button className={'dropzone'+(dragging?' dragging':'')} disabled={!ready||busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const file=e.dataTransfer.files[0];if(file)void handleFile(file)}}>
              <span className="upload-icon">{busy?<LoaderCircle size={25} className="spin"/>:<Upload size={25}/>}</span><strong>{busy?'正在读取名单…':'点击或拖入 Excel 文件'}</strong><span>支持 .xlsx、.xls、.csv · 最大 10 MB</span>
            </button><div className="under-upload"><button onClick={()=>void excelAction(true)}><Download size={13}/> 名单模板</button><button onClick={()=>{setManual('');openDialog('manual')}}><PencilLine size={13}/> 粘贴姓名</button></div>
            <button className="roster-summary" disabled={!state.students.length} onClick={()=>openDialog('roster')}><Users size={18}/><span>已导入 <strong>{state.students.length}</strong> 位同学</span>{!!state.students.length&&<List size={17}/>}</button>
            {!!state.students.length&&<div className="name-preview">{state.students.slice(0,6).map(s=><span key={s.id}>{s.name}</span>)}<small title={state.source}>{state.source} · 点击上方查看完整名单</small></div>}
          </section>
          <section className="control-section"><h2><span className="step-number">02</span> 分队设置</h2>
            <label className="field-label" htmlFor="class-title">课堂名称</label><Input id="class-title" className="class-title" value={state.title} maxLength={80} onChange={e=>commit({...current.current,title:e.target.value})} placeholder="例如：周三的小组讨论"/>
            <label className="field-label" htmlFor="team-size">每队最多人数</label><div className="stepper"><button aria-label="减少每队人数" disabled={state.size<=1} onClick={()=>commit({...current.current,size:state.size-1})}><Minus size={16}/></button><input id="team-size" type="number" min="1" max="100" step="1" value={state.size} onChange={e=>{const size=Number(e.target.value);if(Number.isInteger(size)&&size>=1&&size<=100)commit({...current.current,size})}}/><span>人 / 队</span><button aria-label="增加每队人数" disabled={state.size>=100} onClick={()=>commit({...current.current,size:state.size+1})}><Plus size={16}/></button></div>
            <Choice label="人数不能整除时" value={state.balanced?'balanced':'remainder'} options={[{value:'balanced',label:'均衡分配，人数最多相差 1'},{value:'remainder',label:'按人数分组，余下单独成队'}]} onChange={value=>commit({...current.current,balanced:value==='balanced'})}/>
            <div className="estimate"><span>预计组成</span><strong>{sizes.length} <small>支队伍</small></strong></div>
            {!!sizes.length&&<p className="size-explanation">{[...new Set(sizes)].sort((a,b)=>b-a).map(size=>sizes.filter(s=>s===size).length+' 队 × '+size+' 人').join('，')}</p>}
            <Button className="primary-button" disabled={!ready||!state.students.length||busy} onClick={randomize}><Shuffle size={18}/>{state.teams.length?'重新随机分队':'随机分队'}</Button>
            {!!state.teams.length&&<p className="small-help">设置变化将在下次分队时生效。</p>}
          </section>
          <div className="sidebar-tip"><GraduationCap size={19}/><p>Excel 文件只在本机读取。<br/>分组与分数自动保存在当前浏览器。</p></div>
        </aside>}
        <section className="results-panel"><Tabs value={tab} onValueChange={value=>setTab(String(value))} className="board-tabs">
          <div className="results-toolbar"><TabsList variant="line" className="real-tabs"><TabsTrigger value="board"><LayoutGrid size={17}/> 分队看板</TabsTrigger><TabsTrigger value="ranking"><Trophy size={17}/> 积分排行</TabsTrigger></TabsList><div className="toolbar-actions"><Button variant="ghost" className="icon-button" aria-label={presenting?'退出投屏模式':'进入投屏模式'} title={presenting?'退出投屏':'投屏模式'} onClick={()=>setPresenting(!presenting)}>{presenting?<X size={18}/>:<Expand size={18}/>}</Button><Button variant="outline" className="export-button" disabled={!state.teams.length} onClick={()=>void excelAction()}><Download size={15}/> 导出</Button></div></div>
          {!!state.teams.length&&<div className="board-subtoolbar"><span><b>{state.title||'我的课堂'}</b><span className="board-meta">{state.teams.length} 支队伍 · {state.students.length} 位同学</span></span><div>{!readOnly&&<><button onClick={()=>{commit(undoScore(current.current));setNotice('已撤销上一次计分。')}} disabled={!state.history.length} title="撤销上一次计分"><Undo2 size={14}/> 撤销</button><button onClick={()=>requestChange(()=>commit({...current.current,teams:current.current.teams.map(t=>({...t,score:0})),history:[]}),'将所有小队的积分归零，并清除计分记录。')} title="清零本轮积分"><RotateCcw size={14}/> 清零</button></>}<button onClick={()=>void share()}><Share2 size={14}/> 分享</button></div></div>}
          <TabsContent value="board">
            {state.teams.length?<div className="teams-grid">{state.teams.map((team,i)=><article className={'team-card tone-'+i%6} key={team.id}>
              <div className="team-heading"><span className="team-number">{String(i+1).padStart(2,'0')}</span><h3>{team.name}</h3><span>{team.members.length} 人</span></div>
              <div className="team-members">{team.members.map(student=><div key={student.id}><span className="avatar">{student.name.slice(-1)}</span><span>{student.name}{displayNumber(student)&&<small>{displayNumber(student)}</small>}</span></div>)}</div>
              <div className="team-score"><span>课堂积分</span><strong aria-live="polite" aria-label={team.name+'积分 '+team.score}>{team.score}<small> 分</small></strong>{!readOnly&&<div className="score-buttons"><button className="minus-score" aria-label={team.name+'减 1 分'} onClick={()=>changeScore(team.id,-1)}><Minus size={15}/></button><button className="plus-score" aria-label={team.name+'加 1 分'} onClick={()=>changeScore(team.id,1)}><Plus size={15}/></button><button className="custom-score" aria-label={team.name+'自定义计分'} onClick={()=>{setScoreTeam(team.id);setPoints('1');setScoreNote('');openDialog('score')}}><PencilLine size={15}/></button></div>}</div>
            </article>)}</div>:<div className="empty-board"><div className="empty-symbol"><Users size={38}/><span><Plus size={16}/></span></div><span className="eyebrow">READY WHEN YOU ARE</span><h2>今天，和谁成为队友？</h2><p>{state.students.length?'名单已经就绪，设置人数后点击「随机分队」。':'从左侧导入班级名单，或体验示例名单。'}<br/>一键随机分队，把更多时间留给课堂。</p><div className="empty-steps"><span><b>1</b> 导入名单</span><i/><span><b>2</b> 设置人数</span><i/><span><b>3</b> 开始组队</span></div></div>}
          </TabsContent>
          <TabsContent value="ranking">{ranks.length?<div className="ranking-view"><div className="ranking-intro"><span className="trophy-mark"><Trophy size={24}/></span><div><h2>课堂积分榜</h2><p>按当前积分排序，相同分数并列。</p></div></div>{ranks.map(team=><div className={'rank-row'+(team.rank===1?' first-place':'')} key={team.id}><span className="rank-number">{team.rank===1?<Trophy size={21}/>:String(team.rank).padStart(2,'0')}</span><div><strong>{team.name}</strong><p>{team.members.map(s=>s.name+(duplicateNames.has(s.name)?'（'+displayNumber(s)+'）':'')).join('、')}</p></div><span className="rank-score">{team.score}<small> 分</small></span></div>)}</div>:<div className="empty-board"><Trophy size={42} className="muted-icon"/><h2>每一分，都值得被看见</h2><p>分队后，为小队的课堂表现加分。<br/>这里会自动更新积分排名。</p></div>}</TabsContent>
        </Tabs>
        <div className="board-footer"><span><Check size={14}/>{readOnly?'只读结果 · 可导出 Excel':'每位同学只出现一次 · 自动保存'}</span>{state.history.length?<button onClick={()=>openDialog('history')}><History size={14}/> 计分记录 ({state.history.length})</button>:<span><Monitor size={14}/> 为课堂大屏而设计</span>}</div>
        </section>
      </div>
      <footer className="site-footer"><span>一起组队 / 每一位同学，都有自己的位置。</span><span>{readOnly?'分享结果不会覆盖你的本地课堂':'静态网页 · 无需登录 · 数据保存在当前浏览器'}</span></footer>
    </main>
    {presenting&&<Button className="exit-presentation" variant="outline" onClick={()=>setPresenting(false)}><X size={16}/> 退出投屏 · Esc</Button>}
    {notice&&<output className="status-notice"><Check size={17}/><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></output>}
    <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null)}}><AlertDialogContent><AlertDialogTitle>确认修改当前课堂？</AlertDialogTitle><AlertDialogDescription>{confirm?.message}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={()=>{const action=confirm?.action;setConfirm(null);action?.()}}>确认继续</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!importData} onOpenChange={open=>{if(!open)setImportData(null)}}><DialogContent className="wide-dialog"><DialogTitle>确认导入名单</DialogTitle><DialogDescription className="file-description">{importData?.file} · 选择姓名所在列，确认后导入。</DialogDescription>
      {importData&&<><Choice label="工作表" value={importData.sheet} options={importData.book.SheetNames.map(name=>({value:name,label:name}))} onChange={value=>void changeSheet(value)}/>
        <div className="import-row"><label className="choice-field" htmlFor="import-start-row"><span>起始行（Excel 行号）</span><Input id="import-start-row" type="number" min="1" max="1000" value={importData.options.headerRow+1} onChange={e=>{const row=Number(e.target.value);if(Number.isInteger(row)&&row>=1&&row<=1000)setImportData({...importData,options:{...importData.options,headerRow:row-1}})}}/></label><label className="check-field" htmlFor="import-header"><Checkbox id="import-header" checked={importData.options.hasHeader} onCheckedChange={checked=>setImportData({...importData,options:{...importData.options,hasHeader:!!checked}})}/> 起始行是表头</label></div>
        <div className="import-row">{(['nameColumn','idColumn'] as const).map(key=><Choice key={key} label={key==='nameColumn'?'姓名列（必选）':'学号列（可选）'} value={String(importData.options[key])} options={[...(key==='idColumn'?[{value:'-1',label:'不使用学号'}]:[]),...Array.from({length:Math.min(100,Math.max(1,...importData.rows.map(r=>r.length)))},(_,i)=>({value:String(i),label:'第 '+(i+1)+' 列'+(importData.options.hasHeader?' · '+(importData.rows[importData.options.headerRow]?.[i]||'未命名'):'')}))]} onChange={value=>setImportData({...importData,options:{...importData.options,[key]:Number(value)}})}/>)}</div>
        {preview&&!preview.error&&<><div className="import-preview"><Table><TableHeader><TableRow><TableHead>姓名</TableHead><TableHead>学号</TableHead></TableRow></TableHeader><TableBody>{preview.students.slice(0,6).map(s=><TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell>{s.number||'—'}</TableCell></TableRow>)}</TableBody></Table></div><p className="small-help">预览前 6 人，共 {preview.students.length} 人。{preview.skipped>0?'已跳过 '+preview.skipped+' 行空姓名。':''}{preview.duplicateNames>0?'同名记录保留为不同学生，请确认不是重复行。':''}</p></>}
        {(preview?.error||dialogError)&&<p role="alert" className="inline-error">{dialogError||preview?.error}</p>}
        <Button className="primary-button" disabled={!preview?.students.length||!!preview?.error||!!dialogError} onClick={()=>{if(preview?.students.length){const data=preview.students;const source=importData.file;setImportData(null);replaceRoster(data,source)}}}>导入 {preview?.students.length||0} 位同学</Button></>}
    </DialogContent></Dialog>
    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent className={dialog==='roster'||dialog==='history'?'wide-dialog':'standard-dialog'}>
      {dialog==='manual'&&<><DialogTitle>粘贴学生姓名</DialogTitle><DialogDescription>每行一个姓名；支持用逗号、顿号或分号分隔。同名会保留为不同学生。</DialogDescription><Textarea rows={8} value={manual} onChange={e=>setManual(e.target.value)} placeholder={'陈思远\n林雨桐\n王子涵'} maxLength={60000}/><Button className="primary-button" onClick={()=>{try{const rows=manual.split(/[\n\r,，、;；]+/).map(n=>[n.trim()]);const result=rosterFromRows(rows,{headerRow:0,hasHeader:false,nameColumn:0,idColumn:-1});setDialog(null);replaceRoster(result.students,'手动粘贴名单')}catch(error){setDialogError(errorMessage(error))}}}>使用这份名单</Button></>}
      {dialog==='roster'&&<><DialogTitle>班级名单 · {state.students.length} 人</DialogTitle><DialogDescription>{state.source}。同名同学用学号或记录编号区分。</DialogDescription><div className="roster-list"><Table><TableHeader><TableRow><TableHead>序号</TableHead><TableHead>姓名</TableHead><TableHead>学号 / 记录编号</TableHead></TableRow></TableHeader><TableBody>{state.students.map((s,i)=><TableRow key={s.id}><TableCell>{i+1}</TableCell><TableCell>{s.name}</TableCell><TableCell>{displayNumber(s)||'—'}</TableCell></TableRow>)}</TableBody></Table></div><Button variant="outline" onClick={()=>{setDialog(null);requestChange(()=>commit(emptyClassroom()),'清空学生名单、分组和全部积分。需要保留时，请先导出结果。',true)}}><Trash2 size={16}/> 清空当前课堂</Button></>}
      {dialog==='score'&&<><DialogTitle>{scoreTarget?.name} · 自定义计分</DialogTitle><DialogDescription>输入增加或扣除的分数，支持一位小数。</DialogDescription><label className="choice-field" htmlFor="score-delta"><span>分数变化</span><Input id="score-delta" type="number" step="0.1" min="-10000" max="10000" value={points} onChange={e=>setPoints(e.target.value)} placeholder="例如 5 或 -2"/></label><label className="choice-field" htmlFor="score-note"><span>计分备注（可选）</span><Input id="score-note" maxLength={200} value={scoreNote} onChange={e=>setScoreNote(e.target.value)} placeholder="例如：分享清晰、合作积极"/></label><Button className="primary-button" onClick={()=>{if(changeScore(scoreTeam,Number(points),scoreNote))setDialog(null)}}>确认计分</Button></>}
      {dialog==='history'&&<><DialogTitle>计分记录</DialogTitle><DialogDescription>显示本轮最近 2000 条记录。撤销会移除最近一条。</DialogDescription><div className="history-list">{[...state.history].reverse().map(h=><div className="history-entry" key={h.id}><span><b>{h.teamName}</b><small>{h.note||'课堂计分'} · {new Date(h.time).toLocaleTimeString('zh-CN',{hour12:false})}</small></span><strong className={h.delta>=0?'positive':'negative'}>{h.delta>0?'+':''}{h.delta}</strong></div>)}</div></>}
      {dialog==='share'&&<><DialogTitle>分享当前分队和积分</DialogTitle><DialogDescription>链接包含本次姓名与积分，请发给需要查看的人。它是只读快照，之后的修改不会自动同步。</DialogDescription><Textarea aria-label="结果分享链接" className="share-url" readOnly value={shareURL} onFocus={e=>e.target.select()} rows={3}/><Button className="primary-button" onClick={()=>void copyShare()}><Share2 size={16}/> 复制结果链接</Button><p className="small-help">学生无需登录。若聊天软件截断长链接，请用 Excel 导出分享。</p></>}
      {dialogError&&<p className="inline-error" role="alert">{dialogError}</p>}
    </DialogContent></Dialog>
  </div>;
}




