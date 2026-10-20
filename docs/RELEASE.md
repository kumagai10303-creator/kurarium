# Release Guide

## Prerequisites

- Windows 10 22H2 or Windows 11 x64
- Node.js 22 or newer
- Git
- GitHub account

## Local build

```powershell
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run fetch:ffmpeg
npm test
npm run typecheck
npm run build
npm run dist
```

Outputs:

- `release/Kurarium-Installer-<version>-win-x64.exe`
- `release/Kurarium-Portable-<version>-win-x64.zip`
- `release/SHA256SUMS.txt` (created by the release workflow or manually)

Always test the artifact downloaded from GitHub, not only the local build.

## Private repository phase

1. Create a private repository named `kurarium` under the personal account.
2. Push the source and confirm GitHub Actions is enabled.
3. Add testers as collaborators with **Read** access.
4. Push a tag such as `v0.1.0`.
5. The Release workflow creates a **draft** release.
6. Testers can download the draft/pre-release assets while logged in.
7. Mark the release as pre-release while testing.

For a manual build, open **Actions > Release > Run workflow**. It builds the
artifacts and creates or updates the draft release for the current package version.

Private Release assets are not publicly downloadable. Testers need GitHub accounts
and repository access.

## Public transition

Before changing repository visibility:

- Run a secret scan over the full history.
- Confirm `data/`, logs, SMB credentials, certificates, and personal paths are absent.
- Confirm `LICENSE` (MIT, kumagai31 (@kumatani31)) and `THIRD_PARTY_NOTICES.md`.
- Confirm the FFmpeg GPLv3 notice and source information are included.
- Review README installation, SmartScreen, LAN, SMB, and uninstall instructions.
- Enable branch protection, secret scanning, and Dependabot.

If the private history contains anything that should not be public, create a fresh
public repository and publish a new clean release instead of changing visibility.

Changing visibility exposes the entire commit history and all Release assets.
After going public, recreate the release with signed assets if signing was added.

## Versioning

- `package.json` version and the tag must match (`v0.1.0`).
- The release workflow fails if they differ.
- Keep `appId` (`com.kurarium.app`) and artifact names stable. Future auto-update
  support depends on them.

## Signing later

The first release is unsigned. The workflow already accepts:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

Store them in **Settings > Secrets and variables > Actions**. Never commit a
certificate or password.

EV hardware tokens cannot be used on GitHub-hosted runners. Use a cloud signing
service (Azure Trusted Signing, SSL.com eSigner, DigiCert KeyLocker, or similar) or a
self-hosted runner. See [SIGNING.md](SIGNING.md).

## GitHub Free limits

- Actions: 2,000 minutes per month for private repositories.
- Windows runners consume minutes at 2x.
- Actions artifact storage is limited; release assets should be used for distribution.
- Run packaging only on tags or manually, not on every commit.

## Release checklist

- [ ] Tests and typecheck pass
- [ ] Version and tag match
- [ ] FFmpeg checksum verified
- [ ] Icons generated
- [ ] Installer and portable ZIP built
- [ ] SHA256SUMS generated
- [ ] LEGAL-NOTICES.zip generated
- [ ] Draft release created
- [ ] Tested from a clean Windows VM
- [ ] Installer tested from the downloaded asset
- [ ] Portable ZIP tested from a writable folder
- [ ] Uninstall keeps user data
- [ ] Release notes list known issues and unsigned status
- [ ] Release published
