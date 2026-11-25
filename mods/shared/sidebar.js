import { div } from "gpui-kit";
import { layout } from "herdr";

// The app's sidebar mods draw a rail below this width.
export const RAIL_PX = 160;

export function sidebarPx() {
  return findNode(layout(), "sidebar")?.size?.px ?? Infinity;
}

export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function alertDot(color, t) {
  return div()
    .absolute()
    .top(-2)
    .right(-2)
    .size(6)
    .rounded(3)
    .bg(color)
    .border(1)
    .border_color(t.chrome);
}
