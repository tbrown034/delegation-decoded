import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#171717",
          borderRadius: 6,
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
            fontSize: 17,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: -1,
          }}
        >
          DD
        </span>
        {/* Thin accent bar at bottom — party colors */}
        <div
          style={{
            position: "absolute",
            bottom: 3,
            left: 6,
            right: 6,
            height: 2,
            borderRadius: 1,
            display: "flex",
            gap: 1,
          }}
        >
          <div style={{ flex: 1, background: "#2563eb", borderRadius: 1 }} />
          <div style={{ flex: 1, background: "#dc2626", borderRadius: 1 }} />
        </div>
      </div>
    ),
    { ...size }
  );
}
