require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("dotenv").config();
require('hardhat-abi-exporter');
require('hardhat-contract-sizer');
require('solidity-coverage')
require("solidity-docgen")
require('solidity-coverage')
require("hardhat-gas-reporter");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
        details: {
          yul: true
        }
      },
    },
  },
  networks: {
    mumbai: {
      url: "process.env.POLYGON_MUMBAI_RPC",
      accounts: [process.env.ROPSTEN_PRIVATE_KEY],
    },
    bscTestnet: {
      url: "https://bsc-testnet-rpc.publicnode.com",
      accounts: [process.env.ROPSTEN_PRIVATE_KEY],
      gasPrice: 3000000000,
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: [process.env.ROPSTEN_PRIVATE_KEY],
      gasPrice: 300000000,
    },
    base: {
      url: "https://base.llamarpc.com",
      accounts: [process.env.ROPSTEN_PRIVATE_KEY],
      gasPrice: 1000000000,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSC_TESTNET_API_KEY,
      baseSepolia: "empty",
      base: process.env.BSC_TESTNET_API_KEY
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://base-sepolia.blockscout.com/api",
          browserURL: "https://base-sepolia.blockscout.com"
        }
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://base.llamarpc.com",
          browserURL: "https://base-sepolia.blockscout.com"
        }
      }
    ]
  },
  abiExporter: {
    path: './data/abi',
    runOnCompile: true,
    clear: true
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: false
  },
  docgen: {
    sourcesDir: 'contracts',
    outputDir: 'docs',
    pages: 'files',
    theme: 'markdown',
    collapseNewlines: true,
    pageExtension: '.md',
  },
  gasReporter: {
    currency: 'EUR',
    enabled: true,
    L2:"base",
    L2Etherscan: process.env.L2ETHERSCAN,
    coinmarketcap:process.env.COINMARKETCAP_API_KEY
  }
};