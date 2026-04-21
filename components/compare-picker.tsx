"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Mode = "delegation" | "members" | "states";

interface MemberOption {
  bioguideId: string;
  fullName: string;
  party: string;
  stateCode: string;
  chamber: string;
  district: number | null;
}

interface ComparePickerProps {
  mode: Mode;
  selectedState?: string;
  selectedA?: string;
  selectedB?: string;
  states: { code: string; name: string }[];
  allMembers?: MemberOption[];
}

const modes: { value: Mode; label: string }[] = [
  { value: "delegation", label: "Within Delegation" },
  { value: "members", label: "Member vs. Member" },
  { value: "states", label: "State vs. State" },
];

export function ComparePicker({
  mode,
  selectedState,
  selectedA,
  selectedB,
  states,
  allMembers,
}: ComparePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    router.push(`/compare?${sp.toString()}`);
  }

  function handleModeChange(newMode: Mode) {
    navigate({ mode: newMode });
  }

  // Group members by state for the optgroups
  const membersByState = allMembers
    ? allMembers.reduce(
        (acc, m) => {
          if (!acc[m.stateCode]) acc[m.stateCode] = [];
          acc[m.stateCode].push(m);
          return acc;
        },
        {} as Record<string, MemberOption[]>
      )
    : {};

  return (
    <div className="mb-10">
      {/* Mode tabs */}
      <div className="flex gap-2">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => handleModeChange(m.value)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
              mode === m.value
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Selection controls */}
      <div className="mt-5">
        {mode === "delegation" && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              State
            </label>
            <select
              value={selectedState || ""}
              onChange={(e) =>
                navigate({ mode: "delegation", state: e.target.value })
              }
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="">Select a state</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "members" && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Member A
              </label>
              <select
                value={selectedA || ""}
                onChange={(e) =>
                  navigate({
                    mode: "members",
                    a: e.target.value,
                    b: selectedB || "",
                  })
                }
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">Select a member</option>
                {Object.entries(membersByState).map(([code, mems]) => (
                  <optgroup key={code} label={code}>
                    {mems.map((m) => (
                      <option key={m.bioguideId} value={m.bioguideId}>
                        {m.fullName} ({m.party[0]}) —{" "}
                        {m.chamber === "senate"
                          ? "Sen."
                          : m.district
                            ? `Dist. ${m.district}`
                            : "At-Large"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <span className="pb-1.5 text-sm text-neutral-300">vs.</span>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Member B
              </label>
              <select
                value={selectedB || ""}
                onChange={(e) =>
                  navigate({
                    mode: "members",
                    a: selectedA || "",
                    b: e.target.value,
                  })
                }
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">Select a member</option>
                {Object.entries(membersByState).map(([code, mems]) => (
                  <optgroup key={code} label={code}>
                    {mems.map((m) => (
                      <option key={m.bioguideId} value={m.bioguideId}>
                        {m.fullName} ({m.party[0]}) —{" "}
                        {m.chamber === "senate"
                          ? "Sen."
                          : m.district
                            ? `Dist. ${m.district}`
                            : "At-Large"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        )}

        {mode === "states" && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                State A
              </label>
              <select
                value={selectedA || ""}
                onChange={(e) =>
                  navigate({
                    mode: "states",
                    a: e.target.value,
                    b: selectedB || "",
                  })
                }
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">Select a state</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="pb-1.5 text-sm text-neutral-300">vs.</span>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                State B
              </label>
              <select
                value={selectedB || ""}
                onChange={(e) =>
                  navigate({
                    mode: "states",
                    a: selectedA || "",
                    b: e.target.value,
                  })
                }
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">Select a state</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
