import assert from "node:assert/strict";
import childProcess from "node:child_process";
import * as fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

import autoresearchExtension from "../extensions/pi-autoresearch/index.ts";

const cases = [
  ["zero baseline", 0, 5, "Baseline metric: 0 | this: 5"],
  ["negative zero baseline", -0, 5, "Baseline metric: 0 | this: 5"],
  ["crashed baseline", 0, 5, "Baseline metric: 0 | this: 5", "crash"],
  ["positive delta", 10, 15, "Baseline metric: 10 | this: 15 (+50.0%)"],
  ["negative delta", 10, 5, "Baseline metric: 10 | this: 5 (-50.0%)"],
  ["unchanged metric", 10, 10, "Baseline metric: 10 | this: 10 (0.0%)"],
  // Preserve the existing signed-baseline formatting outside this zero-baseline fix.
  ["negative baseline", -10, 5, "Baseline metric: -10 | this: 5 (+-150.0%)"],
  ["zero current metric", 10, 0, "Baseline metric: 10"],
  ["negative current metric", 10, -5, "Baseline metric: 10"],
  ["both metrics zero", 0, 0, "Baseline metric: 0"],
  ["negative current with zero baseline", 0, -5, "Baseline metric: 0"],
  ["zero current with negative baseline", -10, 0, "Baseline metric: -10"],
  ["both metrics negative", -10, -5, "Baseline metric: -10"],
];

test("primary metric logging omits zero-baseline percentages and preserves other output", async (t) => {
  for (const [name, baseline, metric, metricLine, baselineStatus = "keep"] of cases) {
    await t.test(name, async (t) => {
      const cwd = fs.mkdtempSync(path.join(tmpdir(), "pi-primary-metric-"));
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = cwd;
      t.after(() => {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        t.mock.restoreAll();
        syncBuiltinESMExports();
        fs.rmSync(cwd, { recursive: true, force: true });
      });

      const forbidden = () => { throw new Error("external work is forbidden in unit tests"); };
      for (const method of ["spawn", "exec", "execFile", "execSync", "spawnSync", "execFileSync", "fork"]) {
        t.mock.method(childProcess, method, forbidden);
      }
      t.mock.method(globalThis, "fetch", forbidden);
      t.mock.method(net.Socket.prototype, "connect", forbidden);
      for (const transport of [http, https]) {
        t.mock.method(transport, "request", forbidden);
        t.mock.method(transport, "get", forbidden);
      }
      t.mock.method(Date, "now", () => 1234);
      syncBuiltinESMExports();

      const tools = new Map();
      const execCalls = [];
      autoresearchExtension({
        on() {}, registerCommand() {}, registerShortcut() {},
        registerTool(tool) { tools.set(tool.name, tool); },
        sendUserMessage: forbidden,
        async exec(command, args) {
          execCalls.push([command, args]);
          return { code: 0, stdout: "", stderr: "" };
        },
      });
      const ctx = { cwd, hasUI: false, abort: forbidden, sessionManager: { getSessionId: () => "synthetic" } };
      const log = tools.get("log_experiment");
      const params = { commit: "abcdef0123", metric: baseline, status: baselineStatus, description: "baseline" };
      await log.execute("baseline", params, undefined, undefined, ctx);
      const result = await log.execute("candidate", {
        ...params, metric, status: "keep", description: "candidate",
      }, undefined, undefined, ctx);

      assert.equal(result.content[0].text, [
        "Logged #2: keep — candidate", metricLine, "(2 experiments)",
        "📝 Git: nothing to commit (working tree clean)",
      ].join("\n"));
      assert.equal(result.details.state.bestMetric, baseline);
      const expectedRuns = [
        { metric: baseline, status: baselineStatus, description: "baseline" },
        { metric, status: "keep", description: "candidate" },
      ].map((run) => ({
        commit: "abcdef0", ...run, metrics: {}, timestamp: 1234, segment: 0, confidence: null, asi: undefined,
      }));
      assert.deepEqual(result.details.state.results, expectedRuns);
      assert.deepEqual(result.details.experiment, expectedRuns[1]);
      const persisted = fs.readFileSync(path.join(cwd, ".auto", "log.jsonl"), "utf8");
      assert.equal(persisted, expectedRuns.map((run, i) => JSON.stringify({
        run: i + 1, commit: run.commit, metric: run.metric, metrics: run.metrics,
        status: run.status, description: run.description, timestamp: run.timestamp,
        segment: run.segment, confidence: run.confidence,
      })).join("\n") + "\n");
      const gitCalls = [["git", ["add", "-A"]], ["git", ["diff", "--cached", "--quiet"]]];
      if (baselineStatus === "crash") {
        assert.equal(execCalls[0][0], "bash");
        assert.equal(execCalls[0][1][0], "-c");
        assert.match(execCalls[0][1][1], /git checkout --/);
        assert.deepEqual(execCalls.slice(1), gitCalls);
      } else {
        assert.deepEqual(execCalls, [...gitCalls, ...gitCalls]);
      }
    });
  }
});
