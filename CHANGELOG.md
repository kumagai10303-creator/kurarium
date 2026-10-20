# Changelog

## 0.2.0

- Added a thumbnail generation progress bar with completed/total counts and failures.
- Reduced thumbnail resolution and quality, with automatic background regeneration.
- Added orphaned thumbnail cleanup.
- Optimized thumbnail queue concurrency by media type and added a queue index.
- Reduced UI re-renders by memoizing gallery views and isolating scan status updates.
- Added lazy asynchronous image decoding and content-visibility for gallery rows.
- Replaced the app-name setting with an overview panel showing version and data folder.
- Made the mixed-media setting apply immediately without a save button.
- Destroyed the embedded browser when minimizing to the tray, recreating it on reopen.
- Renamed release assets to `Kurarium-Installer-*` and `Kurarium-Portable-*`.

## 0.1.0

- Initial Windows release.
- Per-user installer and portable ZIP.
- Electron tray application with embedded web UI.
- Local, SMB, PDF, music, and video libraries.
- Startup scan, thumbnails, and video transcoding.
- LAN access with session login.
