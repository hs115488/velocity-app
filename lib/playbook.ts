import type { UserProfile } from "@/types/velocity";

export function lightsOut(profile: UserProfile): string {
  const [h, m] = profile.wakeTarget.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setHours(d.getHours() - 8);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
