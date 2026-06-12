// test/Suite/ReferralSystem.test.js
// Unit tests for ReferralSystem.sol

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const {
  deploySystem, kycApprove, createProperty, approveProperty,
  fundAndBuy, completeRaise,
} = require("./helpers");

describe("ReferralSystem", function () {
  let ctx;
  // referrer  = user who refers others
  // referred  = user who was referred
  // approvedCaller = an address the admin has whitelisted as an approved caller

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    // Approve owner address as a caller so tests can call addRewards directly
    await ctx.referral.connect(ctx.owner).addApprovedCtrs(ctx.owner.address);
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  describe("Initial state", function () {
    it("rewardToken is EURC", async function () {
      expect(await ctx.referral.rewardToken()).to.equal(ctx.eurc.address);
    });

    it("ctrHestyControl is set correctly", async function () {
      expect(await ctx.referral.ctrHestyControl()).to.equal(ctx.hestyAC.address);
    });

    it("tokenFactory is set correctly", async function () {
      expect(await ctx.referral.tokenFactory()).to.equal(ctx.tokenFactory.address);
    });

    it("TokenFactory address is pre-approved as a caller", async function () {
      expect(await ctx.referral.approvedCtrs(ctx.tokenFactory.address)).to.equal(true);
    });

    it("owner address is approved as a caller (set in beforeEach)", async function () {
      expect(await ctx.referral.approvedCtrs(ctx.owner.address)).to.equal(true);
    });
  });

  // ─── addApprovedCtrs / removeApprovedCtrs ─────────────────────────────────

  describe("addApprovedCtrs / removeApprovedCtrs", function () {
    it("admin can add a new approved caller", async function () {
      await expect(ctx.referral.connect(ctx.owner).addApprovedCtrs(ctx.random.address))
        .to.emit(ctx.referral, "NewApprovedCtr").withArgs(ctx.random.address);
      expect(await ctx.referral.approvedCtrs(ctx.random.address)).to.equal(true);
    });

    it("non-admin cannot add approved caller", async function () {
      await expect(
        ctx.referral.connect(ctx.random).addApprovedCtrs(ctx.random.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts if address already approved", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).addApprovedCtrs(ctx.owner.address)
      ).to.be.revertedWith("Already Approved");
    });

    it("admin can remove an approved caller", async function () {
      await expect(ctx.referral.connect(ctx.owner).removeApprovedCtrs(ctx.owner.address))
        .to.emit(ctx.referral, "RemovedApprovedCtr").withArgs(ctx.owner.address);
      expect(await ctx.referral.approvedCtrs(ctx.owner.address)).to.equal(false);
    });

    it("non-admin cannot remove approved caller", async function () {
      await expect(
        ctx.referral.connect(ctx.random).removeApprovedCtrs(ctx.owner.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts removing a non-approved address", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).removeApprovedCtrs(ctx.random.address)
      ).to.be.revertedWith("Not Approved Router");
    });
  });

  // ─── addRewards ───────────────────────────────────────────────────────────

  describe("addRewards", function () {
    it("approved caller can add property rewards", async function () {
      await ctx.referral.connect(ctx.owner).addRewards(
        ctx.investor1.address, ctx.investor2.address, 0, 1000
      );
      expect(await ctx.referral.rewards(ctx.investor1.address, 0)).to.equal(1000);
      expect(await ctx.referral.totalRewards(ctx.investor1.address)).to.equal(1000);
      expect(await ctx.referral.rewardsByProperty(0)).to.equal(1000);
      expect(await ctx.referral.numberOfRef(ctx.investor1.address)).to.equal(1);
    });

    it("emits AddPropertyRefRewards event", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).addRewards(
          ctx.investor1.address, ctx.investor2.address, 0, 1000
        )
      ).to.emit(ctx.referral, "AddPropertyRefRewards").withArgs(0, ctx.investor1.address, 1000);
    });

    it("non-approved caller cannot add rewards", async function () {
      await expect(
        ctx.referral.connect(ctx.random).addRewards(
          ctx.investor1.address, ctx.investor2.address, 0, 1000
        )
      ).to.be.revertedWith("Not Approved");
    });

    it("accumulates rewards for the same referrer-user pair", async function () {
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 1000);
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 500);
      expect(await ctx.referral.rewards(ctx.investor1.address, 0)).to.equal(1500);
    });

    it("does NOT add rewards if user is already referred by someone else", async function () {
      // First, investor1 refers investor2
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 1000);
      // Now try investor3 referring investor2 (who is already referred)
      await ctx.referral.connect(ctx.owner).addRewards(ctx.random.address, ctx.investor2.address, 0, 999);
      // random should get nothing
      expect(await ctx.referral.rewards(ctx.random.address, 0)).to.equal(0);
    });

    it("stores referredBy correctly for first referral", async function () {
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 100);
      expect(await ctx.referral.referredBy(ctx.investor2.address)).to.equal(ctx.investor1.address);
    });

    it("reverts if system is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 100)
      ).to.be.revertedWith("All Hesty Paused");
    });
  });

  // ─── addGlobalRewards ────────────────────────────────────────────────────

  describe("addGlobalRewards", function () {
    it("approved caller can add global rewards (with token transfer)", async function () {
      const amt = 5_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.referral.address, amt);
      await ctx.referral.connect(ctx.owner).addGlobalRewards(ctx.investor1.address, amt);
      expect(await ctx.referral.globalRewards(ctx.investor1.address)).to.equal(amt);
    });

    it("emits AddGlobalRewards event", async function () {
      const amt = 5_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.referral.address, amt);
      await expect(
        ctx.referral.connect(ctx.owner).addGlobalRewards(ctx.investor1.address, amt)
      ).to.emit(ctx.referral, "AddGlobalRewards").withArgs(ctx.investor1.address, amt);
    });

    it("non-approved caller cannot add global rewards", async function () {
      await expect(
        ctx.referral.connect(ctx.random).addGlobalRewards(ctx.investor1.address, 100)
      ).to.be.revertedWith("Not Approved");
    });

    it("reverts if paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.referral.connect(ctx.owner).addGlobalRewards(ctx.investor1.address, 1)
      ).to.be.revertedWith("All Hesty Paused");
    });
  });

  // ─── claimPropertyRewards ─────────────────────────────────────────────────

  describe("claimPropertyRewards", function () {
    beforeEach(async function () {
      // Create a complete raise so rewards are claimable
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);

      // Add property rewards and fund ReferralSystem with tokens to pay out
      const rew = 2_000;
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, rew);
      await ctx.eurc.connect(ctx.owner).mint(ctx.referral.address, rew);
    });

    it("KYC-approved caller can claim property rewards for a user", async function () {
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 0);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.sub(before)).to.equal(2_000);
    });

    it("zeroes out rewards after claim", async function () {
      await ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 0);
      expect(await ctx.referral.rewards(ctx.investor1.address, 0)).to.equal(0);
    });

    it("emits ClaimPropertyRewards event", async function () {
      await expect(ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 0))
        .to.emit(ctx.referral, "ClaimPropertyRewards").withArgs(0, ctx.investor1.address, 2_000);
    });

    it("reverts if property is not yet completed / claimable", async function () {
      await createProperty(ctx); // propId 1, not completed
      await expect(
        ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 1)
      ).to.be.revertedWith("Not yet");
    });

    it("reverts if caller is not KYC approved", async function () {
      await expect(
        ctx.referral.connect(ctx.random).claimPropertyRewards(ctx.investor1.address, 0)
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if caller is blacklisted", async function () {
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor1.address);
      await expect(
        ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 0)
      ).to.be.revertedWith("Blacklisted");
    });

    it("reverts if system is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.referral.connect(ctx.investor1).claimPropertyRewards(ctx.investor1.address, 0)
      ).to.be.revertedWith("All Hesty Paused");
    });
  });

  // ─── claimGlobalRewards ───────────────────────────────────────────────────

  describe("claimGlobalRewards", function () {
    beforeEach(async function () {
      await kycApprove(ctx, ctx.investor1);
      const amt = 3_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.referral.address, amt);
      await ctx.referral.connect(ctx.owner).addGlobalRewards(ctx.investor1.address, amt);
    });

    it("KYC-approved user can claim their global rewards", async function () {
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await ctx.referral.connect(ctx.investor1).claimGlobalRewards(ctx.investor1.address);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.sub(before)).to.equal(3_000);
    });

    it("zeroes out globalRewards after claim", async function () {
      await ctx.referral.connect(ctx.investor1).claimGlobalRewards(ctx.investor1.address);
      expect(await ctx.referral.globalRewards(ctx.investor1.address)).to.equal(0);
    });

    it("emits ClaimGlobalRewards event", async function () {
      await expect(ctx.referral.connect(ctx.investor1).claimGlobalRewards(ctx.investor1.address))
        .to.emit(ctx.referral, "ClaimGlobalRewards").withArgs(ctx.investor1.address, 3_000);
    });

    it("reverts if caller is not KYC approved", async function () {
      await expect(
        ctx.referral.connect(ctx.random).claimGlobalRewards(ctx.investor1.address)
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if caller is blacklisted", async function () {
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor1.address);
      await expect(
        ctx.referral.connect(ctx.investor1).claimGlobalRewards(ctx.investor1.address)
      ).to.be.revertedWith("Blacklisted");
    });

    it("reverts if system is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.referral.connect(ctx.investor1).claimGlobalRewards(ctx.investor1.address)
      ).to.be.revertedWith("All Hesty Paused");
    });
  });

  // ─── getReferrerDetails ───────────────────────────────────────────────────

  describe("getReferrerDetails", function () {
    it("returns zeros for user with no referrals", async function () {
      const [nRef, total, global] = await ctx.referral.getReferrerDetails(ctx.random.address);
      expect(nRef).to.equal(0);
      expect(total).to.equal(0);
      expect(global).to.equal(0);
    });

    it("returns correct data after property rewards added", async function () {
      await ctx.referral.connect(ctx.owner).addRewards(ctx.investor1.address, ctx.investor2.address, 0, 500);
      const [nRef, total, global] = await ctx.referral.getReferrerDetails(ctx.investor1.address);
      expect(nRef).to.equal(1);
      expect(total).to.equal(500);
      expect(global).to.equal(0);
    });

    it("returns correct globalRewards after global rewards added", async function () {
      const amt = 1_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.referral.address, amt);
      await ctx.referral.connect(ctx.owner).addGlobalRewards(ctx.investor1.address, amt);
      const [, , global] = await ctx.referral.getReferrerDetails(ctx.investor1.address);
      expect(global).to.equal(amt);
    });
  });

  // ─── Admin setters ────────────────────────────────────────────────────────

  describe("Admin setters", function () {
    it("admin can update the reward token", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tok2 = await MockERC20.deploy("T2", "T2");
      await tok2.deployed();
      await expect(ctx.referral.connect(ctx.owner).setRewardToken(tok2.address))
        .to.emit(ctx.referral, "NewRewardToken").withArgs(tok2.address);
      expect(await ctx.referral.rewardToken()).to.equal(tok2.address);
    });

    it("setRewardToken reverts for zero address", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).setRewardToken(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not null");
    });

    it("non-admin cannot update reward token", async function () {
      await expect(
        ctx.referral.connect(ctx.random).setRewardToken(ctx.eurc.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("admin can update hestyAccessControl", async function () {
      const HestyAC = await ethers.getContractFactory("HestyAccessControl");
      const newAC = await HestyAC.deploy();
      await newAC.deployed();
      await expect(ctx.referral.connect(ctx.owner).setHestyAccessControlCtr(newAC.address))
        .to.emit(ctx.referral, "NewHestyAccessControl").withArgs(newAC.address);
    });

    it("setHestyAccessControlCtr reverts for zero address", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).setHestyAccessControlCtr(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not null");
    });

    it("admin can update tokenFactory in ReferralSystem", async function () {
      const TF = await ethers.getContractFactory("TokenFactory");
      const newTF = await TF.deploy(300, ctx.treasury.address, 1, ctx.hestyAC.address);
      await newTF.deployed();
      await expect(ctx.referral.connect(ctx.owner).setNewTokenFactory(newTF.address))
        .to.emit(ctx.referral, "NewTokenFactory").withArgs(newTF.address);
      // old tokenFactory should be de-approved, new one approved
      expect(await ctx.referral.approvedCtrs(ctx.tokenFactory.address)).to.equal(false);
      expect(await ctx.referral.approvedCtrs(newTF.address)).to.equal(true);
    });

    it("setNewTokenFactory reverts for zero address", async function () {
      await expect(
        ctx.referral.connect(ctx.owner).setNewTokenFactory(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not null");
    });
  });
});
