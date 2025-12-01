const { expect } = require('chai');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const DEFAULT_META = {
  srcAsset: 'ETH',
  dstChain: 'Linea',
  dstAddress: '0xdestination',
  dstAsset: 'USDC',
};

const hashSecret = (secret) => ethers.sha256(abiCoder.encode(['uint256'], [secret]));
const futureTimestamp = async (offsetSeconds = 3600) => (await time.latest()) + offsetSeconds;
const getBalance = (address) => ethers.provider.getBalance(address);
const gasCostFromReceipt = (receipt) => {
  const gasUsed = BigInt(receipt.gasUsed);
  const gasPriceSource = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  const gasPrice = BigInt(gasPriceSource);
  return gasUsed * gasPrice;
};

async function deployTrainFixture() {
  const [deployer, initiator, solverA, solverB, receiver, relayer] = await ethers.getSigners();
  const Train = await ethers.getContractFactory('Train');
  const train = await Train.deploy();
  await train.waitForDeployment();
  return { train, deployer, initiator, solverA, solverB, receiver, relayer };
}

async function lockUserHTLC(train, signer, receiver, overrides = {}) {
  const {
    amount = ethers.parseEther('1'),
    swapId = ethers.id('user-swap'),
    secret = 11n,
    timelockOffset = 3600,
    meta = DEFAULT_META,
  } = overrides;
  const timelock = await futureTimestamp(timelockOffset);
  const hashlock = hashSecret(secret);
  const tx = await train
    .connect(signer)
    .lock(
      swapId,
      hashlock,
      0,
      0,
      timelock,
      receiver.address,
      meta.srcAsset,
      meta.dstChain,
      meta.dstAddress,
      meta.dstAsset,
      { value: amount }
    );
  await tx.wait();
  return { swapId, secret, hashlock, timelock, amount, htlcId: 0, meta };
}

async function lockSolverHTLC(train, solver, receiver, swapId, overrides = {}) {
  const {
    amount = ethers.parseEther('0.5'),
    reward = ethers.parseEther('0.05'),
    secret = 77n,
    timelockOffset = 3600,
    rewardLead = 120,
    meta = DEFAULT_META,
    expectedId = 1,
  } = overrides;
  const timelock = await futureTimestamp(timelockOffset);
  const rewardTimelock = timelock - rewardLead;
  const hashlock = hashSecret(secret);
  const total = amount + reward;
  const tx = await train
    .connect(solver)
    .lock(
      swapId,
      hashlock,
      reward,
      rewardTimelock,
      timelock,
      receiver.address,
      meta.srcAsset,
      meta.dstChain,
      meta.dstAddress,
      meta.dstAsset,
      { value: total }
    );
  await tx.wait();
  return { swapId, secret, hashlock, timelock, rewardTimelock, amount, reward, total, htlcId: expectedId, meta };
}

describe('Train', function () {
  describe('lock', function () {
    it('initializes a user HTLC and records the swap', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('lock-user');
      const amount = ethers.parseEther('1');
      const secret = 123n;
      const hashlock = hashSecret(secret);
      const timelock = await futureTimestamp(3600);

      await expect(
        train
          .connect(initiator)
          .lock(
            swapId,
            hashlock,
            0,
            0,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount }
          )
      )
        .to.emit(train, 'UserLocked')
        .withArgs(
          swapId,
          hashlock,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          initiator.address,
          receiver.address,
          DEFAULT_META.srcAsset,
          amount,
          timelock
        );

      const htlc = await train.getHTLCDetails(swapId, 0);
      expect(htlc.amount).to.equal(amount);
      expect(htlc.hashlock).to.equal(hashlock);
      expect(htlc.sender).to.equal(initiator.address);
      expect(htlc.srcReceiver).to.equal(receiver.address);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);

      const swaps = await train.getUserSwaps(initiator.address);
      expect(swaps).to.deep.equal([swapId]);
    });

    it('prevents duplicate user initialization for the same swap', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('duplicate-swap');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      await expect(lockUserHTLC(train, initiator, receiver, { swapId })).to.be.revertedWithCustomError(
        train,
        'SwapAlreadyInitialized'
      );
    });

    it('allows multiple solver HTLCs with increasing IDs', async function () {
      const { train, initiator, solverA, solverB, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('solver-chain');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const solverAmount = ethers.parseEther('0.4');
      const reward = ethers.parseEther('0.1');
      const timelock = await futureTimestamp(4000);
      const rewardTimelock = timelock - 60;
      const hashlock = hashSecret(555n);

      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashlock,
            reward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: solverAmount + reward }
          )
      )
        .to.emit(train, 'SolverLocked')
        .withArgs(
          swapId,
          1,
          hashlock,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          solverA.address,
          receiver.address,
          DEFAULT_META.srcAsset,
          solverAmount,
          reward,
          rewardTimelock,
          timelock
        );

      const secondHashlock = hashSecret(777n);
      const secondTimelock = await futureTimestamp(5000);
      const secondRewardTimelock = secondTimelock - 120;

      await expect(
        train
          .connect(solverB)
          .lock(
            swapId,
            secondHashlock,
            reward,
            secondRewardTimelock,
            secondTimelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: solverAmount + reward }
          )
      )
        .to.emit(train, 'SolverLocked')
        .withArgs(
          swapId,
          2,
          secondHashlock,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          solverB.address,
          receiver.address,
          DEFAULT_META.srcAsset,
          solverAmount,
          reward,
          secondRewardTimelock,
          secondTimelock
        );

      const solverHTLC = await train.getHTLCDetails(swapId, 2);
      expect(solverHTLC.sender).to.equal(solverB.address);
      expect(solverHTLC.reward).to.equal(reward);
    });

    it('reverts when the timelock is sooner than 15 minutes', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const soon = (await time.latest()) + 899;
      await expect(
        train
          .connect(initiator)
          .lock(
            ethers.id('short-timelock'),
            hashSecret(1n),
            0,
            0,
            soon,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: ethers.parseEther('1') }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidTimelock');
    });

    it('reverts when msg.value is not greater than the reward', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      await lockUserHTLC(train, initiator, receiver, { swapId: ethers.id('insufficient') });

      const swapId = ethers.id('insufficient');
      const reward = ethers.parseEther('1');
      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashSecret(22n),
            reward,
            (await futureTimestamp(3600)) - 60,
            await futureTimestamp(3600),
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: reward }
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('enforces reward timelock bounds for solver HTLCs', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-guard');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      const reward = ethers.parseEther('0.2');

      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashSecret(33n),
            reward,
            timelock + 100,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: reward + ethers.parseEther('1') }
          )
      ).to.be.revertedWithCustomError(train, 'InvaliRewardData');

      const now = await time.latest();
      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashSecret(44n),
            reward,
            now,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: reward + ethers.parseEther('1') }
          )
      ).to.be.revertedWithCustomError(train, 'InvaliRewardData');
    });
  });

  describe('refund', function () {
    it('reverts when HTLC does not exist', async function () {
      const { train } = await loadFixture(deployTrainFixture);
      await expect(train.refund(ethers.id('missing'), 0)).to.be.revertedWithCustomError(train, 'HTLCNotExists');
    });

    it('reverts before the timelock expires', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const { swapId } = await lockUserHTLC(train, initiator, receiver);
      await expect(train.connect(initiator).refund(swapId, 0)).to.be.revertedWithCustomError(
        train,
        'NotPassedTimelock'
      );
    });

    it('refunds the user HTLC and marks it as claimed', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const { swapId, timelock, amount } = await lockUserHTLC(train, initiator, receiver);

      await time.increaseTo(timelock + 1);
      await expect(() => train.connect(initiator).refund(swapId, 0)).to.changeEtherBalances(
        [train, initiator],
        [amount * -1n, amount]
      );

      const htlc = await train.getHTLCDetails(swapId, 0);
      expect(htlc.claimed).to.equal(2);
    });

    it('refunds solver HTLCs with the reward included', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('solver-refund');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, {
        amount: ethers.parseEther('0.8'),
        reward: ethers.parseEther('0.2'),
      });

      await time.increaseTo(solverLock.timelock + 1);
      const total = solverLock.amount + solverLock.reward;
      await expect(() => train.connect(solverA).refund(swapId, solverLock.htlcId)).to.changeEtherBalances(
        [train, solverA],
        [total * -1n, total]
      );
      const htlc = await train.getHTLCDetails(swapId, solverLock.htlcId);
      expect(htlc.claimed).to.equal(2);
    });

    it('cannot refund twice', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const { swapId, timelock } = await lockUserHTLC(train, initiator, receiver);
      await time.increaseTo(timelock + 1);
      await train.connect(initiator).refund(swapId, 0);
      await expect(train.connect(initiator).refund(swapId, 0)).to.be.revertedWithCustomError(train, 'AlreadyClaimed');
    });
  });

  describe('view helpers', function () {
    it('returns an empty struct for unknown swap/htlc IDs', async function () {
      const { train } = await loadFixture(deployTrainFixture);
      const details = await train.getHTLCDetails(ethers.id('missing'), 5);
      expect(details.amount).to.equal(0n);
      expect(details.reward).to.equal(0n);
      expect(details.sender).to.equal(ethers.ZeroAddress);
      expect(details.srcReceiver).to.equal(ethers.ZeroAddress);
      expect(details.hashlock).to.equal(ethers.ZeroHash);
    });

    it('tracks user-created swaps while ignoring solver locks', async function () {
      const { train, initiator, receiver, solverA } = await loadFixture(deployTrainFixture);
      const swapUserOne = ethers.id('view-user-1');
      const swapUserTwo = ethers.id('view-user-2');
      await lockUserHTLC(train, initiator, receiver, { swapId: swapUserOne });
      await lockUserHTLC(train, initiator, receiver, { swapId: swapUserTwo });

      // Solver lock should not push a swapId into the initiator history
      await lockSolverHTLC(train, solverA, receiver, swapUserTwo, { expectedId: 1 });

      const swaps = await train.getUserSwaps(initiator.address);
      expect(swaps).to.deep.equal([swapUserOne, swapUserTwo]);
    });

    it('returns solver HTLC metadata including reward timing', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('view-solver-detail');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, {
        amount: ethers.parseEther('0.9'),
        reward: ethers.parseEther('0.3'),
        rewardLead: 30,
        expectedId: 1,
      });

      const details = await train.getHTLCDetails(swapId, solverLock.htlcId);
      expect(details.amount).to.equal(solverLock.amount);
      expect(details.reward).to.equal(solverLock.reward);
      expect(details.rewardTimelock).to.equal(solverLock.rewardTimelock);
      expect(details.sender).to.equal(solverA.address);
      expect(details.srcReceiver).to.equal(receiver.address);
      expect(details.hashlock).to.equal(solverLock.hashlock);
    });
  });

  describe('redeem', function () {
    it('redeems a user HTLC and reveals the secret', async function () {
      const { train, initiator, receiver, relayer } = await loadFixture(deployTrainFixture);
      const { swapId, secret, hashlock, amount } = await lockUserHTLC(train, initiator, receiver, {
        secret: 888n,
        amount: ethers.parseEther('1.2'),
      });

      const receiverBefore = await getBalance(receiver.address);
      const tx = await train.connect(relayer).redeem(swapId, 0, secret);
      await expect(tx).to.emit(train, 'TokenRedeemed').withArgs(swapId, 0, relayer.address, secret, hashlock);
      const receiverAfter = await getBalance(receiver.address);
      expect(receiverAfter - receiverBefore).to.equal(amount);

      const htlc = await train.getHTLCDetails(swapId, 0);
      expect(htlc.claimed).to.equal(3);
      expect(htlc.secret).to.equal(secret);
    });

    it('pays solver reward when redeemed before the reward timelock', async function () {
      const { train, initiator, solverA, receiver, relayer } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-before');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, {
        amount: ethers.parseEther('0.8'),
        reward: ethers.parseEther('0.15'),
        expectedId: 1,
      });

      const receiverBefore = await getBalance(receiver.address);
      const solverBefore = await getBalance(solverA.address);
      const tx = await train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret);
      await expect(tx)
        .to.emit(train, 'TokenRedeemed')
        .withArgs(swapId, solverLock.htlcId, relayer.address, solverLock.secret, solverLock.hashlock);

      const receiverAfter = await getBalance(receiver.address);
      const solverAfter = await getBalance(solverA.address);
      expect(receiverAfter - receiverBefore).to.equal(solverLock.amount);
      expect(solverAfter - solverBefore).to.equal(solverLock.reward);
    });

    it('lets the receiver claim the reward after the reward timelock', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('receiver-after-reward');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, {
        amount: ethers.parseEther('0.6'),
        reward: ethers.parseEther('0.2'),
        rewardLead: 10,
        expectedId: 1,
      });

      await time.increaseTo(solverLock.rewardTimelock + 1);
      const receiverBefore = await getBalance(receiver.address);
      const tx = await train.connect(receiver).redeem(swapId, solverLock.htlcId, solverLock.secret);
      await expect(tx)
        .to.emit(train, 'TokenRedeemed')
        .withArgs(swapId, solverLock.htlcId, receiver.address, solverLock.secret, solverLock.hashlock);
      const receipt = await tx.wait();
      const receiverAfter = await getBalance(receiver.address);
      const adjustedGain = receiverAfter + gasCostFromReceipt(receipt) - receiverBefore;
      expect(adjustedGain).to.equal(solverLock.amount + solverLock.reward);
    });

    it('awards the reward to a relayer after the reward timelock when receiver differs', async function () {
      const { train, initiator, solverA, receiver, relayer } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('relayer-claims');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, {
        amount: ethers.parseEther('0.7'),
        reward: ethers.parseEther('0.25'),
        rewardLead: 5,
        expectedId: 1,
      });

      await time.increaseTo(solverLock.rewardTimelock + 1);
      const receiverBefore = await getBalance(receiver.address);
      const relayerBefore = await getBalance(relayer.address);
      const tx = await train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret);
      await expect(tx)
        .to.emit(train, 'TokenRedeemed')
        .withArgs(swapId, solverLock.htlcId, relayer.address, solverLock.secret, solverLock.hashlock);
      const receipt = await tx.wait();
      const receiverAfter = await getBalance(receiver.address);
      const relayerAfter = await getBalance(relayer.address);
      const relayerDelta = relayerAfter + gasCostFromReceipt(receipt) - relayerBefore;
      expect(receiverAfter - receiverBefore).to.equal(solverLock.amount);
      expect(relayerDelta).to.equal(solverLock.reward);
    });

    it('reverts if the provided secret is wrong', async function () {
      const { train, initiator, solverA, receiver, relayer } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('wrong-secret');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const solverLock = await lockSolverHTLC(train, solverA, receiver, swapId, { expectedId: 1 });
      await expect(train.connect(relayer).redeem(swapId, solverLock.htlcId, 999n)).to.be.revertedWithCustomError(
        train,
        'HashlockNotMatch'
      );
    });

    it('reverts if the HTLC does not exist', async function () {
      const { train, relayer } = await loadFixture(deployTrainFixture);
      await expect(train.connect(relayer).redeem(ethers.id('unknown'), 0, 1n)).to.be.revertedWithCustomError(
        train,
        'HTLCNotExists'
      );
    });

    it('prevents redeeming twice or after a refund', async function () {
      const { train, initiator, receiver, relayer } = await loadFixture(deployTrainFixture);
      const { swapId, secret, timelock } = await lockUserHTLC(train, initiator, receiver, {
        secret: 444n,
      });

      await train.connect(relayer).redeem(swapId, 0, secret);
      await expect(train.connect(relayer).redeem(swapId, 0, secret)).to.be.revertedWithCustomError(
        train,
        'AlreadyClaimed'
      );

      const {
        swapId: swapId2,
        secret: secret2,
        timelock: timelock2,
      } = await lockUserHTLC(train, initiator, receiver, {
        swapId: ethers.id('refunded-first'),
        secret: 999n,
      });
      await time.increaseTo(timelock2 + 1);
      await train.connect(initiator).refund(swapId2, 0);
      await expect(train.connect(relayer).redeem(swapId2, 0, secret2)).to.be.revertedWithCustomError(
        train,
        'AlreadyClaimed'
      );
    });
  });
});
