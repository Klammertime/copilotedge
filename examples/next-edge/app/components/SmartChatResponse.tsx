"use client";
import { useEffect, useState } from "react";

export function SmartChatResponse({ 
  fetchResponse, 
  query,
  fakeTypewriter = true 
}: { 
  fetchResponse:(q:string)=>Promise<string>, 
  query:string,
  fakeTypewriter?: boolean
}) {
  const [stage, setStage] = useState<"t0"|"t1"|"t2"|"done">("t0");
  const [text, setText] = useState("");
  const [display, setDisplay] = useState("");

  useEffect(() => {
    let active = true;
    setStage("t0"); setText(""); setDisplay("");

    const timers = [
      setTimeout(()=>active&&setStage("t1"), 300),
      setTimeout(()=>active&&setStage("t2"), 900)
    ];
    const start = performance.now();

    fetchResponse(query).then(res => {
      if (!active) return;
      setText(res);
      setStage("done");
      // typewriter fake only if short
      const cps = 30;
      if (fakeTypewriter && res.length <= 600) {
        let i = 0;
        const tick = () => {
          if (!active) return;
          i += Math.max(1, Math.floor(cps/10));
          setDisplay(res.slice(0, i));
          if (i < res.length) setTimeout(tick, 100);
          else setDisplay(res);
        };
        tick();
      } else {
        setDisplay(res);
      }
      // emit perf mark
      window.dispatchEvent(new CustomEvent("ce:latency", { detail: { ttfb_ms: performance.now()-start }}));
    });

    return () => { active=false; timers.forEach(clearTimeout); };
  }, [query, fetchResponse]);

  if (stage !== "done") {
    return <div className="text-sm text-zinc-500">
      {stage==="t0" && "Thinking…"}
      {stage==="t1" && "Searching context…"}
      {stage==="t2" && "Formulating answer…"}
    </div>;
  }
  return <div className="whitespace-pre-wrap">{display}</div>;
}