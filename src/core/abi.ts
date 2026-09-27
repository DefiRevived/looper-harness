export const erc721Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
] as const;

/** Loopers-specific extension (LoopersUpgradeable.sol): ERC-8004 agent identity + ERC-6551 account. */
export const loopersExtrasAbi = [
  { type: 'function', name: 'erc8004BoundByLooper', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'erc8004AgentIdByLooper', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'erc8004AgentURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'erc8004AgentBaseURI', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'EXPECTED_IDENTITY_REGISTRY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenBoundAccount', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;
