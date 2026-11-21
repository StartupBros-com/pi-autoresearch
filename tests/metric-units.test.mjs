import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

import autoresearchExtension from "../extensions/pi-autoresearch/index.ts";
import { reconstructJsonlState } from "../extensions/pi-autoresearch/jsonl.ts";

const cases = [
  ["latencyµs", "µs"], ["µs", "µs"], ["latency_µs", "µs"],
  ["latency_ms", "ms"], ["_ms", "ms"],
  ["elapsed_s", "s"], ["_s", "s"], ["elapsed_sec", "s"], ["_sec", "s"],
  ["size_kb", "kb"], ["_kb", "kb"], ["size_mb", "mb"], ["_mb", "mb"],
  ["", ""], ["ms", ""], ["seconds", ""], ["latency_us", ""],
  ["latencyμs", ""], ["latency_MS", ""], ["size_MB", ""],
  ["latency_ms_extra", ""], ["latency_ms ", ""], ["latency_ms\n", ""],
  ["latency_ms_sec", "s"], ["size_mb_ms", "ms"], ["latency_msµs", "µs"],
];
const metrics = Object.fromEntries(cases.map(([name], i) => [name, i + 1]));
const expected = cases.map(([name, unit]) => ({ name, unit }));

test("reconstruction preserves every unit suffix and case-sensitive near miss", () => {
  const result = reconstructJsonlState(JSON.stringify({ run: 1, metrics }));
  assert.deepEqual(result.secondaryMetrics, expected);
});

test("live registration and persisted reconstruction agree without external work", async (t) => {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "pi-metric-units-"));
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
  for (const method of ["spawn", "exec", "execFile", "execSync", "spawnSync", "execFileSync"]) {
    t.mock.method(childProcess, method, forbidden);
  }
  t.mock.method(globalThis, "fetch", forbidden);
  syncBuiltinESMExports();

  const tools = new Map();
  const execCalls = [];
  autoresearchExtension({
    on() {}, registerCommand() {}, registerShortcut() {},
    registerTool(tool) { tools.set(tool.name, tool); },
    sendUserMessage: forbidden,
    async exec(command, args) {
      execCalls.push([command, args]);
      assert.equal(command, "git");
      assert.ok(["add", "diff"].includes(args[0]));
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const ctx = { cwd, hasUI: false, sessionManager: { getSessionId: () => "synthetic" } };
  const params = { commit: "abcdef0123", metric: 1, metrics, status: "keep", description: "synthetic" };
  const log = tools.get("log_experiment");
  const first = await log.execute("first", params, undefined, undefined, ctx);
  assert.deepEqual(first.details.state.secondaryMetrics, expected);
  assert.deepEqual(reconstructJsonlState(fs.readFileSync(path.join(cwd, ".auto", "log.jsonl"), "utf8")).secondaryMetrics, expected);

  const second = await log.execute("second", {
    ...params, metrics: { ...metrics, added_kb: 42 }, force: true,
  }, undefined, undefined, ctx);
  const expanded = [...expected, { name: "added_kb", unit: "kb" }];
  assert.deepEqual(second.details.state.secondaryMetrics, expanded);
  assert.deepEqual(reconstructJsonlState(fs.readFileSync(path.join(cwd, ".auto", "log.jsonl"), "utf8")).secondaryMetrics, expanded);
  assert.deepEqual(execCalls, [
    ["git", ["add", "-A"]], ["git", ["diff", "--cached", "--quiet"]],
    ["git", ["add", "-A"]], ["git", ["diff", "--cached", "--quiet"]],
  ]);
});
