"use client";

import { useState, type FormEvent } from "react";
import { Check, Pause, Play, Plus, Trash2 } from "lucide-react";
import type { DailyLog, TimedTask } from "@/types/velocity";
import { formatDuration } from "@/lib/velocity";
import { MAX_TITLE_LENGTH, TASK_DURATIONS, tasksOf, taskElapsed, taskRemaining } from "@/lib/tasks";
import { Card, SectionLabel } from "@/components/ui";

export interface TaskListActions {
  addTask: (title: string, minutes: number) => void;
  startTask: (id: string) => void;
  pauseTask: (id: string) => void;
  toggleTaskDone: (id: string) => void;
  removeTask: (id: string) => void;
  carryOverTasks: () => void;
}

function fmtMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function TaskRow({
  task,
  now,
  editing,
  actions,
}: {
  task: TimedTask;
  now: Date;
  editing: boolean;
  actions: TaskListActions;
}) {
  const running = task.startedAt !== null;
  const elapsed = taskElapsed(task, now);
  const remaining = taskRemaining(task, now);
  const over = remaining < 0;
  const started = elapsed > 0;
  const progress = Math.min(1, elapsed / (task.minutes * 60));

  let detail: string;
  let detailClass = "text-muted";
  if (task.done) {
    detail = started ? `Done · ${fmtMinutes(elapsed / 60)} spent` : "Done";
  } else if (over) {
    detail = `${formatDuration(-remaining)} over`;
    detailClass = "text-bad";
  } else if (running) {
    detail = `${formatDuration(remaining)} left`;
    detailClass = "text-accent";
  } else if (started) {
    detail = `${formatDuration(remaining)} left · paused`;
  } else {
    detail = fmtMinutes(task.minutes);
  }

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => actions.toggleTaskDone(task.id)}
          aria-label={task.done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
          className={`hit flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 ${
            task.done ? "border-good bg-good text-card" : "border-line"
          }`}
        >
          {task.done && <Check className="h-4 w-4" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[16px] leading-tight ${task.done ? "text-faint line-through" : "font-medium"}`}>
            {task.title}
          </p>
          <p className={`mt-1 text-[13px] tabular-nums ${detailClass}`}>{detail}</p>
        </div>
        {editing ? (
          <button
            onClick={() => actions.removeTask(task.id)}
            aria-label={`Delete "${task.title}"`}
            className="hit flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bad-soft text-bad transition active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : task.done ? null : running ? (
          <button
            onClick={() => actions.pauseTask(task.id)}
            aria-label={`Pause "${task.title}"`}
            className="hit flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent transition active:scale-95"
          >
            <Pause className="h-4 w-4" fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={() => actions.startTask(task.id)}
            aria-label={`${started ? "Resume" : "Start"} "${task.title}"`}
            className="hit flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-bg transition active:scale-95"
          >
            <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
          </button>
        )}
      </div>
      {started && !task.done && (
        <div className="ml-10 mt-2.5 h-1 overflow-hidden rounded-full bg-fill">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${over ? "bg-bad" : "bg-accent"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}

function AddTaskForm({ onAdd, autoFocus }: { onAdd: (title: string, minutes: number) => void; autoFocus?: boolean }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState<number>(25);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title, minutes);
    setTitle("");
  };

  return (
    <form onSubmit={submit} className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="Add a task"
          aria-label="Task name"
          autoFocus={autoFocus}
          enterKeyHint="done"
          // 16px stops iPhone from zooming into the field.
          className="h-11 min-w-0 flex-1 rounded-[12px] bg-fill px-3 text-[16px] text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          aria-label="Add task"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-ink text-bg transition active:scale-95 disabled:opacity-30"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-1.5 gap-y-3" role="radiogroup" aria-label="Time for this task">
        {TASK_DURATIONS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={minutes === m}
            onClick={() => setMinutes(m)}
            className={`hit-y h-8 rounded-full px-3 text-[13px] font-semibold tabular-nums transition ${
              minutes === m ? "bg-ink text-bg" : "bg-fill text-muted"
            }`}
          >
            {m === 60 ? "1 h" : `${m} min`}
          </button>
        ))}
      </div>
    </form>
  );
}

export function TaskList({
  log,
  yesterday,
  now,
  actions,
}: {
  log: DailyLog;
  yesterday: DailyLog | undefined;
  now: Date;
  actions: TaskListActions;
}) {
  const [editing, setEditing] = useState(false);
  const list = tasksOf(log);
  const open = list.filter((t) => !t.done);
  const leftMinutes = open.reduce((sum, t) => sum + Math.max(0, taskRemaining(t, now)) / 60, 0);
  const carryable = list.length === 0 ? tasksOf(yesterday).filter((t) => !t.done).length : 0;

  return (
    <section>
      <div className="flex items-end justify-between">
        <SectionLabel>Tasks</SectionLabel>
        {list.length > 0 && (
          <button onClick={() => setEditing((e) => !e)} className="hit px-1 pb-2 text-[14px] font-semibold text-accent">
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <Card className="overflow-hidden">
        {list.length > 0 ? (
          <>
            <p className="px-4 pt-3.5 text-[13px] tabular-nums text-muted">
              {open.length === 0
                ? `All ${list.length} done`
                : `${open.length} to go · ${fmtMinutes(leftMinutes)} left`}
            </p>
            <ul className="divide-y divide-line">
              {list.map((t) => (
                <TaskRow key={t.id} task={t} now={now} editing={editing} actions={actions} />
              ))}
            </ul>
          </>
        ) : (
          <p className="px-4 pt-4 text-[14px] leading-relaxed text-muted">
            Name each task and give it a time. Time on a task counts toward deep work.
          </p>
        )}
        {carryable > 0 && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-fill px-3.5 py-3">
            <p className="text-[13px] leading-snug text-muted">
              {carryable} unfinished from yesterday
            </p>
            <button onClick={actions.carryOverTasks} className="hit shrink-0 text-[14px] font-semibold text-accent">
              Bring over
            </button>
          </div>
        )}
        <div className={list.length > 0 ? "border-t border-line" : ""}>
          <AddTaskForm onAdd={actions.addTask} />
        </div>
      </Card>
      <p className="px-1 pt-2 text-[13px] leading-snug text-muted">
        Starting a task starts your deep work timer. Only one task runs at a time.
      </p>
    </section>
  );
}
