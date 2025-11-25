use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HTLC {
    /// The sender's address
    pub sender: String,
    /// The receiver's address
    pub receiver: String,
    /// The amount locked in the HTLC (in zatoshis)
    pub amount: u64,
    /// The hash of the secret (preimage)
    pub hashlock: [u8; 32],
    /// The timelock (block height or timestamp)
    pub timelock: u64,
    /// Whether the HTLC has been redeemed
    pub redeemed: bool,
    /// Whether the HTLC has been refunded
    pub refunded: bool,
}

impl HTLC {
    /// Creates a new HTLC
    pub fn new(
        sender: String,
        receiver: String,
        amount: u64,
        hashlock: [u8; 32],
        timelock: u64,
    ) -> Self {
        Self {
            sender,
            receiver,
            amount,
            hashlock,
            timelock,
            redeemed: false,
            refunded: false,
        }
    }

    /// Checks if the HTLC can be redeemed with the given secret
    pub fn verify_secret(&self, secret: &[u8]) -> bool {
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(secret);
        hash.as_slice() == self.hashlock
    }

    /// Checks if the timelock has expired
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.timelock
    }

    /// Attempts to redeem the HTLC with the given secret
    pub fn redeem(&mut self, secret: &[u8]) -> Result<(), HTLCError> {
        if self.redeemed {
            return Err(HTLCError::AlreadyRedeemed);
        }
        if self.refunded {
            return Err(HTLCError::AlreadyRefunded);
        }
        if !self.verify_secret(secret) {
            return Err(HTLCError::InvalidSecret);
        }
        self.redeemed = true;
        Ok(())
    }

    /// Attempts to refund the HTLC
    pub fn refund(&mut self, current_time: u64) -> Result<(), HTLCError> {
        if self.redeemed {
            return Err(HTLCError::AlreadyRedeemed);
        }
        if self.refunded {
            return Err(HTLCError::AlreadyRefunded);
        }
        if !self.is_expired(current_time) {
            return Err(HTLCError::TimelockNotExpired);
        }
        self.refunded = true;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HTLCError {
    AlreadyRedeemed,
    AlreadyRefunded,
    InvalidSecret,
    TimelockNotExpired,
}

impl fmt::Display for HTLCError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HTLCError::AlreadyRedeemed => write!(f, "HTLC already redeemed"),
            HTLCError::AlreadyRefunded => write!(f, "HTLC already refunded"),
            HTLCError::InvalidSecret => write!(f, "Invalid secret provided"),
            HTLCError::TimelockNotExpired => write!(f, "Timelock has not expired yet"),
        }
    }
}

impl std::error::Error for HTLCError {}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Sha256, Digest};

    #[test]
    fn test_htlc_creation() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let htlc = HTLC::new(
            "sender_address".to_string(),
            "receiver_address".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert_eq!(htlc.sender, "sender_address");
        assert_eq!(htlc.receiver, "receiver_address");
        assert_eq!(htlc.amount, 1000000);
        assert!(!htlc.redeemed);
        assert!(!htlc.refunded);
    }

    #[test]
    fn test_verify_secret() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert!(htlc.verify_secret(secret));
        assert!(!htlc.verify_secret(b"wrong_secret"));
    }

    #[test]
    fn test_redeem_success() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert!(htlc.redeem(secret).is_ok());
        assert!(htlc.redeemed);
    }

    #[test]
    fn test_redeem_invalid_secret() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert_eq!(htlc.redeem(b"wrong_secret"), Err(HTLCError::InvalidSecret));
        assert!(!htlc.redeemed);
    }

    #[test]
    fn test_redeem_already_redeemed() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        htlc.redeem(secret).unwrap();
        assert_eq!(htlc.redeem(secret), Err(HTLCError::AlreadyRedeemed));
    }

    #[test]
    fn test_refund_success() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert!(htlc.refund(100).is_ok());
        assert!(htlc.refunded);
    }

    #[test]
    fn test_refund_timelock_not_expired() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        assert_eq!(htlc.refund(99), Err(HTLCError::TimelockNotExpired));
        assert!(!htlc.refunded);
    }

    #[test]
    fn test_refund_already_refunded() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        htlc.refund(100).unwrap();
        assert_eq!(htlc.refund(100), Err(HTLCError::AlreadyRefunded));
    }

    #[test]
    fn test_cannot_redeem_after_refund() {
        let secret = b"my_secret";
        let hashlock = Sha256::digest(secret).into();
        
        let mut htlc = HTLC::new(
            "sender".to_string(),
            "receiver".to_string(),
            1000000,
            hashlock,
            100,
        );

        htlc.refund(100).unwrap();
        assert_eq!(htlc.redeem(secret), Err(HTLCError::AlreadyRefunded));
    }
}
