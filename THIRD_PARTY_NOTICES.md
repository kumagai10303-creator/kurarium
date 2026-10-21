# Third-Party Notices

Kurarium is licensed under the MIT License. The following third-party components are
included in or distributed with Kurarium and remain under their own licenses.

## Application runtime

| Component | Version | License | Project |
| --- | --- | --- | --- |
| Electron | 44.9.1 | MIT | https://github.com/electron/electron |
| Chromium | bundled with Electron | BSD-style and other licenses | https://www.chromium.org/ |
| Fastify | 5.x | MIT | https://github.com/fastify/fastify |
| @fastify/static | 10.x | MIT | https://github.com/fastify/fastify-static |
| better-sqlite3 | 13.x | MIT | https://github.com/WiseLibs/better-sqlite3 |
| @marsaud/smb2 | 0.18.x | MIT | https://github.com/marsaud/node-smb2 |
| sharp | 0.35.x | Apache-2.0 | https://github.com/lovell/sharp |
| libvips (via sharp) | bundled | LGPL-3.0-or-later | https://github.com/libvips/libvips |
| @napi-rs/canvas | 1.x | MIT | https://github.com/Brooooooklyn/canvas |
| pdfjs-dist | 6.x | Apache-2.0 | https://github.com/mozilla/pdf.js |
| React / React DOM | 18.x | MIT | https://github.com/facebook/react |

Electron's license files are distributed with the application:

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

License files for npm dependencies are included in the packaged application under
`resources/app.asar.unpacked/node_modules/**/LICENSE*` where the dependency provides
one.

## FFmpeg

Kurarium invokes FFmpeg and FFprobe as separate executables for thumbnails, metadata
probing, remuxing, and transcoding.

- Build: BtbN FFmpeg-Builds `ffmpeg-n9.0.2-28-g669f5ab083-win64-gpl-9.0.zip`
- Build source: https://github.com/BtbN/FFmpeg-Builds
- FFmpeg source: https://ffmpeg.org/download.html
- License: GNU General Public License version 3

The exact build URL and SHA-256 checksum are recorded in
`resources/licenses/FFMPEG-SOURCE.txt`. The full GPLv3 text is distributed as
`resources/licenses/FFMPEG-GPLv3.txt` and in `LEGAL-NOTICES.zip` on the Release page.

Kurarium's own source code remains under the MIT License. FFmpeg is a separate
program distributed under GPLv3. If GPL redistribution is not acceptable, replace the
bundled FFmpeg build with an LGPL-compatible build and remove features that require
GPL-only components.
