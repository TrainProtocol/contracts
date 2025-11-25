use wasm_bindgen::prelude::*;
use zcash_core::{HTLC, HTLCError};

#[cfg(target_arch = "wasm32")]
use console_error_panic_hook;

/// Initialize panic hook for better error messages in WASM
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

/// WASM wrapper for the HTLC struct
#[wasm_bindgen]
pub struct WasmHTLC {
    inner: HTLC,
}

#[wasm_bindgen]
impl WasmHTLC {
    /// Creates a new HTLC
    /// 
    /// # Arguments
    /// * `sender` - The sender's address
    /// * `receiver` - The receiver's address
    /// * `amount` - The amount in zatoshis
    /// * `hashlock` - The 32-byte hash of the secret (as Uint8Array)
    /// * `timelock` - The timelock (block height or timestamp)
    #[wasm_bindgen(constructor)]
    pub fn new(
        sender: String,
        receiver: String,
        amount: u64,
        hashlock: &[u8],
        timelock: u64,
    ) -> Result<WasmHTLC, JsValue> {
        if hashlock.len() != 32 {
            return Err(JsValue::from_str("Hashlock must be exactly 32 bytes"));
        }

        let mut hash_array = [0u8; 32];
        hash_array.copy_from_slice(hashlock);

        Ok(WasmHTLC {
            inner: HTLC::new(sender, receiver, amount, hash_array, timelock),
        })
    }

    /// Gets the sender's address
    #[wasm_bindgen(getter)]
    pub fn sender(&self) -> String {
        self.inner.sender.clone()
    }

    /// Gets the receiver's address
    #[wasm_bindgen(getter)]
    pub fn receiver(&self) -> String {
        self.inner.receiver.clone()
    }

    /// Gets the amount in zatoshis
    #[wasm_bindgen(getter)]
    pub fn amount(&self) -> u64 {
        self.inner.amount
    }

    /// Gets the hashlock as a byte array
    #[wasm_bindgen(getter)]
    pub fn hashlock(&self) -> Vec<u8> {
        self.inner.hashlock.to_vec()
    }

    /// Gets the timelock
    #[wasm_bindgen(getter)]
    pub fn timelock(&self) -> u64 {
        self.inner.timelock
    }

    /// Checks if the HTLC has been redeemed
    #[wasm_bindgen(getter)]
    pub fn redeemed(&self) -> bool {
        self.inner.redeemed
    }

    /// Checks if the HTLC has been refunded
    #[wasm_bindgen(getter)]
    pub fn refunded(&self) -> bool {
        self.inner.refunded
    }

    /// Verifies if the provided secret matches the hashlock
    #[wasm_bindgen(js_name = verifySecret)]
    pub fn verify_secret(&self, secret: &[u8]) -> bool {
        self.inner.verify_secret(secret)
    }

    /// Checks if the timelock has expired
    #[wasm_bindgen(js_name = isExpired)]
    pub fn is_expired(&self, current_time: u64) -> bool {
        self.inner.is_expired(current_time)
    }

    /// Attempts to redeem the HTLC with the given secret
    pub fn redeem(&mut self, secret: &[u8]) -> Result<(), JsValue> {
        self.inner
            .redeem(secret)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Attempts to refund the HTLC after the timelock has expired
    pub fn refund(&mut self, current_time: u64) -> Result<(), JsValue> {
        self.inner
            .refund(current_time)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

/// Creates a SHA256 hash of the input data
/// Useful for generating hashlocks
#[wasm_bindgen(js_name = createHashlock)]
pub fn create_hashlock(secret: &[u8]) -> Vec<u8> {
    use sha2::{Sha256, Digest};
    Sha256::digest(secret).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_htlc_creation() {
        let secret = b"my_secret";
        let hashlock = create_hashlock(secret);
        
        let htlc = WasmHTLC::new(
            "sender_address".to_string(),
            "receiver_address".to_string(),
            1000000,
            &hashlock,
            100,
        ).unwrap();

        assert_eq!(htlc.sender(), "sender_address");
        assert_eq!(htlc.receiver(), "receiver_address");
        assert_eq!(htlc.amount(), 1000000);
        assert_eq!(htlc.timelock(), 100);
        assert!(!htlc.redeemed());
        assert!(!htlc.refunded());
    }

    #[test]
    fn test_create_hashlock() {
        let secret = b"test_secret";
        let hash = create_hashlock(secret);
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_verify_secret() {
        let secret = b"my_secret";
        let hashlock = create_hashlock(secret);
        
        let htlc = WasmHTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            &hashlock,
            100,
        ).unwrap();

        assert!(htlc.verify_secret(secret));
        assert!(!htlc.verify_secret(b"wrong_secret"));
    }

    #[test]
    fn test_redeem() {
        let secret = b"my_secret";
        let hashlock = create_hashlock(secret);
        
        let mut htlc = WasmHTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            &hashlock,
            100,
        ).unwrap();

        assert!(htlc.redeem(secret).is_ok());
        assert!(htlc.redeemed());
    }

    #[test]
    fn test_refund() {
        let secret = b"my_secret";
        let hashlock = create_hashlock(secret);
        
        let mut htlc = WasmHTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            &hashlock,
            100,
        ).unwrap();

        assert!(htlc.refund(100).is_ok());
        assert!(htlc.refunded());
    }
}
