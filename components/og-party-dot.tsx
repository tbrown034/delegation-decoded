interface OgPartyDotProps {
  color: string;
  count: number;
  label: string;
}

export function OgPartyDot({ color, count, label }: OgPartyDotProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        fontSize: 22,
        fontWeight: 600,
        color: "#404040",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 14,
          height: 14,
          borderRadius: 99,
          background: color,
        }}
      />
      <div style={{ display: "flex" }}>{`${count} ${label}`}</div>
    </div>
  );
}
