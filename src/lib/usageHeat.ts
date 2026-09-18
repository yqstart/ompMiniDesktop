/**
 * 「使用统计」热力图（GitHub 贡献图口径）的纯计算：分档阈值、色档、月份刻度。
 *
 * 数据形状由后端给（`usage.rs`：最近 53 周、周日对齐、逐日补零、到今天为止）——
 * 这里只做可视化归一，不改数字本身；色档与月份标签都是纯展示层。
 */
import type { UsageHeatRow } from "@shared/types";

/** 色档阈值：非零值的 p25 / p50 / p75（GitHub 口径的四分位分档）。 */
export function heatThresholds(totals: readonly number[]): [number, number, number] {
  const nonzero = totals.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) {
    // 没有参照（一整年都没有用量）：任何正数都落最浅一档
    return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  }
  const at = (p: number) => nonzero[Math.floor(p * (nonzero.length - 1))];
  return [at(0.25), at(0.5), at(0.75)];
}

/** 0 = 没用量（空格），1–4 由浅到深（阈值边界归入较浅一档）。 */
export function heatLevel(total: number, [p25, p50, p75]: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  if (total <= p25) return 1;
  if (total <= p50) return 2;
  if (total <= p75) return 3;
  return 4;
}

/**
 * 月份刻度：某月从哪一列开始（该列包含 1 号）就在哪一列上方标注（标签是月份短名，跟随界面语言）。
 * 窗口起点落在月中时，起点列的月份不标——那个月的第一周不在日历里，标了反而像从月中开始。
 */
export function monthTicks(
  cells: readonly UsageHeatRow[],
  locale: string,
): { col: number; label: string }[] {
  const fmtMonth = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const out: { col: number; label: string }[] = [];
  let marked = "";
  for (let i = 0; i < cells.length; i += 7) {
    const head = cells[i].date.split("-").map(Number);
    // 每列最后一天：不满 7 格的尾列取实际最后一行
    const tail = cells[Math.min(i + 6, cells.length - 1)].date.split("-").map(Number);
    const crosses = tail[0] !== head[0] || tail[1] !== head[1];
    if (head[2] !== 1 && !crosses) continue;
    const month = `${tail[0]}-${tail[1]}`;
    if (month === marked) continue;
    marked = month;
    out.push({ col: i / 7, label: fmtMonth.format(Date.UTC(tail[0], tail[1] - 1, 1)) });
  }
  return out;
}
