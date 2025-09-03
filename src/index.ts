import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const GAMMA_API_V02_BASE = "https://public-api.gamma.app/v0.2/generations";
const GAMMA_API_KEY = process.env.GAMMA_API_KEY;

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    // @ts-expect-error intentional generic
    return value.map((v) => removeUndefinedDeep(v)).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = removeUndefinedDeep(v);
      if (cleaned !== undefined && !(typeof cleaned === "object" && cleaned !== null && Object.keys(cleaned as object).length === 0)) {
        result[k] = cleaned;
      }
    }
    // @ts-expect-error preserve type
    return result;
  }
  // @ts-expect-error preserve type
  return value;
}

type GenerationInitResponse = { id?: string; generationId?: string } & Record<string, unknown>;
type GenerationStatusResponse = {
  id?: string;
  status?: string;
  url?: string;
  shareUrl?: string;
  files?: Array<{ url?: string; type?: string } | string> | null;
  result?: { files?: Array<{ url?: string } | string> };
} & Record<string, unknown>;

async function startGeneration(payload: Record<string, unknown>): Promise<string> {
  const response = await fetch(GAMMA_API_V02_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": GAMMA_API_KEY || "",
    },
    body: JSON.stringify(removeUndefinedDeep(payload)),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gamma v0.2 init failed: ${response.status} ${errorText}`);
  }
  const data = (await response.json()) as GenerationInitResponse;
  const id = data.generationId || data.id;
  if (!id) {
    throw new Error("Gamma v0.2 init response missing generation id");
  }
  return id;
}

async function pollGeneration(
  generationId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<string> {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${GAMMA_API_V02_BASE}/${encodeURIComponent(generationId)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": GAMMA_API_KEY || "",
      },
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gamma v0.2 poll failed: ${res.status} ${errorText}`);
    }
    const data = (await res.json()) as GenerationStatusResponse;
    const status = (data.status || "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
      // Try various shapes for url(s)
      if (data.url) return data.url;
      if (data.shareUrl) return data.shareUrl;
      const filesArrays: Array<Array<{ url?: string } | string> | undefined | null> = [
        data.files || undefined,
        data.result?.files,
      ];
      for (const files of filesArrays) {
        if (files && files.length > 0) {
          const first = files[0] as any;
          const url = typeof first === "string" ? first : first?.url;
          if (url) return url as string;
        }
      }
      throw new Error("Gamma v0.2 completed but no file URL present in response");
    }
    if (status === "failed" || status === "error") {
      throw new Error("Gamma v0.2 generation failed");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Gamma v0.2 generation timed out while waiting for result");
}

// Helper function for making Gamma API v0.2 requests end-to-end
async function generatePresentation(
  params: Record<string, any>
): Promise<{ url: string | null; error: string | null }> {
  try {
    const payload = {
      textOptions: {
        input: params.inputText,
        prompt: params.inputText,
        tone: params.tone,
        audience: params.audience,
        language: params.language,
        length: params.textAmount,
        amount: params.textAmount,
        mode: params.textMode,
        additionalInstructions: params.additionalInstructions,
      },
      imageOptions: {
        model: params.imageModel,
        style: params.imageStyle,
      },
      layoutOptions: {
        numCards: params.numCards,
        editorMode: params.editorMode,
      },
    };

    const generationId = await startGeneration(payload);
    const url = await pollGeneration(generationId);
    return { url, error: null };
  } catch (error: any) {
    console.error("Error making Gamma API v0.2 request:", error);
    return { url: null, error: error.message || String(error) };
  }
}

// Create server instance
const server = new McpServer({
  name: "gamma-presentation",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register Gamma generation tool
server.tool(
  "generate-presentation",
  "Generate a presentation using the Gamma API. The response will include a link to the generated presentation in the 'text' field. Always include the link in the response when it's available. Do your best to show a preview or a link preview or some sense of the content to the user in the response.",
  {
    inputText: z.string().describe("The topic or prompt for the presentation."),
    tone: z
      .string()
      .optional()
      .describe(
        "The tone of the presentation (e.g. 'humorous and sarcastic')."
      ),
    audience: z
      .string()
      .optional()
      .describe("The intended audience (e.g. 'students')."),
    textAmount: z
      .enum(["short", "medium", "long"])
      .optional()
      .describe("How much text to generate."),
    textMode: z
      .enum(["generate", "summarize"])
      .optional()
      .describe("Text mode for Gamma API."),
    language: z
      .string()
      .optional()
      .describe(
        "Output language for generated content (e.g. 'en', 'es', or full name)."
      ),
    numCards: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of slides/cards to generate."),
    imageModel: z
      .string()
      .optional()
      .describe("Image model to use (e.g. 'dall-e-3')."),
    imageStyle: z
      .string()
      .optional()
      .describe("Image style (e.g. 'line drawings')."),
    editorMode: z
      .string()
      .optional()
      .describe("Editor mode (e.g. 'freeform')."),
    additionalInstructions: z
      .string()
      .optional()
      .describe("Any extra instructions for Gamma."),
  },
  async (params) => {
    const { url, error } = await generatePresentation(params);
    if (!url) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to generate presentation using Gamma API. Error: ${
              error || "Unknown error."
            }`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Presentation generated! View it here: ${url}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gamma MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
