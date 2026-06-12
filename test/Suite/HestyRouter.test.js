// test/Suite/HestyRouter.test.js
// Unit tests for HestyRouter.sol

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const {
  deploySystem, kycApprove, createProperty, approveProperty,
  fundAndBuy, completeRaise, PROP,
} = require("./helpers");

describe("HestyRouter", function () {
  let ctx;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  describe("Initial state", function () {
    it("tokenFactory is set correctly", async function () {
      expect(await ctx.router.tokenFactory()).to.equal(ctx.tokenFactory.address);
    });

    it("hestyAccessControl is set correctly", async function () {
      expect(await ctx.router.hestyAccessControl()).to.equal(ctx.hestyAC.address);
    });

    it("pendingHestyAccessControl is zero initially", async function () {
      expect(await ctx.router.pendingHestyAccessControl()).to.equal(
        ethers.constants.AddressZero
      );
    });
  });

  // ─── offChainBuyTokens ────────────────────────────────────────────────────

  describe("offChainBuyTokens", function () {
    beforeEach(async function () {
      // Router must hold FUNDS_MANAGER so it can call TokenFactory.adminBuyTokens
      await ctx.hestyAC.grantRole(await ctx.hestyAC.FUNDS_MANAGER(), ctx.router.address);
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await kycApprove(ctx, ctx.investor1);
    });

    it("admin can register an off-chain investment for a KYC'd buyer", async function () {
      await ctx.router.connect(ctx.owner).offChainBuyTokens(0, ctx.investor1.address, 5);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(5);
    });

    it("emits NewInvestment event via TokenFactory", async function () {
      await expect(
        ctx.router.connect(ctx.owner).offChainBuyTokens(0, ctx.investor1.address, 5)
      ).to.emit(ctx.tokenFactory, "NewInvestment");
    });

    it("non-admin cannot call offChainBuyTokens", async function () {
      await expect(
        ctx.router.connect(ctx.random).offChainBuyTokens(0, ctx.investor1.address, 5)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts if buyer is not KYC approved", async function () {
      await expect(
        ctx.router.connect(ctx.owner).offChainBuyTokens(0, ctx.random.address, 5)
      ).to.be.revertedWith("No KYC Made");
    });
  });

  // ─── adminDistribution ───────────────────────────────────────────────────

  describe("adminDistribution", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);
    });

    it("admin can distribute revenue held by the router", async function () {
      const amt = 50_000;
      // Fund the router directly so it has tokens to distribute
      await ctx.eurc.connect(ctx.owner).mint(ctx.router.address, amt);

      // router approves itself to be pulled by tokenFactory → PropertyToken
      // But adminDistribution does: eurc.approve(tokenFactory, amt) then calls distributeRevenue
      await ctx.router.connect(ctx.owner).adminDistribution(0, amt);
    });

    it("non-admin cannot call adminDistribution", async function () {
      await expect(
        ctx.router.connect(ctx.random).adminDistribution(0, 1)
      ).to.be.revertedWith("Not Admin Manager");
    });
  });

  // ─── proposeNewAccessControl / confirmAccessControlChange ─────────────────

  describe("Access control upgrade (propose + confirm)", function () {
    let newHestyAC;

    beforeEach(async function () {
      const HestyAccessControl = await ethers.getContractFactory("HestyAccessControl");
      newHestyAC = await HestyAccessControl.connect(ctx.owner).deploy();
      await newHestyAC.deployed();
    });

    it("admin can propose a new HestyAccessControl", async function () {
      await ctx.router.connect(ctx.owner).proposeNewAccessControl(newHestyAC.address);
      expect(await ctx.router.pendingHestyAccessControl()).to.equal(newHestyAC.address);
    });

    it("emits HestyAccessControlPending event on proposal", async function () {
      await expect(ctx.router.connect(ctx.owner).proposeNewAccessControl(newHestyAC.address))
        .to.emit(ctx.router, "HestyAccessControlPending").withArgs(newHestyAC.address);
    });

    it("non-admin cannot propose", async function () {
      await expect(
        ctx.router.connect(ctx.random).proposeNewAccessControl(newHestyAC.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts proposal with zero address", async function () {
      await expect(
        ctx.router.connect(ctx.owner).proposeNewAccessControl(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not null");
    });

    it("confirmAccessControlChange succeeds when called via the NEW (pending) HestyAC", async function () {
      await ctx.router.connect(ctx.owner).proposeNewAccessControl(newHestyAC.address);
      // Must be called FROM the pending (new) HestyAC so msg.sender == pendingHestyAccessControl
      await newHestyAC.connect(ctx.owner).confirmAccessControlAdmin(ctx.router.address);
      expect(await ctx.router.hestyAccessControl()).to.equal(newHestyAC.address);
      expect(await ctx.router.pendingHestyAccessControl()).to.equal(
        ethers.constants.AddressZero
      );
    });

    it("emits NewHestyAccessControl event on confirmation", async function () {
      await ctx.router.connect(ctx.owner).proposeNewAccessControl(newHestyAC.address);
      await expect(newHestyAC.connect(ctx.owner).confirmAccessControlAdmin(ctx.router.address))
        .to.emit(ctx.router, "NewHestyAccessControl").withArgs(newHestyAC.address);
    });

    it("confirmAccessControlChange reverts if caller is not the pending contract", async function () {
      await ctx.router.connect(ctx.owner).proposeNewAccessControl(newHestyAC.address);
      await expect(
        ctx.router.connect(ctx.owner).confirmAccessControlChange()
      ).to.be.revertedWith("Wrong Router");
    });
  });

  // ─── setNewTokenFactory ───────────────────────────────────────────────────

  describe("setNewTokenFactory", function () {
    it("admin can update the token factory", async function () {
      const TF = await ethers.getContractFactory("TokenFactory");
      const newTF = await TF.connect(ctx.owner).deploy(
        300, ctx.treasury.address, 1, ctx.hestyAC.address
      );
      await newTF.deployed();
      await expect(ctx.router.connect(ctx.owner).setNewTokenFactory(newTF.address))
        .to.emit(ctx.router, "NewTokenFactory").withArgs(newTF.address);
      expect(await ctx.router.tokenFactory()).to.equal(newTF.address);
    });

    it("non-admin cannot update token factory", async function () {
      await expect(
        ctx.router.connect(ctx.random).setNewTokenFactory(ctx.tokenFactory.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts for zero address", async function () {
      await expect(
        ctx.router.connect(ctx.owner).setNewTokenFactory(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not null");
    });
  });
});
