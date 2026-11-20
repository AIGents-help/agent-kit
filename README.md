# @aigents/agent-kit

Make a brand findable and usable by AI agents. Define a skill once; it is
served as an **MCP tool** (for a person's assistant) and as an **A2A v1.0
skill** (for other agents), from the same definition.

Built against the normative [`a2a.proto`][proto] (v1.0.1), not the prose on
the docs site — several field names differ between the two, and the proto is
the one that is authoritative.

[proto]: https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto

## What a brand gets

| Route | What it is |
|---|---|
| `/.well-known/agent-card.json` | The A2A agent card. Open CORS; agents find you here. |
| `/a2a` | A2A v1.0, JSON-RPC binding. `SendMessage`, `GetExtendedAgentCard`. |
| `/mcp` | MCP over Streamable HTTP. |
| `/llms.txt` | The same facts in plain language, for everything else. |

## Adding it to a brand — about 20 minutes

**1. Install** (workspace, or a git dependency):

```bash
npm install @aigents/agent-kit zod@^4 mcp-handler@^2 @modelcontextprotocol/server@^2
```

**2. Describe the brand** — `agent/brand.config.ts`:

```ts
import type { BrandConfig } from "@aigents/agent-kit";

export const brand: BrandConfig = {
  name: "YourBrand",
  description: "One sentence a stranger would understand.",
  url: "https://www.yourbrand.com",
  version: "1.0.0",
  provider: { organization: "AIGents LLC", url: "https://aigents.help" },
  enableLevel3: false,            // anything that writes stays refused
  rateLimitPerMinute: 60,
  async logCall(entry) { /* insert into your agent_calls table */ },
  async countRecentCalls(caller, sinceIso) { /* count rows; see below */ },
};
```

**3. Write skills** — `agent/skills.ts`:

```ts
import { z } from "zod";
import { defineSkill, type Skill } from "@aigents/agent-kit";

export const skills: Skill[] = [
  defineSkill({
    id: "search_things",
    name: "Search things",
    description: "What an agent should expect back, in a sentence.",
    level: 2,                      // 1 findable · 2 queryable · 3 actionable
    public: true,
    tags: ["search"],
    inputSchema: z.object({ query: z.string().max(200).optional() }),
    returns: ["id", "title", "url"] as const,   // the allowlist
    handler: async ({ query }) => findThings(query),
  }),
];
```

**4. Mount four routes.** In a Next.js App Router project:

```ts
// agent/registry.ts
import { createRegistry } from "@aigents/agent-kit";
import { brand } from "./brand.config";
import { skills } from "./skills";
export const registry = createRegistry(brand, skills);

// app/mcp/route.ts
import { createMcpRoute } from "@aigents/agent-kit";
import { registry } from "@/agent/registry";
const handler = createMcpRoute(registry);
export { handler as GET, handler as POST, handler as DELETE };

// app/a2a/route.ts
import { createA2aHandler } from "@aigents/agent-kit";
import { registry } from "@/agent/registry";
export const POST = createA2aHandler(registry);

// app/.well-known/agent-card.json/route.ts
import { buildAgentCard } from "@aigents/agent-kit";
import { registry } from "@/agent/registry";
export const GET = async () =>
  Response.json(buildAgentCard(registry), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });

// app/llms.txt/route.ts
import { buildLlmsTxt } from "@aigents/agent-kit";
import { registry } from "@/agent/registry";
export const GET = async () =>
  new Response(buildLlmsTxt(registry), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
```

Mark each `export const dynamic = "force-dynamic"`.

**5. Add the log table** and exclude the four routes from any middleware.

```sql
create table agent_calls (
  id uuid primary key default gen_random_uuid(),
  skill text not null, caller text not null,
  protocol text not null check (protocol in ('mcp','a2a')),
  input jsonb, latency_ms integer not null default 0,
  result_bytes integer not null default 0,
  ok boolean not null default true, error text,
  created_at timestamptz not null default now()
);
create index on agent_calls (caller, created_at desc);
alter table agent_calls enable row level security;   -- service role only
```

## The guardrails, and why they're here and not in your handler

- **Level 3 is refused at the door.** A skill marked level 3 never reaches its
  handler unless the brand config says `enableLevel3: true`. A brand that
  hasn't opted in cannot accidentally expose a write.
- **Returns are an allowlist.** Whatever a handler returns is filtered to the
  fields the skill declared. A `select *` that picks up a private column
  cannot leak it.
- **Rate limits are counted where everyone can see them.** Serverless
  instances don't share memory, so an in-process counter silently stops
  limiting the moment there is more than one instance — supply
  `countRecentCalls` and it counts rows in your log table instead. There is an
  in-memory fallback, and it is only a fallback.
- **Every call is logged** — skill, caller, input, latency, result size,
  outcome — before the result is returned.

All four live in `registry.call`, which both protocols go through. MCP and
A2A therefore cannot come to different conclusions about what a skill is
allowed to do.

## How routing works on `/a2a`

An agent that read your card sends the skill id in `metadata.skill` (or a
`data` part). A person's assistant sends words, and the handler matches them
against skill ids, names and tags. If nothing matches, the Task comes back
`TASK_STATE_FAILED` listing the skills that exist — a dead end that tells you
where the road is.

## Not included

Signed agent cards (`signatures` is present and empty — the hook is there),
streaming (`SendStreamingMessage`), push notifications, and task persistence:
every skill here is a read that finishes inside the request, so `GetTask` has
nothing to look up.
