import { pad2 } from '@/lib/format';

type TFn = (key: string) => string;

/** Current month as YYYY-MM. */
export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

/** "2026-10" -> "October 2026" (month names come from i18n). */
export function monthLabel(month: string, t: TFn): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${t(`agent.month.${m}`)} ${y}`;
}
