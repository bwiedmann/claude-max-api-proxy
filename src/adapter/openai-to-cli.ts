/**
 * Converts OpenAI chat request format to Claude CLI input
 *
 * Supports two modes:
 * - Text-only: prompt passed as CLI argument (legacy)
 * - Stream-JSON: NDJSON piped to stdin with full multimodal support (images)
 */

import type {
  OpenAIChatRequest,
  OpenAIContentPart,
  OpenAITextContentPart,
  OpenAIImageContentPart,
} from "../types/openai.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku";

/**
 * Claude CLI stream-json content block types
 */
interface CliTextContent {
  type: "text";
  text: string;
}

interface CliImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

type CliContentBlock = CliTextContent | CliImageContent;

/**
 * NDJSON message format for Claude CLI --input-format stream-json
 */
export interface CliStreamMessage {
  type: "user";
  message: {
    role: "user";
    content: CliContentBlock[];
  };
}

export interface CliInput {
  /** Single prompt string (legacy text-only mode) */
  prompt: string;
  /** NDJSON lines for stdin piping (stream-json mode with image support) */
  stdinMessages: string[];
  /** Whether the request contains images and needs stream-json mode */
  hasImages: boolean;
  model: ClaudeModel;
  sessionId?: string;
  systemPrompt?: string;
  tools?: string[];
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-opus-4-6": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-sonnet-4-5": "sonnet",
  "claude-haiku-4": "haiku",
  // With provider prefix
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-opus-4-6": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-sonnet-4-5": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  // Claude-max prefix (from OpenClaw config)
  "claude-max/claude-opus-4": "opus",
  "claude-max/claude-opus-4-6": "opus",
  "claude-max/claude-sonnet-4": "sonnet",
  "claude-max/claude-sonnet-4-5": "sonnet",
  "claude-max/claude-haiku-4": "haiku",
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
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }
  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) {
    return MODEL_MAP[stripped];
  }
  return "opus";
}

/**
 * Check if any message in the request contains images
 */
function requestHasImages(messages: OpenAIChatRequest["messages"]): boolean {
  return messages.some((msg) => {
    if (typeof msg.content === "string") return false;
    return msg.content.some((part) => part.type === "image_url");
  });
}

/**
 * Convert an OpenAI image_url to a Claude CLI base64 image block.
 * Handles data URIs (data:image/png;base64,...) and passes through the data.
 */
function convertImagePart(part: OpenAIImageContentPart): CliImageContent | null {
  const url = part.image_url.url;

  // Parse data URI: data:image/png;base64,iVBOR...
  const match = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    // Non-data-URI images (http URLs) are not supported by CLI
    console.error("[openai-to-cli] Skipping non-data-URI image:", url.slice(0, 60));
    return null;
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1],
      data: match[2],
    },
  };
}

/**
 * Convert OpenAI content parts to Claude CLI content blocks
 */
function convertContentParts(content: string | OpenAIContentPart[]): CliContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  const blocks: CliContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const img = convertImagePart(part);
      if (img) blocks.push(img);
    }
  }
  return blocks;
}

/**
 * Convert OpenAI messages to Claude CLI stream-json NDJSON lines.
 *
 * Claude CLI stream-json only accepts "user" role messages.
 * System and assistant messages are inlined as tagged text blocks
 * within the user message content.
 */
function messagesToStreamJson(messages: OpenAIChatRequest["messages"]): string[] {
  const allBlocks: CliContentBlock[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
      case "developer": {
        const text = extractContent(msg.content);
        allBlocks.push({ type: "text", text: `<system>\n${text}\n</system>` });
        break;
      }
      case "assistant": {
        const text = extractContent(msg.content);
        allBlocks.push({ type: "text", text: `<previous_response>\n${text}\n</previous_response>` });
        break;
      }
      case "user": {
        const blocks = convertContentParts(msg.content);
        allBlocks.push(...blocks);
        break;
      }
    }
  }

  const stdinMsg: CliStreamMessage = {
    type: "user",
    message: {
      role: "user",
      content: allBlocks,
    },
  };

  return [JSON.stringify(stdinMsg)];
}

/**
 * Extract text from message content.
 *
 * OpenAI API allows content to be either a plain string or an array of
 * content parts (e.g. [{type: "text", text: "..."}]). This function
 * normalises both forms into a single string.
 */
export function extractContent(
  content: string | OpenAIContentPart[],
): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter((part): part is OpenAITextContentPart => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  return String(content ?? "");
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
    const text = extractContent(msg.content);

    switch (msg.role) {
      case "system":
      case "developer":
        systemParts.push(text);
        break;
      case "user":
        conversationParts.push(text);
        break;
      case "assistant":
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
 * Convert OpenAI chat request to CLI input format.
 * Automatically chooses stream-json mode when images are present.
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const { systemPrompt, conversationPrompt } = extractMessagesContent(request.messages);
  const hasImages = requestHasImages(request.messages);

  return {
    prompt: conversationPrompt,
    stdinMessages: messagesToStreamJson(request.messages),
    hasImages,
    model: extractModel(request.model),
    sessionId: request.user,
    systemPrompt,
    tools: undefined,
  };
}
