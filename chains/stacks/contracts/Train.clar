;; title: HashedTimeLockStacks
;; version:
;; summary:
;; description:
;;   _____ ____      _    ___ _   _      ____  ____   ___ _____ ___   ____ ___  _
;;  |_   _|  _ \    / \  |_ _| \ | |    |  _ \|  _ \ / _ \_   _/ _ \ / ___/ _ \| |
;;    | | | |_) |  / _ \  | ||  \| |    | |_) | |_) | | | || || | | | |  | | | | |
;;    | | |  _ <  / ___ \ | || |\  |    |  __/|  _ <| |_| || || |_| | |__| |_| | |___
;;    |_| |_| \_\/_/   \_\___|_| \_|    |_|   |_| \_\\___/ |_| \___/ \____\___/|_____|
;; traits
;;

;; token definitions
;;

;; constants
;;
(define-constant err-funds-not-sent (err u1000))
(define-constant err-not-future-timelock (err u1001))
(define-constant err-not-passed-timelock (err u1002))
(define-constant err-lock-already-exists (err u1003))
(define-constant err-htlc-already-exists (err u1004))
(define-constant err-htlc-not-exists (err u1005))
(define-constant err-hashlock-not-match (err u1006))
(define-constant err-already-redeemed (err u1007))
(define-constant err-already-refunded (err u1008))
(define-constant err-already-locked (err u1009))
(define-constant err-no-allowance (err u1010))
(define-constant err-invalid-signature (err u1011))
(define-constant err-hashlock-already-set (err u1012))
(define-constant err-tx-failed (err u1013))
(define-constant err-in-stacks-or-clarity (err u1014))


;; (define-constant contract-owner tx-sender)

;; data vars
;;
(define-data-var contract-nonce uint u0)
(define-data-var initial-seed uint u0)
(define-data-var seed uint u0)
(var-set seed (+ stx-liquid-supply (+ chain-id (+ (var-get initial-seed) (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) err-in-stacks-or-clarity)))))

;; data maps
;;
(define-map contracts
  {id: uint}   
  {
    dstAddress: (string-ascii 256),
    dstChain: (string-ascii 256),
    dstAsset: (string-ascii 256),
    srcAsset: (string-ascii 256),
    sender: principal,
    srcReceiver: principal,
    hashlock: (buff 32),
    timelock: uint,
    amount: uint,
    secret: (buff 32),
    redeemed: bool,
    refunded: bool
  }
)

(define-public (commit
    (hop-chains (list 5 (string-ascii 256)))
    (hop-assets (list 5 (string-ascii 256)))
    (hop-addresses (list 5 (string-ascii 256)))
    (dst-chain (string-ascii 256))
    (dst-asset (string-ascii 256))
    (dst-address (string-ascii 256))
    (src-asset (string-ascii 256))
    (src-receiver principal)
    (timelock uint)
    (msg-value uint)
)
  (let (
    (id (bit-xor (var-get seed) (var-get contract-nonce)))
  )
    (asserts! (> msg-value u0) err-funds-not-sent)
    (asserts! (> timelock (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) err-in-stacks-or-clarity)) err-not-future-timelock)
  
    (asserts! 
      (map-insert contracts {id: id}
        {
          dstAddress: dst-address,
          dstChain: dst-chain,
          dstAsset: dst-asset,
          srcAsset: src-asset,
          sender: tx-sender,
          srcReceiver: src-receiver,
          hashlock: 0x0000000000000000000000000000000000000000000000000000000000000000,
          timelock: timelock,
          amount: msg-value,
          secret: 0x0000000000000000000000000000000000000000000000000000000000000000,
          redeemed: false,
          refunded: false
        })
      err-htlc-already-exists
    )
    (var-set contract-nonce (+ (var-get contract-nonce) u1))
    (try! (stx-transfer? msg-value tx-sender (as-contract tx-sender)))
    (print {  hop-chains: hop-chains,
              hop-assets: hop-assets,
              hop-addresses: hop-addresses,
              id: id,
              dstChain: dst-chain,
              dstAddress: dst-address,
              dstAsset: dst-asset,
              sender: tx-sender,
              srcReceiver: src-receiver,
              srcAsset: src-asset,
              amount: msg-value,
              timelock: timelock})
    (ok id)
  )
)


(define-public (refund (id uint)) 
  (let
    (
      (htlc (unwrap! (map-get? contracts {id: id}) err-htlc-not-exists))
    )
    (asserts! (is-eq false (get refunded htlc)) err-already-refunded)
    (asserts! (is-eq false (get redeemed htlc)) err-already-redeemed)
    (asserts! (<= (get timelock htlc) (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) err-in-stacks-or-clarity) ) err-not-passed-timelock)

    (try! (as-contract (stx-transfer? (get amount htlc) tx-sender (get sender htlc))))

    (asserts! (map-set contracts {id: id}
      {
        dstAddress: (get dstAddress htlc),
        dstChain: (get dstChain htlc),
        dstAsset: (get dstAsset htlc),
        srcAsset: (get srcAsset htlc),
        sender: (get sender htlc),
        srcReceiver: (get srcReceiver htlc),
        hashlock: (get hashlock htlc),
        timelock: (get timelock htlc),
        amount: (get amount htlc),
        secret: (get secret htlc),
        redeemed: (get redeemed htlc),
        refunded: true  
      }) err-in-stacks-or-clarity)
    (print id)
    (ok true)
  )
)

(define-public (lock
    (id uint)
    (hashlock (buff 32))
    (timelock uint)
    (src-receiver principal)
    (src-asset (string-ascii 256))
    (dst-chain (string-ascii 256))
    (dst-address (string-ascii 256))
    (dst-asset (string-ascii 256))
    (msg-value uint)
  )
  (let (
    (existing-htlc (map-get? contracts {id: id}))
  )
    (asserts! (> msg-value u0) err-funds-not-sent)
    (asserts! (> timelock (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) err-in-stacks-or-clarity)) err-not-future-timelock)

    (asserts! 
      (map-insert contracts {id: id}
        {
          dstAddress: dst-address,
          dstChain: dst-chain,
          dstAsset: dst-asset,
          srcAsset: src-asset,
          sender: tx-sender,
          srcReceiver: src-receiver,
          hashlock: hashlock,
          timelock: timelock,
          amount: msg-value,
          secret: 0x0000000000000000000000000000000000000000000000000000000000000000, 
          redeemed: false,
          refunded: false
        })
      err-htlc-already-exists
    )
    (try! (stx-transfer? msg-value tx-sender (as-contract tx-sender)))
    (print {id: id,
            hashlock: hashlock,
            dstChain: dst-chain,
            dstAddress: dst-address,
            dstAsset: dst-asset,
            sender: tx-sender,
            srcReceiver: src-receiver,
            srcAsset: src-asset,
            amount: msg-value,
            timelock: timelock})
    (ok id)
  )
)

(define-public (redeem (id uint) (secret (buff 32)))
  (let (
    (htlc (unwrap! (map-get? contracts {id: id}) err-htlc-not-exists))
    (hash (sha256 secret))
  )

  (asserts! (is-eq false (get redeemed htlc)) err-already-redeemed)
  (asserts! (is-eq false (get refunded htlc)) err-already-refunded)
  (asserts! (is-eq hash (get hashlock htlc)) err-hashlock-not-match)

  (asserts! (map-set contracts {id: id}
      {
        dstAddress: (get dstAddress htlc),
        dstChain: (get dstChain htlc),
        dstAsset: (get dstAsset htlc),
        srcAsset: (get srcAsset htlc),
        sender: (get sender htlc),
        srcReceiver: (get srcReceiver htlc),
        hashlock: (get hashlock htlc),
        timelock: (get timelock htlc),
        amount: (get amount htlc),
        secret: secret,
        redeemed: true,
        refunded: (get refunded htlc)  
      }) err-in-stacks-or-clarity)
    (try! (as-contract (stx-transfer? (get amount htlc) tx-sender (get srcReceiver htlc))))
    (print {id: id,redeemAddress: tx-sender,secret: secret, hashlock: (get hashlock htlc)})
    (ok true)
  )
)

(define-public (add-lock (id uint) (hashlock (buff 32)) (timelock uint)) 
  (let (
    (htlc (unwrap! (map-get? contracts {id: id}) err-htlc-not-exists))
  )
  (asserts! (is-eq tx-sender (get sender htlc)) err-no-allowance)
  (apply-lock id hashlock timelock))
)

(define-public (add-lock-sig (id uint) (hashlock (buff 32)) (timelock uint) (signature (buff 65)))
  (let
    (
      (htlc (unwrap! (map-get? contracts {id: id}) err-htlc-not-exists))
      (message (concat (unwrap! (to-consensus-buff? id) err-in-stacks-or-clarity)
                       (concat hashlock
                               (unwrap! (to-consensus-buff? timelock) err-in-stacks-or-clarity))))
      (message-hash (sha256 message))
      (user-pub-key (unwrap! (secp256k1-recover? message-hash signature) err-in-stacks-or-clarity))
      (signer-addr (unwrap! (principal-of? user-pub-key) err-in-stacks-or-clarity))
    )
    (asserts! (is-eq signer-addr (get sender htlc)) err-invalid-signature)
    (apply-lock id hashlock timelock)
  )
)

(define-private (apply-lock (id uint) (hashlock (buff 32)) (timelock uint)) 
  (let (
    (htlc (unwrap! (map-get? contracts {id: id}) err-htlc-not-exists))
  )
  (asserts! (is-eq false (get refunded htlc)) err-already-refunded)
  (asserts! (< (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) err-in-stacks-or-clarity) timelock) err-not-future-timelock)
  (asserts! (is-eq 0x0000000000000000000000000000000000000000000000000000000000000000 (get hashlock htlc)) err-hashlock-already-set)

  (asserts! (map-set contracts {id: id}
      {
        dstAddress: (get dstAddress htlc),
        dstChain: (get dstChain htlc),
        dstAsset: (get dstAsset htlc),
        srcAsset: (get srcAsset htlc),
        sender: (get sender htlc),
        srcReceiver: (get srcReceiver htlc),
        hashlock: hashlock,
        timelock: timelock,
        amount: (get amount htlc),
        secret: (get secret htlc),
        redeemed: (get redeemed htlc),
        refunded: (get refunded htlc)  
      }) err-in-stacks-or-clarity)
      (print {id: id,
              hashlock: hashlock,
              dstChain:  (get dstChain htlc),
              dstAddress: (get dstAddress htlc),
              dstAsset: (get dstAsset htlc),
              sender: (get sender htlc),
              srcReceiver: (get srcReceiver htlc),
              srcAsset: (get srcAsset htlc),
              amount: (get amount htlc),
              timelock: timelock})
    (ok id)
  )
)

;; read-only functions
;;
(define-read-only (get-contract-details (id uint))
    (map-get? contracts {id: id}) 
)

;; private functions
;;
(define-private (has-HTLC (id uint)) 
  (map-get? contracts {id: id})
)
