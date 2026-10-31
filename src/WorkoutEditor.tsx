import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FitnessDB, createSession, deleteSession, saveSession } from "./db";
import { formatSets, records, totals } from "./analytics";
import {
  type Dataset,
  type Session,
  type SessionItem,
  type WorkoutSet,
  localDate,
  names,
  stamp,
  validSet,
} from "./model";

type Workout = { session: Session; sets: WorkoutSet[] };
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "保存失败，请重试";

// Keep the text being typed (including a trailing decimal point) independent of the numeric model.
function SetNumber({
  value,
  label,
  decimal,
  onChange,
  onError,
}: {
  value: number | null;
  label: string;
  decimal?: boolean;
  onChange: (value: number | null) => void;
  onError: (invalid: boolean) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      enterKeyHint="next"
      aria-label={label}
      aria-invalid={invalid}
      placeholder="—"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        const input = e.currentTarget;
        requestAnimationFrame(() =>
          input.scrollIntoView({ block: "nearest", behavior: "instant" }),
        );
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const normalized = raw.replace(",", ".");
        const n = Number(normalized);
        const bad =
          normalized !== "" &&
          (!(decimal ? /^\d+(?:\.\d*)?$/ : /^\d+$/).test(normalized) ||
            !Number.isFinite(n) ||
            (decimal ? n < 0 || n > 2000 : n < 1 || n > 1000));
        setInvalid(bad);
        onError(bad);
        if (!bad) onChange(normalized === "" ? null : n);
      }}
    />
  );
}

export default function WorkoutEditor({
  initial,
  data,
  db,
  onClose,
  onComplete,
  notify,
}: {
  initial: Workout;
  data: Dataset;
  db: FitnessDB;
  onClose: () => void;
  onComplete: (session: Session, sets: WorkoutSet[]) => void;
  notify: (text: string) => void;
}) {
  const [w, setW] = useState(initial);
  const latest = useRef(initial);
  const queue = useRef(Promise.resolve());
  const failed = useRef(false);
  const finishLock = useRef(false);
  const invalid = useRef(new Set<string>());
  const [numericError, setNumericError] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [savedAt, setSavedAt] = useState(initial.session.updatedAt);
  const [active, setActive] = useState(initial.session.items[0]?.id ?? "");
  const [extra, setExtra] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const editing = initial.session.status !== "draft";
  useEffect(() => {
    dialog.current?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.current?.style.setProperty(
        "--editor-height",
        `${viewport?.height ?? innerHeight}px`,
      );
      dialog.current?.style.setProperty(
        "--editor-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      document.body.style.overflow = old;
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending || error || numericError) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [pending, error, numericError]);
  function persist(next: Workout) {
    latest.current = next;
    setW(next);
    setPending((n) => n + 1);
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveSession(db, next.session, next.sets))
      .then(() => {
        failed.current = false;
        setError("");
        setSavedAt(next.session.updatedAt);
      })
      .catch((e) => {
        failed.current = true;
        setError(errorText(e) + "。当前输入仍在，请修正后重试。");
      })
      .finally(() => setPending((n) => n - 1));
  }
  function change(next: Workout) {
    if (finishLock.current) return;
    const now = new Date().toISOString();
    persist({
      session: { ...next.session, updatedAt: now },
      sets: next.sets.map((s) => ({ ...s, updatedAt: now })),
    });
  }
  function sessionPatch(p: Partial<Session>) {
    change({ ...latest.current, session: { ...latest.current.session, ...p } });
  }
  function itemPatch(id: string, p: Partial<SessionItem>) {
    sessionPatch({
      items: latest.current.session.items.map((i) =>
        i.id === id ? { ...i, ...p } : i,
      ),
    });
  }
  function setPatch(id: string, p: Partial<WorkoutSet>) {
    const v = latest.current;
    change({
      ...v,
      sets: v.sets.map((s) => (s.id === id ? { ...s, ...p } : s)),
    });
  }
  function numeric(key: string, bad: boolean) {
    if (bad) invalid.current.add(key);
    else invalid.current.delete(key);
    setNumericError(invalid.current.size > 0);
  }
  function clearErrors(ids: string[]) {
    for (const id of ids) {
      invalid.current.delete(id + ":weight");
      invalid.current.delete(id + ":reps");
    }
    setNumericError(invalid.current.size > 0);
  }
  async function close() {
    if (finishLock.current) return;
    if (invalid.current.size) {
      setError(
        "请先修正标红的数字，或清空该输入；未保存的输入不会被直接丢弃。",
      );
      return;
    }
    finishLock.current = true;
    setFinishing(true);
    await queue.current;
    if (failed.current) {
      finishLock.current = false;
      setFinishing(false);
      return;
    }
    onClose();
  }
  async function finish(status: "completed" | "incomplete") {
    if (finishLock.current) return;
    const v = latest.current;
    if (invalid.current.size) {
      setError("请修正标红的重量或次数。重量为0–2000kg，次数为1–1000整数。");
      return;
    }
    if (!v.session.date || v.session.date > localDate()) {
      setError("已结束训练的日期不能晚于今天。");
      return;
    }
    if (!v.sets.some(validSet)) {
      setError("至少填写一组重量和次数，空白组不会算作完成。");
      return;
    }
    if (v.sets.some((s) => (s.weight === null) !== (s.reps === null))) {
      setError("有未填写完整的组，请同时填写重量与次数，或清空这一组。");
      return;
    }
    finishLock.current = true;
    setFinishing(true);
    await queue.current;
    const done = { ...v.session, status, updatedAt: new Date().toISOString() };
    try {
      await saveSession(db, done, v.sets);
      notify(
        status === "completed"
          ? "训练已完成，趋势已更新"
          : "已保存为未完成，实际成绩已保留",
      );
      if (status === "completed") onComplete(done, v.sets);
      else onClose();
    } catch (e) {
      failed.current = true;
      setError(errorText(e));
      finishLock.current = false;
      setFinishing(false);
    }
  }
  async function remove() {
    if (
      finishLock.current ||
      !confirm("删除这次训练及其所有实际组？建议先导出备份。")
    )
      return;
    finishLock.current = true;
    setFinishing(true);
    await queue.current;
    try {
      await deleteSession(db, latest.current.session.id);
      onClose();
      notify("训练及关联组已删除");
    } catch (e) {
      setError(errorText(e));
      finishLock.current = false;
      setFinishing(false);
    }
  }
  const completedSets = totals(w.sets).sets;
  return (
    <dialog
      ref={dialog}
      className="modal workout-editor"
      aria-labelledby="workout-title"
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <header className="workout-header">
        <div>
          <span className="eyebrow">
            {editing ? "编辑实际成绩" : "本次训练 · 草稿"}
          </span>
          <h2 id="workout-title">
            {w.session.kind} · {names[w.session.kind]}
          </h2>
        </div>
        <button
          className="icon-button"
          disabled={finishing}
          aria-label="关闭训练记录"
          onClick={() => void close()}
        >
          <X />
        </button>
      </header>
      <div className="workout-content">
        <div className="save-state" role="status">
          {pending ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <ShieldCheck size={16} />
          )}
          {pending
            ? "正在保存到本地…"
            : error
              ? "输入需要检查"
              : `${editing ? "修改已保存" : "草稿已自动保存"} · ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`}
        </div>
        {(error || numericError) && (
          <div className="editor-error" role="alert">
            {error || "请检查标红的数字。重量支持小数，次数必须为正整数。"}
            {failed.current && (
              <button
                className="text-button"
                onClick={() => persist(latest.current)}
              >
                重试保存
              </button>
            )}
          </div>
        )}
        <fieldset className="fieldset-reset" disabled={finishing}>
          <div className="form-grid workout-meta">
            <label>
              训练类型
              <select
                value={w.session.kind}
                onChange={(e) => {
                  const kind = e.target.value as Session["kind"];
                  if (kind === w.session.kind) return;
                  if (
                    w.sets.some((s) => s.weight !== null || s.reps !== null) &&
                    !confirm(
                      "切换类型会重新载入该计划，替换本次动作和输入。继续？",
                    )
                  )
                    return;
                  const replacement = createSession(data, kind);
                  invalid.current.clear();
                  setNumericError(false);
                  setError("");
                  change({
                    session: {
                      ...w.session,
                      kind,
                      items: replacement.session.items,
                    },
                    sets: replacement.sets.map((s) => ({
                      ...s,
                      sessionId: w.session.id,
                    })),
                  });
                  setActive(replacement.session.items[0]?.id ?? "");
                }}
              >
                {(["A", "B", "C"] as const).map((k) => (
                  <option key={k} value={k}>
                    {k} · {names[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              训练日期
              <input
                type="date"
                required
                value={w.session.date}
                onChange={(e) => sessionPatch({ date: e.target.value })}
              />
            </label>
          </div>
          <div className="workout-progress">
            <span>本次实际成绩</span>
            <b>{completedSets} 组已填写</b>
          </div>
          {w.session.items.map((i, index) => {
            const sets = w.sets
              .filter((s) => s.itemId === i.id)
              .sort((a, b) => a.order - b.order);
            const last = records(
              data,
              i.exerciseId,
              i.equipment,
              i.technique,
            ).find((r) => r.session.id !== w.session.id);
            const goal = data.trainingGoals
              .filter(
                (g) =>
                  g.exerciseId === i.exerciseId &&
                  g.equipment === i.equipment &&
                  g.technique === i.technique &&
                  g.status === "confirmed",
              )
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            const expanded = active === i.id;
            const copyIndex = sets.findIndex(
              (set, n) =>
                n > 0 && set.weight === null && sets[n - 1].weight !== null,
            );
            const copyTo = copyIndex >= 0 ? copyIndex : sets.length - 1;
            const copyFrom = sets[copyTo - 1];
            return (
              <section
                className={"log-exercise " + (expanded ? "is-active" : "")}
                key={i.id}
              >
                <div className="log-exercise-heading">
                  <button
                    className="exercise-toggle"
                    aria-expanded={expanded}
                    aria-controls={"item-" + i.id}
                    onClick={() => setActive(expanded ? "" : i.id)}
                  >
                    <span className="exercise-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <b>{i.name}</b>
                      <small>
                        {totals(sets).sets}/{i.targetSets} 组已填写
                      </small>
                    </span>
                    <ChevronDown size={18} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={"移除动作 " + i.name}
                    onClick={() => {
                      if (
                        sets.some(
                          (s) => s.weight !== null || s.reps !== null,
                        ) &&
                        !confirm("移除这个动作及已填写的组？")
                      )
                        return;
                      const v = latest.current;
                      clearErrors(sets.map((s) => s.id));
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
                <div className="exercise-reference">
                  <p>
                    <span>上次</span>
                    <b>{last ? formatSets(last.sets) : "首次记录"}</b>
                  </p>
                  <p>
                    <span>目标</span>
                    <b>
                      {goal
                        ? `${goal.weight === null ? "重量待定" : goal.weight + "kg"} · ${goal.sets}组 × ${goal.min}–${goal.max}次`
                        : "尚无已确认目标"}
                    </b>
                  </p>
                </div>
                <div
                  id={"item-" + i.id}
                  hidden={!expanded}
                  className="exercise-body"
                >
                  {(!i.equipment || !i.technique) && (
                    <p className="comparison-hint">
                      器械或动作方式未填写，历史比较可信度有限。
                    </p>
                  )}
                  <div className="set-head">
                    <span>组</span>
                    <span>重量 kg</span>
                    <span>次数</span>
                    <span />
                  </div>
                  {sets.map((s, n) => (
                    <div className="set-row" key={s.id}>
                      <span>{n + 1}</span>
                      <SetNumber
                        label={`${i.name} 第${n + 1}组重量`}
                        decimal
                        value={s.weight}
                        onChange={(value) => setPatch(s.id, { weight: value })}
                        onError={(bad) => numeric(s.id + ":weight", bad)}
                      />
                      <SetNumber
                        label={`${i.name} 第${n + 1}组次数`}
                        value={s.reps}
                        onChange={(value) => setPatch(s.id, { reps: value })}
                        onError={(bad) => numeric(s.id + ":reps", bad)}
                      />
                      <button
                        className="icon-button"
                        aria-label={`移除${i.name}第${n + 1}组`}
                        onClick={() => {
                          if (
                            (s.weight !== null || s.reps !== null) &&
                            !confirm("移除这一组实际成绩？")
                          )
                            return;
                          const v = latest.current;
                          let order = 0;
                          clearErrors([s.id]);
                          change({
                            ...v,
                            sets: v.sets
                              .filter((x) => x.id !== s.id)
                              .map((x) =>
                                x.itemId === i.id
                                  ? { ...x, order: order++ }
                                  : x,
                              ),
                          });
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="set-tools">
                    <button
                      className="secondary compact"
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
                    <button
                      className="text-button"
                      disabled={sets.length < 2 || copyFrom?.weight == null}
                      onClick={() => {
                        const target = sets[copyTo];
                        if (
                          target.weight !== null &&
                          !confirm("用上一组重量替换这一组重量？次数保持不变。")
                        )
                          return;
                        numeric(target.id + ":weight", false);
                        setPatch(target.id, { weight: copyFrom.weight });
                      }}
                    >
                      <Copy size={15} />
                      复制上一组重量
                      <span className="copy-to">
                        至第{Math.max(2, copyTo + 1)}组
                      </span>
                    </button>
                  </div>
                  <details className="equipment-settings">
                    <summary>
                      <Settings2 size={16} />
                      器械与动作设置
                    </summary>
                    <p className="muted">
                      完成训练后，下次自动带出这套设置。修改设置后只比较相同条件。
                    </p>
                    <label>
                      器械标识
                      <input
                        maxLength={160}
                        placeholder="例如：胸推01，可稍后填写"
                        value={i.equipment}
                        onChange={(e) =>
                          itemPatch(i.id, { equipment: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      动作方式 / 座椅设置
                      <input
                        maxLength={500}
                        placeholder="例如：座椅2，固定动作幅度"
                        value={i.technique}
                        onChange={(e) =>
                          itemPatch(i.id, { technique: e.target.value })
                        }
                      />
                    </label>
                    <div className="quality-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={i.quality}
                          onChange={(e) =>
                            itemPatch(i.id, { quality: e.target.checked })
                          }
                        />
                        动作质量稳定
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={i.reserve}
                          onChange={(e) =>
                            itemPatch(i.id, { reserve: e.target.checked })
                          }
                        />
                        仍有适当余力
                      </label>
                    </div>
                    <small className="muted">
                      计划快照：{i.targetSets}组 × {i.min}–{i.max}
                      次；实际成绩独立保存。
                    </small>
                  </details>
                </div>
              </section>
            );
          })}
          <details className="workout-more">
            <summary>更多信息</summary>
            <div className="form-grid">
              <label>
                训练时长（分钟）
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1440"
                  value={w.session.duration ?? ""}
                  onChange={(e) =>
                    sessionPatch({
                      duration:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                主观疲劳
                <select
                  value={w.session.fatigue}
                  onChange={(e) => sessionPatch({ fatigue: e.target.value })}
                >
                  <option value="">待填写</option>
                  {["轻松", "适中", "较累", "非常累"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              训练感受
              <textarea
                maxLength={20000}
                value={w.session.notes}
                onChange={(e) => sessionPatch({ notes: e.target.value })}
                placeholder="恢复情况、动作感受…"
              />
            </label>
            <div className="add-exercise">
              <select
                aria-label="选择要添加的动作"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              >
                <option value="">选择额外动作</option>
                {data.exercises
                  .filter(
                    (e) =>
                      e.active &&
                      !w.session.items.some((i) => i.exerciseId === e.id),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
              <button
                className="secondary"
                disabled={!extra || w.session.items.length >= 30}
                onClick={() => {
                  const created = createSession(
                    {
                      ...data,
                      workoutPlans: [
                        {
                          ...data.workoutPlans[0],
                          kind: w.session.kind,
                          items: [
                            { exerciseId: extra, sets: 3, min: 8, max: 12 },
                          ],
                        },
                      ],
                    },
                    w.session.kind,
                  );
                  const item = created.session.items[0];
                  if (!item) return;
                  const v = latest.current;
                  change({
                    ...v,
                    session: {
                      ...v.session,
                      items: [...v.session.items, item],
                    },
                    sets: [
                      ...v.sets,
                      ...created.sets.map((s) => ({
                        ...s,
                        sessionId: v.session.id,
                      })),
                    ],
                  });
                  setExtra("");
                  setActive(item.id);
                }}
              >
                <Plus size={16} />
                添加动作
              </button>
            </div>
            <button
              className="text-button"
              disabled={finishing}
              onClick={() => void finish("incomplete")}
            >
              记为未完成
            </button>
            <button
              className="text-button danger delete-workout"
              disabled={finishing}
              onClick={() => void remove()}
            >
              删除训练
            </button>
          </details>
        </fieldset>
        <footer className="editor-actions">
          <button
            className="primary"
            disabled={finishing}
            onClick={() => void finish("completed")}
          >
            {finishing ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <Check size={18} />
            )}
            完成训练
          </button>
          <button
            className="secondary"
            disabled={finishing}
            onClick={() => void close()}
          >
            {editing ? "保存并关闭" : "保存并关闭"}
          </button>
          <p className="muted">
            <CheckCircle2 size={14} />
            空白组不计入成绩，关闭后可继续草稿。
          </p>
        </footer>
      </div>
    </dialog>
  );
}
