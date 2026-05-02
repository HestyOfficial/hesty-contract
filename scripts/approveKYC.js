const { ethers } = require("hardhat");

const HESTY_ACCESS_CONTROL_ADDRESS = "0x121D2845a883207355a1037066050437345071Ff"; // HestyAccessControl deployed address
const USER_ADDRESS                  = "0x8d2fa83D53f5281ed7f3Cc9496fa969b84942285"; // Address to KYC-approve
const SPONSOR                       = false; // true → approveUserKYC (sends ETH to user if low balance)

async function main() {
  if (!HESTY_ACCESS_CONTROL_ADDRESS) throw new Error("HESTY_ACCESS_CONTROL_ADDRESS is required");
  if (!USER_ADDRESS) throw new Error("USER_ADDRESS is required");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const hestyAccessControl = await ethers.getContractAt("HestyAccessControl", HESTY_ACCESS_CONTROL_ADDRESS, signer);

  const alreadyKYC = await hestyAccessControl.kycCompleted(USER_ADDRESS);
  if (alreadyKYC) {
    console.log("User already KYC approved, nothing to do.");
    return;
  }

  const fn = SPONSOR ? "approveUserKYC" : "approveKYCOnly";
  console.log(`Calling ${fn} for ${USER_ADDRESS}...`);

  const tx = await hestyAccessControl[fn](USER_ADDRESS);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("KYC approved.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });