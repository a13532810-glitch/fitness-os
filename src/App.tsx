import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Database,
  Dumbbell,
  FileText,
  Home as HomeIcon,
  Leaf,
  LoaderCircle,
  Moon,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  WifiOff,
  X,
} from 'lucide-react';
import { FitnessDB, seed, snapshot, createSession, saveSession, deleteSession } from './db';
import {
  type Dataset,
  type Mode,
  type Kind,
  type Session,
  type SessionItem,
  type WorkoutSet,
  type Plan,
  type Exercise,
  type Goal,
  type Settings,
  names,
  stamp,
  uuid,
  localDate,
  shiftDate,
  weekStart,
  validSet,
} from './model';
import {
  totals,
  formatSets,
  records,
  lastRecord,
  progress,
  suggestion,
  nextKind,
  weekCompleted,
  packageAnalysis,
  analysisMarkdown,
  aiPrompt,
} from './analytics';
import {
  download,
  makeBackup,
  previewRestore,
  restore,
  counts,
  type RecoveryPreview,
} from './backup';
type Page = 'home' | 'record' | 'trends' | 'ai' | 'settings';
const nav = [
  ['home', HomeIcon, '首页'],
  ['record', Dumbbell, '记录'],
  ['trends', TrendingUp, '趋势'],
  ['ai', Sparkles, 'AI'],
  ['settings', Settings2, '设置'],
] as const;
const fmt = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
const num = (s: string) => (s === '' ? null : Number(s));
const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试');
const touch = <span className="dot" />;
function Badge({ children, green = false }: { children: ReactNode; green?: boolean }) {
  return <span className={'badge ' + (green ? 'green' : '')}>{children}</span>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Activity size={30} />
      <strong>{title}</strong>
      <p>{children ?? '留下第一次记录，进步才有迹可循。'}</p>
    </div>
  );
}
function Section({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-title">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="welcome">
        <ShieldCheck size={40} />
        <h1>暂时无法打开训练空间</h1>
        <p>本地数据不会被自动清除。请重新加载；若持续出错，请保留网站数据并联系开发者。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [mode, setMode] = useState<Mode | null>(() => {
    try {
      const m = localStorage.getItem('fitness-os-mode');
      return m === 'real' || m === 'demo' ? m : null;
    } catch {
      return null;
    }
  });
  function choose(m: Mode) {
    try {
      localStorage.setItem('fitness-os-mode', m);
    } catch {
      /* mode preference is optional; records live in IndexedDB */
    }
    setMode(m);
  }
  return (
    <Boundary>
      {mode ? (
        <Workspace key={mode} mode={mode} switchMode={choose} />
      ) : (
        <main className="welcome">
          <div className="brand-icon">
            <Activity />
          </div>
          <span className="eyebrow">YOUR OWN PACE</span>
          <h1>
            把训练，
            <br />
            变成看得见的进步。
          </h1>
          <p>
            一个只属于你的训练空间。
            <br />
            无需账号，记录留在这台设备。
          </p>
          <button className="primary" onClick={() => choose('real')}>
            开启我的训练空间 <ArrowRight size={18} />
          </button>
          <button className="secondary" onClick={() => choose('demo')}>
            先体验虚构演示
          </button>
          <small>正式数据与演示数据分别存储，可随时切换。</small>
        </main>
      )}
    </Boundary>
  );
}
function Workspace({ mode, switchMode }: { mode: Mode; switchMode: (m: Mode) => void }) {
  const db = useMemo(() => new FitnessDB(mode), [mode]);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [editor, setEditor] = useState<{ session: Session; sets: WorkoutSet[] } | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(() => (ready ? snapshot(db) : undefined), [db, ready]);
  useEffect(() => {
    let active = true;
    seed(db)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setBootError(errorText(e));
      });
    return () => {
      active = false;
      db.close();
    };
  }, [db]);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    addEventListener('online', fn);
    addEventListener('offline', fn);
    return () => {
      removeEventListener('online', fn);
      removeEventListener('offline', fn);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const theme = data?.settings[0]?.theme ?? 'system';
    document.documentElement.dataset.theme = theme;
  }, [data?.settings]);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(e) {
      setToast('离线组件注册失败：' + errorText(e));
    },
  });
  async function start(kind: Kind) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const w = createSession(data, kind);
      await saveSession(db, w.session, w.sets);
      setEditor(w);
    } catch (e) {
      setToast('无法创建草稿：' + errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function open(w: Session) {
    if (!data) return;
    setEditor({
      session: structuredClone(w),
      sets: structuredClone(data.workoutSets.filter((s) => s.sessionId === w.id)),
    });
  }
  function move(p: Page) {
    setPage(p);
    window.scrollTo({ top: 0 });
  }
  if (bootError)
    return (
      <main className="welcome">
        <Database />
        <h1>本地数据库未能打开</h1>
        <p>{bootError}</p>
        <p>请检查是否处于受限浏览模式或存储空间不足。不要清理已有网站数据。</p>
        <button onClick={() => location.reload()}>重试</button>
      </main>
    );
  if (!data)
    return (
      <main className="welcome">
        <LoaderCircle className="spin" />
        <p>正在打开本地训练空间…</p>
      </main>
    );
  const titles = {
    home: '训练总览',
    record: '训练记录',
    trends: '进步趋势',
    ai: 'AI 周报',
    settings: '我的设置',
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            move('home');
          }}
        >
          <span className="brand-icon">
            <Activity />
          </span>
          <span>
            Fitness <b>OS</b>
            <small>个人训练空间</small>
          </span>
        </a>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => move(id)}>
              <Icon size={20} />
              {label}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={20} />
          <div>
            你的数据，留在本地<small>无账号 · 无云端同步</small>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span className="breadcrumb">
            Fitness OS <span>/</span> {titles[page]}
          </span>
          <div className="top-status">
            {!online ? (
              <>
                <WifiOff size={14} /> 离线可记录
              </>
            ) : (
              <>{touch} 本地保存</>
            )}
            <button
              className={'mode-chip ' + (mode === 'demo' ? 'demo' : '')}
              onClick={() => {
                if (!editor) switchMode(mode === 'real' ? 'demo' : 'real');
              }}
            >
              {mode === 'demo' ? '虚构演示' : '正式空间'}
            </button>
          </div>
        </header>
        <main className="content">
          {mode === 'demo' && (
            <div className="demo-banner">
              <Sparkles size={17} />
              <span>你正在体验独立演示空间。所有成绩均为虚构，不进入正式趋势、周报或备份。</span>
              <button onClick={() => switchMode('real')}>返回正式</button>
            </div>
          )}
          {needRefresh && (
            <div className="notice">
              <span>新版本已就绪，草稿会保留。请保存当前记录后更新。</span>
              <button disabled={Boolean(editor)} onClick={() => void updateServiceWorker(true)}>
                更新应用
              </button>
            </div>
          )}
          {page === 'home' && (
            <Dashboard
              data={data}
              start={start}
              open={open}
              plans={() => setShowPlans(true)}
              move={move}
              busy={busy}
            />
          )}
          {page === 'record' && (
            <RecordPage
              data={data}
              start={start}
              open={open}
              plans={() => setShowPlans(true)}
              busy={busy}
            />
          )}
          {page === 'trends' && <Trends data={data} db={db} notify={setToast} />}
          {page === 'ai' && <AIPage data={data} db={db} mode={mode} notify={setToast} />}
          {page === 'settings' && (
            <SettingsPage
              data={data}
              db={db}
              mode={mode}
              switchMode={switchMode}
              notify={setToast}
              offlineReady={offlineReady}
            />
          )}
          <footer className="page-footer">
            按自己的节奏，持续向前。<span>Fitness OS · 本地优先</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {nav.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={page === id ? 'page' : undefined}
            className={page === id ? 'active' : ''}
            onClick={() => move(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {editor && (
        <WorkoutEditor
          key={editor.session.id}
          initial={editor}
          data={data}
          db={db}
          onClose={() => setEditor(null)}
          notify={setToast}
        />
      )}
      {showPlans && (
        <PlanEditor data={data} db={db} close={() => setShowPlans(false)} notify={setToast} />
      )}
    </div>
  );
}
function Dashboard({
  data,
  start,
  open,
  plans,
  move,
  busy,
}: {
  data: Dataset;
  start: (k: Kind) => void;
  open: (s: Session) => void;
  plans: () => void;
  move: (p: Page) => void;
  busy: boolean;
}) {
  const next = nextKind(data),
    plan = data.workoutPlans.find((p) => p.kind === next);
  const last = [...data.workoutSessions]
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  const draft = data.workoutSessions
    .filter((s) => s.status === 'draft')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const prefs = data.settings[0];
  const day =
    Math.floor(
      (new Date(localDate() + 'T12:00:00').getTime() -
        new Date(prefs.cycleStart + 'T12:00:00').getTime()) /
        86400000,
    ) + 1;
  const cycleCount = data.workoutSessions.filter(
    (s) =>
      s.status === 'completed' &&
      s.date >= prefs.cycleStart &&
      s.date <= shiftDate(prefs.cycleStart, 89),
  ).length;
  const completed = weekCompleted(data);
  const enabled = data.workoutPlans.some((p) => p.enabled);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {new Date().toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}{' '}
            · KEEP SHOWING UP
          </span>
          <h1>今天，也为自己进步一点。</h1>
          <p>看清目标，专注训练。每一次记录，都算数。</p>
        </div>
        <button className="secondary compact" onClick={plans}>
          <Settings2 size={17} />
          调整计划
        </button>
      </div>
      {draft && (
        <button className="draft-banner" onClick={() => open(draft)}>
          <FileText size={20} />
          <span>
            <b>还有一份训练草稿</b>
            <small>
              {fmt(draft.date)} · {names[draft.kind]}，继续填写实际成绩
            </small>
          </span>
          <ArrowRight size={20} />
        </button>
      )}
      <div className="dashboard-top">
        <section className="hero">
          <div className="hero-copy">
            <Badge green>下次训练 · {next}</Badge>
            <h2>{plan?.name ?? '自选训练'}</h2>
            <p>
              {enabled
                ? '练一休一，按你的恢复状态安排。'
                : '计划已暂停，仍可在记录页自由选择训练。'}
              <br />
              预计 {plan?.items.length ?? 0} 个动作 · 目标由你确认
            </p>
            <button className="primary" disabled={busy || !enabled} onClick={() => start(next)}>
              {busy ? <LoaderCircle size={18} /> : <Plus size={20} />}开始记录{' '}
              <ArrowRight size={18} />
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <Dumbbell strokeWidth={1.3} />
            <span>
              BUILD YOUR
              <br />
              OWN MOMENTUM
            </span>
          </div>
        </section>
        <section className="cycle-card">
          <div className="card-top">
            <span className="eyebrow">90 天训练周期</span>
            <Leaf size={18} />
          </div>
          <div className="cycle-number">
            {day < 1 ? '未开始' : Math.min(day, 90)}
            <span>/ 90 天</span>
          </div>
          <div className="progress-track">
            <span style={{ width: Math.max(0, Math.min((day / 90) * 100, 100)) + '%' }} />
          </div>
          <h3>
            {day < 1
              ? '准备开始'
              : day <= 30
                ? '建立基线，找到节奏'
                : day <= 60
                  ? '保持质量，稳步进步'
                  : '回顾表现，规划下一程'}
          </h3>
          <p>{fmt(prefs.cycleStart)} 开始 · 不预设身体结果</p>
          <div className="cycle-goal">
            周期完成 <b>{cycleCount}</b> 次
            {prefs.cycleTargetSessions
              ? ` / 目标 ${prefs.cycleTargetSessions} 次 · ${Math.round((cycleCount / prefs.cycleTargetSessions) * 100)}%`
              : ' · 可在设置中制定次数目标'}
          </div>
        </section>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <span>
            <CalendarDays size={17} /> 本周已完成
          </span>
          <strong>
            {completed}
            <small>次训练</small>
          </strong>
          <p>
            {prefs.weeklyPlanned === null
              ? '周计划次数待设置'
              : prefs.weeklyPlanned === 0
                ? '本周未安排训练'
                : `计划 ${prefs.weeklyPlanned} 次 · ${Math.round((completed / prefs.weeklyPlanned) * 100)}% 已完成`}
          </p>
        </div>
        <div className="stat-card">
          <span>
            <Dumbbell size={17} /> 最近一次训练
          </span>
          <strong className="text-stat">{last ? names[last.kind] : '等待第一次'}</strong>
          <p>
            {last
              ? `${fmt(last.date)} · ${last.duration ?? '未填'} 分钟`
              : '实际成绩从这里开始积累'}
          </p>
        </div>
        <div className="stat-card">
          <span>
            <TrendingUp size={17} /> 累计完成
          </span>
          <strong>
            {data.workoutSessions.filter((s) => s.status === 'completed').length}
            <small>次训练</small>
          </strong>
          <p>完成次数，不代表训练效果评分</p>
        </div>
      </div>
      <Section
        eyebrow="TRAIN WITH INTENTION"
        title="下次训练，心中有数"
        action={
          <button className="text-button" onClick={() => move('trends')}>
            查看趋势 <ArrowRight size={15} />
          </button>
        }
      >
        <div className="exercise-grid">
          {plan?.items.map((p, index) => {
            const e = data.exercises.find((e) => e.id === p.exerciseId);
            if (!e) return null;
            const r = lastRecord(data, e.id, e.equipment, e.technique);
            const g = data.trainingGoals
              .filter(
                (g) =>
                  g.exerciseId === e.id &&
                  g.equipment === e.equipment &&
                  g.technique === e.technique &&
                  g.status === 'confirmed',
              )
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            return (
              <article className="exercise-card" key={e.id}>
                <div className="exercise-card-top">
                  <span className="exercise-index">{String(index + 1).padStart(2, '0')}</span>
                  <Badge>{e.muscle}</Badge>
                </div>
                <h3>{e.name}</h3>
                <p className="equipment">{e.equipment || '器械标识待填写'}</p>
                <div className="performance-row">
                  <small>上次实际</small>
                  <b>{r ? formatSets(r.sets) : '暂无实际成绩'}</b>
                </div>
                <div className="performance-row target">
                  <small>已确认目标</small>
                  <b>
                    {g
                      ? `${g.weight === null ? '重量待定' : g.weight + 'kg'} · ${g.sets}组 × ${g.min}–${g.max}次`
                      : `${p.sets}组 × ${p.min}–${p.max}次 · 重量待确认`}
                  </b>
                </div>
              </article>
            );
          })}
        </div>
      </Section>
      <div className="quiet-card">
        <ShieldCheck size={22} />
        <div>
          <h3>训练数据，只留在你的设备</h3>
          <p>iPhone 与 Mac 不自动同步。每周导出一份备份，让记录更安心。</p>
        </div>
        <button className="text-button" onClick={() => move('settings')}>
          管理备份 <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
function RecordPage({
  data,
  start,
  open,
  plans,
  busy,
}: {
  data: Dataset;
  start: (k: Kind) => void;
  open: (s: Session) => void;
  plans: () => void;
  busy: boolean;
}) {
  const sessions = [...data.workoutSessions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOG YOUR EFFORT</span>
          <h1>只记录，真实的完成。</h1>
          <p>上次成绩仅作参考，不会自动填成本次成绩。</p>
        </div>
        <button className="secondary compact" onClick={plans}>
          <Settings2 size={16} />
          计划与动作
        </button>
      </div>
      <div className="type-grid">
        {(['A', 'B', 'C'] as const).map((k) => (
          <button disabled={busy} className="type-card" key={k} onClick={() => start(k)}>
            <span>{k}</span>
            <div>
              <h3>{names[k]}</h3>
              <p>
                {data.workoutPlans.find((p) => p.kind === k)?.items.length ?? 0} 个动作 · 自由调整
              </p>
            </div>
            <Plus size={22} />
          </button>
        ))}
      </div>
      <Section title="训练历史" eyebrow="YOUR TRAINING JOURNAL">
        <div className="session-list">
          {sessions.length ? (
            sessions.map((s) => (
              <button className="session-row" key={s.id} onClick={() => open(s)}>
                <span className={'type-icon ' + s.kind}>{s.kind}</span>
                <span className="session-info">
                  <b>
                    {names[s.kind]}训练{' '}
                    <Badge green={s.status === 'completed'}>
                      {s.status === 'draft'
                        ? '草稿'
                        : s.status === 'completed'
                          ? '已完成'
                          : '未完成'}
                    </Badge>
                  </b>
                  <small>
                    {fmt(s.date)} · {s.duration ?? '未填'} 分钟 · {s.items.length} 个动作
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))
          ) : (
            <Empty title="还没有训练记录">选一个训练类型，从真实的第一组开始。</Empty>
          )}
        </div>
      </Section>
    </>
  );
}
function WorkoutEditor({
  initial,
  data,
  db,
  onClose,
  notify,
}: {
  initial: { session: Session; sets: WorkoutSet[] };
  data: Dataset;
  db: FitnessDB;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [w, setW] = useState(initial);
  const [pending, setPending] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(initial.session.updatedAt);
  const [addExercise, setAddExercise] = useState('');
  const queue = useRef(Promise.resolve());
  const latest = useRef(w);
  const failures = useRef(false);
  const [finishing, setFinishing] = useState(false);
  function persist(next: typeof w) {
    latest.current = next;
    setW(next);
    setPending((n) => n + 1);
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveSession(db, next.session, next.sets))
      .then(() => {
        setSavedAt(next.session.updatedAt);
        setSaveError('');
        failures.current = false;
      })
      .catch((e) => {
        failures.current = true;
        setSaveError('保存失败：' + errorText(e) + '。请保留页面并重试。');
      })
      .finally(() => setPending((n) => n - 1));
  }
  function change(next: typeof w) {
    const now = new Date().toISOString();
    persist({
      ...next,
      session: { ...next.session, updatedAt: now },
      sets: next.sets.map((s) => ({ ...s, updatedAt: now })),
    });
  }
  function sessionPatch(p: Partial<Session>) {
    change({ ...latest.current, session: { ...latest.current.session, ...p } });
  }
  function itemPatch(id: string, p: Partial<SessionItem>) {
    const v = latest.current;
    sessionPatch({ items: v.session.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  }
  function setPatch(id: string, p: Partial<WorkoutSet>) {
    const v = latest.current;
    change({ ...v, sets: v.sets.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (pending || saveError) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', fn);
    return () => removeEventListener('beforeunload', fn);
  }, [pending, saveError]);
  async function close() {
    await queue.current;
    if (failures.current) {
      notify('保存尚未成功，请重试或复制当前内容后再离开。');
      return;
    }
    onClose();
  }
  async function finish(status: 'completed' | 'incomplete') {
    if (finishing) return;
    const v = latest.current;
    if (!v.session.date || v.session.date > localDate()) {
      notify('请填写有效的训练日期，已结束训练不能晚于今天');
      return;
    }
    if (!v.session.items.length) {
      notify('请至少添加一个动作');
      return;
    }
    if (v.sets.some((s) => (s.weight === null) !== (s.reps === null))) {
      notify('有未填完整的组：请同时填重量与次数，或清空/移除该组');
      return;
    }
    if (!v.sets.some(validSet)) {
      notify('请至少记录一个有效训练组');
      return;
    }
    if (v.session.items.some((i) => !i.equipment.trim())) {
      notify('请填写器械标识，自重动作可写“自重”');
      return;
    }
    setFinishing(true);
    sessionPatch({ status });
    await queue.current;
    setFinishing(false);
    if (!failures.current) {
      notify(
        status === 'completed' ? '训练已完成，趋势已更新' : '已保存为未完成，已录入的组仍保留',
      );
      onClose();
    }
  }
  async function remove() {
    if (!confirm('删除这次训练及其所有实际组？建议先导出备份。')) return;
    await queue.current;
    try {
      await deleteSession(db, w.session.id);
      notify('训练及关联组已删除');
      onClose();
    } catch (e) {
      notify(errorText(e));
    }
  }
  const fieldsDisabled = finishing;
  return (
    <Modal
      title={w.session.status === 'draft' ? '记录本次训练' : '编辑训练记录'}
      onClose={() => void close()}
    >
      <div className="save-state" role="status">
        {pending ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{' '}
        {saveError ||
          (pending
            ? '正在保存到本地…'
            : `已保存 · ${new Date(savedAt).toLocaleTimeString('zh-CN')}`)}
        {saveError && <button onClick={() => persist(latest.current)}>重试保存</button>}
      </div>
      <fieldset disabled={fieldsDisabled} className="fieldset-reset">
        <div className="form-grid">
          <label>
            训练日期
            <input
              type="date"
              required
              value={w.session.date}
              onChange={(e) => sessionPatch({ date: e.target.value })}
            />
          </label>
          <label>
            训练类型
            <select
              value={w.session.kind}
              onChange={(e) => sessionPatch({ kind: e.target.value as Kind })}
            >
              {(['A', 'B', 'C'] as const).map((k) => (
                <option key={k} value={k}>
                  {k} · {names[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            训练时长（分钟）
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="1440"
              placeholder="例如 45"
              value={w.session.duration ?? ''}
              onChange={(e) => sessionPatch({ duration: num(e.target.value) })}
            />
          </label>
          <label>
            主观疲劳
            <select
              value={w.session.fatigue}
              onChange={(e) => sessionPatch({ fatigue: e.target.value })}
            >
              <option value="">待填写</option>
              {['轻松', '适中', '较累', '非常累'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        {w.session.items.map((i, index) => {
          const sets = w.sets.filter((s) => s.itemId === i.id).sort((a, b) => a.order - b.order);
          const last = lastRecord(data, i.exerciseId, i.equipment, i.technique);
          const ref =
            last?.session.id === w.session.id
              ? records(data, i.exerciseId, i.equipment, i.technique).find(
                  (r) => r.session.id !== w.session.id,
                )
              : last;
          return (
            <section className="log-exercise" key={i.id}>
              <div className="log-exercise-heading">
                <span className="exercise-index">{index + 1}</span>
                <h3>{i.name}</h3>
                <button
                  className="icon-button danger"
                  aria-label={'移除动作 ' + i.name}
                  onClick={() => {
                    if (
                      sets.some((s) => s.weight !== null || s.reps !== null) &&
                      !confirm('移除这个动作及已填写的组？')
                    )
                      return;
                    const v = latest.current;
                    change({
                      ...v,
                      session: {
                        ...v.session,
                        items: v.session.items.filter((x) => x.id !== i.id),
                      },
                      sets: v.sets.filter((s) => s.itemId !== i.id),
                    });
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <div className="form-grid">
                <label>
                  器械标识
                  <input
                    maxLength={160}
                    placeholder="例如 健身房胸推01"
                    value={i.equipment}
                    onChange={(e) => itemPatch(i.id, { equipment: e.target.value })}
                  />
                </label>
                <label>
                  动作方式 / 座椅设置
                  <input
                    maxLength={500}
                    placeholder="保持可比的设置与幅度"
                    value={i.technique}
                    onChange={(e) => itemPatch(i.id, { technique: e.target.value })}
                  />
                </label>
              </div>
              <div className="reference">
                <span>上次参考 {ref ? fmt(ref.session.date) : ''}</span>
                <b>{ref ? formatSets(ref.sets) : '暂无相同器械与动作方式的历史'}</b>
              </div>
              <div className="set-table">
                <div className="set-head">
                  <span>组</span>
                  <span>实际重量 kg</span>
                  <span>实际次数</span>
                  <span />
                </div>
                {sets.map((s, n) => (
                  <div className="set-row" key={s.id}>
                    <span>{n + 1}</span>
                    <input
                      aria-label={`${i.name} 第${n + 1}组重量`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="2000"
                      step="0.5"
                      placeholder="—"
                      value={s.weight ?? ''}
                      onChange={(e) => setPatch(s.id, { weight: num(e.target.value) })}
                    />
                    <input
                      aria-label={`${i.name} 第${n + 1}组次数`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="1000"
                      step="1"
                      placeholder="—"
                      value={s.reps ?? ''}
                      onChange={(e) => setPatch(s.id, { reps: num(e.target.value) })}
                    />
                    <button
                      className="icon-button"
                      aria-label={`移除${i.name}第${n + 1}组`}
                      onClick={() => {
                        if (
                          (s.reps !== null || s.weight !== null) &&
                          !confirm('移除这一组实际成绩？')
                        )
                          return;
                        const v = latest.current;
                        const remaining = v.sets.filter((x) => x.id !== s.id);
                        let o = 0;
                        change({
                          ...v,
                          sets: remaining.map((x) =>
                            x.itemId === i.id ? { ...x, order: o++ } : x,
                          ),
                        });
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="add-set"
                disabled={sets.length >= 30}
                onClick={() => {
                  const v = latest.current;
                  change({
                    ...v,
                    sets: [
                      ...v.sets,
                      {
                        ...stamp(),
                        sessionId: v.session.id,
                        itemId: i.id,
                        exerciseId: i.exerciseId,
                        order: sets.length,
                        weight: null,
                        reps: null,
                      },
                    ],
                  });
                }}
              >
                <Plus size={16} />
                添加一组
              </button>
              <div className="quality-row">
                <label>
                  <input
                    type="checkbox"
                    checked={i.quality}
                    onChange={(e) => itemPatch(i.id, { quality: e.target.checked })}
                  />
                  动作质量稳定
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={i.reserve}
                    onChange={(e) => itemPatch(i.id, { reserve: e.target.checked })}
                  />
                  仍有适当余力
                </label>
              </div>
              <small className="muted">
                目标快照：{i.targetSets}组 × {i.min}–{i.max}
                次。不同重量逐组填写，空白组不会算作完成。
              </small>
            </section>
          );
        })}
        <div className="add-exercise">
          <select
            aria-label="选择要添加的动作"
            value={addExercise}
            onChange={(e) => setAddExercise(e.target.value)}
          >
            <option value="">选择额外动作</option>
            {data.exercises
              .filter((e) => e.active)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          <button
            className="secondary"
            disabled={!addExercise || w.session.items.length >= 30}
            onClick={() => {
              const e = data.exercises.find((x) => x.id === addExercise)!;
              const v = latest.current;
              const i: SessionItem = {
                id: uuid(),
                exerciseId: e.id,
                name: e.name,
                equipment: e.equipment,
                technique: e.technique,
                targetSets: 3,
                min: 8,
                max: 12,
                quality: false,
                reserve: false,
              };
              change({
                ...v,
                session: { ...v.session, items: [...v.session.items, i] },
                sets: [
                  ...v.sets,
                  ...[0, 1, 2].map((order) => ({
                    ...stamp(),
                    sessionId: v.session.id,
                    itemId: i.id,
                    exerciseId: e.id,
                    order,
                    weight: null,
                    reps: null,
                  })),
                ],
              });
              setAddExercise('');
            }}
          >
            <Plus size={16} />
            添加动作
          </button>
        </div>
        <label>
          训练感受
          <textarea
            maxLength={20000}
            placeholder="动作质量、恢复或需要注意的事…"
            value={w.session.notes}
            onChange={(e) => sessionPatch({ notes: e.target.value })}
          />
        </label>
      </fieldset>
      <div className="editor-actions">
        <button className="primary" disabled={finishing} onClick={() => void finish('completed')}>
          {finishing ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}完成训练
        </button>
        <button className="secondary" disabled={finishing} onClick={() => void close()}>
          保存并关闭
        </button>
        <button
          className="text-button"
          disabled={finishing}
          onClick={() => void finish('incomplete')}
        >
          记为未完成
        </button>
        <button className="text-button danger" disabled={finishing} onClick={() => void remove()}>
          删除训练
        </button>
      </div>
    </Modal>
  );
}
function PlanEditor({
  data,
  db,
  close,
  notify,
}: {
  data: Dataset;
  db: FitnessDB;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [plans, setPlans] = useState(() => structuredClone(data.workoutPlans));
  const [exercises, setExercises] = useState(() => structuredClone(data.exercises));
  const [kind, setKind] = useState<Kind>('A');
  const [extra, setExtra] = useState('');
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = plans.find((p) => p.kind === kind)!;
  function patch(patch: Partial<Plan>) {
    setChanged(true);
    setPlans(
      plans.map((x) =>
        x.id === p.id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x,
      ),
    );
  }
  function item(id: string, patch: Partial<Plan['items'][number]>) {
    patchPlan(p.items.map((i) => (i.exerciseId === id ? { ...i, ...patch } : i)));
  }
  function patchPlan(items: Plan['items']) {
    patch({ items });
  }
  function exPatch(id: string, patch: Partial<Exercise>) {
    setChanged(true);
    setExercises(
      exercises.map((e) =>
        e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e,
      ),
    );
  }
  async function save() {
    if (busy) return;
    for (const e of exercises)
      if (!e.name.trim()) {
        notify('动作名称不能为空');
        return;
      }
    for (const p of plans) {
      if (!p.name.trim()) {
        notify('计划名称不能为空');
        return;
      }
      for (const i of p.items)
        if (
          !Number.isInteger(i.sets) ||
          i.sets < 1 ||
          i.sets > 30 ||
          !Number.isInteger(i.min) ||
          i.min < 1 ||
          i.max < i.min ||
          !Number.isInteger(i.max) ||
          i.max > 1000
        ) {
          notify('请检查组数1–30、次数1–1000及上下限');
          return;
        }
    }
    setBusy(true);
    try {
      await db.transaction('rw', [db.exercises, db.workoutPlans], async () => {
        await db.exercises.bulkPut(exercises);
        await db.workoutPlans.bulkPut(plans);
      });
      notify('计划已保存，历史成绩保持原样');
      close();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="训练计划与动作"
      onClose={() => {
        if (!changed || confirm('放弃尚未保存的计划修改？')) close();
      }}
    >
      <p className="muted">
        计划和器械设置用于新训练。已有草稿及历史快照保持原样，修改后请在记录中确认实际器械。
      </p>
      <div className="segmented">
        {(['A', 'B', 'C'] as const).map((k) => (
          <button className={kind === k ? 'selected' : ''} key={k} onClick={() => setKind(k)}>
            {k} · {names[k]}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          计划名称
          <input maxLength={160} value={p.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          纳入自动轮换（可停用 C）
        </label>
      </div>
      {p.items.map((i) => {
        const e = exercises.find((e) => e.id === i.exerciseId)!;
        return (
          <div className="plan-item" key={i.exerciseId}>
            <div className="row-between">
              <h3>{e.name}</h3>
              <button
                className="icon-button danger"
                aria-label={'从计划移除' + e.name}
                onClick={() => patchPlan(p.items.filter((x) => x.exerciseId !== i.exerciseId))}
              >
                <X size={17} />
              </button>
            </div>
            <div className="form-grid three">
              <label>
                目标组数
                <input
                  aria-label={e.name + '目标组数'}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="30"
                  value={i.sets || ''}
                  onChange={(e) => item(i.exerciseId, { sets: Number(e.target.value) })}
                />
              </label>
              <label>
                次数下限
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  value={i.min || ''}
                  onChange={(e) => item(i.exerciseId, { min: Number(e.target.value) })}
                />
              </label>
              <label>
                次数上限
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  value={i.max || ''}
                  onChange={(e) => item(i.exerciseId, { max: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        );
      })}
      <div className="add-exercise">
        <select
          aria-label="加入计划的动作"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        >
          <option value="">选择动作加入计划</option>
          {exercises
            .filter((e) => e.active && !p.items.some((i) => i.exerciseId === e.id))
            .map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
        </select>
        <button
          className="secondary"
          disabled={!extra || p.items.length >= 30}
          onClick={() => {
            patchPlan([...p.items, { exerciseId: extra, sets: 3, min: 8, max: 12 }]);
            setExtra('');
          }}
        >
          加入
        </button>
      </div>
      <h3 className="subheading">器械动作管理</h3>
      <p className="muted">
        停用动作会从新训练中跳过，历史记录仍保留。自重动作的器械标识可填“自重”。
      </p>
      {exercises.map((e) => (
        <details className="exercise-details" key={e.id}>
          <summary>
            {e.name || '新动作'}
            <Badge>{e.active ? '启用' : '停用'}</Badge>
          </summary>
          <div className="form-grid">
            <label>
              动作名称
              <input
                maxLength={160}
                value={e.name}
                onChange={(x) => exPatch(e.id, { name: x.target.value })}
              />
            </label>
            <label>
              主要肌群
              <input
                maxLength={100}
                value={e.muscle}
                onChange={(x) => exPatch(e.id, { muscle: x.target.value })}
              />
            </label>
            <label>
              器械标识
              <input
                maxLength={160}
                value={e.equipment}
                onChange={(x) => exPatch(e.id, { equipment: x.target.value })}
              />
            </label>
            <label>
              默认动作方式
              <input
                maxLength={500}
                value={e.technique}
                onChange={(x) => exPatch(e.id, { technique: x.target.value })}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={e.active}
              onChange={(x) => exPatch(e.id, { active: x.target.checked })}
            />
            启用此动作
          </label>
        </details>
      ))}
      <button
        className="secondary"
        onClick={() => {
          setExercises([
            ...exercises,
            { ...stamp(), name: '新动作', muscle: '', equipment: '', technique: '', active: true },
          ]);
          setChanged(true);
        }}
      >
        <Plus size={17} />
        新增动作
      </button>
      <div className="editor-actions">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          保存计划与动作
        </button>
      </div>
    </Modal>
  );
}
function Sparkline({
  points,
  label,
  unit,
}: {
  points: { date: string; value: number }[];
  label: string;
  unit: string;
}) {
  if (points.length < 2)
    return (
      <div className="chart-empty">
        暂无足够数据<small>至少记录两个可比数据点</small>
      </div>
    );
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const min = Math.min(...sorted.map((p) => p.value)),
    max = Math.max(...sorted.map((p) => p.value));
  const start = new Date(sorted[0].date + 'T12:00:00').getTime(),
    end = new Date(sorted.at(-1)!.date + 'T12:00:00').getTime();
  const coords = sorted.map((p) => ({
    x: 18 + ((new Date(p.date + 'T12:00:00').getTime() - start) / (end - start || 1)) * 464,
    y: 130 - ((p.value - min) / (max - min || 1)) * 100,
  }));
  return (
    <figure className="chart">
      <div className="chart-summary">
        <span>{label}</span>
        <b>
          {sorted.at(-1)!.value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}{' '}
          <small>{unit}</small>
        </b>
      </div>
      <svg
        role="img"
        aria-label={`${label}，${sorted.map((p) => p.date + ' ' + p.value + unit).join('，')}`}
        viewBox="0 0 500 160"
      >
        <path d="M18 30H482M18 80H482M18 130H482" className="grid-line" />
        <polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          className="chart-line"
        />
        {coords.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" className="chart-point" />
        ))}
      </svg>
      <figcaption>
        {fmt(sorted[0].date)}
        <span>{fmt(sorted.at(-1)!.date)}</span>
      </figcaption>
    </figure>
  );
}
function Trends({
  data,
  db,
  notify,
}: {
  data: Dataset;
  db: FitnessDB;
  notify: (s: string) => void;
}) {
  const [exerciseId, setExerciseId] = useState(data.exercises[0]?.id ?? '');
  const [equipment, setEquipment] = useState('');
  const [technique, setTechnique] = useState('');
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [bodyForm, setBodyForm] = useState(false);
  const [goalForm, setGoalForm] = useState<Goal | null>(null);
  const [filterDay, setFilterDay] = useState('');
  const all = records(data, exerciseId);
  const equipmentOptions = [...new Set(all.map((r) => r.item.equipment).filter(Boolean))];
  const currentEquipment = equipment || equipmentOptions[0] || '';
  const techniques = [
    ...new Set(
      all
        .filter((r) => r.item.equipment === currentEquipment)
        .map((r) => r.item.technique)
        .filter(Boolean),
    ),
  ];
  const currentTechnique = technique || techniques[0] || '';
  const comparableRecords = records(data, exerciseId, currentEquipment, currentTechnique);
  const p = progress(data, exerciseId, currentEquipment, currentTechnique);
  const latest = comparableRecords[0];
  const e = data.exercises.find((e) => e.id === exerciseId);
  const ended = data.workoutSessions.filter((s) => s.status !== 'draft');
  const metric = totals(data.workoutSets.filter((s) => ended.some((w) => w.id === s.sessionId)));
  const first = month + '-01';
  const cells = Array.from(
    { length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  const offset = (new Date(first + 'T12:00:00').getDay() + 6) % 7;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = shiftDate(weekStart(), -(7 - i) * 7),
      to = shiftDate(from, 6);
    return {
      from,
      count: data.workoutSessions.filter(
        (s) => s.status === 'completed' && s.date >= from && s.date <= to,
      ).length,
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SMALL STEPS, REAL PROGRESS</span>
          <h1>让进步，有据可循。</h1>
          <p>比较相同动作、器械、动作方式与目标组数。</p>
        </div>
        <button className="secondary compact" onClick={() => setBodyForm(true)}>
          <Plus size={17} />
          记录身体指标
        </button>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <span>已结束训练总组数</span>
          <strong>
            {metric.sets}
            <small>组</small>
          </strong>
          <p>包括已完成和未完成的实际组</p>
        </div>
        <div className="stat-card">
          <span>实际总次数</span>
          <strong>
            {metric.reps}
            <small>次</small>
          </strong>
          <p>空白组不计入</p>
        </div>
        <div className="stat-card">
          <span>累计训练量</span>
          <strong>
            {metric.volume.toLocaleString()}
            <small>kg×次</small>
          </strong>
          <p>训练量不等同于肌肉增长</p>
        </div>
      </div>
      <div className="two-columns">
        <section className="panel calendar">
          <div className="row-between">
            <h2>训练日历</h2>
            <div className="month-controls">
              <button
                className="icon-button"
                aria-label="上个月"
                onClick={() => setMonth(shiftDate(first, -1).slice(0, 7))}
              >
                <ChevronLeft size={17} />
              </button>
              <b>{month}</b>
              <button
                className="icon-button"
                aria-label="下个月"
                onClick={() => {
                  const d = new Date(first + 'T12:00:00');
                  d.setMonth(d.getMonth() + 1);
                  setMonth(localDate(d).slice(0, 7));
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="calendar-grid">
            {['一', '二', '三', '四', '五', '六', '日'].map((x) => (
              <span className="weekday" key={x}>
                {x}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={'blank' + i} />
            ))}
            {cells.map((d) => {
              const sessions = data.workoutSessions.filter((s) => s.date === d);
              return (
                <button
                  key={d}
                  aria-label={
                    d +
                    ' ' +
                    (sessions.some((s) => s.status === 'completed')
                      ? '有已完成训练'
                      : sessions.some((s) => s.status === 'incomplete')
                        ? '有未完成训练'
                        : '无已完成训练')
                  }
                  className={
                    (d === localDate() ? 'today ' : '') +
                    (d === filterDay ? 'selected ' : '') +
                    (sessions.some((s) => s.status === 'completed') ? 'trained' : '')
                  }
                  onClick={() => setFilterDay(d === filterDay ? '' : d)}
                >
                  {Number(d.slice(-2))}
                  <i
                    className={
                      sessions.some((s) => s.status === 'incomplete') ? 'incomplete-dot' : ''
                    }
                  />
                </button>
              );
            })}
          </div>
          <small className="muted">绿色：有已完成训练 · 橙点：有未完成训练</small>
          {filterDay && (
            <div className="day-detail">
              <b>{fmt(filterDay)}</b>
              {data.workoutSessions
                .filter((s) => s.date === filterDay)
                .map((s) => (
                  <p key={s.id}>
                    {names[s.kind]} ·{' '}
                    {s.status === 'completed' ? '已完成' : s.status === 'draft' ? '草稿' : '未完成'}{' '}
                    · {totals(data.workoutSets.filter((x) => x.sessionId === s.id)).sets}组
                  </p>
                ))}
              {!data.workoutSessions.some((s) => s.date === filterDay) && <p>这一天没有记录</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>每周训练次数</h2>
          <p className="muted">自然周，周一开始；仅计已完成训练</p>
          <div className="bar-chart">
            {weeks.map((w) => (
              <div key={w.from}>
                <b>{w.count}</b>
                <span
                  style={{
                    height:
                      Math.max(4, (w.count / Math.max(1, ...weeks.map((x) => x.count))) * 130) +
                      'px',
                  }}
                />
                <small>{w.from.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="inline-note">
            <CalendarDays size={18} />
            <span>稳定出勤，比追求一次完美更重要。</span>
          </div>
        </section>
      </div>
      <Section
        title="同器械力量趋势"
        eyebrow="COMPARE LIKE WITH LIKE"
        action={
          <button
            className="text-button"
            onClick={() => {
              if (e)
                setGoalForm({
                  ...stamp(),
                  exerciseId: e.id,
                  equipment: currentEquipment || e.equipment,
                  technique: currentTechnique || e.technique,
                  weight: null,
                  sets: 3,
                  min: 8,
                  max: 12,
                  status: 'pending',
                  source: 'manual',
                  reason: '本人制定，等待确认',
                });
            }}
          >
            <Plus size={16} />
            制定下次目标
          </button>
        }
      >
        <div className="panel">
          <div className="form-grid three">
            <label>
              器械动作
              <select
                value={exerciseId}
                onChange={(x) => {
                  setExerciseId(x.target.value);
                  setEquipment('');
                  setTechnique('');
                }}
              >
                {data.exercises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              器械标识
              <select
                value={currentEquipment}
                onChange={(x) => {
                  setEquipment(x.target.value);
                  setTechnique('');
                }}
              >
                <option value="">请选择</option>
                {equipmentOptions.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </label>
            <label>
              动作方式
              <select value={currentTechnique} onChange={(x) => setTechnique(x.target.value)}>
                <option value="">请选择</option>
                {techniques.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="progress-verdict">
            <Badge green={p.delta !== null && p.delta > 0}>{p.label}</Badge>
            {p.warning && <p>{p.warning}</p>}
          </div>
          <p className="muted">
            图表仅显示同器械、同动作方式的每次最高实际组重量。重量变化不自动代表进步；请同时核对次数和组数。
          </p>
          {currentEquipment && currentTechnique ? (
            <Sparkline
              label="每次最高实际组重量"
              unit="kg"
              points={comparableRecords
                .filter((r) => r.sets.some(validSet))
                .map((r) => ({
                  date: r.session.date,
                  value: Math.max(...r.sets.filter(validSet).map((s) => s.weight!)),
                }))}
            />
          ) : (
            <Empty title="暂无足够数据">请先填写器械标识和动作方式。</Empty>
          )}
          <div className="reference">
            <span>下次训练建议 · 待本人确认</span>
            <b>{latest ? suggestion(data, latest.item) : '先建立真实基线，不预设重量。'}</b>
          </div>
          <h3 className="subheading">历史实际成绩</h3>
          {comparableRecords.length ? (
            comparableRecords.map((r) => (
              <div className="history-line" key={r.session.id + r.item.id}>
                <b>{fmt(r.session.date)}</b>
                <span>
                  {formatSets(r.sets)}
                  <small>
                    {totals(r.sets).sets}实际组 / {r.item.targetSets}目标组 · 总
                    {totals(r.sets).reps}次 · {totals(r.sets).volume}kg×次
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p className="muted">暂无足够数据。未填写条件的记录不用于力量比较。</p>
          )}
          {latest && (
            <details className="best-groups">
              <summary>最佳组表现候选（按相同重量比较次数）</summary>
              {[
                ...new Set(
                  comparableRecords.flatMap((r) => r.sets.filter(validSet).map((s) => s.weight!)),
                ),
              ]
                .sort((a, b) => a - b)
                .map((weight) => {
                  const candidates = comparableRecords.flatMap((r) =>
                    r.sets
                      .filter((s) => validSet(s) && s.weight === weight)
                      .map((s) => ({ date: r.session.date, reps: s.reps! })),
                  );
                  const best = candidates.sort((a, b) => b.reps - a.reps)[0];
                  return (
                    <p key={weight}>
                      {weight}kg × {best.reps}次 <small>{fmt(best.date)}，需核对动作质量</small>
                    </p>
                  );
                })}
            </details>
          )}
        </div>
      </Section>
      <Section title="下次目标确认" eyebrow="YOUR DECISION, ALWAYS">
        {data.trainingGoals.length ? (
          <div className="goal-grid">
            {[...data.trainingGoals]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((g) => (
                <article className="panel goal-card" key={g.id}>
                  <div className="row-between">
                    <h3>{data.exercises.find((e) => e.id === g.exerciseId)?.name}</h3>
                    <Badge green={g.status === 'confirmed'}>
                      {g.status === 'pending'
                        ? '待确认'
                        : g.status === 'confirmed'
                          ? '已确认'
                          : '已归档'}
                    </Badge>
                  </div>
                  <p>
                    {g.equipment || '器械未填写'} · {g.technique || '动作方式未填写'}
                  </p>
                  <strong>
                    {g.weight ?? '待定'}{' '}
                    <small>
                      kg · {g.sets}组 × {g.min}–{g.max}次
                    </small>
                  </strong>
                  <p>{g.reason}</p>
                  <small className="muted">
                    {g.source === 'ai' ? 'AI 建议，需本人核验' : '本人制定'} ·{' '}
                    {fmt(g.updatedAt.slice(0, 10))}
                  </small>
                  <div className="button-row">
                    {g.status === 'pending' && (
                      <button
                        className="primary compact"
                        onClick={async () => {
                          if (!g.equipment.trim() || !g.technique.trim()) {
                            notify('请先编辑器械标识与动作方式');
                            return;
                          }
                          if (
                            !confirm(
                              '已核对依据、器械实际档位与动作条件，确认将该目标用于下一次训练？',
                            )
                          )
                            return;
                          try {
                            await db.transaction('rw', db.trainingGoals, async () => {
                              const old = await db.trainingGoals
                                .where('exerciseId')
                                .equals(g.exerciseId)
                                .toArray();
                              for (const x of old)
                                if (
                                  x.status === 'confirmed' &&
                                  x.equipment === g.equipment &&
                                  x.technique === g.technique
                                )
                                  await db.trainingGoals.update(x.id, {
                                    status: 'completed',
                                    updatedAt: new Date().toISOString(),
                                  });
                              await db.trainingGoals.update(g.id, {
                                status: 'confirmed',
                                updatedAt: new Date().toISOString(),
                              });
                            });
                            notify('目标已确认，历史实际成绩保持原样');
                          } catch (e) {
                            notify(errorText(e));
                          }
                        }}
                      >
                        <Check size={16} />
                        本人确认
                      </button>
                    )}
                    <button
                      className="secondary compact"
                      onClick={() => setGoalForm({ ...g, ...stamp(), status: 'pending' })}
                    >
                      调整为新版本
                    </button>
                  </div>
                </article>
              ))}
          </div>
        ) : (
          <Empty title="你的目标，等待你确认">建议不会自动生效。先选择动作，再制定下次目标。</Empty>
        )}
      </Section>
      <Section title="身体变化" eyebrow="LOOK AT THE LONGER TERM">
        <div className="two-columns">
          <div className="panel">
            <Sparkline
              label="体重记录"
              unit="kg"
              points={data.bodyMetrics
                .filter((b) => b.weight !== null)
                .map((b) => ({ date: b.date, value: b.weight! }))}
            />
          </div>
          <div className="panel">
            <Sparkline
              label="腰围记录"
              unit="cm"
              points={data.bodyMetrics
                .filter((b) => b.waist !== null)
                .map((b) => ({ date: b.date, value: b.waist! }))}
            />
          </div>
        </div>
        <p className="muted">
          体重{data.bodyMetrics.filter((b) => b.weight !== null).length}个记录点，腰围
          {data.bodyMetrics.filter((b) => b.waist !== null).length}
          个记录点。不强制每日录入；单日波动不等于脂肪增减。
        </p>
        <details className="panel">
          <summary>查看身体指标明细</summary>
          {[...data.bodyMetrics]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((b) => (
              <div className="history-line" key={b.id}>
                <b>{fmt(b.date)}</b>
                <span>
                  {b.weight ?? '—'}kg · {b.waist ?? '—'}cm<small>{b.notes}</small>
                </span>
                <button
                  className="icon-button danger"
                  aria-label={'删除身体指标' + b.date}
                  onClick={async () => {
                    if (confirm('删除这条身体指标？'))
                      try {
                        await db.bodyMetrics.delete(b.id);
                      } catch (e) {
                        notify(errorText(e));
                      }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
        </details>
      </Section>
      {bodyForm && <BodyForm db={db} close={() => setBodyForm(false)} notify={notify} />}{' '}
      {goalForm && (
        <GoalForm
          goal={goalForm}
          data={data}
          db={db}
          close={() => setGoalForm(null)}
          notify={notify}
        />
      )}
    </>
  );
}
function BodyForm({
  db,
  close,
  notify,
}: {
  db: FitnessDB;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [date, setDate] = useState(localDate());
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal title="记录身体指标" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!weight && !waist) {
            notify('至少填写体重或腰围');
            return;
          }
          try {
            await db.bodyMetrics.add({
              ...stamp(),
              date,
              weight: num(weight),
              waist: num(waist),
              notes,
            });
            notify('身体指标已保存');
            close();
          } catch (e) {
            notify(errorText(e));
          }
        }}
      >
        <div className="form-grid">
          <label>
            测量日期
            <input
              type="date"
              required
              max={localDate()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            体重（kg）
            <input
              type="number"
              inputMode="decimal"
              min="10"
              max="500"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <label>
            腰围（cm）
            <input
              type="number"
              inputMode="decimal"
              min="20"
              max="300"
              step="0.1"
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
            />
          </label>
        </div>
        <label>
          测量条件或备注
          <textarea
            maxLength={20000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例如 晨起、同一软尺"
          />
        </label>
        <p className="muted">尽量保持测量条件一致，观察多次记录，不判断单日脂肪变化。</p>
        <button className="primary" type="submit">
          保存身体指标
        </button>
      </form>
    </Modal>
  );
}
function GoalForm({
  goal,
  data,
  db,
  close,
  notify,
}: {
  goal: Goal;
  data: Dataset;
  db: FitnessDB;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [g, setG] = useState(goal);
  const patch = (p: Partial<Goal>) => setG({ ...g, ...p });
  return (
    <Modal title="制定待确认目标" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (g.max < g.min) {
            notify('次数上限不能小于下限');
            return;
          }
          try {
            await db.trainingGoals.add({
              ...g,
              status: 'pending',
              updatedAt: new Date().toISOString(),
            });
            notify('建议已存为待确认，尚未成为正式目标');
            close();
          } catch (e) {
            notify(errorText(e));
          }
        }}
      >
        <div className="form-grid">
          <label>
            动作
            <select value={g.exerciseId} onChange={(e) => patch({ exerciseId: e.target.value })}>
              {data.exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            建议来源
            <select
              value={g.source}
              onChange={(e) => patch({ source: e.target.value as Goal['source'] })}
            >
              <option value="manual">本人制定</option>
              <option value="ai">ChatGPT 建议（待核验）</option>
            </select>
          </label>
          <label>
            器械标识
            <input
              maxLength={160}
              required
              value={g.equipment}
              onChange={(e) => patch({ equipment: e.target.value })}
            />
          </label>
          <label>
            动作方式
            <input
              maxLength={500}
              required
              value={g.technique}
              onChange={(e) => patch({ technique: e.target.value })}
            />
          </label>
          <label>
            目标重量 kg（可留空）
            <input
              inputMode="decimal"
              type="number"
              min="0"
              max="2000"
              step="0.5"
              value={g.weight ?? ''}
              onChange={(e) => patch({ weight: num(e.target.value) })}
            />
          </label>
          <label>
            目标组数
            <input
              inputMode="numeric"
              type="number"
              min="1"
              max="30"
              required
              value={g.sets}
              onChange={(e) => patch({ sets: Number(e.target.value) })}
            />
          </label>
          <label>
            次数下限
            <input
              inputMode="numeric"
              type="number"
              min="1"
              max="1000"
              required
              value={g.min}
              onChange={(e) => patch({ min: Number(e.target.value) })}
            />
          </label>
          <label>
            次数上限
            <input
              inputMode="numeric"
              type="number"
              min="1"
              max="1000"
              required
              value={g.max}
              onChange={(e) => patch({ max: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          制定依据
          <textarea
            required
            maxLength={20000}
            value={g.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="引用上次实际组，说明动作质量、余力及器械可用档位"
          />
        </label>
        <p className="muted">保存后仍为待确认。不会改写实际成绩，不自动假定器械配重档位。</p>
        <button type="submit" className="primary">
          保存为待确认目标
        </button>
      </form>
    </Modal>
  );
}
function AIPage({
  data,
  db,
  mode,
  notify,
}: {
  data: Dataset;
  db: FitnessDB;
  mode: Mode;
  notify: (s: string) => void;
}) {
  const [text, setText] = useState('');
  const [week, setWeek] = useState(weekStart(localDate()));
  const [copyFallback, setCopyFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  function exportPackage(markdown: boolean) {
    try {
      const p = packageAnalysis(data, mode);
      download(
        `Fitness-OS-分析-${localDate()}.${markdown ? 'md' : 'json'}`,
        markdown ? analysisMarkdown(p) : JSON.stringify(p, null, 2),
        markdown ? 'text/markdown' : 'application/json',
      );
      notify('分析数据包已生成，请自行选择是否发给 ChatGPT');
    } catch (e) {
      notify(errorText(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REFLECT. ADJUST. REPEAT.</span>
          <h1>每周回顾，下一步更清楚。</h1>
          <p>把真实记录整理成依据，再由你决定如何调整。</p>
        </div>
      </div>
      <section className="panel ai-hero">
        <span className="brand-icon">
          <Sparkles />
        </span>
        <h2>你的数据，你决定何时分享</h2>
        <p>
          这里不调用 AI，也不自动上传健康数据。导出数据包后，可自行交给 ChatGPT
          分析，再把结论保存回来。
        </p>
        <div className="button-row">
          <button
            className="primary"
            disabled={mode === 'demo'}
            onClick={() => exportPackage(false)}
          >
            <ArrowDownToLine size={18} />
            导出分析 JSON
          </button>
          <button
            className="secondary"
            disabled={mode === 'demo'}
            onClick={() => exportPackage(true)}
          >
            <FileText size={18} />
            导出 Markdown
          </button>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(aiPrompt);
                notify('ChatGPT 分析提示词已复制');
              } catch {
                setCopyFallback(true);
              }
            }}
          >
            <Clipboard size={18} />
            复制 ChatGPT 分析提示词
          </button>
        </div>
        {mode === 'demo' && <p className="muted">演示模式不生成正式分析包，请切换到正式空间。</p>}
        <details>
          <summary>数据包包含什么？</summary>
          <p>
            最近7天训练、最近28天历史及逐组成绩、当前计划、身体指标、已确认和待确认目标、缺失信息提示。7天与28天窗口有重叠，提示词要求避免重复计数。
          </p>
        </details>
        {copyFallback && (
          <label>
            当前浏览器无法自动复制，请长按选择以下文本
            <textarea readOnly value={aiPrompt} onFocus={(e) => e.target.select()} />
          </label>
        )}
      </section>
      <Section title="保存本周的思考" eyebrow="A NOTE TO YOUR FUTURE SELF">
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || busy) return;
            setBusy(true);
            try {
              await db.weeklyReports.add({ ...stamp(), week, text });
              setText('');
              notify('周报已保存，训练目标仍需在趋势页单独确认');
            } catch (e) {
              notify(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            周报对应日期
            <input type="date" required value={week} onChange={(e) => setWeek(e.target.value)} />
          </label>
          <label>
            分析结论或个人复盘
            <textarea
              required
              maxLength={20000}
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴 ChatGPT 分析，或写下本周训练、恢复与下周打算…"
            />
          </label>
          <p className="muted">
            AI 建议不会自动成为目标。请在「趋势 → 制定下次目标」录入、核验器械档位，并本人确认。
          </p>
          <button className="primary" disabled={busy || !text.trim()} type="submit">
            保存周报
          </button>
        </form>
      </Section>
      <Section title="周报档案">
        {data.weeklyReports.length ? (
          [...data.weeklyReports]
            .sort((a, b) => b.week.localeCompare(a.week))
            .map((r) => (
              <details className="panel report" key={r.id}>
                <summary>
                  {fmt(r.week)} · 周报 <Badge>{mode === 'demo' ? '虚构演示' : '本人保存'}</Badge>
                </summary>
                <div className="report-text">{r.text}</div>
                <button
                  className="text-button danger"
                  onClick={async () => {
                    if (confirm('删除这份周报？'))
                      try {
                        await db.weeklyReports.delete(r.id);
                      } catch (e) {
                        notify(errorText(e));
                      }
                  }}
                >
                  删除周报
                </button>
              </details>
            ))
        ) : (
          <Empty title="还没有周报">先记录，再分析。数据不够时，也可以写下感受。</Empty>
        )}
      </Section>
    </>
  );
}
const tableLabels: Record<string, string> = {
  exercises: '动作',
  workoutPlans: '计划',
  workoutSessions: '训练',
  workoutSets: '实际组',
  bodyMetrics: '身体指标',
  trainingGoals: '目标',
  weeklyReports: '周报',
  settings: '设置',
};
function CountList({ data }: { data: Dataset }) {
  return (
    <div className="count-list">
      {Object.entries(counts(data)).map(([key, value]) => (
        <span key={key}>
          {tableLabels[key]} <b>{value}</b>
        </span>
      ))}
    </div>
  );
}
function SettingsPage({
  data,
  db,
  mode,
  switchMode,
  notify,
  offlineReady,
}: {
  data: Dataset;
  db: FitnessDB;
  mode: Mode;
  switchMode: (m: Mode) => void;
  notify: (s: string) => void;
  offlineReady: boolean;
}) {
  const prefs = data.settings[0];
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmation, setConfirmation] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState('');
  const [storage, setStorage] = useState('');
  async function preference(p: Partial<Settings>) {
    try {
      await db.settings.update(prefs.id, { ...p, updatedAt: new Date().toISOString() });
    } catch (e) {
      notify(errorText(e));
    }
  }
  async function buildPreview(value: string, m: 'merge' | 'replace') {
    setPreview(null);
    setDownloaded(false);
    setConfirmation('');
    setResult('');
    setErr('');
    if (!value) return;
    try {
      const p = await previewRestore(db, value, m);
      download(`Fitness-OS-导入前备份-${Date.now()}.json`, JSON.stringify(p.before, null, 2));
      setPreview(p);
    } catch (e) {
      setErr(errorText(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>你的空间，由你掌握。</h1>
          <p>计划、备份和设备设置，都在这里。</p>
        </div>
        <Badge green={mode === 'real'}>{mode === 'real' ? '正式空间' : '独立虚构演示空间'}</Badge>
      </div>
      <div className="two-columns">
        <section className="panel">
          <h2>训练节奏</h2>
          <label>
            90天周期开始日期
            <input
              type="date"
              required
              value={prefs.cycleStart}
              onChange={(e) => {
                if (e.target.value) void preference({ cycleStart: e.target.value });
              }}
            />
          </label>
          <label>
            本自然周计划训练次数
            <select
              value={prefs.weeklyPlanned ?? ''}
              onChange={(e) => void preference({ weeklyPlanned: num(e.target.value) })}
            >
              <option value="">暂未设置</option>
              {Array.from({ length: 15 }, (_, i) => (
                <option key={i} value={i}>
                  {i} 次
                </option>
              ))}
            </select>
          </label>
          <label>
            90天周期目标训练次数
            <select
              value={prefs.cycleTargetSessions ?? ''}
              onChange={(e) => void preference({ cycleTargetSessions: num(e.target.value) })}
            >
              <option value="">暂未设置</option>
              {Array.from({ length: 180 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} 次
                </option>
              ))}
            </select>
          </label>
          <small className="muted">仅用于本周完成率。可随恢复调整，不强制 C 训练。</small>
        </section>
        <section className="panel">
          <h2>外观与空间</h2>
          <label>
            显示模式
            <select
              value={prefs.theme}
              onChange={(e) => void preference({ theme: e.target.value as Settings['theme'] })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <p className="muted">正式与演示分别存入两个 IndexedDB 数据库。</p>
          <button
            className="secondary"
            onClick={() => switchMode(mode === 'real' ? 'demo' : 'real')}
          >
            {mode === 'real' ? '体验虚构演示' : '返回正式空间'}
          </button>
        </section>
      </div>
      <Section title="备份与恢复" eyebrow="KEEP A COPY, KEEP YOUR PROGRESS">
        <section className="panel">
          <div className="inline-note warning">
            <ShieldCheck size={24} />
            <div>
              <b>本地保存，不代表永远不会丢失</b>
              <p>
                卸载 PWA、清理网站数据、更换设备或浏览器存储回收可能导致数据丢失。iPhone 和 Mac
                默认不自动同步。建议每周导出备份；正式使用前必须完成一次备份恢复测试。
              </p>
            </div>
          </div>
          <CountList data={data} />
          <div className="button-row">
            <button
              className="primary"
              disabled={mode === 'demo' || busy}
              onClick={async () => {
                try {
                  const backup = await makeBackup(db);
                  download(
                    `Fitness-OS-完整备份-${localDate()}.json`,
                    JSON.stringify(backup, null, 2),
                  );
                  await preference({ lastBackup: new Date().toISOString() });
                  notify('完整 JSON 已生成，请确认文件已保存在「文件」或下载目录');
                } catch (e) {
                  notify(errorText(e));
                }
              }}
            >
              <ArrowDownToLine size={18} />
              导出完整 JSON 备份
            </button>
          </div>
          <p className="muted">
            数据版本 1 · 最近生成备份：
            {prefs.lastBackup ? new Date(prefs.lastBackup).toLocaleString('zh-CN') : '尚未生成'}
            。点击下载不代表系统能核实你已保存文件。
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={prefs.restoreTested}
              onChange={(e) => void preference({ restoreTested: e.target.checked })}
            />
            我已实际完成备份恢复，并核对训练与组数
          </label>
          <hr />
          <h3>从 JSON 恢复</h3>
          <p className="muted">
            先验证文件、预览数量，再恢复。默认保留所有现有 ID；重复导入不会重复创建记录，同 ID
            的不同内容保留当前版本。
          </p>
          <label>
            选择完整备份文件
            <input
              aria-label="选择备份文件"
              type="file"
              accept=".json,application/json"
              disabled={mode === 'demo' || busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setPreview(null);
                setRaw('');
                setDownloaded(false);
                setErr('');
                setResult('');
                if (file.size > 20 * 1024 * 1024) {
                  setErr('文件超过20MB，未读取、未写入');
                  return;
                }
                try {
                  const value = await file.text();
                  setRaw(value);
                  await buildPreview(value, importMode);
                } catch (error) {
                  setErr('无法读取文件：' + errorText(error));
                }
              }}
            />
          </label>
          <label>
            恢复方式
            <select
              disabled={busy || mode === 'demo'}
              value={importMode}
              onChange={async (e) => {
                const m = e.target.value as 'merge' | 'replace';
                setImportMode(m);
                await buildPreview(raw, m);
              }}
            >
              <option value="merge">合并：保留现有数据（默认）</option>
              <option value="replace">覆盖：用备份替换全部当前正式数据</option>
            </select>
          </label>
          {err && (
            <p className="error" role="alert">
              {err}。现有数据未改变。
            </p>
          )}
          {preview && (
            <div className="restore-preview">
              <h3>导入预览 · {preview.mode === 'merge' ? '合并保留' : '完整覆盖'}</h3>
              <p>
                文件导出于 {new Date(preview.incoming.exportedAt).toLocaleString('zh-CN')} · 版本1 ·
                正式数据
              </p>
              <b>文件内记录</b>
              <CountList data={preview.incoming.data} />
              <b>恢复后的预计数量</b>
              <CountList data={preview.result} />
              <p>
                已验证全部关联。{preview.conflicts.length} 项同 ID 内容冲突，
                {preview.mode === 'merge' ? '保留现有版本' : '覆盖现有内容'}。
              </p>
              <p className="muted">
                已自动生成并触发下载当前数据备份；如果没有保存成功，请取消恢复，重新选择文件。
              </p>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    `Fitness-OS-导入前备份-${Date.now()}.json`,
                    JSON.stringify(preview.before, null, 2),
                  )
                }
              >
                再次下载导入前备份
              </button>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={downloaded}
                  onChange={(e) => setDownloaded(e.target.checked)}
                />
                我已确认导入前备份文件保存成功
              </label>
              {preview.mode === 'replace' && (
                <label>
                  输入「覆盖当前数据」确认替换
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="覆盖当前数据"
                  />
                </label>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  !downloaded ||
                  (preview.mode === 'replace' && confirmation !== '覆盖当前数据')
                }
                onClick={async () => {
                  setBusy(true);
                  setErr('');
                  try {
                    const r = await restore(db, preview, confirmation, downloaded);
                    setResult(
                      '恢复成功；' +
                        Object.entries(r.counts)
                          .map(([k, v]) => tableLabels[k] + v)
                          .join('、') +
                        '。' +
                        r.relations,
                    );
                    setPreview(null);
                    setRaw('');
                    notify('恢复成功，数量与关联已核对');
                  } catch (e) {
                    setErr(errorText(e));
                    setPreview(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认{preview.mode === 'merge' ? '合并恢复' : '覆盖全部正式数据'}
              </button>
            </div>
          )}
          {result && (
            <p className="success" role="status">
              {result}
            </p>
          )}
        </section>
      </Section>
      <Section title="安装与离线" eyebrow="TAKE YOUR TRAINING WITH YOU">
        <div className="two-columns">
          <section className="panel">
            <h3>添加到 iPhone 主屏幕</h3>
            <ol>
              <li>在 Safari 打开通过 HTTPS 提供的应用。</li>
              <li>点击分享按钮，选择「添加到主屏幕」。</li>
              <li>先联网完整打开一次，随后用飞行模式测试记录和重启。</li>
            </ol>
            <p className="muted">
              Mac
              可使用浏览器的安装应用或添加到程序坞功能。本地开发地址仅供本机，手机访问需另行配置安全的本地
              HTTPS。
            </p>
            <Badge green={offlineReady}>
              {offlineReady ? '离线资源已准备好' : '首次打开后准备离线资源'}
            </Badge>
          </section>
          <section className="panel">
            <h3>设备存储</h3>
            <p className="muted">
              申请持久存储可降低自动回收的可能性，但不能代替备份。Safari 可能不会授予此请求。
            </p>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const persisted = await navigator.storage?.persist?.();
                  const estimate = await navigator.storage?.estimate?.();
                  setStorage(
                    `${persisted ? '已获持久存储许可' : '未获持久存储许可 / 浏览器不支持'}；当前约 ${((estimate?.usage ?? 0) / 1024 / 1024).toFixed(2)} MB`,
                  );
                } catch (e) {
                  setStorage(errorText(e));
                }
              }}
            >
              检查并申请持久存储
            </button>
            <p>{storage}</p>
            <small className="muted">
              应用更新仅替换静态资源，不清空 IndexedDB。没有远程健康数据服务、统计或广告。
            </small>
          </section>
        </div>
      </Section>
    </>
  );
}
