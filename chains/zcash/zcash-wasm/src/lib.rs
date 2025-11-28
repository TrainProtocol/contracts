use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use js_sys::Promise;
use serde::{Deserialize, Serialize};
use bip39::{Language, Mnemonic};
use sha2::{Digest, Sha256};
use ripemd::Ripemd160;

#[cfg(target_arch = "wasm32")]
use console_error_panic_hook;

#[cfg(target_arch = "wasm32")]
use getrandom::register_custom_getrandom;

#[cfg(target_arch = "wasm32")]
fn custom_getrandom(buf: &mut [u8]) -> Result<(), getrandom::Error> {
    use js_sys::Uint8Array;
    use wasm_bindgen::JsCast;
    
    let crypto = js_sys::Reflect::get(&js_sys::global(), &"crypto".into())
        .map_err(|_| getrandom::Error::from(core::num::NonZeroU32::new(1).unwrap()))?;
    
    let get_random_values = js_sys::Reflect::get(&crypto, &"getRandomValues".into())
        .map_err(|_| getrandom::Error::from(core::num::NonZeroU32::new(1).unwrap()))?
        .dyn_into::<js_sys::Function>()
        .map_err(|_| getrandom::Error::from(core::num::NonZeroU32::new(1).unwrap()))?;
    
    let array = Uint8Array::new_with_length(buf.len() as u32);
    get_random_values.call1(&crypto, &array)
        .map_err(|_| getrandom::Error::from(core::num::NonZeroU32::new(1).unwrap()))?;
    
    array.copy_to(buf);
    Ok(())
}

#[cfg(target_arch = "wasm32")]
register_custom_getrandom!(custom_getrandom);

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WasmNetwork {
    Mainnet,
    Testnet,
}

#[wasm_bindgen]
pub struct WasmRpcConfig {
    url: String,
    username: Option<String>,
    password: Option<String>,
    api_key: Option<String>,
}

#[wasm_bindgen]
impl WasmRpcConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(url: String) -> Self {
        Self {
            url,
            username: None,
            password: None,
            api_key: None,
        }
    }

    #[wasm_bindgen(js_name = withAuth)]
    pub fn with_auth(url: String, username: String, password: String) -> Self {
        Self {
            url,
            username: Some(username),
            password: Some(password),
            api_key: None,
        }
    }

    #[wasm_bindgen(js_name = withApiKey)]
    pub fn with_api_key(url: String, api_key: String) -> Self {
        Self {
            url,
            username: None,
            password: None,
            api_key: Some(api_key),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn url(&self) -> String {
        self.url.clone()
    }
}

#[wasm_bindgen]
pub struct WasmWallet {
    network: WasmNetwork,
    seed: Vec<u8>,
    account: u32,
}

#[wasm_bindgen]
impl WasmWallet {
    #[wasm_bindgen(getter)]
    pub fn network(&self) -> WasmNetwork {
        self.network
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> u32 {
        self.account
    }

    #[wasm_bindgen(js_name = getSeedHex)]
    pub fn get_seed_hex(&self) -> String {
        hex::encode(&self.seed)
    }
}

#[wasm_bindgen]
pub struct WasmZcashClient {
    network: WasmNetwork,
    rpc_url: String,
    rpc_username: Option<String>,
    rpc_password: Option<String>,
    rpc_api_key: Option<String>,
}

#[wasm_bindgen]
impl WasmZcashClient {
    #[wasm_bindgen(constructor)]
    pub fn new(network: WasmNetwork, config: WasmRpcConfig) -> Self {
        Self {
            network,
            rpc_url: config.url,
            rpc_username: config.username,
            rpc_password: config.password,
            rpc_api_key: config.api_key,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn network(&self) -> WasmNetwork {
        self.network
    }

    // Wallet methods (sync)

    #[wasm_bindgen(js_name = walletFromMnemonic)]
    pub fn wallet_from_mnemonic(&self, mnemonic: String, account: u32) -> Result<WasmWallet, JsValue> {
        let mnemonic = Mnemonic::parse_in_normalized(Language::English, &mnemonic)
            .map_err(|e| JsValue::from_str(&format!("Invalid mnemonic: {}", e)))?;
        
        let seed_bytes = mnemonic.to_seed("");
        
        Ok(WasmWallet {
            network: self.network,
            seed: seed_bytes.to_vec(),
            account,
        })
    }

    #[wasm_bindgen(js_name = walletFromPrivateKey)]
    pub fn wallet_from_private_key(&self, private_key_hex: String) -> Result<WasmWallet, JsValue> {
        let private_key = hex::decode(&private_key_hex)
            .map_err(|e| JsValue::from_str(&format!("Invalid hex: {}", e)))?;
            
        if private_key.len() != 32 {
            return Err(JsValue::from_str("Private key must be 32 bytes"));
        }
        
        Ok(WasmWallet {
            network: self.network,
            seed: private_key,
            account: 0,
        })
    }

    #[wasm_bindgen(js_name = deriveTransparentAddress)]
    pub fn derive_transparent_address(&self, wallet: &WasmWallet, index: u32) -> Result<String, JsValue> {
        // BIP44 path: m/44'/133'/account'/0/index (133 is Zcash coin type)
        let path = vec![
            0x8000002C, // 44' (purpose)
            0x80000085, // 133' (Zcash coin type)
            0x80000000 | wallet.account, // account'
            0,          // change (0 = external)
            index,      // address index
        ];
        
        let private_key = derive_private_key(&wallet.seed, &path)
            .map_err(|e| JsValue::from_str(&e))?;
        
        let public_key = derive_public_key(&private_key)
            .map_err(|e| JsValue::from_str(&e))?;
        
        let address = public_key_to_address(&public_key, wallet.network)
            .map_err(|e| JsValue::from_str(&e))?;
        
        Ok(address)
    }

    #[wasm_bindgen(js_name = deriveShieldedAddress)]
    pub fn derive_shielded_address(&self, _wallet: &WasmWallet, _index: u32) -> Result<String, JsValue> {
        Err(JsValue::from_str("Method not yet implemented - requires zcash_primitives"))
    }

    // RPC methods - these will call the Zcash node via fetch API in browser

    #[wasm_bindgen(js_name = getBlockHeight)]
    pub fn get_block_height(&self) -> Promise {
        let url = self.rpc_url.clone();
        let username = self.rpc_username.clone();
        let password = self.rpc_password.clone();
        let api_key = self.rpc_api_key.clone();
        
        future_to_promise(async move {
            Self::rpc_call(&url, username.as_deref(), password.as_deref(), api_key.as_deref(), "getblockcount", vec![]).await
        })
    }

    #[wasm_bindgen(js_name = getTransaction)]
    pub fn get_transaction(&self, txid: String) -> Promise {
        let url = self.rpc_url.clone();
        let username = self.rpc_username.clone();
        let password = self.rpc_password.clone();
        let api_key = self.rpc_api_key.clone();
        
        future_to_promise(async move {
            let params = vec![
                JsValue::from_str(&txid),
                JsValue::from_f64(1.0), // verbose = true
            ];
            Self::rpc_call(&url, username.as_deref(), password.as_deref(), api_key.as_deref(), "getrawtransaction", params).await
        })
    }

    #[wasm_bindgen(js_name = getTransparentBalance)]
    pub fn get_transparent_balance(&self, address: String) -> Promise {
        let url = self.rpc_url.clone();
        let username = self.rpc_username.clone();
        let password = self.rpc_password.clone();
        let api_key = self.rpc_api_key.clone();
        
        future_to_promise(async move {
            let addresses_obj = js_sys::Object::new();
            let addresses_array = js_sys::Array::new();
            addresses_array.push(&JsValue::from_str(&address));
            js_sys::Reflect::set(&addresses_obj, &JsValue::from_str("addresses"), &addresses_array)
                .map_err(|_| JsValue::from_str("Failed to create params object"))?;
                
            let params = vec![addresses_obj.into()];
            Self::rpc_call(&url, username.as_deref(), password.as_deref(), api_key.as_deref(), "getaddressbalance", params).await
        })
    }

    #[wasm_bindgen(js_name = listUtxos)]
    pub fn list_utxos(&self, address: String) -> Promise {
        let url = self.rpc_url.clone();
        let username = self.rpc_username.clone();
        let password = self.rpc_password.clone();
        let api_key = self.rpc_api_key.clone();
        
        future_to_promise(async move {
            let addresses_obj = js_sys::Object::new();
            let addresses_array = js_sys::Array::new();
            addresses_array.push(&JsValue::from_str(&address));
            js_sys::Reflect::set(&addresses_obj, &JsValue::from_str("addresses"), &addresses_array)
                .map_err(|_| JsValue::from_str("Failed to create params object"))?;
                
            let params = vec![addresses_obj.into()];
            Self::rpc_call(&url, username.as_deref(), password.as_deref(), api_key.as_deref(), "getaddressutxos", params).await
        })
    }

    async fn rpc_call(
        url: &str,
        username: Option<&str>,
        password: Option<&str>,
        api_key: Option<&str>,
        method: &str,
        params: Vec<JsValue>,
    ) -> Result<JsValue, JsValue> {
        use web_sys::{Request, RequestInit, RequestMode, Response};

        let params_array = js_sys::Array::new();
        for param in params {
            params_array.push(&param);
        }

        let body_obj = js_sys::Object::new();
        js_sys::Reflect::set(&body_obj, &JsValue::from_str("jsonrpc"), &JsValue::from_str("2.0"))?;
        js_sys::Reflect::set(&body_obj, &JsValue::from_str("id"), &JsValue::from_str("zcash-wasm"))?;
        js_sys::Reflect::set(&body_obj, &JsValue::from_str("method"), &JsValue::from_str(method))?;
        js_sys::Reflect::set(&body_obj, &JsValue::from_str("params"), &params_array)?;

        let body_str = js_sys::JSON::stringify(&body_obj)?;

        let mut opts = RequestInit::new();
        opts.set_method("POST");
        opts.set_mode(RequestMode::Cors);
        opts.body(Some(body_str.unchecked_ref()));

        let request = Request::new_with_str_and_init(url, &opts)?;
        
        request.headers().set("Content-Type", "application/json")?;
        request.headers().set("accept", "application/json")?;
        
        if let Some(key) = api_key {
            request.headers().set("x-api-key", key)?;
        } else if let (Some(user), Some(pass)) = (username, password) {
            let auth = format!("{}:{}", user, pass);
            let encoded = base64_encode(&auth);
            request.headers().set("Authorization", &format!("Basic {}", encoded))?;
        }

        let global = js_sys::global();
        let fetch_fn = js_sys::Reflect::get(&global, &JsValue::from_str("fetch"))
            .map_err(|_| JsValue::from_str("fetch is not available"))?;
        let fetch_fn = fetch_fn.dyn_into::<js_sys::Function>()
            .map_err(|_| JsValue::from_str("fetch is not a function"))?;
        
        let promise = fetch_fn.call1(&global, &request)
            .map_err(|e| JsValue::from_str(&format!("Failed to call fetch: {:?}", e)))?;
        
        let resp_value = wasm_bindgen_futures::JsFuture::from(js_sys::Promise::from(promise)).await?;
        let resp: Response = resp_value.dyn_into()?;

        let json = wasm_bindgen_futures::JsFuture::from(resp.json()?).await?;
        
        let result = js_sys::Reflect::get(&json, &JsValue::from_str("result"))?;
        
        if result.is_undefined() || result.is_null() {
            let error = js_sys::Reflect::get(&json, &JsValue::from_str("error"))?;
            if !error.is_null() {
                return Err(error);
            }
            return Err(JsValue::from_str("No result in RPC response"));
        }

        Ok(result)
    }
}

use k256::ecdsa::SigningKey;
use k256::elliptic_curve::sec1::ToEncodedPoint;

fn derive_private_key(seed: &[u8], path: &[u32]) -> Result<Vec<u8>, String> {
    use sha2::Sha512;
    use hmac::{Hmac, Mac};
    
    type HmacSha512 = Hmac<Sha512>;
    
    let mut mac = HmacSha512::new_from_slice(b"Bitcoin seed")
        .map_err(|e| format!("HMAC error: {}", e))?;
    mac.update(seed);
    let result = mac.finalize().into_bytes();
    
    let mut chain_code = result[32..64].to_vec();
    let mut private_key = result[0..32].to_vec();
    
    for &index in path {
        let hardened = index >= 0x80000000;
        
        let mut data = Vec::new();
        if hardened {
            data.push(0x00);
            data.extend_from_slice(&private_key);
        } else {
            let signing_key = SigningKey::from_bytes((&private_key[..]).into())
                .map_err(|e| format!("Invalid private key: {}", e))?;
            let verifying_key = signing_key.verifying_key();
            let public_key_bytes = verifying_key.to_encoded_point(true);
            data.extend_from_slice(public_key_bytes.as_bytes());
        }
        data.extend_from_slice(&index.to_be_bytes());
        
        let mut mac = HmacSha512::new_from_slice(&chain_code)
            .map_err(|e| format!("HMAC error: {}", e))?;
        mac.update(&data);
        let result = mac.finalize().into_bytes();
        
        let mut new_key = [0u8; 32];
        new_key.copy_from_slice(&result[0..32]);
        
        for i in 0..32 {
            let sum = private_key[i] as u16 + new_key[i] as u16;
            private_key[i] = sum as u8;
            if i + 1 < 32 && sum > 255 {
                private_key[i + 1] = private_key[i + 1].wrapping_add(1);
            }
        }
        
        chain_code = result[32..64].to_vec();
    }
    
    Ok(private_key)
}

fn derive_public_key(private_key: &[u8]) -> Result<Vec<u8>, String> {
    let signing_key = SigningKey::from_bytes(private_key.into())
        .map_err(|e| format!("Invalid private key: {}", e))?;
    
    let verifying_key = signing_key.verifying_key();
    let public_key_point = verifying_key.to_encoded_point(true);
    
    Ok(public_key_point.as_bytes().to_vec())
}

fn public_key_to_address(public_key: &[u8], network: WasmNetwork) -> Result<String, String> {
    let sha_hash = Sha256::digest(public_key);
    let ripemd_hash = Ripemd160::digest(&sha_hash);
    
    let version_bytes = match network {
        WasmNetwork::Mainnet => vec![0x1C, 0xB8],
        WasmNetwork::Testnet => vec![0x1D, 0x25],
    };
    
    let mut payload = version_bytes;
    payload.extend_from_slice(&ripemd_hash);
    
    let address = base58check_encode(&payload)?;
    
    Ok(address)
}

fn base58check_encode(payload: &[u8]) -> Result<String, String> {
    let hash1 = Sha256::digest(payload);
    let hash2 = Sha256::digest(&hash1);
    let checksum = &hash2[0..4];
    
    let mut data = payload.to_vec();
    data.extend_from_slice(checksum);
    
    Ok(bs58::encode(&data).into_string())
}

#[wasm_bindgen(js_name = bytesToHex)]
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

#[wasm_bindgen(js_name = hexToBytes)]
pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, JsValue> {
    hex::decode(hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex: {}", e)))
}

#[wasm_bindgen(js_name = generateMnemonic)]
pub fn generate_mnemonic() -> Result<String, JsValue> {
    use bip39::Mnemonic;
    // Generate 32 bytes of random entropy for a 24-word mnemonic
    let mut entropy = [0u8; 32];
    getrandom::getrandom(&mut entropy)
        .map_err(|e| JsValue::from_str(&format!("Failed to generate random bytes: {}", e)))?;
    
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| JsValue::from_str(&format!("Failed to create mnemonic: {}", e)))?;
    Ok(mnemonic.to_string())
}

fn base64_encode(s: &str) -> String {
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::STANDARD.encode(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_network() {
        let network = WasmNetwork::Mainnet;
        assert_eq!(network, WasmNetwork::Mainnet);
    }

    #[test]
    fn test_rpc_config_creation() {
        let config = WasmRpcConfig::new("http://localhost:8232".to_string());
        assert_eq!(config.url(), "http://localhost:8232");
    }

    #[test]
    fn test_client_creation() {
        let config = WasmRpcConfig::new("http://localhost:8232".to_string());
        let client = WasmZcashClient::new(WasmNetwork::Testnet, config);
        assert!(matches!(client.network(), WasmNetwork::Testnet));
    }

    #[test]
    fn test_hex_utils() {
        let bytes = vec![0x01, 0x02, 0x03, 0x04];
        let hex = bytes_to_hex(&bytes);
        assert_eq!(hex, "01020304");
        
        let decoded = hex_to_bytes(&hex).unwrap();
        assert_eq!(decoded, bytes);
    }
}
