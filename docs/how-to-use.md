# How to Use

## Running Locally

```bash
cd workspace/a-workbench
npm install
npm run dev
```

Server runs on `:3000`, portal on `:3001`.

## Connecting Claude Code

1. Get your API key from the portal (`http://localhost:3000/portal`)
2. Configure Claude Code:

```bash
claude config set mcpServers.workbench '{"url": "http://localhost:3000/mcp", "headers": {"Authorization": "Bearer YOUR_API_KEY"}}'
```

3. Use tools:

```
You: search for jira tools
Claude: search_tools("jira")

You: create a ticket
Claude: execute_tool("jira_create_issue", {project: "PROJ", summary: "Bug"})

You: connect my jira
Claude: get_auth_url("jira") → open URL → authorize → done
```

## Adding a Plugin

1. Create `packages/plugins/my-integration/`:

```ts
// manifest.ts
export default {
  name: "my-integration",
  version: "1.0.0",
  auth: { type: "none" },
};

// tools/hello.ts
export const hello = {
  name: "my_hello",
  description: "Say hello",
  inputSchema: z.object({ name: z.string() }),
  handler: async (ctx, args) => `Hello ${args.name}!`,
};
```

2. Restart server. Plugin auto-loaded.

## Docker

```bash
docker-compose up -d
```

Access at `http://localhost:3000`.
