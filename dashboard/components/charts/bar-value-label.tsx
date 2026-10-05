/**
 * LabelList content for horizontal bars: the value sits just past the bar's data end,
 * on the left for negative values, and is drawn even for zero-length bars.
 */
export function barValueLabel(format: (v: number, index: number) => string, fill: string) {
  return function BarValueLabel(props: unknown) {
    const { x, y, width, height, value, index } = props as { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown; index?: number };
    if (typeof value !== "number") return null;
    const left = Number(x);
    const w = Number(width);
    const end = value < 0 ? Math.min(left, left + w) : Math.max(left, left + w);
    return (
      <text x={value < 0 ? end - 6 : end + 6} y={Number(y) + Number(height) / 2} dy="0.35em" textAnchor={value < 0 ? "end" : "start"} fill={fill} fontSize={12}>
        {format(value, index ?? 0)}
      </text>
    );
  };
}
