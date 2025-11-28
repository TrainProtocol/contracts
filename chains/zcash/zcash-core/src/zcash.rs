use std::fmt;
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};

/// Zcash network types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}



impl fmt::Display for Network {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Network::Mainnet => write!(f, "mainnet"),
            Network::Testnet => write!(f, "testnet"),
        }
    }
}

/// RPC configuration for connecting to a Zcash node
#[derive(Debug, Clone)]
pub struct RpcConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl RpcConfig {
    pub fn new(url: String) -> Self {
        Self {
            url,
            username: None,
            password: None,
        }
    }

    pub fn with_auth(url: String, username: String, password: String) -> Self {
        Self {
            url,
            username: Some(username),
            password: Some(password),
        }
    }
}

/// Main Zcash client for interacting with the network
#[derive(Debug, Clone)]
pub struct ZcashClient {
    network: Network,
    rpc_config: RpcConfig,
}

impl ZcashClient {
    /// Creates a new Zcash client
    pub fn new(network: Network, rpc_config: RpcConfig) -> Self {
        Self {
            network,
            rpc_config,
        }
    }

    /// Gets the current network
    pub fn network(&self) -> Network {
        self.network
    }

    /// Gets the RPC configuration
    pub fn rpc_config(&self) -> &RpcConfig {
        &self.rpc_config
    }

    // Transaction methods
    
    /// Gets a transaction by its ID via RPC
    pub async fn get_transaction(&self, txid: &str) -> Result<Transaction, ZcashError> {
        let response = self.rpc_call("getrawtransaction", vec![
            serde_json::json!(txid),
            serde_json::json!(1), // verbose = true
        ]).await?;
        
        serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse transaction: {}", e)))
    }

    /// Gets a raw transaction by its ID via RPC
    pub async fn get_raw_transaction(&self, txid: &str) -> Result<Vec<u8>, ZcashError> {
        let response = self.rpc_call("getrawtransaction", vec![
            serde_json::json!(txid),
            serde_json::json!(0), // verbose = false
        ]).await?;
        
        let hex_str: String = serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse raw tx: {}", e)))?;
            
        hex::decode(&hex_str)
            .map_err(|e| ZcashError::InvalidTransaction(format!("Invalid hex: {}", e)))
    }

    /// Broadcasts a raw transaction to the network via RPC
    pub async fn send_raw_transaction(&self, raw_tx: &[u8]) -> Result<String, ZcashError> {
        let hex_tx = hex::encode(raw_tx);
        let response = self.rpc_call("sendrawtransaction", vec![
            serde_json::json!(hex_tx),
        ]).await?;
        
        serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to broadcast tx: {}", e)))
    }

    /// Creates a raw transaction using zcash_primitives
    pub fn create_raw_transaction(
        &self,
        _inputs: Vec<TransactionInput>,
        _outputs: Vec<TransactionOutput>,
    ) -> Result<Vec<u8>, ZcashError> {
        Err(ZcashError::NotImplemented("create_raw_transaction".to_string()))
    }

    /// Gets the current block height via RPC
    pub async fn get_block_height(&self) -> Result<u64, ZcashError> {
        let response = self.rpc_call("getblockcount", vec![]).await?;
        serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse block height: {}", e)))
    }

    /// Gets block information by height via RPC
    pub async fn get_block(&self, height: u64) -> Result<Block, ZcashError> {
        // First get block hash
        let hash_response = self.rpc_call("getblockhash", vec![
            serde_json::json!(height),
        ]).await?;
        
        let hash: String = serde_json::from_value(hash_response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse block hash: {}", e)))?;
        
        // Then get block details
        let response = self.rpc_call("getblock", vec![
            serde_json::json!(hash),
            serde_json::json!(1), // verbose = true
        ]).await?;
        
        serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse block: {}", e)))
    }

    // Wallet methods

    /// Creates a wallet from a mnemonic phrase using bip39 and zcash_primitives
    pub fn wallet_from_mnemonic(
        &self,
        mnemonic: &str,
        account: u32,
    ) -> Result<Wallet, ZcashError> {
        let mnemonic = Mnemonic::parse_in_normalized(Language::English, mnemonic)
            .map_err(|e| ZcashError::InvalidMnemonic(e.to_string()))?;
        
        // Convert mnemonic to seed bytes
        let seed_bytes = mnemonic.to_seed("");
        
        Ok(Wallet {
            network: self.network,
            seed: seed_bytes.to_vec(),
            account,
        })
    }

    /// Creates a wallet from a private key
    pub fn wallet_from_private_key(&self, private_key: &[u8]) -> Result<Wallet, ZcashError> {
        if private_key.len() != 32 {
            return Err(ZcashError::InvalidPrivateKey("Key must be 32 bytes".to_string()));
        }
        
        Ok(Wallet {
            network: self.network,
            seed: private_key.to_vec(),
            account: 0,
        })
    }

    /// Derives a transparent address from a wallet at a specific index
    pub fn derive_transparent_address(
        &self,
        _wallet: &Wallet,
        _index: u32,
    ) -> Result<String, ZcashError> {
        Err(ZcashError::NotImplemented("derive_transparent_address".to_string()))
    }

    /// Derives a shielded address from a wallet at a specific index
    pub fn derive_shielded_address(
        &self,
        _wallet: &Wallet,
        _index: u32,
    ) -> Result<String, ZcashError> {
        Err(ZcashError::NotImplemented("derive_shielded_address".to_string()))
    }

    // Shielding methods

    /// Shields transparent UTXOs to a shielded address
    pub async fn shield_utxos(
        &self,
        _from_address: &str,
        _to_shielded_address: &str,
        _amount: u64,
    ) -> Result<String, ZcashError> {
        Err(ZcashError::NotImplemented("shield_utxos".to_string()))
    }

    /// Unshields from a shielded address to a transparent address
    pub async fn unshield(
        &self,
        _from_shielded_address: &str,
        _to_transparent_address: &str,
        _amount: u64,
    ) -> Result<String, ZcashError> {
        Err(ZcashError::NotImplemented("unshield".to_string()))
    }

    /// Gets the balance of a transparent address via RPC
    pub async fn get_transparent_balance(&self, address: &str) -> Result<u64, ZcashError> {
        let response = self.rpc_call("getaddressbalance", vec![
            serde_json::json!({"addresses": [address]}),
        ]).await?;
        
        let balance_obj: serde_json::Value = serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse balance: {}", e)))?;
            
        let balance = balance_obj["balance"].as_u64()
            .ok_or_else(|| ZcashError::RpcError("Invalid balance format".to_string()))?;
            
        Ok(balance)
    }

    /// Gets the balance of a shielded address via RPC
    pub async fn get_shielded_balance(&self, address: &str) -> Result<u64, ZcashError> {
        let response = self.rpc_call("z_getbalance", vec![
            serde_json::json!(address),
        ]).await?;
        
        let balance: f64 = serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse balance: {}", e)))?;
            
        // Convert ZEC to zatoshis (1 ZEC = 100,000,000 zatoshis)
        Ok((balance * 100_000_000.0) as u64)
    }

    /// Lists UTXOs for a transparent address via RPC
    pub async fn list_utxos(&self, address: &str) -> Result<Vec<UTXO>, ZcashError> {
        let response = self.rpc_call("getaddressutxos", vec![
            serde_json::json!({"addresses": [address]}),
        ]).await?;
        
        serde_json::from_value(response)
            .map_err(|e| ZcashError::RpcError(format!("Failed to parse UTXOs: {}", e)))
    }

    async fn rpc_call(
        &self,
        method: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, ZcashError> {
        let client = reqwest::Client::new();
        let mut request = client.post(&self.rpc_config.url);
        
        if let (Some(username), Some(password)) = (&self.rpc_config.username, &self.rpc_config.password) {
            request = request.basic_auth(username, Some(password));
        }
        
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "zcash-client",
            "method": method,
            "params": params,
        });
        
        let response = request
            .json(&body)
            .send()
            .await
            .map_err(|e| ZcashError::NetworkError(e.to_string()))?;
            
        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ZcashError::NetworkError(e.to_string()))?;
            
        if let Some(error) = json.get("error") {
            if !error.is_null() {
                return Err(ZcashError::RpcError(error.to_string()));
            }
        }
        
        json.get("result")
            .cloned()
            .ok_or_else(|| ZcashError::RpcError("No result in RPC response".to_string()))
    }
}

// Supporting types

/// Represents a Zcash wallet (wraps bip39 seed and zcash_primitives keys)
#[derive(Debug, Clone)]
pub struct Wallet {
    pub network: Network,
    pub seed: Vec<u8>,
    pub account: u32,
}

/// Represents a transaction input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionInput {
    pub txid: String,
    pub vout: u32,
    #[serde(rename = "scriptSig")]
    pub script_sig: Option<String>,
    pub sequence: Option<u32>,
}

/// Represents a transaction output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionOutput {
    pub value: u64,
    #[serde(rename = "scriptPubKey")]
    pub script_pubkey: Option<String>,
    pub address: Option<String>,
}

/// Represents a complete transaction (from RPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub txid: String,
    pub version: Option<i32>,
    pub locktime: Option<u32>,
    #[serde(rename = "vin")]
    pub inputs: Option<Vec<TransactionInput>>,
    #[serde(rename = "vout")]
    pub outputs: Option<Vec<TransactionOutput>>,
    pub confirmations: Option<u64>,
    #[serde(rename = "blockheight")]
    pub block_height: Option<u64>,
}

/// Represents a block in the Zcash blockchain (from RPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub hash: String,
    pub height: u64,
    pub time: Option<u64>,
    #[serde(rename = "tx")]
    pub transactions: Option<Vec<String>>,
    #[serde(rename = "merkleroot")]
    pub merkle_root: Option<String>,
}

/// Represents a UTXO (Unspent Transaction Output from RPC)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UTXO {
    pub txid: String,
    #[serde(rename = "outputIndex")]
    pub vout: u32,
    pub address: String,
    pub satoshis: u64,
    pub height: Option<u64>,
}

impl UTXO {
    pub fn value(&self) -> u64 {
        self.satoshis
    }
    
    pub fn confirmations(&self, current_height: u64) -> u64 {
        self.height.map(|h| current_height.saturating_sub(h) + 1).unwrap_or(0)
    }
}

/// Errors that can occur when interacting with Zcash
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZcashError {
    NotImplemented(String),
    RpcError(String),
    InvalidAddress(String),
    InvalidTransaction(String),
    InsufficientFunds,
    NetworkError(String),
    WalletError(String),
    InvalidMnemonic(String),
    InvalidPrivateKey(String),
}

impl fmt::Display for ZcashError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ZcashError::NotImplemented(method) => {
                write!(f, "Method '{}' not yet implemented", method)
            }
            ZcashError::RpcError(msg) => write!(f, "RPC error: {}", msg),
            ZcashError::InvalidAddress(addr) => write!(f, "Invalid address: {}", addr),
            ZcashError::InvalidTransaction(msg) => write!(f, "Invalid transaction: {}", msg),
            ZcashError::InsufficientFunds => write!(f, "Insufficient funds"),
            ZcashError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            ZcashError::WalletError(msg) => write!(f, "Wallet error: {}", msg),
            ZcashError::InvalidMnemonic(msg) => write!(f, "Invalid mnemonic: {}", msg),
            ZcashError::InvalidPrivateKey(msg) => write!(f, "Invalid private key: {}", msg),
        }
    }
}

impl std::error::Error for ZcashError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_network_display() {
        assert_eq!(Network::Mainnet.to_string(), "mainnet");
        assert_eq!(Network::Testnet.to_string(), "testnet");
    }

    #[test]
    fn test_rpc_config_creation() {
        let config = RpcConfig::new("http://localhost:8232".to_string());
        assert_eq!(config.url, "http://localhost:8232");
        assert!(config.username.is_none());
        assert!(config.password.is_none());
    }

    #[test]
    fn test_rpc_config_with_auth() {
        let config = RpcConfig::with_auth(
            "http://localhost:8232".to_string(),
            "user".to_string(),
            "pass".to_string(),
        );
        assert_eq!(config.url, "http://localhost:8232");
        assert_eq!(config.username, Some("user".to_string()));
        assert_eq!(config.password, Some("pass".to_string()));
    }

    #[test]
    fn test_client_creation() {
        let config = RpcConfig::new("http://localhost:8232".to_string());
        let client = ZcashClient::new(Network::Testnet, config);
        assert_eq!(client.network(), Network::Testnet);
    }

    #[test]
    fn test_error_display() {
        let err = ZcashError::NotImplemented("test_method".to_string());
        assert_eq!(err.to_string(), "Method 'test_method' not yet implemented");

        let err = ZcashError::InsufficientFunds;
        assert_eq!(err.to_string(), "Insufficient funds");
    }
    
    #[test]
    fn test_wallet_from_mnemonic() {
        let config = RpcConfig::new("http://localhost:8232".to_string());
        let client = ZcashClient::new(Network::Testnet, config);
        
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let wallet = client.wallet_from_mnemonic(mnemonic, 0);
        assert!(wallet.is_ok());
        
        let wallet = wallet.unwrap();
        assert_eq!(wallet.network, Network::Testnet);
        assert_eq!(wallet.account, 0);
        assert!(!wallet.seed.is_empty());
    }
}
