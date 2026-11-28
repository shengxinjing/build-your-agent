import { test, expect } from "vitest";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  buildMinimalEnv,
  buildSandboxPlan,
  createSandboxRunner,
} from "./p07-os-sandbox-shell.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}

function makeTempDir(prefix = "p07-lab-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 424242;
  child.kills = [];
  child.kill = (sig) => {
    child.kills.push(sig);
    return true;
  };
  return child;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForPidExit(pid, maxWaitMs = 600) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isPidAlive(pid);
}

test("p07 withFakeLlm + 假 launcher 覆盖成功/命令失败/启动失败/sandbox_unavailable，且绝不降级直接 spawn 目标命令", async () => {
  const dir = makeTempDir();
  try {
    const spawnedCalls = [];
    const scenarios = [
      // 1. 成功
      (child) => {
        queueMicrotask(() => {
          child.stdout.write("all tests passed\n");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
      },
      // 2. 命令失败（非 0 退出码）
      (child) => {
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.write("AssertionError: expected 1 to be 2\n");
          child.stderr.end();
          child.emit("close", 2, null);
        });
      },
      // 3. 启动失败（EACCES）
      (child) => {
        queueMicrotask(() => child.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" })));
      },
      // 4. 沙箱未安装（ENOENT -> sandbox_unavailable）
      (child) => {
        queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn bwrap ENOENT"), { code: "ENOENT" })));
      },
    ];

    const fakeSpawn = (bin, argv, opts) => {
      spawnedCalls.push({ bin, argv, opts });
      const child = createFakeChild();
      const run = scenarios.shift();
      run(child);
      return child;
    };

    const linuxRunner = createSandboxRunner({
      cwd: dir,
      platform: "linux",
      spawnImpl: fakeSpawn,
      existsImpl: () => true,
    });

    const messages = [{ role: "user", content: "依次运行四条命令测试沙箱反馈" }];
    await withFakeLlm(
      [
        toolReply("c1", "run_sandboxed", { cmd: "node", args: ["-v"] }),
        toolReply("c2", "run_sandboxed", { cmd: "node", args: ["fail.js"] }),
        toolReply("c3", "run_sandboxed", { cmd: "echo", args: ["launch-err"] }),
        toolReply("c4", "run_sandboxed", { cmd: "echo", args: ["no-bwrap"] }),
        { message: { role: "assistant", content: "四类沙箱结果均已处理" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const answer = await agentLoop(messages, { runner: linuxRunner });
        expect(answer).toBe("四类沙箱结果均已处理");
        expect(requests).toHaveLength(5);

        expect(requests[1].messages.find((m) => m.tool_call_id === "c1").content).toContain("status=ok");
        expect(requests[1].messages.find((m) => m.tool_call_id === "c1").content).toContain("all tests passed");

        expect(requests[2].messages.find((m) => m.tool_call_id === "c2").content).toContain("status=command_failed exit=2");
        expect(requests[2].messages.find((m) => m.tool_call_id === "c2").content).toContain("AssertionError");

        expect(requests[3].messages.find((m) => m.tool_call_id === "c3").content).toContain("status=launch_failed");
        expect(requests[4].messages.find((m) => m.tool_call_id === "c4").content).toContain("status=sandbox_unavailable");
      },
    );

    // 关键安全断言：每次 spawn 调用的第一个参数都是沙箱启动器 bwrap，绝不是目标命令 node/echo
    expect(spawnedCalls).toHaveLength(4);
    expect(spawnedCalls.every((c) => c.bin === "bwrap" && c.opts.shell === false)).toBe(true);

    // Windows / 不支持平台：严格 Fail-Closed，根本不调用 spawnImpl
    const winCalls = [];
    const winRunner = createSandboxRunner({
      cwd: dir,
      platform: "win32",
      spawnImpl: (...a) => {
        winCalls.push(a);
        return createFakeChild();
      },
    });
    const winRes = await winRunner.runSandboxed({ cmd: "cmd.exe", args: ["/c", "dir"] });
    expect(winRes.ok).toBe(false);
    expect(winRes.status).toBe("sandbox_unavailable");
    expect(winCalls).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p07 参数隔离、环境变量最小白名单、双流 UTF-8 安全字节上限与 --doctor 状态分类", async () => {
  const dir = makeTempDir();
  try {
    // 1. 启动器参数隔离：模型传入 --bind / -p 等旗标只能落在 -- 之后
    const bwrapPlan = buildSandboxPlan({
      cwd: dir,
      platform: "linux",
      cmd: "--bind",
      args: ["/", "/host", "--unshare-net", "; rm -rf /"],
      existsImpl: () => true,
    });
    expect(bwrapPlan.ok).toBe(true);
    const ddIdx = bwrapPlan.launcherArgs.indexOf("--");
    expect(ddIdx).toBeGreaterThan(0);
    const hostFlags = bwrapPlan.launcherArgs.slice(0, ddIdx);
    const guestArgv = bwrapPlan.launcherArgs.slice(ddIdx + 1);
    expect(hostFlags).toContain("--unshare-net");
    expect(hostFlags).toContain("--unshare-pid");
    expect(hostFlags).toContain("--die-with-parent");
    expect(guestArgv).toEqual(["--bind", "/", "/host", "--unshare-net", "; rm -rf /"]);

    const macPlan = buildSandboxPlan({
      cwd: dir,
      platform: "darwin",
      cmd: "-p",
      args: ["(allow default)", "evil"],
      existsImpl: () => true,
    });
    expect(macPlan.ok).toBe(true);
    expect(macPlan.launcherArgs[0]).toBe("-p");
    expect(macPlan.launcherArgs[1]).toContain("(deny default)");
    expect(macPlan.launcherArgs[1]).toContain("(deny network*)");
    expect(macPlan.launcherArgs[2]).toBe("--");
    expect(macPlan.launcherArgs.slice(3)).toEqual(["-p", "(allow default)", "evil"]);

    // 2. 环境变量最小白名单：剥离宿主密钥
    const minEnv = buildMinimalEnv(
      {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        API_KEY: "demo-secret-value",
        LLM_API_TOKEN: "demo-token-value",
        AWS_SECRET_ACCESS_KEY: "demo-aws-value",
        PRIVATE_TOKEN: "demo-private",
      },
      { workspaceReal: dir, platform: "linux" },
    );
    expect(minEnv.PATH).toBe("/usr/bin:/bin");
    expect(minEnv.LANG).toBe("en_US.UTF-8");
    expect(minEnv.HOME).toBe(dir);
    expect(minEnv.TMPDIR).toBe("/tmp");
    expect(minEnv.API_KEY).toBeUndefined();
    expect(minEnv.LLM_API_TOKEN).toBeUndefined();
    expect(minEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(minEnv.PRIVATE_TOKEN).toBeUndefined();

    // 3. 双流共享字节上限 + 多字节 UTF-8 跨分片截断不乱码
    const capRunner = createSandboxRunner({
      cwd: dir,
      platform: "linux",
      maxOutputBytes: 14,
      existsImpl: () => true,
      spawnImpl: (_bin, _argv, opts) => {
        expect(opts.env.API_KEY).toBeUndefined();
        const child = createFakeChild();
        queueMicrotask(() => {
          const zh = Buffer.from("中文", "utf8"); // 6 bytes
          // 故意把“中”拆成跨 chunk 发送，测试 StringDecoder 完整拼接
          child.stdout.write(zh.subarray(0, 2));
          child.stdout.write(zh.subarray(2));
          // stderr 再输出 emoji（4 bytes x 3 = 12 bytes），与 stdout 共享 14 字节上限
          child.stderr.write(Buffer.from("🚀🔥🎉", "utf8"));
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
        return child;
      },
      envSource: { PATH: "/usr/bin:/bin", API_KEY: "must-not-leak" },
    });
    const capRes = await capRunner.runSandboxed({ cmd: "echo", args: ["utf8"] });
    expect(capRes.ok).toBe(true);
    expect(capRes.outputTruncated).toBe(true);
    expect(Buffer.byteLength(capRes.output, "utf8")).toBeLessThanOrEqual(14);
    expect(capRes.output).toBe("中文🚀🔥"); // 6 + 4 + 4 = 14 bytes，精确不截断半个字符
    expect(capRes.output).not.toContain("�");

    // 4. --doctor 区分 available / not_installed / blocked_by_env / unsupported_platform
    const docAvail = await createSandboxRunner({
      cwd: dir,
      platform: "linux",
      existsImpl: () => true,
      spawnImpl: () => {
        const c = createFakeChild();
        queueMicrotask(() => {
          c.stdout.end("SANDBOX_DOCTOR_OK");
          c.emit("close", 0, null);
        });
        return c;
      },
    }).doctor();
    expect(docAvail).toMatchObject({ ok: true, status: "available", backend: "bwrap" });

    const docMissing = await createSandboxRunner({
      cwd: dir,
      platform: "linux",
      existsImpl: () => true,
      spawnImpl: () => {
        const c = createFakeChild();
        queueMicrotask(() => c.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })));
        return c;
      },
    }).doctor();
    expect(docMissing).toMatchObject({ ok: false, status: "not_installed", backend: "bwrap" });

    const docBlocked = await createSandboxRunner({
      cwd: dir,
      platform: "linux",
      existsImpl: () => true,
      spawnImpl: () => {
        const c = createFakeChild();
        queueMicrotask(() => {
          c.stderr.end("bwrap: Creating new namespace failed: Operation not permitted\n");
          c.emit("close", 1, null);
        });
        return c;
      },
    }).doctor();
    expect(docBlocked).toMatchObject({ ok: false, status: "blocked_by_env", backend: "bwrap" });

    const docWin = await createSandboxRunner({ cwd: dir, platform: "win32" }).doctor();
    expect(docWin).toMatchObject({ ok: false, status: "unsupported_platform", backend: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p07 超时级联清理子孙进程，且超时与正常退出竞态时仅完成一次无残留句柄", async () => {
  const dir = makeTempDir();
  try {
    // Part A: 真实可控子进程 + fork 孙进程（用轻量 POSIX sh shim 充当 launcher，离线跨环境可运行）
    if (process.platform !== "win32") {
      const shimPath = path.join(dir, "shim-launcher.sh");
      writeFileSync(
        shimPath,
        [
          "#!/bin/sh",
          'while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done',
          "shift",
          'exec "$@"',
        ].join("\n") + "\n",
        "utf8",
      );
      chmodSync(shimPath, 0o755);

      const pidFile = path.join(dir, "pids.json");
      const targetScript = [
        `const { spawn } = require("node:child_process");`,
        `const fs = require("node:fs");`,
        `const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
        `fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ child: process.pid, grand: grand.pid }));`,
        `setInterval(() => {}, 1000);`,
      ].join(" ");

      const runner = createSandboxRunner({
        cwd: dir,
        platform: process.platform === "darwin" ? "darwin" : "linux",
        launcherOverride: shimPath,
        killGraceMs: 80,
      });

      const res = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", targetScript],
        timeoutMs: 500,
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe("timeout");
      expect(existsSync(pidFile)).toBe(true);

      const { child: childPid, grand: grandPid } = JSON.parse(readFileSync(pidFile, "utf8"));
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(await waitForPidExit(grandPid)).toBe(true);
    }

    // Part B: 超时与正常退出竞态 - 仅 resolve 一次、无未捕获异常、流已销毁
    let fakeChild;
    let resolveCount = 0;
    const raceRunner = createSandboxRunner({
      cwd: dir,
      platform: "linux",
      existsImpl: () => true,
      killGraceMs: 20,
      spawnImpl: () => {
        fakeChild = createFakeChild();
        setTimeout(() => {
          fakeChild.emit("close", 0, null);
          // 模拟竞态后的重复 close 和迟到 error
          fakeChild.emit("close", 1, "SIGKILL");
          fakeChild.emit("error", new Error("late error after settle"));
        }, 25);
        return fakeChild;
      },
    });

    const raceRes = await raceRunner.runSandboxed({ cmd: "node", args: ["-v"], timeoutMs: 25 }).then((r) => {
      resolveCount += 1;
      return r;
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(resolveCount).toBe(1);
    expect(["ok", "timeout"]).toContain(raceRes.status);
    expect(fakeChild.stdout.destroyed).toBe(true);
    expect(fakeChild.stderr.destroyed).toBe(true);

    // 正常快速退出后，超时定时器已被清理，绝不误杀
    let fastChild;
    const fastRunner = createSandboxRunner({
      cwd: dir,
      platform: "linux",
      existsImpl: () => true,
      spawnImpl: () => {
        fastChild = createFakeChild();
        queueMicrotask(() => fastChild.emit("close", 0, null));
        return fastChild;
      },
    });
    const fastRes = await fastRunner.runSandboxed({ cmd: "echo", args: ["fast"], timeoutMs: 30 });
    await new Promise((r) => setTimeout(r, 60));
    expect(fastRes.status).toBe("ok");
    expect(fastChild.kills).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 默认跳过并标明 unverified，避免离线环境假绿；设置 P07_REAL_SANDBOX=1 运行真实 OS 沙箱拦截验证
const REAL_SANDBOX_ENABLED = process.env.P07_REAL_SANDBOX === "1";
const realSandboxTest = REAL_SANDBOX_ENABLED ? test : test.skip;

realSandboxTest(
  "p07 [opt-in P07_REAL_SANDBOX=1 | unverified when skipped] 真实 OS 沙箱拦截与宿主正对照",
  async () => {
    const workspace = makeTempDir("p07-real-ws-");
    const roDir = makeTempDir("p07-real-ro-");
    const outsideDir = makeTempDir("p07-real-out-");
    const server = net.createServer((socket) => {
      socket.end("LOOPBACK_OK");
    });

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;

      const roSeed = path.join(roDir, "seed.txt");
      writeFileSync(roSeed, "RO_SEED_OK", "utf8");
      const sentinelFile = path.join(outsideDir, "sentinel.txt");
      writeFileSync(sentinelFile, "TOP_SECRET_SENTINEL", "utf8");

      const runner = createSandboxRunner({
        cwd: workspace,
        readOnlyDirs: [roDir],
        killGraceMs: 80,
      });

      // 0. 真实 --doctor 探针必须通过
      const doc = await runner.doctor();
      expect(doc.ok).toBe(true);
      expect(doc.status).toBe("available");

      // 1. 宿主正对照 + 沙箱：工作区可写
      writeFileSync(path.join(workspace, "host.txt"), "host-ok", "utf8");
      const wsWrite = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync("sandbox.txt", "sandbox-ok"); console.log("WS_OK");`],
      });
      expect(wsWrite.ok).toBe(true);
      expect(readFileSync(path.join(workspace, "sandbox.txt"), "utf8")).toBe("sandbox-ok");

      // 2. 宿主正对照 + 沙箱：只读目录可读但不可写
      const hostRoFile = path.join(roDir, "host-wrote.txt");
      writeFileSync(hostRoFile, "host-can-write", "utf8");
      expect(existsSync(hostRoFile)).toBe(true);

      const roRead = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", `console.log(require("node:fs").readFileSync(${JSON.stringify(roSeed)}, "utf8"));`],
      });
      expect(roRead.ok).toBe(true);
      expect(roRead.output).toContain("RO_SEED_OK");

      const roTarget = path.join(roDir, "sandbox-blocked.txt");
      const roWrite = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(roTarget)}, "nope");`],
      });
      expect(roWrite.ok).toBe(false);
      expect(existsSync(roTarget)).toBe(false);

      // 3. 宿主正对照 + 沙箱：工作区外哨兵文件不可读
      expect(readFileSync(sentinelFile, "utf8")).toBe("TOP_SECRET_SENTINEL");
      const readSentinel = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", `console.log(require("node:fs").readFileSync(${JSON.stringify(sentinelFile)}, "utf8"));`],
      });
      expect(readSentinel.ok).toBe(false);
      expect(readSentinel.output).not.toContain("TOP_SECRET_SENTINEL");

      // 4. 宿主正对照 + 沙箱：本机回环监听不可连
      const hostLoopback = await new Promise((resolve, reject) => {
        const sock = net.connect(port, "127.0.0.1");
        let data = "";
        sock.on("data", (d) => (data += d.toString()));
        sock.on("end", () => resolve(data));
        sock.on("error", reject);
      });
      expect(hostLoopback).toBe("LOOPBACK_OK");

      const netScript = [
        `const net = require("node:net");`,
        `const s = net.connect(${port}, "127.0.0.1");`,
        `s.on("data", (d) => { process.stdout.write(d); s.end(); });`,
        `s.on("error", (e) => { console.error(e.code || e.message); process.exit(3); });`,
      ].join(" ");
      const netRes = await runner.runSandboxed({ cmd: process.execPath, args: ["-e", netScript], timeoutMs: 3000 });
      expect(netRes.ok).toBe(false);
      expect(netRes.output).not.toContain("LOOPBACK_OK");

      // 5. 真实沙箱内超时：fork 孙进程被级联清理
      const grandPidFile = path.join(workspace, "grand-real.pid");
      const forkScript = [
        `const { spawn } = require("node:child_process");`,
        `const fs = require("node:fs");`,
        `const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
        `fs.writeFileSync(${JSON.stringify(grandPidFile)}, String(g.pid));`,
        `setInterval(() => {}, 1000);`,
      ].join(" ");
      const timeoutRes = await runner.runSandboxed({
        cmd: process.execPath,
        args: ["-e", forkScript],
        timeoutMs: 500,
      });
      expect(timeoutRes.ok).toBe(false);
      expect(timeoutRes.status).toBe("timeout");
      const grandPid = Number(readFileSync(grandPidFile, "utf8").trim());
      expect(grandPid).toBeGreaterThan(0);
      expect(await waitForPidExit(grandPid)).toBe(true);
    } finally {
      server.close();
      rmSync(workspace, { recursive: true, force: true });
      rmSync(roDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  },
  15000,
);
