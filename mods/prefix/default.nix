# A tmux-style prefix. `groups` is the key table after the prefix, as the card
# shows it:
#
#   [ { name = "Tabs"; rows = [ { keys = [ "c" ]; label = "New tab"; run = "tab.new"; } ]; } ]
#
# A key is GPUI's name for it. A row's `run` is the app command for its keys,
# or maps each key to its own. `action` names one of main.js's own ACTIONS
# instead; an unknown one does nothing.
#
# The table becomes the card.json shipped in the mod and `passthru.keymap`, the
# "mod:prefix" section of keys.json. That keymap's owner binds ctrl-f to
# `mod.open:prefix`: the prefix key is fixed, since a second press sends a
# literal Ctrl+F. The y and u actions open the pick mod, so install mod-pick
# beside it.
{
  buildMod,
  formats,
  groups ? [ ],
  lib,
}:
let
  # A map's keys come sorted, which suits 1-9 and h j k l.
  bindings =
    row:
    if lib.isAttrs (row.run or null) then
      lib.mapAttrsToList (key: run: {
        inherit key;
        command = "run:${run}";
      }) row.run
    else
      map (key: {
        inherit key;
        command = if row ? action then row.action else "run:${row.run}";
      }) row.keys;

  allBindings = lib.concatMap bindings (lib.concatMap (group: group.rows) groups);

  keymap =
    assert lib.assertMsg (lib.allUnique (
      [ "ctrl-f" ] ++ map (binding: binding.key) allBindings
    )) "herdr-app prefix: a key is bound twice";
    {
      "ctrl-f" = "prefix.send-prefix";
    }
    // lib.listToAttrs (
      map (binding: lib.nameValuePair binding.key "prefix.${binding.command}") allBindings
    );

  card = (formats.json { }).generate "herdr-app-prefix-card.json" (
    map (group: {
      inherit (group) name;
      rows = map (
        row:
        let
          rowBindings = bindings row;
        in
        {
          inherit (row) label;
          keys = map (binding: binding.key) rowBindings;
          inherit (lib.head rowBindings) command;
        }
      ) group.rows;
    }) groups
  );
in
buildMod {
  dir = ./.;
  files."card.json" = card;
  passthru = { inherit keymap; };
}
