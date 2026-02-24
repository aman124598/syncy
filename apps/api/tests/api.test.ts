import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "../src/server.js";

describe("api basics", () => {
  it("returns not found for unknown job", async () => {
    const app = createServer();
    const response = await request(app).get("/api/jobs/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("JOB_NOT_FOUND");
  });
});