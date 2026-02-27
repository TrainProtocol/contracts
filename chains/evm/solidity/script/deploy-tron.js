'use strict';

const TronWeb = require('tronweb');
const fs = require('fs');
const path = require('path');

const NETWORKS = {
  mainnet: { fullHost: 'https://api.trongrid.io', name: 'Tron Mainnet' },
  nile:    { fullHost: 'https://nile.trongrid.io', name: 'Nile Testnet' },
  shasta:  { fullHost: 'https://api.shasta.trongrid.io', name: 'Shasta Testnet' },
};

async function waitForContractAddress(tronWeb, txId, attempts = 30, intervalMs = 3000) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info && info.contract_address) {
      return tronWeb.address.fromHex(info.contract_address);
    }
    process.stdout.write('.');
  }
  return null;
}

function saveDeployment(network, data) {
  const dir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tron-${network}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return path.relative(process.cwd(), file);
}

async function main() {
  const network = process.argv[2] || 'nile';
  const networkConfig = NETWORKS[network];

  if (!networkConfig) {
    console.error(`Unknown network "${network}". Choose from: mainnet, nile, shasta`);
    process.exit(1);
  }

  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) {
    console.error('Error: PRIVATE_KEY environment variable is required.');
    process.exit(1);
  }
  const privateKey = rawKey.startsWith('0x') ? rawKey.slice(2) : rawKey;

  console.log(`\nDeploying Train to ${networkConfig.name} ...`);

  const artifactPath = path.join(__dirname, '..', 'out', 'Train.sol', 'Train.json');
  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found. Run: $env:FOUNDRY_PROFILE="tron"; forge build`);
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const abi = artifact.abi;
  const bytecodeObject = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecodeObject) {
    console.error('Bytecode missing from artifact. Re-compile the contract.');
    process.exit(1);
  }
  const bytecode = bytecodeObject.startsWith('0x') ? bytecodeObject.slice(2) : bytecodeObject;

  const tronWeb = new TronWeb({ fullHost: networkConfig.fullHost, privateKey });
  const deployer = tronWeb.address.fromPrivateKey(privateKey);
  console.log(`Deployer : ${deployer}`);

  const balance = await tronWeb.trx.getBalance(deployer);
  console.log(`Balance  : ${(balance / 1e6).toFixed(6)} TRX`);

  if (balance === 0) {
    console.warn('Warning: deployer balance is 0 TRX. Deployment will likely fail.');
  }

  console.log('Building deployment transaction...');
  const tx = await tronWeb.transactionBuilder.createSmartContract(
    {
      abi,
      bytecode,
      feeLimit: 1_000_000_000,
      callValue: 0,
      userFeePercentage: 100,
      originEnergyLimit: 10_000_000,
      name: 'Train',
    },
    deployer,
  );

  const signedTx = await tronWeb.trx.sign(tx, privateKey);
  console.log('Broadcasting transaction...');
  const result = await tronWeb.trx.sendRawTransaction(signedTx);

  if (!result.result) {
    console.error('Deployment transaction rejected:', JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const txId = result.txid;
  console.log(`Tx ID    : ${txId}`);
  console.log('Waiting for confirmation...');

  const contractAddress = await waitForContractAddress(tronWeb, txId);

  if (!contractAddress) {
    console.error('\nTimed out waiting for contract address. Check the transaction:');
    console.error(`  https://tronscan.org/#/transaction/${txId}`);
    process.exit(1);
  }

  const hexAddress = tronWeb.address.toHex(contractAddress);
  console.log('\n' + '='.repeat(60));
  console.log('  CONTRACT DEPLOYED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`  Network : ${networkConfig.name}`);
  console.log(`  Address : ${contractAddress}`);
  console.log(`  Hex     : ${hexAddress}`);
  console.log(`  Tx      : ${txId}`);
  console.log('='.repeat(60));

  const savedPath = saveDeployment(network, { network, contractAddress, hexAddress, txId, deployer, timestamp: new Date().toISOString() });
  console.log(`\nDeployment info saved to: ${savedPath}`);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message ?? err);
  process.exit(1);
});
