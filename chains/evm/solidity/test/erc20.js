const { expect } = require('chai');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const hashSecret = (secret) => ethers.sha256(abiCoder.encode(['uint256'], [secret]));
const DEFAULT_META = {
  srcAsset: 'ETH',
  dstChain: 'Linea',
  dstAddress: '0xdestination',
  dstAsset: 'USDC',
};
const TOKEN_MINT = ethers.parseEther('1000');
const futureTimestamp = async (offsetSeconds = 3600) => (await time.latest()) + offsetSeconds;

async function deployTrainERC20Fixture() {
  const [deployer, initiator, solverA, solverB, receiver, relayer] = await ethers.getSigners();
  const TrainERC20 = await ethers.getContractFactory('TrainERC20');
  const train = await TrainERC20.deploy();
  await train.waitForDeployment();

  const TestToken = await ethers.getContractFactory('TestToken');
  const token = await TestToken.deploy();
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const trainAddress = await train.getAddress();
  const holders = [initiator, solverA, solverB, receiver, relayer];

  for (const signer of holders) {
    await token.mint(signer.address, TOKEN_MINT);
    await token.connect(signer).approve(trainAddress, ethers.MaxUint256);
  }

  return { train, token, tokenAddress, trainAddress, deployer, initiator, solverA, solverB, receiver, relayer };
}

async function lockUserHTLC(fixture, overrides = {}) {
  const { train, tokenAddress, initiator, receiver } = fixture;
  const caller = overrides.caller ?? initiator;
  const swapId = overrides.swapId ?? ethers.id(`user-${overrides.label ?? 'default'}`);
  const amount = overrides.amount ?? ethers.parseEther('1');
  const secret = overrides.secret ?? 111n;
  const hashlock = overrides.hashlock ?? hashSecret(secret);
  const timelock = overrides.timelock ?? (await futureTimestamp(overrides.timelockOffset ?? 3600));
  const meta = { ...DEFAULT_META, ...overrides.meta };
  const srcReceiver = overrides.srcReceiver ?? receiver.address;

  await train
    .connect(caller)
    .lock(
      swapId,
      hashlock,
      0,
      0,
      timelock,
      srcReceiver,
      meta.srcAsset,
      meta.dstChain,
      meta.dstAddress,
      meta.dstAsset,
      amount,
      tokenAddress
    );

  return { swapId, amount, secret, hashlock, timelock, srcReceiver, htlcId: 0 };
}

async function lockSolverHTLC(fixture, swapId, overrides = {}) {
  const { train, tokenAddress, receiver } = fixture;
  const caller = overrides.caller ?? fixture.solverA;
  const amount = overrides.amount ?? ethers.parseEther('0.5');
  const reward = overrides.reward ?? ethers.parseEther('0.05');
  const secret = overrides.secret ?? 222n;
  const hashlock = overrides.hashlock ?? hashSecret(secret);
  const timelock = overrides.timelock ?? (await futureTimestamp(overrides.timelockOffset ?? 3600));
  const rewardTimelock = overrides.rewardTimelock ?? (reward > 0n ? timelock - (overrides.rewardLead ?? 120) : 0);
  const meta = { ...DEFAULT_META, ...overrides.meta };
  const srcReceiver = overrides.srcReceiver ?? receiver.address;
  const expectedId = overrides.expectedId ?? 1;

  await train
    .connect(caller)
    .lock(
      swapId,
      hashlock,
      reward,
      rewardTimelock,
      timelock,
      srcReceiver,
      meta.srcAsset,
      meta.dstChain,
      meta.dstAddress,
      meta.dstAsset,
      amount,
      tokenAddress
    );

  return { swapId, amount, reward, secret, hashlock, timelock, rewardTimelock, srcReceiver, htlcId: expectedId };
}

describe('TrainERC20', function () {
  describe('lock', function () {
    it('initializes a user HTLC and tracks the swap owner history', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, tokenAddress } = fixture;
      const swapId = ethers.id('erc20-user-init');
      const secret = 333n;
      const hashlock = hashSecret(secret);
      const amount = ethers.parseEther('5');
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
            amount,
            tokenAddress
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
          timelock,
          tokenAddress
        );

      const details = await train.getHTLCDetails(swapId, 0);
      expect(details.amount).to.equal(amount);
      expect(details.hashlock).to.equal(hashlock);
      expect(details.sender).to.equal(initiator.address);
      expect(details.srcReceiver).to.equal(receiver.address);
      expect(details.timelock).to.equal(timelock);
      expect(details.claimed).to.equal(1);

      const swaps = await train.getUserSwaps(initiator.address);
      expect(swaps).to.deep.equal([swapId]);
    });

    it('prevents duplicate user initialization for a swapId', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, tokenAddress } = fixture;
      const swapId = ethers.id('erc20-duplicate');
      const amount = ethers.parseEther('2');
      const timelock = await futureTimestamp(3600);
      const hashlock = hashSecret(44n);

      await train
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
          amount,
          tokenAddress
        );

      await expect(
        train
          .connect(initiator)
          .lock(
            swapId,
            hashSecret(55n),
            0,
            0,
            timelock + 100,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            amount,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'SwapAlreadyInitialized');
    });

    it('allows multiple solver HTLCs with incrementing IDs', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, solverA, solverB, receiver } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-solvers') });

      const solverReward = ethers.parseEther('0.1');
      const solverAmount = ethers.parseEther('0.8');
      const timelock = await futureTimestamp(4000);
      const rewardTimelock = timelock - 60;
      const hashlock = hashSecret(777n);

      await expect(
        train
          .connect(solverA)
          .lock(
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
            solverAmount,
            fixture.tokenAddress
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
          solverReward,
          rewardTimelock,
          timelock,
          fixture.tokenAddress
        );

      const secondHashlock = hashSecret(888n);
      const secondTimelock = await futureTimestamp(5000);
      const secondRewardTimelock = secondTimelock - 120;

      await expect(
        train
          .connect(solverB)
          .lock(
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
            solverAmount,
            fixture.tokenAddress
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
          solverReward,
          secondRewardTimelock,
          secondTimelock,
          fixture.tokenAddress
        );

      const solverDetails = await train.getHTLCDetails(swapId, 2);
      expect(solverDetails.sender).to.equal(solverB.address);
      expect(solverDetails.reward).to.equal(solverReward);
    });

    it('allows solver-first swaps but blocks later user initialization', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, solverA, solverB, receiver } = fixture;
      const swapId = ethers.id('erc20-solver-first');
      const solverAmount = ethers.parseEther('0.7');
      const solverReward = ethers.parseEther('0.2');
      const timelock = await futureTimestamp(3600);
      const rewardTimelock = timelock - 30;
      const hashlock = hashSecret(901n);

      await expect(
        train
          .connect(solverA)
          .lock(
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
            solverAmount,
            fixture.tokenAddress
          )
      ).to.emit(train, 'SolverLocked');

      await expect(
        lockUserHTLC(fixture, { swapId, caller: initiator, hashlock: hashSecret(902n) })
      ).to.be.revertedWithCustomError(train, 'SwapAlreadyInitialized');

      await expect(
        train
          .connect(solverB)
          .lock(
            swapId,
            hashSecret(903n),
            solverReward,
            rewardTimelock,
            timelock + 300,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            solverAmount,
            fixture.tokenAddress
          )
      ).to.emit(train, 'SolverLocked');

      const userSwaps = await train.getUserSwaps(initiator.address);
      expect(userSwaps.length).to.equal(0);
    });

    it('requires timelocks to be at least 15 minutes in the future', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, tokenAddress } = fixture;
      const soon = (await time.latest()) + 899;
      await expect(
        train
          .connect(initiator)
          .lock(
            ethers.id('erc20-short-timelock'),
            hashSecret(1n),
            0,
            0,
            soon,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            ethers.parseEther('1'),
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'InvalidTimelock');
    });

    it('enforces reward timelock bounds for solver HTLCs', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, tokenAddress } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-reward-guard') });
      const timelock = await futureTimestamp(3600);
      const reward = ethers.parseEther('0.2');

      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashSecret(22n),
            reward,
            timelock + 1,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            ethers.parseEther('0.5'),
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardTimelock');

      const now = await time.latest();
      await expect(
        train
          .connect(solverA)
          .lock(
            swapId,
            hashSecret(23n),
            reward,
            now,
            timelock,
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            ethers.parseEther('0.5'),
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'InvalidRewardTimelock');
    });

    it('requires non-zero token amount', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, tokenAddress } = fixture;
      await expect(
        train
          .connect(initiator)
          .lock(
            ethers.id('erc20-zero-amount'),
            hashSecret(6n),
            0,
            0,
            await futureTimestamp(),
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            0,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('requires allowance to cover amount plus reward', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, token, tokenAddress, trainAddress } = fixture;
      const amount = ethers.parseEther('2');
      const reward = ethers.parseEther('1');
      await token.connect(initiator).approve(trainAddress, amount); // approve only amount

      await expect(
        train
          .connect(initiator)
          .lock(
            ethers.id('erc20-allowance'),
            hashSecret(90n),
            reward,
            (await futureTimestamp(3600)) - 60,
            await futureTimestamp(3600),
            receiver.address,
            DEFAULT_META.srcAsset,
            DEFAULT_META.dstChain,
            DEFAULT_META.dstAddress,
            DEFAULT_META.dstAsset,
            amount,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(train, 'NoAllowance');
    });
  });

  describe('refund', function () {
    it('reverts for unknown HTLCs', async function () {
      const { train } = await loadFixture(deployTrainERC20Fixture);
      await expect(train.refund(ethers.id('erc20-missing'), 0)).to.be.revertedWithCustomError(train, 'HTLCNotExists');
    });

    it('reverts before the timelock expires', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-refund-too-soon') });
      await expect(train.connect(initiator).refund(swapId, 0)).to.be.revertedWithCustomError(
        train,
        'NotPassedTimelock'
      );
    });

    it('refunds user HTLCs and marks them claimed', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator, receiver, token } = fixture;
      const { swapId, timelock, amount } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-refund-user') });

      await time.increaseTo(timelock + 1);
      const balanceBefore = await token.balanceOf(initiator.address);
      await expect(train.connect(initiator).refund(swapId, 0)).to.emit(train, 'TokenRefunded').withArgs(swapId, 0);
      const balanceAfter = await token.balanceOf(initiator.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);

      const details = await train.getHTLCDetails(swapId, 0);
      expect(details.claimed).to.equal(2);
    });

    it('refunds solver HTLCs including the reward', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, initiator, token } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { caller: initiator, swapId: ethers.id('erc20-refund-solver') });
      const solverLock = await lockSolverHTLC(fixture, swapId, {
        caller: solverA,
        amount: ethers.parseEther('0.9'),
        reward: ethers.parseEther('0.3'),
        expectedId: 1,
      });

      await time.increaseTo(solverLock.timelock + 1);
      const balanceBefore = await token.balanceOf(solverA.address);
      await train.connect(solverA).refund(swapId, solverLock.htlcId);
      const balanceAfter = await token.balanceOf(solverA.address);
      expect(balanceAfter - balanceBefore).to.equal(solverLock.amount + solverLock.reward);
    });

    it('cannot refund twice', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, initiator } = fixture;
      const { swapId, timelock } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-refund-double') });
      await time.increaseTo(timelock + 1);
      await train.connect(initiator).refund(swapId, 0);
      await expect(train.connect(initiator).refund(swapId, 0)).to.be.revertedWithCustomError(train, 'AlreadyClaimed');
    });
  });

  describe('redeem', function () {
    it('redeems a user HTLC and stores the secret', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, receiver, relayer } = fixture;
      const { swapId, secret, hashlock, amount } = await lockUserHTLC(fixture, {
        swapId: ethers.id('erc20-redeem-user'),
        secret: 888n,
        amount: ethers.parseEther('1.2'),
      });

      const balBefore = await fixture.token.balanceOf(receiver.address);
      await expect(train.connect(relayer).redeem(swapId, 0, secret))
        .to.emit(train, 'TokenRedeemed')
        .withArgs(swapId, 0, relayer.address, secret, hashlock);
      const balAfter = await fixture.token.balanceOf(receiver.address);
      expect(balAfter - balBefore).to.equal(amount);

      const details = await train.getHTLCDetails(swapId, 0);
      expect(details.claimed).to.equal(3);
      expect(details.secret).to.equal(secret);
    });

    it('pays solver reward to the sender if redeemed before reward timelock', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, relayer, token } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-redeem-before') });
      const solverLock = await lockSolverHTLC(fixture, swapId, {
        caller: solverA,
        amount: ethers.parseEther('0.8'),
        reward: ethers.parseEther('0.15'),
        expectedId: 1,
      });

      const solverBefore = await token.balanceOf(solverA.address);
      const receiverBefore = await token.balanceOf(receiver.address);
      await train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret);
      const solverAfter = await token.balanceOf(solverA.address);
      const receiverAfter = await token.balanceOf(receiver.address);
      expect(solverAfter - solverBefore).to.equal(solverLock.reward);
      expect(receiverAfter - receiverBefore).to.equal(solverLock.amount);
    });

    it('lets the receiver claim reward after the reward timelock', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, token } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-redeem-receiver') });
      const solverLock = await lockSolverHTLC(fixture, swapId, {
        caller: solverA,
        amount: ethers.parseEther('0.6'),
        reward: ethers.parseEther('0.2'),
        rewardLead: 10,
        expectedId: 1,
      });

      await time.increaseTo(solverLock.rewardTimelock + 1);
      const receiverBefore = await token.balanceOf(receiver.address);
      await train.connect(receiver).redeem(swapId, solverLock.htlcId, solverLock.secret);
      const receiverAfter = await token.balanceOf(receiver.address);
      expect(receiverAfter - receiverBefore).to.equal(solverLock.amount + solverLock.reward);
    });

    it('awards the reward to a relayer after the reward timelock when receiver differs', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, relayer, token } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-redeem-relayer') });
      const solverLock = await lockSolverHTLC(fixture, swapId, {
        caller: solverA,
        amount: ethers.parseEther('0.7'),
        reward: ethers.parseEther('0.25'),
        rewardLead: 5,
        expectedId: 1,
      });

      await time.increaseTo(solverLock.rewardTimelock + 1);
      const receiverBefore = await token.balanceOf(receiver.address);
      const relayerBefore = await token.balanceOf(relayer.address);
      await train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret);
      const receiverAfter = await token.balanceOf(receiver.address);
      const relayerAfter = await token.balanceOf(relayer.address);
      expect(receiverAfter - receiverBefore).to.equal(solverLock.amount);
      expect(relayerAfter - relayerBefore).to.equal(solverLock.reward);
    });

    it('reverts if the secret is invalid or HTLC missing or already claimed', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { train, solverA, receiver, relayer } = fixture;
      const { swapId } = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-redeem-guards') });
      const solverLock = await lockSolverHTLC(fixture, swapId, { caller: solverA, expectedId: 1 });

      await expect(train.connect(relayer).redeem(swapId, solverLock.htlcId, 999n)).to.be.revertedWithCustomError(
        train,
        'HashlockNotMatch'
      );
      await expect(
        train.connect(relayer).redeem(ethers.id('missing'), 0, solverLock.secret)
      ).to.be.revertedWithCustomError(train, 'HTLCNotExists');

      await train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret);
      await expect(
        train.connect(relayer).redeem(swapId, solverLock.htlcId, solverLock.secret)
      ).to.be.revertedWithCustomError(train, 'AlreadyClaimed');

      const refunded = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-redeem-after-refund'), secret: 999n });
      await time.increaseTo(refunded.timelock + 1);
      await train.connect(receiver).refund(refunded.swapId, 0);
      await expect(train.connect(relayer).redeem(refunded.swapId, 0, refunded.secret)).to.be.revertedWithCustomError(
        train,
        'AlreadyClaimed'
      );
    });
  });

  describe('view helpers', function () {
    it('returns zeroed struct for unknown HTLCs', async function () {
      const { train } = await loadFixture(deployTrainERC20Fixture);
      const details = await train.getHTLCDetails(ethers.id('erc20-view-missing'), 9);
      expect(details.amount).to.equal(0n);
      expect(details.sender).to.equal(ethers.ZeroAddress);
      expect(details.hashlock).to.equal(ethers.ZeroHash);
    });

    it('tracks user swaps while ignoring solver-only locks', async function () {
      const fixture = await loadFixture(deployTrainERC20Fixture);
      const { initiator, solverA, receiver, train } = fixture;
      const first = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-view-user1') });
      const second = await lockUserHTLC(fixture, { swapId: ethers.id('erc20-view-user2') });
      await lockSolverHTLC(fixture, second.swapId, { caller: solverA, expectedId: 1 });

      const swaps = await train.getUserSwaps(initiator.address);
      expect(swaps).to.deep.equal([first.swapId, second.swapId]);
    });
  });
});
