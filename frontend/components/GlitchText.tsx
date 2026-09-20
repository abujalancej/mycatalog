"use client";

import type { CSSProperties, FC } from "react";

type GlitchTextProps = {
  children: string;
  speed?: number;
  enableShadows?: boolean;
  enableOnHover?: boolean;
  className?: string;
};

interface CustomCSSProperties extends CSSProperties {
  "--after-duration": string;
  "--before-duration": string;
  "--after-shadow": string;
  "--before-shadow": string;
}

const GlitchText: FC<GlitchTextProps> = ({
  children,
  speed = 0.9,
  enableShadows = true,
  enableOnHover = false,
  className = ""
}) => {
  const inlineStyles: CustomCSSProperties = {
    "--after-duration": `${speed * 3}s`,
    "--before-duration": `${speed * 2}s`,
    "--after-shadow": enableShadows ? "-3px 0 rgba(255, 71, 87, 0.55)" : "none",
    "--before-shadow": enableShadows ? "3px 0 rgba(57, 209, 255, 0.55)" : "none"
  };

  const hoverClass = enableOnHover ? "enable-on-hover" : "";

  return (
    <div className={`glitch ${hoverClass} ${className}`.trim()} style={inlineStyles} data-text={children}>
      {children}
    </div>
  );
};

export default GlitchText;
