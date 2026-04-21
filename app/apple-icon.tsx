import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#171717",
          borderRadius: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* DD monogram */}
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 90,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: -4,
          }}
        >
          DD
        </span>
        {/* Thin accent bar at bottom — party colors */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 32,
            right: 32,
            height: 6,
            borderRadius: 3,
            display: "flex",
            gap: 4,
          }}
        >
          <div style={{ flex: 1, background: "#2563eb", borderRadius: 3 }} />
          <div style={{ flex: 1, background: "#dc2626", borderRadius: 3 }} />
        </div>
      </div>
    ),
    { ...size }
  );
}
