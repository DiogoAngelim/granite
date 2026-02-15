export interface PixEscrowGateway {
  lockFunds(input: { referenceId: string; ownerId: string; amount: number }): Promise<void>;
  refundToOwner(input: { referenceId: string; ownerId: string; amount: number }): Promise<void>;
  releaseToExecutive(input: {
    referenceId: string;
    executiveId: string;
    netAmount: number;
    platformFee: number;
  }): Promise<void>;
}

export class PixEscrowGatewaySim implements PixEscrowGateway {
  async lockFunds(_input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    void _input;
    return;
  }

  async refundToOwner(_input: { referenceId: string; ownerId: string; amount: number }): Promise<void> {
    void _input;
    return;
  }

  async releaseToExecutive(_input: {
    referenceId: string;
    executiveId: string;
    netAmount: number;
    platformFee: number;
  }): Promise<void> {
    void _input;
    return;
  }
}