const fs = require("fs");
const path = require("path");
const {
  TaskBoard,
  assert,
  cleanRuntime,
  ensureDir,
  loadEnv,
  safeJoin,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

function performTask(workerName, task, workspaceDir) {
  const outputPath = safeJoin(workspaceDir, `done/${task.id}.txt`);
  writeText(outputPath, `${workerName} completed ${task.title}\n`);
}

function runAutonomousTeam({ board, workspaceDir, workers }) {
  let progress = true;

  while (progress) {
    progress = false;

    for (const worker of workers) {
      const claimed = board.claimNext(worker);
      if (!claimed) {
        continue;
      }

      progress = true;
      performTask(worker, claimed, workspaceDir);
      board.update(claimed.id, { status: "completed" });
    }
  }
}

function selfTest() {
  const runtimeDir = cleanRuntime("s11");
  const boardDir = ensureDir(path.join(runtimeDir, "tasks"));
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));
  const board = new TaskBoard(boardDir);

  const setup = board.create("Setup project");
  const backend = board.create("Build backend", { blockedBy: [setup.id] });
  const frontend = board.create("Build frontend", { blockedBy: [setup.id] });
  board.create("Run QA", { blockedBy: [backend.id, frontend.id] });

  runAutonomousTeam({
    board,
    workspaceDir,
    workers: ["alice", "bob"],
  });

  const tasks = board.list();
  assert(
    tasks.every((task) => task.status === "completed"),
    "s11 self-test failed: not all tasks were completed.",
  );
  assert(
    tasks.every((task) => task.owner),
    "s11 self-test failed: some tasks were completed without an owner.",
  );
  assert(
    fs.existsSync(path.join(workspaceDir, "done", "task-001.txt")),
    "s11 self-test failed: task output files are missing.",
  );

  console.log("[s11] self-test passed");
  console.log(board.render());
}

if (require.main === module) {
  try {
    selfTest();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
