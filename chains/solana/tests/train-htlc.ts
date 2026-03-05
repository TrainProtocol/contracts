import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";
import { expect } from "chai";

const BN = (anchor as any).default?.BN ?? (anchor as any).BN;
type Program = anchor.Program;
const AnchorError = (anchor as any).default?.AnchorError ?? anchor.AnchorError;
const {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = anchor.web3;
type PublicKey = anchor.web3.PublicKey;
const {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} = splToken;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateHashlock(): { secret: number[]; hashlock: number[] } {
  const secretBuf = randomBytes(32);
  const hashlockBuf = createHash("sha256").update(secretBuf).digest();
  return {
    secret: Array.from(secretBuf),
    hashlock: Array.from(hashlockBuf),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function indexToLeBytes(index: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return buf;
}

// ─── PDA derivation ──────────────────────────────────────────────────────────

function deriveUserLock(
  programId: PublicKey,
  hashlock: number[]
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_lock"), Buffer.from(hashlock)],
    programId
  );
}

function deriveUserVault(
  programId: PublicKey,
  hashlock: number[]
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_vault"), Buffer.from(hashlock)],
    programId
  );
}

function deriveSolverLock(
  programId: PublicKey,
  hashlock: number[],
  index: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("solver_lock"),
      Buffer.from(hashlock),
      indexToLeBytes(index),
    ],
    programId
  );
}

function deriveSolverVault(
  programId: PublicKey,
  hashlock: number[],
  index: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("solver_vault"),
      Buffer.from(hashlock),
      indexToLeBytes(index),
    ],
    programId
  );
}

function deriveSolverRewardVault(
  programId: PublicKey,
  hashlock: number[],
  index: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("solver_reward_vault"),
      Buffer.from(hashlock),
      indexToLeBytes(index),
    ],
    programId
  );
}

function deriveSolverCount(
  programId: PublicKey,
  hashlock: number[]
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver_count"), Buffer.from(hashlock)],
    programId
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_EMPTY = 0;
const STATUS_PENDING = 1;
const STATUS_REFUNDED = 2;
const STATUS_REDEEMED = 3;

// Common instruction fields for user_lock_sol / user_lock_token
function userLockBaseArgs(
  hashlock: number[],
  amount: number,
  timelockDelta: number,
  sender: PublicKey,
  recipient: PublicKey
) {
  return {
    hashlock,
    amount: new BN(amount),
    timelockDelta: new BN(timelockDelta),
    quoteExpiry: new BN(Math.floor(Date.now() / 1000) + 600),
    sender,
    recipient,
    srcChain: "solana",
    dstChain: "ethereum",
    dstAddress: "0x1234567890abcdef1234567890abcdef12345678",
    dstAmount: new BN(1000),
    dstToken: "ETH",
    rewardAmount: new BN(0),
    rewardToken: "",
    rewardRecipient: "",
    rewardTimelockDelta: new BN(0),
    userData: Buffer.from([]),
    solverData: Buffer.from([]),
  };
}

function solverLockBaseArgs(
  hashlock: number[],
  index: number,
  amount: number,
  reward: number,
  timelockDelta: number,
  rewardTimelockDelta: number,
  sender: PublicKey,
  recipient: PublicKey,
  rewardRecipient: PublicKey
) {
  return {
    hashlock,
    index: new BN(index),
    amount: new BN(amount),
    reward: new BN(reward),
    timelockDelta: new BN(timelockDelta),
    rewardTimelockDelta: new BN(rewardTimelockDelta),
    sender,
    recipient,
    rewardRecipient,
    srcChain: "ethereum",
    dstChain: "solana",
    dstAddress: "SomeAddress",
    dstAmount: new BN(1000),
    dstToken: "SOL",
    data: Buffer.from([]),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("train-htlc", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.trainHtlc as Program;
  const programId = program.programId;

  const signer = (provider.wallet as anchor.Wallet).payer;
  const recipient = Keypair.generate();
  const rewardRecipient = Keypair.generate();

  let mintA: PublicKey;
  let mintB: PublicKey;
  let signerAtaA: PublicKey;
  let signerAtaB: PublicKey;

  before(async () => {
    // Airdrop to signer
    const sig1 = await provider.connection.requestAirdrop(
      signer.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig1);

    // Airdrop to recipient (needs SOL for rent)
    const sig2 = await provider.connection.requestAirdrop(
      recipient.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig2);

    // Airdrop to rewardRecipient
    const sig3 = await provider.connection.requestAirdrop(
      rewardRecipient.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig3);

    // Create mint A (6 decimals)
    mintA = await createMint(
      provider.connection,
      signer,
      signer.publicKey,
      null,
      6
    );

    // Create mint B (6 decimals)
    mintB = await createMint(
      provider.connection,
      signer,
      signer.publicKey,
      null,
      6
    );

    // Create ATAs for signer
    signerAtaA = await createAccount(
      provider.connection,
      signer,
      mintA,
      signer.publicKey
    );
    signerAtaB = await createAccount(
      provider.connection,
      signer,
      mintB,
      signer.publicKey
    );

    // Mint tokens
    await mintTo(
      provider.connection,
      signer,
      mintA,
      signerAtaA,
      signer,
      1_000_000_000
    );
    await mintTo(
      provider.connection,
      signer,
      mintB,
      signerAtaB,
      signer,
      1_000_000_000
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // User Lock SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("User Lock SOL", () => {
    it("locks SOL successfully", async () => {
      const { secret, hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000; // 0.005 SOL

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.amount.toNumber()).to.equal(amount);
      expect(lock.status).to.equal(STATUS_PENDING);
      expect(lock.sender.toBase58()).to.equal(signer.publicKey.toBase58());
      expect(lock.recipient.toBase58()).to.equal(
        recipient.publicKey.toBase58()
      );
    });

    it("fails with zero amount", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);

      try {
        await program.methods
          .userLockSol(
            ...Object.values(
              userLockBaseArgs(
                hashlock,
                0,
                300,
                signer.publicKey,
                recipient.publicKey
              )
            ) as any
          )
          .accounts({
            signer: signer.publicKey,
            userLock: userLockPda,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("ZeroAmount");
      }
    });

    it("fails with expired quote", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);

      try {
        const args = userLockBaseArgs(
          hashlock,
          5_000_000,
          300,
          signer.publicKey,
          recipient.publicKey
        );
        args.quoteExpiry = new BN(1); // expired in 1970

        await program.methods
          .userLockSol(...(Object.values(args) as any))
          .accounts({
            signer: signer.publicKey,
            userLock: userLockPda,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("QuoteExpired");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // User Lock Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("User Lock Token", () => {
    it("locks tokens successfully", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const [vaultPda] = deriveUserVault(programId, hashlock);
      const amount = 1_000_000;

      await program.methods
        .userLockToken(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.amount.toNumber()).to.equal(amount);
      expect(lock.status).to.equal(STATUS_PENDING);
      expect(lock.tokenMint.toBase58()).to.equal(mintA.toBase58());

      const vaultAccount = await getAccount(provider.connection, vaultPda);
      expect(Number(vaultAccount.amount)).to.equal(amount);
    });

    it("fails with zero amount", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const [vaultPda] = deriveUserVault(programId, hashlock);

      try {
        await program.methods
          .userLockToken(
            ...Object.values(
              userLockBaseArgs(
                hashlock,
                0,
                300,
                signer.publicKey,
                recipient.publicKey
              )
            ) as any
          )
          .accounts({
            signer: signer.publicKey,
            userLock: userLockPda,
            tokenMint: mintA,
            senderTokenAccount: signerAtaA,
            vault: vaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("ZeroAmount");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Redeem User SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Redeem User SOL", () => {
    it("redeems with correct secret", async () => {
      const { secret, hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000;

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const recipientBalBefore = await provider.connection.getBalance(
        recipient.publicKey
      );

      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
          recipient: recipient.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.status).to.equal(STATUS_REDEEMED);
      expect(lock.secret).to.deep.equal(secret);

      const recipientBalAfter = await provider.connection.getBalance(
        recipient.publicKey
      );
      expect(recipientBalAfter - recipientBalBefore).to.equal(amount);
    });

    it("fails with wrong secret", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              5_000_000,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const wrongSecret = Array.from(randomBytes(32));

      try {
        await program.methods
          .redeemUserSol(hashlock, wrongSecret)
          .accounts({
            caller: signer.publicKey,
            userLock: userLockPda,
            recipient: recipient.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("HashlockMismatch");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Redeem User Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Redeem User Token", () => {
    it("redeems tokens with correct secret", async () => {
      const { secret, hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const [vaultPda] = deriveUserVault(programId, hashlock);
      const amount = 500_000;

      const recipientAtaA = getAssociatedTokenAddressSync(
        mintA,
        recipient.publicKey
      );

      await program.methods
        .userLockToken(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await program.methods
        .redeemUserToken(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
          recipient: recipient.publicKey,
          tokenMint: mintA,
          vault: vaultPda,
          recipientTokenAccount: recipientAtaA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.status).to.equal(STATUS_REDEEMED);

      const recipientTokenAcc = await getAccount(
        provider.connection,
        recipientAtaA
      );
      expect(Number(recipientTokenAcc.amount)).to.equal(amount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund User SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Refund User SOL", () => {
    it("refunds after timelock expires", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000;

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              1, // 1 second timelock
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await sleep(2000);

      const senderBalBefore = await provider.connection.getBalance(
        signer.publicKey
      );

      await program.methods
        .refundUserSol(hashlock)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
          sender: signer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });

    it("recipient can refund anytime", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000;

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              3600, // 1 hour timelock — NOT expired
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // recipient calls refund before timelock expires — should succeed
      await program.methods
        .refundUserSol(hashlock)
        .accounts({
          caller: recipient.publicKey,
          userLock: userLockPda,
          sender: signer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([recipient])
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });

    it("fails before timelock for non-recipient", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              5_000_000,
              3600,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // third party tries to refund — should fail
      const thirdParty = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        thirdParty.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .refundUserSol(hashlock)
          .accounts({
            caller: thirdParty.publicKey,
            userLock: userLockPda,
            sender: signer.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([thirdParty])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("TimelockNotExpired");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund User Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Refund User Token", () => {
    it("refunds tokens after timelock", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const [vaultPda] = deriveUserVault(programId, hashlock);
      const amount = 500_000;

      await program.methods
        .userLockToken(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              1, // 1 second timelock
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await sleep(2000);

      // Use init_if_needed ATA for sender
      const senderAtaA = getAssociatedTokenAddressSync(
        mintA,
        signer.publicKey
      );

      await program.methods
        .refundUserToken(hashlock)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
          sender: signer.publicKey,
          tokenMint: mintA,
          vault: vaultPda,
          senderTokenAccount: senderAtaA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Solver Lock SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Solver Lock SOL", () => {
    it("locks SOL with reward", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const amount = 5_000_000;
      const reward = 1_000_000;

      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              300,
              100,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.amount.toNumber()).to.equal(amount);
      expect(lock.reward.toNumber()).to.equal(reward);
      expect(lock.status).to.equal(STATUS_PENDING);

      const counter = await (program.account as any).solverLockCounter.fetch(
        counterPda
      );
      expect(counter.count.toNumber()).to.equal(1);
    });

    it("supports multiple locks per hashlock", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda1] = deriveSolverLock(programId, hashlock, 1);
      const [solverLockPda2] = deriveSolverLock(programId, hashlock, 2);

      // First lock
      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              5_000_000,
              0,
              300,
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda1,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Second lock
      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              2,
              3_000_000,
              0,
              300,
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda2,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const counter = await (program.account as any).solverLockCounter.fetch(
        counterPda
      );
      expect(counter.count.toNumber()).to.equal(2);
    });

    it("fails with invalid index", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      // Try index 5 without creating 1-4 first
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 5);

      try {
        await program.methods
          .solverLockSol(
            ...Object.values(
              solverLockBaseArgs(
                hashlock,
                5,
                5_000_000,
                0,
                300,
                0,
                signer.publicKey,
                recipient.publicKey,
                rewardRecipient.publicKey
              )
            ) as any
          )
          .accounts({
            signer: signer.publicKey,
            counter: counterPda,
            solverLock: solverLockPda,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("InvalidIndex");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Solver Lock Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Solver Lock Token", () => {
    it("locks tokens with same reward token", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const amount = 500_000;
      const reward = 100_000;

      await program.methods
        .solverLockToken(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              300,
              100,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.amount.toNumber()).to.equal(amount);
      expect(lock.reward.toNumber()).to.equal(reward);
      expect(lock.tokenMint.toBase58()).to.equal(mintA.toBase58());
      expect(lock.rewardTokenMint.toBase58()).to.equal(mintA.toBase58());

      const vaultAccount = await getAccount(provider.connection, vaultPda);
      expect(Number(vaultAccount.amount)).to.equal(amount + reward);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Solver Lock Token Diff Reward
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Solver Lock Token Diff Reward", () => {
    it("locks with different reward token", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const [rewardVaultPda] = deriveSolverRewardVault(
        programId,
        hashlock,
        1
      );
      const amount = 500_000;
      const reward = 200_000;

      await program.methods
        .solverLockTokenDiffReward(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              300,
              100,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          senderTokenAccount: signerAtaA,
          senderRewardTokenAccount: signerAtaB,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.tokenMint.toBase58()).to.equal(mintA.toBase58());
      expect(lock.rewardTokenMint.toBase58()).to.equal(mintB.toBase58());

      const mainVault = await getAccount(provider.connection, vaultPda);
      expect(Number(mainVault.amount)).to.equal(amount);

      const rewardVault = await getAccount(
        provider.connection,
        rewardVaultPda
      );
      expect(Number(rewardVault.amount)).to.equal(reward);
    });

    it("fails when mints are the same", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const [rewardVaultPda] = deriveSolverRewardVault(
        programId,
        hashlock,
        1
      );

      try {
        await program.methods
          .solverLockTokenDiffReward(
            ...Object.values(
              solverLockBaseArgs(
                hashlock,
                1,
                500_000,
                100_000,
                300,
                100,
                signer.publicKey,
                recipient.publicKey,
                rewardRecipient.publicKey
              )
            ) as any
          )
          .accounts({
            signer: signer.publicKey,
            counter: counterPda,
            solverLock: solverLockPda,
            tokenMint: mintA,
            rewardTokenMint: mintA, // same mint — should fail
            senderTokenAccount: signerAtaA,
            senderRewardTokenAccount: signerAtaA,
            vault: vaultPda,
            rewardVault: rewardVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        // Could be AnchorError or PDA constraint error
        expect(e.toString()).to.include("Error");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Redeem Solver SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Redeem Solver SOL", () => {
    it("redeems and routes reward to reward_recipient before reward_timelock", async () => {
      const { secret, hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const amount = 5_000_000;
      const reward = 1_000_000;

      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              3600,
              1800, // reward_timelock_delta = 1800s (30 min from now)
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const recipientBalBefore = await provider.connection.getBalance(
        recipient.publicKey
      );
      const rewardRecipientBalBefore = await provider.connection.getBalance(
        rewardRecipient.publicKey
      );

      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REDEEMED);

      const recipientBalAfter = await provider.connection.getBalance(
        recipient.publicKey
      );
      expect(recipientBalAfter - recipientBalBefore).to.equal(amount);

      const rewardRecipientBalAfter = await provider.connection.getBalance(
        rewardRecipient.publicKey
      );
      expect(rewardRecipientBalAfter - rewardRecipientBalBefore).to.equal(
        reward
      );
    });

    it("reward goes to caller after reward_timelock", async () => {
      const { secret, hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const amount = 5_000_000;
      const reward = 1_000_000;

      // Use 1s reward_timelock_delta so it expires immediately
      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              300,
              1, // reward_timelock_delta = 1s
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await sleep(2000);

      // Use a third-party caller to verify reward goes to caller, not reward_recipient
      const thirdParty = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        thirdParty.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const callerBalBefore = await provider.connection.getBalance(
        thirdParty.publicKey
      );

      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts({
          caller: thirdParty.publicKey,
          solverLock: solverLockPda,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([thirdParty])
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REDEEMED);

      // Caller should have received the reward (minus tx fee)
      const callerBalAfter = await provider.connection.getBalance(
        thirdParty.publicKey
      );
      // reward = 1_000_000, tx fee ~5000. Caller gain should be > 0
      expect(callerBalAfter - callerBalBefore + 10_000).to.be.greaterThan(
        reward - 10_000
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Redeem Solver Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Redeem Solver Token", () => {
    it("redeems tokens with reward routing", async () => {
      const { secret, hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const amount = 500_000;
      const reward = 100_000;

      const recipientAtaA = getAssociatedTokenAddressSync(
        mintA,
        recipient.publicKey
      );
      const rewardRecipientAtaA = getAssociatedTokenAddressSync(
        mintA,
        rewardRecipient.publicKey
      );
      const callerAtaA = getAssociatedTokenAddressSync(
        mintA,
        signer.publicKey
      );

      await program.methods
        .solverLockToken(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              3600,
              1800,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await program.methods
        .redeemSolverToken(hashlock, new BN(1), secret)
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          tokenMint: mintA,
          vault: vaultPda,
          recipientTokenAccount: recipientAtaA,
          rewardRecipientTokenAccount: rewardRecipientAtaA,
          callerTokenAccount: callerAtaA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REDEEMED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Redeem Solver Token Diff Reward
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Redeem Solver Token Diff Reward", () => {
    it("redeems with different reward token", async () => {
      const { secret, hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const [rewardVaultPda] = deriveSolverRewardVault(
        programId,
        hashlock,
        1
      );
      const amount = 500_000;
      const reward = 200_000;

      const recipientAtaA = getAssociatedTokenAddressSync(
        mintA,
        recipient.publicKey
      );
      const rewardRecipientAtaB = getAssociatedTokenAddressSync(
        mintB,
        rewardRecipient.publicKey
      );
      const callerAtaB = getAssociatedTokenAddressSync(
        mintB,
        signer.publicKey
      );

      // Lock
      await program.methods
        .solverLockTokenDiffReward(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              3600,
              1800,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          senderTokenAccount: signerAtaA,
          senderRewardTokenAccount: signerAtaB,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      // Redeem
      await program.methods
        .redeemSolverTokenDiffReward(hashlock, new BN(1), secret)
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          recipientTokenAccount: recipientAtaA,
          rewardRecipientTokenAccount: rewardRecipientAtaB,
          callerRewardTokenAccount: callerAtaB,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REDEEMED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund Solver SOL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Refund Solver SOL", () => {
    it("refunds amount + reward after timelock", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const amount = 5_000_000;
      const reward = 1_000_000;

      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              1, // 1 second timelock
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await sleep(2000);

      await program.methods
        .refundSolverSol(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          sender: signer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund Solver Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Refund Solver Token", () => {
    it("refunds tokens after timelock", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const amount = 500_000;
      const reward = 100_000;

      const senderAtaA = getAssociatedTokenAddressSync(
        mintA,
        signer.publicKey
      );

      await program.methods
        .solverLockToken(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              1, // 1s timelock
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          senderTokenAccount: signerAtaA,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await sleep(2000);

      await program.methods
        .refundSolverToken(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          sender: signer.publicKey,
          tokenMint: mintA,
          vault: vaultPda,
          senderTokenAccount: senderAtaA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund Solver Token Diff Reward
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Refund Solver Token Diff Reward", () => {
    it("refunds both token vaults", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const [vaultPda] = deriveSolverVault(programId, hashlock, 1);
      const [rewardVaultPda] = deriveSolverRewardVault(
        programId,
        hashlock,
        1
      );
      const amount = 500_000;
      const reward = 200_000;

      const senderAtaA = getAssociatedTokenAddressSync(
        mintA,
        signer.publicKey
      );
      const senderAtaB = getAssociatedTokenAddressSync(
        mintB,
        signer.publicKey
      );

      await program.methods
        .solverLockTokenDiffReward(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              1, // 1s timelock
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          senderTokenAccount: signerAtaA,
          senderRewardTokenAccount: signerAtaB,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await sleep(2000);

      await program.methods
        .refundSolverTokenDiffReward(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          sender: signer.publicKey,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          vault: vaultPda,
          rewardVault: rewardVaultPda,
          senderTokenAccount: senderAtaA,
          senderRewardTokenAccount: senderAtaB,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        solverLockPda
      );
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Close
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Close", () => {
    it("closes redeemed user lock", async () => {
      const { secret, hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000;

      // Lock
      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Redeem
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
          recipient: recipient.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Close
      await program.methods
        .closeUserLock(hashlock)
        .accounts({
          caller: signer.publicKey,
          userLock: userLockPda,
        } as any)
        .rpc();

      // Account should no longer exist
      const info = await provider.connection.getAccountInfo(userLockPda);
      expect(info).to.be.null;
    });

    it("closes refunded solver lock", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);

      // Lock with 1s timelock
      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              5_000_000,
              0,
              1,
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await sleep(2000);

      // Refund
      await program.methods
        .refundSolverSol(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
          sender: signer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Close
      await program.methods
        .closeSolverLock(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: solverLockPda,
        } as any)
        .rpc();

      const info = await provider.connection.getAccountInfo(solverLockPda);
      expect(info).to.be.null;
    });

    it("fails to close pending lock", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              5_000_000,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      try {
        await program.methods
          .closeUserLock(hashlock)
          .accounts({
            caller: signer.publicKey,
            userLock: userLockPda,
          } as any)
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e).to.be.instanceOf(AnchorError);
        expect(e.error.errorCode.code).to.equal("StillPending");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // View
  // ═══════════════════════════════════════════════════════════════════════════

  describe("View", () => {
    it("get_user_lock returns correct data", async () => {
      const { hashlock } = generateHashlock();
      const [userLockPda] = deriveUserLock(programId, hashlock);
      const amount = 5_000_000;

      await program.methods
        .userLockSol(
          ...Object.values(
            userLockBaseArgs(
              hashlock,
              amount,
              300,
              signer.publicKey,
              recipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          userLock: userLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // View functions return data via simulate
      const result = await program.methods
        .getUserLock(hashlock)
        .accounts({
          userLock: userLockPda,
        } as any)
        .view();

      expect(result.amount.toNumber()).to.equal(amount);
      expect(result.status).to.equal(STATUS_PENDING);
      expect(result.sender.toBase58()).to.equal(signer.publicKey.toBase58());
    });

    it("get_solver_lock returns correct data", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda] = deriveSolverLock(programId, hashlock, 1);
      const amount = 5_000_000;
      const reward = 1_000_000;

      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              amount,
              reward,
              300,
              100,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const result = await program.methods
        .getSolverLock(hashlock, new BN(1))
        .accounts({
          solverLock: solverLockPda,
        } as any)
        .view();

      expect(result.amount.toNumber()).to.equal(amount);
      expect(result.reward.toNumber()).to.equal(reward);
      expect(result.status).to.equal(STATUS_PENDING);
    });

    it("get_solver_lock_count returns count", async () => {
      const { hashlock } = generateHashlock();
      const [counterPda] = deriveSolverCount(programId, hashlock);
      const [solverLockPda1] = deriveSolverLock(programId, hashlock, 1);
      const [solverLockPda2] = deriveSolverLock(programId, hashlock, 2);

      // Create 2 solver locks
      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              1,
              5_000_000,
              0,
              300,
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda1,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .solverLockSol(
          ...Object.values(
            solverLockBaseArgs(
              hashlock,
              2,
              3_000_000,
              0,
              300,
              0,
              signer.publicKey,
              recipient.publicKey,
              rewardRecipient.publicKey
            )
          ) as any
        )
        .accounts({
          signer: signer.publicKey,
          counter: counterPda,
          solverLock: solverLockPda2,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const result = await program.methods
        .getSolverLockCount(hashlock)
        .accounts({
          counter: counterPda,
        } as any)
        .view();

      expect(result.toNumber()).to.equal(2);
    });
  });
});
