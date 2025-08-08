if (typeof window !== "undefined") {
  window.addEventListener("ce:latency", (e:any) => {
    console.log("[CE] ttfb_ms", Math.round(e.detail.ttfb_ms));
  });
}