import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AnalysisResult, JobRecord, JobStatus, TimeRange, TrimDecision } from "@syncy/shared";
import { paths } from "./config.js";

export type JobEventRow = {
  id: number;
  jobId: string;
  timestamp: string;
  type: string;
  payloadJson: string;
};

type JobRow = {
  id: string;
  status: JobStatus;
  video_path: string;
  replacement_audio_path: string | null;
  output_path: string | null;
  video_duration_sec: number;
  target_duration_sec: number;
  delta_sec: number;
  decision_json: string | null;
  override_keep_range_json: string | null;
  analysis_result_json: string | null;
  error_code: JobRecord["errorCode"] | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

function parseJsonField<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as T;
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    status: row.status,
    videoPath: row.video_path,
    replacementAudioPath: row.replacement_audio_path ?? undefined,
    outputPath: row.output_path ?? undefined,
    videoDurationSec: row.video_duration_sec,
    targetDurationSec: row.target_duration_sec,
    deltaSec: row.delta_sec,
    decision: parseJsonField<TrimDecision>(row.decision_json),
    overrideKeepRange: parseJsonField<TimeRange>(row.override_keep_range_json),
    analysisResult: parseJsonField<AnalysisResult>(row.analysis_result_json),
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class JobRepository {
  private db: Database.Database;

  public constructor(dbPath = paths.dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        video_path TEXT NOT NULL,
        replacement_audio_path TEXT,
        output_path TEXT,
        video_duration_sec REAL NOT NULL DEFAULT 0,
        target_duration_sec REAL NOT NULL DEFAULT 0,
        delta_sec REAL NOT NULL DEFAULT 0,
        decision_json TEXT,
        override_keep_range_json TEXT,
        analysis_result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
      ON jobs(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_job_events_job_id_timestamp
      ON job_events(job_id, timestamp);
    `);
  }

  public insertJob(
    job: Omit<
      JobRecord,
      "decision" | "overrideKeepRange" | "analysisResult" | "outputPath" | "errorCode" | "errorMessage"
    >
  ): JobRecord {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id,
        status,
        video_path,
        replacement_audio_path,
        output_path,
        video_duration_sec,
        target_duration_sec,
        delta_sec,
        decision_json,
        override_keep_range_json,
        analysis_result_json,
        error_code,
        error_message,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @status,
        @video_path,
        @replacement_audio_path,
        NULL,
        @video_duration_sec,
        @target_duration_sec,
        @delta_sec,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        @created_at,
        @updated_at
      );
    `);

    stmt.run({
      id: job.id,
      status: job.status,
      video_path: job.videoPath,
      replacement_audio_path: job.replacementAudioPath ?? null,
      video_duration_sec: job.videoDurationSec,
      target_duration_sec: job.targetDurationSec,
      delta_sec: job.deltaSec,
      created_at: job.createdAt,
      updated_at: job.updatedAt
    });

    const inserted = this.getJob(job.id);
    if (!inserted) {
      throw new Error(`Job insert failed for ${job.id}`);
    }
    return inserted;
  }

  public updateJob(jobId: string, patch: Partial<JobRecord>): JobRecord {
    const current = this.getJob(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} not found`);
    }

    const merged: JobRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    const stmt = this.db.prepare(`
      UPDATE jobs SET
        status = @status,
        video_path = @video_path,
        replacement_audio_path = @replacement_audio_path,
        output_path = @output_path,
        video_duration_sec = @video_duration_sec,
        target_duration_sec = @target_duration_sec,
        delta_sec = @delta_sec,
        decision_json = @decision_json,
        override_keep_range_json = @override_keep_range_json,
        analysis_result_json = @analysis_result_json,
        error_code = @error_code,
        error_message = @error_message,
        updated_at = @updated_at
      WHERE id = @id;
    `);

    stmt.run({
      id: merged.id,
      status: merged.status,
      video_path: merged.videoPath,
      replacement_audio_path: merged.replacementAudioPath ?? null,
      output_path: merged.outputPath ?? null,
      video_duration_sec: merged.videoDurationSec,
      target_duration_sec: merged.targetDurationSec,
      delta_sec: merged.deltaSec,
      decision_json: merged.decision ? JSON.stringify(merged.decision) : null,
      override_keep_range_json: merged.overrideKeepRange
        ? JSON.stringify(merged.overrideKeepRange)
        : null,
      analysis_result_json: merged.analysisResult
        ? JSON.stringify(merged.analysisResult)
        : null,
      error_code: merged.errorCode ?? null,
      error_message: merged.errorMessage ?? null,
      updated_at: merged.updatedAt
    });

    const updated = this.getJob(jobId);
    if (!updated) {
      throw new Error(`Job update failed for ${jobId}`);
    }
    return updated;
  }

  public getJob(jobId: string): JobRecord | null {
    const stmt = this.db.prepare<[string], JobRow>("SELECT * FROM jobs WHERE id = ? LIMIT 1");
    const row = stmt.get(jobId);
    return row ? rowToJob(row) : null;
  }

  public insertEvent(
    jobId: string,
    type: string,
    payload: Record<string, unknown> | string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO job_events (job_id, timestamp, type, payload_json)
      VALUES (?, ?, ?, ?);
    `);
    const payloadJson =
      typeof payload === "string" ? JSON.stringify({ message: payload }) : JSON.stringify(payload);
    stmt.run(jobId, new Date().toISOString(), type, payloadJson);
  }

  public listEvents(jobId: string): JobEventRow[] {
    const stmt = this.db.prepare<[string], JobEventRow>(
      "SELECT id, job_id AS jobId, timestamp, type, payload_json AS payloadJson FROM job_events WHERE job_id = ? ORDER BY id ASC"
    );
    return stmt.all(jobId);
  }

  public upsertArtifact(
    jobId: string,
    kind: string,
    filePath: string,
    meta: Record<string, unknown> | null = null
  ): void {
    const existing = this.db
      .prepare<[string, string], { id: number }>(
        "SELECT id FROM artifacts WHERE job_id = ? AND kind = ? LIMIT 1"
      )
      .get(jobId, kind);

    if (existing) {
      this.db
        .prepare(
          "UPDATE artifacts SET path = ?, meta_json = ?, created_at = ? WHERE id = ?"
        )
        .run(filePath, meta ? JSON.stringify(meta) : null, new Date().toISOString(), existing.id);
      return;
    }

    this.db
      .prepare(
        "INSERT INTO artifacts (job_id, kind, path, meta_json, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(jobId, kind, filePath, meta ? JSON.stringify(meta) : null, new Date().toISOString());
  }
}
