// The agent card: /.well-known/agent-card.json
//
// Field names follow A2A v1.0's normative a2a.proto under proto3 JSON mapping
// (lowerCamelCase), not the prose in the docs site, which paraphrases some of
// them. Required by the spec: name, description, supportedInterfaces, version,
// capabilities, defaultInputModes, defaultOutputModes, skills.
import type { Registry } from "./registry";

export type AgentCard = Record<string, unknown>;

export function buildAgentCard(reg: Registry): AgentCard {
  const b = reg.brand;
  return {
    name: b.name,
    description: b.description,
    version: b.version,
    provider: { organization: b.provider.organization, url: b.provider.url },
    ...(b.documentationUrl ? { documentationUrl: b.documentationUrl } : {}),
    ...(b.iconUrl ? { iconUrl: b.iconUrl } : {}),
    supportedInterfaces: [
      {
        url: `${b.url}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        tenant: "",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: reg.listed().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags ?? [],
      ...(s.examples?.length ? { examples: s.examples } : {}),
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
    // Signed cards come later; the hook is here so adding one is a config
    // change rather than a shape change that breaks every consumer.
    signatures: [],
  };
}

/** Where a brand mounts the card, per spec section 8. */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";
