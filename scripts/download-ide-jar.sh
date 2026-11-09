#!/usr/bin/env bash
# Downloads the latest snapshot of the NeoJoin language server (shaded IDE jar) from the Maven Central snapshot repository
# and saves it as tools.vitruv.neojoin.frontend.ide.jar, the file name that package.json lists in "files".
#
# The version of the snapshot is "config.languageServerVersion" in package.json.
#
# Usage: scripts/download-ide-jar.sh [target directory]   (default: the repository root; an existing directory)
#
# Snapshot files have a timestamped name (for example ...ide-0.1.0-20261109.090420-2.jar), which is looked up in the
# Maven metadata of the snapshot. Needs bash, node, curl, sed, tr, cut, mktemp and sha1sum or shasum (all part of Git Bash on
# Windows, macOS and Linux).
#
# Safety: only HTTPS (TLS 1.2+) is used. The timestamp from the metadata is checked against the expected format before it
# becomes part of a URL. The jar is written to a temporary file, whose SHA-1 has to match the checksum published next to
# it, and only then moved to its final name, so a failed or truncated download never leaves a jar behind. The checksum
# comes from the same server: it detects corrupt downloads, but does not prove the origin. The GPG signature (.asc) is
# not verified (it would need a pinned public key of the publisher).
set -euo pipefail

# The version comes from "config.languageServerVersion" in package.json. node runs in the repository root, because it
# needs a path in the format of the platform (not the POSIX path of Git Bash on Windows).
version=$(cd "$(dirname "$0")/.." && node -p 'require("./package.json").config?.languageServerVersion ?? ""')
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-SNAPSHOT$ ]]; then
    echo "config.languageServerVersion in package.json must be a snapshot version like 0.1.0-SNAPSHOT (found: '$version')" >&2
    exit 1
fi
base="https://central.sonatype.com/repository/maven-snapshots/tools/vitruv/tools.vitruv.neojoin.frontend.ide/$version"
jar_name=tools.vitruv.neojoin.frontend.ide.jar
target="${1:-$(dirname "$0")/..}"

fetch() {
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 300 "$@"
}

sha1_of() {
    if command -v sha1sum > /dev/null; then
        sha1sum "$1" | cut -c1-40
    else
        shasum -a 1 "$1" | cut -c1-40
    fi
}

# The jar without classifier is the snapshotVersion entry whose first child is the extension.
snapshot=$(fetch "$base/maven-metadata.xml" \
    | tr -d ' \r\n' \
    | sed -n 's|.*<snapshotVersion><extension>jar</extension><value>\([^<]*\)</value>.*|\1|p')

if ! [[ "$snapshot" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9]{8}\.[0-9]{6}-[0-9]+$ ]]; then
    echo "No valid jar snapshot version found in $base/maven-metadata.xml (found: '$snapshot')" >&2
    exit 1
fi

echo "Language server snapshot: $snapshot"
tmp_file=$(mktemp "$target/$jar_name.XXXXXX")
trap 'rm -f "$tmp_file"' EXIT

url="$base/tools.vitruv.neojoin.frontend.ide-$snapshot.jar"
fetch --output "$tmp_file" "$url"

expected=$(fetch "$url.sha1" | tr -d ' \r\n' | cut -c1-40)
if ! [[ "$expected" =~ ^[0-9a-f]{40}$ ]]; then
    echo "No valid SHA-1 checksum found at $url.sha1" >&2
    exit 1
fi
actual=$(sha1_of "$tmp_file")
if [ "$actual" != "$expected" ]; then
    echo "SHA-1 mismatch for $url: expected $expected, got $actual" >&2
    exit 1
fi

chmod 644 "$tmp_file"
mv "$tmp_file" "$target/$jar_name"
