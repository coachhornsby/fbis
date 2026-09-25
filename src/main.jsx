import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Offline() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#0b0f14",
      color: "#e7edf4",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      padding: "24px"
    }}>
      <section style={{maxWidth:"640px",textAlign:"center"}}>
        <h1 style={{fontSize:"32px",margin:"0 0 12px"}}>FBIS is offline</h1>
        <p style={{margin:0,lineHeight:1.5,color:"#aeb8c4"}}>
          The site and automated ACTION/Apify collection are paused.
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Offline />
  </StrictMode>
);
