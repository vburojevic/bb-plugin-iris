// DecisionLog (chunk "craft"): decisions newest first, each with its topic,
// who decided and why; a search field and topic chips narrow the list. A
// superseded or reversed decision stays, muted and labeled, so the history
// reads whole. Logic lives in core/decisions.ts.

import { Chip, Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { type DecisionRow, filterDecisions, normalizeDecisions } from "../core/decisions";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { Caption, FOCUS, Nothing, Problems } from "./agents-kit";

const STATUS: Record<DecisionRow["status"], { label: string; tone?: string } | null> = { active: null, proposed: { label: "Proposed", tone: "info" }, superseded: { label: "Superseded" }, reversed: { label: "Reversed", tone: "warn" } };

function shortDate(r: DecisionRow): string | undefined {
  if (r.time == null) return r.date;
  const d = new Date(r.time);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function DecisionLogView({ props }: ViewProps) {
  const pending = isPendingValue(props.items);
  const model = useMemo(() => (pending ? null : normalizeDecisions(props.items)), [pending, props.items]);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  if (!model) return <Shimmer className="h-40" />;
  const title = str(props.title);
  if (!model.rows.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No decisions yet</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const rows = filterDecisions(model.rows, query, topic);
  const inForce = model.rows.filter((r) => r.status === "active").length;
  return (
    <div className="min-w-0">
      <Caption title={title}>
        <span>
          {model.rows.length} {model.rows.length === 1 ? "decision" : "decisions"}
          {inForce !== model.rows.length ? `, ${inForce} in force` : ""}
        </span>
      </Caption>
      {model.rows.length > 3 || model.topics.length > 1 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-44">
            <Glyph name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search decisions" aria-label="Search decisions" className="h-7 w-full rounded-full bg-transparent pl-7 pr-3 text-[12.5px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[color-mix(in_oklab,var(--iris-accent)_55%,transparent)]" />
          </label>
          {model.topics.length > 1 ? (
            <div className="iris-scroll-x -m-0.5 flex min-w-0 max-w-full gap-1 overflow-x-auto p-0.5" role="group" aria-label="Topics">
              {[{ name: null as string | null, count: model.rows.length }, ...model.topics].map((t) => (
                <button key={t.name ?? "all"} type="button" aria-pressed={topic === t.name} onClick={() => setTopic(t.name)} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] ring-1", topic === t.name ? "bg-foreground/10 text-foreground ring-foreground/25" : "text-muted-foreground ring-border hover:bg-state-hover hover:text-foreground", FOCUS)}>
                  {t.name ?? "All"}
                  <span className="tabular-nums text-muted-foreground">{t.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length ? (
        <ol className="min-w-0">
          {rows.map((r, k) => (
            <Entry key={`${r.order}`} row={r} first={k === 0} />
          ))}
        </ol>
      ) : (
        <Nothing>Nothing matches</Nothing>
      )}
      <Problems items={model.problems} />
    </div>
  );
}

function Entry({ row, first }: { row: DecisionRow; first: boolean }) {
  const env = useEnv();
  const [more, setMore] = useState(false);
  const status = STATUS[row.status];
  const gone = row.status === "superseded" || row.status === "reversed";
  const date = shortDate(row);
  const long = (row.why?.length ?? 0) > 180;
  return (
    <li className={cn("grid min-w-0 grid-cols-1 gap-x-4 py-2.5 @md/iris:grid-cols-[4.5rem_minmax(0,1fr)]", !first && "border-t border-border")}>
      <div className="hidden pt-px text-[12px] tabular-nums text-muted-foreground @md/iris:block">{date ?? ""}</div>
      <div className="min-w-0">
        <div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          {row.topic ? <span className="font-medium uppercase tracking-[0.04em]">{row.topic}</span> : null}
          {date ? <span className="tabular-nums @md/iris:hidden">{date}</span> : null}
          {status ? (
            <Chip tone={status.tone} className="h-[18px]">
              {status.label}
            </Chip>
          ) : null}
        </div>
        <div className={cn("text-[13.5px] font-medium leading-snug [text-wrap:pretty]", gone && "text-muted-foreground line-through decoration-muted-foreground/60")}>{row.decision}</div>
        {row.why ? (
          <p className={cn("mt-0.5 text-[12.5px] leading-snug text-muted-foreground [text-wrap:pretty]", long && !more && "line-clamp-2")}>
            {row.why}
          </p>
        ) : null}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 text-[11.5px] text-muted-foreground">
          {row.by ? (
            <span className="inline-flex items-center gap-1">
              <Glyph name="user-round" size={12} />
              {row.by}
            </span>
          ) : null}
          {long ? (
            <button type="button" onClick={() => setMore(!more)} className={cn("rounded hover:text-foreground", FOCUS)}>
              {more ? "Less" : "Read why"}
            </button>
          ) : null}
          {row.link && !/^https?:\/\//.test(row.link) ? <span>{row.link}</span> : null}
          {row.link && /^https?:\/\//.test(row.link) ? (
            <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openUrl", args: [row.link as string] }])} className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", FOCUS)}>
              <Glyph name="external-link" size={12} />
              Link
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
