import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIR, newId, projectPath, readJson, writeJson } from "./storage.mjs";
import { RenderCancelled, renderProject } from "./render.mjs";
import { resolveMastering } from "../shared/mastering.js";

const MAX_CONCURRENT = 1;

export class JobQueue extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, any>} */
    this.jobs = new Map();
    /** @type {string[]} */
    this.pending = [];
    this.running = 0;
  }

  /**
   * @param {any} project
   * @param {{ format: "mp4"|"wav"|"mp3", normalize?: boolean, mastering?: {enabled: boolean, preset: string} }} options
   */
  enqueue(project, options) {
    const mastering = resolveMastering(options);
    const job = {
      id: newId("j"),
      projectId: project.id,
      projectName: project.name,
      format: options.format,
      normalize: mastering.enabled,
      mastering,
      status: "queued",
      stage: "Queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      output: null,
      error: null,
      child: null,
      cancelled: false,
    };

    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    this.#persist(job).catch(() => {});
    this.#drain();
    return this.publicJob(job);
  }

  /** @param {string} id */
  get(id) {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : null;
  }

  /** @param {string} id */
  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return this.publicJob(job);
    }

    job.cancelled = true;
    job.stage = "Cancelling";

    if (job.status === "queued") {
      this.pending = this.pending.filter((pendingId) => pendingId !== job.id);
      this.#finish(job, "cancelled", "Render cancelled");
    } else if (job.child) {
      job.child.kill("SIGTERM");
      setTimeout(() => {
        if (job.child && !job.child.killed) job.child.kill("SIGKILL");
      }, 1500).unref();
    }

    return this.publicJob(job);
  }

  /** @param {any} job */
  publicJob(job) {
    return {
      id: job.id,
      projectId: job.projectId,
      format: job.format,
      normalize: job.normalize,
      mastering: job.mastering,
      status: job.status,
      stage: job.stage,
      progress: Math.round(job.progress),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      output: job.output
        ? {
            ...job.output,
            downloadUrl: `/api/projects/${job.projectId}/exports/${job.output.file}`,
          }
        : null,
      error: job.error,
    };
  }

  async #drain() {
    while (this.running < MAX_CONCURRENT && this.pending.length > 0) {
      const id = this.pending.shift();
      const job = this.jobs.get(id);
      if (!job || job.cancelled) continue;
      this.running += 1;
      this.#run(job)
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.#drain().catch(() => {});
        });
    }
  }

  /** @param {any} job */
  async #run(job) {
    job.status = "rendering";
    job.stage = "Preparing";
    job.startedAt = new Date().toISOString();
    job.progress = 1;
    this.#update(job);

    try {
      const project = await readJson(projectPath(job.projectId, "project.json"));
      if (!project) throw new Error("The project no longer exists");
      await mkdir(projectPath(job.projectId, "exports"), { recursive: true });

      const output = await renderProject(project, {
        format: job.format,
        normalize: job.normalize,
        mastering: job.mastering,
        jobId: job.id,
      }, {
        progress: (percent, stage) => {
          job.progress = percent;
          job.stage = stage;
          this.#update(job);
        },
        onChild: (child) => {
          job.child = child;
        },
        cancelled: () => job.cancelled,
      });

      if (job.cancelled) throw new RenderCancelled();

      job.status = "completed";
      job.stage = "Completed";
      job.progress = 100;
      job.output = output;
      job.finishedAt = new Date().toISOString();

      project.exports = Array.isArray(project.exports) ? project.exports : [];
      project.exports.unshift({
        id: job.id,
        file: output.file,
        filename: output.filename,
        format: output.format,
        size: output.size,
        duration: output.duration,
        normalize: output.normalize,
        mastering: output.mastering,
        createdAt: output.createdAt,
      });
      project.exports = project.exports.slice(0, 10);
      project.updatedAt = new Date().toISOString();
      await writeJson(projectPath(project.id, "project.json"), project);
    } catch (error) {
      if (error instanceof RenderCancelled || job.cancelled) {
        this.#finish(job, "cancelled", "Render cancelled");
        return;
      }
      this.#finish(job, "failed", error.message || "The render failed");
      return;
    }

    this.#update(job);
    this.emit("complete", this.publicJob(job));
  }

  /** @param {any} job @param {string} status @param {string} [error] */
  #finish(job, status, error = null) {
    job.status = status;
    job.stage = status === "cancelled" ? "Cancelled" : "Failed";
    job.error = error;
    job.finishedAt = new Date().toISOString();
    job.child = null;
    this.#update(job);
  }

  /** @param {any} job */
  #update(job) {
    const percent = Math.round(job.progress);
    const stageChanged = job._lastStage !== job.stage;
    const enoughProgress = job._lastPercent === undefined || percent >= job._lastPercent + 2;
    if (stageChanged || enoughProgress || job.status !== "rendering") {
      job._lastPercent = percent;
      job._lastStage = job.stage;
      this.#persist(job).catch(() => {});
    }
    this.emit("update", this.publicJob(job));
  }

  /** @param {any} job */
  async #persist(job) {
    const file = projectPath(job.projectId, "exports", `${job.id}.json`);
    await mkdir(projectPath(job.projectId, "exports"), { recursive: true }).catch(
      () => {},
    );
    const record = {
      id: job.id,
      projectId: job.projectId,
      format: job.format,
      normalize: job.normalize,
      mastering: job.mastering,
      status: job.status,
      stage: job.stage,
      progress: Math.round(job.progress),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      output: job.output,
      error: job.error,
    };
    await writeJson(file, record).catch(() => {});
  }

  async restore() {
    // Jobs are process-local; anything left mid-flight is marked failed.
    const projects = await readdir(PROJECT_DIR).catch(() => []);
    for (const projectId of projects) {
      const dir = join(PROJECT_DIR, projectId, "exports");
      const entries = await readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const file = join(dir, entry);
        const record = await readFile(file, "utf8")
          .then((value) => JSON.parse(value))
          .catch(() => null);
        if (
          record &&
          (record.status === "queued" || record.status === "rendering")
        ) {
          record.status = "failed";
          record.stage = "Interrupted";
          record.error = "The server restarted before this render finished.";
          await writeJson(file, record).catch(() => {});
        }
      }
    }
  }
}
