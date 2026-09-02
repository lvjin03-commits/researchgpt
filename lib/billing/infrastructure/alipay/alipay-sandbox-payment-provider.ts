import {
  AlipayPaymentProvider,
  ALIPAY_SANDBOX_GATEWAY,
  minorUnitsToYuan,
  yuanToMinorUnits,
  type AlipayPaymentConfig,
  type AlipaySdkPort,
} from "./alipay-payment-provider.ts";

export type AlipaySandboxPaymentConfig = Omit<AlipayPaymentConfig, "mode">;

export class AlipaySandboxPaymentProvider extends AlipayPaymentProvider {
  constructor(config: AlipaySandboxPaymentConfig, sdk?: AlipaySdkPort) {
    super({ ...config, mode: "sandbox" }, sdk);
  }
}

export { ALIPAY_SANDBOX_GATEWAY, minorUnitsToYuan, yuanToMinorUnits };
export type { AlipaySdkPort };
