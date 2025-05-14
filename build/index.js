import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();
const GAMMA_API_URL = "https://api.gamma.app/public-api/v0.1/generate";
const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
// Helper function for making Gamma API requests
async function generatePresentation(params) {
  try {
    const response = await fetch(GAMMA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": GAMMA_API_KEY || "",
      },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, body: ${errorText}`
      );
    }
    const data = await response.json();
    return { url: data.url || null, error: null };
  } catch (error) {
    console.error("Error making Gamma API request:", error);
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
