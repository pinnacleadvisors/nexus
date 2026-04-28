---
type: atom
title: "macOS LibreSSL openssl dgst output format differs from GNU"
id: macos-libressl-openssl-dgst-output-format-differs-from-gnu
created: 2026-04-28
sources:
  - services/claude-gateway/scripts/smoke.sh
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# macOS LibreSSL openssl dgst output format differs from GNU

On macOS the bundled openssl is LibreSSL; 'openssl dgst -sha256 -hmac KEY' output format does not always match GNU/OpenSSL 3.x. Where Linux emits 'HMAC-SHA256(stdin)= <hex>' (two whitespace fields,  = hex), LibreSSL can emit a single field, leaving 'awk '{print }'' empty. Parse with 'awk '{print }'' (last field) for portability across both userlands.
