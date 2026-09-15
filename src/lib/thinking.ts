/**
 * 思考档工具：可用档推导 + 最高档选择 + 真值归一。
 *
 * 硬约束（omp 18.1.22 实测，见 docs/rpc-memo.md §3）：
 * - 合法档 = 当前模型 `thinking.efforts`，但 `off` 恒定合法（不在 efforts 内亦生效）；
 * - 非法档 `set_thinking_level` 同样回 `success:true`（静默归一或忽略）→ 只能前端先过滤，禁止先发再报错；
 * - 切模型后 omp **不会**自动修正档位（切到无思考模型直接丢掉档位）→ 由后端自动重设为最高档。
 */

/** 档位强度序（与 omp CLI `--thinking` 全集一致，off 最弱）。 */
export const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** 该模型可选档：off 恒在首位，其余按强度序取 efforts 交集（未知档忽略）。 */
export function thinkingLevelsOf(efforts: readonly string[] | null | undefined): string[] {
  const set = new Set(efforts ?? []);
  return THINKING_ORDER.filter((lv) => lv === "off" || set.has(lv));
}

/** 该模型支持的最高档；无可用档（不支持思考）= off。 */
export function highestThinking(efforts: readonly string[] | null | undefined): string {
  const levels = thinkingLevelsOf(efforts);
  return levels[levels.length - 1] ?? "off";
}

/**
 * 依据 omp 真值算 UI 应显示的档位。
 * `shouldSync` = 真值缺失或非法（切模型后会丢档），需下发纠正为最高档。
 */
export function resolveThinking(
  efforts: readonly string[] | null | undefined,
  actual: string | null | undefined,
): { level: string; shouldSync: boolean } {
  const levels = thinkingLevelsOf(efforts);
  if (actual && levels.includes(actual)) return { level: actual, shouldSync: false };
  return { level: highestThinking(efforts), shouldSync: levels.length > 1 };
}
