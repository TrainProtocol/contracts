import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { webcrypto } from 'crypto';
import dotenv from 'dotenv';
import init, {
    WasmZcashClient,
    WasmNetwork,
    WasmRpcConfig,
    generateMnemonic} from '../zcash-wasm/pkg/zcash_wasm.js';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

async function testZcashWasm() {
    const wasmPath = join(__dirname, '../zcash-wasm/pkg/zcash_wasm_bg.wasm');
    const wasmBuffer = readFileSync(wasmPath);
    await init(wasmBuffer);

    const useTestnet = (process.env.NETWORK || 'testnet').toLowerCase() === 'testnet';
    const network = useTestnet ? WasmNetwork.Testnet : WasmNetwork.Mainnet;
    const rpcUrl = useTestnet ? process.env.TESTNET_RPC_URL : process.env.MAINNET_RPC_URL;
    let mnemonic = process.env.MNEMONIC;
    if (!mnemonic || mnemonic.trim() === '') {
        mnemonic = generateMnemonic();
        console.log('Generated mnemonic:', mnemonic);
    }

    const rpcConfig = process.env.TATUM_API_KEY 
        ? WasmRpcConfig.withApiKey(rpcUrl, process.env.TATUM_API_KEY)
        : new WasmRpcConfig(rpcUrl);
    const client = new WasmZcashClient(network, rpcConfig);
    const wallet = client.walletFromMnemonic(mnemonic, 0);

    let derivedAddress0, derivedAddress1;
    try {
        derivedAddress0 = client.deriveTransparentAddress(wallet, 0);
        console.log('Address (index 0):', derivedAddress0);
        derivedAddress1 = client.deriveTransparentAddress(wallet, 1);
        console.log('Address (index 1):', derivedAddress1);
    } catch (error) {
        console.log('Address derivation failed:', error.message || error);
    }

    try {
        const height = await client.getBlockHeight();
        console.log('Block height:', height);
    } catch (error) {
        console.log('Could not get block height:', error.message || error);
    }

    const addressToCheck = process.env.TRANSPARENT_ADDRESS || derivedAddress0;
    const currency = useTestnet ? 'TAZ' : 'ZEC';
    
    if (addressToCheck) {
        try {
            const explorerUrl = useTestnet 
                ? `https://api.blockchair.com/zcash/testnet/dashboards/address/${addressToCheck}`
                : `https://api.blockchair.com/zcash/dashboards/address/${addressToCheck}`;
            
            const response = await fetch(explorerUrl);
            const data = await response.json();
            
            if (data.data && data.data[addressToCheck]) {
                const addressInfo = data.data[addressToCheck].address;
                const balance = addressInfo.balance / 100000000;
                const received = addressInfo.received / 100000000;
                const sent = addressInfo.spent / 100000000;
                
                console.log('Balance:', balance, currency);
                console.log('Received:', received, currency);
                console.log('Sent:', sent, currency);
                console.log('Transactions:', addressInfo.transaction_count);
            } else {
                console.log('Balance: 0', currency);
            }
        } catch (error) {
            console.log('Could not get balance:', error.message || error);
        }
    }
}

testZcashWasm().catch(console.error);
