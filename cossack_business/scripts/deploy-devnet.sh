#!/usr/bin/env bash
set -euo pipefail

#
# Builds, deploys (or upgrades) all six programs to Devnet,
# then runs the initialisation script to create on-chain state.
#
# Prerequisites:
#   - Solana CLI pointing to a funded devnet keypair
#   - Anchor CLI >= v0.32
#   - Node.js + Yarn installed
#
# Usage:
#   chmod +x scripts/deploy-devnet.sh
#   ./scripts/deploy-devnet.sh

echo "=== Cossack Business — Devnet Deploy ==="

echo ""
echo "Step 1: Switch RPC to devnet"
solana config set --url devnet

echo ""
echo "Step 2: Wallet balance check"
BALANCE=$(solana balance | awk '{print $1}')
echo "   Current balance: ${BALANCE} SOL"

echo ""
echo "Step 3: Compile all programs"
anchor build

# The six programs that make up the game
ALL_PROGRAMS=(resource_manager magic_token item_nft search crafting marketplace)

echo ""
echo "Step 4: Deploy / upgrade loop"
for prog in "${ALL_PROGRAMS[@]}"; do
  echo "   Deploying ${prog}..."
  anchor deploy --program-name "$prog" --provider.cluster devnet || {
    echo "   ⚠ ${prog} initial deploy failed — attempting upgrade..."
    anchor upgrade --program-name "$prog" --provider.cluster devnet \
      "target/deploy/${prog}.so" || echo "   ⚠ ${prog} upgrade also failed"
  }
done

echo ""
echo "Step 5: Run initialisation script"
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-node scripts/initialize.ts

echo ""
echo "=== Deploy finished ==="
echo ""
echo "Program IDs (from Anchor.toml):"
for prog in "${ALL_PROGRAMS[@]}"; do
  ID=$(grep "^${prog}" Anchor.toml | head -1 | awk -F'"' '{print $2}')
  echo "  ${prog} = ${ID}"
done
