import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, run, theme } from "herdr";
import { LOGIN, nextStatus, present } from "./auth.js";
import { RAIL_PX, alertDot, sidebarPx } from "./sidebar.js";

const POLL_MS = 60_000;
const FAST_POLL_MS = 5_000;
const FAST_FOR_MS = 5 * 60_000;
const ICON = "mods/gcloud/gcloud.svg";

export default class Gcloud extends View {
  init(_props, cx) {
    this.status = null;
    this.polling = false;
    this.polledAt = 0;
    this.fastUntil = 0;
    if (checking()) return;
    this.poll(cx);
    cx.timer.every(FAST_POLL_MS, (cx) => {
      const now = Date.now();
      if (now - this.polledAt >= (now < this.fastUntil ? FAST_POLL_MS : POLL_MS)) this.poll(cx);
    });
  }

  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    this.polledAt = Date.now();
    cx.spawn(async (cx) => {
      this.status = await nextStatus(exec, this.status, Date.now());
      this.polling = false;
      if (this.status && !present(this.status, Date.now()).login) this.fastUntil = 0;
      cx.notify();
    });
  }

  login() {
    run("tab.new", { name: "gcloud auth", argv: LOGIN });
    this.fastUntil = Date.now() + FAST_FOR_MS;
  }

  render() {
    const t = theme();
    const rail = sidebarPx() < RAIL_PX;
    const shown = this.status && present(this.status, Date.now());
    return v_flex()
      .id("gcloud")
      .w_full()
      .h_full()
      .px(rail ? 4 : 10)
      .py(6)
      .border_t(1)
      .border_color(t.border)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(shown ? statusLine(shown, rail, t, () => this.login()) : checkingLine(rail, t));
  }
}

function statusLine(shown, rail, t, onLogin) {
  return line(rail)
    .id("gcloud-line")
    .tooltip(shown.tip)
    .accessibility_label("gcloud sign-in")
    .when(shown.login, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(onLogin),
    )
    .child(icon(rail && shown.login ? t[shown.tone] : null, t))
    .when(!rail, (el) =>
      el
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(shown.account ? t.muted : t.dim)
            .child(shown.account || "not signed in"),
        )
        .child(div().flex_none().font_medium().text_color(t[shown.tone]).child(shown.text)),
    );
}

function checkingLine(rail, t) {
  return line(rail)
    .child(icon(null))
    .when(!rail, (el) => el.child(div().text_color(t.dim).child("Checking gcloud…")));
}

function line(rail) {
  return h_flex()
    .h(26)
    .px(rail ? 0 : 8)
    .gap(8)
    .items_center()
    .when(rail, (el) => el.justify_center())
    .rounded(7)
    .text_size(11);
}

function icon(alert, t) {
  return h_flex()
    .relative()
    .size(14)
    .flex_none()
    .child(image(ICON).w(14).h(14))
    .when(alert, (el) => el.child(alertDot(alert, t)));
}
