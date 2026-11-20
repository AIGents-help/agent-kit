// llms.txt — the plain-language version of the same facts.
//
// Same brand config as the agent card, so the two cannot describe different
// products. One is for agents that speak A2A; this is for everything else
// that just reads the site.
import type { Registry } from "./registry";

export function buildLlmsTxt(reg: Registry, extra?: { notes?: string[]; links?: { label: string; href: string }[] }): string {
  const b = reg.brand;
  const lines: string[] = [
    `# ${b.name}`,
    "",
    `> ${b.description}`,
    "",
    `Site: ${b.url}`,
    `Operated by: ${b.provider.organization} (${b.provider.url})`,
    "",
    "## For agents",
    "",
    `- Agent card: ${b.url}/.well-known/agent-card.json`,
    `- A2A endpoint (JSON-RPC, v1.0): ${b.url}/a2a`,
    `- MCP endpoint (Streamable HTTP): ${b.url}/mcp`,
    "",
    "## What you can ask for",
    "",
  ];
  for (const s of reg.listed()) lines.push(`- \`${s.id}\` — ${s.description}`);
  lines.push("");
  if (extra?.links?.length) {
    lines.push("## Useful pages", "");
    for (const l of extra.links) lines.push(`- [${l.label}](${l.href})`);
    lines.push("");
  }
  lines.push(
    "## Rules",
    "",
    "- Everything here is public information already shown to a visitor who isn't signed in.",
    "- Results carry a link. Send the person there to finish — bookings and payments happen on the site, with a human.",
    "- Read-only. Nothing here books, buys, or changes anything.",
    "",
  );
  if (extra?.notes?.length) lines.push(...extra.notes, "");
  return lines.join("\n");
}
