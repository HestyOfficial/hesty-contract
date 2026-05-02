const { ethers } = require("hardhat");

const HESTY_ACCESS_CONTROL_ADDRESS = "0x121D2845a883207355a1037066050437345071Ff"; // HestyAccessControl deployed address
const USER_ADDRESS                  = "0x4af205B25330F0fC7186b1c670D921fa828071d7"; // Address to revoke KYC from

async function main() {
  if (!HESTY_ACCESS_CONTROL_ADDRESS) throw new Error("HESTY_ACCESS_CONTROL_ADDRESS is required");
  if (!USER_ADDRESS) throw new Error("USER_ADDRESS is required");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const hestyAccessControl = await ethers.getContractAt("HestyAccessControl", HESTY_ACCESS_CONTROL_ADDRESS, signer);

  const isKYC = await hestyAccessControl.kycCompleted(USER_ADDRESS);
  if (!isKYC) {
    console.log("User is not KYC approved, nothing to revert.");
    return;
  }

  console.log(`Revoking KYC for ${USER_ADDRESS}...`);

  const tx = await hestyAccessControl.revertUserKYC(USER_ADDRESS);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("KYC revoked.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });