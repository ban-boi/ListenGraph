/**
 * SVG 波浪路径生成器。
 *
 * 根据物理尺寸和曲率参数生成 SVG path 的 d 属性和配套 viewBox。
 * 路径长度 = length × 2（无缝滚动动画需要双倍重复）。
 */

export interface WavePathResult {
  /** SVG path 的 d 属性 */
  readonly path: string;
  /** SVG viewBox 属性值 */
  readonly viewBox: string;
  /** 实际 wave 数量 */
  readonly numWaves: number;
  /** 实际波长（px），可能因四舍五入偏离 targetWavelength */
  readonly actualWavelength: number;
}

/**
 * @param length 波浪线在主方向上的物理长度（px）
 * @param crossLength 波浪线在垂直方向上的尺寸（px）
 * @param amplitude 振幅（中心到峰/谷距离，px）
 * @param targetWavelength 目标波长（px），实际波长按 wave 数取整调整
 * @param direction 'horizontal'（横向波）或 'vertical'（竖向波）
 */
export function generateWavePath(
  length: number,
  crossLength: number,
  amplitude: number,
  targetWavelength: number,
  direction: 'horizontal' | 'vertical',
): WavePathResult {
  const numWaves = Math.max(1, Math.round(length / targetWavelength));
  const actualWavelength = length / numWaves;
  const halfWave = actualWavelength / 2;
  const totalLength = length * 2;
  const totalCurves = numWaves * 4;

  if (direction === 'horizontal') {
    const cy = crossLength / 2;
    let d = `M0 ${cy}`;
    for (let i = 0; i < totalCurves; i++) {
      const x0 = i * halfWave;
      const x1 = x0 + halfWave;
      const peak = i % 2 === 0 ? cy - amplitude : cy + amplitude;
      d += ` Q${(x0 + x1) / 2} ${peak} ${x1} ${cy}`;
    }
    return {
      path: d,
      viewBox: `0 0 ${totalLength} ${crossLength}`,
      numWaves,
      actualWavelength,
    };
  }

  // vertical
  const cx = crossLength / 2;
  let d = `M${cx} 0`;
  for (let i = 0; i < totalCurves; i++) {
    const y0 = i * halfWave;
    const y1 = y0 + halfWave;
    const peak = i % 2 === 0 ? cx - amplitude : cx + amplitude;
    d += ` Q${peak} ${(y0 + y1) / 2} ${cx} ${y1}`;
  }
  return {
    path: d,
    viewBox: `0 0 ${crossLength} ${totalLength}`,
    numWaves,
    actualWavelength,
  };
}
