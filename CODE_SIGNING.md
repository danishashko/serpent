# Code Signing Guide

Serpent uses **SignPath Foundation** for free code signing (open-source projects).

## Why Code Signing Matters

Without a code signing certificate, Windows SmartScreen shows a warning when users download and run the installer. Code signing eliminates that warning and builds trust.

## Current Status

| Item | Status |
|------|--------|
| GitHub Actions release workflow | ✅ Ready |
| OSI-approved license (MIT) | ✅ Done |
| Public repository | ✅ Done |
| Published release | ✅ v1.0.0 |
| "Code signing policy" on home page + release page | ✅ Done |
| MFA on GitHub | ⬜ Confirm |
| SignPath application | ⏳ Not submitted |
| Signed builds | ❌ Not yet |

## How to Set Up SignPath (Free for OSS)

### Step 1: Apply

Submit the application form at [signpath.org/apply](https://signpath.org/apply). The
eligibility rules it is judged against are at [signpath.org/terms](https://signpath.org/terms).

Details to supply:

| Field | Value |
|-------|-------|
| Project URL | `https://github.com/danishashko/serpent` |
| License | MIT (OSI-approved, no commercial dual-licensing) |
| Description | AI-native local SEO spider — a free, open-source technical SEO crawler |
| Latest release | `https://github.com/danishashko/serpent/releases/tag/v1.0.0` |
| Code signing policy | `https://github.com/danishashko/serpent#code-signing-policy` |
| Build system | GitHub Actions (`.github/workflows/release.yml`), tag-triggered |

The certificate is issued to SignPath Foundation, not to this project — SignPath is not a
CA and cannot issue certificates to individuals or projects. Approval is discretionary and
there is no appeal process.

### Step 2: Configure SignPath

After approval, you'll receive:
- **Organization ID**
- **API Token**
- Access to the SignPath dashboard

In the SignPath dashboard:
1. Create a **Project** named `serpent`
2. Create a **Signing Policy** named `release-signing`
3. Create an **Artifact Configuration** for the `.exe` installer

### Step 3: Add GitHub Secret

1. Go to your repo → Settings → Secrets and variables → Actions
2. Add a new secret: `SIGNPATH_API_TOKEN` = your API token from SignPath

### Step 4: Enable Signing in the Workflow

In `.github/workflows/release.yml`, uncomment the two SignPath steps and fill in your organization ID.

### Step 5: Test

Push a version tag to trigger a signed build:

```bash
npm version patch
git push origin main --tags
```

## Alternative: Self-Signed (Development Only)

For local testing, you can create a self-signed certificate:

```powershell
New-SelfSignedCertificate -Type CodeSigning -Subject "CN=Serpent Dev" -CertStoreLocation Cert:\CurrentUser\My
```

This won't eliminate SmartScreen warnings but is useful for testing the signing workflow.

## Release Workflow

Once signing is set up, the release process is:

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Push with tags — triggers GitHub Actions
git push origin main --tags

# 3. GitHub Actions will:
#    - Run tests
#    - Build the installer
#    - Sign it via SignPath
#    - Create a GitHub Release with the signed .exe
#    - electron-updater picks it up for auto-updates
```
