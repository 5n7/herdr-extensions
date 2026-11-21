import { describe, expect, test } from "bun:test";
import { findOpenable, findTokens, isWebUrl } from "./tokens";

describe("findTokens", () => {
  test("ends URLs at Japanese punctuation and the text after them", () => {
    expect(
      texts([
        "詳細はhttps://example.com/a_(b)。次は、https://github.com/5n7/dotfiles/pull/12、です",
      ]),
    ).toEqual(["https://example.com/a_(b)", "https://github.com/5n7/dotfiles/pull/12"]);
  });

  test("leaves out what a sentence or a bracket adds to a URL", () => {
    expect(
      texts(["see (https://a.test/path). <https://b.test/x?y=1&z=2>, [x](https://c.test)"]),
    ).toEqual(["https://a.test/path", "https://b.test/x?y=1&z=2", "https://c.test"]);
  });

  test("includes git remotes", () => {
    expect(texts(["git@github.com:5n7/dotfiles.git ssh://host/repo"])).toEqual([
      "git@github.com:5n7/dotfiles.git",
      "ssh://host/repo",
    ]);
  });

  test("keeps an editor's line and column on a path, not the sentence's period", () => {
    expect(texts(["at ./src/x.ts:12:5 and ~/src/github.com/5n7, see src/main.rs."])).toEqual([
      "./src/x.ts:12:5",
      "~/src/github.com/5n7",
      "src/main.rs",
    ]);
  });

  test("drops an ellipsis a bracket or comma follows, and a bare slash", () => {
    expect(texts(["(https://a.test/dir/...) https://b.test/dir/..., see /... here"])).toEqual([
      "https://a.test/dir/",
      "https://b.test/dir/",
    ]);
  });

  test("keeps a .. segment, but not a sentence's period or ellipsis", () => {
    expect(
      texts(["cd ../.. then ~/foo/.. or src/a.ts... See https://a.test/docs/. or dir/..."]),
    ).toEqual(["../..", "~/foo/..", "src/a.ts", "https://a.test/docs/", "dir/"]);
  });

  test("keeps a host and its port before the path", () => {
    expect(texts(["curl localhost:8080/health or 127.0.0.1:3000/api/v1."])).toEqual([
      "localhost:8080/health",
      "127.0.0.1:3000/api/v1",
    ]);
  });

  test("takes a diff's path without its a/ or b/", () => {
    expect(texts(["--- a/src/main.rs", "+++ b/src/lib.rs"])).toEqual(["src/main.rs", "src/lib.rs"]);
  });

  test("tells commits from words and numbers", () => {
    expect(texts(["commit 4ea006d defaced 1234567"])).toEqual(["4ea006d", "1234567"]);
  });

  test("finds UUIDs, addresses and long numbers", () => {
    expect(
      texts(["id 123e4567-e89b-12d3-a456-426614174000 at 192.168.1.10:8080 pid 48213 of 12"]),
    ).toEqual(["123e4567-e89b-12d3-a456-426614174000", "192.168.1.10:8080", "48213"]);
  });

  test("prefers a URL over the path and numbers inside it", () => {
    expect(texts(["open https://example.com/src/12345/main.rs"])).toEqual([
      "https://example.com/src/12345/main.rs",
    ]);
  });

  test("prefers a path over the address and numbers inside it", () => {
    expect(texts(["route 10.0.0.0/8 via /proc/12345/status"])).toEqual([
      "10.0.0.0/8",
      "/proc/12345/status",
    ]);
  });

  test("places a captured path where it sits in its line", () => {
    expect(findTokens(["+++ b/a/b.ts"])).toEqual([{ line: 0, start: 6, text: "a/b.ts" }]);
  });
});

describe("findOpenable", () => {
  test("finds URLs and files with an extension, bare, relative, absolute and under home", () => {
    expect(
      texts(
        ["https://a.test README.md, ./docs/a.markdown ../x/main.rs /tmp/b.md ~/.zshrc ~/c.md."],
        findOpenable,
      ),
    ).toEqual([
      "https://a.test",
      "README.md",
      "./docs/a.markdown",
      "../x/main.rs",
      "/tmp/b.md",
      "~/.zshrc",
      "~/c.md",
    ]);
  });

  test("leaves out words, numbers, versions and folders", () => {
    expect(texts(["see 1.5 v1.2 12345 src/ docs/api"], findOpenable)).toEqual([]);
  });

  test("keeps an editor's line and column on a file", () => {
    expect(texts(["at docs/a.md:12:5 and b.ts:3"], findOpenable)).toEqual([
      "docs/a.md:12:5",
      "b.ts:3",
    ]);
  });

  test("takes a file's whole name, extensions and all", () => {
    expect(texts(["a.mdx b.md.bak c.md/d.ts"], findOpenable)).toEqual([
      "a.mdx",
      "b.md.bak",
      "c.md/d.ts",
    ]);
  });

  test("takes a diff's file without its a/ or b/", () => {
    expect(texts(["--- a/docs/a.md", "+++ b/src/x.ts"], findOpenable)).toEqual([
      "docs/a.md",
      "src/x.ts",
    ]);
  });

  test("takes a URL whole, not the file at its end", () => {
    expect(
      texts(["https://github.com/o/r/blob/main/README.md ssh://host/x.md"], findOpenable),
    ).toEqual(["https://github.com/o/r/blob/main/README.md", "ssh://host/x.md"]);
  });

  test("ends a file at brackets and quotes", () => {
    expect(texts(["[a](docs/a.md) `b.md` 'c.md'"], findOpenable)).toEqual([
      "docs/a.md",
      "b.md",
      "c.md",
    ]);
  });
});

describe("isWebUrl", () => {
  test("tells a browser's URL from a path", () => {
    expect([isWebUrl("HTTPS://a.test"), isWebUrl("docs/a.md")]).toEqual([true, false]);
  });
});

function texts(lines: string[], find = findTokens): string[] {
  return find(lines).map((t) => t.text);
}
