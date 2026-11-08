export interface PlanningGoal {
 id: string; name: string; term: "short" | "long"; target: number; saved: number; date: string; description: string; accountId: string;
}
export const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
export function todayISO(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; }
export function goalMetrics(goal: PlanningGoal, now = new Date()) {
 const end = new Date(`${goal.date}T00:00:00`);
 const validDate = Number.isFinite(end.getTime());
 const overdue = !validDate || goal.date <= todayISO(now);
 const months = validDate ? Math.max(1, Math.ceil(((end.getFullYear()-now.getFullYear())*12 + end.getMonth()-now.getMonth()) + (end.getDate()-now.getDate())/31)) : 1;
 const remaining = Math.max(0, goal.target-goal.saved);
 return { progress: goal.target > 0 ? Math.max(0, Math.min(100, goal.saved/goal.target*100)) : 0, completed: remaining === 0, overdue, monthly: overdue ? null : remaining/months };
}
export function validGoal(value: unknown): value is PlanningGoal {
 if (!value || typeof value !== "object") return false;
 const g = value as Partial<PlanningGoal>;
 return typeof g.id === "string" && typeof g.name === "string" && (g.term === "short" || g.term === "long") && typeof g.target === "number" && Number.isFinite(g.target) && g.target > 0 && typeof g.saved === "number" && Number.isFinite(g.saved) && g.saved >= 0 && typeof g.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && Number.isFinite(Date.parse(g.date)) && typeof g.description === "string" && typeof g.accountId === "string";
}
