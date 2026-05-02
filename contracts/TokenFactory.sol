// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PropertyToken} from "./PropertyToken.sol";
import "./interfaces/IHestyAccessControl.sol";
import "./interfaces/ITokenFactory.sol";
import {IIssuance} from "./interfaces/IIssuance.sol";
import "./interfaces/IReferral.sol";
import "./Constants.sol";

/*

    @title Token Factory

    @notice Manages issuance of property tokens, stores them until they are bought
            and manages the distribution of revenue through holders. Allows
            investors to also claim the investment returns.
            In case the property fails to raise then allows users to claim
            funds back.

    @author Pedro G. S. Ferreira

    .##.....##.########.########.#########.##....##.
    .##.....##.##.......##..........##......##..##.
    .##.....##.##.........##........##........##.
    .#########.########.....##......##........##.
    .##.....##.##..........##.......##........##.
    .##.....##.##.........##........##........##.
    .##.....##.########.########....##........##.

*/

contract TokenFactory is
ReentrancyGuard,
Constants {

    IHestyAccessControl public ctrHestyControl;     // Hesty Access Control Contract
    IIssuance           public ctrHestyIssuance;    // Hesty Tokens Issuance Logic

    uint256 public propertyCounter;         // Number of properties created until now
    uint256 public minInvAmount;            // Minimum amount allowed to invest
    uint256 public platformFeeBasisPoints;  // Investment Fee charged by Hesty (in Basis Points)
    address public treasury;                // Address that will receive Hesty fees revenue
    bool    public initialized;            // Checks if the contract is already initialized

    mapping(uint256 => PropertyInfo)    public property;                // Stores properties info
    mapping(uint256 => uint256)         public platformFee;             // (Property id => fee amount) The fee earned by the platform on every investment
    mapping(uint256 => uint256)         public ownersPlatformFee;       // The fee earned by the platform on every investment
    mapping(uint256 => uint256)         public propertyOwnerShare;      // The amount reserved to propertyOwner
    mapping(uint256 => uint256)         public ownersFeeBasisPoints;    // Owners Fee charged by Hesty (in Basis Points) in each project
    mapping(uint256 => bool)            public deadProperty;            // After Canceled can no longer be approved
    mapping(address => bool)            public tokensWhitelist;         // Payment Token whitelist

    mapping(address => mapping(uint256 => uint256)) public userInvested;    // Amount invested by each user in each property
    mapping(address => mapping(uint256 => uint256)) public feeChargedToUser;// Fee charged to each user in each property
    mapping(address => mapping(uint256 => uint256)) public rightForTokens;  // Amount of tokens that each user bought

    //Events
    event              InitializeFactory( address ctrHestyIssuance_);
    event                 CreateProperty(uint256 id);
    event           NewReferralSystemCtr(address newSystemCtr);
    event           NewIssuanceContract(address newIssuanceCtr);
    event                    NewTreasury(address newTreasury);
    event   NewPropertyOwnerAddrReceiver(address newAddress);
    event                  NewInvestment(uint256 indexed propertyId, address investor, uint256 amount, uint256 amountSpent, uint256 date);
    event                 RevenuePayment(uint256 indexed propertyId, uint256 amount);
    event                 CancelProperty(uint256 propertyId);
    event                 NewPlatformFee(uint256 newFee);
    event               NewMaxNReferrals(uint256 newNumber);
    event          NewMaxReferralRevenue(uint256 newAmount);
    event            NewPropertyDeadline(uint256 propertyId, uint256 newDeadline);
    event                   NewOwnersFee(uint256 indexed id, uint256 newFee);
    event                 NewReferralFee(uint256 newFee);
    event         NewMinInvestmentAmount(uint256 minInvestmentAmount);
    event                   ClaimProfits(address indexed user, uint256 propertyId);
    event                  CompleteRaise(uint256 propertyId);
    event                   RecoverFunds(address indexed user, uint256 propertyId);
    event                ApproveProperty(uint256 propertyId, uint256 newDeadline);
    event            GetInvestmentTokens(address indexed user, uint256 propertyId);
    event              AddWhitelistToken(address token);
    event           RemoveWhitelistToken(address token);


    struct PropertyInfo{
        uint256 price;          // Price for each property token
        uint256 amountToSell;   // Amount of tokens to sell
        uint256 threshold;      // Amount necessary to proceed with investment
        uint256 raised;         // Amount tokens sold
        uint256 raiseDeadline;  // When the fundraising ends
        bool    isCompleted;    // Checks if the raise is completed
        bool    approved;       // Checks if the raise can start
        bool    extended;       // Checks if the raise was already extended
        address owner;          // Hesty owner
        address ownerExchAddr;  // Property Owner/Manager exchange address to receive EUROC
        IERC20 paymentToken;    // Token used to buy property tokens/assets
        address asset;          // Property token contract
        IERC20 revenueToken;    // Revenue token for investors

    }


    /**
        @dev    Constructor for Token Factory
        @param  fee Investment fee charged by Hesty (in Basis Points)
        @param  treasury_ The Multi-Signature Address that will receive Hesty fees revenue
        @param  minInvAmount_ Minimum amount a user can invest
        @param  ctrHestyControl_ Contract that manages access to certain functions
    */
    constructor(
        uint256 fee,
        address treasury_,
        uint256 minInvAmount_,
        address ctrHestyControl_
    ){

        require(fee < MAX_FEE_POINTS, "Invalid Platform Fee");

        platformFeeBasisPoints  = fee;
        minInvAmount            = minInvAmount_;
        treasury                = treasury_;
        initialized             = false;
        ctrHestyControl         = IHestyAccessControl(ctrHestyControl_);

    }

    /**
        @dev Checks that `msg.sender` is an Admin
    */
    modifier onlyAdmin(){
        ctrHestyControl.onlyAdmin(msg.sender);
        _;
    }

    /**
        @dev Checks that `msg.sender` is an Admin
    */
    modifier onlyFundsManager(){
        ctrHestyControl.onlyFundsManager(msg.sender);
        _;
    }

    /**
        @dev Checks that contract is initialized
    */
    modifier onlyWhenInitialized(){
        require(initialized, "Not yet init");
        _;
    }

    /**
        @dev Checks that `msg.sender` is not blacklisted
    */
    modifier whenNotBlackListed(){
        require(!ctrHestyControl.blackList(msg.sender), "Blacklisted");
        _;
    }

    /**
        @dev Checks that `msg.sender` has is KYC approved
    */
    modifier whenKYCApproved(address user){
        require(ctrHestyControl.kycCompleted(user), "No KYC Made");
        _;
    }

    /**
        @dev Checks that contracts are not paused
    */
    modifier whenNotAllPaused(){
        require(!ctrHestyControl.paused(), "All Hesty Paused");
        _;
    }

    /**
        @dev    Initialized Token Factory Contract
        @dev    It emits a `InitializeFactory` event.
    */
    function initialize(
        address ctrHestyIssuance_) external onlyAdmin{

        require(!initialized, "Already init");

        initialized       = true;
        ctrHestyIssuance = IIssuance(ctrHestyIssuance_);

        emit InitializeFactory(ctrHestyIssuance_);

    }

    /**===================================================
        NON OWNER STATE MODIFIABLE FUNTIONS
    ======================================================**/

    /**
        @dev    Issues a new property token
        @dev    It emits a `CreateProperty` event.
        @param  amount The amount of tokens to issue
        @param  tokenPrice Token Price
        @param  threshold Amount to reach in order to proceed to production
        @param  paymentToken Token that will be charged on every investment made
    */
    function createProperty(
        uint256 amount,
        uint256 listingTokenFee,
        uint256 tokenPrice,
        uint256 threshold,
        address paymentToken,
        address revenueToken,
        string memory name,
        string memory symbol,
        address admin
    ) external whenKYCApproved(msg.sender) onlyWhenInitialized whenNotAllPaused whenNotBlackListed returns(uint256) {

        require(tokensWhitelist[paymentToken] && tokensWhitelist[revenueToken], "Invalid pay token");
        require( listingTokenFee < MAX_FEE_POINTS, "Fee must be valid");

        address newAsset = IIssuance(ctrHestyIssuance).createPropertyToken(
            amount,
            address(revenueToken),
            name,
            symbol,
            address(ctrHestyControl),
            ctrHestyControl.owner() );

        property[propertyCounter++] = PropertyInfo( tokenPrice,
                                                    amount * 1 ether,
                                                    threshold,
                                                    0,
                                                    0,
                                                    false,
                                                    false,
                                                    false,
                                                    msg.sender,
                                                    msg.sender,
                                                    IERC20(paymentToken),
                                                    newAsset,
                                                    IERC20(revenueToken));

        ownersFeeBasisPoints[propertyCounter - 1] = listingTokenFee;

        emit CreateProperty(propertyCounter - 1);

        return propertyCounter - 1;
    }


    /**
        @dev    Function to buy property tokens
        @dev    It emits a `NewInvestment` event.
        @dev    If there is a referral store the fee to pay and transfer funds to this contract
        @param  id Property id
        @param  amount Amount of tokens that user wants to buy
        @param  ref The referral of the user, address(0) if doesn't exist
    */
    function buyTokens(
        address onBehalfOf,
        uint256 id,
        uint256 amount,
        address ref
    ) external nonReentrant whenNotAllPaused whenKYCApproved(msg.sender) whenKYCApproved(onBehalfOf) whenNotBlackListed{

        PropertyInfo storage p = property[id];

        // Calculate how much costs to buy tokens
        uint256 boughtTokensPrice = amount * p.price;

        // Require that raise is still active and not expired
        require(p.raiseDeadline >= block.timestamp, "Raise expired");
        require(boughtTokensPrice >= minInvAmount, "Lower than min");
        require(property[id].approved && !property[id].isCompleted, "Property Not For Sale");
        require(p.raised + amount <= p.amountToSell, "Too much raised");

        // Calculate the investment fee and then get the total investment cost
        uint256 fee    = boughtTokensPrice * platformFeeBasisPoints / BASIS_POINTS;
        uint256 total  = boughtTokensPrice + fee;

        // Charge investment cost from user
        SafeERC20.safeTransferFrom(p.paymentToken,msg.sender, address(this), total);

        // Store Platform fee and user Invested Amount Paid
        platformFee[id]                += fee;
        userInvested[msg.sender][id]   += boughtTokensPrice;
        feeChargedToUser[msg.sender][id] += fee;
        rightForTokens[onBehalfOf][id] += amount;

        /// @dev Calculate owners fee
        uint256 ownersFee = boughtTokensPrice * ownersFeeBasisPoints[id] / BASIS_POINTS;

        ownersPlatformFee[id]  += ownersFee;
        propertyOwnerShare[id] += boughtTokensPrice - ownersFee;

        p.raised     += amount;
        property[id] = p;

        emit NewInvestment(id, onBehalfOf, amount, boughtTokensPrice, block.timestamp);
    }



    /*
        @dev    Distribution of revenue through property token holders
        @dev    It emits a `RevenuePayment` event.
        @param  id Property id
        @param  amount The amount of funds in EURC to distribute
    */
    function distributeRevenue(uint256 id, uint256 amount) external nonReentrant whenNotAllPaused{

        PropertyInfo storage p = property[id];

        require(p.isCompleted, "Time not valid");

        SafeERC20.safeTransferFrom(p.revenueToken, msg.sender, address(this), amount);
        SafeERC20.forceApprove(p.revenueToken, p.asset, amount);
        PropertyToken(p.asset).distributionRewards(amount);

        emit RevenuePayment(id, amount);

    }

    /*
        @dev    Get Property Tokens after property raize is complete
        @dev    It emits a `GetInvestmentTokens` event.
        @param  user User address
        @param  id Property id
    */
    function getInvestmentTokens(address user, uint256 id) external nonReentrant whenNotAllPaused{

        PropertyInfo storage p = property[id];

        require(p.isCompleted, "Time not valid");

        // Transfer Asset to buyer
        if(rightForTokens[user][id] > 0){
            SafeERC20.safeTransfer(IERC20(p.asset), user, rightForTokens[user][id] * 1 ether);
            rightForTokens[user][id] = 0;
        }


        emit GetInvestmentTokens(user, id);
    }

    /*
        @dev    Claim Investment returns
        @dev    It emits a `ClaimProfits` event.
        @param  user that will receive investment returns
        @param  id Property id
    */
    function claimInvestmentReturns(address user, uint256 id) external nonReentrant whenNotAllPaused{

        PropertyInfo storage p = property[id];

        require(p.isCompleted, "Time not valid");

        PropertyToken(p.asset).claimDividensExternal(user);

        emit ClaimProfits(user, id);
    }

    /*
        @dev    Claim Investment returns
        @dev    It emits a `RecoverFunds` event.
        @param  user that will receive recover investment
        @param  id Property id
    */
    function recoverFundsInvested(address user, uint256 id) external nonReentrant whenNotAllPaused {

        PropertyInfo storage p = property[id];

        require(p.raiseDeadline < block.timestamp && !p.isCompleted, "Time not valid"); // @dev it must be < not <=
        require(p.raised * p.price < p.threshold, "Threshold reached, cannot recover funds");

        uint256 amount         = userInvested[user][id] + feeChargedToUser[user][id];
        userInvested[user][id] = 0;
        rightForTokens[user][id] = 0;
        feeChargedToUser[user][id] = 0;

        SafeERC20.safeTransfer(p.paymentToken, user, amount);

        emit RecoverFunds(user, id);

    }

    /**=====================================
        Viewable Functions
    =========================================*/

    /**
        @dev    Checks if people can claim their referral share of a property
        @param  id Property Id
        @return If it is already possible to claim referral rewards
    */
    function isRefClaimable(uint256 id) external view returns(bool){
        return property[id].threshold <= property[id].raised * property[id].price && property[id].isCompleted;
    }

    /**
        @dev    Returns Property representative token
        @param id Property Id
        @return Property Token
    */
    function getPropertyInfo(uint256 id) external view returns(address, address){
        return (address(property[id].asset), address(property[id].revenueToken));
    }



    /**===================================================
       OWNER STATE MODIFIABLE FUNTIONS
   ======================================================**/

    /*
        @dev    Buy Tokens without spending funds, this helpful for offchain investments
        @dev    It emits a `NewInvestment` event.
        @param  id Property id
        @param  buyer The user who will receive the property tokens
        @param  amount The amount of property tokens to buy
    */
    function adminBuyTokens(uint256 id, address buyer, uint256 amount) whenKYCApproved(buyer) external nonReentrant onlyFundsManager{

        PropertyInfo storage p    = property[id];

        // Require that raise is still active and not expired
        require(p.raiseDeadline >= block.timestamp, "Raise expired");
        require(p.raised + amount <= p.amountToSell, "Too much raised");

        // Calculate how much costs to buy tokens
        uint256 boughtTokensPrice = amount * p.price;

        rightForTokens[buyer][id] += amount;

        p.raised += amount;
        property[id] = p;

        emit NewInvestment(id, buyer, amount, boughtTokensPrice, block.timestamp);
    }

    /**
        @dev    Function to complete the property Raise
        @dev    It emits a `CompleteRaise` event.
        @dev    Send funds to property owner exchange address and fees to
                platform multisig
        @param  id Property Id
    */
    function completeRaise(uint256 id) external onlyAdmin nonReentrant{

        PropertyInfo storage p = property[id];

        require(p.approved && !p.isCompleted, "Canceled or Already Completed");
        require(p.raised * p.price >= property[id].threshold , "Threshold not met");

        property[id].isCompleted = true;

        SafeERC20.safeTransfer(p.paymentToken, treasury, platformFee[id]);
        platformFee[id] = 0;

        SafeERC20.safeTransfer(p.paymentToken,treasury,  ownersPlatformFee[id]);
        ownersPlatformFee[id] = 0;

        /// @dev Send property owners their share
        SafeERC20.safeTransfer(p.paymentToken,p.ownerExchAddr, propertyOwnerShare[id]);
        propertyOwnerShare[id] = 0;

        emit CompleteRaise(id);
    }

    /**
        @dev     Approves property to start raise
        @dev     It emits an `ApproveProperty` event.
        @param   id Property Id
        @param   raiseDeadline when the raise will end
    */
    function approveProperty(uint256 id, uint256 raiseDeadline) external onlyAdmin{

        require(!property[id].approved, "Already Approved");
        require(!deadProperty[id], "Already Canceled");

        property[id].approved = true;
        property[id].raiseDeadline = raiseDeadline;

        emit ApproveProperty(id, raiseDeadline);
    }

    /**
        @dev     In case Hesty or property Manager gives up from raising funds for property
                 allow users to claim back their funds
        @dev     It emits a `CancelProperty` event
        @param   id Property Id
    */
    function cancelProperty(uint256 id) external onlyAdmin{

        property[id].raiseDeadline = 0; // Important to allow investors to recover funds
        property[id].approved = false;  // Prevent more investments
        deadProperty[id] = true;

        emit CancelProperty(id);
    }

    /**
        @dev     Function to change platform fee
        @dev     It emits a `NewPlatformFee` event.
        @dev     Fee must be lower than total amount raised
        @param   newFee New platform fee
    */
    function setPlatformFee(uint256 newFee) external onlyAdmin{

        require(newFee < MAX_FEE_POINTS, "Fee must be valid");
        platformFeeBasisPoints = newFee;

        emit NewPlatformFee(newFee);
    }

    /**
        @dev     Function to change owners fee
        @dev     It emits a `NewOwnersFee` event.
        @dev     Fee must be lower than total amount raised
        @param   newFee New owners fee
    */
    function setOwnersFee(uint256 id, uint256 newFee) external onlyAdmin{

        require( newFee < MAX_FEE_POINTS, "Fee must be valid");
        ownersFeeBasisPoints[id] = newFee;

        emit NewOwnersFee(id, newFee);
    }

    /**
        @dev    Function to change owners address where he will receive funds
        @dev    It emits a `NewPropertyOwnerAddrReceiver` event.
        @dev    Fee must be lower than fee charged by platform
        @param  id Property Id
        @param  newAddress New Property Owner Address
    */
    function setNewPropertyOwnerReceiverAddress(uint256 id, address newAddress) external onlyAdmin{

        require( newAddress != address(0), "Address must be valid");
        property[id].ownerExchAddr = newAddress;

        emit NewPropertyOwnerAddrReceiver(newAddress);
    }

    /**
        @dev    Function to extend property raise deadline
        @param  id Property id
        @param  newDeadline The deadline for the raise
    */
    function extendRaiseForProperty(uint256 id, uint256 newDeadline) external onlyAdmin{

        PropertyInfo storage p = property[id];

        require(p.raiseDeadline < newDeadline && p.raiseDeadline + EXTENDED_TIME >= newDeadline  && !p.extended, "Invalid deadline");
        property[id].raiseDeadline = newDeadline;
        property[id].extended = true;

        emit NewPropertyDeadline(id, newDeadline);
    }

    /**
        @dev    Function to set minimum investment amount
        @param  newMinInv Minimum Investment Amount
    */
    function setMinInvAmount(uint256 newMinInv) external onlyAdmin{
        require(newMinInv > 0, "Amount too low");
        minInvAmount = newMinInv;

        emit NewMinInvestmentAmount(newMinInv);
    }


    /**
        @dev    Function to set a new treasury address
        @dev    It emits a `NewTreasury` event.
        @param  newTreasury The new treasury address
    */
    function setTreasury(address newTreasury) external onlyAdmin{

        require(newTreasury != address(0), "Not allowed");
        treasury = newTreasury;

        emit NewTreasury(newTreasury);
    }


    /**
@dev    Function to set a new Referral Management Contract
        @dev    It emits a ` NewIssuanceContract` event.
        @param  newIssuanceCtr The new Issuance Management Contract

    */
    function setIssuanceContract(address newIssuanceCtr) external onlyAdmin{

        require(newIssuanceCtr != address(0), "Not allowed");
        ctrHestyIssuance = IIssuance(newIssuanceCtr);

        emit NewIssuanceContract(newIssuanceCtr);
    }

    function addWhitelistedToken(address newToken) external onlyAdmin{

        require(newToken != address(0), "Not allowed");

        tokensWhitelist[newToken] = true;

        emit AddWhitelistToken(newToken);
    }

    function removeWhitelistedToken(address oldToken) external onlyAdmin{

        require(tokensWhitelist[oldToken], "Not Found");

        tokensWhitelist[oldToken] = false;

        emit RemoveWhitelistToken(oldToken);
    }

}