// The A2A v1.0 endpoint, JSON-RPC binding.
//
// Shapes follow the normative a2a.proto under proto3 JSON mapping:
// methods are PascalCase ("SendMessage", "GetTask"), TaskState serialises as
// its enum name ("TASK_STATE_COMPLETED"), and field names are lowerCamelCase.
// The docs site paraphrases several of these; the proto is the source.
//
// One message in, one completed Task out, with the result as an Artifact.
// There is no long-running work here — every skill is a read — so a Task is
// born and finished inside the request.
import { AgentKitError, type Registry } from "./registry";

const A2A_VERSION = "1.0";

type JsonRpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

const rpcError = (id: unknown, code: number, message: string, data?: unknown) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }, { status: 200 });

const uuid = () => globalThis.crypto.randomUUID();

/** Text a caller sent us, flattened out of the Message parts. */
function textOf(message: Record<string, unknown> | undefined): string {
  const parts = (message?.parts as Array<Record<string, unknown>>) ?? [];
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join(" ").trim();
}

/** Structured input a caller sent, if they sent any. */
function dataOf(message: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const parts = (message?.parts as Array<Record<string, unknown>>) ?? [];
  for (const p of parts) if (p.data && typeof p.data === "object") return p.data as Record<string, unknown>;
  return null;
}

/**
 * Which skill a message is asking for.
 *
 * An explicit skill id wins — that is what another agent reading the card
 * will send. Free text falls back to matching against ids, names and tags,
 * so a person's assistant can ask in words.
 */
function routeToSkill(reg: Registry, message: Record<string, unknown> | undefined, metadata: Record<string, unknown> | undefined) {
  const explicit = (metadata?.skill ?? metadata?.skillId ?? dataOf(message)?.skill) as string | undefined;
  if (explicit && reg.get(explicit)) return reg.get(explicit)!;

  const text = textOf(message).toLowerCase();
  if (!text) return null;
  const candidates = reg.listed();
  let best: { skill: (typeof candidates)[number]; score: number } | null = null;
  for (const s of candidates) {
    let score = 0;
    if (text.includes(s.id.replace(/_/g, " "))) score += 5;
    if (text.includes(s.name.toLowerCase())) score += 4;
    for (const t of s.tags ?? []) if (text.includes(t.toLowerCase())) score += 2;
    for (const w of s.description.toLowerCase().split(/\W+/)) {
      if (w.length > 5 && text.includes(w)) score += 1;
    }
    if (!best || score > best.score) best = { skill: s, score };
  }
  return best && best.score > 0 ? best.skill : null;
}

export function createA2aHandler(reg: Registry) {
  return async function POST(req: Request): Promise<Response> {
    // The spec requires the header; it also says an absent header may be
    // treated as 0.3. We accept a missing one and refuse a mismatched major.
    const sent = req.headers.get("a2a-version") ?? req.headers.get("A2A-Version");
    if (sent && sent.split(".")[0] !== "1") {
      return rpcError(null, -32000, `VersionNotSupportedError: this agent speaks A2A ${A2A_VERSION}.`);
    }

    let body: JsonRpcRequest;
    try { body = (await req.json()) as JsonRpcRequest; }
    catch { return rpcError(null, -32700, "Parse error"); }

    const id = body.id ?? null;
    const caller = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (body.method === "GetExtendedAgentCard") {
      const { buildAgentCard } = await import("./agent-card");
      return Response.json({ jsonrpc: "2.0", id, result: buildAgentCard(reg) }, a2aHeaders());
    }
    if (body.method !== "SendMessage") {
      return rpcError(id, -32601, `Method not found: ${String(body.method)}. This agent implements SendMessage.`);
    }

    const params = (body.params ?? {}) as Record<string, unknown>;
    const message = params.message as Record<string, unknown> | undefined;
    if (!message) return rpcError(id, -32602, "params.message is required.");

    const skill = routeToSkill(reg, message, params.metadata as Record<string, unknown> | undefined);
    const contextId = (message.contextId as string) || uuid();
    const taskId = uuid();

    if (!skill) {
      return Response.json({
        jsonrpc: "2.0", id,
        result: {
          task: failedTask(taskId, contextId,
            `I couldn't tell which skill you wanted. Ask for one by id — ${reg.listed().map((s) => s.id).join(", ")} — or put it in metadata.skill.`),
        },
      }, a2aHeaders());
    }

    // Structured input if given, otherwise the words themselves, which most
    // skills accept as a free-text query.
    const input = dataOf(message) ?? { query: textOf(message) };

    try {
      const result = await reg.call(skill.id, stripSkillKey(input), { caller }, "a2a");
      return Response.json({
        jsonrpc: "2.0", id,
        result: {
          task: {
            id: taskId,
            contextId,
            status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
            artifacts: [{
              artifactId: uuid(),
              name: skill.id,
              description: skill.description,
              parts: [{ data: result as object, mediaType: "application/json" }],
            }],
            history: [message],
          },
        },
      }, a2aHeaders());
    } catch (e) {
      const err = e as AgentKitError;
      return Response.json({
        jsonrpc: "2.0", id,
        result: { task: failedTask(taskId, contextId, err.message) },
      }, a2aHeaders());
    }
  };
}

/** `skill` is routing metadata, not an argument any handler expects. */
function stripSkillKey(input: Record<string, unknown>): Record<string, unknown> {
  const { skill: _skill, ...rest } = input;
  void _skill;
  return rest;
}

function failedTask(id: string, contextId: string, why: string) {
  return {
    id, contextId,
    status: {
      state: "TASK_STATE_FAILED",
      timestamp: new Date().toISOString(),
      message: {
        messageId: uuid(),
        role: "ROLE_AGENT",
        parts: [{ text: why }],
      },
    },
    artifacts: [],
  };
}

function a2aHeaders() {
  return { headers: { "A2A-Version": A2A_VERSION, "Access-Control-Allow-Origin": "*" } };
}

export { A2A_VERSION };
