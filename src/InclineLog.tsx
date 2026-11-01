import { useRef, useState } from "react";
import { type Dataset, type InclineRecord, localDate, stamp } from "./model";
import { type FitnessDB } from "./db";
import { inclineDefaults, inclineWeek, validIncline } from "./incline";
export function InclineSummary({
  data,
  open,
}: {
  data: Dataset;
  open: () => void;
}) {
  const week = inclineWeek(data.inclineRecords);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>本周爬坡</h2>
        <button onClick={open}>记录爬坡</button>
      </div>
      <p>
        <strong>{week.minutes}</strong> 分钟 · {week.count} 次
      </p>
    </section>
  );
}
export function InclineLog({ data, db }: { data: Dataset; db: FitnessDB }) {
  const [editing, setEditing] = useState<InclineRecord | null>(null);
  const [form, setForm] = useState(() => ({
    ...inclineDefaults(data.inclineRecords),
    date: localDate(),
  }));
  const [values, setValues] = useState(() => ({
    minutes: String(form.minutes),
    incline: String(form.incline),
    speed: String(form.speed),
  }));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [limit, setLimit] = useState(20);
  const week = inclineWeek(data.inclineRecords);
  function reset() {
    setEditing(null);
    setForm({ ...inclineDefaults(data.inclineRecords), date: localDate() });
    const d = inclineDefaults(data.inclineRecords);
    setValues({
      minutes: String(d.minutes),
      incline: String(d.incline),
      speed: String(d.speed),
    });
  }
  return (
    <section className="panel incline-log" aria-label="跑步机爬坡">
      <h2>跑步机爬坡</h2>
      <p className="muted">
        本周 {week.minutes} 分钟 · {week.count} 次 · 周一开始
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const record = {
            ...(editing ?? stamp()),
            date: form.date,
            minutes: Number(values.minutes),
            incline: Number(values.incline),
            speed: Number(values.speed),
            updatedAt: new Date().toISOString(),
          };
          if (
            Object.values(values).some((v) => !v.trim()) ||
            !validIncline(record)
          ) {
            setMessage("请填写有效日期及数值");
            return;
          }
          lock.current = true;
          setBusy(true);
          try {
            await db.inclineRecords.put(record);
            setEditing(record);
            setMessage("爬坡记录已保存");
          } catch (e) {
            lock.current = false;
            setMessage(String(e));
          } finally {
            setBusy(false); // Prevent a second submission until the user edits or starts another training.
          }
        }}
      >
        <div className="form-grid">
          {(
            [
              ["minutes", "时长（分钟）", 1440],
              ["incline", "坡度（%）", 100],
              ["speed", "速度（km/h）", 100],
            ] as const
          ).map(([key, label, max]) => (
            <label key={key}>
              {label}
              <input
                disabled={busy}
                aria-label={label}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={key === "minutes" ? 0.01 : 0}
                max={max}
                required
                value={values[key]}
                onChange={(e) => {
                  if (lock.current && !busy) {
                    lock.current = false;
                    setMessage("");
                  }
                  setValues({ ...values, [key]: e.target.value });
                }}
              />
            </label>
          ))}
          <label>
            训练日期
            <input
              disabled={busy}
              type="date"
              required
              value={form.date}
              onChange={(e) => {
                if (!busy) lock.current = false;
                setForm({ ...form, date: e.target.value });
              }}
            />
          </label>
        </div>
        <div className="button-row">
          <button className="primary" disabled={busy || lock.current}>
            {editing ? "保存修改" : "保存爬坡记录"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              lock.current = false;
              reset();
              setMessage("");
            }}
          >
            记录另一次训练
          </button>
        </div>
        <p role="status">{message}</p>
      </form>
      <h3>爬坡历史</h3>
      {data.inclineRecords.length === 0 && (
        <p className="muted">完成训练后，在这里留下第一条记录。</p>
      )}
      {[...data.inclineRecords]
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt),
        )
        .slice(0, limit)
        .map((r) => (
          <article className="incline-history" key={r.id}>
            <p>
              {r.date} · {r.minutes}分钟 · 坡度{r.incline}% · {r.speed}km/h
            </p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => {
                  lock.current = false;
                  setEditing(r);
                  setForm(r);
                  setValues({
                    minutes: String(r.minutes),
                    incline: String(r.incline),
                    speed: String(r.speed),
                  });
                  setMessage("");
                }}
              >
                编辑
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  if (!confirm("删除这条爬坡记录？")) return;
                  try {
                    await db.inclineRecords.delete(r.id);
                    if (editing?.id === r.id) {
                      lock.current = false;
                      reset();
                    }
                    setMessage("记录已删除");
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      {data.inclineRecords.length > limit && (
        <button onClick={() => setLimit(limit + 20)}>更多爬坡记录</button>
      )}
    </section>
  );
}
