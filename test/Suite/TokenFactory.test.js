// test/Suite/TokenFactory.test.js
// Full unit test suite for TokenFactory.sol

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const {
  deploySystem, kycApprove, createProperty, approveProperty,
  fundAndBuy, completeRaise, getPropertyToken,
  increaseTime, mineAt, PROP, PLATFORM_FEE_BP, FAR_FUTURE, ONE_DAY,
} = require("./helpers");

describe("TokenFactory", function () {
  let ctx;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  describe("Constructor / initial state", function () {
    it("platformFeeBasisPoints set correctly", async function () {
      expect(await ctx.tokenFactory.platformFeeBasisPoints()).to.equal(PLATFORM_FEE_BP);
    });

    it("treasury set correctly", async function () {
      expect(await ctx.tokenFactory.treasury()).to.equal(ctx.treasury.address);
    });

    it("minInvAmount set correctly", async function () {
      expect(await ctx.tokenFactory.minInvAmount()).to.equal(1);
    });

    it("ctrHestyControl set correctly", async function () {
      expect(await ctx.tokenFactory.ctrHestyControl()).to.equal(ctx.hestyAC.address);
    });

    it("propertyCounter starts at 0", async function () {
      expect(await ctx.tokenFactory.propertyCounter()).to.equal(0);
    });

    it("initialized is true after deployment setup", async function () {
      expect(await ctx.tokenFactory.initialized()).to.equal(true);
    });

    it("ctrHestyIssuance is set after initialize", async function () {
      expect(await ctx.tokenFactory.ctrHestyIssuance()).to.equal(ctx.issuance.address);
    });

    it("EURC is whitelisted", async function () {
      expect(await ctx.tokenFactory.tokensWhitelist(ctx.eurc.address)).to.equal(true);
    });

    it("constructor reverts if fee >= MAX_FEE_POINTS (3000)", async function () {
      const TF = await ethers.getContractFactory("TokenFactory");
      await expect(
        TF.deploy(3000, ctx.treasury.address, 1, ctx.hestyAC.address)
      ).to.be.revertedWith("Invalid Platform Fee");
    });
  });

  // ─── initialize() ─────────────────────────────────────────────────────────

  describe("initialize", function () {
    it("cannot initialize twice", async function () {
      // deploySystem already called initialize once
      await expect(
        ctx.tokenFactory.connect(ctx.owner).initialize(ctx.issuance.address)
      ).to.be.revertedWith("Already init");
    });

    it("only admin can initialize", async function () {
      // Deploy a fresh (uninitialized) TokenFactory
      const TF = await ethers.getContractFactory("TokenFactory");
      const fresh = await TF.connect(ctx.owner).deploy(
        300, ctx.treasury.address, 1, ctx.hestyAC.address
      );
      await fresh.deployed();
      await expect(
        fresh.connect(ctx.random).initialize(ctx.issuance.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("emits InitializeFactory event", async function () {
      const TF = await ethers.getContractFactory("TokenFactory");
      const fresh = await TF.connect(ctx.owner).deploy(
        300, ctx.treasury.address, 1, ctx.hestyAC.address
      );
      await fresh.deployed();
      await expect(fresh.connect(ctx.owner).initialize(ctx.issuance.address))
        .to.emit(fresh, "InitializeFactory")
        .withArgs(ctx.issuance.address);
    });
  });

  // ─── Token whitelist ──────────────────────────────────────────────────────

  describe("addWhitelistedToken / removeWhitelistedToken", function () {
    it("admin can add a token to whitelist", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tok2 = await MockERC20.deploy("T2", "T2");
      await tok2.deployed();
      await ctx.tokenFactory.connect(ctx.owner).addWhitelistedToken(tok2.address);
      expect(await ctx.tokenFactory.tokensWhitelist(tok2.address)).to.equal(true);
    });

    it("non-admin cannot whitelist token", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).addWhitelistedToken(ctx.eurc.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts on zero-address whitelist", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).addWhitelistedToken(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not allowed");
    });

    it("admin can remove a whitelisted token", async function () {
      await ctx.tokenFactory.connect(ctx.owner).removeWhitelistedToken(ctx.eurc.address);
      expect(await ctx.tokenFactory.tokensWhitelist(ctx.eurc.address)).to.equal(false);
    });

    it("non-admin cannot remove whitelisted token", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).removeWhitelistedToken(ctx.eurc.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts removing a non-whitelisted token", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).removeWhitelistedToken(ctx.owner.address)
      ).to.be.revertedWith("Not Found");
    });

    it("emits AddWhitelistToken event", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tok2 = await MockERC20.deploy("T2", "T2");
      await tok2.deployed();
      await expect(ctx.tokenFactory.connect(ctx.owner).addWhitelistedToken(tok2.address))
        .to.emit(ctx.tokenFactory, "AddWhitelistToken")
        .withArgs(tok2.address);
    });

    it("emits RemoveWhitelistToken event", async function () {
      await expect(ctx.tokenFactory.connect(ctx.owner).removeWhitelistedToken(ctx.eurc.address))
        .to.emit(ctx.tokenFactory, "RemoveWhitelistToken")
        .withArgs(ctx.eurc.address);
    });
  });

  // ─── createProperty ───────────────────────────────────────────────────────

  describe("createProperty", function () {
    it("KYC-approved user can create a property", async function () {
      await createProperty(ctx);
      expect(await ctx.tokenFactory.propertyCounter()).to.equal(1);
    });

    it("increments propertyCounter on each call", async function () {
      await createProperty(ctx);
      await createProperty(ctx);
      expect(await ctx.tokenFactory.propertyCounter()).to.equal(2);
    });

    it("emits CreateProperty event with correct id", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.emit(ctx.tokenFactory, "CreateProperty").withArgs(0);
    });

    it("reverts if user is not KYC approved", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if payment token is not whitelisted", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const foreign = await MockERC20.deploy("F", "F");
      await foreign.deployed();
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          foreign.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("Invalid pay token");
    });

    it("reverts if revenue token is not whitelisted", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const foreign = await MockERC20.deploy("F", "F");
      await foreign.deployed();
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, foreign.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("Invalid pay token");
    });

    it("reverts if listingTokenFee >= MAX_FEE_POINTS (3000)", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, 3000, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("Fee must be valid");
    });

    it("reverts if contract is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("All Hesty Paused");
    });

    it("reverts if creator is blacklisted", async function () {
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.propOwner.address);
      await expect(
        ctx.tokenFactory.connect(ctx.propOwner).createProperty(
          PROP.amount, PROP.listingFee, PROP.tokenPrice, PROP.threshold,
          ctx.eurc.address, ctx.eurc.address, PROP.name, PROP.symbol, ctx.hestyAC.address
        )
      ).to.be.revertedWith("Blacklisted");
    });

    it("stores correct property fields after creation", async function () {
      await createProperty(ctx);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.price).to.equal(PROP.tokenPrice);
      expect(prop.amountToSell).to.equal(
        ethers.BigNumber.from(PROP.amount).mul(ethers.utils.parseEther("1"))
      );
      expect(prop.threshold).to.equal(PROP.threshold);
      expect(prop.raised).to.equal(0);
      expect(prop.isCompleted).to.equal(false);
      expect(prop.approved).to.equal(false);
      expect(prop.owner).to.equal(ctx.propOwner.address);
    });
  });

  // ─── approveProperty ─────────────────────────────────────────────────────

  describe("approveProperty", function () {
    beforeEach(async function () {
      await createProperty(ctx);
    });

    it("admin can approve a property with a future deadline", async function () {
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, FAR_FUTURE);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.approved).to.equal(true);
      expect(prop.raiseDeadline).to.equal(FAR_FUTURE);
    });

    it("emits ApproveProperty event", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).approveProperty(0, FAR_FUTURE)
      ).to.emit(ctx.tokenFactory, "ApproveProperty").withArgs(0, FAR_FUTURE);
    });

    it("non-admin cannot approve property", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).approveProperty(0, FAR_FUTURE)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts if property is already approved", async function () {
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, FAR_FUTURE);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).approveProperty(0, FAR_FUTURE)
      ).to.be.revertedWith("Already Approved");
    });

    it("reverts if property has been canceled", async function () {
      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).approveProperty(0, FAR_FUTURE)
      ).to.be.revertedWith("Already Canceled");
    });
  });

  // ─── cancelProperty ───────────────────────────────────────────────────────

  describe("cancelProperty", function () {
    beforeEach(async function () {
      await createProperty(ctx);
    });

    it("admin can cancel an unapproved property", async function () {
      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0);
      expect(await ctx.tokenFactory.deadProperty(0)).to.equal(true);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.raiseDeadline).to.equal(0);
      expect(prop.approved).to.equal(false);
    });

    it("admin can cancel an approved property", async function () {
      await approveProperty(ctx, 0);
      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0);
      expect(await ctx.tokenFactory.deadProperty(0)).to.equal(true);
    });

    it("non-admin cannot cancel", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).cancelProperty(0)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("emits CancelProperty event", async function () {
      await expect(ctx.tokenFactory.connect(ctx.owner).cancelProperty(0))
        .to.emit(ctx.tokenFactory, "CancelProperty").withArgs(0);
    });

    it("investors can recover funds after cancel", async function () {
      await approveProperty(ctx, 0);
      // Buy 2 tokens: 2 * 100 = 200 < 500 threshold → recovery is allowed
      await fundAndBuy(ctx, ctx.investor1, 0, 2);
      const invested = await ctx.tokenFactory.userInvested(ctx.investor1.address, 0);
      const fee      = await ctx.tokenFactory.feeChargedToUser(ctx.investor1.address, 0);
      const before   = await ctx.eurc.balanceOf(ctx.investor1.address);

      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0);
      await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0);

      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.sub(before)).to.equal(invested.add(fee));
    });
  });

  // ─── buyTokens ────────────────────────────────────────────────────────────

  describe("buyTokens", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
    });

    it("KYC-approved investor can buy tokens", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(5);
    });

    it("records correct userInvested amount", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      const expected = 5 * PROP.tokenPrice;
      expect(await ctx.tokenFactory.userInvested(ctx.investor1.address, 0)).to.equal(expected);
    });

    it("records correct platform fee", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      const cost    = 5 * PROP.tokenPrice;
      const expFee  = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
      expect(await ctx.tokenFactory.platformFee(0)).to.equal(expFee);
    });

    it("records correct feeChargedToUser", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      const cost   = 5 * PROP.tokenPrice;
      const expFee = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
      expect(await ctx.tokenFactory.feeChargedToUser(ctx.investor1.address, 0)).to.equal(expFee);
    });

    it("records correct ownersPlatformFee (listing fee)", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      const cost      = 5 * PROP.tokenPrice;
      const expOwFee  = Math.floor(cost * PROP.listingFee / 10_000);
      expect(await ctx.tokenFactory.ownersPlatformFee(0)).to.equal(expOwFee);
    });

    it("records correct propertyOwnerShare", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      const cost      = 5 * PROP.tokenPrice;
      const ownersFee = Math.floor(cost * PROP.listingFee / 10_000);
      expect(await ctx.tokenFactory.propertyOwnerShare(0)).to.equal(cost - ownersFee);
    });

    it("emits NewInvestment event", async function () {
      await kycApprove(ctx, ctx.investor1);
      await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 10000);
      await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 0, 5, ethers.constants.AddressZero
        )
      ).to.emit(ctx.tokenFactory, "NewInvestment");
    });

    it("reverts if caller is not KYC approved", async function () {
      await ctx.eurc.connect(ctx.owner).mint(ctx.random.address, 10000);
      await ctx.eurc.connect(ctx.random).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.random).buyTokens(
          ctx.random.address, 0, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if onBehalfOf is not KYC approved", async function () {
      await kycApprove(ctx, ctx.investor1);
      await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 10000);
      await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.random.address, 0, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if system is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 0, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("All Hesty Paused");
    });

    it("reverts if caller is blacklisted", async function () {
      await kycApprove(ctx, ctx.investor1);
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor1.address);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 0, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Blacklisted");
    });

    it("reverts if boughtTokensPrice < minInvAmount", async function () {
      await ctx.tokenFactory.connect(ctx.owner).setMinInvAmount(99999);
      await kycApprove(ctx, ctx.investor1);
      await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 10000);
      await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 0, 1, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Lower than min");
    });

    it("reverts when property is not approved (deadline=0 fires first)", async function () {
      // An unapproved property has raiseDeadline=0 < block.timestamp, so
      // the "Raise expired" guard fires before "Property Not For Sale".
      await createProperty(ctx); // propId = 1, never approved → raiseDeadline = 0
      await kycApprove(ctx, ctx.investor1);
      await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 10000);
      await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 1, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Raise expired");
    });

    it("reverts if deadline is expired", async function () {
      const shortDeadline = (await ethers.provider.getBlock("latest")).timestamp + 10;
      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0); // re-use propId 0 slot by creating new
      await createProperty(ctx); // propId 1
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(1, shortDeadline);
      await increaseTime(20);
      await kycApprove(ctx, ctx.investor1);
      await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 10000);
      await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
      await expect(
        ctx.tokenFactory.connect(ctx.investor1).buyTokens(
          ctx.investor1.address, 1, 5, ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Raise expired");
    });

    it("raised tracks cumulative token purchases correctly", async function () {
      // amountToSell is stored as amount * 1e18 (for ERC20 parity), while raised
      // is incremented by the raw token count from each buyTokens call.
      // The "Too much raised" guard therefore only fires when raised exceeds
      // amountToSell (= PROP.amount * 1e18), which requires astronomical input.
      // This test verifies that raised increments correctly with each purchase.
      await fundAndBuy(ctx, ctx.investor1, 0, 3);
      await fundAndBuy(ctx, ctx.investor2, 0, 4);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.raised).to.equal(7); // 3 + 4
    });

    it("multiple investors can buy from same property", async function () {
      await fundAndBuy(ctx, ctx.investor1, 0, 3);
      await fundAndBuy(ctx, ctx.investor2, 0, 2);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(3);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor2.address, 0)).to.equal(2);
      expect((await ctx.tokenFactory.property(0)).raised).to.equal(5);
    });
  });

  // ─── adminBuyTokens ───────────────────────────────────────────────────────

  describe("adminBuyTokens", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await kycApprove(ctx, ctx.investor1);
    });

    it("FUNDS_MANAGER can buy tokens on behalf of a KYC'd user", async function () {
      await ctx.tokenFactory.connect(ctx.fundsManager).adminBuyTokens(0, ctx.investor1.address, 5);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(5);
    });

    it("emits NewInvestment event", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.fundsManager).adminBuyTokens(0, ctx.investor1.address, 5)
      ).to.emit(ctx.tokenFactory, "NewInvestment");
    });

    it("non-FUNDS_MANAGER cannot call adminBuyTokens", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).adminBuyTokens(0, ctx.investor1.address, 5)
      ).to.be.revertedWith("Not Funds Manager");
    });

    it("reverts if buyer is not KYC approved", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.fundsManager).adminBuyTokens(0, ctx.random.address, 5)
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if deadline has passed", async function () {
      const shortDL = (await ethers.provider.getBlock("latest")).timestamp + 10;
      await createProperty(ctx); // propId 1
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(1, shortDL);
      await increaseTime(20);
      await expect(
        ctx.tokenFactory.connect(ctx.fundsManager).adminBuyTokens(1, ctx.investor1.address, 5)
      ).to.be.revertedWith("Raise expired");
    });

    it("does not charge investor EURC (off-chain payment)", async function () {
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await ctx.tokenFactory.connect(ctx.fundsManager).adminBuyTokens(0, ctx.investor1.address, 5);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after).to.equal(before); // balance unchanged
    });
  });

  // ─── completeRaise ────────────────────────────────────────────────────────

  describe("completeRaise", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      // Invest enough to meet threshold (5 tokens)
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
    });

    it("admin can complete a raise when threshold is met", async function () {
      await ctx.tokenFactory.connect(ctx.owner).completeRaise(0);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.isCompleted).to.equal(true);
    });

    it("emits CompleteRaise event", async function () {
      await expect(ctx.tokenFactory.connect(ctx.owner).completeRaise(0))
        .to.emit(ctx.tokenFactory, "CompleteRaise").withArgs(0);
    });

    it("transfers platformFee to treasury", async function () {
      const cost   = 5 * PROP.tokenPrice;
      const fee    = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
      const before = await ctx.eurc.balanceOf(ctx.treasury.address);
      await ctx.tokenFactory.connect(ctx.owner).completeRaise(0);
      const after  = await ctx.eurc.balanceOf(ctx.treasury.address);
      // treasury receives platformFee + ownersPlatformFee
      const ownersFee = Math.floor(cost * PROP.listingFee / 10_000);
      expect(after.sub(before)).to.equal(fee + ownersFee);
    });

    it("transfers propertyOwnerShare to property owner", async function () {
      const cost      = 5 * PROP.tokenPrice;
      const ownersFee = Math.floor(cost * PROP.listingFee / 10_000);
      const expShare  = cost - ownersFee;
      const before    = await ctx.eurc.balanceOf(ctx.propOwner.address);
      await ctx.tokenFactory.connect(ctx.owner).completeRaise(0);
      const after     = await ctx.eurc.balanceOf(ctx.propOwner.address);
      expect(after.sub(before)).to.equal(expShare);
    });

    it("zeroes out fee accounting", async function () {
      await ctx.tokenFactory.connect(ctx.owner).completeRaise(0);
      expect(await ctx.tokenFactory.platformFee(0)).to.equal(0);
      expect(await ctx.tokenFactory.ownersPlatformFee(0)).to.equal(0);
      expect(await ctx.tokenFactory.propertyOwnerShare(0)).to.equal(0);
    });

    it("non-admin cannot complete raise", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).completeRaise(0)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts if threshold not met", async function () {
      await createProperty(ctx); // propId 1, threshold = 500
      await approveProperty(ctx, 1);
      await fundAndBuy(ctx, ctx.investor1, 1, 2); // only 200, threshold is 500
      await expect(
        ctx.tokenFactory.connect(ctx.owner).completeRaise(1)
      ).to.be.revertedWith("Threshold not met");
    });

    it("reverts if already completed", async function () {
      await ctx.tokenFactory.connect(ctx.owner).completeRaise(0);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).completeRaise(0)
      ).to.be.revertedWith("Canceled or Already Completed");
    });

    it("reverts if property is canceled", async function () {
      await ctx.tokenFactory.connect(ctx.owner).cancelProperty(0);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).completeRaise(0)
      ).to.be.revertedWith("Canceled or Already Completed");
    });
  });

  // ─── getInvestmentTokens ──────────────────────────────────────────────────

  describe("getInvestmentTokens", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);
    });

    it("investor receives property tokens after raise completes", async function () {
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0);
      const pt      = await getPropertyToken(ctx, 0);
      const balance = await pt.balanceOf(ctx.investor1.address);
      expect(balance).to.equal(ethers.utils.parseEther("5"));
    });

    it("zeroes out rightForTokens after claim", async function () {
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(0);
    });

    it("emits GetInvestmentTokens event", async function () {
      await expect(ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0))
        .to.emit(ctx.tokenFactory, "GetInvestmentTokens")
        .withArgs(ctx.investor1.address, 0);
    });

    it("reverts before raise is completed", async function () {
      await createProperty(ctx); // propId 1
      await approveProperty(ctx, 1);
      await fundAndBuy(ctx, ctx.investor1, 1, 5);
      await expect(
        ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 1)
      ).to.be.revertedWith("Time not valid");
    });

    it("calling again after all tokens claimed is a no-op", async function () {
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0);
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0); // should not revert
      const pt = await getPropertyToken(ctx, 0);
      expect(await pt.balanceOf(ctx.investor1.address)).to.equal(ethers.utils.parseEther("5"));
    });
  });

  // ─── distributeRevenue ────────────────────────────────────────────────────

  describe("distributeRevenue", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);
    });

    it("anyone can distribute revenue after raise completes", async function () {
      const amt = 20_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.random.address, amt);
      await ctx.eurc.connect(ctx.random).approve(ctx.tokenFactory.address, amt);
      await ctx.tokenFactory.connect(ctx.random).distributeRevenue(0, amt);
    });

    it("emits RevenuePayment event", async function () {
      const amt = 20_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, amt);
      await expect(ctx.tokenFactory.connect(ctx.owner).distributeRevenue(0, amt))
        .to.emit(ctx.tokenFactory, "RevenuePayment").withArgs(0, amt);
    });

    it("reverts if raise is not completed", async function () {
      await createProperty(ctx); // propId 1, not completed
      await approveProperty(ctx, 1);
      const amt = 20_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, amt);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).distributeRevenue(1, amt)
      ).to.be.revertedWith("Time not valid");
    });

    it("reverts if system is paused", async function () {
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      const amt = 20_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, amt);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).distributeRevenue(0, amt)
      ).to.be.revertedWith("All Hesty Paused");
    });
  });

  // ─── claimInvestmentReturns ───────────────────────────────────────────────

  describe("claimInvestmentReturns", function () {
    beforeEach(async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);
      // Give investor their property tokens
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0);
      // Distribute some revenue
      const amt = 50_000;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, amt);
      await ctx.tokenFactory.connect(ctx.owner).distributeRevenue(0, amt);
    });

    it("anyone can trigger claim for a user", async function () {
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await ctx.tokenFactory.connect(ctx.owner).claimInvestmentReturns(ctx.investor1.address, 0);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.gt(before)).to.equal(true);
    });

    it("emits ClaimProfits event", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).claimInvestmentReturns(ctx.investor1.address, 0)
      ).to.emit(ctx.tokenFactory, "ClaimProfits").withArgs(ctx.investor1.address, 0);
    });

    it("reverts if raise not completed", async function () {
      await createProperty(ctx); // propId 1
      await approveProperty(ctx, 1);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).claimInvestmentReturns(ctx.investor1.address, 1)
      ).to.be.revertedWith("Time not valid");
    });
  });

  // ─── recoverFundsInvested ─────────────────────────────────────────────────

  describe("recoverFundsInvested", function () {
    it("investor can recover funds after deadline passes and threshold not met", async function () {
      await createProperty(ctx);
      const shortDL = (await ethers.provider.getBlock("latest")).timestamp + 100;
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, shortDL);
      await fundAndBuy(ctx, ctx.investor1, 0, 2); // 200 < 500 threshold

      const invested = await ctx.tokenFactory.userInvested(ctx.investor1.address, 0);
      const fee      = await ctx.tokenFactory.feeChargedToUser(ctx.investor1.address, 0);
      const before   = await ctx.eurc.balanceOf(ctx.investor1.address);

      await increaseTime(200);
      await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0);

      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.sub(before)).to.equal(invested.add(fee));
    });

    it("zeroes out user accounting after recovery", async function () {
      await createProperty(ctx);
      const shortDL = (await ethers.provider.getBlock("latest")).timestamp + 100;
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, shortDL);
      await fundAndBuy(ctx, ctx.investor1, 0, 2);
      await increaseTime(200);
      await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0);
      expect(await ctx.tokenFactory.userInvested(ctx.investor1.address, 0)).to.equal(0);
      expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, 0)).to.equal(0);
      expect(await ctx.tokenFactory.feeChargedToUser(ctx.investor1.address, 0)).to.equal(0);
    });

    it("emits RecoverFunds event", async function () {
      await createProperty(ctx);
      const shortDL = (await ethers.provider.getBlock("latest")).timestamp + 100;
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, shortDL);
      await fundAndBuy(ctx, ctx.investor1, 0, 2);
      await increaseTime(200);
      await expect(ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0))
        .to.emit(ctx.tokenFactory, "RecoverFunds").withArgs(ctx.investor1.address, 0);
    });

    it("reverts if deadline has not passed yet", async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0); // FAR_FUTURE deadline
      await fundAndBuy(ctx, ctx.investor1, 0, 2);
      await expect(
        ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0)
      ).to.be.revertedWith("Time not valid");
    });

    it("reverts if raise was completed (threshold met)", async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5); // meets threshold
      await completeRaise(ctx, 0);
      // even though isCompleted=true, the condition in recoverFunds checks !isCompleted
      await expect(
        ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0)
      ).to.be.revertedWith("Time not valid");
    });

    it("reverts if threshold was reached (even if deadline passed)", async function () {
      await createProperty(ctx);
      const shortDL = (await ethers.provider.getBlock("latest")).timestamp + 100;
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, shortDL);
      await fundAndBuy(ctx, ctx.investor1, 0, 5); // meets threshold, 5*100=500>=500
      await increaseTime(200);
      await expect(
        ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, 0)
      ).to.be.revertedWith("Threshold reached, cannot recover funds");
    });
  });

  // ─── extendRaiseForProperty ───────────────────────────────────────────────

  describe("extendRaiseForProperty", function () {
    let baseDeadline;

    beforeEach(async function () {
      await createProperty(ctx);
      const block    = await ethers.provider.getBlock("latest");
      baseDeadline   = block.timestamp + 30 * ONE_DAY;
      await ctx.tokenFactory.connect(ctx.owner).approveProperty(0, baseDeadline);
    });

    it("admin can extend the deadline within 15-day window", async function () {
      const extended = baseDeadline + 7 * ONE_DAY; // +7 days (≤ +15 days)
      await ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, extended);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.raiseDeadline).to.equal(extended);
      expect(prop.extended).to.equal(true);
    });

    it("emits NewPropertyDeadline event", async function () {
      const extended = baseDeadline + 7 * ONE_DAY;
      await expect(ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, extended))
        .to.emit(ctx.tokenFactory, "NewPropertyDeadline").withArgs(0, extended);
    });

    it("non-admin cannot extend", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).extendRaiseForProperty(0, baseDeadline + ONE_DAY)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("reverts if new deadline is not greater than current deadline", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, baseDeadline)
      ).to.be.revertedWith("Invalid deadline");
    });

    it("reverts if new deadline exceeds 15-day extension window", async function () {
      const tooFar = baseDeadline + 16 * ONE_DAY;
      await expect(
        ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, tooFar)
      ).to.be.revertedWith("Invalid deadline");
    });

    it("cannot extend twice", async function () {
      const extended = baseDeadline + 7 * ONE_DAY;
      await ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, extended);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(0, extended + ONE_DAY)
      ).to.be.revertedWith("Invalid deadline");
    });
  });

  // ─── isRefClaimable ───────────────────────────────────────────────────────

  describe("isRefClaimable", function () {
    it("returns false before raise is completed", async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      expect(await ctx.tokenFactory.isRefClaimable(0)).to.equal(false);
    });

    it("returns true after completed raise with threshold met", async function () {
      await createProperty(ctx);
      await approveProperty(ctx, 0);
      await fundAndBuy(ctx, ctx.investor1, 0, 5);
      await completeRaise(ctx, 0);
      expect(await ctx.tokenFactory.isRefClaimable(0)).to.equal(true);
    });
  });

  // ─── getPropertyInfo ──────────────────────────────────────────────────────

  describe("getPropertyInfo", function () {
    it("returns asset and revenue token addresses", async function () {
      await createProperty(ctx);
      const [asset, revToken] = await ctx.tokenFactory.getPropertyInfo(0);
      expect(asset).to.not.equal(ethers.constants.AddressZero);
      expect(revToken).to.equal(ctx.eurc.address);
    });
  });

  // ─── Admin setters ────────────────────────────────────────────────────────

  describe("Admin setters", function () {
    it("setPlatformFee — admin sets valid fee", async function () {
      await expect(ctx.tokenFactory.connect(ctx.owner).setPlatformFee(500))
        .to.emit(ctx.tokenFactory, "NewPlatformFee").withArgs(500);
      expect(await ctx.tokenFactory.platformFeeBasisPoints()).to.equal(500);
    });

    it("setPlatformFee — reverts for non-admin", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).setPlatformFee(500)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("setPlatformFee — reverts if fee >= MAX_FEE_POINTS", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setPlatformFee(3000)
      ).to.be.revertedWith("Fee must be valid");
    });

    it("setOwnersFee — admin sets valid fee", async function () {
      await createProperty(ctx);
      await expect(ctx.tokenFactory.connect(ctx.owner).setOwnersFee(0, 500))
        .to.emit(ctx.tokenFactory, "NewOwnersFee").withArgs(0, 500);
      expect(await ctx.tokenFactory.ownersFeeBasisPoints(0)).to.equal(500);
    });

    it("setOwnersFee — reverts for non-admin", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).setOwnersFee(0, 500)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("setOwnersFee — reverts if fee >= MAX_FEE_POINTS", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setOwnersFee(0, 3000)
      ).to.be.revertedWith("Fee must be valid");
    });

    it("setTreasury — admin can update treasury", async function () {
      await expect(ctx.tokenFactory.connect(ctx.owner).setTreasury(ctx.random.address))
        .to.emit(ctx.tokenFactory, "NewTreasury").withArgs(ctx.random.address);
      expect(await ctx.tokenFactory.treasury()).to.equal(ctx.random.address);
    });

    it("setTreasury — reverts for non-admin", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).setTreasury(ctx.random.address)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("setTreasury — reverts for zero address", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setTreasury(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not allowed");
    });

    it("setMinInvAmount — admin can update", async function () {
      await ctx.tokenFactory.connect(ctx.owner).setMinInvAmount(1000);
      expect(await ctx.tokenFactory.minInvAmount()).to.equal(1000);
    });

    it("setMinInvAmount — reverts for non-admin", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.random).setMinInvAmount(1000)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("setMinInvAmount — reverts for zero amount", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setMinInvAmount(0)
      ).to.be.revertedWith("Amount too low");
    });

    it("setIssuanceContract — admin can update", async function () {
      const Issuance2 = await ethers.getContractFactory("HestyAssetIssuance");
      const iss2 = await Issuance2.deploy(ctx.tokenFactory.address);
      await iss2.deployed();
      await expect(ctx.tokenFactory.connect(ctx.owner).setIssuanceContract(iss2.address))
        .to.emit(ctx.tokenFactory, "NewIssuanceContract").withArgs(iss2.address);
    });

    it("setIssuanceContract — reverts for zero address", async function () {
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setIssuanceContract(ethers.constants.AddressZero)
      ).to.be.revertedWith("Not allowed");
    });

    it("setNewPropertyOwnerReceiverAddress — admin can update", async function () {
      await createProperty(ctx);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setNewPropertyOwnerReceiverAddress(0, ctx.random.address)
      ).to.emit(ctx.tokenFactory, "NewPropertyOwnerAddrReceiver").withArgs(ctx.random.address);
      const prop = await ctx.tokenFactory.property(0);
      expect(prop.ownerExchAddr).to.equal(ctx.random.address);
    });

    it("setNewPropertyOwnerReceiverAddress — reverts for zero address", async function () {
      await createProperty(ctx);
      await expect(
        ctx.tokenFactory.connect(ctx.owner).setNewPropertyOwnerReceiverAddress(0, ethers.constants.AddressZero)
      ).to.be.revertedWith("Address must be valid");
    });
  });
});
