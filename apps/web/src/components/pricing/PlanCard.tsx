import type { BillingInterval, PlanCopy } from "../../lib/plans.js";
import { PLAN_PRICES, TIER_CREDITS } from "../../lib/plans.js";

interface PlanCardProps {
  plan: PlanCopy;
  interval: BillingInterval;
  isActive: boolean;
}

export function PlanCard({ plan, interval, isActive }: PlanCardProps) {
  const prices = PLAN_PRICES[plan.id];
  const credits = TIER_CREDITS[plan.id];

  const priceDisplay =
    prices === null ? "Custom" : prices[interval] === 0 ? "$0" : `$${prices[interval]}/mo`;

  const yearlySubLabel =
    interval === "yearly" && prices !== null && prices.yearly > 0
      ? `$${prices.yearly * 12} billed yearly`
      : null;

  return (
    <div
      className={`relative flex flex-col rounded-xl border-2 bg-gray-900 p-6 transition-all ${plan.accentBorder} ${
        isActive ? "shadow-lg" : "opacity-90 hover:opacity-100"
      }`}
    >
      {/* ACTIVE pill */}
      {isActive && (
        <div className="absolute right-4 top-4">
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-xs font-bold ${plan.accentBorder} ${plan.accentText}`}
          >
            ACTIVE
          </span>
        </div>
      )}

      {/* Plan name */}
      <h3 className={`font-mono text-lg font-bold ${plan.accentText}`}>{plan.name}</h3>

      {/* Price */}
      <div className="mt-4">
        <span className="font-mono text-3xl font-bold text-white">{priceDisplay}</span>
        {yearlySubLabel && <p className="mt-0.5 text-xs text-gray-500">{yearlySubLabel}</p>}
      </div>

      {/* Credit summary */}
      {credits && (
        <p className="mt-2 font-mono text-xs text-gray-500">
          {credits.monthly.toLocaleString()} credits / month
        </p>
      )}

      {/* Feature list */}
      <ul className="mt-6 flex-1 space-y-2">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
            <span className={`mt-0.5 text-xs ${plan.accentText}`}>›</span>
            {f}
          </li>
        ))}
      </ul>

      {/* CTA button — no-op in prototype per SPEC §12 */}
      <button
        type="button"
        onClick={() => {}}
        className={`mt-8 flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-all ${plan.accentBorder} ${plan.accentText} hover:bg-white/5`}
      >
        {plan.ctaLabel} <span>›</span>
      </button>
    </div>
  );
}
