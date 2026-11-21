# Goes in a sidebar block above its footer, which it resizes to fit:
#
#   { "id": "usage", "type": "block", "size": { "px": 40 }, "content": { "mod": "usage" } }
#
# A block with another id names it in `props.block`.
{ buildMod }:
buildMod {
  dir = ./.;
  files = {
    "claude.js" = ./claude.js;
    "limits.js" = ./limits.js;
  };
}
