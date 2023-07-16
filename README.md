#  AMB - Arbitrary Message Bridge
The Arbitrary Message Bridge (AMB) is designed to relay **any data** between two EVM-based chains. The user encodes data in the form of an arbitrary method call, which can also include or exclude parameters. This information, along with the target contract address and foreign chain ID, is passed to the *Sender* contract.  As soon as data are relayed from chain A to chain B by the validators, the user can call the ```executeMessage``` function in the *Receiver* contract on side B to execute the encoded method of the target contract. Oracles can validate messages by listening to *Sender* events or using data stored on-chain in the *Sender* contract.

## Features
* ```sendMessage```: The main user function of the *Sender* contract. Allows the user to send an encoded message to the provided chain.
* ```executeMessage```: The main user function of the *Receiver* contract. Allows the user to execute an encoded message if it has been validated by oracles.

## Use cases
* transfer digital assets between two chains
* trigger a method in one chain after some contract invocation in another chain
* propagate tokens prices to another chain
* synchronize contracts states between two chains

## Setup
1. Clone the repository and navigate to the project directory:
```bash
git clone https://github.com/lexaisnotdead/Arbitrary-Message-Bridge.git
cd ./Arbitrary-Message-Bridge
```
2. Install the project dependencies:
```bash
npm install
```
3. Create a new ```.env``` file in the project directory with the following variables:
```bash
INFURA_API_KEY = <your_infura_project_id>
PRIVATE_KEY = <your_private_key>
ETHERSCAN_API_KEY = <your_etherscan_api_key>
```
4. create a new ```state.json``` file according to the example from ```state-example.json```.

## Usage
To run the tests, simply execute the following command:
```bash
npx hardhat test
```

To deploy the contracts to a local network, execute the following commands:
```bash
npx hardhat run scripts/deploy-sender.js --network localhost
npx hardhat run scripts/deploy-receiver.js --network localhost
```
Replace ```localhost``` with the name of the network you want to deploy to (e.g. goerli, mainnet, etc.) and make sure you have the corresponding configuration in the `hardhat.config.js` file.

## Links
Links to the verified contracts in the Goerli network:

[Sender proxy contract](https://goerli.etherscan.io/address/0x129c74253d415A623Ca5Ea5d867208561F5dcB6e#code)

[Sender implementation contract](https://goerli.etherscan.io/address/0x66Dc821D18fb74c9e499e05aaC0Efe98b93af9ed#code)

[Receiver proxy contract](https://goerli.etherscan.io/address/0xA26155B8bC43F745bc519A708cbcfBFdfF369124#code)

[Receiver implementation contract](https://goerli.etherscan.io/address/0xe55a94A1c0536F02674a4151db7269b459Db7e7c#code)