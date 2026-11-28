import { test, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, computeRevision, createCodeEditor } from "./p06-search-exact-edit.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}

function makeTempDir(prefix = "p06-lab-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("p06 完整工具链 search_code -> read_file(分页) -> replace_lines 只改第二段重复块且逐轮回传结果", async () => {
  const dir = makeTempDir();
  try {
    const filler = Array.from({ length: 40 }, (_, i) => `// padding line ${i + 1}`);
    const dupBlock = [
      "function makePolicy() {",
      "  return { retries: 3, timeoutMs: 1000 };",
      "}",
    ];
    const lines = [
      "// header",
      ...dupBlock,
      ...filler,
      ...dupBlock,
      "// footer",
    ];
    const original = `${lines.join("\n")}\n`;
    writeFileSync(path.join(dir, "service.js"), original, "utf8");
    const initialRev = computeRevision(Buffer.from(original, "utf8"));

    // 第一段在第 2-4 行，第二段在第 45-47 行
    const editor = createCodeEditor({ cwd: dir });
    const messages = [{ role: "user", content: "把 service.js 里第二段 makePolicy 的 timeoutMs 改为 3000" }];

    await withFakeLlm(
      [
        toolReply("c1", "search_code", { query: "timeoutMs: 1000", path: "." }),
        toolReply("c2", "read_file", { path: "service.js", offset: 44, limit: 6 }),
        toolReply("c3", "replace_lines", {
          path: "service.js",
          start_line: 45,
          end_line: 47,
          revision: initialRev,
          expected_lines: dupBlock,
          replacement_lines: [
            "function makePolicy() {",
            "  return { retries: 3, timeoutMs: 3000 };",
            "}",
          ],
        }),
        { message: { role: "assistant", content: "已仅更新第二段重复代码块" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const answer = await agentLoop(messages, { editor });
        expect(answer).toBe("已仅更新第二段重复代码块");
        expect(requests).toHaveLength(4);

        const searchMsg = requests[1].messages.find((m) => m.tool_call_id === "c1");
        expect(searchMsg.content).toContain("service.js:3:");
        expect(searchMsg.content).toContain("service.js:46:");

        const readMsg = requests[2].messages.find((m) => m.tool_call_id === "c2");
        expect(readMsg.content).toContain(`revision=${initialRev}`);
        expect(readMsg.content).toContain("46 |   return { retries: 3, timeoutMs: 1000 };");

        const replaceMsg = requests[3].messages.find((m) => m.tool_call_id === "c3");
        expect(replaceMsg.content).toContain("Replaced service.js lines 45-47");

        const updatedLines = readFileSync(path.join(dir, "service.js"), "utf8").split("\n");
        // 第一段逐字节保持原样
        expect(updatedLines.slice(1, 4)).toEqual(dupBlock);
        // 第二段已被精准替换
        expect(updatedLines.slice(44, 47)).toEqual([
          "function makePolicy() {",
          "  return { retries: 3, timeoutMs: 3000 };",
          "}",
        ]);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p06 写前四重校验：拒绝未读/窗口外/非法行号/expected_lines不匹配/旧revision，重读后再改成功", () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, "target.js");
    const initial = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n";
    writeFileSync(filePath, initial, "utf8");
    const editor = createCodeEditor({ cwd: dir });
    const initialBytes = readFileSync(filePath);

    // 1. 未先 read_file 直接改：拒绝且磁盘零变更
    const noRead = editor.replaceLines({
      path: "target.js",
      start_line: 1,
      end_line: 1,
      revision: computeRevision(initialBytes),
      expected_lines: ["const line1 = 1;"],
      replacement_lines: ["const line1 = 99;"],
    });
    expect(noRead.ok).toBe(false);
    expect(noRead.error).toContain("call read_file");
    expect(readFileSync(filePath).equals(initialBytes)).toBe(true);

    // 仅读前 5 行
    const page1 = editor.readFile({ path: "target.js", offset: 1, limit: 5 });
    expect(page1.ok).toBe(true);
    expect(page1.hasMore).toBe(true);

    // 2. 编辑落在已读窗口之外（第 12 行）：拒绝
    const outOfWindow = editor.replaceLines({
      path: "target.js",
      start_line: 12,
      end_line: 12,
      revision: page1.revision,
      expected_lines: ["const line12 = 12;"],
      replacement_lines: ["const line12 = 120;"],
    });
    expect(outOfWindow.ok).toBe(false);
    expect(outOfWindow.error).toContain("outside read windows");

    // 3. 非法行号：start_line=0、start>end、越界行号
    expect(
      editor.replaceLines({
        path: "target.js",
        start_line: 0,
        end_line: 1,
        revision: page1.revision,
        expected_lines: ["a", "b"],
        replacement_lines: ["a"],
      }).ok,
    ).toBe(false);
    expect(
      editor.replaceLines({
        path: "target.js",
        start_line: 4,
        end_line: 2,
        revision: page1.revision,
        expected_lines: [],
        replacement_lines: [],
      }).ok,
    ).toBe(false);
    expect(
      editor.replaceLines({
        path: "target.js",
        start_line: 1,
        end_line: 99,
        revision: page1.revision,
        expected_lines: Array(99).fill("x"),
        replacement_lines: ["x"],
      }).ok,
    ).toBe(false);

    // 4. expected_lines 不匹配：拒绝
    const mismatch = editor.replaceLines({
      path: "target.js",
      start_line: 2,
      end_line: 2,
      revision: page1.revision,
      expected_lines: ["const line2 = 999;"],
      replacement_lines: ["const line2 = 200;"],
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toContain("expected_lines mismatch");
    expect(readFileSync(filePath).equals(initialBytes)).toBe(true);

    // 5. 外部改动磁盘导致 stale revision：拒绝且外部版本零变更
    const externalText = initial.replace("const line20 = 20;", "const line20 = 2000;");
    writeFileSync(filePath, externalText, "utf8");
    const externalBytes = readFileSync(filePath);
    const stale = editor.replaceLines({
      path: "target.js",
      start_line: 2,
      end_line: 2,
      revision: page1.revision,
      expected_lines: ["const line2 = 2;"],
      replacement_lines: ["const line2 = 200;"],
    });
    expect(stale.ok).toBe(false);
    expect(stale.error).toContain("stale revision");
    expect(readFileSync(filePath).equals(externalBytes)).toBe(true);

    // 6. 重读目标窗口拿到新 revision 后修改成功
    const fresh = editor.readFile({ path: "target.js", offset: 1, limit: 5 });
    expect(fresh.revision).not.toBe(page1.revision);
    const ok = editor.replaceLines({
      path: "target.js",
      start_line: 2,
      end_line: 2,
      revision: fresh.revision,
      expected_lines: ["const line2 = 2;"],
      replacement_lines: ["const line2 = 200;"],
    });
    expect(ok.ok).toBe(true);
    expect(readFileSync(filePath, "utf8")).toContain("const line2 = 200;");
    expect(readFileSync(filePath, "utf8")).toContain("const line20 = 2000;");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p06 search_code 稳定字典序、截断标志、跳过二进制/大文件/忽略目录，并拦截越界与外部 symlink", () => {
  const dir = makeTempDir("p06-search-");
  const outsideDir = makeTempDir("p06-outside-");
  try {
    mkdirSync(path.join(dir, "a"), { recursive: true });
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });

    // 故意按非字典序写入
    writeFileSync(path.join(dir, "z.js"), "const needle = 'z';\n");
    writeFileSync(path.join(dir, "a", "b.js"), "const needle = 'ab';\n");
    writeFileSync(path.join(dir, "a", "a.js"), "const needle = 'aa';\n");
    writeFileSync(path.join(dir, "m.js"), "const needle = 'm';\n");

    // 应被跳过的目录、二进制和大文件
    writeFileSync(path.join(dir, ".git", "hidden.txt"), "needle inside git\n");
    writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "needle inside nm\n");
    writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0xff]));
    writeFileSync(path.join(dir, "huge.txt"), `needle ${"x".repeat(4096)}\n`);

    // 工作区外哨兵文件 + 指向它的 symlink
    const secretFile = path.join(outsideDir, "secret.txt");
    writeFileSync(secretFile, "needle from outside secret\n");
    symlinkSync(secretFile, path.join(dir, "escape-link.txt"));

    const editor = createCodeEditor({ cwd: dir, maxFileBytes: 1024, maxLineBytes: 24 });

    // 稳定字典序 + 跳过忽略项与外部 symlink
    const full = editor.searchCode({ query: "needle" });
    expect(full.ok).toBe(true);
    expect(full.matches.map((m) => m.path)).toEqual(["a/a.js", "a/b.js", "m.js", "z.js"]);
    expect(full.skipped.binary).toBe(1);
    expect(full.skipped.tooLarge).toBe(1);
    expect(full.skipped.symlinkOutside).toBe(1);
    expect(full.truncated).toBe(false);

    // maxMatches 截断标志
    const capped = editor.searchCode({ query: "needle", maxMatches: 2 });
    expect(capped.ok).toBe(true);
    expect(capped.matches.map((m) => m.path)).toEqual(["a/a.js", "a/b.js"]);
    expect(capped.truncated).toBe(true);
    expect(capped.truncatedByMatches).toBe(true);
    expect(capped.text).toContain("truncated: true");

    // 单行多字节 UTF-8 超长截断标志（不产生乱码替换符 U+FFFD）
    writeFileSync(path.join(dir, "utf8.txt"), "中文标题前缀：needle 🚀🚀🚀 超长多字节内容继续延伸\n");
    const longLine = editor.searchCode({ query: "needle", path: "utf8.txt" });
    expect(longLine.ok).toBe(true);
    expect(longLine.truncated).toBe(true);
    expect(longLine.truncatedByLineBytes).toBe(true);
    expect(longLine.matches[0].lineTruncated).toBe(true);
    expect(longLine.matches[0].preview).not.toContain("�");
    expect(longLine.matches[0].preview.endsWith("...")).toBe(true);

    // 拦截 ../ 越界与直接访问工作区外 symlink
    expect(editor.searchCode({ query: "needle", path: "../" }).ok).toBe(false);
    expect(editor.readFile({ path: "../outside.txt" }).ok).toBe(false);
    expect(editor.readFile({ path: "escape-link.txt" }).ok).toBe(false);
    expect(editor.searchCode({ query: "needle", path: "escape-link.txt" }).ok).toBe(false);
    expect(
      editor.replaceLines({
        path: "escape-link.txt",
        start_line: 1,
        end_line: 1,
        revision: "000000000000",
        expected_lines: ["x"],
        replacement_lines: ["y"],
      }).ok,
    ).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("p06 保持 LF/CRLF 与有无末尾换行约定，并在写入前拒绝二进制文件或二进制输入", () => {
  const dir = makeTempDir("p06-eol-");
  try {
    const editor = createCodeEditor({ cwd: dir });
    const variants = [
      { name: "lf-trailing.txt", content: "a1\na2\na3\n", expected: "a1\nA2\na3\n" },
      { name: "lf-notrailing.txt", content: "a1\na2\na3", expected: "a1\nA2\na3" },
      { name: "crlf-trailing.txt", content: "a1\r\na2\r\na3\r\n", expected: "a1\r\nA2\r\na3\r\n" },
      { name: "crlf-notrailing.txt", content: "a1\r\na2\r\na3", expected: "a1\r\nA2\r\na3" },
    ];

    for (const v of variants) {
      const fullPath = path.join(dir, v.name);
      writeFileSync(fullPath, v.content, "utf8");
      const read = editor.readFile({ path: v.name, offset: 1, limit: 10 });
      expect(read.ok).toBe(true);
      const edit = editor.replaceLines({
        path: v.name,
        start_line: 2,
        end_line: 2,
        revision: read.revision,
        expected_lines: ["a2"],
        replacement_lines: ["A2"],
      });
      expect(edit.ok).toBe(true);
      expect(readFileSync(fullPath, "utf8")).toBe(v.expected);
    }

    // 写入前拒绝二进制目标文件（含 NUL 字节或非法 UTF-8 均零变更）
    const binPath = path.join(dir, "raw.bin");
    const binBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0xff]);
    writeFileSync(binPath, binBytes);
    expect(editor.readFile({ path: "raw.bin" }).ok).toBe(false);
    const editBin = editor.replaceLines({
      path: "raw.bin",
      start_line: 1,
      end_line: 1,
      revision: computeRevision(binBytes),
      expected_lines: ["x"],
      replacement_lines: ["y"],
    });
    expect(editBin.ok).toBe(false);
    expect(editBin.error).toContain("binary");
    expect(readFileSync(binPath).equals(binBytes)).toBe(true);

    const badUtf8Path = path.join(dir, "invalid-utf8.bin");
    const badUtf8Bytes = Buffer.from([0xc3, 0x28, 0xff, 0xfe]);
    writeFileSync(badUtf8Path, badUtf8Bytes);
    expect(editor.readFile({ path: "invalid-utf8.bin" }).ok).toBe(false);
    expect(readFileSync(badUtf8Path).equals(badUtf8Bytes)).toBe(true);

    // 写入前拒绝含 NUL 字节或裸换行的 replacement_lines（零变更）
    const txtPath = path.join(dir, "lf-trailing.txt");
    const before = readFileSync(txtPath);
    const reread = editor.readFile({ path: "lf-trailing.txt", offset: 1, limit: 10 });
    const badNul = editor.replaceLines({
      path: "lf-trailing.txt",
      start_line: 1,
      end_line: 1,
      revision: reread.revision,
      expected_lines: ["a1"],
      replacement_lines: ["bad\0bytes"],
    });
    expect(badNul.ok).toBe(false);
    expect(badNul.error).toContain("binary NUL");
    expect(readFileSync(txtPath).equals(before)).toBe(true);

    const badNewline = editor.replaceLines({
      path: "lf-trailing.txt",
      start_line: 1,
      end_line: 1,
      revision: reread.revision,
      expected_lines: ["a1"],
      replacement_lines: ["line1\nline2"],
    });
    expect(badNewline.ok).toBe(false);
    expect(badNewline.error).toContain("raw line breaks");
    expect(readFileSync(txtPath).equals(before)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
