const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Token Factory - Comprehensive Tests", function () {
  let hestyAccessControlCtr, tokenFactory, token, referral, issuance;
  let owner, propertyManager, addr1, addr2, addr3, addr4, addr5;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function setupFullEnvironment() {
    await tokenFactory.initialize(referral.address, issuance.address);
    await hestyAccessControlCtr.connect(addr2).approveUserKYC(propertyManager.address);
    await tokenFactory.addWhitelistedToken(token.address);
  }

  async function createProperty() {
    await tokenFactory
      .connect(propertyManager)
      .createProperty(1000000, 1000, 4, 10000000, token.address, token.address, "token", "TKN", hestyAccessControlCtr.address);
  }

  async function setupBuyerAndBuy(buyer, amount, referralAddr = ethers.constants.AddressZero) {
    await hestyAccessControlCtr.connect(addr2).approveUserKYC(buyer.address);
    await token.mint(buyer.address, 100000);
    await token.connect(buyer).approve(tokenFactory.address, 100000);
    await tokenFactory.buyTokens(buyer.address, 0, amount, referralAddr);
  }

  // ─── Fixtures ───────────────────────────────────────────────────────────────

  beforeEach(async function () {
    [owner, propertyManager, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();

    const HestyAccessControl = await ethers.getContractFactory("HestyAccessControl");
    hestyAccessControlCtr = await HestyAccessControl.connect(owner).deploy();
    await hestyAccessControlCtr.deployed();

    const TokenFactory = await ethers.getContractFactory("TokenFactory");
    tokenFactory = await TokenFactory.connect(owner).deploy(300, 100, owner.address, 1, hestyAccessControlCtr.address);
    await tokenFactory.deployed();

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.connect(owner).deploy("name", "symbol");
    await token.deployed();

    const Referral = await ethers.getContractFactory("ReferralSystem");
    referral = await Referral.connect(owner).deploy(token.address, hestyAccessControlCtr.address, tokenFactory.address);
    await referral.deployed();

    const Issuance = await ethers.getContractFactory("HestyAssetIssuance");
    issuance = await Issuance.connect(owner).deploy(tokenFactory.address);
    await issuance.deployed();

    // Grant KYC Manager role to addr2
    await hestyAccessControlCtr.grantRole(
      "0x1df25ad963bcdf5796797f14b691a634f65032f90fca9c8f59fd3b590a07e949",
      addr2.address
    );
  });

  // ─── Constants ──────────────────────────────────────────────────────────────

  describe("Constants", function () {
    it("Returns correct BLACKLIST_MANAGER hash", async function () {
      expect(await tokenFactory.BLACKLIST_MANAGER()).to.equal(
        "0x46a5e99059e0b949704bc0cc0e3748d22c5f6ededc6f4a64b1e645b926d1163b"
      );
    });

    it("Returns correct FUNDS_MANAGER hash", async function () {
      expect(await tokenFactory.FUNDS_MANAGER()).to.equal(
        "0x93779bf6be703205517715c86297c193472c9d5533e90609b671022041168a4c"
      );
    });

    it("Returns correct KYC_MANAGER hash", async function () {
      expect(await tokenFactory.KYC_MANAGER()).to.equal(
        "0x1df25ad963bcdf5796797f14b691a634f65032f90fca9c8f59fd3b590a07e949"
      );
    });

    it("Returns correct PAUSER_MANAGER hash", async function () {
      expect(await tokenFactory.PAUSER_MANAGER()).to.equal(
        "0x9ad250910475b46679c53074aa5d6cd2421e8c7126f9eb9c2d0aeeebbe1df64d"
      );
    });
  });

  // ─── Initialization ─────────────────────────────────────────────────────────

  describe("Initialization", function () {
    it("Starts as not initialized", async function () {
      expect(await tokenFactory.initialized()).to.equal(false);
    });

    it("Non-admin cannot initialize", async function () {
      await expect(
        tokenFactory.connect(propertyManager).initialize(referral.address, issuance.address)
      ).to.be.revertedWith("Not Admin Manager");
      expect(await tokenFactory.initialized()).to.equal(false);
    });

    it("Admin can initialize", async function () {
      await tokenFactory.initialize(referral.address, issuance.address);
      expect(await tokenFactory.initialized()).to.equal(true);
    });

    it("Cannot initialize twice", async function () {
      await tokenFactory.initialize(referral.address, issuance.address);
      await expect(
        tokenFactory.initialize(referral.address, issuance.address)
      ).to.be.reverted;
    });

    it("referralSystemCtr is zero before initialization", async function () {
      expect(await tokenFactory.referralSystemCtr()).to.equal(ethers.constants.AddressZero);
    });

    it("referralSystemCtr is set after initialization", async function () {
      await tokenFactory.initialize(referral.address, issuance.address);
      expect(await tokenFactory.referralSystemCtr()).to.equal(referral.address);
    });
  });

  // ─── Default State ──────────────────────────────────────────────────────────

  describe("Default State / Getters", function () {
    it("propertyCounter starts at 0", async function () {
      expect(await tokenFactory.propertyCounter()).to.equal(0);
    });

    it("minInvAmount starts at 1", async function () {
      expect(await tokenFactory.minInvAmount()).to.equal(1);
    });

    it("maxNumberOfReferrals is 20", async function () {
      expect(await tokenFactory.maxNumberOfReferrals()).to.equal(20);
    });

    it("maxAmountOfRefRev is 10000000000", async function () {
      expect(await tokenFactory.maxAmountOfRefRev()).to.equal(10000000000);
    });

    it("treasury is owner", async function () {
      expect(await tokenFactory.treasury()).to.equal(owner.address);
    });

    it("ctrHestyControl is correct for any caller", async function () {
      expect(await tokenFactory.ctrHestyControl()).to.equal(hestyAccessControlCtr.address);
      expect(await tokenFactory.connect(addr2).ctrHestyControl()).to.equal(hestyAccessControlCtr.address);
      expect(await tokenFactory.connect(propertyManager).ctrHestyControl()).to.equal(hestyAccessControlCtr.address);
    });
  });

  // ─── Whitelisted Tokens ─────────────────────────────────────────────────────

  describe("Whitelisted Tokens", function () {
    it("Non-admin cannot whitelist token", async function () {
      await expect(
        tokenFactory.connect(addr1).addWhitelistedToken(token.address)
      ).to.be.reverted;
    });

    it("Admin can whitelist token", async function () {
      await tokenFactory.addWhitelistedToken(token.address);
    });

    it("Cannot create property with non-whitelisted token", async function () {
      await tokenFactory.initialize(referral.address, issuance.address);
      await hestyAccessControlCtr.connect(addr2).approveUserKYC(propertyManager.address);
      await expect(
        tokenFactory.connect(propertyManager).createProperty(
          1000000, 1000, 4, 10000000, token.address, token.address, "token", "TKN", hestyAccessControlCtr.address
        )
      ).to.be.reverted;
    });
  });

  // ─── Property Creation ──────────────────────────────────────────────────────

  describe("Property Creation", function () {
    beforeEach(async function () {
      await setupFullEnvironment();
    });

    it("KYC-approved manager can create property", async function () {
      await createProperty();
      expect(await tokenFactory.propertyCounter()).to.equal(1);
    });

    it("Non-KYC user cannot create property", async function () {
      await expect(
        tokenFactory.connect(addr1).createProperty(
          1000000, 1000, 4, 10000000, token.address, token.address, "token", "TKN", hestyAccessControlCtr.address
        )
      ).to.be.reverted;
    });

    it("Multiple properties increment counter correctly", async function () {
      await createProperty();
      await createProperty();
      await createProperty();
      expect(await tokenFactory.propertyCounter()).to.equal(3);
    });

    it("Issuance contract cannot be called directly to create property token", async function () {
      await expect(
        issuance.createPropertyToken(1000000, token.address, "token", "TKN", hestyAccessControlCtr.address, addr1.address)
      ).to.be.revertedWith("Not TokenFactory");
    });
  });

  // ─── Buy Tokens ─────────────────────────────────────────────────────────────

  describe("Buy Tokens", function () {
    beforeEach(async function () {
      await setupFullEnvironment();
      await createProperty();
      await tokenFactory.approveProperty(0, 2937487238472834);
    });

    it("Buy tokens without referral", async function () {
      await setupBuyerAndBuy(owner, 2);
    });

    it("Buy tokens with referral", async function () {
      await setupBuyerAndBuy(owner, 2, addr3.address);
    });

    it("Non-KYC user cannot buy tokens", async function () {
      await token.mint(addr1.address, 100000);
      await token.connect(addr1).approve(tokenFactory.address, 100000);
      await expect(
        tokenFactory.buyTokens(addr1.address, 0, 2, ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("Cannot buy below min investment amount", async function () {
      await hestyAccessControlCtr.connect(addr2).approveUserKYC(owner.address);
      await token.mint(owner.address, 100000);
      await token.connect(owner).approve(tokenFactory.address, 100000);
      await expect(
        tokenFactory.buyTokens(owner.address, 0, 0, ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("Cannot buy without token approval", async function () {
      await hestyAccessControlCtr.connect(addr2).approveUserKYC(owner.address);
      await token.mint(owner.address, 100000);
      // No approve call
      await expect(
        tokenFactory.buyTokens(owner.address, 0, 2, ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("Multiple buyers can buy tokens from same property", async function () {
      await setupBuyerAndBuy(owner, 2);
      await setupBuyerAndBuy(addr1, 2);
      await setupBuyerAndBuy(addr3, 2);
    });
  });

  // ─── Revenue Distribution ───────────────────────────────────────────────────

  describe("Revenue Distribution", function () {
    beforeEach(async function () {
      await setupFullEnvironment();
      await createProperty();
      await tokenFactory.approveProperty(0, 2937487238472834);
      await setupBuyerAndBuy(owner, 2, addr3.address);
    });

    it("Cannot distribute revenue before deadline", async function () {
      await token.mint(addr4.address, 40000);
      await token.connect(addr4).approve(tokenFactory.address, 20002);
      await expect(
        tokenFactory.connect(addr4).distributeRevenue(0, 9999)
      ).to.be.revertedWith("Time not valid");
    });

    it("Cannot claim returns before deadline", async function () {
      await expect(
        tokenFactory.connect(addr4).claimInvestmentReturns(addr4.address, 0)
      ).to.be.revertedWith("Time not valid");
    });

    it("Cannot recover funds before deadline", async function () {
      await expect(
        tokenFactory.connect(addr4).recoverFundsInvested(addr4.address, 0)
      ).to.be.revertedWith("Time not valid");
    });

    it("Cannot distribute revenue for non-existent property", async function () {
      await token.mint(addr4.address, 40000);
      await token.connect(addr4).approve(tokenFactory.address, 20002);
      await expect(
        tokenFactory.connect(addr4).distributeRevenue(999, 9999)
      ).to.be.reverted;
    });
  });

  // ─── Extend Raise ───────────────────────────────────────────────────────────

  describe("Extend Raise", function () {
    beforeEach(async function () {
      await setupFullEnvironment();
      await createProperty();
      await tokenFactory.approveProperty(0, 2937487238472834);
      await setupBuyerAndBuy(owner, 2, addr3.address);
    });

    it("Non-admin cannot extend raise", async function () {
      await expect(
        tokenFactory.connect(addr4).extendRaiseForProperty(0, 1000000000000)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("Cannot extend with invalid (past) deadline", async function () {
      await expect(
        tokenFactory.extendRaiseForProperty(0, 2937487238472824)
      ).to.be.revertedWith("Invalid deadline");
    });

    it("Admin can extend raise with valid future deadline", async function () {
      await tokenFactory.extendRaiseForProperty(0, 2937487238472838);
    });

    it("Can recover funds after deadline passes", async function () {
      await ethers.provider.send("evm_mine", [2937487238472844]);
      await tokenFactory.connect(addr4).recoverFundsInvested(addr4.address, 0);
      expect(await tokenFactory.isRefClaimable(0)).to.equal(false);
    });
  });

  // ─── Admin Setters ──────────────────────────────────────────────────────────

  describe("Admin Setters", function () {
    it("setOwnersFee - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setOwnersFee(0, 1000)).to.be.revertedWith("Not Admin Manager");
    });

    it("setOwnersFee - invalid fee reverts", async function () {
      await expect(tokenFactory.setOwnersFee(0, 10000)).to.be.revertedWith("Fee must be valid");
    });

    it("setOwnersFee - emits NewOwnersFee event", async function () {
      await expect(tokenFactory.setOwnersFee(0, 1000))
        .to.emit(tokenFactory, "NewOwnersFee")
        .withArgs(0, 1000);
    });

    it("setPlatformFee - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setPlatformFee(1000)).to.be.revertedWith("Not Admin Manager");
    });

    it("setPlatformFee - invalid fee reverts", async function () {
      await expect(tokenFactory.setPlatformFee(10000)).to.be.revertedWith("Fee must be valid");
    });

    it("setPlatformFee - emits NewPlatformFee event", async function () {
      await expect(tokenFactory.setPlatformFee(1000))
        .to.emit(tokenFactory, "NewPlatformFee")
        .withArgs(1000);
    });

    it("setMinInvAmount - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setMinInvAmount(10000)).to.be.revertedWith("Not Admin Manager");
    });

    it("setMinInvAmount - admin can set", async function () {
      await tokenFactory.setMinInvAmount(10);
      expect(await tokenFactory.minInvAmount()).to.equal(10);
    });

    it("setMaxNumberOfReferrals - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setMaxNumberOfReferrals(10000)).to.be.revertedWith("Not Admin Manager");
    });

    it("setMaxNumberOfReferrals - admin can set", async function () {
      await tokenFactory.setMaxNumberOfReferrals(50);
      expect(await tokenFactory.maxNumberOfReferrals()).to.equal(50);
    });

    it("setMaxAmountOfRefRev - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setMaxAmountOfRefRev(100000000)).to.be.revertedWith("Not Admin Manager");
    });

    it("setMaxAmountOfRefRev - admin can set", async function () {
      await tokenFactory.setMaxAmountOfRefRev(999999);
      expect(await tokenFactory.maxAmountOfRefRev()).to.equal(999999);
    });

    it("setTreasury - zero address reverts", async function () {
      await expect(tokenFactory.setTreasury(ethers.constants.AddressZero)).to.be.revertedWith("Not allowed");
    });

    it("setTreasury - non-admin reverts", async function () {
      await expect(tokenFactory.connect(addr4).setTreasury(addr1.address)).to.be.revertedWith("Not Admin Manager");
    });

    it("setTreasury - emits NewTreasury event", async function () {
      await expect(tokenFactory.setTreasury(addr1.address))
        .to.emit(tokenFactory, "NewTreasury")
        .withArgs(addr1.address);
    });

    it("setTreasury - updates treasury address", async function () {
      await tokenFactory.setTreasury(addr1.address);
      expect(await tokenFactory.treasury()).to.equal(addr1.address);
    });

    it("setReferralContract - zero address reverts", async function () {
      await expect(tokenFactory.setReferralContract(ethers.constants.AddressZero)).to.be.revertedWith("Not allowed");
    });

    it("setReferralContract - non-admin reverts", async function () {
      const Referral2 = await ethers.getContractFactory("ReferralSystem");
      const referral2 = await Referral2.connect(owner).deploy(token.address, hestyAccessControlCtr.address, tokenFactory.address);
      await referral2.deployed();
      await expect(tokenFactory.connect(addr4).setReferralContract(referral2.address)).to.be.revertedWith("Not Admin Manager");
    });

    it("setReferralContract - emits NewReferralSystemCtr event", async function () {
      const Referral2 = await ethers.getContractFactory("ReferralSystem");
      const referral2 = await Referral2.connect(owner).deploy(token.address, hestyAccessControlCtr.address, tokenFactory.address);
      await referral2.deployed();
      await expect(tokenFactory.setReferralContract(referral2.address))
        .to.emit(tokenFactory, "NewReferralSystemCtr")
        .withArgs(referral2.address);
    });

    it("setIssuanceContract - zero address reverts", async function () {
      await expect(tokenFactory.setIssuanceContract(ethers.constants.AddressZero)).to.be.revertedWith("Not allowed");
    });

    it("setIssuanceContract - non-admin reverts", async function () {
      const Issuance2 = await ethers.getContractFactory("HestyAssetIssuance");
      const issuance2 = await Issuance2.connect(owner).deploy(tokenFactory.address);
      await issuance2.deployed();
      await expect(tokenFactory.connect(addr4).setIssuanceContract(issuance2.address)).to.be.revertedWith("Not Admin Manager");
    });

    it("setIssuanceContract - emits NewIssuanceContract event", async function () {
      const Issuance2 = await ethers.getContractFactory("HestyAssetIssuance");
      const issuance2 = await Issuance2.connect(owner).deploy(tokenFactory.address);
      await issuance2.deployed();
      await expect(tokenFactory.setIssuanceContract(issuance2.address))
        .to.emit(tokenFactory, "NewIssuanceContract")
        .withArgs(issuance2.address);
    });
  });

  // ─── KYC Flow ───────────────────────────────────────────────────────────────

  describe("KYC Flow", function () {
    it("Unapproved user cannot buy tokens", async function () {
      await setupFullEnvironment();
      await createProperty();
      await tokenFactory.approveProperty(0, 2937487238472834);
      await token.mint(addr5.address, 100000);
      await token.connect(addr5).approve(tokenFactory.address, 100000);
      await expect(
        tokenFactory.buyTokens(addr5.address, 0, 2, ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("KYC approved user can buy tokens", async function () {
      await setupFullEnvironment();
      await createProperty();
      await tokenFactory.approveProperty(0, 2937487238472834);
      await setupBuyerAndBuy(addr5, 2);
    });
  });

  // ─── Fee Calculations ────────────────────────────────────────────────────────

  describe("Fee Boundaries", function () {
    it("Platform fee of 0 is valid", async function () {
      await expect(tokenFactory.setPlatformFee(0))
        .to.emit(tokenFactory, "NewPlatformFee")
        .withArgs(0);
    });

    it("Platform fee at exact boundary (9999) is valid", async function () {
      await expect(tokenFactory.setPlatformFee(9999))
        .to.emit(tokenFactory, "NewPlatformFee")
        .withArgs(9999);
    });

    it("Platform fee at 10000 is invalid", async function () {
      await expect(tokenFactory.setPlatformFee(10000)).to.be.revertedWith("Fee must be valid");
    });

    it("Owners fee at 0 is valid", async function () {
      await expect(tokenFactory.setOwnersFee(0, 0))
        .to.emit(tokenFactory, "NewOwnersFee")
        .withArgs(0, 0);
    });
  });
});