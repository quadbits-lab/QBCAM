#!/bin/sh
# Reset macOS TCC grants for the dev bundle. Unsigned dev rebuilds can keep a
# stale denial; run this, restart the app, and approve the prompt again.
set -e
BUNDLE_ID="${QBCAM_BUNDLE_ID:-ai.qbcam.desktop}"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script only applies to macOS."
  exit 0
fi
tccutil reset Camera "$BUNDLE_ID" || true
tccutil reset Microphone "$BUNDLE_ID" || true
echo "Reset camera/microphone permission for $BUNDLE_ID. Restart QBCAM."
