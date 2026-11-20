// The MCP surface: the same skills, as tools for a person's assistant.
//
// mcp-handler turns an MCP server definition into a Web-standard handler, so
// it mounts straight into a Next.js route. Every tool goes through the same
// registry.call as A2A does — the guardrails are not reimplemented here, and
// so cannot disagree with the other protocol about what a skill may do.
import { createMcpHandler } from "mcp-handler";
import type { Registry } from "./registry";

/**
 * What we actually use of the MCP server object.
 *
 * registerTool's modern overload infers its output type from `outputSchema`,
 * which we don't pass — the registry already knows what each skill returns,
 * and keeping a second copy as a zod schema would be one more thing to drift.
 * With no `outputSchema` the overload can't resolve, so the call is made
 * against the shape we rely on rather than silently falling back to the
 * deprecated raw-shape signature.
 */
type ToolRegistrar = {
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown },
    cb: (input: unknown, extra: unknown) => Promise<{
      content: { type: "text"; text: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    }>,
  ): unknown;
};

/** Best-effort caller id. MCP gives us headers, not a socket. */
function callerOf(extra: unknown): string {
  const headers = (extra as { requestInfo?: { headers?: Record<string, string | string[]> } })?.requestInfo?.headers;
  const fwd = headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  return first?.split(",")[0]?.trim() || "mcp";
}

export function createMcpRoute(reg: Registry) {
  return createMcpHandler(
    (server) => {
      const s = server as unknown as ToolRegistrar;
      for (const skill of reg.listed()) {
        s.registerTool(
          skill.id,
          {
            title: skill.name,
            description: skill.description,
            inputSchema: skill.inputSchema,
          },
          async (input, extra) => {
            try {
              const result = await reg.call(skill.id, input, { caller: callerOf(extra) }, "mcp");
              return {
                // Text for assistants that only read text, structured for the
                // ones that can use the real shape.
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                structuredContent: { result } as Record<string, unknown>,
              };
            } catch (e) {
              return {
                isError: true,
                content: [{ type: "text" as const, text: (e as Error).message }],
              };
            }
          },
        );
      }
    },
    { serverInfo: { name: reg.brand.name, version: reg.brand.version } },
  );
}
