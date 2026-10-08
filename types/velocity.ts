export const TASK_IDS = ["wake", "gym", "deepWork"] as const;

export type TaskId = (typeof TASK_IDS)[number];
export type DateKey = string; // "YYYY-MM-DD"
export type ClockTime = string; // "HH:MM"

export interface UserProfile {
  id: string;
  name: string;
  wakeTarget: ClockTime;
  wakeGraceMinutes: number;
  deepWorkTargetMinutes: number;
  startDate: DateKey;
  createdAt: string; // ISO 8601
  /** A change to the standard made mid-day. It starts on `from` so today can't be bent to fit. */
  pending?: {
    wakeTarget?: ClockTime;
    wakeGraceMinutes?: number;
    deepWorkTargetMinutes?: number;
    from: DateKey;
  } | null;
}

export interface WakeLog {
  loggedAt: string; // ISO 8601
  minutesOff: number;
  onTime: boolean;
}

export interface GymLog {
  checkedInAt: string; // ISO 8601
}

export interface DeepWorkSession {
  startedAt: string; // ISO 8601
  endedAt: string | null; // ISO 8601 or null if running
}

/** A task with a time budget. Time spent on it also counts as deep work. */
export interface TimedTask {
  id: string;
  title: string;
  /** Time budget in minutes. */
  minutes: number;
  /** Seconds spent across finished stretches (excludes the running one). */
  spentSeconds: number;
  /** ISO 8601 when the current stretch started, or null if not running. */
  startedAt: string | null;
  done: boolean;
  createdAt: string; // ISO 8601
}

export interface DailyLog {
  date: DateKey;
  wake: WakeLog | null;
  gym: GymLog | null;
  deepWork: {
    sessions: DeepWorkSession[];
    totalMinutes: number;
  };
  /** Optional so logs saved before tasks existed still load. */
  tasks?: TimedTask[];
  /** Deep work target (minutes) this day is judged by, fixed when the day is first recorded. */
  deepWorkTarget?: number;
  completed: {
    wake: boolean;
    gym: boolean;
    deepWork: boolean;
  };
}

export interface VelocityState {
  version: number;
  profile: UserProfile;
  logs: Record<DateKey, DailyLog>;
}

export interface StreakMetrics {
  current: number;
  longest: number;
  totalExecutedDays: number;
  lostStreak: number;
}

export type ExecutionGrade = "NEW" | "ELITE" | "ON TRACK" | "SLIPPING" | "FAILING";

export interface ExecutionScore {
  today: number;
  rolling7: number | null;
  rolling30: number | null;
  grade: ExecutionGrade;
}
