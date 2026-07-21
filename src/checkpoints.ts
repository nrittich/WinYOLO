import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type CheckpointStatus = "prepared" | "running" | "completed" | "interrupted" | "accepted" | "rolled_back" | "failed";

export interface CheckpointRecord {
  schema: 2;
  id: string;
  runId: string;
  sourceRoot: string;
  sourceCwd: string;
  workspace: string;
  workspaceCwd: string;
  branch: string;
  baselineCommit: string;
  sourceStateHash: string;
  patchPath: string;
  finalDiffHash: string | null;
  status: CheckpointStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CommandResult { code: number; stdout: string; stderr: string }
export type CommandRunner = (command: string[], cwd: string) => Promise<CommandResult>;

export function resolveGitExecutable(
  which: (name: string) => string | null = Bun.which,
  pathExists: (path: string) => boolean = existsSync,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromPath = which("git.exe") ?? which("git");
  if (fromPath) return fromPath;
  const programRoots = [environment.ProgramFiles, environment["ProgramFiles(x86)"], environment.SystemDrive ? join(environment.SystemDrive, "Program Files") : null]
    .filter((value): value is string => Boolean(value));
  for (const root of programRoots) {
    for (const relativePath of [["Git", "cmd", "git.exe"], ["Git", "bin", "git.exe"]]) {
      const candidate = join(root, ...relativePath);
      if (pathExists(candidate)) return candidate;
    }
  }
  return null;
}

async function defaultRunner(command: string[], cwd: string): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertChild(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || resolve(rel) === rel) {
    throw new Error("checkpoint_path_escape");
  }
}

function isSecretFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.");
}

function isExcludedOverlay(path: string): boolean {
  return isSecretFile(path) || basename(path).startsWith("._");
}

export class CheckpointManager {
  readonly #root: string;
  readonly #runner: CommandRunner;

  constructor(dataDir: string, runner: CommandRunner = defaultRunner) {
    this.#root = join(dataDir, "workspaces");
    this.#runner = runner;
  }

  async #git(cwd: string, ...args: string[]): Promise<string> {
    const executable = resolveGitExecutable();
    if (!executable) throw new Error("Git is installed but is not visible to WinYOLO. Reopen PowerShell or refresh PATH, then retry.");
    const result = await this.#runner([executable, ...args], cwd);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git_${args[0]}_failed`);
    return result.stdout;
  }

  async #save(record: CheckpointRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await mkdir(dirname(record.patchPath), { recursive: true });
    await writeFile(join(dirname(record.patchPath), "checkpoint.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async prepare(sourceCwd: string, runId: string = randomUUID()): Promise<CheckpointRecord> {
    const requested = await realpath(resolve(sourceCwd));
    let sourceRoot: string;
    try {
      sourceRoot = await realpath(resolve((await this.#git(requested, "rev-parse", "--show-toplevel")).trim()));
    } catch {
      throw new Error("Isolation requires a Git repository. Run `git init`, create an initial commit, then retry.");
    }
    const relativeCwd = relative(sourceRoot, requested);
    if (relativeCwd.startsWith("..")) throw new Error("cwd_outside_repository");
    const id = `cp-${runId}`;
    const workspace = join(this.#root, runId, "repo");
    assertChild(this.#root, workspace);
    await mkdir(dirname(workspace), { recursive: true });
    const branch = `winyolo/checkpoint-${runId}`;
    const sourceStatus = await this.#git(sourceRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all");
    const sourceStateHash = hash(sourceStatus);
    // A linked worktree stores a `.git` pointer back into the source user's
    // protected profile. The restricted runner must never receive access to
    // that metadata, so every checkpoint uses a self-contained local clone.
    await this.#git(sourceRoot, "clone", "--no-hardlinks", "--no-checkout", "--", sourceRoot, workspace);
    await this.#git(workspace, "checkout", "-b", branch, "HEAD");
    try {
    const trackedPatch = await this.#git(sourceRoot, "diff", "--binary", "HEAD");
    if (trackedPatch) {
      const patch = join(dirname(workspace), "initial.patch");
      await writeFile(patch, trackedPatch, "utf8");
      await this.#git(workspace, "apply", "--whitespace=nowarn", patch);
    }
    // Git's checkout/line-ending filters can make an otherwise valid patch
    // appear clean on Windows. Overlay every tracked dirty path directly from
    // the source tree as a second, filesystem-level preservation guarantee.
    const changedTracked = (await this.#git(sourceRoot, "diff", "--name-only", "-z", "HEAD"))
      .split("\0").filter(Boolean).filter((path) => !isExcludedOverlay(path));
    for (const path of changedTracked) {
      const source = join(sourceRoot, path); const destination = join(workspace, path);
      assertChild(sourceRoot, source); assertChild(workspace, destination);
      try { await cp(source, destination, { recursive: true, force: true }); }
      catch { await rm(destination, { recursive: true, force: true }); }
    }
    const untracked = (await this.#git(sourceRoot, "ls-files", "--others", "--exclude-standard", "-z"))
      .split("\0").filter(Boolean).filter((path) => !isExcludedOverlay(path));
    for (const path of untracked) {
      const destination = join(workspace, path);
      assertChild(workspace, destination);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(sourceRoot, path), destination, { recursive: true, errorOnExist: false });
    }
    const tracked = (await this.#git(workspace, "ls-files", "-z")).split("\0").filter(Boolean);
    for (const path of tracked.filter(isSecretFile)) {
      await writeFile(join(workspace, path), "# withheld by WinYOLO isolated mode\n", "utf8");
    }
    await this.#git(workspace, "add", "-A");
    await this.#git(workspace, "-c", "user.name=WinYOLO Checkpoint", "-c", "user.email=winyolo@localhost", "commit", "--allow-empty", "-m", `WinYOLO isolated baseline ${runId}`);
    const baselineCommit = (await this.#git(workspace, "rev-parse", "HEAD")).trim();
    const now = new Date().toISOString();
    const record: CheckpointRecord = {
      schema: 2, id, runId, sourceRoot, sourceCwd: requested, workspace,
      workspaceCwd: join(workspace, relativeCwd), branch, baselineCommit, sourceStateHash,
      patchPath: join(dirname(workspace), "result.patch"), finalDiffHash: null,
      status: "prepared", createdAt: now, updatedAt: now,
    };
    await this.#save(record);
    return record;
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }

  async get(id: string): Promise<CheckpointRecord | undefined> {
    const entries = await readdir(this.#root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(this.#root, entry.name, "checkpoint.json");
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as CheckpointRecord;
        if (record.id === id || record.runId === id) return record;
      } catch {}
    }
    return undefined;
  }

  async list(): Promise<CheckpointRecord[]> {
    const entries = await readdir(this.#root, { withFileTypes: true }).catch(() => []);
    const records: CheckpointRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { records.push(JSON.parse(await readFile(join(this.#root, entry.name, "checkpoint.json"), "utf8"))); } catch {}
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async update(id: string, status: CheckpointStatus): Promise<CheckpointRecord> {
    const record = await this.get(id);
    if (!record) throw new Error("checkpoint_not_found");
    record.status = status;
    await this.#save(record);
    return record;
  }

  async diff(id: string): Promise<{ record: CheckpointRecord; patch: string; hash: string }> {
    const record = await this.get(id);
    if (!record) throw new Error("checkpoint_not_found");
    if (record.status === "accepted" || record.status === "rolled_back") {
      const patch = await readFile(record.patchPath, "utf8").catch(() => "");
      const diffHash = hash(patch);
      record.finalDiffHash = diffHash;
      await this.#save(record);
      return { record, patch, hash: diffHash };
    }
    await this.#git(record.workspace, "add", "--intent-to-add", ".");
    const patch = await this.#git(record.workspace, "diff", "--binary", record.baselineCommit);
    const diffHash = hash(patch);
    record.finalDiffHash = diffHash;
    await writeFile(record.patchPath, patch, "utf8");
    await this.#save(record);
    return { record, patch, hash: diffHash };
  }

  async accept(id: string): Promise<CheckpointRecord> {
    const { record, patch } = await this.diff(id);
    const currentStatus = await this.#git(record.sourceRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all");
    if (hash(currentStatus) !== record.sourceStateHash) {
      throw new Error("source_changed_since_checkpoint; inspect the exported patch and retry after reconciling local changes");
    }
    if (patch) {
      await this.#git(record.sourceRoot, "apply", "--3way", "--whitespace=nowarn", record.patchPath).catch(() => undefined);
      // A new untracked file is not always materialized by `git apply` on
      // Windows. Synchronize the exact workspace delta from the checkpoint
      // baseline as a filesystem fallback after the guarded source-state check.
      const changed = (await this.#git(record.workspace, "diff", "--name-only", "-z", record.baselineCommit)).split("\0").filter(Boolean);
      for (const path of changed) {
        const source = join(record.sourceRoot, path); const workspace = join(record.workspace, path);
        assertChild(record.sourceRoot, source); assertChild(record.workspace, workspace);
        try { await cp(workspace, source, { recursive: true, force: true }); }
        catch { await rm(source, { recursive: true, force: true }); }
      }
    }
    record.status = "accepted";
    await this.#save(record);
    await this.#cleanup(record);
    return record;
  }

  async rollback(id: string): Promise<CheckpointRecord> {
    const { record } = await this.diff(id);
    record.status = "rolled_back";
    await this.#save(record);
    await this.#cleanup(record);
    return record;
  }

  async #cleanup(record: CheckpointRecord): Promise<void> {
    await rm(record.workspace, { recursive: true, force: true });
  }
}
