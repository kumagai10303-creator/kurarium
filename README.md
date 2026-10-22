<img src="docs/readme-header.svg" alt="Kurarium — local and SMB media viewer for Windows" width="100%">

Local and SMB media viewer for Windows. Browse images, video, PDF, and music from a
browser UI hosted by a local server.

## Project status

Kurarium is currently a **Public Beta**. Windows release binaries are **not
code-signed** and may trigger SmartScreen warnings. Verify the published SHA-256
checksums and review the source before running a release.

The project is intended for personal use on a trusted local network. It is not
designed to be exposed directly to the internet.

## Supported platforms

- Windows 11 (x64)
- Windows 10 is not supported.

## Distribution

Releases are published on GitHub Releases.

- `Kurarium-Installer-<version>-win-x64.exe`: per-user installer (no administrator rights required)
- `Kurarium-Portable-<version>-win-x64.zip`: portable build
- `SHA256SUMS.txt`: checksums for the release assets
- `LEGAL-NOTICES.zip`: license texts and third-party notices
- `FFMPEG-SOURCE.zip`: corresponding FFmpeg source archive and build scripts
- `SBOM.cdx.json`: CycloneDX software bill of materials

### Unsigned builds

Public Beta releases are **not code-signed**. Windows SmartScreen may display a
warning such as "Windows protected your PC". Choose **More info** and then
**Run anyway** only if the SHA-256 checksum matches the published value.

The self-signed certificate used for LAN HTTPS is separate from Windows code
signing. It encrypts LAN traffic but does not establish a trusted publisher for the
installer or executable.

Verify a download in PowerShell:

```powershell
Get-FileHash .\Kurarium-Installer-0.5.0-win-x64.exe -Algorithm SHA256
```

Compare the result with the matching line in `SHA256SUMS.txt`.

## Installation

1. Run the installer.
2. Start **Kurarium** from the Start menu or the desktop shortcut.
3. Add libraries in **Settings > Libraries**. Use the folder button to choose local
   folders in Explorer, or type paths directly.
4. Start a scan.

The application closes to the system tray. Use **Exit** in the tray menu to stop the
server and quit completely.

## Portable build

Extract the ZIP to a writable folder and run `Kurarium.exe`. User data is stored in a
`data` folder next to the executable. If that folder is not writable, Kurarium falls
back to `%LOCALAPPDATA%\Kurarium`.

Portable updates: exit Kurarium first, then extract the new ZIP over the existing
folder. The `data` folder is preserved.

## Data locations

- Installed build: `%LOCALAPPDATA%\Kurarium\data`
- Portable build: `<extracted folder>\data`
- Database: `data\mediaviewer.db`
- Thumbnails: `data\thumbs.db`
- Transcode cache: `data\transcoded`
- Server settings: `data\.system\config.ini`
- LAN TLS certificate and private key: `data\.system\tls`

## Uninstall

The Windows uninstaller asks whether to delete user data. User data is deleted by
default; choose **いいえ** to preserve it.

## Thumbnail cache

Thumbnails are generated on demand for items near the visible area and stored in
`data\thumbs.db`. The default cache limit is **512 MB**. When the limit is exceeded,
the least recently used thumbnails are removed. An optional retention period (TTL) is
**disabled by default**.

Configure the cache in **Settings > System > サムネイルキャッシュ**. The maximum can be
set from 128 MB to 4096 MB. If TTL is enabled, thumbnails expire after the configured
number of days since their last access. The cache can be reduced on upgrade; original
media files are never modified.

SMB passwords are never stored in the database or settings file. They are kept in
Windows Credential Manager. The password is passed to the credential helper through
standard input rather than a process command line. Before a new or changed SMB
connection is saved, Kurarium tests the supplied credentials and share access; the
connection is saved only when the test succeeds.

### Moving from a development build

The development server stores data in `data/` inside the project. To keep an existing
library database and thumbnails:

1. Exit Kurarium and stop the development server.
2. Copy the project `data` folder to `%LOCALAPPDATA%\Kurarium\data`.
3. Start the installed application.

Media paths are stored as absolute paths. If drive letters or folder locations
changed, run a new scan after copying.

## LAN access

By default the server listens on `127.0.0.1` over HTTP and does not require a login.

To open the library to other devices on the LAN:

1. Set a login user name and a password of at least **5 characters** in
   **Settings > System**.
2. Enable **ローカルネットワーク内に公開**. The port field becomes editable.
3. Save the settings and restart Kurarium.
4. Download the LAN certificate from the settings screen and trust it on each client.
5. Allow Kurarium through Windows Firewall when prompted.

When LAN publishing is off, Kurarium listens on `127.0.0.1` over HTTP. When it is on,
Kurarium listens on `0.0.0.0` over **HTTPS** and requires login. It does not fall back
to HTTP while LAN publishing is enabled. If an older saved host is unavailable on the
current PC, Kurarium falls back to `127.0.0.1` for local recovery.

### Self-signed certificate

Kurarium generates a self-signed certificate on first LAN startup. The certificate
covers `localhost`, the PC host name, and the LAN addresses present at generation
time. Its validity is 365 days.

The certificate is available from **Settings > System > HTTPS証明書**. Install the
downloaded `kurarium-lan.cer` into the trusted root store of each client device. If
the certificate is not trusted, the browser will show a warning; do not bypass that
warning unless you have verified the fingerprint shown in the settings screen.

If the PC's LAN address changes, the settings screen warns that the certificate does
not cover the current address. Regenerate the certificate and trust the new one on
each client. Regenerating invalidates the old certificate.

See [docs/LAN_HTTPS.md](docs/LAN_HTTPS.md) for certificate installation steps on
Windows, Chrome/Edge, Firefox, iOS, and Android.

LAN access is intended for a trusted network only. The 5-character minimum is a
convenience setting, not a recommendation; use a longer, unique password. Login
failures are rate-limited per client IP (5 failures in 15 minutes). Never expose the
LAN port directly to the internet.

## Development

Requirements: Node.js 22 or newer and ffmpeg/ffprobe on `PATH`.

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install

npm --prefix backend run dev
npm --prefix frontend run dev
```

The development server runs on <http://127.0.0.1:3000>. The Vite dev server proxies
API requests.

### E2E smoke tests

Playwright builds the frontend, starts an isolated backend that serves the production
bundle, seeds three images, and runs the gallery, lightbox, and cache-settings smoke
tests.

```powershell
npm run test:e2e:install
npm run test:e2e
```

### Production build

```powershell
npm run build
npm run dist
```

`npm run dist` builds the installer and the portable ZIP into `release/`.
FFmpeg binaries are required for packaging and are fetched separately:

```powershell
npm run fetch:ffmpeg
npm run fetch:ffmpeg-source
npm run dist
```

`npm run fetch:ffmpeg-source` creates `release/FFMPEG-SOURCE.zip` with the exact
corresponding source and build scripts for the bundled FFmpeg binary.

Release and signing procedures are documented in
[docs/RELEASE.md](docs/RELEASE.md) and [docs/SIGNING.md](docs/SIGNING.md). The
component layout is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

```powershell
npm test
npm run typecheck
```

## License

Kurarium is licensed under the MIT License. See [LICENSE](LICENSE).

Bundled third-party components retain their own licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security reports: see [SECURITY.md](SECURITY.md). Privacy: see [PRIVACY.md](PRIVACY.md).
Contribution guidelines: see [CONTRIBUTING.md](CONTRIBUTING.md).

FFmpeg is distributed under the GNU General Public License version 3. The bundled
build configuration and source availability are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
