import React from 'react';

/**
 * Liquid Glass 的折射滤镜（WWDC25 那套光学三件套里的"折射"）。
 *
 * 苹果的 Liquid Glass 由多层组成：折射、镜面高光、随内容自适应的半透明底色。
 * 网页里做不到 Metal 级的实时折射，但可以用 SVG 的 feTurbulence + feDisplacementMap
 * 把 backdrops（玻璃背后的内容）做低频位移——就是那层"厚玻璃把背景轻微扭曲"的感觉。
 * Chromium（Android WebView / Chrome）支持把 SVG 滤镜放进 backdrop-filter，
 * 不支持时 ThemeContext 会自动退回纯磨砂，不会整块失效。
 */
export const GLASS_FILTER_ID = 'itdc-lg-refract';

const GlassFilters: React.FC = () => (
  <svg
    width="0"
    height="0"
    aria-hidden
    focusable="false"
    style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
  >
    <defs>
      {/* 滤镜区域比元素大一圈：位移会把边缘像素"拉"进来，留足余量才不会出现透明缺口。
          区域和 octaves 都压到刚好够用——这是每帧都要重算的滤镜，越省越不闪。 */}
      <filter
        id={GLASS_FILTER_ID}
        x="-8%"
        y="-8%"
        width="116%"
        height="116%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.009 0.013"
          numOctaves="1"
          seed="7"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="14"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>
);

export default GlassFilters;
