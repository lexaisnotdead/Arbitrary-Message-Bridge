const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
  
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );
    
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const Sender = await ethers.getContractFactory("Sender");
    const sender = await upgrades.deployProxy(Sender, { initializer: 'initialize', kind: 'uups' });
    await sender.deployed();
    
    console.log("Sender contract deployed to:", sender.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });