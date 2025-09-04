# Gamma MCP Server

This document guides you through setting up and running the Gamma MCP (Model Context Protocol) server, which allows you to generate presentations using the Gamma API directly from MCP clients like Anthropic's Claude for Desktop.

## Quick Start (TL;DR)

Run everything from the `gamma-mcpserver` directory so local dependencies and the `tsconfig.json` are picked up.

```bash
cd /ABSOLUTE/PATH/TO/your/project/gamma-mcpserver
npm install

# Set your Gamma API key
printf 'GAMMA_API_KEY="your_actual_gamma_api_key_here"\n' > .env

# Option 1: Build and run compiled JS (recommended)
npm run build && node build/index.js

# Option 2: Run directly with ts-node during development
npx ts-node --project tsconfig.json src/index.ts

# Option 3: Pass API key via CLI flags (overrides .env)
# Direct flag
npx ts-node --project tsconfig.json src/index.ts --api-key=sk-gamma-xxxx
# As header (either works; Authorization is mirrored to X-API-KEY)
npx ts-node --project tsconfig.json src/index.ts --header "X-API-KEY: sk-gamma-xxxx"
npx ts-node --project tsconfig.json src/index.ts --header "Authorization: sk-gamma-xxxx"
```

Common gotchas:
- "Error: Cannot find module './index.ts'": You likely ran from the wrong directory. `cd gamma-mcpserver` first, or pass the full path and `--project gamma-mcpserver/tsconfig.json` when running from elsewhere.
- "Cannot find package '@modelcontextprotocol/sdk'": Install dependencies in this folder: `cd gamma-mcpserver && npm install`.
- ESM/ts-node complaints: If you see module/ESM errors, try `npx ts-node --esm --project tsconfig.json src/index.ts`.

Run from repo root (alternative):
```bash
cd /ABSOLUTE/PATH/TO/your/project
npx ts-node --project gamma-mcpserver/tsconfig.json gamma-mcpserver/src/index.ts
```

## What is Gamma?

[Gamma](https://gamma.app) is an AI-powered platform designed to help users create various types of content, with a strong focus on presentations. It leverages artificial intelligence to automatically generate slides, suggest text, and incorporate imagery, allowing for rapid development of polished presentations from simple prompts or existing documents. This MCP server specifically interacts with Gamma's API to bring this presentation generation capability into environments like Claude for Desktop. Check out the Gamma Generate API v0.2 docs at [developers.gamma.app/reference/generate-a-gamma](https://developers.gamma.app/reference/generate-a-gamma).

## What We'll Be Building

This server exposes a tool to an MCP client (like Claude for Desktop) that can take a prompt and various parameters to generate a presentation using the Gamma API. The server will return a link to the generated presentation.

## Core MCP Concepts

Model Context Protocol servers can provide three main types of capabilities:

- **Resources**: File-like data that can be read by clients (like API responses or file contents).
- **Tools**: Functions that can be called by the LLM (with user approval).
- **Prompts**: Pre-written templates that help users accomplish specific tasks.

This server primarily focuses on providing a **Tool**.

## Prerequisite Knowledge

This quickstart assumes you have familiarity with:

- Node.js and TypeScript.
- LLMs like Anthropic's Claude.
- Basic command-line usage.

## System Requirements

- Node.js (v16 or higher recommended).
- npm (Node Package Manager) or yarn.
- Access to the Gamma API. You'll need an API key, don't have one? Check out the [Gamma API docs](#) to get one.

## Set Up Your Environment

1.  **Clone the Repository / Get the Code:**
    If this project is in a Git repository, clone it:

    ```bash
    git clone git@github.com:gamma-app/gamma-mcp-server.git
    cd gamma-mcp-server
    ```
    
2.  **Initialize Your Node.js Project (if not cloned):**
    If you created a new directory, initialize a `package.json` file:

    ```bash
    npm init -y
    ```

3.  **Install Dependencies:**
    You'll need the MCP SDK, Zod for validation, node-fetch for API calls, TypeScript, and ts-node to run TypeScript directly.

    ```bash
    npm install @modelcontextprotocol/sdk zod node-fetch typescript ts-node @types/node
    # or
    # yarn add @modelcontextprotocol/sdk zod node-fetch typescript ts-node @types/node
    ```

4.  **Configure TypeScript:** 
You might want to adjust the `tsconfig.json` to suit your preferences, but the default should work. Ensure `moduleResolution` is set to `"node"` or `"node16"` / `"nodenext"` and `module` is compatible (e.g. `"commonjs"` if running with `ts-node` in a CommonJS context, or adjust for ES Modules). The provided `src/index.ts` uses ES module syntax (`import ... from`).
    A common `tsconfig.json` for ES Modules with Node.js might include:

    ```json
    {
      "compilerOptions": {
        "target": "ES2020",
        "module": "ESNext",
        "moduleResolution": "node",
        "esModuleInterop": true,
        "forceConsistentCasingInFileNames": true,
        "strict": true,
        "skipLibCheck": true,
        "outDir": "./dist" // Optional: if you plan to compile
      },
      "include": ["src/**/*"],
      "exclude": ["node_modules"]
    }
    ```

    Also, in your `package.json`, add `"type": "module"` if you are using ES Modules.

5.  **API Key Configuration:**
    Provide your Gamma API key in any of these ways (CLI overrides `.env`):

    - `.env` file (loaded via `dotenv`):
      ```
      GAMMA_API_KEY="your_actual_gamma_api_key_here"
      ```
    - Environment variable when invoking:
      ```bash
      GAMMA_API_KEY="sk-gamma-xxxx" node build/index.js
      ```
    - CLI flags (override env and `.env`):
      ```bash
      # Direct flag
      node build/index.js --api-key=sk-gamma-xxxx
      # Or pass as header
      node build/index.js --header "X-API-KEY: sk-gamma-xxxx"
      node build/index.js --header "Authorization: sk-gamma-xxxx"
      ```

    Notes:
    - If no key is supplied, requests will be sent without authentication and the Gamma API will return 401.
    - Headers provided via `--header` are merged into requests; `Authorization` is mirrored to `X-API-KEY` for convenience.

## Understanding the Server Code (`src/index.ts`)

Let's break down the key parts of the `src/index.ts` file:

1.  **Imports:**

    ```typescript
    import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
    import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
    import { z } from "zod";
    import fetch from "node-fetch";
    ```

    These lines import the necessary MCP server classes, Zod for schema definition and validation, and `node-fetch` for making HTTP requests.

2.  **Gamma API Configuration:**

    ```typescript
    const GAMMA_API_V02_BASE = "https://public-api.gamma.app/v0.2/generations";
    const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
    ```

    This sets up the base URL for the Gamma API and the API key.

3.  **`generatePresentation` Helper Function:**
    This `async` function is responsible for making the POST request to the Gamma API with the provided parameters and handling the response or errors.

4.  **MCP Server Instance:**

    ```typescript
    const server = new McpServer({
      name: "gamma-presentation",
      version: "1.0.0",
      capabilities: {
        resources: {},
        tools: {},
      },
    });
    ```

    This initializes a new MCP server with a name and version.

5.  **Tool Definition (`server.tool`):**

    ```typescript
    server.tool(
      "generate-presentation",
      "Generate a presentation using the Gamma API...",
      {
        /* Zod schema for parameters */
      },
      async (params) => {
        /* Tool execution logic */
      }
    );
    ```

    This is the core of the MCP server.

    - `"generate-presentation"`: The name of the tool that clients will call.
    - `"Generate a presentation..."`: A description of what the tool does. This is important for the LLM to understand how and when to use the tool.
    - **Schema (`zod` object):** Defines the input parameters the tool expects (e.g., `inputText`, `tone`, `audience`). `zod` is used to describe the type, whether it's optional, and provide a description for each parameter.
      - `inputText`: The main topic or prompt.
      - `tone`: Optional, e.g., 'humorous and sarcastic'.
      - `audience`: Optional, e.g., 'students'.
      - `textAmount`: Optional, 'short', 'medium', or 'long'.
      - `textMode`: Optional, 'generate' or 'summarize'.
      - `numCards`: Optional, number of slides (1-20).
      - And others like `imageModel`, `imageStyle`, `editorMode`, `additionalInstructions`.
    - **Handler Function (`async (params) => { ... }`):** This function is executed when the tool is called. It receives the parameters, calls `generatePresentation`, and formats the response (a link to the presentation or an error message).

6.  **`main` Function:**

    ```typescript
    async function main() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error("Gamma MCP Server running on stdio");
    }

    main().catch(/* ... */);
    ```

    This function sets up the server to communicate over standard input/output (stdio) and starts it.

## Running Your Server

1.  **Set the `GAMMA_API_KEY` Environment Variable:**
    Before running the server, ensure you have set the `GAMMA_API_KEY` environment variable as described in the "API Key Configuration" section above.

2.  **Start the Server:**
    Build and start the server (uses `build/index.js`):
    ```bash
    npm run build && node build/index.js --api-key=sk-gamma-xxxx
    ```
    Alternatively, you can add scripts to your `package.json`:
    ```json
    // package.json
    "scripts": {
      "build": "tsc",
      "start": "node build/index.js"
    },
    ```
    Then run:
    ```bash
    npm start -- --api-key=sk-gamma-xxxx
    # or
    # yarn start
    ```
    If successful, you should see:
    ```
    Gamma MCP Server running on stdio
    ```
    The server is now running and waiting for an MCP client to connect via stdio.

## Testing Your Server with Claude for Desktop

To use this server with Claude for Desktop, you need to configure Claude for Desktop to know how to launch your server.

1.  **Install Claude for Desktop:**
    Make sure you have Claude for Desktop installed. You can get it from the official source. Ensure it's updated to the latest version.

2.  **Locate Claude for Desktop Configuration File:**
    The configuration file is typically located at:

    - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
    - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` (e.g., `C:\Users\<YourUser>\AppData\Roaming\Claude\claude_desktop_config.json`)
    - **Linux:** `~/.config/Claude/claude_desktop_config.json`

    If the file or directories don't exist, create them.

3.  **Configure Your Server in `claude_desktop_config.json`:**
    Open `claude_desktop_config.json` in a text editor. Add your Gamma server to the `mcpServers` object.

    **Important:** You need the **absolute path** to your project directory and to `ts-node` (or `node` if you compile to JS).

    - **Finding absolute path to your project:** Navigate to your `gamma-mcp-server` directory in the terminal and run `pwd` (macOS/Linux) or `cd` (Windows, then copy the path).
    - **Finding absolute path to `npx` or `ts-node`:**
      - For `npx`: Run `which npx` (macOS/Linux) or `where npx` (Windows).
      - Often, `npx` is used, which then finds `ts-node` in your project's `node_modules/.bin` or globally. If Claude has trouble with `npx`, you might need to provide the direct path to `ts-node`.
      - A more robust way for the `command` might be to use the absolute path to your Node.js executable, and then specify `ts-node` and `src/index.ts` as arguments, ensuring the `cwd` (Current Working Directory) is set correctly.

    Here's an example configuration. **You MUST replace `/ABSOLUTE/PATH/TO/YOUR/gamma-mcp-server` with the actual absolute path.**

    You will also need to ensure that the `GAMMA_API_KEY` environment variable is available to the process launched by Claude for Desktop. How to do this depends on your OS and how Claude for Desktop launches processes. Some common methods include:

    - Setting the environment variable globally on your system.
    - If Claude for Desktop is launched from a terminal where `GAMMA_API_KEY` is already exported, it might inherit it.
    - Modifying the `command` or `args` in `claude_desktop_config.json` to explicitly pass the environment variable if your shell/Node.js setup allows (e.g., `"command": "env", "args": ["GAMMA_API_KEY=your_key", "npx", "ts-node", ...]` - this can be tricky and OS-dependent).
    - Using a wrapper script as the `command` that first sets the environment variable and then executes `npx ts-node src/index.ts`.

    A simple way for testing is often to ensure `GAMMA_API_KEY` is set in your user's global shell environment (e.g., in `~/.bashrc`, `~/.zshrc`, or system-wide environment variables on Windows) before launching Claude for Desktop.

    ```json
    {
      "mcpServers": {
        "gamma-presentation-generator": {
          "command": "node",
          "args": [
            "build/index.js",
            "--api-key=sk-gamma-xxxx"
          ],
          "cwd": "/ABSOLUTE/PATH/TO/YOUR/gamma-mcpserver"
        }
      }
    }
    ```
    If you prefer TypeScript directly during development:
    ```json
    {
      "mcpServers": {
        "gamma-presentation-generator": {
          "command": "npx",
          "args": [
            "ts-node",
            "--project",
            "tsconfig.json",
            "src/index.ts",
            "--header",
            "X-API-KEY: sk-gamma-xxxx"
          ],
          "cwd": "/ABSOLUTE/PATH/TO/YOUR/gamma-mcpserver"
        }
      }
    }
    ```

    **Explanation:**

    - `"gamma-presentation-generator"`: This is the name you give to your server configuration within Claude. It can be anything descriptive.
    - `"command"`: The executable to run. `npx` is convenient as it resolves `ts-node` from your project. If this causes issues, use the absolute path to your Node.js executable.
    - `"args"`: Arguments passed to the command.
      - Prefer pointing to the built file `build/index.js` with `node` for reliability, or use `npx ts-node src/index.ts` if you prefer running TypeScript directly during development.
    - `"cwd"`: **Crucially**, set this to the absolute path of your project's root directory (`gamma-mcp-server`). This ensures that `ts-node` can find `src/index.ts` and `node_modules`.

4.  **Save and Restart Claude for Desktop:**
    Save the `claude_desktop_config.json` file and completely restart Claude for Desktop.

5.  **Test with Commands:**
    Once Claude for Desktop restarts, it should attempt to connect to your server.

    - Look for the tool icon in the Claude for Desktop interface. Clicking it should show your `generate-presentation` tool.
    - Try prompting Claude:
      - "Generate a presentation about the future of artificial intelligence."
      - "Make a presentation on sustainable energy sources, targeting college students, make it medium length."
      - "Use the gamma tool to create a short, humorous presentation for developers about the importance of documentation."

    Claude should recognize the request, identify your tool, and (after your approval if configured) execute it. Your server (running in its own terminal or process) will then call the Gamma API, and the link to the presentation should appear in Claude's response.

## What's Happening Under the Hood

When you ask a question in Claude for Desktop:

1.  The client (Claude for Desktop) sends your question to the Claude LLM.
2.  Claude analyzes the available tools (including your `generate-presentation` tool) and decides if and how to use it.
3.  If Claude decides to use your tool, it sends a request to Claude for Desktop.
4.  Claude for Desktop executes the chosen tool by communicating with your MCP server (which it launched based on `claude_desktop_config.json`) over stdio.
5.  Your server runs the tool logic (calls the Gamma API).
6.  The results (presentation URL or error) are sent back from your server to Claude for Desktop, then to the LLM.
7.  Claude formulates a natural language response incorporating the tool's output.
8.  The response is displayed to you!

## Request/Response shape (Gamma v0.2)

- POST `https://public-api.gamma.app/v0.2/generations` with body including:
  - `inputText` (required)
  - Optional top-level fields like `textMode`, `format`, `numCards`, `cardSplit`, `additionalInstructions`, `exportAs`
  - `textOptions` (e.g., `amount`, `language`, `tone`, `audience`)
  - `imageOptions` (e.g., `source`, `model`, `style`)
  - `cardOptions`, `sharingOptions`

- Response: `{ generationId: string }`

- GET `https://public-api.gamma.app/v0.2/generations/{generationId}` returns status plus URLs. When `status` is `completed`, it includes a `gammaUrl` and may include file URLs (e.g., PDF/PPTX) depending on `exportAs`.

When `exportAs` is provided, this server downloads the file automatically to `gamma-mcpserver/output/` and returns the absolute path in the tool response alongside the `gammaUrl`.

## Troubleshooting

- **Server Not Detected by Claude for Desktop:**
  - Double-check the absolute paths in `claude_desktop_config.json` for `cwd` and potentially `command`.
  - Ensure your server name in the config (`gamma-presentation-generator` in the example) is unique.
  - Verify that `claude_desktop_config.json` is correctly formatted JSON.
  - Make sure your server runs correctly on its own using `npx ts-node src/index.ts` before trying to integrate with Claude. Check for any errors in the server's console output.
  - Ensure there are no firewalls or security software blocking `npx` or `node` from executing or communicating.
- **Errors from the Server:**
  - Check the console output of your `gamma-mcp-server` (the terminal where you ran `npx ts-node src/index.ts`). It might show errors from the Gamma API or within the server logic.
  - Ensure your `GAMMA_API_KEY` is correct and has not expired.
  - Verify network connectivity.
- **Claude Doesn't Use the Tool:**
  - Make sure the tool description in `src/index.ts` (`server.tool(...)`) is clear and accurately describes what the tool does and its parameters. This helps the LLM decide when to use it.
  - Ensure the parameter descriptions in the Zod schema are also clear.
- **`ts-node` or Module Issues:**
  - Ensure `typescript` and `ts-node` are installed locally in your project (`npm ls ts-node typescript`).
  - Check your `tsconfig.json` for compatibility with your Node.js version and module system (ESM vs CommonJS). If using ESM (`"type": "module"` in `package.json`), ensure `ts-node` is compatible or use `ts-node-esm`. The provided `index.ts` uses ES module imports.

This guide should provide a comprehensive overview of setting up and using your Gamma MCP server. Happy presenting!
