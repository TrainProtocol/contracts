/**
 * Tron deployment for Train Protocol contracts (ConstantPayoutCurve, Train, TrainRouter).
 *
 * Usage:
 *   set TRON_PRIVATE_KEY=<hex, no 0x>            (or put it in .env)
 *   npm run deploy:tron:nile | deploy:tron:shasta | deploy:tron:mainnet
 *   (equivalent to: FOUNDRY_PROFILE=tron forge build && node script/deploy-tron.js <network>)
 *
 * NOTE: Tron derives contract addresses with a 0x41 prefix and has no CREATE2 factory
 * infrastructure, so these addresses WILL DIFFER from the deterministic CREATE2 address
 * the EVM chains share. That is expected and unavoidable.
 *
 * Requires TVM >= GreatVoyage-v4.8.0 (Kant): the bytecode targets Cancun and uses
 * transient storage (EIP-1153). Nile/Shasta have this since Q1 2025.
 */

const fs = require('fs');
const path = require('path');

const TronWebLib = require('tronweb');
// tronweb 5.x exports the class directly; 6.x uses a named export. Support both.
const TronWeb = TronWebLib.TronWeb || TronWebLib.default || TronWebLib;

const HOSTS = {
  nile: 'https://nile.trongrid.io',
  shasta: 'https://api.shasta.trongrid.io',
  mainnet: 'https://api.trongrid.io',
};

// Cap on TRX burned per deployment, in sun (1 TRX = 1e6 sun). Override with TRON_FEE_LIMIT.
const DEFAULT_FEE_LIMIT = 1_000_000_000; // 1000 TRX

const CONTRACTS = ['ConstantPayoutCurve', 'Train', 'TrainRouter'];

function loadDotEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (value && !(name in process.env)) process.env[name] = value;
  }
}

function loadArtifact(rootDir, name) {
  const artifactPath = path.join(rootDir, 'out', `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath} - run: FOUNDRY_PROFILE=tron forge build`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const bytecode = artifact.bytecode.object.replace(/^0x/, '');
  return { abi: artifact.abi, bytecode };
}

async function main() {
  const network = process.argv[2];
  if (!HOSTS[network]) {
    console.error(`Usage: node script/deploy-tron.js <${Object.keys(HOSTS).join('|')}>`);
    process.exit(1);
  }

  const rootDir = path.join(__dirname, '..');
  loadDotEnv(rootDir);

  const privateKey = (process.env.TRON_PRIVATE_KEY || '').replace(/^0x/, '');
  if (!privateKey) {
    console.error('TRON_PRIVATE_KEY is not set (env or .env).');
    process.exit(1);
  }
  const feeLimit = Number(process.env.TRON_FEE_LIMIT || DEFAULT_FEE_LIMIT);

  const tronWeb = new TronWeb({ fullHost: HOSTS[network], privateKey });
  const deployer = tronWeb.address.fromPrivateKey(privateKey);
  console.log(`Network : ${network} (${HOSTS[network]})`);
  console.log(`Deployer: ${deployer}`);
  console.log(`FeeLimit: ${feeLimit} sun (${feeLimit / 1e6} TRX) per contract`);
  console.log('');

  const deployed = {};
  for (const name of CONTRACTS) {
    const { abi, bytecode } = loadArtifact(rootDir, name);
    console.log(`Deploying ${name}...`);
    const contract = await tronWeb.contract().new({
      abi,
      bytecode,
      feeLimit,
      callValue: 0,
      userFeePercentage: 100,
      originEnergyLimit: 10_000_000,
      parameters: [],
    });
    const hexAddress = contract.address;
    const base58Address = tronWeb.address.fromHex(hexAddress);
    deployed[name] = { base58: base58Address, hex: hexAddress };
    console.log(`  ${name}: ${base58Address} (hex ${hexAddress})`);
  }

  console.log('');
  console.log('================ SUMMARY ================');
  for (const name of CONTRACTS) {
    console.log(`${name.padEnd(20)}: ${deployed[name].base58}`);
  }
  console.log('');
  console.log('NOTE: Tron addresses differ from the CREATE2 address shared by the EVM testnets.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
