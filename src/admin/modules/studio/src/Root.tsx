import "./index.css";
import { Composition } from "remotion";
import { PaymentFlowVideo, getPaymentFlowVideoMetadata } from "./PaymentFlowVideo";
import { PAYMENT_FLOW } from "./data/payment-flow";

export const RemotionRoot: React.FC = () => {
  const defaultProps = {
    flowData: PAYMENT_FLOW,
  };
  return (
    <>
      <Composition
        id="PaymentFlowVideo"
        component={PaymentFlowVideo}
        defaultProps={defaultProps}
        calculateMetadata={({props}) => {
          const metadata = getPaymentFlowVideoMetadata(props?.flowData);
          return {
            durationInFrames: metadata.durationInFrames,
            fps: metadata.fps,
            width: metadata.width,
            height: metadata.height,
          };
        }}
      />
    </>
  );
};
