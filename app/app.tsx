import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CloudUpload, LoaderCircle, LockKeyhole, RefreshCw, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { decodeSnapshot, emptyClassroom, type Classroom } from '@/lib/classroom';
import { authenticateTeacher, changeTeacherPassword, chooseTeacherDraft, endTeacherSession, fetchPublishedClassroom, publicClassroom, publishClassroom, PublishingError, saveTeacherDraft, setupTeacherPassword, type DraftChoice, type Publication, type TeacherSession } from '@/lib/publishing';
import Home from './page';
import { StudentSubmission, TeacherSubmissions } from './submissions';

function message(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''; }
function readLegacyLink() {
  if (!window.location.hash.startsWith('#result=')) return { classroom: null, error: '' };
  try { return { classroom: decodeSnapshot(window.location.hash.slice(8)), error: '' }; }
  catch { return { classroom: null, error: '旧分享链接无效，下面显示最新已发布版本。' }; }
}

export default function App() {
  const [view] = useState(() => new URLSearchParams(window.location.search).get('view'));
  const submissionView = view === 'submit' || view === 'submissions';
  const [legacy] = useState(readLegacyLink);
  const [published, setPublished] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadId = useRef(0);
  const [setupToken, setSetupToken] = useState(() => /^#setup=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] ?? '');
  const [loginOpen, setLoginOpen] = useState(!!setupToken);
  const [tokenInput, setTokenInput] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
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

  useEffect(() => { if (setupToken) window.history.replaceState(null, '', window.location.pathname + window.location.search); }, [setupToken]);

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
    if (setupToken && tokenInput !== passwordConfirm) { setLoginError('两次输入的密码不一致。'); return; }
    setLoginBusy(true); setLoginError('');
    const entered = tokenInput; setTokenInput(''); setPasswordConfirm('');
    try {
      const verified = setupToken ? await setupTeacherPassword(entered, setupToken) : await authenticateTeacher(entered);
      setSetupToken('');
      if (submissionView) { setSession(verified); setLoginOpen(false); return; }
      let choice: DraftChoice;
      try { choice = chooseTeacherDraft(verified.published, verified.sha, localStorage); }
      catch { choice = { draft: verified.published.classroom ?? emptyClassroom(), conflict: false, warning: '无法读取本机草稿，请及时导出 Excel。' }; }
      setLoginOpen(false);
      if (choice.conflict) { pendingSession.current = verified; setDraftChoice({ ...choice, publishedAt: verified.published.publishedAt }); }
      else activateTeacher(verified, choice.draft, choice.warning);
    } catch (error) { setLoginError(message(error)); if (error instanceof PublishingError && error.code === 'setup_done') setSetupToken(''); }
    finally { setLoginBusy(false); }
  }
  function logout() {
    if (session) void endTeacherSession(session).catch(() => {});
    setSession(null); pendingSession.current = null; latestDraft.current = null; setInitialDraft(null);
    setDraftChoice(null); setTokenInput(''); setPublishTarget(null);
    setPublishError(''); setPublishStatus(''); setDraftWarning(''); setNeedsLogin(false);
    void refreshPublic();
  }
  async function publish(state: Classroom) {
    if (!session || submitting || needsLogin) return;
    setSubmitting(true); setPublishTarget(null); setPublishError(''); setPublishStatus('正在发布…');
    try {
      const result = await publishClassroom(session, state);
      setSession({ ...session, sha: result.sha, published: result.publication });
      setDirty(JSON.stringify(latestDraft.current) !== JSON.stringify(state));
      try { if (latestDraft.current) saveTeacherDraft(latestDraft.current, result.sha, localStorage); }
      catch { setDraftWarning('已发布，但无法保存本机版本标记。下次登录请核对草稿。'); }
      setPublished(result.publication); setLoadError('');
      setPublishStatus('已发布，学生刷新即可查看。');
    } catch (error) {
      setPublishStatus(''); setPublishError(message(error)); setNeedsLogin(true);
    } finally { setSubmitting(false); }
  }

  async function updatePassword() {
    if (!session || passwordBusy) return;
    if (newPassword !== newPasswordConfirm) { setPasswordError('两次输入的新密码不一致。'); return; }
    setPasswordBusy(true); setPasswordError('');
    try {
      const verified = await changeTeacherPassword(session, oldPassword, newPassword);
      // Password changes must not silently upgrade a stale draft's publication base.
      setSession({ ...session, token: verified.token, expiresAt: verified.expiresAt });
      setPasswordDialog(false); setOldPassword(''); setNewPassword(''); setNewPasswordConfirm('');
      setPublishStatus('密码已修改，其他设备需要重新登录。');
    } catch (error) { setPasswordError(message(error)); }
    finally { setPasswordBusy(false); }
  }

  const headerActions = session ? <>
    <span className="teacher-label">教师 · {session.login}</span>
    <Button variant="ghost" className="password-button" disabled={submitting || passwordBusy || needsLogin} onClick={() => { setOldPassword(''); setNewPassword(''); setNewPasswordConfirm(''); setPasswordError(''); setPasswordDialog(true); }}>修改密码</Button>
    <Button variant="outline" className="outline-button" disabled={submitting || passwordBusy} onClick={() => { const relogin = needsLogin; logout(); if (relogin) { setLoginError(''); setLoginOpen(true); } }}>{needsLogin ? '重新登录' : '退出'}</Button>
  </> : <>
    {!submissionView && <Button variant="ghost" className="icon-button" aria-label="刷新已发布课堂" title="刷新" disabled={loading} onClick={() => void refreshPublic()}><RefreshCw size={17} className={loading ? 'spin' : ''}/></Button>}
    <Button variant="outline" className="outline-button" onClick={() => { setLoginError(''); setTokenInput(''); setLoginOpen(true); }}><LockKeyhole size={15}/> 教师登录</Button>
  </>;
  const status = session ? <>
    <output className="publication-bar">
      {submitting ? <LoaderCircle size={16} className="spin"/> : <CloudUpload size={16}/>}
      <span>{publishStatus || (dirty ? '本机草稿 · 尚未发布' : '已载入已发布版本')}{publishStatus && dirty ? ' · 另有草稿修改待发布' : ''}</span>
    </output>
    {draftWarning && <p className="error-banner" role="alert">{draftWarning}</p>}
    {publishError && <p className="error-banner" role="alert">{publishError}</p>}
  </> : <>
    <div className="publication-bar"><LockKeyhole size={16}/><span>{legacy.classroom ? '历史分享快照' : published?.publishedAt ? `只读 · 更新于 ${formatTime(published.publishedAt)}` : '尚未发布课堂'}</span>{legacy.classroom && <a href="./">查看最新课堂</a>}</div>
    {legacy.error && <p className="error-banner" role="alert">{legacy.error}</p>}
    {loadError && <p className="error-banner" role="alert">{loadError}{published ? ' 当前显示上次读取的版本。' : ''}</p>}
  </>;

  const viewState = session && initialDraft ? initialDraft : legacy.classroom ?? published?.classroom ?? emptyClassroom();
  return <>
    {submissionView ? <div className="app-shell"><header className="site-header"><a className="brand" href="./"><span className="brand-mark"><Shuffle size={23}/></span><h1>几何深度学习</h1></a><div className="header-actions"><a className="submission-nav" href="./">课堂</a><a className="submission-nav" href="?view=submit" aria-current={view === 'submit' ? 'page' : undefined}>学生提交</a><a className="submission-nav" href="?view=submissions" aria-current={view === 'submissions' ? 'page' : undefined}>提交记录</a>{headerActions}</div></header>{view === 'submit' ? <StudentSubmission/> : <TeacherSubmissions session={session} onLogin={() => { setLoginError(''); setTokenInput(''); setLoginOpen(true); }}/>}</div> : session || published || legacy.classroom ? <Home key={session ? `teacher-${editKey}` : `public-${legacy.classroom ? 'snapshot' : published?.publicationId ?? 'empty'}`} initialState={viewState} readOnly={!session} headerActions={<><a className="submission-nav" href="?view=submit">学生提交</a><a className="submission-nav" href="?view=submissions">提交记录</a>{headerActions}</>} status={status} onDraftChange={onDraftChange} onPublish={setPublishTarget} publishing={submitting || passwordBusy || needsLogin}/> : <div className="app-shell">
      <header className="site-header"><a className="brand" href="./"><span className="brand-mark"><Shuffle size={23}/></span><h1>几何深度学习</h1></a><div className="header-actions">{headerActions}</div></header>
      <main className="workspace"><div className="public-loading">{loading ? <><LoaderCircle size={26} className="spin"/><span>正在读取课堂…</span></> : <><p className="inline-error" role="alert">{loadError}</p><Button variant="outline" onClick={() => void refreshPublic()}>重新读取</Button></>}</div></main>
    </div>}

    <Dialog open={loginOpen} onOpenChange={open => { if (!loginBusy) { setLoginOpen(open); if (!open) { setTokenInput(''); setPasswordConfirm(''); } } }}><DialogContent className="standard-dialog">
      <DialogTitle>{setupToken ? '设置教师密码' : '教师登录'}</DialogTitle>
      <DialogDescription>{setupToken ? '设置后，可在任何设备上使用此密码登录。至少 12 个字符，建议使用较长短语。' : '请输入教师密码。'}</DialogDescription>
      <form className="login-form" onSubmit={event => { event.preventDefault(); void login(); }}>
        <input type="hidden" name="username" autoComplete="username" value="ly633"/>
        <label className="choice-field" htmlFor="teacher-password"><span>{setupToken ? '设置密码' : '密码'}</span><Input id="teacher-password" name="password" type="password" autoComplete={setupToken ? 'new-password' : 'current-password'} maxLength={72} value={tokenInput} disabled={loginBusy} onChange={event => setTokenInput(event.target.value)} placeholder="请输入教师密码"/></label>
        {!!setupToken && <label className="choice-field" htmlFor="confirm-password"><span>再次输入密码</span><Input id="confirm-password" type="password" autoComplete="new-password" maxLength={72} value={passwordConfirm} disabled={loginBusy} onChange={event => setPasswordConfirm(event.target.value)}/></label>}
        {loginError && <p className="inline-error" role="alert">{loginError}</p>}
        <Button type="submit" className="primary-button" disabled={loginBusy || !tokenInput}>{loginBusy ? <LoaderCircle size={16} className="spin"/> : <LockKeyhole size={16}/>} {loginBusy ? '正在验证…' : setupToken ? '设置并登录' : '登录'}</Button>
      </form>
      {!!setupToken && <p className="small-help">此设置入口仅供你使用，完成设置后自动失效。</p>}
    </DialogContent></Dialog>

    <Dialog open={passwordDialog} onOpenChange={open => { if (!passwordBusy) { setPasswordDialog(open); if (!open) { setOldPassword(''); setNewPassword(''); setNewPasswordConfirm(''); } } }}><DialogContent className="standard-dialog">
      <DialogTitle>修改教师密码</DialogTitle><DialogDescription>新密码至少 12 个字符。修改后，其他设备需要重新登录。</DialogDescription>
      <form className="login-form" onSubmit={event => { event.preventDefault(); void updatePassword(); }}>
        <label className="choice-field" htmlFor="old-password"><span>当前密码</span><Input id="old-password" type="password" autoComplete="current-password" maxLength={72} value={oldPassword} onChange={event => setOldPassword(event.target.value)} disabled={passwordBusy}/></label>
        <label className="choice-field" htmlFor="new-password"><span>新密码</span><Input id="new-password" type="password" autoComplete="new-password" maxLength={72} value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={passwordBusy}/></label>
        <label className="choice-field" htmlFor="new-password-confirm"><span>再次输入新密码</span><Input id="new-password-confirm" type="password" autoComplete="new-password" maxLength={72} value={newPasswordConfirm} onChange={event => setNewPasswordConfirm(event.target.value)} disabled={passwordBusy}/></label>
        {passwordError && <p className="inline-error" role="alert">{passwordError}</p>}
        <Button className="primary-button" type="submit" disabled={passwordBusy || !oldPassword || !newPassword || !newPasswordConfirm}>{passwordBusy ? '正在保存…' : '保存密码'}</Button>
      </form>
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
      <AlertDialogDescription>将公开 {publishTarget?.students.length} 位同学的姓名、学号、分组及全部 {publishTarget?.assignments.length} 次作业成绩。发布后，所有人刷新同一网址即可查看。</AlertDialogDescription>
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (publishTarget) void publish(publishTarget); }}><Check size={16}/> 确认发布</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
