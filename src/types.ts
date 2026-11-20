// The two things a brand supplies: what it is, and what it can do.
//
// A skill is written once. The MCP server exposes it as a tool for a person's
// assistant; the A2A endpoint exposes it as a skill for another agent. Two
// protocols, one definition — because the moment they are defined separately
// they start telling different stories about the same capability.
import type { z } from "zod";

/**
 * Levels are a safety boundary, not a category:
 *   1 — findable. Public facts anyone could read off the website.
 *   2 — queryable. Public data, searched and filtered on the caller's behalf.
 *   3 — actionable. Changes something or touches money. Off unless the brand
 *       explicitly turns it on, and refused at the door if it hasn't.
 */
export type SkillLevel = 1 | 2 | 3;

export type Skill<I extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: string;
  name: string;
  description: string;
  inputSchema: I;
  level: SkillLevel;
  /** Listed on the public agent card and callable without credentials. */
  public: boolean;
  /** Short phrases an agent can use to decide whether this skill fits. */
  examples?: string[];
  tags?: string[];
  /**
   * The only fields a result may contain. Anything else is stripped before it
   * leaves the building — a handler that accidentally selects a column it
   * shouldn't cannot leak it.
   */
  returns: readonly string[];
  handler: (input: z.infer<I>, ctx: SkillContext) => Promise<unknown>;
};

export type SkillContext = {
  /** Who is calling, as best we can tell: an agent id, or an IP. */
  caller: string;
  brand: BrandConfig;
};

export type AgentCallLog = {
  skill: string;
  caller: string;
  input: unknown;
  latencyMs: number;
  resultBytes: number;
  ok: boolean;
  error?: string;
  protocol: "mcp" | "a2a";
};

export type BrandConfig = {
  /** Public name, as a person would say it. */
  name: string;
  description: string;
  /** Absolute https origin, no trailing slash. */
  url: string;
  provider: { organization: string; url: string };
  /** Semver of the agent surface, not of the product. */
  version: string;
  documentationUrl?: string;
  iconUrl?: string;
  /** Level 3 stays refused until a brand deliberately turns it on. */
  enableLevel3?: boolean;
  /** Requests per minute per caller. 60 unless a brand says otherwise. */
  rateLimitPerMinute?: number;
  /** Where every call is recorded. The brand owns the table. */
  logCall: (entry: AgentCallLog) => Promise<void>;
  /**
   * How many calls this caller has made in the last minute. Supplied by the
   * brand because serverless instances don't share memory, so an in-process
   * counter silently stops limiting the moment there is more than one.
   */
  countRecentCalls?: (caller: string, sinceIso: string) => Promise<number>;
};

/**
 * Defines one skill with its input type intact.
 *
 * Writing `const skills: Skill[] = [...]` widens the schema generic, and the
 * handler's argument collapses to `unknown` — so every handler would have to
 * re-assert the shape it already declared. This keeps the inference per skill
 * while the array stays a plain Skill[].
 */
export function defineSkill<I extends import("zod").ZodTypeAny>(skill: Skill<I>): Skill {
  return skill as unknown as Skill;
}
