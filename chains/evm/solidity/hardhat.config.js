require('dotenv').config();

const isZKsyncNetwork = process.env.HARDHAT_NETWORK?.toLowerCase().includes('zksync');

if (isZKsyncNetwork) {
  require('@matterlabs/hardhat-zksync');
  require('@matterlabs/hardhat-zksync-verify');
  require('@matterlabs/hardhat-zksync-solc');
  require('@matterlabs/hardhat-zksync-deploy');
} else {
  require('@nomicfoundation/hardhat-toolbox');
  require('@openzeppelin/hardhat-upgrades');
  require('@nomicfoundation/hardhat-ignition');
}
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  ignition: {
    strategyConfig: {
      create2: {
        salt: '0x0000000000000000000000000000000000000000000000000000000000011111',
      },
    },
  },
  solidity: {
    version: '0.8.23',
    zksolc: {
      version: '1.5.11',
      settings: {},
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    ZKsyncEraSepolia: {
      url: 'https://sepolia.era.zksync.dev',
      ethNetwork: 'sepolia',
      chainId: 300,
      zksync: true,
      accounts: [process.env.PRIV_KEY],
      verifyURL: 'https://explorer.sepolia.era.zksync.dev/contract_verification',
    },
    ZKsyncEraMainnet: {
      url: 'https://mainnet.era.zksync.io',
      ethNetwork: 'mainnet',
      chainId: 324,
      zksync: true,
      accounts: [process.env.priv_key_zk_sync],
      verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification',
    },
    mainnet: {
      url: process.env.ethRPC,
      accounts: [process.env.mainnet],
    },
    arbitrumOne: {
      url: process.env.arbitrumRPC,
      accounts: [process.env.mainnet],
    },
    optimisticEthereum: {
      url: process.env.optimismRPC,
      accounts: [process.env.mainnet],
    },
    base: {
      url: process.env.baseRPC,
      accounts: [process.env.mainnet],
    },
    mantleSepolia: {
      url: 'https://endpoints.omniatech.io/v1/mantle/sepolia/public',
      accounts: [process.env.PRIV_KEY],
    },
    berachain: {
      url: 'https://bartio.rpc.berachain.com/',
      accounts: [process.env.PRIV_KEY],
    },
    kakarot_sepolia: {
      url: 'https://sepolia-rpc.kakarot.org',
      accounts: [process.env.PRIV_KEY],
    },
    unichainSepolia: {
      url: 'https://sepolia.unichain.org',
      accounts: [process.env.PRIV_KEY],
    },
    arbitrumSepolia: {
      url: 'https://arbitrum-sepolia.infura.io/v3/2d3e18b5f66f40df8d5df3d990d6d941',
      accounts: [process.env.PRIV_KEY],
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/775081a490784e709d3457ed0e413b21`,
      accounts: [process.env.PRIV_KEY],
    },
    lineaSepolia: {
      url: 'https://rpc.sepolia.linea.build',
      accounts: [process.env.PRIV_KEY],
      chainId: 59141,
    },
    optimismSepolia: {
      url: 'https://sepolia.optimism.io',
      accounts: [process.env.PRIV_KEY],
      chainId: 11155420,
    },
    taikoHekla: {
      url: 'https://rpc.hekla.taiko.xyz.',
      accounts: [process.env.PRIV_KEY],
      chainId: 167009,
    },
    immutableTestnet: {
      url: 'https://rpc.testnet.immutable.com',
      accounts: [process.env.PRIV_KEY],
      chainId: 13473,
    },
    minato: {
      url: 'https://rpc.minato.soneium.org/',
      accounts: [process.env.PRIV_KEY],
    },
    hardhat: {
      zksync: true,
    },
  },
  etherscan: {
    enabled: true,
    apiKey: {
      berachain: process.env.berachain,
      unichainSepolia: process.env.unichainSepolia,
      immutableTestnet: process.env.immutableTestnet,
      optimismSepolia: process.env.optimismSepolia,
      lineaSepolia: process.env.lineaSepolia,
      taikoHekla: process.env.taikoHekla,
      arbitrumSepolia: process.env.arbitrumSepolia,
      minato: process.env.minato,
      sepolia: process.env.sepolia,
      kakarot_sepolia: process.env.kakarotSepolia,
      mantleSepolia: process.env.mantleSepolia,
      mainnet: process.env.sepolia,
      optimisticEthereum: process.env.optimismSepolia,
      arbitrumOne: process.env.arbitrumSepolia,
      base: process.env.baseAPIKey,
      zkSyncEraSepolia: process.env.zk_sync,
      zkSyncEraMainnet: process.env.zk_sync,
    },
    customChains: [
      {
        network: 'zkSyncEraMainnet',
        chainId: 324,
        urls: {
          apiURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification',
          browserURL: 'https://explorer.zksync.io',
          verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification',
        },
      },
      {
        network: 'zkSyncEraSepolia',
        chainId: 300,
        urls: {
          apiURL: 'https://api-sepolia-era.zksync.network/api',
          browserURL: 'https://sepolia.explorer.zksync.io',
        },
      },
      {
        network: 'mantleSepolia',
        chainId: 5003,
        urls: {
          apiURL: 'https://api-sepolia.mantlescan.xyz/api',
          browserURL: 'https://sepolia.mantlescan.xyz/',
        },
      },
      {
        network: 'berachain',
        chainId: 80084,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/80084/etherscan/api/',
          browserURL: 'https://bartio.beratrail.io/',
        },
      },
      {
        network: 'unichainSepolia',
        chainId: 1301,
        urls: {
          apiURL: 'https://sepolia.uniscan.xyz/api',
          browserURL: '	https://sepolia.uniscan.xyz/',
        },
      },
      {
        network: 'lineaSepolia',
        chainId: 59141,
        urls: {
          apiURL: 'https://api-sepolia.lineascan.build/api',
          browserURL: 'https://sepolia.lineascan.build',
        },
      },
      {
        network: 'optimismSepolia',
        chainId: 11155420,
        urls: {
          apiURL: 'https://api-sepolia-optimistic.etherscan.io/api',
          browserURL: 'https://sepolia-optimism.etherscan.io/',
        },
      },
      {
        network: 'taikoHekla',
        chainId: 167009,
        urls: {
          apiURL: 'https://blockscoutapi.hekla.taiko.xyz/api',
          browserURL: 'https://blockscoutapi.hekla.taiko.xyz/',
        },
      },
      {
        network: 'immutableTestnet',
        chainId: 13473,
        urls: {
          apiURL: 'https://explorer.testnet.immutable.com/api',
          browserURL: 'https://explorer.testnet.immutable.com/',
        },
      },
      {
        network: 'arbitrumSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io/',
        },
      },
      {
        network: 'kakarot_sepolia',
        chainId: 920637907288165,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/920637907288165/etherscan',
          browserURL: 'https://sepolia.kakarotscan.org',
        },
      },
      {
        network: 'minato',
        chainId: 1946,
        urls: {
          apiURL: 'https://explorer-testnet.soneium.org/api',
          browserURL: 'https://explorer-testnet.soneium.org/',
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};
