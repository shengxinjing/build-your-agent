import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { callLlm, colorLog, isMainModule, tool } from "./helper.js";

const SYSTEM = `You are a coding agent running commands inside a strict OS sandbox. Use run_sandboxed(cmd, args, timeoutMs) with explicit argv arrays (no shell). Never assume network access or host paths outside the workspace.`;

export const DEFAULT_ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ"];
const LINUX_RO_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"];
const MACOS_RO_DIRS = ["/System", "/usr", "/bin", "/sbin", "/Library", "/dev", "/private/etc", "/private/var/db", "/opt/homebrew"];
const DOCTOR_TOKEN = "SANDBOX_DOCTOR_OK";

const tools = [
  tool("run_sandboxed", "Run an executable inside the OS sandbox (argv-only, no shell, fail-closed).", {
    type: "object",
    properties: {
      cmd: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      timeoutMs: { type: "integer" },
    },
    required: ["cmd"],
  }),
];

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

function escapeSeatbelt(p) {
  if (/[\0\r\n]/.test(p)) throw new Error(`Invalid control character in sandbox path: ${p}`);
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getSafeRuntimeDirs(execPath) {
  if (!execPath) return [];
  const dirs = new Set();
  const forbidden = new Set([path.sep, os.homedir(), os.tmpdir()]);
  try { forbidden.add(realpathSync(os.tmpdir())); } catch {}
  let realBin = execPath;
  try { realBin = realpathSync(execPath); } catch {}
  for (const dir of [path.dirname(path.dirname(realBin)), path.dirname(execPath)]) {
    if (dir && !forbidden.has(dir)) dirs.add(dir);
  }
  return [...dirs];
}

export function buildMinimalEnv(sourceEnv = process.env, { workspaceReal, platform = process.platform, extraAllow = [] } = {}) {
  const env = {};
  for (const key of new Set([...DEFAULT_ENV_ALLOWLIST, ...extraAllow])) {
    if (typeof sourceEnv[key] === "string" && sourceEnv[key].length > 0) env[key] = sourceEnv[key];
  }
  if (!env.PATH) env.PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin";
  if (workspaceReal) {
    env.HOME = workspaceReal;
    env.TMPDIR = platform === "linux" ? "/tmp" : workspaceReal;
  }
  return env;
}

export function buildMacOsSeatbeltPolicy({ workspaceReal, readOnlyDirs = [], execPath = process.execPath }) {
  const roPaths = new Set([...MACOS_RO_DIRS, ...getSafeRuntimeDirs(execPath), ...readOnlyDirs]);
  const roLines = [...roPaths].map((p) => `  (subpath "${escapeSeatbelt(p)}")`).join("\n");
  const ws = escapeSeatbelt(workspaceReal);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow signal)",
    "(allow file-read-metadata)",
    "(allow file-map-executable)",
    "(allow file-read*",
    '  (literal "/")',
    roLines,
    `  (subpath "${ws}"))`,
    "(allow file-write*",
    `  (subpath "${ws}")`,
    '  (literal "/dev/null")',
    '  (literal "/dev/zero"))',
    "(deny network*)",
  ].join("\n");
}

export function buildBwrapArgs({ workspaceReal, readOnlyDirs = [], cmd, args = [], execPath = process.execPath, existsImpl = existsSync }) {
  const bwrapArgs = [];
  const bound = new Set();
  const addRoBind = (dir) => {
    if (!dir || bound.has(dir) || !existsImpl(dir)) return;
    bound.add(dir);
    bwrapArgs.push("--ro-bind", dir, dir);
  };
  for (const dir of LINUX_RO_DIRS) addRoBind(dir);
  for (const dir of getSafeRuntimeDirs(execPath)) {
    if (!LINUX_RO_DIRS.some((base) => dir === base || dir.startsWith(`${base}/`))) addRoBind(dir);
  }
  for (const dir of readOnlyDirs) addRoBind(dir);
  bwrapArgs.push(
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", workspaceReal, workspaceReal, "--chdir", workspaceReal,
    "--unshare-net", "--unshare-pid", "--die-with-parent",
    "--", cmd, ...args,
  );
  return bwrapArgs;
}

export function buildSandboxPlan({
  cwd = process.cwd(), cmd, args = [], platform = process.platform,
  readOnlyDirs = [], launcherOverride = null, execPath = process.execPath, existsImpl = existsSync,
} = {}) {
  if (typeof cmd !== "string" || !cmd.trim() || cmd.includes("\0")) {
    return { ok: false, status: "invalid_args", backend: null, error: "Error: cmd must be a non-empty string without NUL." };
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) {
    return { ok: false, status: "invalid_args", backend: null, error: "Error: args must be an array of strings without NUL." };
  }
  let workspaceReal;
  let roReal;
  try {
    workspaceReal = realpathSync(path.resolve(cwd));
    roReal = readOnlyDirs.map((d) => realpathSync(path.resolve(d)));
  } catch (error) {
    return { ok: false, status: "invalid_args", backend: null, error: `Error: invalid workspace/readOnlyDirs - ${error.message}` };
  }
  if (platform === "linux") {
    const launcher = launcherOverride || "bwrap";
    return { ok: true, backend: "bwrap", launcher, launcherArgs: buildBwrapArgs({ workspaceReal, readOnlyDirs: roReal, cmd, args, execPath, existsImpl }), workspaceReal };
  }
  if (platform === "darwin") {
    const launcher = launcherOverride || "/usr/bin/sandbox-exec";
    if (!launcherOverride && !existsImpl(launcher)) {
      return { ok: false, status: "sandbox_unavailable", reason: "not_installed", backend: "sandbox-exec", error: `Sandbox unavailable: ${launcher} not found.` };
    }
    const policy = buildMacOsSeatbeltPolicy({ workspaceReal, readOnlyDirs: roReal, execPath });
    return { ok: true, backend: "sandbox-exec", launcher, launcherArgs: ["-p", policy, "--", cmd, ...args], workspaceReal };
  }
  return {
    ok: false, status: "sandbox_unavailable", reason: "unsupported_platform", backend: null,
    error: `Sandbox unavailable on platform "${platform}" (fail-closed: refusing unsandboxed execution).`,
  };
}

function createCappedCollector(maxBytes) {
  let usedBytes = 0;
  let truncated = false;
  let output = "";
  const appendText = (text) => {
    if (!text || truncated) return;
    const textBytes = Buffer.byteLength(text, "utf8");
    if (usedBytes + textBytes <= maxBytes) {
      output += text;
      usedBytes += textBytes;
      return;
    }
    for (const ch of text) {
      const size = Buffer.byteLength(ch, "utf8");
      if (usedBytes + size > maxBytes) {
        truncated = true;
        return;
      }
      output += ch;
      usedBytes += size;
    }
  };
  return {
    createStreamHandler() {
      const dec = new StringDecoder("utf8");
      return { push: (chunk) => appendText(dec.write(chunk)), flush: () => appendText(dec.end()) };
    },
    result: () => ({ output, outputTruncated: truncated, outputBytes: usedBytes }),
  };
}

function killProcessTree(child, signal, useProcessGroup) {
  if (useProcessGroup && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try { child.kill?.(signal); } catch {}
}

function formatRunText(res) {
  const head = `[sandbox:${res.backend || "none"}] status=${res.status}${res.exitCode != null ? ` exit=${res.exitCode}` : ""}${res.outputTruncated ? " outputTruncated=true" : ""}`;
  return `${head}\n${res.output || res.error || "(no output)"}`;
}

export function createSandboxRunner({
  cwd = process.cwd(), platform = process.platform, readOnlyDirs = [], defaultTimeoutMs = 10000,
  maxOutputBytes = 16 * 1024, killGraceMs = 150, envSource = process.env, extraEnvAllow = [],
  launcherOverride = null, spawnImpl = spawn, existsImpl = existsSync, execPath = process.execPath,
} = {}) {
  const runSandboxed = ({ cmd, args = [], timeoutMs = defaultTimeoutMs } = {}) => {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      const res = { ok: false, status: "invalid_args", backend: null, exitCode: null, signal: null, output: "", outputTruncated: false, error: "Error: timeoutMs must be an integer >= 1." };
      return Promise.resolve({ ...res, text: formatRunText(res) });
    }
    const plan = buildSandboxPlan({ cwd, cmd, args, platform, readOnlyDirs, launcherOverride, execPath, existsImpl });
    if (!plan.ok) {
      const res = { ...plan, exitCode: null, signal: null, output: "", outputTruncated: false };
      return Promise.resolve({ ...res, text: formatRunText(res) });
    }
    const env = buildMinimalEnv(envSource, { workspaceReal: plan.workspaceReal, platform, extraAllow: extraEnvAllow });
    const useProcessGroup = spawnImpl === spawn && process.platform !== "win32";

    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(plan.launcher, plan.launcherArgs, {
          cwd: plan.workspaceReal, env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: useProcessGroup,
        });
      } catch (error) {
        const missing = error?.code === "ENOENT";
        const res = {
          ok: false, status: missing ? "sandbox_unavailable" : "launch_failed",
          reason: missing ? "not_installed" : "spawn_error", backend: plan.backend,
          exitCode: null, signal: null, output: "", outputTruncated: false,
          error: `Sandbox launch failed (${plan.launcher}): ${error.message}`,
        };
        return resolve({ ...res, text: formatRunText(res) });
      }

      const collector = createCappedCollector(maxOutputBytes);
      const outStream = collector.createStreamHandler();
      const errStream = collector.createStreamHandler();
      let settled = false;
      let timedOut = false;
      let timeoutTimer = null;
      let killTimer = null;
      let fallbackTimer = null;

      const clearTimers = () => {
        for (const t of [timeoutTimer, killTimer, fallbackTimer]) if (t) clearTimeout(t);
        timeoutTimer = killTimer = fallbackTimer = null;
      };

      const finish = (partial) => {
        if (settled) return;
        settled = true;
        clearTimers();
        outStream.flush();
        errStream.flush();
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
        child.removeAllListeners();
        child.on?.("error", () => {});
        const res = { backend: plan.backend, ...collector.result(), ...partial };
        resolve({ ...res, text: formatRunText(res) });
      };

      child.stdout?.on("data", (chunk) => outStream.push(chunk));
      child.stderr?.on("data", (chunk) => errStream.push(chunk));
      child.on("error", (error) => {
        const missing = error?.code === "ENOENT";
        finish({
          ok: false, status: missing ? "sandbox_unavailable" : "launch_failed",
          reason: missing ? "not_installed" : "spawn_error", exitCode: null, signal: null,
          error: `Sandbox launcher error (${plan.launcher}): ${error.message}`,
        });
      });

      child.on("close", (code, signal) => {
        if (timedOut) {
          killProcessTree(child, "SIGKILL", useProcessGroup);
          return finish({ ok: false, status: "timeout", exitCode: code, signal: signal || "SIGKILL", error: `Command timed out after ${timeoutMs}ms (process tree terminated).` });
        }
        const ok = code === 0 && !signal;
        finish({ ok, status: ok ? "ok" : "command_failed", exitCode: code, signal: signal || null, error: ok ? null : `Command exited with code=${code}${signal ? ` signal=${signal}` : ""}.` });
      });

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killProcessTree(child, "SIGTERM", useProcessGroup);
        killTimer = setTimeout(() => {
          if (settled) return;
          killProcessTree(child, "SIGKILL", useProcessGroup);
          child.stdout?.destroy?.();
          child.stderr?.destroy?.();
          fallbackTimer = setTimeout(() => {
            finish({ ok: false, status: "timeout", exitCode: null, signal: "SIGKILL", error: `Command timed out after ${timeoutMs}ms (process tree terminated).` });
          }, Math.max(50, killGraceMs));
          fallbackTimer.unref?.();
        }, killGraceMs);
        killTimer.unref?.();
      }, timeoutMs);
      timeoutTimer.unref?.();
    });
  };

  const doctor = async () => {
    const probe = await runSandboxed({ cmd: execPath, args: ["-e", `process.stdout.write("${DOCTOR_TOKEN}")`], timeoutMs: 5000 });
    if (probe.ok && probe.output.includes(DOCTOR_TOKEN)) {
      return { ok: true, status: "available", backend: probe.backend, detail: `Sandbox backend "${probe.backend}" passed live probe.` };
    }
    if (probe.status === "sandbox_unavailable") {
      return { ok: false, status: probe.reason || "not_installed", backend: probe.backend, detail: probe.error };
    }
    return { ok: false, status: "blocked_by_env", backend: probe.backend, detail: (probe.output || probe.error || "Probe failed").trim() };
  };

  return { runSandboxed, doctor };
}

export async function agentLoop(messages, { runner = createSandboxRunner() } = {}) {
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) return message.content || "";
    messages.push(message);
    for (const call of message.tool_calls) {
      const parsed = safeParseArgs(call.function.arguments);
      let output;
      if (!parsed.ok) output = parsed.error;
      else if (call.function.name === "run_sandboxed") output = (await runner.runSandboxed(parsed.value)).text;
      else output = `Unknown tool: ${call.function.name}`;
      colorLog("cyan", `> ${call.function.name}: ${String(output).slice(0, 140)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  const runner = createSandboxRunner();
  if (process.argv.includes("--doctor")) {
    const report = await runner.doctor();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const messages = [];
  console.log("p07 OS Sandbox & Supervised Shell 演示：argv 隔离 + Fail-Closed 沙箱，支持 --doctor，输入 q 退出。\n");
  try {
    while (true) {
      let input;
      try {
        input = (await rl.question("p07 >> ")).trim();
      } catch {
        break;
      }
      if (!input) continue;
      if (input === "q" || input === "exit") break;
      messages.push({ role: "user", content: input });
      const answer = await agentLoop(messages, { runner });
      messages.push({ role: "assistant", content: answer });
      console.log(`\n${answer}\n`);
    }
  } finally {
    rl.close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
