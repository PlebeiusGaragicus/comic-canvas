import type { PiTaskProfile } from '../../types';
import type { TaskProfile } from './types';

export const PROFILES: Partial<Record<PiTaskProfile, TaskProfile>> = {};

export function registerProfile(profile: TaskProfile): TaskProfile {
  PROFILES[profile.id] = profile;
  return profile;
}
