const assert = require('assert')
const Web3Utils = require('web3-utils')
const env = require('../loadEnv')
const { ZERO_ADDRESS } = require('../constants')

const {
  deployContract,
  privateKeyToAddress,
  sendRawTxHome,
  upgradeProxy,
  initializeValidators,
  transferProxyOwnership,
  setBridgeContract,
  transferOwnership,
  assertStateWithRetry
} = require('../deploymentUtils')
const { web3Home, deploymentPrivateKey, HOME_RPC_URL } = require('../web3')

const {
  homeContracts: {
    EternalStorageProxy,
    BridgeValidators,
    RewardableValidators,
    FeeManagerErcToErcPOSDAO,
    HomeBridgeErcToErc,
    HomeBridgeErcToErcPOSDAO,
    ERC677BridgeToken,
    ERC677BridgeTokenRewardable,
    AbsoluteDailyLimit,
    RelativeDailyLimit
  }
} = require('../loadContracts')

const VALIDATORS = env.VALIDATORS.split(' ')

const {
  DEPLOYMENT_ACCOUNT_PRIVATE_KEY,
  REQUIRED_NUMBER_OF_VALIDATORS,
  HOME_BRIDGE_OWNER,
  HOME_VALIDATORS_OWNER,
  HOME_UPGRADEABLE_ADMIN,
  HOME_DAILY_LIMIT,
  HOME_MAX_AMOUNT_PER_TX,
  HOME_MIN_AMOUNT_PER_TX,
  HOME_REQUIRED_BLOCK_CONFIRMATIONS,
  HOME_GAS_PRICE,
  BRIDGEABLE_TOKEN_NAME,
  BRIDGEABLE_TOKEN_SYMBOL,
  BRIDGEABLE_TOKEN_DECIMALS,
  FOREIGN_DAILY_LIMIT,
  FOREIGN_MAX_AMOUNT_PER_TX,
  FOREIGN_MIN_AMOUNT_PER_TX,
  DEPLOY_REWARDABLE_TOKEN,
  BLOCK_REWARD_ADDRESS,
  DPOS_STAKING_ADDRESS,
  HOME_REWARDABLE,
  HOME_TRANSACTIONS_FEE,
  FOREIGN_TRANSACTIONS_FEE,
  FOREIGN_TO_HOME_DECIMAL_SHIFT,
  RELATIVE_DAILY_LIMIT,
  TARGET_LIMIT,
  THRESHOLD,
} = env

const DEPLOYMENT_ACCOUNT_ADDRESS = privateKeyToAddress(DEPLOYMENT_ACCOUNT_PRIVATE_KEY)

const foreignToHomeDecimalShift = FOREIGN_TO_HOME_DECIMAL_SHIFT || 0

const isRewardableBridge = HOME_REWARDABLE === 'BOTH_DIRECTIONS'

let VALIDATORS_REWARD_ACCOUNTS = []

if (isRewardableBridge && BLOCK_REWARD_ADDRESS === ZERO_ADDRESS) {
  VALIDATORS_REWARD_ACCOUNTS = env.VALIDATORS_REWARD_ACCOUNTS.split(' ')
}

async function initializeBridge({ validatorsBridge, bridge, erc677token, limitsContract, initialNonce }) {
  let nonce = initialNonce
  let initializeHomeBridgeData

  const requestLimitsArray = RELATIVE_DAILY_LIMIT
    ? [TARGET_LIMIT, THRESHOLD, HOME_MAX_AMOUNT_PER_TX, HOME_MIN_AMOUNT_PER_TX]
    : [HOME_DAILY_LIMIT, HOME_MAX_AMOUNT_PER_TX, HOME_MIN_AMOUNT_PER_TX]

  let RELATIVE_DAILY_LIMIT_PARAMS
  if (RELATIVE_DAILY_LIMIT) {
    RELATIVE_DAILY_LIMIT_PARAMS = `TARGET_LIMIT: ${TARGET_LIMIT} which is ${
      Web3Utils.fromWei(Web3Utils.toBN(TARGET_LIMIT).mul(Web3Utils.toBN(100)))
    }%,
      THRESHOLD: ${THRESHOLD} which is ${Web3Utils.fromWei(THRESHOLD)} in eth,`
  }

  if (isRewardableBridge && BLOCK_REWARD_ADDRESS !== ZERO_ADDRESS) {
    console.log('\ndeploying implementation for fee manager')
    const feeManager = await deployContract(FeeManagerErcToErcPOSDAO, [], {
      from: DEPLOYMENT_ACCOUNT_ADDRESS,
      nonce
    })
    console.log('[Home] feeManager Implementation: ', feeManager.options.address)
    nonce++

    const homeFeeInWei = Web3Utils.toWei(HOME_TRANSACTIONS_FEE.toString(), 'ether')
    const foreignFeeInWei = Web3Utils.toWei(FOREIGN_TRANSACTIONS_FEE.toString(), 'ether')
    console.log('\ninitializing Home Bridge with fee contract:\n')
    console.log(`Home Validators: ${validatorsBridge.options.address},
    ${
      RELATIVE_DAILY_LIMIT
        ? RELATIVE_DAILY_LIMIT_PARAMS
        : `HOME_DAILY_LIMIT : ${HOME_DAILY_LIMIT} which is ${Web3Utils.fromWei(HOME_DAILY_LIMIT)} in eth,`
    }
    HOME_MAX_AMOUNT_PER_TX: ${HOME_MAX_AMOUNT_PER_TX} which is ${Web3Utils.fromWei(HOME_MAX_AMOUNT_PER_TX)} in eth,
    HOME_MIN_AMOUNT_PER_TX: ${HOME_MIN_AMOUNT_PER_TX} which is ${Web3Utils.fromWei(HOME_MIN_AMOUNT_PER_TX)} in eth,
    HOME_GAS_PRICE: ${HOME_GAS_PRICE}, HOME_REQUIRED_BLOCK_CONFIRMATIONS : ${HOME_REQUIRED_BLOCK_CONFIRMATIONS},
    LIMITS_CONTRACT: ${limitsContract.options.address},
    Block Reward: ${BLOCK_REWARD_ADDRESS},
    Fee Manager: ${feeManager.options.address},
    Home Fee: ${homeFeeInWei} which is ${HOME_TRANSACTIONS_FEE * 100}%
    Foreign Fee: ${foreignFeeInWei} which is ${FOREIGN_TRANSACTIONS_FEE * 100}%`)
    initializeHomeBridgeData = await bridge.methods
      .rewardableInitialize(
        validatorsBridge.options.address,
        requestLimitsArray,
        HOME_GAS_PRICE,
        HOME_REQUIRED_BLOCK_CONFIRMATIONS,
        erc677token.options.address,
        [FOREIGN_DAILY_LIMIT, FOREIGN_MAX_AMOUNT_PER_TX, FOREIGN_MIN_AMOUNT_PER_TX],
        HOME_BRIDGE_OWNER,
        feeManager.options.address,
        [homeFeeInWei, foreignFeeInWei],
        BLOCK_REWARD_ADDRESS,
        foreignToHomeDecimalShift,
        limitsContract.options.address
      )
      .encodeABI()
  } else {
    console.log(`Home Validators: ${validatorsBridge.options.address},
    ${
      RELATIVE_DAILY_LIMIT
        ? RELATIVE_DAILY_LIMIT_PARAMS
        : `HOME_DAILY_LIMIT : ${HOME_DAILY_LIMIT} which is ${Web3Utils.fromWei(HOME_DAILY_LIMIT)} in eth,`
    }
    HOME_MAX_AMOUNT_PER_TX: ${HOME_MAX_AMOUNT_PER_TX} which is ${Web3Utils.fromWei(HOME_MAX_AMOUNT_PER_TX)} in eth,
    HOME_MIN_AMOUNT_PER_TX: ${HOME_MIN_AMOUNT_PER_TX} which is ${Web3Utils.fromWei(HOME_MIN_AMOUNT_PER_TX)} in eth,
    HOME_GAS_PRICE: ${HOME_GAS_PRICE}, HOME_REQUIRED_BLOCK_CONFIRMATIONS : ${HOME_REQUIRED_BLOCK_CONFIRMATIONS},
    FOREIGN_TO_HOME_DECIMAL_SHIFT: ${foreignToHomeDecimalShift},
    LIMITS_CONTRACT: ${limitsContract.options.address}
    `)
    initializeHomeBridgeData = await bridge.methods
      .initialize(
        validatorsBridge.options.address,
        requestLimitsArray,
        HOME_GAS_PRICE,
        HOME_REQUIRED_BLOCK_CONFIRMATIONS,
        erc677token.options.address,
        [FOREIGN_DAILY_LIMIT, FOREIGN_MAX_AMOUNT_PER_TX, FOREIGN_MIN_AMOUNT_PER_TX],
        HOME_BRIDGE_OWNER,
        foreignToHomeDecimalShift,
        limitsContract.options.address
      )
      .encodeABI()
  }

  const txInitializeHomeBridge = await sendRawTxHome({
    data: initializeHomeBridgeData,
    nonce,
    to: bridge.options.address,
    privateKey: deploymentPrivateKey,
    url: HOME_RPC_URL
  })
  if (txInitializeHomeBridge.status) {
    assert.strictEqual(Web3Utils.hexToNumber(txInitializeHomeBridge.status), 1, 'Transaction Failed')
  } else {
    await assertStateWithRetry(bridge.methods.isInitialized().call, true)
  }
  nonce++

  return nonce
}

async function deployHome() {
  let nonce = await web3Home.eth.getTransactionCount(DEPLOYMENT_ACCOUNT_ADDRESS)
  console.log('deploying storage for home validators')
  const storageValidatorsHome = await deployContract(EternalStorageProxy, [], {
    from: DEPLOYMENT_ACCOUNT_ADDRESS,
    nonce
  })
  console.log('[Home] BridgeValidators Storage: ', storageValidatorsHome.options.address)
  nonce++

  console.log('\ndeploying implementation for home validators')
  const bridgeValidatorsContract =
    isRewardableBridge && BLOCK_REWARD_ADDRESS === ZERO_ADDRESS ? RewardableValidators : BridgeValidators
  const bridgeValidatorsHome = await deployContract(bridgeValidatorsContract, [], {
    from: DEPLOYMENT_ACCOUNT_ADDRESS,
    nonce
  })
  console.log('[Home] BridgeValidators Implementation: ', bridgeValidatorsHome.options.address)
  nonce++

  console.log('\nhooking up eternal storage to BridgeValidators')
  await upgradeProxy({
    proxy: storageValidatorsHome,
    implementationAddress: bridgeValidatorsHome.options.address,
    version: '1',
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  console.log('\ninitializing Home Bridge Validators with following parameters:\n')
  bridgeValidatorsHome.options.address = storageValidatorsHome.options.address
  await initializeValidators({
    contract: bridgeValidatorsHome,
    isRewardableBridge: isRewardableBridge && BLOCK_REWARD_ADDRESS === ZERO_ADDRESS,
    requiredNumber: REQUIRED_NUMBER_OF_VALIDATORS,
    validators: VALIDATORS,
    rewardAccounts: VALIDATORS_REWARD_ACCOUNTS,
    owner: HOME_VALIDATORS_OWNER,
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  console.log('transferring proxy ownership to multisig for Validators Proxy contract')
  await transferProxyOwnership({
    proxy: storageValidatorsHome,
    newOwner: HOME_UPGRADEABLE_ADMIN,
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  console.log('\ndeploying limits contract')
  const LimitsContract = RELATIVE_DAILY_LIMIT ? RelativeDailyLimit : AbsoluteDailyLimit
  const limitsContract = await deployContract(LimitsContract, [], {
    from: DEPLOYMENT_ACCOUNT_ADDRESS,
    nonce
  })
  nonce++
  console.log('[Home] Limits Contract: ', limitsContract.options.address)

  console.log('\ndeploying homeBridge storage\n')
  const homeBridgeStorage = await deployContract(EternalStorageProxy, [], {
    from: DEPLOYMENT_ACCOUNT_ADDRESS,
    nonce
  })
  nonce++
  console.log('[Home] HomeBridge Storage: ', homeBridgeStorage.options.address)

  console.log('\ndeploying homeBridge implementation\n')
  const bridgeContract =
    isRewardableBridge && BLOCK_REWARD_ADDRESS !== ZERO_ADDRESS ? HomeBridgeErcToErcPOSDAO : HomeBridgeErcToErc
  const homeBridgeImplementation = await deployContract(bridgeContract, [], {
    from: DEPLOYMENT_ACCOUNT_ADDRESS,
    nonce
  })
  nonce++
  console.log('[Home] HomeBridge Implementation: ', homeBridgeImplementation.options.address)

  console.log('\nhooking up HomeBridge storage to HomeBridge implementation')
  await upgradeProxy({
    proxy: homeBridgeStorage,
    implementationAddress: homeBridgeImplementation.options.address,
    version: '1',
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  console.log('\n[Home] deploying Bridgeble token')
  const erc677Contract =
    (isRewardableBridge && BLOCK_REWARD_ADDRESS !== ZERO_ADDRESS) || DEPLOY_REWARDABLE_TOKEN
      ? ERC677BridgeTokenRewardable
      : ERC677BridgeToken
  const erc677token = await deployContract(
    erc677Contract,
    [BRIDGEABLE_TOKEN_NAME, BRIDGEABLE_TOKEN_SYMBOL, BRIDGEABLE_TOKEN_DECIMALS],
    { from: DEPLOYMENT_ACCOUNT_ADDRESS, network: 'home', nonce }
  )
  nonce++
  console.log('[Home] Bridgeble Token: ', erc677token.options.address)

  console.log('\nset bridge contract on ERC677BridgeToken')
  await setBridgeContract({
    contract: erc677token,
    bridgeAddress: homeBridgeStorage.options.address,
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  if ((isRewardableBridge && BLOCK_REWARD_ADDRESS !== ZERO_ADDRESS) || DEPLOY_REWARDABLE_TOKEN) {
    console.log('\nset BlockReward contract on ERC677BridgeTokenRewardable')
    const setBlockRewardContractData = await erc677token.methods
      .setBlockRewardContract(BLOCK_REWARD_ADDRESS)
      .encodeABI({ from: DEPLOYMENT_ACCOUNT_ADDRESS })
    const setBlockRewardContract = await sendRawTxHome({
      data: setBlockRewardContractData,
      nonce,
      to: erc677token.options.address,
      privateKey: deploymentPrivateKey,
      url: HOME_RPC_URL
    })
    assert.strictEqual(Web3Utils.hexToNumber(setBlockRewardContract.status), 1, 'Transaction Failed')
    nonce++
  }

  if (DEPLOY_REWARDABLE_TOKEN) {
    console.log('\nset Staking contract on ERC677BridgeTokenRewardable')
    const setStakingContractData = await erc677token.methods
      .setStakingContract(DPOS_STAKING_ADDRESS)
      .encodeABI({ from: DEPLOYMENT_ACCOUNT_ADDRESS })
    const setStakingContract = await sendRawTxHome({
      data: setStakingContractData,
      nonce,
      to: erc677token.options.address,
      privateKey: deploymentPrivateKey,
      url: HOME_RPC_URL
    })
    assert.strictEqual(Web3Utils.hexToNumber(setStakingContract.status), 1, 'Transaction Failed')
    nonce++
  }

  console.log('transferring ownership of Bridgeble token to homeBridge contract')
  await transferOwnership({
    contract: erc677token,
    newOwner: homeBridgeStorage.options.address,
    nonce,
    url: HOME_RPC_URL
  })
  nonce++

  console.log('\ninitializing Home Bridge with following parameters:\n')
  homeBridgeImplementation.options.address = homeBridgeStorage.options.address

  nonce = await initializeBridge({
    validatorsBridge: storageValidatorsHome,
    bridge: homeBridgeImplementation,
    erc677token,
    limitsContract,
    initialNonce: nonce
  })

  console.log('transferring proxy ownership to multisig for Home bridge Proxy contract')
  await transferProxyOwnership({
    proxy: homeBridgeStorage,
    newOwner: HOME_UPGRADEABLE_ADMIN,
    nonce,
    url: HOME_RPC_URL
  })

  console.log('\nHome Deployment Bridge completed\n')
  return {
    homeBridge: {
      address: homeBridgeStorage.options.address,
      deployedBlockNumber: Web3Utils.hexToNumber(homeBridgeStorage.deployedBlockNumber)
    },
    erc677: { address: erc677token.options.address }
  }
}
module.exports = deployHome
