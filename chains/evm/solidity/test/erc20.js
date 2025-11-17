const { expect } = require('chai');
const { keccak256, toUtf8Bytes, parseEther } = require('ethers');
const TrainERC20 = require('../ignition/modules/deployERC20');

describe('Train ERC20 contract', () => {
  let trainErc20, token, deployer, user1, user2;
  let hopChains, hopAssets, hopAddresses, dstChain, dstAsset, dstAddress, srcAsset, srcReceiver;

  beforeEach(async () => {
    [deployer, user1, user2] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory('TestToken');
    token = await TestToken.deploy();
    await token.waitForDeployment();

    ({ trainErc20 } = await ignition.deploy(TrainERC20));

    hopChains = ['ETH'];
    hopAssets = ['ETH'];
    hopAddresses = [user1.address];
    dstChain = 'ETH';
    dstAsset = 'ETH';
    dstAddress = user2.address;
    srcAsset = 'ETH';
    srcReceiver = user2.address;

    await token.connect(user1).mint(user1.address, parseEther('100'));
    await token.connect(user1).approve(await trainErc20.getAddress(), parseEther('100'));
    await token.connect(user2).mint(user2.address, parseEther('100'));
    await token.connect(user2).approve(await trainErc20.getAddress(), parseEther('100'));
  });

  // ===========================
  //         COMMIT
  // ===========================
  describe('commit', () => {
    it('should deploy Train ERC20 contract', async () => {
      expect(await trainErc20.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    });

    it('commits tokens and emits TokenCommitted', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 3600;
      const Id = keccak256(toUtf8Bytes('erc20-case1'));
      const amount = parseEther('10');
      const tokenAddress = await token.getAddress();

      await expect(
        trainErc20
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
            amount,
            tokenAddress
          )
      )
        .to.emit(trainErc20, 'TokenCommitted')
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
          amount,
          timelock,
          tokenAddress
        );

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.amount).to.equal(amount);
      expect(htlc.tokenContract).to.equal(tokenAddress);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(srcReceiver);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);
    });

    it('commit reverts if amount is zero', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 3600;
      const Id = keccak256(toUtf8Bytes('erc20-case2'));
      const tokenAddress = await token.getAddress();

      await expect(
        trainErc20
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
            0,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(trainErc20, 'FundsNotSent');
    });

    it('commit reverts if HTLC with same Id exists', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 3600;
      const Id = keccak256(toUtf8Bytes('erc20-case3'));
      const amount = parseEther('1');
      const tokenAddress = await token.getAddress();

      await trainErc20
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
          amount,
          tokenAddress
        );

      await expect(
        trainErc20
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
            amount,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(trainErc20, 'HTLCAlreadyExists');
    });

    it('reverts if timelock is less than 15 minutes in the future', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 100;
      const Id = keccak256(toUtf8Bytes('erc20-case4'));
      const amount = parseEther('1');
      const tokenAddress = await token.getAddress();

      await expect(
        trainErc20
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
            amount,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(trainErc20, 'InvalidTimelock');
    });

    it('reverts if sender has insufficient balance', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 3600;
      const Id = keccak256(toUtf8Bytes('erc20-case5'));
      const tooMuch = parseEther('1000');
      const tokenAddress = await token.getAddress();

      await expect(
        trainErc20
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
            tooMuch,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(trainErc20, 'InsufficientBalance');
    });

    it('reverts if contract is not approved for enough tokens', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 3600;
      const Id = keccak256(toUtf8Bytes('erc20-case6'));
      const amount = parseEther('2');
      const tokenAddress = await token.getAddress();

      await token.connect(user2).approve(await trainErc20.getAddress(), 0);

      await expect(
        trainErc20
          .connect(user2)
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
            amount,
            tokenAddress
          )
      ).to.be.revertedWithCustomError(trainErc20, 'NoAllowance');
    });

    it('allows different users to commit unique Ids', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock1 = block.timestamp + 2000;
      const timelock2 = block.timestamp + 3000;
      const Id1 = keccak256(toUtf8Bytes('erc20-user1'));
      const Id2 = keccak256(toUtf8Bytes('erc20-user2'));
      const amount = parseEther('1');
      const tokenAddress = await token.getAddress();

      await expect(
        trainErc20
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
            amount,
            tokenAddress
          )
      ).to.emit(trainErc20, 'TokenCommitted');

      await expect(
        trainErc20
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
            user1.address,
            timelock2,
            amount,
            tokenAddress
          )
      ).to.emit(trainErc20, 'TokenCommitted');
    });

    it('commit stores correct data for the new HTLC', async () => {
      const block = await ethers.provider.getBlock('latest');
      const timelock = block.timestamp + 5000;
      const Id = keccak256(toUtf8Bytes('erc20-datacase'));
      const amount = parseEther('2');
      const tokenAddress = await token.getAddress();

      const tx = await trainErc20
        .connect(user1)
        .commit([], [], [], dstChain, dstAsset, dstAddress, srcAsset, Id, srcReceiver, timelock, amount, tokenAddress);
      const receipt = await tx.wait();
      console.log(`Actual gas used commit (hop depth is 0): ${receipt.gasUsed.toString()}`);

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.amount).to.equal(amount);
      expect(htlc.tokenContract).to.equal(tokenAddress);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(srcReceiver);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);
    });
  });

  // ===========================
  //         LOCK
  // ===========================
  describe('lock', () => {
    let lockParams, tokenAddress, lockId, hashlock, reward, rewardTimelock, timelock, amount;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      lockId = keccak256(toUtf8Bytes('erc20-lock-case'));
      hashlock = keccak256(toUtf8Bytes('erc20-lock-secret'));
      timelock = now + 2000;
      reward = parseEther('1');
      rewardTimelock = timelock - 100;
      amount = parseEther('10');
      tokenAddress = await token.getAddress();

      lockParams = {
        Id: lockId,
        hashlock,
        reward,
        rewardTimelock,
        timelock,
        srcReceiver: user2.address,
        srcAsset: 'ETH',
        dstChain: 'ETH',
        dstAddress: user2.address,
        dstAsset: 'ETH',
        amount,
        tokenContract: tokenAddress,
      };
    });

    it('locks ERC20 tokens and emits TokenLocked', async () => {
      await expect(trainErc20.connect(user1).lock(lockParams))
        .to.emit(trainErc20, 'TokenLocked')
        .withArgs(
          lockParams.Id,
          lockParams.hashlock,
          lockParams.dstChain,
          lockParams.dstAddress,
          lockParams.dstAsset,
          user1.address,
          lockParams.srcReceiver,
          lockParams.srcAsset,
          amount,
          reward,
          rewardTimelock,
          timelock,
          tokenAddress
        );

      const htlc = await trainErc20.getHTLCDetails(lockParams.Id);
      expect(htlc.amount).to.equal(amount);
      expect(htlc.hashlock).to.equal(hashlock);
      expect(htlc.tokenContract).to.equal(tokenAddress);
      expect(htlc.sender).to.equal(user1.address);
      expect(htlc.srcReceiver).to.equal(user2.address);
      expect(htlc.timelock).to.equal(timelock);
      expect(htlc.claimed).to.equal(1);

      const rewardStruct = await trainErc20.getRewardDetails(lockParams.Id);
      expect(rewardStruct.amount).to.equal(reward);
      expect(rewardStruct.timelock).to.equal(rewardTimelock);
    });

    it('reverts if timelock is less than 1800 seconds in the future', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const badParams = { ...lockParams, timelock: now + 100 };
      await expect(trainErc20.connect(user1).lock(badParams)).to.be.revertedWithCustomError(
        trainErc20,
        'InvalidTimelock'
      );
    });

    it('reverts if rewardTimelock > timelock', async () => {
      const badParams = { ...lockParams, rewardTimelock: timelock + 100 };
      await expect(trainErc20.connect(user1).lock(badParams)).to.be.revertedWithCustomError(
        trainErc20,
        'InvaliRewardTimelock'
      );
    });

    it('reverts if rewardTimelock <= now', async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const badParams = { ...lockParams, rewardTimelock: now };
      await expect(trainErc20.connect(user1).lock(badParams)).to.be.revertedWithCustomError(
        trainErc20,
        'InvaliRewardTimelock'
      );
    });

    it('reverts if HTLC with same Id already exists', async () => {
      await trainErc20.connect(user1).lock(lockParams);
      await expect(trainErc20.connect(user1).lock(lockParams)).to.be.revertedWithCustomError(
        trainErc20,
        'HTLCAlreadyExists'
      );
    });

    it('reverts if sent amount is zero', async () => {
      const badParams = { ...lockParams, amount: 0 };
      await expect(trainErc20.connect(user1).lock(badParams)).to.be.revertedWithCustomError(trainErc20, 'FundsNotSent');
    });

    it('reverts if balance too low (including reward)', async () => {
      const bigAmount = parseEther('1000');
      const badParams = { ...lockParams, amount: bigAmount };
      await expect(trainErc20.connect(user1).lock(badParams)).to.be.revertedWithCustomError(
        trainErc20,
        'InsufficientBalance'
      );
    });

    it('reverts if not enough allowance for both amount and reward', async () => {
      await token.connect(user1).approve(await trainErc20.getAddress(), 0);
      await expect(trainErc20.connect(user1).lock(lockParams)).to.be.revertedWithCustomError(trainErc20, 'NoAllowance');
    });

    it('stores no reward if reward is 0', async () => {
      const paramsNoReward = { ...lockParams, reward: 0 };
      const tx = await trainErc20.connect(user1).lock(paramsNoReward);
      const receipt = await tx.wait();
      console.log(`Actual gas used lock (no reward): ${receipt.gasUsed.toString()}`);
      const rewardStruct = await trainErc20.getRewardDetails(lockParams.Id);
      expect(rewardStruct.amount).to.equal(0n);
      expect(rewardStruct.timelock).to.equal(0);
    });
  });

  // ===========================
  //         ADDLOCK
  // ===========================
  describe('addLock', () => {
    let Id, tokenAddress, timelock, newHashlock, newTimelock, amount;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      timelock = block.timestamp + 2000;
      Id = keccak256(toUtf8Bytes('erc20-addlock-case'));
      amount = parseEther('5');
      tokenAddress = await token.getAddress();
      newHashlock = keccak256(toUtf8Bytes('erc20-new-hashlock'));
      newTimelock = timelock + 1000;

      await trainErc20
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
          amount,
          tokenAddress
        );
    });

    it('adds hashlock and updates timelock if sender is correct and hashlock not set', async () => {
      await expect(trainErc20.connect(user1).addLock(Id, newHashlock, newTimelock))
        .to.emit(trainErc20, 'TokenLockAdded')
        .withArgs(Id, newHashlock, newTimelock);

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.hashlock).to.equal(newHashlock);
      expect(htlc.timelock).to.equal(newTimelock);
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('erc20-nonexistent'));
      await expect(trainErc20.connect(user1).addLock(fakeId, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        trainErc20,
        'HTLCNotExists'
      );
    });

    it('reverts if sender is not HTLC creator', async () => {
      await expect(trainErc20.connect(user2).addLock(Id, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        trainErc20,
        'NoAllowance'
      );
    });

    it('reverts if hashlock already set', async () => {
      const tx = await trainErc20.connect(user1).addLock(Id, newHashlock, newTimelock);
      const receipt = await tx.wait();
      console.log(`Actual gas used addLock: ${receipt.gasUsed.toString()}`);

      // Try to set it again (should fail)
      const altHashlock = keccak256(toUtf8Bytes('erc20-alt-hashlock'));
      await expect(
        trainErc20.connect(user1).addLock(Id, altHashlock, newTimelock + 1000)
      ).to.be.revertedWithCustomError(trainErc20, 'HashlockAlreadySet');
    });

    it('reverts if timelock is less than 15 minutes ahead', async () => {
      const block = await ethers.provider.getBlock('latest');
      const badTimelock = block.timestamp + 100; // <900s in future
      await expect(trainErc20.connect(user1).addLock(Id, newHashlock, badTimelock)).to.be.revertedWithCustomError(
        trainErc20,
        'InvalidTimelock'
      );
    });

    it('reverts if HTLC is already claimed', async () => {
      // Simulate as if HTLC was refunded
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await trainErc20.connect(user1).refund(Id);

      await expect(trainErc20.connect(user1).addLock(Id, newHashlock, newTimelock)).to.be.revertedWithCustomError(
        trainErc20,
        'AlreadyClaimed'
      );
    });
  });

  // ===========================
  //         ADDLOCKSIG
  // ===========================

  describe('addLockSig', () => {
    let Id,
      tokenAddress,
      timelock,
      newHashlock,
      newTimelock,
      amount,
      message,
      domain,
      types,
      signer,
      signature,
      r,
      s,
      v;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      timelock = block.timestamp + 2000;
      Id = keccak256(toUtf8Bytes('erc20-addlocksig-case'));
      amount = parseEther('5');
      tokenAddress = await token.getAddress();
      newHashlock = keccak256(toUtf8Bytes('erc20-addlocksig-hashlock'));
      newTimelock = timelock + 1000;
      signer = user1;

      // Commit HTLC as user1 (the signer)
      await trainErc20
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
          amount,
          tokenAddress
        );

      // Prepare EIP-712 domain and types (must match the contract)
      domain = {
        name: 'Train',
        version: '1',
        chainId: await signer.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: await trainErc20.getAddress(),
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
      await expect(trainErc20.connect(user2).addLockSig(message, r, s, v))
        .to.emit(trainErc20, 'TokenLockAdded')
        .withArgs(Id, newHashlock, newTimelock);

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.hashlock).to.equal(newHashlock);
      expect(htlc.timelock).to.equal(newTimelock);
    });

    it('reverts if signature is from a different signer', async () => {
      // Sign with user2 (not HTLC creator)
      const badSignature = await user2.signTypedData(domain, types, message);
      const badR = '0x' + badSignature.slice(2, 66);
      const badS = '0x' + badSignature.slice(66, 130);
      const badV = parseInt(badSignature.slice(130, 132), 16);

      await expect(trainErc20.connect(user2).addLockSig(message, badR, badS, badV)).to.be.revertedWithCustomError(
        trainErc20,
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

      await expect(trainErc20.connect(user2).addLockSig(badMessage, badR, badS, badV)).to.be.revertedWithCustomError(
        trainErc20,
        'InvalidTimelock'
      );
    });

    it('reverts if hashlock already set', async () => {
      // Set it first time
      const tx = await trainErc20.connect(user2).addLockSig(message, r, s, v);
      const receipt = await tx.wait();
      console.log(`Actual gas used addLockSig: ${receipt.gasUsed.toString()}`);

      // Try again with a new signature (for a different hashlock)
      const altMessage = { ...message, hashlock: keccak256(toUtf8Bytes('erc20-alt')) };
      const altSignature = await signer.signTypedData(domain, types, altMessage);
      const altR = '0x' + altSignature.slice(2, 66);
      const altS = '0x' + altSignature.slice(66, 130);
      const altV = parseInt(altSignature.slice(130, 132), 16);

      await expect(trainErc20.connect(user2).addLockSig(altMessage, altR, altS, altV)).to.be.revertedWithCustomError(
        trainErc20,
        'HashlockAlreadySet'
      );
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('erc20-nohtlc'));
      const fakeMsg = { ...message, Id: fakeId };
      const fakeSig = await signer.signTypedData(domain, types, fakeMsg);
      const fakeR = '0x' + fakeSig.slice(2, 66);
      const fakeS = '0x' + fakeSig.slice(66, 130);
      const fakeV = parseInt(fakeSig.slice(130, 132), 16);

      await expect(trainErc20.connect(user2).addLockSig(fakeMsg, fakeR, fakeS, fakeV)).to.be.revertedWithCustomError(
        trainErc20,
        'HTLCNotExists'
      );
    });

    it('reverts if HTLC is already claimed', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await trainErc20.connect(user1).refund(Id);

      await expect(trainErc20.connect(user2).addLockSig(message, r, s, v)).to.be.revertedWithCustomError(
        trainErc20,
        'AlreadyClaimed'
      );
    });
  });

  // ===========================
  //          REFUND
  // ===========================

  describe('refund', () => {
    let Id, timelock, amount, tokenAddress, reward, rewardTimelock;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      timelock = now + 1200;
      Id = keccak256(toUtf8Bytes('erc20-refund-case'));
      amount = parseEther('10');
      tokenAddress = await token.getAddress();

      await trainErc20
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
          amount,
          tokenAddress
        );
    });

    it('reverts if HTLC does not exist', async () => {
      const randomId = keccak256(toUtf8Bytes('erc20-refund-no-htlc'));
      await expect(trainErc20.connect(user1).refund(randomId)).to.be.revertedWithCustomError(
        trainErc20,
        'HTLCNotExists'
      );
    });

    it('reverts if HTLC is already claimed (refunded)', async () => {
      // Fast-forward time so refund is possible
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      const tx = await trainErc20.connect(user1).refund(Id);
      const receipt = await tx.wait();
      console.log(`Actual gas used refund (no reward): ${receipt.gasUsed.toString()}`);

      await expect(trainErc20.connect(user1).refund(Id)).to.be.revertedWithCustomError(trainErc20, 'AlreadyClaimed');
    });

    it('reverts if timelock has not passed', async () => {
      await expect(trainErc20.connect(user1).refund(Id)).to.be.revertedWithCustomError(trainErc20, 'NotPassedTimelock');
    });

    it('refunds after timelock and emits TokenRefunded', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await expect(trainErc20.connect(user1).refund(Id)).to.emit(trainErc20, 'TokenRefunded').withArgs(Id);

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.claimed).to.equal(2);
    });

    it('refunds full amount to sender (without reward)', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      const balBefore = await token.balanceOf(user1.address);

      await trainErc20.connect(user1).refund(Id);

      const balAfter = await token.balanceOf(user1.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it('refunds full amount + reward if present', async () => {
      // Create HTLC with reward
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const timelock2 = now + 1900;
      const Id2 = keccak256(toUtf8Bytes('erc20-refund-reward-case'));
      reward = parseEther('1');
      rewardTimelock = timelock2 - 100;
      const total = amount + reward;

      await token.connect(user1).mint(user1.address, reward);
      await token.connect(user1).approve(await trainErc20.getAddress(), total);

      await trainErc20.connect(user1).lock({
        Id: Id2,
        hashlock: keccak256(toUtf8Bytes('erc20-lock-hashlock')),
        reward: reward,
        rewardTimelock,
        timelock: timelock2,
        srcReceiver,
        srcAsset,
        dstChain,
        dstAddress,
        dstAsset,
        amount,
        tokenContract: tokenAddress,
      });

      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock2 + 1]);
      await ethers.provider.send('evm_mine');

      const balBefore = await token.balanceOf(user1.address);

      await trainErc20.connect(user1).refund(Id2);

      const balAfter = await token.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(amount + reward);
    });
  });

  // ===========================
  //          REDEEM
  // ===========================

  describe('redeem', () => {
    let Id, secret, hashlock, timelock, amount, reward, rewardTimelock, tokenAddress;

    beforeEach(async () => {
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      Id = keccak256(toUtf8Bytes('redeem-case'));
      tokenAddress = await token.getAddress();
      amount = parseEther('10');
      reward = parseEther('1');
      secret = 12345n;
      hashlock = await ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [secret]));
      timelock = now + 2000;
      rewardTimelock = timelock - 100;

      // Mint enough tokens and approve for lock (amount + reward)
      await token.connect(user1).mint(user1.address, amount + reward);
      await token.connect(user1).approve(await trainErc20.getAddress(), amount + reward);

      await trainErc20.connect(user1).lock({
        Id,
        hashlock,
        reward,
        rewardTimelock,
        timelock,
        srcReceiver,
        srcAsset,
        dstChain,
        dstAddress,
        dstAsset,
        amount,
        tokenContract: tokenAddress,
      });
    });

    it('redeems funds with correct secret and emits TokenRedeemed', async () => {
      await expect(trainErc20.connect(user2).redeem(Id, secret))
        .to.emit(trainErc20, 'TokenRedeemed')
        .withArgs(Id, user2.address, secret, hashlock);

      const htlc = await trainErc20.getHTLCDetails(Id);
      expect(htlc.claimed).to.equal(3);
      expect(htlc.secret).to.equal(secret);
    });

    it('pays reward to sender and funds to receiver if redeemed before rewardTimelock', async () => {
      const balSenderBefore = await token.balanceOf(user1.address);
      const balReceiverBefore = await token.balanceOf(user2.address);

      await trainErc20.connect(user2).redeem(Id, secret);

      const balSenderAfter = await token.balanceOf(user1.address);
      const balReceiverAfter = await token.balanceOf(user2.address);

      expect(balSenderAfter - balSenderBefore).to.equal(reward);
      expect(balReceiverAfter - balReceiverBefore).to.equal(amount);
    });

    it('pays both reward and funds to receiver if redeemed after rewardTimelock', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [rewardTimelock + 10]);
      await ethers.provider.send('evm_mine');

      const balSenderBefore = await token.balanceOf(user1.address);
      const balReceiverBefore = await token.balanceOf(user2.address);

      await trainErc20.connect(user2).redeem(Id, secret);

      const balSenderAfter = await token.balanceOf(user1.address);
      const balReceiverAfter = await token.balanceOf(user2.address);

      expect(balReceiverAfter - balReceiverBefore).to.equal(amount + reward);
      expect(balSenderAfter - balSenderBefore).to.equal(0n);
    });

    it('redeems without reward: receiver gets all funds', async () => {
      // Make a new HTLC with no reward
      const block = await ethers.provider.getBlock('latest');
      const now = block.timestamp;
      const Id2 = keccak256(toUtf8Bytes('redeem-noreward'));
      const amount2 = parseEther('7');
      const secret2 = 55555n;
      const hashlock2 = await ethers.sha256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [secret2]));
      const timelock2 = now + 2000;

      await token.connect(user1).mint(user1.address, amount2);
      await token.connect(user1).approve(await trainErc20.getAddress(), amount2);

      await trainErc20.connect(user1).lock({
        Id: Id2,
        hashlock: hashlock2,
        reward: 0,
        rewardTimelock: timelock2 - 100,
        timelock: timelock2,
        srcReceiver,
        srcAsset,
        dstChain,
        dstAddress,
        dstAsset,
        amount: amount2,
        tokenContract: tokenAddress,
      });

      const balReceiverBefore = await token.balanceOf(user2.address);
      const tx = await trainErc20.connect(user2).redeem(Id2, secret2);
      const receipt = await tx.wait();
      console.log(`Actual gas used redeem (no reward): ${receipt.gasUsed.toString()}`);
      const balReceiverAfter = await token.balanceOf(user2.address);

      expect(balReceiverAfter - balReceiverBefore).to.equal(amount2);
    });

    it('reverts if HTLC does not exist', async () => {
      const fakeId = keccak256(toUtf8Bytes('not-exist'));
      await expect(trainErc20.connect(user2).redeem(fakeId, secret)).to.be.revertedWithCustomError(
        trainErc20,
        'HTLCNotExists'
      );
    });

    it('reverts if secret does not match hashlock', async () => {
      await expect(trainErc20.connect(user2).redeem(Id, 999n)).to.be.revertedWithCustomError(
        trainErc20,
        'HashlockNotMatch'
      );
    });

    it('reverts if HTLC is already claimed (redeemed)', async () => {
      await trainErc20.connect(user2).redeem(Id, secret);
      await expect(trainErc20.connect(user2).redeem(Id, secret)).to.be.revertedWithCustomError(
        trainErc20,
        'AlreadyClaimed'
      );
    });

    it('reverts if HTLC is already claimed (refunded)', async () => {
      await ethers.provider.send('evm_setNextBlockTimestamp', [timelock + 1]);
      await ethers.provider.send('evm_mine');
      await trainErc20.connect(user1).refund(Id);
      await expect(trainErc20.connect(user2).redeem(Id, secret)).to.be.revertedWithCustomError(
        trainErc20,
        'AlreadyClaimed'
      );
    });
  });
});
