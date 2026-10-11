import type { ExecutionGrade } from "@/types/velocity";

function gradeLabel(grade: ExecutionGrade): string {
  if (grade === "NEW") return "";
  return grade.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The text one person receives: executed or missed, streak, grade, and the three marks. */
export function dayReport(input: {
  dateLabel: string;
  executed: boolean;
  grade: ExecutionGrade;
  streak: number;
  wake: boolean;
  gym: boolean;
  deepWork: boolean;
  partnerName: string;
}): string {
  const marks = [
    input.wake ? "Wake" : "Wake missed",
    input.gym ? "Train" : "Train missed",
    input.deepWork ? "Deep work" : "Deep work missed",
  ].join(". ");
  const grade = gradeLabel(input.grade);
  const who = input.partnerName.trim();
  const parts = [
    input.dateLabel,
    input.executed ? "Executed" : "Missed",
    `Streak ${input.streak}`,
    grade ? `Grade ${grade}` : "",
    marks,
    who ? `For ${who}` : "",
  ].filter(Boolean);
  return `${parts.join(". ")}.`;
}
