# Cloudflare agent setup for FBIS (Cursor)

Source: https://developers.cloudflare.com/agent-setup/prompt.md

## Project MCP server (configured in repository)

The version-controlled `.cursor/mcp.json` registers the official Cloudflare remote MCP server:

```json
{
  "mcpServers": {
    "cloudflare": {
      "url": "https://mcp.cloudflare.com/mcp"
    }
  }
}
```

No API tokens or account credentials are stored in the repository. Cloudflare OAuth authorizes access on the first Cloudflare tool use from Cursor.

## One-time developer-machine steps

1. Pull the latest FBIS repository changes and open the FBIS project in Cursor.
2. Install the official Cloudflare skills on that **local** developer machine (Node.js/npm required):

   ```powershell
   npx -y skills add cloudflare/skills --skill '*' --yes --global
   ```

3. Reload/restart Cursor so it discovers project MCP configuration and installed skills.
4. Open Cursor's MCP settings and verify the **cloudflare** server is available. Invoke a Cloudflare tool, then complete the OAuth consent in your browser.

No Cloudflare API token is required in `.cursor/mcp.json`. Keep OAuth credentials and secrets out of git.

## Optional CLI

Cloudflare's `cf` CLI is beta and **not installed by this repository**. The FBIS project already uses Wrangler/Cloudflare Pages, so preserve the existing Wrangler configuration and deployment workflow. Install `cf` separately only when it is explicitly wanted.

## Deployment safety

Agent setup grants development tooling; it does **not** approve any FBIS production D1 migration or cutover. NBA remains governed by its separate schema, parity, receipt, and strict-routing gates. Do not create arbitrary production resources or toggle `SPORT_DB_MODE_*` as part of agent setup.
