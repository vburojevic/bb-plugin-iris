// ThemePreview (chunk "craft"): a small app screen, sign-in form or pricing
// page whose every color, radius and font comes from --tp-* custom properties
// set on its own frame, so nothing leaks in or out. Inputs bound to the same
// states change it as they move. The mock is a picture: nothing in it is
// focusable or does anything. Values are checked in core/themepreview.ts.

import { Glyph, Shimmer, cn, inkOn, str } from "@iris/ui";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { isPendingValue } from "../core/evaluate";
import { THEME_TOKENS, readTheme, themeStyle } from "../core/themepreview";
import type { ViewProps } from "../ui/render";
import { Caption, FOCUS, Problems } from "./agents-kit";

type Mock = "app" | "form" | "pricing";
const MOCKS: { id: Mock; label: string }[] = [
  { id: "app", label: "App" },
  { id: "form", label: "Sign in" },
  { id: "pricing", label: "Pricing" },
];

const v = (name: string) => `var(--tp-${name})`;
const soft = (name: string, p: number) => `color-mix(in oklab, ${v(name)} ${p}%, transparent)`;
const R = (k = 1) => `calc(var(--tp-radius) * ${k})`;
const surface: CSSProperties = { background: v("card"), border: `1px solid ${v("border")}`, borderRadius: R() };
const primaryBtn: CSSProperties = { background: v("primary"), color: v("primary-foreground"), borderRadius: R(0.8) };
const ghostBtn: CSSProperties = { border: `1px solid ${v("border")}`, borderRadius: R(0.8), color: v("foreground") };
const field: CSSProperties = { border: `1px solid ${v("border")}`, borderRadius: R(0.7), background: v("background") };
const muted: CSSProperties = { color: v("muted-foreground") };

export function ThemePreviewView({ props }: ViewProps) {
  const pending = isPendingValue(props.vars);
  const theme = useMemo(() => (pending ? null : readTheme(props.vars)), [pending, props.vars]);
  const initial: Mock = props.mock === "form" || props.mock === "pricing" ? props.mock : "app";
  const [picked, setPicked] = useState<{ mock: Mock; from: Mock } | null>(null);
  // The prop wins when it changes (a bound Select); a tab the person picked holds until then.
  const mock = picked && picked.from === initial ? picked.mock : initial;
  const setMock = (m: Mock) => setPicked({ mock: m, from: initial });
  if (!theme) return <Shimmer className="h-72" />;
  const style = themeStyle(theme, (c) => {
    try {
      return inkOn(c);
    } catch {
      return null;
    }
  });
  const given = THEME_TOKENS.filter((t) => theme.values[t].given);
  return (
    <div className="min-w-0">
      <Caption title={str(props.title)}>
        <span role="group" aria-label="Screen" className="inline-flex rounded-full p-0.5 ring-1 ring-border">
          {MOCKS.map((m) => (
            <button key={m.id} type="button" aria-pressed={mock === m.id} onClick={() => setMock(m.id)} className={cn("h-6 rounded-full px-2.5 text-[12px]", mock === m.id ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground", FOCUS)}>
              {m.label}
            </button>
          ))}
        </span>
      </Caption>
      <div role="img" aria-label={`A ${MOCKS.find((m) => m.id === mock)?.label.toLowerCase()} screen drawn in the theme`} className="relative isolate overflow-hidden select-none" style={{ ...style, background: v("background"), color: v("foreground"), fontFamily: v("font"), borderRadius: R(1.4), border: `1px solid ${v("border")}` } as CSSProperties}>
        {mock === "app" ? <AppMock /> : mock === "form" ? <FormMock /> : <PricingMock />}
      </div>
      {given.length ? (
        <div className="iris-scroll-x -mx-0.5 mt-1.5 flex gap-1.5 overflow-x-auto p-0.5">
          {given.map((t) => (
            <span key={t} className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] ring-1 ring-border">
              {t === "radius" || t === "font" || t === "mono" ? <Glyph name={t === "radius" ? "square-round-corner" : "type"} size={12} className="text-muted-foreground" /> : <span className="size-3 rounded-full ring-1 ring-border" style={{ background: theme.values[t].value }} />}
              <span className="text-muted-foreground">{t}</span>
              <span className="max-w-[10rem] truncate font-mono">{theme.values[t].value}</span>
            </span>
          ))}
        </div>
      ) : null}
      <Problems items={theme.problems} />
    </div>
  );
}

function Badge({ children, tone = "accent" }: { children: ReactNode; tone?: string }) {
  return (
    <span className="inline-flex h-5 items-center px-2 text-[11px] font-medium" style={{ background: soft(tone, 16), color: v(tone), borderRadius: "999px" }}>
      {children}
    </span>
  );
}

function AppMock() {
  const nav = [
    ["layout-grid", "Projects", true],
    ["inbox", "Inbox", false],
    ["chart-line", "Reports", false],
    ["settings", "Settings", false],
  ] as const;
  const projects = [
    { name: "Checkout redesign", tag: "In review", done: 0.72 },
    { name: "Offline sync", tag: "Building", done: 0.41 },
    { name: "Onboarding", tag: "Planned", done: 0.12 },
  ];
  return (
    <div className="flex min-h-[300px]">
      <aside className="hidden w-44 shrink-0 flex-col gap-1 p-3 @lg/iris:flex" style={{ borderRight: `1px solid ${v("border")}`, background: v("muted") }}>
        <div className="mb-3 flex items-center gap-2 px-2 text-[13px] font-semibold">
          <span className="size-5" style={{ background: v("primary"), borderRadius: R(0.5) }} />
          Northwind
        </div>
        {nav.map(([icon, label, active]) => (
          <div key={label} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]" style={active ? { background: soft("primary", 14), color: v("primary"), borderRadius: R(0.7), fontWeight: 600 } : muted}>
            <Glyph name={icon} size={14} />
            {label}
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[17px] font-semibold leading-tight">Projects</div>
            <div className="text-[12px]" style={muted}>
              3 active, 1 waiting on review
            </div>
          </div>
          <div className="flex gap-2">
            <span className="px-3 py-1.5 text-[12.5px] font-medium" style={ghostBtn}>
              Export
            </span>
            <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[12.5px] font-medium" style={primaryBtn}>
              <Glyph name="plus" size={13} />
              New project
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]" style={{ ...field, ...muted }}>
          <Glyph name="search" size={13} />
          Search projects
        </div>
        <div className="mt-3 space-y-2">
          {projects.map((p) => (
            <div key={p.name} className="p-3" style={surface}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium">{p.name}</span>
                <Badge>{p.tag}</Badge>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden" style={{ background: v("muted"), borderRadius: 999 }}>
                <div className="h-full" style={{ width: `${p.done * 100}%`, background: v("primary"), borderRadius: 999 }} />
              </div>
              <div className="mt-1 text-[11.5px]" style={muted}>
                {Math.round(p.done * 100)}% done
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FormMock() {
  return (
    <div className="grid min-h-[300px] place-items-center p-5" style={{ background: v("muted") }}>
      <div className="w-full max-w-[320px] p-5" style={surface}>
        <div className="mb-3 size-8" style={{ background: v("primary"), borderRadius: R(0.6) }} />
        <div className="text-[17px] font-semibold">Welcome back</div>
        <div className="mb-4 text-[12.5px]" style={muted}>
          Sign in to keep going
        </div>
        {[
          ["Email", "maya@example.com"],
          ["Password", "••••••••••"],
        ].map(([label, value]) => (
          <div key={label} className="mb-3">
            <div className="mb-1 text-[12px] font-medium">{label}</div>
            <div className="px-2.5 py-1.5 text-[12.5px]" style={field}>
              {value}
            </div>
          </div>
        ))}
        <div className="mb-4 flex items-center gap-2 text-[12px]">
          <span className="grid size-4 place-items-center" style={{ background: v("primary"), color: v("primary-foreground"), borderRadius: R(0.3) }}>
            <Glyph name="check" size={11} />
          </span>
          Keep me signed in
        </div>
        <div className="py-2 text-center text-[13px] font-medium" style={primaryBtn}>
          Sign in
        </div>
        <div className="mt-3 text-center text-[12px]" style={muted}>
          New here? <span style={{ color: v("primary"), fontWeight: 600 }}>Create an account</span>
        </div>
      </div>
    </div>
  );
}

function PricingMock() {
  const plans = [
    { name: "Starter", price: "$0", note: "For trying it out", features: ["1 project", "Community help"] },
    { name: "Team", price: "$24", note: "Per person, monthly", features: ["Unlimited projects", "Reviews and approvals", "Priority help"], pick: true },
    { name: "Scale", price: "$60", note: "Per person, monthly", features: ["Everything in Team", "Single sign-on", "Audit log"] },
  ];
  return (
    <div className="p-4">
      <div className="mb-3 text-center">
        <div className="text-[17px] font-semibold">Pick a plan</div>
        <div className="text-[12.5px]" style={muted}>
          Change or cancel any time
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 @lg/iris:grid-cols-3">
        {plans.map((p) => (
          <div key={p.name} className="flex flex-col p-4" style={{ ...surface, ...(p.pick ? { border: `2px solid ${v("primary")}` } : {}) }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">{p.name}</span>
              {p.pick ? <Badge tone="primary">Popular</Badge> : null}
            </div>
            <div className="mt-2 text-[24px] font-semibold leading-none">{p.price}</div>
            <div className="mt-1 text-[11.5px]" style={muted}>
              {p.note}
            </div>
            <ul className="my-3 space-y-1.5 text-[12.5px]">
              {p.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <Glyph name="check" size={13} style={{ color: v("primary") }} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-auto py-1.5 text-center text-[12.5px] font-medium" style={p.pick ? primaryBtn : ghostBtn}>
              {p.pick ? "Start free trial" : "Choose"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
