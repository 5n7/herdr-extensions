import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existingFile, searchFolders } from "./files";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pick-files-"));
  mkdirSync(join(root, "docs/dir.md"), { recursive: true });
  writeFileSync(join(root, "docs/a.md"), "# a");
});

afterAll(() => rmSync(root, { recursive: true }));

describe("searchFolders", () => {
  test("adds the repository's root after a folder inside it", () => {
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "src"));
    expect([searchFolders(join(repo, "src")), searchFolders(repo)]).toEqual([
      [join(repo, "src"), repo],
      [repo],
    ]);
  });

  test("keeps a folder outside a repository alone", () => {
    expect(searchFolders(join(root, "docs"))).toEqual([join(root, "docs")]);
  });
});

describe("existingFile", () => {
  test("resolves a path from the program's folder", () => {
    expect(existingFile("./a.md", [join(root, "docs")], "/home")).toBe(join(root, "docs/a.md"));
  });

  test("takes the first folder the file is in", () => {
    expect(existingFile("docs/a.md", [join(root, "docs"), root], "/home")).toBe(
      join(root, "docs/a.md"),
    );
  });

  test("keeps an absolute path", () => {
    expect(existingFile(join(root, "docs/a.md"), ["/elsewhere"], "/home")).toBe(
      join(root, "docs/a.md"),
    );
  });

  test("expands ~ to home", () => {
    expect(existingFile("~/docs/a.md", ["/elsewhere"], root)).toBe(join(root, "docs/a.md"));
  });

  test("drops an editor's line and column", () => {
    expect(existingFile("docs/a.md:12:5", [root], "/home")).toBe(join(root, "docs/a.md"));
  });

  test("gives nothing for a missing file, a folder, or a file taken for a folder", () => {
    expect(
      ["b.md", "docs/dir.md", "docs/a.md/b.md"].map((path) => existingFile(path, [root], "/home")),
    ).toEqual([null, null, null]);
  });
});
