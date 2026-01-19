# TRAIN Protocol on X1 - Deployment Guide

This document provides step-by-step instructions for building, testing, and deploying the TRAIN HTLC contracts to the X1 blockchain network.

## Overview

X1 is a Solana SVM (Sealevel Virtual Machine) fork, which means TRAIN Protocol's Solana implementation can be deployed directly to X1 with minimal configuration changes. The primary difference is the RPC endpoint and cluster configuration.

## Prerequisites

Before deploying to X1, ensure you have:

- Rust toolchain installed (`rustup`)
- - Anchor framework 0.30.1+ installed
  - - Solana CLI tools (v1.18+)
    - - A Solana wallet with test tokens (for X1 testnet)
      - - Git for version control
        - - Node.js and Yarn for testing (optional)
         
          - ### Installation
         
          - ```bash
            # Install Rust
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
            source $HOME/.cargo/env

            # Install Anchor
            npm install -g @coral-xyz/anchor-cli@0.30.1

            # Install Solana CLI
            sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"
            export PATH="/home/username/.local/share/solana/install/active_release/bin:$PATH"
            ```

            ## X1 Network Configuration

            ### X1 Testnet (Tachyon)

            - **Network**: X1 Tachyon Testnet
            - - **RPC Endpoint**: `https://rpc.testnet.x1.xyz`
              - - **Chain ID**: 195 (testnet)
                - - **Faucet**: https://xolana.xen.network/web_faucet
                  - - **Explorer**: https://testnet.x1scan.com/
                   
                    - ### X1 Mainnet
                   
                    - - **Network**: X1 Mainnet
                      - - **RPC Endpoint**: `https://rpc.mainnet.x1.xyz`
                        - - **Chain ID**: 196 (mainnet)
                          - - **Entrypoints**: entrypoint0-4.mainnet.x1.xyz:8001
                           
                            - ## Setup Steps
                           
                            - ### 1. Clone and Setup
                           
                            - ```bash
                              # Clone your fork
                              git clone https://github.com/VladimirKlav/contracts.git
                              cd contracts

                              # Checkout the X1 branch
                              git checkout main-add-x1

                              # Navigate to Solana contracts directory
                              cd chains/solana/sol
                              ```

                              ### 2. Configure Solana CLI for X1 Testnet

                              ```bash
                              # Set X1 testnet as the active cluster
                              solana config set -u https://rpc.testnet.x1.xyz

                              # Verify configuration
                              solana config get

                              # Output should show:
                              # RPC URL: https://rpc.testnet.x1.xyz
                              # WebSocket URL: wss://rpc.testnet.x1.xyz/
                              # Keypair Path: /home/username/.config/solana/id.json
                              ```

                              ### 3. Fund Your Wallet

                              Get test XNT tokens from the X1 faucet:

                              ```bash
                              # Get your wallet address
                              solana address

                              # Visit https://xolana.xen.network/web_faucet
                              # Enter your wallet address and request test tokens
                              # Wait 1-2 minutes for tokens to arrive

                              # Check your balance
                              solana balance
                              ```

                              ### 4. Build the TRAIN Contracts

                              ```bash
                              # Build all Anchor programs
                              anchor build

                              # Output should show:
                              # Compiling train_htlc v0.1.0
                              # Compiling train_discovery v0.1.0
                              # Finished dev [unoptimized + debuginfo] target(s) in X.XXs
                              ```

                              ### 5. Deploy to X1 Testnet

                              ```bash
                              # Deploy the contracts
                              anchor deploy

                              # This will:
                              # 1. Create IDL (Interface Definition Language)
                              # 2. Upload program binaries
                              # 3. Update Anchor.toml with deployed program IDs
                              ```

                              ### 6. Update Program IDs

                              After successful deployment, you'll get two program IDs. Update them in `Anchor.toml`:

                              ```toml
                              [programs.x1-testnet]
                              train_htlc = "YOUR_DEPLOYED_HTLC_PROGRAM_ID"
                              train_discovery = "YOUR_DEPLOYED_DISCOVERY_PROGRAM_ID"
                              ```

                              ### 7. Run Tests

                              ```bash
                              # Run Anchor test suite
                              anchor test

                              # This will:
                              # 1. Start a local X1 validator
                              # 2. Deploy your programs
                              # 3. Run all tests in tests/
                              # 4. Display results
                              ```

                              ## Verification Steps

                              ### Verify Deployment on Explorer

                              After deployment, verify your contracts on the X1 explorer:

                              1. Visit: https://testnet.x1scan.com/
                              2. 2. Search for your program ID
                                 3. 3. Confirm:
                                    4.    - Program is verified
                                          -    - Program owner matches your wallet
                                               -    - Executable flag is set
                                                
                                                    - ### Verify HTLC Functionality
                                                
                                                    - Test the key HTLC operations:
                                                
                                                    - ```bash
                                                      # Lock funds test
                                                      # Should create an HTLC with:
                                                      # - Correct timeout
                                                      # - Correct recipient
                                                      # - Correct hash preimage

                                                      # Reveal secret test
                                                      # Should allow redemption when correct hash preimage is provided

                                                      # Refund test
                                                      # Should allow refund after timeout period
                                                      ```

                                                      ## Common Issues and Solutions

                                                      ### Issue: RPC Connection Failed

                                                      **Error**: "Failed to connect to RPC endpoint"

                                                      **Solution**:
                                                      ```bash
                                                      # Verify RPC endpoint is correct
                                                      solana config get

                                                      # Test connection
                                                      curl https://rpc.testnet.x1.xyz

                                                      # If testnet is down, check status at:
                                                      # https://x1labs.github.io/docs/status
                                                      ```

                                                      ### Issue: Insufficient Funds

                                                      **Error**: "Transaction failed: Account has insufficient funds"

                                                      **Solution**:
                                                      ```bash
                                                      # Check your balance
                                                      solana balance

                                                      # Request more tokens from faucet:
                                                      # https://xolana.xen.network/web_faucet

                                                      # Or transfer from another testnet wallet
                                                      solana transfer RECIPIENT_ADDRESS AMOUNT
                                                      ```

                                                      ### Issue: Program Deployment Failed

                                                      **Error**: "BPF program too large"

                                                      **Solution**:
                                                      ```bash
                                                      # Build in release mode (smaller binary)
                                                      anchor build --release

                                                      # Deploy release build
                                                      anchor deploy --program-name train_htlc --program-keypair target/deploy/train_htlc-keypair.json
                                                      ```

                                                      ## Next Steps After Deployment

                                                      1. **Create Migration Scripts**
                                                      2.    - Add deployment scripts to `migrations/` directory
                                                            -    - Document any onchain state setup
                                                             
                                                                 - 2. **Integration Testing**
                                                                   3.    - Test atomic swaps between chains
                                                                         -    - Verify timeout behaviors
                                                                              -    - Test hash collision handling
                                                                               
                                                                                   - 3. **Documentation Updates**
                                                                                     4.    - Update main README with X1 support
                                                                                           -    - Create X1-specific API documentation
                                                                                                -    - Document network-specific parameters
                                                                                                 
                                                                                                     - 4. **Security Audit**
                                                                                                       5.    - Review contract code for X1-specific vulnerabilities
                                                                                                             -    - Test edge cases for SVM compatibility
                                                                                                                  -    - Verify gas/compute unit estimates
                                                                                                                   
                                                                                                                       - ## Monitoring and Maintenance
                                                                                                                   
                                                                                                                       - ### Monitor Program Status
                                                                                                                   
                                                                                                                       - ```bash
                                                                                                                         # Check program info
                                                                                                                         solana program show YOUR_PROGRAM_ID

                                                                                                                         # View program account data
                                                                                                                         solana account YOUR_PROGRAM_ID
                                                                                                                         ```
                                                                                                                         
                                                                                                                         ### Update Programs (if needed)
                                                                                                                         
                                                                                                                         ```bash
                                                                                                                         # Rebuild with changes
                                                                                                                         anchor build

                                                                                                                         # Deploy update
                                                                                                                         anchor deploy
                                                                                                                         ```
                                                                                                                         
                                                                                                                         ## Resources
                                                                                                                         
                                                                                                                         - [X1 Documentation](https://docs.x1.xyz)
                                                                                                                         - - [Anchor Framework Docs](https://www.anchor-lang.com)
                                                                                                                           - - [Solana SVM Documentation](https://docs.solana.com)
                                                                                                                             - - [TRAIN Protocol GitHub](https://github.com/TrainProtocol/contracts)
                                                                                                                               - - [X1 Explorer](https://testnet.x1scan.com/)
                                                                                                                                
                                                                                                                                 - ## Support
                                                                                                                                
                                                                                                                                 - For issues or questions:
                                                                                                                                
                                                                                                                                 - 1. Check the [X1 Documentation](https://docs.x1.xyz)
                                                                                                                                   2. 2. Review Anchor Framework [GitHub Issues](https://github.com/coral-xyz/anchor/issues)
                                                                                                                                      3. 3. Open an issue on the [TRAIN Protocol repository](https://github.com/TrainProtocol/contracts)
