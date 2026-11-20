// The registry: every skill a brand offers, and the one gate they all pass.
//
// Guardrails live here rather than in each protocol adapter, so MCP and A2A
// cannot enforce different rules about the same skill — which is exactly the
// kind of drift that turns a read-only surface into a write one by accident.
import type { AgentCallLog, BrandConfig, Skill, SkillContext } from "./types";

export class AgentKitError extends Error {
  constructor(message: string, readonly code: "not_found" | "forbidden" | "rate_limited" | "bad_input" | "failed") {
    super(message);
  }
}

/** Keeps only the fields a skill declared it returns. */
function pick(value: unknown, allow: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => pick(v, allow));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Last-resort limiter for a single process. Real limits come from the brand. */
const memory = new Map<string, number[]>();
function memoryCount(caller: string, windowMs: number): number {
  const now = Date.now();
  const hits = (memory.get(caller) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  memory.set(caller, hits);
  if (memory.size > 5000) memory.clear();      // bounded; this is a fallback
  return hits.length;
}

export function createRegistry(brand: BrandConfig, skills: Skill[]) {
  const byId = new Map(skills.map((s) => [s.id, s]));

  /** What the agent card and tool list may advertise. */
  function listed(): Skill[] {
    return skills.filter((s) => s.public && (s.level < 3 || brand.enableLevel3 === true));
  }

  async function call(id: string, rawInput: unknown, ctx: Omit<SkillContext, "brand">, protocol: "mcp" | "a2a"): Promise<unknown> {
    const started = Date.now();
    const skill = byId.get(id);

    const record = async (ok: boolean, resultBytes: number, error?: string) => {
      const entry: AgentCallLog = {
        skill: id, caller: ctx.caller, input: rawInput,
        latencyMs: Date.now() - started, resultBytes, ok, error, protocol,
      };
      // Logging must never be the reason a good call fails.
      await brand.logCall(entry).catch(() => {});
    };

    if (!skill) {
      await record(false, 0, "unknown skill");
      throw new AgentKitError(`No skill called "${id}".`, "not_found");
    }

    // Level 3 is refused at the door, not inside the handler, so a brand that
    // hasn't opted in cannot reach the code that would change something.
    if (skill.level >= 3 && brand.enableLevel3 !== true) {
      await record(false, 0, "level 3 disabled");
      throw new AgentKitError(`"${id}" isn't available on this brand.`, "forbidden");
    }
    if (!skill.public) {
      await record(false, 0, "not public");
      throw new AgentKitError(`"${id}" isn't available.`, "forbidden");
    }

    const limit = brand.rateLimitPerMinute ?? 60;
    const sinceIso = new Date(Date.now() - 60_000).toISOString();
    const used = brand.countRecentCalls
      ? await brand.countRecentCalls(ctx.caller, sinceIso).catch(() => 0)
      : memoryCount(ctx.caller, 60_000);
    if (used >= limit) {
      await record(false, 0, "rate limited");
      throw new AgentKitError(`Slow down — ${limit} requests a minute.`, "rate_limited");
    }

    const parsed = skill.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
      await record(false, 0, why);
      throw new AgentKitError(why, "bad_input");
    }

    try {
      const raw = await skill.handler(parsed.data, { ...ctx, brand });
      const safe = pick(raw, skill.returns);
      const bytes = JSON.stringify(safe ?? null).length;
      await record(true, bytes);
      return safe;
    } catch (e) {
      const msg = (e as Error)?.message ?? "failed";
      await record(false, 0, msg);
      throw new AgentKitError(msg, "failed");
    }
  }

  return { brand, skills, listed, get: (id: string) => byId.get(id), call };
}

export type Registry = ReturnType<typeof createRegistry>;
