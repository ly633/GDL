import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CloudUpload, LoaderCircle, LockKeyhole, RefreshCw, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { decodeSnapshot, emptyClassroom, type Classroom } from '@/lib/classroom';
import { authenticateTeacher, chooseTeacherDraft, fetchPublishedClassroom, publicClassroom, publishClassroom, saveTeacherDraft, type DraftChoice, type Publication, type TeacherSession } from '@/lib/publishing';
import Home from './page';

const ACTIONS_URL = 'https://github.com/ly633/GDL/actions/workflows/pages.yml';
type Deployment = { publicationId: string; started: number };
function message(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''; }
function readLegacyLink() {
  if (!window.location.hash.startsWith('#result=')) return { classroom: null, error: '' };
  try { return { classroom: decodeSnapshot(window.location.hash.slice(8)), error: '' }; }
  catch { return { classroom: null, error: '旧分享链接无效，下面显示最新已发布版本。' }; }
}

export default function App() {
  const [legacy] = useState(readLegacyLink);
  const [published, setPublished] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadId = useRef(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<TeacherSession | null>(null);
  const [initialDraft, setInitialDraft] = useState<Classroom | null>(null);
  const latestDraft = useRef<Classroom | null>(null);
  const [editKey, setEditKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [draftWarning, setDraftWarning] = useState('');
  const pendingSession = useRef<TeacherSession | null>(null);
  const [draftChoice, setDraftChoice] = useState<(DraftChoice & { publishedAt: string | null }) | null>(null);
  const [publishTarget, setPublishTarget] = useState<Classroom | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [publishStatus, setPublishStatus] = useState('');
  const [publishError, setPublishError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  const refreshPublic = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true); setLoadError('');
    try { const result = await fetchPublishedClassroom(); if (loadId.current === id) setPublished(result); }
    catch (error) { if (loadId.current === id) setLoadError(message(error)); }
    finally { if (loadId.current === id) setLoading(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const id = loadId.current;
    void fetchPublishedClassroom()
      .then(result => { if (!cancelled && loadId.current === id) setPublished(result); })
      .catch(error => { if (!cancelled && loadId.current === id) setLoadError(message(error)); })
      .finally(() => { if (!cancelled && loadId.current === id) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!deployment) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await fetchPublishedClassroom();
        if (cancelled) return;
        if (result.publicationId === deployment!.publicationId) {
          setPublished(result); setLoadError(''); setPublishStatus('发布完成，学生刷新即可查看。'); setDeployment(null); return;
        }
      } catch { /* A transient Pages failure does not mean the commit failed. */ }
      if (cancelled) return;
      if (Date.now() - deployment!.started >= 180000) {
        setPublishStatus('已提交，暂未确认部署完成。请查看部署状态。'); setDeployment(null); return;
      }
      timer = setTimeout(() => void check(), 10000);
    }
    timer = setTimeout(() => void check(), 8000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deployment]);

  const onDraftChange = useCallback((state: Classroom) => {
    latestDraft.current = state; setDirty(true);
    if (!session) return '请先登录教师账号。';
    try { saveTeacherDraft(state, session.sha, localStorage); return ''; }
    catch { return '无法保存本机草稿，请导出 Excel。'; }
  }, [session]);
  function activateTeacher(verified: TeacherSession, draft: Classroom, warning = '') {
    setInitialDraft(draft); latestDraft.current = draft; setSession(verified); setEditKey(key => key + 1);
    setDirty(JSON.stringify(publicClassroom(draft)) !== JSON.stringify(verified.published.classroom));
    setNeedsLogin(false); setPublishError(''); setPublishStatus(''); setDraftChoice(null); pendingSession.current = null;
    try {
      // Never store credentials. Retain unreadable old data until the user edits.
      if (!warning) saveTeacherDraft(draft, verified.sha, localStorage);
    } catch { warning = '无法保存本机草稿，请及时导出 Excel。'; }
    setDraftWarning(warning);
  }
  async function login() {
    if (loginBusy) return;
    setLoginBusy(true); setLoginError('');
    const entered = tokenInput; setTokenInput('');
    try {
      const verified = await authenticateTeacher(entered);
      let choice: DraftChoice;
      try { choice = chooseTeacherDraft(verified.published, verified.sha, localStorage); }
      catch { choice = { draft: verified.published.classroom ?? emptyClassroom(), conflict: false, warning: '无法读取本机草稿，请及时导出 Excel。' }; }
      setLoginOpen(false);
      if (choice.conflict) { pendingSession.current = verified; setDraftChoice({ ...choice, publishedAt: verified.published.publishedAt }); }
      else activateTeacher(verified, choice.draft, choice.warning);
    } catch (error) { setLoginError(message(error)); }
    finally { setLoginBusy(false); }
  }
  function logout() {
    setSession(null); pendingSession.current = null; latestDraft.current = null; setInitialDraft(null);
    setDraftChoice(null); setTokenInput(''); setPublishTarget(null); setDeployment(null);
    setPublishError(''); setPublishStatus(''); setDraftWarning(''); setNeedsLogin(false);
    void refreshPublic();
  }
  async function publish(state: Classroom) {
    if (!session || submitting || deployment || needsLogin) return;
    setSubmitting(true); setPublishTarget(null); setPublishError(''); setPublishStatus('正在提交…');
    try {
      const result = await publishClassroom(session, state);
      setSession({ ...session, sha: result.sha, published: result.publication });
      setDirty(JSON.stringify(latestDraft.current) !== JSON.stringify(state));
      try { if (latestDraft.current) saveTeacherDraft(latestDraft.current, result.sha, localStorage); }
      catch { setDraftWarning('已提交，但无法保存本机版本标记。下次登录请核对草稿。'); }
      setPublishStatus('已提交，正在部署…');
      setDeployment({ publicationId: result.publication.publicationId!, started: Date.now() });
    } catch (error) {
      setPublishStatus(''); setPublishError(message(error)); setNeedsLogin(true);
    } finally { setSubmitting(false); }
  }

  const headerActions = session ? <>
    <span className="teacher-label">教师 · {session.login}</span>
    <Button variant="outline" className="outline-button" disabled={submitting} onClick={() => { const relogin = needsLogin; logout(); if (relogin) { setLoginError(''); setLoginOpen(true); } }}>{needsLogin ? '重新登录' : '退出'}</Button>
  </> : <>
    <Button variant="ghost" className="icon-button" aria-label="刷新已发布课堂" title="刷新" disabled={loading} onClick={() => void refreshPublic()}><RefreshCw size={17} className={loading ? 'spin' : ''}/></Button>
    <Button variant="outline" className="outline-button" onClick={() => { setLoginError(''); setTokenInput(''); setLoginOpen(true); }}><LockKeyhole size={15}/> 教师登录</Button>
  </>;
  const status = session ? <>
    <output className="publication-bar">
      {submitting || deployment ? <LoaderCircle size={16} className="spin"/> : <CloudUpload size={16}/>}
      <span>{publishStatus || (dirty ? '本机草稿 · 尚未发布' : '已载入已发布版本')}{publishStatus && dirty ? ' · 另有草稿修改待发布' : ''}</span>
      {!!publishStatus && <a href={ACTIONS_URL} target="_blank" rel="noreferrer">部署状态</a>}
    </output>
    {draftWarning && <p className="error-banner" role="alert">{draftWarning}</p>}
    {publishError && <p className="error-banner" role="alert">{publishError} <a href={ACTIONS_URL} target="_blank" rel="noreferrer">查看部署状态</a></p>}
  </> : <>
    <div className="publication-bar"><LockKeyhole size={16}/><span>{legacy.classroom ? '历史分享快照' : published?.publishedAt ? `只读 · 更新于 ${formatTime(published.publishedAt)}` : '尚未发布课堂'}</span>{legacy.classroom && <a href="./">查看最新课堂</a>}</div>
    {legacy.error && <p className="error-banner" role="alert">{legacy.error}</p>}
    {loadError && <p className="error-banner" role="alert">{loadError}{published ? ' 当前显示上次读取的版本。' : ''}</p>}
  </>;

  const viewState = session && initialDraft ? initialDraft : legacy.classroom ?? published?.classroom ?? emptyClassroom();
  return <>
    {session || published || legacy.classroom ? <Home key={session ? `teacher-${editKey}` : `public-${legacy.classroom ? 'snapshot' : published?.publicationId ?? 'empty'}`} initialState={viewState} readOnly={!session} headerActions={headerActions} status={status} onDraftChange={onDraftChange} onPublish={setPublishTarget} publishing={submitting || !!deployment || needsLogin}/> : <div className="app-shell">
      <header className="site-header"><a className="brand" href="./"><span className="brand-mark"><Shuffle size={23}/></span><h1>几何深度学习</h1></a><div className="header-actions">{headerActions}</div></header>
      <main className="workspace"><div className="public-loading">{loading ? <><LoaderCircle size={26} className="spin"/><span>正在读取课堂…</span></> : <><p className="inline-error" role="alert">{loadError}</p><Button variant="outline" onClick={() => void refreshPublic()}>重新读取</Button></>}</div></main>
    </div>}

    <Dialog open={loginOpen} onOpenChange={open => { if (!loginBusy) { setLoginOpen(open); if (!open) setTokenInput(''); } }}><DialogContent className="standard-dialog">
      <DialogTitle>教师登录</DialogTitle>
      <DialogDescription>使用 ly633 的 GitHub 访问令牌。</DialogDescription>
      <ol className="login-steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 Fine-grained token</a>，选择仅授权 <b>GDL</b> 仓库。</li>
        <li>Repository permissions → <b>Contents: Read and write</b>。</li>
        <li>生成后粘贴到下方。</li>
      </ol>
      <form className="login-form" onSubmit={event => { event.preventDefault(); void login(); }}>
        <label className="choice-field" htmlFor="github-token"><span>访问令牌</span><Input id="github-token" type="password" autoComplete="off" spellCheck={false} maxLength={5000} value={tokenInput} disabled={loginBusy} onChange={event => setTokenInput(event.target.value)} placeholder="github_pat_…"/></label>
        {loginError && <p className="inline-error" role="alert">{loginError}</p>}
        <Button type="submit" className="primary-button" disabled={loginBusy || !tokenInput.trim()}>{loginBusy ? <LoaderCircle size={16} className="spin"/> : <LockKeyhole size={16}/>} {loginBusy ? '正在验证…' : '登录'}</Button>
      </form>
      <p className="small-help">令牌仅在当前页面内存中使用，刷新后需重新登录。编辑内容先保存为本机草稿，点击发布后才对外更新。</p>
    </DialogContent></Dialog>

    <Dialog open={!!draftChoice} onOpenChange={open => { if (!open) { setDraftChoice(null); pendingSession.current = null; } }}><DialogContent className="standard-dialog">
      <DialogTitle>选择要编辑的版本</DialogTitle>
      <DialogDescription>本机草稿与线上版本来自不同记录，请核对后选择。</DialogDescription>
      <div className="version-choice"><strong>本机草稿</strong><span>{draftChoice?.draft.students.length} 位同学 · {draftChoice?.draft.assignments.length} 次作业</span><strong>线上版本</strong><span>发布于 {formatTime(draftChoice?.publishedAt ?? null)}</span></div>
      <Button className="primary-button" onClick={() => { if (pendingSession.current && draftChoice) activateTeacher(pendingSession.current, draftChoice.draft); }}>继续本机草稿</Button>
      <Button variant="outline" onClick={() => { const verified = pendingSession.current; if (verified?.published.classroom) activateTeacher(verified, verified.published.classroom); }}>用线上版本替换本机草稿</Button>
    </DialogContent></Dialog>

    <AlertDialog open={!!publishTarget} onOpenChange={open => { if (!open) setPublishTarget(null); }}><AlertDialogContent>
      <AlertDialogTitle>发布当前课堂？</AlertDialogTitle>
      <AlertDialogDescription>将公开 {publishTarget?.students.length} 位同学的姓名、学号、分组及全部 {publishTarget?.assignments.length} 次作业成绩。部署完成后，所有人刷新同一网址即可查看。</AlertDialogDescription>
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (publishTarget) void publish(publishTarget); }}><Check size={16}/> 确认发布</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
