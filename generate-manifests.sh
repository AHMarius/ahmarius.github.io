#!/usr/bin/env bash
#
# generate-manifests.sh
#
# Scans every subfolder under the given root (default: current directory)
# and writes a manifest.json in each one listing the .jpg/.jpeg files it
# contains. Intended for gallery folders where the only files present are
# images (manifest.json itself is excluded from the listing).
#
# Usage:
#   ./generate-manifests.sh [root-folder]
#
# Example:
#   ./generate-manifests.sh projects/

set -euo pipefail

ROOT="${1:-.}"

if [ ! -d "$ROOT" ]; then
    echo "Error: '$ROOT' is not a directory." >&2
    exit 1
fi

count=0

# Find every directory under ROOT (including ROOT itself)
while IFS= read -r -d '' dir; do
    # Collect image files (case-insensitive jpg/jpeg) directly inside this dir
    images=()
    while IFS= read -r -d '' file; do
        images+=("$(basename "$file")")
    done < <(find "$dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) -print0 | sort -z)

    # Skip folders with no images (don't clutter every dir with empty manifests)
    if [ "${#images[@]}" -eq 0 ]; then
        continue
    fi

    manifest="$dir/manifest.json"

    {
        printf '['
        for i in "${!images[@]}"; do
            # JSON-escape backslashes and quotes in filenames
            escaped="${images[$i]//\\/\\\\}"
            escaped="${escaped//\"/\\\"}"
            printf '"%s"' "$escaped"
            if [ "$i" -lt $(( ${#images[@]} - 1 )) ]; then
                printf ', '
            fi
        done
        printf ']'
    } > "$manifest"

    echo "Wrote $manifest (${#images[@]} image(s))"
    count=$((count + 1))

done < <(find "$ROOT" -type d -print0)

echo "Done. $count manifest(s) written."
