import "./index.css";
import { Composition } from "remotion";
import { PaymentFlowVideo } from "./PaymentFlowVideo";
import { VIDEO_DURATION_IN_FRAMES, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./data/steps";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PaymentFlowVideo"
        component={PaymentFlowVideo}
        durationInFrames={VIDEO_DURATION_IN_FRAMES}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
      />
    </>
  );
};
