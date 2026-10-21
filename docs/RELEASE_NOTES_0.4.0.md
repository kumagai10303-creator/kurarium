# Kurarium 0.4.0

This release makes thumbnail generation on demand and adds a bounded, configurable
thumbnail cache.

## Highlights

- Thumbnails are generated when items approach the visible area instead of scanning
  and generating the entire library in the background.
- The thumbnail cache now has a default **512 MB** limit. When full, least recently
  used thumbnails are removed first.
- Thumbnail retention (TTL) is available in **Settings > System**. It is **disabled by
  default**; when enabled, thumbnails expire after the configured days since last use.
- The cache limit can be set from 128 MB to 4096 MB. TTL can be set from 1 to 365 days.
- The gallery now uses measured thumbnail dimensions for layout, reducing empty space
  and aspect-ratio jumps.
- Cached thumbnails remain in `data\thumbs.db`; original media files are not modified.
- Japanese PDF thumbnails now load PDF.js CMaps from the filesystem, avoiding the
  packaged-build CMap warning.
- LAN login failures are rate-limited per client IP.
- SMB credentials are registered without placing the password on a process command
  line.
- Folder tiles use the first item by filename as their thumbnail and request it
  immediately, even when it has not been generated yet.
- Fixed intermittent blank thumbnails after returning from another page.
- Improved taskbar icon initialization on first launch.
- Added a LAN publishing toggle; when enabled, the port becomes editable and applies after restart.
- Fall back to loopback if a saved LAN bind address is unavailable.

## Upgrade notes

- Existing thumbnails are kept when they match the current thumbnail format.
- On first launch, the cache may be trimmed from its current size to the 512 MB
  default. Use **Settings > System > サムネイルキャッシュ** to choose a larger limit.
- The first display of uncached items may take longer while the thumbnail is
  generated. Subsequent displays use the cache.
- The full-library thumbnail progress bar is no longer used. Thumbnails are prepared
  as you browse.

## Requirements

- Windows 10 22H2 (x64) or Windows 11 (x64)
- The installer is currently unsigned. Verify the published SHA-256 checksum before
  running it.
- LAN access uses HTTP. Use a trusted network or a reverse proxy with HTTPS.

## Known limitations

- Windows 10 22H2 has not yet been tested on physical hardware for this release.
- Very slow SMB sources may time out the first thumbnail request; the request is
  retried by the gallery.
