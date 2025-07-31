const { expect } = require('chai');
const { ignition } = require('hardhat');
const { keccak256, toUtf8Bytes, parseEther, formatEther } = require('ethers');
const Train = require('../ignition/modules/deployETH');

describe('Train native tests', () => {
  let train, deployer, user1, user2;
  let hopChains, hopAssets, hopAddresses, dstChain, dstAsset, dstAddress, srcAsset, srcReceiver;
  let snapshotId;

  beforeEach(async () => {
    [deployer, user1, user2] = await ethers.getSigners();
    ({ train } = await ignition.deploy(Train));
    hopChains = ['ETH'];
    hopAssets = ['ETH'];
    hopAddresses = [user1.address];
    dstChain = 'ETH';
    dstAsset = 'ETH';
    dstAddress = user1.address;
    srcAsset = 'ETH';
    srcReceiver = user2.address;
    // Take a snapshot after every fresh deploy
    snapshotId = await ethers.provider.send('evm_snapshot');
  });

  // ======================
  //         COMMIT
  // ======================
  describe('commit', () => {
    it('should deploy Train contract', async () => {
      expect(await train.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    });

    it('commits funds and emits TokenCommitted', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock = now + 3600;
      const Id = keccak256(toUtf8Bytes('case1'));
      const value = parseEther('1');

      await expect(
        train
          .connect(user1)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id,
            srcReceiver,
            timelock,
            { value }
          )
      )
        .to.emit(train, 'TokenCommitted')
        .withArgs(
          Id,
          hopChains,
          hopAssets,
          hopAddresses,
          dstChain,
          dstAddress,
          dstAsset,
          user1.address,
          srcReceiver,
          srcAsset,
          value,
          timelock
        );

      // Verify storage
      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.amount).to.equal(value);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(srcReceiver);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);
    });

    it('commit reverts if no value sent', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock = now + 3600;
      const Id = keccak256(toUtf8Bytes('case2'));

      await expect(
        train
          .connect(user1)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id,
            srcReceiver,
            timelock
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('commit reverts if HTLC with same Id exists', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock = now + 3600;
      const Id = keccak256(toUtf8Bytes('case3'));
      const value = parseEther('1');

      // First commit is successful
      await train
        .connect(user1)
        .commit(
          hopChains,
          hopAssets,
          hopAddresses,
          dstChain,
          dstAsset,
          dstAddress,
          srcAsset,
          Id,
          srcReceiver,
          timelock,
          {
            value,
          }
        );

      // Second commit with same Id should fail
      await expect(
        train
          .connect(user1)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id,
            srcReceiver,
            timelock,
            { value }
          )
      ).to.be.revertedWithCustomError(train, 'HTLCAlreadyExists');
    });

    it('reverts if timelock is less than 15 minutes in the future', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock = now + 100; // Less than 900 seconds
      const Id = keccak256(toUtf8Bytes('case4'));
      const value = parseEther('1');

      await expect(
        train
          .connect(user1)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id,
            srcReceiver,
            timelock,
            { value }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidTimelock');
    });

    it('allows different users to commit unique Ids', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock1 = now + 2000;
      const timelock2 = now + 3000;
      const Id1 = keccak256(toUtf8Bytes('user1-case'));
      const Id2 = keccak256(toUtf8Bytes('user2-case'));
      const value = parseEther('1');

      await expect(
        train
          .connect(user1)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id1,
            srcReceiver,
            timelock1,
            { value }
          )
      ).to.emit(train, 'TokenCommitted');

      await expect(
        train
          .connect(user2)
          .commit(
            hopChains,
            hopAssets,
            hopAddresses,
            dstChain,
            dstAsset,
            dstAddress,
            srcAsset,
            Id2,
            user2.address,
            timelock2,
            { value }
          )
      ).to.emit(train, 'TokenCommitted');
    });

    it('commit stores correct data for the new HTLC', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock = now + 5000;
      const Id = keccak256(toUtf8Bytes('datacase'));
      const value = parseEther('2');

      const tx = await train
        .connect(user1)
        .commit(
          [],
          [],
          [],
          dstChain,
          dstAsset,
          dstAddress,
          srcAsset,
          Id,
          srcReceiver,
          timelock,
          {
            value,
          }
        );

      const receipt = await tx.wait();
      console.log(`Actual gas used commit (hop depth is 0): ${receipt.gasUsed.toString()}`);

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.amount).to.equal(value);
      expect(htlc.hashlock).to.equal('0x0100000000000000000000000000000000000000000000000000000000000000');
      expect(htlc.secret).to.equal(1n);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(srcReceiver);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);
    });
  });

  // ======================
  //         REFUND
  // ======================
  describe('refund', () => {
    let Id, timelock, value;

    beforeEach(async () => {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot');
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      timelock = now + 1200;
      Id = keccak256(toUtf8Bytes('refund-case'));
      value = parseEther('1');
      await train
        .connect(user1)
        .commit(
          hopChains,
          hopAssets,
          hopAddresses,
          dstChain,
          dstAsset,
          dstAddress,
          srcAsset,
          Id,
          srcReceiver,
          timelock,
          { value }
        );
    });

    it('reverts if HTLC does not exist', async () => {
      const randomId = keccak256(toUtf8Bytes('random-case'));
      await expect(train.connect(user1).refund(randomId)).to.be.revertedWithCustomError(train, 'HTLCNotExists');
    });

    it('reverts if HTLC is already claimed (refunded)', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await train.connect(user1).refund(Id);

      await expect(train.connect(user1).refund(Id)).to.be.revertedWithCustomError(train, 'AlreadyClaimed');
    });

    it('reverts if timelock has not passed', async () => {
      await expect(train.connect(user1).refund(Id)).to.be.revertedWithCustomError(train, 'NotPassedTimelock');
    });

    it('refunds after timelock and emits TokenRefunded', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await expect(train.connect(user1).refund(Id)).to.emit(train, 'TokenRefunded').withArgs(Id);

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.claimed).to.equal(2);
    });

    it('refunds full amount to sender (without reward)', async () => {
      const balBefore = await ethers.provider.getBalance(user1.address);

      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      const tx = await train.connect(user1).refund(Id);
      const receipt = await tx.wait();
      console.log(`Actual gas used refund (no reward): ${receipt.gasUsed.toString()}`);

      const balAfter = await ethers.provider.getBalance(user1.address);
      // Allow for gas slippage; should get almost all their ETH back
      expect(balAfter).to.be.above(balBefore - parseEther('0.01'));
    });

    it('refunds full amount + reward if present', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock2 = now + 1900;
      const Id2 = keccak256(toUtf8Bytes('refund-reward-case'));
      const reward = parseEther('0.1');
      const total = parseEther('1');
      const rewardTimelock = timelock2 - 100;

      await train
        .connect(user1)
        .lock(
          Id2,
          keccak256(toUtf8Bytes('hashlock')),
          reward,
          rewardTimelock,
          timelock2,
          srcReceiver,
          srcAsset,
          dstChain,
          dstAddress,
          dstAsset,
          { value: total }
        );
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock2 + 1]);
      await ethers.provider.send('evm_mine');
      await expect(train.connect(user1).refund(Id2)).to.emit(train, 'TokenRefunded').withArgs(Id2);

      const htlc = await train.getHTLCDetails(Id2);
      expect(htlc.claimed).to.equal(2);
    });
  });

  // ======================
  //         LOCK
  // ======================
  describe('lock', () => {
    let Id, hashlock, reward, rewardTimelock, timelock, value;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      Id = keccak256(toUtf8Bytes('lock-case'));
      hashlock = keccak256(toUtf8Bytes('secret1'));
      reward = parseEther('0.1');
      timelock = now + 2000;
      rewardTimelock = timelock - 100;
      value = parseEther('1');
    });

    it('locks funds and emits TokenLocked event', async () => {
      await expect(
        train
          .connect(user1)
          .lock(Id, hashlock, reward, rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAddress, dstAsset, {
            value,
          })
      )
        .to.emit(train, 'TokenLocked')
        .withArgs(
          Id,
          hashlock,
          dstChain,
          dstAddress,
          dstAsset,
          user1.address,
          srcReceiver,
          srcAsset,
          value - reward,
          reward,
          rewardTimelock,
          timelock
        );

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.amount).to.equal(value - reward);
      expect(htlc.hashlock).to.equal(hashlock);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(srcReceiver);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);

      const rewardStruct = await train.getRewardDetails(Id);
      expect(rewardStruct.amount).to.equal(reward);
      expect(rewardStruct.timelock).to.equal(rewardTimelock);
    });

    it('reverts if timelock is less than 1800 seconds in the future', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const badTimelock = now + 1000;
      const Id2 = keccak256(toUtf8Bytes('lock-bad-timelock'));

      await expect(
        train
          .connect(user1)
          .lock(
            Id2,
            hashlock,
            reward,
            rewardTimelock,
            badTimelock,
            srcReceiver,
            srcAsset,
            dstChain,
            dstAddress,
            dstAsset,
            { value }
          )
      ).to.be.revertedWithCustomError(train, 'InvalidTimelock');
    });

    it('reverts if rewardTimelock > timelock', async () => {
      const badRewardTimelock = timelock + 100;
      const Id2 = keccak256(toUtf8Bytes('lock-bad-reward-tl'));

      await expect(
        train
          .connect(user1)
          .lock(
            Id2,
            hashlock,
            reward,
            badRewardTimelock,
            timelock,
            srcReceiver,
            srcAsset,
            dstChain,
            dstAddress,
            dstAsset,
            { value }
          )
      ).to.be.revertedWithCustomError(train, 'InvaliRewardTimelock');
    });

    it('reverts if rewardTimelock <= now', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const badRewardTimelock = now;
      const Id2 = keccak256(toUtf8Bytes('lock-bad-reward-tl2'));

      await expect(
        train
          .connect(user1)
          .lock(
            Id2,
            hashlock,
            reward,
            badRewardTimelock,
            timelock,
            srcReceiver,
            srcAsset,
            dstChain,
            dstAddress,
            dstAsset,
            { value }
          )
      ).to.be.revertedWithCustomError(train, 'InvaliRewardTimelock');
    });

    it('reverts if HTLC with same Id already exists', async () => {
      await train
        .connect(user1)
        .lock(Id, hashlock, reward, rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAddress, dstAsset, {
          value,
        });

      await expect(
        train
          .connect(user1)
          .lock(Id, hashlock, reward, rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAddress, dstAsset, {
            value,
          })
      ).to.be.revertedWithCustomError(train, 'HTLCAlreadyExists');
    });

    it('reverts if sent value is zero', async () => {
      const Id2 = keccak256(toUtf8Bytes('lock-zero-value'));

      await expect(
        train
          .connect(user1)
          .lock(Id2, hashlock, reward, rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAddress, dstAsset)
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('reverts if sent value is <= reward', async () => {
      const Id2 = keccak256(toUtf8Bytes('lock-low-value'));

      await expect(
        train
          .connect(user1)
          .lock(
            Id2,
            hashlock,
            reward,
            rewardTimelock,
            timelock,
            srcReceiver,
            srcAsset,
            dstChain,
            dstAddress,
            dstAsset,
            { value: reward }
          )
      ).to.be.revertedWithCustomError(train, 'FundsNotSent');
    });

    it('stores no reward if reward is 0', async () => {
      const Id2 = keccak256(toUtf8Bytes('lock-no-reward'));
      const noReward = 0n;

      const tx = await train
        .connect(user1)
        .lock(
          Id2,
          hashlock,
          noReward,
          rewardTimelock,
          timelock,
          srcReceiver,
          srcAsset,
          dstChain,
          dstAddress,
          dstAsset,
          { value }
        );

      const receipt = await tx.wait();
      console.log(`Actual gas used lock (no reward): ${receipt.gasUsed.toString()}`);

      const rewardStruct = await train.getRewardDetails(Id2);
      expect(rewardStruct.amount).to.equal(noReward);
      expect(rewardStruct.timelock).to.equal(0);
    });
  });

  // ======================
  //         ADDLOCK
  // ======================

  describe('addLock', () => {
    let Id, hashlock, newHashlock, newTimelock, timelock, value;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      Id = keccak256(toUtf8Bytes('addlock-case'));
      hashlock = keccak256(toUtf8Bytes('original-hashlock'));
      newHashlock = keccak256(toUtf8Bytes('new-hashlock'));
      timelock = now + 2000;
      newTimelock = timelock + 1000;
      value = parseEther('1');

      // Commit a basic HTLC using commit() (addLock only works on existing HTLCs)
      await train
        .connect(user1)
        .commit(
          hopChains,
          hopAssets,
          hopAddresses,
          dstChain,
          dstAsset,
          dstAddress,
          srcAsset,
          Id,
          srcReceiver,
          timelock,
          { value }
        );
    });

    it('adds hashlock and updates timelock if sender is correct and hashlock not set', async () => {
      await expect(train.connect(user1).addLock(Id, newHashlock, newTimelock))
        .to.emit(train, 'TokenLockAdded')
        .withArgs(Id, newHashlock, newTimelock);

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.hashlock).to.equal(newHashlock);
      expect(htlc.timelock).to.equal(newTimelock);
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('not-exist'));
      await expect(train.connect(user1).addLock(fakeId, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        train,
        'HTLCNotExists'
      );
    });

    it('reverts if sender is not HTLC creator', async () => {
      await expect(train.connect(user2).addLock(Id, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        train,
        'NoAllowance'
      );
    });

    it('reverts if hashlock already set', async () => {
      // First, set the hashlock successfully
      const tx = await train.connect(user1).addLock(Id, newHashlock, newTimelock);
      const receipt = await tx.wait();
      console.log(`Actual gas used addLock: ${receipt.gasUsed.toString()}`);

      // Second, try to set it again (should revert)
      await expect(train.connect(user1).addLock(Id, hashlock, timelock + 2000)).to.be.revertedWithCustomError(
        train,
        'HashlockAlreadySet'
      );
    });

    it('reverts if timelock is less than 15 minutes ahead', async () => {
      const block = await ethers.provider.getBlock('latest');
      const badTimelock = block.timestamp + 100; // Less than 900
      await expect(train.connect(user1).addLock(Id, newHashlock, badTimelock)).to.be.revertedWithCustomError(
        train,
        'InvalidTimelock'
      );
    });

    it('reverts if HTLC is already claimed', async () => {
      // Simulate as if HTLC was refunded
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await train.connect(user1).refund(Id);

      // Now, addLock should revert
      await expect(train.connect(user1).addLock(Id, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        train,
        'AlreadyClaimed'
      );
    });
  });

  // ======================
  //       ADDLOCKSIG
  // ======================
  describe('addLockSig', () => {
    let Id, hashlock, newHashlock, newTimelock, timelock, value, message, domain, types, signer, signature, r, s, v;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      Id = keccak256(toUtf8Bytes('addlocksig-case'));
      hashlock = keccak256(toUtf8Bytes('original-hashlock'));
      newHashlock = keccak256(toUtf8Bytes('new-hashlock'));
      timelock = now + 2000;
      newTimelock = timelock + 1000;
      value = parseEther('1');
      signer = user1;

      // Commit HTLC as user1 (the signer)
      await train
        .connect(signer)
        .commit(
          hopChains,
          hopAssets,
          hopAddresses,
          dstChain,
          dstAsset,
          dstAddress,
          srcAsset,
          Id,
          srcReceiver,
          timelock,
          { value }
        );

      // Prepare EIP-712 domain and types (must match the contract)
      domain = {
        name: 'Train',
        version: '1',
        chainId: await signer.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await train.getAddress(),
      };
      types = {
        addLockMsg: [
          { name: 'Id', type: 'bytes32' },
          { name: 'hashlock', type: 'bytes32' },
          { name: 'timelock', type: 'uint48' },
        ],
      };
      message = {
        Id,
        hashlock: newHashlock,
        timelock: newTimelock,
      };

      // Sign the typed data as user1
      signature = await signer.signTypedData(domain, types, message);
      r = '0x' + signature.slice(2, 66);
      s = '0x' + signature.slice(66, 130);
      v = parseInt(signature.slice(130, 132), 16);
    });

    it('adds hashlock and updates timelock via valid signature', async () => {
      await expect(train.connect(user2).addLockSig(message, r, s, v))
        .to.emit(train, 'TokenLockAdded')
        .withArgs(Id, newHashlock, newTimelock);

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.hashlock).to.equal(newHashlock);
      expect(htlc.timelock).to.equal(newTimelock);
    });

    it('reverts if signature is from a different signer', async () => {
      // Sign with user2 (not HTLC creator)
      const badSignature = await user2.signTypedData(domain, types, message);
      const badR = '0x' + badSignature.slice(2, 66);
      const badS = '0x' + badSignature.slice(66, 130);
      const badV = parseInt(badSignature.slice(130, 132), 16);

      await expect(train.connect(user2).addLockSig(message, badR, badS, badV)).to.be.revertedWithCustomError(
        train,
        'InvalidSignature'
      );
    });

    it('reverts if not enough timelock', async () => {
      const block = await ethers.provider.getBlock('latest');
      const badTimelock = block.timestamp + 100; // <900s in future
      const badMessage = { ...message, timelock: badTimelock };

      // Must sign the new message!
      const badSignature = await signer.signTypedData(domain, types, badMessage);
      const badR = '0x' + badSignature.slice(2, 66);
      const badS = '0x' + badSignature.slice(66, 130);
      const badV = parseInt(badSignature.slice(130, 132), 16);

      await expect(train.connect(user2).addLockSig(badMessage, badR, badS, badV)).to.be.revertedWithCustomError(
        train,
        'InvalidTimelock'
      );
    });

    it('reverts if hashlock already set', async () => {
      // Set it first time
      const tx = await train.connect(user2).addLockSig(message, r, s, v);
      const receipt = await tx.wait();
      console.log(`Actual gas used addLockSig: ${receipt.gasUsed.toString()}`);

      // Try again with a new signature (for a different hashlock)
      const altMessage = { ...message, hashlock: keccak256(toUtf8Bytes('alt')) };
      const altSignature = await signer.signTypedData(domain, types, altMessage);
      const altR = '0x' + altSignature.slice(2, 66);
      const altS = '0x' + altSignature.slice(66, 130);
      const altV = parseInt(altSignature.slice(130, 132), 16);

      await expect(train.connect(user2).addLockSig(altMessage, altR, altS, altV)).to.be.revertedWithCustomError(
        train,
        'HashlockAlreadySet'
      );
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('nohtlc'));
      const fakeMsg = { ...message, Id: fakeId };
      const fakeSig = await signer.signTypedData(domain, types, fakeMsg);
      const fakeR = '0x' + fakeSig.slice(2, 66);
      const fakeS = '0x' + fakeSig.slice(66, 130);
      const fakeV = parseInt(fakeSig.slice(130, 132), 16);

      await expect(train.connect(user2).addLockSig(fakeMsg, fakeR, fakeS, fakeV)).to.be.revertedWithCustomError(
        train,
        'HTLCNotExists'
      );
    });

    it('reverts if HTLC is already claimed', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await train.connect(user1).refund(Id);

      await expect(train.connect(user2).addLockSig(message, r, s, v)).to.be.revertedWithCustomError(
        train,
        'AlreadyClaimed'
      );
    });
  });

  // ======================
  //         REDEEM
  // ======================
  describe('redeem', () => {
    let Id, secret, hashlock, timelock, value, reward, rewardTimelock;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      Id = keccak256(toUtf8Bytes('redeem-case'));
      secret = 42n;
      hashlock = await ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [secret]));
      timelock = now + 2000;
      value = parseEther('1');
      reward = parseEther('0.1');
      rewardTimelock = timelock - 100;

      // Create an HTLC using lock
      await train
        .connect(user1)
        .lock(Id, hashlock, reward, rewardTimelock, timelock, srcReceiver, srcAsset, dstChain, dstAddress, dstAsset, {
          value,
        });
    });

    it('redeems funds with correct secret and emits TokenRedeemed', async () => {
      await expect(train.connect(user2).redeem(Id, secret))
        .to.emit(train, 'TokenRedeemed')
        .withArgs(Id, user2.address, secret, hashlock);

      const htlc = await train.getHTLCDetails(Id);
      expect(htlc.claimed).to.equal(3);
      expect(htlc.secret).to.equal(secret);
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('nohtlc'));
      await expect(train.connect(user2).redeem(fakeId, secret)).to.be.revertedWithCustomError(train, 'HTLCNotExists');
    });

    it('reverts if secret does not match hashlock', async () => {
      await expect(train.connect(user2).redeem(Id, 999n)).to.be.revertedWithCustomError(train, 'HashlockNotMatch');
    });

    it('reverts if HTLC is already claimed (redeemed)', async () => {
      await train.connect(user2).redeem(Id, secret);

      await expect(train.connect(user2).redeem(Id, secret)).to.be.revertedWithCustomError(train, 'AlreadyClaimed');
    });

    it('reverts if HTLC is already claimed (refunded)', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await train.connect(user1).refund(Id);

      await expect(train.connect(user2).redeem(Id, secret)).to.be.revertedWithCustomError(train, 'AlreadyClaimed');
    });

    it('redeems without reward: receiver gets all funds', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const Id = keccak256(toUtf8Bytes('redeem-no-reward'));
      const secret = 42n;
      const hashlock = await ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [secret]));
      const timelock = now + 2000;
      const value = parseEther('1');
      const reward = 0n;
      const rewardTimelock = timelock - 100;

      await train
        .connect(user1)
        .lock(Id, hashlock, reward, rewardTimelock, timelock, user2.address, srcAsset, dstChain, dstAddress, dstAsset, {
          value,
        });

      const balReceiverBefore = await ethers.provider.getBalance(user2.address);

      const tx = await train.connect(user2).redeem(Id, secret);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.effectiveGasPrice || receipt.gasPrice;
      const feesPaid = gasUsed * gasPrice;
      console.log(`Actual gas used redeem (no reward): ${receipt.gasUsed.toString()}`);

      const balReceiverAfter = await ethers.provider.getBalance(user2.address);
      expect(balReceiverAfter - balReceiverBefore).to.equal(value - feesPaid);
    });

    it('pays reward to sender and funds to receiver if redeemed before rewardTimelock', async () => {
      const balSenderBefore = await ethers.provider.getBalance(user1.address);
      const balReceiverBefore = await ethers.provider.getBalance(user2.address);

      const tx = await train.connect(user2).redeem(Id, secret);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.effectiveGasPrice || receipt.gasPrice;
      const feesPaid = gasUsed * effectiveGasPrice;

      const balSenderAfter = await ethers.provider.getBalance(user1.address);
      const balReceiverAfter = await ethers.provider.getBalance(user2.address);

      expect(balSenderAfter - balSenderBefore).to.equal(reward);
      expect(balReceiverAfter - balReceiverBefore).to.equal(value - reward - feesPaid);
    });

    it('pays both reward and funds to receiver if redeemed after rewardTimelock', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const Id2 = keccak256(toUtf8Bytes('redeem-reward-expired'));
      const timelock2 = now + 2000;
      const rewardTimelock2 = now + 500;

      await train
        .connect(user1)
        .lock(
          Id2,
          hashlock,
          reward,
          rewardTimelock2,
          timelock2,
          srcReceiver,
          srcAsset,
          dstChain,
          dstAddress,
          dstAsset,
          {
            value,
          }
        );

      await ethers.provider.send('evm_setNextBlockTimestamp', [rewardTimelock2 + 10]);
      await ethers.provider.send('evm_mine');

      const balSenderBefore = await ethers.provider.getBalance(user1.address);
      const balReceiverBefore = await ethers.provider.getBalance(user2.address);

      const tx = await train.connect(user2).redeem(Id2, secret);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.effectiveGasPrice || receipt.gasPrice;
      const feesPaid = gasUsed * effectiveGasPrice;

      const balSenderAfter = await ethers.provider.getBalance(user1.address);
      const balReceiverAfter = await ethers.provider.getBalance(user2.address);

      expect(balReceiverAfter - balReceiverBefore).to.equal(value - feesPaid);
      expect(balSenderAfter - balSenderBefore).to.equal(0n);
    });
  });
});
