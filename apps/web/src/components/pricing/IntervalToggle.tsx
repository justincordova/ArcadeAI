import type { BillingInterval } from "../../lib/plans.js";

interface IntervalToggleProps {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}

export function IntervalToggle({ value, onChange }: IntervalToggleProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 p-1">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={`rounded-md px-4 py-1.5 font-mono text-sm transition-all ${
          value === "monthly" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("yearly")}
        className={`flex items-center gap-2 rounded-md px-4 py-1.5 font-mono text-sm transition-all ${
          value === "yearly" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
        }`}
      >
        Yearly
        <span className="rounded bg-green-900 px-1.5 py-0.5 text-xs text-green-400">-15%</span>
      </button>
    </div>
  );
}
