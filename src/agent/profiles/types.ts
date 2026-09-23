/** Task profile contracts (ported from pi_profiles.py dataclasses). */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { PiTaskProfile } from '../../types';

export interface TaskArgs {
  target: string | null;
  force: boolean;
  instructions: string | null;
}

/** One unit of work inside a task. `buildPrompt` returning null means there
 *  is nothing for the model to do; the runtime then only calls `onSuccess(false)`. */
export interface TaskStep {
  name: string;
  /** System prompt: persona/task preamble + skill markdown (+ prompt guide). */
  systemPrompt: string;
  /** Tools this step's agent may call (the only side-effect channel). */
  tools: AgentTool[];
  /** Seed the book as a message prefix before the task prompt. */
  seedBook: boolean;
  buildPrompt: () => Promise<string | null>;
  /** Validate by state diff; throw when the step did not deliver. May return
   *  a dict merged into the ledger `source`. `ran` is false when skipped. */
  onSuccess: (ran: boolean) => Promise<Record<string, unknown> | null | void>;
  /** Follow-up sent on the same agent when validation fails (up to two times). */
  repairPrompt?: string;
}

export interface TaskProfile {
  id: PiTaskProfile;
  title: (target: string | null) => string;
  acceptsTarget: boolean;
  acceptsInstructions: boolean;
  /** Names of the domain tools this profile registers (for display/tests). */
  tools: string[];
  /** Throw a ServiceError when the task must not start. */
  precheck: (slug: string, args: TaskArgs) => Promise<void>;
  /** Lazily yields steps; resumed after each step so it can read state
   *  produced by earlier steps (extract-all reads what discovery registered). */
  plan: (slug: string, args: TaskArgs) => AsyncGenerator<TaskStep, void, void>;
}

export function taskArgs(options: { target?: string | null; force?: boolean; instructions?: string | null } = {}): TaskArgs {
  return { target: options.target ?? null, force: options.force ?? false, instructions: options.instructions ?? null };
}
