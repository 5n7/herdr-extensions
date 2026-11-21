// Rate limits at the foot of the sidebar, a line per account. It resizes the
// layout block holding it, `props.block` (default "usage"), to fit. A new
// provider goes in `createProviders` and returns what ./limits.js describes.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, home, knownAgents, layout, props, run, settings, theme } from "herdr";
import { createClaude } from "./claude.js";
import { ago, clock, compactUntil, hiddenAlert, longUntil, onLine, shown, tone } from "./limits.js";

const POLL_MS = 5 * 60_000;
const ACCOUNTS_KEY = "usage.accounts";
const OPEN_KEY = "usage.open";
// The app's sidebar mods draw a rail below this width.
const RAIL_PX = 160;
const COUNTDOWN_MIN_PX = 240;

export default class Usage extends View {
  init(_props, cx) {
    this.providers = createProviders();
    this.accounts = load(ACCOUNTS_KEY, []);
    this.open = new Set(load(OPEN_KEY, []));
    this.programs = {};
    this.contentPx = 0;
    if (checking()) return;
    this.poll(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    cx.timer.every(60_000, (cx) => {
      this.fit();
      cx.notify();
    });
  }

  poll(cx) {
    const now = Date.now();
    if (!Object.keys(this.programs).length) this.loadPrograms(cx);
    for (const provider of this.providers) {
      cx.spawn(async (cx) => {
        const previous = this.accounts.filter((a) => a.provider === provider.key);
        const next = await provider.poll(previous, now).catch(() => null);
        if (!next) return;
        this.accounts = [...this.accounts.filter((a) => a.provider !== provider.key), ...next];
        save(ACCOUNTS_KEY, this.accounts);
        cx.notify();
      });
    }
  }

  loadPrograms(cx) {
    cx.spawn(async (cx) => {
      for (const program of await knownAgents().catch(() => [])) {
        this.programs[program.key] = { icon: program.icon, tint: program.tint };
      }
      cx.notify();
    });
  }

  toggle(id, cx) {
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
    save(OPEN_KEY, [...this.open]);
    cx.notify();
  }

  // on_size_change reports zoomed sizes; layout.resize takes them at zoom 1.
  measured(height) {
    this.contentPx = Math.ceil(height / (settings().zoom ?? 1));
    this.fit();
  }

  fit() {
    const id = props()?.block ?? "usage";
    const block = find(layout(), id);
    const px = this.contentPx;
    if (!block || px <= 0 || block.size?.px === px) return;
    run("layout.resize", { id, px });
  }

  render() {
    const sidebarPx = find(layout(), "sidebar")?.size?.px ?? Infinity;
    const look = {
      compact: sidebarPx < COUNTDOWN_MIN_PX,
      now: Date.now(),
      programs: this.programs,
      t: theme(),
    };
    const { t } = look;
    const rail = sidebarPx < RAIL_PX;
    const order = this.providers.map((p) => p.key);
    const accounts = shown(this.accounts, order, look.now);
    return v_flex()
      .id("usage")
      .w_full()
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        v_flex()
          .id("usage-content")
          .w_full()
          .px(rail ? 4 : 10)
          .py(6)
          .gap(1)
          .border_t(1)
          .border_color(t.border)
          .on_size_change((size) => this.measured(size.height))
          .when(accounts.length === 0 && !rail, (el) =>
            el.child(div().px(8).py(4).text_size(11.5).text_color(t.dim).child("No usage yet")),
          )
          .children(
            accounts.map((account) =>
              rail
                ? railLine(account, look)
                : accountView(account, this.open.has(account.id), look, (cx) =>
                    this.toggle(account.id, cx),
                  ),
            ),
          ),
      );
  }
}

function createProviders() {
  return [createClaude({ exec, home: home() })];
}

function accountView(account, open, look, onToggle) {
  const { t } = look;
  const line = h_flex()
    .id(elementId(account))
    .h(26)
    .px(8)
    .gap(8)
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .text_size(11)
    .hover((s) => s.bg(t.hover))
    .tooltip(`${account.name} (${account.source}), as of ${ago(account.at, look.now)}`)
    .accessibility_label(`${account.title} usage`)
    .on_click((_e, cx) => onToggle(cx))
    .child(accountIcon(account, look))
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .overflow_hidden()
        .gap(12)
        .children(onLine(account.limits).map((l) => limitSummary(l, account.stale, look))),
    )
    .child(
      div()
        .flex_none()
        .text_color(t.dim)
        .child(open ? "▾" : "▸"),
    );
  return v_flex()
    .flex_none()
    .child(line)
    .when(open, (el) => el.child(accountDetails(account, look)));
}

function limitSummary(l, stale, look) {
  const { compact, now, t } = look;
  return h_flex()
    .flex_none()
    .gap(4)
    .child(div().text_color(t.dim).child(l.key))
    .child(
      div()
        .font_medium()
        .text_color(stale ? t.dim : t[tone(l.pct)])
        .child(`${Math.round(l.pct)}%`),
    )
    .when(!stale && !compact && l.resetsAt, (el) =>
      el.child(div().text_color(t.dim).child(compactUntil(l.resetsAt, now))),
    );
}

function accountDetails(account, look) {
  const { now, t } = look;
  return v_flex()
    .pl(30)
    .pr(8)
    .pt(4)
    .pb(9)
    .gap(7)
    .text_size(11)
    .child(
      h_flex()
        .justify_between()
        .items_center()
        .child(div().text_size(12).font_medium().child(account.title))
        .child(div().text_color(t.dim).child(ago(account.at, now))),
    )
    .children(account.limits.map((l) => limitDetail(l, look)));
}

function limitDetail(l, look) {
  const { now, t } = look;
  const color = t[tone(l.pct)];
  const pct = Math.max(0, Math.min(100, l.pct));
  return v_flex()
    .gap(3)
    .child(
      h_flex()
        .justify_between()
        .child(div().text_color(t.muted).child(l.label))
        .child(
          div()
            .text_color(color)
            .child(`${Math.round(l.pct)}%`),
        ),
    )
    .child(
      div()
        .h(3)
        .rounded(2)
        .bg(t.input)
        .child(div().h_full().rounded(2).w(`${pct}%`).bg(color)),
    )
    .when(l.resetsAt, (el) => el.child(div().text_color(t.dim).child(resetText(l, now))));
}

function railLine(account, look) {
  const { now, t } = look;
  const top = Math.max(...onLine(account.limits).map((l) => l.pct));
  const tip = [
    `${account.title}, as of ${ago(account.at, now)}`,
    ...account.limits.map(
      (l) => `${l.label}: ${Math.round(l.pct)}%${l.resetsAt ? `, ${resetText(l, now)}` : ""}`,
    ),
  ].join("\n");
  return h_flex()
    .id(elementId(account))
    .h(22)
    .gap(4)
    .items_center()
    .justify_center()
    .rounded(7)
    .text_size(10)
    .hover((s) => s.bg(t.hover))
    .tooltip(tip)
    .accessibility_label(`${account.title} usage`)
    .child(accountIcon(account, look))
    .child(
      div()
        .font_medium()
        .text_color(account.stale ? t.dim : t[tone(top)])
        .child(`${Math.round(top)}%`),
    );
}

// As the agents list draws it: a picture as is, a one-color glyph in the
// text color.
function accountIcon(account, look) {
  const { programs, t } = look;
  const program = programs[account.icon];
  return h_flex()
    .relative()
    .size(14)
    .flex_none()
    .when(program?.icon, (el) =>
      el.child(
        program.tint
          ? svg(program.icon).size(14).text_color(t.foreground)
          : image(program.icon).w(14).h(14),
      ),
    )
    .when(hiddenAlert(account.limits), (el) =>
      el.child(
        div()
          .absolute()
          .top(-2)
          .right(-2)
          .size(6)
          .rounded(3)
          .bg(t.ansi1)
          .border(1)
          .border_color(t.chrome),
      ),
    );
}

function resetText(l, now) {
  return l.resetsAt <= now
    ? `reset at ${clock(l.resetsAt, now)}`
    : `resets in ${longUntil(l.resetsAt, now)} · ${clock(l.resetsAt, now)}`;
}

function elementId(account) {
  return `usage-${account.id.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
