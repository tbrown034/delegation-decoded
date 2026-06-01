interface OgStatProps {
  label: string;
  value: string;
  color?: string;
  valueSize?: number;
  valueLetterSpacing?: number;
}

export function OgStat({
  label,
  value,
  color,
  valueSize = 48,
  valueLetterSpacing = -1,
}: OgStatProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontSize: valueSize,
          fontWeight: 600,
          color: color ?? "#171717",
          fontFamily: "Georgia, serif",
          letterSpacing: valueLetterSpacing,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 14,
          color: "#737373",
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginTop: 4,
          fontFamily: "system-ui",
        }}
      >
        {label}
      </div>
    </div>
  );
}
