// StringsTable (chunk "l10n"): localized strings side by side with the issues
// a release would trip on, and a tile per locale. Reading and checking the
// files lives in core/l10n.ts.

import { Chip, Glyph, InlineError, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useMemo, useState, type ReactNode } from "react";
import { isPendingValue } from "../core/evaluate";
import { type IssueKind, type LocaleSummary, type StringsRow, readStrings, reviewStrings } from "../core/l10n";
import type { ViewProps } from "../ui/render";

const KIND: Record<IssueKind, { label: string; tone: string; icon: string }> = {
  missing: { label: "Missing", tone: "bad", icon: "circle-dashed" },
  placeholders: { label: "Placeholders", tone: "bad", icon: "braces" },
  untranslated: { label: "Untranslated", tone: "warn", icon: "languages" },
  long: { label: "Long", tone: "warn", icon: "move-horizontal" },
  review: { label: "Review", tone: "info", icon: "eye" },
};
const ORDER: IssueKind[] = ["missing", "placeholders", "untranslated", "long", "review"];
const COUNTED: Record<IssueKind, [string, string]> = { missing: ["missing", "missing"], placeholders: ["placeholder", "placeholders"], untranslated: ["untranslated", "untranslated"], long: ["long", "long"], review: ["to review", "to review"] };
const PAGE = 60;

let names: Intl.DisplayNames | null | undefined;
function localeName(code: string): string | null {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      names = null;
    }
  }
  try {
    const n = names?.of(code.replace("_", "-"));
    return n && n !== code ? n : null;
  } catch {
    return null;
  }
}

const pendingIn = (v: unknown) => isPendingValue(v) || (!!v && typeof v === "object" && Object.values(v).some(isPendingValue));
const strList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : undefined);
const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

export function StringsTableView({ props }: ViewProps) {
  const env = useEnv();
  const raw = props.strings;
  const pending = pendingIn(raw);
  const source = str(props.source);
  const locales = strList(props.locales);
  const same = strList(props.same);
  const growth = num(props.growth);
  const limits = props.limits as number | Record<string, number> | undefined;
  const result = useMemo(() => {
    if (pending || raw === undefined) return null;
    const { table, problems } = readStrings(raw, { source, locales });
    return { table, problems, ...reviewStrings(table, { growth, limits, same }) };
    // Props arrive as fresh objects on each render; their JSON is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, JSON.stringify([raw, source, locales, same, growth, limits])]);

  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"issues" | "all">(props.show === "all" ? "all" : "issues");
  const [kinds, setKinds] = useState<Set<IssueKind>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const view = props.view === "summary" || props.view === "table" ? props.view : "both";
  const title = str(props.title);

  if (pending) return <Shimmer className="h-64" />;
  if (!result) return <InlineError error={new Error("strings is required: an .xcstrings catalog or { locale: load(file) }")} context="<StringsTable>" />;
  const { table, problems, rows, summary } = result;
  const targets = table.locales.filter((l) => l !== table.source);
  const shown = focus ? [focus] : targets;
  const issuesIn = (r: StringsRow, l: string) => r.cells[l]?.issues ?? [];
  const matchesKind = (r: StringsRow) => shown.some((l) => issuesIn(r, l).some((x) => !kinds.size || kinds.has(x.kind)));
  const withIssues = rows.filter(matchesKind);
  const effective = mode === "issues" && !withIssues.length && !kinds.size && !focus ? "all" : mode;
  const q = search.trim().toLowerCase();
  const filtered = (effective === "issues" ? withIssues : rows).filter(
    (r) => !q || r.key.toLowerCase().includes(q) || Object.values(r.cells).some((c) => c.value?.toLowerCase().includes(q)),
  );
  const visible = filtered.slice(0, limit);
  const totalIssues = summary.reduce((n, s) => n + ORDER.reduce((m, k) => m + s.counts[k], 0), 0);

  const pick = (key: string, locale: string, value: string | null) => {
    if (props.onPick) env.run(props.onPick, [key, locale]);
    else if (value) env.perform([{ $iris: "action", kind: "copy", args: [value] }]);
  };
  const toggleKind = (k: IssueKind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {title ? <div className="truncate text-[13.5px] font-semibold">{title}</div> : null}
      {problems.length ? <InlineError error={new Error(problems.slice(0, 3).join("; ") + (problems.length > 3 ? ` (and ${problems.length - 3} more)` : ""))} context="<StringsTable>" /> : null}
      {view !== "table" && summary.length ? (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))]" role="group" aria-label="Locales">
          {summary.map((s) => (
            <LocaleTile key={s.locale} s={s} active={focus === s.locale} onClick={view === "summary" ? undefined : () => (setFocus(focus === s.locale ? null : s.locale), setLimit(PAGE))} />
          ))}
        </div>
      ) : null}
      {view !== "summary" ? (
        <div className="min-w-0">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex h-8 w-full items-center sm:w-auto sm:min-w-[10rem] sm:flex-1 gap-2 rounded-full bg-muted/60 px-3 text-[13px] ring-1 ring-border focus-within:ring-foreground/30">
              <Glyph name="search" size={14} className="text-muted-foreground" />
              <input value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} placeholder="Search keys and text" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Search strings" />
              {search ? (
                <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <Glyph name="x" size={13} />
                </button>
              ) : null}
            </label>
            <div className="flex shrink-0 rounded-full bg-muted/70 p-0.5 text-[12px]" role="tablist" aria-label="Rows">
              {(["issues", "all"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={effective === m}
                  onClick={() => (setMode(m), setLimit(PAGE))}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 tabular-nums", effective === m ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
                >
                  {m === "issues" ? `With issues ${withIssues.length}` : `All ${rows.length}`}
                </button>
              ))}
            </div>
          </div>
          {totalIssues ? (
            <div className="iris-scroll-x -mx-0.5 mb-2 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5" role="group" aria-label="Issue filters">
              {ORDER.filter((k) => summary.some((s) => s.counts[k])).map((k) => (
                <KindToggle key={k} kind={k} on={kinds.has(k)} count={summary.filter((s) => shown.includes(s.locale)).reduce((n, s) => n + s.counts[k], 0)} onClick={() => (toggleKind(k), setMode("issues"), setLimit(PAGE))} />
              ))}
              {focus ? (
                <button type="button" onClick={() => setFocus(null)} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-2.5 text-[12px] text-background">
                  {focus}
                  <Glyph name="x" size={12} />
                </button>
              ) : null}
            </div>
          ) : null}
          {!table.keys.length ? (
            <Note icon="file-question">No strings found</Note>
          ) : effective === "all" && mode === "issues" && !q ? (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Glyph name="circle-check" size={13} style={{ color: env.palette.tone.good }} />
              No issues in {targets.length === 1 ? targets[0] : `${targets.length} locales`}
            </div>
          ) : null}
          {visible.length ? (
            <div className="iris-scroll-x relative min-w-0 overflow-auto rounded-[10px] ring-1 ring-border" style={{ maxHeight: 560 }}>
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-[2] bg-card">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="sticky left-0 z-[1] min-w-[8rem] max-w-[11rem] border-b border-r border-border bg-card px-2.5 py-1.5 font-medium sm:min-w-[10rem] sm:max-w-none">
                      Key<span className="font-normal sm:hidden"> and {table.source}</span>
                    </th>
                    {[table.source, ...shown].map((l) => (
                      <th key={l} scope="col" className={cn("min-w-[10rem] border-b border-border px-2.5 py-1.5 font-medium sm:min-w-[11.5rem]", l === table.source && "hidden sm:table-cell")}>
                        <span className="font-mono text-foreground">{l}</span> <span className="font-normal">{l === table.source ? "source" : (localeName(l) ?? "")}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.key} className="group align-top">
                      <th scope="row" className="sticky left-0 z-[1] max-w-[11rem] sm:max-w-[16rem] border-b border-r border-border/60 bg-card px-2.5 py-2 text-left font-normal group-last:border-b-0">
                        <div className="break-all font-mono text-[12px] leading-snug">{r.key}</div>
                        {r.comment ? <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{r.comment}</div> : null}
                        <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-muted-foreground sm:hidden">{r.source ?? "Not in source"}</div>
                      </th>
                      {[table.source, ...shown].map((l) => (
                        <Cell key={l} row={r} locale={l} isSource={l === table.source} onPick={pick} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : table.keys.length ? (
            <Note icon="search-x">No strings match</Note>
          ) : null}
          {filtered.length > limit ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Showing {limit} of {filtered.length}
              </span>
              <button type="button" onClick={() => setLimit(limit + PAGE * 2)} className="h-7 rounded-full px-3 text-foreground ring-1 ring-border hover:bg-state-hover">
                Show more
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[10px] py-8 text-xs text-muted-foreground ring-1 ring-border">
      <Glyph name={icon} size={18} />
      {children}
    </div>
  );
}

function KindToggle({ kind, on, count, onClick }: { kind: IssueKind; on: boolean; count: number; onClick: () => void }) {
  const env = useEnv();
  const color = env.palette.tone[KIND[kind].tone as "bad"];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] tabular-nums ring-1 transition-colors", on ? "ring-transparent" : "text-muted-foreground ring-border hover:text-foreground")}
      style={on ? { background: tint(color, 16), color } : undefined}
    >
      <Glyph name={KIND[kind].icon} size={12} style={on ? undefined : { color }} />
      {KIND[kind].label}
      <span className={on ? "" : "text-foreground"}>{count}</span>
    </button>
  );
}

function LocaleTile({ s, active, onClick }: { s: LocaleSummary; active: boolean; onClick?: () => void }) {
  const env = useEnv();
  const pct = s.total ? s.translated / s.total : 1;
  const issues = ORDER.filter((k) => s.counts[k]);
  const shown = Math.floor(pct * 1000) / 10;
  const body = (
    <>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-mono text-[12.5px] font-medium">{s.locale}</span>
        <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{localeName(s.locale) ?? ""}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold leading-none tabular-nums">{shown === 100 || shown === 0 ? Math.round(shown) : shown}%</span>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {s.translated} of {s.total}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: env.palette.accent }} />
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap gap-1">
        {issues.length ? (
          issues.map((k) => (
            <Chip key={k} tone={KIND[k].tone}>
              {s.counts[k]} {COUNTED[k][s.counts[k] === 1 ? 0 : 1]}
            </Chip>
          ))
        ) : (
          <Chip tone="good" icon="check">
            Complete
          </Chip>
        )}
      </div>
    </>
  );
  const cls = cn("flex min-w-0 flex-col justify-start rounded-xl px-3 py-2.5 text-left ring-1 transition-colors", active ? "bg-state-active ring-foreground/40" : "ring-border");
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} title={active ? "Show every locale" : `Show only ${s.locale}`} className={cn(cls, "hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Cell({ row, locale, isSource, onPick }: { row: StringsRow; locale: string; isSource: boolean; onPick: (key: string, locale: string, value: string | null) => void }) {
  const env = useEnv();
  const cell = row.cells[locale];
  const issues = cell?.issues ?? [];
  const worst = ORDER.find((k) => issues.some((x) => x.kind === k));
  const color = worst ? env.palette.tone[KIND[worst].tone as "bad"] : undefined;
  const value = cell?.value ?? null;
  return (
    <td className={cn("border-b border-border/60 p-0 group-last:border-b-0", isSource && "hidden sm:table-cell")} style={color ? { background: tint(color, 8) } : undefined}>
      <button
        type="button"
        onClick={() => onPick(row.key, locale, value)}
        title={issues.map((x) => `${KIND[x.kind].label}: ${x.detail}`).join("\n") || (value ? "Copy" : undefined)}
        className="block w-full min-w-0 px-2.5 py-2 text-left hover:bg-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--iris-accent)]"
      >
        {value ? (
          <span className={cn("line-clamp-3 whitespace-pre-wrap break-words leading-snug", isSource && "text-muted-foreground")}>{value}</span>
        ) : (
          <span className="italic text-muted-foreground/70">{isSource ? "Not in source" : "Missing"}</span>
        )}
        {issues.length && !(issues.length === 1 && issues[0].kind === "missing") ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {issues
              .filter((x) => x.kind !== "missing")
              .map((x) => (
                <Chip key={x.kind} tone={KIND[x.kind].tone} icon={KIND[x.kind].icon}>
                  {x.kind === "untranslated" || x.kind === "review" ? KIND[x.kind].label : x.detail}
                </Chip>
              ))}
          </span>
        ) : null}
        {cell?.plural ? <span className="mt-1 block text-[11px] text-muted-foreground">plural, other form</span> : null}
      </button>
    </td>
  );
}

