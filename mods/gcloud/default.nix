# Goes in a sidebar block sized to its one line:
#
#   { "id": "gcloud", "type": "block", "size": { "px": 39 }, "content": { "mod": "gcloud" } }
{ buildMod }:
buildMod {
  dir = ./.;
  files = {
    "auth.js" = ./auth.js;
    "gcloud.svg" = ./gcloud.svg;
  };
}
