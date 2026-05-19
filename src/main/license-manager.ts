// Open-source release: all features permanently unlocked. No license required.

export type LicenseTier = 'free' | 'pro' | 'lifetime';

export interface LicenseInfo {
  tier: LicenseTier;
  valid: boolean;
  key: string | null;
}

export async function getLicense(): Promise<LicenseInfo> {
  return { tier: 'lifetime', valid: true, key: null };
}

export async function activateLicense(_key: string): Promise<LicenseInfo & { success: boolean }> {
  return { tier: 'lifetime', valid: true, key: null, success: true };
}

export async function deactivateLicense(): Promise<void> {}
