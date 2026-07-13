#!/usr/bin/env bash
# TXE tests (aztec test) deploy dependency contracts by artifact name from train/target/:
#   - @token_contract/Token          -> target/token_contract-Token.json
#   - @payout_curve/ConstantPayoutCurve -> target/payout_curve-ConstantPayoutCurve.json
# `aztec compile` only emits the train artifact and wipes foreign ones, so re-run this
# script after every compile and before `aztec test`.
set -euo pipefail
cd "$(dirname "$0")"

TOKEN_CHECKOUT="$HOME/nargo/github.com/defi-wonderland/aztec-standards/v5.0.0-rc.2"

# Build deps if their artifacts are missing
if [ ! -f "$TOKEN_CHECKOUT/target/token_contract-Token.json" ]; then
  (cd "$TOKEN_CHECKOUT" && aztec compile -- --package token_contract)
fi
if [ ! -f ../payout_curve/target/payout_curve-ConstantPayoutCurve.json ]; then
  (cd ../payout_curve && aztec compile)
fi

cp "$TOKEN_CHECKOUT/target/token_contract-Token.json" target/
cp ../payout_curve/target/payout_curve-ConstantPayoutCurve.json target/
echo "TXE dependency artifacts in place."
