#!/usr/bin/env bash
# TEMPORARY bridge until the aztec-standards successor publishes a v5.0.0 release.
#
# Why: the Train contract depends on the token from defi-wonderland/aztec-standards
# (tag v5.0.0-rc.2 — the last release before the repo was archived). That tag pins
# aztec-nr v5.0.0-rc.2, which is incompatible with the v5.0.0 network: rc.2 bakes in
# a different canonical AuthRegistry address, so authwit-authorized transfers can
# never succeed on-chain. This script patches the nargo cache checkout to build the
# SAME token source against aztec-nr v5.0.0 (the source compiles unchanged), and
# refreshes the artifact copies the TS scripts load from node_modules.
#
# Run once after cloning (and after any `npm install` in scripts/, which restores
# the stale rc.2-built artifact in node_modules).
#
# Retire this when https://github.com/alejoamiras/ecosystem-tooling (the official
# continuation; packages/aztec-standards) tags v5.0.0 — then point train/Nargo.toml
# and scripts/package.json at that release and delete this script.
set -euo pipefail
cd "$(dirname "$0")"

CACHE="$HOME/nargo/github.com/defi-wonderland/aztec-standards/v5.0.0-rc.2"
SCRIPTS="$(cd ../scripts && pwd)"

# 1. Ensure the cache checkout exists (a train compile fetches it)
if [ ! -d "$CACHE" ]; then
  echo "Cache checkout missing - triggering dependency fetch via train compile (may fail; that's ok)..."
  (cd train && aztec compile || true)
fi
[ -d "$CACHE" ] || { echo "ERROR: $CACHE still missing; run 'aztec compile' in contracts/train once."; exit 1; }

# 2. Point every aztec-packages pin in the checkout at v5.0.0 (no-op when already patched)
{ grep -rl 'tag = "v5.0.0-rc.2"' "$CACHE" --include="Nargo.toml" || true; } | while read -r f; do
  sed -i 's/tag = "v5.0.0-rc.2"/tag = "v5.0.0"/g' "$f"
done
echo "Cache pins patched to v5.0.0."

# 3. Rebuild the token artifact with the v5.0.0 toolchain
(cd "$CACHE" && rm -rf target && aztec compile -- --package token_contract --force)

# 4. Refresh the artifact copies used by the TS scripts (npm ships the rc.2-built one)
SRC="$CACHE/target/token_contract-Token.json"
for d in target dist/target artifacts/target; do
  cp "$SRC" "$SCRIPTS/node_modules/@defi-wonderland/aztec-standards/$d/token_contract-Token.json"
done
echo "node_modules token artifact refreshed."
echo "Done - token is now built against aztec-nr v5.0.0."
