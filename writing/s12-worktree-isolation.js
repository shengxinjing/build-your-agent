const fs = require("fs");
const path = require("path");
const {
  TaskBoard,
  WorktreeManager,
  appendJsonl,
  assert,
  cleanRuntime,
  ensureDir,
  initDemoRepo,
  loadEnv,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

function selfTest() {
  const runtimeDir = cleanRuntime("s12");
  const repoDir = path.join(runtimeDir, "repo");
  const taskDir = ensureDir(path.join(runtimeDir, "tasks"));
  const worktreeRoot = path.join(runtimeDir, "worktrees");
  const eventsPath = path.join(runtimeDir, "events.jsonl");

  initDemoRepo(repoDir);

  const board = new TaskBoard(taskDir);
  const authTask = board.create("Refactor auth flow");
  const uiTask = board.create("Build login UI");

  const worktrees = new WorktreeManager({
    repoDir,
    worktreeRoot,
    taskBoard: board,
  });

  const authWorktree = worktrees.create("auth-refactor", authTask.id);
  appendJsonl(eventsPath, {
    event: "worktree.create",
    taskId: authTask.id,
    name: authWorktree.name,
  });

  const uiWorktree = worktrees.create("ui-login", uiTask.id);
  appendJsonl(eventsPath, {
    event: "worktree.create",
    taskId: uiTask.id,
    name: uiWorktree.name,
  });

  writeText(path.join(authWorktree.path, "auth.txt"), "auth work\n");
  writeText(path.join(uiWorktree.path, "ui.txt"), "ui work\n");

  const removed = worktrees.remove("auth-refactor", { completeTask: true });
  appendJsonl(eventsPath, {
    event: "worktree.remove",
    taskId: authTask.id,
    name: removed.name,
  });

  const index = worktrees.list();
  const authTaskAfter = board.get(authTask.id);
  const uiTaskAfter = board.get(uiTask.id);

  assert(
    index.length === 2,
    "s12 self-test failed: worktree index does not contain both entries.",
  );
  assert(
    authTaskAfter.status === "completed",
    "s12 self-test failed: removing the worktree did not complete the task.",
  );
  assert(
    uiTaskAfter.status === "in_progress",
    "s12 self-test failed: active worktree did not update the task state.",
  );
  assert(
    fs.existsSync(eventsPath),
    "s12 self-test failed: event log was not written.",
  );

  console.log("[s12] self-test passed");
  console.log(JSON.stringify(index, null, 2));
}

if (require.main === module) {
  try {
    selfTest();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
