const WorkoutEditor = lazy(() => import("./WorkoutEditor"));
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
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
  MoreHorizontal,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  WifiOff,
  X,
} from "lucide-react";
import {
  FitnessDB,
  seed,
  snapshot,
  createSession,
  emptyDrafts,
  cleanEmptyDrafts,
  hasDraftContent,
  deleteSession,
  rememberedExercise,
} from "./db";
import {
  type BodyMetric,
  type Dataset,
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
} from "./model";
import {
  totals,
  formatSets,
  records,
  lastRecord,
  progress,
  suggestion,
  nextKind,
  weekCompleted,
  weeklyCounts,
  packageAnalysis,
  analysisMarkdown,
  aiPrompt,
} from "./analytics";
import {
  download,
  makeBackup,
  integrity,
  previewRestore,
  restore,
  counts,
  type RecoveryPreview,
} from "./backup";
type Page = "home" | "record" | "trends" | "ai" | "data";
const nav = [
  ["home", HomeIcon, "总览"],
  ["record", Dumbbell, "训练"],
  ["trends", TrendingUp, "趋势"],
  ["ai", Sparkles, "AI 周报"],
] as const;
const fmt = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
const num = (s: string) => (s === "" ? null : Number(s));
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
const touch = <span className="dot" />;
function Badge({
  children,
  green = false,
}: {
  children: ReactNode;
  green?: boolean;
}) {
  return <span className={"badge " + (green ? "green" : "")}>{children}</span>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Activity size={30} />
      <strong>{title}</strong>
      <p>{children ?? "留下第一次记录，进步才有迹可循。"}</p>
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
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const resize = () =>
      ref.current?.style.setProperty(
        "--modal-height",
        `${Math.max(180, (viewport?.height ?? innerHeight) - 24)}px`,
      );
    resize();
    viewport?.addEventListener("resize", resize);
    return () => {
      document.body.style.overflow = old;
      viewport?.removeEventListener("resize", resize);
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
        <p>
          本地数据不会被自动清除。请重新加载；若持续出错，请保留网站数据并联系开发者。
        </p>
        <button onClick={() => location.reload()}>重新加载</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <Boundary>
      <Workspace />
    </Boundary>
  );
}
function Workspace() {
  const db = useMemo(() => new FitnessDB("real"), []);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [page, setPage] = useState<Page>(() => {
    const p = location.hash.slice(1);
    return (
      ["home", "record", "trends", "ai", "data"].includes(p) ? p : "home"
    ) as Page;
  });
  const [homeMenu, setHomeMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [editor, setEditor] = useState<{
    session: Session;
    sets: WorkoutSet[];
  } | null>(null);
  const [summary, setSummary] = useState<{
    session: Session;
    sets: WorkoutSet[];
  } | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(
    () => (ready ? snapshot(db) : undefined),
    [db, ready],
  );
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
    addEventListener("online", fn);
    addEventListener("offline", fn);
    return () => {
      removeEventListener("online", fn);
      removeEventListener("offline", fn);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const theme = data?.settings[0]?.theme ?? "system";
    document.documentElement.dataset.theme = theme;
  }, [data?.settings]);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(e) {
      setToast("离线组件注册失败：" + errorText(e));
    },
  });
  async function start(kind: Kind) {
    if (!data || busy) return;
    setBusy(true);
    try {
      setSummary(null);
      const w = createSession(data, kind);
      setEditor(w);
    } catch (e) {
      setToast("无法创建草稿：" + errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function open(w: Session) {
    if (!data) return;
    setEditor({
      session: structuredClone(w),
      sets: structuredClone(
        data.workoutSets.filter((s) => s.sessionId === w.id),
      ),
    });
  }
  useEffect(() => {
    const sync = () => {
      const p = location.hash.slice(1);
      setPage(
        (["home", "record", "trends", "ai", "data"].includes(p)
          ? p
          : "home") as Page,
      );
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  function move(p: Page) {
    location.hash = p;
    setPage(p);
    setHomeMenu(false);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            move("home");
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
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => move(id)}
            >
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
          <span className="breadcrumb">Fitness OS</span>
          <div className="top-status">
            {!online ? (
              <>
                <WifiOff size={14} /> 离线可记录
              </>
            ) : (
              <>{touch} 本地保存</>
            )}
          </div>
        </header>
        <main className="content" data-page={page}>
          {needRefresh && (
            <div className="notice">
              <span>新版本已就绪，草稿会保留。请保存当前记录后更新。</span>
              <button
                disabled={Boolean(editor)}
                onClick={() => void updateServiceWorker(true)}
              >
                更新应用
              </button>
            </div>
          )}
          {summary && (
            <section className="completion-card" aria-label="训练完成总结">
              <CheckCircle2 size={32} />
              <span className="eyebrow">本次训练已保存</span>
              <h2>训练完成</h2>
              <p>
                {names[summary.session.kind]} · {totals(summary.sets).sets} 组 ·{" "}
                {totals(summary.sets).reps} 次
              </p>

              <div className="button-row">
                <button
                  className="primary"
                  onClick={() =>
                    void start(
                      nextKind({
                        ...data,
                        workoutSessions: [
                          ...data.workoutSessions.filter(
                            (s) => s.id !== summary.session.id,
                          ),
                          summary.session,
                        ],
                      }),
                    )
                  }
                >
                  记录下一次训练 <ArrowRight size={16} />
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setSummary(null);
                    move("trends");
                  }}
                >
                  查看历史与趋势
                </button>
                <button
                  className="text-button"
                  onClick={() => setSummary(null)}
                >
                  收起总结
                </button>
              </div>
            </section>
          )}
          {page === "home" && (
            <>
              <div className="overview-toolbar">
                <button
                  className="icon-button"
                  aria-label="总览更多操作"
                  aria-expanded={homeMenu}
                  onClick={() => setHomeMenu(!homeMenu)}
                >
                  <MoreHorizontal />
                </button>
                {homeMenu && (
                  <div className="overview-menu">
                    <button onClick={() => move("data")}>
                      <Database size={18} />
                      数据管理
                    </button>
                    <button
                      onClick={() => {
                        setShowPlans(true);
                        setHomeMenu(false);
                      }}
                    >
                      <Dumbbell size={18} />
                      训练计划与动作库
                    </button>
                  </div>
                )}
              </div>
              <Dashboard
                data={data}
                start={start}
                open={open}
                plans={() => setShowPlans(true)}
                move={move}
                busy={busy}
              />
            </>
          )}
          {page === "record" && (
            <RecordPage
              db={db}
              data={data}
              start={start}
              open={open}
              plans={() => setShowPlans(true)}
              busy={busy}
            />
          )}
          {page === "trends" && (
            <Trends data={data} db={db} notify={setToast} />
          )}
          {page === "ai" && <AIPage data={data} db={db} notify={setToast} />}
          {page === "data" && (
            <SettingsPage
              data={data}
              db={db}

              notify={setToast}
              offlineReady={offlineReady}
              onPlans={() => setShowPlans(true)}
            />
          )}
        </main>
      </div>
      <nav className="bottom-nav">
        {nav.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            className={page === id ? "active" : ""}
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
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {editor && (
        <Suspense
          fallback={
            <div className="toast" role="status">
              正在打开训练记录…
            </div>
          }
        >
          <WorkoutEditor
            key={editor.session.id}
            initial={editor}
            data={data}
            db={db}
            onClose={() => setEditor(null)}
            onComplete={(session, sets) => {
              setSummary({ session, sets });
              setEditor(null);
              move("record");
            }}
            notify={setToast}
            onManageExercises={() => setShowPlans(true)}
          />
        </Suspense>
      )}
      {showPlans && (
        <PlanEditor
          data={data}
          db={db}
          close={() => setShowPlans(false)}
          notify={setToast}
        />
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
    .filter((s) => s.status === "completed")
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    )[0];
  const draft = data.workoutSessions
    .filter(
      (s) =>
        s.status === "draft" &&
        hasDraftContent(
          s,
          data.workoutSets.filter((x) => x.sessionId === s.id),
        ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const prefs = data.settings[0];
  const day =
    Math.floor(
      (new Date(localDate() + "T12:00:00").getTime() -
        new Date(prefs.cycleStart + "T12:00:00").getTime()) /
        86400000,
    ) + 1;
  const cycleCount = data.workoutSessions.filter(
    (s) =>
      s.status === "completed" &&
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
            {new Date().toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}{" "}
          </span>
          <h1>训练总览</h1>
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
            <Badge green>下一次训练 · {next}</Badge>
            <h2>{plan?.name ?? "自选训练"}</h2>
            <p>
              {!enabled && "计划已暂停。"}
              {plan?.items
                .map(
                  (p) =>
                    data.exercises.find((e) => e.id === p.exerciseId)?.name,
                )
                .filter(Boolean)
                .join(" · ") || "自由安排训练动作"}
            </p>
            <button
              className="primary"
              disabled={busy || !enabled}
              onClick={() => start(next)}
            >
              {busy ? <LoaderCircle size={18} /> : <Plus size={20} />}开始记录{" "}
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
        <section className="cycle-card">
          <div className="card-top">
            <span className="eyebrow">90 天训练周期</span>
            <Leaf size={18} />
          </div>
          <div className="cycle-number">
            {day < 1 ? "未开始" : Math.min(day, 90)}
            <span>/ 90 天</span>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: Math.max(0, Math.min((day / 90) * 100, 100)) + "%",
              }}
            />
          </div>
          <h3>
            {day < 1
              ? "准备开始"
              : day <= 30
                ? "建立基线，找到节奏"
                : day <= 60
                  ? "保持质量，稳步进步"
                  : "回顾表现，规划下一程"}
          </h3>
          <p>{fmt(prefs.cycleStart)} 开始</p>
          <div className="cycle-goal">
            周期完成 <b>{cycleCount}</b> 次
            {prefs.cycleTargetSessions
              ? ` / 目标 ${prefs.cycleTargetSessions} 次 · ${Math.round((cycleCount / prefs.cycleTargetSessions) * 100)}%`
              : ""}
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
              ? "周计划次数待设置"
              : prefs.weeklyPlanned === 0
                ? "本周未安排训练"
                : `计划 ${prefs.weeklyPlanned} 次 · ${Math.round((completed / prefs.weeklyPlanned) * 100)}% 已完成`}
          </p>
        </div>
        <div className="stat-card">
          <span>
            <Dumbbell size={17} /> 最近一次训练
          </span>
          <strong className="text-stat">{last ? names[last.kind] : "—"}</strong>
          <p>
            {last
              ? `${fmt(last.date)}${last.duration ? " · " + last.duration + " 分钟" : ""}`
              : ""}
          </p>
        </div>
        <div className="stat-card">
          <span>
            <TrendingUp size={17} /> 累计完成
          </span>
          <strong>
            {
              data.workoutSessions.filter((s) => s.status === "completed")
                .length
            }
            <small>次训练</small>
          </strong>
        </div>
      </div>
      <Section
        eyebrow="TRAIN WITH INTENTION"
        title="训练计划"
        action={
          <button className="text-button" onClick={() => move("trends")}>
            查看趋势 <ArrowRight size={15} />
          </button>
        }
      >
        <div className="exercise-grid">
          {plan?.items.map((p) => {
            const original = data.exercises.find((e) => e.id === p.exerciseId);
            const e = original ? rememberedExercise(data, original) : undefined;
            if (!e) return null;
            const r = lastRecord(data, e.id, e.equipment, e.technique);
            const g = data.trainingGoals
              .filter(
                (g) =>
                  g.exerciseId === e.id &&
                  g.equipment === e.equipment &&
                  g.technique === e.technique &&
                  g.status === "confirmed",
              )
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            return (
              <details className="overview-exercise" key={e.id}>
                <summary>
                  <b>{e.name}</b>
                  <span>
                    {g
                      ? `${g.sets} × ${g.min}–${g.max}`
                      : `${p.sets} × ${p.min}–${p.max}`}
                  </span>
                </summary>
                <div className="exercise-facts">
                  <p>
                    {e.muscle}
                    {e.equipment ? ` · ${e.equipment}` : " · 器械待填写"}
                  </p>
                  {r && <p>上次 {formatSets(r.sets)}</p>}
                  {g && (
                    <p>
                      已确认目标{" "}
                      {g.weight === null ? "重量待定" : `${g.weight} kg`}
                    </p>
                  )}
                </div>
              </details>
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
        <button className="text-button" onClick={() => move("data")}>
          管理备份 <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
function RecordPage({
  db,
  data,
  start,
  open,
  plans,
  busy,
}: {
  db: FitnessDB;
  data: Dataset;
  start: (k: Kind) => void;
  open: (s: Session) => void;
  plans: () => void;
  busy: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(30);
  const [cleanup, setCleanup] = useState<Session[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupError, setCleanupError] = useState("");
  const candidates = emptyDrafts(data);
  const drafts = data.workoutSessions.filter(
    (s) =>
      s.status === "draft" &&
      hasDraftContent(
        s,
        data.workoutSets.filter((x) => x.sessionId === s.id),
      ),
  );
  const sessions = data.workoutSessions
    .filter((s) => s.status !== "draft")
    .sort(
      (a, b) =>
        Number(b.status === "completed") - Number(a.status === "completed") ||
        b.date.localeCompare(a.date) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOG YOUR EFFORT</span>
          <h1>训练记录</h1>
        </div>
        <button className="secondary compact" onClick={plans}>
          <Settings2 size={16} />
          计划与动作
        </button>
      </div>
      <div className="type-grid">
        {(["A", "B", "C"] as const).map((k) => (
          <button
            disabled={busy}
            className="type-card"
            key={k}
            onClick={() => start(k)}
          >
            <span>{k}</span>
            <div>
              <h3>{names[k]}</h3>
              <p>
                {data.workoutPlans.find((p) => p.kind === k)?.items.length ?? 0}{" "}
                个动作 · 自由调整
              </p>
            </div>
            <Plus size={22} />
          </button>
        ))}
      </div>
      {drafts.length > 0 && (
        <Section title="继续训练">
          <div className="session-list">
            {drafts.map((s) => (
              <button
                className="session-row"
                key={s.id}
                onClick={() => open(s)}
              >
                <b>{names[s.kind]}</b>
                <span>{fmt(s.date)} · 草稿</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </Section>
      )}
      {candidates.length > 0 && (
        <details className="panel">
          <summary>检查 {candidates.length} 份空白草稿</summary>
          <p className="muted">
            仅列出没有实际重量、次数、时长、备注、器械设置或质量标记的草稿。清理前下载完整备份。
          </p>
          <button
            className="text-button"
            onClick={() => setCleanup(candidates)}
          >
            预览安全清理
          </button>
        </details>
      )}
      {cleanup && (
        <Modal title="空白草稿清理预览" onClose={() => setCleanup(null)}>
          <p>以下 {cleanup.length} 份草稿无有效训练输入；不会合并训练。</p>
          {cleanupError && <p role="alert">{cleanupError}</p>}
          {cleanup.map((s) => (
            <div className="history-line" key={s.id}>
              {fmt(s.date)} · {s.kind}
              <small>
                创建 {s.createdAt} · 更新 {s.updatedAt}
              </small>
            </div>
          ))}
          <button
            className="secondary"
            disabled={cleaning}
            onClick={async () => {
              setCleaning(true);
              setCleanupError("");
              try {
                download(
                  `Fitness-OS-清理前-${localDate()}.json`,
                  JSON.stringify(await makeBackup(db), null, 2),
                );
                if (!confirm("请确认完整备份已下载。清理预览中的空白草稿？"))
                  return;
                await cleanEmptyDrafts(
                  db,
                  cleanup.map((s) => s.id),
                );
                setCleanup(null);
              } catch (e) {
                setCleanupError("清理未完成：" + errorText(e));
              } finally {
                setCleaning(false);
              }
            }}
          >
            备份并确认清理
          </button>
        </Modal>
      )}
      <Section title="训练历史" eyebrow="YOUR TRAINING JOURNAL">
        <div className="session-list">
          {sessions.length ? (
            sessions.slice(0, visibleCount).map((s) => (
              <button
                className="session-row"
                key={s.id}
                onClick={() => open(s)}
              >
                <span className={"type-icon " + s.kind}>{s.kind}</span>
                <span className="session-info">
                  <b>
                    {names[s.kind]}训练{" "}
                    <Badge green={s.status === "completed"}>
                      {s.status === "draft"
                        ? "草稿"
                        : s.status === "completed"
                          ? "已完成"
                          : "未完成"}
                    </Badge>
                  </b>
                  <small>
                    {fmt(s.date)} ·{" "}
                    {s.duration !== null ? `${s.duration} 分钟 · ` : ""}
                    {s.items.length} 个动作
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))
          ) : (
            <Empty title="还没有训练记录">
              选一个训练类型，从真实的第一组开始。
            </Empty>
          )}
        </div>
        {sessions.length > visibleCount && (
          <button
            className="secondary"
            onClick={() => setVisibleCount((n) => n + 30)}
          >
            查看更多训练
          </button>
        )}
      </Section>
    </>
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
  const [exercises, setExercises] = useState(() =>
    structuredClone(data.exercises),
  );
  const [kind, setKind] = useState<Kind>("A");
  const [extra, setExtra] = useState("");
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = plans.find((p) => p.kind === kind)!;
  function patch(patch: Partial<Plan>) {
    setChanged(true);
    setPlans(
      plans.map((x) =>
        x.id === p.id
          ? { ...x, ...patch, updatedAt: new Date().toISOString() }
          : x,
      ),
    );
  }
  function item(id: string, patch: Partial<Plan["items"][number]>) {
    patchPlan(
      p.items.map((i) => (i.exerciseId === id ? { ...i, ...patch } : i)),
    );
  }
  function patchPlan(items: Plan["items"]) {
    patch({ items });
  }
  function exPatch(id: string, patch: Partial<Exercise>) {
    setChanged(true);
    setExercises(
      exercises.map((e) =>
        e.id === id
          ? { ...e, ...patch, updatedAt: new Date().toISOString() }
          : e,
      ),
    );
  }
  async function save() {
    if (busy) return;
    for (const e of exercises)
      if (!e.name.trim()) {
        notify("动作名称不能为空");
        return;
      }
    for (const p of plans) {
      if (!p.name.trim()) {
        notify("计划名称不能为空");
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
          notify("请检查组数1–30、次数1–1000及上下限");
          return;
        }
    }
    setBusy(true);
    try {
      await db.transaction("rw", [db.exercises, db.workoutPlans], async () => {
        await db.exercises.bulkPut(exercises);
        await db.workoutPlans.bulkPut(plans);
      });
      notify("计划已保存，历史成绩保持原样");
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
        if (!changed || confirm("放弃尚未保存的计划修改？")) close();
      }}
    >
      <details className="help">
        <summary>计划修改说明</summary>
        <p>仅用于新训练，历史及已有草稿保持原样。</p>
      </details>
      <div className="segmented">
        {(["A", "B", "C"] as const).map((k) => (
          <button
            className={kind === k ? "selected" : ""}
            key={k}
            onClick={() => setKind(k)}
          >
            {k} · {names[k]}
          </button>
        ))}
      </div>
      <div className="form-grid plan-meta">
        <details className="plan-name">
          <summary>{p.name} · 编辑名称</summary>
          <label>
            计划名称
            <input
              maxLength={160}
              value={p.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
        </details>
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
          <details className="plan-item" key={i.exerciseId}>
            <summary>
              <b>{e.name}</b>
              <span>
                {i.sets} 组 × {i.min}–{i.max} 次
              </span>
            </summary>
            <div className="row-between">
              <h3>{e.name}</h3>
              <button
                className="icon-button danger"
                aria-label={"从计划移除" + e.name}
                onClick={() =>
                  patchPlan(
                    p.items.filter((x) => x.exerciseId !== i.exerciseId),
                  )
                }
              >
                <X size={17} />
              </button>
            </div>
            <div className="form-grid three">
              <label>
                目标组数
                <input
                  aria-label={e.name + "目标组数"}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="30"
                  value={i.sets || ""}
                  onChange={(e) =>
                    item(i.exerciseId, { sets: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                次数下限
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  value={i.min || ""}
                  onChange={(e) =>
                    item(i.exerciseId, { min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                次数上限
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  value={i.max || ""}
                  onChange={(e) =>
                    item(i.exerciseId, { max: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </details>
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
            .filter(
              (e) => e.active && !p.items.some((i) => i.exerciseId === e.id),
            )
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
            patchPlan([
              ...p.items,
              { exerciseId: extra, sets: 3, min: 8, max: 12 },
            ]);
            setExtra("");
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
            {e.name || "新动作"}
            <Badge>{e.active ? "启用" : "停用"}</Badge>
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
            {
              ...stamp(),
              name: "新动作",
              muscle: "",
              equipment: "",
              technique: "",
              active: true,
            },
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
        <b>{label}</b>
        <span>
          {[...points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
            ?.value ?? "—"}{" "}
          {unit}
        </span>
        <small>至少两个可比数据点显示趋势</small>
      </div>
    );
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const min = Math.min(...sorted.map((p) => p.value)),
    max = Math.max(...sorted.map((p) => p.value));
  const start = new Date(sorted[0].date + "T12:00:00").getTime(),
    end = new Date(sorted.at(-1)!.date + "T12:00:00").getTime();
  const coords = sorted.map((p) => ({
    x:
      18 +
      ((new Date(p.date + "T12:00:00").getTime() - start) /
        (end - start || 1)) *
        464,
    y: 130 - ((p.value - min) / (max - min || 1)) * 100,
  }));
  return (
    <figure className="chart">
      <div className="chart-summary">
        <span>{label}</span>
        <b>
          {sorted
            .at(-1)!
            .value.toLocaleString("zh-CN", { maximumFractionDigits: 10 })}{" "}
          <small>{unit}</small>
        </b>
      </div>
      <svg
        role="img"
        aria-label={`${label}，${sorted.map((p) => p.date + " " + p.value + unit).join("，")}`}
        viewBox="0 0 500 160"
      >
        <path d="M18 30H482M18 80H482M18 130H482" className="grid-line" />
        <polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(" ")}
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
  const [range, setRange] = useState<"4" | "12" | "all">("12");
  const from =
    range === "all" ? "" : shiftDate(localDate(), -(Number(range) * 7 - 1));
  const trendData = {
    ...data,
    workoutSessions: data.workoutSessions.filter(
      (s) => !from || s.date >= from,
    ),
    bodyMetrics: data.bodyMetrics.filter((b) => !from || b.date >= from),
  };
  const [historyLimit, setHistoryLimit] = useState(30);
  const [exerciseId, setExerciseId] = useState(data.exercises[0]?.id ?? "");
  const [equipment, setEquipment] = useState("");
  const [technique, setTechnique] = useState("");
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [bodyForm, setBodyForm] = useState(false);
  const [editingBody, setEditingBody] = useState<BodyMetric | undefined>();
  const [goalForm, setGoalForm] = useState<Goal | null>(null);
  const [filterDay, setFilterDay] = useState("");
  const all = records(trendData, exerciseId);
  const equipmentOptions = [
    ...new Set(all.map((r) => r.item.equipment).filter(Boolean)),
  ];
  const currentEquipment = equipment || equipmentOptions[0] || "";
  const techniques = [
    ...new Set(
      all
        .filter((r) => r.item.equipment === currentEquipment)
        .map((r) => r.item.technique)
        .filter(Boolean),
    ),
  ];
  const currentTechnique = technique || techniques[0] || "";
  const comparableRecords = records(
    trendData,
    exerciseId,
    currentEquipment,
    currentTechnique,
  );
  const p = progress(trendData, exerciseId, currentEquipment, currentTechnique);
  const latest = comparableRecords[0];
  const e = data.exercises.find((e) => e.id === exerciseId);
  const ended = trendData.workoutSessions.filter((s) => s.status !== "draft");
  const endedIds = new Set(ended.map((w) => w.id));
  const metric = totals(
    data.workoutSets.filter((s) => endedIds.has(s.sessionId)),
  );
  const first = month + "-01";
  const cells = Array.from(
    {
      length: new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)),
        0,
      ).getDate(),
    },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  const offset = (new Date(first + "T12:00:00").getDay() + 6) % 7;
  const weeks = weeklyCounts(data.workoutSessions);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SMALL STEPS, REAL PROGRESS</span>
          <h1>进步趋势</h1>
        </div>
        <button className="secondary compact" onClick={() => setBodyForm(true)}>
          <Plus size={17} />
          记录身体指标
        </button>
      </div>
      <div className="segmented range-filter" aria-label="趋势时间范围">
        {(["4", "12", "all"] as const).map((r) => (
          <button
            key={r}
            className={range === r ? "selected" : ""}
            aria-pressed={range === r}
            onClick={() => {
              setRange(r);
              setHistoryLimit(30);
            }}
          >
            {r === "all" ? "全部历史" : `最近 ${r} 周`}
          </button>
        ))}
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
      <details className="help">
        <summary>指标口径</summary>
        已结束训练包括完成和未完成的有效实际组，草稿排除。训练量不等同于肌肉增长。
      </details>
      <div className="two-columns calendar-section">
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
                  const d = new Date(first + "T12:00:00");
                  d.setMonth(d.getMonth() + 1);
                  setMonth(localDate(d).slice(0, 7));
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="calendar-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((x) => (
              <span className="weekday" key={x}>
                {x}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"blank" + i} />
            ))}
            {cells.map((d) => {
              const sessions = data.workoutSessions.filter((s) => s.date === d);
              return (
                <button
                  key={d}
                  aria-label={
                    d +
                    " " +
                    (sessions.some((s) => s.status === "completed")
                      ? "有已完成训练"
                      : sessions.some((s) => s.status === "incomplete")
                        ? "有未完成训练"
                        : "无已完成训练")
                  }
                  className={
                    (d === localDate() ? "today " : "") +
                    (d === filterDay ? "selected " : "") +
                    (sessions.some((s) => s.status === "completed")
                      ? "trained"
                      : "")
                  }
                  onClick={() => setFilterDay(d === filterDay ? "" : d)}
                >
                  {Number(d.slice(-2))}
                  <i
                    className={
                      sessions.some((s) => s.status === "incomplete")
                        ? "incomplete-dot"
                        : ""
                    }
                  />
                </button>
              );
            })}
          </div>
          <small className="muted">
            绿色：有已完成训练 · 橙点：有未完成训练
          </small>
          {filterDay && (
            <div className="day-detail">
              <b>{fmt(filterDay)}</b>
              {data.workoutSessions
                .filter((s) => s.date === filterDay)
                .map((s) => (
                  <p key={s.id}>
                    {names[s.kind]} ·{" "}
                    {s.status === "completed"
                      ? "已完成"
                      : s.status === "draft"
                        ? "草稿"
                        : "未完成"}{" "}
                    ·{" "}
                    {
                      totals(
                        data.workoutSets.filter((x) => x.sessionId === s.id),
                      ).sets
                    }
                    组
                  </p>
                ))}
              {!data.workoutSessions.some((s) => s.date === filterDay) && (
                <p>这一天没有记录</p>
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>每周训练次数</h2>
          <p className="muted">自然周，周一开始；仅计已完成训练</p>
          {weeks.some((w) => w.count > 0) && (
            <p className="muted">最近 8 周 · 左右滑动查看</p>
          )}
          {weeks.some((w) => w.count > 0) ? (
            <div
              className="weekly-chart-scroll"
              tabIndex={0}
              role="region"
              aria-label="最近八周训练次数，可横向滚动"
            >
              <div className="bar-chart">
                {weeks.map((w) => (
                  <div key={w.from}>
                    <div className="weekly-bar-track">
                      <b>{w.count}</b>
                      <span
                        style={{
                          height:
                            Math.max(
                              4,
                              (w.count /
                                Math.max(1, ...weeks.map((x) => x.count))) *
                                130,
                            ) + "px",
                        }}
                      />
                    </div>
                    <small>{w.from.slice(5).replace("-", "/")}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="weekly-empty">
              <strong>暂无已完成训练</strong>
              <p className="muted">
                完成第一次训练后，这里会显示每周训练趋势。
              </p>
            </div>
          )}
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
                  status: "pending",
                  source: "manual",
                  reason: "本人制定，等待确认",
                });
            }}
          >
            <Plus size={16} />
            制定下次目标
          </button>
        }
      >
        <div className="panel">
          <div className="form-grid three strength-filters">
            <label>
              器械动作
              <select
                value={exerciseId}
                onChange={(x) => {
                  setExerciseId(x.target.value);
                  setEquipment("");
                  setTechnique("");
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
                  setTechnique("");
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
              <select
                value={currentTechnique}
                onChange={(x) => setTechnique(x.target.value)}
              >
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
          <details className="help">
            <summary>比较口径</summary>
            仅比较同器械、同方式；图表显示最高实际组重量，重量变化不自动代表进步，需核对组数和次数。
          </details>
          {currentEquipment && currentTechnique ? (
            <Sparkline
              label="每次最高实际组重量"
              unit="kg"
              points={comparableRecords
                .filter((r) => r.sets.some(validSet))
                .map((r) => ({
                  date: r.session.date,
                  value: Math.max(
                    ...r.sets.filter(validSet).map((s) => s.weight!),
                  ),
                }))}
            />
          ) : (
            <Empty title="暂无足够数据">请先填写器械标识和动作方式。</Empty>
          )}
          {latest && (
            <div className="reference">
              <span>下次训练建议 · 待本人确认</span>
              <b>
                {latest
                  ? suggestion(data, latest.item)
                  : "先建立真实基线，不预设重量。"}
              </b>
            </div>
          )}
          <h3 className="subheading">历史实际成绩</h3>
          {comparableRecords.length ? (
            comparableRecords.slice(0, historyLimit).map((r) => (
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
            <p className="muted">未填写条件的记录不用于力量比较。</p>
          )}
          {comparableRecords.length > historyLimit && (
            <button
              className="secondary"
              onClick={() => setHistoryLimit((n) => n + 30)}
            >
              查看更多历史
            </button>
          )}
          {latest && (
            <details className="best-groups">
              <summary>最佳组表现候选（按相同重量比较次数）</summary>
              {[
                ...new Set(
                  comparableRecords.flatMap((r) =>
                    r.sets.filter(validSet).map((s) => s.weight!),
                  ),
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
                      {weight}kg × {best.reps}次{" "}
                      <small>{fmt(best.date)}，需核对动作质量</small>
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
                    <h3>
                      {data.exercises.find((e) => e.id === g.exerciseId)?.name}
                    </h3>
                    <Badge green={g.status === "confirmed"}>
                      {g.status === "pending"
                        ? "待确认"
                        : g.status === "confirmed"
                          ? "已确认"
                          : "已归档"}
                    </Badge>
                  </div>
                  <p>
                    {g.equipment || "器械未填写"} ·{" "}
                    {g.technique || "动作方式未填写"}
                  </p>
                  <strong>
                    {g.weight ?? "待定"}{" "}
                    <small>
                      kg · {g.sets}组 × {g.min}–{g.max}次
                    </small>
                  </strong>
                  <p>{g.reason}</p>
                  <small className="muted">
                    {g.source === "ai" ? "AI 建议，需本人核验" : "本人制定"} ·{" "}
                    {fmt(g.updatedAt.slice(0, 10))}
                  </small>
                  <div className="button-row">
                    {g.status === "pending" && (
                      <button
                        className="primary compact"
                        onClick={async () => {
                          if (!g.equipment.trim() || !g.technique.trim()) {
                            notify("请先编辑器械标识与动作方式");
                            return;
                          }
                          if (
                            !confirm(
                              "已核对依据、器械实际档位与动作条件，确认将该目标用于下一次训练？",
                            )
                          )
                            return;
                          try {
                            await db.transaction(
                              "rw",
                              db.trainingGoals,
                              async () => {
                                const old = await db.trainingGoals
                                  .where("exerciseId")
                                  .equals(g.exerciseId)
                                  .toArray();
                                for (const x of old)
                                  if (
                                    x.status === "confirmed" &&
                                    x.equipment === g.equipment &&
                                    x.technique === g.technique
                                  )
                                    await db.trainingGoals.update(x.id, {
                                      status: "completed",
                                      updatedAt: new Date().toISOString(),
                                    });
                                await db.trainingGoals.update(g.id, {
                                  status: "confirmed",
                                  updatedAt: new Date().toISOString(),
                                });
                              },
                            );
                            notify("目标已确认，历史实际成绩保持原样");
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
                      onClick={() =>
                        setGoalForm({ ...g, ...stamp(), status: "pending" })
                      }
                    >
                      调整为新版本
                    </button>
                  </div>
                </article>
              ))}
          </div>
        ) : (
          <Empty title="你的目标，等待你确认">
            建议不会自动生效。先选择动作，再制定下次目标。
          </Empty>
        )}
      </Section>
      <Section title="身体变化" eyebrow="LOOK AT THE LONGER TERM">
        <div className="body-summary">
          {(["weight", "waist"] as const).map((key) => {
            const unit = key === "weight" ? "kg" : "cm";
            const label = key === "weight" ? "体重记录" : "腰围记录";
            const latestMetric = [...data.bodyMetrics]
              .filter((b) => b[key] !== null)
              .sort(
                (a, b) =>
                  b.date.localeCompare(a.date) ||
                  b.updatedAt.localeCompare(a.updatedAt),
              )[0];
            return (
              <div className="panel" key={key}>
                <small>{label}</small>
                <strong>
                  {latestMetric?.[key] ?? "—"} <small>{unit}</small>
                </strong>
                <small>
                  {latestMetric ? fmt(latestMetric.date) : "尚未记录"}
                </small>
              </div>
            );
          })}
        </div>
        <div className="body-trends">
          {(["weight", "waist"] as const).map((key) => {
            const points = trendData.bodyMetrics
              .filter((b) => b[key] !== null)
              .map((b) => ({ date: b.date, value: b[key]! }));
            return points.length >= 2 ? (
              <div className="panel" key={key}>
                <Sparkline
                  label={key === "weight" ? "体重记录" : "腰围记录"}
                  unit={key === "weight" ? "kg" : "cm"}
                  points={points}
                />
              </div>
            ) : (
              <p className="muted" key={key}>
                {key === "weight" ? "体重" : "腰围"} · {points.length}{" "}
                个记录点，至少两个点显示趋势
              </p>
            );
          })}
        </div>
        <details className="help">
          <summary>测量说明</summary>
          体重与腰围分别比较；单日波动不等于脂肪增减。
        </details>
        <details className="panel">
          <summary>查看身体指标明细</summary>
          {[...trendData.bodyMetrics]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((b) => (
              <div className="history-line" key={b.id}>
                <b>{fmt(b.date)}</b>
                <span>
                  {b.weight ?? "—"}kg · {b.waist ?? "—"}cm
                  <small>{b.notes}</small>
                </span>
                <button
                  className="text-button"
                  aria-label={"编辑身体指标" + b.date}
                  onClick={() => {
                    setEditingBody(b);
                    setBodyForm(true);
                  }}
                >
                  编辑
                </button>
                <button
                  className="icon-button danger"
                  aria-label={"删除身体指标" + b.date}
                  onClick={async () => {
                    if (confirm("删除这条身体指标？"))
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
      {bodyForm && (
        <BodyForm
          db={db}
          metric={editingBody}
          close={() => {
            setBodyForm(false);
            setEditingBody(undefined);
          }}
          notify={notify}
        />
      )}{" "}
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
  metric,
  close,
  notify,
}: {
  db: FitnessDB;
  metric?: BodyMetric;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [date, setDate] = useState(metric?.date ?? localDate());
  const [weight, setWeight] = useState(String(metric?.weight ?? ""));
  const [waist, setWaist] = useState(String(metric?.waist ?? ""));
  const [notes, setNotes] = useState(metric?.notes ?? "");
  return (
    <Modal title="记录身体指标" onClose={close}>
      <form
        className="body-metric-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!weight && !waist) {
            notify("至少填写体重或腰围");
            return;
          }
          try {
            await db.bodyMetrics.put({
              ...(metric ?? stamp()),
              updatedAt: new Date().toISOString(),
              date,
              weight: num(weight),
              waist: num(waist),
              notes,
            });
            notify("身体指标已保存");
            close();
          } catch (e) {
            notify(errorText(e));
          }
        }}
      >
        <div className="body-metric-grid">
          <label className="metric-date">
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
          测量条件或备注（选填）
          <textarea
            rows={2}
            maxLength={20000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例如 晨起、同一软尺"
          />
        </label>
        <p className="muted">
          尽量保持测量条件一致，观察多次记录，不判断单日脂肪变化。
        </p>
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
  const [advanced, setAdvanced] = useState(false);
  const patch = (p: Partial<Goal>) => setG({ ...g, ...p });
  return (
    <Modal title="制定待确认目标" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!g.equipment.trim() || !g.technique.trim() || !g.reason.trim()) {
            setAdvanced(true);
            notify("请在高级选项补充器械、动作方式和制定依据");
            return;
          }
          if (g.max < g.min) {
            notify("次数上限不能小于下限");
            return;
          }
          try {
            await db.trainingGoals.add({
              ...g,
              status: "pending",
              updatedAt: new Date().toISOString(),
            });
            notify("建议已存为待确认，尚未成为正式目标");
            close();
          } catch (e) {
            notify(errorText(e));
          }
        }}
      >
        <div className="form-grid goal-fields">
          <label>
            动作
            <select
              value={g.exerciseId}
              onChange={(e) => patch({ exerciseId: e.target.value })}
            >
              {data.exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标重量 kg（可留空）
            <input
              inputMode="decimal"
              type="number"
              min="0"
              max="2000"
              step="0.5"
              value={g.weight ?? ""}
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
        <details
          className="advanced-options"
          open={advanced}
          onToggle={(e) => setAdvanced(e.currentTarget.open)}
        >
          <summary>高级选项</summary>
          <div className="form-grid">
            {" "}
            <label>
              建议来源
              <select
                value={g.source}
                onChange={(e) =>
                  patch({ source: e.target.value as Goal["source"] })
                }
              >
                <option value="manual">本人制定</option>
                <option value="ai">ChatGPT 建议（待核验）</option>
              </select>
            </label>
            <label>
              器械标识
              <input
                maxLength={160}

                value={g.equipment}
                onChange={(e) => patch({ equipment: e.target.value })}
              />
            </label>
            <label>
              动作方式
              <input
                maxLength={500}

                value={g.technique}
                onChange={(e) => patch({ technique: e.target.value })}
              />
            </label>
          </div>{" "}
          <label>
            制定依据
            <textarea
              maxLength={20000}
              value={g.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              placeholder="引用上次实际组，说明动作质量、余力及器械可用档位"
            />
          </label>
        </details>
        <p className="muted">
          保存后仍为待确认。不会改写实际成绩，不自动假定器械配重档位。
        </p>
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
  notify,
}: {
  data: Dataset;
  db: FitnessDB;
  notify: (s: string) => void;
}) {
  const overview = data.exercises
    .filter((e) => e.active)
    .map((e) => {
      const config = rememberedExercise(data, e);
      const latest = lastRecord(data, e.id, config.equipment, config.technique);
      return {
        name: e.name,
        latest,
        change: progress(data, e.id, config.equipment, config.technique),
      };
    })
    .filter((x) => x.latest)
    .slice(0, 3);
  const issues = overview.map((x) => x.change.warning).filter(Boolean);
  const [text, setText] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [week, setWeek] = useState(weekStart(localDate()));
  const [copyFallback, setCopyFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  function exportPackage(markdown: boolean) {
    try {
      const p = packageAnalysis(data, "real");
      download(
        `Fitness-OS-分析-${localDate()}.${markdown ? "md" : "json"}`,
        markdown ? analysisMarkdown(p) : JSON.stringify(p, null, 2),
        markdown ? "text/markdown" : "application/json",
      );
      notify("分析数据包已生成，请自行选择是否发给 ChatGPT");
    } catch (e) {
      notify(errorText(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REFLECT. ADJUST. REPEAT.</span>
          <h1>AI 周报</h1>
        </div>
      </div>
      <section className="weekly-overview panel">
        <h2>本周训练概况</h2>
        <p className="weekly-number">
          {weekCompleted(data)}
          <small>次已完成</small>
        </p>
        <p className="muted">
          本周有效组数{" "}
          {
            totals(
              data.workoutSets.filter((s) =>
                data.workoutSessions.some(
                  (w) =>
                    w.id === s.sessionId &&
                    w.status === "completed" &&
                    w.date >= weekStart(localDate()) &&
                    w.date <= localDate(),
                ),
              ),
            ).sets
          }{" "}
          组
        </p>
        <details className="help">
          <summary>统计说明</summary>
          本地规则汇总；力量比较使用最近可比记录，不限定本周，并非 AI 结论。
        </details>
        <div
          className={"weekly-groups " + (!overview.length ? "no-history" : "")}
        >
          <div>
            <h3>力量变化</h3>
            {overview.length ? (
              overview.map((x) => (
                <p key={x.name}>
                  {x.name} · {x.change.label}
                </p>
              ))
            ) : (
              <p>暂无足够数据，先建立真实训练基线。</p>
            )}
          </div>
          <div>
            <h3>主要问题</h3>
            <p>
              {issues.length
                ? issues.join(" ")
                : "暂无足够依据判断停滞；请结合疲劳与恢复情况复盘。"}
            </p>
          </div>
          <div>
            <h3>下周建议</h3>
            <p>
              {overview[0]?.latest
                ? suggestion(data, overview[0].latest.item)
                : "先记录实际成绩，再形成有依据的建议。"}
            </p>
          </div>
          <div>
            <h3>下次目标</h3>
            <p>
              {
                data.trainingGoals.filter((g) => g.status === "confirmed")
                  .length
              }{" "}
              个已确认目标；新建议需在趋势页由你确认。
            </p>
          </div>
        </div>
      </section>
      <section className="panel ai-hero">
        <span className="brand-icon">
          <Sparkles />
        </span>
        <h2>导出给 ChatGPT</h2>
        <p>导出本地记录 → 交给 ChatGPT → 保存你认可的建议。</p>
        <div className="button-row">
          <button
            className="primary"

            onClick={() => exportPackage(false)}
          >
            <ArrowDownToLine size={18} />
            导出分析 JSON
          </button>
          <button
            className="secondary"

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
                notify("ChatGPT 分析提示词已复制");
              } catch {
                setCopyFallback(true);
              }
            }}
          >
            <Clipboard size={18} />
            复制 ChatGPT 分析提示词
          </button>
        </div>
        <details>
          <summary>数据包包含什么？</summary>
          <p>
            最近7天训练、最近28天历史及逐组成绩、当前计划、身体指标、已确认和待确认目标、缺失信息提示。7天与28天窗口有重叠，提示词要求避免重复计数。
          </p>
        </details>
        {copyFallback && (
          <label>
            当前浏览器无法自动复制，请长按选择以下文本
            <textarea
              readOnly
              value={aiPrompt}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
      </section>
      <Section title="保存 AI 分析" eyebrow="A NOTE TO YOUR FUTURE SELF">
        <form
          className="panel ai-page-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || busy) return;
            setBusy(true);
            try {
              if (reportId)
                await db.weeklyReports.update(reportId, {
                  week,
                  text,
                  updatedAt: new Date().toISOString(),
                });
              else await db.weeklyReports.add({ ...stamp(), week, text });
              setReportId(null);
              setText("");
              notify("周报已保存，训练目标仍需在趋势页单独确认");
            } catch (e) {
              notify(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            周报对应日期
            <input
              type="date"
              required
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            />
          </label>
          <label>
            分析结论或个人复盘
            <textarea
              required
              maxLength={20000}
              rows={3}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              }}
              placeholder="粘贴 ChatGPT 分析，或写下本周训练、恢复与下周打算…"
            />
          </label>
          <p className="muted">
            AI 建议不会自动成为目标。请在「趋势 →
            制定下次目标」录入、核验器械档位，并本人确认。
          </p>
          <button
            className="primary"
            disabled={busy || !text.trim()}
            type="submit"
          >
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
                  {fmt(r.week)} · 周报 <Badge>本人保存</Badge>
                </summary>
                <div className="report-text">{r.text}</div>
                <button
                  className="text-button"
                  onClick={() => {
                    setReportId(r.id);
                    setWeek(r.week);
                    setText(r.text);
                    document
                      .querySelector(".ai-page-form")
                      ?.scrollIntoView({ block: "start" });
                  }}
                >
                  编辑周报
                </button>
                <button
                  className="text-button danger"
                  onClick={async () => {
                    if (confirm("删除这份周报？"))
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
          <Empty title="还没有周报">
            先记录，再分析。数据不够时，也可以写下感受。
          </Empty>
        )}
      </Section>
    </>
  );
}
const tableLabels: Record<string, string> = {
  exercises: "动作",
  workoutPlans: "计划",
  workoutSessions: "训练",
  workoutSets: "实际组",
  bodyMetrics: "身体指标",
  trainingGoals: "目标",
  weeklyReports: "周报",
  settings: "设置",
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
  notify,
  offlineReady,
  onPlans,
}: {
  data: Dataset;
  db: FitnessDB;
  notify: (s: string) => void;
  offlineReady: boolean;
  onPlans: () => void;
}) {
  const prefs = data.settings[0];
  const [bodyForm, setBodyForm] = useState(false);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [confirmation, setConfirmation] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const [storage, setStorage] = useState("");
  async function preference(p: Partial<Settings>) {
    try {
      await db.settings.update(prefs.id, {
        ...p,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      notify(errorText(e));
    }
  }
  async function buildPreview(value: string, m: "merge" | "replace") {
    setPreview(null);
    setDownloaded(false);
    setConfirmation("");
    setResult("");
    setErr("");
    if (!value) return;
    try {
      const p = await previewRestore(db, value, m);
      download(
        `Fitness-OS-导入前备份-${Date.now()}.json`,
        JSON.stringify(p.before, null, 2),
      );
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
          <h1>数据管理</h1>
        </div>
      </div>
      <div className="settings-shortcuts panel">
        <button onClick={onPlans}>
          <Dumbbell size={20} />
          计划与动作
          <ChevronRight size={18} />
        </button>
        <button onClick={() => setBodyForm(true)}>
          <Activity size={20} />
          记录身体指标
          <ChevronRight size={18} />
        </button>
      </div>
      {bodyForm && (
        <BodyForm db={db} close={() => setBodyForm(false)} notify={notify} />
      )}
      <div className="two-columns settings-preferences">
        <section className="panel">
          <h2>训练节奏</h2>
          <label>
            90天周期开始日期
            <input
              type="date"
              required
              value={prefs.cycleStart}
              onChange={(e) => {
                if (e.target.value)
                  void preference({ cycleStart: e.target.value });
              }}
            />
          </label>
          <label>
            本自然周计划训练次数
            <select
              value={prefs.weeklyPlanned ?? ""}
              onChange={(e) =>
                void preference({ weeklyPlanned: num(e.target.value) })
              }
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
              value={prefs.cycleTargetSessions ?? ""}
              onChange={(e) =>
                void preference({ cycleTargetSessions: num(e.target.value) })
              }
            >
              <option value="">暂未设置</option>
              {Array.from({ length: 180 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} 次
                </option>
              ))}
            </select>
          </label>
          <small className="muted">
            仅用于本周完成率。可随恢复调整，不强制 C 训练。
          </small>
        </section>
        <section className="panel">
          <h2>外观</h2>
          <label>
            显示模式
            <select
              value={prefs.theme}
              onChange={(e) =>
                void preference({ theme: e.target.value as Settings["theme"] })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </section>
      </div>
      <Section title="备份与恢复" eyebrow="KEEP A COPY, KEEP YOUR PROGRESS">
        <section className="panel">
          <div className="inline-note warning">
            <ShieldCheck size={24} />
            <div>
              <b>本地保存，不代表永远不会丢失</b>
              <p>
                卸载
                PWA、清理网站数据、更换设备或浏览器存储回收可能导致数据丢失。iPhone
                和 Mac
                默认不自动同步。建议每周导出备份；正式使用前必须完成一次备份恢复测试。
              </p>
            </div>
          </div>
          <CountList data={data} />
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              try {
                integrity(await snapshot(db));
                notify("数据完整，关联已核对");
              } catch (e) {
                notify("数据完整性检查失败：" + errorText(e));
              }
            }}
          >
            检查数据完整性
          </button>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                try {
                  const backup = await makeBackup(db);
                  download(
                    `Fitness-OS-完整备份-${localDate()}.json`,
                    JSON.stringify(backup, null, 2),
                  );
                  await preference({ lastBackup: new Date().toISOString() });
                  notify(
                    "完整 JSON 已生成，请确认文件已保存在「文件」或下载目录",
                  );
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
            {prefs.lastBackup
              ? new Date(prefs.lastBackup).toLocaleString("zh-CN")
              : "尚未生成"}
            。点击下载不代表系统能核实你已保存文件。
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={prefs.restoreTested}
              onChange={(e) =>
                void preference({ restoreTested: e.target.checked })
              }
            />
            我已实际完成备份恢复，并核对训练与组数
          </label>
          <hr />
          <h3>从 JSON 恢复</h3>
          <p className="muted">
            先验证文件、预览数量，再恢复。默认保留所有现有
            ID；重复导入不会重复创建记录，同 ID 的不同内容保留当前版本。
          </p>
          <label>
            选择完整备份文件
            <input
              aria-label="选择备份文件"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPreview(null);
                setRaw("");
                setDownloaded(false);
                setErr("");
                setResult("");
                if (file.size > 20 * 1024 * 1024) {
                  setErr("文件超过20MB，未读取、未写入");
                  return;
                }
                try {
                  const value = await file.text();
                  setRaw(value);
                  await buildPreview(value, importMode);
                } catch (error) {
                  setErr("无法读取文件：" + errorText(error));
                }
              }}
            />
          </label>
          <label>
            恢复方式
            <select
              disabled={busy}
              value={importMode}
              onChange={async (e) => {
                const m = e.target.value as "merge" | "replace";
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
              <h3>
                导入预览 · {preview.mode === "merge" ? "合并保留" : "完整覆盖"}
              </h3>
              <p>
                文件导出于{" "}
                {new Date(preview.incoming.exportedAt).toLocaleString("zh-CN")}{" "}
                · 版本1 · 正式数据
              </p>
              <b>文件内记录</b>
              <CountList data={preview.incoming.data} />
              <b>恢复后的预计数量</b>
              <CountList data={preview.result} />
              <p>
                已验证全部关联。{preview.conflicts.length} 项同 ID 内容冲突，
                {preview.mode === "merge" ? "保留现有版本" : "覆盖现有内容"}。
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
              {preview.mode === "replace" && (
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
                  (preview.mode === "replace" &&
                    confirmation !== "覆盖当前数据")
                }
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  try {
                    const r = await restore(
                      db,
                      preview,
                      confirmation,
                      downloaded,
                    );
                    setResult(
                      "恢复成功；" +
                        Object.entries(r.counts)
                          .map(([k, v]) => tableLabels[k] + v)
                          .join("、") +
                        "。" +
                        r.relations,
                    );
                    setPreview(null);
                    setRaw("");
                    notify("恢复成功，数量与关联已核对");
                  } catch (e) {
                    setErr(errorText(e));
                    setPreview(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认{preview.mode === "merge" ? "合并恢复" : "覆盖全部正式数据"}
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
              {offlineReady ? "离线资源已准备好" : "首次打开后准备离线资源"}
            </Badge>
          </section>
          <section className="panel">
            <h3>设备存储</h3>
            <p className="muted">
              申请持久存储可降低自动回收的可能性，但不能代替备份。Safari
              可能不会授予此请求。
            </p>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const persisted = await navigator.storage?.persist?.();
                  const estimate = await navigator.storage?.estimate?.();
                  setStorage(
                    `${persisted ? "已获持久存储许可" : "未获持久存储许可 / 浏览器不支持"}；当前约 ${((estimate?.usage ?? 0) / 1024 / 1024).toFixed(2)} MB`,
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
              应用更新仅替换静态资源，不清空
              IndexedDB。没有远程健康数据服务、统计或广告。
            </small>
          </section>
        </div>
      </Section>
      <p className="version-info">Fitness OS · V1.2.1 · 数据版本 1</p>
    </>
  );
}
