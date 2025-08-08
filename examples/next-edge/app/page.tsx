"use client";
import { useState } from "react";
import { SmartChatResponse } from "./components/SmartChatResponse";

export default function Page() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const fetchResponse = async (q: string): Promise<string> => {
    const res = await fetch("/api/copilotedge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: q }] })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || data.error || "No response";
  };

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">CopilotEdge Demo</h1>
      
      <div className="space-y-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSubmitted(query)}
          placeholder="Ask something..."
          className="w-full px-4 py-2 border rounded"
        />
        <button
          onClick={() => setSubmitted(query)}
          className="px-6 py-2 bg-blue-500 text-white rounded"
        >
          Send
        </button>
      </div>

      {submitted && (
        <div className="mt-8 p-4 bg-gray-50 rounded">
          <SmartChatResponse 
            fetchResponse={fetchResponse} 
            query={submitted}
            fakeTypewriter={process.env.CE_FAKE_TYPEWRITER !== "off"}
          />
        </div>
      )}
    </main>
  );
}