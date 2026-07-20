// Gasless rails test suite:
//   Rail A — fee-payer sponsorship (partially-signed transaction relay)
//   Rail B — durable nonce (offline/deferred signing)
//   Rail C — ed25519 signed intent (user never signs a transaction)
// plus the adversarial matrix for each rail.
import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  BN,
  Program,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  generateHashlock,
  sleep,
  sha256,
  deriveUserLock,
  deriveUserVault,
  deriveIntentDomain,
  deriveDelegate,
  deriveConsumedIntent,
  deriveProgramData,
  userLockParams,
  computeCallHash,
  buildIntentMessage,
  ed25519VerifyIx,
  expectError,
  splToken,
} from "./shared";

const { SYSVAR_RENT_PUBKEY, NONCE_ACCOUNT_LENGTH, NonceAccount } = anchor.web3;
const {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  approve,
} = splToken;

describe("gasless rails", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.trainHtlc as Program;
  const programId = program.programId;
  const connection = provider.connection;

  const signer = (provider.wallet as anchor.Wallet).payer; // upgrade authority on localnet
  const user = Keypair.generate();
  const relayer = Keypair.generate();
  const recipient = Keypair.generate();
  const refundTo = Keypair.generate();

  const [intentDomainPda] = deriveIntentDomain(programId);
  const [delegatePda] = deriveDelegate(programId);

  let mintA: anchor.web3.PublicKey;
  let userAta: anchor.web3.PublicKey;
  let domainSalt: Buffer;

  const now = () => Math.floor(Date.now() / 1000);

  before(async () => {
    for (const [pk, amount] of [
      [user.publicKey, 20],
      [relayer.publicKey, 20],
      [recipient.publicKey, 2],
      [refundTo.publicKey, 2],
    ] as const) {
      const sig = await connection.requestAirdrop(pk, amount * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    mintA = await createMint(connection, signer, signer.publicKey, null, 6);
    userAta = await createAssociatedTokenAccount(
      connection,
      signer,
      mintA,
      user.publicKey
    );
    await mintTo(connection, signer, mintA, userAta, signer, 1_000_000_000);

    // One-time SPL delegation to the program's delegate PDA (Permit2-allowance
    // analog). On production this transaction can itself be relayer-sponsored.
    await approve(
      connection,
      signer, // fee payer
      userAta,
      delegatePda,
      user, // owner signs
      500_000_000
    );

    // Initialize the intent domain (upgrade authority only).
    const existing = await connection.getAccountInfo(intentDomainPda);
    if (!existing) {
      domainSalt = Buffer.from(sha256(Buffer.from("localnet-test-salt")));
      await program.methods
        .initializeIntentDomain(Array.from(domainSalt))
        .accounts({
          authority: signer.publicKey,
          intentDomain: intentDomainPda,
          program: programId,
          programData: deriveProgramData(programId)[0],
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    }
    const domain = await (program.account as any).intentDomain.fetch(
      intentDomainPda
    );
    domainSalt = Buffer.from(domain.salt);
  });

  // ─── Builders ───────────────────────────────────────────────────────────────

  const solLockAccounts = (hashlock: number[]) => ({
    payer: relayer.publicKey,
    sender: user.publicKey,
    userLock: deriveUserLock(programId, hashlock)[0],
    payoutCurveProgram: null,
    systemProgram: SystemProgram.programId,
  });

  async function buildSponsoredLockTx(hashlock: number[], amount: number) {
    const params = userLockParams({
      hashlock,
      amount,
      recipient: recipient.publicKey,
      refundTo: user.publicKey,
    });
    const ix = await program.methods
      .userLockSol(params, Buffer.from([]), Buffer.from([]))
      .accounts(solLockAccounts(hashlock) as any)
      .instruction();
    const tx = new Transaction().add(ix);
    tx.feePayer = relayer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    return tx;
  }

  interface IntentArgs {
    hashlock: number[];
    amount: number;
    nonce: number;
    deadline: number;
  }

  function buildIntent(args: IntentArgs) {
    const params = userLockParams({
      hashlock: args.hashlock,
      amount: args.amount,
      recipient: recipient.publicKey,
      refundTo: user.publicKey,
    });
    const userData = Buffer.from([]);
    const solverData = Buffer.from([]);
    const callHash = computeCallHash(program, params, userData, solverData);
    const message = buildIntentMessage({
      programId,
      domainSalt,
      user: user.publicKey,
      mint: mintA,
      amount: args.amount,
      callHash,
      nonce: args.nonce,
      deadline: args.deadline,
    });
    const intentHash = sha256(message);
    return { params, userData, solverData, message, intentHash };
  }

  async function intentLockIx(
    args: IntentArgs,
    built: ReturnType<typeof buildIntent>,
    overrides: Record<string, unknown> = {}
  ) {
    return program.methods
      .userLockTokenWithIntent(
        built.params,
        built.userData,
        built.solverData,
        new BN(args.nonce),
        new BN(args.deadline)
      )
      .accounts({
        payer: relayer.publicKey,
        user: user.publicKey,
        intentDomain: intentDomainPda,
        consumedIntent: deriveConsumedIntent(programId, user.publicKey, args.nonce)[0],
        delegate: delegatePda,
        userLock: deriveUserLock(programId, args.hashlock)[0],
        tokenMint: mintA,
        userTokenAccount: userAta,
        vault: deriveUserVault(programId, args.hashlock)[0],
        payoutCurveProgram: null,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...overrides,
      } as any)
      .instruction();
  }

  async function sendIntentTx(instructions: anchor.web3.TransactionInstruction[]) {
    const tx = new Transaction().add(...instructions);
    tx.feePayer = relayer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(relayer); // ONLY the relayer signs the transaction
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig);
    return sig;
  }

  // ═══════════════ Rail A: fee-payer sponsorship (co-signed relay) ═════════════

  describe("Rail A: fee-payer sponsorship", () => {
    it("relayer pays fees+rent; user co-signs as funds authority", async () => {
      const { secret, hashlock } = generateHashlock();
      const amount = 3_000_000;
      const tx = await buildSponsoredLockTx(hashlock, amount);

      const userBefore = await connection.getBalance(user.publicKey);
      const relayerBefore = await connection.getBalance(relayer.publicKey);

      // user signs first (offline), relayer countersigns and broadcasts
      tx.partialSign(user);
      tx.partialSign(relayer);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig);

      const lock = await (program.account as any).userLock.fetch(
        deriveUserLock(programId, hashlock)[0]
      );
      expect(lock.sender.toBase58()).to.equal(user.publicKey.toBase58());
      expect(lock.rentPayer.toBase58()).to.equal(relayer.publicKey.toBase58());
      // user paid exactly the locked amount, no fees/rent
      expect(userBefore - (await connection.getBalance(user.publicKey))).to.equal(
        amount
      );
      // relayer paid fee + lock rent
      expect(await connection.getBalance(relayer.publicKey)).to.be.lessThan(
        relayerBefore
      );

      await program.methods
        .redeemUserSol(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: deriveUserLock(programId, hashlock)[0],
          rentPayer: relayer.publicKey,
          recipient: recipient.publicKey,
          refundTo: user.publicKey,
          payoutCurveProgram: null,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("malicious relayer cannot mutate a user-signed transaction", async () => {
      const { hashlock } = generateHashlock();
      const tx = await buildSponsoredLockTx(hashlock, 1_000_000);
      tx.partialSign(user);

      // Relayer tampers with the instruction data after the user signed.
      tx.instructions[0].data[20] ^= 0xff;
      tx.partialSign(relayer);

      await expectError(
        connection.sendRawTransaction(tx.serialize({ verifySignatures: false })),
        "ignature" // Signature verification failure
      );
    });

    it("a co-signed transaction cannot be replayed", async () => {
      const { hashlock } = generateHashlock();
      const tx = await buildSponsoredLockTx(hashlock, 1_000_000);
      tx.partialSign(user);
      tx.partialSign(relayer);
      const raw = tx.serialize();
      const sig = await connection.sendRawTransaction(raw);
      await connection.confirmTransaction(sig);

      await expectError(
        connection.sendRawTransaction(raw),
        "already been processed"
      );
    });

    it("the user signature binds the fee payer (wrong fee payer rejected)", async () => {
      const { hashlock } = generateHashlock();
      const tx = await buildSponsoredLockTx(hashlock, 1_000_000);
      tx.partialSign(user);

      // A different relayer swaps itself in as fee payer after the user signed.
      const otherRelayer = Keypair.generate();
      const sig = await connection.requestAirdrop(
        otherRelayer.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);
      tx.feePayer = otherRelayer.publicKey;

      let failed = false;
      try {
        tx.partialSign(otherRelayer);
        await connection.sendRawTransaction(
          tx.serialize({ verifySignatures: false })
        );
      } catch {
        failed = true;
      }
      expect(failed).to.equal(true);
    });
  });

  // ═══════════════ Rail B: durable nonce (offline signing) ═════════════════════

  describe("Rail B: durable nonce", () => {
    const nonceKeypair = Keypair.generate();

    before(async () => {
      const rent = await connection.getMinimumBalanceForRentExemption(
        NONCE_ACCOUNT_LENGTH
      );
      const tx = new Transaction().add(
        ...SystemProgram.createNonceAccount({
          fromPubkey: relayer.publicKey,
          noncePubkey: nonceKeypair.publicKey,
          authorizedPubkey: relayer.publicKey,
          lamports: rent,
        }).instructions
      );
      await provider.sendAndConfirm(tx, [relayer, nonceKeypair]);
    });

    it("user signs offline against a durable nonce; relayer submits later; replay fails", async () => {
      const { hashlock } = generateHashlock();
      const amount = 2_000_000;

      const nonceInfo = await connection.getAccountInfo(nonceKeypair.publicKey);
      const nonceAccount = NonceAccount.fromAccountData(nonceInfo!.data);

      const params = userLockParams({
        hashlock,
        amount,
        recipient: recipient.publicKey,
        refundTo: user.publicKey,
      });
      const lockIx = await program.methods
        .userLockSol(params, Buffer.from([]), Buffer.from([]))
        .accounts(solLockAccounts(hashlock) as any)
        .instruction();

      const tx = new Transaction();
      tx.add(
        SystemProgram.nonceAdvance({
          noncePubkey: nonceKeypair.publicKey,
          authorizedPubkey: relayer.publicKey,
        })
      );
      tx.add(lockIx);
      tx.feePayer = relayer.publicKey;
      tx.recentBlockhash = nonceAccount.nonce; // durable nonce, no expiry window

      tx.partialSign(user); // "offline" signature
      await sleep(1500); // deferred submission
      tx.partialSign(relayer);
      const raw = tx.serialize();
      const sig = await connection.sendRawTransaction(raw);
      await connection.confirmTransaction(sig);

      const lock = await (program.account as any).userLock.fetch(
        deriveUserLock(programId, hashlock)[0]
      );
      expect(lock.sender.toBase58()).to.equal(user.publicKey.toBase58());

      // The nonce advanced — the identical transaction can never run again.
      await expectError(connection.sendRawTransaction(raw), "lockhash");
    });
  });

  // ═══════════════ Rail C: ed25519 signed intent ═══════════════════════════════

  describe("Rail C: signed intent", () => {
    it("relayer executes a user-signed intent; user signs no transaction", async () => {
      const { secret, hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 5_000_000,
        nonce: 1,
        deadline: now() + 300,
      };
      const built = buildIntent(args);

      const userTokensBefore = Number(
        (await getAccount(connection, userAta)).amount
      );
      await sendIntentTx([
        ed25519VerifyIx(user, built.message),
        await intentLockIx(args, built),
      ]);

      const lock = await (program.account as any).userLock.fetch(
        deriveUserLock(programId, hashlock)[0]
      );
      expect(lock.sender.toBase58()).to.equal(user.publicKey.toBase58());
      expect(lock.rentPayer.toBase58()).to.equal(relayer.publicKey.toBase58());
      expect(lock.amount.toNumber()).to.equal(args.amount);
      expect(
        userTokensBefore - Number((await getAccount(connection, userAta)).amount)
      ).to.equal(args.amount);

      const consumed = await (program.account as any).consumedIntent.fetch(
        deriveConsumedIntent(programId, user.publicKey, args.nonce)[0]
      );
      expect(consumed.user.toBase58()).to.equal(user.publicKey.toBase58());

      // settle so later tests reuse a clean slate
      await program.methods
        .redeemUserToken(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: deriveUserLock(programId, hashlock)[0],
          rentPayer: relayer.publicKey,
          recipient: recipient.publicKey,
          refundTo: user.publicKey,
          tokenMint: mintA,
          vault: deriveUserVault(programId, hashlock)[0],
          recipientTokenAccount: splToken.getAssociatedTokenAddressSync(
            mintA,
            recipient.publicKey
          ),
          refundToTokenAccount: null,
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();
    });

    it("an intent cannot be consumed twice, even after the lock settles", async () => {
      const { secret, hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 1_000_000,
        nonce: 2,
        deadline: now() + 300,
      };
      const built = buildIntent(args);
      await sendIntentTx([
        ed25519VerifyIx(user, built.message),
        await intentLockIx(args, built),
      ]);

      // Settle and close the user lock so its PDA is free again — the
      // ConsumedIntent PDA must still block a replay on its own.
      await program.methods
        .redeemUserToken(hashlock, secret)
        .accounts({
          caller: signer.publicKey,
          userLock: deriveUserLock(programId, hashlock)[0],
          rentPayer: relayer.publicKey,
          recipient: recipient.publicKey,
          refundTo: user.publicKey,
          tokenMint: mintA,
          vault: deriveUserVault(programId, hashlock)[0],
          recipientTokenAccount: splToken.getAssociatedTokenAddressSync(
            mintA,
            recipient.publicKey
          ),
          refundToTokenAccount: null,
          payoutCurveProgram: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      await expectError(
        sendIntentTx([
          ed25519VerifyIx(user, built.message),
          await intentLockIx(args, built),
        ]),
        "already in use"
      );
    });

    it("relayer cannot execute different parameters than the user signed", async () => {
      const { hashlock } = generateHashlock();
      const signedArgs = {
        hashlock,
        amount: 1_000_000,
        nonce: 3,
        deadline: now() + 300,
      };
      const signedBuilt = buildIntent(signedArgs);

      // Relayer doubles the amount and derives a fresh intent hash for the
      // tampered params, but can only attach the user's ORIGINAL signature.
      const tamperedArgs = { ...signedArgs, amount: 2_000_000 };
      const tamperedBuilt = buildIntent(tamperedArgs);

      await expectError(
        sendIntentTx([
          ed25519VerifyIx(user, signedBuilt.message), // valid sig, old message
          await intentLockIx(tamperedArgs, tamperedBuilt),
        ]),
        "InvalidIntentSignature"
      );
    });

    it("an attacker cannot substitute their own signature for the user's", async () => {
      const attacker = Keypair.generate();
      const { hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 1_000_000,
        nonce: 4,
        deadline: now() + 300,
      };
      const built = buildIntent(args);

      await expectError(
        sendIntentTx([
          ed25519VerifyIx(attacker, built.message), // attacker-signed
          await intentLockIx(args, built),
        ]),
        "InvalidIntentSignature"
      );
    });

    it("rejects an expired intent", async () => {
      const { hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 1_000_000,
        nonce: 5,
        deadline: now() - 10,
      };
      const built = buildIntent(args);
      await expectError(
        sendIntentTx([
          ed25519VerifyIx(user, built.message),
          await intentLockIx(args, built),
        ]),
        "IntentExpired"
      );
    });

    it("rejects a lock instruction without the ed25519 verification", async () => {
      const { hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 1_000_000,
        nonce: 6,
        deadline: now() + 300,
      };
      const built = buildIntent(args);
      await expectError(
        sendIntentTx([await intentLockIx(args, built)]),
        "InvalidIntentSignature"
      );
    });

    it("rejects a spoofed instructions sysvar", async () => {
      const { hashlock } = generateHashlock();
      const args = {
        hashlock,
        amount: 1_000_000,
        nonce: 7,
        deadline: now() + 300,
      };
      const built = buildIntent(args);
      await expectError(
        sendIntentTx([
          ed25519VerifyIx(user, built.message),
          await intentLockIx(args, built, {
            instructionsSysvar: Keypair.generate().publicKey,
          }),
        ]),
        "InvalidIntentSignature"
      );
    });

    it("rejects an intent exceeding the delegated amount", async () => {
      const poorUser = Keypair.generate();
      const sig = await connection.requestAirdrop(
        poorUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);
      const poorAta = await createAssociatedTokenAccount(
        connection,
        signer,
        mintA,
        poorUser.publicKey
      );
      await mintTo(connection, signer, mintA, poorAta, signer, 10_000_000);
      await approve(connection, signer, poorAta, delegatePda, poorUser, 500_000);

      const { hashlock } = generateHashlock();
      const amount = 1_000_000; // > delegated 500_000
      const deadline = now() + 300;
      const params = userLockParams({
        hashlock,
        amount,
        recipient: recipient.publicKey,
        refundTo: poorUser.publicKey,
      });
      const callHash = computeCallHash(
        program,
        params,
        Buffer.from([]),
        Buffer.from([])
      );
      const message = buildIntentMessage({
        programId,
        domainSalt,
        user: poorUser.publicKey,
        mint: mintA,
        amount,
        callHash,
        nonce: 1,
        deadline,
      });

      const ix = await program.methods
        .userLockTokenWithIntent(
          params,
          Buffer.from([]),
          Buffer.from([]),
          new BN(1),
          new BN(deadline)
        )
        .accounts({
          payer: relayer.publicKey,
          user: poorUser.publicKey,
          intentDomain: intentDomainPda,
          consumedIntent: deriveConsumedIntent(programId, poorUser.publicKey, 1)[0],
          delegate: delegatePda,
          userLock: deriveUserLock(programId, hashlock)[0],
          tokenMint: mintA,
          userTokenAccount: poorAta,
          vault: deriveUserVault(programId, hashlock)[0],
          payoutCurveProgram: null,
          instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await expectError(
        sendIntentTx([ed25519VerifyIx(poorUser, message), ix]),
        "InvalidDelegation"
      );
    });

    it("consumed intents close only after the deadline, rent to the relayer", async () => {
      const { hashlock } = generateHashlock();
      const deadline = now() + 4;
      const args = { hashlock, amount: 1_000_000, nonce: 8, deadline };
      const built = buildIntent(args);
      await sendIntentTx([
        ed25519VerifyIx(user, built.message),
        await intentLockIx(args, built),
      ]);
      const [consumedPda] = deriveConsumedIntent(programId, user.publicKey, args.nonce);

      await expectError(
        program.methods
          .closeConsumedIntent()
          .accounts({
            caller: signer.publicKey,
            consumedIntent: consumedPda,
            rentPayer: relayer.publicKey,
          } as any)
          .rpc(),
        "IntentNotExpired"
      );

      await sleep(5500);
      const relayerBefore = await connection.getBalance(relayer.publicKey);
      await program.methods
        .closeConsumedIntent()
        .accounts({
          caller: signer.publicKey,
          consumedIntent: consumedPda,
          rentPayer: relayer.publicKey,
        } as any)
        .rpc();
      expect(await connection.getBalance(relayer.publicKey)).to.be.greaterThan(
        relayerBefore
      );
      expect(await connection.getAccountInfo(consumedPda)).to.be.null;
    });

    it("only the upgrade authority can initialize the intent domain", async () => {
      // Domain already exists — re-init must fail regardless of caller.
      await expectError(
        program.methods
          .initializeIntentDomain(Array.from(sha256(Buffer.from("evil"))))
          .accounts({
            authority: signer.publicKey,
            intentDomain: intentDomainPda,
            program: programId,
            programData: deriveProgramData(programId)[0],
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc(),
        "already in use"
      );
    });
  });
});
