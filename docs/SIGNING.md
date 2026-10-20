# Code Signing

Kurarium 0.1.0 is released unsigned. Windows SmartScreen may warn about an unknown
publisher. Do not use a self-signed certificate for public releases; it does not
establish trust.

## Options

| Option | Notes |
| --- | --- |
| OV code signing certificate | Identity validation required. Can use a PFX or a cloud signing service. Reputation builds over time. |
| EV code signing certificate | Stronger reputation, usually hardware-token based. Use a cloud signing service for GitHub Actions. |
| Azure Trusted Signing | Microsoft-managed signing. Requires an Azure subscription and eligibility review. |
| SignPath Foundation | Free for eligible open-source projects. Requires a public repository and OSI-approved license. |

## GitHub Actions with a PFX

1. Purchase an OV certificate and export it as a password-protected PFX.
2. Add repository secrets:
   - `CSC_LINK`: base64 of the PFX, or a URL accessible to the runner
   - `CSC_KEY_PASSWORD`: PFX password
3. Run the Release workflow. electron-builder signs the app and installer.
4. Verify:

```powershell
Get-AuthenticodeSignature .\Kurarium-Installer-0.1.0-win-x64.exe | Format-List
```

## Cloud signing

If the certificate cannot be exported (EV token), sign through a cloud service.
Configure the provider's GitHub Action or a custom electron-builder signing hook.
The workflow currently sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and passes
`CSC_LINK`/`CSC_KEY_PASSWORD` when present.

## Timestamping

Use an RFC 3161 timestamp server so signatures remain valid after the certificate
expires. electron-builder uses a timestamp server by default when signing.

## Release assets

Sign:

- `Kurarium.exe`
- `Kurarium-Installer-<version>-win-x64.exe`

Then create the portable ZIP so it contains the signed executable. A ZIP file itself
is not signed; publish SHA256 checksums alongside it.

## After signing

- Verify the installer signature on a clean machine.
- Publish SHA256SUMS.txt.
- Update README and release notes to remove the unsigned warning.
- SmartScreen reputation may still take time; EV/cloud signing helps but does not
  guarantee an immediate warning-free experience.
