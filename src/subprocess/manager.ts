/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import type {
  ClaudeCliMessage,
  ClaudeCliAssistant,
  ClaudeCliResult,
  ClaudeCliStreamEvent,
} from "../types/claude-cli.js";
import { isAssistantMessage, isResultMessage, isContentDelta } from "../types/claude-cli.js";
import type { ClaudeModel } from "../adapter/openai-to-cli.js";

export interface SubprocessOptions {
  model: ClaudeModel;
  sessionId?: string;
  cwd?: string;
  timeout?: number;
}

export interface SubprocessEvents {
  message: (msg: ClaudeCliMessage) => void;
  assistant: (msg: ClaudeCliAssistant) => void;
  result: (result: ClaudeCliResult) => void;
  error: (error: Error) => void;
  close: (code: number | null) => void;
  raw: (line: string) => void;
}

const DEFAULT_TIMEOUT = 300000; // 5 minutes

export class ClaudeSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Claude CLI subprocess.
   *
   * Two modes:
   * - Text mode (stdinMessages omitted): prompt passed as CLI argument
   * - Stream-JSON mode (stdinMessages provided): messages piped via stdin (supports images)
   */
  async start(
    prompt: string,
    options: SubprocessOptions & { stdinMessages?: string[] }
  ): Promise<void> {
    const useStreamInput = !!options.stdinMessages?.length;
    const args = this.buildArgs(useStreamInput ? null : prompt, options, useStreamInput);
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        // Use spawn() for security - no shell interpretation
        this.process = spawn("claude", args, {
          cwd: options.cwd || "/tmp", // Use neutral dir to avoid loading CLAUDE.md
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Set timeout
        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        // Handle spawn errors (e.g., claude not found)
        this.process.on("error", (err) => {
          this.clearTimeout();
          if (err.message.includes("ENOENT")) {
            reject(
              new Error(
                "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
              )
            );
          } else {
            reject(err);
          }
        });

        // Pipe messages via stdin or close it
        if (useStreamInput && options.stdinMessages) {
          for (const line of options.stdinMessages) {
            this.process.stdin?.write(line + "\n");
          }
        }
        this.process.stdin?.end();

        console.error(
          `[Subprocess] Process spawned with PID: ${this.process.pid}` +
          ` (mode: ${useStreamInput ? "stream-json" : "text"})`
        );

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[Subprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            console.error("[Subprocess stderr]:", errorText.slice(0, 200));
          }
        });

        // Handle process close
        this.process.on("close", (code) => {
          console.error(`[Subprocess] Process closed with code: ${code}`);
          this.clearTimeout();
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        resolve();
      } catch (err) {
        this.clearTimeout();
        reject(err);
      }
    });
  }

  /**
   * Build CLI arguments array.
   * @param prompt - Text prompt (null when using stream-json input)
   * @param options - Subprocess options
   * @param streamInput - Whether to use --input-format stream-json
   */
  private buildArgs(
    prompt: string | null,
    options: SubprocessOptions,
    streamInput: boolean
  ): string[] {
    const args = [
      "--print", // Non-interactive mode
      "--output-format",
      "stream-json", // JSON streaming output
      "--verbose", // Required for stream-json
      "--include-partial-messages", // Enable streaming chunks
      "--model",
      options.model, // Model alias (opus/sonnet/haiku)
      "--no-session-persistence", // Don't save sessions
      "--tools", "", // Disable all tools — act as a plain chat model
      "--disable-slash-commands", // Disable skills
      "--setting-sources", "", // Don't load any settings files (CLAUDE.md etc.)
      "--system-prompt", "You are a helpful assistant. Follow the user's instructions precisely. When asked to output JSON, output ONLY raw JSON without markdown code fences.",
    ];

    if (streamInput) {
      args.push("--input-format", "stream-json");
    } else if (prompt) {
      args.push(prompt);
    }

    if (options.sessionId) {
      args.push("--session-id", options.sessionId);
    }

    return args;
  }

  /**
   * Process the buffer and emit parsed messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: ClaudeCliMessage = JSON.parse(trimmed);
        this.emit("message", message);

        if (isContentDelta(message)) {
          // Emit content delta for streaming
          this.emit("content_delta", message as ClaudeCliStreamEvent);
        } else if (isAssistantMessage(message)) {
          this.emit("assistant", message);
        } else if (isResultMessage(message)) {
          this.emit("result", message);
        }
      } catch {
        // Non-JSON output, emit as raw
        this.emit("raw", trimmed);
      }
    }
  }

  /**
   * Clear the timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Kill the subprocess
   */
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.process.kill(signal);
    }
  }

  /**
   * Check if the process is still running
   */
  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }
}

/**
 * Verify that Claude CLI is installed and accessible
 */
export async function verifyClaude(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error:
          "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Claude CLI returned non-zero exit code",
        });
      }
    });
  });
}

/**
 * Check if Claude CLI is authenticated
 *
 * Claude Code stores credentials in the OS keychain, not a file.
 * We verify authentication by checking if we can call the CLI successfully.
 * If the CLI is installed, it typically has valid credentials from `claude auth login`.
 */
export async function verifyAuth(): Promise<{ ok: boolean; error?: string }> {
  // If Claude CLI is installed and the user has run `claude auth login`,
  // credentials are stored in the OS keychain and will be used automatically.
  // We can't easily check the keychain, so we'll just return true if the CLI exists.
  // Authentication errors will surface when making actual API calls.
  return { ok: true };
}
