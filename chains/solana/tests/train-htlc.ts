import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { createHash } from "crypto";
import {
  BN,
  Program,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  STATUS_PENDING,
  STATUS_REFUNDED,
  STATUS_REDEEMED,
  generateHashlock,
  sleep,
  deriveUserLock,
  deriveUserVault,
  deriveSolverLock,
  deriveSolverVault,
  deriveSolverRewardVault,
  deriveSolverCount,
  userLockParams,
  solverLockParams,
  expectError,
  splToken,
} from "./shared";

const { SYSVAR_RENT_PUBKEY } = anchor.web3;
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} = splToken;

describe("train-htlc core", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.trainHtlc as Program;
  const programId = program.programId;
  const constantCurveId = (anchor.workspace.constantPayoutCurve as Program)
    .programId;
  const mockCurveId = (anchor.workspace.mockDecayCurve as Program).programId;

  const signer = (provider.wallet as anchor.Wallet).payer;
  const recipient = Keypair.generate();
  const rewardRecipient = Keypair.generate();
  const refundTo = Keypair.generate();
  const relayer = Keypair.generate();
  const thirdParty = Keypair.generate();

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let signerAtaA: anchor.web3.PublicKey;
  let signerAtaB: anchor.web3.PublicKey;

  const ata = (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner);

  before(async () => {
    for (const [kp, amount] of [
      [signer.publicKey, 100],
      [recipient.publicKey, 5],
      [rewardRecipient.publicKey, 5],
      [refundTo.publicKey, 5],
      [relayer.publicKey, 5],
      [thirdParty.publicKey, 5],
    ] as const) {
      const sig = await provider.connection.requestAirdrop(
        kp,
        amount * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    mintA = await createMint(provider.connection, signer, signer.publicKey, null, 6);
    mintB = await createMint(provider.connection, signer, signer.publicKey, null, 6);
    signerAtaA = await createAccount(provider.connection, signer, mintA, signer.publicKey);
    signerAtaB = await createAccount(provider.connection, signer, mintB, signer.publicKey);
    await mintTo(provider.connection, signer, mintA, signerAtaA, signer, 1_000_000_000);
    await mintTo(provider.connection, signer, mintB, signerAtaB, signer, 1_000_000_000);
  });

  // Account builders (defaults: signer pays for itself, no curve)
  const userLockSolAccounts = (hashlock: number[]) => ({
    payer: signer.publicKey,
    sender: signer.publicKey,
    userLock: deriveUserLock(programId, hashlock)[0],
    payoutCurveProgram: null,
    systemProgram: SystemProgram.programId,
  });

  const userLockTokenAccounts = (hashlock: number[]) => ({
    payer: signer.publicKey,
    sender: signer.publicKey,
    userLock: deriveUserLock(programId, hashlock)[0],
    tokenMint: mintA,
    senderTokenAccount: signerAtaA,
    vault: deriveUserVault(programId, hashlock)[0],
    payoutCurveProgram: null,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const redeemUserSolAccounts = (hashlock: number[], caller = signer.publicKey) => ({
    caller,
    userLock: deriveUserLock(programId, hashlock)[0],
    rentPayer: signer.publicKey,
    recipient: recipient.publicKey,
    refundTo: refundTo.publicKey,
    payoutCurveProgram: null,
    systemProgram: SystemProgram.programId,
  });

  const redeemUserTokenAccounts = (hashlock: number[]) => ({
    caller: signer.publicKey,
    userLock: deriveUserLock(programId, hashlock)[0],
    rentPayer: signer.publicKey,
    recipient: recipient.publicKey,
    refundTo: refundTo.publicKey,
    tokenMint: mintA,
    vault: deriveUserVault(programId, hashlock)[0],
    recipientTokenAccount: ata(mintA, recipient.publicKey),
    refundToTokenAccount: null,
    payoutCurveProgram: null,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const refundUserSolAccounts = (hashlock: number[], caller = signer.publicKey) => ({
    caller,
    userLock: deriveUserLock(programId, hashlock)[0],
    rentPayer: signer.publicKey,
    refundTo: refundTo.publicKey,
    systemProgram: SystemProgram.programId,
  });

  const solverLockSolAccounts = (hashlock: number[], index: number) => ({
    payer: signer.publicKey,
    sender: signer.publicKey,
    counter: deriveSolverCount(programId, hashlock)[0],
    solverLock: deriveSolverLock(programId, hashlock, index)[0],
    payoutCurveProgram: null,
    systemProgram: SystemProgram.programId,
  });

  const solverLockTokenAccounts = (hashlock: number[], index: number) => ({
    payer: signer.publicKey,
    sender: signer.publicKey,
    counter: deriveSolverCount(programId, hashlock)[0],
    solverLock: deriveSolverLock(programId, hashlock, index)[0],
    tokenMint: mintA,
    senderTokenAccount: signerAtaA,
    vault: deriveSolverVault(programId, hashlock, index)[0],
    payoutCurveProgram: null,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  });

  const redeemSolverSolAccounts = (
    hashlock: number[],
    index: number,
    caller = signer.publicKey
  ) => ({
    caller,
    solverLock: deriveSolverLock(programId, hashlock, index)[0],
    recipient: recipient.publicKey,
    rewardRecipient: rewardRecipient.publicKey,
    refundTo: refundTo.publicKey,
    payoutCurveProgram: null,
    systemProgram: SystemProgram.programId,
  });

  const refundSolverSolAccounts = (hashlock: number[], index: number) => ({
    caller: signer.publicKey,
    solverLock: deriveSolverLock(programId, hashlock, index)[0],
    refundTo: refundTo.publicKey,
    systemProgram: SystemProgram.programId,
  });

  const lamports = (pk: anchor.web3.PublicKey) =>
    provider.connection.getBalance(pk);

  // ═══════════════════════════════ User Lock SOL ═══════════════════════════════

  describe("User Lock SOL", () => {
    it("locks SOL and records full parity fields", async () => {
      const { hashlock } = generateHashlock();
      const amount = 5_000_000;
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([1, 2]),
          Buffer.from([3])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.amount.toNumber()).to.equal(amount);
      expect(lock.status).to.equal(STATUS_PENDING);
      expect(lock.sender.toBase58()).to.equal(signer.publicKey.toBase58());
      expect(lock.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
      expect(lock.refundTo.toBase58()).to.equal(refundTo.publicKey.toBase58());
      expect(lock.rentPayer.toBase58()).to.equal(signer.publicKey.toBase58());
      expect(lock.payoutCurve.toBase58()).to.equal(PublicKey.default.toBase58());
      expect(lock.startTime.toNumber()).to.be.greaterThan(0);
      expect(lock.timelock.toNumber()).to.equal(
        lock.startTime.toNumber() + 3600
      );
    });

    it("fails with zero amount", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .userLockSol(
            userLockParams({
              hashlock,
              amount: 0,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts(userLockSolAccounts(hashlock) as any)
          .rpc(),
        "ZeroAmount"
      );
    });

    it("fails with expired quote", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .userLockSol(
            userLockParams({
              hashlock,
              amount: 1_000_000,
              quoteExpiry: Math.floor(Date.now() / 1000) - 10,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts(userLockSolAccounts(hashlock) as any)
          .rpc(),
        "QuoteExpired"
      );
    });

    it("fails with default refund_to (ZeroAddress)", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .userLockSol(
            userLockParams({
              hashlock,
              amount: 1_000_000,
              recipient: recipient.publicKey,
              refundTo: PublicKey.default,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts(userLockSolAccounts(hashlock) as any)
          .rpc(),
        "ZeroAddress"
      );
    });

    it("rejects a duplicate pending hashlock (PDA already in use)", async () => {
      const { hashlock } = generateHashlock();
      const params = userLockParams({
        hashlock,
        amount: 1_000_000,
        recipient: recipient.publicKey,
        refundTo: refundTo.publicKey,
      });
      await program.methods
        .userLockSol(params, Buffer.from([]), Buffer.from([]))
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      await expectError(
        program.methods
          .userLockSol(params, Buffer.from([]), Buffer.from([]))
          .accounts(userLockSolAccounts(hashlock) as any)
          .rpc(),
        "already in use"
      );
    });
  });

  // ══════════ Variant confusion: SOL settlement must reject token locks ═════════
  // Regression test for the audit CRITICAL: a token lock shares the
  // ["user_lock"/"solver_lock", ...] PDA with a SOL lock, so the native-SOL
  // settlement handlers must refuse to operate on a token lock (which would treat
  // token base-units as lamports and strand the vault).

  describe("SOL settlement rejects token locks (variant confusion)", () => {
    it("redeem_user_sol rejects a token user lock", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount: 100_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockTokenAccounts(hashlock) as any)
        .rpc();

      await expectError(
        program.methods
          .redeemUserSol(hashlock, secret)
          .accounts(redeemUserSolAccounts(hashlock) as any)
          .rpc(),
        "WrongToken"
      );
    });

    it("refund_user_sol rejects a token user lock (even after timelock)", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount: 100_000,
            timelockDelta: 2,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockTokenAccounts(hashlock) as any)
        .rpc();
      await sleep(3500);
      await expectError(
        program.methods
          .refundUserSol(hashlock)
          .accounts(refundUserSolAccounts(hashlock, thirdParty.publicKey) as any)
          .signers([thirdParty])
          .rpc(),
        "WrongToken"
      );
    });

    it("redeem_solver_sol and refund_solver_sol reject a token solver lock", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockToken(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 100_000,
            timelockDelta: 2,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockTokenAccounts(hashlock, 1) as any)
        .rpc();

      await expectError(
        program.methods
          .redeemSolverSol(hashlock, new BN(1), secret)
          .accounts(redeemSolverSolAccounts(hashlock, 1) as any)
          .rpc(),
        "WrongToken"
      );
      await sleep(3500);
      await expectError(
        program.methods
          .refundSolverSol(hashlock, new BN(1))
          .accounts(refundSolverSolAccounts(hashlock, 1) as any)
          .rpc(),
        "WrongToken"
      );
    });
  });

  // ═══════════════════════════════ User Lock Token ═════════════════════════════

  describe("User Lock Token", () => {
    it("locks tokens into the vault", async () => {
      const { hashlock } = generateHashlock();
      const amount = 250_000;
      const [vaultPda] = deriveUserVault(programId, hashlock);

      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockTokenAccounts(hashlock) as any)
        .rpc();

      const vault = await getAccount(provider.connection, vaultPda);
      expect(Number(vault.amount)).to.equal(amount);
      const lock = await (program.account as any).userLock.fetch(
        deriveUserLock(programId, hashlock)[0]
      );
      expect(lock.tokenMint.toBase58()).to.equal(mintA.toBase58());
      expect(lock.amount.toNumber()).to.equal(amount);
    });

    it("fails with zero amount", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .userLockToken(
            userLockParams({
              hashlock,
              amount: 0,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts(userLockTokenAccounts(hashlock) as any)
          .rpc(),
        "ZeroAmount"
      );
    });
  });

  // ═══════════════════════════════ Redeem User ═════════════════════════════════

  describe("Redeem User SOL", () => {
    it("pays recipient, closes lock, returns rent to rent_payer", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 5_000_000;
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();

      const recipientBefore = await lamports(recipient.publicKey);
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts(redeemUserSolAccounts(hashlock) as any)
        .rpc();

      const recipientAfter = await lamports(recipient.publicKey);
      expect(recipientAfter - recipientBefore).to.equal(amount);
      const closed = await provider.connection.getAccountInfo(userLockPda);
      expect(closed).to.be.null;
    });

    it("fails with wrong secret", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();

      const wrongSecret = Array.from(Buffer.alloc(32, 7));
      await expectError(
        program.methods
          .redeemUserSol(hashlock, wrongSecret)
          .accounts(redeemUserSolAccounts(hashlock) as any)
          .rpc(),
        "HashlockMismatch"
      );
    });

    it("matches the EVM secret->hashlock vector (sha256 of 32 BE bytes)", async () => {
      // secret = uint256(1); EVM: sha256(abi.encodePacked(secret))
      const secretBuf = Buffer.alloc(32);
      secretBuf[31] = 1;
      const expectedHashlock =
        "ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5";
      const hashlockBuf = createHash("sha256").update(secretBuf).digest();
      expect(hashlockBuf.toString("hex")).to.equal(expectedHashlock);

      const hashlock = Array.from(hashlockBuf);
      const secret = Array.from(secretBuf);
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts(redeemUserSolAccounts(hashlock) as any)
        .rpc();
    });
  });

  describe("Redeem User Token", () => {
    it("pays recipient ATA, closes vault and lock", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 111_000;
      const [vaultPda] = deriveUserVault(programId, hashlock);

      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockTokenAccounts(hashlock) as any)
        .rpc();

      await program.methods
        .redeemUserToken(hashlock, secret)
        .accounts(redeemUserTokenAccounts(hashlock) as any)
        .rpc();

      const recipientAta = await getAccount(
        provider.connection,
        ata(mintA, recipient.publicKey)
      );
      expect(Number(recipientAta.amount)).to.be.gte(amount);
      expect(await provider.connection.getAccountInfo(vaultPda)).to.be.null;
      expect(
        await provider.connection.getAccountInfo(
          deriveUserLock(programId, hashlock)[0]
        )
      ).to.be.null;
    });
  });

  // ═══════════════════════════════ Refund User ═════════════════════════════════

  describe("Refund User SOL", () => {
    it("refunds to refund_to (not caller, not sender) after timelock", async () => {
      const { hashlock } = generateHashlock();
      const amount = 3_000_000;
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            timelockDelta: 2,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      await sleep(3500);

      const refundToBefore = await lamports(refundTo.publicKey);
      const thirdBefore = await lamports(thirdParty.publicKey);
      await program.methods
        .refundUserSol(hashlock)
        .accounts(refundUserSolAccounts(hashlock, thirdParty.publicKey) as any)
        .signers([thirdParty])
        .rpc();

      expect((await lamports(refundTo.publicKey)) - refundToBefore).to.equal(
        amount
      );
      // third party paid the fee, received nothing
      expect(await lamports(thirdParty.publicKey)).to.be.lte(thirdBefore);
    });

    it("allows the recipient to refund early (funds still to refund_to)", async () => {
      const { hashlock } = generateHashlock();
      const amount = 3_000_000;
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            timelockDelta: 3600,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();

      const refundToBefore = await lamports(refundTo.publicKey);
      await program.methods
        .refundUserSol(hashlock)
        .accounts(refundUserSolAccounts(hashlock, recipient.publicKey) as any)
        .signers([recipient])
        .rpc();
      expect((await lamports(refundTo.publicKey)) - refundToBefore).to.equal(
        amount
      );
    });

    it("rejects non-recipient refund before timelock", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            timelockDelta: 3600,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      await expectError(
        program.methods
          .refundUserSol(hashlock)
          .accounts(refundUserSolAccounts(hashlock, thirdParty.publicKey) as any)
          .signers([thirdParty])
          .rpc(),
        "TimelockNotExpired"
      );
    });
  });

  describe("Refund User Token", () => {
    it("refunds tokens to refund_to ATA after timelock", async () => {
      const { hashlock } = generateHashlock();
      const amount = 44_000;
      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount,
            timelockDelta: 2,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockTokenAccounts(hashlock) as any)
        .rpc();
      await sleep(3500);

      await program.methods
        .refundUserToken(hashlock)
        .accounts({
          caller: signer.publicKey,
          userLock: deriveUserLock(programId, hashlock)[0],
          rentPayer: signer.publicKey,
          refundTo: refundTo.publicKey,
          tokenMint: mintA,
          vault: deriveUserVault(programId, hashlock)[0],
          refundToTokenAccount: ata(mintA, refundTo.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const refundAta = await getAccount(
        provider.connection,
        ata(mintA, refundTo.publicKey)
      );
      expect(Number(refundAta.amount)).to.be.gte(amount);
    });
  });

  // ═══════════════════ Sponsored (payer != sender) rail A basis ════════════════

  describe("Sponsored lock (payer/sender split)", () => {
    it("relayer pays rent, sender funds; rent returns to relayer on redeem", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 2_000_000;
      const [userLockPda] = deriveUserLock(programId, hashlock);

      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payer: relayer.publicKey,
        } as any)
        .signers([relayer])
        .rpc();

      const lock = await (program.account as any).userLock.fetch(userLockPda);
      expect(lock.sender.toBase58()).to.equal(signer.publicKey.toBase58());
      expect(lock.rentPayer.toBase58()).to.equal(relayer.publicKey.toBase58());

      const relayerBefore = await lamports(relayer.publicKey);
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          ...redeemUserSolAccounts(hashlock),
          rentPayer: relayer.publicKey,
        } as any)
        .rpc();
      // lock account rent returned to the relayer
      expect(await lamports(relayer.publicKey)).to.be.greaterThan(relayerBefore);
    });
  });

  // ═══════════════════════════════ Solver Lock ═════════════════════════════════

  describe("Solver Lock SOL", () => {
    it("locks amount+reward, increments counter across locks", async () => {
      const { hashlock } = generateHashlock();
      const [lockPda] = deriveSolverLock(programId, hashlock, 1);

      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 4_000_000,
            reward: 1_000_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(4_000_000);
      expect(lock.reward.toNumber()).to.equal(1_000_000);
      expect(lock.refundTo.toBase58()).to.equal(refundTo.publicKey.toBase58());
      expect(lock.rentPayer.toBase58()).to.equal(signer.publicKey.toBase58());

      // second lock, same hashlock
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 2,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 2) as any)
        .rpc();

      const count = await program.methods
        .getSolverLockCount(hashlock)
        .accounts({ counter: deriveSolverCount(programId, hashlock)[0] } as any)
        .view();
      expect(count.toNumber()).to.equal(2);
    });

    it("rejects out-of-order index", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .solverLockSol(
            solverLockParams({
              hashlock,
              index: 5,
              amount: 1_000_000,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([])
          )
          .accounts(solverLockSolAccounts(hashlock, 5) as any)
          .rpc(),
        "InvalidIndex"
      );
    });

    it("rejects reward with reward_timelock_delta >= timelock_delta", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .solverLockSol(
            solverLockParams({
              hashlock,
              index: 1,
              amount: 1_000_000,
              reward: 100,
              timelockDelta: 100,
              rewardTimelockDelta: 100,
              recipient: recipient.publicKey,
              rewardRecipient: rewardRecipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([])
          )
          .accounts(solverLockSolAccounts(hashlock, 1) as any)
          .rpc(),
        "RewardTimelockNotLessThanTimelock"
      );
    });
  });

  describe("Solver Lock Token", () => {
    it("locks amount+reward in a single vault", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockToken(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 300_000,
            reward: 50_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockTokenAccounts(hashlock, 1) as any)
        .rpc();

      const vault = await getAccount(
        provider.connection,
        deriveSolverVault(programId, hashlock, 1)[0]
      );
      expect(Number(vault.amount)).to.equal(350_000);
    });
  });

  describe("Solver Lock Token Diff Reward", () => {
    const diffAccounts = (hashlock: number[], index: number) => ({
      payer: signer.publicKey,
      sender: signer.publicKey,
      counter: deriveSolverCount(programId, hashlock)[0],
      solverLock: deriveSolverLock(programId, hashlock, index)[0],
      tokenMint: mintA,
      rewardTokenMint: mintB,
      senderTokenAccount: signerAtaA,
      senderRewardTokenAccount: signerAtaB,
      vault: deriveSolverVault(programId, hashlock, index)[0],
      rewardVault: deriveSolverRewardVault(programId, hashlock, index)[0],
      payoutCurveProgram: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    });

    it("locks amount and reward in separate vaults", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockTokenDiffReward(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 200_000,
            reward: 70_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(diffAccounts(hashlock, 1) as any)
        .rpc();

      const vault = await getAccount(
        provider.connection,
        deriveSolverVault(programId, hashlock, 1)[0]
      );
      const rewardVault = await getAccount(
        provider.connection,
        deriveSolverRewardVault(programId, hashlock, 1)[0]
      );
      expect(Number(vault.amount)).to.equal(200_000);
      expect(Number(rewardVault.amount)).to.equal(70_000);
    });

    it("rejects identical mints", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .solverLockTokenDiffReward(
            solverLockParams({
              hashlock,
              index: 1,
              amount: 200_000,
              reward: 70_000,
              rewardTimelockDelta: 1800,
              recipient: recipient.publicKey,
              rewardRecipient: rewardRecipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([])
          )
          .accounts({
            ...diffAccounts(hashlock, 1),
            rewardTokenMint: mintA,
            senderRewardTokenAccount: signerAtaA,
          } as any)
          .rpc(),
        "Error"
      );
    });
  });

  // ═══════════════════════════════ Redeem Solver ═══════════════════════════════

  describe("Redeem Solver SOL", () => {
    it("routes reward to reward_recipient before reward timelock", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 4_000_000,
            reward: 1_000_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();

      const recipientBefore = await lamports(recipient.publicKey);
      const rewardBefore = await lamports(rewardRecipient.publicKey);
      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts(redeemSolverSolAccounts(hashlock, 1) as any)
        .rpc();

      expect((await lamports(recipient.publicKey)) - recipientBefore).to.equal(
        4_000_000
      );
      expect(
        (await lamports(rewardRecipient.publicKey)) - rewardBefore
      ).to.equal(1_000_000);
    });

    it("routes reward to the caller after reward timelock", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 2_000_000,
            reward: 500_000,
            timelockDelta: 3600,
            rewardTimelockDelta: 2,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();
      await sleep(3500);

      const thirdBefore = await lamports(thirdParty.publicKey);
      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts(
          redeemSolverSolAccounts(hashlock, 1, thirdParty.publicKey) as any
        )
        .signers([thirdParty])
        .rpc();
      // caller received the reward (minus the tx fee it paid)
      expect(await lamports(thirdParty.publicKey)).to.be.greaterThan(
        thirdBefore + 400_000
      );
    });

    it("rejects double redeem (NotPending)", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();
      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts(redeemSolverSolAccounts(hashlock, 1) as any)
        .rpc();
      await expectError(
        program.methods
          .redeemSolverSol(hashlock, new BN(1), secret)
          .accounts(redeemSolverSolAccounts(hashlock, 1) as any)
          .rpc(),
        "NotPending"
      );
    });
  });

  describe("Redeem Solver Token", () => {
    it("redeems single-vault lock (reward to reward_recipient)", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockToken(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 300_000,
            reward: 50_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockTokenAccounts(hashlock, 1) as any)
        .rpc();

      await program.methods
        .redeemSolverToken(hashlock, new BN(1), secret)
        .accounts({
          caller: signer.publicKey,
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          rentPayer: signer.publicKey,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          refundTo: refundTo.publicKey,
          tokenMint: mintA,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          recipientTokenAccount: ata(mintA, recipient.publicKey),
          rewardRecipientTokenAccount: ata(mintA, rewardRecipient.publicKey),
          callerTokenAccount: signerAtaA,
          refundToTokenAccount: null,
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        deriveSolverLock(programId, hashlock, 1)[0]
      );
      expect(lock.status).to.equal(STATUS_REDEEMED);
      // vault emptied and closed
      expect(
        await provider.connection.getAccountInfo(
          deriveSolverVault(programId, hashlock, 1)[0]
        )
      ).to.be.null;
    });
  });

  describe("Redeem Solver Token Diff Reward", () => {
    it("redeems two-vault lock", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockTokenDiffReward(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 200_000,
            reward: 70_000,
            rewardTimelockDelta: 1800,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts({
          payer: signer.publicKey,
          sender: signer.publicKey,
          counter: deriveSolverCount(programId, hashlock)[0],
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          tokenMint: mintA,
          rewardTokenMint: mintB,
          senderTokenAccount: signerAtaA,
          senderRewardTokenAccount: signerAtaB,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          rewardVault: deriveSolverRewardVault(programId, hashlock, 1)[0],
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await program.methods
        .redeemSolverTokenDiffReward(hashlock, new BN(1), secret)
        .accounts({
          caller: signer.publicKey,
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          rentPayer: signer.publicKey,
          recipient: recipient.publicKey,
          rewardRecipient: rewardRecipient.publicKey,
          refundTo: refundTo.publicKey,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          rewardVault: deriveSolverRewardVault(programId, hashlock, 1)[0],
          recipientTokenAccount: ata(mintA, recipient.publicKey),
          rewardRecipientTokenAccount: ata(mintB, rewardRecipient.publicKey),
          callerRewardTokenAccount: ata(mintB, signer.publicKey),
          refundToTokenAccount: null,
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const rewardAta = await getAccount(
        provider.connection,
        ata(mintB, rewardRecipient.publicKey)
      );
      expect(Number(rewardAta.amount)).to.be.gte(70_000);
    });
  });

  // ═══════════════════════════════ Refund Solver ═══════════════════════════════

  describe("Refund Solver", () => {
    it("SOL: refunds amount+reward to refund_to after timelock", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 2_000_000,
            reward: 500_000,
            timelockDelta: 2,
            rewardTimelockDelta: 1,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();
      await sleep(3500);

      const before = await lamports(refundTo.publicKey);
      await program.methods
        .refundSolverSol(hashlock, new BN(1))
        .accounts(refundSolverSolAccounts(hashlock, 1) as any)
        .rpc();
      expect((await lamports(refundTo.publicKey)) - before).to.equal(2_500_000);
    });

    it("SOL: rejects refund before timelock", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();
      await expectError(
        program.methods
          .refundSolverSol(hashlock, new BN(1))
          .accounts(refundSolverSolAccounts(hashlock, 1) as any)
          .rpc(),
        "TimelockNotExpired"
      );
    });

    it("Token: refunds amount+reward to refund_to ATA after timelock", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockToken(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 120_000,
            reward: 30_000,
            timelockDelta: 2,
            rewardTimelockDelta: 1,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockTokenAccounts(hashlock, 1) as any)
        .rpc();
      await sleep(3500);

      const refundAtaAddr = ata(mintA, refundTo.publicKey);
      const before = Number(
        (await provider.connection.getAccountInfo(refundAtaAddr))
          ? (await getAccount(provider.connection, refundAtaAddr)).amount
          : 0
      );
      await program.methods
        .refundSolverToken(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          rentPayer: signer.publicKey,
          refundTo: refundTo.publicKey,
          tokenMint: mintA,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          refundToTokenAccount: refundAtaAddr,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();
      const after = Number(
        (await getAccount(provider.connection, refundAtaAddr)).amount
      );
      expect(after - before).to.equal(150_000);
    });

    it("Diff reward: refunds both vaults to refund_to after timelock", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockTokenDiffReward(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 90_000,
            reward: 20_000,
            timelockDelta: 2,
            rewardTimelockDelta: 1,
            recipient: recipient.publicKey,
            rewardRecipient: rewardRecipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts({
          payer: signer.publicKey,
          sender: signer.publicKey,
          counter: deriveSolverCount(programId, hashlock)[0],
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          tokenMint: mintA,
          rewardTokenMint: mintB,
          senderTokenAccount: signerAtaA,
          senderRewardTokenAccount: signerAtaB,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          rewardVault: deriveSolverRewardVault(programId, hashlock, 1)[0],
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();
      await sleep(3500);

      await program.methods
        .refundSolverTokenDiffReward(hashlock, new BN(1))
        .accounts({
          caller: signer.publicKey,
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
          rentPayer: signer.publicKey,
          refundTo: refundTo.publicKey,
          tokenMint: mintA,
          rewardTokenMint: mintB,
          vault: deriveSolverVault(programId, hashlock, 1)[0],
          rewardVault: deriveSolverRewardVault(programId, hashlock, 1)[0],
          refundToTokenAccount: ata(mintA, refundTo.publicKey),
          refundToRewardTokenAccount: ata(mintB, refundTo.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      const lock = await (program.account as any).solverLock.fetch(
        deriveSolverLock(programId, hashlock, 1)[0]
      );
      expect(lock.status).to.equal(STATUS_REFUNDED);
    });
  });

  // ═══════════════════════════════ Close Solver Lock ═══════════════════════════

  describe("Close Solver Lock", () => {
    it("sender reclaims rent after settlement; wrong caller and pending rejected", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();

      const closeAccounts = {
        caller: signer.publicKey,
        solverLock: deriveSolverLock(programId, hashlock, 1)[0],
        rentPayer: signer.publicKey,
      };

      // still pending
      await expectError(
        program.methods
          .closeSolverLock(hashlock, new BN(1))
          .accounts(closeAccounts as any)
          .rpc(),
        "StillPending"
      );

      await program.methods
        .redeemSolverSol(hashlock, new BN(1), secret)
        .accounts(redeemSolverSolAccounts(hashlock, 1) as any)
        .rpc();

      // wrong caller
      await expectError(
        program.methods
          .closeSolverLock(hashlock, new BN(1))
          .accounts({ ...closeAccounts, caller: thirdParty.publicKey } as any)
          .signers([thirdParty])
          .rpc(),
        "WrongSender"
      );

      await program.methods
        .closeSolverLock(hashlock, new BN(1))
        .accounts(closeAccounts as any)
        .rpc();
      expect(
        await provider.connection.getAccountInfo(
          deriveSolverLock(programId, hashlock, 1)[0]
        )
      ).to.be.null;

      // closed index can never be re-initialized (counter is permanent)
      await expectError(
        program.methods
          .solverLockSol(
            solverLockParams({
              hashlock,
              index: 1,
              amount: 1_000_000,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
            }),
            Buffer.from([])
          )
          .accounts(solverLockSolAccounts(hashlock, 1) as any)
          .rpc(),
        "InvalidIndex"
      );
    });
  });

  // ═══════════════════════════════ Payout Curves ═══════════════════════════════

  describe("Payout curves", () => {
    it("constant curve pays the full amount (no excess)", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 2_000_000;
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: constantCurveId,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payoutCurveProgram: constantCurveId,
        } as any)
        .rpc();

      const recipientBefore = await lamports(recipient.publicKey);
      const refundToBefore = await lamports(refundTo.publicKey);
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          ...redeemUserSolAccounts(hashlock),
          payoutCurveProgram: constantCurveId,
        } as any)
        .rpc();
      expect((await lamports(recipient.publicKey)) - recipientBefore).to.equal(
        amount
      );
      expect(await lamports(refundTo.publicKey)).to.equal(refundToBefore);
    });

    it("decay curve splits payout/excess (SOL)", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 2_000_000;
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: mockCurveId,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();

      const recipientBefore = await lamports(recipient.publicKey);
      const refundToBefore = await lamports(refundTo.publicKey);
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          ...redeemUserSolAccounts(hashlock),
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();
      expect((await lamports(recipient.publicKey)) - recipientBefore).to.equal(
        amount / 2
      );
      expect((await lamports(refundTo.publicKey)) - refundToBefore).to.equal(
        amount / 2
      );
    });

    it("decay curve splits payout/excess (token, excess to refund_to ATA)", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 100_000;
      await program.methods
        .userLockToken(
          userLockParams({
            hashlock,
            amount,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: mockCurveId,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockTokenAccounts(hashlock),
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();

      const refundAtaAddr = ata(mintA, refundTo.publicKey);
      const before = Number(
        (await provider.connection.getAccountInfo(refundAtaAddr))
          ? (await getAccount(provider.connection, refundAtaAddr)).amount
          : 0
      );
      await program.methods
        .redeemUserToken(hashlock, secret)
        .accounts({
          ...redeemUserTokenAccounts(hashlock),
          refundToTokenAccount: refundAtaAddr,
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();
      const after = Number(
        (await getAccount(provider.connection, refundAtaAddr)).amount
      );
      expect(after - before).to.equal(amount / 2);
    });

    it("rejects zero payout at redeem (bps = 0)", async () => {
      const { secret, hashlock } = generateHashlock();
      const config = Buffer.from([0, 0]); // 0 bps
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: mockCurveId,
            payoutCurveData: config,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();
      await expectError(
        program.methods
          .redeemUserSol(hashlock, secret)
          .accounts({
            ...redeemUserSolAccounts(hashlock),
            payoutCurveProgram: mockCurveId,
          } as any)
          .rpc(),
        "InvalidPayout"
      );
    });

    it("rejects payout > amount at redeem (bps = 20000)", async () => {
      const { secret, hashlock } = generateHashlock();
      const config = Buffer.alloc(2);
      config.writeUInt16LE(20000);
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: mockCurveId,
            payoutCurveData: config,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payoutCurveProgram: mockCurveId,
        } as any)
        .rpc();
      await expectError(
        program.methods
          .redeemUserSol(hashlock, secret)
          .accounts({
            ...redeemUserSolAccounts(hashlock),
            payoutCurveProgram: mockCurveId,
          } as any)
          .rpc(),
        "InvalidPayout"
      );
    });

    it("rejects a non-executable payout curve at creation", async () => {
      const { hashlock } = generateHashlock();
      const fakeCurve = Keypair.generate().publicKey;
      await expectError(
        program.methods
          .userLockSol(
            userLockParams({
              hashlock,
              amount: 1_000_000,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
              payoutCurve: fakeCurve,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts({
            ...userLockSolAccounts(hashlock),
            payoutCurveProgram: fakeCurve,
          } as any)
          .rpc(),
        "InvalidPayoutCurve"
      );
    });

    it("rejects a curve account that does not match the declared curve", async () => {
      const { hashlock } = generateHashlock();
      await expectError(
        program.methods
          .userLockSol(
            userLockParams({
              hashlock,
              amount: 1_000_000,
              recipient: recipient.publicKey,
              refundTo: refundTo.publicKey,
              payoutCurve: mockCurveId,
            }),
            Buffer.from([]),
            Buffer.from([])
          )
          .accounts({
            ...userLockSolAccounts(hashlock),
            payoutCurveProgram: constantCurveId,
          } as any)
          .rpc(),
        "InvalidPayoutCurve"
      );
    });

    it("rejects redeem without the curve account when the lock has a curve", async () => {
      const { secret, hashlock } = generateHashlock();
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
            payoutCurve: constantCurveId,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts({
          ...userLockSolAccounts(hashlock),
          payoutCurveProgram: constantCurveId,
        } as any)
        .rpc();
      await expectError(
        program.methods
          .redeemUserSol(hashlock, secret)
          .accounts(redeemUserSolAccounts(hashlock) as any)
          .rpc(),
        "InvalidPayoutCurve"
      );
    });
  });

  // ══════════════════ Documented deviation: hashlock reuse ═════════════════════

  describe("Hashlock lifecycle (documented deviation)", () => {
    it("a settled hashlock can be re-locked, and the public secret redeems it instantly", async () => {
      const { secret, hashlock } = generateHashlock();
      const params = () =>
        userLockParams({
          hashlock,
          amount: 1_000_000,
          recipient: recipient.publicKey,
          refundTo: refundTo.publicKey,
        });

      await program.methods
        .userLockSol(params(), Buffer.from([]), Buffer.from([]))
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts(redeemUserSolAccounts(hashlock) as any)
        .rpc();

      // The PDA was closed — the same hashlock can be locked again...
      await program.methods
        .userLockSol(params(), Buffer.from([]), Buffer.from([]))
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();
      // ...and anyone holding the (now public) secret can settle it immediately.
      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts(redeemUserSolAccounts(hashlock, thirdParty.publicKey) as any)
        .signers([thirdParty])
        .rpc();
    });
  });

  // ═══════════════════════════════ Views ═══════════════════════════════════════

  describe("Views", () => {
    it("get_user_lock returns extended fields", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .userLockSol(
          userLockParams({
            hashlock,
            amount: 1_000_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([]),
          Buffer.from([])
        )
        .accounts(userLockSolAccounts(hashlock) as any)
        .rpc();

      const data = await program.methods
        .getUserLock(hashlock)
        .accounts({ userLock: deriveUserLock(programId, hashlock)[0] } as any)
        .view();
      expect(data.amount.toNumber()).to.equal(1_000_000);
      expect(data.refundTo.toBase58()).to.equal(refundTo.publicKey.toBase58());
      expect(data.rentPayer.toBase58()).to.equal(signer.publicKey.toBase58());
      expect(data.status).to.equal(STATUS_PENDING);
    });

    it("get_solver_lock returns extended fields", async () => {
      const { hashlock } = generateHashlock();
      await program.methods
        .solverLockSol(
          solverLockParams({
            hashlock,
            index: 1,
            amount: 1_500_000,
            recipient: recipient.publicKey,
            refundTo: refundTo.publicKey,
          }),
          Buffer.from([])
        )
        .accounts(solverLockSolAccounts(hashlock, 1) as any)
        .rpc();

      const data = await program.methods
        .getSolverLock(hashlock, new BN(1))
        .accounts({
          solverLock: deriveSolverLock(programId, hashlock, 1)[0],
        } as any)
        .view();
      expect(data.amount.toNumber()).to.equal(1_500_000);
      expect(data.refundTo.toBase58()).to.equal(refundTo.publicKey.toBase58());
    });
  });
});
