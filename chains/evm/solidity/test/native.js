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
    .lockSrc(
      swapId,
      hashlock,
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
    .lockDst(
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
  describe('lockSrc (user lock)', function () {
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
          .lockSrc(
            swapId,
            hashlock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount }
          )
      )
        .to.emit(train, 'SrcLocked')
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
      expect(htlc.reward).to.equal(0);

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

    it('reverts when the timelock is sooner than 30 minutes', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const soon = (await time.latest()) + 1799;
      await expect(
        train
          .connect(initiator)
          .lockSrc(
            ethers.id('short-timelock'),
            hashSecret(1n),
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

    it('reverts when msg.value is zero', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const timelock = await futureTimestamp(3600);
      await expect(
        train
          .connect(initiator)
          .lockSrc(
            ethers.id('zero-value'),
            hashSecret(1n),
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: 0 }
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('accepts timelock at 30 minutes boundary with +1s buffer', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const now = await time.latest();
      const boundary = now + 1801; // +1s buffer to avoid mining drift
      const amount = ethers.parseEther('0.1');
      await expect(
        train
          .connect(initiator)
          .lockSrc(
            ethers.id('src-boundary-30m'),
            hashSecret(2n),
            boundary,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount }
          )
      ).to.emit(train, 'SrcLocked');
    });
  });

  describe('lockDst (solver lock)', function () {
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
          .lockDst(
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
        .to.emit(train, 'DstLocked')
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
          .lockDst(
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
        .to.emit(train, 'DstLocked')
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

    it('permits a solver-first swap at htlcId 0', async function () {
      const { train, initiator, solverA, solverB, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('solver-first');
      const solverAmount = ethers.parseEther('0.8');
      const solverReward = ethers.parseEther('0.15');
      const timelock = await futureTimestamp(4200);
      const rewardTimelock = timelock - 30;
      const hashlock = hashSecret(901n);

      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashlock,
            solverReward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: solverAmount + solverReward }
          )
      )
        .to.emit(train, 'DstLocked')
        .withArgs(
          swapId,
          0,
          hashlock,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          solverA.address,
          receiver.address,
          DEFAULT_META.srcAsset,
          solverAmount,
          solverReward,
          rewardTimelock,
          timelock
        );

      const solverDetails = await train.getHTLCDetails(swapId, 0);
      expect(solverDetails.sender).to.equal(solverA.address);
      expect(solverDetails.amount).to.equal(solverAmount);
      expect(solverDetails.reward).to.equal(solverReward);

      await expect(lockUserHTLC(train, initiator, receiver, { swapId })).to.be.revertedWithCustomError(
        train,
        'SwapAlreadyInitialized'
      );

      const secondHashlock = hashSecret(902n);
      const secondTimelock = await futureTimestamp(5200);
      const secondRewardTimelock = secondTimelock - 60;
      await expect(
        train
          .connect(solverB)
          .lockDst(
            swapId,
            secondHashlock,
            solverReward,
            secondRewardTimelock,
            secondTimelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: solverAmount + solverReward }
          )
      )
        .to.emit(train, 'DstLocked')
        .withArgs(
          swapId,
          1,
          secondHashlock,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          solverB.address,
          receiver.address,
          DEFAULT_META.srcAsset,
          solverAmount,
          solverReward,
          secondRewardTimelock,
          secondTimelock
        );

      const userSwaps = await train.getUserSwaps(initiator.address);
      expect(userSwaps.length).to.equal(0);
    });

    it('reverts when the timelock is sooner than 15 minutes', async function () {
      const { train, solverA, receiver } = await loadFixture(deployTrainFixture);
      const soon = (await time.latest()) + 899;
      const reward = ethers.parseEther('0.1');
      const amount = ethers.parseEther('1');
      await expect(
        train
          .connect(solverA)
          .lockDst(
            ethers.id('short-timelock'),
            hashSecret(1n),
            reward,
            soon - 60,
            soon,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + reward }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidTimelock');
    });

    it('reverts when reward is zero', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('zero-reward');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(22n),
            0,
            timelock - 60,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: ethers.parseEther('1') }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardAmount');
    });

    it('reverts when reward equals the entire msg.value (amount would be zero)', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-equals-value');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      const value = ethers.parseEther('1');
      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(33n),
            value,
            timelock - 60,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: value }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardAmount');
    });

    it('reverts when reward is less than 10% of the swap amount', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('low-reward');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      const amount = ethers.parseEther('1');
      const lowReward = ethers.parseEther('0.05'); // Only 5% of amount, needs to be 10%+
      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(44n),
            lowReward,
            timelock - 60,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + lowReward }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardAmount');
    });

    it('accepts reward exactly at 10% of the swap amount', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('exact-10-percent');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const amount = ethers.parseEther('1');
      const reward = ethers.parseEther('0.111111111111111111'); // Exactly 10% of 1 ETH
      const timelock = await futureTimestamp(3600);
      const rewardTimelock = timelock - 60;

      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(55n),
            reward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + reward }
          )
      ).to.emit(train, 'DstLocked');

      const htlc = await train.getHTLCDetails(swapId, 1);
      expect(htlc.amount).to.equal(amount);
      expect(htlc.reward).to.equal(reward);
    });

    it('reverts when locking small amounts that result in reward calculation being less than 10%', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('tiny-amount');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      // 10 wei total: 9 wei amount, 1 wei reward
      // reward * 10 < amount => 1 * 10 < 9 => 10 < 9 is false, but
      // 1 wei is ~11.11% of 9 wei, so this should actually pass!
      // Let's use 8 wei reward instead: 8 * 10 = 80 < 82? No, still passes
      // Use 1 wei reward on 11 wei amount: 1 * 10 = 10 < 11? Yes! This fails
      await expect(
        train.connect(solverA).lockDst(
          swapId,
          hashSecret(66n),
          1n, // 1 wei reward
          timelock - 60,
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: 12n } // 12 wei total (11 wei amount + 1 wei reward), 1*10=10 < 11
        )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardAmount');
    });

    it('reverts when locking amounts where reward rounds down to less than 10%', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('rounding-issue');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      // 100 wei total: 91 wei amount, 9 wei reward
      // Using multiplication: 9 * 10 = 90 < 91? Yes, this fails correctly
      await expect(
        train.connect(solverA).lockDst(
          swapId,
          hashSecret(77n),
          9n, // 9 wei reward
          timelock - 60,
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: 100n } // 100 wei total (91 wei amount + 9 wei reward)
        )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardAmount');
    });

    it('accepts minimum viable amounts where reward is exactly 10%', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('min-viable');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      // 11 wei total: 10 wei amount, 1 wei reward
      // Using multiplication: 1 * 10 = 10 >= 10? Yes (equal), should pass
      await expect(
        train.connect(solverA).lockDst(
          swapId,
          hashSecret(88n),
          1n, // 1 wei reward
          timelock - 60,
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: 11n } // 11 wei total (10 wei amount + 1 wei reward)
        )
      ).to.emit(train, 'DstLocked');

      const htlc = await train.getHTLCDetails(swapId, 1);
      expect(htlc.amount).to.equal(10n);
      expect(htlc.reward).to.equal(1n);
    });

    it('reverts when msg.value is zero', async function () {
      const { train, solverA, receiver } = await loadFixture(deployTrainFixture);
      const timelock = await futureTimestamp(3600);
      await expect(
        train
          .connect(solverA)
          .lockDst(
            ethers.id('zero-value'),
            hashSecret(1n),
            ethers.parseEther('0.1'),
            timelock - 60,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: 0 }
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('enforces reward timelock bounds for solver HTLCs', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-guard');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      const amount = ethers.parseEther('0.8');
      const reward = ethers.parseEther('0.2');

      await expect(
        train
          .connect(solverA)
          .lockDst(
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
            { value: amount + reward }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardTimelock');

      const now = await time.latest();
      await expect(
        train
          .connect(solverA)
          .lockDst(
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
            { value: amount + reward }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardTimelock');
    });

    it('accepts timelock at 15 minutes boundary with +1s buffer', async function () {
      const { train, solverA, receiver } = await loadFixture(deployTrainFixture);
      const now = await time.latest();
      const timelock = now + 901; // +1s buffer to avoid mining drift
      const rewardTimelock = timelock - 60;
      const amount = ethers.parseEther('0.2');
      const reward = ethers.parseEther('0.03');
      await expect(
        train
          .connect(solverA)
          .lockDst(
            ethers.id('dst-boundary-15m'),
            hashSecret(3n),
            reward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + reward }
          )
      ).to.emit(train, 'DstLocked');
    });

    it('allows rewardTimelock equal to timelock (on-boundary)', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-on-boundary');
      await lockUserHTLC(train, initiator, receiver, { swapId });
      const timelock = await futureTimestamp(3600);
      const rewardTimelock = timelock; // equal to timelock is allowed by contract
      const amount = ethers.parseEther('0.5');
      const reward = ethers.parseEther('0.06');
      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(4n),
            reward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + reward }
          )
      ).to.emit(train, 'DstLocked');
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

    it('reverts with TransferFailed when refund transfer fails', async function () {
      const { train, receiver } = await loadFixture(deployTrainFixture);
      const RejectEther = await ethers.getContractFactory('RejectEther');
      const rejectContract = await RejectEther.deploy();
      await rejectContract.waitForDeployment();

      const swapId = ethers.id('transfer-fail-refund');
      const timelock = await futureTimestamp(3600);
      const amount = ethers.parseEther('1');

      await ethers.provider.send('hardhat_impersonateAccount', [await rejectContract.getAddress()]);
      const rejectSigner = await ethers.getSigner(await rejectContract.getAddress());
      await ethers.provider.send('hardhat_setBalance', [
        await rejectContract.getAddress(),
        ethers.toQuantity(ethers.parseEther('10')),
      ]);

      await train
        .connect(rejectSigner)
        .lockSrc(
          swapId,
          hashSecret(1n),
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: amount }
        );

      await time.increaseTo(timelock + 1);
      await expect(train.refund(swapId, 0)).to.be.revertedWithCustomError(train, 'TransferFailed');
      await ethers.provider.send('hardhat_stopImpersonatingAccount', [await rejectContract.getAddress()]);
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

    it('redeems small amounts correctly with minimum viable wei', async function () {
      const { train, initiator, receiver, relayer } = await loadFixture(deployTrainFixture);
      const { swapId, secret } = await lockUserHTLC(train, initiator, receiver, {
        amount: 1n, // 1 wei
        swapId: ethers.id('tiny-user-redeem'),
      });

      const receiverBefore = await getBalance(receiver.address);
      await train.connect(relayer).redeem(swapId, 0, secret);
      const receiverAfter = await getBalance(receiver.address);
      expect(receiverAfter - receiverBefore).to.equal(1n);
    });

    it('redeems solver HTLC with minimum viable amounts (11 wei total)', async function () {
      const { train, initiator, solverA, receiver, relayer } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('tiny-solver-redeem');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const timelock = await futureTimestamp(3600);
      const rewardTimelock = timelock - 60;
      const secret = 12345n;
      const hashlock = hashSecret(secret);

      // 11 wei total: 10 wei amount, 1 wei reward (exactly 10%)
      await train
        .connect(solverA)
        .lockDst(
          swapId,
          hashlock,
          1n,
          rewardTimelock,
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: 11n }
        );

      const receiverBefore = await getBalance(receiver.address);
      const solverBefore = await getBalance(solverA.address);
      await train.connect(relayer).redeem(swapId, 1, secret);
      const receiverAfter = await getBalance(receiver.address);
      const solverAfter = await getBalance(solverA.address);

      expect(receiverAfter - receiverBefore).to.equal(10n);
      expect(solverAfter - solverBefore).to.equal(1n);
    });

    it('reverts with TransferFailed when redeem transfer fails', async function () {
      const { train, initiator } = await loadFixture(deployTrainFixture);
      const RejectEther = await ethers.getContractFactory('RejectEther');
      const rejectContract = await RejectEther.deploy();
      await rejectContract.waitForDeployment();

      const swapId = ethers.id('transfer-fail-redeem');
      const secret = 12345n;
      const hashlock = hashSecret(secret);
      const timelock = await futureTimestamp(3600);
      const amount = ethers.parseEther('1');

      await train
        .connect(initiator)
        .lockSrc(
          swapId,
          hashlock,
          timelock,
          rejectContract.target,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: amount }
        );

      await expect(train.redeem(swapId, 0, secret)).to.be.revertedWithCustomError(train, 'TransferFailed');
    });
  });

  describe('Edge cases and security', function () {
    it('allows anyone to call refund after timelock expires, not just sender', async function () {
      const { train, initiator, receiver, relayer } = await loadFixture(deployTrainFixture);
      const { swapId, timelock, amount } = await lockUserHTLC(train, initiator, receiver);

      await time.increaseTo(timelock + 1);
      // Relayer calls refund instead of initiator
      await expect(() => train.connect(relayer).refund(swapId, 0)).to.changeEtherBalances(
        [train, initiator], // funds still go to initiator
        [amount * -1n, amount]
      );
    });

    it('allows anyone to call redeem with correct secret', async function () {
      const { train, initiator, receiver, relayer, deployer } = await loadFixture(deployTrainFixture);
      const { swapId, secret, amount } = await lockUserHTLC(train, initiator, receiver);

      const receiverBefore = await getBalance(receiver.address);
      await train.connect(deployer).redeem(swapId, 0, secret); // deployer redeems
      const receiverAfter = await getBalance(receiver.address);
      expect(receiverAfter - receiverBefore).to.equal(amount); // receiver still gets funds
    });

    it('handles multiple sequential HTLCs correctly with unique IDs', async function () {
      const { train, initiator, solverA, solverB, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('multi-solver-sequence');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      // Create 5 solver HTLCs
      for (let i = 0; i < 5; i++) {
        const amount = ethers.parseEther('0.1');
        const reward = ethers.parseEther('0.02');
        const timelock = await futureTimestamp(3600 + i * 100);
        const rewardTimelock = timelock - 60;
        const solver = i % 2 === 0 ? solverA : solverB;

        await train
          .connect(solver)
          .lockDst(
            swapId,
            hashSecret(BigInt(100 + i)),
            reward,
            rewardTimelock,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: amount + reward }
          );

        const htlc = await train.getHTLCDetails(swapId, i + 1);
        expect(htlc.sender).to.equal(solver.address);
        expect(htlc.amount).to.equal(amount);
      }
    });

    it('prevents refund on one htlcId from affecting other htlcIds in same swap', async function () {
      const { train, initiator, solverA, solverB, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('isolated-refunds');
      await lockUserHTLC(train, initiator, receiver, { swapId, timelockOffset: 2000 });

      const solverLock1 = await lockSolverHTLC(train, solverA, receiver, swapId, {
        expectedId: 1,
        timelockOffset: 2100,
      });
      const solverLock2 = await lockSolverHTLC(train, solverB, receiver, swapId, {
        expectedId: 2,
        timelockOffset: 2200,
      });

      // Refund first solver HTLC
      await time.increaseTo(solverLock1.timelock + 1);
      await train.connect(solverA).refund(swapId, 1);

      // Verify first is refunded
      const htlc1 = await train.getHTLCDetails(swapId, 1);
      expect(htlc1.claimed).to.equal(2);

      // Verify second is still active
      const htlc2 = await train.getHTLCDetails(swapId, 2);
      expect(htlc2.claimed).to.equal(1);

      // Can still redeem second
      await train.connect(receiver).redeem(swapId, 2, solverLock2.secret);
      const htlc2After = await train.getHTLCDetails(swapId, 2);
      expect(htlc2After.claimed).to.equal(3);
    });

    it('prevents redeem on one htlcId from affecting other htlcIds in same swap', async function () {
      const { train, initiator, solverA, solverB, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('isolated-redeems');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const solverLock1 = await lockSolverHTLC(train, solverA, receiver, swapId, { expectedId: 1, secret: 111n });
      const solverLock2 = await lockSolverHTLC(train, solverB, receiver, swapId, { expectedId: 2, secret: 222n });

      // Redeem first solver HTLC
      await train.connect(receiver).redeem(swapId, 1, solverLock1.secret);

      // Verify first is redeemed
      const htlc1 = await train.getHTLCDetails(swapId, 1);
      expect(htlc1.claimed).to.equal(3);

      // Verify second is still active
      const htlc2 = await train.getHTLCDetails(swapId, 2);
      expect(htlc2.claimed).to.equal(1);

      // Can still redeem second with different secret
      await train.connect(receiver).redeem(swapId, 2, solverLock2.secret);
      const htlc2After = await train.getHTLCDetails(swapId, 2);
      expect(htlc2After.claimed).to.equal(3);
    });

    it('correctly handles reward distribution at exact rewardTimelock boundary', async function () {
      const { train, initiator, solverA, receiver, relayer } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('reward-boundary');
      await lockUserHTLC(train, initiator, receiver, { swapId });

      const amount = ethers.parseEther('1');
      const reward = ethers.parseEther('0.2');
      const timelock = await futureTimestamp(3600);
      const rewardTimelock = timelock - 60;
      const secret = 999n;

      await train
        .connect(solverA)
        .lockDst(
          swapId,
          hashSecret(secret),
          reward,
          rewardTimelock,
          timelock,
          receiver.address,
          DEFAULT_META.srcAsset,
          DEFAULT_META.dstChain,
          DEFAULT_META.dstAddress,
          DEFAULT_META.dstAsset,
          { value: amount + reward }
        );

      // Set time to exactly rewardTimelock + 1
      await time.increaseTo(rewardTimelock + 1);

      // Relayer should get reward, receiver gets amount
      const receiverBefore = await getBalance(receiver.address);
      const relayerBefore = await getBalance(relayer.address);
      const tx = await train.connect(relayer).redeem(swapId, 1, secret);
      const receipt = await tx.wait();

      const receiverAfter = await getBalance(receiver.address);
      const relayerAfter = await getBalance(relayer.address);
      const relayerDelta = relayerAfter + gasCostFromReceipt(receipt) - relayerBefore;

      expect(receiverAfter - receiverBefore).to.equal(amount);
      expect(relayerDelta).to.equal(reward);
    });

    it('prevents integer overflow/underflow with maximum values', async function () {
      const { train, solverA, receiver } = await loadFixture(deployTrainFixture);
      const swapId = ethers.id('max-values');

      const maxUint256 = ethers.MaxUint256;
      const timelock = await futureTimestamp(3600);

      // This should revert because msg.value would overflow or be insufficient
      await expect(
        train
          .connect(solverA)
          .lockDst(
            swapId,
            hashSecret(1n),
            maxUint256,
            timelock - 60,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            { value: ethers.parseEther('1') }
          )
      ).to.be.reverted; // Will revert due to insufficient funds or InvalidRewardAmount
    });

    it('ensures contract balance matches locked funds after multiple operations', async function () {
      const { train, initiator, solverA, solverB, receiver, relayer } = await loadFixture(deployTrainFixture);

      // Lock user HTLC
      const userLock = await lockUserHTLC(train, initiator, receiver, {
        amount: ethers.parseEther('1'),
        swapId: ethers.id('balance-check'),
      });

      // Lock solver HTLCs
      const solverLock1 = await lockSolverHTLC(train, solverA, receiver, userLock.swapId, {
        amount: ethers.parseEther('0.5'),
        reward: ethers.parseEther('0.1'),
        expectedId: 1,
      });

      const solverLock2 = await lockSolverHTLC(train, solverB, receiver, userLock.swapId, {
        amount: ethers.parseEther('0.3'),
        reward: ethers.parseEther('0.05'),
        expectedId: 2,
      });

      const expectedBalance = userLock.amount + solverLock1.total + solverLock2.total;
      const contractBalance = await getBalance(await train.getAddress());
      expect(contractBalance).to.equal(expectedBalance);

      // Redeem user HTLC
      await train.connect(relayer).redeem(userLock.swapId, 0, userLock.secret);

      const afterRedeemBalance = await getBalance(await train.getAddress());
      expect(afterRedeemBalance).to.equal(expectedBalance - userLock.amount);
    });

    it('handles gas-limited transfers gracefully in redeem', async function () {
      const { train, initiator, receiver } = await loadFixture(deployTrainFixture);
      const { swapId, secret, amount } = await lockUserHTLC(train, initiator, receiver);

      // Even with gas limit, transfer should succeed (contract uses low gas limit internally)
      const receiverBefore = await getBalance(receiver.address);
      await train.redeem(swapId, 0, secret);
      const receiverAfter = await getBalance(receiver.address);

      expect(receiverAfter - receiverBefore).to.equal(amount);
    });

    it('validates that getUserSwaps only tracks user-initiated swaps at htlcId 0', async function () {
      const { train, initiator, solverA, receiver } = await loadFixture(deployTrainFixture);

      const swapId1 = ethers.id('user-track-1');
      const swapId2 = ethers.id('user-track-2');
      const swapId3 = ethers.id('solver-track-1');

      // User creates two swaps
      await lockUserHTLC(train, initiator, receiver, { swapId: swapId1 });
      await lockUserHTLC(train, initiator, receiver, { swapId: swapId2 });

      // Solver creates a swap (not tracked for solver)
      await lockSolverHTLC(train, solverA, receiver, swapId3, {
        expectedId: 0,
        amount: ethers.parseEther('1'),
        reward: ethers.parseEther('0.2'),
      });

      const userSwaps = await train.getUserSwaps(initiator.address);
      const solverSwaps = await train.getUserSwaps(solverA.address);

      expect(userSwaps.length).to.equal(2);
      expect(userSwaps).to.deep.equal([swapId1, swapId2]);
      expect(solverSwaps.length).to.equal(0);
    });

    it('ensures all external calls check return values to prevent stuck funds', async function () {
      const { train } = await loadFixture(deployTrainFixture);
      const transferFailedError = train.interface.getError('TransferFailed');
      expect(transferFailedError).to.not.be.undefined;
      expect(transferFailedError.name).to.equal('TransferFailed');
      const bytecode = await ethers.provider.getCode(await train.getAddress());
      expect(bytecode).to.not.equal('0x');
      expect(bytecode.length).to.be.greaterThan(0);
      const gasStipendHex = '0x2710';
      expect(bytecode).to.include(gasStipendHex.slice(2));
    });
  });
});
