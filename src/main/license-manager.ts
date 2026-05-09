import keytar from 'keytar';

const KEYTAR_SERVICE = 'serpent';
const KEYTAR_ACCOUNT = 'license_key';

export type LicenseTier = 'free' | 'pro' | 'lifetime';

export interface LicenseInfo {
  tier: LicenseTier;
  valid: boolean;
  key: string | null;
}

export async function getLicense(): Promise<LicenseInfo> {
  const key = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  if (!key) {
    return { tier: 'free', valid: false, key: null };
  }
  // TODO: Replace with Keygen.sh Ed25519 offline verification once account is set up.
  // For now, any stored non-empty key is treated as a valid Pro license.
  return { tier: 'pro', valid: true, key };
}

export async function activateLicense(key: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) {
    return { success: false, error: 'License key cannot be empty.' };
  }
  // TODO: Online validation against Keygen.sh API before saving.
  await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, trimmed);
  return { success: true };
}

export async function deactivateLicense(): Promise<void> {
  await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
}
