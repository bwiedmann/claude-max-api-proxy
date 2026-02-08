/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest } from "../types/openai.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  sessionId?: string;
  systemPrompt?: string;
  tools?: string[];
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-opus-4-6": "opus", // Note: CLI doesn't have a separate 4.6 model, uses regular opus (200k limit)
  "claude-sonnet-4": "sonnet",
  "claude-sonnet-4-5": "sonnet",
  "claude-haiku-4": "haiku",
  // With provider prefix
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-opus-4-6": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-sonnet-4-5": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  // Claude-max prefix (from Clawdbot config)
  "claude-max/claude-opus-4-6": "opus",
  "claude-max/claude-sonnet-4-5": "sonnet",
  // Aliases
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
  "opus-max": "opus",
  "sonnet-max": "sonnet",
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
 * Extract text content from a message content field
 * Handles both string content and array of content parts (multimodal)
 */
function extractTextContent(content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>): string {
  // If it's already a string, return it directly
  if (typeof content === "string") {
    return content;
  }

  // If it's an array of content parts, extract text from each text part
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  // Fallback for unexpected types
  return String(content);
}

/**
 * Extract system messages and conversation from OpenAI messages array
 *
 * System messages should be passed via --append-system-prompt flag,
 * not embedded in the user prompt (more reliable for OpenClaw integration).
 */
export function extractMessagesContent(messages: OpenAIChatRequest["messages"]): {
  systemPrompt: string | undefined;
  conversationPrompt: string;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    const text = extractTextContent(msg.content);

    switch (msg.role) {
      case "system":
      case "developer":
        // System/developer messages go to --append-system-prompt flag
        // "developer" is OpenAI's newer role for system-level instructions
        systemParts.push(text);
        break;

      case "user":
        // User messages are the main prompt
        conversationParts.push(text);
        break;

      case "assistant":
        // Previous assistant responses for context
        conversationParts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n").trim() : undefined,
    conversationPrompt: conversationParts.join("\n").trim(),
  };
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * @deprecated Use extractMessagesContent instead for better system prompt handling
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const { systemPrompt, conversationPrompt } = extractMessagesContent(messages);

  if (systemPrompt) {
    return `<system>\n${systemPrompt}\n</system>\n\n${conversationPrompt}`;
  }

  return conversationPrompt;
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const { systemPrompt, conversationPrompt } = extractMessagesContent(request.messages);

  return {
    prompt: conversationPrompt,
    model: extractModel(request.model),
    sessionId: request.user, // Use OpenAI's user field for session mapping
    systemPrompt,
    // TODO: Extract tool names from request.tools and map to Claude Code tool names
    // For now, let Claude Code use all its builtin tools
    tools: undefined,
  };
}
