# Kurarium 0.5.0 Public Beta

This is the first public-beta-oriented release. The Windows binaries are **unsigned**.
Verify the published SHA-256 checksums before running them.

## Highlights

- LAN publishing now uses HTTPS with a per-installation self-signed certificate.
- Download and trust the LAN certificate from **Settings > System > HTTPS証明書**.
- The login password minimum is now 5 characters. Use a longer, unique password when
  possible.
- LAN sessions use Secure cookies and are invalidated when credentials change.
- Added Host/Origin validation, cross-site API blocking, CSP, request body limits, and
  stricter JSON handling.
- Local library path fields now include an Explorer folder picker in setup and Settings.
- Folder navigation now uses a sticky shelf with a clear section header and a
  one-row/all-folders switch. The expanded folder view uses a fluid grid that fills the
  available width while keeping the configured tile shape, and the folder and file areas
  are visually separated so the current location is easier to scan.
- Image views are now included in browsing history. Turning history off hides the
  History tab and its entries without deleting them.
- The uninstaller asks whether to delete user data. The default is to delete it.
- The default folder tile shape is now fixed 1:1 (square).
- Added corresponding FFmpeg source packaging and an SBOM to the release assets.

## Upgrade notes

- LAN mode no longer serves plain HTTP. Existing bookmarks must use `https://`.
- Existing LAN clients must trust the new self-signed certificate.
- If the PC's LAN address changes, regenerate the certificate in Settings and trust
  the new certificate on each client.
- LAN mode requires a password of at least 5 characters. Existing shorter passwords
  can still be used to log in; set a new password when convenient.

## Requirements

- Windows 11 (x64); Windows 10 is not supported
- Unsigned installer: verify `SHA256SUMS.txt`
- LAN access: trusted local network only; do not expose the port to the internet

## Known limitations

- Very slow SMB sources may time out the first thumbnail request; the gallery retries.
- The LAN UI is single-user: every authenticated client has full library and settings
  access.
- Code signing is not included in this beta. The self-signed LAN certificate is for
  HTTPS only and does not establish publisher trust for the installer.

## Verification assets

- `SHA256SUMS.txt`
- `LEGAL-NOTICES.zip`
- `FFMPEG-SOURCE.zip`
- `SBOM.cdx.json`
