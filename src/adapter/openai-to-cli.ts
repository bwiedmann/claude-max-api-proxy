/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest } from "../types/openai.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  sessionId?: string;
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-4": "haiku",
  // With provider prefix
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  // Aliases
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
};

/**
 * Extract Claude model alias from request model string
 */
export function extractModel(model: string): ClaudeModel {
  // Try direct lookup
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }

  // Try stripping provider prefix
  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) {
    return MODEL_MAP[stripped];
  }

  // Default to opus (Claude Max subscription)
  return "opus";
}

/**
 * Extract text from message content (handles both string and array formats)
 *
 * OpenAI API allows content to be:
 * - A string: "Hello"
 * - An array of content parts: [{"type": "text", "text": "Hello"}]
 */
function extractContentText(content: unknown): string {
  // Simple string content
  if (typeof content === "string") {
    return content;
  }

  // Array of content parts (multi-modal format)
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text: string } =>
        part && typeof part === "object" && part.type === "text" && typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("");
  }

  // Null/undefined
  if (content === null || content === undefined) {
    return "";
  }

  // Unknown object - try to stringify as last resort
  if (typeof content === "object") {
    console.error("[extractContentText] Unexpected object content:", JSON.stringify(content).slice(0, 200));
    return JSON.stringify(content);
  }

  // Other types - convert to string
  return String(content);
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const textContent = extractContentText(msg.content);

    switch (msg.role) {
      case "system":
        // System messages become context instructions
        parts.push(`<system>\n${textContent}\n</system>\n`);
        break;

      case "user":
        // User messages are the main prompt
        parts.push(textContent);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${textContent}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  return {
    prompt: messagesToPrompt(request.messages),
    model: extractModel(request.model),
    sessionId: request.user, // Use OpenAI's user field for session mapping
  };
}
