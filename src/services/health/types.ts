export enum NCResponse {
  SUCCESS = "succeeded!",
}

export enum SupportedBlockChains {
  AVA = "AVA",
  AVATST = "AVATST",
  ETH = "ETH",
  BSC = "BSC",
  BSCTST = "BSCTST",
  POL = "POL",
  POLTST = "POLTST",
  FUS = "FUS",
  XDAI = "XDAI",
  RIN = "RIN",
  ROP = "ROP",
  GOE = "GOE",
  KOV = "KOV",
  HEI = "HEI",
  POKT = "POKT"
}

export enum SupportedBlockChainTypes {
  ETH = "ETH",
  AVA = "AVA",
  HEI = "HEI",
  POKT = "POKT",
  SOL = "SOL",
  ALG = "ALG",
  HRM = "HRM"
}

export enum NonEthVariants {
  AVA = "AVA",
  AVATST = "AVATST"
}

export enum ErrorConditions {
  HEALTHY = "HEALTHY",
  OFFLINE = "OFFLINE",
  PEER_OFFLINE = "PEER_OFFLINE",
  NO_RESPONSE = "NO_RESPONSE",
  NO_RESPONSE_ONE_NODE = "NO_RESPONSE_ONE_NODE",
  NOT_SYNCHRONIZED = "NOT_SYNCHRONIZED",
}

export enum ErrorStatus {
  ERROR = "ERROR",
  OK = "OK",
  INFO = "INFO",
  WARNING = "WARNING",
}

export enum Messages {
  OFFLINE = "This node is offfline!",
}
export interface ExternalResponse {
  height: number;
}

interface BlockHeight {
  delta: number;
  externalHeight: number;
  internalHeight: number;
}

export interface HealthResponse {
  name: string;
  conditions?: ErrorConditions;
  ethSyncing?: any;
  height?: BlockHeight;
  peers?: number;
  status: ErrorStatus;
  health?: any;
  details?: any;
}
