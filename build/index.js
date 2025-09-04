import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
// Ensure .env is loaded regardless of current working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const GAMMA_API_V02_BASE = "https://public-api.gamma.app/v0.2/generations";
const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
if (!GAMMA_API_KEY || GAMMA_API_KEY.trim() === "") {
    console.error("GAMMA_API_KEY is missing. Create a .env file next to package.json with GAMMA_API_KEY=... or export it in your environment.");
    process.exit(1);
}
function removeUndefinedDeep(value) {
    if (Array.isArray(value)) {
        return value
            .map((v) => removeUndefinedDeep(v))
            .filter((v) => v !== undefined);
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            const cleaned = removeUndefinedDeep(v);
            const isEmptyObject = typeof cleaned === "object" && cleaned !== null && Object.keys(cleaned).length === 0;
            if (cleaned !== undefined && !isEmptyObject) {
                result[k] = cleaned;
            }
        }
        return result;
    }
    return value;
}
async function startGeneration(payload) {
    const response = await fetch(GAMMA_API_V02_BASE, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-KEY": GAMMA_API_KEY || "",
            Accept: "application/json",
        },
        body: JSON.stringify(removeUndefinedDeep(payload)),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gamma v0.2 init failed: ${response.status} ${errorText}`);
    }
    const data = (await response.json());
    const id = data.generationId;
    if (!id) {
        throw new Error("Gamma v0.2 init response missing generation id");
    }
    return id;
}
async function pollGeneration(generationId, options = {}) {
    const intervalMs = options.intervalMs ?? 3000;
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(`${GAMMA_API_V02_BASE}/${encodeURIComponent(generationId)}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": GAMMA_API_KEY || "",
                Accept: "application/json",
            },
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Gamma v0.2 poll failed: ${res.status} ${errorText}`);
        }
        const data = (await res.json());
        const status = (data.status || "").toLowerCase();
        if (status === "completed" || status === "succeeded" || status === "success") {
            const gammaUrl = data.gammaUrl || data.url || data.shareUrl;
            let fileUrl;
            // Prefer explicit fields if present
            if (data.pdfUrl)
                fileUrl = data.pdfUrl;
            if (data.pptxUrl)
                fileUrl = data.pptxUrl;
            // Fallback to files arrays
            const filesArrays = [
                data.files || undefined,
                data.result?.files,
            ];
            for (const files of filesArrays) {
                if (fileUrl)
                    break;
                if (files && files.length > 0) {
                    const first = files[0];
                    const url = typeof first === "string" ? first : first?.url;
                    if (url)
                        fileUrl = url;
                }
            }
            return { gammaUrl, fileUrl };
        }
        if (status === "failed" || status === "error") {
            throw new Error("Gamma v0.2 generation failed");
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("Gamma v0.2 generation timed out while waiting for result");
}
// Helper function for making Gamma API v0.2 requests end-to-end
async function generatePresentation(params) {
    try {
        // Map older textAmount values to v0.2 accepted values if needed
        const mapAmount = (val) => {
            if (!val)
                return undefined;
            const v = String(val).toLowerCase();
            if (["brief", "medium", "detailed", "extensive"].includes(v))
                return v;
            if (v === "short")
                return "brief";
            if (v === "long")
                return "detailed";
            return undefined;
        };
        const payload = removeUndefinedDeep({
            inputText: params.inputText,
            textMode: params.textMode,
            format: params.format,
            themeName: params.themeName,
            numCards: typeof params.numCards === "string" ? Number(params.numCards) : params.numCards,
            cardSplit: params.cardSplit,
            additionalInstructions: params.additionalInstructions,
            exportAs: params.exportAs,
            textOptions: removeUndefinedDeep({
                amount: mapAmount(params.textAmount),
                tone: params.tone,
                audience: params.audience,
                language: params.language,
            }),
            imageOptions: removeUndefinedDeep({
                source: params.imageSource,
                model: params.imageModel,
                style: params.imageStyle,
            }),
            cardOptions: removeUndefinedDeep({
                dimensions: params.cardDimensions,
            }),
            sharingOptions: removeUndefinedDeep({
                workspaceAccess: params.workspaceAccess,
                externalAccess: params.externalAccess,
            }),
        });
        const generationId = await startGeneration(payload);
        const { gammaUrl, fileUrl } = await pollGeneration(generationId);
        let savedFilePath = null;
        if (fileUrl && params.exportAs) {
            const outDir = path.resolve(__dirname, "../output");
            await mkdir(outDir, { recursive: true });
            const urlObj = new URL(fileUrl);
            const extFromPath = path.extname(urlObj.pathname) || `.${String(params.exportAs)}`;
            const baseName = `gamma-generation-${generationId}${extFromPath}`;
            const targetPath = path.join(outDir, baseName);
            const fileRes = await fetch(fileUrl, { method: "GET" });
            if (!fileRes.ok) {
                console.error(`Failed to download file ${fileUrl}: ${fileRes.status}`);
            }
            else {
                const arrayBuf = await fileRes.arrayBuffer();
                await writeFile(targetPath, Buffer.from(arrayBuf));
                savedFilePath = targetPath;
            }
        }
        return { url: gammaUrl || null, filePath: savedFilePath, error: null };
    }
    catch (error) {
        console.error("Error making Gamma API v0.2 request:", error);
        return { url: null, filePath: null, error: error.message || String(error) };
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
server.tool("generate-presentation", "Generate a presentation using the Gamma API (v0.2). Optionally export a file and save it locally.", {
    inputText: z.string().describe("Prompt/topic text. Required by Gamma v0.2."),
    textMode: z
        .enum(["generate", "condense", "preserve"])
        .optional()
        .describe("How to treat the inputText."),
    format: z
        .enum(["presentation", "document", "social"])
        .optional()
        .describe("Output format."),
    themeName: z.string().optional().describe("Theme name in Gamma."),
    numCards: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Number of cards when cardSplit=auto."),
    cardSplit: z
        .enum(["auto", "inputTextBreaks"])
        .optional()
        .describe("How to split content into cards."),
    additionalInstructions: z.string().optional(),
    exportAs: z
        .enum(["pdf", "pptx"])
        .optional()
        .describe("Also export as a file. Will be downloaded locally."),
    // textOptions
    textAmount: z
        .enum(["brief", "medium", "detailed", "extensive", "short", "long"])
        .optional()
        .describe("How much text to include per card (v0.2: brief/medium/detailed/extensive)."),
    tone: z.string().optional(),
    audience: z.string().optional(),
    language: z.string().optional(),
    // imageOptions
    imageSource: z
        .enum([
        "aiGenerated",
        "pictographic",
        "unsplash",
        "giphy",
        "webAllImages",
        "webFreeToUse",
        "webFreeToUseCommercially",
        "placeholder",
        "noImages",
    ])
        .optional(),
    imageModel: z.string().optional(),
    imageStyle: z.string().optional(),
    // cardOptions
    cardDimensions: z
        .enum(["fluid", "16x9", "4x3", "pageless", "letter", "a4", "1x1", "4x5", "9x16"])
        .optional(),
    // sharingOptions
    workspaceAccess: z
        .enum(["noAccess", "view", "comment", "edit", "fullAccess"])
        .optional(),
    externalAccess: z
        .enum(["noAccess", "view", "comment", "edit"])
        .optional(),
}, async (params) => {
    const { url, filePath, error } = await generatePresentation(params);
    if (!url) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to generate presentation using Gamma API. Error: ${error || "Unknown error."}`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: "text",
                text: filePath
                    ? `Presentation generated! View it here: ${url}\nSaved exported file to: ${filePath}`
                    : `Presentation generated! View it here: ${url}`,
            },
        ],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Gamma MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
