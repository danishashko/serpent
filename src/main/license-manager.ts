import keytar from 'keytar';
import axios from 'axios';
import crypto from 'crypto';
import os from 'os';

const KEYTAR_SERVICE = 'serpent';
const KEYTAR_ACCOUNT = 'license_key';
const KEYTAR_MACHINE_ACCOUNT = 'machine_id';
const KEYGEN_ACCOUNT = 'f8c0798a-1d9d-4e6d-b2b9-f1b709277cea';
const KEYGEN_API = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}`;
const LIFETIME_POLICY_ID = '27a1c2dd-2c3d-4a9e-8f36-f34f4e5b1014';

export type LicenseTier = 'free' | 'pro' | 'lifetime';

export interface LicenseInfo {
  tier: LicenseTier;
  valid: boolean;
  key: string | null;
}

function getMachineFingerprint(): string {
  const raw = [
    os.hostname(),
    os.userInfo().username,
    process.env.COMPUTERNAME ?? '',
    process.env.USERNAME ?? '',
  ].join('::');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function tierFromPolicy(policyId: string | null | undefined): LicenseTier {
  return policyId === LIFETIME_POLICY_ID ? 'lifetime' : 'pro';
}

async function callValidateKey(
  key: string,
  fingerprint?: string,
): Promise<{ valid: boolean; code: string; licenseId: string | null; policyId: string | null }> {
  const meta: Record<string, unknown> = { key };
  if (fingerprint) meta.scope = { fingerprint };

  const response = await axios.post(
    `${KEYGEN_API}/licenses/actions/validate-key`,
    { meta },
    {
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      timeout: 10_000,
    },
  );

  const respMeta = response.data?.meta ?? {};
  const data = response.data?.data ?? null;
  return {
    valid: Boolean(respMeta.valid),
    code: String(respMeta.code ?? 'UNKNOWN'),
    licenseId: data?.id ?? null,
    policyId: data?.relationships?.policy?.data?.id ?? null,
  };
}

async function callActivateMachine(key: string, licenseId: string, fingerprint: string): Promise<string> {
  const response = await axios.post(
    `${KEYGEN_API}/machines`,
    {
      data: {
        type: 'machines',
        attributes: {
          fingerprint,
          platform: process.platform,
          name: os.hostname(),
        },
        relationships: {
          license: { data: { type: 'licenses', id: licenseId } },
        },
      },
    },
    {
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
        Authorization: `License ${key}`,
      },
      timeout: 10_000,
    },
  );
  return response.data.data.id as string;
}

async function callDeactivateMachine(key: string, machineId: string): Promise<void> {
  await axios.delete(`${KEYGEN_API}/machines/${machineId}`, {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: `License ${key}`,
    },
    timeout: 10_000,
  });
}

export async function getLicense(): Promise<LicenseInfo> {
  const key = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  if (!key) return { tier: 'free', valid: false, key: null };

  try {
    const fingerprint = getMachineFingerprint();
    const result = await callValidateKey(key, fingerprint);

    if (result.valid) {
      return { tier: tierFromPolicy(result.policyId), valid: true, key };
    }

    if (result.code === 'NO_MACHINE' || result.code === 'NO_MACHINES') {
      if (result.licenseId) {
        try {
          const machineId = await callActivateMachine(key, result.licenseId, fingerprint);
          await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_MACHINE_ACCOUNT, machineId);
          return { tier: tierFromPolicy(result.policyId), valid: true, key };
        } catch {
          // Silent failure — fall through to free
        }
      }
    }

    return { tier: 'free', valid: false, key };
  } catch {
    // Network error: grant offline grace rather than block the user
    return { tier: 'pro', valid: true, key };
  }
}

export async function activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = licenseKey.trim();
  if (!trimmed) return { success: false, error: 'License key cannot be empty.' };

  try {
    const fingerprint = getMachineFingerprint();
    const result = await callValidateKey(trimmed, fingerprint);

    if (result.valid) {
      // Machine already activated for this fingerprint
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, trimmed);
      return { success: true };
    }

    switch (result.code) {
      case 'NO_MACHINE':
      case 'NO_MACHINES':
      case 'FINGERPRINT_SCOPE_MISMATCH': {
        if (!result.licenseId) return { success: false, error: 'Could not retrieve license details.' };
        try {
          const machineId = await callActivateMachine(trimmed, result.licenseId, fingerprint);
          await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, trimmed);
          await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_MACHINE_ACCOUNT, machineId);
          return { success: true };
        } catch (err) {
          if (axios.isAxiosError(err)) {
            const errors = err.response?.data?.errors as Array<{ code?: string; detail?: string }> | undefined;
            if (errors?.length) {
              const code = errors[0]?.code ?? '';
              if (code === 'MACHINE_LIMIT_EXCEEDED' || code === 'TOO_MANY_MACHINES') {
                return {
                  success: false,
                  error: 'Machine limit reached. Please deactivate this license on another machine first.',
                };
              }
              return { success: false, error: errors[0].detail ?? 'Machine activation failed.' };
            }
          }
          return { success: false, error: 'Machine activation failed. Please try again.' };
        }
      }

      case 'TOO_MANY_MACHINES':
        return {
          success: false,
          error: 'Machine limit reached. Please deactivate this license on another machine first.',
        };
      case 'EXPIRED':
        return { success: false, error: 'This license has expired.' };
      case 'SUSPENDED':
        return { success: false, error: 'This license has been suspended.' };
      case 'NOT_FOUND':
        return { success: false, error: 'Invalid license key.' };
      default:
        return { success: false, error: `Activation failed (${result.code}). Please try again.` };
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const code = err.code ?? '';
      if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(code)) {
        return { success: false, error: 'Cannot reach license server. Check your internet connection.' };
      }
    }
    return { success: false, error: 'License validation failed. Please try again.' };
  }
}

export async function deactivateLicense(): Promise<void> {
  const key = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  const machineId = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_MACHINE_ACCOUNT);
  if (key && machineId) {
    try {
      await callDeactivateMachine(key, machineId);
    } catch {
      // Best-effort — remove locally regardless
    }
  }
  await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_MACHINE_ACCOUNT);
}
